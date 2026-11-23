"""
Informes de frecuencia del probador (23/11/2026): cuántas veces pasa algo tras la señal de una regla, sin entrada ni
salida. Uso: python -m pytest tests/test_rule_frequency.py
"""
import json

import numpy as np
import pytest

import rule_frequency as rf
import rule_tester as rt

TF = 15
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def bars_of(closes, wick=0.0):
    out, prev = [], closes[0]
    for i, c in enumerate(closes):
        out.append({"t": i * MS, "o": prev, "c": c, "h": max(prev, c) + wick, "l": min(prev, c) - wick, "vol": 10.0, "delta": 0.0})
        prev = c
    return out


def ctx_of(closes, wick=0.0, lead=0):
    ctx = rt._context("TEST", TF, bars_of(closes, wick))
    ctx["atr"] = np.ones(len(closes))  # ATR fijo en 1: las distancias se leen directo
    ctx["lead"] = lead
    return ctx


def test_la_pregunta_se_acota_y_se_escribe_en_palabras():
    q = rf.clean_question({"kind": "otra", "bars": 9999, "a": -3})
    assert q == {"kind": "reach", "bars": rf.MAX_BARS, "a": 0.05, "b": 1.0}
    assert rf.clean_question({"kind": "close"})["a"] == 0.0, "cerrar a favor, sin distancia, es lo de fábrica"
    assert rf.question_text({"kind": "reach", "bars": 1, "a": 2, "b": 1}) == "llega a 2 ATR a favor en las 1 vela siguientes"
    assert "antes que a 1.5 ATR en contra" in rf.question_text({"kind": "first", "bars": 10, "a": 2, "b": 1.5})
    assert rf.question_text({"kind": "close", "bars": 5, "a": 0, "b": 1}) == "a las 5 velas cierra a favor"


def test_llega_mide_desde_la_apertura_siguiente_y_solo_en_sus_velas():
    # Señal en la vela 10: la 11 abre en 100. Sube a 102 en la vela 13 (tercera vela tras la señal)
    closes = [100] * 11 + [100.5, 101, 102, 102, 102] + [102] * 20
    ctx = ctx_of(closes)
    reach = lambda bars, a, side=1: bool(rf.outcomes(ctx, [10], side, {"kind": "reach", "bars": bars, "a": a, "b": 1})[0][0])
    assert reach(3, 2.0) and not reach(2, 2.0), "llega en la tercera vela, no antes"
    assert not reach(3, 2.1)
    assert not reach(20, 0.5, side=-1), "en corto, el precio nunca baja medio ATR"


def test_antes_que_cuenta_la_meta_que_llega_primero_y_la_duda_como_que_no():
    q = {"kind": "first", "bars": 10, "a": 2, "b": 1}
    up_first = ctx_of([100] * 11 + [101, 102.5, 98, 98] + [98] * 15)
    down_first = ctx_of([100] * 11 + [98.5, 103, 103] + [103] * 15)
    assert rf.outcomes(up_first, [10], 1, q)[0][0] and not rf.outcomes(down_first, [10], 1, q)[0][0]
    assert rf.outcomes(down_first, [10], -1, {**q, "a": 1, "b": 2})[0][0], "el corto llega a 1 a favor antes que a 2 en contra"
    # Las dos metas en la misma vela (mecha de 3 a cada lado): dudoso, cuenta como que no
    both = ctx_of([100] * 30, wick=3.0)
    hit, doubt = rf.outcomes(both, [10], 1, q)
    assert not hit[0] and doubt[0]


def test_cierre_mira_solo_la_vela_n():
    ctx = ctx_of([100] * 11 + [105, 104, 99.5, 101] + [101] * 15)
    close = lambda bars, a=0.0: bool(rf.outcomes(ctx, [10], 1, {"kind": "close", "bars": bars, "a": a, "b": 1})[0][0])
    assert close(1) and close(2) and not close(3) and close(4)
    assert close(1, 4.9) and not close(1, 5.0), "más de `a` ATR, no igual"


def test_el_informe_cuenta_por_lado_por_año_y_separa_las_que_se_pisan():
    closes = [100.0] * 400
    for k in (50, 51, 52, 200):  # Tras estas velas el precio sube 2 en la vela siguiente y vuelve
        closes[k + 1] = 102.0
    ctx = ctx_of(closes)
    q = rf.clean_question({"kind": "reach", "bars": 5, "a": 1.5})
    out = rf.measure(ctx, [(50, 1), (51, 1), (52, 1), (200, 1), (300, 1), (300, 1), (300, -1), (398, 1)], q)
    assert out["all"]["n"] == 6, "la repetida cuenta una vez y la del final, sin sus 5 velas, queda fuera"
    assert out["unfinished"] == 1
    # 50 y 200 llegan (entran en 100 y la vela sube a 102); 51 y 52 entran ya en 102 y no suben 1.5 más
    assert out["all"]["hits"] == 2
    assert out["separated"]["n"] == 4 and out["separated"]["hits"] == 2, "51 y 52 pisan la ventana de 50"
    assert [(s["side"], s["n"]) for s in out["sides"]] == [("largos", 5), ("cortos", 1)]
    assert out["years"] == [{"year": 1970, **out["all"]}]
    assert out["small"] and out["edge"]["clear"] is False
    assert out["all"]["low"] < out["all"]["rate"] < out["all"]["high"]


def test_la_tasa_base_es_la_de_una_vela_cualquiera_del_mismo_lado():
    rng = np.random.default_rng(3)
    closes = list(100 + np.cumsum(rng.normal(0, 1, 3000)))
    ctx = ctx_of(closes)
    q = rf.clean_question({"kind": "close", "bars": 4})
    # Señales al azar: su tasa debe parecerse a la base, y la diferencia no debe salir "clara"
    ks = sorted(int(k) for k in rng.choice(np.arange(40, 2900), 300, replace=False))
    out = rf.measure(ctx, [(k, 1) for k in ks], q)
    assert out["base"]["n"] > 2900
    assert abs(out["base"]["rate"] - 50) < 4, "en un paseo al azar, cerrar a favor es mitad y mitad"
    assert abs(out["edge"]["diff"]) < 3 * out["edge"]["margin"] and not out["small"]
    # Señales que miran el futuro (solo velas tras las que sube): la diferencia sí es clara
    wins = [k for k in range(40, 2900, 7) if closes[k + 4] > closes[k]]
    rigged = rf.measure(ctx, [(k, 1) for k in wins], q)
    assert rigged["edge"]["clear"] and rigged["edge"]["diff"] > 30


def test_las_velas_de_calentamiento_no_cuentan():
    ctx = ctx_of([100.0] * 200, lead=60)
    out = rf.measure(ctx, [(20, 1), (59, 1), (60, 1), (100, 1)], rf.clean_question({"kind": "reach", "bars": 3}))
    assert out["all"]["n"] == 2


def flat(n=300, price=100.0):
    return [{"t": k * MS, "o": price, "h": price + 0.5, "l": price - 0.5, "c": price, "delta": 0.0, "vol": 10.0} for k in range(n)]


def ev(bar, d=1):
    return {"code": "EX", "dir": d, "t": bar * MS, "known": (bar + 1) * MS, "lo": 99.0, "hi": 99.6}


def raw_rule(**kw):
    return {"name": "R", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1},
            "entry": {"type": "limit", "at": "far", "expiry": 2}, "stop": {"type": "atr", "atr": 0.2, "maxAtr": 0.3},
            "exit": {"targetR": 2}, "cooldown": 50, **kw}


def test_la_señal_es_la_de_la_regla_sin_su_entrada_ni_su_salida(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a, **k: None)
    span = {"bars": flat(), "events": [ev(100), ev(101), ev(102), ev(150, -1), ev(200)]}
    # Con la regla tal cual (limit lejana, stop mínimo, enfriamiento y una a la vez) casi nada entra...
    full = rt.run("TEST", rt.clean_rule(raw_rule()), span, PHASE, None, base=False)
    assert full["summary"].get("n", 0) < 5
    # ...pero la señal son las cinco, cada una con su lado, en la vela que la da a conocer
    ctx, signals, _ = rf.signals_of("TEST", rt.clean_rule(raw_rule()), span, PHASE)
    assert sorted(signals) == [(100, 1), (101, 1), (102, 1), (150, -1), (200, 1)]
    # Invertida, el lado es el contrario; con horario, solo las que caen dentro
    _, inverted, _ = rf.signals_of("TEST", rt.clean_rule(raw_rule(invert=True)), span, PHASE)
    assert sorted(inverted) == [(100, -1), (101, -1), (102, -1), (150, 1), (200, -1)]
    hours = {"from": 0, "to": 26 * 60, "weekdays": [0, 1, 2, 3, 4, 5, 6]}
    _, timed, _ = rf.signals_of("TEST", rt.clean_rule(raw_rule(hours={**hours, "to": 30 * 60 % 1440 or 1439})), span, PHASE)
    assert len(timed) <= 5


def test_el_informe_solo_corre_en_la_fase_1_y_queda_anotado(monkeypatch, tmp_path):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a, **k: None)
    monkeypatch.setattr(rt, "tester_dir", lambda: tmp_path)
    span = {"bars": flat(), "events": [ev(100), ev(150, -1), ev(200)]}
    seen = {}

    def fake_detect(symbol, tf, phase, rule, progress=None):
        seen["phase"] = phase["phase"]
        return span

    monkeypatch.setattr(rt, "detect_span", fake_detect)
    monkeypatch.setattr(rt, "codes_for", lambda symbol, tf: None)
    monkeypatch.setattr(rt, "phases", lambda symbol: [{**PHASE, "available": True}, {"phase": 2, "available": True}, {"phase": 3, "available": True}])
    out = rf.report("TEST", raw_rule(), {"kind": "reach", "bars": 5, "a": 0.4})
    assert out["success"] and seen["phase"] == 1 and out["phase"] == 1
    assert out["all"] == {"n": 3, "hits": 3, "rate": 100.0, "low": out["all"]["low"], "high": 100.0}
    assert out["askedBefore"] == 1 and out["askedThisSignal"] == 1
    again = rf.report("TEST", raw_rule(), {"kind": "close", "bars": 5})
    assert again["askedBefore"] == 2 and again["askedThisSignal"] == 2, "cada pregunta distinta cuenta"
    same = rf.report("TEST", raw_rule(name="otro nombre"), {"kind": "close", "bars": 5})
    assert same["askedBefore"] == 2, "la misma pregunta de la misma señal no suma (el nombre no cuenta)"
    rows = [json.loads(line) for line in (tmp_path / "frequency.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 3 and rows[0]["question"]["kind"] == "reach" and rows[0]["n"] == 3
    # Sin fase 1 disponible, o sin elementos, no hay informe
    monkeypatch.setattr(rt, "phases", lambda symbol: [{**PHASE, "available": False}])
    assert rf.report("TEST", raw_rule(), {})["success"] is False
    assert rf.report("TEST", {"tf": TF, "recipe": {"slots": []}}, {})["success"] is False
