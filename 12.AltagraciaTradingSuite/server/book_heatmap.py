# book_heatmap.py - Mapa de liquidez para el grafico (13/11/2026).
#
# La liquidez que esperaba en el libro grabado (book_recorder.py), por vela y por precio, para dibujarla detras de
# las velas en una pestana aparte: el usuario pidio que no se mezcle con el grafico principal ni con sus datos.
# Sale del libro de minutos (.bkm de book_store): el promedio ponderado por tiempo de cada cubo grueso (~0.03% del
# precio; BTC 20 USD), hasta +-5% del precio de cada minuto, de lo grabado en el PC y lo bajado de la nube.
# Dos modos:
#   - "toda": el promedio de la liquidez en los minutos de la vela;
#   - "sostenida": la que estuvo los ultimos N minutos hasta el cierre de la vela (el menor promedio de esos
#     minutos). Quita lo que aparece y desaparece, como las franjas de los creadores de mercado que siguen al precio.
#     Si falta uno de esos minutos, la vela queda sin dato: lo de ese minuto no se sabe.
# Cada celda va en un byte: round(16 * log10(1 + USD)), de 0 a 255 (cada paso es 15.5% mas). El grafico elige el
# contraste con lo que esta a la vista.
# Con sides (14/11/2026, pedido del usuario): compra y venta por separado (cells_b y cells_a), cada una con su propio
# promedio o minimo. Sumadas, un soporte roto que pasa a resistencia (las compras se van y en el mismo precio aparecen
# ventas) seguia como una sola franja; asi se ve el cambio de lado, y lo sostenido de cada lado empieza de cero.
import asyncio
import base64
import math
import re
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException

import book_store
from settings import CONFIG

MINUTE = 60000
FRAMES = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1": 1, "5": 5, "15": 15, "60": 60, "240": 240}
SUSTAIN = (5, 15, 30, 60, 120, 240)
MODES = ("toda", "sostenida")
MAX_COLS = 1500
MAX_MINUTES = 10 * 1440      # a lo sumo 10 dias de minutos por pedido
MAX_ROWS = 600
ENC = 16.0                   # celda = round(ENC * log10(1 + USD))
DEFAULT_BAND = 0.03          # sin low/high: el rango de precios de la ventana +-3%
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")


def encode(usd: np.ndarray) -> np.ndarray:
    v = np.nan_to_num(usd, nan=0.0)
    return np.clip(np.rint(ENC * np.log10(1.0 + np.maximum(v, 0.0))), 0, 255).astype(np.uint8)


def decode(cells: np.ndarray) -> np.ndarray:
    """Lo inverso de encode (para pruebas): el USD que representa cada byte."""
    return 10 ** (cells.astype(np.float64) / ENC) - 1.0


def _width(h: dict) -> float:
    return float(h["step"]) * float(h["tick"])


def grid(base, symbol: str, frame_min: int, start: int, end: int, mode: str = "toda", sustain: int = 30,
         low: Optional[float] = None, high: Optional[float] = None, step: Optional[float] = None,
         now_ms: Optional[int] = None, sides: bool = False) -> dict:
    """Mapa de [start, end) en velas de frame_min minutos. Columnas: una por vela desde t0; filas: precios de
    `step` USD desde row0 * step. Sin step usa el ancho de los cubos grabados, mas grueso si no caben MAX_ROWS."""
    frame = frame_min * MINUTE
    start -= start % frame
    if end <= start:
        raise ValueError("rango vacio")
    truncated = False
    ncols = -(-(end - start) // frame)
    if ncols > MAX_COLS:                       # se quedan las velas mas recientes
        start = start + (ncols - MAX_COLS) * frame
        ncols = MAX_COLS
        truncated = True
    first = start - (sustain * MINUTE if mode == "sostenida" else 0)
    if (end - first) // MINUTE > MAX_MINUTES:
        first = end - MAX_MINUTES * MINUTE
        first -= first % MINUTE
        truncated = True
    cols = sorted(book_store.minute_columns(base, symbol, first, end), key=lambda hp: hp[0]["t"])
    out = {"symbol": symbol, "frame": frame_min, "mode": mode, "sustain": sustain if mode == "sostenida" else None,
           "t0": start, "cols": ncols, "frame_ms": frame, "enc": ENC, "truncated": truncated,
           "first_ms": int(cols[0][0]["t"]) if cols else None, "last_ms": int(cols[-1][0]["t"]) if cols else None,
           "row0": None, "rows": 0, "step": None, "cells": "", "coverage": [0] * ncols, "sides": bool(sides)}
    if not cols:
        return out
    widths = [_width(h) for h, _ in cols]
    native = max(set(widths), key=widths.count)
    mids = [float(h["mid"]) for h, _ in cols if h.get("mid")]
    if low is None or high is None:
        if not mids:
            return out
        low, high = min(mids) * (1 - DEFAULT_BAND), max(mids) * (1 + DEFAULT_BAND)
    w = max(float(step), native) if step else native
    if not step:
        while (high - low) / w > MAX_ROWS:
            w += native
    row0 = int(math.floor(low / w))
    nrows = int(math.ceil(high / w)) - row0
    if nrows <= 0 or nrows > MAX_ROWS * 2:
        raise ValueError("rango de precios demasiado grande para ese paso")
    # una fila por minuto grabado: el USD de cada precio (compras y ventas en la misma fila de precio)
    t_first = int(cols[0][0]["t"])
    span = (int(cols[-1][0]["t"]) - t_first) // MINUTE + 1
    names = ("b", "a") if sides else ("ba",)
    Ms = {nm: np.full((span, nrows), np.nan, np.float32) for nm in names}
    for h, p in cols:
        if h.get("gap"):
            continue                           # minuto incompleto: no se sabe que hubo
        i = (int(h["t"]) - t_first) // MINUTE
        wm, n, kmid = _width(h), int(h["n"]), int(h["kmid"])
        rows_by = {nm: np.zeros(nrows, np.float64) for nm in names}
        for side in ("b", "a"):
            k = kmid - np.arange(n) if side == "b" else kmid + np.arange(n)
            center = (k + 0.5) * wm
            usd = np.maximum(p[f"twa_{side}"].astype(np.float64), 0.0) * center
            r = np.floor(center / w).astype(np.int64) - row0
            sel = (r >= 0) & (r < nrows)
            np.add.at(rows_by[side if sides else "ba"], r[sel], usd[sel])
        for nm in names:
            Ms[nm][i] = rows_by[nm]
    M = Ms[names[0]]
    present = ~np.isnan(M[:, 0])
    vals_by = {nm: np.full((ncols, nrows), np.nan, np.float32) for nm in names}
    cover = np.zeros(ncols, np.int64)
    now_ms = now_ms if now_ms is not None else end
    for c in range(ncols):
        a = start + c * frame
        b = min(a + frame, end)
        ia = max(0, (a - t_first) // MINUTE)
        ib = min(span, (b - t_first) // MINUTE)
        if ib <= ia:
            continue
        here = present[ia:ib]
        if not here.any():
            continue
        cover[c] = int(round(100 * here.sum() / max(1, (min(b, now_ms) - a) // MINUTE)))
        if mode == "toda":
            for nm in names:
                vals_by[nm][c] = np.nanmean(Ms[nm][ia:ib][here], axis=0)
        else:
            last = ia + int(np.flatnonzero(here)[-1])      # el ultimo minuto grabado de la vela (la vela en curso)
            wa = last + 1 - sustain
            if wa < 0:
                continue
            if np.isnan(M[wa:last + 1, 0]).any():
                continue                                   # falto un minuto: lo sostenido no se sabe
            for nm in names:
                vals_by[nm][c] = Ms[nm][wa:last + 1].min(axis=0)
    b64 = lambda v: base64.b64encode(encode(v).tobytes()).decode("ascii")  # noqa: E731
    out.update(row0=row0, rows=nrows, step=w, coverage=[min(100, int(x)) for x in cover])
    if sides:
        out.pop("cells", None)
        out.update(cells_b=b64(vals_by["b"]), cells_a=b64(vals_by["a"]))
    else:
        out.update(cells=b64(vals_by["ba"]))
    return out


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/heatmap/{symbol}")
    async def book_heatmap(symbol: str, interval: str = "15m", from_ms: int = 0, to_ms: int = 0, mode: str = "toda",
                           minutes: int = 30, low: Optional[float] = None, high: Optional[float] = None,
                           step: Optional[float] = None, sides: int = 0):
        symbol = symbol.upper()
        if not SYMBOL_RE.match(symbol):
            raise HTTPException(status_code=404, detail="moneda invalida")
        if interval not in FRAMES:
            raise HTTPException(status_code=400, detail="marco invalido")
        if mode not in MODES:
            raise HTTPException(status_code=400, detail="modo invalido: toda o sostenida")
        if minutes not in SUSTAIN:
            raise HTTPException(status_code=400, detail=f"minutos invalidos: {', '.join(map(str, SUSTAIN))}")
        if not (0 < from_ms < to_ms):
            raise HTTPException(status_code=400, detail="rango de horas invalido")
        if (low is None) != (high is None) or (low is not None and not (0 < low < high)):
            raise HTTPException(status_code=400, detail="rango de precios invalido")
        if step is not None and not (step > 0):
            raise HTTPException(status_code=400, detail="paso invalido")
        base = book_store.sources(CONFIG["orderflow_data"])
        try:
            res = await asyncio.to_thread(grid, base, symbol, FRAMES[interval], from_ms, to_ms, mode, minutes, low, high, step,
                                          None, bool(sides))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, **res}

    return r
