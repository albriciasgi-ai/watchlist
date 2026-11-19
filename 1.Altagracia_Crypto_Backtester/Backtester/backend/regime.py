"""
Regímenes del mercado: tendencia u horizontalidad, para medir qué tan bien la detectan los indicadores.

- La referencia (truth) mira el futuro a propósito: con todo el tramo a la vista, cada vela se juzga por su ventana
  centrada. Sirve solo para calificar a los detectores, nunca para operar.
- Los detectores (regime_detectors.py) solo usan lo ocurrido hasta cada vela, y se comparan contra la referencia.
- Todo es solo de la fase 1: las fases 2 y 3 quedan para comprobar estrategias.
"""
import math
import time

import numpy as np

import rule_tester as rt

TFS = (15, 60, 240)
DEFAULT_WINDOW = 24       # Velas de la ventana centrada de la referencia (12 antes y 12 después)
TREND_SHARE = 0.25        # Parte del tiempo que la referencia marca como tendencia
MIN_RUN = 6               # Un tramo de tendencia o de rango más corto se une a su vecino


def phase_bars(symbol, tf):
    """Velas de la fase 1 de la moneda: las del almacén de trades antes del caché de velas, y después las del caché."""
    phase = next((p for p in rt.phases(symbol) if p["phase"] == 1), None)
    if phase is None or not phase["available"]:
        return [], None
    for attempt in range(4):
        try:
            cached = rt.candle_bars(symbol, tf)
            break
        except (EOFError, OSError, ValueError):
            # App 1 reescribe el caché de velas sin archivo temporal: leído a mitad de escritura, se espera y se repite
            if attempt == 3:
                raise
            time.sleep(3)
    first = cached[0]["t"] if cached else phase["end"]
    bars = []
    if rt.has_store(symbol) and first > phase["start"]:
        early = rt.early_candles(symbol, tf, first)
        bars = [{"t": int(t), "o": o, "h": h, "l": l, "c": c, "vol": v}
                for t, o, h, l, c, v in zip(early["t"], early["o"], early["h"], early["l"], early["c"], early["v"])]
    bars += [{"t": b["t"], "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "vol": b["vol"]} for b in cached if b["t"] >= first]
    bars = [b for b in bars if phase["start"] <= b["t"] < phase["end"]]
    return bars, phase


def arrays(bars):
    return {k: np.array([b[src] for b in bars], dtype=float) for k, src in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))} | {
        "t": np.array([b["t"] for b in bars], dtype=np.int64)}


def atr(h, l, c, n=14):
    prev = np.concatenate([[c[0]], c[:-1]])
    tr = np.maximum(h - l, np.maximum(abs(h - prev), abs(l - prev)))
    out = np.empty_like(tr)
    out[0] = tr[0]
    for i in range(1, len(tr)):
        out[i] = out[i - 1] + (tr[i] - out[i - 1]) / n  # Wilder
    return out


def _runs(labels):
    """Tramos seguidos con la misma etiqueta: (inicio, fin exclusivo, etiqueta)."""
    out, start = [], 0
    for i in range(1, len(labels) + 1):
        if i == len(labels) or labels[i] != labels[start]:
            out.append((start, i, int(labels[start])))
            start = i
    return out


def _merge_short(labels, min_run):
    """Un tramo más corto que min_run toma la etiqueta del vecino más largo. Se repite hasta que no quede ninguno."""
    runs = [list(r) for r in _runs(labels)]
    while len(runs) > 1:
        k = min(range(len(runs)), key=lambda i: runs[i][1] - runs[i][0])  # El tramo más corto primero
        if runs[k][1] - runs[k][0] >= min_run:
            break
        left = runs[k - 1] if k > 0 else None
        right = runs[k + 1] if k + 1 < len(runs) else None
        pick = max((r for r in (left, right) if r), key=lambda r: r[1] - r[0])
        if pick is left:
            left[1] = runs[k][1]
        else:
            right[0] = runs[k][0]
        del runs[k]
        merged = []
        for r in runs:  # Vecinos que quedaron con la misma etiqueta pasan a ser uno
            if merged and merged[-1][2] == r[2]:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        runs = merged
    out = labels.copy()
    for a, b, lab in runs:
        out[a:b] = lab
    return out


def truth(bars, window=DEFAULT_WINDOW, trend_share=TREND_SHARE, min_run=MIN_RUN):
    """
    Referencia a posteriori. Eficiencia centrada de cada vela: |cierre al final de la ventana − cierre al inicio| ÷
    suma de los movimientos de cierre a cierre dentro de ella. Es 1 si el precio fue derecho y cerca de 0 si fue y
    volvió. La parte de velas con mayor eficiencia (trend_share) es tendencia, con su signo; el resto, horizontal.
    Devuelve etiquetas (+1, −1 tendencia; 0 horizontal), la eficiencia y el umbral.
    """
    a = arrays(bars)
    c, n = a["c"], len(bars)
    half = max(2, window // 2)
    er = np.full(n, np.nan)
    move = np.full(n, 0.0)
    step = np.abs(np.diff(c, prepend=c[0]))
    path = np.cumsum(step)
    for i in range(half, n - half):
        lo, hi = i - half, i + half
        travelled = path[hi] - path[lo]
        if travelled > 0:
            er[i] = abs(c[hi] - c[lo]) / travelled
            move[i] = c[hi] - c[lo]
    valid = ~np.isnan(er)
    threshold = float(np.quantile(er[valid], 1 - trend_share)) if valid.any() else math.inf
    labels = np.zeros(n, dtype=int)
    hot = valid & (er >= threshold)
    labels[hot] = np.sign(move[hot]).astype(int)
    labels = _merge_short(labels, min_run)
    labels[~valid] = 0
    return {"labels": labels, "er": er, "threshold": threshold, "valid": valid}


def zones_of(labels, t, step_ms, keep=(0,)):
    """Tramos de la etiqueta pedida como zonas de tiempo: [inicio, fin)."""
    return [{"start": int(t[a]), "end": int(t[b - 1] + step_ms), "label": lab, "bars": b - a}
            for a, b, lab in _runs(np.asarray(labels)) if lab in keep]
