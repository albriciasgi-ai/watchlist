"""
Probador de reglas del Observador: una regla (elementos de order flow + entrada + stop + salida) corrida
sobre un tramo fijo del histórico, con cada trade contabilizado.

- Tres fases por fecha (UTC). La 1 es para explorar. La 2 y la 3 se corren con la regla ya decidida: su
  resultado queda guardado por regla exacta y no se vuelve a calcular, y la 3 exige haber pasado por la 2.
- Nada usa el futuro: la señal se conoce al cierre de su vela (of_setups.match_recipes), se entra en la
  apertura de la siguiente o con una limit que se llena al cruzar, y el stop sale de velas ya cerradas.
  Un trade que sigue abierto al final de la fase no cuenta: su salida está en la fase siguiente.
- Cuando stop y objetivo caen en la misma vela se mira minuto a minuto; si siguen juntos, cuenta el stop.
- Cada trade guarda, además de lo que pide la regla, todos los elementos presentes en su ventana y las
  medidas de measures.py al decidir, para buscar qué separa a los ganadores de los perdedores.
"""
import datetime as dt
import gzip
import hashlib
import json
import math
import random
import threading
import time
import uuid

import numpy as np

import footprint_store as fs
import liq_sweeps
import measures
import observer
import of_elements as oe
import of_setups as os_
import patterns
import vp_sessions

TFS = (5, 15, 30, 60, 240)
CUTS = ("2024-01-01", "2025-07-01")  # Inicio de la fase 2 y de la fase 3 (la 3 coincide con el corte de los setups)
PHASE_NAMES = {1: "Exploración", 2: "Validación", 3: "Final"}
WARM_DAYS = oe.WINDOW_DAYS + 1  # Los umbrales relativos necesitan 30 días previos
CHUNK_DAYS = 60
TAKER_FEE = 0.00055
MAKER_FEE = 0.0002
REACH_BARS = 300          # Velas en que se mide hasta dónde llegó el precio antes del stop inicial
REACH_LEVELS = (1, 2, 3, 5)
DEFAULT_HORIZON = 96
MAX_HORIZON = 2000
GAP_MS = 6 * 3600000      # Un hueco de datos mayor cierra el trade en la última vela conocida
BASE_TRADES = 3000
SMALL_SAMPLE = 30
MAX_FILTERS = 3
MAX_WINDOW = 10           # Un gatillo puede llegar hasta 10 velas después del barrido
VP_CODES = ("VR", "VF", "VX", "VE")  # Contra el valor de la sesión anterior (vp_sessions.py)
EXTRA_CODES = ("LIQ", "VH") + VP_CODES  # Elementos del probador que no son de of_elements
MIN_TARGET_R = 0.3        # Un objetivo en un nivel a menos de esto del riesgo no se opera

_jobs = {}
_spans = {}
_lock = threading.Lock()
_write_lock = threading.Lock()


def tester_dir():
    return observer.OBSERVER_DIR / "tester"


def _ms(day):
    return int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def _iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d")


# ==================== FASES ====================

def phases(symbol):
    """Tramo de cada fase para el símbolo, según lo que hay en el almacén."""
    cov = fs.coverage(symbol)
    if not cov.get("first"):
        return []
    first = _ms(cov["first"]) + WARM_DAYS * oe.DAY_MS
    last = _ms(cov["last"]) + oe.DAY_MS
    bounds = [first, _ms(CUTS[0]), _ms(CUTS[1]), last]
    out = []
    for n in (1, 2, 3):
        start, end = max(bounds[n - 1], first), min(bounds[n], last)
        out.append({"phase": n, "name": PHASE_NAMES[n], "start": start, "end": end,
                    "from": _iso(start), "to": _iso(max(start, end - 1)), "days": max(0, (end - start) // oe.DAY_MS),
                    "available": end - start >= 30 * oe.DAY_MS, "last_day": cov["last"]})
    return out


# ==================== REGLA ====================

def _num(value, default, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(value):
        return default
    return max(low, min(high, value))


def clean_rule(raw):
    """Regla válida con valores dentro de rango; None si no tiene elementos conocidos."""
    raw = raw or {}
    name = str(raw.get("name") or "Regla")[:60]
    recipe = os_.clean_recipe({**(raw.get("recipe") or {}), "id": name}, EXTRA_CODES, MAX_WINDOW)
    if recipe is None:
        return None
    tf = int(raw.get("tf") or 15)
    if tf not in TFS:
        tf = 15
    entry, stop, exit_ = raw.get("entry") or {}, raw.get("stop") or {}, raw.get("exit") or {}
    target_r = exit_.get("targetR")
    target_r = None if target_r in (None, "", 0, "0") else _num(target_r, 2.0, 0.2, 50.0)
    trail = exit_.get("trail") if exit_.get("trail") in ("none", "swing") else "none"
    horizon = exit_.get("horizon")
    horizon = None if horizon in (None, "", 0, "0") else int(_num(horizon, DEFAULT_HORIZON, 1, MAX_HORIZON))
    known_keys = {item[0] for item in measures.MEASURES}
    filters = []
    for item in (raw.get("filters") or [])[:MAX_FILTERS]:
        if item.get("key") in known_keys and item.get("op") in (">=", "<="):
            filters.append({"key": item["key"], "op": item["op"], "value": _num(item.get("value"), 0.0, -1e9, 1e9)})
    liq = raw.get("liq") or {}
    extra = {}
    if any("LIQ" in slot["codes"] for slot in recipe["slots"]):
        # pierce: basta pasar el swing. reclaim: además una vela cierra de vuelta, en reclaimBars velas o menos
        # what: "swing" barre un swing dentro de una zona; "zone", la zona misma de lado a lado
        extra["liq"] = {"what": "zone" if liq.get("what") == "zone" else "swing",
                        "variant": "reclaim" if liq.get("variant") == "reclaim" else "pierce",
                        "swingBars": int(_num(liq.get("swingBars"), 5, 2, 20)),
                        "reclaimBars": int(_num(liq.get("reclaimBars"), 3, 0, 10))}
    if any(c in VP_CODES for slot in recipe["slots"] for c in slot["codes"]):
        vp = raw.get("vp") or {}
        hours = int(_num(vp.get("hours"), 24, 4, 168))
        # accept: minutos seguidos cerrando dentro (VR) o fuera (VX) del valor. failBars: velas para que un fallo cierre de vuelta
        shapes = sorted({s for s in (vp.get("shapes") or []) if s in vp_sessions.SHAPES})
        extra["vp"] = {**({"shapes": shapes} if shapes and len(shapes) < len(vp_sessions.SHAPES) else {}),  # Formas del perfil anterior que se operan
                       "hours": hours if hours in vp_sessions.PERIODS else 24, "accept": int(_num(vp.get("accept"), 30, 5, 480)),
                       "failBars": int(_num(vp.get("failBars"), 3, 1, 20)), "rows": int(_num(vp.get("rows"), 50, 10, 400)),
                       "share": _num(vp.get("share"), 70, 40, 95)}
        if any("VE" in slot["codes"] for slot in recipe["slots"]):
            # touch: entra tras el primer toque del borde. resting: orden limit esperando en el borde toda la sesión
            extra["vp"]["veEntry"] = "resting" if vp.get("veEntry") == "resting" else "touch"
        # Objetivo en un nivel del perfil en vez de un múltiplo del riesgo. mid: el centro del rango de la sesión anterior
        if exit_.get("targetAt") in ("poc", "edge", "mid"):
            extra["targetAt"], target_r = exit_["targetAt"], None
    if target_r is None and trail == "none" and horizon is None and "targetAt" not in extra:
        horizon = DEFAULT_HORIZON  # Sin objetivo hace falta otra salida
    entry_rule = {"type": entry.get("type") if entry.get("type") in ("market", "limit") else "market",
                  "at": entry.get("at") if entry.get("at") in ("near", "mid", "far") else "near",
                  "expiry": int(_num(entry.get("expiry"), 8, 1, 200))}
    if (extra.get("vp") or {}).get("veEntry") == "resting":
        # La orden espera en el borde del valor hasta que termina la sesión
        entry_rule = {"type": "limit", "at": "near", "expiry": max(1, extra["vp"]["hours"] * 60 // tf)}
    return {
        **extra,
        "name": name, "tf": tf, "recipe": recipe, "invert": bool(raw.get("invert")),
        "entry": entry_rule,
        "stop": {"type": stop.get("type") if stop.get("type") in ("swing", "candle", "zone", "atr") else "swing",
                 "bars": int(_num(stop.get("bars"), 5, 2, 20)), "atr": _num(stop.get("atr"), 1.5, 0.1, 20.0),
                 "buffer": _num(stop.get("buffer"), 0.1, 0.0, 5.0), "minAtr": _num(stop.get("minAtr"), 0.1, 0.0, 10.0),
                 "maxAtr": _num(stop.get("maxAtr"), 6.0, 0.2, 100.0)},
        "exit": {"targetR": target_r, "trail": trail, "trailBars": int(_num(exit_.get("trailBars"), 5, 2, 20)),
                 "horizon": horizon, "opposite": bool(exit_.get("opposite"))},
        "oneAtATime": raw.get("oneAtATime") is not False,
        # Velas de espera tras cerrar un trade antes de tomar otra señal (solo con una posición a la vez)
        "cooldown": int(_num(raw.get("cooldown"), 0, 0, 500)),
        # Hueco mínimo, en ATR, entre el área de valor y la vela que la abandona. 0 = la regla literal
        "vaGap": _num(raw.get("vaGap"), 0.0, 0.0, 5.0),
        "filters": filters,
        "target": _num(raw.get("target"), oe.DEFAULT_TARGET, 0.005, 0.3),
        "volFilter": _num(raw.get("volFilter"), oe.DEFAULT_VOL_FILTER, 0.0, 10.0),
    }


def rule_hash(symbol, rule):
    """Identidad de la regla exacta: el nombre no cuenta, lo demás sí."""
    body = {k: v for k, v in rule.items() if k != "name"}
    body["recipe"] = {k: v for k, v in rule["recipe"].items() if k != "id"}
    text = json.dumps([symbol, body], sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


# ==================== ELEMENTOS DEL TRAMO ====================

def _span_path(symbol, tf, phase, rule):
    key = f"{symbol}_{tf}_f{phase['phase']}_{phase['from']}_{phase['to']}_t{rule['target']}_v{rule['volFilter']}"
    return tester_dir() / "cache" / (key.replace(".", "p") + ".npz")


def detect_span(symbol, tf, phase, rule, progress=None):
    """Velas y elementos de toda la fase. Se calcula una vez y queda en disco: una fase no cambia."""
    path = _span_path(symbol, tf, phase, rule)
    with _lock:
        cached = _spans.get(str(path))
    if cached is not None:
        return cached
    if path.exists():
        with np.load(path, allow_pickle=False) as z:
            bars = [dict(t=int(t), o=float(o), h=float(h), l=float(l), c=float(c), delta=float(d), vol=float(v))
                    for t, o, h, l, c, d, v in zip(z["t"], z["o"], z["h"], z["l"], z["c"], z["delta"], z["vol"])]
            events = [dict(code=str(code), dir=int(d), t=int(t), known=int(k), lo=float(lo), hi=float(hi))
                      for code, d, t, k, lo, hi in zip(z["e_code"], z["e_dir"], z["e_t"], z["e_known"], z["e_lo"], z["e_hi"])]
        span = {"bars": bars, "events": events}
    else:
        start, end, tf_ms = phase["start"], phase["end"], tf * 60000
        bars, events = [], []
        total = max(1, math.ceil((end - start) / (CHUNK_DAYS * oe.DAY_MS)))
        chunk_start, done = start, 0
        while chunk_start < end:
            chunk_end = min(end, chunk_start + CHUNK_DAYS * oe.DAY_MS)
            # Se pide una vela de más para que la última del tramo vea a su siguiente (VA abandonada);
            # lo que pasa del tramo se descarta y llega con el tramo que sigue
            part = oe.detect(symbol, tf, chunk_start, min(end, chunk_end + tf_ms) - 1, end, rule["target"], 0, rule["volFilter"])
            bars.extend(b for b in part["bars"] if chunk_start <= b["t"] < chunk_end)
            events.extend(e for e in part["events"] if chunk_start <= e["t"] < chunk_end and e["known"] <= end)
            chunk_start = chunk_end
            done += 1
            if progress:
                progress(done, total)
        span = {"bars": [dict(t=b["t"], o=b["o"], h=b["h"], l=b["l"], c=b["c"], delta=b["delta"], vol=b["vol"]) for b in bars],
                "events": [dict(code=e["code"], dir=e["dir"], t=e["t"], known=e["known"], lo=e["lo"], hi=e["hi"]) for e in events]}
        if span["bars"]:
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(".tmp.npz")
            b, e = span["bars"], span["events"]
            np.savez_compressed(
                partial, t=np.array([x["t"] for x in b], np.int64), o=np.array([x["o"] for x in b]),
                h=np.array([x["h"] for x in b]), l=np.array([x["l"] for x in b]), c=np.array([x["c"] for x in b]),
                delta=np.array([x["delta"] for x in b]), vol=np.array([x["vol"] for x in b]),
                e_code=np.array([x["code"] for x in e], dtype="U2"), e_dir=np.array([x["dir"] for x in e], np.int8),
                e_t=np.array([x["t"] for x in e], np.int64), e_known=np.array([x["known"] for x in e], np.int64),
                e_lo=np.array([x["lo"] for x in e]), e_hi=np.array([x["hi"] for x in e]))
            partial.replace(path)
    with _lock:
        _spans[str(path)] = span
        while len(_spans) > 3:
            _spans.pop(next(iter(_spans)))
    return span


def early_candles(symbol, tf, before_ms):
    """
    Velas del almacén de trades desde el inicio de la fase 1 hasta before_ms, para el gráfico de la ventana: el caché
    de velas de App 1 guarda 5 años y la fase 1 empieza antes. Columnas t, o, h, l, c, v. Queda en disco por mes.
    """
    tf = int(tf)
    first = next((p["start"] for p in phases(symbol) if p["phase"] == 1), None)
    empty = {"t": [], "o": [], "h": [], "l": [], "c": [], "v": []}
    if first is None or tf not in TFS or before_ms <= first:
        return empty
    step = tf * 60000
    end = before_ms // step * step
    # El final se lleva al cierre del día: el archivo no cambia cada vez que el caché de velas corre una vela
    stop = -(-end // oe.DAY_MS) * oe.DAY_MS
    path = tester_dir() / "cache" / f"velas_{symbol}_{tf}_{_iso(first)}_{_iso(stop - 1)}.npz"
    if path.exists():
        with np.load(path, allow_pickle=False) as z:
            cols = {k: z[k] for k in empty}
    else:
        parts_t, parts = [], {k: [] for k in "ohlcv"}
        start = first
        while start < stop:
            chunk = min(stop, start + CHUNK_DAYS * oe.DAY_MS)
            found = fs._parts(symbol, start // 60000, chunk // 60000)
            if found:
                c = fs._candles(found, tf)
                parts_t.append(c["start"].astype(np.int64) * 60000)
                for key, name in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close")):
                    parts[key].append(c[name])
                parts["v"].append(c["buy"] + c["sell"])
            start = chunk
        if not parts_t:
            return empty
        cols = {"t": np.concatenate(parts_t), **{k: np.concatenate(v) for k, v in parts.items()}}
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".tmp.npz")
        np.savez_compressed(partial, **cols)
        partial.replace(path)
    keep = cols["t"] < end
    return {"t": cols["t"][keep].tolist(), **{k: np.round(cols[k][keep], 8).tolist() for k in "ohlcv"}}


# ==================== SIMULACIÓN ====================

def _pivot(values, start, n, sign):
    """Pivote más reciente en `start` o antes: mínimo (sign 1) o máximo (-1) de n velas a cada lado."""
    for p in range(start, max(n, start - 200) - 1, -1):
        if _is_pivot(values[p - n:p + n + 1], values[p], sign):
            return p
    return None


def _is_pivot(window, value, sign):
    """El único extremo de su ventana: empatar con una vecina no cuenta, como en S&R v2."""
    extreme = min(window) if sign > 0 else max(window)
    return value == extreme and window.count(extreme) == 1


def _stop_price(rule, ctx, k, side, zone, entry_hint):
    """Stop de la regla con lo conocido al cierre de la vela k. None si no hay dónde ponerlo."""
    stop, atr = rule["stop"], ctx["atr"][k]
    buffer = stop["buffer"] * atr
    lows, highs = ctx["L"], ctx["H"]
    kind = stop["type"]
    if kind == "atr":
        return entry_hint - side * stop["atr"] * atr
    if kind == "zone" and zone is not None:
        return zone[0] - buffer if side > 0 else zone[1] + buffer
    if kind == "swing":
        values = lows if side > 0 else highs
        # El swing debe quedar detrás de la entrada: si el último no lo está se busca el anterior
        # Un pivote necesita sus velas de la derecha ya cerradas: el más reciente posible es k - bars
        p = k - stop["bars"]
        for _ in range(6):
            p = _pivot(values, p, stop["bars"], side)
            if p is None:
                break
            if (entry_hint - values[p]) * side > 0:
                return values[p] - side * buffer
            p -= 1
        first = max(0, k - 4 * stop["bars"])
        return (min(lows[first:k + 1]) - buffer) if side > 0 else (max(highs[first:k + 1]) + buffer)
    # candle (y zone sin zona): extremo desde la primera vela del elemento hasta la que dispara
    first = max(0, min(k, ctx.get("i0", k)))
    return (min(lows[first:k + 1]) - buffer) if side > 0 else (max(highs[first:k + 1]) + buffer)


def _minute_path(ctx, j):
    """Minutos de la vela j: listas (t, h, l), o None sin almacén."""
    reader = ctx.get("minutes")
    if reader is None:
        return None
    t0 = ctx["T"][j] // 60000
    data = reader(ctx["symbol"], t0, t0 + ctx["tf"])
    if data is None or not len(data["m"]):
        return None
    return list(zip((int(m) * 60000 for m in data["m"]), (float(x) for x in data["h"]), (float(x) for x in data["l"])))


def simulate(rule, ctx, k, side, zone=None, opposite=None):
    """
    Un trade con la señal conocida al cierre de la vela k. Devuelve None si no hay vela siguiente,
    {"skip": motivo} si la orden no entra, o el trade con "open": True si la fase termina antes de su salida.
    """
    T, O, H, L, C, atr = ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["atr"]
    n, tf_ms = len(T), ctx["tf"] * 60000
    e = k + 1
    if e >= n or T[e] - T[k] > GAP_MS:
        return None
    entry_rule, exit_rule = rule["entry"], rule["exit"]
    entry, entry_i, fee_in, limit_fill = O[e], e, TAKER_FEE, False
    if entry_rule["type"] == "limit" and zone is not None:
        share = {"near": 1.0, "mid": 0.5, "far": 0.0}[entry_rule["at"]]
        price = zone[0] + share * (zone[1] - zone[0]) if side > 0 else zone[1] - share * (zone[1] - zone[0])
        if (O[e] - price) * side > 0:  # El precio tiene que volver hasta la limit
            entry_i = None
            for j in range(e, min(n, e + entry_rule["expiry"])):
                if (L[j] < price) if side > 0 else (H[j] > price):  # Se llena al cruzar, no al tocar
                    entry, entry_i, fee_in, limit_fill = price, j, MAKER_FEE, True
                    break
            if entry_i is None:
                return {"skip": "limit sin llenar"}
    stop = _stop_price(rule, ctx, k, side, zone, entry)
    risk = (entry - stop) * side if stop is not None else 0
    if risk <= 0:
        return {"skip": "stop del lado equivocado"}
    stop_atr = risk / atr[k] if atr[k] > 0 else 0
    if stop_atr < rule["stop"]["minAtr"]:
        return {"skip": "stop muy corto"}
    if stop_atr > rule["stop"]["maxAtr"]:
        return {"skip": "stop muy largo"}
    target = entry + side * risk * exit_rule["targetR"] if exit_rule["targetR"] else None
    if rule.get("targetAt"):
        # Objetivo en el POC o en el borde contrario del valor de la sesión anterior
        levels = ctx.get("vp")
        if levels is None:
            return {"skip": "sin perfil para el objetivo"}
        if rule["targetAt"] == "mid" and levels.get("high") is not None:
            target = (levels["high"] + levels["low"]) / 2
        else:
            target = levels["poc"] if rule["targetAt"] in ("poc", "mid") else (levels["vah"] if side > 0 else levels["val"])
        if (target - entry) * side < MIN_TARGET_R * risk:
            return {"skip": "objetivo del perfil muy cerca o ya pasado"}
    initial_stop = stop

    def favorable(j):
        return ((H[j] if side > 0 else L[j]) - entry) * side / risk

    def adverse(j):
        return ((L[j] if side > 0 else H[j]) - entry) * side / risk

    exit_price = exit_t = reason = None
    mfe, mae = 0.0, 0.0
    j = entry_i
    while j < n:
        if j > entry_i and T[j] - T[j - 1] > GAP_MS:
            exit_price, exit_t, reason = C[j - 1], T[j - 1] + tf_ms, "hueco de datos"
            break
        low, high = L[j], H[j]
        hit_stop = low <= stop if side > 0 else high >= stop
        hit_goal = target is not None and (high >= target if side > 0 else low <= target)
        first_bar = limit_fill and j == entry_i
        if hit_stop and (hit_goal or first_bar):
            # Dudoso a nivel de vela: se mira minuto a minuto. En el minuto del llenado no cuenta el objetivo
            minutes = _minute_path(ctx, j)
            hit_stop = hit_goal = False
            if minutes is None:
                hit_stop = True
            else:
                filled = not first_bar
                for mt, mh, ml in minutes:
                    if not filled:
                        if (ml < entry) if side > 0 else (mh > entry):
                            filled = True
                            if (ml <= stop) if side > 0 else (mh >= stop):
                                hit_stop, exit_t = True, mt
                                break
                        continue
                    s = ml <= stop if side > 0 else mh >= stop
                    g = target is not None and (mh >= target if side > 0 else ml <= target)
                    if s or g:
                        hit_stop, hit_goal, exit_t = s, g and not s, mt
                        break
        elif first_bar and hit_goal:
            hit_goal = False  # Sin stop tocado, el objetivo en la vela del llenado se deja para la siguiente
        if hit_stop:
            gapped = (O[j] < stop) if side > 0 else (O[j] > stop)
            exit_price = O[j] if gapped and not first_bar else stop
            reason = "stop" if stop == initial_stop else "stop arrastrado"
            exit_t = exit_t or T[j]
            mae = min(mae, (exit_price - entry) * side / risk)
            break
        if hit_goal:
            exit_price, reason, exit_t = target, "objetivo", exit_t or T[j]
            mfe = max(mfe, (target - entry) * side / risk)
            break
        mfe, mae = max(mfe, favorable(j)), min(mae, adverse(j))
        # Con la vela cerrada: señal contraria, horizonte y stop arrastrado
        if exit_rule["opposite"] and opposite is not None and j > k and j in opposite and j + 1 < n:
            exit_price, exit_t, reason = O[j + 1], T[j + 1], "señal contraria"
            break
        if exit_rule["horizon"] and j - entry_i + 1 >= exit_rule["horizon"]:
            exit_price, exit_t, reason = C[j], T[j] + tf_ms, "tiempo"
            break
        if exit_rule["trail"] == "swing":
            m = exit_rule["trailBars"]
            p = j - m
            if p - m >= 0 and p > k:
                values = L if side > 0 else H
                is_pivot = _is_pivot(values[p - m:j + 1], values[p], side)
                level = values[p] - side * rule["stop"]["buffer"] * atr[j]
                if is_pivot and (level - stop) * side > 0 and (C[j] - level) * side > 0:
                    stop = level
        j += 1

    # Hasta dónde llegó antes del stop inicial, sin importar la salida elegida
    reach, reach_done = 0.0, False
    for i in range(entry_i + (1 if limit_fill else 0), min(n, entry_i + REACH_BARS)):
        if i > entry_i and T[i] - T[i - 1] > GAP_MS:
            reach_done = True
            break
        if (L[i] <= initial_stop) if side > 0 else (H[i] >= initial_stop):
            reach_done = True
            break
        reach = max(reach, favorable(i))
    else:
        reach_done = entry_i + REACH_BARS <= n

    trade = {"k": k, "entry_i": entry_i, "dir": side, "signal": T[k], "known": T[k] + tf_ms, "entry_t": T[entry_i], "entry": entry,
             "stop": initial_stop, "target": target, "risk": risk, "stop_atr": round(stop_atr, 3),
             "order": "limit" if limit_fill else "market", "reach": round(reach, 3) if reach_done else None}
    if exit_price is None:
        trade["open"] = True
        return trade
    gross = (exit_price - entry) * side / risk
    cost = (fee_in * entry + TAKER_FEE * exit_price) / risk
    trade.update(exit_t=exit_t, exit=exit_price, reason=reason, r=round(gross - cost, 4), gross=round(gross, 4),
                 mfe=round(mfe, 3), mae=round(mae, 3), bars=j - entry_i + 1, exit_i=j)
    return trade


# ==================== RESUMEN ====================

def _wilson(wins, n):
    return list(os_._wilson(wins, n))


def summary(trades):
    """Estadísticas de una lista de trades cerrados, en orden de salida."""
    rs = [t["r"] for t in trades]
    n = len(rs)
    if not n:
        return {"n": 0}
    wins = sum(1 for r in rs if r > 0)
    gains, losses = sum(r for r in rs if r > 0), -sum(r for r in rs if r < 0)
    equity, peak, drawdown, run_w, run_l, best_w, best_l = 0.0, 0.0, 0.0, 0, 0, 0, 0
    for r in rs:
        equity += r
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
        run_w, run_l = (run_w + 1, 0) if r > 0 else (0, run_l + 1)
        best_w, best_l = max(best_w, run_w), max(best_l, run_l)
    reached = [t["reach"] for t in trades if t.get("reach") is not None]
    mean = sum(rs) / n
    var = sum((r - mean) ** 2 for r in rs) / (n - 1) if n > 1 else 0.0
    return {
        "n": n, "wins": wins, "winRate": round(100 * wins / n, 1), "wilson": _wilson(wins, n),
        "avgR": round(mean, 3), "totalR": round(sum(rs), 2), "seR": round(math.sqrt(var / n), 4),
        "profitFactor": round(gains / losses, 2) if losses > 0 else None,
        "avgWin": round(gains / wins, 3) if wins else None, "avgLoss": round(-losses / (n - wins), 3) if n > wins else None,
        "maxDrawdownR": round(drawdown, 2), "bestStreak": best_w, "worstStreak": best_l,
        "avgBars": round(sum(t["bars"] for t in trades) / n, 1),
        "medianMfe": round(float(np.median([t["mfe"] for t in trades])), 2),
        "medianMae": round(float(np.median([t["mae"] for t in trades])), 2),
        "reach": {str(level): round(100 * sum(1 for x in reached if x >= level) / len(reached), 1) for level in REACH_LEVELS} if reached else None,
        "reachN": len(reached), "medianReach": round(float(np.median(reached)), 2) if reached else None,
        "smallSample": n < SMALL_SAMPLE,
    }


def _brief(trades):
    n = len(trades)
    if not n:
        return {"n": 0, "winRate": None, "avgR": None, "totalR": 0.0}
    wins = sum(1 for t in trades if t["r"] > 0)
    return {"n": n, "winRate": round(100 * wins / n, 1), "avgR": round(sum(t["r"] for t in trades) / n, 3),
            "totalR": round(sum(t["r"] for t in trades), 2)}


def _split(trades, label, check):
    yes = [t for t in trades if check(t)]
    no = [t for t in trades if not check(t)]
    return {"label": label, "with": _brief(yes), "without": _brief(no)}


def _breakdowns(trades, rule):
    by = {"year": {}, "side": {}, "hour": {}, "reason": {}, "combo": {}}
    for t in trades:
        moment = dt.datetime.fromtimestamp(t["entry_t"] / 1000, dt.timezone.utc)
        by["year"].setdefault(str(moment.year), []).append(t)
        by["side"].setdefault("Largos" if t["dir"] > 0 else "Cortos", []).append(t)
        by["hour"].setdefault(f"{moment.hour // 4 * 4:02d}-{moment.hour // 4 * 4 + 4:02d} UTC", []).append(t)
        by["reason"].setdefault(t["reason"], []).append(t)
        by["combo"].setdefault("+".join(sorted(t["votes"])), []).append(t)
    # Perfil de la sesión anterior: su forma y dónde abrió la sesión del trade, también por lado
    open_names = {1: "Abrió encima del valor", -1: "Abrió debajo del valor", 0: "Abrió dentro del valor"}
    by.update(vpShape={}, vpShapeSide={}, vpOpen={})
    for t in trades:
        vp = t.get("vp")
        if not vp:
            continue
        shape = vp.get("shape") or "?"
        by["vpShape"].setdefault(shape, []).append(t)
        by["vpShapeSide"].setdefault(f"{shape} · {'largos' if t['dir'] > 0 else 'cortos'}", []).append(t)
        by["vpOpen"].setdefault(open_names.get(vp.get("open"), "?"), []).append(t)
    out = {name: [{"label": key, **_brief(group)} for key, group in sorted(groups.items())] for name, groups in by.items()}
    out["combo"].sort(key=lambda row: -row["n"])
    out["combo"] = out["combo"][:20]
    rule_codes = sorted({c for slot in rule["recipe"]["slots"] for c in slot["codes"]})
    out["ruleElements"] = [_split(trades, c, lambda t, c=c: c in t["votes"]) for c in rule_codes] if len(rule_codes) > 1 else []
    # Con "todos" cada trade tiene todos los elementos: no hay con qué comparar
    out["ruleElements"] = [row for row in out["ruleElements"] if row["with"]["n"] and row["without"]["n"]]
    others = sorted({c for t in trades for c in t["present"]} - set(rule_codes))
    out["otherElements"] = [_split(trades, c, lambda t, c=c: c in t["present"]) for c in others]
    against = sorted({c for t in trades for c in t["against"]})
    out["againstElements"] = [_split(trades, c, lambda t, c=c: c in t["against"]) for c in against]
    for key in ("otherElements", "againstElements"):
        out[key] = [row for row in out[key] if row["with"]["n"] >= 5 and row["without"]["n"] >= 5]
        out[key].sort(key=lambda row: -abs((row["with"]["avgR"] or 0) - (row["without"]["avgR"] or 0)))
    return out


# ==================== CORRIDA ====================

def _context(symbol, tf, bars):
    _, atr, _ = os_._series(bars)
    return {"symbol": symbol, "tf": tf, "T": [b["t"] for b in bars], "O": [b["o"] for b in bars], "H": [b["h"] for b in bars],
            "L": [b["l"] for b in bars], "C": [b["c"] for b in bars], "atr": atr, "minutes": fs.minutes}


def _passes(filters, row):
    for item in filters:
        value = row.get(item["key"]) if row else None
        if value is None or (item["op"] == ">=" and value < item["value"]) or (item["op"] == "<=" and value > item["value"]):
            return False
    return True


def _va_gap_ok(min_gap, match, zones, index, ctx, tf_ms):
    """Cada VA abandonada de la señal deja al menos min_gap ATR entre su área y la vela que la abandonó."""
    for code, t in match["votes"]:
        if code != "VA":
            continue
        i = index.get(t)  # El voto cuenta en la vela que abandona el área
        if i is None or not ctx["atr"][i] > 0:
            return False
        for lo, hi, _ in zones.get((code, match["dir"], t + tf_ms), []):
            gap = ctx["L"][i] - hi if match["dir"] > 0 else lo - ctx["H"][i]
            if gap / ctx["atr"][i] < min_gap:
                return False
    return True


_extra = {}


def _extra_events(symbol, rule, span, ctx, control=False):
    """LIQ y VH de liq_sweeps para las velas de la fase. control: los barridos sin liquidación pasan por LIQ."""
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    if not codes & set(EXTRA_CODES):
        return []
    if not codes & {"LIQ", "VH"}:
        return _vp_events(symbol, rule, span)
    liq = {"what": "swing", "variant": "pierce", "swingBars": 5, "reclaimBars": 3, **(rule.get("liq") or {})}
    key = (id(span["bars"]), symbol, rule["tf"], liq["what"], liq["variant"], liq["swingBars"], liq["reclaimBars"])
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = liq_sweeps.events(symbol, span["bars"], rule["tf"], liq["swingBars"], liq["variant"], liq["reclaimBars"], ctx["atr"],
                                  what=liq["what"])
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    wanted = "SWP" if control else "LIQ"
    out = [{**e, "code": "LIQ"} if e["code"] == wanted else e for e in found if e["code"] in (wanted, "VH")]
    return out + _vp_events(symbol, rule, span)


def _vp_levels(symbol, hours, rows, share, start_ms, end_ms):
    """Niveles de las sesiones del tramo, guardados en disco: una sesión cerrada no cambia."""
    path = tester_dir() / "cache" / f"vp3_{symbol}_{hours}h_{rows}_{int(share)}_{_iso(start_ms)}_{_iso(end_ms - 1)}.json"
    if path.exists():
        with open(path, encoding="utf-8") as fh:
            return {int(k): v for k, v in json.load(fh).items()}
    levels = vp_sessions.sessions(symbol, hours, start_ms - hours * vp_sessions.HOUR, end_ms, rows, share / 100)
    if levels:
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".tmp")
        with open(partial, "w", encoding="utf-8") as fh:
            json.dump(levels, fh)
        partial.replace(path)
    return levels


def _vp_events(symbol, rule, span):
    """VR, VF y VX contra el valor de la sesión anterior."""
    vp = rule.get("vp")
    bars = span["bars"]
    if not vp or not bars:
        return []
    key = (id(bars), symbol, rule["tf"], "vp", vp["hours"], vp["accept"], vp["failBars"], vp["rows"], vp["share"], vp.get("veEntry"))
    with _lock:
        found = _extra.get(key)
    if found is None:
        tf_ms = rule["tf"] * 60000
        levels = _vp_levels(symbol, vp["hours"], vp["rows"], vp["share"], bars[0]["t"], bars[-1]["t"] + tf_ms)
        accept = max(1, round(vp["accept"] / rule["tf"]))
        found = vp_sessions.events(bars, rule["tf"], levels, vp["hours"], accept, vp["failBars"], vp.get("veEntry") or "touch")
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    shapes = vp.get("shapes")
    return [e for e in found if e["info"].get("shape") in shapes] if shapes else found


def run(symbol, rule, span, phase, table=None, base=True, control=False):
    """La regla sobre las velas y elementos de la fase. Devuelve resumen, cortes y cada trade."""
    bars, events, tf = span["bars"], span["events"], rule["tf"]
    tf_ms = tf * 60000
    if len(bars) < 100:
        return {"success": False, "message": "Sin velas suficientes en el almacén para esa fase"}
    ctx = _context(symbol, tf, bars)
    extra = _extra_events(symbol, rule, span, ctx, control)
    events = events + extra if extra else events
    liq_info = {(e["dir"], e["known"]): e["info"] for e in extra if e["code"] == "LIQ"}
    vp_info = {(e["code"], e["dir"], e["known"]): e["info"] for e in extra if e["code"] in VP_CODES}
    index = {t: i for i, t in enumerate(ctx["T"])}
    votes = os_._votes(bars, events, tf_ms)
    zones = {}
    for e in events:
        zones.setdefault((e["code"], e["dir"], e["known"]), []).append((e["lo"], e["hi"], e["t"]))
    matches = os_.match_recipes(bars, events, [rule["recipe"]], tf)
    matches.sort(key=lambda m: m["known"])
    flip = -1 if rule["invert"] else 1
    known_at = {1: set(), -1: set()}
    for m in matches:
        k = index.get(m["known"] - tf_ms)
        if k is not None:
            known_at[m["dir"] * flip].add(k)

    trades, skipped, open_count, busy_until, busy = [], {}, 0, -1, 0
    window = rule["recipe"]["window"]
    # Con órdenes limit, una señal posterior puede llenarse antes que una anterior (o las dos órdenes de un rango,
    # la de arriba y la de abajo): se simulan todas y se toman por orden de llenado, no de señal
    defer = rule["oneAtATime"] and rule["entry"]["type"] == "limit"
    pending = []
    for m in matches:
        k = index.get(m["known"] - tf_ms)
        if k is None:
            continue
        side = m["dir"] * flip
        if rule["oneAtATime"] and not defer and k < busy_until:
            busy += 1
            continue
        if rule["oneAtATime"] and not defer and k < busy_until + rule["cooldown"]:
            skipped["enfriamiento"] = skipped.get("enfriamiento", 0) + 1
            continue
        if rule["vaGap"] > 0 and not _va_gap_ok(rule["vaGap"], m, zones, index, ctx, tf_ms):
            skipped["VA con hueco pequeño"] = skipped.get("VA con hueco pequeño", 0) + 1
            continue
        measured = None
        if table is not None:
            row = measures.row_at(table, m["known"])
            measured = measures.read_row(table, row, side) if row is not None else None
        if rule["filters"] and not _passes(rule["filters"], measured):
            skipped["filtro de contexto"] = skipped.get("filtro de contexto", 0) + 1
            continue
        found = [z for code, t in m["votes"] for z in zones.get((code, m["dir"], t + tf_ms), [])]
        zone = (min(z[0] for z in found), max(z[1] for z in found)) if found else None
        ctx["i0"] = index.get(min([e_t for _, e_t in m["votes"]] + [m["t0"]]), k)
        ctx["vp"] = next((vp_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in vp_info), None)
        trade = simulate(rule, ctx, k, side, zone, known_at[-side])
        if trade is None:
            continue
        if "skip" in trade:
            skipped[trade["skip"]] = skipped.get(trade["skip"], 0) + 1
            continue
        if trade.get("open"):
            if defer:
                pending.append(trade)
            else:
                open_count += 1
                busy_until = len(bars)
            continue
        lo = max(0, k - window + 1)
        trade["votes"] = sorted({code for code, _ in m["votes"]})
        trade["present"] = sorted({c for j in range(lo, k + 1) for c in votes[m["dir"]][j]})
        trade["against"] = sorted({c for j in range(lo, k + 1) for c in votes[-m["dir"]][j]})
        trade["zone"] = [round(zone[0], 8), round(zone[1], 8)] if zone else None
        # Dónde estaba cada elemento de la regla, para dibujarlo con el trade
        trade["marks"] = [{"code": code, "t": z[2], "lo": round(z[0], 8), "hi": round(z[1], 8)}
                          for code, t in m["votes"] for z in zones.get((code, m["dir"], t + tf_ms), [])]
        swept = next((liq_info[(m["dir"], t + tf_ms)] for code, t in m["votes"]
                      if code == "LIQ" and (m["dir"], t + tf_ms) in liq_info), None)
        if swept is not None:
            trade["liq"] = swept  # La zona barrida: dinero, antigüedad y hasta dónde pasó el precio
        if ctx["vp"] is not None:
            trade["vp"] = ctx["vp"]  # El valor de la sesión anterior que usó la regla, y dónde abrió la sesión
        trade["measures"] = measured
        if defer:
            pending.append(trade)
            continue
        trades.append(trade)
        if rule["oneAtATime"]:
            busy_until = trade.pop("exit_i") + 1
        else:
            trade.pop("exit_i")
    for trade in sorted(pending, key=lambda t: (t["entry_i"], t["k"])):
        if trade["entry_i"] < busy_until:
            busy += 1
        elif trade["entry_i"] < busy_until + rule["cooldown"]:
            skipped["enfriamiento"] = skipped.get("enfriamiento", 0) + 1
        elif trade.get("open"):
            open_count += 1
            busy_until = len(bars)
        else:
            trades.append(trade)
            busy_until = trade.pop("exit_i") + 1
    for number, trade in enumerate(trades, 1):
        trade["n"] = number
        trade.pop("k", None)
        trade.pop("entry_i", None)

    ordered = sorted(trades, key=lambda t: t["exit_t"])
    result = {
        "success": True, "symbol": symbol, "rule": rule, "phase": phase["phase"], "from": phase["from"], "to": phase["to"],
        "bars": len(bars), "signals": len(matches), "skipped": skipped, "busy": busy, "open": open_count,
        "summary": summary(ordered), "breakdowns": _breakdowns(trades, rule),
        "equity": _equity(ordered), "measuresAvailable": table is not None, "trades": trades,
    }
    if base:
        result["baseline"] = _baseline(rule, ctx, trades, symbol)
        s, b = result["summary"], result["baseline"]
        if s.get("n") and b.get("n"):
            edge = s["avgR"] - b["avgR"]
            se = math.sqrt(s["seR"] ** 2 + b["seR"] ** 2)
            result["edge"] = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
                              "clear": abs(edge) > 1.96 * se and not s["smallSample"]}
        if "liq" in rule and not control:
            # El mismo gatillo tras barrer un swing sin liquidaciones: dice si las liquidaciones aportan algo
            other = run(symbol, rule, span, phase, table, base=False, control=True)
            c = other.get("summary") or {}
            result["control"] = {key: c.get(key) for key in ("n", "winRate", "avgR", "seR", "profitFactor", "smallSample")}
            if s.get("n") and c.get("n"):
                edge = s["avgR"] - c["avgR"]
                se = math.sqrt(s["seR"] ** 2 + c["seR"] ** 2)
                result["control"]["edge"] = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
                                             "clear": abs(edge) > 1.96 * se and not s["smallSample"] and not c["smallSample"]}
            first = liq_sweeps.first_day(symbol)
            result["liqFrom"] = _iso(first) if first else None
    result["winnersVsLosers"] = _winners_vs_losers(trades)
    return result


def _equity(ordered):
    total, points = 0.0, []
    for t in ordered:
        total += t["r"]
        points.append([t["exit_t"], round(total, 3)])
    return points


def _baseline(rule, ctx, trades, symbol):
    """Entradas al azar con el mismo stop y la misma salida, y la misma proporción de largos y cortos."""
    if not trades:
        return {"n": 0}
    n = len(ctx["T"])
    longs = sum(1 for t in trades if t["dir"] > 0) / len(trades)
    rng = random.Random(int(hashlib.sha1(f"{symbol}{rule['tf']}{n}".encode()).hexdigest()[:8], 16))
    stop = rule["stop"]
    if stop["type"] in ("zone", "candle"):
        # Ese stop depende del elemento, que al azar no existe: se usa la distancia mediana de los trades de la regla
        stop = {**stop, "type": "atr", "atr": max(0.1, float(np.median([t["stop_atr"] for t in trades])))}
    base_rule = {**rule, "entry": {**rule["entry"], "type": "market"}, "stop": stop}
    if rule.get("targetAt"):
        # Al azar no hay perfil: el objetivo es el múltiplo del riesgo mediano que tuvieron los trades de la regla
        reward = [abs(t["target"] - t["entry"]) / t["risk"] for t in trades if t.get("target") is not None and t["risk"] > 0]
        base_rule = {k: v for k, v in base_rule.items() if k != "targetAt"}
        base_rule["exit"] = {**rule["exit"], "targetR": max(0.2, float(np.median(reward))) if reward else 1.0}
    light = {**ctx, "minutes": None, "i0": None}  # Sin minuto a minuto: en la duda cuenta el stop, como en contra de la base no sesga a favor
    done = []
    for _ in range(BASE_TRADES):
        k = rng.randrange(30, n - 2)
        side = 1 if rng.random() < longs else -1
        light["i0"] = k
        trade = simulate(base_rule, light, k, side)
        if trade and "skip" not in trade and not trade.get("open"):
            done.append(trade)
    stats = summary(done)
    return {key: stats.get(key) for key in ("n", "winRate", "avgR", "seR", "profitFactor", "reach", "medianReach")}


def _winners_vs_losers(trades):
    winners = [t["measures"] for t in trades if t["r"] > 0 and t.get("measures")]
    losers = [t["measures"] for t in trades if t["r"] <= 0 and t.get("measures")]
    if len(winners) < patterns.MIN_GROUP or len(losers) < patterns.MIN_GROUP:
        return None
    labels = patterns._labels()
    keys = [item[0] for item in measures.MEASURES if item[0] not in patterns.UNCOMPARED]
    result = patterns.compare_groups(winners, losers, keys, labels)
    result["rows"] = result["rows"][:25]
    return result


# ==================== REGISTRO Y TRABAJOS ====================

def _runs_path():
    return tester_dir() / "runs.jsonl"


def _run_path(run_id):
    return tester_dir() / "runs" / f"{run_id}.json.gz"


def history(symbol=None):
    path = _runs_path()
    rows = []
    if path.exists():
        with open(path, encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
    return [r for r in rows if symbol is None or r.get("symbol") == symbol]


def _save(result, digest):
    run_id = f"{result['symbol']}_{result['rule']['tf']}_f{result['phase']}_{digest}_{int(time.time())}"
    result["id"], result["hash"], result["at"] = run_id, digest, int(time.time() * 1000)
    with _write_lock:
        path = _run_path(run_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(result, fh, allow_nan=False, separators=(",", ":"))
        record = {"id": run_id, "at": result["at"], "symbol": result["symbol"], "tf": result["rule"]["tf"],
                  "phase": result["phase"], "hash": digest, "name": result["rule"]["name"], "rule": result["rule"],
                  "from": result["from"], "to": result["to"], "summary": result["summary"],
                  "baseline": result.get("baseline"), "edge": result.get("edge")}
        with open(_runs_path(), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
    return run_id


def load_run(run_id):
    path = _run_path(run_id)
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def public_run(result):
    """La corrida sin las medidas de cada trade, que se piden por trade."""
    if result is None:
        return None
    out = dict(result)
    out["trades"] = [{k: v for k, v in t.items() if k != "measures"} for t in result["trades"]]
    return out


def trade_detail(run_id, number):
    result = load_run(run_id)
    if result is None:
        return None
    for t in result["trades"]:
        if t["n"] == number:
            labels = patterns._labels()
            rows = [{"key": k, "label": labels[k][0], "group": labels[k][1], "value": v}
                    for k, v in (t.get("measures") or {}).items() if k in labels]
            return {"trade": {k: v for k, v in t.items() if k != "measures"}, "measures": rows}
    return None


def gate(symbol, rule, phase_number):
    """Qué se sabe antes de correr una fase: corrida guardada, variantes probadas y si la fase 3 está permitida."""
    digest = rule_hash(symbol, rule)
    rows = history(symbol)
    same = [r for r in rows if r["hash"] == digest and r["phase"] == phase_number]
    info = {"hash": digest, "stored": same[-1]["id"] if same and phase_number > 1 else None,
            "variantsPhase1": len({r["hash"] for r in rows if r["phase"] == 1}),
            "rulesInPhase": len({r["hash"] for r in rows if r["phase"] == phase_number}),
            "ranPhase1": any(r["hash"] == digest and r["phase"] == 1 for r in rows),
            "ranPhase2": any(r["hash"] == digest and r["phase"] == 2 for r in rows)}
    info["blocked"] = "La fase 3 pide haber corrido antes esta misma regla en la fase 2" if phase_number == 3 and not info["ranPhase2"] else None
    return info


def start(symbol, raw_rule, phase_number, confirm=False):
    """Lanza la corrida en un hilo. Las fases 2 y 3 devuelven la guardada si esa regla exacta ya se corrió."""
    rule = clean_rule(raw_rule)
    if rule is None:
        return {"success": False, "message": "La regla no tiene elementos conocidos"}
    phase = next((p for p in phases(symbol) if p["phase"] == phase_number), None)
    if phase is None or not phase["available"]:
        return {"success": False, "message": "El almacén de trades no cubre esa fase para este símbolo"}
    info = gate(symbol, rule, phase_number)
    if info["blocked"]:
        return {"success": False, "message": info["blocked"], "gate": info}
    if info["stored"]:
        return {"success": True, "run": info["stored"], "stored": True, "gate": info}
    if phase_number > 1 and not confirm:
        return {"success": True, "needsConfirm": True, "gate": info, "phase": phase}
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "state": "running", "done": 0, "total": 1, "stage": "Elementos del tramo", "run": None, "error": None}
    with _lock:
        _jobs[job_id] = job

    def work():
        try:
            span = detect_span(symbol, rule["tf"], phase, rule, lambda d, t: job.update(done=d, total=t))
            job["stage"] = "Simulando los trades"
            table = measures.table_for(symbol)
            result = run(symbol, rule, span, phase, table)
            if not result.get("success"):
                job.update(state="error", error=result.get("message"))
                return
            result["gate"] = info
            job.update(run=_save(result, info["hash"]), state="done")
        except Exception as error:  # El hilo no puede dejar el trabajo colgado
            job.update(state="error", error=f"{type(error).__name__}: {error}")

    threading.Thread(target=work, daemon=True).start()
    return {"success": True, "job": job_id, "gate": info}


def job_status(job_id):
    with _lock:
        job = _jobs.get(job_id)
    return dict(job) if job else None


def sensitivity(symbol, raw_rule):
    """Solo en la fase 1: la regla con valores vecinos de objetivo y ventana, para ver si el resultado es frágil."""
    rule = clean_rule(raw_rule)
    phase = next((p for p in phases(symbol) if p["phase"] == 1), None)
    if rule is None or phase is None or not phase["available"]:
        return {"success": False, "message": "Regla o fase no válidas"}
    if not _span_path(symbol, rule["tf"], phase, rule).exists():
        return {"success": False, "message": "Corre primero la regla en la fase 1"}
    span = detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule["filters"] else None
    rows = []

    def add(label, variant, current=False):
        result = run(symbol, variant, span, phase, table, base=False)
        if result.get("success"):
            s = result["summary"]
            rows.append({"label": label, "current": current, "n": s.get("n", 0), "winRate": s.get("winRate"),
                         "avgR": s.get("avgR"), "totalR": s.get("totalR"), "profitFactor": s.get("profitFactor")})

    add("Regla actual", rule, True)
    target = rule["exit"]["targetR"]
    if target:
        for value in sorted({round(target * f, 2) for f in (0.5, 0.75, 1.25, 1.5)}):
            add(f"Objetivo {value} R", {**rule, "exit": {**rule["exit"], "targetR": value}})
    for window in (rule["recipe"]["window"] - 1, rule["recipe"]["window"] + 1):
        if 1 <= window <= MAX_WINDOW and len(rule["recipe"]["slots"]) > 1:
            add(f"Ventana {window} velas", {**rule, "recipe": {**rule["recipe"], "window": window}})
    for buffer in sorted({round(rule["stop"]["buffer"] * f, 3) for f in (0.5, 2.0)} | {0.0}):
        if buffer != rule["stop"]["buffer"]:
            add(f"Margen del stop {buffer} ATR", {**rule, "stop": {**rule["stop"], "buffer": buffer}})
    return {"success": True, "rows": rows}


def export_csv(run_id):
    result = load_run(run_id)
    if result is None:
        return None
    keys = [item[0] for item in measures.MEASURES]
    head = ["n", "lado", "senal_utc", "entrada_utc", "salida_utc", "orden", "entrada", "stop", "objetivo", "salida", "motivo",
            "r_neto", "r_bruto", "max_favor_r", "max_contra_r", "alcance_r", "velas", "stop_atr", "elementos_regla",
            "elementos_presentes", "elementos_en_contra", "liq_swing", "liq_extremo", "liq_usd", "liq_dias", "liq_atr"] + keys
    stamp = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")
    lines = [",".join(head)]
    for t in result["trades"]:
        m = t.get("measures") or {}
        row = [t["n"], "largo" if t["dir"] > 0 else "corto", stamp(t["signal"]), stamp(t["entry_t"]), stamp(t["exit_t"]),
               t["order"], t["entry"], round(t["stop"], 8), "" if t["target"] is None else round(t["target"], 8), t["exit"],
               t["reason"], t["r"], t["gross"], t["mfe"], t["mae"], "" if t["reach"] is None else t["reach"], t["bars"],
               t["stop_atr"], " ".join(t["votes"]), " ".join(t["present"]), " ".join(t["against"])]
        liq = t.get("liq") or {}
        row += ["" if liq.get(k) is None else liq[k] for k in ("swing", "extreme", "usd", "zoneAgeDays", "depthAtr")]
        row += ["" if m.get(k) is None else m[k] for k in keys]
        lines.append(",".join(str(x) for x in row))
    return "\n".join(lines) + "\n"
