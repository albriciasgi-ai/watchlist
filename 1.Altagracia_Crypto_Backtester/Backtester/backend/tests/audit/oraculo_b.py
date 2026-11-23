"""Oráculo B: simulador independiente del ciclo de un trade del probador de reglas (App 1).

Escrito solo a partir de ``pruebas_backtesting/ESPECIFICACION_CICLO_TRADE.md`` (secciones 1 a 9).
No importa ni copia nada del backend ni del frontend: es la segunda versión con que se audita el
motor. Cada bloque cita la sección que sigue; donde la especificación no alcanza, la decisión
tomada va marcada con ``AMBIGUO`` y está en la lista del informe.

Uso::

    out = simulate_signals(tf, bars, atr, signals, rule, minutes_of=..., opposite=...)
    out["results"]  # una entrada por señal, en el orden de entrada
    out["trades"]   # los trades que quedan tras la selección, con "n" desde 1
    out["fates"]    # {id: motivo} de las señales que entraron y no quedaron
"""

import math

MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS
REACH_BARS = 300          # sección 8
SWING_LOOKBACK = 200      # sección 4, stop "swing"
SWING_MAX_PIVOTS = 6      # sección 4, stop "swing"
LEVEL_MIN_R = 0.3         # sección 4, objetivo de nivel
AT_FRACTION = {"near": 1.0, "mid": 0.5, "far": 0.0}   # sección 3.2


def _finite(x):
    """ATR utilizable: un valor ausente o no finito cuenta como 0 (AMBIGUO)."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def _need(d, key, where):
    """Un parámetro que la especificación exige: si falta, falla en vez de adivinar."""
    if key not in d or d[key] is None:
        raise ValueError(f"falta {where}.{key}")
    return d[key]


class _Data:
    """Velas, ATR, minutos y huecos (secciones 1, 2 y 4.1)."""

    def __init__(self, tf, bars, atr, minutes_of, gap_ms):
        self.tf_ms = int(tf) * MINUTE_MS
        self.n = len(bars)
        self.t = [int(b["t"]) for b in bars]
        self.o = [float(b["o"]) for b in bars]
        self.h = [float(b["h"]) for b in bars]
        self.l = [float(b["l"]) for b in bars]
        self.c = [float(b["c"]) for b in bars]
        self.atr = [_finite(a) for a in atr]
        self.minutes_of = minutes_of
        # sección 1: por defecto max(6 h, 2·tf)
        self.gap = int(gap_ms) if gap_ms is not None else max(6 * HOUR_MS, 2 * self.tf_ms)

    def is_gap(self, j):
        """True si el salto de la vela j-1 a la j es un hueco de datos."""
        return self.t[j] - self.t[j - 1] > self.gap

    def real_minutes(self, j):
        """Los minutos negociados de la vela j como (t, alto, bajo), o None si no hay."""
        if self.minutes_of is None:
            return None
        m = self.minutes_of(j)
        if not m:
            return None
        return [(int(tm), float(hi), float(lo)) for tm, hi, lo in m]

    def path(self, j):
        """Sección 4.1: los minutos de la vela o, sin ellos, su recorrido supuesto.

        Recorrido supuesto: apertura, el extremo más cercano a la apertura, el otro y el
        cierre; si h - o < o - l va primero el máximo, si no el mínimo. Cada punto es un
        "minuto" con alto = bajo = ese precio y, AMBIGUO, la hora de apertura de la vela.
        Si hay minutos se usan aunque no muestren el toque que muestran h o l (convención).
        """
        m = self.real_minutes(j)
        if m is not None:
            return m
        o, h, l, c, t = self.o[j], self.h[j], self.l[j], self.c[j], self.t[j]
        seq = (o, h, l, c) if h - o < o - l else (o, l, h, c)
        return [(t, p, p) for p in seq]


# ---------------------------------------------------------------- sección 3: entrada

def _filled(entry_i, entry, order, fee, side, fill):
    """fill: "limit" o "stop" si su vela es la vela del llenado (sección 5, paso 2); si no, None."""
    return None, {"entry_i": entry_i, "entry": entry, "order": order, "fee": fee,
                  "side": side, "fill": fill}


def _market(d, k, side, taker):
    """Sección 3.1: apertura de la vela siguiente, comisión taker."""
    return _filled(k + 1, d.o[k + 1], "market", taker, side, None)


def _entry(d, sig, rule, taker, maker):
    """Devuelve (motivo_de_skip, None) o (None, entrada)."""
    k, side = int(sig["k"]), int(sig["side"])
    e = rule.get("entry") or {}
    typ = e.get("type") or "market"
    zone = sig.get("zone")
    if typ == "market":
        return _market(d, k, side, taker)
    if typ == "limit":
        return _limit(d, k, side, zone, e, taker, maker)
    if typ == "stop":
        return _stop_order(d, k, side, zone, e, sig, taker)
    if typ == "straddle":
        return _straddle(d, k, side, zone, e, sig, taker)
    raise ValueError(f"entrada desconocida: {typ}")


def _limit(d, k, side, zone, e, taker, maker):
    """Sección 3.2."""
    if zone is None:
        return _market(d, k, side, taker)
    zl, zh = float(zone[0]), float(zone[1])
    s = AT_FRACTION[_need(e, "at", "entry")]
    price = zl + s * (zh - zl) if side == 1 else zh - s * (zh - zl)
    if (d.o[k + 1] - price) * side <= 0:
        return _market(d, k, side, taker)
    last = min(k + int(_need(e, "expiry", "entry")), d.n - 1)
    for j in range(k + 1, last + 1):
        crossed = d.l[j] < price if side == 1 else d.h[j] > price
        if crossed:
            # convención: al precio de la limit aunque la vela haya abierto más allá
            return _filled(j, price, "limit", maker, side, "limit")
    return "limit sin llenar", None


def _stop_order(d, k, side, zone, e, sig, taker):
    """Sección 3.3: orden stop a favor, con cancelación opcional por el otro borde."""
    a = d.atr[k]
    off = float(e.get("offset") or 0.0)
    if zone is not None and e.get("from") != "close":
        level = float(zone[1]) + off * a if side == 1 else float(zone[0]) - off * a
    else:
        level = d.c[k] + side * off * a
    cancel = None
    if zone is not None and e.get("cancel") and float(zone[1]) > float(zone[0]):
        cancel = float(zone[0]) if side == 1 else float(zone[1])
    wait = sig.get("expiry")
    if wait is None:
        wait = _need(e, "expiry", "entry")
    last = min(k + int(wait), d.n - 1)
    for j in range(k + 1, last + 1):
        touch = d.h[j] >= level if side == 1 else d.l[j] <= level
        passed = cancel is not None and (d.l[j] < cancel if side == 1 else d.h[j] > cancel)
        if not touch:
            if passed:
                return "orden stop sin llenar", None
            continue
        if passed:
            won = _stop_or_cancel(d, j, side, level, cancel)
            if won == "cancel":
                return "orden stop sin llenar", None
            if won is None:
                continue          # AMBIGUO: los minutos no muestran ninguna de las dos
        beyond = d.o[j] > level if side == 1 else d.o[j] < level
        if beyond:
            return _filled(j, d.o[j], "stop", taker, side, None)
        return _filled(j, level, "stop", taker, side, "stop")
    return "orden stop sin llenar", None


def _stop_or_cancel(d, j, side, level, cancel):
    """El primer minuto (o punto del recorrido supuesto) en que pasa alguna decide."""
    for _tm, hi, lo in d.path(j):
        fill = hi >= level if side == 1 else lo <= level
        canc = lo < cancel if side == 1 else hi > cancel
        if fill and canc:
            # gana la más cercana a la apertura; empate a favor del llenado
            return "fill" if abs(level - d.o[j]) <= abs(d.o[j] - cancel) else "cancel"
        if fill:
            return "fill"
        if canc:
            return "cancel"
    return None


def _straddle(d, k, side, zone, e, sig, taker):
    """Sección 3.4: dos órdenes stop; el lado del trade es el de la que se llena."""
    a = d.atr[k]
    off = float(e.get("offset") or 0.0)
    if e.get("from") == "zone" and zone is not None:
        up, dn = float(zone[1]) + off * a, float(zone[0]) - off * a
    else:                         # AMBIGUO: sin "from" o "zone" sin zona, desde el cierre
        up, dn = d.c[k] + off * a, d.c[k] - off * a
    sides = tuple(int(s) for s in (sig.get("sides") or (side,)))
    last = min(k + int(_need(e, "expiry", "entry")), d.n - 1)
    for j in range(k + 1, last + 1):
        tu = 1 in sides and d.h[j] >= up
        td = -1 in sides and d.l[j] <= dn
        if not (tu or td):
            continue
        won = _straddle_side(d, j, up, dn) if (tu and td) else (1 if tu else -1)
        level = up if won == 1 else dn
        beyond = d.o[j] > up if won == 1 else d.o[j] < dn
        if beyond:
            return _filled(j, d.o[j], "stop", taker, won, None)
        return _filled(j, level, "stop", taker, won, "stop")
    return "ninguna orden stop se llenó", None


def _straddle_side(d, j, up, dn):
    """Tocan las dos: decide el primer minuto real; si en él tocan las dos o ningún minuto lo
    dice (sin minutos no se usa el recorrido supuesto), la más cercana a la apertura."""
    closer = 1 if abs(up - d.o[j]) <= abs(d.o[j] - dn) else -1
    for _tm, hi, lo in d.real_minutes(j) or ():
        a, b = hi >= up, lo <= dn
        if a and b:
            return closer
        if a:
            return 1
        if b:
            return -1
    return closer


# ---------------------------------------------------------------- sección 4: stop y objetivo

def _initial_stop(d, sig, rule, side, entry):
    """El stop con lo conocido al cierre de k y la entrada ya decidida."""
    st = rule.get("stop") or {}
    typ = st.get("type")
    k = int(sig["k"])
    a = d.atr[k]
    buf = float(st.get("buffer") or 0.0)
    zone = sig.get("zone")
    if typ == "atr":
        return entry - side * float(_need(st, "atr", "stop")) * a
    if typ == "zone" and zone is not None:
        return float(zone[0]) - buf * a if side == 1 else float(zone[1]) + buf * a
    if typ in ("zone", "candle"):     # "zone" sin zona: como "candle"
        i0 = sig.get("i0")
        i0 = k if i0 is None else min(max(int(i0), 0), k)   # AMBIGUO: i0 ausente = k
        if side == 1:
            return min(d.l[i0:k + 1]) - buf * a
        return max(d.h[i0:k + 1]) + buf * a
    if typ == "swing":
        return _swing_stop(d, k, side, entry, int(_need(st, "bars", "stop")), buf * a)
    raise ValueError(f"stop desconocido: {typ}")


def _is_pivot(d, p, lo_i, hi_i, side):
    """p es el ÚNICO extremo (mínimo en un largo, máximo en un corto) de [lo_i, hi_i]."""
    if side == 1:
        v = d.l[p]
        return all(d.l[i] > v for i in range(lo_i, hi_i + 1) if i != p)
    v = d.h[p]
    return all(d.h[i] < v for i in range(lo_i, hi_i + 1) if i != p)


def _swing_stop(d, k, side, entry, n, pad):
    """Pivote más reciente confirmado detrás de la entrada; hasta 6 pivotes y 200 velas.

    AMBIGUO: se pide la ventana entera ([p - N, p + N] con p - N >= 0) y la búsqueda llega
    hasta p = k - N - 200 inclusive.
    """
    p = k - n
    floor = k - n - SWING_LOOKBACK
    seen = 0
    while p >= floor and p - n >= 0 and seen < SWING_MAX_PIVOTS:
        if _is_pivot(d, p, p - n, p + n, side):
            seen += 1
            v = d.l[p] if side == 1 else d.h[p]
            if (entry - v) * side > 0:
                return v - side * pad
        p -= 1
    lo_i = max(0, k - 4 * n)          # respaldo sin pivote útil
    if side == 1:
        return min(d.l[lo_i:k + 1]) - pad
    return max(d.h[lo_i:k + 1]) + pad


def _target(sig, rule, side, entry, risk, chain_on, level_target):
    """Devuelve (objetivo o None, motivo_de_skip o None)."""
    ex = rule.get("exit") or {}
    tr = ex.get("targetR")
    if tr is not None:
        mult = float(tr)
        ct = ex.get("chainTarget")
        if ct and chain_on is not None and chain_on(int(sig["k"]), side):
            mult = float(_need(ct, "r", "exit.chainTarget"))
        return entry + side * risk * mult, None
    if rule.get("targetAt") is not None:
        lv = level_target(sig) if level_target is not None else None
        if lv is None:
            return None, "sin objetivo de nivel"          # AMBIGUO: motivo propio
        lv = float(lv)
        if (lv - entry) * side < LEVEL_MIN_R * risk:
            return None, "objetivo muy cerca o ya pasado"
        return lv, None
    return None, None


# ---------------------------------------------------------------- sección 5, paso 2

def _is_fill_minute(kind, side, entry, hi, lo):
    """Minuto del llenado: limit largo bajo < entrada; orden stop largo alto >= entrada."""
    if kind == "limit":
        return lo < entry if side == 1 else hi > entry
    return hi >= entry if side == 1 else lo <= entry


def _stop_price(d, j, side, stop, fill_bar):
    """El stop, o la apertura si la vela abrió más allá de él (salvo en la vela del llenado)."""
    if not fill_bar and (d.o[j] - stop) * side < 0:
        return d.o[j]
    return stop


def _plain_bar(d, j, side, entry, stop, target, fill_bar):
    """Toques sin objetivo arrastrado. Devuelve (tipo, precio, hora) o None.

    fill_bar: "limit" / "stop" en la vela del llenado, si no None.
    """
    if side == 1:
        ts = d.l[j] <= stop
        to = target is not None and d.h[j] >= target
    else:
        ts = d.h[j] >= stop
        to = target is not None and d.l[j] <= target
    if ts and (to or fill_bar):
        started = not fill_bar
        for tm, hi, lo in d.path(j):
            s_hit = lo <= stop if side == 1 else hi >= stop
            if not started:
                if _is_fill_minute(fill_bar, side, entry, hi, lo):
                    started = True
                    if s_hit:                  # en el minuto del llenado solo cuenta el stop
                        return "stop", stop, tm
                continue                       # antes del llenado no cuenta nada
            if s_hit:                          # los dos en el mismo minuto: cuenta el stop
                return "stop", _stop_price(d, j, side, stop, fill_bar), tm
            if target is not None and (hi >= target if side == 1 else lo <= target):
                return "target", target, tm
        return None
    if ts:
        return "stop", _stop_price(d, j, side, stop, fill_bar), d.t[j]
    if to and not fill_bar:     # en la vela del llenado el objetivo se deja para la siguiente
        return "target", target, d.t[j]
    return None


class _TpTrail:
    """Sección 6: objetivo arrastrado. El objetivo fijo nunca cierra el trade."""

    def __init__(self, cfg, side, entry, risk, atr_k):
        self.side = side
        self.start = entry + side * float(_need(cfg, "start", "exit.tpTrail")) * risk
        self.dist = float(_need(cfg, "dist", "exit.tpTrail"))
        self.unit = cfg.get("unit") or "r"
        self.risk = risk
        self.atr_k = atr_k
        self.active = False
        self.best = None
        self.level = None
        self.on = None

    def _distance(self):
        if self.unit == "r":
            return self.dist * self.risk
        if self.unit == "atr":
            return self.dist * self.atr_k        # fija desde la señal
        if self.unit == "pct":
            return self.best * self.dist / 100.0
        raise ValueError(f"unidad desconocida: {self.unit}")

    def bar(self, d, j, entry, stop, fill_bar):
        """Devuelve ("stop" | "tp", precio, hora) o None."""
        side = self.side
        ts = d.l[j] <= stop if side == 1 else d.h[j] >= stop
        reaches = d.h[j] >= self.start if side == 1 else d.l[j] <= self.start
        if not (self.active or reaches or (ts and fill_bar)):
            if ts:
                return "stop", _stop_price(d, j, side, stop, fill_bar), d.t[j]
            return None
        started = not fill_bar
        first = True
        for tm, hi, lo in d.path(j):
            if not started:
                if _is_fill_minute(fill_bar, side, entry, hi, lo):
                    started = True
                    # AMBIGUO: en el minuto del llenado tampoco se activa ni se arrastra
                    if lo <= stop if side == 1 else hi >= stop:
                        return "stop", stop, tm
                continue
            # primero el nivel más cercano a favor (empate: el objetivo arrastrado)
            if self.level is not None and (self.level - stop) * side >= 0:
                level, kind = self.level, "tp"
            else:
                level, kind = stop, "stop"
            if lo <= level if side == 1 else hi >= level:
                # en la apertura si la vela abrió más allá del nivel que traía
                beyond = first and not fill_bar and (d.o[j] - level) * side < 0
                return kind, (d.o[j] if beyond else level), tm
            first = False
            # después, el mejor precio arrastra el objetivo (solo se acerca)
            fav = hi if side == 1 else lo
            if self.best is None or (fav - self.best) * side > 0:
                self.best = fav
            if not self.active and (fav - self.start) * side >= 0:
                self.active = True
                self.on = d.t[j]
            if self.active:
                new = self.best - side * self._distance()
                if self.level is None or (new - self.level) * side > 0:
                    self.level = new
        return None


# ---------------------------------------------------------------- sección 5, paso 4

def _trail_level(d, ex, j, k, side, entry, risk, mfe, buf):
    """Nivel nuevo del trailing al cierre de j, o None."""
    mode = ex.get("trail") or "none"
    if mode == "swing":
        m = int(_need(ex, "trailBars", "exit"))
        p = j - m
        if p - m >= 0 and p > k and _is_pivot(d, p, p - m, j, side):
            v = d.l[p] if side == 1 else d.h[p]
            return v - side * buf * d.atr[j]
        return None
    if mode == "bars":
        m = int(_need(ex, "trailBars", "exit"))
        lo_i = max(0, j - m + 1)          # AMBIGUO: recortado a la primera vela de los datos
        ext = min(d.l[lo_i:j + 1]) if side == 1 else max(d.h[lo_i:j + 1])
        return ext - side * buf * d.atr[j]
    if mode in ("atr", "pct"):
        start = ex.get("trailStart")
        if mfe < (0.0 if start is None else float(start)):
            return None
        best = entry + side * mfe * risk
        if mode == "atr":
            return best - side * (float(_need(ex, "trailAtr", "exit")) * d.atr[j])
        return best - side * (best * float(_need(ex, "trailPct", "exit")) / 100.0)
    return None


def _walk(d, sig, rule, info, stop0, target, risk, ctx):
    """Sección 5 (y 6). Devuelve la salida, o {"open": True} si se acaban las velas."""
    k = int(sig["k"])
    side, entry, ei, fill = info["side"], info["entry"], info["entry_i"], info["fill"]
    ex = rule.get("exit") or {}
    buf = float((rule.get("stop") or {}).get("buffer") or 0.0)
    tp = _TpTrail(ex["tpTrail"], side, entry, risk, d.atr[k]) if ex.get("tpTrail") else None
    opp = (ctx.opposite or {}).get(-side) or ()
    chan = (ctx.exit_at or {}).get(side) or ()
    vpa = (ctx.vpa_exit or {}).get(side) or {}
    from_r = float((ex.get("vpa") or {}).get("fromR") or 0.0)   # AMBIGUO: sin vpa, 0
    horizon = ex.get("horizon")
    be = ex.get("breakEven")
    stop = stop0
    mfe = mae = 0.0                                              # AMBIGUO: arrancan en 0

    def out(xi, price, when, reason):
        return {"exit_i": xi, "exit": price, "exit_t": when, "reason": reason, "mfe": mfe,
                "mae": mae, "tp_on": tp.on if tp else None}

    for j in range(ei, d.n):
        if j > ei and d.is_gap(j):                               # 1. hueco
            return out(j - 1, d.c[j - 1], d.t[j - 1] + d.tf_ms, "hueco de datos")
        fill_bar = fill if j == ei else None
        hit = tp.bar(d, j, entry, stop, fill_bar) if tp else \
            _plain_bar(d, j, side, entry, stop, target, fill_bar)  # 2. toques
        if hit is not None:
            kind, price, when = hit
            if kind == "stop":
                mae = min(mae, (price - entry) * side / risk)
                reason = "stop" if stop == stop0 else (
                    "stop en la entrada" if stop == entry else "stop arrastrado")
            elif kind == "target":
                mfe = max(mfe, (target - entry) * side / risk)
                reason = "objetivo"
            else:
                reason = "objetivo arrastrado"   # AMBIGUO: sin tocar mfe ni mae
            return out(j, price, when, reason)
        if side == 1:                                            # 3. mfe y mae
            mfe = max(mfe, (d.h[j] - entry) / risk)
            mae = min(mae, (d.l[j] - entry) / risk)
        else:
            mfe = max(mfe, (entry - d.l[j]) / risk)
            mae = min(mae, (entry - d.h[j]) / risk)
        nxt = j + 1 < d.n                                        # 4. al cierre
        if nxt:
            if ex.get("opposite") and j in opp:
                return out(j + 1, d.o[j + 1], d.t[j + 1], "señal contraria")
            if j in chan:
                return out(j + 1, d.o[j + 1], d.t[j + 1], "sale del canal")
            if j in vpa and mfe >= from_r:
                return out(j + 1, d.o[j + 1], d.t[j + 1], vpa[j])
        if horizon and j - ei + 1 >= horizon:
            return out(j, d.c[j], d.t[j] + d.tf_ms, "tiempo")
        if nxt:
            level = _trail_level(d, ex, j, k, side, entry, risk, mfe, buf)
            if level is not None and (d.c[j] - level) * side > 0 and (level - stop) * side > 0:
                stop = level
            if be is not None and mfe >= float(be) and (entry - stop) * side > 0 \
                    and (d.c[j] - entry) * side > 0:
                stop = entry
    return {"open": True, "mfe": mfe, "mae": mae, "tp_on": tp.on if tp else None}


# ---------------------------------------------------------------- secciones 7 y 8

def _reach(d, info, stop0, risk):
    """Lo máximo a favor en R antes de tocar el stop inicial, en 300 velas."""
    side, entry, ei = info["side"], info["entry"], info["entry_i"]
    s = ei if info["order"] == "market" else ei + 1
    end = s + REACH_BARS
    best = 0.0                                    # AMBIGUO: arranca en 0
    for j in range(s, min(end, d.n)):
        if d.is_gap(j):
            return best
        if d.l[j] <= stop0 if side == 1 else d.h[j] >= stop0:
            return best                           # AMBIGUO: esa vela no cuenta
        best = max(best, ((d.h[j] if side == 1 else d.l[j]) - entry) * side / risk)
    return best if end <= d.n else None


class _Ctx:
    def __init__(self, **kw):
        self.__dict__.update(kw)


def _simulate_one(d, sig, rule, ctx):
    sid = sig.get("id")
    k = int(sig["k"])
    if k < 0 or k + 1 >= d.n or d.is_gap(k + 1):
        return {"id": sid, "skip": "sin vela siguiente"}
    why, info = _entry(d, sig, rule, ctx.taker, ctx.maker)
    if why:
        return {"id": sid, "skip": why}
    side, entry, ei = info["side"], info["entry"], info["entry_i"]
    stop0 = _initial_stop(d, sig, rule, side, entry)
    risk = (entry - stop0) * side
    if risk <= 0:
        return {"id": sid, "skip": "stop del lado equivocado"}
    a = d.atr[k]
    stop_atr = risk / a if a > 0 else 0.0
    st = rule.get("stop") or {}
    if st.get("minAtr") is not None and stop_atr < float(st["minAtr"]):
        return {"id": sid, "skip": "stop muy corto"}
    if st.get("maxAtr") is not None and stop_atr > float(st["maxAtr"]):
        return {"id": sid, "skip": "stop muy largo"}
    target, why = _target(sig, rule, side, entry, risk, ctx.chain_on, ctx.level_target)
    if why:
        return {"id": sid, "skip": why}
    has_tp = bool((rule.get("exit") or {}).get("tpTrail"))
    base = {"id": sid, "k": k, "side": side, "entry_i": ei, "entry": entry, "entry_t": d.t[ei],
            "order": info["order"], "stop": stop0, "target": target, "risk": risk,
            "stop_atr": stop_atr}
    walk = _walk(d, sig, rule, info, stop0, target, risk, ctx)
    reach = _reach(d, info, stop0, risk)
    if walk.get("open"):
        res = dict(base, open=True, mfe=walk["mfe"], mae=walk["mae"], reach=reach)
        if has_tp:
            res["tp_on"] = walk["tp_on"]
        return res
    xi, xp = walk["exit_i"], walk["exit"]
    gross = (xp - entry) * side / risk                                   # sección 7
    cost = (info["fee"] * entry + ctx.taker * xp) / risk
    res = dict(base, exit_i=xi, exit=xp, exit_t=walk["exit_t"], reason=walk["reason"],
               gross=gross, r=round(gross - cost, 4), mfe=walk["mfe"], mae=walk["mae"],
               bars=xi - ei + 1, reach=reach)
    if has_tp:
        res["tp_on"] = walk["tp_on"]
    return res


# ---------------------------------------------------------------- sección 9: selección

def _select(signals, results, rule):
    typ = (rule.get("entry") or {}).get("type") or "market"
    one = bool(rule.get("oneAtATime", False))     # AMBIGUO: sin el campo, todas cuentan
    cool = int(rule.get("cooldown") or 0)
    order = sorted(range(len(signals)), key=lambda i: int(signals[i]["k"]))   # estable
    fates = {}
    if typ == "straddle":                         # una misma vela k pone sus órdenes una vez
        seen, kept = set(), []
        for i in order:
            kk = int(signals[i]["k"])
            if kk in seen:
                if "skip" not in results[i]:
                    fates[results[i]["id"]] = "misma vela"     # AMBIGUO: motivo propio
                continue
            seen.add(kk)
            kept.append(i)
        order = kept
    entered = [i for i in order if "skip" not in results[i]]
    deferred = typ in ("limit", "stop", "straddle")
    if one and deferred:
        entered.sort(key=lambda i: (results[i]["entry_i"], int(signals[i]["k"])))
    taken, last, blocked = [], None, False
    for i in entered:
        res = results[i]
        if one:
            when = res["entry_i"] if deferred else int(signals[i]["k"])
            if blocked or (last is not None and when <= last):
                fates[res["id"]] = "posición abierta"
                continue
            if last is not None and when < last + 1 + cool:
                fates[res["id"]] = "enfriamiento"
                continue
        if res.get("open"):
            fates[res["id"]] = "abierta al final de la fase"
            blocked = one                          # ocupa todo lo que sigue
            continue
        taken.append(res)
        if one:
            last = res["exit_i"]
    return [dict(r, n=n) for n, r in enumerate(taken, 1)], fates


def simulate_signals(tf, bars, atr, signals, rule, minutes_of=None, opposite=None, exit_at=None,
                     vpa_exit=None, chain_on=None, level_target=None, taker=0.00055, maker=0.0002,
                     gap_ms=None):
    """Devuelve {"results": [...uno por señal, en el orden de entrada...], "trades": [...los que
    quedan tras la selección, numerados desde 1 en "n"...], "fates": {id: motivo}}"""
    d = _Data(tf, bars, atr, minutes_of, gap_ms)
    ctx = _Ctx(opposite=opposite, exit_at=exit_at, vpa_exit=vpa_exit, chain_on=chain_on,
               level_target=level_target, taker=float(taker), maker=float(maker))
    results = [_simulate_one(d, s, rule, ctx) for s in signals]
    trades, fates = _select(signals, results, rule)
    return {"results": results, "trades": trades, "fates": fates}
