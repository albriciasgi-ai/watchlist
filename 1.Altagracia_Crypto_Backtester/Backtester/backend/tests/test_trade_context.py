"""Lo que usó la regla alrededor de un trade, para depurar (rule_tester.trade_context). Uso: python -m pytest tests/test_trade_context.py"""
import json

import numpy as np
import pytest

import rule_tester as rt

TF = 15
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def rising(n=400, start=100.0, step=0.1):
    """Velas que suben de a poco, con delta a favor: la EMA queda debajo y el CVD es positivo"""
    out = []
    for k in range(n):
        o = start + step * k
        c = o + step
        out.append({"t": k * MS, "o": o, "h": c + 0.05, "l": o - 0.05, "c": c, "delta": 4.0, "vol": 10.0})
    return out


def ev(code, bar, d=1, lo=None, hi=None):
    return {"code": code, "dir": d, "t": bar * MS, "known": (bar + 1) * MS, "lo": lo if lo is not None else 100.0 + 0.1 * bar - 0.2,
            "hi": hi if hi is not None else 100.0 + 0.1 * bar}


def rule(**kw):
    base = {"name": "R", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1},
            "stop": {"type": "atr", "atr": 1.0, "minAtr": 0, "maxAtr": 100}, "exit": {"targetR": None, "horizon": 10}}
    base.update(kw)
    return rt.clean_rule(base)


@pytest.fixture(autouse=True)
def sin_almacen(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)


def ema(values, period):
    """EMA aparte del código, como la del probador: sembrada con el primer cierre y válida desde la vela period - 1"""
    out, value, k = [], values[0], 2 / (period + 1)
    for i, x in enumerate(values):
        value = x * k + value * (1 - k)
        out.append(value if i >= period - 1 else None)
    return out


def test_el_rastro_no_cambia_la_corrida_y_dice_que_paso_con_cada_senal():
    bars = rising()
    # 30 da trade; 33 cae con la posición abierta; 60 es corta y la EMA no la deja; 80 da trade
    events = [ev("EX", 30), ev("EX", 33), ev("EX", 60, d=-1), ev("EX", 80)]
    r = rule(lines=[{"type": "ema", "period": 10, "mode": "side"}])
    plain = rt.run("TEST", r, {"bars": bars, "events": events}, PHASE, None, base=False)
    trace = {}
    traced = rt.run("TEST", r, {"bars": bars, "events": events}, PHASE, None, base=False, trace=trace)
    assert json.dumps(plain, sort_keys=True) == json.dumps(traced, sort_keys=True), "el rastro no cambia nada de la corrida"
    seen = [(s["k"], s["dir"], s["what"], s.get("n")) for s in trace["signals"]]
    assert seen == [(30, 1, "trade", 1), (33, 1, "posición abierta", None), (60, -1, "filtro de VWAP o EMA", None), (80, 1, "trade", 2)]
    assert trace["ctx"]["T"][0] == 0 and len(trace["events"]) == 4


def test_las_limit_que_no_quedan_dicen_por_que():
    bars = rising()
    # Con entrada limit las señales se toman por orden de llenado: la segunda cae con la primera abierta
    r = rule(entry={"type": "limit", "at": "near", "expiry": 5})
    events = [ev("EX", 30, lo=102.0, hi=103.2), ev("EX", 31, lo=102.1, hi=103.3)]
    trace = {}
    result = rt.run("TEST", r, {"bars": bars, "events": events}, PHASE, None, base=False, trace=trace)
    whats = [s["what"] for s in trace["signals"]]
    assert whats.count("trade") == len(result["trades"])
    assert all(w in ("trade", "posición abierta", "limit sin llenar") for w in whats), whats


@pytest.fixture
def saved(tmp_path, monkeypatch):
    """Una corrida guardada en una carpeta aparte, con su tramo servido sin almacén y un OI que sube 1% por vela"""
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.flow_filters, "oi_at_close", lambda symbol, bars, tf: 1000.0 * 1.01 ** np.arange(len(bars)))
    bars = rising()
    # 30 da trade; 33 cae con la posición abierta; 60 es corta y la EMA no la deja; 80 se supo a las 20:15, fuera de horario
    events = [ev("EX", 30), ev("EX", 33), ev("EX", 60, d=-1), ev("EX", 80), ev("OT", 70)]
    span = {"bars": bars, "events": events}
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: span)
    rt._replays.clear()
    r = rule(lines=[{"type": "ema", "period": 10, "mode": "side"}], flow={"cvd": 5, "oi": "rise", "oiBars": 6, "oiPct": 2},
             hours={"on": True, "from": 420, "to": 1200, "weekdays": False})
    result = rt.run("TEST", r, span, PHASE, None, base=False)
    run_id = rt._save(result, "abc")
    return run_id, bars


def test_dibuja_las_lineas_filtros_y_senales_de_la_regla(saved):
    run_id, bars = saved
    result = rt.load_run(run_id)
    assert [t["signal"] // MS for t in result["trades"]] == [30]
    trade = result["trades"][0]
    ctx = rt.trade_context(run_id, trade["n"])
    json.dumps(ctx, allow_nan=False)  # Sin NaN: viaja como JSON
    assert ctx["success"] and ctx["same"], "al repetirla da el mismo trade"
    k = trade["signal"] // MS
    assert ctx["signal"] == trade["signal"]
    assert ctx["from"] == max(0, k - rt.CONTEXT_BEFORE) * MS
    assert ctx["to"] == (trade["exit_t"] // MS + rt.CONTEXT_AFTER + 1) * MS
    # La EMA entera en la ventana, igual a una calculada aparte
    expected = ema([b["c"] for b in bars], 10)
    line = ctx["lines"][0]
    assert line["label"] == "EMA 10" and len(line["points"]) > 80
    for t, value in line["points"]:
        assert value == pytest.approx(expected[t // MS], rel=1e-9)
    rows = {row["key"]: row for row in ctx["rows"]}
    assert set(rows) == {"line1", "cvd", "oi", "hours"}
    state = {key: dict((t, s) for t, s in row["items"]) for key, row in rows.items()}
    assert state["line1"][trade["signal"]] == 1, "un largo con el cierre sobre la EMA pasa"
    assert state["line1"][0] is None, "antes de tener la EMA, sin dato"
    assert state["cvd"][trade["signal"]] == 1 and state["cvd"][0] is None, "sin velas suficientes no hay CVD"
    assert state["oi"][trade["signal"]] == 1 and "+6.15% en 6 velas" in rows["oi"]["note"], rows["oi"]["note"]
    assert state["oi"][3 * MS] == 0, "con menos de 6 velas atrás no se mide"
    # El horario mira la hora en que se supo la señal (el cierre de su vela)
    for t, s in state["hours"].items():
        minute = ((t + MS) // 60000) % 1440
        assert s == (1 if 420 <= minute <= 1200 else 0)
    whats = {s["t"] // MS: s["what"] for s in ctx["signals"]}
    assert whats == {30: "trade", 33: "posición abierta", 60: "filtro de VWAP o EMA", 80: "fuera de horario"}
    assert {e["code"] for e in ctx["elements"]} == {"EX"}, "solo los elementos de la regla"
    assert len(ctx["elements"]) == 4


def test_el_recorrido_del_stop_inicial_a_la_entrada_y_arrastrado(tmp_path, monkeypatch):
    """Un largo que sube de a poco: el stop pasa a la entrada en 1.5R y después persigue al mejor precio a 3 ATR"""
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    bars = rising(400, step=0.5)
    span = {"bars": bars, "events": [ev("EX", 60)]}
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: span)
    rt._replays.clear()
    r = rule(stop={"type": "atr", "atr": 1.0, "minAtr": 0, "maxAtr": 100},
             exit={"targetR": None, "horizon": 30, "trail": "atr", "trailAtr": 3, "trailStart": 1, "breakEven": 1.5})
    result = rt.run("TEST", r, span, PHASE, None, base=False)
    assert "_path" not in result["trades"][0], "el recorrido no queda en la corrida guardada"
    run_id = rt._save(result, "camino")
    trade = result["trades"][0]
    ctx = rt.trade_context(run_id, trade["n"])
    path = ctx["stopPath"]
    assert len(path) == trade["bars"], "una vela por cada vela del trade"
    assert path[0][0] == trade["entry_t"] and path[0][1] == pytest.approx(trade["stop"]) and path[0][2] == "inicial"
    phases = [p[2] for p in path]
    assert "entrada" in phases and "arrastrado" in phases, phases
    assert phases.index("entrada") < phases.index("arrastrado"), "primero a la entrada y después arrastrado"
    levels = [p[1] for p in path]
    assert all(b >= a for a, b in zip(levels, levels[1:])), "en un largo el stop solo sube"
    assert trade["reason"] in ("tiempo", "stop arrastrado")


def test_sin_corrida_o_sin_trade_no_hay_contexto(saved):
    run_id, _ = saved
    assert rt.trade_context(run_id, 99) is None
    assert rt.trade_context("NO_EXISTE_15_f1_x_1", 1) is None
