"""
Setups de Orderflows Unlocked como recetas: qué elementos de of_elements deben coincidir y cómo.

Un "consenso" al estilo de Strategic Flows, con las reglas sin futuro de App 1:
- threshold: al menos `min` casillas en la ventana; strict: todas. La vela que dispara debe aportar un voto.
- groups: cada grupo con su mínimo de casillas en la ventana.
- sequence: los grupos en orden; el último en la vela que dispara y los anteriores en velas previas.
- Un voto cuenta en la vela con la que se conoce el elemento (la VA abandonada, en la vela siguiente).
- Filtros: swing (mínimo o máximo de N velas hasta `flex` velas antes), momentum (EMA 14 con pendiente) y
  confirmación de entrada (el precio avanza `atr` ATR a favor dentro de `bars` velas; el setup se conoce ahí).

La evaluación corre la receta sobre el histórico ya ocurrido, con costos, contra la base de las velas del
mismo color con las mismas reglas de salida.
"""
import datetime as dt
import math

import of_elements as oe

MAX_SLOTS = 6
MAX_WINDOW = 5
EMA_PERIOD = 14
SLOPE_BARS = 3
SLOPE_ATR = 0.25
TAKER_FEE = 0.00055  # Por lado, como el bot y las órdenes de App 1


def clean_recipe(raw):
    """Receta válida con valores dentro de rango; None si no tiene casillas con códigos conocidos."""
    slots = []
    for slot in (raw.get("slots") or [])[:MAX_SLOTS]:
        codes = [c for c in (slot.get("codes") or []) if c in oe.CATALOG]
        if codes:
            slots.append({"codes": codes, "group": max(0, min(3, int(slot.get("group", 0) or 0)))})
    if not slots:
        return None
    mode = raw.get("mode") if raw.get("mode") in ("threshold", "strict", "groups", "sequence") else "strict"
    groups = sorted({s["group"] for s in slots})
    mins = raw.get("groupMins") or {}
    swing = raw.get("swing") or {}
    entry = raw.get("entry") or {}
    return {
        "id": str(raw.get("id") or "receta")[:60],
        "side": raw.get("side") if raw.get("side") in ("both", "long", "short") else "both",
        "mode": mode,
        "slots": slots,
        "min": max(1, min(len(slots), int(raw.get("min") or len(slots)))),
        "groups": groups,
        "groupMins": {g: max(1, int(mins.get(str(g), mins.get(g, 1)) or 1)) for g in groups},
        "window": max(1, min(MAX_WINDOW, int(raw.get("window") or 1))),
        "swing": {"on": bool(swing.get("on")), "bars": max(2, min(20, int(swing.get("bars") or 5))),
                  "flex": max(0, min(5, int(swing.get("flex") or 0))), "onSwing": bool(swing.get("onSwing"))},
        "momentum": bool(raw.get("momentum")),
        "entry": {"on": bool(entry.get("on")), "atr": max(0.05, min(3.0, float(entry.get("atr") or 0.25))),
                  "bars": max(1, min(5, int(entry.get("bars") or 2)))},
    }


def _series(bars):
    """EMA 14, su pendiente en ATR y el ATR 14 de cada vela."""
    ema, atr, slope, trs = [], [], [], []
    k = 2 / (EMA_PERIOD + 1)
    for i, b in enumerate(bars):
        ema.append(b["c"] if i == 0 else b["c"] * k + ema[-1] * (1 - k))
        prev = bars[i - 1]["c"] if i else b["c"]
        trs.append(max(b["h"] - b["l"], abs(b["h"] - prev), abs(b["l"] - prev)))
        window = trs[-14:]
        atr.append(sum(window) / len(window))
        slope.append((ema[i] - ema[i - SLOPE_BARS]) / atr[i] if i >= SLOPE_BARS and atr[i] > 0 else 0.0)
    return ema, atr, slope


def _votes(bars, events, tf_ms):
    """Por lado (1, -1): conjunto de códigos de cada vela, en la vela con la que se conocen."""
    index = {b["t"]: i for i, b in enumerate(bars)}
    votes = {1: [set() for _ in bars], -1: [set() for _ in bars]}
    for e in events:
        i = index.get(e["known"] - tf_ms)
        if i is not None and e["dir"] in votes:
            votes[e["dir"]][i].add(e["code"])
    return votes


def _hits(slot, votes_side, lo, hi):
    """Velas de [lo, hi] donde vota alguno de los códigos de la casilla."""
    codes = slot["codes"]
    return [j for j in range(lo, hi + 1) if any(c in votes_side[j] for c in codes)]


def _consensus(recipe, votes_side, i):
    """Velas que aportaron votos si la receta se cumple con disparo en la vela i; None si no."""
    lo = max(0, i - recipe["window"] + 1)
    slots = recipe["slots"]
    hits = [_hits(s, votes_side, lo, i) for s in slots]
    if not any(i in h for h in hits):
        return None  # La vela que dispara debe aportar su propio voto
    mode = recipe["mode"]
    if mode in ("threshold", "strict"):
        need = len(slots) if mode == "strict" else recipe["min"]
        return hits if sum(1 for h in hits if h) >= need else None
    if mode == "groups":
        for g in recipe["groups"]:
            if sum(1 for s, h in zip(slots, hits) if s["group"] == g and h) < recipe["groupMins"][g]:
                return None
        return hits
    # sequence: el último grupo en la vela que dispara; cada grupo anterior antes que el siguiente
    groups = recipe["groups"]
    last = groups[-1]
    if sum(1 for s, h in zip(slots, hits) if s["group"] == last and i in h) < recipe["groupMins"][last]:
        return None
    limit = i
    for g in reversed(groups[:-1]):
        member = [(s, h) for s, h in zip(slots, hits) if s["group"] == g]
        latest = [max([j for j in h if j < limit], default=None) for _, h in member]
        latest = [j for j in latest if j is not None]
        if len(latest) < recipe["groupMins"][g]:
            return None
        limit = min(sorted(latest, reverse=True)[:recipe["groupMins"][g]])
    return hits


def _swing_ok(recipe, bars, votes_side, d, i):
    sw = recipe["swing"]
    for s in range(max(0, i - sw["flex"]), i + 1):
        window = bars[max(0, s - sw["bars"] + 1):s + 1]
        if len(window) < sw["bars"]:
            continue
        extreme = bars[s]["l"] <= min(b["l"] for b in window) if d > 0 else bars[s]["h"] >= max(b["h"] for b in window)
        if extreme and (not sw["onSwing"] or any(any(c in votes_side[s] for c in slot["codes"]) for slot in recipe["slots"])):
            return True
    return False


def match_recipes(bars, events, recipes, tf_minutes):
    """Coincidencias de cada receta. Cada una lleva la hora en que se conoce."""
    tf_ms = int(tf_minutes) * 60000
    if not bars:
        return []
    votes = _votes(bars, events, tf_ms)
    ema, atr, slope = _series(bars)
    matches = []
    for recipe in recipes:
        sides = {"both": (1, -1), "long": (1,), "short": (-1,)}[recipe["side"]]
        for d in sides:
            last = -10 ** 9
            for i in range(len(bars)):
                if i - last < recipe["window"]:
                    continue
                hits = _consensus(recipe, votes[d], i)
                if hits is None:
                    continue
                if recipe["momentum"] and not (slope[i] * d >= SLOPE_ATR and (bars[i]["c"] - ema[i]) * d > 0):
                    continue
                if recipe["swing"]["on"] and not _swing_ok(recipe, bars, votes[d], d, i):
                    continue
                known = bars[i]["t"] + tf_ms
                entry_t = None
                if recipe["entry"]["on"]:
                    goal = bars[i]["c"] + d * recipe["entry"]["atr"] * atr[i]
                    for j in range(i + 1, min(len(bars), i + 1 + recipe["entry"]["bars"])):
                        if (d > 0 and bars[j]["h"] >= goal) or (d < 0 and bars[j]["l"] <= goal):
                            entry_t = bars[j]["t"]
                            break
                    if entry_t is None:
                        continue  # Sin confirmación todavía, o nunca: no se muestra
                    known = entry_t + tf_ms
                voted = sorted({(code, bars[j]["t"]) for slot, h in zip(recipe["slots"], hits) for j in h
                                for code in slot["codes"] if code in votes[d][j]}, key=lambda x: x[1])
                matches.append({"id": recipe["id"], "dir": d, "t": bars[i]["t"], "t0": voted[0][1] if voted else bars[i]["t"],
                                "known": known, "entry": entry_t, "votes": [list(v) for v in voted]})
                last = i
    return matches


def setups(symbol, interval_minutes, start_ms, end_ms, known_until_ms, recipes, target=oe.DEFAULT_TARGET,
           vol_filter=oe.DEFAULT_VOL_FILTER):
    """Coincidencias de las recetas con disparo entre start_ms y end_ms, conocidas antes de known_until_ms."""
    tf = int(interval_minutes)
    clean = [r for r in (clean_recipe(x) for x in recipes) if r]
    if not clean:
        return {"matches": [], "known_until": known_until_ms}
    pad = (MAX_WINDOW + 25) * tf * 60000  # Velas previas para ventana, swing y EMA
    result = oe.detect(symbol, tf, start_ms - pad, end_ms, known_until_ms, target, 0, vol_filter)
    matches = [m for m in match_recipes(result["bars"], result["events"], clean, tf) if m["t"] >= start_ms]
    return {"matches": matches, "known_until": result["known_until"], "warming": result["warming"]}


def _wilson(wins, n, z=1.96):
    if n == 0:
        return None, None
    p = wins / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return round(100 * (mid - half), 1), round(100 * (mid + half), 1)


def _trade(bars, atr, k, d, stop_atr, target_r, horizon):
    """R neto de entrar al cierre de la vela k; None si la salida todavía no se conoce."""
    entry = bars[k]["c"]
    risk = stop_atr * atr[k]
    if risk <= 0:
        return None
    stop, goal = entry - d * risk, entry + d * risk * target_r
    for j in range(k + 1, min(len(bars), k + 1 + horizon)):
        b = bars[j]
        hit_stop = b["l"] <= stop if d > 0 else b["h"] >= stop
        hit_goal = b["h"] >= goal if d > 0 else b["l"] <= goal
        if hit_stop or hit_goal:
            exit_price = stop if hit_stop else goal  # Si toca los dos en la misma vela cuenta el stop
            break
    else:
        if k + horizon >= len(bars):
            return None
        exit_price = bars[k + horizon]["c"]
    gross = (exit_price - entry) * d / risk
    return gross - TAKER_FEE * (entry + exit_price) / risk


CHUNK_DAYS = 60  # detect() no pasa de oe.MAX_RANGE_DAYS por pedido


def _detect_span(symbol, tf, start, end, target, vol_filter):
    """detect() en tramos seguidos, para rangos más largos que los que acepta de una vez."""
    bars, events, warming = [], [], False
    chunk_start = start
    while chunk_start < end:
        chunk_end = min(end, chunk_start + CHUNK_DAYS * oe.DAY_MS)
        # Cada tramo termina 1 ms antes del siguiente: una vela nunca sale dos veces
        part = oe.detect(symbol, tf, chunk_start, chunk_end - 1 if chunk_end < end else end, end, target, 0, vol_filter)
        last = bars[-1]["t"] if bars else None
        bars.extend(b for b in part["bars"] if last is None or b["t"] > last)
        events.extend(e for e in part["events"] if last is None or e["t"] > last)
        warming = warming or part["warming"]
        chunk_start = chunk_end
    return {"bars": bars, "events": events, "warming": warming}


def evaluate(symbol, interval_minutes, recipe_raw, known_until_ms, days=180, stop_atr=1.5, target_r=2.0, horizon=96,
             target=oe.DEFAULT_TARGET, vol_filter=oe.DEFAULT_VOL_FILTER, reserve_ms=None, validation=False):
    """
    La receta sobre los `days` días anteriores a known_until_ms, con salida por stop (ATR), objetivo (R) u
    horizonte, y comisión taker de entrada y salida. La base son las velas del mismo color, con las mismas reglas.

    reserve_ms separa las fechas de ajuste de las de comprobación. Sin `validation`, la ventana nunca pasa de
    reserve_ms: lo reservado no se mira mientras se ajusta la receta. Con `validation`, se evalúa todo lo
    reservado, desde reserve_ms hasta el último día del almacén, y lo pide un botón aparte que deja registro.
    """
    recipe = clean_recipe(recipe_raw)
    if recipe is None:
        return {"success": False, "message": "La receta no tiene elementos conocidos"}
    tf = int(interval_minutes)
    days = max(7, min(int(days), 730 if not validation else 2500))
    if validation:
        if reserve_ms is None:
            return {"success": False, "message": "Falta la fecha de corte de la comprobación"}
        last = oe.fs.coverage(symbol).get("last")
        if not last:
            return {"success": False, "message": "Sin días en el almacén"}
        known_until_ms = int(dt.datetime.fromisoformat(last).replace(tzinfo=dt.timezone.utc).timestamp() * 1000) + oe.DAY_MS
        start = max(int(reserve_ms), known_until_ms - 2500 * oe.DAY_MS)  # Todo lo reservado, no solo `days`
    else:
        if reserve_ms is not None:
            known_until_ms = min(known_until_ms, reserve_ms)
        start = known_until_ms - days * oe.DAY_MS
    if known_until_ms - start < 7 * oe.DAY_MS:
        return {"success": False, "message": "La ventana queda en menos de 7 días: la hora simulada está muy cerca de la fecha de corte"}
    result = _detect_span(symbol, tf, start, known_until_ms, target, vol_filter)
    bars = result["bars"]
    if len(bars) < 50:
        return {"success": False, "message": "Sin velas suficientes en el almacén para ese rango"}
    _, atr, _ = _series(bars)
    index = {b["t"]: i for i, b in enumerate(bars)}
    tf_ms = tf * 60000
    sides = {"both": (1, -1), "long": (1,), "short": (-1,)}[recipe["side"]]

    def summary(rs, years):
        rs = [r for r in rs if r is not None]
        n = len(rs)
        wins = sum(1 for r in rs if r > 0)
        by_year = {}
        for r, y in years:
            if r is not None:
                item = by_year.setdefault(y, [0, 0, 0.0])
                item[0] += 1
                item[1] += r > 0
                item[2] += r
        return {"n": n, "winRate": round(100 * wins / n, 1) if n else None, "wilson": _wilson(wins, n),
                "avgR": round(sum(rs) / n, 3) if n else None, "totalR": round(sum(rs), 2),
                "byYear": {y: {"n": v[0], "winRate": round(100 * v[1] / v[0], 1), "avgR": round(v[2] / v[0], 3)}
                           for y, v in sorted(by_year.items())}}

    trades, pending = [], 0
    for m in match_recipes(bars, result["events"], [recipe], tf):
        k = index.get(m["known"] - tf_ms)
        if k is None:
            continue
        r = _trade(bars, atr, k, m["dir"], stop_atr, target_r, horizon)
        if r is None:
            pending += 1
        year = dt.datetime.fromtimestamp(m["t"] / 1000, dt.timezone.utc).year
        trades.append((r, year))
    base = []
    for k in range(14, len(bars)):
        color = 1 if bars[k]["c"] > bars[k]["o"] else (-1 if bars[k]["c"] < bars[k]["o"] else 0)
        if color in sides:
            year = dt.datetime.fromtimestamp(bars[k]["t"] / 1000, dt.timezone.utc).year
            base.append((_trade(bars, atr, k, color, stop_atr, target_r, horizon), year))

    setup = summary([r for r, _ in trades], trades)
    baseline = summary([r for r, _ in base], base)
    return {"success": True, "recipe": recipe["id"], "days": days, "bars": len(bars), "pending": pending,
            "from": bars[0]["t"], "to": bars[-1]["t"], "validation": bool(validation),
            "rules": {"stopAtr": stop_atr, "targetR": target_r, "horizon": horizon, "fee": TAKER_FEE},
            "setup": setup, "baseline": baseline,
            "edgeR": round(setup["avgR"] - baseline["avgR"], 3) if setup["avgR"] is not None and baseline["avgR"] is not None else None,
            "warming": result["warming"], "smallSample": setup["n"] < 30}
