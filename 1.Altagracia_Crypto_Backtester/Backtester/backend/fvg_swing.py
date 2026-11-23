"""
Elementos del probador hechos con velas, sin futuro:

- IM, impulso: el cierre avanzó al menos `atr` ATR en las últimas `bars` velas (contra el cierre de `bars` velas antes),
  hacia donde va. Un evento al empezar el impulso: la vela anterior no lo cumplía. Con `range`, además la vela de la
  señal mide al menos `range` ATR de alto. La zona va del mínimo al máximo del impulso.

- FV, FVG nuevo: la vela i deja un hueco con la vela i-2 (su mínimo sobre el máximo de i-2 es alcista; su máximo bajo
  el mínimo de i-2, bajista), de al menos `minAtr` ATR. La regla del indicador FVG de App 1. Se conoce al cierre de i.
  La zona es el hueco: con entrada limit en la zona, el trade espera que el precio vuelva a él; el stop "borde lejano
  de la zona" queda al otro lado del hueco.
- SP, swing del detector: un mínimo (alcista) o máximo (bajista) que es el único extremo de `bars` velas a cada lado,
  como el indicador Swing de App 1, con volumen de su vela de al menos `minZ` (z-score contra las 20 anteriores; None
  = sin filtro). Se conoce al cerrar la última vela de su derecha. La zona es la vela del swing: el stop "extremo de la
  vela del elemento" queda detrás del swing.
"""
import numpy as np

CODES = {"FV": "FVG nuevo (hueco entre la vela y dos antes)", "SP": "Swing del detector (mínimo o máximo confirmado)",
         "IM": "Impulso (el precio avanza varios ATR en pocas velas)"}
Z_BARS = 20


def _arrays(bars):
    return {k: np.array([b[s] for b in bars], dtype=float) for k, s in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))}


def _atr(h, l, c, n=14):
    prev = np.r_[c[0], c[:-1]]
    tr = np.maximum.reduce([h - l, np.abs(h - prev), np.abs(l - prev)])
    out = np.empty(len(tr))
    out[0] = tr[0]
    for i in range(1, len(tr)):
        out[i] = out[i - 1] + (tr[i] - out[i - 1]) / n
    return out


def _vol_z(v, i):
    if i < Z_BARS:
        return None
    w = v[i - Z_BARS:i]
    sd = w.std()
    return float((v[i] - w.mean()) / sd) if sd > 0 else 0.0


def events(bars, tf, fv=None, sp=None, im=None):
    if not bars or (fv is None and sp is None and im is None):
        return []
    a = _arrays(bars)
    h, l, c, v = a["h"], a["l"], a["c"], a["v"]
    t = np.array([b["t"] for b in bars], dtype=np.int64)
    step = tf * 60000
    atr = _atr(h, l, c)
    out = []
    if fv is not None:
        for i in range(2, len(c)):
            for side, lo, hi in ((1, h[i - 2], l[i]), (-1, h[i], l[i - 2])):
                gap = hi - lo
                if gap > 0 and gap >= fv["minAtr"] * atr[i]:
                    # first: la primera de las tres velas del patrón, para el stop "extremo de la vela del elemento" (H16 del
                    # protocolo de pruebas, 22/11/2026: antes era solo la tercera, la que da a conocer el hueco)
                    out.append({"code": "FV", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": float(lo), "hi": float(hi),
                                "first": int(t[i - 2]), "info": {"gapAtr": round(float(gap / atr[i]), 2)}})
    if im is not None:
        n, need = im["bars"], im["atr"]
        moved = np.full(len(c), 0.0)
        moved[n:] = (c[n:] - c[:-n]) / np.where(atr[n:] > 0, atr[n:], np.inf)
        for i in range(n + 1, len(c)):
            for side in (1, -1):
                if moved[i] * side < need or moved[i - 1] * side >= need:
                    continue
                if im.get("range") is not None and (h[i] - l[i]) < im["range"] * atr[i]:
                    continue
                out.append({"code": "IM", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": float(l[i - n + 1:i + 1].min()),
                            "hi": float(h[i - n + 1:i + 1].max()), "info": {"movedAtr": round(float(moved[i] * side), 2)}})
    if sp is not None:
        n = sp["bars"]
        for p in range(n, len(c) - n):
            for side, vals in ((1, l), (-1, h)):
                w = vals[p - n:p + n + 1]
                ext = w.min() if side > 0 else w.max()
                if vals[p] != ext or np.count_nonzero(w == ext) != 1:
                    continue
                z = _vol_z(v, p)
                if sp.get("minZ") is not None and (z is None or z < sp["minZ"]):
                    continue
                known = p + n
                out.append({"code": "SP", "dir": side, "t": int(t[p]), "known": int(t[known] + step), "lo": float(l[p]), "hi": float(h[p]),
                            "info": {"price": float(vals[p]), "z": None if z is None else round(z, 2)}})
    return out
