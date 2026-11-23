"""Huella de los datos de cada corrida (protocolo de pruebas, H20, 22/11/2026). Uso: python -m pytest tests/test_data_mark.py"""
import rule_tester as rt

DAY = 86400000
T0 = 1700000000000 - 1700000000000 % DAY


def bars(n, close=100.0, start=T0):
    return [{"t": start + k * 3600000, "o": 100.0, "h": 101.0, "l": 99.0, "c": close, "vol": 5.0, "delta": 0.0} for k in range(n)]


def record(mark, frm="2023-11-14", to="2023-11-15"):
    return {"id": "X_60_f2_abc_1", "symbol": "X", "phase": 2, "hash": "abc", "from": frm, "to": to,
            "rule": {"tf": 60, "target": 0.05, "volFilter": 2.0}, "data": mark}


def test_la_huella_cambia_si_cambia_una_vela():
    a, b = bars(48), bars(48)
    b[10] = {**b[10], "c": 100.5}
    assert rt.data_mark(a) == rt.data_mark(bars(48))
    assert rt.data_mark(a)["sha1"] != rt.data_mark(b)["sha1"]


def test_se_reusa_solo_con_las_mismas_velas(monkeypatch):
    rt._marks.clear()
    today = {"bars": bars(48)}
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: today)
    saved = record(rt.data_mark(bars(48)))
    assert rt.same_data(saved)
    rt._marks.clear()
    today["bars"] = bars(48, close=101.0)  # Velas reparadas o almacén nuevo
    assert not rt.same_data(saved)


def test_la_fase_que_crece_no_cambia_lo_ya_corrido(monkeypatch):
    """La fase 3 suma días nuevos: la huella se toma solo del tramo de la corrida."""
    rt._marks.clear()
    saved = record(rt.data_mark(bars(48)))
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": bars(48 + 24 * 5)})
    assert rt.same_data(saved)


def test_una_corrida_sin_huella_no_se_puede_comprobar():
    assert rt.same_data({"symbol": "X", "rule": {"tf": 60}, "from": "2023-11-14", "to": "2023-11-15"})


def test_el_candado_no_devuelve_una_corrida_con_otros_datos(monkeypatch):
    rt._marks.clear()
    saved = record(rt.data_mark(bars(48)))
    rule = {"tf": 60, "target": 0.05, "volFilter": 2.0, "name": "x"}
    monkeypatch.setattr(rt, "rule_hash", lambda s, r: "abc")
    monkeypatch.setattr(rt, "history", lambda s=None, stale=False: [saved])
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": bars(48)})
    assert rt.gate("X", rule, 2)["stored"] == saved["id"]
    rt._marks.clear()
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: {"bars": bars(48, close=99.5)})
    assert rt.gate("X", rule, 2)["stored"] is None
