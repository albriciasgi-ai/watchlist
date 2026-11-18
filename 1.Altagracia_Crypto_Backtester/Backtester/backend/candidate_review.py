"""
Revisión de candidatos, por sesiones: una regla floja del probador propone momentos y quien opera decide en cada uno
si entra, a ciegas. Mide lo que su criterio agrega sobre la regla.

Una sesión es una moneda y un tramo seguido de la fase 1 (nunca de la 2 ni de la 3: esas quedan frescas para comprobar
reglas). Los candidatos van en orden: se decide uno y se pasa al siguiente, y el resultado de cada decisión solo se
entrega cuando el candidato a la vista ya es posterior a su salida. Lo que pasa después del candidato a la vista
nunca sale del servidor.

Registro: OrderFlowData/observer/review/sessions.jsonl. Solo se agregan líneas: `session`, `decision` y `end`.
"""
import bisect
import copy
import json
import random
import threading
import time

import measures
import observer
import rule_tester as rt

DEFAULT_DAYS = 28
MIN_DAYS, MAX_DAYS = 7, 120
MIN_CANDIDATES = 8        # Con menos no hay sesión que valga: se busca otro tramo
MAX_CANDIDATES = 60       # Una sesión más larga se corta ahí
TRIES = 40
LIMIT_BARS = 12          # Velas que espera una entrada limit propia antes de vencer
AFTER_BARS = 8           # Velas que se ven después de la salida de un trade antes del candidato siguiente
POSITION_GROUPS = ((1, 5), (6, 10), (11, 20), (21, MAX_CANDIDATES))
_lock = threading.Lock()


def review_dir():
    return observer.OBSERVER_DIR / "review"


def _journal():
    return review_dir() / "sessions.jsonl"


def _append(event):
    path = _journal()
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock, open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, separators=(",", ":")) + "\n")


def sessions():
    """Cada sesión con sus decisiones, en el orden en que se crearon."""
    path = _journal()
    out = {}
    if not path.exists():
        return out
    with _lock, open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue  # Una línea cortada no tumba el registro
        if event.get("event") == "session":
            out[event["id"]] = {**event, "decisions": [], "ended": None}
        elif event.get("session") in out:
            if event["event"] == "decision":
                out[event["session"]]["decisions"].append(event)
            elif event["event"] == "end":
                out[event["session"]]["ended"] = event.get("at")
    return out


def _generator(rule):
    """La regla como propone candidatos: cada señal cuenta, a mercado, sin esperar a que cierre la anterior."""
    gen = copy.deepcopy(rule)
    gen["oneAtATime"] = False
    gen["cooldown"] = 0
    gen["entry"] = {**gen["entry"], "type": "market"}
    return gen


def _ready(symbol, rule, phase):
    """Si la fase 1 de esa moneda se puede leer ya, sin detectar elementos durante minutos."""
    if phase is None or not phase["available"]:
        return False
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    if rt._on_candles(symbol, rule["tf"]):
        return not codes - set(rt.CANDLE_CODES)
    return rt._span_path(symbol, rule["tf"], phase, rule).exists()


def _phase1(symbol):
    return next((p for p in rt.phases(symbol) if p["phase"] == 1), None)


def _candidates(symbol, rule):
    """Todas las señales de la regla en la fase 1, con lo que la regla habría hecho en cada una."""
    phase = _phase1(symbol)
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule["filters"] else None
    result = rt.run(symbol, rule, span, phase, table, base=False)
    tf_ms = rule["tf"] * 60000
    found = []
    for t in result.get("trades") or []:
        if t.get("open") or t.get("r") is None:
            continue
        found.append({"time": t["signal"] + tf_ms, "signal": t["signal"], "dir": t["dir"], "entry": t["entry"], "stop": t["stop"],
                      "target": t.get("target"), "exit": t["exit"], "exit_t": t["exit_t"], "r": t["r"], "reason": t["reason"],
                      "reach": t.get("reach"), "votes": t.get("votes") or []})
    found.sort(key=lambda c: c["time"])
    return phase, found


def _pick_stretch(phase, found, days, taken, rng):
    """Un tramo de `days` días con candidatos suficientes, que no pise un tramo ya usado si se puede."""
    day = 86400000
    first, last = phase["start"] + 10 * day, phase["end"] - days * day - 20 * day  # Margen para leer el contexto y para que todo cierre
    if last <= first:
        return None
    best = None
    for attempt in range(TRIES):
        start = (first + rng.randrange(0, max(1, (last - first) // day)) * day)
        end = start + days * day
        inside = [c for c in found if start <= c["time"] < end][:MAX_CANDIDATES]
        if len(inside) < MIN_CANDIDATES:
            continue
        overlap = any(start < b and a < end for a, b in taken)
        if not overlap:
            return start, end, inside
        best = best or (start, end, inside)
    return best


def start(symbol, raw_rule, days=DEFAULT_DAYS, any_symbol=False, seed=None):
    """Abre una sesión. Con `any_symbol` la moneda se elige al azar entre las que ya tienen lista la fase 1 para esa regla."""
    rule = rt.clean_rule(raw_rule)
    if rule is None:
        return {"success": False, "message": "La regla no tiene elementos conocidos"}
    rule = _generator(rule)
    days = int(max(MIN_DAYS, min(MAX_DAYS, days or DEFAULT_DAYS)))
    rng = random.Random(seed)
    symbols = [symbol]
    if any_symbol:
        symbols = [s for s in rt.candle_symbols() if _ready(s, rule, _phase1(s))]
        rng.shuffle(symbols)
        if not symbols:
            return {"success": False, "message": "Ninguna moneda tiene lista la fase 1 para esta regla: córrela primero en la fase 1"}
    past = sessions()
    for sym in symbols:
        phase = _phase1(sym)
        if not _ready(sym, rule, phase):
            if any_symbol:
                continue
            return {"success": False, "message": f"Corre primero esta regla en la fase 1 de {sym}: la revisión usa los elementos ya detectados"
                    if phase and phase["available"] else f"{sym} no tiene datos de la fase 1 para esta regla"}
        phase, found = _candidates(sym, rule)
        taken = [(s["start"], s["end"]) for s in past.values() if s["symbol"] == sym]
        stretch = _pick_stretch(phase, found, days, taken, rng)
        if stretch is None:
            continue
        begin, end, inside = stretch
        session = {"event": "session", "id": f"rev_{sym}_{int(time.time() * 1000)}", "symbol": sym, "tf": rule["tf"], "rule": rule,
                   "hash": rt.rule_hash(sym, rule), "start": begin, "end": end, "days": days, "at": int(time.time() * 1000),
                   "candidates": [{**c, "i": i} for i, c in enumerate(inside)]}
        _append(session)
        return {"success": True, **public({**session, "decisions": [], "ended": None})}
    return {"success": False, "message": f"La regla da menos de {MIN_CANDIDATES} candidatos en {days} días: sube los días o afloja la regla"}


def _own_trade(session, candidate, side, stop, target, limit=None):
    """El trade de quien decide, con su stop y su objetivo, simulado con las reglas del probador. Con `limit`, la entrada
    espera en ese precio hasta LIMIT_BARS velas y se llena al cruzarlo; si la apertura siguiente ya es mejor que ese
    precio, entra a mercado. Devuelve (trade, problema, vencimiento): sin llenarse, trade es None y vencimiento su hora."""
    symbol, rule = session["symbol"], session["rule"]
    span = rt.detect_span(symbol, rule["tf"], _phase1(symbol), rule)
    bars = span["bars"]
    ctx = rt._context(symbol, rule["tf"], bars)
    times = ctx["T"]
    k = bisect.bisect_left(times, candidate["signal"])
    if k >= len(times) or times[k] != candidate["signal"] or k + 1 >= len(times):
        return None, "No se encontró la vela del candidato", None
    entry, atr = ctx["O"][k + 1], ctx["atr"][k]
    waits = limit is not None and (entry - limit) * side > 0   # El precio tiene que volver hasta la limit
    if waits:
        entry = limit
    if stop is None or (entry - stop) * side <= 0:
        return None, "El stop tiene que quedar detrás de la entrada", None
    if target is not None and (target - entry) * side <= 0:
        return None, "El objetivo tiene que quedar delante de la entrada", None
    risk = abs(entry - stop)
    own = copy.deepcopy(rule)
    own["invert"] = False
    own["stop"] = {**own["stop"], "type": "atr", "atr": risk / atr if atr > 0 else 1.0, "buffer": 0.0, "minAtr": 0.0, "maxAtr": 1e9}
    own["exit"] = {**own["exit"], "targetR": abs(target - entry) / risk if target is not None else None, "trail": "none", "opposite": False,
                   "horizon": own["exit"].get("horizon") or rt.DEFAULT_HORIZON}
    own.pop("targetAt", None)
    own["entry"] = {"type": "limit", "at": "near", "expiry": LIMIT_BARS} if waits else {**own["entry"], "type": "market"}
    trade = rt.simulate(own, ctx, k, side, zone=(limit, limit) if waits else None)
    if trade and trade.get("skip") == "limit sin llenar":
        return None, None, times[min(len(times) - 1, k + LIMIT_BARS)] + rule["tf"] * 60000
    if not trade or trade.get("skip") or trade.get("open"):
        return None, "Ese trade no se pudo simular hasta su salida", None
    return {"order": "limit" if waits else "market", "dir": side, "entry": trade["entry"], "entry_t": trade["entry_t"], "stop": trade["stop"], "target": trade.get("target"),
            "exit": trade["exit"], "exit_t": trade["exit_t"], "r": trade["r"], "reason": trade["reason"]}, None, None


def decide(session_id, index, action, stop=None, target=None, seconds=None, follow=False, entry=None):
    """Una decisión sobre el candidato a la vista: `skip`, `rule` (como propone la regla), `long` o `short` con stop y objetivo propios.
    Con `follow`, tras entrar el gráfico sigue hasta que el trade cierra y unas velas más: los candidatos que caen en ese
    tramo quedan como `passed` (no se deciden), como al operar una posición a la vez."""
    session = sessions().get(session_id)
    if session is None:
        return {"success": False, "message": "Esa sesión no existe"}
    if session["ended"] or len(session["decisions"]) >= len(session["candidates"]):
        return {"success": False, "message": "La sesión ya terminó"}
    if index != len(session["decisions"]):
        return {"success": False, "message": "Ese no es el candidato a la vista"}
    candidate = session["candidates"][index]
    if action not in ("skip", "rule", "long", "short"):
        return {"success": False, "message": "Decisión no válida"}
    trade, unfilled = None, None
    if action == "rule":
        trade = {k: candidate[k] for k in ("dir", "entry", "stop", "target", "exit", "exit_t", "r", "reason")}
        trade["entry_t"] = candidate["time"]
    elif action in ("long", "short"):
        trade, problem, unfilled = _own_trade(session, candidate, 1 if action == "long" else -1, stop, target, entry)
        if trade is None and unfilled is None:
            return {"success": False, "message": problem}
    event = {"event": "decision", "session": session_id, "i": index, "action": action, "trade": trade, "at": int(time.time() * 1000),
             "seconds": round(float(seconds), 1) if isinstance(seconds, (int, float)) and 0 <= seconds < 86400 else None}
    if unfilled is not None:
        event["unfilled"] = unfilled  # La limit no se llenó: hora en que venció
    _append(event)
    session["decisions"].append(event)
    if follow and (trade or unfilled is not None):
        resume = trade["exit_t"] + AFTER_BARS * session["tf"] * 60000 if trade else unfilled
        for later in session["candidates"][index + 1:]:
            if later["time"] >= resume:
                break
            passed = {"event": "decision", "session": session_id, "i": later["i"], "action": "passed", "trade": None, "at": event["at"], "seconds": None}
            _append(passed)
            session["decisions"].append(passed)
    if len(session["decisions"]) >= len(session["candidates"]):
        _append({"event": "end", "session": session_id, "at": event["at"]})
        session["ended"] = event["at"]
    return {"success": True, **public(session)}


def end(session_id):
    session = sessions().get(session_id)
    if session is None:
        return {"success": False, "message": "Esa sesión no existe"}
    if not session["ended"]:
        stamp = int(time.time() * 1000)
        _append({"event": "end", "session": session_id, "at": stamp})
        session["ended"] = stamp
    return {"success": True, **public(session)}


def _shown(candidate):
    """Lo que se puede ver de un candidato al decidir: nada posterior a su hora."""
    return {"i": candidate["i"], "time": candidate["time"], "signal": candidate["signal"], "dir": candidate["dir"], "entry": candidate["entry"],
            "stop": candidate["stop"], "target": candidate["target"], "votes": candidate.get("votes") or []}


def public(session):
    """La sesión como la puede ver quien decide. El resultado de una decisión solo sale si su salida ya quedó atrás
    del candidato a la vista, o si la sesión terminó."""
    done = bool(session["ended"])
    position = len(session["decisions"])
    current = session["candidates"][position] if not done and position < len(session["candidates"]) else None
    now = current["time"] if current else None
    decisions = []
    for d in session["decisions"]:
        candidate = session["candidates"][d["i"]]
        row = {"i": d["i"], "action": d["action"], "time": candidate["time"], "proposed": candidate["dir"]}
        trade = d.get("trade")
        if d.get("unfilled") is not None:
            row["unfilled" if done or d["unfilled"] <= now else "pending"] = True
        if trade and not done and trade["entry_t"] > now:
            row["pending"] = True  # Una limit que se llena después de la hora a la vista: todavía no se sabe
        elif trade:
            row.update(dir=trade["dir"], entry=trade["entry"], entry_t=trade["entry_t"], stop=trade["stop"], target=trade["target"], order=trade.get("order"))
            if done or trade["exit_t"] <= now:
                row.update(exit=trade["exit"], exit_t=trade["exit_t"], r=trade["r"], reason=trade["reason"])
        if done or candidate["exit_t"] <= now:
            row["ruleR"] = candidate["r"]  # Lo que hizo la regla ahí, se haya entrado o no
        decisions.append(row)
    out = {"session": {"id": session["id"], "symbol": session["symbol"], "tf": session["tf"], "start": session["start"], "total": len(session["candidates"]),
                       "position": position, "done": done, "name": session["rule"].get("name"), "until": _until(session) if done else None},
           "candidate": _shown(current) if current else None, "decisions": decisions}
    if done:
        out["summary"] = _summary([_row(session, d) for d in session["decisions"]])
    return out


def _until(session):
    """Hasta dónde se muestra el gráfico de una sesión terminada: la salida del último trade y unas velas más, sin pasar del tramo siguiente por decidir."""
    step = AFTER_BARS * session["tf"] * 60000
    times = [session["candidates"][d["i"]]["time"] for d in session["decisions"]] + [d["trade"]["exit_t"] + step for d in session["decisions"] if d.get("trade")]
    times += [d["unfilled"] for d in session["decisions"] if d.get("unfilled") is not None]
    return max(times) if times else session["start"]


def active(symbol=None):
    """La última sesión sin terminar (de esa moneda, si se pide)."""
    open_ = [s for s in sessions().values() if not s["ended"] and (symbol is None or s["symbol"] == symbol)]
    return {"success": True, **public(open_[-1])} if open_ else {"success": True, "session": None}


def state(session_id):
    session = sessions().get(session_id)
    return {"success": True, **public(session)} if session else {"success": False, "message": "Esa sesión no existe"}


# ==================== INFORME ====================

def _row(session, decision):
    candidate = session["candidates"][decision["i"]]
    trade = decision.get("trade")
    return {"position": decision["i"] + 1, "taken": trade is not None, "r": trade["r"] if trade else None, "ruleR": candidate["r"],
            "action": "unfilled" if decision.get("unfilled") is not None else decision["action"], "seconds": decision.get("seconds"), "symbol": session["symbol"], "session": session["id"],
            "exit_t": trade["exit_t"] if trade else None, "time": candidate["time"]}


def _stat(values):
    values = [v for v in values if v is not None]
    n = len(values)
    if not n:
        return {"n": 0, "winRate": None, "avgR": None, "margin": None, "totalR": 0.0}
    mean = sum(values) / n
    sd = (sum((v - mean) ** 2 for v in values) / (n - 1)) ** 0.5 if n > 1 else 0.0
    return {"n": n, "winRate": round(100 * sum(1 for v in values if v > 0) / n, 1), "avgR": round(mean, 3),
            "margin": round(1.96 * sd / n ** 0.5, 3) if n > 1 else None, "totalR": round(sum(values), 2)}


def _gap(a, b):
    """Diferencia de R medio entre dos grupos, con su margen. `clear` solo si el margen no incluye el cero y hay 30 por grupo."""
    a, b = [v for v in a if v is not None], [v for v in b if v is not None]
    if len(a) < 2 or len(b) < 2:
        return None
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    va = sum((v - ma) ** 2 for v in a) / (len(a) - 1)
    vb = sum((v - mb) ** 2 for v in b) / (len(b) - 1)
    half = 1.96 * (va / len(a) + vb / len(b)) ** 0.5
    diff = ma - mb
    return {"r": round(diff, 3), "low": round(diff - half, 3), "high": round(diff + half, 3),
            "clear": (diff - half > 0 or diff + half < 0) and min(len(a), len(b)) >= 30}


def _summary(rows):
    passed = sum(1 for r in rows if r["action"] == "passed")
    unfilled = sum(1 for r in rows if r["action"] == "unfilled")
    # Lo que pasó con un trade abierto no fue una decisión, y una limit sin llenar no fue un trade ni un "no entro"
    rows = [r for r in rows if r["action"] not in ("passed", "unfilled")]
    taken = [r for r in rows if r["taken"]]
    skipped = [r for r in rows if not r["taken"]]
    out = {"decisions": len(rows), "passed": passed, "unfilled": unfilled, "taken": _stat([r["r"] for r in taken]), "takenAsRule": _stat([r["ruleR"] for r in taken]),
           "skipped": _stat([r["ruleR"] for r in skipped]), "rule": _stat([r["ruleR"] for r in rows]),
           # Lo que agrega elegir: lo tomado contra lo dejado, medido con la misma vara (lo que hizo la regla en cada uno)
           "selection": _gap([r["ruleR"] for r in taken], [r["ruleR"] for r in skipped]),
           # Lo que agrega todo el criterio (elegir, lado, stop y objetivo): tus trades contra tomar todos como la regla
           "overRule": _gap([r["r"] for r in taken], [r["ruleR"] for r in rows])}
    groups = []
    for low, high in POSITION_GROUPS:
        part = [r for r in rows if low <= r["position"] <= high]
        if not part:
            continue
        secs = sorted(r["seconds"] for r in part if r["seconds"] is not None)
        groups.append({"label": f"{low} a {high}" if high < MAX_CANDIDATES else f"{low} en adelante", "decisions": len(part),
                       "taken": _stat([r["r"] for r in part if r["taken"]]), "skipped": _stat([r["ruleR"] for r in part if not r["taken"]]),
                       "rule": _stat([r["ruleR"] for r in part]), "seconds": secs[len(secs) // 2] if secs else None})
    out["byPosition"] = groups
    return out


def report():
    """Todas las sesiones juntas. De una sesión sin terminar solo cuentan las decisiones cuyo resultado ya se pudo ver."""
    rows, listed, streak = [], [], {"win": [], "loss": []}
    for session in sessions().values():
        done = bool(session["ended"])
        position = len(session["decisions"])
        now = None if done or position >= len(session["candidates"]) else session["candidates"][position]["time"]
        own = []
        for d in session["decisions"]:
            row = _row(session, d)
            candidate = session["candidates"][d["i"]]
            seen = done or now is None or (candidate["exit_t"] <= now and (row["exit_t"] is None or row["exit_t"] <= now))
            if seen:
                own.append(row)
        # Tras ganar o tras perder: el trade tomado anterior que ya había cerrado al decidir este
        closed = []
        for row in own:
            if row["taken"]:
                before = [p for p in closed if p["exit_t"] <= row["time"]]
                if before:
                    streak["win" if before[-1]["r"] > 0 else "loss"].append(row["r"])
                closed.append(row)
        rows.extend(own)
        listed.append({"id": session["id"], "symbol": session["symbol"], "tf": session["tf"], "name": session["rule"].get("name"), "at": session["at"],
                       "done": done, "total": len(session["candidates"]), "decided": position,
                       "taken": _stat([r["r"] for r in own if r["taken"]]), "rule": _stat([r["ruleR"] for r in own])})
    return {"success": True, "sessions": listed[::-1], **_summary(rows), "afterWin": _stat(streak["win"]), "afterLoss": _stat(streak["loss"]),
            "smallSample": sum(1 for r in rows if r["taken"]) < 30}
