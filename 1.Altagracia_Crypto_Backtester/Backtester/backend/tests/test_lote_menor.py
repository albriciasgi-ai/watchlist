"""
El lote menor del protocolo de pruebas (22/11/2026) que no cambia trades: la identidad de la regla (O-18), el contador de
variantes (F-12), los ids de las corridas (O-28), las acciones en 5m y 30m (F-11) y las corridas del contexto del trade
(O-30). Uso: python -m pytest tests/test_lote_menor.py
"""
import json

import rule_tester as rt


def rule(**kw):
    base = {"name": "R", "tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "fv": {"minAtr": 0.3},
            "stop": {"type": "atr", "atr": 1.5}, "exit": {"targetR": 3}}
    base.update(kw)
    return rt.clean_rule(base)


def test_lo_que_no_hace_nada_no_cambia_la_identidad():
    plain = rule()
    same = rule(stop={"type": "atr", "atr": 1.5, "buffer": 0.3, "bars": 9},
                recipe={"slots": [{"codes": ["FV"]}], "mode": "threshold", "min": 1, "swing": {"bars": 12}, "entry": {"atr": 1.0}})
    assert rt.rule_hash("X", plain) == rt.rule_hash("X", same)
    # Lo que sí cuenta sigue cambiando la identidad
    assert rt.rule_hash("X", plain) != rt.rule_hash("X", rule(stop={"type": "atr", "atr": 2.0}))
    swing_stop = rule(stop={"type": "swing", "buffer": 0.3})
    assert rt.rule_hash("X", swing_stop) != rt.rule_hash("X", rule(stop={"type": "swing", "buffer": 0.1}))
    # Con el stop arrastrado al swing, el margen del stop en ATR se usa
    trail = dict(exit={"targetR": 3, "trail": "swing"})
    assert rt.rule_hash("X", rule(stop={"type": "atr", "buffer": 0.3}, **trail)) != rt.rule_hash("X", rule(stop={"type": "atr"}, **trail))


def write_runs(tmp_path, monkeypatch, records):
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    path = rt._runs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")


def test_el_contador_de_variantes_cuenta_las_de_motores_anteriores(tmp_path, monkeypatch):
    write_runs(tmp_path, monkeypatch, [
        {"id": "a", "symbol": "X", "tf": 240, "phase": 1, "hash": "h1", "rule": {}, "engine": 5},
        {"id": "b", "symbol": "X", "tf": 240, "phase": 1, "hash": "h2", "rule": {}, "engine": 4},
        {"id": "c", "symbol": "X", "tf": 240, "phase": 1, "hash": "h3", "rule": {}, "engine": rt.ENGINE},
    ])
    monkeypatch.setattr(rt, "rule_hash", lambda s, r: "h9")
    info = rt.gate("X", rule(), 1)
    assert info["variantsPhase1"] == 3, "las tres se probaron, aunque dos sean de motores anteriores"
    assert [r["id"] for r in rt.history("X")] == ["c"] and len(rt.history("X", stale=True)) == 3


def test_dos_corridas_en_el_mismo_segundo_tienen_ids_distintos(tmp_path, monkeypatch):
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.time, "time", lambda: 1_800_000_000.0)
    result = {"symbol": "X", "phase": 1, "from": "2020-01-01", "to": "2020-01-31", "rule": rule(), "summary": {"n": 0}, "trades": []}
    first, second = rt._save(dict(result), "abc"), rt._save(dict(result), "abc")
    assert first != second
    assert len({r["id"] for r in rt.history(stale=True)}) == 2


def test_las_acciones_no_tienen_5m_ni_30m(monkeypatch):
    monkeypatch.setattr(rt, "_candle_path", lambda symbol: rt.STOCK_DIR / f"{symbol}.json.gz")
    assert [tf for tf in (5, 15, 30, 60, 240, 1440) if rt.has_candles("AAA", tf)] == [15, 60, 240, 1440]


def test_la_corrida_que_se_sigue_usando_no_sale_primero(monkeypatch):
    rt._replays.clear()
    for n in range(6):
        rt._replays[f"r{n}"] = {"n": n}
    monkeypatch.setattr(rt, "saved_rule", lambda result: (_ for _ in ()).throw(AssertionError("no debía repetirla")))
    assert rt._replay({"id": "r0"}) == {"n": 0}
    assert list(rt._replays)[-1] == "r0", "la usada va al final y sale la menos usada"
    rt._replays.clear()


def test_los_pedidos_de_una_corrida_que_se_esta_repitiendo_esperan_esa_repeticion(monkeypatch):
    # O-33 (etapa 7, 22/11/2026): cada clic mientras decía "repitiendo la regla" lanzaba otra repetición entera de la
    # corrida; con las liquidaciones en 15m se juntaron 55 y el servidor dejó de responder. Ahora la repite uno y los
    # demás esperan su resultado
    import threading
    import time
    rt._replays.clear()
    calls = []
    monkeypatch.setattr(rt, "saved_rule", lambda result: {"tf": 240})
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": []})

    def slow_run(symbol, rule, span, phase, table, base=True, trace=None):
        calls.append(1)
        time.sleep(0.3)
        trace["ok"] = True
        return {"success": True}
    monkeypatch.setattr(rt, "run", slow_run)
    result = {"id": "pesada", "symbol": "X", "phase": 1, "from": "2021-01-01", "to": "2021-02-01"}
    got = []
    threads = [threading.Thread(target=lambda: got.append(rt._replay(result))) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert len(calls) == 1, "una sola repetición para los 8 pedidos"
    assert len(got) == 8 and all(g is not None and g.get("ok") for g in got)
    assert not rt._replaying, "nadie queda marcado como repitiendo"
    rt._replays.clear()


def test_si_la_repeticion_falla_el_que_esperaba_la_intenta(monkeypatch):
    import threading
    import time
    rt._replays.clear()
    calls = []
    monkeypatch.setattr(rt, "saved_rule", lambda result: {"tf": 240})
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": []})

    def flaky_run(symbol, rule, span, phase, table, base=True, trace=None):
        calls.append(1)
        time.sleep(0.2)
        return {"success": len(calls) > 1}
    monkeypatch.setattr(rt, "run", flaky_run)
    result = {"id": "falla", "symbol": "X", "phase": 1, "from": "2021-01-01", "to": "2021-02-01"}
    got = []
    threads = [threading.Thread(target=lambda: got.append(rt._replay(result))) for _ in range(2)]
    for t in threads:
        t.start()
        time.sleep(0.05)
    for t in threads:
        t.join(10)
    assert len(calls) == 2 and sorted(g is None for g in got) == [False, True]
    rt._replays.clear()
