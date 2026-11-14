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
import math
import time
from collections import deque
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException

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
# (moneda, step) -> [(hora, {cubo: (compra, venta)})] para lo agregado o retirado
_hist: Dict[Tuple[str, int], deque] = {}


def add_trades(symbol: str, trades: List[dict]):
    """Trades de publicTrade de Bybit: T (ms), p, v, S ("Buy" = compra agresiva)."""
    q = _trades.get(symbol)
    if q is None:
        q = _trades[symbol] = deque(maxlen=TRADE_MAX)
    for t in trades:
        try:
            q.append((int(t["T"]), float(t["p"]), float(t["v"]), t.get("S") == "Buy"))
        except (KeyError, TypeError, ValueError):
            continue
    if q:
        cut = q[-1][0] - TRADE_KEEP_MS
        while q and q[0][0] < cut:
            q.popleft()


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


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/ladder/{symbol}")
    async def book_ladder(symbol: str, step: int = 0, rows: int = 60, center: Optional[float] = None, window: int = 300):
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
            return {"success": True, **view(book, sym, step or None, rows, center if center and center > 0 else None, window)}
        except ValueError as e:
            raise HTTPException(status_code=503, detail=str(e))

    return r
