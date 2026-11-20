"""Trailing del objetivo, como un bot: objetivo fijo, arranque antes de él, y el objetivo arrastrado hasta que el precio
vuelve. Uso: python -m pytest tests/test_tp_trail.py"""
import numpy as np
import pytest

import candidate_review
import rule_tester as rt
from tests.test_trailing_straddle import MS, ctx_of, path, rule_of

# Entrada en 100 (apertura de la vela 40), stop de 2 ATR (ATR fijo en 1): riesgo 2, objetivo 3R en 106
SIGNAL = 39
UP = [100] * 40 + [101, 102, 103, 104, 105.5, 107, 108, 107.5, 106.8, 106, 105]


def trailing(start=2.5, dist=0.5, unit="r", target=3, **exit_):
    return rule_of(stop={"type": "atr", "atr": 2, "maxAtr": 50},
                   exit={"targetR": target, "tpTrail": {"start": start, "dist": dist, "unit": unit}, **exit_})


def test_solo_entra_si_se_pide_y_con_objetivo_en_r():
    plain = rule_of(stop={"type": "atr", "atr": 2}, exit={"targetR": 3})
    assert "tpTrail" not in plain["exit"], "una regla sin él conserva su identidad"
    off = rule_of(stop={"type": "atr", "atr": 2}, exit={"targetR": 3, "tpTrail": {"on": False, "start": 2.5}})
    assert rt.rule_hash("X", off) == rt.rule_hash("X", plain)
    assert "tpTrail" not in rule_of(exit={"targetR": None, "horizon": 10, "tpTrail": {"start": 2}})["exit"], "sin objetivo no hay qué arrastrar"
    rule = trailing(start=4, dist=0.5)
    assert rule["exit"]["tpTrail"] == {"start": 3, "dist": 0.5, "unit": "r"}, "el arranque no pasa del objetivo"
    assert rule["exit"]["horizon"] is None, "con objetivo no se impone el cierre por tiempo"
    assert trailing(unit="otra")["exit"]["tpTrail"]["unit"] == "r"


def test_el_objetivo_fijo_cierra_y_arrastrado_sigue_hasta_que_el_precio_vuelve():
    bars = path(UP, wick=0.0)
    fixed = rt.simulate(rule_of(stop={"type": "atr", "atr": 2, "maxAtr": 50}, exit={"targetR": 3}), ctx_of(bars), SIGNAL, 1)
    assert fixed["reason"] == "objetivo" and fixed["exit"] == pytest.approx(106)
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, 1)
    # Se activa en 105 (vela 44, que llega a 105.5); el mejor precio llega a 108 y el objetivo queda en 107, a 0.5R (1)
    assert t["reason"] == "objetivo arrastrado" and t["exit"] == pytest.approx(107)
    assert t["target"] == pytest.approx(106), "el objetivo fijo queda en el trade, para su caja"
    assert t["exit_t"] // MS == 48 and t["tp_on"] // MS == 44
    assert t["gross"] == pytest.approx(3.5) and t["mfe"] == pytest.approx(4.0)


def test_si_se_devuelve_antes_del_objetivo_sale_en_el_nivel_arrastrado():
    bars = path([100] * 40 + [101, 102, 103, 104, 105.5, 105.8, 104.6, 103], wick=0.0)
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, 1)
    assert t["reason"] == "objetivo arrastrado" and t["exit"] == pytest.approx(104.8)  # 105.8 - 1, debajo del objetivo
    assert t["gross"] == pytest.approx(2.4)


def test_sin_llegar_al_arranque_sale_como_siempre():
    bars = path([100] * 40 + [101, 102, 103, 104.9, 103, 101, 99, 97], wick=0.0)
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, 1)
    assert t["reason"] == "stop" and t["exit"] == pytest.approx(98) and t["tp_on"] is None


def test_se_activa_y_sale_dentro_de_la_misma_vela():
    # Sin minutos la vela sigue su recorrido supuesto: abre en 104, baja a 103.9 (lo más cerca), sube a 106 y cierra en
    # 104.8. A 106 el objetivo queda en 105, y el cierre lo toca: sale en 105 en esa vela
    bars = path(UP, wick=0.0)
    bars[44].update(o=104, h=106, l=103.9, c=104.8)
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, 1)
    assert t["reason"] == "objetivo arrastrado" and t["exit"] == pytest.approx(105) and t["exit_t"] // MS == 44


def test_los_minutos_mandan_sobre_el_recorrido_supuesto():
    bars = path(UP, wick=0.0)
    bars[44].update(o=104, h=106, l=103.9, c=105.5)  # Supuesto: 104, 103.9, 106, 105.5; no vuelve a 105
    ctx = ctx_of(bars)
    t = rt.simulate(trailing(), ctx, SIGNAL, 1)
    assert t["exit_t"] // MS > 44
    t0 = bars[44]["t"] // 60000

    def reader(symbol, start, end):
        if start != t0:
            return None
        # Primero el máximo y después baja a 104.9: el objetivo arrastrado (105) se toca en el segundo minuto
        return {"m": np.array([t0, t0 + 1, t0 + 2]), "h": np.array([106.0, 105.9, 105.5]), "l": np.array([104.0, 104.9, 105.2])}

    ctx["minutes"] = reader
    seen = rt.simulate(trailing(), ctx, SIGNAL, 1)
    assert seen["reason"] == "objetivo arrastrado" and seen["exit"] == pytest.approx(105) and seen["exit_t"] == (t0 + 1) * 60000


def test_si_abre_mas_alla_del_nivel_sale_en_la_apertura():
    bars = path(UP, wick=0.0)
    bars[45].update(o=103, h=103, l=102, c=102)  # Tras activarse en 104.5, la vela siguiente abre en 103
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, 1)
    assert t["reason"] == "objetivo arrastrado" and t["exit"] == pytest.approx(103) and t["exit_t"] // MS == 45


def test_un_corto_es_el_espejo():
    bars = path([100] * 40 + [99, 98, 97, 96, 94.5, 93, 92, 92.5, 93.2, 94], wick=0.0)
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, -1)
    # Objetivo en 94, arranque en 95; el mejor precio llega a 92 y el objetivo arrastrado queda en 93
    assert t["dir"] == -1 and t["reason"] == "objetivo arrastrado" and t["exit"] == pytest.approx(93)
    assert t["gross"] == pytest.approx(3.5)


def test_la_distancia_en_atr_o_en_porcentaje_del_mejor_precio():
    bars = path(UP, wick=0.0)
    atr = rt.simulate(trailing(dist=0.5, unit="atr"), ctx_of(bars), SIGNAL, 1)
    assert atr["exit"] == pytest.approx(107.5)  # 108 - 0.5 ATR (de la vela de la señal), tocado por la vela que baja a 107.5
    pct = rt.simulate(trailing(dist=1, unit="pct"), ctx_of(bars), SIGNAL, 1)
    assert pct["exit"] == pytest.approx(108 * 0.99)


def test_el_recorrido_guarda_el_objetivo_arrastrado_de_cada_vela():
    bars = path(UP, wick=0.0)
    steps = []
    t = rt.simulate(trailing(), ctx_of(bars), SIGNAL, 1, path=steps)
    assert [row[0] // MS for row in steps] == list(range(40, 49))
    assert all(row[1] == pytest.approx(98) for row in steps), "el stop no se mueve"
    assert [row[2] for row in steps] == [None] * 4 + [pytest.approx(v) for v in (104.5, 106, 107, 107, 107)]
    assert t["exit"] == pytest.approx(steps[-1][2])


def test_el_azar_usa_la_misma_salida_y_la_caja_propia_de_la_revision_no(monkeypatch):
    rule = trailing()
    bars = path(UP, wick=0.1)  # Con mechas: la revisión calcula su ATR con las velas, y sin rango daría 0
    t = rt.simulate(rule, ctx_of(bars), SIGNAL, 1)
    assert rt._random_rule(rule, [t])["exit"]["tpTrail"] == rule["exit"]["tpTrail"]
    # La caja propia de la revisión sale en su objetivo (106), sin el trailing del objetivo de la regla (que daría 107)
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": bars, "events": []})
    monkeypatch.setattr(candidate_review, "_phase1", lambda symbol: None)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    own, problem, _ = candidate_review._own_trade({"symbol": "TEST", "rule": rule}, {"signal": bars[SIGNAL]["t"]}, 1, 98.0, 106.0)
    assert problem is None and own["reason"] == "objetivo" and own["exit"] == pytest.approx(106)


def test_el_contexto_del_trade_dibuja_el_objetivo_arrastrado(tmp_path, monkeypatch):
    from tests.test_trade_context import PHASE, ev, rising, rule
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    bars = rising(400, step=0.5)
    for i in range(70, 400):  # Sube hasta la vela 70 y después baja: el objetivo arrastrado se toca al volver
        o = bars[69]["c"] - 0.5 * (i - 69)
        bars[i].update(o=o + 0.5, c=o, h=o + 0.55, l=o - 0.05)
    span = {"bars": bars, "events": [ev("EX", 60)]}
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: span)
    rt._replays.clear()
    r = rule(stop={"type": "atr", "atr": 1.0, "minAtr": 0, "maxAtr": 100},
             exit={"targetR": 6, "horizon": None, "tpTrail": {"start": 3, "dist": 1, "unit": "r"}})
    result = rt.run("TEST", r, span, PHASE, None, base=False)
    trade = result["trades"][0]
    assert trade["reason"] == "objetivo arrastrado", trade["reason"]
    run_id = rt._save(result, "arrastre")
    ctx = rt.trade_context(run_id, trade["n"])
    assert ctx["same"]
    start = ctx["tpStart"]
    assert start["r"] == 3 and start["price"] == pytest.approx(trade["entry"] + 3 * trade["risk"])
    assert start["t"] == trade["tp_on"]
    levels = [p[1] for p in ctx["tpPath"]]
    assert levels and all(b >= a for a, b in zip(levels, levels[1:])), "en un largo el objetivo arrastrado solo sube"
    assert levels[-1] == pytest.approx(trade["exit"])
    assert len(ctx["stopPath"]) == trade["bars"] and all(len(p) == 3 for p in ctx["stopPath"])
