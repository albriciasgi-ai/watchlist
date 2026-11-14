# book_levels.py - Niveles de liquidez sostenida (14/11/2026), para la pestana "Mapa".
#
# Pedido del usuario, entre las ideas de indicadores con el mapa y el ladder: como DOM Levels de ATAS, pero filtrado por
# tiempo, y diciendo como termino cada nivel. Bookmap y ATAS no filtran por tiempo lo que parpadea.
#
# Sale del libro de minutos (.bkm, el mismo del mapa): el promedio de cada cubo grueso (~0.03% del precio; BTC 20 USD).
#   - Un cubo es "grande" en un minuto si su USD pasa el percentil PCT de los cubos de su lado a +-BAND del precio de ese
#     minuto, y es al menos X_MEDIAN veces su mediana. Solo usa ese minuto: nada del futuro.
#   - Empieza un tramo cuando es grande y sigue mientras tenga al menos la mitad (KEEP) de lo que tenia al empezar, como
#     la antiguedad de book_study. Hasta GAP_TOLERANCE minutos sin grabar (una reconexion) no lo cortan; mas, termina
#     "sin dato": lo de despues no se sabe.
#   - Es un nivel sostenido si dura al menos N minutos. Se sabe desde ese momento (known): antes se dibuja tenue.
#   - Como termina, con las velas de 1 minuto de Bybit:
#       consumido: el precio llego al nivel en el minuto en que se fue o en el anterior (se negocio contra el);
#       retirado: se fue sin que el precio llegara (dice a que distancia estaba);
#       activo: sigue en el ultimo minuto grabado.
#   - Retiro cerca (14/11, pedido del usuario): un retirado con el precio a NEAR_ATR (media ATR de 15m) o menos, o a
#     NEAR_PCT sin ATR. Lejos del precio, retirarse es lo normal del libro; cerca, es lo mas parecido a una "carnada".
#   - Toques: minutos en que el precio llego al nivel y el nivel siguio (defendido).
# Solo para mirar y medir; los umbrales no estan validados (book_study los compara con el azar).
import asyncio
import math
import re
import time
from typing import Dict, List, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException

import book_store
from settings import CONFIG

MINUTE = 60000
MIN_MINUTES = (15, 30, 60, 120, 240)
PCT = 95.0                  # percentil de los cubos de su lado para ser "grande"
BAND = 0.02                 # el percentil se toma con los cubos a +-2% del precio
X_MEDIAN = 3.0              # y al menos 3 veces la mediana de esos cubos (un libro parejo no tiene "grandes")
KEEP = 0.5                  # sigue mientras tenga al menos la mitad de lo que tenia al empezar
NEAR_ATR = 0.5               # retiro cerca: a media ATR de 15m o menos del precio
NEAR_PCT = 0.3              # sin ATR: a 0.3% o menos
GAP_TOLERANCE = 5           # minutos seguidos sin grabar que un nivel aguanta; mas, termina "sin dato"
LOOKBACK_MIN = 240          # se lee desde 4 h antes de lo pedido, para saber cuando empezo un nivel
MAX_MINUTES = 3 * 1440      # a lo sumo 3 dias de minutos por pedido (las velas de 1 minuto del grafico en vivo)
MAX_LEVELS = 400
CACHE_SECONDS = 50
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
_cache: Dict[tuple, Tuple[float, dict]] = {}


def _atr15(bars: Dict[int, Tuple[float, float, float]], n: int = 14):
    """ATR de 15m (14 velas) de la ultima vela cerrada antes de cada hora, con las velas de 1 minuto. None si no hay."""
    if not bars:
        return lambda t: None
    frame = 15 * MINUTE
    groups: Dict[int, list] = {}
    for t in sorted(bars):
        groups.setdefault(t - t % frame, []).append(bars[t])
    starts = sorted(groups)
    tr, prev = [], None
    for st in starts:
        g = groups[st]
        hi, lo, cl = max(b[0] for b in g), min(b[1] for b in g), g[-1][2]
        tr.append(hi - lo if prev is None else max(hi - lo, abs(hi - prev), abs(lo - prev)))
        prev = cl
    atr = [sum(tr[k - n + 1:k + 1]) / n if k + 1 >= n else None for k in range(len(tr))]
    arr = np.array(starts, np.int64)

    def at(t: int):
        k = int(np.searchsorted(arr + frame, t, side="right")) - 1   # la ultima vela cerrada en t
        return atr[k] if k >= 0 else None
    return at


def _matrix(cols):
    """USD por minuto y fila de precio, de cada lado, en la grilla del cubo mas comun. NaN = minuto sin grabar."""
    widths = [h["step"] * h["tick"] for h, _ in cols]
    w = max(set(widths), key=widths.count)
    ks = []
    for h, _ in cols:
        n, kmid = int(h["n"]), int(h["kmid"])
        wm = h["step"] * h["tick"]
        ks.append((math.floor((kmid - n) * wm / w), math.floor((kmid + n + 1) * wm / w)))
    r0 = min(a for a, _ in ks)
    r1 = max(b for _, b in ks)
    nrows = r1 - r0 + 1
    t0 = int(cols[0][0]["t"])
    span = (int(cols[-1][0]["t"]) - t0) // MINUTE + 1
    B = np.full((span, nrows), np.nan, np.float32)
    A = np.full((span, nrows), np.nan, np.float32)
    mids = np.full(span, np.nan)
    for h, p in cols:
        if h.get("gap"):
            continue
        i = (int(h["t"]) - t0) // MINUTE
        wm, n, kmid = h["step"] * h["tick"], int(h["n"]), int(h["kmid"])
        for side, M in (("b", B), ("a", A)):
            k = kmid - np.arange(n) if side == "b" else kmid + np.arange(n)
            center = (k + 0.5) * wm
            usd = np.maximum(p[f"twa_{side}"].astype(np.float64), 0.0) * center
            r = np.floor(center / w).astype(np.int64) - r0
            row = np.zeros(nrows)
            np.add.at(row, r, usd)
            M[i] = row
        mids[i] = float(h["mid"]) if h.get("mid") else np.nan
    return t0, w, r0, B, A, mids


def _thresholds(M: np.ndarray, mids: np.ndarray, w: float, r0: int, pct: float, band: float) -> np.ndarray:
    """Percentil de cada minuto con los cubos de ese lado (con algo) a +-band del precio."""
    th = np.full(M.shape[0], np.inf)
    centers = (np.arange(M.shape[1]) + r0 + 0.5) * w
    for i in range(M.shape[0]):
        if not np.isfinite(mids[i]) or np.isnan(M[i, 0]):
            continue
        sel = (np.abs(centers - mids[i]) <= mids[i] * band) & (M[i] > 0)
        if sel.sum() >= 10:
            vals = M[i, sel]
            th[i] = max(np.percentile(vals, pct), X_MEDIAN * np.median(vals))
    return th


def levels(cols, bars: Dict[int, Tuple[float, float, float]], start: int, end: int, min_minutes: int = 30,
           pct: float = PCT, band: float = BAND, keep: float = KEEP) -> dict:
    """Niveles sostenidos de los minutos grabados (cols de book_store.minute_columns, en orden), que tocan [start, end).
    bars: minuto -> (alto, bajo, cierre) de las velas de 1 minuto."""
    out = {"levels": [], "step": None, "first_ms": None, "last_ms": None, "min_minutes": min_minutes, "pct": pct}
    if not any(not c[0].get("gap") for c in cols):
        return out
    t0, w, r0, B, A, mids = _matrix(cols)
    span = B.shape[0]
    out.update(step=w, first_ms=t0, last_ms=t0 + (span - 1) * MINUTE)
    found = []
    for side, M in (("b", B), ("a", A)):
        th = _thresholds(M, mids, w, r0, pct, band)
        nrows = M.shape[1]
        run_start = np.full(nrows, -1)
        ref = np.zeros(nrows)
        total = np.zeros(nrows)
        peak = np.zeros(nrows)
        touches = np.zeros(nrows, np.int64)
        lo_px = (np.arange(nrows) + r0) * w
        hi_px = lo_px + w

        def close(rows, i, reason):
            for r in rows:
                s = int(run_start[r])
                dur = i - s
                if dur >= min_minutes:
                    found.append({"side": side, "lo": round(float(lo_px[r]), 10), "hi": round(float(hi_px[r]), 10),
                                  "start": t0 + s * MINUTE, "known": t0 + (s + min_minutes) * MINUTE,
                                  "end": None if reason == "activo" else t0 + i * MINUTE, "minutes": int(dur),
                                  "usd": round(float(total[r] / dur)), "usd_max": round(float(peak[r])),
                                  "reason": reason, "touches": int(touches[r]), "from_start": s == 0, "dist_pct": None,
                                  "dist_atr": None, "near": False,
                                  "_i": i})
                run_start[r] = -1
                touches[r] = 0

        missing = 0
        for i in range(span):
            v = M[i]
            active = run_start >= 0
            if np.isnan(v[0]):                      # minuto sin grabar: se espera hasta GAP_TOLERANCE
                missing += 1
                if missing == GAP_TOLERANCE + 1:
                    close(np.flatnonzero(active), i - GAP_TOLERANCE, "sin_dato")
                continue
            missing = 0
            keep_on = active & (v >= keep * ref)
            close(np.flatnonzero(active & ~keep_on), i, "terminado")
            # toques: el precio llego al nivel en este minuto y el nivel siguio
            bar = bars.get(t0 + i * MINUTE)
            if bar is not None:
                reached = (bar[1] <= hi_px) if side == "b" else (bar[0] >= lo_px)
                touches += (keep_on & reached).astype(np.int64)
            new = (run_start < 0) & (v >= th[i]) & (v > 0)
            run_start[new] = i
            ref[new] = v[new]
            total[new] = 0.0
            peak[new] = 0.0
            on = run_start >= 0
            total[on] += v[on]
            peak[on] = np.maximum(peak[on], v[on])
        close(np.flatnonzero(run_start >= 0), span, "activo")

    # como termino: consumido si el precio llego en ese minuto o el anterior; si no, retirado (cerca o lejos)
    atr_at = _atr15(bars)
    for lv in found:
        i = lv.pop("_i")
        if lv["reason"] != "terminado":
            continue
        near = [bars.get(t0 + j * MINUTE) for j in (i - 1, i)]
        near = [b for b in near if b is not None]
        if not near:
            lv["reason"] = "sin_precio"
            continue
        if lv["side"] == "b":
            reached = min(b[1] for b in near) <= lv["hi"]
            gap = (near[-1][2] - lv["hi"]) / near[-1][2]
        else:
            reached = max(b[0] for b in near) >= lv["lo"]
            gap = (lv["lo"] - near[-1][2]) / near[-1][2]
        lv["reason"] = "consumido" if reached else "retirado"
        if not reached:
            lv["dist_pct"] = round(100 * gap, 3)
            atr = atr_at(t0 + i * MINUTE)
            dist = gap * near[-1][2]
            lv["dist_atr"] = round(dist / atr, 2) if atr else None
            lv["near"] = bool(dist <= NEAR_ATR * atr) if atr else bool(100 * gap <= NEAR_PCT)
    sel = [lv for lv in found if lv["start"] < end and (lv["end"] is None or lv["end"] > start)]
    sel.sort(key=lambda lv: lv["usd"] * lv["minutes"], reverse=True)
    out["truncated"] = len(sel) > MAX_LEVELS
    out["levels"] = sorted(sel[:MAX_LEVELS], key=lambda lv: lv["start"])
    return out


_bars_cache: Dict[str, Tuple[float, int, Dict[int, Tuple[float, float, float]]]] = {}
BARS_SECONDS = 55


async def _bars(symbol: str, first: int) -> Dict[int, Tuple[float, float, float]]:
    """Velas de 1 minuto de Bybit desde first (a lo sumo 3 dias, como el grafico en vivo). Se guardan un minuto: el
    grafico pide los niveles cada minuto y cada pedido a Bybit de 1 a 3 dias son 2 a 5 paginas."""
    import candles
    hit = _bars_cache.get(symbol)
    if hit and time.time() - hit[0] < BARS_SECONDS and hit[1] <= first:
        return hit[2]
    days = max(1, min(3, math.ceil((time.time() * 1000 - first) / 86_400_000)))
    try:
        data = await candles.cached_klines(symbol, "1", days)
    except Exception:
        return {}
    bars = {int(c["timestamp"]): (float(c["high"]), float(c["low"]), float(c["close"])) for c in data}
    if len(_bars_cache) > 30:
        _bars_cache.clear()
    _bars_cache[symbol] = (time.time(), int(time.time() * 1000) - days * 86_400_000, bars)
    return bars


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/levels/{symbol}")
    async def book_levels(symbol: str, from_ms: int = 0, to_ms: int = 0, minutes: int = 30):
        symbol = symbol.upper()
        if not SYMBOL_RE.match(symbol):
            raise HTTPException(status_code=404, detail="moneda invalida")
        if minutes not in MIN_MINUTES:
            raise HTTPException(status_code=400, detail=f"minutos invalidos: {', '.join(map(str, MIN_MINUTES))}")
        if not (0 < from_ms < to_ms):
            raise HTTPException(status_code=400, detail="rango de horas invalido")
        now = int(time.time() * 1000)
        to_ms = min(to_ms, now + MINUTE)
        first = max(from_ms - LOOKBACK_MIN * MINUTE, to_ms - MAX_MINUTES * MINUTE)
        first -= first % MINUTE
        key = (symbol, minutes, first // 3_600_000, to_ms // MINUTE)
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return {"success": True, **hit[1]}
        base = book_store.sources(CONFIG["orderflow_data"])
        cols = await asyncio.to_thread(book_store.minute_columns, base, symbol, first, to_ms)
        cols = sorted(cols, key=lambda hp: hp[0]["t"])
        bars = await _bars(symbol, first) if cols else {}
        res = await asyncio.to_thread(levels, cols, bars, from_ms, to_ms, minutes)
        res["truncated_time"] = first > from_ms - LOOKBACK_MIN * MINUTE
        if len(_cache) > 50:
            _cache.clear()
        _cache[key] = (time.time(), res)
        return {"success": True, **res}

    return r
