# candles.py - Velas de Bybit y validaciones comunes del servidor de la suite.
#
# Lo usan main.py (/api/historical) y market_routes.py (indicadores que calculan con velas).
# El cliente HTTP lo crea main.py al arrancar y lo deja aqui con set_client().
import asyncio
import re
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import HTTPException

from settings import CONFIG

COLOMBIA_TZ = timezone(timedelta(hours=-5))
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
INTERVALS = {"1": 1, "5": 5, "15": 15, "60": 60, "240": 240}
# Dias de velas por marco para el grafico en vivo (cada pedido a Bybit trae 1000 velas)
LIVE_DAYS = {"1": 3, "5": 10, "15": 30, "60": 120, "240": 365}
CANDLE_CACHE_SECONDS = 5
# Pedidos a Bybit por segundo desde este servidor. Bybit cuenta en una ventana de 1 s y responde "Too many visits"
# (retCode 10006) si se pasa: con la pagina recien abierta, cinco marcos, el Swing y la Watchlist piden a la vez
BYBIT_PER_SECOND = 10
TOO_MANY_VISITS = 10006

_client: Optional[httpx.AsyncClient] = None
_cache = {}
_bybit_slots = deque()   # horas reservadas para los pedidos a Bybit, en orden (pueden estar en el futuro)


def _reserve_bybit_slot() -> float:
    """Reserva la hora de un pedido: en ningun segundo caben mas de BYBIT_PER_SECOND. Sin await: no se intercala."""
    now = time.monotonic()
    while _bybit_slots and now - _bybit_slots[0] >= 1.0:
        _bybit_slots.popleft()
    slot = now
    if len(_bybit_slots) >= BYBIT_PER_SECOND:
        slot = max(now, _bybit_slots[-BYBIT_PER_SECOND] + 1.0)
    _bybit_slots.append(slot)
    return slot


async def bybit_turn():
    """Espera el turno de un pedido a Bybit: a lo sumo BYBIT_PER_SECOND en cualquier segundo, en orden de llegada."""
    wait = _reserve_bybit_slot() - time.monotonic()
    if wait > 0:
        await asyncio.sleep(wait)


def set_client(client: Optional[httpx.AsyncClient]):
    global _client
    _client = client


def client() -> httpx.AsyncClient:
    if _client is None:
        raise HTTPException(status_code=503, detail="servidor sin cliente HTTP")
    return _client


def symbol_code(symbol: str) -> str:
    symbol = (symbol or "").upper()
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail="simbolo invalido")
    return symbol


def interval_code(interval: str) -> str:
    """'15m', '1h', '4h', '60'... a la clave de Bybit ('15', '60', '240'). Otro marco: 400."""
    text = (str(interval) if interval is not None else "").strip().lower()
    if text.endswith("h") and text[:-1].isdigit():
        text = str(int(text[:-1]) * 60)
    elif text.endswith("m") and text[:-1].isdigit():
        text = text[:-1]
    if text not in INTERVALS:
        raise HTTPException(status_code=400, detail="marco no soportado")
    return text


async def klines(symbol: str, interval: str, days: int):
    """Velas de Bybit de los ultimos `days` dias, en orden y con la forma del backend de App 1."""
    minutes = INTERVALS[interval]
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * 86_400_000
    out, cursor = [], start_ms
    http = client()
    for _ in range(40):
        params = {"category": "linear", "symbol": symbol, "interval": interval, "start": cursor, "limit": 1000}
        # Bybit a veces tarda: tres intentos por pagina antes de responder 503 (antes era un error 500). Con "Too many
        # visits" se espera a que pase su ventana de 1 s y se vuelve a pedir
        for attempt in range(4):
            await bybit_turn()
            try:
                r = await http.get(f"{CONFIG['bybit_url']}/v5/market/kline", params=params)
                data = r.json()
            except (httpx.HTTPError, ValueError) as e:
                if attempt >= 2:
                    raise HTTPException(status_code=503, detail=f"Bybit no respondio las velas: {type(e).__name__}")
                await asyncio.sleep(1 + attempt)
                continue
            if data.get("retCode") == TOO_MANY_VISITS and attempt < 3:
                await asyncio.sleep(1.2 + attempt)
                continue
            break
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


async def cached_klines(symbol: str, interval: str, days: int):
    """klines() con la misma cache corta de /api/historical: varios indicadores piden lo mismo a la vez."""
    days = max(1, min(int(days), LIVE_DAYS[interval]))
    key = (symbol, interval, days)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CANDLE_CACHE_SECONDS:
        return hit[1]
    candles = await klines(symbol, interval, days)
    _cache[key] = (time.time(), candles)
    return candles
