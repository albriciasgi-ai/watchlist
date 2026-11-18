"""
Volumen de Respuesta como elementos del probador de reglas: la flecha (vela con mucho volumen para su hora) y el
rombo (la respuesta iguala a la tendencia), con la regla de measures.py, que repite responseBalance.js.

Todo se conoce al cerrar la vela: el tramo, el volumen por hora y el balance solo miran hacia atrás.
"""
import numpy as np

import measures

CODES = {"RF": "Flecha de Volumen de Respuesta (vela con mucho volumen para su hora)",
         "RB": "Rombo de Volumen de Respuesta (la respuesta iguala a la tendencia)"}
ARROWS = ("with", "against", "any")   # La flecha va a favor del tramo, en contra, o cualquiera
ROMBOS = ("turn", "follow")           # El rombo se opera contra el tramo (giro) o a favor (sigue)


def events(bars, tf, leg=measures.LEG_ATR, spike=measures.AGGRESSION, arrow="with", rombo="turn"):
    """RF y RB de las velas. leg: ATR con que gira el tramo. spike: veces el volumen normal de su hora."""
    if len(bars) < 2:
        return []
    ts = np.array([b["t"] for b in bars], dtype=np.int64)
    o, h, l, c, v = (np.array([b[k] for b in bars], dtype=float) for k in ("o", "h", "l", "c", "vol"))
    atr = measures.atr(h, l, c)
    relative = measures.hour_volume(ts, v)
    direction, start, extreme = measures.zigzag(h, l, c, atr, leg)
    side = np.sign(c - o).astype(np.int8)
    signal = measures.equilibrium(measures.balance(side, relative, direction, start), direction, start)
    tf_ms = tf * 60000
    out = []
    for i in np.nonzero((relative >= spike) & (side != 0))[0]:
        d, along = int(side[i]), int(side[i]) == int(direction[i])
        if (arrow == "with" and not along) or (arrow == "against" and along):
            continue
        b = bars[i]
        out.append({"code": "RF", "dir": d, "t": b["t"], "known": b["t"] + tf_ms, "lo": b["l"], "hi": b["h"],
                    "info": {"times": round(float(relative[i]), 2), "leg": int(direction[i])}})
    for i in np.nonzero(signal)[0]:
        b, d = bars[i], int(direction[i])
        if rombo == "follow":
            lo, hi, way = b["l"], b["h"], d
        else:  # El giro: la zona va del cierre al extremo del tramo, para poner el stop detrás
            lo, hi, way = min(b["c"], float(extreme[i])), max(b["c"], float(extreme[i])), -d
        out.append({"code": "RB", "dir": way, "t": b["t"], "known": b["t"] + tf_ms, "lo": lo, "hi": hi,
                    "info": {"leg": d, "extreme": round(float(extreme[i]), 8)}})
    out.sort(key=lambda e: e["known"])
    return out
