"""
Barrido de señales (23/11/2026): qué hizo el precio tras cada señal, sin entrada ni salida, contra las velas de su
trimestre y lado, por los dos primeros tramos del embudo. Uso: python -m pytest tests/test_signal_sweep.py
"""
import math

import numpy as np

import rule_frequency as rf
import rule_tester as rt
import signal_sweep as sw
from tests.test_rule_search import fake_market

TF = 240
MS = TF * 60000
START = rt._ms("2021-01-01")


def bars_of(closes, wick=0.0, start=START):
    out, prev = [], closes[0]
    for i, c in enumerate(closes):
        out.append({"t": start + i * MS, "o": prev, "c": c, "h": max(prev, c) + wick, "l": min(prev, c) - wick, "vol": 10.0, "delta": 0.0})
        prev = c
    return out


def ctx_of(closes, wick=0.0, lead=0):
    ctx = rt._context("TEST", TF, bars_of(closes, wick))
    ctx["atr"] = np.ones(len(closes))  # ATR fijo en 1: las distancias se leen directo
    ctx["lead"] = lead
    return ctx


def walk(n=4600, seed=4, drift=0.0):
    rng = np.random.default_rng(seed)
    return list(100 + np.cumsum(rng.normal(drift, 1.0, n)))


def test_las_excursiones_y_quien_llega_primero():
    # Vela 10: se entra en la apertura de la 11 (100). Sube a 103 en tres velas y después cae a 96
    closes = [100.0] * 11 + [101, 102, 103, 101, 98, 96] + [96.0] * 80
    f = sw.fields(ctx_of(closes))
    assert f["up"][6][10] == 3.0 and f["down"][6][10] == 4.0
    assert f["up"][24][10] == 3.0 and f["down"][24][10] == 4.0
    assert f["first"][2.0][10] == 1.0, "llegó a +2 antes que a −2"
    assert f["first"][3.0][10] == 1.0 and f["first"][1.0][10] == 1.0
    # Al revés: primero abajo
    down = [100.0] * 11 + [98.5, 97.5, 103, 103] + [103.0] * 80
    assert sw.fields(ctx_of(down))["first"][2.0][10] == 0.0
    # Las dos metas en la misma vela (mechas de 3 a cada lado), o ninguna en 48 velas: no cuenta
    assert math.isnan(sw.fields(ctx_of([100.0] * 120, wick=3.0))["first"][2.0][10])
    assert math.isnan(sw.fields(ctx_of([100.0] * 120))["first"][2.0][10])
    # Las últimas 48 velas no tienen su ventana completa
    assert np.isnan(f["up"][6][-48:]).all() and np.isfinite(f["up"][6][:-48]).all()
    assert len(sw.fields(ctx_of([100.0] * 30))["first"][1.0]) == 30


def test_el_control_es_el_promedio_de_su_trimestre():
    values = np.array([1.0, 3.0, 10.0, 20.0, np.nan, 7.0])
    quarters = np.array([1, 1, 2, 2, 2, 3])
    usable = np.array([True, True, True, True, True, False])
    out = sw.centered(values, quarters, usable)
    assert list(out[:4]) == [-1.0, 1.0, -5.0, 5.0] and np.isnan(out[4]) and np.isnan(out[5])
    times = [rt._ms("2021-02-15"), rt._ms("2021-04-01"), rt._ms("2022-12-31")]
    assert list(sw.quarter_index(times)) == [2021 * 4, 2021 * 4 + 1, 2022 * 4 + 3]


def collect(ctx, signals, **cfg):
    collector = sw.Collector(sw.clean_config(cfg))
    collector.add_coin("TEST", ctx, signals)
    return collector.result([{"key": key, "codes": key.split("+")} for key in signals])


def test_una_señal_con_ventaja_sale_arriba_una_al_azar_no_y_la_invertida_en_negativo():
    ctx = ctx_of(walk())
    f = sw.fields(ctx)
    rng = np.random.default_rng(2)
    n = len(ctx["T"])
    ks = [int(k) for k in rng.choice(np.arange(60, n - 60), 900, replace=False)]
    good = {(k, 1) for k in ks if f["first"][2.0][k] == 1.0 or rng.random() < 0.35}   # Mira el futuro: gana casi siempre
    noise = {(k, 1 if i % 2 else -1) for i, k in enumerate(ks)}
    out = collect(ctx, {"BUENA": good, "AZAR": noise, "ALREVES": {(k, -s) for k, s in good}})
    rows = {r["key"]: r for r in out["rows"]}
    assert rows["BUENA"]["judged"] and rows["BUENA"]["score"] > 4 and rows["BUENA"]["clear"]
    assert rows["ALREVES"]["score"] < -4 and rows["ALREVES"]["clear"], "negativa y pareja: sirve al revés"
    assert rows["ALREVES"]["score"] == -rows["BUENA"]["score"]
    assert abs(rows["AZAR"]["score"]) < 2 and not rows["AZAR"]["clear"]
    assert out["rows"][0]["key"] in ("BUENA", "ALREVES") and out["rows"][-1]["key"] == "AZAR"
    assert out["tests"] == 3 and out["need"] == round(sw.gate(3), 2)
    # La tasa cruda y lo que queda sobre el control
    both = rows["BUENA"]["parts"]["both"]["first"][2.0]
    assert both["rate"] > 70 and both["mean"] > 15
    assert abs(rows["AZAR"]["parts"]["both"]["first"][2.0]["mean"]) < 6


def test_en_un_mercado_que_solo_sube_comprar_no_tiene_ventaja_sobre_su_control():
    # Todo sube: cualquier largo "llega a +2 antes que a −2" casi siempre. Contra las velas de su trimestre, nada
    ctx = ctx_of(walk(drift=0.25, seed=8))
    rng = np.random.default_rng(5)
    ks = [int(k) for k in rng.choice(np.arange(60, len(ctx["T"]) - 60), 900, replace=False)]
    row = collect(ctx, {"LARGOS": {(k, 1) for k in ks}})["rows"][0]
    both = row["parts"]["both"]["first"][2.0]
    assert both["rate"] > 65, "la tasa cruda engaña"
    assert abs(both["mean"]) < 5 and abs(row["score"]) < 2 and not row["clear"]


def test_cada_señal_va_a_su_tramo_y_la_puerta_no_se_mira():
    ctx = ctx_of(walk())
    T = ctx["T"]
    cfg = sw.clean_config({})
    first, second, gap = rt._ms(cfg["split1"]), rt._ms(cfg["split"]), cfg["gapDays"] * sw.DAY_MS
    assert sw.bounds(cfg) == {"a": (None, first), "b": (first + gap, second)}
    every = {(k, 1) for k in range(len(T))}
    row = collect(ctx, {"TODAS": every}, minSignals=20)["rows"][0]
    reach = max(sw.HORIZONS)
    a = sum(1 for k in range(len(T) - reach) if T[k + reach] + MS < first)
    b = sum(1 for k in range(len(T) - reach) if T[k] >= first + gap and T[k + reach] + MS < second)
    assert (row["parts"]["a"]["n"], row["parts"]["b"]["n"]) == (a, b) and a > 0 and b > 0
    assert row["parts"]["both"]["n"] == a + b
    assert set(row["parts"]) == {"a", "b", "both"}, "el tercer tramo no aparece"
    assert a + b < sum(1 for t in T if t < second), "la ventana que cruza un corte, y el hueco, no cuentan"
    # Con las velas de calentamiento delante, esas no cuentan
    lead = collect({**ctx, "lead": 500}, {"TODAS": every}, minSignals=20)["rows"][0]
    assert lead["parts"]["a"]["n"] == a - 500


def test_con_pocas_señales_se_muestra_pero_no_se_juzga_y_tramos_opuestos_dan_cero():
    ctx = ctx_of(walk())
    f = sw.fields(ctx)
    T = ctx["T"]
    first = rt._ms("2022-01-01")
    few = {(k, 1) for k in range(100, 130)}
    out = collect(ctx, {"POCAS": few})
    assert out["rows"][0]["judged"] is False and out["rows"][0]["score"] is None and out["tests"] == 0 and out["need"] is None
    # Gana en el primer tramo y pierde en el segundo: la nota es cero
    wins_a = {(k, 1) for k in range(60, len(T) - 60) if T[k] < first - 60 * sw.DAY_MS and f["first"][2.0][k] == 1.0}
    loses_b = {(k, 1) for k in range(60, len(T) - 60) if T[k] > first + 40 * sw.DAY_MS and f["first"][2.0][k] == 0.0}
    row = collect(ctx, {"MIXTA": wins_a | loses_b})["rows"][0]
    assert row["judged"] and row["score"] == 0.0 and not row["clear"]
    assert row["parts"]["a"]["first"][2.0]["t"] > 3 and row["parts"]["b"]["first"][2.0]["t"] < -3


def test_el_umbral_sube_con_las_pruebas_y_la_configuracion_se_acota():
    assert round(sw.gate(1), 2) == 1.0 and round(sw.gate(49), 2) == 2.0 and sw.gate(0) is None
    assert sw.gate(900) > sw.gate(49) > sw.gate(10)
    cfg = sw.clean_config({"tf": 7, "group": "otra", "minSignals": 1, "split1": "2022-12-01", "pairs": ["A"] * 40})
    assert cfg["tf"] == 240 and cfg["group"] == "base" and cfg["minSignals"] == 20
    assert (cfg["split1"], cfg["split"]) == ("2022-01-01", "2023-01-01") and cfg["pairs"] == ["A"] and cfg["pairsB"] == []
    assert [sw.clean_config({"tf": tf})["tf"] for tf in sw.SWEEP_TFS] == [5, 15, 30, 45, 60, 240, 1440]


def test_parejas_las_dos_señales_del_mismo_lado_en_la_ventana():
    a = {(10, 1), (20, 1), (30, -1), (50, 1)}
    b = {(11, 1), (23, 1), (30, 1), (48, 1), (49, -1)}
    # 10 y 11 (a 1 vela): la señal es la 11. 20 y 23 (a 3): fuera de la ventana de 3. 30: lados distintos. 48 y 50: la 50
    assert sw.pair_signals(a, b) == {(11, 1), (50, 1)}
    assert sw.pair_signals(a, a) == a
    assert sw.pair_signals(a, set()) == set()


def test_familias_cada_elemento_en_una_y_parejas_dentro_o_entre_dos():
    codes = [c for _, _, family in sw.FAMILIES for c in family]
    assert len(codes) == len(set(codes)) and "LIQ" not in codes
    # Todo elemento que se puede barrer tiene familia
    assert set(rt.CANDLE_CODES) - set(sw.SKIP_CODES) <= set(codes) and set(sw.oe.CATALOG) <= set(codes)
    # Una lista: todas entre sí. Dos listas: solo las cruzadas, sin repetir ni emparejar un elemento consigo mismo
    inside = sw.pair_list(sw.clean_config({"pairs": ["HM", "EN", "DJ", "HM"]}))
    assert inside == [("HM", "EN"), ("HM", "DJ"), ("EN", "DJ")]
    cross = sw.pair_list(sw.clean_config({"pairs": ["HM", "EN"], "pairsB": ["VH", "RF", "HM"]}))
    assert cross == [("HM", "VH"), ("HM", "RF"), ("EN", "VH"), ("EN", "RF"), ("EN", "HM")]
    assert sw.clean_config({"pairsB": ["VH"]})["pairsB"] == []
    # El tope de parejas: no arranca
    big = [c for _, _, family in sw.FAMILIES[:3] for c in family][:sw.MAX_PAIR_CODES]
    answer = sw.start({"pairs": big})
    assert answer["success"] is False and str(sw.MAX_PAIRS) in answer["message"]
    assert sw.start({"pairs": ["HM"]})["success"] is False
    assert [f["id"] for f in sw.history()["families"]] == [key for key, _, _ in sw.FAMILIES]


def test_las_señales_de_un_elemento_son_las_de_su_regla_en_el_probador(monkeypatch):
    spans = fake_market(monkeypatch)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a, **k: None)
    phase = rt.phases("AAAUSDT")[0]
    span = rt._warmed("AAAUSDT", TF, phase, rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}}), spans["AAAUSDT"])
    ctx = rt._context("AAAUSDT", TF, span["bars"])
    ctx["bars"], ctx["lead"] = span["bars"], span["lead"]
    found = sw.element_signals("AAAUSDT", TF, span, ctx, ["RF", "HM", "EN"])
    for code in ("RF", "HM", "EN"):
        rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": [code]}]}})
        _, signals, _ = rf.signals_of("AAAUSDT", rule, spans["AAAUSDT"], phase)
        assert found[code] == set(signals) and len(found[code]) > 5, code
    # Una vela con la señal hacia los dos lados no dice una dirección: no entra
    monkeypatch.setattr(rt, "_extra_events", lambda symbol, rule, span, ctx: [
        {"code": "CP", "dir": d, "t": span["bars"][k]["t"], "known": span["bars"][k]["t"] + MS, "lo": 1, "hi": 2} for k in (200, 300) for d in (1, -1)
    ] + [{"code": "CP", "dir": 1, "t": span["bars"][400]["t"], "known": span["bars"][400]["t"] + MS, "lo": 1, "hi": 2}])
    assert sw.element_signals("AAAUSDT", TF, span, ctx, ["CP"])["CP"] == {(400, 1)}


def test_el_barrido_corre_guarda_y_cuenta_las_pruebas(monkeypatch, tmp_path):
    fake_market(monkeypatch)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a, **k: None)
    monkeypatch.setattr(sw, "sweep_dir", lambda: tmp_path)
    monkeypatch.setattr(rt, "codes_for", lambda symbol, tf: set(rt.CANDLE_CODES))
    monkeypatch.setattr(rt, "_on_candles", lambda symbol, tf: False)
    cfg = sw.clean_config({"tf": TF, "codes": ["RF", "HM", "EN"], "split1": "2021-04-01", "split": "2021-10-01", "minSignals": 20})
    out = sw.run(cfg)
    assert out["symbols"] == ["AAAUSDT", "BBBUSDT"] and {r["key"] for r in out["rows"]} == {"RF", "HM", "EN"}
    assert all(r["coins"] == 2 for r in out["rows"]) and out["tests"] >= 1
    # Las parejas de los elegidos
    pairs = sw.run({**cfg, "pairs": ["RF", "HM", "EN"]})
    assert {r["key"] for r in pairs["rows"]} <= {"RF+HM", "RF+EN", "HM+EN"} and pairs["rows"]
    # Entre dos familias: solo las cruzadas
    cross = sw.run({**cfg, "pairs": ["RF"], "pairsB": ["HM", "EN"]})
    assert {r["key"] for r in cross["rows"]} <= {"RF+HM", "RF+EN"} and cross["rows"]
    # Por la ruta: queda guardado y anotado
    answer = sw.start({"tf": TF, "codes": ["RF", "HM"], "split1": "2021-04-01", "split": "2021-10-01", "minSignals": 20})
    import time
    for _ in range(300):
        job = sw.job_status(answer["job"])
        if job["state"] != "running":
            break
        time.sleep(0.1)
    assert job["state"] == "done", job
    saved = sw.load(job["sweep"])
    assert saved["config"]["tf"] == TF and saved["testsBefore"] == 0
    past = sw.history()
    assert len(past["sweeps"]) == 1 and past["tests"] == saved["tests"]
    assert sw.load("no-existe") is None
