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


def test_sin_minutos_la_vela_dudosa_sigue_su_recorrido_supuesto_y_los_minutos_mandan(monkeypatch):
    # Dos órdenes a 1 ATR del cierre y stop de 1 ATR: el stop queda en la apertura de la vela que llena la de arriba.
    # Sin minutos la vela sigue el recorrido supuesto (apertura, el extremo más cercano, el otro y cierre); con minutos,
    # mandan ellos. Antes, sin minutos, siempre contaba el stop
    import numpy as np
    import rule_search as rs
    rule = rule_of(entry={"type": "straddle", "from": "close", "offset": 1, "expiry": 5},
                   stop={"type": "atr", "atr": 1, "maxAtr": 50}, exit={"horizon": 3})
    after = [101.5, 103, 104, 105]
    # Abre más cerca del mínimo: primero el mínimo (antes de llenarse) y después el máximo. No toca el stop
    low_first = path([100] * 150 + after, wick=0.3)
    t = rt.simulate(rule, ctx_of(low_first), 149, 1)
    assert t["dir"] == 1 and t["exit_t"] > low_first[152]["t"] and t["r"] > 0
    # Abre más cerca del máximo: se llena subiendo y el mínimo, después, toca el stop. Solo la orden de arriba (como
    # con un filtro de flujo): si no, el mínimo llenaría también la de abajo
    high_first = path([100] * 150 + after, wick=0.3)
    high_first[150].update(h=101.2, l=98.5, c=101.0)
    ctx = ctx_of(high_first)
    t = rt.simulate(rule, ctx, 149, 1, sides=(1,))
    assert t["reason"] == "stop" and t["exit_t"] // MS == high_first[150]["t"] // MS
    # Los minutos de esa vela dicen que el mínimo fue antes de llenarse: mandan ellos
    t0 = high_first[150]["t"] // 60000

    def reader(symbol, start, end):
        if start != t0:
            return None
        return {"m": np.array([t0, t0 + 1, t0 + 2]), "h": np.array([100.0, 101.2, 101.1]), "l": np.array([98.5, 100.4, 100.6])}

    ctx["minutes"] = reader
    seen = rt.simulate(rule, ctx, 149, 1, sides=(1,))
    assert seen["exit_t"] > high_first[152]["t"] and seen["r"] > 0
    # Los dos controles del probador y el de la búsqueda reciben los mismos minutos que la regla (hasta el 20/11 iban
    # sin ellos, y la ventaja de las reglas con dos órdenes stop salía inflada)
    calls = []
    plain = rt.simulate

    def spy(rule_, ctx_, *args, **kwargs):
        calls.append(ctx_.get("minutes"))
        return plain(rule_, ctx_, *args, **kwargs)

    monkeypatch.setattr(rt, "simulate", spy)
    rt._baseline(rule, ctx, [seen], "TEST")
    rt._leg_baseline(rule, ctx, [seen], "TEST")
    item = {"ctx": ctx, "span": {"bars": high_first}, "cut": 140, "n": len(high_first), "T": np.array(ctx["T"], dtype=np.int64)}
    # Sin el embudo: el tramo de entrenamiento es uno solo ("train"; con el embudo son "a" y "b")
    rs.Evaluator(rs.clean_config({"tfs": [240], "funnel": False}))._control("TEST", 240, item, rule, [seen], "train", "random")
    assert calls and all(m is reader for m in calls)
