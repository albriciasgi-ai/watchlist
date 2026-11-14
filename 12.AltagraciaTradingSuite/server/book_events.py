# book_events.py - Absorcion y barrido del libro como Elementos OF (14/11/2026).
#
# Pedido del usuario: llevar la absorcion y el barrido a los elementos del footprint. Salen del libro grabado (solo la
# suite lo tiene) y se suman a la respuesta de /api/orderflow/elements de la suite con los codigos AB y BL, en el
# formato de of_elements de App 1 (code, dir, t, t0, known, lo, hi, value, thr). App 1 no los calcula.
#
# AB - Absorcion en el libro: en una vela, en un cubo del libro de minutos (~0.03%: BTC 20 USD), se negocio contra
#      ese lado (venta agresiva contra las compras, o compra agresiva contra las ventas) al menos ABS_X veces lo que
#      habia esperando en promedio; lo que esperaba al final de la vela es al menos KEEP de lo del principio (se
#      repuso o se quedo); y el precio no paso (al cerrar la vela sigue de su lado). Ademas lo negociado pasa el
#      percentil ABS_PCT de las velas de las 24 horas anteriores (umbral relativo, sin mirar el futuro; con menos de
#      MIN_HISTORY velas no marca). dir +1 si fueron compras que absorbieron venta (alcista), -1 al reves.
# BL - Barrido del libro: un nivel sostenido (book_levels, 15 minutos o mas, el 5% mas grande de su lado) que se
#      consumio en la vela: el precio llego y se lo comio. dir -1 si fue una compra barrida (bajista), +1 una venta.
# Los dos se conocen al cerrar la vela. Son ayudas de lectura, sin validar contra el azar.
from typing import Dict, List, Optional, Tuple

import numpy as np

import book_levels
import book_store
import book_study

MINUTE = 60000
DAY = 86400000
ABS_X = 2.0
KEEP = 0.5
ABS_PCT = 90.0
MIN_HISTORY = 20
MIN_COVER = 0.8          # una vela necesita el 80% de sus minutos grabados
BL_MINUTES = 15
CATALOG = {"AB": ["Absorción en el libro", "band"], "BL": ["Barrido del libro (nivel sostenido)", "band"]}


def _trade_grid(trades, t0: int, span: int, w: float, r0: int, nrows: int, start: int, end: int):
    """USD negociado por minuto y fila de precio: venta agresiva (contra las compras) y compra agresiva (contra las
    ventas). None si no hay trades de esos dias."""
    sell = np.zeros((span, nrows))
    buy = np.zeros((span, nrows))
    seen = False
    for day in book_store.days_between(start, end):
        d = trades._day(day) if trades is not None else None
        if d is None:
            continue
        seen = True
        t, p, q, side, _ = d
        a, b = np.searchsorted(t, [start, end])
        tt, pp, qq, ss = t[a:b], p[a:b], q[a:b], side[a:b]
        i = (tt - t0) // MINUTE
        r = np.floor(pp / w).astype(np.int64) - r0
        ok = (i >= 0) & (i < span) & (r >= 0) & (r < nrows)
        usd = pp * qq
        for grid, s in ((sell, -1), (buy, 1)):
            m = ok & (ss == s)
            np.add.at(grid, (i[m], r[m]), usd[m])
    return (sell, buy) if seen else None


def absorption(cols, trades, frame_min: int, start: int, end: int, known_until: int) -> List[dict]:
    """Eventos AB de las velas que empiezan en [start, end) y cierran hasta known_until. cols: minutos del libro desde
    24 horas antes de start (para el umbral relativo)."""
    if not cols or not any(not c[0].get("gap") for c in cols):
        return []
    t0, w, r0, B, A, mids = book_levels._matrix(cols)
    span, nrows = B.shape
    grids = _trade_grid(trades, t0, span, w, r0, nrows, t0, t0 + span * MINUTE)
    if grids is None:
        return []
    sell, buy = grids
    frame = frame_min * MINUTE
    first_c = t0 - t0 % frame
    history = {"b": [], "a": []}     # (inicio de vela, mayor negociado contra ese lado)
    out = []
    lo_px = (np.arange(nrows) + r0) * w
    for c in range(first_c, t0 + span * MINUTE, frame):
        ia, ib = max(0, (c - t0) // MINUTE), min(span, (c + frame - t0) // MINUTE)
        if ib <= ia or c + frame > known_until:
            continue
        present = np.flatnonzero(~np.isnan(B[ia:ib, 0]))
        if len(present) < MIN_COVER * frame_min:
            continue
        rows_idx = ia + present
        close_mid = float(mids[rows_idx[-1]])
        for side, M, against in (("b", B, sell), ("a", A, buy)):
            rest = M[rows_idx].astype(np.float64)
            avg = rest.mean(axis=0)
            traded = against[ia:ib].sum(axis=0)
            hist = history[side]
            best = float(traded.max()) if traded.size else 0.0
            past = [v for (tc, v) in hist if c - DAY <= tc < c]
            hist.append((c, best))
            if c < start or c >= end or len(past) < MIN_HISTORY or not np.isfinite(close_mid):
                continue
            thr = float(np.percentile(past, ABS_PCT))
            held = (close_mid > lo_px) if side == "b" else (close_mid < lo_px + w)
            ok = (traded >= ABS_X * avg) & (avg > 0) & (rest[-1] >= KEEP * rest[0]) & held & (traded >= thr) & (traded > 0)
            if not ok.any():
                continue
            r = int(np.flatnonzero(ok)[np.argmax(traded[ok])])
            out.append({"code": "AB", "dir": 1 if side == "b" else -1, "t": int(c), "t0": int(c), "known": int(c + frame),
                        "lo": round(float(lo_px[r]), 10), "hi": round(float(lo_px[r] + w), 10),
                        "value": round(float(traded[r])), "thr": round(thr), "rest": round(float(avg[r]))})
    return out


def sweeps(cols, bars: Dict[int, Tuple[float, float, float]], frame_min: int, start: int, end: int,
           known_until: int) -> List[dict]:
    """Eventos BL: niveles sostenidos (15 minutos o mas) consumidos en la vela."""
    if not cols:
        return []
    frame = frame_min * MINUTE
    res = book_levels.levels(cols, bars, start, end, BL_MINUTES)
    out = []
    for lv in res["levels"]:
        if lv["reason"] != "consumido" or lv["end"] is None:
            continue
        c = lv["end"] - lv["end"] % frame
        if c < start or c >= end or c + frame > known_until:
            continue
        out.append({"code": "BL", "dir": -1 if lv["side"] == "b" else 1, "t": int(c), "t0": int(c), "known": int(c + frame),
                    "lo": lv["lo"], "hi": lv["hi"], "value": lv["usd"], "thr": None, "minutes": lv["minutes"]})
    return out


_trades: Dict[str, book_study.Trades] = {}


def detect(base, symbol: str, frame_min: int, start: int, end: int, known_until: int,
           bars: Optional[Dict[int, Tuple[float, float, float]]] = None) -> List[dict]:
    """AB y BL de las velas que empiezan en [start, end). Sin libro grabado en esas horas, nada."""
    end = min(end, known_until)
    if end <= start:
        return []
    cols = sorted(book_store.minute_columns(base, symbol, start - DAY, end + frame_min * MINUTE), key=lambda h: h[0]["t"])
    if not cols:
        return []
    trades = _trades.get(symbol)
    if trades is None:
        if len(_trades) > 4:
            _trades.clear()
        trades = _trades[symbol] = book_study.Trades(symbol)
    trades.days = {d: v for d, v in trades.days.items() if d != book_store.day_of(known_until)}  # el dia en curso crece
    out = absorption(cols, trades, frame_min, start, end, known_until)
    if bars:
        out += sweeps([c for c in cols if c[0]["t"] >= start - book_levels.LOOKBACK_MIN * MINUTE], bars, frame_min,
                      start, end, known_until)
    return sorted(out, key=lambda e: (e["t"], e["code"]))
