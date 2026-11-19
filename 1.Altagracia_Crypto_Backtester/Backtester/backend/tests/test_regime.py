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
