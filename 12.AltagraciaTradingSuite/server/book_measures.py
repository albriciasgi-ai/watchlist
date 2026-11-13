# book_measures.py - Medidas del libro de cada trade real del journal (13/11/2026), con el libro que graba la suite.
#
# Lo que el informe de patrones del price ladder propuso medir en cada orden: si la liquidez cerca del precio era
# mucha o poca para esa moneda, si habia liquidez en tu entrada y si se sostenia, si la que protegia tu orden se iba
# retirando y, al llenarse, si se retiro antes del toque y cuanto se negocio ahi. Se calculan con los archivos de
# book_store.py (segundos y minutos) y, lo negociado, con los footprints de 1 minuto del almacen (App 1, live=True).
# Un trade anterior a la grabacion queda sin estas medidas ("—"). No anticipan nada: se comparan en el informe de
# ganadoras y perdedoras como las demas.
from typing import Dict, List, Optional, Tuple

import numpy as np

import book_store
from settings import CONFIG

MINUTE = 60000
NEAR = 0.005          # +-0.5% del precio
ZONE = 0.0005         # tu entrada: +-0.05% de su precio
TYPICAL = 0.0025      # para comparar tu entrada: cubos a +-0.25% de su distancia, en el mismo lado
GROUP = "Libro"
_depth_cache: Dict[Tuple[str, int], float] = {}

CATALOG = [
    ("book_depth05", "Libro: liquidez a ±0.5% en los 5 min previos (USD)"),
    ("book_depth05_pct", "Libro: esa liquidez contra las 24 h previas (percentil 0 a 100)"),
    ("book_imbalance05", "Libro: desequilibrio a ±0.5% a favor del trade (−1 a 1)"),
    ("book_entry_usd", "Libro: liquidez en espera en tu entrada (±0.05%, USD)"),
    ("book_entry_rel", "Libro: tu entrada contra lo típico a esa distancia (veces)"),
    ("book_entry_hold", "Libro: persistencia en tu entrada en 15 min (mínimo ÷ promedio)"),
    ("book_protect_chg", "Libro: liquidez entre tu entrada y tu stop, cambio en 10 min (%)"),
    ("book_fill_pulled", "Libro: retirado de tu entrada en los 30 s antes del llenado (%)"),
    ("book_fill_exec", "Libro: negociado en tu entrada en el minuto del llenado ÷ lo que había (veces)"),
]


def catalog() -> List[Dict[str, str]]:
    return [{"key": key, "label": label, "group": GROUP} for key, label in CATALOG]


def _base():
    return book_store.sources(CONFIG["orderflow_data"])  # lo grabado en el PC y lo bajado de la nube


def _columns(base, symbol: str, start: int, end: int):
    return [(h, p) for h, p in book_store.minute_columns(base, symbol, start, end) if h.get("mid")]


def _near_usd(header: dict, parts: Dict[str, np.ndarray], band: float = NEAR) -> Tuple[float, float]:
    mid = header["mid"]
    _, bids = book_store.zone_depth(header, parts["twa_b"], "b", mid * (1 - band), mid)
    _, asks = book_store.zone_depth(header, parts["twa_a"], "a", mid, mid * (1 + band))
    return bids, asks


def _cached_near(base, symbol: str, minute: int, header=None, parts=None) -> Optional[float]:
    key = (symbol, minute)
    if key in _depth_cache:
        return _depth_cache[key]
    if header is None:
        return None
    b, a = _near_usd(header, parts)
    if len(_depth_cache) > 300000:
        _depth_cache.clear()
    _depth_cache[key] = b + a
    return b + a


def _round(x, digits=3):
    return None if x is None or not np.isfinite(x) else round(float(x), digits)


def decision_measures(base, symbol: str, side: int, entry: Optional[float], stop: Optional[float], at: int) -> Dict[str, Optional[float]]:
    out = {key: None for key, _ in CATALOG}
    last_closed = at - at % MINUTE  # el minuto en curso al decidir no esta cerrado
    cols = _columns(base, symbol, last_closed - 24 * 60 * MINUTE, last_closed)
    if not cols:
        return out
    recent = [(h, p) for h, p in cols if h["t"] >= last_closed - 5 * MINUTE]
    if not recent:
        return out
    near = [sum(_near_usd(h, p)) for h, p in recent]
    out["book_depth05"] = _round(np.mean(near), 0)
    # contra las 24 h anteriores a esos 5 minutos, sin contarlos
    day = [_cached_near(base, symbol, h["t"], h, p) for h, p in cols if h["t"] < last_closed - 5 * MINUTE]
    day = [x for x in day if x is not None]
    if len(day) >= 60:
        out["book_depth05_pct"] = _round(100.0 * np.mean(np.array(day) < out["book_depth05"]), 1)
    h, p = recent[-1]
    bids, asks = _near_usd(h, p)
    if bids + asks > 0:
        out["book_imbalance05"] = _round(side * (bids - asks) / (bids + asks), 3)
    if not entry:
        return out
    book_side = "b" if side > 0 else "a"
    lo, hi = entry * (1 - ZONE), entry * (1 + ZONE)
    if book_store.covers(h, book_side, lo, hi):
        _, usd = book_store.zone_depth(h, p[f"twa_{book_side}"], book_side, lo, hi)
        out["book_entry_usd"] = _round(usd, 0)
        # lo tipico en el mismo lado y a la misma distancia del precio, sin la zona de la entrada
        mid = h["mid"]
        dist = abs(entry - mid)
        width = h["step"] * h["tick"]
        i = np.arange(int(h["n"]))
        k = h["kmid"] - i if book_side == "b" else h["kmid"] + i
        center = (k + 0.5) * width
        d = np.abs(center - mid)
        ring = (np.abs(d - dist) <= mid * TYPICAL) & ((center < lo) | (center > hi))
        values = p[f"twa_{book_side}"][ring].astype(np.float64) * center[ring]
        in_zone = book_store.zone_indices(h, book_side, lo, hi)
        typical = float(np.median(values)) if len(values) >= 5 else 0.0
        if typical > 0 and len(in_zone):
            out["book_entry_rel"] = _round(usd / len(in_zone) / typical, 2)
        hold = [(book_store.zone_depth(hh, pp[f"min_{book_side}"], book_side, lo, hi)[1],
                 book_store.zone_depth(hh, pp[f"twa_{book_side}"], book_side, lo, hi)[1])
                for hh, pp in cols if hh["t"] >= last_closed - 15 * MINUTE and book_store.covers(hh, book_side, lo, hi)]
        if len(hold) >= 5:
            mean = np.mean([b for _, b in hold])
            if mean > 0:
                out["book_entry_hold"] = _round(min(a for a, _ in hold) / mean, 3)
    if stop and stop != entry:
        a_, b_ = sorted((entry, stop))
        then = [(hh, pp) for hh, pp in cols if hh["t"] <= last_closed - 10 * MINUTE]
        if then and book_store.covers(h, book_side, a_, b_) and book_store.covers(then[-1][0], book_side, a_, b_):
            now_usd = book_store.zone_depth(h, p[f"twa_{book_side}"], book_side, a_, b_)[1]
            before = book_store.zone_depth(then[-1][0], then[-1][1][f"twa_{book_side}"], book_side, a_, b_)[1]
            if before > 0:
                out["book_protect_chg"] = _round(100.0 * (now_usd - before) / before, 1)
    return out


def _zone_at(secs, book_side: str, lo: float, hi: float, t: int) -> Optional[float]:
    """USD en la zona en la ultima toma de segundo hasta t."""
    best = None
    for header, bids, asks in secs:
        rows = bids if book_side == "b" else asks
        for r, ts in enumerate(header["ts"]):
            if ts <= t:
                best = (header, rows[r])
    if best is None or not book_store.covers(best[0], book_side, lo, hi):
        return None
    return book_store.zone_depth(best[0], best[1], book_side, lo, hi)[1]


def fill_measures(base, symbol: str, side: int, entry: float, filled_at: int, executed=None) -> Dict[str, Optional[float]]:
    out = {"book_fill_pulled": None, "book_fill_exec": None}
    book_side = "b" if side > 0 else "a"
    lo, hi = entry * (1 - ZONE), entry * (1 + ZONE)
    secs = book_store.second_rows(base, symbol, filled_at - 2 * MINUTE, filled_at + MINUTE)
    before30 = _zone_at(secs, book_side, lo, hi, filled_at - 30000)
    before5 = _zone_at(secs, book_side, lo, hi, filled_at - 5000)
    if before30 and before5 is not None:
        out["book_fill_pulled"] = _round(100.0 * max(0.0, 1.0 - before5 / before30), 1)
    if before30 and executed is not None:
        traded = executed(symbol, filled_at - filled_at % MINUTE, lo, hi, side)
        if traded is not None:
            out["book_fill_exec"] = _round(traded / before30, 3)
    return out


def executed_usd(symbol: str, minute: int, lo: float, hi: float, side: int) -> Optional[float]:
    """USD negociado contra tu lado en la zona, en ese minuto: ventas agresivas para un long, compras para un short."""
    try:
        import footprint_store  # App 1 (su backend esta en sys.path)
        res = footprint_store.footprints(symbol, 1, minute, minute + MINUTE, live=True,
                                         step=max((hi - lo) / 10, 1e-12))
    except Exception:
        return None
    fps = res.get("footprints") or []
    if not fps:
        return None
    total = 0.0
    for level in fps[0]["levels"]:
        mid = level["price_mid"]
        if lo <= mid <= hi:
            total += (level["bid_volume"] if side > 0 else level["ask_volume"]) * mid
    return total


def compute(trade: dict, base=None, executed=executed_usd) -> Dict[str, Optional[float]]:
    """Todas las medidas del libro de un trade del journal (las del llenado, si se lleno despues de decidir)."""
    base = base or _base()
    side = 1 if trade.get("side") == "Buy" else -1
    decision = trade.get("decision") or {}
    at = decision.get("at") or trade.get("opened_at")
    symbol = trade.get("symbol")
    out = {key: None for key, _ in CATALOG}
    if not at or not symbol:
        return out
    entry = trade.get("entry") or (decision.get("order") or {}).get("entry")
    stop = trade.get("initial_stop_loss") or (decision.get("order") or {}).get("stop")
    out.update(decision_measures(base, symbol, side, entry, stop, int(at)))
    opened = trade.get("opened_at")
    if entry and opened:
        out.update(fill_measures(base, symbol, side, float(entry), int(opened), executed))
    return out
