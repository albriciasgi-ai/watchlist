"""
Registro automatico de las operaciones y busqueda de patrones.

El registro del observador guarda los hechos de cada orden. Aqui se leen las medidas de esos momentos,
los dibujos y niveles que quien opera tomo de referencia, y el resultado en unidades de riesgo.
Como todo sale de la tabla de medidas, una orden vieja se puede recalcular y una regla se puede probar
en todo el historico con los mismos numeros.

Para no confundir casualidad con patron: cada entrada se compara con momentos sin entrada, y una
diferencia solo se marca si supera lo que da el azar al revisar todas las medidas juntas.
"""
import csv
import datetime as dt
import io
import math
import random
import zlib

import numpy as np

import measures
import observer

MINUTE = 60000
DAY = 86400000
NEAR_ATR = 0.25  # Una referencia a esta distancia cuenta como "en el nivel"
CONTROLS_PER_TRADE = 10
CONTROL_WINDOW_DAYS = 7
CONTROL_GAP_MINUTES = 120  # Un control no puede estar pegado a una entrada real
PERMUTATIONS = 300
SMALL_ENTRIES = 30
MIN_GROUP = 5
TAKER_FEE = 0.00055
MAX_CONDITIONS = 3
UNCOMPARED = {"hour"}  # Es una categoria: su orden numerico no significa nada
OPERATED_MARGIN = DAY


def _number(value, digits=4):
    return None if value is None or not math.isfinite(value) else round(float(value), digits)


def _side(trade):
    return 1 if trade["side"] == "long" else -1


# ==================== UNA ORDEN ====================

def order_measures(trade, atr):
    """Como se planteo la orden, en unidades comparables entre fechas."""
    side = _side(trade)
    entry, stop, target, market = (trade.get(key) for key in ("entry", "stop", "target", "market"))
    stop_distance = abs(entry - stop) if entry and stop else None
    return {
        "order_type": trade.get("type"),
        "stop_atr": _number(stop_distance / atr) if stop_distance and atr > 0 else None,
        "reward_risk": _number(abs(target - entry) / stop_distance) if target and stop_distance else None,
        "entry_gap_atr": _number(side * (market - entry) / atr) if market and entry and atr > 0 else None,
    }


def drawing_prices(drawing, time_ms):
    """Precios de un dibujo en un momento. Una linea de tendencia se prolonga hasta ese momento."""
    kind = drawing.get("type")
    if kind == "horizontal":
        return [("Línea horizontal", drawing["price"])]
    if kind == "trendline":
        span = drawing["time2"] - drawing["time1"]
        if span == 0:
            return []
        slope = (drawing["price2"] - drawing["price1"]) / span
        return [("Línea de tendencia", drawing["price1"] + slope * (time_ms - drawing["time1"]))]
    if kind == "rectangle":
        return [("Rectángulo, borde alto", drawing["high"]), ("Rectángulo, borde bajo", drawing["low"])]
    if kind == "fibonacci":
        return [(f"Fibonacci {level['label']}", level["price"]) for level in drawing.get("levels") or []]
    return []


# "data" (12/11/2026): un nivel guardado como dato, sin papel en el trade. Sigue siendo una referencia de precio
ROLE_NAMES = {"support": "Soporte", "resistance": "Resistencia", "entry": "Entrada", "target": "Objetivo", "data": "Solo dato"}
MARK_ONLY = ""  # Una marca elegida sin papel de nivel, como un rombo


def _role_gap(items, role, price, atr):
    """Distancia en ATR del precio de la orden al nivel con ese papel mas cercano."""
    gaps = [abs(item["price"] - price) for item in items if item.get("role") == role]
    return _number(min(gaps) / atr, 3) if gaps and price and atr > 0 else None


def references(trade, atr):
    """Niveles elegidos y dibujos de referencia, medidos desde la entrada. Una marca sin papel no es un nivel."""
    side = _side(trade)
    entry = trade.get("entry") or trade.get("market")
    items = []
    for level in trade.get("levels") or []:
        if level.get("role") == MARK_ONLY or level.get("price") is None:
            continue
        item = {"origin": "level", "label": f"{level.get('kind')} · {level.get('source')}", "price": level["price"]}
        if level.get("role") in ROLE_NAMES:
            item["role"] = ROLE_NAMES[level["role"]]
        items.append(item)
    for drawing in trade.get("drawings") or []:
        for label, price in drawing_prices(drawing, trade["time"]):
            items.append({"origin": "drawing", "label": label, "price": price})

    if not items or not entry or atr <= 0:
        return {"items": items, "ref_count": len(items)}

    for item in items:
        item["distance_atr"] = _number(side * (entry - item["price"]) / atr, 3)  # Positivo: detras de la entrada

    distances = [item["distance_atr"] for item in items]
    behind = [value for value in distances if value >= 0]
    ahead = [-value for value in distances if value < 0]
    nearest = min(items, key=lambda item: abs(item["distance_atr"]))
    stop, target = trade.get("stop"), trade.get("target")
    return {
        "items": items,
        "ref_count": len(items),
        "ref_levels": sum(item["origin"] == "level" for item in items),
        "ref_drawings": sum(item["origin"] == "drawing" for item in items),
        "ref_nearest_atr": abs(nearest["distance_atr"]),
        "ref_nearest_label": nearest["label"],
        "ref_behind_atr": min(behind) if behind else None,
        "ref_ahead_atr": min(ahead) if ahead else None,
        "ref_at_entry": abs(nearest["distance_atr"]) <= NEAR_ATR,
        "ref_stop_behind": side * (entry - stop) / atr > min(behind) if stop and behind else None,
        "ref_target_at": any(abs(item["price"] - target) / atr <= NEAR_ATR for item in items) if target else None,
        "ref_entry_atr": _role_gap(items, "Entrada", entry, atr),
        "ref_target_atr": _role_gap(items, "Objetivo", target, atr),
    }


def outcome(trade, table):
    """Resultado en unidades de riesgo, lo maximo a favor y en contra, y cuanto tardo cada parte."""
    fill_time, fill_price = trade.get("fill_time"), trade.get("fill_price")
    result = {
        "filled": fill_time is not None,
        "wait_minutes": _number((fill_time - trade["time"]) / MINUTE, 1) if fill_time else None,
        "r": _number(observer.r_multiple(trade)),
        "pnl": trade.get("pnl"),
        "exit_reason": trade.get("exit_reason"),
        "duration_minutes": None, "best_r": None, "worst_r": None,
    }
    exit_time, exit_price, stop = trade.get("exit_time"), trade.get("exit_price"), trade.get("stop")
    if not fill_time or not exit_time:
        return result
    result["duration_minutes"] = _number((exit_time - fill_time) / MINUTE, 1)
    risk = abs((fill_price or trade.get("entry")) - stop) if stop else None
    if not risk or table is None or "m5_time" not in table:
        return result

    side = _side(trade)
    start = fill_price or trade.get("entry")
    first = int(np.searchsorted(table["m5_time"], fill_time, side="left"))
    last = int(np.searchsorted(table["m5_time"], exit_time - 5 * MINUTE, side="right"))
    highs = np.r_[table["m5_high"][first:last], start, exit_price]
    lows = np.r_[table["m5_low"][first:last], start, exit_price]
    best, worst = (highs.max(), lows.min()) if side > 0 else (lows.min(), highs.max())
    result["best_r"] = _number(side * (best - start) / risk, 3)
    result["worst_r"] = _number(side * (worst - start) / risk, 3)
    return result


def reading(trade, table=None):
    """Todo lo automatico de una orden. Las medidas solo usan lo cerrado antes de cada momento."""
    symbol = trade["symbol"]
    if table is None:
        table = measures.table_for(symbol, trade["time"])
    if table is None:
        return {"available": False, "status": measures.status(symbol)}
    row = measures.row_at(table, trade["time"])
    if row is None:
        return {"available": False, "status": "outside"}

    side = _side(trade)
    atr = float(table["atr"][row])
    result = {
        "available": True,
        "decision_candle": int(table["close_time"][row]),
        "decision": measures.read_row(table, row, side),
        "order": order_measures(trade, atr),
        "references": references(trade, atr),
        "outcome": outcome(trade, table),
    }
    fill_time = trade.get("fill_time")
    fill_row = measures.row_at(table, fill_time) if fill_time else None
    if fill_row is not None and fill_row != row:
        result["fill"] = measures.read_row(table, fill_row, side)
        result["fill_candle"] = int(table["close_time"][fill_row])
    return result


def orders(limit=50):
    """Ordenes registradas. Las medidas, igual que la lectura de la regla, aparecen cuando la orden termina."""
    public = observer.list_trades(limit)
    for trade in public:
        if trade.get("status") in ("closed", "cancelled"):
            trade["automatic"] = reading(trade)
    return public


# ==================== PATRONES ====================

def _ended(trade):
    return trade.get("status") in ("closed", "cancelled")


def _scope(symbol, blind, include_rewound):
    group = [trade for trade in observer.trades().values() if trade.get("symbol") == symbol and _ended(trade)]
    if not include_rewound:
        group = [trade for trade in group if not trade.get("rewound")]
    if blind == "only":
        group = [trade for trade in group if trade.get("blind")]
    elif blind == "none":
        group = [trade for trade in group if not trade.get("blind")]
    return group


def control_rows(table, group, until=None):
    """
    Momentos sin entrada cerca de cada orden: misma semana, mismo lado y lejos de toda entrada real.
    Cada orden siempre recibe los mismos, para que el informe no cambie al repetirlo.
    Con until, solo momentos que la corrida ya vivió.
    """
    close_time = table["close_time"]
    decisions = np.array(sorted(trade["time"] for trade in group), dtype=np.int64)
    gap = CONTROL_GAP_MINUTES * MINUTE
    result = []
    for trade in group:
        first = int(np.searchsorted(close_time, trade["time"] - CONTROL_WINDOW_DAYS * DAY))
        end = trade["time"] + CONTROL_WINDOW_DAYS * DAY
        last = int(np.searchsorted(close_time, min(end, until) if until else end))
        candidates = np.arange(first, last)
        if len(candidates) == 0:
            continue
        nearest = np.searchsorted(decisions, close_time[candidates])
        left = np.abs(close_time[candidates] - decisions[np.maximum(nearest - 1, 0)])
        right = np.abs(close_time[candidates] - decisions[np.minimum(nearest, len(decisions) - 1)])
        candidates = candidates[np.minimum(left, right) > gap]
        chooser = random.Random(zlib.crc32(str(trade["id"]).encode()))
        picks = chooser.sample(candidates.tolist(), min(CONTROLS_PER_TRADE, len(candidates)))
        result += [measures.read_row(table, int(index), _side(trade)) for index in picks]
    return result


def _ranks(values):
    unique, inverse, counts = np.unique(values, return_inverse=True, return_counts=True)
    ends = np.cumsum(counts)
    return (ends - (counts - 1) / 2)[inverse]


def _share(rank_sum, n, m):
    """De cada par de un dato de cada grupo, en cuantos el primero es mayor. 0.5 es no distinguirlos."""
    return (rank_sum - n * (n + 1) / 2) / (n * m)


def compare_groups(first, second, keys, labels, seed=7):
    """
    Que medidas separan dos grupos. El umbral sale de repartir los datos al azar muchas veces y mirar
    la mayor diferencia de todas las medidas: lo que lo supera no se explica por haber mirado tantas.
    """
    rng = np.random.default_rng(seed)
    rows, noise = [], []
    for key in keys:
        a = np.array([row[key] for row in first if row.get(key) is not None], dtype=float)
        b = np.array([row[key] for row in second if row.get(key) is not None], dtype=float)
        if len(a) < MIN_GROUP or len(b) < MIN_GROUP or len(np.unique(np.r_[a, b])) < 2:
            continue
        n, m = len(a), len(b)
        ranks = _ranks(np.r_[a, b])
        shuffled = np.argsort(rng.random((PERMUTATIONS, n + m)), axis=1)[:, :n]
        noise.append(np.abs(_share(ranks[shuffled].sum(axis=1), n, m) - 0.5))
        share = float(_share(ranks[:n].sum(), n, m))
        rows.append({
            "key": key, "label": labels[key][0], "group": labels[key][1], "first": n, "second": m,
            "first_median": _number(np.median(a)), "second_median": _number(np.median(b)), "share": round(share, 3),
        })

    threshold = float(np.percentile(np.max(noise, axis=0), 95)) if noise else None
    for row in rows:
        row["clear"] = abs(row["share"] - 0.5) > threshold
    rows.sort(key=lambda row: -abs(row["share"] - 0.5))
    return {"rows": rows, "threshold": _number(threshold, 3)}


def _labels():
    labels = {key: (label, group) for key, label, group, _ in measures.MEASURES}
    labels.update({
        "stop_atr": ("Stop (ATR)", "La orden"), "reward_risk": ("Riesgo beneficio", "La orden"),
        "entry_gap_atr": ("Entrada mejor que el mercado (ATR)", "La orden"),
        "ref_nearest_atr": ("Referencia más cercana (ATR)", "Referencias"),
        "ref_behind_atr": ("Referencia detrás de la entrada (ATR)", "Referencias"),
        "ref_ahead_atr": ("Referencia delante de la entrada (ATR)", "Referencias"),
        "ref_count": ("Referencias marcadas", "Referencias"),
        "ref_entry_atr": ("Entrada contra tu nivel de entrada (ATR)", "Referencias"),
        "ref_target_atr": ("Objetivo contra tu nivel objetivo (ATR)", "Referencias"),
    })
    return labels


def report(symbol, blind="all", include_rewound=False, until=None):
    """Que distingue tus entradas de los momentos sin entrada, y las ganadoras de las perdedoras."""
    group = _scope(symbol, blind, include_rewound)
    table = measures.table_for(symbol, max((trade["time"] for trade in group), default=None))
    if table is None:
        return {"status": measures.status(symbol)}

    items = []
    for trade in group:
        automatic = reading(trade, table)
        if automatic.get("available"):
            items.append({
                "trade": trade, "decision": automatic["decision"], "order": automatic["order"],
                "references": automatic["references"], "result": automatic["outcome"]["r"],
            })

    labels = _labels()
    keys = [item[0] for item in measures.MEASURES if item[0] not in UNCOMPARED]
    decisions = [item["decision"] for item in items]
    controls = control_rows(table, [item["trade"] for item in items], until) if items else []

    def full_row(item):
        extra = {key: value for key, value in item["references"].items() if isinstance(value, (int, float)) and not isinstance(value, bool)}
        return {**item["decision"], **item["order"], **extra}

    closed = [item for item in items if item["result"] is not None]
    winners = [full_row(item) for item in closed if item["result"] > 0]
    losers = [full_row(item) for item in closed if item["result"] <= 0]
    with_order = keys + ["stop_atr", "reward_risk", "entry_gap_atr", "ref_nearest_atr", "ref_behind_atr", "ref_ahead_atr", "ref_count", "ref_entry_atr", "ref_target_atr"]

    marked = [item for item in items if item["references"].get("ref_count")]
    at_level = [item for item in closed if item["references"].get("ref_at_entry")]
    away = [item for item in closed if item["references"].get("ref_count") and not item["references"].get("ref_at_entry")]

    def wins(rows):
        return sum(row["result"] > 0 for row in rows) / len(rows) if rows else None

    return {
        "status": "ready",
        "symbol": symbol,
        "counts": {"entries": len(items), "controls": len(controls), "closed": len(closed), "winners": len(winners), "losers": len(losers)},
        "small_sample": len(items) < SMALL_ENTRIES,
        "entries": compare_groups(decisions, controls, keys, labels),
        "results": compare_groups(winners, losers, with_order, labels, seed=8),
        "references": {
            "with_reference": len(marked), "closed_at_level": len(at_level), "closed_away": len(away),
            "win_at_level": wins(at_level), "win_away": wins(away),
        },
    }


# ==================== REGISTRO EN TABLA ====================

def _iso(time_ms):
    return dt.datetime.fromtimestamp(time_ms / 1000, dt.timezone.utc).isoformat(timespec="minutes") if time_ms else ""


def export_csv(symbol, hide_dates=False):
    """Una fila por orden, con sus hechos, sus medidas al decidir y al llenarse, y su resultado."""
    table = measures.table_for(symbol)
    keys = [item[0] for item in measures.MEASURES]
    head = ["id", "sesion", "decision_utc", "marco", "lado", "tipo", "entrada", "stop", "objetivo", "mercado", "estado", "llenado_utc",
            "precio_llenado", "cierre_utc", "precio_cierre", "motivo_cierre", "pnl", "r", "mejor_r", "peor_r", "minutos_en_trade", "minutos_de_espera",
            "fecha_oculta", "retroceso", "stop_atr", "riesgo_beneficio", "mejora_entrada_atr", "referencias", "referencia_cercana", "referencia_cercana_atr",
            "en_referencia", "stop_detras_de_referencia", "objetivo_en_referencia", "entrada_contra_nivel_atr", "objetivo_contra_nivel_atr"]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(head + keys + [f"llenado_{key}" for key in keys])

    group = [trade for trade in observer.trades().values() if trade.get("symbol") == symbol]
    masked = [trade for trade in group if hide_dates and trade.get("blind")]  # Al final: su lugar acotaria la fecha
    trades = sorted((trade for trade in group if trade not in masked), key=lambda trade: trade["time"]) + masked
    for trade in trades:
        automatic = reading(trade, table) if table is not None and _ended(trade) else {}
        date = (lambda _: "") if hide_dates and trade.get("blind") else _iso
        order = automatic.get("order") or {}
        refs = automatic.get("references") or {}
        result = automatic.get("outcome") or {}
        decision = automatic.get("decision") or {}
        fill = automatic.get("fill") or decision
        writer.writerow([
            trade["id"], trade.get("session"), date(trade["time"]), trade.get("timeframe"), trade["side"], trade.get("type"), trade.get("entry"),
            trade.get("stop"), trade.get("target"), trade.get("market"), trade.get("status"), date(trade.get("fill_time")), trade.get("fill_price"),
            date(trade.get("exit_time")), trade.get("exit_price"), trade.get("exit_reason"), trade.get("pnl"), result.get("r"), result.get("best_r"),
            result.get("worst_r"), result.get("duration_minutes"), result.get("wait_minutes"), bool(trade.get("blind")), bool(trade.get("rewound")),
            order.get("stop_atr"), order.get("reward_risk"), order.get("entry_gap_atr"), refs.get("ref_count"), refs.get("ref_nearest_label"),
            refs.get("ref_nearest_atr"), refs.get("ref_at_entry"), refs.get("ref_stop_behind"), refs.get("ref_target_at"),
            refs.get("ref_entry_atr"), refs.get("ref_target_atr"),
        ] + [decision.get(key) for key in keys] + [fill.get(key) for key in keys])
    return output.getvalue()


# ==================== REGLAS EN EL HISTORICO ====================

def operated_spans(symbol):
    """Fechas ya operadas, por sesion: una regla sacada de ellas no se puede probar en ellas."""
    sessions = {}
    for trade in observer.trades().values():
        if trade.get("symbol") != symbol:
            continue
        times = [trade["time"]] + [trade[key] for key in ("fill_time", "exit_time", "cancel_time") if trade.get(key)]
        first, last = sessions.get(trade.get("session"), (min(times), max(times)))
        sessions[trade.get("session")] = (min(first, min(times)), max(last, max(times)))
    return [(first - OPERATED_MARGIN, last + OPERATED_MARGIN) for first, last in sessions.values()]


def _simulate(table, rows, side, stop_atr, target_r, horizon):
    """Resultado neto en unidades de riesgo. Si stop y objetivo caen en la misma vela, cuenta el stop."""
    high, low, close, atr = table["high"], table["low"], table["close"], table["atr"]
    results = []
    for row in rows:
        end = row + horizon
        entry, risk = close[row], stop_atr * atr[row]
        if end >= len(close) or not risk > 0:
            continue
        stop = entry - side * risk
        target = entry + side * target_r * risk
        span_high, span_low = high[row + 1:end + 1], low[row + 1:end + 1]
        stopped = np.nonzero(span_low <= stop if side > 0 else span_high >= stop)[0]
        reached = np.nonzero(span_high >= target if side > 0 else span_low <= target)[0]
        first_stop = stopped[0] if len(stopped) else horizon
        first_target = reached[0] if len(reached) else horizon
        if len(stopped) and first_stop <= first_target:
            gross = -1.0
        elif len(reached):
            gross = target_r
        else:
            gross = side * (close[end] - entry) / risk
        results.append((row, gross - 2 * TAKER_FEE * entry / risk))
    return results


def _spaced(rows, cooldown):
    chosen, last = [], -cooldown
    for row in rows:
        if row - last >= cooldown:
            chosen.append(int(row))
            last = row
    return chosen


def _summary(results):
    values = np.array([value for _, value in results], dtype=float)
    count = len(values)
    if count == 0:
        return {"signals": 0, "win_rate": None, "win_low": None, "win_high": None, "avg_r": None, "avg_low": None, "avg_high": None, "total_r": 0.0}
    wins = int((values > 0).sum())
    low, high = observer._wilson(wins, count)
    margin = 1.96 * values.std(ddof=1) / math.sqrt(count) if count > 1 else 0.0
    return {
        "signals": count, "win_rate": wins / count, "win_low": low, "win_high": high, "avg_r": float(values.mean()),
        "avg_low": float(values.mean() - margin), "avg_high": float(values.mean() + margin), "total_r": float(values.sum()),
    }


def rule_test(symbol, conditions, side="both", stop_atr=1.5, target_r=2.0, horizon=96, cooldown=16, until=None):
    """Cuantas veces se habria cumplido una regla en fechas no operadas, y que paso despues."""
    table = measures.table_for(symbol)
    if table is None:
        return {"status": measures.status(symbol)}
    catalog = {item[0]: item for item in measures.MEASURES}
    if not 1 <= len(conditions) <= MAX_CONDITIONS:
        raise ValueError(f"Una regla lleva entre 1 y {MAX_CONDITIONS} condiciones")
    for condition in conditions:
        if condition.get("key") not in catalog or condition.get("op") not in (">=", "<="):
            raise ValueError("Condición inválida")
        if not isinstance(condition.get("value"), (int, float)):
            raise ValueError("Cada condición necesita un valor")
    if side not in ("long", "short", "both") or stop_atr <= 0 or target_r <= 0 or horizon < 1 or cooldown < 1:
        raise ValueError("Parámetros inválidos")

    close_time = table["close_time"]
    # Con until, solo señales cuyo resultado ya ocurrió en la corrida
    allowed = close_time + horizon * 15 * MINUTE <= until if until else np.ones(len(close_time), dtype=bool)
    spans = operated_spans(symbol)
    for first, last in spans:
        allowed &= (close_time < first) | (close_time > last)

    signals, base = [], []
    for direction in ((1, -1) if side == "both" else (1,) if side == "long" else (-1,)):
        mask = allowed.copy()
        for condition in conditions:
            values = measures.column(table, catalog[condition["key"]], direction)
            mask &= (values >= condition["value"]) if condition["op"] == ">=" else (values <= condition["value"])
        signals += _simulate(table, _spaced(np.nonzero(mask)[0], cooldown), direction, stop_atr, target_r, horizon)
        base += _simulate(table, _spaced(np.nonzero(allowed)[0], cooldown), direction, stop_atr, target_r, horizon)

    years = {}
    for row, value in signals:
        year = dt.datetime.fromtimestamp(int(close_time[row]) / 1000, dt.timezone.utc).year
        years.setdefault(year, []).append((row, value))

    summary = _summary(signals)
    reference = _summary(base)
    difference = summary["avg_r"] - reference["avg_r"] if summary["signals"] and reference["signals"] else None
    return {
        "status": "ready", **summary, "base": reference, "difference_r": difference, "small_sample": summary["signals"] < SMALL_ENTRIES,
        "excluded_periods": len(spans), "first": int(close_time[0]), "last": int(close_time[-1]),
        "years": [{"year": year, **_summary(rows)} for year, rows in sorted(years.items())],
    }
