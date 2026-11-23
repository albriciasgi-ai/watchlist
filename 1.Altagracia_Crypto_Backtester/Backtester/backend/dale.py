"""
Las zonas de Trader Dale con el primer regreso (21/11/2026), para el probador.

Las reglas y sus cifras quedaron fijadas antes de correrlas en docs/PLAN_ESTRATEGIAS_BYKO_DALE.md (paso 3). Sin futuro:
cada zona nace en la vela en que se conoce, y todo lo demás sale de velas cerradas.

La mecánica, común a todas:
- La zona se arma cuando, después de nacer, `away` velas completas (todo su rango) quedan del mismo lado de ella sin
  volver a tocarla: "el precio se aleja una o dos velas completas". El lado da la dirección: desde arriba, largo.
  Si en `armBars` velas no se arma, se descarta.
- El evento es la vela que la arma. El probador pone ahí la limit en el borde cercano (entrada "limit", "near"), que se
  llena en el primer regreso. Cada zona da a lo sumo un evento.
- El stop va entre `minDay` y `maxDay` del ATR diario (14 días, sin el día en curso), como pide Dale. Con el borde
  lejano más `buffer` ATR más lejos que `maxDay`, la zona no se opera; más cerca que `minDay`, el stop se aleja hasta ahí.
  La zona del evento ya trae ese stop: la regla usa el stop "borde lejano de la zona" sin margen.

Las zonas:
- DS: la franja de los desequilibrios apilados (ST) del almacén. DN: el POC alineado (AP). DG: la orden grande (GR).
  Solo las monedas con almacén de trades: salen de los elementos de la fase (span["events"]).
- DA: la caja de la pestaña Régimen (er_box) que termina con una ruptura. La zona es su POC (la franja de `rows` filas con
  más volumen y las vecinas seguidas con `share` o más). Antes de armarse, el precio tiene que llegar a `run` ATR del
  borde de la caja.
- DC: el tramo del zigzag de `leg` ATR, la primera vez que mide `minLeg` ATR y cada vez que crece otros `minLeg`. Su
  perfil en `rows` filas; el cluster es el pico más alto del `core` central, si tiene `bump` veces la mediana de las
  filas; la zona, esa fila y sus vecinas seguidas con `share` o más. Una franja ya tomada del mismo tramo no se repite.
- El volumen por precio de DA y DC se reparte parejo en el rango de cada vela: una aproximación, en todas las monedas.

Control (`control=True`): cada zona se mueve entre `shiftMin` y `shiftMax` ATR hacia arriba o hacia abajo, al azar pero
siempre igual (semilla por zona), con el mismo alto y la misma mecánica: dice si importa dónde estuvo el volumen.

DX, apilados desplazados (hipótesis del 22/11, fijada en el plan antes de correrla en las fases 2 y 3): es exactamente el
control de DS como regla, con su misma semilla. Su control son las mismas zonas ancladas en velas al azar: por cada franja,
una vela al azar del tramo (semilla por franja), una zona del mismo alto en ATR centrada en su cierre y movida igual. Dice
si importa el apilado o basta la mecánica.
"""
import zlib

import numpy as np

import measures

CODES = {"DS": "Apilados con regreso (Dale): la zona de los desequilibrios apilados, en el primer regreso",
         "DN": "Nodo doble con regreso (Dale): el mismo POC en dos velas, en el primer regreso",
         "DG": "Orden grande con regreso (Dale): la franja de la orden grande, en el primer regreso",
         "DA": "Acumulación con regreso (Dale): el POC de la caja tras la ruptura, en el primer regreso",
         "DC": "Cluster del tramo con regreso (Dale): el nodo de volumen del tramo, en el primer regreso",
         "DX": "Apilados desplazados con regreso (hipótesis del 22/11): la zona de los apilados movida de 1 a 3 ATR, en el primer regreso"}
STORE_CODES = ("DS", "DN", "DG", "DX")  # Salen del almacén de trades
SOURCE = {"DS": "ST", "DN": "AP", "DG": "GR", "DX": "ST"}
DAY_MS = 86400000

# Campo: (por defecto, mínimo, máximo, entero)
PARAMS = {"away": (2, 1, 20, True), "armBars": (200, 1, 2000, True), "minDay": (0.1, 0.0, 2.0, False),
          "maxDay": (0.2, 0.01, 5.0, False), "buffer": (0.1, 0.0, 5.0, False),
          "rows": (30, 5, 200, True), "share": (0.7, 0.1, 1.0, False), "run": (3.0, 0.0, 50.0, False),
          "leg": (3.0, 0.5, 20.0, False), "minLeg": (5.0, 1.0, 50.0, False), "core": (0.7, 0.1, 1.0, False),
          "bump": (1.5, 1.0, 20.0, False), "shiftMin": (1.0, 0.0, 20.0, False), "shiftMax": (3.0, 0.1, 30.0, False)}


def clean(raw):
    raw = raw or {}
    out = {}
    for field, (default, low, high, whole) in PARAMS.items():
        try:
            value = float(raw.get(field, default))
        except (TypeError, ValueError):
            value = default
        if value != value:
            value = default
        value = max(low, min(high, value))
        out[field] = int(round(value)) if whole else value
    out["maxDay"] = max(out["maxDay"], out["minDay"])
    out["shiftMax"] = max(out["shiftMax"], out["shiftMin"])
    return out


def day_atr(t, h, l, c, n=14):
    """ATR de `n` días de las velas unidas por día UTC, en cada vela: el de los días ya cerrados (NaN al principio)."""
    day = t // DAY_MS
    days, first = np.unique(day, return_index=True)
    last = np.r_[first[1:], len(t)] - 1
    dh = np.array([h[a:b + 1].max() for a, b in zip(first, last)])
    dl = np.array([l[a:b + 1].min() for a, b in zip(first, last)])
    dc = c[last]
    prev = np.r_[np.nan, dc[:-1]]
    tr = np.where(np.isfinite(prev), np.maximum(dh - dl, np.maximum(np.abs(dh - prev), np.abs(dl - prev))), dh - dl)
    atr = np.full(len(days), np.nan)
    for i in range(n - 1, len(days)):
        atr[i] = tr[i - n + 1:i + 1].mean()
    known = np.r_[np.nan, atr[:-1]]  # El de cada día se usa desde el día siguiente
    return known[np.searchsorted(days, day)]


def profile(h, l, v, i0, i1, rows):
    """Volumen por precio de las velas i0..i1, repartido parejo en el rango de cada vela. (bordes, volumen) o None."""
    lo, hi = float(l[i0:i1 + 1].min()), float(h[i0:i1 + 1].max())
    if not hi > lo:
        return None
    edges = np.linspace(lo, hi, rows + 1)
    vol = np.zeros(rows)
    scale = rows / (hi - lo)
    for k in range(i0, i1 + 1):
        a, b = (l[k] - lo) * scale, (h[k] - lo) * scale
        ia, ib = int(min(rows - 1, max(0, np.floor(a)))), int(min(rows - 1, max(0, np.floor(b))))
        if ib == ia or b - a <= 0:
            vol[ia] += v[k]
            continue
        cuts = np.clip(np.arange(ia, ib + 2, dtype=float), a, b)
        vol[ia:ib + 1] += v[k] * np.diff(cuts) / (b - a)
    return edges, vol


def _band(edges, vol, center, share):
    """La fila `center` y sus vecinas seguidas con `share` o más de su volumen: (bajo, alto)."""
    floor_ = vol[center] * share
    a = b = center
    while a > 0 and vol[a - 1] >= floor_:
        a -= 1
    while b < len(vol) - 1 and vol[b + 1] >= floor_:
        b += 1
    return float(edges[a]), float(edges[b + 1])


def _accumulation(t, o, h, l, c, v, atr, cfg):
    """DA: el POC de cada caja que termina con una ruptura. (vela en que se conoce, bajo, alto, info, condición extra)."""
    import regime_detectors as rd  # Aquí y no arriba: regime_detectors importa regime, que importa rule_tester
    a = {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}
    out = []
    for z in rd.er_box(a, **rd.PARAMS["er_box"]["params"])["zones"]:
        i = z["end"] + 1
        if i >= len(c):
            continue
        side = 1 if c[i] > z["high"] else -1 if c[i] < z["low"] else 0
        if not side:
            continue
        prof = profile(h, l, v, z["start"], z["end"], cfg["rows"])
        if prof is None:
            continue
        lo, hi = _band(*prof, int(np.argmax(prof[1])), cfg["share"])
        edge = z["high"] if side > 0 else z["low"]
        out.append((i, lo, hi, {"box": [round(float(z["low"]), 8), round(float(z["high"]), 8)], "boxStart": int(t[z["start"]])},
                    {"edge": edge, "side": side, "run": cfg["run"] * atr[i]}))
    return out


def _leg_cluster(t, h, l, c, v, atr, cfg):
    """
    DC: los clusters de volumen de cada tramo. El perfil del tramo se mira la primera vez que mide `minLeg` ATR y otra vez
    cada vez que crece otros `minLeg` ATR: las pausas de una tendencia larga aparecen después. El cluster es el pico más
    alto del perfil (una fila con tanto o más volumen que sus vecinas) dentro del `core` central, con `bump` veces la
    mediana de las filas: la ladera de la base del tramo no es un pico. Una franja que se cruza con otra del mismo tramo
    no se repite.
    """
    direction, start, extreme = measures.zigzag(h, l, c, atr, cfg["leg"])
    out, looked, taken = [], {}, {}
    for i in range(1, len(c)):
        s = int(start[i])
        if not atr[i] > 0:
            continue
        base = l[s] if direction[i] > 0 else h[s]
        size = abs(extreme[i] - base) / atr[i]
        step = int(size // cfg["minLeg"])
        if step < 1 or step <= looked.get(s, 0):
            continue
        looked[s] = step
        prof = profile(h, l, v, s, i, cfg["rows"])
        if prof is None:
            continue
        edges, vol = prof
        rows = len(vol)
        cut = int(round(rows * (1 - cfg["core"]) / 2))
        padded = np.r_[-1.0, vol, -1.0]
        peaks = [r for r in range(cut, rows - cut) if vol[r] >= padded[r] and vol[r] >= padded[r + 2]]
        if not peaks:
            continue
        center = max(peaks, key=lambda r: vol[r])
        if vol[center] < cfg["bump"] * float(np.median(vol)):
            continue
        lo, hi = _band(edges, vol, center, cfg["share"])
        if any(lo < b and a < hi for a, b in taken.get(s, [])):
            continue  # Ese cluster ya salió de este tramo
        taken.setdefault(s, []).append((lo, hi))
        out.append((i, lo, hi, {"leg": [int(t[s]), int(direction[i])], "legAtr": round(float(size), 2)}, None))
    return out


def _store_zones(code, span_events, index, step):
    """DS, DN y DG: las zonas de ST, AP y GR de los elementos de la fase."""
    out = []
    for e in span_events:
        if e["code"] != SOURCE[code]:
            continue
        i = index.get(e["known"] - step)
        if i is not None and e["hi"] >= e["lo"]:
            out.append((i, float(e["lo"]), float(e["hi"]), {"from": SOURCE[code], "fromDir": int(e["dir"])}, None))
    return out


def _arm(h, l, lo, hi, i, cfg, extra):
    """Primera vela en que la zona se arma: `away` velas completas de un lado sin volver a tocarla. (vela, lado) o None."""
    count = {1: 0, -1: 0}
    reached = extra is None
    for j in range(i + 1, min(len(h), i + 1 + cfg["armBars"])):
        if not reached:  # DA: el precio llegó a `run` ATR del borde de la caja, del lado de la ruptura
            reached = h[j] - extra["edge"] >= extra["run"] if extra["side"] > 0 else extra["edge"] - l[j] >= extra["run"]
        if l[j] > hi:
            count[1], count[-1] = count[1] + 1, 0
        elif h[j] < lo:
            count[-1], count[1] = count[-1] + 1, 0
        else:
            count = {1: 0, -1: 0}  # Tocó la zona antes de alejarse: vuelve a contar
        for side in (1, -1):
            if count[side] >= cfg["away"] and reached and (extra is None or side == extra["side"]):
                return j, side
    return None


def candidates(bars, tf, cfg, codes, span_events=(), control=False):
    """Los eventos de las zonas pedidas (con `control`, de las zonas desplazadas), en la vela en que se arman."""
    codes = set(codes) & set(CODES)
    if not bars or not codes:
        return []
    import regime  # Aquí y no arriba: regime importa rule_tester, que importa este módulo
    t = np.array([b["t"] for b in bars], dtype=np.int64)
    o, h, l, c, v = (np.array([b[k] for b in bars], dtype=float) for k in ("o", "h", "l", "c", "vol"))
    atr = regime.atr(h, l, c)
    dayatr = day_atr(t, h, l, c)
    step = tf * 60000
    index = {int(x): i for i, x in enumerate(t)}
    out = []
    for code in sorted(codes):
        if code in STORE_CODES:
            zones = _store_zones(code, span_events, index, step)
        elif code == "DA":
            zones = _accumulation(t, o, h, l, c, v, atr, cfg)
        else:
            zones = _leg_cluster(t, h, l, c, v, atr, cfg)
        for i, lo, hi, info, extra in zones:
            shift = 0.0
            if code == "DX" and control:
                # Control de DX: la misma zona anclada en una vela al azar del tramo, centrada en su cierre y movida igual
                rng = np.random.default_rng(zlib.crc32(f"DXa{int(t[i])}{lo:.8g}".encode()))
                k = int(rng.integers(0, len(c)))
                if not (atr[i] > 0 and atr[k] > 0):
                    continue
                half = (hi - lo) / atr[i] * atr[k] / 2
                shift = float(rng.choice((-1.0, 1.0)) * rng.uniform(cfg["shiftMin"], cfg["shiftMax"]) * atr[k])
                i, lo, hi = k, float(c[k] - half + shift), float(c[k] + half + shift)
                info = {**info, "anchor": True}
            elif control or code == "DX":
                # Las zonas desplazadas. DX usa la semilla del control de DS: es exactamente ese control
                rng = np.random.default_rng(zlib.crc32(f"{'DS' if code == 'DX' else code}{int(t[i])}{lo:.8g}".encode()))
                shift = float(rng.choice((-1.0, 1.0)) * rng.uniform(cfg["shiftMin"], cfg["shiftMax"]) * atr[i])
                lo, hi = lo + shift, hi + shift
                if extra is not None:
                    extra = {**extra, "edge": extra["edge"] + shift}
            armed = _arm(h, l, lo, hi, i, cfg, extra)
            if armed is None:
                continue
            j, side = armed
            if not (dayatr[j] > 0 and atr[j] > 0):
                continue
            entry = hi if side > 0 else lo
            stop = (lo - cfg["buffer"] * atr[j]) if side > 0 else (hi + cfg["buffer"] * atr[j])
            dist = abs(entry - stop)
            if dist > cfg["maxDay"] * dayatr[j]:
                continue  # El stop de la zona pasa del tope de Dale: no se opera
            dist = max(dist, cfg["minDay"] * dayatr[j])
            zlo, zhi = (entry - dist, entry) if side > 0 else (entry, entry + dist)
            out.append({"code": code, "dir": int(side), "t": int(t[j]), "known": int(t[j] + step), "lo": float(zlo), "hi": float(zhi),
                        "info": {**info, "zone": [round(lo, 8), round(hi, 8)], "born": int(t[i]), "armedAfter": int(j - i),
                                 "stopDay": round(float(dist / dayatr[j]), 3), "shiftAtr": round(shift / atr[i], 2) if shift else 0.0}})
    return out


def events(bars, tf, cfg, codes, span_events=(), control=False):
    return candidates(bars, tf, cfg, codes, span_events, control)
