"""
Elementos del probador hechos con las cajas de la eficiencia con caja (regime_detectors.er_box), sin futuro:

- BX, ruptura de caja: la vela que cierra fuera de una caja vigente y la termina, a favor de la ruptura. Se conoce
  al cierre de esa vela. La zona es la caja entera.
- BE, borde de caja: dentro de una caja vigente, la vela que llega al quinto (`share`) de arriba o de abajo, hacia
  el centro. Un evento por llegada; se rearma cuando el precio vuelve al tercio del centro. Filtros del estudio:
  la vela no puede ser grande (cuerpo ≤ `maxBody` ATR) y tiene que cerrar lejos del borde (en su vela, a
  `rejection` o más del extremo del borde). La zona va del borde a su quinto: el stop "borde lejano de la zona"
  queda detrás del borde, y el objetivo "centro" es el centro de la caja.

Una caja se sabe vigente en la vela i si se detectó antes y todavía no se rompió (la ruptura es la vela end + 1).
"""
import numpy as np

CODES = {"BX": "Ruptura de caja (rango de la pestaña Régimen)", "BE": "Borde de caja, hacia el centro"}


def _arrays(bars):
    return {"t": np.array([b["t"] for b in bars], dtype=np.int64),
            **{k: np.array([b[s] for b in bars], dtype=float) for k, s in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))}}


def events(bars, tf, bx=None, be=None):
    if not bars or (bx is None and be is None):
        return []
    import regime  # Aquí y no arriba: regime importa rule_tester, que importa este módulo
    import regime_detectors as rd
    a = _arrays(bars)
    atr = regime.atr(a["h"], a["l"], a["c"])
    zones = rd.er_box(a, **rd.PARAMS["er_box"]["params"])["zones"]
    step = tf * 60000
    o, h, l, c, t = a["o"], a["h"], a["l"], a["c"], a["t"]
    out = []
    for z in zones:
        height = z["high"] - z["low"]
        if height <= 0:
            continue
        mid = (z["low"] + z["high"]) / 2
        box = {"low": round(z["low"], 8), "high": round(z["high"], 8), "start": int(t[z["start"]]), "detected": int(t[z["detected"]])}
        if bx is not None:
            i = z["end"] + 1
            if i < len(c):
                side = 1 if c[i] > mid else -1
                if bx.get("maxHeight") is None or height / atr[i] <= bx["maxHeight"]:
                    out.append({"code": "BX", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": z["low"], "hi": z["high"],
                                "info": {**box, "heightAtr": round(float(height / atr[i]), 2), "bars": int(z["end"] - z["start"] + 1)}})
        if be is not None:
            share = be["share"]
            armed = {1: True, -1: True}
            for i in range(z["detected"] + 1, min(z["end"] + 1, len(c))):
                if abs(c[i] - mid) < height / 6:
                    armed = {1: True, -1: True}
                for side, hit in ((1, l[i] <= z["low"] + share * height), (-1, h[i] >= z["high"] - share * height)):
                    if not hit or not armed[side]:
                        continue
                    armed[side] = False
                    rng = max(h[i] - l[i], 1e-12)
                    close_at = (c[i] - l[i]) / rng if side > 0 else (h[i] - c[i]) / rng
                    if be["maxBody"] and abs(c[i] - o[i]) > be["maxBody"] * atr[i]:
                        continue
                    if close_at < be["rejection"]:
                        continue
                    lo, hi = (z["low"], z["low"] + share * height) if side > 0 else (z["high"] - share * height, z["high"])
                    out.append({"code": "BE", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": lo, "hi": hi,
                                "info": {**box, "closeAt": round(float(close_at), 2)}})
    return out
