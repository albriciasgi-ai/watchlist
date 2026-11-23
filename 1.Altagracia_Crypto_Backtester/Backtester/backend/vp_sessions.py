"""
Perfil de volumen por sesión (VP Periodic) para el probador de reglas: POC, VAH y VAL de cada sesión ya
cerrada, con el volumen real del almacén de trades, y los elementos que salen de comparar el precio de una
sesión con el valor de la anterior.

El perfil sigue la regla de sessionProfile.js: `rows` franjas entre el mínimo y el máximo de la sesión, el POC
en la franja de más volumen y el área de valor creciendo desde el POC hacia la vecina mayor hasta juntar `share`.
Las sesiones van en UTC; la semana empieza el lunes. Una sesión solo se usa cuando ya cerró: nada mira el futuro.

Elementos, todos contra el valor de la sesión inmediatamente anterior:
- VR, regreso al valor (la "regla del 80%"): la sesión abre fuera del valor y después `accept` velas seguidas
  cierran dentro. Dirección: hacia el borde contrario. Una vez por sesión.
- VF, fallo fuera del valor: con el cierre anterior dentro del valor, una vela pasa el VAH o el VAL y en
  `fail_bars` velas o menos una vela cierra de vuelta dentro. Dirección: hacia el POC.
- VE, extremo del valor (para operar el rango tras un perfil equilibrado): la sesión abre dentro del valor
  anterior y el precio llega a un borde. En el VAL es alcista y en el VAH bajista. Dos formas (`ve_entry`):
  "touch", al cerrar la primera vela que toca cada borde en la sesión; "resting", al cerrar la sesión anterior,
  para dejar una orden limit esperando en cada borde durante toda la sesión siguiente. La zona va del borde al
  mínimo o máximo de la sesión anterior, que es donde queda el stop.
- Forma del perfil de la sesión anterior (`shape`), ver profile_shape: "B" con dos distribuciones separadas por
  un valle; si no, por las colas que quedan fuera del área de valor: "P" con la cola larga abajo, "b" con la cola
  larga arriba y "D" con las dos parecidas. La forma se conoce al cerrar la sesión. (La primera versión miraba
  solo en qué tercio del rango caía el POC, y marcaba como D perfiles con dos nodos o con una cola larga.)
- VX, aceptación fuera del valor: `accept` velas seguidas cierran fuera, del mismo lado. Dirección: la de la
  salida. Una vez por lado y sesión.
"""
import numpy as np

import footprint_store as fs

HOUR = 3600000
DAY_MS = 24 * HOUR
MONDAY_OFFSET = 4 * DAY_MS  # El 1 de enero de 1970 fue jueves
PERIODS = (4, 8, 12, 24, 168)
MIN_COVERAGE = 0.9          # Una sesión con menos minutos en el almacén no da niveles
SHAPES = ("D", "P", "b", "B")
SECOND_PEAK = 0.6          # B: el segundo pico tiene al menos esta parte del volumen del POC
SPLIT_GAP = 0.15           # ... está a esta parte del rango o más
VALLEY = 0.6               # ... y entre los dos el volumen baja a esta parte del pico menor, o menos
SMOOTH_ROWS = 3            # El perfil se suaviza antes de buscar picos: una franja suelta no es una distribución
TAIL_GAP = 0.2             # P o b: una cola fuera del valor es más larga que la otra en esta parte del rango
CODES = {"VR": "Regreso al valor de la sesión anterior", "VF": "Fallo fuera del valor de la sesión anterior",
         "VX": "Aceptación fuera del valor de la sesión anterior", "VE": "Extremo del valor de la sesión anterior"}


def session_start(t, hours):
    length = hours * HOUR
    anchor = MONDAY_OFFSET if hours == 168 else 0
    return (t - anchor) // length * length + anchor


def _value_area(levels, share):
    """Franja del POC y franjas extremas del área de valor, creciendo hacia la vecina mayor."""
    rows = len(levels)
    total = levels.sum()
    poc = int(np.argmax(levels))
    lo = hi = poc
    covered = levels[poc]
    while covered < total * share and (lo > 0 or hi < rows - 1):
        below = levels[lo - 1] if lo > 0 else -1.0
        above = levels[hi + 1] if hi < rows - 1 else -1.0
        if below > above:
            lo -= 1
            covered += below
        else:
            hi += 1
            covered += above
    return poc, lo, hi


def profile_levels(prices, volumes, rows=50, share=0.7):
    """POC, VAH y VAL (precio medio de su franja) de un perfil, y su forma; None sin rango o sin volumen."""
    if not len(prices):
        return None
    low, high = float(prices.min()), float(prices.max())
    if not high > low:
        return None
    # Sin el ruido de coma flotante: un precio justo en el borde de dos franjas caía en una u otra según el redondeo
    # (24.999… o 25.0); con la cuenta exacta va a la de arriba (O-07 del protocolo de pruebas, 22/11/2026)
    row = np.clip(np.floor(np.round((prices - low) / (high - low) * rows, 9)).astype(np.int64), 0, rows - 1)
    levels = np.bincount(row, weights=volumes, minlength=rows)
    if not levels.sum() > 0:
        return None
    poc, lo, hi = _value_area(levels, share)
    step = (high - low) / rows
    mid = lambda i: round(low + step * (i + 0.5), 8)
    return {"poc": mid(poc), "vah": mid(hi), "val": mid(lo), "high": high, "low": low,
            "shape": profile_shape(levels, share), "pocPos": round((poc + 0.5) / rows, 3)}


def profile_shape(levels, share=0.7):
    """
    Forma del perfil. "B": dos distribuciones separadas por un valle. Si no, según las colas que quedan fuera del
    área de valor: "P" con la cola larga abajo (el volumen quedó arriba), "b" con la cola larga arriba, y "D" con
    las dos colas parecidas (el volumen en el medio).
    """
    levels = np.asarray(levels, dtype=float)
    rows = len(levels)
    width = max(1, min(SMOOTH_ROWS, rows // 12))
    smooth = np.convolve(levels, np.ones(width) / width, "same")
    main = int(np.argmax(smooth))
    gap = max(2, int(round(SPLIT_GAP * rows)))
    peaks = [i for i in range(rows) if smooth[i] >= SECOND_PEAK * smooth[main] and abs(i - main) >= gap
             and smooth[i] >= smooth[max(0, i - 1)] and smooth[i] >= smooth[min(rows - 1, i + 1)]]
    for other in sorted(peaks, key=lambda i: -smooth[i]):
        a, b = sorted((main, other))
        if smooth[a:b + 1].min() <= VALLEY * smooth[other]:
            return "B"
    _, lo, hi = _value_area(levels, share)
    below, above = lo / rows, (rows - 1 - hi) / rows
    if below - above >= TAIL_GAP:
        return "P"
    if above - below >= TAIL_GAP:
        return "b"
    return "D"


def sessions(symbol, hours, start_ms, end_ms, rows=50, share=0.7):
    """Niveles de cada sesión completa que empieza en [start_ms, end_ms): {start: {poc, vah, val, high, low}}."""
    length = hours * HOUR
    out = {}
    start = session_start(start_ms, hours)
    while start < end_ms:
        parts = fs._parts(symbol, start // 60000, (start + length) // 60000)
        minutes = sum(int(stop - first) for _, first, stop, _, _ in parts)
        if parts and minutes >= MIN_COVERAGE * length / 60000:
            prices, volumes = [], []
            for data, _, _, cell_first, cell_stop in parts:
                ps, qs, ticks = (int(x) for x in data["info"])
                prices.append((data["cl"][cell_first:cell_stop] + 0.5) * ticks / ps)
                volumes.append((data["cb"][cell_first:cell_stop] + data["cs"][cell_first:cell_stop]) / qs)
            levels = profile_levels(np.concatenate(prices), np.concatenate(volumes), rows, share)
            if levels:
                out[start] = levels
        start += length
    return out


SHIFT_RANGE = (0.3, 1.0)   # Control: cada sesión se desplaza entre estas partes de su rango, arriba o abajo


def shifted(levels, seed):
    """
    Los mismos perfiles en precios donde no estuvo el volumen: los niveles de cada sesión (POC, VAH, VAL, máximo y
    mínimo) se mueven juntos, arriba o abajo al azar, entre SHIFT_RANGE de su rango. Conservan su forma y sus
    distancias, así una regla da lo mismo con ellos solo si el lugar del volumen no importa.
    """
    import random
    out = {}
    for start, lv in levels.items():
        rng = random.Random(f"{seed}:{start}")
        offset = rng.choice((-1, 1)) * rng.uniform(*SHIFT_RANGE) * (lv["high"] - lv["low"])
        out[start] = {**lv, **{k: round(lv[k] + offset, 8) for k in ("poc", "vah", "val", "high", "low")}}
    return out


def events(bars, tf, levels, hours, accept=2, fail_bars=3, ve_entry="touch"):
    """VR, VF, VX y VE de las velas, con la forma de los eventos de of_elements más `info` (los niveles usados)."""
    tf_ms = int(tf) * 60000
    length = hours * HOUR
    out = []
    current, prior, state = None, None, None
    for i, b in enumerate(bars):
        start = session_start(b["t"], hours)
        if start != current:
            current, prior = start, levels.get(start - length)
            if prior is not None and ve_entry == "resting" and i > 0 and session_start(bars[i - 1]["t"], hours) == start - length \
                    and prior["val"] <= bars[i - 1]["c"] <= prior["vah"]:
                # La sesión anterior cerró dentro de su valor: órdenes en los dos bordes para toda la sesión que empieza
                last = bars[i - 1]
                rest = {"poc": prior["poc"], "vah": prior["vah"], "val": prior["val"], "high": prior["high"], "low": prior["low"],
                        "session": start, "open": 0, "hours": hours, "shape": prior.get("shape"), "pocPos": prior.get("pocPos")}
                out.append({"code": "VE", "dir": 1, "t": last["t"], "known": last["t"] + tf_ms, "lo": prior["low"], "hi": prior["val"], "info": rest})
                out.append({"code": "VE", "dir": -1, "t": last["t"], "known": last["t"] + tf_ms, "lo": prior["vah"], "hi": prior["high"], "info": rest})
            if prior is not None:
                where = 1 if b["o"] > prior["vah"] else (-1 if b["o"] < prior["val"] else 0)
                state = {"open": where, "inside": 0, "outside": 0, "side": 0, "vr": where == 0, "vx": set(), "ve": set(),
                         "hi": b["h"], "lo": b["l"], "trip": None, "prev_in": where == 0}
        if prior is None:
            continue
        s = state
        vah, val, poc = prior["vah"], prior["val"], prior["poc"]
        s["hi"], s["lo"] = max(s["hi"], b["h"]), min(s["lo"], b["l"])
        close_in = val <= b["c"] <= vah
        side = 0 if close_in else (1 if b["c"] > vah else -1)
        info = {"poc": poc, "vah": vah, "val": val, "high": prior["high"], "low": prior["low"], "session": current, "open": s["open"], "hours": hours,
                "shape": prior.get("shape"), "pocPos": prior.get("pocPos")}

        def add(code, d, lo, hi, extra=None):
            out.append({"code": code, "dir": d, "t": b["t"], "known": b["t"] + tf_ms, "lo": lo, "hi": hi,
                        "info": {**info, **(extra or {})}})

        # VE: la sesión abrió dentro del valor y el precio toca un borde por primera vez
        if ve_entry == "touch" and s["open"] == 0:
            if b["l"] <= val and 1 not in s["ve"]:
                s["ve"].add(1)
                add("VE", 1, min(prior["low"], b["l"]), val, {"extreme": b["l"]})
            if b["h"] >= vah and -1 not in s["ve"]:
                s["ve"].add(-1)
                add("VE", -1, vah, max(prior["high"], b["h"]), {"extreme": b["h"]})

        # VF: salida desde dentro del valor que no se sostiene
        if s["trip"] is None and s["prev_in"]:
            if b["h"] > vah:
                s["trip"] = {"d": -1, "i": i, "ext": b["h"]}
            elif b["l"] < val:
                s["trip"] = {"d": 1, "i": i, "ext": b["l"]}
        if s["trip"] is not None:
            trip = s["trip"]
            trip["ext"] = max(trip["ext"], b["h"]) if trip["d"] < 0 else min(trip["ext"], b["l"])
            if close_in:
                edge = vah if trip["d"] < 0 else val
                add("VF", trip["d"], min(edge, trip["ext"]), max(edge, trip["ext"]), {"extreme": trip["ext"]})
                s["trip"] = None
            elif i - trip["i"] + 1 >= fail_bars:
                s["trip"] = None  # Se quedó fuera: ya no es un fallo

        # Cierres seguidos dentro o fuera
        s["inside"] = s["inside"] + 1 if close_in else 0
        s["outside"] = s["outside"] + 1 if side and side == s["side"] else (1 if side else 0)
        s["side"] = side

        # VR: abrió fuera y vuelve a sostenerse dentro
        if not s["vr"] and s["inside"] >= accept:
            s["vr"] = True
            d = -s["open"]
            extreme = s["hi"] if d < 0 else s["lo"]
            edge = vah if d < 0 else val
            add("VR", d, min(edge, extreme), max(edge, extreme), {"extreme": extreme})

        # VX: se sostiene fuera
        if side and s["outside"] >= accept and side not in s["vx"]:
            s["vx"].add(side)
            edge = vah if side > 0 else val
            add("VX", side, min(poc, edge), max(poc, edge))

        s["prev_in"] = close_in
    return out
