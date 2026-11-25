"""Flecha y rombo del Volumen de Respuesta en el probador. Uso: python -m pytest tests/test_response_volume.py"""
import random

import response_volume as rv
import rule_tester as rt

TF = 240
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def rising(n=120):
    """Velas verdes de 4 horas que suben de a 1, con volumen parejo."""
    return [{"t": k * MS, "o": 100.0 + k, "c": 101.0 + k, "h": 101.2 + k, "l": 99.8 + k, "delta": 0.0, "vol": 100.0} for k in range(n)]


def marked():
    bars = rising()
    bars[50]["vol"] = 500.0                                  # Verde con 5 veces el volumen de su hora, a favor del tramo
    bars[55].update(o=156.0, c=155.0, vol=500.0)             # Roja con 5 veces, contra el tramo alcista
    return bars


def test_flecha_a_favor_y_en_contra_del_tramo():
    bars = marked()
    favor = [e for e in rv.events(bars, TF) if e["code"] == "RF"]
    assert [(e["t"], e["dir"]) for e in favor] == [(bars[50]["t"], 1)]
    e = favor[0]
    assert e["known"] == bars[51]["t"] and (e["lo"], e["hi"]) == (bars[50]["l"], bars[50]["h"])
    assert e["info"] == {"times": 5.0, "leg": 1}
    against = [e for e in rv.events(bars, TF, arrow="against") if e["code"] == "RF"]
    assert [(e["t"], e["dir"]) for e in against] == [(bars[55]["t"], -1)]
    assert len([e for e in rv.events(bars, TF, arrow="any") if e["code"] == "RF"]) == 2
    assert [e for e in rv.events(bars, TF, spike=6.0) if e["code"] == "RF"] == []


def noisy(n=700, seed=3):
    rng = random.Random(seed)
    bars, price = [], 100.0
    for k in range(n):
        close = price + rng.gauss(0, 1.0)
        bars.append({"t": k * MS, "o": price, "c": close, "h": max(price, close) + abs(rng.gauss(0, 0.3)),
                     "l": min(price, close) - abs(rng.gauss(0, 0.3)), "delta": 0.0, "vol": 50.0 + 100.0 * rng.random() ** 3 * 6})
        price = close
    return bars


def test_el_rombo_se_opera_como_giro_o_siguiendo_el_tramo():
    bars = noisy()
    turn = [e for e in rv.events(bars, TF) if e["code"] == "RB"]
    follow = [e for e in rv.events(bars, TF, rombo="follow") if e["code"] == "RB"]
    assert len(turn) >= 5 and [e["t"] for e in turn] == [e["t"] for e in follow]
    by_t = {b["t"]: b for b in bars}
    for a, b in zip(turn, follow):
        assert a["dir"] == -a["info"]["leg"] and b["dir"] == b["info"]["leg"]
        # Giro: la zona llega al extremo del tramo. Siguiendo: es la vela
        assert a["info"]["extreme"] in (round(a["lo"], 8), round(a["hi"], 8))
        assert (b["lo"], b["hi"]) == (by_t[b["t"]]["l"], by_t[b["t"]]["h"])


def test_lo_conocido_no_cambia_con_velas_posteriores():
    bars = noisy()
    full = rv.events(bars, TF, arrow="any")
    for cut in (200, 431, 650):
        assert rv.events(bars[:cut], TF, arrow="any") == [e for e in full if e["known"] <= bars[cut]["t"]]


def test_la_regla_con_la_flecha_abre_el_trade_y_guarda_lo_que_vio(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    raw = {"name": "F", "tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2.0},
           "exit": {"targetR": 2.0, "horizon": 5}, "cooldown": 0}
    rule = rt.clean_rule(raw)
    assert rule["rv"] == {"leg": 2.0, "spike": 2.0, "arrow": "with", "rombo": "turn"}
    bars = marked()
    trades = rt.run("X", rule, {"bars": bars, "events": []}, PHASE, None, base=False)["trades"]
    assert [(t["signal"], t["dir"]) for t in trades] == [(bars[50]["t"], 1)]
    assert trades[0]["rv"] == {"times": 5.0, "leg": 1, "code": "RF"} and trades[0]["entry"] == bars[51]["o"]
    other = rt.clean_rule({**raw, "rv": {"arrow": "against"}})
    assert rt.rule_hash("X", other) != rt.rule_hash("X", rule)
    trades = rt.run("X", other, {"bars": marked(), "events": []}, PHASE, None, base=False)["trades"]
    assert [(t["signal"], t["dir"]) for t in trades] == [(bars[55]["t"], -1)]
    # Una regla sin estos elementos no lleva sus ajustes
    assert "rv" not in rt.clean_rule({**raw, "recipe": {"slots": [{"codes": ["VH"]}]}})
    assert {"RF", "RB"} <= set(rt.CANDLE_CODES)


def test_todas_las_monedas_un_trabajo_y_un_informe_conjunto(tmp_path, monkeypatch):
    import time

    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    monkeypatch.setattr(rt, "candle_symbols", lambda group="base": ["AAAUSDT", "BBBUSDT", "CCCUSDT"])
    monkeypatch.setattr(rt, "has_store", lambda s: s == "AAAUSDT")
    monkeypatch.setattr(rt.measures, "table_for", lambda s: None)
    phase = {"phase": 1, "name": "Exploración", "from": "2020-01-01", "to": "2020-01-31", "available": True}
    monkeypatch.setattr(rt, "phases", lambda s: [{**phase, "phase": n, "available": not (s == "CCCUSDT" and n == 1)} for n in (1, 2, 3)])
    monkeypatch.setattr(rt, "detect_span", lambda symbol, tf, ph, rule, progress=None: {"bars": marked(), "events": []})
    raw = {"name": "F", "tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2.0},
           "exit": {"targetR": 2.0, "horizon": 5}, "cooldown": 0}

    def wait(job_id):
        for _ in range(200):
            job = rt.job_status(job_id)
            if job["state"] != "running":
                return job
            time.sleep(0.05)
        raise AssertionError("el trabajo no terminó")

    started = rt.start_all(raw, 1)
    assert [(r["symbol"], r["action"]) for r in started["plan"]] == [("AAAUSDT", "run"), ("BBBUSDT", "run"), ("CCCUSDT", "skip")]
    job = wait(started["job"])
    assert job["state"] == "done" and job["symbolsDone"] == 2 and all(r["run"] for r in job["plan"][:2])
    report = rt.consolidated(raw, 1)
    assert [r["symbol"] for r in report["symbols"]] == ["AAAUSDT", "BBBUSDT"] and report["summary"]["n"] == 2
    assert report["symbols"][0]["n"] == 1 and report["withTrades"] == 2 and [r["label"] for r in report["bySide"]] == ["Largos"]
    assert report["plan"][2]["reason"] == "sin datos de esa fase" and len(report["equity"]) == 2
    # Lo ya corrido no se repite, y otra regla no ve esas corridas
    again = rt.start_all(raw, 1)
    assert again.get("done") and "job" not in again and len(rt.history()) == 2
    assert rt.consolidated({**raw, "rv": {"spike": 3}}, 1)["success"] is False
    # La fase 2 pide confirmar, y la 3 no corre sin la 2
    assert rt.start_all(raw, 2)["needsConfirm"] is True and len(rt.history()) == 2
    blocked = rt.start_all(raw, 3)
    assert blocked["success"] is False and {r["reason"] for r in blocked["plan"]} == {"falta correr esta regla en la fase 2"}
    # Una moneda sin almacén no entra con elementos de order flow
    mixed = rt.start_all({**raw, "recipe": {"slots": [{"codes": ["VA"]}]}}, 2)
    assert [r["action"] for r in mixed["plan"]] == ["run", "skip", "skip"] and "VA" in mixed["plan"][1]["reason"]


def test_control_de_seguir_el_tramo_y_corridas_guardadas_antes(tmp_path, monkeypatch):
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    monkeypatch.setattr(rt, "has_store", lambda s: False)
    monkeypatch.setattr(rt, "phases", lambda s: [{"phase": 1, "from": "2020-01-01", "to": "2020-01-31", "available": True}])
    bars = noisy()
    monkeypatch.setattr(rt, "detect_span", lambda symbol, tf, ph, rule, progress=None: {"bars": bars, "events": []})
    rule = rt.clean_rule({"name": "F", "tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2.0},
                          "exit": {"targetR": 2.0, "horizon": 50}, "cooldown": 0, "rv": {"arrow": "any", "leg": 3}})
    result = rt.run("X", rule, {"bars": bars, "events": []}, PHASE)
    leg = result["legBaseline"]
    assert leg["leg"] == 3.0 and leg["n"] > 1000 and result["legEdge"]["low"] <= result["legEdge"]["r"] <= result["legEdge"]["high"]
    # El control siempre entra a favor del tramo: no es el azar de largos y cortos
    assert leg["avgR"] != result["baseline"]["avgR"]
    # Sin la bandera base no se calcula, y es el mismo cada vez
    assert "legBaseline" not in rt.run("X", rule, {"bars": bars, "events": []}, PHASE, base=False)
    assert rt.run("X", rule, {"bars": bars, "events": []}, PHASE)["legBaseline"] == leg
    # Una corrida guardada sin el control lo recibe al pedirla, sin cambiar sus trades
    old = {k: v for k, v in result.items() if k not in ("legBaseline", "legEdge")}
    run_id = rt._save(old, "abc")
    filled = rt.with_leg_baseline(rt.load_run(run_id))
    assert filled["legBaseline"] == leg and filled["summary"] == result["summary"]
    assert rt.load_run(run_id)["legBaseline"] == leg, "queda guardado para la próxima vez"

def test_los_elementos_en_memoria_no_pasan_de_unas_velas_a_otras():
    # La clave era id(bars): al soltarse una lista, la de otra moneda podía recibir el mismo id y heredar sus elementos
    a = [{"t": k, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "vol": 10.0} for k in range(50)]
    b = [dict(x, c=1.6) for x in a]
    assert rt._bars_key(a) == rt._bars_key(list(a)) and rt._bars_key(a) != rt._bars_key(b) and rt._bars_key(a) != rt._bars_key(a[:-1])
    assert "id(bars)" not in open(rt.__file__, encoding="utf-8").read().replace("`id(bars)`", "")


def test_el_rombo_sale_solo_cuando_sube_la_respuesta():
    # Motor 7 (23/11/2026, decidido por el usuario): la verde de 100 deja la ventana en la vela 4 y el balance cae. Con la
    # regla de antes salía ahí el rombo; ahora sigue armado, la roja de 20 no sube la respuesta (30) y la de 50 sí
    import numpy as np
    import measures
    rows = [(100, 101, 100), (101, 100.8, 30), (100.8, 101.2, 10), (101.2, 101.6, 10), (101.6, 102, 10), (102, 101.8, 20), (101.8, 101.5, 50)]
    side = np.array([np.sign(c - o) for o, c, _ in rows], dtype=np.int8)
    weight = np.array([v for _, _, v in rows], dtype=float)
    direction, start = np.ones(len(rows), dtype=int), np.zeros(len(rows), dtype=int)
    window, top = measures.RESPONSE_WINDOW, measures.RESPONSE_TOP
    try:
        measures.RESPONSE_WINDOW, measures.RESPONSE_TOP = 4, 1
        values, answers = measures.balance(side, weight, direction, start, parts=True)
    finally:
        measures.RESPONSE_WINDOW, measures.RESPONSE_TOP = window, top
    assert values[4] <= measures.BALANCE and values[5] <= measures.BALANCE
    assert list(np.nonzero(measures.equilibrium(values, direction, start, answers, side))[0]) == [6]
    assert list(np.nonzero(measures.equilibrium(values, direction, start))[0]) == [4], "sin answers, la regla de antes"
    assert np.isnan(answers[0]) and answers[1] == 30 and answers[5] == 20 and answers[6] == 50
