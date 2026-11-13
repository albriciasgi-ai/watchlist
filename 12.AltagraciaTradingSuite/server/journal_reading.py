# journal_reading.py - La lectura de la regla del laboratorio para un trade real (13/11/2026), como el Observador de
# App 1: observer.read_at sin copiarlo, en el minuto de la decision y solo con lo ocurrido antes de ella.
#
# - Minutos y celdas del almacen de trades: dias oficiales y, donde faltan, nube + PC (live=True). La regla mira 45
#   dias hacia atras: si la moneda tiene menos dias seguidos grabados, la lectura sale "parcial" y el informe no la usa
#   (con menos velas, un movimiento o un contexto que no se ve contaria como ausente).
# - Interes abierto de 5 minutos: la serie local de App 1 (OrderFlowData/oi) y, lo que le falta, Bybit REST. La misma
#   serie usan las medidas (journal_measures.py).
# - Como en App 1, la lectura se ve cuando el trade se cerro: antes la ruta no la da.
# - Se guarda cuando el almacen ya llego a la hora de la decision (la nube baja cada 15 minutos); pasados 2 dias se
#   guarda lo que haya.
import datetime as dt
import time
from typing import Any, Dict, Optional, Tuple

import numpy as np
from starlette.concurrency import run_in_threadpool

import footprint_store  # App 1 (su backend esta en sys.path)
import observer  # App 1: solo se usan su lectura y sus comparaciones; su registro (journal.jsonl) no se toca
import oi_store  # App 1
import market_routes

READING_VERSION = 1
MINUTE = 60000
DAY = 86400000
OI_LOOKBACK_MS = 26 * 3600000  # la lectura mira 4 horas de OI y las medidas 24, mas lo que tarda en publicarse
OI_STALE_MS = 30 * MINUTE      # si la serie local termina antes de esto, lo que falta se pide a Bybit
NEEDED_DAYS = observer.LOOKBACK_DAYS + 1  # dias del almacen, con el de la decision, para una lectura completa
CATCH_UP_MINUTES = 5           # el almacen debe llegar a estos minutos de la decision para guardar la lectura
SETTLE_MS = 2 * DAY            # pasado esto, la lectura se guarda con lo que haya
RECENT_SECONDS = 300           # una lectura sin guardar se repite a lo sumo cada 5 minutos
_recent: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def _day_iso(day_index: int) -> str:
    return (dt.date(1970, 1, 1) + dt.timedelta(days=day_index)).isoformat()


def _clean(value):
    """Para guardar y responder en JSON: un valor no finito queda en None, y los de numpy pasan a los de Python."""
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    return value


async def oi_series(symbol: str, start_ms: int, end_ms: int) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """(minutos, valores) del interes abierto de 5 minutos entre start_ms y end_ms, o None sin datos."""
    points: Dict[int, float] = {}
    local = await run_in_threadpool(oi_store.points, symbol)
    if local is not None:
        times, values = local
        lo, hi = np.searchsorted(times, [start_ms // MINUTE, end_ms // MINUTE + 1])
        for t, v in zip(times[lo:hi].tolist(), values[lo:hi].tolist()):
            points[int(t) * MINUTE] = float(v)
    last = max(points) if points else None
    if last is None or last < end_ms - OI_STALE_MS:
        try:
            fresh = await market_routes._bybit_oi(symbol, "5min", last + 1 if last else start_ms, end_ms)
        except Exception:  # Bybit o la red fallaron: queda lo local, o la lectura sin OI
            fresh = {}
        points.update({int(ts): float(v) for ts, v in fresh.items()})
    if not points:
        return None
    stamps = sorted(points)
    return np.array(stamps, dtype=np.int64) // MINUTE, np.array([points[s] for s in stamps], dtype=np.float64)


def coverage(symbol: str, at_ms: int) -> Dict[str, Any]:
    """Dias seguidos del almacen (oficiales o de nube + PC) que terminan en el de la decision."""
    last = int(at_ms) // DAY
    day = last
    while last - day < NEEDED_DAYS:
        iso = _day_iso(day)
        if not (footprint_store._day_path(symbol, iso).exists() or footprint_store._live_path(symbol, iso).exists()):
            break
        day -= 1
    days = last - day
    return {"days": days, "from": _day_iso(day + 1) if days else None, "needed": NEEDED_DAYS, "complete": days >= NEEDED_DAYS}


def _store_reach(symbol: str, at_ms: int) -> Optional[int]:
    """Ultimo minuto del almacen antes de la decision (en las 2 horas anteriores), o None."""
    t = int(at_ms) // MINUTE
    data = footprint_store.minutes(symbol, t - 120, t, live=True)
    return None if data is None else int(data["m"][-1])


def reading_time(trade: Dict[str, Any]) -> Optional[int]:
    """La hora que se lee: la de la decision en el panel o, sin ella, la apertura que anoto el bot."""
    decision = trade.get("decision") or {}
    if trade.get("pre_existing") and not decision:
        return None  # posicion anterior al journal: no se sabe cuando se decidio
    at = decision.get("at") or trade.get("opened_at")
    return int(at) if at else None


def as_observer_trade(trade: Dict[str, Any], reading: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """El trade del bot en la forma que leen las comparaciones y el informe de App 1 (su R sale igual que el del bot)."""
    closes = trade.get("closes") or []
    entry = trade.get("entry")
    return {
        "side": "long" if trade.get("side") == "Buy" else "short", "reading": reading, "status": trade.get("status"),
        "pnl": trade.get("pnl"), "stop": trade.get("initial_stop_loss") if entry else None, "fill_price": entry,
        "quantity": trade.get("closed_qty") or sum((c.get("qty") or 0) for c in closes) or trade.get("size") or 0,
    }


def _conditions(item: Dict[str, Any]):
    """Cada condicion de la regla (las del informe de App 1) en este trade: True, False o None si no se sabe."""
    return [{"id": key, "label": label, "value": check(item), "rule": key in observer.RULE_PARTS}
            for key, label, check in observer.CONDITIONS]


async def trade_reading(trade: Dict[str, Any]) -> Dict[str, Any]:
    """Lectura de la regla para un trade, con su comparacion por bloques y sus condiciones. final: ya se puede guardar."""
    at = reading_time(trade)
    base = {"version": READING_VERSION, "at": at}
    if not at:
        return {**base, "available": False, "final": True,
                "reason": "Sin hora de decisión: la posición ya estaba abierta antes del journal."}
    symbol = trade["symbol"]
    side = 1 if trade.get("side") == "Buy" else -1
    order = (trade.get("decision") or {}).get("order") or {}
    entry = order.get("entry") or trade.get("entry")
    series = await oi_series(symbol, at - OI_LOOKBACK_MS, at)
    reading = await run_in_threadpool(observer.read_at, symbol, at, side, entry, True, series)
    reach = await run_in_threadpool(_store_reach, symbol, at)
    caught_up = reach is not None and reach >= at // MINUTE - CATCH_UP_MINUTES
    cover = coverage(symbol, at)
    final = caught_up or time.time() * 1000 - at > SETTLE_MS
    result = {**base, "available": bool(reading.get("available")), "final": final, "caught_up": caught_up,
              "entry": entry, "side": "long" if side > 0 else "short", "coverage": cover, "oi_points": 0 if series is None else len(series[0])}
    if not result["available"]:
        result["reason"] = (f"Sin trades grabados de {symbol} cerca de esa hora: la regla lee el almacén de trades "
                            "(días oficiales y, donde faltan, los de la nube y el PC).")
        return _clean(result)
    item = as_observer_trade(trade, reading)
    result["reading"] = reading
    result["rows"] = observer.compare(item)["rows"]
    result["conditions"] = _conditions(item)
    result["complete"] = cover["complete"]
    return _clean(result)


async def reading_for(store, trade: Dict[str, Any]) -> Dict[str, Any]:
    """La lectura guardada o, si no hay, calculada (y guardada si ya es final). Solo para trades cerrados."""
    tid = trade["trade_id"]
    cached = store.readings_get(tid)
    if cached and cached.get("version") == READING_VERSION:
        return cached
    hit = _recent.get(tid)
    if hit and time.time() - hit[0] < RECENT_SECONDS:
        return hit[1]
    result = await trade_reading(trade)
    if result.get("final"):
        store.readings_put(tid, result)
        _recent.pop(tid, None)
    else:
        _recent[tid] = (time.time(), result)
    return result
