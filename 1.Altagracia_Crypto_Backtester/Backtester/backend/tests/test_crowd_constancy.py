"""Multitud por el funding, OI sostenido y constancia por trimestre. Uso: python -m pytest tests/test_crowd_constancy.py"""
import json
import pathlib
import shutil
import subprocess

import numpy as np
import pytest

import flow_filters as ff
import rule_search as rs
import rule_tester as rt

H4, DAY = 4 * 3600000, 86400000


def bars(n, start=0, tf=240):
    return [{"t": start + i * tf * 60000, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.0, "vol": 10.0, "delta": 0.0} for i in range(n)]


def test_el_funding_es_el_de_los_3_dias_anteriores_en_equivalente_por_8_horas(monkeypatch):
    # Liquidaciones cada 8 h de 0.01%, salvo una de 0.1% que llega justo después del cierre de la vela 30
    times = np.arange(0, 40 * DAY, 8 * 3600000, dtype=np.int64)
    rates = np.full(len(times), 0.0001)
    b = bars(240)
    late = b[30]["t"] + H4 + 3600000
    rates[np.searchsorted(times, late)] = 0.001
    times[np.searchsorted(times, late)] = late
    monkeypatch.setattr(ff, "funding_series", lambda symbol: (times, rates))
    f = ff.funding_3d("X", b, 240)
    assert f[30] == pytest.approx(0.0001)  # Lo que liquida después del cierre no se conoce todavía
    assert f[33] > 0.0001
    # Cada 4 horas la mitad de la tasa da el mismo equivalente por 8 horas
    t4 = np.arange(0, 40 * DAY, H4, dtype=np.int64)
    monkeypatch.setattr(ff, "funding_series", lambda symbol: (t4, np.full(len(t4), 0.00005)))
    assert ff.funding_3d("X", b, 240)[60] == pytest.approx(0.0001)


def test_la_multitud_segun_el_lado():
    assert ff.crowd(0.0005, -1) == "contra" and ff.crowd(-0.0002, -1) == "con" and ff.crowd(0.0001, -1) == "neutro"
    assert ff.crowd(-0.0002, 1) == "contra" and ff.crowd(0.0005, 1) == "con" and ff.crowd(0.00005, 1) == "neutro"
    assert ff.crowd_ok("nocon", 0.00005, 1) and not ff.crowd_ok("nocon", 0.0005, 1)
    assert ff.crowd_ok("contra", -0.0002, 1) and not ff.crowd_ok("contra", 0.00005, 1)
    assert not ff.crowd_ok("nocon", float("nan"), 1)  # Sin funding no pasa


def test_el_oi_sostenido_cuenta_los_pasos_que_suben_y_no_mira_adelante(monkeypatch):
    t = np.arange(0, 60 * DAY, H4, dtype=np.int64)
    v = 100 + np.cumsum(np.where(np.arange(len(t)) % 4 == 0, -1.0, 1.0))  # Sube 3 de cada 4 pasos
    monkeypatch.setattr(ff, "_json_series", lambda symbol: (t, v, 240))
    b = bars(300)
    s = ff.oi_steady("X", b, 240, 14)
    assert np.isnan(s[50])  # Sin 14 días de historia
    assert s[200] == pytest.approx(0.75, abs=0.02)
    # Un salto del OI después del cierre de la vela 200 no cambia su valor
    v2 = v.copy()
    k = np.searchsorted(t, b[200]["t"] + H4, side="right")
    v2[k:] += 50
    monkeypatch.setattr(ff, "_json_series", lambda symbol: (t, v2, 240))
    assert ff.oi_steady("X", b, 240, 14)[200] == pytest.approx(s[200])


def test_una_regla_sin_los_filtros_nuevos_conserva_su_identidad_y_la_ventana_los_devuelve(tmp_path):
    base = {"tf": 240, "recipe": {"slots": [{"codes": ["IM"]}]}, "stop": {"type": "atr", "atr": 1.5}, "exit": {"targetR": 3}}
    assert "flow" not in rt.clean_rule(base)
    rule = rt.clean_rule({**base, "flow": {"crowd": "nocon", "steady": True, "steadyDays": 21, "steadyMin": 0.55}})
    assert rule["flow"] == {"crowd": "nocon", "steady": True, "steadyDays": 21, "steadyMin": 0.55}
    node = shutil.which("node")
    if node is None:
        pytest.skip("sin node")
    source, target = tmp_path / "r.json", tmp_path / "b.json"
    source.write_text(json.dumps([rule]), encoding="utf-8")
    module = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "backtesting" / "ruleTester.js").as_uri()
    script = ("const fs = await import('node:fs'); const m = await import(process.argv[1]);"
              "fs.writeFileSync(process.argv[3], JSON.stringify(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(r => m.toBackendRule(m.fromBackendRule(r)))));")
    subprocess.run([node, "--input-type=module", "-e", script, module, str(source), str(target)], check=True, capture_output=True)
    again = json.loads(target.read_text(encoding="utf-8"))[0]
    assert rt.clean_rule(again)["flow"] == rule["flow"]


def test_la_constancia_cuenta_trimestres_contra_el_azar_de_cada_uno():
    q1, q2 = rt._ms("2024-01-10"), rt._ms("2024-04-10")
    result = {"baseline": {"avgR": 0.0, "quarters": {"2024T1": {"1": [100, 20.0]}, "2024T2": {"1": [100, -30.0]}}},
              "trades": [{"entry_t": q1, "dir": 1, "r": 0.5}] * 30 + [{"entry_t": q2, "dir": 1, "r": -0.1}] * 30}
    rows = rt.quarter_rows(result)
    assert rows["2024T1"][2] == pytest.approx(30 * (0.5 - 0.2))   # Contra el azar de su trimestre (+0.2)
    assert rows["2024T2"][2] == pytest.approx(30 * (-0.1 + 0.3))  # En un trimestre malo para todos, gana al azar (−0.3)
    cons = rt.consistency(rows)
    assert cons["positive"] == 2 and cons["total"] == 2 and cons["median"] == pytest.approx(0.25)
    assert cons["top4Share"] == pytest.approx(1.0)
    assert rt.consistency({"2024T1": [5, 1.0, 1.0]})["total"] == 0  # Con menos de 20 trades no cuenta


def test_la_busqueda_puede_elegir_por_constancia():
    cfg = rs.clean_config({"tfs": [240], "codes": ["IM"], "fitness": "constancia", "minTrades": 20})
    record = {"complexity": 1, "train": {"n": 400, "edge": 0.5, "se": 0.05, "coinsWith": 7, "coinsUp": 7,
                                         "consistency": {"total": 8, "positive": 6, "median": 0.04}}}
    assert rs.fitness(record, cfg) == pytest.approx(0.04)  # La mediana por trimestre, no el promedio
    record["train"]["consistency"] = {"total": 2, "positive": 2, "median": 0.3}
    assert rs.fitness(record, cfg) < 0  # Con menos de 4 trimestres no compite
    assert rs.clean_config({})["fitness"] == "promedio"
