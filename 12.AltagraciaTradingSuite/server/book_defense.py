# book_defense.py - Defensa de zona (14/11/2026), para la pestana "Mapa".
#
# Pedido del usuario: saber si una zona suya se sostiene hasta que el precio vuelve. Es la medicion de book_study.py
# (la misma regla, sin copiarla), en vivo y sobre el grafico, con las zonas que el usuario dibuja en cada moneda:
#   - linea horizontal: su precio +-0.05% (POINT_ZONE de book_study);
#   - rectangulo: su rango de precios, desde su primera hora. Uno de mas de MAX_ZONE_PCT de alto no cuenta (un rango
#     tan ancho deja al precio siempre adentro).
# Por cada visita (book_study.visits): el precio estuvo al menos 1/4 de ATR de 15m lejos y llega; aguanta si se aleja
# 1/2 ATR antes de pasarla por 1/4 ATR, si no la cruza. Dice lo que habia en la zona al acercarse y al llegar (libro de
# cada segundo), lo negociado contra ese lado (trades exactos), la antiguedad de esa liquidez y el patron: barrido,
# absorcion, defensa, retiro y rebote, retiro y cruce o consumida.
# Ademas el estado de las zonas cerca del precio (a 2 ATR o menos), antes de que llegue: lo que hay ahora de su lado,
# contra hace 30 minutos, y su antiguedad.
# No es una senal ni esta validado contra el azar: eso lo mide book_study con semanas de libro.
import asyncio
import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException

import book_store
import book_study
from settings import CONFIG

MINUTE = 60000
MAX_SPAN_MS = 24 * 3600000      # a lo sumo 24 horas por pedido: el libro de cada segundo pesa
MAX_ZONE_PCT = 1.5
NEAR_ATR = 2.0                  # estado de las zonas a 2 ATR o menos del precio
BEFORE_MIN = 30
CACHE_SECONDS = 50
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
_cache: Dict[tuple, Tuple[float, dict]] = {}
_trades: Dict[str, book_study.Trades] = {}


def zones_from_drawings(shapes: List[dict], start: int, end: int) -> List[dict]:
    """Zonas de los dibujos de la moneda: lineas horizontales y rectangulos."""
    out = []
    for s in shapes or []:
        try:
            if s.get("type") == "horizontal":
                p = float(s["price"])
                if p <= 0:
                    continue
                out.append({"kind": "linea", "label": f"{p:.10g}", "id": s.get("id"), "lo": p * (1 - book_study.POINT_ZONE),
                            "hi": p * (1 + book_study.POINT_ZONE), "from": start, "to": end})
            elif s.get("type") == "rectangle":
                lo, hi = sorted((float(s["price1"]), float(s["price2"])))
                if lo <= 0 or (hi - lo) / hi * 100 > MAX_ZONE_PCT:
                    continue
                t0 = int(min(float(s["time1"]), float(s["time2"])))
                if hi - lo < lo * 2 * book_study.POINT_ZONE:          # un rectangulo muy fino: como una linea
                    c = (lo + hi) / 2
                    lo, hi = c * (1 - book_study.POINT_ZONE), c * (1 + book_study.POINT_ZONE)
                out.append({"kind": "rectangulo", "label": s.get("label") or f"{lo:.10g}-{hi:.10g}", "id": s.get("id"),
                            "lo": lo, "hi": hi, "from": max(start, t0), "to": end})
        except (KeyError, TypeError, ValueError):
            continue
    return [z for z in out if z["to"] > z["from"]]


def _minute_usd(mins: Optional[dict], t: int, side: str, lo: float, hi: float) -> Optional[float]:
    """Promedio de la zona en el minuto cerrado que contiene t (libro de minutos, hasta +-5% del precio)."""
    if mins is None:
        return None
    m = t - t % MINUTE
    i = int(np.searchsorted(mins["t"], m, side="right")) - 1
    if i < 0 or int(mins["t"][i]) != m:
        return None
    h, p = mins["cols"][i]
    if h.get("gap") or not book_store.covers(h, side, lo, hi):
        return None
    return book_store.zone_depth(h, p[f"twa_{side}"], side, lo, hi)[1]


def status(sec: dict, atr: np.ndarray, mins: Optional[dict], zone: dict) -> Optional[dict]:
    """La zona antes de que llegue el precio: lo que hay de su lado en el ultimo minuto cerrado contra 30 minutos
    antes (libro de minutos: el de cada segundo solo llega a +-0.8% del precio), y su antiguedad."""
    if not len(sec["ts"]) or not np.isfinite(atr[-1]) or mins is None or not len(mins["t"]):
        return None
    t = int(sec["ts"][-1])
    bb, ba, a = float(sec["bb"][-1]), float(sec["ba"][-1]), float(atr[-1])
    if bb > zone["hi"]:
        side, dist = "b", bb - zone["hi"]
    elif ba < zone["lo"]:
        side, dist = "a", zone["lo"] - ba
    else:
        return None                                     # el precio esta adentro: eso es una visita
    if dist > NEAR_ATR * a:
        return None
    last = int(mins["t"][-1])                           # el ultimo minuto cerrado grabado
    now = _minute_usd(mins, last, side, zone["lo"], zone["hi"])
    before = _minute_usd(mins, last - BEFORE_MIN * MINUTE, side, zone["lo"], zone["hi"])
    age, held, frac = book_study.zone_age(mins, last + MINUTE, side, zone["lo"], zone["hi"])
    return {"side": side, "at": last, "usd": None if now is None else round(now),
            "usd_before": None if before is None else round(before),
            "kept_pct": round(100 * now / before) if now is not None and before else None,
            "age_min": age, "dist_atr": round(dist / a, 2)}


def defense(sec: Optional[dict], zones: List[dict], trades, mins: Optional[dict]) -> dict:
    out = {"zones": [], "visits": [], "status": []}
    if sec is None or not zones:
        return out
    atr = book_study.atr_at(sec)
    for z in zones:
        out["zones"].append({k: z[k] for k in ("kind", "label", "id", "lo", "hi", "from")})
        for v in book_study.visits(sec, atr, z, trades, mins):
            kept = round(100 * v["arrival_usd"] / v["approach_usd"]) if v.get("approach_usd") and v.get("arrival_usd") is not None else None
            out["visits"].append({"id": z["id"], "label": z["label"], "kind": z["kind"], "lo": z["lo"], "hi": z["hi"],
                                  "side": v["side"], "at": v["at"], "outcome": v["outcome"], "pattern": v["pattern"],
                                  "seconds": v["seconds"], "gap": v["gap"], "approach_usd": _r(v["approach_usd"]),
                                  "arrival_usd": _r(v["arrival_usd"]), "kept_pct": kept, "traded_usd": _r(v["traded_usd"]),
                                  "aged_min": v["aged_min"], "sustained_frac": v["sustained_frac"],
                                  "approach_s": v["approach_s"]})
        st = status(sec, atr, mins, z)
        if st:
            out["status"].append({"id": z["id"], "label": z["label"], "lo": z["lo"], "hi": z["hi"], **st})
    out["visits"].sort(key=lambda v: v["at"])
    return out


def _r(x):
    return None if x is None else round(float(x))


def _compute(symbol: str, start: int, end: int, shapes: List[dict], with_trades: bool = True) -> dict:
    base = book_store.sources(CONFIG["orderflow_data"])
    zones = zones_from_drawings(shapes, start, end)
    if not zones:
        return {"zones": [], "visits": [], "status": [], "note": "sin lineas ni rectangulos dibujados en esta moneda"}
    # 4 horas antes: el ATR de 15m necesita 14 velas cerradas
    sec = book_study.load_seconds(base, symbol, start - 4 * 3600000, end)
    mins = book_study.load_minutes(base, symbol, start - (book_study.AGE_MAX_MIN + 2) * MINUTE, end)
    trades = None
    if with_trades:
        trades = _trades.get(symbol)
        if trades is None:
            if len(_trades) > 4:
                _trades.clear()
            trades = _trades[symbol] = book_study.Trades(symbol)
        trades.days = {d: v for d, v in trades.days.items() if d != book_store.day_of(end)}  # el dia en curso crece
    res = defense(sec, zones, trades, mins)
    if sec is None:
        res["note"] = "sin libro de cada segundo grabado en estas horas"
    return res


def make_router(drawings_dir: Path) -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/defense/{symbol}")
    async def book_defense(symbol: str, from_ms: int = 0, to_ms: int = 0):
        symbol = symbol.upper()
        if not SYMBOL_RE.match(symbol):
            raise HTTPException(status_code=404, detail="moneda invalida")
        if not (0 < from_ms < to_ms):
            raise HTTPException(status_code=400, detail="rango de horas invalido")
        now = int(time.time() * 1000)
        to_ms = min(to_ms, now + MINUTE)
        from_ms = max(from_ms, to_ms - MAX_SPAN_MS)
        path = drawings_dir / f"{symbol}.json"
        try:
            raw = path.read_text(encoding="utf-8") if path.exists() else '{"shapes": []}'
            shapes = json.loads(raw).get("shapes") or []
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"dibujos ilegibles: {e}")
        key = (symbol, from_ms // (15 * MINUTE), to_ms // MINUTE, hash(raw))
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return {"success": True, **hit[1]}
        res = await asyncio.to_thread(_compute, symbol, from_ms, to_ms, shapes)
        res.update(from_ms=from_ms, to_ms=to_ms)
        if len(_cache) > 40:
            _cache.clear()
        _cache[key] = (time.time(), res)
        return {"success": True, **res}

    return r
