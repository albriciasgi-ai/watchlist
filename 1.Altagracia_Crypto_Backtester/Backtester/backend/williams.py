"""
Indicadores de Bill Williams para el probador de reglas (20/11/2026): el mismo cálculo de
frontend/src/components/indicators/williams.js, operación por operación (prueba de paridad en tests/test_williams.py).
Si cambia una regla aquí, hay que cambiarla allá.

Elementos del probador (solo necesitan velas: valen en todas las monedas, en las acciones y en 1D):
- WD, 1.er sabio: barra divergente lejos de la boca, con angulación y el AO en contra. La zona es la vela: con la
  entrada "stop", la orden va en su máximo (largo) o su mínimo (corto), y el stop "extremo de la vela" en el otro.
- WA, 2.º sabio: la tercera barra seguida del mismo color del AO tras una del otro. La zona es la vela.
- WF, 3.er sabio: el fractal de su lado, desde la vela en que se sabe; la zona es su nivel. Solo los que el precio
  pasó estando del lado correcto de los dientes (que se saben en la apertura de esa vela: van desplazados). info.expiry
  son las velas hasta que el precio lo pasó: la orden stop espera hasta ahí.

Todo se sabe al cerrar la vela del evento (`known`). Nada mira el futuro.
"""
import math

NAN = float("nan")

CODES = {
    "WD": "Barra divergente (1.er sabio de Williams)",
    "WA": "AO, tres barras del mismo color (2.º sabio)",
    "WF": "Ruptura de fractal (3.er sabio)",
}

DEFAULTS = {
    "jawLen": 13, "jawShift": 8, "teethLen": 8, "teethShift": 5, "lipsLen": 5, "lipsShift": 3, "sleepAtr": 0.5,
    "fast": 5, "slow": 34, "signal": 5, "maxRight": 20,
    "lookback": 1, "angBars": 5, "minGapAtr": 0.0, "requireAo": True, "pendingBars": 5, "alligatorFilter": True,
}


def _finite(x):
    return x == x and x not in (math.inf, -math.inf)


def sma(values, n):
    """Media simple de n con suma corrida, desde el primer valor finito (como williams.js)."""
    length = len(values)
    out = [NAN] * length
    first = 0
    while first < length and not _finite(values[first]):
        first += 1
    total = 0.0
    for i in range(first, length):
        total += values[i]
        if i - first >= n:
            total -= values[i - n]
        if i - first >= n - 1:
            out[i] = total / n
    return out


def smma(values, n):
    """Media suavizada de Wilder: la primera es la media simple de n; después (anterior × (n − 1) + valor) ÷ n."""
    length = len(values)
    out = [NAN] * length
    if length < n:
        return out
    total = 0.0
    for i in range(n):
        total += values[i]
    previous = total / n
    out[n - 1] = previous
    for i in range(n, length):
        previous = (previous * (n - 1) + values[i]) / n
        out[i] = previous
    return out


def atr_of(h, l, c, n=14):
    """Rango verdadero promedio de Wilder desde la primera vela."""
    out = [0.0] * len(h)
    for i in range(len(h)):
        previous = c[i - 1] if i else c[0]
        tr = max(h[i] - l[i], abs(h[i] - previous), abs(l[i] - previous))
        out[i] = out[i - 1] + (tr - out[i - 1]) / n if i else tr
    return out


def shifted(raw, shift):
    out = [NAN] * len(raw)
    for i in range(shift, len(raw)):
        out[i] = raw[i - shift]
    return out


def directions(values):
    """1 si sube respecto de la anterior, −1 si baja; un empate conserva la dirección anterior; 0 sin dato."""
    out = [0] * len(values)
    for i in range(1, len(values)):
        a, b = values[i], values[i - 1]
        if not _finite(a) or not _finite(b):
            continue
        out[i] = 1 if a > b else (-1 if a < b else out[i - 1])
    return out


def fractals(h, l, max_right=20):
    """Fractales en el orden en que se saben: {dir, index, price, known}."""
    out, open_ = [], []
    for i in range(len(h)):
        for f in open_:
            if f["done"]:
                continue
            x = h[i] if f["dir"] > 0 else l[i]
            if (x > f["price"] if f["dir"] > 0 else x < f["price"]) or i - f["index"] > max_right:
                f["done"] = True
                continue
            if x < f["price"] if f["dir"] > 0 else x > f["price"]:
                f["lower"] += 1
                if f["lower"] == 2:
                    out.append({"dir": f["dir"], "index": f["index"], "price": f["price"], "known": i})
                    f["done"] = True
        open_ = [f for f in open_ if not f["done"]]
        if i >= 2:
            if h[i] > h[i - 1] and h[i] > h[i - 2]:
                open_.append({"dir": 1, "index": i, "price": h[i], "lower": 0, "done": False})
            if l[i] < l[i - 1] and l[i] < l[i - 2]:
                open_.append({"dir": -1, "index": i, "price": l[i], "lower": 0, "done": False})
    return out


def alligator_state(jaw, teeth, lips, atr, sleep_atr):
    out = [0] * len(jaw)
    for i in range(len(jaw)):
        J, T, L = jaw[i], teeth[i], lips[i]
        if not (_finite(J) and _finite(T) and _finite(L)):
            continue
        spread = max(J, T, L) - min(J, T, L)
        if spread < sleep_atr * atr[i]:
            continue
        if L > T > J:
            out[i] = 1
        elif L < T < J:
            out[i] = -1
    return out


def compute(h, l, c, cfg=None):
    """Las series de Williams de velas cerradas (listas). cfg: los parámetros de DEFAULTS que cambian."""
    cfg = {**DEFAULTS, **(cfg or {})}
    n = len(h)
    med = [(h[i] + l[i]) / 2 for i in range(n)]
    jaw_raw, teeth_raw, lips_raw = smma(med, cfg["jawLen"]), smma(med, cfg["teethLen"]), smma(med, cfg["lipsLen"])
    jaw, teeth, lips = shifted(jaw_raw, cfg["jawShift"]), shifted(teeth_raw, cfg["teethShift"]), shifted(lips_raw, cfg["lipsShift"])
    atr = atr_of(h, l, c, 14)
    fast, slow = sma(med, cfg["fast"]), sma(med, cfg["slow"])
    ao = [fast[i] - slow[i] if _finite(slow[i]) else NAN for i in range(n)]
    ao_dir = directions(ao)
    avg = sma(ao, cfg["signal"])
    ac = [ao[i] - avg[i] if _finite(avg[i]) else NAN for i in range(n)]
    ac_dir = directions(ac)
    zone = [NAN] * n
    for i in range(n):
        if ao_dir[i] and ac_dir[i]:
            zone[i] = 1 if ao_dir[i] == 1 and ac_dir[i] == 1 else (-1 if ao_dir[i] == -1 and ac_dir[i] == -1 else 0)
    return {"med": med, "close": list(c), "jaw": jaw, "teeth": teeth, "lips": lips, "atr": atr, "ao": ao, "aoDir": ao_dir, "ac": ac, "acDir": ac_dir,
            "zone": zone, "state": alligator_state(jaw, teeth, lips, atr, cfg["sleepAtr"]), "fractals": fractals(h, l, cfg["maxRight"])}


def wise_men(o, h, l, c, series, cfg=None):
    """Señales de los tres sabios sin resolver su entrada (eso lo hace el probador con la orden stop):
    {wise, dir, index, entry, stop} del 1.º y el 2.º, y {wise: 3, dir, index (vela en que se supo el fractal), entry,
    hit} del 3.º, solo si el precio lo pasó del lado correcto de los dientes."""
    cfg = {**DEFAULTS, **(cfg or {})}
    jaw, teeth, lips, atr, ao_dir = series["jaw"], series["teeth"], series["lips"], series["atr"], series["aoDir"]
    n = len(h)
    k, back = max(1, int(cfg["angBars"])), max(1, int(cfg["lookback"]))
    out = []
    for i in range(max(back, k), n):
        J, T, L = jaw[i], teeth[i], lips[i]
        if _finite(J) and _finite(T) and _finite(L) and _finite(jaw[i - k]):
            mid = (h[i] + l[i]) / 2
            lowest, highest = math.inf, -math.inf
            for j in range(1, back + 1):
                lowest, highest = min(lowest, l[i - j]), max(highest, h[i - j])
            if l[i] < lowest and c[i] > mid and h[i] < min(J, T, L):
                gap, before = J - h[i], jaw[i - k] - h[i - k]
                if gap > before and gap >= cfg["minGapAtr"] * atr[i] and (not cfg["requireAo"] or ao_dir[i] == -1):
                    out.append({"wise": 1, "dir": 1, "index": i, "entry": h[i], "stop": l[i]})
            elif h[i] > highest and c[i] < mid and l[i] > max(J, T, L):
                gap, before = l[i] - J, l[i - k] - jaw[i - k]
                if gap > before and gap >= cfg["minGapAtr"] * atr[i] and (not cfg["requireAo"] or ao_dir[i] == 1):
                    out.append({"wise": 1, "dir": -1, "index": i, "entry": l[i], "stop": h[i]})
        if i >= 3:
            s = ao_dir[i]
            if s != 0 and ao_dir[i - 1] == s and ao_dir[i - 2] == s and ao_dir[i - 3] == -s:
                out.append({"wise": 2, "dir": s, "index": i, "entry": h[i] if s > 0 else l[i], "stop": l[i] if s > 0 else h[i]})

    # El 3.º: el último fractal de cada lado espera hasta que el precio lo pasa o llega otro
    pending, f_list, f = {1: None, -1: None}, series["fractals"], 0
    for j in range(n):
        for side in (1, -1):
            p = pending[side]
            if p is None or not (h[j] > p["price"] if side > 0 else l[j] < p["price"]):
                continue
            T = teeth[j]
            valid = not cfg["alligatorFilter"] or (_finite(T) and (p["price"] > T if side > 0 else p["price"] < T))
            if valid:
                out.append({"wise": 3, "dir": side, "index": p["known"], "entry": p["price"], "hit": j, "fractal": p["index"]})
            pending[side] = None
        while f < len(f_list) and f_list[f]["known"] == j:
            pending[f_list[f]["dir"]] = f_list[f]
            f += 1
    out.sort(key=lambda s: (s["index"], s["wise"], -s["dir"]))
    return out


def events(bars, tf, cfg=None, codes=("WD", "WA", "WF")):
    """Eventos del probador: {code, dir, t, known, lo, hi, info} con la forma de los de of_elements."""
    tf_ms = int(tf) * 60000
    o, h, l, c = [b["o"] for b in bars], [b["h"] for b in bars], [b["l"] for b in bars], [b["c"] for b in bars]
    series = compute(h, l, c, cfg)
    code_of = {1: "WD", 2: "WA", 3: "WF"}
    out = []
    for s in wise_men(o, h, l, c, series, cfg):
        code = code_of[s["wise"]]
        if code not in codes:
            continue
        i = s["index"]
        t = bars[i]["t"]
        if s["wise"] == 3:
            info = {"wise": 3, "fractal": bars[s["fractal"]]["t"], "level": s["entry"], "expiry": s["hit"] - i}
            out.append({"code": code, "dir": s["dir"], "t": t, "known": t + tf_ms, "lo": s["entry"], "hi": s["entry"], "info": info})
        else:
            out.append({"code": code, "dir": s["dir"], "t": t, "known": t + tf_ms, "lo": l[i], "hi": h[i],
                        "info": {"wise": s["wise"], "entry": s["entry"], "stop": s["stop"]}})
    return out


def filter_ok(bw, series, k, side):
    """Filtros de Williams en la vela k a favor del trade. alligator: awake (despierto a su favor), side (el cierre del
    lado de los dientes) o sleeping (dormido). zone: la zona de la vela a favor (verde en un largo)."""
    mode = bw.get("alligator")
    if mode == "awake" and series["state"][k] != side:
        return False
    if mode == "sleeping" and series["state"][k] != 0:
        return False
    if mode == "side":
        teeth = series["teeth"][k]
        if not _finite(teeth) or (series["close"][k] - teeth) * side <= 0:
            return False
    if bw.get("zone") and series["zone"][k] != side:
        return False
    return True
