"""
Lee el almacen diario de order flow creado desde los trades de Bybit.

Cada dia guarda, por minuto y por precio, compra y venta reales. De ahi salen footprints de
cualquier marco y step, siempre cortados en la hora simulada para no mostrar el futuro.

Dias de la nube (live=True): si falta el dia oficial, se lee el que grabo el collector de
Northflank y bajo PanelOrderFlow/sync_nube.py a OrderFlowData/live/store. Esta apagado por
defecto: App 1 (Observador, medidas, setups) usa solo dias oficiales. Lo enciende la app en
tiempo real con live=True o con ORDERFLOW_USE_LIVE=1. El dia oficial siempre manda.
"""
import datetime as dt
import json
import math
import os
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np

STORE_DIR = Path(os.environ.get("ORDERFLOW_STORE", r"C:\Users\inven\OrderFlowData\store"))
LIVE_DIR = Path(os.environ.get("ORDERFLOW_LIVE_STORE", str(STORE_DIR.parent / "live" / "store")))
USE_LIVE = os.environ.get("ORDERFLOW_USE_LIVE", "0") == "1"
MAX_DAYS_IN_MEMORY = 96
IMBALANCE_RATIO = 3.0
STACKED_MIN_LEVELS = 3
ZSCORE_LOOKBACK = 20
CANDLE_VOLUME_BARS = 20  # Velas anteriores para el filtro de volumen de la vela de los imbalances
MAX_CANDLE_VOLUME_BARS = 100
MAX_RATIO = 99.99  # Imbalance contra un lado en cero: la division no tiene valor finito
MAX_LEVELS_PER_CANDLE = 200  # Un step muy fino en velas anchas pesaria decenas de MB por respuesta
LEVEL_GROUPS = (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000)  # Niveles que se unen en una vela ancha

# Tamano de celda por marco, como parte del precio. En BTC a 80,000: 5, 10, 10, 25 y 50 USD.
STEP_BY_INTERVAL = {1: 0.00006, 5: 0.0001, 15: 0.000125, 60: 0.0003, 240: 0.0006}

_days = OrderedDict()
_days_lock = threading.Lock()  # El observador lee en otro hilo


def _day_path(symbol, day):
    return STORE_DIR / symbol / day[:4] / f"{symbol}_{day}.npz"


def _live_path(symbol, day):
    return LIVE_DIR / symbol / day[:4] / f"{symbol}_{day}.npz"


def _live_gaps(symbol, day):
    """Huecos [inicio_ms, fin_ms] de un dia de la nube, del estado que guarda sync_nube.py junto al .tape."""
    state = LIVE_DIR.parent / "tape" / symbol / day[:4] / f"{symbol}_{day}.json"
    try:
        info = json.loads(state.read_text(encoding="utf-8"))
    except Exception:
        return [], False, None
    gaps = [[int(a), int(b)] for a, b in info.get("gaps", [])]
    start = int(dt.datetime.fromisoformat(day + "T00:00:00+00:00").timestamp() * 1000)
    covered = info.get("covered_from")
    if covered is not None and int(covered) > start:
        gaps.append([start, int(covered)])  # el collector empezo a grabar a mitad del dia
    # Un dia sin cerrar solo esta grabado hasta su ultimo guardado en la nube
    until = None if info.get("final") or info.get("saved_at") is None else int(info["saved_at"])
    return sorted(gaps), bool(info.get("complete")), until


def _remember(key, data):
    with _days_lock:
        _days[key] = data
        _days.move_to_end(key)
        while len(_days) > MAX_DAYS_IN_MEMORY:
            _days.popitem(last=False)


def _load_day(symbol, day, live=False):
    key = (symbol, day)
    with _days_lock:
        if key in _days:
            _days.move_to_end(key)
            return _days[key]
    path = _day_path(symbol, day)
    if path.exists():
        with np.load(path) as z:
            data = {name: z[name] for name in z.files}
        _remember(key, data)
        return data
    if not live:
        return None
    # Dia de la nube: cambia con cada sincronizacion, asi que se vuelve a leer si cambio el archivo
    path = _live_path(symbol, day)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    live_key = (symbol, day, "live")
    with _days_lock:
        cached = _days.get(live_key)
        if cached is not None and cached["_mtime"] == mtime:
            _days.move_to_end(live_key)
            return cached
    with np.load(path) as z:
        data = {name: z[name] for name in z.files}
    data["_mtime"] = mtime
    data["_live"] = True
    data["_gaps"], data["_complete"], data["_until"] = _live_gaps(symbol, day)
    data["_day"] = day
    _remember(live_key, data)
    return data


def coverage(symbol):
    """Primer dia, ultimo dia y cantidad de dias disponibles."""
    days = sorted(p.stem.rsplit("_", 1)[1] for p in (STORE_DIR / symbol).glob("*/*.npz"))
    return {"first": days[0], "last": days[-1], "days": len(days)} if days else {"first": None, "last": None, "days": 0}


def continuous_days(symbol):
    """Primer y ultimo dia del tramo sin huecos mas reciente del almacen."""
    days = sorted(dt.date.fromisoformat(p.stem.rsplit("_", 1)[1]) for p in (STORE_DIR / symbol).glob("*/*.npz"))
    if not days:
        return None
    first = days[-1]
    for day in reversed(days[:-1]):
        if (first - day).days > 1:
            break
        first = day
    return first, days[-1]


def auto_step(price, interval_minutes, cell):
    """Step legible para el marco: valor redondo y multiplo de la celda guardada."""
    target = price * STEP_BY_INTERVAL.get(interval_minutes, 0.000125)
    power = 10 ** math.floor(math.log10(target))
    options = [k * power for k in (1, 2, 2.5, 5, 10)]
    best = min(options, key=lambda x: abs(x - target))
    return max(cell, round(best / cell) * cell)


def _ratio(big, small, rules):
    """Ratio del lado dominante, o None si no alcanza las condiciones."""
    if big <= 0 or big < rules.get("min_volume", 0):
        return None
    if small <= 0:
        return MAX_RATIO if rules.get("count_zero") else None
    ratio = big / small
    return min(ratio, MAX_RATIO) if ratio >= rules.get("ratio", IMBALANCE_RATIO) else None


def _share_filter(levels, found, stacked, share):
    """
    Celdas contra la vela: un imbalance suelto queda si su celda (compra + venta) tiene al menos `share` del volumen
    de la vela; un stacked, si la suma de sus celdas lo tiene. Las celdas de un stacked que queda siguen marcadas.
    """
    total = sum(lv["total_volume"] for lv in levels)
    if share <= 0 or total <= 0:
        return found, stacked
    kept = [s for s in stacked if sum(levels[i]["total_volume"] for i in s["levels"]) >= share * total]
    in_kept = {i for s in kept for i in s["levels"]}
    return [x for x in found if x["level_index"] in in_kept or levels[x["level_index"]]["total_volume"] >= share * total], kept


def _imbalances(levels, rules=None):
    """
    Mismo nivel: compra contra venta del nivel.
    Diagonal: compra del nivel contra venta del nivel inferior, y venta contra compra del superior.
    """
    rules = rules or {}
    diagonal = rules.get("mode") == "diagonal"
    result = []
    for i, lv in enumerate(levels):
        below = levels[i - 1]["bid_volume"] if i > 0 else 0.0
        above = levels[i + 1]["ask_volume"] if i + 1 < len(levels) else 0.0
        buy = _ratio(lv["ask_volume"], below if diagonal else lv["bid_volume"], rules)
        sell = _ratio(lv["bid_volume"], above if diagonal else lv["ask_volume"], rules)
        if buy is None and sell is None:
            continue
        side = "BUY" if sell is None or (buy is not None and buy >= sell) else "SELL"
        result.append({"level_index": i, "type": side, "ratio": round(buy if side == "BUY" else sell, 2)})
    return result


def _stacked(levels, imbalances, min_levels=STACKED_MIN_LEVELS):
    by_level = {x["level_index"]: x for x in imbalances}
    result, streak, side = [], [], None

    def close():
        if len(streak) >= min_levels:
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


def _parts(symbol, start_min, end_min, live=False):
    """Dias que tocan el rango, con la posicion de sus minutos y de sus celdas."""
    day = dt.datetime.fromtimestamp(start_min * 60, dt.timezone.utc).date()
    last = dt.datetime.fromtimestamp((end_min - 1) * 60, dt.timezone.utc).date()
    parts = []
    while day <= last:
        data = _load_day(symbol, day.isoformat(), live)
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


def _level_group(low, high, max_levels):
    """Menor union redonda de niveles que deja la vela dentro del maximo."""
    for group in LEVEL_GROUPS:
        if high // group - low // group + 1 <= max_levels:
            return group
    return LEVEL_GROUPS[-1]


def _levels(cells, first, stop, step_ticks, ps, max_levels=None):
    """
    Niveles de una vela, de menor a mayor precio, sin huecos entre el minimo y el maximo.
    Con max_levels une niveles vecinos para no pasar de ese numero. Devuelve tambien su step.
    """
    raw = [int(level) for level in cells["level"][first:stop].tolist()]
    group = _level_group(min(raw), max(raw), max_levels) if max_levels else 1

    found = {}
    for i, level in enumerate(raw, first):
        item = found.setdefault(level // group, [0.0, 0.0, 0])
        item[0] += float(cells["buy"][i])
        item[1] += float(cells["sell"][i])
        item[2] += int(cells["count"][i])

    size = step_ticks * group
    levels = []
    for level in range(min(found), max(found) + 1):
        low = level * size / ps
        high = (level + 1) * size / ps
        buy, sell, count = found.get(level, (0.0, 0.0, 0))
        levels.append({
            "price": (low + high) / 2, "price_min": low, "price_max": high, "price_mid": (low + high) / 2,
            "bid_volume": round(sell, 6), "ask_volume": round(buy, 6), "delta": round(buy - sell, 6),
            "total_volume": round(buy + sell, 6), "trade_count": count,
        })
    return levels, size / ps


def _live(live):
    return USE_LIVE if live is None else bool(live)


def minutes(symbol, start_min, end_min, live=None):
    """Precio y volumen de cada minuto negociado entre start_min y end_min, o None sin datos."""
    parts = _parts(symbol, start_min, end_min, _live(live))
    if not parts:
        return None

    def join(name):
        return np.concatenate([d[name][a:b] / d["info"][0] for d, a, b, _, _ in parts])

    return {
        "m": np.concatenate([d["m"][a:b] for d, a, b, _, _ in parts]),
        "o": join("o"), "h": join("h"), "l": join("l"), "c": join("c"),
        "v": np.concatenate([(d["buy"][a:b] + d["sell"][a:b]) / d["info"][1] for d, a, b, _, _ in parts]),
    }


def cells(symbol, start_min, end_min, live=None):
    """Precio medio y volumen de cada celda negociada entre start_min y end_min."""
    prices, volumes = [np.empty(0)], [np.empty(0)]
    for data, _, _, first, stop in _parts(symbol, start_min, end_min, _live(live)):
        ps, qs, ticks = (int(x) for x in data["info"])
        prices.append((data["cl"][first:stop] + 0.5) * ticks / ps)
        volumes.append((data["cb"][first:stop] + data["cs"][first:stop]) / qs)
    return np.concatenate(prices), np.concatenate(volumes)


def profile(symbol, start_ms, end_ms, known_until_ms, low, high, rows, live=None):
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
        for data, first, stop, cell_first, cell_stop in _parts(symbol, start_min, end_min, _live(live)):
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


def footprints(symbol, interval_minutes, start_ms, end_ms, known_until_ms=None, step=None, imbalance=None, max_levels=None,
               live=None):
    """
    Footprints de las velas que empiezan entre start_ms y end_ms.
    known_until_ms corta la informacion: un minuto solo cuenta si ya termino en ese instante.
    imbalance acepta ratio, mode, min_volume, count_zero y stacked_levels, y dos filtros (14/11, pedido del usuario):
    - candle_volume_pct (> 0): la vela solo tiene imbalances si su volumen llega a ese % del promedio de las
      candle_volume_bars velas anteriores (sin velas anteriores, no se filtra). Cada vela lleva su volumen relativo;
    - cell_share_pct (> 0): un imbalance suelto queda si su celda tiene ese % del volumen de la vela, y un stacked
      si la suma de sus celdas lo tiene.
    max_levels es el tope por vela con step automatico: una vela ancha sube su propio step.
    live: tambien dias de la nube donde falta el oficial (ver arriba). Sus velas llevan
    source "live", y gap True si tocan un hueco de la grabacion (volumen incompleto).
    """
    live = _live(live)
    imbalance = imbalance or {}
    tf = int(interval_minutes)
    start_min = (start_ms // 60000) // tf * tf
    end_min = -(-end_ms // 60000)
    if known_until_ms is not None:
        end_min = min(end_min, known_until_ms // 60000)
    empty = {"footprints": [], "step_size": step, "known_until": max(end_min, 0) * 60000}
    if end_min <= start_min:
        return empty

    wanted = _parts(symbol, start_min, end_min, live)
    if not wanted:
        return empty
    candle_pct = max(0.0, float(imbalance.get("candle_volume_pct") or 0))
    candle_bars = max(1, min(int(imbalance.get("candle_volume_bars") or CANDLE_VOLUME_BARS), MAX_CANDLE_VOLUME_BARS))
    look = candle_bars if candle_pct > 0 else 0
    share = max(0.0, float(imbalance.get("cell_share_pct") or 0)) / 100
    data0 = wanted[-1][0]
    ps = int(data0["info"][0])
    ticks = max(int(d["info"][2]) for d, *_ in wanted)
    cell = ticks / ps
    price_ref = float(data0["c"][wanted[-1][2] - 1]) / ps
    used_step = float(step) if step else auto_step(price_ref, tf, cell)

    # Las velas anteriores solo sirven para medir el volumen relativo de la primera vela pedida
    candles = _candles(_parts(symbol, start_min - tf * max(ZSCORE_LOOKBACK, look), end_min, live), tf)
    # Dias de la nube: rango de minutos de cada uno y sus huecos, en minutos
    live_days = [(d["_day"], int(d["m"][0]) // 1440 * 1440, [(a // 60000, -(-b // 60000)) for a, b in d["_gaps"]],
                  d["_complete"], None if d["_until"] is None else d["_until"] // 60000)
                 for d, *_ in wanted if d.get("_live")]

    # El step es multiplo de la celda guardada, para que todos los niveles midan lo mismo
    shown = candles["start"] >= start_min
    widest = float((candles["high"] - candles["low"])[shown].max()) if shown.any() else 0.0
    least = 0 if max_levels else math.ceil(widest * ps / MAX_LEVELS_PER_CANDLE / ticks) * ticks
    step_ticks = max(ticks, int(round(used_step * ps / ticks)) * ticks, least)

    cells = _cell_sums(wanted, tf, step_ticks)
    volumes = candles["buy"] + candles["sell"]

    result = []
    for index, t in enumerate(candles["start"].tolist()):
        if t < start_min:
            continue
        first, stop = np.searchsorted(cells["start"], [t, t + 1])
        if first == stop:
            continue
        levels, level_step = _levels(cells, first, stop, step_ticks, ps, max_levels)
        poc = max(range(len(levels)), key=lambda i: levels[i]["total_volume"])
        past = volumes[max(0, index - ZSCORE_LOOKBACK):index]
        mean = float(past.mean()) if len(past) else 0.0
        std = float(past.std()) if len(past) else 0.0
        found = _imbalances(levels, imbalance)
        stacked = _stacked(levels, found, imbalance.get("stacked_levels", STACKED_MIN_LEVELS))
        buy, sell = float(candles["buy"][index]), float(candles["sell"][index])
        relative = None
        if look:
            # Solo velas anteriores: la vela en curso se compara con lo que lleva
            prior = volumes[max(0, index - candle_bars):index]
            relative = (buy + sell) / float(prior.mean()) if len(prior) and prior.mean() > 0 else None
            if relative is not None and relative * 100 < candle_pct:
                found, stacked = [], []
        found, stacked = _share_filter(levels, found, stacked, share)
        result.append({
            "candle_timestamp": t * 60000, "symbol": symbol, "interval": str(tf),
            "candle_open": float(candles["open"][index]), "candle_high": float(candles["high"][index]),
            "candle_low": float(candles["low"][index]), "candle_close": float(candles["close"][index]),
            "step_size": level_step, "levels": levels, "num_levels": len(levels),
            "poc_index": poc, "poc_price": levels[poc]["price_mid"], "poc": levels[poc]["price_mid"],
            "total_delta": round(buy - sell, 6), "delta": round(buy - sell, 6),
            "total_volume": round(buy + sell, 6), "trade_count": int(candles["trades"][index]),
            "imbalances": found,
            "stacked_imbalances": stacked,
            "volume_zscore": round((buy + sell - mean) / std, 2) if std > 0 else 0.0,
            "complete": t + tf <= end_min, "estimated": False,
        })
        if relative is not None:
            result[-1]["candle_volume_ratio"] = round(relative, 4)  # volumen de la vela / promedio de las anteriores
        if live_days:
            for _, day_min, gaps, _, until in live_days:
                if day_min <= t < day_min + 1440:
                    result[-1]["source"] = "live"
                    result[-1]["gap"] = any(a < t + tf and b > t for a, b in gaps)
                    if until is not None and t + tf > until:
                        result[-1]["complete"] = False  # la nube aun no guarda el final de esta vela
    out = {"footprints": result, "step_size": step_ticks / ps, "cell_size": cell, "known_until": end_min * 60000}
    if live_days:
        out["live_days"] = [{"day": d, "complete": c, "until": None if u is None else u * 60000}
                            for d, _, _, c, u in live_days]
    return out
