"""Los 64 casos de respuesta conocida del oráculo B (test_oraculo_b_casos.py), corridos con el oráculo A.

El oráculo A (oraculo.py) tiene otra interfaz: un trade por llamada (`simulate`) y la selección aparte (`select`). Aquí
se envuelve con la de B (`simulate_signals`) sin cambiar ninguno de los dos oráculos ni los casos: cada caso se vuelve
a armar con el adaptador en lugar de la función de B. Una falla dice dónde el oráculo A (que repite al motor en todas
las corridas) se aparta de la respuesta calculada a mano con la especificación.

Uso (desde backend/): python -B -m pytest -q tests/audit/test_oraculo_a_casos.py
"""
import bisect
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oraculo as oa  # noqa: E402
import test_oraculo_b_casos as casos  # noqa: E402


def simulate_signals_a(tf, bars, atr, signals, rule, minutes_of=None, opposite=None, exit_at=None,
                       vpa_exit=None, chain_on=None, level_target=None, taker=0.00055, maker=0.0002,
                       gap_ms=None):
    T = [x["t"] for x in bars]
    O = [x["o"] for x in bars]
    H = [x["h"] for x in bars]
    L = [x["l"] for x in bars]
    C = [x["c"] for x in bars]
    minutes = None
    if minutes_of is not None:
        def minutes(t0, t1):
            j = bisect.bisect_left(T, t0)
            return [(t, h, l) for t, h, l in (minutes_of(j) or []) if t0 <= t < t1] if j < len(T) and T[j] == t0 else []
    b = oa.Bars(tf, T, O, H, L, C, list(atr), minutes=minutes, gap_ms=gap_ms)
    # El oráculo A recibe la regla ya limpia (como la da clean_rule); los casos traen solo lo que usan. Se completa con
    # lo que la especificación toma cuando falta: sin margen, sin topes del stop y la salida VPA armada desde 0 R.
    stop = dict(rule.get("stop") or {})
    for key, default in (("buffer", 0.0), ("minAtr", 0.0), ("maxAtr", float("inf"))):
        if stop.get(key) is None:
            stop[key] = default
    rule = {**rule, "stop": stop, "exit": dict(rule.get("exit") or {})}
    if rule["exit"].get("vpa") is not None:
        rule["exit"]["vpa"] = {"fromR": 0.0, **rule["exit"]["vpa"]}
    # Los casos son de la especificación de antes del motor 6: sin el tope de la comisión (H18), lo a favor de la vela del
    # llenado desde su apertura (H4) y el alcance de 299 velas (O-05). Lo del motor 6, en test_oraculo_a_motor6.py
    rule.setdefault("maxFeeR", 0)
    results, pairs = [], []
    for s in signals:
        sig = {"k": s["k"], "side": s["side"], "zone": s.get("zone"), "i0": s.get("i0", s["k"]),
               "expiry": s.get("expiry"), "sides": tuple(s.get("sides") or (s["side"],))}
        r = oa.simulate(b, rule, sig, opposite=opposite, exit_at=exit_at, vpa_exit=vpa_exit, chain_on=chain_on,
                        level_target=level_target, taker=taker, maker=maker, variant={"h4": False, "o05": False})
        r = {"skip": "sin vela siguiente"} if r is None else dict(r)
        r["id"] = s.get("id")
        results.append(r)
        pairs.append((s["k"], r))
    etype = (rule.get("entry") or {}).get("type") or "market"
    deferred = etype in ("limit", "straddle", "stop")
    one = bool(rule.get("oneAtATime", False))
    order = sorted(range(len(pairs)), key=lambda i: pairs[i][0])
    taken, fates_a = oa.select([pairs[i] for i in order], one, int(rule.get("cooldown") or 0), deferred)
    ids = {(k, r.get("side"), r.get("entry_i")): r["id"] for k, r in pairs if "skip" not in r}
    fates = {ids.get(key, key): why for key, why in fates_a.items()}
    return {"results": results, "trades": [dict(r, n=n) for n, r in enumerate(taken, 1)], "fates": fates}


# Cada función del módulo de los casos, armada otra vez con el adaptador en su lugar
_g = dict(casos.__dict__)
_g["simulate_signals"] = simulate_signals_a
for _name, _obj in list(casos.__dict__.items()):
    if isinstance(_obj, types.FunctionType) and _obj.__module__ == casos.__name__:
        _new = types.FunctionType(_obj.__code__, _g, _name, _obj.__defaults__, _obj.__closure__)
        _new.__kwdefaults__ = _obj.__kwdefaults__
        _new.__dict__.update(_obj.__dict__)          # las marcas de pytest (parametrize) viven aquí
        _g[_name] = _new
for _name, _obj in list(_g.items()):
    if _name.startswith("test_") and isinstance(_obj, types.FunctionType):
        globals()[_name] = _obj
del _g, _name, _obj
