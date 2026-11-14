# ladder.py - Price ladder (DOM) de la pestana "Mapa" (14/11/2026).
#
# No abre otra conexion a Bybit: el libro sale del grabador de la suite (book_recorder, que lo tiene al dia en memoria
# con cada mensaje de orderbook.full) y lo negociado, de los trades que ya recibe la grabacion (recorder.TradeFeed).
# La pagina lo pide unas 4 veces por segundo, solo para la moneda que esta mirando (GET /api/book/ladder/{simbolo}).
#
# Cada fila es un precio agrupado en "step" (un multiplo del tick):
#   - compra y venta en espera (en la moneda, como Bybit);
#   - lo negociado ahi en los ultimos minutos, compra agresiva y venta agresiva;
#   - lo agregado o retirado en los ultimos segundos (el libro de ahora contra el de hace ~5 s).
# Solo para mirar: no envia ni cambia ordenes.
# Cola de tus Limit (14/11): con watch=precio:desde,... da, en el precio exacto (un tick), lo que espera de cada lado y
# lo negociado ahi desde esa hora (compra y venta agresiva). La pagina estima con eso cuanto tienes delante.
# Cinta de operaciones grandes (14/11): los trades del mismo instante y lado son una orden (como el Smart Tape de ATAS
# y build_flow.py); se guardan 30 minutos por moneda y /api/book/tape/{simbolo} da las de USD sobre un minimo (o el
# percentil 99 de esos 30 minutos) y cuanto se compro y se vendio en los ultimos 30 s.
import math
import time

import numpy as np
from collections import deque
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

import book_recorder

TRADE_KEEP_MS = 30 * 60000        # trades guardados por moneda para lo negociado
TRADE_MAX = 400000                # tope por moneda (BTC en una tarde agitada: unos 3,000 por minuto)
CHANGE_MS = 5000                  # lo agregado o retirado: contra el libro de hace ~5 s
HIST_KEEP_MS = 12000
MAX_ROWS = 200
MAX_MULT = 100000
STEP_FRACTION = 0.0001            # step automatico ~0.01% del precio (en BTC 5 USD, el del footprint de 1m)
WINDOWS = (60, 300, 900, 1800)    # segundos de lo negociado que se pueden pedir

_trades: Dict[str, deque] = {}
# ordenes agresivas: [hora ms, compra?, cantidad, USD, primer precio, ultimo precio, menor, mayor, trades]
_orders: Dict[str, deque] = {}
TAPE_LIMIT = 80
TAPE_PCT = 99.0
SUMMARY_MS = 30000
# (moneda, step) -> [(hora, {cubo: (compra, venta)})] para lo agregado o retirado
_hist: Dict[Tuple[str, int], deque] = {}


def add_trades(symbol: str, trades: List[dict]):
    """Trades de publicTrade de Bybit: T (ms), p, v, S ("Buy" = compra agresiva)."""
    q = _trades.get(symbol)
    if q is None:
        q = _trades[symbol] = deque(maxlen=TRADE_MAX)
    orders = _orders.get(symbol)
    if orders is None:
        orders = _orders[symbol] = deque(maxlen=TRADE_MAX)
    for t in trades:
        try:
            row = (int(t["T"]), float(t["p"]), float(t["v"]), t.get("S") == "Buy")
        except (KeyError, TypeError, ValueError):
            continue
        q.append(row)
        add_order(orders, *row)
    if q:
        cut = q[-1][0] - TRADE_KEEP_MS
        while q and q[0][0] < cut:
            q.popleft()
        while orders and orders[0][0] < cut:
            orders.popleft()


def add_order(orders: deque, T: int, p: float, v: float, is_buy: bool):
    """Suma un trade a la ultima orden si es del mismo instante y lado; si no, empieza otra."""
    last = orders[-1] if orders else None
    if last is not None and last[0] == T and last[1] == is_buy:
        last[2] += v
        last[3] += p * v
        last[5] = p
        last[6] = min(last[6], p)
        last[7] = max(last[7], p)
        last[8] += 1
    else:
        orders.append([T, is_buy, v, p * v, p, p, p, p, 1])


def tape(symbol: str, min_usd: float = 0.0, limit: int = TAPE_LIMIT, tick: Optional[float] = None, orders=None,
         now_ms: Optional[int] = None) -> dict:
    """Las ordenes grandes mas recientes. min_usd 0: el percentil 99 de las ordenes de los ultimos 30 minutos."""
    orders = _orders.get(symbol) if orders is None else orders
    out = {"symbol": symbol, "min_usd": None, "auto": not min_usd, "orders": [], "buy_30s": 0.0, "sell_30s": 0.0,
           "count": len(orders) if orders else 0}
    if not orders:
        return out
    if min_usd and min_usd > 0:
        thr = float(min_usd)
    else:
        usd = np.fromiter((o[3] for o in orders), float, count=len(orders))
        thr = float(np.percentile(usd, TAPE_PCT)) if len(usd) >= 50 else float("inf")
    out["min_usd"] = None if not np.isfinite(thr) else round(thr)
    now_ms = int(now_ms if now_ms is not None else orders[-1][0])
    rows = []
    for o in reversed(orders):
        if now_ms - o[0] <= SUMMARY_MS:
            if o[1]:
                out["buy_30s"] += o[3]
            else:
                out["sell_30s"] += o[3]
        big = o[3] > thr if out["auto"] else o[3] >= thr     # automatico: por encima del percentil (no los empates)
        if big and len(rows) < limit:
            levels = int(round((o[7] - o[6]) / tick)) + 1 if tick else None
            rows.append({"t": o[0], "side": "buy" if o[1] else "sell", "qty": round(o[2], 8), "usd": round(o[3]),
                         "p0": o[4], "p1": o[5], "lo": o[6], "hi": o[7], "levels": levels, "trades": o[8]})
        if len(rows) >= limit and now_ms - o[0] > SUMMARY_MS:
            break
    out["buy_30s"] = round(out["buy_30s"])
    out["sell_30s"] = round(out["sell_30s"])
    out["orders"] = rows
    return out


def auto_mult(price: float, tick: float) -> int:
    return book_recorder.nice_ticks(price * STEP_FRACTION / tick)


def _buckets(levels: Dict[int, float], mult: int, lo: int, hi: int) -> Dict[int, float]:
    """Suma por cubo (precio en ticks // mult) de los niveles entre los cubos lo y hi."""
    out: Dict[int, float] = {}
    tlo, thi = lo * mult, (hi + 1) * mult
    if (thi - tlo) < len(levels):
        for t in range(tlo, thi):
            q = levels.get(t)
            if q:
                k = t // mult
                out[k] = out.get(k, 0.0) + q
    else:
        for t, q in levels.items():
            if tlo <= t < thi:
                k = t // mult
                out[k] = out.get(k, 0.0) + q
    return out


def view(book, symbol: str, mult: Optional[int] = None, rows: int = 60, center: Optional[float] = None,
         window_s: int = 300, now_ms: Optional[int] = None, trades=None, hist=None) -> dict:
    """La vista del ladder con el libro como esta ahora. book: book_recorder.Book ya sincronizado."""
    tick = book.tick
    mid_t = book.mid_ticks()
    if mid_t is None or not tick:
        raise ValueError("libro sin compras o sin ventas")
    if not mult or mult < 1:
        mult = auto_mult(mid_t * tick, tick)
    mult = int(min(mult, MAX_MULT))
    rows = int(max(5, min(rows, MAX_ROWS)))
    step = mult * tick
    kc = int(math.floor(round(center / tick) / mult)) if center else int(math.floor(mid_t / mult))
    hi = kc + rows // 2
    lo = hi - rows + 1
    bids = _buckets(book.bids, mult, lo, hi)
    asks = _buckets(book.asks, mult, lo, hi)
    now_ms = int(now_ms if now_ms is not None else time.time() * 1000)

    # lo negociado en la ventana
    buy: Dict[int, float] = {}
    sell: Dict[int, float] = {}
    last = None
    trades = _trades.get(symbol) if trades is None else trades
    if trades:
        last = trades[-1][1]
        since = trades[-1][0] - window_s * 1000
        for T, p, v, is_buy in reversed(trades):
            if T < since:
                break
            k = int(math.floor(round(p / tick) / mult))
            if lo <= k <= hi:
                side = buy if is_buy else sell
                side[k] = side.get(k, 0.0) + v

    # lo agregado o retirado: contra el libro de hace CHANGE_MS (el mas viejo que no pase de HIST_KEEP_MS)
    key = (symbol, mult)
    h = _hist.setdefault(key, deque()) if hist is None else hist
    before = None
    for ts, blo, bhi, snap in h:
        if now_ms - ts >= CHANGE_MS:
            before = (blo, bhi, snap)
        else:
            break
    h.append((now_ms, lo, hi, {k: (bids.get(k, 0.0), asks.get(k, 0.0)) for k in set(bids) | set(asks)}))
    while h and now_ms - h[0][0] > HIST_KEEP_MS:
        h.popleft()

    digits = max(0, -int(math.floor(math.log10(step) + 1e-9))) if step < 1 else 0
    out_rows = []
    for k in range(hi, lo - 1, -1):
        b, a = bids.get(k, 0.0), asks.get(k, 0.0)
        if before is not None and before[0] <= k <= before[1]:   # un precio fuera de esa vista: sin dato
            pb, pa = before[2].get(k, (0.0, 0.0))
            db, da = b - pb, a - pa
        else:
            db = da = None
        out_rows.append([round(k * step, digits + 2), round(b, 8), round(a, 8), round(buy.get(k, 0.0), 8),
                         round(sell.get(k, 0.0), 8), None if db is None else round(db, 8), None if da is None else round(da, 8)])
    return {"symbol": symbol, "ts": book.last_ts, "now": now_ms, "tick": tick, "mult": mult, "step": round(step, 12),
            "digits": digits, "best_bid": round(book.best_b * tick, 12), "best_ask": round(book.best_a * tick, 12),
            "mid": round(mid_t * tick, 12), "last": last, "window_s": window_s, "change_s": CHANGE_MS // 1000,
            "changes": before is not None, "trades": trades is not None and len(trades) > 0,
            "columns": ["precio", "compra", "venta", "negociado_compra", "negociado_venta", "cambio_compra", "cambio_venta"],
            "rows": out_rows}


MAX_WATCH = 10


def parse_watch(text: Optional[str]) -> List[Tuple[float, int]]:
    """'65500:1794600000000,65400.5:1794600100000' -> [(65500.0, 1794600000000), ...]; lo ilegible se ignora."""
    out = []
    for part in (text or "").split(","):
        try:
            p, since = part.split(":")
            p, since = float(p), int(since)
        except ValueError:
            continue
        if p > 0 and since > 0:
            out.append((p, since))
    return out[:MAX_WATCH]


def watch(book, symbol: str, items: List[Tuple[float, int]], trades=None) -> List[dict]:
    """En el precio exacto de cada orden: lo que espera ahora y lo negociado desde `since`. `partial` si los trades
    guardados no llegan tan atras (se guardan TRADE_KEEP_MS)."""
    tick = book.tick
    trades = _trades.get(symbol) if trades is None else trades
    first = trades[0][0] if trades else None
    out = []
    for price, since in items:
        t = round(price / tick)
        buy = sell = 0.0
        if trades:
            for T, p, v, is_buy in reversed(trades):
                if T < since:
                    break
                if round(p / tick) == t:
                    if is_buy:
                        buy += v
                    else:
                        sell += v
        out.append({"price": round(t * tick, 12), "since": since, "bid": round(book.bids.get(t, 0.0), 8),
                    "ask": round(book.asks.get(t, 0.0), 8), "buy": round(buy, 8), "sell": round(sell, 8),
                    "partial": first is None or first > since})
    return out


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/ladder/{symbol}")
    async def book_ladder(symbol: str, step: int = 0, rows: int = 60, center: Optional[float] = None, window: int = 300,
                          watch_: Optional[str] = Query(None, alias="watch")):
        rec = book_recorder.get_recorder()
        if rec is None:
            raise HTTPException(status_code=503, detail="el libro no se graba en este servidor")
        sym = symbol.upper()
        book = rec.books.get(sym)
        if book is None or sym in rec.closed:
            raise HTTPException(status_code=404, detail="moneda sin libro")
        if not book.ready:
            raise HTTPException(status_code=503, detail="libro sincronizandose")
        if window not in WINDOWS:
            window = 300
        try:
            res = view(book, sym, step or None, rows, center if center and center > 0 else None, window)
            items = parse_watch(watch_)
            if items:
                res["watch"] = watch(book, sym, items)
            return {"success": True, **res}
        except ValueError as e:
            raise HTTPException(status_code=503, detail=str(e))

    @r.get("/api/book/tape/{symbol}")
    async def book_tape(symbol: str, min_usd: float = 0.0, limit: int = TAPE_LIMIT):
        sym = symbol.upper()
        rec = book_recorder.get_recorder()
        book = rec.books.get(sym) if rec is not None else None
        tick = book.tick if book is not None else None
        res = tape(sym, max(0.0, min_usd), max(5, min(int(limit), 200)), tick, now_ms=int(time.time() * 1000))
        if not res["count"]:
            res["note"] = "sin trades todavia (la suite los recibe desde que arranca)"
        return {"success": True, **res}

    return r
