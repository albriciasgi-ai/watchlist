"""
Gaussian Channel como elemento del probador de reglas: el filtro gaussiano de varios polos de Ehlers con bandas de
rango verdadero filtrado (el indicador de DonovanWall en TradingView). Es la misma cuenta que tenía el Strategy
Builder de App 8 (`4.Analizador cripto/backend/strategy_engine.py`), con el cruce limpio del guion original.

La estrategia conocida: comprar cuando el canal sube y una vela cierra sobre la banda superior, y salir cuando una
vela cierra de vuelta bajo esa banda. Aquí también existe el espejo para cortos.

Todo se conoce al cerrar la vela: el filtro solo usa velas anteriores.
"""
import math

CODES = {"GC": "Gaussian Channel: cierra fuera de la banda con el canal a favor"}
EXITS = ("band", "mid", "none")  # Sale al cerrar de vuelta dentro de la banda, al otro lado de la línea central, o no sale por el canal
BINOMIAL = {1: {}, 2: {2: 1}, 3: {2: 3, 3: 1}, 4: {2: 6, 3: 4, 4: 1}, 5: {2: 10, 3: 10, 4: 5, 5: 1},
            6: {2: 15, 3: 20, 4: 15, 5: 6, 6: 1}, 7: {2: 21, 3: 35, 4: 35, 5: 21, 6: 7, 7: 1},
            8: {2: 28, 3: 56, 4: 70, 5: 56, 6: 28, 7: 8, 8: 1}, 9: {2: 36, 3: 84, 4: 126, 5: 126, 6: 84, 7: 36, 8: 9, 9: 1}}


def _filter(alpha, source, poles):
    """Filtro gaussiano de `poles` polos: cada valor sale del dato nuevo y de los `poles` valores anteriores del filtro."""
    n = len(source)
    x = 1.0 - alpha
    gain = alpha ** poles
    terms = [(k, (-1.0 if k % 2 == 0 else 1.0) * m * x ** k) for k, m in BINOMIAL[poles].items()]
    out = [0.0] * n
    if n:
        out[0] = source[0]
    for i in range(1, n):
        value = gain * source[i] + poles * x * out[i - 1]
        for k, weight in terms:
            value += weight * out[max(0, i - k)]  # Antes de la primera vela, el filtro vale el primer dato: sin salto al empezar
        out[i] = value
    return out


def channel(bars, period=144, poles=4, mult=1.414):
    """Línea central, banda superior y banda inferior, una por vela. Fuente: (máximo + mínimo + cierre) / 3."""
    n = len(bars)
    if n < 2:
        return [], [], []
    source = [(b["h"] + b["l"] + b["c"]) / 3.0 for b in bars]
    true_range = [bars[0]["h"] - bars[0]["l"]] + [max(bars[i]["h"] - bars[i]["l"], abs(bars[i]["h"] - bars[i - 1]["c"]),
                                                       abs(bars[i]["l"] - bars[i - 1]["c"])) for i in range(1, n)]
    beta = (1.0 - math.cos(2.0 * math.pi / period)) / (1.414 ** (2.0 / poles) - 1.0)
    alpha = -beta + math.sqrt(beta * beta + 2.0 * beta)
    mid = _filter(alpha, source, poles)
    width = _filter(alpha, true_range, poles)
    return mid, [mid[i] + width[i] * mult for i in range(n)], [mid[i] - width[i] * mult for i in range(n)]


def events(bars, tf, period=144, poles=4, mult=1.414, trend=True):
    """GC alcista: la vela cierra sobre la banda superior y la anterior no, con la línea central subiendo si se pide
    `trend`. GC bajista: el espejo en la banda inferior. Las primeras `2 × period` velas no cuentan: el filtro aún
    depende de dónde empezó."""
    mid, high, low = channel(bars, period, poles, mult)
    tf_ms = tf * 60000
    out = []
    for i in range(max(2, 2 * period), len(bars)):
        close, before = bars[i]["c"], bars[i - 1]["c"]
        rising, falling = mid[i] > mid[i - 1], mid[i] < mid[i - 1]
        info = {"mid": round(mid[i], 8), "high": round(high[i], 8), "low": round(low[i], 8)}
        if close > high[i] and before <= high[i - 1] and (rising or not trend):
            # La zona va de la línea central a la banda: el stop "borde lejano de la zona" queda en la línea central
            out.append({"code": "GC", "dir": 1, "t": bars[i]["t"], "known": bars[i]["t"] + tf_ms, "lo": mid[i], "hi": high[i], "info": info})
        elif close < low[i] and before >= low[i - 1] and (falling or not trend):
            out.append({"code": "GC", "dir": -1, "t": bars[i]["t"], "known": bars[i]["t"] + tf_ms, "lo": low[i], "hi": mid[i], "info": info})
    return out


def exits(bars, period=144, poles=4, mult=1.414, mode="band"):
    """Velas en que un trade abierto sale por el canal, por lado: {1: índices para los largos, -1: para los cortos}."""
    if mode not in ("band", "mid"):
        return None
    mid, high, low = channel(bars, period, poles, mult)
    up, down = (high, low) if mode == "band" else (mid, mid)
    return {1: {i for i in range(len(bars)) if bars[i]["c"] < up[i]}, -1: {i for i in range(len(bars)) if bars[i]["c"] > down[i]}}
