# market_routes.py - Indicadores de App 1 en vivo: las rutas que piden sus *Indicator.js fuera de reproduccion.
#
#   GET  /api/open-interest/{symbol}            Interes abierto (y la Confluencia OI, que lo lee del indicador)
#   GET  /api/vwap/{symbol}                     VWAP de sesion, anclado o movil, con bandas
#   GET  /api/support-resistance/{symbol}       S&R clasico (pivots con volumen)
#   POST /api/rejection-patterns/detect         Patrones de rechazo validados por contextos
#   GET  /api/rejection-patterns/available-contexts/{symbol}
#   POST /api/double-topbottom/detect           Double Top/Bottom (devuelve los patrones y sus tramos)
#   POST /api/double-topbottom/chunk
#   GET  /api/orderflow/elements/{symbol}       Elementos OF con los dias de la nube y el PC (live)
#   POST /api/orderflow/setups/{symbol}         Coincidencias de las recetas, tambien con live
#   POST /api/orderflow/setups/{symbol}/evaluate  Evaluar una receta (solo dias oficiales, como App 1)
#   GET  /api/orderflow/setups/{symbol}/validations  Comprobaciones finales hechas en App 1 (solo lectura)
#
# Swing Detector y Range Detection no piden nada al servidor: calculan en la pagina con las velas.
#
# Reutiliza los modulos del backend de App 1 por import (oi_store, vwap_calculator, sr_levels, of_elements,
# of_setups, rejection_detector, double_topbottom_detector), sin importar su main.py. Nunca envia alertas:
# alert_sender.py de App 1 no se usa y las rutas /api/pattern-alert y /api/proximity-alerts no existen.
# Ninguna ruta escribe en OrderFlowData.
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

sys.path.insert(0, str(Path(__file__).resolve().parent))
from settings import CONFIG  # noqa: E402
import candles  # noqa: E402

DATA = Path(CONFIG["orderflow_data"])
os.environ.setdefault("ORDERFLOW_STORE", str(DATA / "store"))
os.environ.setdefault("ORDERFLOW_LIVE_STORE", str(DATA / "live" / "store"))
os.environ.setdefault("ORDERFLOW_FLOW", str(DATA / "flow"))
os.environ.setdefault("ORDERFLOW_LIVE_FLOW", str(DATA / "live" / "flow"))
os.environ.setdefault("ORDERFLOW_OI", str(DATA / "oi"))
OBSERVER_DIR = Path(os.environ.get("ORDERFLOW_OBSERVER", str(DATA / "observer")))
if CONFIG["app1_backend"] not in sys.path:
    sys.path.insert(0, CONFIG["app1_backend"])
import footprint_store  # noqa: E402
import oi_store  # noqa: E402
import of_elements  # noqa: E402
import of_setups  # noqa: E402
import sr_levels  # noqa: E402
from vwap_calculator import vwap_calculator  # noqa: E402
from rejection_detector import RejectionDetector, serialize_pattern as serialize_rejection  # noqa: E402
from double_topbottom_detector import DoubleTopBottomDetector, serialize_pattern as serialize_double  # noqa: E402

router = APIRouter()
_rejection = RejectionDetector()
_double = DoubleTopBottomDetector()
DAY_MS = 86_400_000
TF_MINUTES = (1, 5, 15, 60, 240)

# Interes abierto: Bybit da 5min, 15min, 1h y 4h; 1m usa 5min, como App 1
OI_BYBIT = {5: "5min", 15: "15min", 60: "1h", 240: "4h"}
OI_PAGE = 200            # puntos por pedido a Bybit
OI_MAX_REQUESTS = 25     # 5,000 puntos por consulta como mucho
OI_TAIL_SECONDS = 60     # el ultimo tramo se vuelve a pedir a Bybit pasado este tiempo
_oi_cache = {}           # (simbolo, minutos) -> {"points": {ts: oi}, "from": ms, "at": s}

# Double Top/Bottom: patrones por tramo trimestral, para /chunk (como DTB_PATTERNS_CACHE de App 1)
_dtb_chunks = {}


def _json(body) -> Response:
    return Response(content=json.dumps(body, allow_nan=False, separators=(",", ":")).encode("utf-8"),
                    media_type="application/json")


def _now_ms() -> int:
    return int(time.time() * 1000)


def _date(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=candles.COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S")


def _closed(rows):
    """Solo velas cerradas: un patron describe la forma final de la vela."""
    return [c for c in rows if not c.get("in_progress")]


async def _candles_for(symbol: str, interval: str, days) -> list:
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = candles.LIVE_DAYS[interval]
    return await candles.cached_klines(symbol, interval, days)


# ---------- interes abierto ----------
async def _bybit_oi(symbol: str, oi_interval: str, start_ms: int, end_ms: int) -> dict:
    """Puntos {ts: oi} de Bybit entre start_ms y end_ms, pidiendo hacia atras desde end_ms."""
    out, cursor_end = {}, end_ms
    http = candles.client()
    for _ in range(OI_MAX_REQUESTS):
        await candles.bybit_turn()
        r = await http.get(f"{CONFIG['bybit_url']}/v5/market/open-interest", params={
            "category": "linear", "symbol": symbol, "intervalTime": oi_interval, "limit": OI_PAGE,
            "startTime": start_ms, "endTime": cursor_end})
        data = r.json()
        if data.get("retCode") != 0:
            if not out:
                raise HTTPException(status_code=502, detail=f"Bybit: {data.get('retMsg')}")
            break
        batch = (data.get("result") or {}).get("list") or []
        if not batch:
            break
        oldest = None
        for item in batch:
            ts = int(item["timestamp"])
            if start_ms <= ts <= end_ms:
                out[ts] = float(item["openInterest"])
            oldest = ts if oldest is None else min(oldest, ts)
        if oldest is None or oldest <= start_ms or len(batch) < OI_PAGE:
            break
        cursor_end = oldest - 1
    return out


async def _bybit_oi_cached(symbol: str, minutes: int, start_ms: int, now: int) -> dict:
    """Lo de Bybit desde start_ms hasta ahora, guardado en memoria: solo el ultimo tramo se vuelve a pedir."""
    oi_interval = OI_BYBIT[minutes]
    key = (symbol, minutes)
    hit = _oi_cache.get(key)
    if hit and hit["from"] <= start_ms:
        if time.time() - hit["at"] >= OI_TAIL_SECONDS:
            tail_from = max(hit["points"]) if hit["points"] else hit["from"]
            hit["points"].update(await _bybit_oi(symbol, oi_interval, tail_from, now))
            hit["at"] = time.time()
        return hit["points"]
    points = await _bybit_oi(symbol, oi_interval, start_ms, now)
    if hit:
        points = {**hit["points"], **points}
    _oi_cache[key] = {"points": points, "from": start_ms, "at": time.time()}
    return points


@router.get("/api/open-interest/{symbol}")
async def open_interest(symbol: str, interval: str = "15", days: int = 30, start_timestamp_ms: Optional[int] = None,
                        end_timestamp_ms: Optional[int] = None, local_only: bool = False):
    """
    Interes abierto como el backend de App 1: la serie local de 5 minutos (OrderFlowData/oi, oi_store) y, para
    lo que falta hasta ahora, Bybit REST. local_only se acepta y se ignora: en vivo lo reciente esta en Bybit.
    """
    symbol, code = candles.symbol_code(symbol), candles.interval_code(interval)
    minutes = max(int(code), 5)
    step = minutes * 60_000
    now = _now_ms()
    if start_timestamp_ms is None or end_timestamp_ms is None:
        days = max(1, min(int(days), candles.LIVE_DAYS[code]))
        start_timestamp_ms, end_timestamp_ms = now - days * DAY_MS, now
    start, end = int(start_timestamp_ms), min(int(end_timestamp_ms), now)
    if end <= start:
        return {"symbol": symbol, "interval": code, "indicator": "openInterest", "success": False, "data": [],
                "error": "rango vacio"}

    local = await run_in_threadpool(oi_store.series, symbol, str(minutes), start, end)
    points = {p["timestamp"]: p["openInterest"] for p in (local or {}).get("data", [])}
    local_last = (local or {}).get("oi_last_timestamp")
    gap_from = start if not points else max(start, (local_last or start) + 1)
    source = "local" if points else "bybit"
    if gap_from < end:
        try:
            fresh = await _bybit_oi_cached(symbol, minutes, gap_from, now)
            added = {ts: v for ts, v in fresh.items() if gap_from <= ts <= end and ts % step == 0}
            if added:
                points.update(added)
                source = "local+bybit" if source == "local" else "bybit"
        except HTTPException as e:
            if not points:
                return {"symbol": symbol, "interval": code, "indicator": "openInterest", "success": False,
                        "data": [], "error": str(e.detail)}
    if not points:
        return {"symbol": symbol, "interval": code, "indicator": "openInterest", "success": False, "data": [],
                "error": "sin interes abierto en ese rango"}
    stamps = sorted(points)
    first = (local or {}).get("oi_first_timestamp") or stamps[0]
    return {"symbol": symbol, "interval": code, "indicator": "openInterest", "success": True, "source": source,
            "data": [{"timestamp": t, "openInterest": points[t]} for t in stamps],
            "oi_first_timestamp": int(first), "oi_last_timestamp": stamps[-1],
            "oi_first_date": _date(first), "oi_last_date": _date(stamps[-1]), "oi_interval": f"{minutes}min"}


# ---------- VWAP ----------
@router.get("/api/vwap/{symbol}")
async def vwap(symbol: str, interval: str = "60", days: int = 7, vwap_type: str = "session", reset_hour: int = 0,
               anchor_timestamp: Optional[int] = None, rolling_period: int = 20, band_multipliers: str = "1.0,2.0,3.0",
               apply_crypto_adjustment: bool = True):
    """VWAP con bandas, con vwap_calculator de App 1 sobre las velas de Bybit (incluye la vela en curso)."""
    symbol, code = candles.symbol_code(symbol), candles.interval_code(interval)
    if vwap_type not in ("session", "anchored", "rolling"):
        vwap_type = "session"
    try:
        multipliers = [float(x.strip()) for x in band_multipliers.split(",") if x.strip()][:6] or [1.0, 2.0, 3.0]
    except ValueError:
        multipliers = [1.0, 2.0, 3.0]
    rows = await _candles_for(symbol, code, days)
    if not rows:
        return {"symbol": symbol, "interval": code, "indicator": "vwap", "data": [], "success": False,
                "error": "sin velas"}
    config = {"reset_hour": max(0, min(int(reset_hour), 23)), "anchor_timestamp": anchor_timestamp,
              "rolling_period": max(2, min(int(rolling_period), 5000)), "band_multipliers": multipliers,
              "apply_crypto_adjustment": apply_crypto_adjustment}

    def body():
        points = vwap_calculator.calculate_vwap_with_bands(rows, vwap_type, config)
        data = []
        for p in points:
            item = {"timestamp": p["timestamp"], "vwap": p["vwap"], "typical_price": p.get("typical_price"),
                    "bands": p.get("bands", {})}
            for extra in ("session_start", "anchor_timestamp", "window_size"):
                if extra in p:
                    item[extra] = p[extra]
                    break
            data.append(item)
        return {"symbol": symbol, "interval": code, "indicator": "vwap", "vwap_type": vwap_type, "data": data,
                "config": {"reset_hour": config["reset_hour"], "anchor_timestamp": anchor_timestamp,
                           "rolling_period": config["rolling_period"], "band_multipliers": multipliers,
                           "crypto_adjustment": apply_crypto_adjustment},
                "success": True, "from_cache": False, "total_points": len(data)}

    return _json(await run_in_threadpool(body))


# ---------- S&R clasico ----------
@router.get("/api/support-resistance/{symbol}")
async def support_resistance(symbol: str, interval: str = "15", days: int = 30, volume_method: str = "zscore",
                             z_score_threshold: float = 1.5, z_score_period: int = 50, left_bars: int = 15,
                             right_bars: int = 15, min_touches: int = 1, cluster_distance: float = 0.5,
                             max_levels: int = 20):
    """Soportes y resistencias con la regla de App 1 (sr_levels), solo con velas cerradas."""
    symbol, code = candles.symbol_code(symbol), candles.interval_code(interval)
    rows = await _candles_for(symbol, code, days)
    closed = _closed(rows)
    if not closed:
        return {"symbol": symbol, "interval": code, "indicator": "supportResistance", "data": {}, "success": False,
                "error": "sin velas"}
    left_bars, right_bars = max(1, min(int(left_bars), 200)), max(1, min(int(right_bars), 200))
    z_score_period = max(2, min(int(z_score_period), 1000))
    max_levels = max(1, min(int(max_levels), 200))

    def body():
        z_scores = sr_levels.calculate_z_score([c["volume"] for c in closed], z_score_period) \
            if volume_method == "zscore" else None
        pivots = sr_levels.detect_pivots(closed, left_bars, right_bars, z_scores, z_score_threshold)
        levels = [lv for lv in sr_levels.cluster_levels(pivots, cluster_distance) if lv["touches"] >= min_touches]
        now = _now_ms()
        price = rows[-1]["close"]  # el precio de ahora, aunque la vela siga abierta
        for lv in levels:
            lv["strength"] = sr_levels.calculate_level_strength(lv, now)
            lv["status"], lv["break_volume"] = sr_levels.determine_level_status(lv, price, closed)
        levels = sorted(levels, key=lambda x: x["strength"], reverse=True)[:max_levels]
        zones = sr_levels.detect_consolidation_zones(levels, min_levels=3, max_distance_pct=2.0)

        def level(lv, kind):
            return {"price": lv["price"], "type": kind, "strength": lv["strength"], "touches": lv["touches"],
                    "avgVolume": lv["avg_z_score"], "firstTouch": lv["first_touch"], "lastTouch": lv["last_touch"],
                    "status": lv["status"], "breakVolume": lv["break_volume"]}

        data = {
            "resistances": [level(lv, "resistance") for lv in levels if lv["type"] == "resistance"],
            "supports": [level(lv, "support") for lv in levels if lv["type"] == "support"],
            "consolidationZones": [{"centerPrice": z["center_price"], "minPrice": z["min_price"], "maxPrice": z["max_price"],
                                    "rangePct": z["range_pct"], "numLevels": z["num_levels"],
                                    "totalTouches": z["total_touches"], "avgStrength": z["avg_strength"]} for z in zones],
            "currentPrice": price,
            "volumeStats": {"method": volume_method,
                            "zScoreThreshold": z_score_threshold if volume_method == "zscore" else None,
                            "period": z_score_period if volume_method == "zscore" else None,
                            "currentZScore": z_scores[-1] if z_scores else None},
        }
        return {"symbol": symbol, "interval": code, "indicator": "supportResistance", "data": data,
                "config": {"volumeMethod": volume_method, "zScoreThreshold": z_score_threshold,
                           "zScorePeriod": z_score_period, "leftBars": left_bars, "rightBars": right_bars,
                           "minTouches": min_touches, "clusterDistance": cluster_distance, "maxLevels": max_levels},
                "success": True, "from_cache": False}

    return _json(await run_in_threadpool(body))


# ---------- patrones de rechazo ----------
def _clean_candles(raw):
    """Velas enviadas por la pagina: solo OHLCV numericos y en orden."""
    out = []
    for c in raw[:20_000]:
        try:
            out.append({"timestamp": int(c["timestamp"]), "open": float(c["open"]), "high": float(c["high"]),
                        "low": float(c["low"]), "close": float(c["close"]), "volume": float(c.get("volume", 0))})
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda c: c["timestamp"])


@router.post("/api/rejection-patterns/detect")
async def rejection_detect(request: Request):
    """
    Patrones de rechazo con los contextos de la pagina. Sin `candles` usa las velas cerradas de Bybit.
    Nunca envia alertas: alertsEnabled del config se ignora.
    """
    body = await request.json()
    symbol = candles.symbol_code(body.get("symbol"))
    code = candles.interval_code(body.get("interval", "4h"))
    config = body.get("config") or {}
    contexts = body.get("referenceContexts") or []
    if not isinstance(config, dict) or not isinstance(contexts, list):
        raise HTTPException(status_code=400, detail="config y referenceContexts no validos")
    sent = body.get("candles")
    rows = _clean_candles(sent) if isinstance(sent, list) and sent else \
        _closed(await _candles_for(symbol, code, body.get("days", candles.LIVE_DAYS[code])))

    def run():
        patterns = _rejection.detect_patterns(symbol, rows, config, contexts, known_levels_only=bool(sent))
        return [serialize_rejection(p) for p in patterns]

    patterns = await run_in_threadpool(run)
    return _json({"success": True, "symbol": symbol, "interval": body.get("interval", "4h"), "patterns": patterns,
                  "totalPatterns": len(patterns),
                  "activeContexts": len([c for c in contexts if isinstance(c, dict) and c.get("enabled", False)])})


@router.get("/api/rejection-patterns/available-contexts/{symbol}")
async def rejection_contexts(symbol: str, interval: str = "4h"):
    return {"success": True, "symbol": candles.symbol_code(symbol), "interval": interval, "contexts": [],
            "message": "Frontend should populate contexts from active indicators"}


# ---------- Double Top/Bottom ----------
def _quarter(ms):
    d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


@router.post("/api/double-topbottom/detect")
async def double_detect(request: Request):
    """
    Double Top/Bottom con el detector de App 1 sobre las velas cerradas de Bybit (o las enviadas).
    A diferencia de App 1 devuelve tambien `patterns`: es lo que lee el indicador fuera de reproduccion.
    """
    body = await request.json()
    symbol = candles.symbol_code(body.get("symbol"))
    interval = str(body.get("interval", "60"))
    code = candles.interval_code(interval)
    config = body.get("config") or {}
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config no valido")
    sent = body.get("candles")
    rows = _clean_candles(sent) if isinstance(sent, list) and sent else \
        _closed(await _candles_for(symbol, code, body.get("days", candles.LIVE_DAYS[code])))

    def run():
        return [serialize_double(p) for p in _double.detect_patterns(symbol, rows, config)]

    patterns = await run_in_threadpool(run)
    chunks = defaultdict(list)
    for p in patterns:
        chunks[_quarter((p.get("secondExtreme") or {}).get("timestamp") or p.get("timestamp") or 0)].append(p)
    chunks = dict(sorted(chunks.items()))
    _dtb_chunks[f"{symbol}_{interval}"] = chunks
    return _json({"success": True, "symbol": symbol, "interval": interval, "cached": True, "patterns": patterns,
                  "totalPatterns": len(patterns), "chunks": list(chunks.keys())})


@router.post("/api/double-topbottom/chunk")
async def double_chunk(request: Request):
    body = await request.json()
    symbol = candles.symbol_code(body.get("symbol"))
    interval = str(body.get("interval", "15"))
    chunks = _dtb_chunks.get(f"{symbol}_{interval}")
    if chunks is None:
        return {"success": False, "error": "No patterns in cache. Run /api/double-topbottom/detect first.", "patterns": []}
    if body.get("chunk"):
        patterns = chunks.get(body["chunk"])
        if patterns is None:
            return {"success": False, "error": f"Chunk {body['chunk']} not found", "patterns": []}
        return _json({"success": True, "symbol": symbol, "interval": interval, "chunk": body["chunk"],
                      "patterns": patterns, "totalPatterns": len(patterns)})
    up_to = body.get("upTo")
    if up_to is None:
        return {"success": False, "error": "Must provide either 'chunk' or 'upTo' parameter", "patterns": []}
    up_to = int(up_to)
    patterns = [p for part in chunks.values() for p in part if p.get("knownAt", 0) <= up_to]
    return _json({"success": True, "symbol": symbol, "interval": interval, "upTo": up_to, "patterns": patterns,
                  "totalPatterns": len(patterns)})


# ---------- Elementos OF y setups (dias de la nube y el PC) ----------
def _store_until(symbol: str, now: int) -> Optional[int]:
    """Fin del ultimo minuto guardado hoy (o ayer) en el almacen en vivo, o None si no hay nada."""
    for back in (0, 1):
        day = datetime.fromtimestamp((now - back * DAY_MS) / 1000, tz=timezone.utc).date().isoformat()
        data = footprint_store._load_day(symbol, day, True)
        if data is None or not len(data["m"]):
            continue
        end = (int(data["m"][-1]) + 1) * 60_000
        if data.get("_until") is not None:
            end = min(end, int(data["_until"]))
        return end
    return None


def _live_cut(symbol: str, known_until: Optional[int]) -> int:
    """Hasta donde se conoce: nunca despues de ahora ni del ultimo minuto guardado en el almacen."""
    now = _now_ms()
    cut = min(known_until if known_until is not None else now, now)
    stored = _store_until(symbol, now)
    return min(cut, stored) if stored is not None else cut


def _tf(interval) -> int:
    text = str(interval)
    if not text.isdigit() or int(text) not in TF_MINUTES:
        raise HTTPException(status_code=400, detail=f"marco '{interval}' no soportado")
    return int(text)


@router.get("/api/orderflow/elements/{symbol}")
async def orderflow_elements(symbol: str, interval: str, start_timestamp: int, end_timestamp: int,
                             known_until: Optional[int] = None, target: float = 0.05, band_days: int = 3,
                             vol_filter: float = 2.0):
    """Elementos OF (of_elements de App 1) con live=True: dias oficiales y, donde faltan, nube + PC."""
    symbol = candles.symbol_code(symbol)
    tf = _tf(interval)

    def body():
        cut = _live_cut(symbol, known_until)
        result = of_elements.detect(symbol, tf, start_timestamp, end_timestamp, cut, target,
                                    max(0, min(band_days, 14)), vol_filter, live=True)
        return {"success": True, "catalog": {k: v[:2] for k, v in of_elements.CATALOG.items()}, **result}

    return _json(await run_in_threadpool(body))


@router.post("/api/orderflow/setups/{symbol}")
async def orderflow_setups(symbol: str, request: Request):
    """Coincidencias de las recetas activas (of_setups de App 1) con live=True."""
    symbol = candles.symbol_code(symbol)
    body = await request.json()
    recipes = body.get("recipes") or []
    if str(body.get("interval")) not in ("1", "5", "15", "60", "240") or not isinstance(recipes, list) or len(recipes) > 200:
        return {"success": False, "message": "Marco o recetas no válidos", "matches": []}

    def run():
        cut = _live_cut(symbol, int(body["known_until"]) if body.get("known_until") is not None else None)
        result = of_setups.setups(symbol, int(body["interval"]), int(body["start_timestamp"]), int(body["end_timestamp"]),
                                  cut, recipes, float(body.get("target", 0.05)), float(body.get("vol_filter", 2.0)),
                                  live=True)
        return {"success": True, **result}

    return _json(await run_in_threadpool(run))


@router.post("/api/orderflow/setups/{symbol}/evaluate")
async def orderflow_setups_evaluate(symbol: str, request: Request):
    """
    Evaluar una receta en los dias anteriores, solo con dias oficiales (sin huecos), como App 1.
    La comprobacion final (validation) se hace en App 1: deja registro en su Observador.
    """
    symbol = candles.symbol_code(symbol)
    body = await request.json()
    if str(body.get("interval")) not in ("1", "5", "15", "60", "240"):
        return {"success": False, "message": "Marco no válido"}
    if body.get("validation"):
        return {"success": False, "message": "La comprobación final se hace en App 1, donde queda registrada"}
    known = min(int(body.get("known_until") or _now_ms()), _now_ms())
    reserve = int(body["reserve_ms"]) if body.get("reserve_ms") else None
    result = await run_in_threadpool(
        of_setups.evaluate, symbol, int(body["interval"]), body.get("recipe") or {}, known, int(body.get("days", 180)),
        float(body.get("stop_atr", 1.5)), float(body.get("target_r", 2.0)), int(body.get("horizon", 96)),
        float(body.get("target", 0.05)), float(body.get("vol_filter", 2.0)), reserve, False)
    return _json(result)


@router.get("/api/orderflow/setups/{symbol}/validations")
async def orderflow_setups_validations(symbol: str):
    """Comprobaciones finales hechas en App 1 (su archivo, solo lectura), de la mas nueva a la mas vieja."""
    symbol = candles.symbol_code(symbol)
    path = OBSERVER_DIR / "setup_validations.jsonl"
    rows = []
    if path.exists():
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get("symbol") == symbol:
                    rows.append(row)
    return {"success": True, "validations": rows[::-1]}
