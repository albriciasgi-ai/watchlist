"""Regímenes: la referencia a posteriori y los detectores sin futuro. Uso: python -m pytest tests/test_regime.py"""
import random

import numpy as np
import pytest

import regime
import regime_detectors as rd

MS = 240 * 60000


def series(seed=4, n=900):
    """Tramos alternados: subida derecha, rango ruidoso, bajada, rango."""
    rng = random.Random(seed)
    bars, price, k = [], 100.0, 0
    for part, length in (("up", 150), ("flat", 300), ("down", 150), ("flat", 300)):
        for _ in range(length):
            drift = {"up": 0.006, "down": -0.006, "flat": 0.0}[part]
            close = price * (1 + drift + rng.gauss(0, 0.004))
            if part == "flat":
                close = 100.0 + (close - 100.0) * 0.9  # Vuelve hacia su centro
            bars.append({"t": k * MS, "o": price, "c": close, "h": max(price, close) * 1.002, "l": min(price, close) * 0.998, "vol": 100 + rng.random() * 50})
            price, k = close, k + 1
        if part == "flat":
            price = 100.0
    return bars[:n]


def test_la_referencia_marca_la_tendencia_y_el_rango():
    bars = series()
    tr = regime.truth(bars, window=48, min_run=8)
    lab = tr["labels"]
    assert (lab[40:130] == 1).mean() > 0.6          # La subida es tendencia alcista
    assert (lab[470:580] == -1).mean() > 0.6         # La bajada, bajista
    assert (lab[620:850] == 0).mean() > 0.8          # El segundo rango, horizontal
    assert (lab[200:420] == 0).mean() > 0.8          # El rango, horizontal
    runs = [b - a for a, b, _ in regime._runs(lab)]
    assert min(runs[1:-1] or [99]) >= 8              # Sin tramos más cortos que el mínimo, salvo en los bordes


@pytest.mark.parametrize("name", list(rd.DETECTORS))
def test_ningun_detector_cambia_una_vela_cerrada_con_velas_nuevas(name):
    bars = series(seed=9)
    a = regime.arrays(bars)
    cut = 700
    short = {k: v[:cut] for k, v in a.items()}
    full = rd.run_detector(name, a, 240, rd.PARAMS[name]["params"])["state"]
    part = rd.run_detector(name, short, 240, rd.PARAMS[name]["params"])["state"]
    assert np.array_equal(full[:cut], part), name


def test_un_detector_halla_el_rango_y_no_la_tendencia():
    bars = series()
    a = regime.arrays(bars)
    tr = regime.truth(bars, window=48, min_run=8)
    for name in ("er", "er_box"):
        sc = rd.score(rd.run_detector(name, a, 240, rd.PARAMS[name]["params"])["state"], tr["labels"], tr["valid"])
        assert sc["recall"] > 0.6 and sc["leak"] < 0.4, (name, sc)


def test_detectar_en_velas_chicas_solo_usa_lo_cerrado():
    fine = {"t": np.arange(16) * 3600000, "state": np.array([0, 0, 0, 1] * 4, dtype=bool)}  # Rango en la 4.ª hora de cada 4
    coarse = {"t": np.arange(4) * MS}
    # Cada vela de 4h toma el estado de la última vela de 1h que cierra con ella: la 4.ª
    assert rd.on_frame(fine, 60, coarse, 240).tolist() == [True] * 4
    fine["state"] = np.array([1, 1, 1, 0] * 4, dtype=bool)
    assert rd.on_frame(fine, 60, coarse, 240).tolist() == [False] * 4


def test_la_caja_de_eficiencia_no_crece():
    a = regime.arrays(series())
    for z in rd.er_box(a, 20, 0.3, 0.5)["zones"]:
        s, d = z["start"], z["detected"]
        assert z["low"] == pytest.approx(a["l"][s:d + 1].min()) and z["high"] == pytest.approx(a["h"][s:d + 1].max())


def test_la_calificacion():
    labels = np.array([0, 0, 0, 1, 1, 0, -1, 0])
    state = np.array([1, 1, 0, 1, 0, 1, 0, 0], dtype=bool)
    sc = rd.score(state, labels, np.ones(8, dtype=bool))
    assert sc["recall"] == 0.6 and sc["leak"] == round(1 / 3, 3) and sc["j"] == round(0.6 - 1 / 3, 3)


def test_el_rango_mayor_no_cambia_lo_cerrado_y_une_cajas():
    a = regime.arrays(series(seed=9))
    parts = [{"i": z["detected"], "low": z["low"], "high": z["high"]} for z in rd.er_box(a, 20, 0.3, 0.5)["zones"]]
    full = rd.major(a, parts, 8, 0.5, 3)
    cut = 650
    short = rd.major({k: v[:cut] for k, v in a.items()}, [p for p in parts if p["i"] < cut], 8, 0.5, 3)
    assert np.array_equal(full["state"][:cut], short["state"])
    assert sum(z["parts"] for z in full["zones"]) == len(parts)


def test_el_rango_mayor_aguanta_cierres_fuera_hasta_el_limite():
    n = 40
    c = np.full(n, 100.0)
    c[20:22] = 105.0           # Dos cierres fuera
    c[30:] = 106.0             # Y después se va
    a = {"t": np.arange(n) * MS, "o": c, "h": c + 0.5, "l": c - 0.5, "c": c, "v": np.ones(n)}
    parts = [{"i": 5, "low": 99.0, "high": 101.0}]
    one = rd.major(a, parts, 20, 0.0, 1)["zones"][0]
    three = rd.major(a, parts, 20, 0.0, 3)["zones"][0]
    assert one["end"] == 19                     # Con 1 cierre, termina en la primera salida
    assert three["end"] == 31                   # Con 3, aguanta los dos de afuera y termina tras el tercero seguido


def test_el_filtro_de_regimen_del_probador():
    import rule_tester as rt
    bars = [{**b, "delta": 0.0} for b in series(seed=9)]
    masks = {m: rt.regime_mask({"mode": m, "major": True, "majorOut": 6, "after": 6}, bars) for m in ("inside", "outside", "breakout")}
    assert np.array_equal(masks["inside"], ~masks["outside"])
    assert not (masks["breakout"] & masks["inside"]).any() and masks["breakout"].any()
    cut = 700
    short = rt.regime_mask({"mode": "inside", "major": True, "majorOut": 6, "after": 6}, bars[:cut])
    assert np.array_equal(short, masks["inside"][:cut])  # Sin futuro


def test_una_regla_sin_regimen_conserva_su_identidad_y_la_ventana_la_devuelve_igual(tmp_path):
    import json
    import pathlib
    import shutil
    import subprocess
    import rule_tester as rt
    base = {"tf": 240, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2}, "exit": {"targetR": 2}}
    assert "regime" not in rt.clean_rule(base) and "regime" not in rt.clean_rule({**base, "regime": {"mode": "any"}})
    rule = rt.clean_rule({**base, "regime": {"mode": "breakout", "major": True, "majorOut": 4, "after": 9}})
    assert rule["regime"] == {"mode": "breakout", "major": True, "majorOut": 4, "after": 9}
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
    assert rt.clean_rule(again)["regime"] == rule["regime"]
