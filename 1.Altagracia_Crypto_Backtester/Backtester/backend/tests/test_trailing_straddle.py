"""Trailing desde el mejor precio, stop a la entrada, dos órdenes stop e Impulso y Compresión. Uso: python -m pytest tests/test_trailing_straddle.py"""
import pytest

import box_elements
import fvg_swing
import rule_tester as rt
from tests.test_regime import series

MS = 240 * 60000


def path(closes, wick=0.2):
    """Velas que cierran en esos precios, cada una abre en el cierre anterior."""
    bars, prev = [], closes[0]
    for i, c in enumerate(closes):
        bars.append({"t": i * MS, "o": prev, "c": c, "h": max(prev, c) + wick, "l": min(prev, c) - wick, "vol": 100.0, "delta": 0.0})
        prev = c
    return bars


def ctx_of(bars):
    ctx = rt._context("TEST", 240, bars)
    ctx["minutes"] = None
    ctx["atr"] = [1.0] * len(bars)  # ATR fijo: las distancias se leen directo
    return ctx


def rule_of(**raw):
    return rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["IM"]}]}, **raw})


def test_una_salida_sin_trailing_nuevo_conserva_su_identidad():
    plain = rule_of(stop={"type": "atr", "atr": 2}, exit={"targetR": 2})
    assert set(plain["exit"]) == {"targetR", "trail", "trailBars", "horizon", "opposite"}
    assert set(plain["entry"]) == {"type", "at", "expiry"}
    trail = rule_of(stop={"type": "atr", "atr": 2}, exit={"trail": "atr", "trailAtr": 3, "trailStart": 1, "breakEven": 1.5})
    assert trail["exit"]["trailAtr"] == 3 and trail["exit"]["trailStart"] == 1 and trail["exit"]["breakEven"] == 1.5
    assert trail["exit"]["horizon"] is None  # El trailing es salida: no se impone el cierre por tiempo


def test_el_trailing_sigue_al_mejor_precio_y_solo_se_acerca():
    closes = [100] * 40 + [100 + i for i in range(1, 11)] + [109, 107, 105, 103]
    bars = path(closes, wick=0.1)
    rule = rule_of(stop={"type": "atr", "atr": 2, "maxAtr": 50}, exit={"trail": "atr", "trailAtr": 3})
    t = rt.simulate(rule, ctx_of(bars), 39, 1)
    assert t["reason"] == "stop arrastrado"
    # Mejor máximo 110.1 (la vela que cierra en 110): stop a 107.1, que toca la vela que baja de 109 a 107
    assert t["exit"] == pytest.approx(107.1)
    assert t["r"] > 3


def test_el_trailing_espera_su_arranque_y_el_stop_pasa_a_la_entrada():
    closes = [100] * 40 + [101, 102, 103, 102, 101, 100, 99, 98, 97]
    bars = path(closes, wick=0.0)
    late = rule_of(stop={"type": "atr", "atr": 2, "maxAtr": 50}, exit={"trail": "atr", "trailAtr": 1, "trailStart": 5})
    assert rt.simulate(late, ctx_of(bars), 39, 1)["reason"] == "stop"  # Nunca llegó a 5R: el stop quedó en el inicial
    even = rule_of(stop={"type": "atr", "atr": 2, "maxAtr": 50}, exit={"trail": "none", "breakEven": 1.0, "horizon": 50})
    t = rt.simulate(even, ctx_of(bars), 39, 1)
    assert t["reason"] == "stop en la entrada" and t["exit"] == pytest.approx(100) and t["r"] < 0  # Pierde solo las comisiones


def test_dos_ordenes_entra_la_que_se_llena_primero():
    rule = rule_of(entry={"type": "straddle", "from": "close", "offset": 1, "expiry": 5}, stop={"type": "atr", "atr": 2, "maxAtr": 50}, exit={"targetR": 1})
    up = path([100] * 40 + [100.5, 101.5, 102, 104, 106], wick=0.0)
    down = path([100] * 40 + [99.5, 98.5, 98, 96, 94], wick=0.0)
    t = rt.simulate(rule, ctx_of(up), 39, -1)  # El lado que pase la señal no importa
    assert t["dir"] == 1 and t["entry"] == pytest.approx(101) and t["order"] == "stop" and t["trigger_atr"] == pytest.approx(1)
    t = rt.simulate(rule, ctx_of(down), 39, 1)
    assert t["dir"] == -1 and t["entry"] == pytest.approx(99)
    # Si un filtro solo deja la orden de abajo, la subida no entra
    assert rt.simulate(rule, ctx_of(up), 39, 1, sides=(-1,)) == {"skip": "ninguna orden stop se llenó"}


def test_impulso_y_compresion_no_miran_adelante():
    bars = series(seed=9)
    full = fvg_swing.events(bars, 240, im={"bars": 3, "atr": 2.0, "range": None}) + box_elements.events(bars, 240, cp={"maxHeight": None})
    assert {e["code"] for e in full} == {"IM", "CP"}
    cps = [e for e in full if e["code"] == "CP"]
    assert len({e["t"] for e in cps}) * 2 == len(cps)  # La compresión sale hacia los dos lados
    cut = 700
    short = fvg_swing.events(bars[:cut], 240, im={"bars": 3, "atr": 2.0, "range": None}) + box_elements.events(bars[:cut], 240, cp={"maxHeight": None})
    known = {(e["code"], e["t"], e["dir"]) for e in full if e["known"] <= bars[cut - 1]["t"] + MS}
    assert known == {(e["code"], e["t"], e["dir"]) for e in short}


def test_compresion_con_dos_ordenes_por_la_ruta_del_probador():
    bars = series(seed=9)
    rule = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["CP"]}]}, "entry": {"type": "straddle", "from": "zone", "offset": 0.2, "expiry": 12},
                          "stop": {"type": "atr", "atr": 2, "maxAtr": 50}, "exit": {"trail": "atr", "trailAtr": 4}})
    phase = {"phase": 1, "from": bars[0]["t"], "to": bars[-1]["t"] + MS}
    res = rt.run("TEST", rule, {"bars": [{**b, "delta": 0.0} for b in bars], "events": []}, phase, None, base=True)
    assert res["success"] and res["trades"]
    for t in res["trades"]:
        assert t["order"] == "stop"
        # La orden de arriba queda sobre la caja; la de abajo, debajo
        assert (t["entry"] > t["zone"][1]) if t["dir"] > 0 else (t["entry"] < t["zone"][0])
    assert res["baseline"]["n"] > 0
