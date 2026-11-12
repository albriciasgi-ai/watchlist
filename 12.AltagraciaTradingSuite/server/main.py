# main.py - Servidor de Altagracia Trading Suite (puerto 13000 por defecto).
#
# Un solo servidor para la app en tiempo real:
#   - Mercado: velas de Bybit y, con los lectores de App 1, footprints, perfil real y liquidaciones.
#     Los footprints salen del almacen de order flow: dias oficiales, y donde faltan, lo que graban la
#     nube (Northflank) y el PC (backend 11000), unido por PanelOrderFlow/sync_nube.py.
#   - Bot: lee y maneja el bot (3.TradingBot_Python) por su API. El bot sigue siendo su propio proceso.
#   - Dibujos: guardados por moneda en data/drawings.
# Las rutas del mercado responden igual que las del backend de App 1, para que el grafico de App 1
# (MiniChart) se use tal cual, sin copiarlo.
#
# Uso:  C:\Python314\python.exe -B main.py      (o SUITE_PORT=13100 para otra copia)
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

sys.path.insert(0, str(Path(__file__).resolve().parent))
from settings import CONFIG, SUITE_DIR  # noqa: E402

# Lectores de App 1: la pieza compartida. Sus carpetas salen de la configuracion de la suite
DATA = Path(CONFIG["orderflow_data"])
os.environ.setdefault("ORDERFLOW_STORE", str(DATA / "store"))
os.environ.setdefault("ORDERFLOW_LIVE_STORE", str(DATA / "live" / "store"))
os.environ.setdefault("ORDERFLOW_LIQ", str(DATA / "liquidations"))
sys.path.insert(0, CONFIG["app1_backend"])
import footprint_store  # noqa: E402
import liq_store  # noqa: E402

COLOMBIA_TZ = timezone(timedelta(hours=-5))
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
INTERVALS = {"1": 1, "5": 5, "15": 15, "60": 60, "240": 240}
# Dias de velas por marco para el grafico en vivo (cada pedido a Bybit trae 1000 velas)
LIVE_DAYS = {"1": 3, "5": 10, "15": 30, "60": 120, "240": 365}
CANDLE_CACHE_SECONDS = 5
DRAWINGS_DIR = Path(CONFIG["data_dir"]) / "drawings"

app = FastAPI(title="Altagracia Trading Suite", version="0.1.0")
_http: Optional[httpx.AsyncClient] = None
_candle_cache = {}


@app.on_event("startup")
async def _startup():
    global _http
    _http = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[SUITE] Servidor en http://{CONFIG['host']}:{CONFIG['port']} | almacen {DATA} | bot {CONFIG['bot_url']}")


@app.on_event("shutdown")
async def _shutdown():
    if _http:
        await _http.aclose()


# ---------- proteccion: solo paginas de este PC ----------
@app.middleware("http")
async def _local_only(request: Request, call_next):
    allowed = set(CONFIG["allowed_origin_hosts"])
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    if host not in allowed:
        return JSONResponse({"success": False, "error": "host no permitido"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != "null":
        if (urlsplit(origin).hostname or "") not in allowed:
            return JSONResponse({"success": False, "error": "origen no permitido"}, status_code=403)
    return await call_next(request)


def _symbol(symbol: str) -> str:
    symbol = (symbol or "").upper()
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail="simbolo invalido")
    return symbol


def _interval(interval: str) -> str:
    text = (interval or "").strip().lower()
    if text.endswith("h") and text[:-1].isdigit():
        text = str(int(text[:-1]) * 60)
    elif text.endswith("m") and text[:-1].isdigit():
        text = text[:-1]
    if text not in INTERVALS:
        raise HTTPException(status_code=400, detail="marco no soportado")
    return text


def _json(body) -> Response:
    return Response(content=json.dumps(body, allow_nan=False, separators=(",", ":")).encode("utf-8"),
                    media_type="application/json")


# ---------- mercado ----------
async def _klines(symbol: str, interval: str, days: int):
    minutes = INTERVALS[interval]
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * 86_400_000
    out, cursor = [], start_ms
    for _ in range(40):
        r = await _http.get(f"{CONFIG['bybit_url']}/v5/market/kline", params={
            "category": "linear", "symbol": symbol, "interval": interval, "start": cursor, "limit": 1000})
        data = r.json()
        if data.get("retCode") != 0:
            raise HTTPException(status_code=502, detail=f"Bybit: {data.get('retMsg')}")
        batch = list(reversed(data["result"]["list"]))
        batch = [c for c in batch if int(c[0]) >= cursor]
        if not batch:
            break
        out.extend(batch)
        cursor = int(batch[-1][0]) + minutes * 60_000
        if cursor > end_ms or len(batch) < 1000:
            break
    seen, candles = set(), []
    for c in out:
        ts = int(c[0])
        if ts in seen:
            continue
        seen.add(ts)
        candles.append({
            "timestamp": ts, "open": float(c[1]), "high": float(c[2]), "low": float(c[3]), "close": float(c[4]),
            "volume": float(c[5]), "in_progress": end_ms - ts < minutes * 60_000,
            "datetime_colombia": datetime.fromtimestamp(ts / 1000, tz=COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return candles


@app.get("/api/historical/{symbol}")
async def historical(symbol: str, interval: str = "15", days: int = 30):
    """Velas de Bybit, con la misma respuesta que el backend de App 1."""
    symbol, interval = _symbol(symbol), _interval(interval)
    days = max(1, min(int(days), LIVE_DAYS[interval]))
    key = (symbol, interval, days)
    hit = _candle_cache.get(key)
    if hit and time.time() - hit[0] < CANDLE_CACHE_SECONDS:
        candles = hit[1]
    else:
        candles = await _klines(symbol, interval, days)
        _candle_cache[key] = (time.time(), candles)
    return {"symbol": symbol, "interval": interval, "data": candles, "success": True,
            "total_candles": len(candles), "days_fetched": days, "max_days_allowed": LIVE_DAYS[interval],
            "updated": int(time.time() * 1000)}


@app.get("/api/orderflow/historical/{symbol}")
async def orderflow_historical(
    symbol: str, interval: str = "1", start_timestamp: Optional[int] = None, end_timestamp: Optional[int] = None,
    known_until: Optional[int] = None, step: Optional[float] = None, imbalance_ratio: float = 3.0,
    imbalance_mode: str = "level", imbalance_min_volume: float = 0.0, imbalance_zero: bool = False,
    stacked_levels: int = 3, max_levels: Optional[int] = None,
):
    """Footprints del almacen (oficial, y nube + PC donde falta el oficial), como el backend de App 1."""
    symbol, interval = _symbol(symbol), _interval(interval)
    now = int(time.time() * 1000)
    if start_timestamp is None or end_timestamp is None:
        end_timestamp = now
        start_timestamp = now - 12 * 3_600_000
    cut = min(known_until if known_until is not None else now, now)
    rules = {"ratio": max(1.01, imbalance_ratio), "mode": imbalance_mode if imbalance_mode in ("level", "diagonal") else "level",
             "min_volume": max(0.0, imbalance_min_volume), "count_zero": imbalance_zero, "stacked_levels": max(2, stacked_levels)}
    limit = max(2, max_levels) if max_levels else None

    def body():
        result = footprint_store.footprints(symbol, int(interval), start_timestamp, end_timestamp, cut, step, rules,
                                            limit, live=True)
        return {"success": True, "footprints": result["footprints"], "count": len(result["footprints"]),
                "step_size": result["step_size"], "cell_size": result.get("cell_size"),
                "known_until": result["known_until"], "interval": interval, "source": "store",
                "live_days": result.get("live_days", [])}

    return _json(await run_in_threadpool(body))


@app.get("/api/orderflow/profile/{symbol}")
async def orderflow_profile(symbol: str, start_timestamp: int, end_timestamp: int, low: float, high: float,
                            rows: int = 50, known_until: Optional[int] = None):
    symbol = _symbol(symbol)
    rows = max(1, min(rows, 2000))
    cut = min(known_until if known_until is not None else int(time.time() * 1000), int(time.time() * 1000))
    result = await run_in_threadpool(footprint_store.profile, symbol, start_timestamp, end_timestamp, cut, low, high,
                                     rows, True)
    return {"success": True, **result}


@app.get("/api/liquidations/{symbol}")
async def liquidations(symbol: str, start_timestamp: int, end_timestamp: int, known_until: Optional[int] = None):
    symbol = _symbol(symbol)
    return _json(await run_in_threadpool(lambda: {"success": True, **liq_store.window(symbol, start_timestamp, end_timestamp, known_until)}))


# ---------- dibujos ----------
@app.get("/api/drawings/{symbol}")
async def get_drawings(symbol: str):
    symbol = _symbol(symbol)
    path = DRAWINGS_DIR / f"{symbol}.json"
    if not path.exists():
        return {"symbol": symbol, "shapes": [], "updated_at": None}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"dibujos ilegibles: {e}")


@app.post("/api/drawings/{symbol}")
async def save_drawings(symbol: str, request: Request):
    symbol = _symbol(symbol)
    body = await request.json()
    shapes = body.get("shapes")
    if not isinstance(shapes, list):
        raise HTTPException(status_code=400, detail="shapes debe ser una lista")
    data = {"symbol": symbol, "interval": str(body.get("interval", "")), "shapes": shapes,
            "updated_at": datetime.now(timezone.utc).isoformat(), "total_shapes": len(shapes)}
    path = DRAWINGS_DIR / f"{symbol}.json"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return {"success": True, "total_shapes": len(shapes)}


# ---------- bot ----------
async def _bot(method: str, path: str, **kw):
    try:
        r = await _http.request(method, CONFIG["bot_url"] + path, **kw)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"bot no disponible: {type(e).__name__}")
    try:
        data = r.json()
    except ValueError:
        raise HTTPException(status_code=502, detail=f"respuesta del bot no es JSON ({r.status_code})")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=data.get("detail") if isinstance(data, dict) else str(data))
    return data


@app.get("/api/bot/overview")
async def bot_overview():
    """Estado, pausa, avisos criticos y ultimas ordenes del bot. No consulta Bybit."""
    status, critical, orders = await asyncio.gather(
        _bot("GET", "/api/status"), _bot("GET", "/api/alerts/critical", params={"limit": 20}),
        _bot("GET", "/api/orders/history", params={"limit": 50}))
    return {"success": True, "status": status, "critical": critical.get("alerts", []),
            "orders": orders.get("orders", []), "orders_total": orders.get("total")}


@app.get("/api/bot/positions")
async def bot_positions():
    """Posiciones abiertas: el bot las pide a Bybit, por eso va aparte y con menos frecuencia."""
    return await _bot("GET", "/api/positions")


@app.get("/api/bot/alerts")
async def bot_alerts(minutes: int = 240):
    return await _bot("GET", "/api/alerts/recent", params={"minutes": max(1, min(minutes, 10_080))})


@app.post("/api/bot/pause")
async def bot_pause(request: Request):
    """Pausa o reanuda todo el trading del bot. Exige {"paused": bool, "confirm": "CAMBIAR_PAUSA"}."""
    body = await request.json()
    if body.get("confirm") != "CAMBIAR_PAUSA" or not isinstance(body.get("paused"), bool):
        raise HTTPException(status_code=400, detail='se necesita {"paused": true|false, "confirm": "CAMBIAR_PAUSA"}')
    return await _bot("POST", "/api/settings/trading-paused", json={"paused": body["paused"]})


# ---------- estado de la suite ----------
@app.get("/api/suite/status")
async def suite_status():
    def store_info():
        out = {}
        for sym in ("BTCUSDT", "ETHUSDT"):
            cov = footprint_store.coverage(sym)
            live_days = sorted(p.stem.rsplit("_", 1)[1] for p in (footprint_store.LIVE_DIR / sym).glob("*/*.npz"))
            out[sym] = {"official_last": cov.get("last"), "live_days": live_days[-5:]}
        return out

    async def local_tape():
        try:
            r = await _http.get("http://127.0.0.1:11000/api/orderflow/local-tape", timeout=3)
            d = r.json()
            return {"running": d.get("running"), "symbols": len(d.get("symbols", [])),
                    "last_build": (d.get("build") or {}).get("last_build")}
        except Exception:
            return {"running": None}

    async def bot():
        try:
            s = await _bot("GET", "/api/status")
            return {"online": True, "mode": s.get("mode"), "trading_paused": s.get("trading_paused")}
        except HTTPException:
            return {"online": False}

    store, tape, bot_state = await asyncio.gather(run_in_threadpool(store_info), local_tape(), bot())
    return {"success": True, "version": app.version, "now": int(time.time() * 1000), "store": store,
            "local_tape": tape, "bot": bot_state}


# Frontend ya armado (web/dist), servido desde aqui: una sola direccion para todo
_dist = SUITE_DIR / "web" / "dist"
if _dist.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=CONFIG["host"], port=int(CONFIG["port"]), log_level="info")
