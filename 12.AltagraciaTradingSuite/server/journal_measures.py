# journal_measures.py - Las medidas del Observador de App 1 para un trade real (paso 4 de la integracion, 12/11/2026).
#
# Usa measures.py de App 1 sin copiarlo (compute, row_at, read_row): las 58 medidas de 15m, 1h y 4h al cerrar la
# ultima vela de 15m anterior a la decision, con las velas de Bybit. Solo usan lo cerrado antes de ese momento.
# Suma lo maximo a favor y en contra del trade, en R del SL inicial, con velas de 5 minutos.
# El interes abierto y el delta salen de los almacenes locales de App 1: en dias sin almacen quedan vacios.
import asyncio
import math
import time
from typing import Any, Dict, List

import numpy as np
from starlette.concurrency import run_in_threadpool

import book_measures  # medidas del libro grabado por la suite (13/11/2026)
import candles
import measures  # App 1 (su backend esta en sys.path)

MINUTE = 60000
DAY = 86400000
INTERVALS = {"5m": "5", "15m": "15", "1h": "60", "4h": "240"}
HISTORY_DAYS = {"15m": 45, "1h": 130, "4h": 400}  # lo que las medidas miran hacia atras (volumen por hora: 30 dias)
MAX_DAYS = {"5m": 30, "15m": 150, "1h": 450, "4h": 900}
CACHE_SECONDS = 600
_cache: Dict[tuple, tuple] = {}
_lock = asyncio.Lock()


async def _candles(symbol: str, tag: str, days: int) -> List[Dict[str, Any]]:
    key = (symbol, tag, days)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    rows = await candles.klines(symbol, INTERVALS[tag], days)
    _cache[key] = (time.time(), rows)
    for old in [k for k, (t, _) in _cache.items() if time.time() - t > CACHE_SECONDS]:
        _cache.pop(old, None)
    return rows


def frame(rows: List[Dict[str, Any]]) -> Dict[str, np.ndarray]:
    """Velas cerradas en arreglos ordenados y sin repetidos, como read_candles de measures.py."""
    rows = [r for r in rows if not r.get("in_progress")]
    ts = np.array([r["timestamp"] for r in rows], dtype=np.int64)
    order = np.argsort(ts, kind="stable")
    ts = ts[order]
    keep = np.r_[np.diff(ts) > 0, True] if len(ts) else np.array([], dtype=bool)
    out = {"ts": ts[keep]}
    for key in ("open", "high", "low", "close", "volume"):
        out[key] = np.array([r[key] for r in rows], dtype=np.float64)[order][keep] if rows else np.array([])
    return out


def excursion(f5: Dict[str, np.ndarray], side: int, entry: float, stop: float, opened: int, closed: int):
    """Lo maximo a favor y en contra entre la apertura y el cierre, en R del SL inicial (velas de 5 minutos)."""
    risk = abs(entry - stop)
    if not risk or not len(f5["ts"]):
        return None, None
    mask = (f5["ts"] + 5 * MINUTE > opened) & (f5["ts"] < closed)
    if not mask.any():
        return None, None
    highs, lows = f5["high"][mask], f5["low"][mask]
    best = (highs.max() - entry) if side > 0 else (entry - lows.min())
    worst = (lows.min() - entry) if side > 0 else (entry - highs.max())
    return round(float(best / risk), 3), round(float(worst / risk), 3)


async def trade_measures(trade: Dict[str, Any]) -> Dict[str, Any]:
    side = 1 if trade.get("side") == "Buy" else -1
    decision = trade.get("decision") or {}
    at = decision.get("at") or trade.get("opened_at")
    if not at or (trade.get("pre_existing") and not decision):
        return {"available": False, "reason": "Sin hora de decisión: la posición ya estaba abierta antes del journal."}
    now = int(time.time() * 1000)
    age = max(0.0, (now - at) / DAY)
    symbol = trade["symbol"]
    async with _lock:  # una a la vez: cada una pide varias paginas de velas a Bybit
        frames = {}
        for tag in ("15m", "1h", "4h"):
            days = int(min(MAX_DAYS[tag], math.ceil(age) + HISTORY_DAYS[tag]))
            frames[tag] = frame(await _candles(symbol, tag, days))
        if any(len(frames[t]["ts"]) < 60 for t in frames):
            return {"available": False, "reason": "Bybit no dio velas suficientes para las medidas."}
        table = await run_in_threadpool(measures.compute, symbol, frames)
        row = measures.row_at(table, int(at))
        if row is None:
            return {"available": False, "reason": "La hora de la decisión queda fuera de las velas que se pudieron pedir."}
        result = {
            "available": True, "decision_at": int(at), "decision_candle": int(table["close_time"][row]),
            "decision": measures.read_row(table, row, side), "complete": trade.get("status") == "closed",
        }
        entry, stop, opened = trade.get("entry"), trade.get("initial_stop_loss"), trade.get("opened_at")
        if entry and stop and opened and not trade.get("pre_existing"):
            days5 = int(min(MAX_DAYS["5m"], math.ceil((now - opened) / DAY) + 1))
            f5 = frame(await _candles(symbol, "5m", days5))
            result["best_r"], result["worst_r"] = excursion(f5, side, entry, stop, opened, trade.get("closed_at") or now)
    # Las del libro grabado por la suite: van con las demas, en el grupo "Libro". Sin libro de esas horas, "—"
    try:
        result["decision"].update(await run_in_threadpool(book_measures.compute, trade))
    except Exception as e:  # el libro nunca impide las demas medidas
        result["book_error"] = str(e)[:200]
    return result


def catalog() -> List[Dict[str, str]]:
    return measures.catalog() + book_measures.catalog()
