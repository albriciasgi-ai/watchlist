"""Filtros de CVD y OI y elementos FV y SP del probador. Uso: python -m pytest tests/test_flow_elements.py"""
import json
import pathlib
import random
import shutil
import subprocess

import numpy as np
import pytest

import flow_filters as ff
import fvg_swing
import rule_tester as rt
from tests.test_regime import series

MS = 240 * 60000


def bars_with_delta(seed=9):
    rng = random.Random(seed)
    return [{**b, "delta": (b["c"] - b["o"]) / max(b["h"] - b["l"], 1e-9) * b["vol"] + rng.gauss(0, 5)} for b in series(seed=seed)]


def test_fv_y_sp_no_miran_adelante():
    bars = series(seed=9)
    fv, sp = {"minAtr": 0.0}, {"bars": 5, "minZ": None}
    full = fvg_swing.events(bars, 240, fv, sp)
    assert {e["code"] for e in full} == {"FV", "SP"}
    for e in full:
        if e["code"] == "FV":
            assert e["known"] == e["t"] + MS and e["hi"] > e["lo"]
        else:  # El swing se conoce al cerrar la quinta vela de su derecha
            assert e["known"] == e["t"] + 6 * MS
    cut = 700
    short = {(e["code"], e["t"], e["dir"]) for e in fvg_swing.events(bars[:cut], 240, fv, sp)}
    known = {(e["code"], e["t"], e["dir"]) for e in full if e["known"] <= bars[cut - 1]["t"] + MS}
    assert known == short


def test_el_cvd_usa_la_delta_real_o_la_estimada():
    real = bars_with_delta()
    value, est = ff.cvd(real, 20)
    assert not est and np.isnan(value[:19]).all() and np.isfinite(value[19:]).all()
    d = np.array([b["delta"] for b in real]); v = np.array([b["vol"] for b in real])
    assert value[100] == pytest.approx(d[81:101].sum() / v[81:101].sum())
    _, est = ff.cvd(series(seed=9), 20)
    assert est  # Sin delta: estimada por el cierre en la vela


def test_el_oi_es_el_conocido_al_cierre(monkeypatch):
    bars = series(seed=9)[:50]
    times = np.array([b["t"] for b in bars], dtype=np.int64)
    monkeypatch.setattr(ff, "source", lambda symbol: (times, np.arange(len(times), dtype=float), 240))
    oi = ff.oi_at_close("X", bars, 240)
    # Al cierre de la vela k se conoce el dato de la apertura de k+1 (el mismo instante), nunca uno posterior
    assert oi[10] == 11 and oi[-1] == len(bars) - 1
    assert ff.oi_at_close("X", bars, 60) is None  # Serie de 4 horas: no vale en marcos menores


def test_una_regla_sin_filtros_conserva_su_identidad_y_la_ventana_los_devuelve(tmp_path):
    base = {"tf": 240, "recipe": {"slots": [{"codes": ["BE"]}]}, "stop": {"type": "zone", "buffer": 0.5}, "exit": {"targetR": 2}}
    plain = rt.clean_rule(base)
    assert "flow" not in plain and "pattern" not in plain["be"]
    rule = rt.clean_rule({**base, "recipe": {"slots": [{"codes": ["BE"]}, {"codes": ["SP"]}, {"codes": ["FV"]}]},
                          "flow": {"cvd": 30, "oi": "rise", "oiBars": 4, "oiPct": 3}, "be": {"pattern": True}, "sp": {"bars": 4, "minZ": 1.5}, "fv": {"minAtr": 0.5}})
    assert rule["flow"] == {"cvd": 30, "oi": "rise", "oiBars": 4, "oiPct": 3.0}
    assert rule["be"]["pattern"] and rule["sp"] == {"bars": 4, "minZ": 1.5} and rule["fv"] == {"minAtr": 0.5}
    node = shutil.which("node")
    if node is None:
        pytest.skip("sin node")
    source, target = tmp_path / "r.json", tmp_path / "b.json"
    source.write_text(json.dumps([rule, plain]), encoding="utf-8")
    module = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "backtesting" / "ruleTester.js").as_uri()
    script = ("const fs = await import('node:fs'); const m = await import(process.argv[1]);"
              "fs.writeFileSync(process.argv[3], JSON.stringify(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(r => m.toBackendRule(m.fromBackendRule(r)))));")
    subprocess.run([node, "--input-type=module", "-e", script, module, str(source), str(target)], check=True, capture_output=True)
    again = json.loads(target.read_text(encoding="utf-8"))
    for key in ("flow", "be", "sp", "fv"):
        assert rt.clean_rule(again[0])[key] == rule[key]
    assert "flow" not in rt.clean_rule(again[1]) and rt.clean_rule(again[1])["be"] == plain["be"]


def test_el_filtro_de_cvd_deja_al_azar_en_las_mismas_velas():
    bars = bars_with_delta()
    rule = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["SP"]}]}, "stop": {"type": "atr", "atr": 1.5}, "exit": {"targetR": 2},
                          "flow": {"cvd": 20}, "oneAtATime": False})
    phase = {"phase": 1, "from": bars[0]["t"], "to": bars[-1]["t"] + MS}
    span = {"bars": bars, "events": []}
    res = rt.run("TEST", rule, span, phase, None, base=True)
    assert res["success"] and res["trades"]
    value, _ = ff.cvd(bars, 20)
    index = {b["t"]: i for i, b in enumerate(bars)}
    for t in res["trades"]:
        k = index[t["entry_t"]] - 1  # Se entra en la apertura siguiente a la vela de la señal
        assert value[k] * t["dir"] > 0
    # Con el CVD al revés (delta contraria a la vela) el filtro descarta señales
    flipped = [{**b, "delta": -b["delta"]} for b in bars]
    other = rt.run("TEST", rule, {"bars": flipped, "events": []}, phase, None, base=True)
    assert other["skipped"].get("filtro de CVD u OI", 0) > 0
