"""
Tabla de medidas del mercado: una fila por cada vela de 15 minutos cerrada, con lo que se conocia al
cierre de esa vela en 15 minutos, 1 hora y 4 horas.

Sale siempre del mismo calculo, sin importar que indicadores haya en pantalla. Por eso sirve para leer
un trade, para leer momentos sin entrada y para probar reglas en todo el historico. Una fila solo usa
velas anteriores a su cierre: agregar velas nunca cambia las filas ya calculadas.

Las distancias van en ATR y el volumen contra lo normal de su hora, para que dos fechas sean comparables.

Se construye en un proceso aparte: python -B measures.py build BTCUSDT
"""
import datetime as dt
import gzip
import json
import math
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np

import footprint_store
import oi_store

VERSION = 1
MINUTE = 60000
DAY = 86400000
FRAMES = (("15m", 15), ("1h", 60), ("4h", 240))
CONTEXT_BARS = {15: 48, 60: 48, 240: 30}  # Las mismas ventanas de contexto del observador en 1h y 4h

# Volumen de Respuesta: repite indicators/responseBalance.js y research/response_volume/engine.py
LEG_ATR = 2.0
RESPONSE_WINDOW = 10
RESPONSE_TOP = 5
DOMINANCE = 2.0
BALANCE = 1.0
HOUR_DAYS = 30
HOUR_MIN_DAYS = 5
AGGRESSION = 2.0
MAX_BALANCE = 10.0
MIN_BALANCE = 0.1

ATR_LENGTH = 14
VOLATILITY_BARS = 100
AGGRESSION_BARS = 10
PEAK_BARS = 5
PROFILE_ROWS = 50
VALUE_AREA = 0.7
FVG_MIN_PCT = 0.03  # Las mismas reglas de FVGIndicator
FVG_MAX_AGE = 300
FVG_FRAMES = ("15m", "1h")
OI_DELAY_MINUTES = 5  # Cada dato se usa 5 minutos despues de su marca
OI_MAX_AGE_MINUTES = 30
FLOW_MIN_MINUTES = 13  # Una vela de 15 minutos con menos minutos negociados no tiene delta confiable
DELTA_BARS = 16


def _frame_measures(tag, name):
    return [
        (f"ctx_{tag}", f"Dirección del precio {name}", "Contexto", 1),
        (f"vol_bias_{tag}", f"Volumen a favor {name}", "Contexto", 1),
        (f"leg_{tag}", f"Tramo a favor {name}", "Tramo", 1),
        (f"leg_age_{tag}", f"Edad del tramo {name} (velas)", "Tramo", 0),
        (f"leg_size_{tag}", f"Tamaño del tramo {name} (ATR)", "Tramo", 0),
        (f"ext_dist_{tag}", f"Distancia al extremo del tramo {name} (ATR)", "Tramo", 0),
        (f"vol_rel_{tag}", f"Volumen de la última vela {name} (veces lo normal)", "Volumen", 0),
        (f"vol_peak_{tag}", f"Mayor volumen de las últimas 5 velas {name} (veces lo normal)", "Volumen", 0),
        (f"aggr_{tag}", f"Velas de agresión a favor {name} (últimas 10)", "Volumen", 1),
        (f"pressure_{tag}", f"Presión del Volumen de Respuesta a favor {name}", "Volumen de Respuesta", 1),
        (f"balance_{tag}", f"Tendencia contra respuesta {name}", "Volumen de Respuesta", 0),
        (f"since_signal_{tag}", f"Velas desde el último equilibrio {name}", "Volumen de Respuesta", 0),
        (f"atr_pct_{tag}", f"ATR {name} (% del precio)", "Volatilidad", 0),
        (f"atr_rel_{tag}", f"ATR {name} contra sus últimas 100 velas", "Volatilidad", 0),
    ]


def _gap_measures(tag, name):
    return [
        (f"fvg_behind_{tag}", f"FVG detrás de la entrada {name} (ATR)", "FVG", ("fvg_below_dist_" + tag, "fvg_above_dist_" + tag)),
        (f"fvg_behind_size_{tag}", f"Tamaño del FVG detrás {name} (ATR)", "FVG", ("fvg_below_size_" + tag, "fvg_above_size_" + tag)),
        (f"fvg_ahead_{tag}", f"FVG delante de la entrada {name} (ATR)", "FVG", ("fvg_above_dist_" + tag, "fvg_below_dist_" + tag)),
    ]


# Clave, etiqueta, grupo y como se lee en cortos: 1 cambia de signo, 0 queda igual, un par elige columna
MEASURES = [item for tag, name in (("15m", "15m"), ("1h", "1h"), ("4h", "4h")) for item in _frame_measures(tag, name)]
MEASURES += [item for tag in FVG_FRAMES for item in _gap_measures(tag, tag)]
MEASURES += [
    ("poc_dist", "Distancia al POC del día anterior (ATR)", "Perfil", 1),
    ("value_pos", "Posición en el valor del día anterior (0 VAL a favor, 1 VAH)", "Perfil", "mirror"),
    ("vwap_dist", "Distancia al VWAP del día (ATR)", "Perfil", 1),
    ("oi_chg_1h", "OI cambio en 1 hora (%)", "Open Interest", 0),
    ("oi_chg_4h", "OI cambio en 4 horas (%)", "Open Interest", 0),
    ("oi_chg_24h", "OI cambio en 24 horas (%)", "Open Interest", 0),
    ("oi_rises", "OI bloques de 1 hora en alza (de 3)", "Open Interest", 0),
    ("delta_15m", "Delta real a favor en la última vela de 15m", "Order flow", 1),
    ("delta_4h", "Delta real a favor en las últimas 4 horas", "Order flow", 1),
    ("hour", "Hora UTC", "Momento", 0),  # Cripto opera 24/7: no se mide sesión del mercado, solo la hora
]

_LOCK = threading.Lock()
_tables = {}
_builds = {}


def table_dir():
    return Path(os.environ.get("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\observer")) / "measures"


def _cache_path(symbol):
    return Path("backtesting_cache") / f"{symbol}_backtesting_data.json.gz"


# ==================== CALCULO ====================

def atr(high, low, close, length=ATR_LENGTH):
    previous = np.r_[close[0], close[:-1]]
    true_range = np.maximum.reduce([high - low, np.abs(high - previous), np.abs(low - previous)])
    total = np.r_[0.0, np.cumsum(true_range)]
    index = np.arange(len(close))
    first = np.maximum(0, index + 1 - length)
    return (total[index + 1] - total[first]) / (index + 1 - first)


def zigzag(high, low, close, atr_values, k):
    """Tramo conocido al cierre de cada vela: direccion, inicio y extremo."""
    n = len(close)
    direction = np.zeros(n, dtype=np.int8)
    start = np.zeros(n, dtype=np.int64)
    extreme = np.zeros(n)
    now_dir, now_start, now_extreme, extreme_at = 1, 0, high[0], 0

    for i in range(n):
        if now_dir == 1:
            if high[i] >= now_extreme:
                now_extreme, extreme_at = high[i], i
            elif close[i] <= now_extreme - k * atr_values[i]:
                now_dir, now_start = -1, extreme_at
                segment = low[extreme_at:i + 1]
                now_extreme = float(segment.min())
                extreme_at = extreme_at + int(segment.argmin())
        else:
            if low[i] <= now_extreme:
                now_extreme, extreme_at = low[i], i
            elif close[i] >= now_extreme + k * atr_values[i]:
                now_dir, now_start = 1, extreme_at
                segment = high[extreme_at:i + 1]
                now_extreme = float(segment.max())
                extreme_at = extreme_at + int(segment.argmax())
        direction[i], start[i], extreme[i] = now_dir, now_start, now_extreme
    return direction, start, extreme


def hour_volume(ts, volume, days=HOUR_DAYS):
    """Volumen de cada vela dividido por la mediana de esa misma hora en los dias anteriores."""
    step = int(np.median(np.diff(ts))) if len(ts) > 1 else 1
    slot = (ts % DAY) // step
    result = np.ones(len(volume))
    for value in np.unique(slot):
        index = np.nonzero(slot == value)[0]
        series = volume[index]
        for position in range(HOUR_MIN_DAYS, len(index)):
            usual = np.median(series[max(0, position - days):position])
            if usual > 0:
                result[index[position]] = series[position] / usual
    return result


def balance(side, weight, direction, start):
    """Promedio de las velas principales de la tendencia contra las de la respuesta."""
    n = len(side)
    result = np.empty(n)
    for i in range(n):
        d = direction[i]
        trend, response = [], []
        for j in range(max(start[i], i - RESPONSE_WINDOW + 1), i + 1):
            if side[j] == d:
                trend.append(weight[j])
            elif side[j] == -d:
                response.append(weight[j])
        if not response:
            result[i] = MAX_BALANCE if trend else 1.0
        elif not trend:
            result[i] = MIN_BALANCE
        else:
            trend.sort(reverse=True)
            response.sort(reverse=True)
            strength = sum(trend[:RESPONSE_TOP]) / min(RESPONSE_TOP, len(trend))
            answer = sum(response[:RESPONSE_TOP]) / min(RESPONSE_TOP, len(response))
            result[i] = min(MAX_BALANCE, max(MIN_BALANCE, strength / answer)) if answer > 0 else MAX_BALANCE
    return result


def equilibrium(values, direction, start):
    """Velas donde la respuesta iguala a la tendencia despues de que esta domino."""
    found = np.zeros(len(values), dtype=bool)
    armed = False
    leg = -1
    for i, value in enumerate(values):
        if start[i] != leg or (i > 0 and direction[i] != direction[i - 1]):
            leg = start[i]
            armed = False
        if value >= DOMINANCE:
            armed = True
        elif armed and value <= BALANCE:
            found[i] = True
            armed = False
    return found


def rolling_median(values, length=VOLATILITY_BARS):
    result = np.full(len(values), np.nan)
    for i in range(length, len(values)):
        result[i] = np.median(values[i - length:i])
    return result


def rolling_sum(values, length):
    total = np.r_[0.0, np.cumsum(values)]
    index = np.arange(len(values))
    return total[index + 1] - total[np.maximum(0, index + 1 - length)]


def rolling_max(values, length):
    result = values.copy()
    for shift in range(1, length):
        result[shift:] = np.maximum(result[shift:], values[:-shift])
    return result


def efficiency(close, bars):
    """Que parte del recorrido fue en linea recta, con signo. Sin suficientes velas no hay lectura."""
    n = len(close)
    result = np.full(n, np.nan)
    if n <= bars:
        return result
    total = np.r_[0.0, np.cumsum(np.abs(np.diff(close, prepend=close[0])))]
    index = np.arange(bars, n)
    path = total[index + 1] - total[index - bars + 1]
    net = close[index] - close[index - bars]
    result[index] = np.divide(net, path, out=np.zeros(len(index)), where=path > 0)
    return result


def volume_bias(open_, close, volume, bars):
    """Volumen de velas alcistas contra el total, de -1 a 1."""
    total = rolling_sum(volume, bars)
    bullish = rolling_sum(np.where(close > open_, volume, 0.0), bars)
    result = np.divide(2 * bullish, total, out=np.ones(len(close)), where=total > 0) - 1
    result[:bars - 1] = np.nan
    return result


def frame_columns(frame, minutes):
    """Medidas de un marco, conocidas al cierre de cada una de sus velas."""
    ts, open_, high, low, close, volume = (frame[key] for key in ("ts", "open", "high", "low", "close", "volume"))
    n = len(close)
    index = np.arange(n)
    atr_values = atr(high, low, close)
    direction, start, extreme = zigzag(high, low, close, atr_values, LEG_ATR)
    side = np.sign(close - open_).astype(np.int8)
    relative = hour_volume(ts, volume)
    values = balance(side, relative, direction, start)
    signal = equilibrium(values, direction, start)
    bars = CONTEXT_BARS[minutes]

    pivot = np.where(direction > 0, low[start], high[start])
    last_signal = np.maximum.accumulate(np.where(signal, index, -1))
    safe_atr = np.where(atr_values > 0, atr_values, np.nan)
    aggressive = np.where(relative >= AGGRESSION, side.astype(float), 0.0)

    return {
        "atr": atr_values,
        "ctx": efficiency(close, bars),
        "vol_bias": volume_bias(open_, close, volume, bars),
        "leg": direction.astype(float),
        "leg_age": (index - start).astype(float),
        "leg_size": np.abs(extreme - pivot) / safe_atr,
        "ext_dist": direction * (extreme - close) / safe_atr,
        "vol_rel": relative,
        "vol_peak": rolling_max(relative, PEAK_BARS),
        "aggr": rolling_sum(aggressive, AGGRESSION_BARS),
        "pressure": direction * np.log2(values),
        "balance": values,
        "since_signal": np.where(last_signal >= 0, index - last_signal, np.nan).astype(float),
        "atr_pct": atr_values / close * 100,
        "atr_rel": atr_values / rolling_median(atr_values),
    }


def day_profile(high, low, volume):
    """POC, VAH y VAL de un grupo de velas, igual que buildProfile en sessionProfile.js."""
    lowest, highest = float(low.min()), float(high.max())
    if not highest > lowest:
        return None
    step = (highest - lowest) / PROFILE_ROWS
    edges = lowest + step * np.arange(PROFILE_ROWS + 1)
    size = high - low
    overlap = np.minimum(high[:, None], edges[None, 1:]) - np.maximum(low[:, None], edges[None, :-1])
    levels = (np.maximum(overlap, 0) * np.divide(volume, size, out=np.zeros(len(size)), where=size > 0)[:, None]).sum(axis=0)
    for row in np.nonzero(size <= 0)[0]:
        levels[min(PROFILE_ROWS - 1, int((low[row] - lowest) / step))] += volume[row]

    poc = int(np.argmax(levels))
    bottom = top = poc
    covered = levels[poc]
    target = levels.sum() * VALUE_AREA
    while covered < target and (bottom > 0 or top < PROFILE_ROWS - 1):
        below = levels[bottom - 1] if bottom > 0 else -1
        above = levels[top + 1] if top < PROFILE_ROWS - 1 else -1
        if below > above:
            bottom -= 1
            covered += below
        else:
            top += 1
            covered += above
    middle = lowest + step * (np.arange(PROFILE_ROWS) + 0.5)
    return float(middle[poc]), float(middle[top]), float(middle[bottom])


def profile_columns(frame, close_time):
    """Valor del dia anterior, que ya cerro, y VWAP del dia en curso."""
    ts, high, low, close, volume = (frame[key] for key in ("ts", "high", "low", "close", "volume"))
    day = ts // DAY
    n = len(close)
    poc, vah, val = (np.full(n, np.nan) for _ in range(3))
    vwap = np.empty(n)

    first = np.r_[0, np.nonzero(np.diff(day))[0] + 1]
    last = np.r_[first[1:], n]
    previous = None
    for begin, end in zip(first, last):
        if previous is not None and day[begin] - previous[0] == 1 and previous[1]:
            poc[begin:end], vah[begin:end], val[begin:end] = previous[1]
        previous = (day[begin], day_profile(high[begin:end], low[begin:end], volume[begin:end]))

        typical = (high[begin:end] + low[begin:end] + close[begin:end]) / 3
        amount = np.cumsum(volume[begin:end])
        vwap[begin:end] = np.divide(np.cumsum(typical * volume[begin:end]), amount, out=typical.copy(), where=amount > 0)
    return poc, vah, val, vwap


def gap_columns(frame, atr_values):
    """FVG abiertos al cierre de cada vela: distancia y tamaño del mas cercano de cada lado."""
    high, low, close = frame["high"], frame["low"], frame["close"]
    n = len(close)
    columns = {key: np.full(n, np.nan) for key in ("below_dist", "below_size", "above_dist", "above_size")}
    margin = FVG_MIN_PCT / 100
    gaps = []

    for i in range(n):
        alive = []
        for gap in gaps:
            if gap[2]:
                gap[1] = min(gap[1], low[i])
            else:
                gap[0] = max(gap[0], high[i])
            if gap[1] > gap[0] and i - gap[3] <= FVG_MAX_AGE:
                alive.append(gap)
        gaps = alive

        if i >= 2:
            if low[i] > high[i - 2] * (1 + margin):
                gaps.append([high[i - 2], low[i], True, i])
            elif high[i] < low[i - 2] * (1 - margin):
                gaps.append([high[i], low[i - 2], False, i])

        scale = atr_values[i]
        if not gaps or scale <= 0:
            continue
        price = close[i]
        below = above = None
        for bottom, top, bullish, _ in gaps:
            size = top - bottom
            if top <= price or (bottom < price and bullish):
                distance = max(0.0, price - top)
                if below is None or distance < below[0]:
                    below = (distance, size)
            else:
                distance = max(0.0, bottom - price)
                if above is None or distance < above[0]:
                    above = (distance, size)
        if below:
            columns["below_dist"][i], columns["below_size"][i] = below[0] / scale, below[1] / scale
        if above:
            columns["above_dist"][i], columns["above_size"][i] = above[0] / scale, above[1] / scale
    return columns


def oi_columns(symbol, close_minutes):
    """Cambio del OI usando cada dato cuando ya estaba publicado."""
    n = len(close_minutes)
    empty = {key: np.full(n, np.nan) for key in ("oi_chg_1h", "oi_chg_4h", "oi_chg_24h", "oi_rises")}
    series = oi_store.points(symbol)
    if series is None:
        return empty
    times, values = series
    published = times + OI_DELAY_MINUTES

    def seen(minutes):
        return np.searchsorted(published, minutes, side="right") - 1

    now = seen(close_minutes)
    fresh = (now >= 0) & (close_minutes - times[np.maximum(now, 0)] <= OI_MAX_AGE_MINUTES)
    for key, hours in (("oi_chg_1h", 1), ("oi_chg_4h", 4), ("oi_chg_24h", 24)):
        before = seen(close_minutes - hours * 60)
        usable = fresh & (before >= 0)
        empty[key][usable] = (values[now[usable]] / values[before[usable]] - 1) * 100

    # Promedio por minuto de cada hora, igual que el observador: cada minuto vale el ultimo dato publicado
    prefix = np.r_[0.0, np.cumsum(values[:-1] * np.diff(published))]

    def summed(minutes):
        last = seen(minutes)
        safe = np.maximum(last, 0)
        return prefix[safe] + values[safe] * (minutes - published[safe] + 1)

    usable = fresh & (seen(close_minutes - 239) >= 0)
    sums = [summed(close_minutes - 60 * hours) for hours in (4, 3, 2, 1, 0)]
    means = [(sums[k + 1] - sums[k])[usable] / 60 for k in range(4)]
    empty["oi_rises"][usable] = sum((later > earlier).astype(float) for earlier, later in zip(means, means[1:]))
    return empty


def _file_day(path):
    """Dias desde 1970 del nombre SIMBOLO_AAAA-MM-DD de un dia del almacen, o None si no se entiende."""
    try:
        return (dt.date.fromisoformat(path.stem.rsplit("_", 1)[-1]) - dt.date(1970, 1, 1)).days
    except ValueError:
        return None


def flow_columns(symbol, start_minutes):
    """Delta real de cada vela de 15 minutos, solo donde el almacen tiene sus minutos."""
    n = len(start_minutes)
    buys, sells = np.full(n, np.nan), np.full(n, np.nan)
    # Un dia fuera de las velas no aporta ninguna fila: saltarlo da lo mismo y evita leer miles de archivos
    # cuando la tabla cubre pocas semanas (journal de la suite, 12/11/2026)
    first_day = int(start_minutes[0]) // 1440 if n else 0
    last_day = int(start_minutes[-1]) // 1440 if n else -1
    for path in sorted((footprint_store.STORE_DIR / symbol).glob("*/*.npz")):
        day_index = _file_day(path)
        if day_index is not None and not (first_day <= day_index <= last_day):
            continue
        with np.load(path) as day:
            scale = float(day["info"][1])
            minute = day["m"].astype(np.int64)
            buy = day["buy"] / scale
            sell = day["sell"] / scale
        bucket = minute // 15 * 15
        first = np.r_[0, np.nonzero(np.diff(bucket))[0] + 1]
        count = np.diff(np.r_[first, len(bucket)])
        rows = np.searchsorted(start_minutes, bucket[first])
        rows = np.minimum(rows, n - 1)
        found = (start_minutes[rows] == bucket[first]) & (count >= FLOW_MIN_MINUTES)
        buys[rows[found]] = np.add.reduceat(buy, first)[found]
        sells[rows[found]] = np.add.reduceat(sell, first)[found]

    total = buys + sells
    delta = np.divide(buys - sells, total, out=np.full(n, np.nan), where=total > 0)

    known = np.isfinite(total)
    both = rolling_sum(np.where(known, total, 0.0), DELTA_BARS)
    net = rolling_sum(np.where(known, buys - sells, 0.0), DELTA_BARS)
    complete = rolling_sum(known.astype(float), DELTA_BARS) == DELTA_BARS
    wide = np.divide(net, both, out=np.full(n, np.nan), where=complete & (both > 0))
    return delta, wide


def compute(symbol, frames):
    """Tabla completa desde las velas de cada marco. Solo usa datos anteriores al cierre de cada fila."""
    base = frames["15m"]
    close_time = base["ts"] + 15 * MINUTE
    close_minutes = close_time // MINUTE
    n = len(close_time)
    columns = {}
    atr15 = None

    for tag, minutes in FRAMES:
        frame = frames[tag]
        values = frame_columns(frame, minutes)
        where = np.searchsorted(frame["ts"] + minutes * MINUTE, close_time, side="right") - 1
        safe = np.maximum(where, 0)
        known = where >= 0

        def aligned(column):
            return np.where(known, column[safe], np.nan)

        for key, column in values.items():
            if key == "atr":
                if tag == "15m":
                    atr15 = aligned(column)
                continue
            columns[f"{key}_{tag}"] = aligned(column)

        if tag in FVG_FRAMES:
            for key, column in gap_columns(frame, values["atr"]).items():
                columns[f"fvg_{key}_{tag}"] = aligned(column)

    close = base["close"]
    poc, vah, val, vwap = profile_columns(base, close_time)
    columns["poc_dist"] = (close - poc) / atr15
    width = vah - val
    columns["value_pos"] = np.divide(close - val, width, out=np.full(n, np.nan), where=width > 0)
    columns["vwap_dist"] = (close - vwap) / atr15

    columns.update(oi_columns(symbol, close_minutes))
    columns["delta_15m"], columns["delta_4h"] = flow_columns(symbol, base["ts"] // MINUTE)

    hours = (close_time // 3600000) % 24
    columns["hour"] = hours.astype(float)
    columns["session"] = np.digitize(hours, (7, 13, 21)).astype(float)  # Sin uso: el codigo anterior con VERSION 1 la lee

    table = {key: column.astype(np.float32) for key, column in columns.items()}
    table.update({"close_time": close_time, "close": close, "high": base["high"], "low": base["low"], "atr": atr15})
    fine = frames.get("5m")
    if fine is not None:
        table.update({"m5_time": fine["ts"], "m5_high": fine["high"], "m5_low": fine["low"]})
    return table


# ==================== CONSTRUCCION ====================

def read_candles(symbol):
    """Velas de cada marco desde el cache de App 1, sin repetidos y sin la ultima, que puede estar abierta."""
    with gzip.open(_cache_path(symbol), "rt", encoding="utf-8") as file:
        timeframes = json.load(file)["timeframes"]

    frames = {}
    for tag in ("5m", "15m", "1h", "4h"):
        rows = timeframes[tag]["main"]
        ts = np.array([row["timestamp"] for row in rows], dtype=np.int64)
        order = np.argsort(ts, kind="stable")
        ts = ts[order]
        keep = np.r_[np.diff(ts) > 0, False]
        frames[tag] = {"ts": ts[keep]}
        for key in ("open", "high", "low", "close", "volume"):
            frames[tag][key] = np.array([row[key] for row in rows], dtype=np.float64)[order][keep]
        del rows
    return frames


def _table_path(symbol):
    return table_dir() / f"{symbol}.npz"


def build(symbol):
    frames = read_candles(symbol)
    table = compute(symbol, frames)
    table["meta"] = np.array(json.dumps({"version": VERSION, "symbol": symbol, "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}))

    folder = table_dir()
    folder.mkdir(parents=True, exist_ok=True)
    partial = folder / f"{symbol}.tmp.npz"
    np.savez_compressed(partial, **table)
    os.replace(partial, _table_path(symbol))
    return len(table["close_time"])


def _start_build(symbol):
    """El cache pesa decenas de MB: se lee en otro proceso para no frenar el backend."""
    with _LOCK:
        running = _builds.get(symbol)
        if running is not None and running.poll() is None:
            return
        script = str(Path(__file__).resolve())
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        _builds[symbol] = subprocess.Popen([sys.executable, "-B", script, "build", symbol], creationflags=flags)


def status(symbol):
    with _LOCK:
        running = _builds.get(symbol)
    if running is not None and running.poll() is None:
        return "building"
    if _load(symbol) is not None:
        return "ready"
    return "missing" if _cache_path(symbol).exists() else "unavailable"


def _load(symbol):
    path = _table_path(symbol)
    if not path.exists():
        return None
    stamp = path.stat().st_mtime
    with _LOCK:
        cached = _tables.get(symbol)
        if cached and cached[0] == stamp:
            return cached[1]
    with np.load(path) as stored:
        if json.loads(str(stored["meta"])).get("version") != VERSION:
            return None  # Mientras se reconstruye no hace falta descomprimir las demás columnas
        table = {name: stored[name] for name in stored.files}
    with _LOCK:
        _tables[symbol] = (stamp, table)
    return table


def table_for(symbol, until_ms=None):
    """Tabla del simbolo. Si falta o no llega hasta until_ms la prepara aparte y devuelve lo que haya."""
    table = _load(symbol)
    source = _cache_path(symbol)
    if not source.exists():
        return table
    if table is None:
        _start_build(symbol)
    elif until_ms is not None and until_ms > int(table["close_time"][-1]) + 15 * MINUTE:
        if source.stat().st_mtime > _table_path(symbol).stat().st_mtime:
            _start_build(symbol)
    return table


# ==================== LECTURA ====================

def row_at(table, time_ms):
    """Ultima fila ya cerrada en time_ms, o None si el momento queda fuera de la tabla."""
    index = int(np.searchsorted(table["close_time"], int(time_ms), side="right")) - 1
    if index < 0 or time_ms >= table["close_time"][-1] + 15 * MINUTE:
        return None
    return index


def column(table, item, side):
    """Columna de una medida vista desde el lado de la orden: 1 compra, -1 venta."""
    key, _, _, rule = item
    if isinstance(rule, tuple):
        return table[rule[0] if side > 0 else rule[1]]
    values = table[key]
    if rule == 1:
        return values * side
    if rule == "mirror":
        return values if side > 0 else 1 - values
    return values


def value_at(table, item, index, side):
    """Una medida de una fila, vista desde el lado de la orden. None si no hay dato."""
    key, _, _, rule = item
    if isinstance(rule, tuple):
        value = float(table[rule[0] if side > 0 else rule[1]][index])
    else:
        value = float(table[key][index])
        if rule == 1:
            value *= side
        elif rule == "mirror" and side < 0:
            value = 1 - value
    return None if math.isnan(value) else round(value, 4)


def read_row(table, index, side):
    return {item[0]: value_at(table, item, index, side) for item in MEASURES}


def catalog():
    return [{"key": key, "label": label, "group": group} for key, label, group, _ in MEASURES]


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "build":
        begin = time.time()
        rows = build(sys.argv[2])
        print(f"{sys.argv[2]}: {rows} filas en {time.time() - begin:.1f} s")
    else:
        print("Uso: python -B measures.py build SIMBOLO")
