"""
Observador de las operaciones manuales de App 1.

Guarda cada orden con lo que la regla del laboratorio leia en ese minuto: contexto de 4 horas y
1 hora, movimiento respaldado por volumen, zona y Open Interest. La lectura queda oculta hasta
que la orden termina, para no influir en quien opera.

La lectura repite readAt() de research/lab/engine.js sobre el almacen diario de trades, con las
reglas fijadas en research/REGLAS_RONDA3.md, y solo usa minutos anteriores a la orden.

El registro es un archivo de eventos en disco: cada linea se agrega y ninguna se reescribe.
"""
import datetime as dt
import json
import math
import os
import random
import threading
from pathlib import Path

import numpy as np

import footprint_store
import oi_store

OBSERVER_DIR = Path(os.environ.get("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\observer"))
JOURNAL_NAME = "journal.jsonl"

RULE = {
    "ctx_eff": 0.3, "ctx_bars": {240: 30, 60: 48},
    "imp_mult": 1.5, "imp_atr": 2, "imp_gap": 2, "imp_age": 60,
    "depth_min": 0.2, "depth_max": 0.85, "fvg_min": 0.0003,
    "near_pct": 0.1, "oi_hours": 4, "oi_steps": 3,
}
FRAMES = (240, 60, 15)
PROFILE_BINS = 40
OI_BLOCKS = 4
OI_DELAY_MINUTES = 5  # Cada dato se usa 5 minutos despues de su marca
OI_MAX_AGE_MINUTES = 30  # Si la serie termina antes, no hay lectura de OI para ese minuto
LOOKBACK_DAYS = 45  # Alcanza para 60 velas de 4 horas mas lo que necesitan el promedio y el ATR
MAX_MINUTES_WITHOUT_TRADES = 1440
BLIND_MARGIN_START_DAYS = 45
BLIND_MARGIN_END_DAYS = 14
BLIND_MIN_SEPARATION_DAYS = 14
SAME_MOVE_OVERLAP = 0.6
SMALL_SAMPLE = 30

_lock = threading.Lock()


# ==================== LECTURA ====================

def _bars(data, tf):
    """Velas completas del marco, construidas desde los minutos."""
    minute = data["m"]
    start = minute // tf * tf
    first = np.r_[0, np.nonzero(np.diff(start))[0] + 1]
    last = np.r_[first[1:], len(start)] - 1
    full = (minute[first] == start[first]) & (minute[last] == start[first] + tf - 1)
    return {
        "t": start[first][full], "o": data["o"][first][full], "c": data["c"][last][full],
        "h": np.maximum.reduceat(data["h"], first)[full], "l": np.minimum.reduceat(data["l"], first)[full],
        "v": np.add.reduceat(data["v"], first)[full],
    }


def _context(bars, tf, t, count):
    """Que parte del recorrido fue en linea recta y de que lado estuvo el volumen."""
    end = int(np.searchsorted(bars["t"], t - tf + 1))
    if end - count < 1:
        return None
    closes = bars["c"][end - count - 1:end]
    span = slice(end - count, end)
    net = float(closes[-1] - closes[0])
    path = float(np.abs(np.diff(closes)).sum())
    total = float(bars["v"][span].sum())
    bullish = float(bars["v"][span][bars["c"][span] > bars["o"][span]].sum())
    efficiency = abs(net) / path if path > 0 else 0.0
    state = "range" if efficiency < RULE["ctx_eff"] else "up" if net > 0 else "down"
    return {"tf": tf, "bars": count, "net": net, "efficiency": efficiency, "up_volume": bullish / total if total > 0 else 0.5, "state": state}


def _impulses(bars, tf):
    """Movimientos respaldados por volumen. Cada uno se conoce al cierre de la vela que lo termina."""
    t, o, h, l, c, v = (bars[key].tolist() for key in ("t", "o", "h", "l", "c", "v"))
    count = len(t)
    true_range = [0.0] * count
    for k in range(1, count):
        true_range[k] = max(h[k] - l[k], abs(h[k] - c[k - 1]), abs(l[k] - c[k - 1]))

    found, run = [], None

    def finish(k):
        span = abs(run["ext"] - run["base"])
        atr = run["atr"]
        if atr > 0 and span >= RULE["imp_atr"] * atr:
            found.append({
                "tf": tf, "d": run["d"], "lo": min(run["base"], run["ext"]), "hi": max(run["base"], run["ext"]),
                "t0": t[run["base_k"]], "t1": t[run["ext_k"]] + tf, "first": t[run["first"]], "known": t[k] + tf,
                "ratio": run["ratio"], "atrs": span / atr, "score": span / atr * run["ratio"],
            })

    for k in range(20, count):
        average = sum(v[k - 20:k]) / 20
        move = c[k] - o[k]
        side = (move > 0) - (move < 0)
        strong = side != 0 and average > 0 and v[k] >= RULE["imp_mult"] * average

        if run:
            if h[k] > run["ext"] if run["d"] > 0 else l[k] < run["ext"]:
                run["ext"] = h[k] if run["d"] > 0 else l[k]
                run["ext_k"] = k
            span = abs(run["ext"] - run["base"])
            back = run["ext"] - c[k] if run["d"] > 0 else c[k] - run["ext"]
            if strong and side == run["d"]:
                run["last"] = k
                run["ratio"] = max(run["ratio"], v[k] / average)
            elif k - run["last"] > RULE["imp_gap"] or back > 0.5 * span or (strong and side == -run["d"]):
                finish(k)
                run = None

        if run is None and strong:
            base_k, base = k, l[k] if side > 0 else h[k]
            for q in range(k - 5, k):
                if l[q] < base if side > 0 else h[q] > base:
                    base = l[q] if side > 0 else h[q]
                    base_k = q
            run = {
                "d": side, "first": k, "last": k, "base": base, "base_k": base_k,
                "ext": h[k] if side > 0 else l[k], "ext_k": k, "ratio": v[k] / average,
                "atr": sum(true_range[k - 14:k]) / 14,
            }
    return found


def _volume_clusters(prices, volumes, low, high, direction):
    """Dos mayores concentraciones de volumen del movimiento, entre 20% y 85% de retroceso."""
    edges = np.array([i * ((high - low) / PROFILE_BINS) + low for i in range(PROFILE_BINS + 1)])
    edges[PROFILE_BINS] = high
    mids = (edges[:-1] + edges[1:]) / 2

    inside = (prices >= edges[0]) & (prices <= edges[-1])
    bins = np.minimum(np.searchsorted(edges, prices[inside], side="right") - 1, PROFILE_BINS - 1)
    volume = np.bincount(bins, weights=volumes[inside], minlength=PROFILE_BINS)

    third = 1 / 3
    smooth = volume * third
    smooth[1:] += volume[:-1] * third
    smooth[:-1] += volume[1:] * third

    extreme = high if direction > 0 else low
    depth = np.abs(extreme - mids) / (high - low)
    candidate = (depth >= RULE["depth_min"]) & (depth <= RULE["depth_max"])
    median = float(np.median(smooth))

    peaks = [
        i for i in range(1, PROFILE_BINS - 1)
        if candidate[i] and smooth[i] >= smooth[i - 1] and smooth[i] >= smooth[i + 1] and smooth[i] >= 1.2 * median
    ]
    peaks.sort(key=lambda i: -smooth[i])

    chosen = []
    for peak in peaks:
        if all(abs(peak - other) >= 3 for other in chosen):
            chosen.append(peak)
        if len(chosen) == 2:
            break

    clusters = []
    for rank, peak in enumerate(chosen, 1):
        a = b = peak
        while a > 0 and candidate[a - 1] and smooth[a - 1] >= 0.7 * smooth[peak]:
            a -= 1
        while b < PROFILE_BINS - 1 and candidate[b + 1] and smooth[b + 1] >= 0.7 * smooth[peak]:
            b += 1
        clusters.append({"typ": "HVN", "rank": rank, "x0": float(edges[a]), "x1": float(edges[b + 1])})
    return clusters


def _move_gaps(bars15, first, last, confirmed, direction):
    """FVG de 15 minutos a favor del movimiento y todavia abiertos cuando este se conoce."""
    highs, lows = bars15["h"], bars15["l"]
    up, down = 1 + RULE["fvg_min"], 1 - RULE["fvg_min"]
    gaps = []
    for j in range(first + 1, last):
        after = slice(j + 2, confirmed + 1)
        if direction > 0 and lows[j + 1] > highs[j - 1] * up:
            bottom, top = float(highs[j - 1]), float(lows[j + 1])
            lowest = float(lows[after].min()) if j + 2 <= confirmed else top
            if lowest > bottom:
                gaps.append({"typ": "FVG", "rank": 1, "x0": bottom, "x1": min(top, lowest)})
        if direction < 0 and highs[j + 1] < lows[j - 1] * down:
            bottom, top = float(highs[j + 1]), float(lows[j - 1])
            highest = float(highs[after].max()) if j + 2 <= confirmed else bottom
            if highest < top:
                gaps.append({"typ": "FVG", "rank": 1, "x0": max(bottom, highest), "x1": top})
    return gaps


def _move_zones(symbol, move, bars15):
    """Perfil real y FVG del movimiento, con la misma logica de los tramos del laboratorio."""
    starts = bars15["t"]
    first = int(np.searchsorted(starts, move["t0"]))
    last = max(first, int(np.searchsorted(starts, move["t1"])) - 1)
    confirmed = max(last, int(np.searchsorted(starts, move["known"])) - 1)
    prices, volumes = footprint_store.cells(symbol, int(starts[first]), int(starts[last]) + 15)
    return (
        _volume_clusters(prices, volumes, move["lo"], move["hi"], move["d"]),
        _move_gaps(bars15, first, last, confirmed, move["d"]),
    )


def _oi_window(symbol, t):
    """OI de las ultimas horas en cuatro bloques, con cada dato usado cuando ya estaba publicado."""
    series = oi_store.points(symbol)
    if series is None:
        return None
    times, values = series
    width = round(RULE["oi_hours"] * 60)
    start = t - width + 1
    minutes = np.arange(start, t + 1)
    index = np.searchsorted(times + OI_DELAY_MINUTES, minutes, side="right") - 1
    if index[0] < 0 or t - int(times[index[-1]]) > OI_MAX_AGE_MINUTES:
        return None

    seen = values[index]
    block = np.minimum(OI_BLOCKS - 1, (minutes - start) * OI_BLOCKS // width)
    means = [float(seen[block == b].mean()) for b in range(OI_BLOCKS)]
    rises = sum(later > earlier for earlier, later in zip(means, means[1:]))
    falls = sum(later < earlier for earlier, later in zip(means, means[1:]))
    change = float(seen[-1] / seen[0] - 1)

    steps = RULE["oi_steps"]
    direction = "up" if rises >= steps and change >= 0 else "down" if falls >= steps and change <= 0 else "mixed"
    return {"dir": direction, "change": change, "rises": rises, "falls": falls, "blocks": means}


def _zone_gap(price, zone):
    if price > zone["x1"]:
        return price / zone["x1"] - 1
    if price < zone["x0"]:
        return zone["x0"] / price - 1
    return 0.0


def _near_zone(zones, price):
    best = None
    for zone in zones:
        gap = _zone_gap(price, zone)
        if best is None or gap < best[1]:
            best = (zone, gap)
    return best


def _zone_chance(zones, market, side, near):
    """Parte de los precios del lado de la orden, hasta 2% del mercado, igual de cerca de una zona."""
    hits = 0
    for k in range(1, 101):
        price = market * (1 - side * k * 0.0002)
        hits += any(_zone_gap(price, zone) <= near for zone in zones)
    return hits / 100


def read_at(symbol, time_ms, side, entry=None):
    """
    Lectura de un minuto para una orden: side es 1 para compra y -1 para venta.
    Solo usa minutos terminados antes de time_ms y velas cerradas.
    """
    t = int(time_ms) // 60000
    data = footprint_store.minutes(symbol, t - LOOKBACK_DAYS * 1440, t)
    if data is None or int(data["m"][-1]) < t - MAX_MINUTES_WITHOUT_TRADES:
        return {"available": False, "missing": "trades", "time": int(time_ms)}

    minute, closes = data["m"], data["c"]
    price = float(closes[-1])
    bars = {tf: _bars(data, tf) for tf in FRAMES}

    start15 = minute // 15 * 15
    first15 = np.r_[0, np.nonzero(np.diff(start15))[0] + 1]
    bars15 = {
        "t": start15[first15],
        "h": np.maximum.reduceat(data["h"], first15),
        "l": np.minimum.reduceat(data["l"], first15),
    }

    zones, moves = [], {}
    for tf in FRAMES:
        alive = []
        for move in _impulses(bars[tf], tf):
            if move["d"] != side or move["known"] > t or (t - move["known"]) / tf > RULE["imp_age"]:
                continue
            since = int(np.searchsorted(minute, move["known"]))
            later = closes[since:]
            if (later <= move["lo"]).any() if side > 0 else (later >= move["hi"]).any():
                continue
            alive.append(move)

            clusters, gaps = _move_zones(symbol, move, bars15)
            lowest = float(data["l"][since:].min()) if since < len(minute) else math.inf
            highest = float(data["h"][since:].max()) if since < len(minute) else -math.inf
            zones += [{**zone, "tf": tf} for zone in clusters]
            zones += [{**gap, "tf": tf} for gap in gaps if (lowest > gap["x0"] if side > 0 else highest < gap["x1"])]

        chosen = None
        for move in alive:
            if chosen is None or move["score"] > chosen["score"]:
                chosen = move
        moves[str(tf)] = {"count": len(alive), "chosen": chosen}

    zones = [zone for zone in zones if (zone["x0"] < price if side > 0 else zone["x1"] > price)]

    near = RULE["near_pct"] / 100
    entry_read = None
    if entry:
        best = _near_zone(zones, float(entry))
        entry_read = {
            "zone": best[0] if best else None,
            "gap": best[1] if best else None,
            "near": bool(best and best[1] <= near),
            "chance": _zone_chance(zones, price, side, near),
        }

    closed15 = bars[15]
    end = int(np.searchsorted(closed15["t"], t - 15 + 1))
    last_ratio = None
    if end > 20:
        average = float(closed15["v"][end - 21:end - 1].mean())
        last_ratio = float(closed15["v"][end - 1]) / average if average > 0 else None

    return {
        "available": True, "time": int(time_ms), "price": price, "side": side,
        "context": {str(tf): _context(bars[tf], tf, t, count) for tf, count in RULE["ctx_bars"].items()},
        "moves": moves, "zones": zones, "entry": entry_read, "oi": _oi_window(symbol, t),
        "volume": {"last_15m_ratio": last_ratio},
    }


# ==================== REGISTRO ====================

def _journal():
    return OBSERVER_DIR / JOURNAL_NAME


def _append(event):
    OBSERVER_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(event, ensure_ascii=False)
    with _lock, open(_journal(), "a", encoding="utf-8") as journal:
        journal.write(line + "\n")


def _events():
    if not _journal().exists():
        return []
    with _lock, open(_journal(), encoding="utf-8") as journal:
        lines = journal.readlines()
    events = []
    for line in lines:
        try:
            events.append(json.loads(line))
        except ValueError:
            continue  # Una linea cortada no invalida el resto del registro
    return events


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def record_order(order):
    """Guarda una orden con la lectura de ese minuto. Quien pregunta solo recibe confirmacion."""
    side = 1 if order["side"] == "long" else -1
    try:
        reading = read_at(order["symbol"], order["time"], side, order.get("entry"))
    except Exception as error:  # La orden se guarda igual: perderla seria peor que no tener lectura
        reading = {"available": False, "missing": "error", "error": str(error), "time": order["time"]}
    _append({**order, "event": "order", "at": _now(), "reading": reading})
    return {"id": order["id"]}


def record_event(order_id, event, details):
    if event not in ("fill", "close", "cancel", "marks", "image"):
        raise ValueError(f"Evento desconocido: {event}")
    _append({**details, "event": event, "id": order_id, "at": _now()})
    return {"id": order_id}


def trades():
    """Estado actual de cada orden, doblando los eventos en orden de llegada."""
    result = {}
    for event in _events():
        kind, order_id = event.get("event"), event.get("id")
        if kind == "order":
            filled = event.get("fill_time") is not None
            result[order_id] = {**event, "status": "open" if filled else "pending"}
        elif order_id in result:
            trade = result[order_id]
            if kind == "fill":
                trade.update(status="open", fill_time=event.get("time"), fill_price=event.get("price"))
            elif kind == "close":
                trade.update(
                    status="closed", exit_time=event.get("time"), exit_price=event.get("price"),
                    exit_reason=event.get("reason"), pnl=event.get("pnl"), pnl_percent=event.get("pnl_percent"),
                )
            elif kind == "cancel":
                trade.update(status="cancelled", cancel_time=event.get("time"))
            elif kind == "marks":
                trade.update(marks=event.get("marks"))
            elif kind == "image":
                image = {key: event.get(key) for key in ("path", "sim_time", "frame")}
                if event.get("markers"):
                    image["markers"] = event["markers"]  # Donde quedo en la imagen cada nivel o marca de la orden
                trade.setdefault("images", {})[event.get("kind")] = image
    return result


def r_multiple(trade):
    """Resultado neto de costos en unidades de riesgo. None sin stop o sin cierre."""
    if trade.get("status") != "closed" or not trade.get("stop") or trade.get("pnl") is None:
        return None
    fill = trade.get("fill_price") or trade.get("entry")
    risk = abs(fill - trade["stop"]) * trade.get("quantity", 0)
    return trade["pnl"] / risk if risk > 0 else None


def _overlap(range_start, range_end, move):
    """Parte del tramo mas corto que comparten el rango del usuario y el movimiento de la regla."""
    start, end = move["t0"] * 60000, move["t1"] * 60000
    shared = min(range_end, end) - max(range_start, start)
    shortest = min(range_end - range_start, end - start)
    return max(0.0, shared / shortest) if shortest > 0 else 0.0


def compare(trade):
    """Bloque por bloque: que marco quien opero, que leyo la regla y si coinciden."""
    reading = trade.get("reading") or {}
    if not reading.get("available"):
        return {"available": False, "missing": reading.get("missing")}

    marks = trade.get("marks") or {}
    reasons = set(marks.get("reasons") or [])
    want = "up" if trade["side"] == "long" else "down"
    rows = []

    for tf, key in ((240, "context4h"), (60, "context1h")):
        context = reading["context"].get(str(tf))
        state = context["state"] if context else None
        mark = marks.get(key)
        rows.append({
            "block": f"context_{tf}", "you": mark, "rule": state, "agree": mark == state if mark and state else None,
            "favor": None if state is None else "range" if state == "range" else "favor" if state == want else "against",
            "efficiency": context["efficiency"] if context else None, "up_volume": context["up_volume"] if context else None,
        })

    chosen = {tf: reading["moves"][tf]["chosen"] for tf in reading["moves"] if reading["moves"][tf]["chosen"]}
    marked_move = "volume" in reasons
    best = None
    for item in trade.get("ranges") or []:
        for tf, move in chosen.items():
            overlap = _overlap(item["start"], item["end"], move)
            if best is None or overlap > best["overlap"]:
                best = {"tf": tf, "overlap": overlap}
    rows.append({
        "block": "move", "you": marked_move or None, "rule": chosen or None,
        "agree": bool(chosen) if marked_move else None, "same_move": best,
        "same": best["overlap"] >= SAME_MOVE_OVERLAP if best else None,
    })

    entry = reading.get("entry") or {}
    marked_zone = sorted(reasons & {"profile", "fvg"})
    rows.append({
        "block": "zone", "you": marked_zone or None, "rule": entry.get("zone"), "gap": entry.get("gap"),
        "near": entry.get("near"), "chance": entry.get("chance"),
        "agree": bool(entry.get("near")) if marked_zone else None,
    })

    oi = reading.get("oi")
    marked_oi = "oi_up" in reasons
    rows.append({
        "block": "oi", "you": marked_oi or None, "rule": oi["dir"] if oi else None,
        "change": oi["change"] if oi else None, "rises": oi["rises"] if oi else None,
        "agree": oi["dir"] == "up" if marked_oi and oi else None,
    })

    rows.append({"block": "volume", "you": None, "rule": reading["volume"]["last_15m_ratio"], "agree": None})
    return {"available": True, "rows": rows}


def public_trade(trade):
    """Lo que puede ver quien opera: la lectura solo aparece cuando la orden termino."""
    public = {key: value for key, value in trade.items() if key not in ("reading", "event", "at")}
    public["created_at"] = trade.get("at")
    public["r"] = r_multiple(trade)
    if trade.get("status") in ("closed", "cancelled"):
        public["comparison"] = compare(trade)
    else:
        public.pop("images", None)
    return public


def list_trades(limit=50):
    ordered = sorted(trades().values(), key=lambda trade: trade.get("at", ""), reverse=True)
    return [public_trade(trade) for trade in ordered[:limit]]


# ==================== INFORME ====================

def _wilson(wins, count):
    if count == 0:
        return None, None
    z = 1.96
    share = wins / count
    denominator = 1 + z * z / count
    center = (share + z * z / (2 * count)) / denominator
    margin = z * math.sqrt(share * (1 - share) / count + z * z / (4 * count * count)) / denominator
    return max(0.0, center - margin), min(1.0, center + margin)


def _stats(group):
    count = len(group)
    wins = sum(1 for trade in group if trade.get("pnl", 0) > 0)
    results = [r_multiple(trade) for trade in group]
    results = [value for value in results if value is not None]
    low, high = _wilson(wins, count)
    return {
        "n": count, "wins": wins, "win_rate": wins / count if count else None, "win_low": low, "win_high": high,
        "r_count": len(results), "avg_r": sum(results) / len(results) if results else None,
        "net": sum(trade.get("pnl", 0) for trade in group),
    }


def _reading(trade):
    reading = trade.get("reading") or {}
    return reading if reading.get("available") else None


def _context_is(tf, kind):
    def check(trade):
        reading = _reading(trade)
        context = reading and reading["context"].get(tf)
        if not context:
            return None
        want = "up" if trade["side"] == "long" else "down"
        state = context["state"]
        return {"favor": state == want, "range": state == "range", "against": state not in (want, "range")}[kind]
    return check


def _has_move(tf):
    def check(trade):
        reading = _reading(trade)
        return bool(reading["moves"][tf]["chosen"]) if reading else None
    return check


def _zone_check(kind):
    def check(trade):
        reading = _reading(trade)
        entry = reading and reading.get("entry")
        if not entry:
            return None
        return bool(entry["near"]) and (kind is None or entry["zone"]["typ"] == kind)
    return check


def _oi_is(direction):
    def check(trade):
        reading = _reading(trade)
        oi = reading and reading.get("oi")
        return oi["dir"] == direction if oi else None
    return check


def _volume_favors(trade):
    reading = _reading(trade)
    context = reading and reading["context"].get("60")
    if not context:
        return None
    share = context["up_volume"] if trade["side"] == "long" else 1 - context["up_volume"]
    return share > 0.5


CONDITIONS = [
    ("ctx240_favor", "4 horas a favor de la orden", _context_is("240", "favor")),
    ("ctx240_range", "4 horas en consolidación", _context_is("240", "range")),
    ("ctx240_against", "4 horas en contra", _context_is("240", "against")),
    ("ctx60_favor", "1 hora a favor de la orden", _context_is("60", "favor")),
    ("ctx60_range", "1 hora en consolidación", _context_is("60", "range")),
    ("ctx60_against", "1 hora en contra", _context_is("60", "against")),
    ("move240", "Movimiento con volumen en 4 horas", _has_move("240")),
    ("move60", "Movimiento con volumen en 1 hora", _has_move("60")),
    ("move15", "Movimiento con volumen en 15 minutos", _has_move("15")),
    ("zone_near", "Entrada a 0.10% o menos de una zona", _zone_check(None)),
    ("zone_hvn", "Cerca de un cluster de volumen", _zone_check("HVN")),
    ("zone_fvg", "Cerca de un FVG", _zone_check("FVG")),
    ("oi_up", "OI creciendo", _oi_is("up")),
    ("oi_mixed", "OI mixto", _oi_is("mixed")),
    ("oi_down", "OI cayendo", _oi_is("down")),
    ("volume_favor", "Más volumen en velas a favor (contexto de 1 hora)", _volume_favors),
]


# Lo que la regla considera a favor: de aqui sale cuanto se repite y cuanto se rompe
RULE_PARTS = ("ctx240_favor", "ctx60_favor", "move240", "move60", "move15", "zone_near", "oi_up", "volume_favor")


def _habits(group):
    rows = []
    for key, label, check in CONDITIONS:
        if key in RULE_PARTS and group:
            rows.append({"id": key, "label": label, "share": sum(check(trade) is True for trade in group) / len(group)})
    rows.sort(key=lambda row: -row["share"])
    return rows


def _split(group, check):
    present, absent = [], []
    for trade in group:
        value = check(trade)
        if value is True:
            present.append(trade)
        elif value is False:
            absent.append(trade)
    return present, absent


def _condition_row(key, label, group, check):
    present, absent = _split(group, check)
    known = len(present) + len(absent)
    return {
        "id": key, "label": label, "known": known, "share": len(present) / known if known else None,
        "with": _stats(present), "without": _stats(absent),
    }


def _marked(reason):
    def check(trade):
        return reason in ((trade.get("marks") or {}).get("reasons") or [])
    return check


def _best_and_worst(group):
    """Que condiciones se repiten en el mejor tercio y faltan en el peor."""
    ranked = sorted((trade for trade in group if r_multiple(trade) is not None), key=r_multiple)
    third = len(ranked) // 3
    if third < 2:
        return []
    worst, best = ranked[:third], ranked[-third:]
    rows = []
    for key, label, check in CONDITIONS:
        top = [check(trade) for trade in best]
        bottom = [check(trade) for trade in worst]
        top, bottom = [v for v in top if v is not None], [v for v in bottom if v is not None]
        if top and bottom:
            rows.append({
                "id": key, "label": label, "best": sum(top) / len(top), "worst": sum(bottom) / len(bottom),
                "difference": sum(top) / len(top) - sum(bottom) / len(bottom),
            })
    rows.sort(key=lambda row: -abs(row["difference"]))
    return rows[:6]


def _agreement(group):
    """Cuantas veces la regla leyo lo mismo que quien opero, por bloque."""
    counts = {}
    for trade in group:
        comparison = compare(trade)
        for row in comparison.get("rows", []):
            if row["agree"] is None:
                continue
            item = counts.setdefault(row["block"], {"block": row["block"], "marked": 0, "agreed": 0})
            item["marked"] += 1
            item["agreed"] += bool(row["agree"])
    return list(counts.values())


def report(symbol=None, blind="all", include_rewound=False):
    """Informe de lo registrado: que condiciones se repiten y cuales acompañan los mejores resultados."""
    every = [trade for trade in trades().values() if not symbol or trade.get("symbol") == symbol]
    rewound = [trade for trade in every if trade.get("rewound")]
    scope = every if include_rewound else [trade for trade in every if not trade.get("rewound")]
    if blind == "only":
        scope = [trade for trade in scope if trade.get("blind")]
    elif blind == "none":
        scope = [trade for trade in scope if not trade.get("blind")]

    closed = [trade for trade in scope if trade["status"] == "closed"]
    # Una orden viva no aporta su lectura: el informe la revelaría antes de que termine
    finished = [trade for trade in scope if trade["status"] in ("closed", "cancelled")]
    read = [trade for trade in finished if _reading(trade)]
    entries = [_reading(trade)["entry"] for trade in read if _reading(trade).get("entry")]
    reasons = sorted({reason for trade in scope for reason in ((trade.get("marks") or {}).get("reasons") or [])})

    return {
        "counts": {
            "total": len(scope), "closed": len(closed), "open": sum(trade["status"] == "open" for trade in scope),
            "pending": sum(trade["status"] == "pending" for trade in scope),
            "cancelled": sum(trade["status"] == "cancelled" for trade in scope),
            "blind": sum(bool(trade.get("blind")) for trade in scope),
            "rewound": len(rewound), "without_reading": len(finished) - len(read),
        },
        "overall": _stats(closed),
        "small_sample": len(closed) < SMALL_SAMPLE,
        "conditions": [_condition_row(key, label, closed, check) for key, label, check in CONDITIONS],
        "habits": _habits(read),
        "marks": [_condition_row(reason, reason, closed, _marked(reason)) for reason in reasons],
        "agreement": _agreement(finished),
        "zones": {
            "orders": len(entries), "near": sum(bool(entry["near"]) for entry in entries),
            "chance": sum(entry["chance"] for entry in entries) / len(entries) if entries else None,
        },
        "best_worst": _best_and_worst(closed),
    }


# ==================== FECHA OCULTA ====================

def blind_start(symbol, first_ms, last_ms):
    """
    Fecha de inicio al azar dentro del tramo sin huecos del almacen, lejos de sus bordes y de las
    fechas ocultas ya usadas. Queda registrada para no repetirla.
    """
    span = footprint_store.continuous_days(symbol)
    if span is None:
        return {"timestamp": None, "reason": "No hay trades descargados para este símbolo."}

    def as_ms(day):
        return int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp() * 1000)

    day_ms = 86400000
    low = max(as_ms(span[0]), first_ms) + BLIND_MARGIN_START_DAYS * day_ms
    high = min(as_ms(span[1]), last_ms) - BLIND_MARGIN_END_DAYS * day_ms

    used = [event["time"] for event in _events() if event.get("event") == "blind" and event.get("symbol") == symbol]
    days = [
        day for day in range(low - low % day_ms + day_ms, high, day_ms)
        if all(abs(day - time) > BLIND_MIN_SEPARATION_DAYS * day_ms for time in used)
    ]
    if not days:
        return {"timestamp": None, "reason": "No quedan fechas sin usar en los datos descargados."}

    start = random.choice(days) + random.randrange(24) * 3600000
    _append({"event": "blind", "symbol": symbol, "time": start, "at": _now()})
    return {"timestamp": start}
