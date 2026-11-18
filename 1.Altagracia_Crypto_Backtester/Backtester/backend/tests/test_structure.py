"""Cambio de carácter del probador de reglas. Uso: python -m pytest tests/test_structure.py"""
import pytest

import rule_tester as rt
import structure as st

TF = 15
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def path(points, start=0):
    """Velas de 15m planas en cada precio, con una décima de mecha a cada lado: sin empates entre vecinas."""
    return [{"t": start + k * MS, "o": p, "h": p + 0.1, "l": p - 0.1, "c": p, "delta": 0.0, "vol": 10.0} for k, p in enumerate(points)]


# Sube en escalera (dos máximos y dos mínimos crecientes) y después cierra bajo el último mínimo
UP = [100, 101, 102, 103, 104, 103, 102, 101.5, 102.5, 104, 105, 106, 107, 106, 105, 104.5, 105.5, 106.5, 108, 106, 105, 104, 103, 102]


def test_cambio_de_caracter_tras_dos_tramos_crecientes():
    bars = path(UP + [102] * 10)
    found = st.events(bars, TF, swing=2, legs=2)
    assert len(found) == 1
    e = found[0]
    assert e["dir"] == -1 and e["info"]["level"] == pytest.approx(104.4) and e["info"]["extreme"] == pytest.approx(108.1)
    assert bars[21]["c"] < 104.4 <= bars[20]["c"] and e["t"] == bars[21]["t"] and e["known"] == bars[22]["t"]
    assert (e["lo"], e["hi"]) == (bars[21]["c"], e["info"]["extreme"])


def test_lo_conocido_no_cambia_con_velas_posteriores_y_al_reves_es_alcista():
    bars = path(UP + [102] * 10)
    assert st.events(bars[:22], TF, swing=2, legs=2) == st.events(bars, TF, swing=2, legs=2)
    assert st.events(bars[:21], TF, swing=2, legs=2) == []
    mirror = path([200 - p for p in UP] + [98] * 10)
    assert [e["dir"] for e in st.events(mirror, TF, swing=2, legs=2)] == [1]


def test_estructura_en_velas_mayores_desde_otra_hora():
    bars = path([100 + (k % 7) for k in range(96 * 3)])
    big = st.aggregate(bars, 240, 90)
    assert big[1]["t"] == 90 * 60000 and big[1]["t"] - big[0]["t"] == 240 * 60000 or big[0]["t"] == -150 * 60000
    assert all(b["h"] >= b["l"] for b in big)
    for e in st.events(bars, TF, 240, 90, swing=2, legs=2):
        assert (e["known"] - 90 * 60000) % (240 * 60000) == 0  # Se conoce al cerrar una vela de 4 h contada desde las 01:30


def test_la_regla_opera_el_cambio_de_caracter_y_respeta_el_horario(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    bars = path([100] * 60 + UP + [102] * 80)
    raw = {"name": "C", "tf": TF, "recipe": {"slots": [{"codes": ["CC"]}]}, "cc": {"swing": 2, "legs": 2},
           "stop": {"type": "zone", "buffer": 0.1, "maxAtr": 100}, "exit": {"targetR": None, "horizon": 5}, "cooldown": 0}
    rule = rt.clean_rule(raw)
    assert rule["cc"] == {"tf": TF, "offset": 0, "swing": 2, "legs": 2} and "hours" not in rule
    trade = rt.run("X", rule, {"bars": bars, "events": []}, PHASE, None, base=False)["trades"][0]
    assert trade["dir"] == -1 and trade["stop"] > 108.1 and trade["cc"]["level"] == pytest.approx(104.4) and trade["votes"] == ["CC"]
    known = trade["signal"] + MS
    minute = (known // 60000) % 1440
    inside = rt.clean_rule({**raw, "hours": {"on": True, "from": minute, "to": minute}})
    assert len(rt.run("X", inside, {"bars": list(bars), "events": []}, PHASE, None, base=False)["trades"]) == 1
    outside = rt.clean_rule({**raw, "hours": {"on": True, "from": (minute + 60) % 1440, "to": (minute + 120) % 1440}})
    result = rt.run("X", outside, {"bars": list(bars), "events": []}, PHASE, None, base=False)
    assert result["trades"] == [] and result["skipped"] == {"fuera de horario": 1}


def test_horario_que_cruza_la_medianoche_y_fin_de_semana():
    hours = {"from": 22 * 60, "to": 2 * 60, "weekdays": False}
    day = 86400000
    assert rt._in_hours(hours, 23 * 3600000) and rt._in_hours(hours, day + 3600000) and not rt._in_hours(hours, 12 * 3600000)
    saturday = 2 * day  # El 3 de enero de 1970 fue sábado
    assert not rt._in_hours({"from": 0, "to": 1439, "weekdays": True}, saturday + 3600000)
    assert rt._in_hours({"from": 0, "to": 1439, "weekdays": True}, 4 * day + 3600000)


def test_una_moneda_sin_almacen_corre_sobre_el_cache_de_velas(tmp_path, monkeypatch):
    import gzip
    import json
    day = 86400000
    start = 19000 * day  # Enero de 2022
    rows = [{"timestamp": start + k * MS, "open": 100.0, "high": 100.5, "low": 99.5, "close": 100.0, "volume": 10.0} for k in range(96 * 120)]
    with gzip.open(tmp_path / "ZZZUSDT_backtesting_data.json.gz", "wt", encoding="utf-8") as fh:
        json.dump({"timeframes": {"15m": {"main": rows}}}, fh)
    monkeypatch.setattr(rt, "CANDLE_DIR", tmp_path)
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path / "observer")
    monkeypatch.setattr(rt.fs, "coverage", lambda symbol: {"first": None, "last": None, "days": 0})
    assert rt.candle_symbols() == ["ZZZUSDT"] and not rt.has_store("ZZZUSDT")
    bars = rt.candle_bars("ZZZUSDT", 15)
    assert len(bars) == 96 * 120 and bars[0] == {"t": start, "o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "delta": 0.0, "vol": 10.0}
    half = rt.candle_bars("ZZZUSDT", 30)
    assert len(half) == 48 * 120 and half[0]["vol"] == 20.0 and half[1]["t"] - half[0]["t"] == 30 * 60000
    phases = rt.phases("ZZZUSDT")
    assert phases[0]["available"] and phases[0]["start"] >= start + rt.WARM_DAYS * day and not phases[2]["available"]
    span = rt.detect_span("ZZZUSDT", 15, phases[0], rt.clean_rule({"name": "C", "recipe": {"slots": [{"codes": ["CC"]}]}}))
    assert span["events"] == [] and span["bars"][0]["t"] == phases[0]["start"] and span["bars"][-1]["t"] < phases[0]["end"]
    refused = rt.start("ZZZUSDT", {"name": "V", "recipe": {"slots": [{"codes": ["VA"]}]}}, 1)
    assert refused["success"] is False and "VA" in refused["message"]
