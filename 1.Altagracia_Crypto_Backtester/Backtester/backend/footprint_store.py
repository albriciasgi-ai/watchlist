"""
Lee el almacen diario de order flow creado desde los trades de Bybit.

Cada dia guarda, por minuto y por precio, compra y venta reales. De ahi salen footprints de
cualquier marco y step, siempre cortados en la hora simulada para no mostrar el futuro.
"""
import datetime as dt
import math
import os
from collections import OrderedDict
from pathlib import Path

import numpy as np

STORE_DIR = Path(os.environ.get("ORDERFLOW_STORE", r"C:\Users\inven\OrderFlowData\store"))
MAX_DAYS_IN_MEMORY = 96
IMBALANCE_RATIO = 3.0
STACKED_MIN_LEVELS = 3
ZSCORE_LOOKBACK = 20

# Tamano de celda por marco, como parte del precio. En BTC a 80,000: 5, 10, 10, 25 y 50 USD.
STEP_BY_INTERVAL = {1: 0.00006, 5: 0.0001, 15: 0.000125, 60: 0.0003, 240: 0.0006}

_days = OrderedDict()


def _day_path(symbol, day):
    return STORE_DIR / symbol / day[:4] / f"{symbol}_{day}.npz"


def _load_day(symbol, day):
    key = (symbol, day)
    if key in _days:
        _days.move_to_end(key)
        return _days[key]
    path = _day_path(symbol, day)
    if not path.exists():
        return None
    with np.load(path) as z:
        data = {name: z[name] for name in z.files}
    _days[key] = data
    while len(_days) > MAX_DAYS_IN_MEMORY:
        _days.popitem(last=False)
    return data


def coverage(symbol):
    """Primer dia, ultimo dia y cantidad de dias disponibles."""
    days = sorted(p.stem.rsplit("_", 1)[1] for p in (STORE_DIR / symbol).glob("*/*.npz"))
    return {"first": days[0], "last": days[-1], "days": len(days)} if days else {"first": None, "last": None, "days": 0}


def auto_step(price, interval_minutes, cell):
    """Step legible para el marco: valor redondo y multiplo de la celda guardada."""
    target = price * STEP_BY_INTERVAL.get(interval_minutes, 0.000125)
    power = 10 ** math.floor(math.log10(target))
    options = [k * power for k in (1, 2, 2.5, 5, 10)]
    best = min(options, key=lambda x: abs(x - target))
    return max(cell, round(best / cell) * cell)


def _imbalances(levels):
    result = []
    for i, lv in enumerate(levels):
        small, big = sorted((lv["bid_volume"], lv["ask_volume"]))
        if small > 0 and big / small >= IMBALANCE_RATIO:
            result.append({"level_index": i, "type": "BUY" if lv["ask_volume"] > lv["bid_volume"] else "SELL", "ratio": round(big / small, 2)})
    return result


def _stacked(levels, imbalances):
    by_level = {x["level_index"]: x for x in imbalances}
    result, streak, side = [], [], None

    def close():
        if len(streak) >= STACKED_MIN_LEVELS:
            ratios = [by_level[i]["ratio"] for i in streak]
            result.append({
                "type": "STACKED_IMBALANCE", "direction": side, "levels": streak.copy(), "levels_count": len(streak),
                "start_price": levels[streak[0]]["price_min"], "end_price": levels[streak[-1]]["price_max"],
                "avg_ratio": round(sum(ratios) / len(ratios), 2),
            })

    for i in range(len(levels)):
        item = by_level.get(i)
        if item is None:
            close()
            streak, side = [], None
        elif item["type"] == side:
            streak.append(i)
        else:
            close()
            streak, side = [i], item["type"]
    close()
    return result


def _parts(symbol, start_min, end_min):
    """Dias que tocan el rango, con la posicion de sus minutos y de sus celdas."""
    day = dt.datetime.fromtimestamp(start_min * 60, dt.timezone.utc).date()
    last = dt.datetime.fromtimestamp((end_min - 1) * 60, dt.timezone.utc).date()
    parts = []
    while day <= last:
        data = _load_day(symbol, day.isoformat())
        if data is not None:
            first, stop = np.searchsorted(data["m"], [start_min, end_min])
            if stop > first:
                cell_first, cell_stop = np.searchsorted(data["cr"], [first, stop])
                parts.append((data, first, stop, cell_first, cell_stop))
        day += dt.timedelta(days=1)
    return parts


def _candles(parts, tf):
    """Une los minutos en velas del marco pedido."""
    def join(name, scale=None):
        if scale is None:
            return np.concatenate([d[name][a:b] for d, a, b, _, _ in parts])
        return np.concatenate([d[name][a:b] / d["info"][scale] for d, a, b, _, _ in parts])

    start = join("m") // tf * tf
    first = np.r_[0, np.nonzero(np.diff(start))[0] + 1]
    last = np.r_[first[1:], len(start)] - 1
    return {
        "start": start[first], "open": join("o", 0)[first], "close": join("c", 0)[last],
        "high": np.maximum.reduceat(join("h", 0), first), "low": np.minimum.reduceat(join("l", 0), first),
        "buy": np.add.reduceat(join("buy", 1), first), "sell": np.add.reduceat(join("sell", 1), first),
        "trades": np.add.reduceat(join("n"), first),
    }


def _cell_sums(parts, tf, step_ticks):
    """Suma compra, venta y trades por vela y por nivel del step pedido."""
    start = np.concatenate([d["m"][d["cr"][a:b]] for d, _, _, a, b in parts]) // tf * tf
    level = np.concatenate([d["cl"][a:b] * int(d["info"][2]) // step_ticks for d, _, _, a, b in parts])
    buy = np.concatenate([d["cb"][a:b] / d["info"][1] for d, _, _, a, b in parts])
    sell = np.concatenate([d["cs"][a:b] / d["info"][1] for d, _, _, a, b in parts])
    count = np.concatenate([d["cn"][a:b] for d, _, _, a, b in parts])

    low = int(level.min())
    span = int(level.max()) - low + 1
    base = int(start.min())
    key = (start - base) // tf * span + (level - low)
    uniq, inverse = np.unique(key, return_inverse=True)
    return {
        "start": uniq // span * tf + base, "level": uniq % span + low,
        "buy": np.bincount(inverse, weights=buy), "sell": np.bincount(inverse, weights=sell),
        "count": np.bincount(inverse, weights=count),
    }


def _levels(cells, first, stop, step_ticks, ps):
    """Niveles de una vela, de menor a mayor precio, sin huecos entre el minimo y el maximo."""
    found = {int(lv): i for i, lv in enumerate(cells["level"][first:stop].tolist(), first)}
    levels = []
    for level in range(min(found), max(found) + 1):
        low = level * step_ticks / ps
        high = (level + 1) * step_ticks / ps
        i = found.get(level)
        buy = float(cells["buy"][i]) if i is not None else 0.0
        sell = float(cells["sell"][i]) if i is not None else 0.0
        levels.append({
            "price": (low + high) / 2, "price_min": low, "price_max": high, "price_mid": (low + high) / 2,
            "bid_volume": round(sell, 6), "ask_volume": round(buy, 6), "delta": round(buy - sell, 6),
            "total_volume": round(buy + sell, 6), "trade_count": int(cells["count"][i]) if i is not None else 0,
        })
    return levels


def profile(symbol, start_ms, end_ms, known_until_ms, low, high, rows):
    """
    Compra y venta reales por franja de precio en un rango de tiempo.
    minutes y expected_minutes dicen cuanto del rango esta en el almacen.
    """
    start_min = start_ms // 60000
    end_min = -(-end_ms // 60000)
    if known_until_ms is not None:
        end_min = min(end_min, known_until_ms // 60000)
    buy, sell, minutes = np.zeros(rows), np.zeros(rows), 0

    if end_min > start_min and high > low:
        for data, first, stop, cell_first, cell_stop in _parts(symbol, start_min, end_min):
            ps, qs, ticks = (int(x) for x in data["info"])
            price = (data["cl"][cell_first:cell_stop] + 0.5) * ticks / ps
            row = np.clip(((price - low) / (high - low) * rows).astype(np.int64), 0, rows - 1)
            buy += np.bincount(row, weights=data["cb"][cell_first:cell_stop] / qs, minlength=rows)
            sell += np.bincount(row, weights=data["cs"][cell_first:cell_stop] / qs, minlength=rows)
            minutes += int(stop - first)

    return {
        "buy": np.round(buy, 6).tolist(), "sell": np.round(sell, 6).tolist(),
        "minutes": minutes, "expected_minutes": max(0, end_min - start_min), "known_until": max(end_min, 0) * 60000,
    }


def footprints(symbol, interval_minutes, start_ms, end_ms, known_until_ms=None, step=None):
    """
    Footprints de las velas que empiezan entre start_ms y end_ms.
    known_until_ms corta la informacion: un minuto solo cuenta si ya termino en ese instante.
    """
    tf = int(interval_minutes)
    start_min = (start_ms // 60000) // tf * tf
    end_min = -(-end_ms // 60000)
    if known_until_ms is not None:
        end_min = min(end_min, known_until_ms // 60000)
    empty = {"footprints": [], "step_size": step, "known_until": max(end_min, 0) * 60000}
    if end_min <= start_min:
        return empty

    wanted = _parts(symbol, start_min, end_min)
    if not wanted:
        return empty
    data0 = wanted[-1][0]
    ps, _, ticks = (int(x) for x in data0["info"])
    cell = ticks / ps
    price_ref = float(data0["c"][wanted[-1][2] - 1]) / ps
    used_step = float(step) if step else auto_step(price_ref, tf, cell)
    step_ticks = max(ticks, int(round(used_step * ps)))

    # Las velas anteriores solo sirven para medir el volumen relativo de la primera vela pedida
    candles = _candles(_parts(symbol, start_min - tf * ZSCORE_LOOKBACK, end_min), tf)
    cells = _cell_sums(wanted, tf, step_ticks)
    volumes = candles["buy"] + candles["sell"]

    result = []
    for index, t in enumerate(candles["start"].tolist()):
        if t < start_min:
            continue
        first, stop = np.searchsorted(cells["start"], [t, t + 1])
        if first == stop:
            continue
        levels = _levels(cells, first, stop, step_ticks, ps)
        poc = max(range(len(levels)), key=lambda i: levels[i]["total_volume"])
        past = volumes[max(0, index - ZSCORE_LOOKBACK):index]
        mean = float(past.mean()) if len(past) else 0.0
        std = float(past.std()) if len(past) else 0.0
        found = _imbalances(levels)
        buy, sell = float(candles["buy"][index]), float(candles["sell"][index])
        result.append({
            "candle_timestamp": t * 60000, "symbol": symbol, "interval": str(tf),
            "candle_open": float(candles["open"][index]), "candle_high": float(candles["high"][index]),
            "candle_low": float(candles["low"][index]), "candle_close": float(candles["close"][index]),
            "step_size": step_ticks / ps, "levels": levels, "num_levels": len(levels),
            "poc_index": poc, "poc_price": levels[poc]["price_mid"], "poc": levels[poc]["price_mid"],
            "total_delta": round(buy - sell, 6), "delta": round(buy - sell, 6),
            "total_volume": round(buy + sell, 6), "trade_count": int(candles["trades"][index]),
            "imbalances": found, "stacked_imbalances": _stacked(levels, found),
            "volume_zscore": round((buy + sell - mean) / std, 2) if std > 0 else 0.0,
            "complete": t + tf <= end_min, "estimated": False,
        })
    return {"footprints": result, "step_size": step_ticks / ps, "known_until": end_min * 60000}
