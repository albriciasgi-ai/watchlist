"""
Cambio de carácter (CC) para el probador de reglas: una tendencia de swings crecientes (o decrecientes) y una
vela que cierra más allá del swing que originó su último tramo.

- La estructura se arma con velas de `struct_minutes`, que pueden ser mayores que las de la regla y empezar a
  `offset_minutes` de las 00:00 UTC (810 = 13:30, la apertura de Nueva York en horario de verano). Salen de unir
  las velas de la regla.
- Swing: el único extremo de `swing` velas a cada lado. Se conoce al cerrar la última de su derecha.
- Tendencia alcista: los últimos `legs` máximos y los últimos `legs` mínimos confirmados son crecientes. Con `closes`
  (de fábrica desde el motor 7), un máximo más alto cuenta solo si alguna vela cerró sobre el máximo anterior: uno
  hecho solo con la mecha no sube la tendencia. Bajista, al revés (un mínimo más bajo, con un cierre bajo el anterior).
- CC bajista: en tendencia alcista, una vela cierra bajo el mínimo de swing que originó el último tramo al alza (el
  último mínimo anterior al último máximo: `ref` "origin", de fábrica desde el motor 7). Alcista: en tendencia bajista,
  una vela cierra sobre el máximo que originó la última caída. Con `ref` "last", el último swing, sea cual sea (la
  regla hasta el motor 6: un rebote chico después del último extremo también contaba). Cada swing dispara una vez.
- El evento se conoce al cerrar esa vela de estructura y cae en la vela de la regla que cierra a la misma hora.
  Su zona va del cierre de la ruptura al extremo de la tendencia (el mayor máximo, o el menor mínimo, desde el swing
  roto): el stop "borde lejano de la zona" queda detrás de ese extremo. Nada mira el futuro.

Motor 7 (23/11/2026): `ref` "origin" y `closes`, decididos por el usuario en la galería del protocolo de pruebas
(G1_RESPUESTAS.md, trades 17, 40 y 71). Hasta el motor 6 el extremo era el de desde el swing roto con `ref` "last",
que no siempre era el de la tendencia (F-20).
"""

CODES = {"CC": "Cambio de carácter (ruptura del swing que originó el último tramo)"}
STRUCT_TFS = (15, 30, 60, 240, 1440)
REFS = ("origin", "last")


def aggregate(bars, minutes, offset_minutes=0):
    """Velas de `minutes` que empiezan a `offset_minutes` de las 00:00 UTC, uniendo las de la regla. Con `last`: su última
    vela de origen; con `count`: cuántas tiene."""
    step, offset, out = minutes * 60000, offset_minutes * 60000, []
    for i, b in enumerate(bars):
        start = (b["t"] - offset) // step * step + offset
        if out and out[-1]["t"] == start:
            bar = out[-1]
            bar["h"], bar["l"], bar["c"], bar["last"] = max(bar["h"], b["h"]), min(bar["l"], b["l"]), b["c"], i
            bar["count"] += 1
        else:
            out.append({"t": start, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "last": i, "count": 1})
    return out


def events(bars, tf, struct_minutes=None, offset_minutes=0, swing=3, legs=2, ref="origin", closes=True):
    """Eventos CC de las velas de la regla, con la forma de los de of_elements más `info` (nivel roto y extremo)."""
    tf_ms = int(tf) * 60000
    struct_minutes = int(struct_minutes or tf)
    if struct_minutes < tf or struct_minutes % int(tf):
        struct_minutes = int(tf)
    big = aggregate(bars, struct_minutes, offset_minutes % struct_minutes)
    struct_ms = struct_minutes * 60000
    H, L, C = [b["h"] for b in big], [b["l"] for b in big], [b["c"] for b in big]
    highs, lows, used, out = [], [], set(), []   # (vela, precio) de los swings ya confirmados
    n = swing

    def trend(points, rising, beyond_close, i):
        """Los puntos van todos para arriba (o para abajo). Con `beyond_close`, cada nuevo extremo cuenta solo si alguna
        vela hasta la actual cerró más allá del anterior."""
        for (xa, a), (_, b) in zip(points, points[1:]):
            if not (a < b if rising else a > b):
                return False
            if beyond_close and not any((C[k] > a) if rising else (C[k] < a) for k in range(xa + 1, i + 1)):
                return False
        return True

    for i, bar in enumerate(big):
        j = i - n
        if j >= n:
            window_h, window_l = H[j - n:i + 1], L[j - n:i + 1]
            if H[j] == max(window_h) and window_h.count(H[j]) == 1:
                highs.append((j, H[j]))
            if L[j] == min(window_l) and window_l.count(L[j]) == 1:
                lows.append((j, L[j]))
        if len(highs) < legs or len(lows) < legs:
            continue
        # La vela de estructura debe estar completa: su última vela de origen cierra con ella y no le falta ninguna del medio
        # (F-17 del protocolo de pruebas, 22/11/2026: antes solo se miraba la última)
        last = bars[bar["last"]]
        if last["t"] + tf_ms != bar["t"] + struct_ms or bar["count"] < struct_ms // tf_ms:
            continue
        hs, ls = highs[-legs:], lows[-legs:]
        # Con `closes`, el máximo más alto de una tendencia alcista pide un cierre sobre el anterior; el mínimo más bajo de
        # una bajista, un cierre bajo el anterior. Los mínimos que suben y los máximos que bajan no lo piden
        up = trend(hs, True, closes, i) and trend(ls, True, False, i)
        down = trend(hs, False, False, i) and trend(ls, False, closes, i)
        base = {"structTf": struct_minutes, "swing": swing, "legs": legs, "breakT": bar["t"], "ref": ref}
        if up:
            level = lows[-1] if ref == "last" else next(((x, p) for x, p in reversed(lows) if x < highs[-1][0]), None)
            if level and C[i] < level[1] and ("L", level[0]) not in used:
                used.add(("L", level[0]))
                seg = H[level[0]:i + 1]
                top = max(seg)
                at = level[0] + seg.index(top)
                out.append({"code": "CC", "dir": -1, "t": last["t"], "known": last["t"] + tf_ms, "lo": C[i], "hi": top,
                            "info": {**base, "level": level[1], "levelT": big[level[0]]["t"], "extreme": top, "extremeT": big[at]["t"]}})
        if down:
            level = highs[-1] if ref == "last" else next(((x, p) for x, p in reversed(highs) if x < lows[-1][0]), None)
            if level and C[i] > level[1] and ("H", level[0]) not in used:
                used.add(("H", level[0]))
                seg = L[level[0]:i + 1]
                bottom = min(seg)
                at = level[0] + seg.index(bottom)
                out.append({"code": "CC", "dir": 1, "t": last["t"], "known": last["t"] + tf_ms, "lo": bottom, "hi": C[i],
                            "info": {**base, "level": level[1], "levelT": big[level[0]]["t"], "extreme": bottom, "extremeT": big[at]["t"]}})
    return out
