"""
Arnés de la capa A del protocolo (21/11/2026): corre una regla en el motor del probador capturando cada llamada a
`rule_tester.simulate` (la regla, el azar y el tramo) y repite cada una con los oráculos A (`oraculo.py`) y B
(`oraculo_b.py`, si existe), con las mismas entradas. Compara campo por campo y también la selección final.

Uso como módulo:
    cap = capture("BTCUSDT", regla_cruda, fase=1)
    rep = compare_calls(cap)            # dict con conteos y ejemplos
"""
import copy
import importlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import rule_tester as rt  # noqa: E402
import measures  # noqa: E402
import onchain_flows  # noqa: E402
import oraculo as oa  # noqa: E402

FIELDS_PRICE = ("entry", "stop", "target", "risk", "exit")
FIELDS_EXACT = ("side", "entry_i", "exit_t", "reason", "order", "tp_on", "chain_on", "entry_t")
FIELDS_R = ("r", "gross")
FIELDS_SOFT = ("mfe", "mae", "reach", "stop_atr")


def _phase(symbol, n):
    return next(p for p in rt.phases(symbol) if p["phase"] == n)


def capture(symbol, raw_rule, phase=1, one_at_a_time=None, span=None, base=True):
    """Corre la regla y guarda cada llamada a simulate con sus entradas y su salida."""
    rule = rt.clean_rule(raw_rule)
    if rule is None:
        raise ValueError("regla sin elementos")
    if one_at_a_time is not None:
        rule = {**rule, "oneAtATime": bool(one_at_a_time)}
    ph = _phase(symbol, phase)
    span = span or rt.detect_span(symbol, rule["tf"], ph, rule)
    table = measures.table_for(symbol)
    calls, contexts = [], {}
    original = rt.simulate

    def spy(rule_, ctx, k, side, zone=None, opposite=None, sides=None, path=None):
        out = original(rule_, ctx, k, side, zone, opposite, sides, path)
        contexts.setdefault(id(ctx["T"]), ctx)
        calls.append({"who": "rule" if rule_ is rule else "control", "rule": rule_, "ctx": id(ctx["T"]),
                      "k": k, "side": side, "zone": zone, "i0": ctx.get("i0"),
                      "expiry": (ctx.get("entryInfo") or {}).get("expiry"), "wise": (ctx.get("entryInfo") or {}).get("wise"),
                      "opposite": opposite, "sides": sides,
                      "vp": copy.deepcopy(ctx.get("vp")), "out": copy.deepcopy(out)})
        return out

    rt.simulate = spy
    started = time.time()
    try:
        result = rt.run(symbol, rule, span, ph, table, base=base)
    finally:
        rt.simulate = original
    return {"symbol": symbol, "rule": rule, "phase": ph, "span": span, "result": result, "calls": calls,
            "contexts": contexts, "seconds": round(time.time() - started, 1)}


def _bars_of(ctx, symbol, own_minutes=True):
    minutes = None
    if ctx.get("minutes") is not None and rt.has_store(symbol) and own_minutes:
        reader = oa.MinuteReader(symbol)
        minutes = reader
    elif ctx.get("minutes") is not None and not rt.is_stock(symbol):
        minutes = None
    return oa.Bars(ctx["tf"], ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["atr"], minutes, ctx.get("gap"))


def _chain_on(rule_, ctx):
    ct = rule_["exit"].get("chainTarget")
    if not ct or "bars" not in ctx:
        return None
    z = rt._chain_series(ct, ctx)[1]
    return lambda k, side: bool(onchain_flows.chain_ok(ct, z[k], side))


def _level_target(rule_, ctx, call):
    if not rule_.get("targetAt"):
        return None
    if rule_["targetAt"] == "weak":
        rng = rt._smc_range(rule_, ctx)
        return lambda sig: (rng["top"][sig["k"]] if sig["side"] > 0 else rng["bottom"][sig["k"]])
    vp = call["vp"]
    if vp is None:
        return lambda sig: None
    if rule_["targetAt"] == "mid" and vp.get("high") is not None:
        return lambda sig: (vp["high"] + vp["low"]) / 2
    if rule_["targetAt"] in ("poc", "mid"):
        return lambda sig: vp["poc"]
    return lambda sig: (vp["vah"] if sig["side"] > 0 else vp["val"])


def _close(a, b, rel=1e-9):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, float) or isinstance(b, float):
        a, b = float(a), float(b)
        if math.isnan(a) and math.isnan(b):
            return True
        return abs(a - b) <= rel * max(1.0, abs(a), abs(b))
    return a == b


def diff(engine, oracle):
    """Campos que no coinciden entre la salida del motor y la de un oráculo."""
    if engine is None or oracle is None:
        return [] if engine is None and oracle is None else ["existe"]
    if ("skip" in engine) or ("skip" in oracle):
        return [] if engine.get("skip") == oracle.get("skip") else ["skip"]
    if engine.get("open") or oracle.get("open"):
        return [] if bool(engine.get("open")) == bool(oracle.get("open")) else ["open"]
    bad = []
    side_e = engine.get("dir", engine.get("side"))
    if side_e != oracle.get("side"):
        bad.append("side")
    for f in FIELDS_PRICE:
        if not _close(engine.get(f), oracle.get(f)):
            bad.append(f)
    for f in ("entry_i", "exit_t", "reason", "order", "entry_t"):
        if engine.get(f) != oracle.get(f):
            bad.append(f)
    for f in ("tp_on", "chain_on"):
        if (f in engine or f in oracle) and engine.get(f) != oracle.get(f):
            bad.append(f)
    for f in FIELDS_R:
        if abs((engine.get(f) or 0) - (oracle.get(f) or 0)) > 1.5e-4:
            bad.append(f)
    for f in ("mfe", "mae"):
        if abs((engine.get(f) or 0) - (oracle.get(f) or 0)) > 1.5e-3:
            bad.append(f)
    if (engine.get("reach") is None) != (oracle.get("reach") is None) or (
            engine.get("reach") is not None and abs(engine["reach"] - oracle["reach"]) > 1.5e-3):
        bad.append("reach")
    if engine.get("bars") != oracle.get("bars"):
        bad.append("bars")
    return bad


def _oracle_b():
    try:
        return importlib.import_module("oraculo_b")
    except Exception:
        return None


def replay_call(cap, call, variant=None, own_minutes=True):
    ctx = cap["contexts"][call["ctx"]]
    b = _bars_of(ctx, cap["symbol"], own_minutes)
    rule_ = call["rule"]
    sig = {"k": call["k"], "side": call["side"], "zone": call["zone"], "i0": call["i0"], "expiry": call["expiry"],
           "wise": call.get("wise"), "sides": call["sides"]}
    return oa.simulate(b, rule_, sig, opposite=call["opposite"], exit_at=ctx.get("exitAt"), vpa_exit=ctx.get("vpaExit"),
                       chain_on=_chain_on(rule_, ctx), level_target=_level_target(rule_, ctx, call),
                       taker=ctx.get("taker", rt.TAKER_FEE), maker=ctx.get("maker", rt.MAKER_FEE), variant=variant)


def replay_call_b(mod, cap, call):
    """La misma llamada con el oráculo B (su interfaz: simulate_signals con una sola señal)."""
    ctx = cap["contexts"][call["ctx"]]
    rule_ = call["rule"]
    bars = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": 0.0} for t, o, h, l, c in zip(ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"])]
    reader = oa.MinuteReader(cap["symbol"]) if (ctx.get("minutes") is not None and rt.has_store(cap["symbol"])) else None
    tf_ms = ctx["tf"] * 60000
    minutes_of = (lambda j: reader(ctx["T"][j], ctx["T"][j] + tf_ms)) if reader else None
    opp = call["opposite"]
    if isinstance(opp, dict):
        opposite = {1: set(opp.get(1) or ()), -1: set(opp.get(-1) or ())}
    else:
        opposite = {-call["side"]: set(opp or ()), call["side"]: set()}
    sig = {"k": call["k"], "side": call["side"], "zone": list(call["zone"]) if call["zone"] else None, "i0": call["i0"],
           "expiry": call["expiry"], "id": 0,
           # Sin lados, las dos órdenes stop van a los dos lados (como _straddle_fill: sides or (1, -1)); lo demás, al de la llamada
           "sides": tuple(call["sides"] or ((1, -1) if rule_["entry"]["type"] == "straddle" else (call["side"],)))}
    lt = _level_target(rule_, ctx, call)
    out = mod.simulate_signals(ctx["tf"], bars, list(ctx["atr"]), [sig], {**rule_, "oneAtATime": False},
                               minutes_of=minutes_of, opposite=opposite, exit_at=ctx.get("exitAt"),
                               vpa_exit=ctx.get("vpaExit"), chain_on=_chain_on(rule_, ctx),
                               level_target=(lambda s: lt(s)) if lt else None,
                               taker=ctx.get("taker", rt.TAKER_FEE), maker=ctx.get("maker", rt.MAKER_FEE),
                               gap_ms=ctx.get("gap"))
    res = out["results"][0] if out.get("results") else None
    return res


def compare_calls(cap, who=("rule", "control"), variant=None, use_b=True, limit_examples=12):
    mod = _oracle_b() if use_b else None
    rep = {"symbol": cap["symbol"], "tf": cap["rule"]["tf"], "phase": cap["phase"]["phase"], "seconds_engine": cap["seconds"],
           "calls": 0, "by_who": {}, "mismatch_a": {}, "mismatch_b": {}, "examples_a": [], "examples_b": []}
    for call in cap["calls"]:
        if call["who"] not in who:
            continue
        rep["calls"] += 1
        rep["by_who"][call["who"]] = rep["by_who"].get(call["who"], 0) + 1
        engine = call["out"]
        a = replay_call(cap, call, variant)
        bad = diff(engine, a)
        for f in bad:
            rep["mismatch_a"][f] = rep["mismatch_a"].get(f, 0) + 1
        if bad and len(rep["examples_a"]) < limit_examples:
            rep["examples_a"].append({"who": call["who"], "k": call["k"], "side": call["side"], "fields": bad,
                                      "engine": _brief(engine), "oracle": _brief(a)})
        if mod is not None:
            try:
                bb = replay_call_b(mod, cap, call)
            except Exception as error:  # Un fallo del oráculo B no detiene la comparación
                bb = {"skip": f"error B: {type(error).__name__}: {error}"}
            badb = diff(engine, bb)
            for f in badb:
                rep["mismatch_b"][f] = rep["mismatch_b"].get(f, 0) + 1
            if badb and len(rep["examples_b"]) < limit_examples:
                rep["examples_b"].append({"who": call["who"], "k": call["k"], "side": call["side"], "fields": badb,
                                          "engine": _brief(engine), "oracle": _brief(bb)})
    return rep


def _brief(t):
    if t is None:
        return None
    keys = ("skip", "open", "dir", "side", "entry_i", "entry", "stop", "target", "exit_i", "exit", "exit_t", "reason", "r", "gross",
            "mfe", "mae", "reach", "bars", "order", "tp_on", "chain_on")
    return {k: (round(v, 8) if isinstance(v, float) else v) for k, v in t.items() if k in keys}


def selection_check(cap_all, cap_one):
    """La selección de la especificación aplicada a las señales de una corrida sin "una posición a la vez" contra los
    trades de la misma regla con ella."""
    rule = cap_one["rule"]
    results = [(c["k"], c["out"]) for c in cap_all["calls"] if c["who"] == "rule"]
    norm = []
    for k, out in results:
        if out is None or "skip" in out:
            norm.append((k, out))
            continue
        o = dict(out)
        o["side"] = o.get("dir")
        norm.append((k, o))
    deferred = rule["entry"]["type"] in ("limit", "straddle", "stop")
    # Desde el motor 5, las órdenes llenadas en la misma vela van por cuándo se llenó cada una: el oráculo lo calcula
    # con sus propias velas y su lector de minutos (fill_time), no con lo que dice el motor
    ctx = next(iter(cap_all["contexts"].values()))
    b = _bars_of(ctx, cap_all["symbol"])
    fill_key = (lambda r: oa.fill_time(b, r["entry_i"], r["side"], r["entry"], r["order"])) if deferred else None
    # Desde el motor 6 (etapa 7): la selección nueva (H15, F-01, H19), escrita aparte en el oráculo. El momento de la salida
    # sale de las velas del oráculo: el primer toque de su precio en su vela (fill_time con "stop"), o fuera de la vela
    tf_ms = b.tf_ms if hasattr(b, "tf_ms") else None

    def exit_key(r):
        j = r["exit_i"]
        t0 = b.T[j]
        if r["exit_t"] >= t0 + (tf_ms or 0) or r["exit_t"] < t0:
            return (r["exit_t"], 0.0)
        return oa.fill_time(b, j, 1 if r["exit"] > b.O[j] else -1, r["exit"], "stop")
    taken, fates = oa.select_motor6(norm, rule["cooldown"], deferred, fill_key=fill_key, exit_key=exit_key if deferred else None)
    mine = [(t["entry_t"], t["dir"], round(t["r"], 4)) for t in taken]
    theirs = [(t["entry_t"], t["dir"], round(t["r"], 4)) for t in cap_one["result"]["trades"]]
    return {"engine": len(theirs), "oracle": len(mine), "same": mine == theirs,
            "only_engine": [x for x in theirs if x not in mine][:8], "only_oracle": [x for x in mine if x not in theirs][:8]}


def atr_check(cap):
    """El ATR del motor contra el del oráculo, en todas las velas del contexto de la regla."""
    ctx = next(iter(cap["contexts"].values()))
    mine = oa.atr14(ctx["H"], ctx["L"], ctx["C"])
    theirs = list(ctx["atr"])
    worst = max(abs(a - b) / max(1e-12, abs(b)) for a, b in zip(mine, theirs))
    return {"bars": len(mine), "max_rel": worst}


def to_json(obj):
    def fix(x):
        if isinstance(x, (np.integer,)):
            return int(x)
        if isinstance(x, (np.floating,)):
            return float(x)
        if isinstance(x, (set, tuple)):
            return list(x)
        return str(x)
    return json.dumps(obj, ensure_ascii=False, indent=1, default=fix)
