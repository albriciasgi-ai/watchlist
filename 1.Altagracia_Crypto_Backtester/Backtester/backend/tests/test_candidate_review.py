"""Revisión de candidatos por sesiones. Uso: python -m pytest tests/test_candidate_review.py"""
import random

import pytest

import candidate_review as cr
import rule_tester as rt

TF = 240
MS = TF * 60000
DAY = 86400000
N = 6 * 400   # 400 días de velas de 4 horas


def bars():
    rng = random.Random(3)
    out, price = [], 100.0
    for k in range(N):
        close = max(1.0, price + rng.gauss(0, 1.0))
        vol = 100.0 * (4 if rng.random() < 0.08 else 1) * (1 + 0.2 * rng.random())
        out.append({"t": k * MS, "o": price, "c": close, "h": max(price, close) + abs(rng.gauss(0, 0.3)),
                    "l": min(price, close) - abs(rng.gauss(0, 0.3)), "delta": 0.0, "vol": vol})
        price = close
    return out


RAW = {"name": "Flecha", "tf": TF, "rv": {"arrow": "any"}, "recipe": {"slots": [{"codes": ["RF"]}]},
       "stop": {"type": "atr", "atr": 2}, "exit": {"targetR": 2, "horizon": 60}}


@pytest.fixture
def world(tmp_path, monkeypatch):
    data = bars()
    phase = {"phase": 1, "start": 0, "end": N * MS, "from": "a", "to": "b", "available": True}
    monkeypatch.setattr(cr.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt, "phases", lambda s: [phase])
    monkeypatch.setattr(rt, "has_store", lambda s: False)
    monkeypatch.setattr(rt, "candle_symbols", lambda: ["X", "Y"])
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": data, "events": []})
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    return data


def test_la_sesion_es_un_tramo_seguido_con_candidatos_en_orden(world):
    s = cr.start("X", RAW, 60, seed=1)
    assert s["success"] and s["session"]["symbol"] == "X" and s["session"]["position"] == 0 and not s["session"]["done"]
    full = cr.sessions()[s["session"]["id"]]
    times = [c["time"] for c in full["candidates"]]
    assert cr.MIN_CANDIDATES <= len(times) <= cr.MAX_CANDIDATES and times == sorted(times)
    assert all(full["start"] <= t < full["end"] for t in times) and full["end"] - full["start"] == 60 * DAY
    # La regla propone cada señal: no espera a que cierre la anterior
    assert full["rule"]["oneAtATime"] is False and full["rule"]["entry"]["type"] == "market"
    # Lo que se ve del candidato no trae nada de su futuro
    assert set(s["candidate"]) == {"i", "time", "signal", "dir", "entry", "stop", "target", "votes"}
    assert s["candidate"]["time"] == times[0] and s["decisions"] == []
    assert cr.active("X")["session"]["id"] == s["session"]["id"] and cr.active("Y")["session"] is None


def test_el_resultado_solo_sale_cuando_el_candidato_a_la_vista_ya_lo_dejo_atras(world):
    s = cr.start("X", RAW, 60, seed=1)
    sid = s["session"]["id"]
    full = cr.sessions()[sid]
    total = len(full["candidates"])
    assert cr.decide(sid, 1, "rule")["success"] is False            # No es el candidato a la vista
    assert cr.decide(sid, 0, "otra")["success"] is False
    answer = None
    for i in range(total):
        answer = cr.decide(sid, i, "rule" if i % 2 == 0 else "skip", seconds=12 + i)
        assert answer["success"]
        now = answer["candidate"]["time"] if answer["candidate"] else None
        for row in answer["decisions"]:
            candidate = full["candidates"][row["i"]]
            if answer["session"]["done"]:
                assert "ruleR" in row
            else:
                assert ("ruleR" in row) == (candidate["exit_t"] <= now)
                if row["action"] == "rule":
                    assert ("r" in row) == (candidate["exit_t"] <= now) and row["entry"] == candidate["entry"]
    assert answer["session"]["done"] and answer["candidate"] is None
    summary = answer["summary"]
    assert summary["decisions"] == total and summary["taken"]["n"] == (total + 1) // 2 and summary["skipped"]["n"] == total // 2
    # Tomar como la regla da lo mismo que la regla en esos candidatos
    assert summary["taken"]["avgR"] == summary["takenAsRule"]["avgR"]
    assert sum(g["decisions"] for g in summary["byPosition"]) == total and summary["byPosition"][0]["seconds"] == 14
    assert cr.decide(sid, total, "skip")["success"] is False and cr.active("X")["session"] is None


def test_un_trade_propio_usa_su_lado_su_stop_y_su_objetivo(world):
    s = cr.start("X", RAW, 60, seed=2)
    sid, c = s["session"]["id"], s["candidate"]
    entry = c["entry"]
    assert cr.decide(sid, 0, "long", stop=entry + 1, target=entry + 2)["success"] is False   # Stop del lado equivocado
    assert cr.decide(sid, 0, "short", stop=entry + 3, target=entry + 1)["success"] is False  # Objetivo del lado equivocado
    answer = cr.decide(sid, 0, "short", stop=entry + 3, target=entry - 6)
    assert answer["success"]
    mine = cr.sessions()[sid]["decisions"][0]["trade"]
    assert mine["dir"] == -1 and mine["entry"] == entry and mine["stop"] == pytest.approx(entry + 3) and mine["target"] == pytest.approx(entry - 6)
    assert (mine["r"] > 1.9) == (mine["reason"] == "objetivo")
    row = answer["decisions"][0]
    assert row["dir"] == -1 and row["stop"] == pytest.approx(entry + 3) and ("r" in row) == (mine["exit_t"] <= answer["candidate"]["time"])


def test_el_informe_separa_lo_tomado_de_lo_dejado_y_no_adelanta_resultados(world):
    s = cr.start("X", RAW, 60, seed=1)
    sid = s["session"]["id"]
    full = cr.sessions()[sid]
    for i in range(6):
        cr.decide(sid, i, "rule" if i < 4 else "skip")
    report = cr.report()
    now = full["candidates"][6]["time"]
    seen = [c for c in full["candidates"][:6] if c["exit_t"] <= now]
    assert report["decisions"] == len(seen) and report["smallSample"] is True and report["sessions"][0]["decided"] == 6
    cr.end(sid)
    report = cr.report()
    assert report["decisions"] == 6 and report["taken"]["n"] == 4 and report["skipped"]["n"] == 2 and report["sessions"][0]["done"] is True
    assert report["taken"]["totalR"] == pytest.approx(sum(c["r"] for c in full["candidates"][:4]), abs=0.01)
    assert report["skipped"]["totalR"] == pytest.approx(sum(c["r"] for c in full["candidates"][4:6]), abs=0.01)
    assert report["selection"]["r"] == pytest.approx(report["takenAsRule"]["avgR"] - report["skipped"]["avgR"], abs=0.002)


def test_moneda_al_azar_y_tramos_que_no_se_repiten(world):
    first = cr.start("X", RAW, 60, any_symbol=True, seed=5)
    assert first["success"] and first["session"]["symbol"] in ("X", "Y")
    spans = []
    for seed in range(4):
        s = cr.start("X", RAW, 30, seed=seed)
        full = cr.sessions()[s["session"]["id"]]
        spans.append((full["start"], full["end"]))
        cr.end(s["session"]["id"])
    assert all(a[1] <= b[0] or b[1] <= a[0] for i, a in enumerate(spans) for b in spans[i + 1:])
    # Una regla que casi no da señales no arma sesión
    rare = cr.start("X", {**RAW, "rv": {"arrow": "any", "spike": 50}}, 30, seed=1)
    assert rare["success"] is False and "candidatos" in rare["message"]


def test_tras_entrar_se_puede_seguir_hasta_que_el_trade_cierre(world):
    s = cr.start("X", RAW, 60, seed=1)
    sid = s["session"]["id"]
    full = cr.sessions()[sid]
    first = full["candidates"][0]
    answer = cr.decide(sid, 0, "rule", follow=True)
    resume = first["exit_t"] + cr.AFTER_BARS * MS
    inside = [c for c in full["candidates"][1:] if c["time"] < resume]
    # El resultado ya se ve, y lo que cayó con el trade abierto no se decide
    assert answer["decisions"][0]["r"] == first["r"] and [d["action"] for d in answer["decisions"][1:]] == ["passed"] * len(inside)
    if answer["candidate"]:
        assert answer["candidate"]["time"] >= resume and answer["candidate"]["i"] == 1 + len(inside)
    # No entrar, o entrar sin seguir, pasa al candidato siguiente
    nxt = answer["candidate"]["i"]
    assert cr.decide(sid, nxt, "skip", follow=True)["candidate"]["i"] == nxt + 1
    done = cr.end(sid)
    assert done["session"]["done"] and done["summary"]["decisions"] == 2 and done["summary"]["passed"] == len(inside)
    assert done["summary"]["taken"]["n"] == 1 and done["summary"]["skipped"]["n"] == 1
    # El gráfico de la sesión terminada llega hasta después de la salida del trade, no hasta el final de la fase
    assert done["session"]["until"] >= resume and done["session"]["until"] < full["end"] + 60 * DAY
    assert cr.report()["decisions"] == 2
