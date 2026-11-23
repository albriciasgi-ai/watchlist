"""
Cambio de carácter (CC) para el probador de reglas: una tendencia de swings crecientes (o decrecientes) y una
vela que cierra más allá de su último swing.

- La estructura se arma con velas de `struct_minutes`, que pueden ser mayores que las de la regla y empezar a
  `offset_minutes` de las 00:00 UTC (810 = 13:30, la apertura de Nueva York en horario de verano). Salen de unir
  las velas de la regla.
- Swing: el único extremo de `swing` velas a cada lado. Se conoce al cerrar la última de su derecha.
- Tendencia alcista: los últimos `legs` máximos y los últimos `legs` mínimos confirmados son crecientes.
  Bajista, al revés.
- CC bajista: en tendencia alcista, una vela cierra bajo el último mínimo de swing. Alcista: en tendencia
  bajista, una vela cierra sobre el último máximo. Cada swing dispara una sola vez.
- El evento se conoce al cerrar esa vela de estructura y cae en la vela de la regla que cierra a la misma hora.
  Su zona va del cierre de la ruptura al extremo de la tendencia: el stop "borde lejano de la zona" queda detrás
  de ese extremo. Nada mira el futuro.
"""

CODES = {"CC": "Cambio de carácter (ruptura del último swing de la tendencia)"}
STRUCT_TFS = (15, 30, 60, 240, 1440)


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


def events(bars, tf, struct_minutes=None, offset_minutes=0, swing=3, legs=2):
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
        hs, ls = [p for _, p in highs[-legs:]], [p for _, p in lows[-legs:]]
        up = all(a < b for a, b in zip(hs, hs[1:])) and all(a < b for a, b in zip(ls, ls[1:]))
        down = all(a > b for a, b in zip(hs, hs[1:])) and all(a > b for a, b in zip(ls, ls[1:]))
        base = {"structTf": struct_minutes, "swing": swing, "legs": legs, "breakT": bar["t"]}
        if up and C[i] < lows[-1][1] and ("L", lows[-1][0]) not in used:
            used.add(("L", lows[-1][0]))
            top = max(H[lows[-1][0]:i + 1])
            out.append({"code": "CC", "dir": -1, "t": last["t"], "known": last["t"] + tf_ms, "lo": C[i], "hi": top,
                        "info": {**base, "level": lows[-1][1], "levelT": big[lows[-1][0]]["t"], "extreme": top}})
        if down and C[i] > highs[-1][1] and ("H", highs[-1][0]) not in used:
            used.add(("H", highs[-1][0]))
            bottom = min(L[highs[-1][0]:i + 1])
            out.append({"code": "CC", "dir": 1, "t": last["t"], "known": last["t"] + tf_ms, "lo": bottom, "hi": C[i],
                        "info": {**base, "level": highs[-1][1], "levelT": big[highs[-1][0]]["t"], "extreme": bottom}})
    return out
