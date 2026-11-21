"""Los sabios de Williams y la estructura SMC en el probador: la entrada stop de un lado, la salida bajo el mínimo de N
velas, los filtros, el objetivo débil, los elementos y que una regla de antes conserve su identidad.
Uso: python -m pytest tests/test_williams_smc.py"""
import random

import pytest

import rule_tester as rt
import smc
import williams
from tests.test_trailing_straddle import ctx_of, path

MS = 240 * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2023-12-31"}


def rule_of(codes=("WD",), **raw):
    return rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": list(codes)}]}, **raw})


def walk(n, seed=5, start=100.0):
    rnd = random.Random(seed)
    bars, price = [], start
    for i in range(n):
        o = price
        c = o * (1 + (rnd.random() - 0.5) * 0.04)
        h, l = max(o, c) * (1 + rnd.random() * 0.015), min(o, c) * (1 - rnd.random() * 0.015)
        bars.append({"t": i * MS, "o": o, "h": h, "l": l, "c": c, "vol": 100 + rnd.random() * 900, "delta": 0.0})
        price = c
    return bars


def test_una_regla_de_antes_conserva_su_identidad_y_las_piezas_nuevas_solo_entran_si_se_piden():
    plain = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "exit": {"targetR": 2}})
    for key in ("wise", "smc", "bwf", "smcf", "targetAt"):
        assert key not in plain
    assert set(plain["entry"]) == {"type", "at", "expiry"}
    stop = rule_of(entry={"type": "stop", "expiry": 7})
    assert stop["entry"] == {"type": "stop", "offset": 0.0, "expiry": 7, "cancel": True}
    assert stop["wise"] == {"lookback": 1, "angBars": 5, "minGapAtr": 0.0, "requireAo": True, "teeth": True}
    full = rule_of(("OB",), bwf={"alligator": "awake", "zone": True}, smcf={"pd": True}, exit={"targetAt": "weak"}, smc={"swing": 20, "internal": 30})
    assert full["bwf"] == {"alligator": "awake", "zone": True}
    assert full["smcf"] == {"pd": True, "swing": 20}
    assert full["targetAt"] == "weak" and full["exit"]["targetR"] is None
    assert full["smc"]["internal"] < full["smc"]["swing"], "la interna más corta que la mayor"
    assert rule_of(exit={"trail": "bars", "trailBars": 3})["exit"]["trail"] == "bars"
    # Los elementos nuevos son de velas: valen sin almacén de trades y en 1D
    assert set(williams.CODES) | set(smc.CODES) <= set(rt.CANDLE_CODES)


def test_la_orden_stop_se_llena_en_el_borde_de_la_zona_espera_y_se_cancela_si_antes_pasa_el_otro_borde():
    closes = [100] * 30 + [100, 100.5, 101.5, 102]
    bars = path(closes, wick=0.1)
    ctx = ctx_of(bars)
    rule = rule_of(entry={"type": "stop", "expiry": 3})
    # Orden de compra en 101 (borde alto de la zona [99, 101]): la vela que va de 100.5 a 101.5 la pasa
    assert rt._stop_fill(rule, ctx, 29, 30, (99.0, 101.0), 1) == (pytest.approx(101.0), 32)
    # Vence antes: espera una sola vela
    assert rt._stop_fill(rule_of(entry={"type": "stop", "expiry": 1}), ctx, 29, 30, (99.0, 101.0), 1) is None
    # Se cancela: el precio pasa antes el borde bajo de la zona
    down = path([100] * 30 + [99.5, 98.5, 102], wick=0.1)
    assert rt._stop_fill(rule, ctx_of(down), 29, 30, (99.0, 101.0), 1) is None
    assert rt._stop_fill(rule_of(entry={"type": "stop", "expiry": 3, "cancel": False}), ctx_of(down), 29, 30, (99.0, 101.0), 1)[1] == 32
    # Abre más allá del nivel: se llena en la apertura
    gap = path([100] * 30, wick=0.1) + [{"t": 30 * MS, "o": 103.0, "h": 103.5, "l": 102.8, "c": 103.2, "vol": 100.0, "delta": 0.0}]
    assert rt._stop_fill(rule, ctx_of(gap), 29, 30, (99.0, 101.0), 1) == (103.0, 30)
    # El 3.er sabio trae su propia espera
    ctx = ctx_of(path([100] * 30 + [100.2] * 8 + [102], wick=0.1))
    ctx["entryInfo"] = {"expiry": 9}
    assert rt._stop_fill(rule, ctx, 29, 30, (101.0, 101.0), 1)[1] == 38


def test_la_salida_bajo_el_minimo_de_n_velas_sigue_al_precio_y_solo_se_acerca():
    closes = [100] * 40 + [101, 102, 103, 104, 105, 104, 103, 102, 101]
    bars = path(closes, wick=0.0)
    rule = rule_of(("WD",), stop={"type": "atr", "atr": 2, "maxAtr": 50, "buffer": 0}, exit={"trail": "bars", "trailBars": 3})
    t = rt.simulate(rule, ctx_of(bars), 39, 1)
    assert t["reason"] == "stop arrastrado"
    # Tras la vela que cierra en 105 el mínimo de las 3 últimas es 103: la vela que baja de 104 a 103 no lo pasa y la
    # que baja de 103 a 102 sí
    assert t["exit"] == pytest.approx(103.0)


def test_los_sabios_en_la_corrida_entran_con_su_orden_stop_y_el_azar_tambien():
    bars = walk(2500, seed=9)
    rule = rule_of(("WD", "WA"), entry={"type": "stop", "expiry": 5}, stop={"type": "candle", "maxAtr": 20}, exit={"targetR": 2})
    rule["recipe"]["mode"] = "threshold"
    rule["recipe"]["min"] = 1
    span = {"bars": bars, "events": []}
    result = rt.run("TEST", rule, span, PHASE)
    assert result["summary"]["n"] > 20
    for t in result["trades"][:30]:
        assert t["order"] == "stop"
        signal = next(b for b in bars if b["t"] == t["signal"])
        level = signal["h"] if t["dir"] > 0 else signal["l"]
        opened = next(b for b in bars if b["t"] == t["entry_t"])
        assert t["entry"] == pytest.approx(level) or t["entry"] == pytest.approx(opened["o"])
        assert t["stop"] == pytest.approx(signal["l"] if t["dir"] > 0 else signal["h"], rel=0.02)
    assert result["baseline"]["n"] > 100, "las entradas al azar ponen su orden stop a la distancia mediana"


def test_el_tercer_sabio_espera_hasta_que_el_precio_pasa_su_fractal():
    bars = walk(1500, seed=21)
    events = williams.events(bars, 240, None, ("WF",))
    assert events
    for e in events[:40]:
        k = next(i for i, b in enumerate(bars) if b["t"] == e["t"])
        hit = k + e["info"]["expiry"]
        side = e["dir"]
        assert (bars[hit]["h"] > e["hi"]) if side > 0 else (bars[hit]["l"] < e["lo"])
        for j in range(k + 1, hit):
            assert (bars[j]["h"] <= e["hi"]) if side > 0 else (bars[j]["l"] >= e["lo"])


def test_los_elementos_smc_y_sus_zonas():
    bars = walk(3000, seed=4)
    found = smc.events(bars, 240, {"swing": 20, "internal": 5}, ("BS", "OB", "BK", "EQ"))
    codes = {e["code"] for e in found}
    assert {"BS", "OB", "BK", "EQ"} <= codes
    for e in found:
        assert e["lo"] <= e["hi"]
        assert e["known"] == e["t"] + MS
        if e["code"] == "EQ":
            i = next(j for j, b in enumerate(bars) if b["t"] == e["t"])
            # El barrido va contra el lado barrido y cerró de vuelta
            level = e["info"]["level"]
            assert (bars[i]["h"] > level and bars[i]["c"] < level) if e["dir"] < 0 else (bars[i]["l"] < level and bars[i]["c"] > level)
    # Con entrada limit en la zona, el OB espera que el precio vuelva a él
    rule = rule_of(("OB",), smc={"swing": 20}, entry={"type": "limit", "at": "near", "expiry": 40}, stop={"type": "zone", "maxAtr": 20}, exit={"targetR": 2})
    result = rt.run("TEST", rule, {"bars": bars, "events": []}, PHASE)
    assert result["summary"]["n"] > 5
    assert all(t["order"] == "limit" for t in result["trades"])


def test_filtros_de_williams_y_smc_y_el_objetivo_debil():
    bars = walk(2000, seed=12)
    series = williams.compute([b["h"] for b in bars], [b["l"] for b in bars], [b["c"] for b in bars])
    for k in range(100, 2000, 37):
        for side in (1, -1):
            assert williams.filter_ok({"alligator": "awake"}, series, k, side) == (series["state"][k] == side)
            assert williams.filter_ok({"zone": True}, series, k, side) == (series["zone"][k] == side)
    rng = smc.ranges(bars, {"swing": 20})
    close = [b["c"] for b in bars]
    for k in range(200, 2000, 41):
        top, bottom = rng["top"][k], rng["bottom"][k]
        if top == top and bottom == bottom and top > bottom:
            middle = (top + bottom) / 2
            assert smc.filter_ok({"pd": True}, rng, close, k, 1) == (close[k] < middle)
            assert smc.filter_ok({"pd": True}, rng, close, k, -1) == (close[k] > middle)
    rule = rule_of(("BS",), smc={"swing": 20}, exit={"targetAt": "weak"}, stop={"type": "atr", "atr": 1.5, "maxAtr": 20})
    result = rt.run("TEST", rule, {"bars": bars, "events": []}, PHASE)
    with_target = [t for t in result["trades"] if t.get("target") is not None]
    assert with_target, "el objetivo es el borde del rango mayor"
    index = {b["t"]: i for i, b in enumerate(bars)}
    for t in with_target[:20]:
        k = index[t["signal"]]
        assert t["target"] == pytest.approx(rng["top"][k] if t["dir"] > 0 else rng["bottom"][k])


def test_los_controles_al_azar_entran_solo_donde_dejan_los_filtros_de_williams_y_smc(monkeypatch):
    bars = walk(1500, seed=21)
    ctx = rt._context("TEST", 240, bars)
    ctx["minutes"], ctx["bars"] = None, bars
    series = williams.compute(ctx["H"], ctx["L"], ctx["C"])
    trades = [{"dir": 1, "stop_atr": 1.5}, {"dir": -1, "stop_atr": 1.5}]
    seen = []
    monkeypatch.setattr(rt, "simulate", lambda rule, c, k, side, **kw: seen.append((k, side)))
    rule = rule_of(("WF",), bwf={"alligator": "awake"}, stop={"type": "atr", "atr": 1.5, "maxAtr": 20}, exit={"targetR": 2})
    rt._baseline(rule, ctx, trades, "TEST")
    rt._leg_baseline(rule, ctx, trades, "TEST")
    assert len(seen) > 200
    assert all(williams.filter_ok({"alligator": "awake"}, series, k, side) for k, side in seen)
    seen.clear()
    rule = rule_of(("BS",), smc={"swing": 20}, smcf={"pd": True}, stop={"type": "atr", "atr": 1.5, "maxAtr": 20}, exit={"targetR": 2})
    rt._baseline(rule, ctx, trades, "TEST")
    rng = smc.ranges(bars, {**rule["smc"], "swing": 20})
    assert len(seen) > 200
    assert all(smc.filter_ok({"pd": True}, rng, ctx["C"], k, side) for k, side in seen)
    # Sin filtros que miren el lado, el sorteo es el de antes: entra en cualquier vela y de cualquier lado
    seen.clear()
    rt._baseline(rule_of(("WF",), stop={"type": "atr", "atr": 1.5, "maxAtr": 20}, exit={"targetR": 2}), ctx, trades, "TEST")
    assert len(seen) == rt.BASE_TRADES


def test_la_busqueda_usa_las_piezas_nuevas_y_un_genoma_de_antes_da_la_misma_regla():
    import rule_search as rs
    cfg = rs.clean_config({"tfs": [240], "codes": ["WD", "WF", "OB", "BS", "FV"], "seed": 3})
    opts = rs._options(cfg)
    new_genes = ("trailBars", "wiseLookback", "wiseAng", "wiseAo", "wiseTeeth", "smcScope", "smcSwing", "smcInternal", "smcBreak",
                 "smcPick", "smcArea", "smcMitigation", "smcEq", "smcReclaim", "bwf", "bwZone", "smcPd", "smcBias", "targetWeak")
    old = {name: 0 for name in opts if name not in new_genes}
    old["e1"] = opts["e1"].index("FV")
    plain = rs.decode(old, cfg)
    assert plain == rs.decode({**old, **{name: 0 for name in new_genes}}, cfg), "un genoma de antes da la misma regla"
    for key in ("wise", "smc", "bwf", "smcf", "targetAt"):
        assert key not in plain
    # Los parámetros de un elemento que la regla no tiene no cambian su identidad
    assert rs.rule_key(rs.decode({**old, "wiseAng": 2, "smcPick": 1}, cfg)) == rs.rule_key(plain)
    full = rs.decode({**old, "e1": opts["e1"].index("WD"), "entry": opts["entry"].index(("stop", "zone")),
                      "trail": opts["trail"].index("bars"), "trailBars": 1, "bwf": 1, "bwZone": 1, "smcPd": 1, "smcBias": 1,
                      "smcSwing": 1, "targetWeak": 1}, cfg)
    assert full == rt.clean_rule(full)
    assert full["entry"]["type"] == "stop" and full["exit"]["trail"] == "bars" and full["exit"]["trailBars"] == 3
    assert full["bwf"] == {"alligator": "awake", "zone": True}
    assert full["smcf"] == {"pd": True, "bias": True, "swing": 20}
    assert full["targetAt"] == "weak" and "wise" in full and "smc" not in full
    assert rs.complexity(full) == 5, "un elemento y cuatro filtros"
    # Las casillas de la ventana sacan cada grupo
    off = rs._options(rs.clean_config({"tfs": [240], "codes": ["WD"], "stopEntry": False, "williams": False, "straddle": False}))
    assert all(e[0] not in ("stop", "straddle") for e in off["entry"]) and off["entry"][:3] == rs.ENTRIES[:3]
    assert off["bwf"] == (None,) and off["smcPd"] == (False,) and off["targetWeak"] == (False,)
