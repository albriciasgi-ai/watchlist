"""
Régimen del mercado en cada vela, para etiquetar cada trade (embudo de búsqueda, 23/11/2026).

No es un filtro ni decide nada: solo dice en qué condiciones cayó cada trade, para ver si una regla gana en todas o
en una sola. Dos etiquetas, las dos con velas de 4 horas ya cerradas (sin futuro):

- Tendencia: "subida" si el cierre está sobre la EMA 50 y la EMA subió más de 0.3 ATR en las últimas 10 velas;
  "bajada", el espejo; si no, "rango". Medido en BTC, ETH, SOL y TRX de 4 horas: sin mínimo, solo el 14% de las
  velas es rango; con 0.3 ATR, cerca de un tercio de cada una; con 1 ATR, el 78% es rango.
- Volatilidad: "alta" si el ATR 14 sobre el precio pasa de su mediana de las 180 velas anteriores (30 días); si no,
  "baja".

Las velas de la regla se unen en bloques de 4 horas (UTC); con velas de 4 horas o más se usan tal cual (en 1D, las
medidas son de velas diarias). Cada vela de la regla lee la última vela de 4 horas cerrada antes de que ella cierre:
lo que se sabía al conocerse una señal en esa vela.
"""
import numpy as np

BLOCK_MS = 4 * 3600 * 1000
EMA_BARS = 50
SLOPE_BARS = 10
SLOPE_ATR = 0.3
ATR_BARS = 14
VOL_LOOKBACK = 180
TRENDS = {1: "subida", -1: "bajada", 0: "rango"}
VOLS = {1: "alta", 0: "baja"}
UNKNOWN = "sin dato"
# Las seis combinaciones del filtro de mercado del probador, como "tendencia-volatilidad"
COMBOS = tuple(f"{trend}-{vol}" for trend in ("subida", "bajada", "rango") for vol in ("alta", "baja"))


def combo(label):
    """La combinación de una etiqueta (tendencia, volatilidad), o None si le falta algún dato."""
    trend, vol = label
    return None if UNKNOWN in (trend, vol) else f"{trend}-{vol}"


def allow_text(allow):
    """En palabras, lo que deja pasar un filtro de mercado: por lo que deja si deja poco, por lo que quita si quita poco."""
    allow = [c for c in COMBOS if c in set(allow)]
    out = [c for c in COMBOS if c not in set(allow)]
    said = lambda items: ", ".join(c.replace("-", " con volatilidad ") for c in items)
    return f"solo en {said(allow)}" if len(allow) <= len(out) else f"sin {said(out)}"


def _blocks(bars, tf):
    """Las velas unidas en bloques de 4 horas: (cierre de cada bloque en ms, máximo, mínimo, cierre). Con tf ≥ 4 h, las mismas."""
    step = tf * 60000
    if step >= BLOCK_MS:
        return (np.array([b["t"] + step for b in bars], dtype=np.int64), np.array([b["h"] for b in bars], dtype=float),
                np.array([b["l"] for b in bars], dtype=float), np.array([b["c"] for b in bars], dtype=float))
    ends, highs, lows, closes = [], [], [], []
    current = None
    for b in bars:
        block = b["t"] // BLOCK_MS
        if block != current:
            current = block
            ends.append((block + 1) * BLOCK_MS)
            highs.append(b["h"])
            lows.append(b["l"])
            closes.append(b["c"])
        else:
            highs[-1] = max(highs[-1], b["h"])
            lows[-1] = min(lows[-1], b["l"])
            closes[-1] = b["c"]
    return np.array(ends, dtype=np.int64), np.array(highs), np.array(lows), np.array(closes)


def _ema(values, period):
    out = np.empty(len(values))
    k = 2.0 / (period + 1)
    acc = values[0]
    for i, v in enumerate(values):
        acc = v if i == 0 else acc + k * (v - acc)
        out[i] = acc
    return out


def block_labels(highs, lows, closes):
    """Por bloque de 4 horas: tendencia (1, -1, 0) y volatilidad (1, 0), o -9 donde todavía no hay historia."""
    n = len(closes)
    trend = np.full(n, -9, dtype=np.int64)
    vol = np.full(n, -9, dtype=np.int64)
    if n == 0:
        return trend, vol
    ema = _ema(closes, EMA_BARS)
    prev = np.concatenate(([closes[0]], closes[:-1]))
    true_range = np.maximum(highs - lows, np.maximum(np.abs(highs - prev), np.abs(lows - prev)))
    atr = np.full(n, np.nan)
    for i in range(ATR_BARS - 1, n):
        atr[i] = true_range[i - ATR_BARS + 1:i + 1].mean()
    rel = atr / closes
    for i in range(n):
        if i >= EMA_BARS + SLOPE_BARS:
            # La EMA tiene que haberse movido al menos SLOPE_ATR veces el ATR: una EMA casi plana es un rango
            moved = ema[i] - ema[i - SLOPE_BARS]
            need = SLOPE_ATR * atr[i] if np.isfinite(atr[i]) else 0.0
            rising = moved > need
            falling = moved < -need
            trend[i] = 1 if closes[i] > ema[i] and rising else -1 if closes[i] < ema[i] and falling else 0
        if i >= ATR_BARS + VOL_LOOKBACK:
            vol[i] = 1 if rel[i] > np.median(rel[i - VOL_LOOKBACK:i]) else 0
    return trend, vol


def labels(bars, tf):
    """Por vela de la regla: (tendencia, volatilidad) como texto, con lo que se sabía al cerrar esa vela."""
    if not bars:
        return []
    ends, highs, lows, closes = _blocks(bars, tf)
    trend, vol = block_labels(highs, lows, closes)
    step = tf * 60000
    out = []
    for b in bars:
        # El último bloque que ya cerró cuando cierra esta vela
        i = int(np.searchsorted(ends, b["t"] + step, side="right")) - 1
        if i < 0 or trend[i] == -9:
            out.append((UNKNOWN, UNKNOWN))
        else:
            out.append((TRENDS[int(trend[i])], VOLS[int(vol[i])] if vol[i] != -9 else UNKNOWN))
    return out


def summarize(rows):
    """rows: (tendencia, volatilidad, R, R menos su control). Devuelve, por tendencia, por volatilidad y por las dos
    juntas, los trades, el R medio y la ventaja media; de más trades a menos."""
    groups = {"trend": {}, "vol": {}, "both": {}}
    for trend, vol, r, edge in rows:
        for name, key in (("trend", trend), ("vol", vol), ("both", f"{trend} · {vol}")):
            cell = groups[name].setdefault(key, [0, 0.0, 0.0])
            cell[0] += 1
            cell[1] += r
            cell[2] += edge
    return {name: sorted(({"label": key, "n": n, "avgR": round(total / n, 4), "edge": round(edge / n, 4)}
                          for key, (n, total, edge) in cells.items()), key=lambda row: -row["n"])
            for name, cells in groups.items()}
