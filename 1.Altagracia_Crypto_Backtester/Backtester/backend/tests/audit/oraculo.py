"""
Oráculo A del protocolo de pruebas (21/11/2026): el ciclo de un trade según `pruebas_backtesting/ESPECIFICACION_CICLO_TRADE.md`.

Escrito desde la especificación, sin importar ni copiar `rule_tester.simulate`. Además del modo de la especificación
(`VARIANT_SPEC`), trae interruptores para medir decisiones de diseño:
  h4             en la vela del llenado, "a favor" y "en contra" solo con los precios posteriores al llenado
  h5             limit llenada en la apertura si la vela abrió más allá; objetivo saltado sale en la apertura
  fillbar_target el objetivo cuenta en la vela del llenado, después del llenado
  h12            si los minutos no muestran el toque que sí muestra la vela, se usa el recorrido supuesto

También: ATR de 14 velas y un lector propio de los minutos del almacén (sin pasar por footprint_store).
"""
import datetime as dt
import os
from pathlib import Path

import numpy as np

STORE = Path(os.environ.get("ORDERFLOW_STORE", r"C:\Users\inven\OrderFlowData\store"))
DAY_MS = 86400000
SIX_HOURS = 6 * 3600000
# h4 y o05: desde el motor 6 (etapa 7), la regla del motor (lo a favor desde el llenado; el alcance, 300 velas desde la
# siguiente al llenado). Con h4 y o05 en False, la especificación de antes, la de los 64 casos de respuesta conocida
VARIANT_SPEC = {"h4": True, "h5": False, "fillbar_target": False, "h12": False, "o05": True}
REACH_BARS = 300
MIN_TARGET_R = 0.3


def atr14(H, L, C):
    """Media simple de los últimos 14 rangos verdaderos (menos al principio). El primero usa su propio cierre."""
    out, trs = [], []
    for i in range(len(C)):
        prev = C[i - 1] if i else C[i]
        trs.append(max(H[i] - L[i], abs(H[i] - prev), abs(L[i] - prev)))
        window = trs[-14:]
        out.append(sum(window) / len(window))
    return out


class MinuteReader:
    """Minutos (hora en ms, alto, bajo) del almacén de trades, leídos de sus archivos diarios .npz."""

    def __init__(self, symbol, root=STORE, keep=64):
        self.symbol, self.root, self.keep, self.days = symbol, Path(root), keep, {}

    def _day(self, day_ms):
        if day_ms in self.days:
            return self.days[day_ms]
        d = dt.datetime.fromtimestamp(day_ms / 1000, dt.timezone.utc)
        path = self.root / self.symbol / f"{d.year}" / f"{self.symbol}_{d:%Y-%m-%d}.npz"
        data = None
        if path.exists():
            with np.load(path, allow_pickle=False) as z:
                scale = float(z["info"][0])
                data = (z["m"].astype(np.int64), z["h"].astype(float) / scale, z["l"].astype(float) / scale)
        self.days[day_ms] = data
        if len(self.days) > self.keep:
            self.days.pop(next(iter(self.days)))
        return data

    def __call__(self, t0_ms, t1_ms):
        """Minutos con inicio en [t0_ms, t1_ms)."""
        out = []
        day = t0_ms - t0_ms % DAY_MS
        while day < t1_ms:
            data = self._day(day)
            if data is not None:
                m, h, l = data
                lo = int(np.searchsorted(m, t0_ms // 60000, side="left"))
                hi = int(np.searchsorted(m, (t1_ms - 1) // 60000, side="right"))
                out.extend((int(m[i]) * 60000, float(h[i]), float(l[i])) for i in range(lo, hi))
            day += DAY_MS
        return out


class Bars:
    def __init__(self, tf, T, O, H, L, C, atr, minutes=None, gap_ms=None):
        self.tf, self.tf_ms = tf, tf * 60000
        self.T, self.O, self.H, self.L, self.C, self.atr = T, O, H, L, C, atr
        self.n = len(T)
        self.minutes = minutes  # función (t0_ms, t1_ms) -> [(t, h, l)] o None
        self.gap = gap_ms if gap_ms is not None else max(SIX_HOURS, 2 * self.tf_ms)

    def assumed(self, j):
        o, h, l, c = self.O[j], self.H[j], self.L[j], self.C[j]
        points = (o, h, l, c) if h - o < o - l else (o, l, h, c)
        return [(self.T[j] + i, p, p) for i, p in enumerate(points)]

    def path(self, j):
        """(minutos, son_reales)."""
        if self.minutes is not None:
            got = self.minutes(self.T[j], self.T[j] + self.tf_ms)
            if got:
                return got, True
        return self.assumed(j), False


def _beyond(price, level, side):
    """El precio pasó el nivel a favor del lado (largo: arriba)."""
    return (price - level) * side > 0


def _pivot_unique(values, lo, hi, p, side):
    window = values[lo:hi + 1]
    extreme = min(window) if side > 0 else max(window)
    return values[p] == extreme and window.count(extreme) == 1


def stop_level(b, rule, k, side, zone, i0, entry):
    st, atr = rule["stop"], b.atr[k]
    buf = st.get("buffer", 0.1) * atr
    kind = st["type"]
    if kind == "atr":
        return entry - side * st["atr"] * atr
    if kind == "zone" and zone is not None:
        return zone[0] - buf if side > 0 else zone[1] + buf
    if kind == "swing":
        N = st["bars"]
        vals = b.L if side > 0 else b.H
        p, checked = k - N, 0
        while checked < 6 and p >= N:
            found = None
            q = p
            while q >= max(N, p - 200):
                if q + N < b.n and _pivot_unique(vals, q - N, q + N, q, side):
                    found = q
                    break
                q -= 1
            if found is None:
                break
            checked += 1
            if (entry - vals[found]) * side > 0:
                return vals[found] - side * buf
            p = found - 1
        first = max(0, k - 4 * N)
        return (min(b.L[first:k + 1]) - buf) if side > 0 else (max(b.H[first:k + 1]) + buf)
    first = max(0, min(k, i0 if i0 is not None else k))
    return (min(b.L[first:k + 1]) - buf) if side > 0 else (max(b.H[first:k + 1]) + buf)


def simulate(b, rule, sig, opposite=None, exit_at=None, vpa_exit=None, chain_on=None, level_target=None,
             taker=0.00055, maker=0.0002, variant=None):
    """Un trade. sig: {k, side, zone, i0, expiry, sides}. Devuelve None, {"skip"}, {"open"} o el trade."""
    v = {**VARIANT_SPEC, **(variant or {})}
    k, side, zone, i0 = sig["k"], sig["side"], sig.get("zone"), sig.get("i0")
    T, O, H, L, C, A = b.T, b.O, b.H, b.L, b.C, b.atr
    e = k + 1
    if e >= b.n or T[e] - T[k] > b.gap:
        return None
    ent, ex = rule["entry"], rule["exit"]
    entry, entry_i, fee_in, order = O[e], e, taker, "market"
    limit_fill = stop_fill = False
    etype = ent["type"]
    if etype == "straddle":
        off = ent["offset"] * A[k]
        if ent.get("from") == "zone" and zone is not None:
            up, dn = zone[1] + off, zone[0] - off
        else:
            up, dn = C[k] + off, C[k] - off
        allowed = tuple(sig.get("sides") or (1, -1))
        filled = None
        for j in range(e, min(b.n, e + ent["expiry"])):
            hits = [s for s in allowed if (H[j] >= up if s > 0 else L[j] <= dn)]
            if not hits:
                continue
            if len(hits) == 2:
                first = None
                for _, mh, ml in b.path(j)[0]:
                    a, z = mh >= up, ml <= dn
                    if a or z:
                        first = 1 if a and not z else (-1 if z and not a else None)
                        break
                if first is None:
                    first = 1 if abs(up - O[j]) <= abs(O[j] - dn) else -1
                hits = [first]
            s = hits[0]
            level = up if s > 0 else dn
            price = O[j] if _beyond(O[j], level, s) else level
            filled = (s, price, j)
            break
        if filled is None:
            return {"skip": "ninguna orden stop se llenó"}
        side, entry, entry_i = filled
        stop_fill, order = entry != O[entry_i], "stop"
    elif etype == "stop":
        off = ent.get("offset", 0.0) * A[k]
        if zone is None or ent.get("from") == "close":
            level, cancel = C[k] + side * off, None
        else:
            level = (zone[1] if side > 0 else zone[0]) + side * off
            cancel = (zone[0] if side > 0 else zone[1]) if ent.get("cancel") and zone[1] > zone[0] else None
        # Desde el motor 6 (F-06): una espera de 0 velas es no esperar, y la orden del 3.er sabio se llena al pasar el fractal
        wait = sig["expiry"] if sig.get("expiry") is not None else ent["expiry"]
        strict = sig.get("wise") == 3
        filled = None
        for j in range(e, min(b.n, e + wait)):
            hit = ((H[j] > level) if side > 0 else (L[j] < level)) if strict else ((H[j] >= level) if side > 0 else (L[j] <= level))
            broke = cancel is not None and (L[j] < cancel if side > 0 else H[j] > cancel)
            if not hit:
                if broke:
                    break
                continue
            if broke:
                first = None
                for _, mh, ml in b.path(j)[0]:
                    up_, dn_ = (mh >= level, ml < cancel) if side > 0 else (ml <= level, mh > cancel)
                    if up_ or dn_:
                        first = "fill" if up_ and not dn_ else ("cancel" if dn_ and not up_ else None)
                        break
                if first is None:
                    first = "fill" if abs(level - O[j]) <= abs(O[j] - cancel) else "cancel"
                if first == "cancel":
                    break
            filled = ((O[j] if _beyond(O[j], level, side) else level), j)
            break
        if filled is None:
            return {"skip": "orden stop sin llenar"}
        entry, entry_i = filled
        stop_fill, order = entry != O[entry_i], "stop"
    elif etype == "limit" and zone is not None:
        share = {"near": 1.0, "mid": 0.5, "far": 0.0}[ent["at"]]
        price = zone[0] + share * (zone[1] - zone[0]) if side > 0 else zone[1] - share * (zone[1] - zone[0])
        if (O[e] - price) * side > 0:
            got = None
            for j in range(e, min(b.n, e + ent["expiry"])):
                if (L[j] < price) if side > 0 else (H[j] > price):
                    fill = price
                    if v["h5"] and j > e and (O[j] - price) * side < 0:
                        fill = O[j]  # Abrió más allá de la limit: se llena en la apertura
                    got = (fill, j)
                    break
            if got is None:
                return {"skip": "limit sin llenar"}
            entry, entry_i = got
            fee_in, order, limit_fill = maker, "limit", True
    fill_bar_kind = limit_fill or stop_fill
    if isinstance(opposite, dict):  # Con dos órdenes el lado se sabe al llenarse
        opposite = opposite.get(-side)
    stop = stop_level(b, rule, k, side, zone, i0, entry)
    risk = (entry - stop) * side if stop is not None else 0
    if risk <= 0:
        return {"skip": "stop del lado equivocado"}
    stop_atr = risk / A[k] if A[k] > 0 else 0
    if stop_atr < rule["stop"]["minAtr"]:
        return {"skip": "stop muy corto"}
    if stop_atr > rule["stop"]["maxAtr"]:
        return {"skip": "stop muy largo"}
    # Desde el motor 6 (etapa 7, H18): el tope de la comisión de ida y vuelta en R (0.3 si la regla no lo trae; 0 lo apaga)
    fee_cap = rule.get("maxFeeR", 0.3)
    if fee_cap and (fee_in + taker) * entry / risk > fee_cap:
        return {"skip": "comisión muy alta para el riesgo"}
    target_r, chain_flag = ex.get("targetR"), None
    if target_r and ex.get("chainTarget") and chain_on is not None:
        chain_flag = bool(chain_on(k, side))
        if chain_flag:
            target_r = ex["chainTarget"]["r"]
    target = entry + side * risk * target_r if target_r else None
    if rule.get("targetAt"):
        target = level_target(sig) if level_target else None
        if target is None:
            return {"skip": "sin nivel para el objetivo"}
        if (target - entry) * side < MIN_TARGET_R * risk:
            return {"skip": "objetivo muy cerca o ya pasado"}
    initial = stop
    tp = ex.get("tpTrail")
    goal = None if tp else target
    if tp:
        tp_start = entry + side * tp["start"] * risk
        tp_gap = tp["dist"] * risk if tp["unit"] == "r" else (tp["dist"] * A[k] if tp["unit"] == "atr" else None)
    tp_on = tp_level = None
    best = entry
    mfe = mae = 0.0
    exit_price = exit_t = reason = None
    j = entry_i

    def stop_reason(level):
        return "stop" if level == initial else ("stop en la entrada" if level == entry else "stop arrastrado")

    def crossed_entry(mh, ml):
        if stop_fill:
            return mh >= entry if side > 0 else ml <= entry
        return ml < entry if side > 0 else mh > entry

    while j < b.n:
        if j > entry_i and T[j] - T[j - 1] > b.gap:
            exit_price, exit_t, reason = C[j - 1], T[j - 1] + b.tf_ms, "hueco de datos"
            j -= 1
            break
        fill_bar = fill_bar_kind and j == entry_i
        bar_mfe = bar_mae = None  # Con h4, lo de la vela del llenado después del llenado
        if tp and (tp_on is not None or (H[j] >= tp_start if side > 0 else L[j] <= tp_start)):
            # Objetivo arrastrado: minuto a minuto desde que se activa (sin atajos)
            minutes, _ = b.path(j)
            filled = not fill_bar
            for step, (mt, mh, ml) in enumerate(minutes):
                if not filled:
                    if crossed_entry(mh, ml):
                        filled = True
                        if (ml <= stop) if side > 0 else (mh >= stop):
                            exit_price, exit_t, reason = stop, mt, stop_reason(stop)
                            break
                    continue
                cap, why = stop, stop_reason(stop)
                if tp_on is not None and (tp_level - stop) * side > 0:
                    cap, why = tp_level, "objetivo arrastrado"
                if (ml <= cap) if side > 0 else (mh >= cap):
                    gapped = step == 0 and not fill_bar and ((O[j] < cap) if side > 0 else (O[j] > cap))
                    exit_price, exit_t, reason = (O[j] if gapped else cap), mt, why
                    break
                top = mh if side > 0 else ml
                if (top - best) * side > 0:
                    best = top
                if tp_on is None and (best - tp_start) * side >= 0:
                    tp_on = T[j]
                if tp_on is not None:
                    level = best - side * (tp_gap if tp_gap is not None else abs(best) * tp["dist"] / 100)
                    if tp_level is None or (level - tp_level) * side > 0:
                        tp_level = level
            if exit_price is not None:
                mfe = max(mfe, (best - entry) * side / risk)
                mae = min(mae, (exit_price - entry) * side / risk)
                break
            hit_stop = hit_goal = False
        else:
            hit_stop = (L[j] <= stop) if side > 0 else (H[j] >= stop)
            hit_goal = goal is not None and ((H[j] >= goal) if side > 0 else (L[j] <= goal))
        resolved_t = None
        if hit_stop and (hit_goal or fill_bar):
            minutes, real = b.path(j)
            hit_stop = hit_goal = False
            filled = not fill_bar
            for mt, mh, ml in minutes:
                if not filled:
                    if crossed_entry(mh, ml):
                        filled = True
                        if (ml <= stop) if side > 0 else (mh >= stop):
                            hit_stop, resolved_t = True, mt
                            break
                    continue
                s = (ml <= stop) if side > 0 else (mh >= stop)
                g = goal is not None and ((mh >= goal) if side > 0 else (ml <= goal))
                if s or g:
                    hit_stop, hit_goal, resolved_t = s, g and not s, mt
                    break
            if v["h12"] and real and not hit_stop and not hit_goal:
                filled = not fill_bar
                for mt, mh, ml in b.assumed(j):
                    if not filled:
                        if crossed_entry(mh, ml):
                            filled = True
                            if (ml <= stop) if side > 0 else (mh >= stop):
                                hit_stop, resolved_t = True, mt
                                break
                        continue
                    s = (ml <= stop) if side > 0 else (mh >= stop)
                    g = goal is not None and ((mh >= goal) if side > 0 else (ml <= goal))
                    if s or g:
                        hit_stop, hit_goal, resolved_t = s, g and not s, mt
                        break
        elif fill_bar and hit_goal:
            hit_goal = False
            if v["fillbar_target"]:
                filled = False
                for mt, mh, ml in b.path(j)[0]:
                    if not filled:
                        filled = crossed_entry(mh, ml)
                        continue
                    if (mh >= goal) if side > 0 else (ml <= goal):
                        hit_goal, resolved_t = True, mt
                        break
        if hit_stop:
            gapped = ((O[j] < stop) if side > 0 else (O[j] > stop)) and not fill_bar
            exit_price, reason, exit_t = (O[j] if gapped else stop), stop_reason(stop), resolved_t or T[j]
            mae = min(mae, (exit_price - entry) * side / risk)
            break
        if hit_goal:
            price = goal
            if v["h5"] and not fill_bar and ((O[j] > goal) if side > 0 else (O[j] < goal)):
                price = O[j]
            exit_price, reason, exit_t = price, "objetivo", resolved_t or T[j]
            mfe = max(mfe, (goal - entry) * side / risk)
            break
        if fill_bar and v["h4"]:
            # Solo lo posterior al llenado
            filled, hi, lo = False, None, None
            for mt, mh, ml in b.path(j)[0]:
                if not filled:
                    filled = crossed_entry(mh, ml)
                    if not filled:
                        continue
                hi = mh if hi is None else max(hi, mh)
                lo = ml if lo is None else min(lo, ml)
            if hi is not None:
                fav = ((hi if side > 0 else lo) - entry) * side / risk
                adv = ((lo if side > 0 else hi) - entry) * side / risk
                mfe, mae = max(mfe, fav), min(mae, adv)
        else:
            mfe = max(mfe, ((H[j] if side > 0 else L[j]) - entry) * side / risk)
            mae = min(mae, ((L[j] if side > 0 else H[j]) - entry) * side / risk)
        nxt = j + 1 < b.n
        if ex.get("opposite") and opposite is not None and j > k and j in opposite and nxt:
            exit_price, exit_t, reason = O[j + 1], T[j + 1], "señal contraria"
            break
        if exit_at is not None and j > k and j in (exit_at.get(side) or ()) and nxt:
            exit_price, exit_t, reason = O[j + 1], T[j + 1], "sale del canal"
            break
        if vpa_exit is not None and j > k and nxt:
            warn = (vpa_exit.get(side) or {}).get(j)
            if warn and mfe >= ex["vpa"]["fromR"]:
                exit_price, exit_t, reason = O[j + 1], T[j + 1], warn
                break
        if ex.get("horizon") and j - entry_i + 1 >= ex["horizon"]:
            exit_price, exit_t, reason = C[j], T[j] + b.tf_ms, "tiempo"
            break
        trail = ex.get("trail", "none")
        level = None
        if trail == "swing":
            m = ex["trailBars"]
            p = j - m
            if p - m >= 0 and p > k:
                vals = L if side > 0 else H
                if _pivot_unique(vals, p - m, j, p, side):
                    level = vals[p] - side * rule["stop"].get("buffer", 0.1) * A[j]
        elif trail == "bars":
            m = ex["trailBars"]
            vals = L[max(0, j - m + 1):j + 1] if side > 0 else H[max(0, j - m + 1):j + 1]
            level = (min(vals) if side > 0 else max(vals)) - side * rule["stop"].get("buffer", 0.1) * A[j]
        elif trail in ("atr", "pct") and mfe >= ex.get("trailStart", 0.0):
            top = entry + side * mfe * risk
            gap = ex["trailAtr"] * A[j] if trail == "atr" else top * ex["trailPct"] / 100
            level = top - side * gap
        if level is not None and (level - stop) * side > 0 and (C[j] - level) * side > 0:
            stop = level
        if ex.get("breakEven") and mfe >= ex["breakEven"] and (entry - stop) * side > 0 and (C[j] - entry) * side > 0:
            stop = entry
        j += 1
    # Hasta dónde llegó antes del stop inicial
    reach, done = 0.0, False
    first = entry_i + (1 if fill_bar_kind else 0)
    i = first
    reach_from = first if v["o05"] else entry_i  # Desde el motor 6 (O-05): 300 velas desde la siguiente al llenado (antes, 299)
    last = min(b.n, reach_from + REACH_BARS)
    while i < last:
        if i > entry_i and T[i] - T[i - 1] > b.gap:
            done = True
            break
        if (L[i] <= initial) if side > 0 else (H[i] >= initial):
            done = True
            break
        reach = max(reach, ((H[i] if side > 0 else L[i]) - entry) * side / risk)
        i += 1
    else:
        done = reach_from + REACH_BARS <= b.n
    trade = {"k": k, "side": side, "entry_i": entry_i, "entry": entry, "entry_t": T[entry_i], "order": order,
             "stop": initial, "target": target, "risk": risk, "stop_atr": round(stop_atr, 3),
             "reach": round(reach, 3) if done else None}
    if chain_flag is not None:
        trade["chain_on"] = chain_flag
    if tp:
        trade["tp_on"] = tp_on
    if exit_price is None:
        trade["open"] = True
        return trade
    gross = (exit_price - entry) * side / risk
    cost = (fee_in * entry + taker * exit_price) / risk
    exit_i = j if reason != "hueco de datos" else j
    trade.update(exit=exit_price, exit_t=exit_t, reason=reason, gross=round(gross, 4), r=round(gross - cost, 4),
                 mfe=round(mfe, 3), mae=round(mae, 3), exit_i=exit_i, bars=exit_i - entry_i + 1)
    return trade


def fill_time(b, j, side, level, order):
    """Cuándo se llena una orden en la vela j (especificación, sección 9, desde el motor 5): con minutos, el primer minuto
    que la llena (dentro de un minuto empatan); sin ellos, en el recorrido supuesto (4.1), el tramo en que el precio llega
    a ella y, dentro del tramo, su distancia desde el comienzo. Limit al cruzar, orden stop al tocar, mercado en la
    apertura. Devuelve una clave para ordenar."""
    if order == "market":
        return (b.T[j], 0.0)

    def fills(h, l):
        if order == "limit":
            return (l < level) if side > 0 else (h > level)
        return (h >= level) if side > 0 else (l <= level)

    if b.minutes is not None:
        for t, h, l in b.minutes(b.T[j], b.T[j] + b.tf_ms) or []:
            if fills(h, l):
                return (t, 0.0)
    o, h, l, c = b.O[j], b.H[j], b.L[j], b.C[j]
    if fills(o, o):
        return (b.T[j], 0.0)
    points = (o, h, l, c) if h - o < o - l else (o, l, h, c)
    for i in range(1, 4):
        a, z = points[i - 1], points[i]
        if fills(max(a, z), min(a, z)):
            return (b.T[j] + i, abs(level - a) / abs(z - a) if z != a else 0.0)
    return (b.T[j] + 4, 0.0)


def select_motor6(results, cooldown=0, deferred=False, fill_key=None, exit_key=None):
    """La selección de la especificación desde el motor 6 (etapa 7, 22/11/2026), escrita aparte de la de antes:
    - a mercado, la señal de la vela de la salida ya entra (k < exit_i: posición abierta); una vela con una señal larga y
      otra corta no da ninguna (H19);
    - con órdenes que esperan, una que se llena en la vela de la salida entra si se llenó después del momento de la
      salida (exit_key del trade anterior, en la escala de fill_key);
    - el enfriamiento, solo tras un trade tomado: k ≤ exit_i + cooldown (F-01)."""
    taken, fates = [], {}
    items = [(k, r) for k, r in results if r is not None and "skip" not in r]
    sides = {}
    for k, r in results:
        if isinstance(r, dict) and r.get("side") is not None:
            sides.setdefault(k, set()).add(r["side"])
    opposed = {k for k, found in sides.items() if len(found) > 1} if not deferred else set()
    if deferred:
        items = sorted(items, key=lambda kr: (kr[1]["entry_i"], fill_key(kr[1]) if fill_key else (0, 0.0), kr[0]))
    last_exit, last_moment, busy_open = None, None, False
    for k, r in items:
        key = (k, r.get("side"), r.get("entry_i"))
        if k in opposed:
            fates[key] = "señales opuestas en la misma vela"
            continue
        point = r["entry_i"] if deferred else k
        if busy_open:
            fates[key] = "posición abierta"
            continue
        if last_exit is not None:
            if point < last_exit or (deferred and point == last_exit and (fill_key(r) if fill_key else (0, 0.0)) <= last_moment):
                fates[key] = "posición abierta"
                continue
            if cooldown and point <= last_exit + cooldown:
                fates[key] = "enfriamiento"
                continue
        if r.get("open"):
            fates[key] = "abierta al final de la fase"
            busy_open = True
            continue
        taken.append(r)
        last_exit = r["exit_i"]
        last_moment = exit_key(r) if (deferred and exit_key) else None
    return taken, fates


def select(results, one_at_a_time=True, cooldown=0, deferred=False, natural=False, T=None, tf_ms=None, fill_key=None):
    """La selección de la especificación (sección 9). results: [(k, trade|skip|open|None)] en orden de k.
    natural=True: una señal entra si se conoce a la hora de la salida o después (para medir la convención).
    fill_key(trade): desde el motor 5, las que se llenan en la misma vela van por cuándo se llenaron (fill_time)."""
    taken, fates = [], {}
    busy_until, busy_exit_t = -1, None
    items = [(k, r) for k, r in results if r is not None and "skip" not in r]
    if not one_at_a_time:
        return [r for _, r in items if not r.get("open")], fates
    if deferred:
        items = sorted(items, key=lambda kr: (kr[1]["entry_i"], fill_key(kr[1]) if fill_key else (0, 0.0), kr[0]))
    for k, r in items:
        key = (k, r.get("side"), r.get("entry_i"))
        point = r["entry_i"] if deferred else k
        if natural and busy_exit_t is not None and not deferred:
            blocked = T[k] + tf_ms < busy_exit_t
        else:
            blocked = point < busy_until
        if blocked:
            fates[key] = "posición abierta"
            continue
        if point < busy_until + cooldown:
            fates[key] = "enfriamiento"
            continue
        if r.get("open"):
            fates[key] = "abierta al final de la fase"
            busy_until = 10 ** 12
            busy_exit_t = 10 ** 15
            continue
        taken.append(r)
        busy_until = r["exit_i"] + 1
        busy_exit_t = r["exit_t"]
    return taken, fates
