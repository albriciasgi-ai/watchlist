"""Tablero de estrategias: celdas, criterio, lectura y orden. Uso: python -m pytest tests/test_strategy_board.py"""
import math

import pytest

import strategy_board as sb


def stats(rs, sides=None, base=0.0, leg=0.0, year="2024"):
    sides = sides or [1] * len(rs)
    return {"n": len(rs), "sum": sum(rs), "sumsq": sum(r * r for r in rs), "wins": sum(1 for r in rs if r > 0),
            "longN": sum(1 for d in sides if d > 0), "longSum": sum(r for r, d in zip(rs, sides) if d > 0),
            "shortN": sum(1 for d in sides if d < 0), "shortSum": sum(r for r, d in zip(rs, sides) if d < 0),
            "years": {year: [len(rs), sum(rs)]},
            "base": {"avgR": base, "seR": 0.01}, "leg": {"avgR": leg, "seR": 0.01}}


def test_la_celda_junta_las_monedas_como_el_informe_todas():
    a, b = [1.0, -1.0, 2.0, -1.0] * 30, [0.5, -1.0] * 40
    cell = sb._pool([("AAA", stats(a, base=0.1)), ("BBB", stats(b, base=-0.2))])
    rs = a + b
    mean = sum(rs) / len(rs)
    se = math.sqrt(sum((r - mean) ** 2 for r in rs) / (len(rs) - 1) / len(rs))
    control = (len(a) * 0.1 + len(b) * -0.2) / len(rs)  # El azar de cada moneda pesa por sus trades
    assert cell["n"] == len(rs) and cell["avgR"] == pytest.approx(mean, abs=1e-3) and cell["seR"] == pytest.approx(se, abs=1e-4)
    assert cell["edge"]["r"] == pytest.approx(mean - control, abs=1e-3) and cell["edge"]["control"] == pytest.approx(control, abs=1e-3)
    assert cell["positive"] == 1 and cell["topCoin"]["symbol"] == "AAA"


def test_pasa_solo_si_gana_y_supera_los_dos_controles_con_margen():
    win = [1.0, -0.5] * 200
    assert sb._pool([("A", stats(win, base=0.0, leg=0.0))])["pass"]
    assert not sb._pool([("A", stats(win, base=0.0, leg=0.24))])["pass"]  # El tramo al azar casi iguala
    lose = [0.5, -1.0] * 200  # Pierde, aunque pierda menos que el azar
    assert not sb._pool([("A", stats(lose, base=-0.6, leg=-0.6))])["pass"]
    no_leg = stats(win)
    no_leg["leg"] = None
    cell = sb._pool([("A", no_leg), ("B", stats(win))])
    assert cell["legMissing"] and cell["pass"]  # El tramo solo vale si lo tienen todas: se juzga contra el azar


def _strategy(name, cells, key="k"):
    return {"key": key, "name": name, "names": [name], "rule": {}, "tf": 240, "lastAt": 0, "runs": 1,
            "cells": {p: {g: sb._pool(items) for g, items in groups.items()} for p, groups in cells.items()}}


def test_la_lectura_dice_que_cayo_y_de_que_lado_esta_la_ventaja():
    good = [1.0, -0.5] * 100
    sides = [1, -1] * 100
    shorts_only = [(-0.5 if d > 0 else 1.5) for d in sides]
    item = _strategy("Regla", {
        "1": {"base": [("A", stats(good, sides)), ("B", stats(good, sides))]},
        "2": {"new": [("C", stats(shorts_only, sides)), ("D", stats(shorts_only, sides))]},
        "3": {"new": [("C", stats([0.1, -0.2] * 100, sides, base=0.0))]},
    })
    found = sb.analyze(item)
    assert found["verdict"].startswith("Cayó en la fase 3")
    texts = " ".join(p["text"] for p in found["points"])
    assert "La ventaja está en los cortos" in texts


def test_el_orden_pone_primero_lo_que_no_cayo_y_deja_fuera_una_sola_moneda():
    good, bad = [1.0, -0.5] * 100, [0.1, -0.2] * 100
    passed = _strategy("Pasa", {"1": {"base": [("A", stats(good)), ("B", stats(good))]}, "2": {"new": [("C", stats(good)), ("D", stats(good))]}}, "p")
    fell = _strategy("Cae", {"1": {"base": [("A", stats(good)), ("B", stats(good))]}, "2": {"new": [("C", stats(bad)), ("D", stats(bad))]}}, "c")
    single = _strategy("Una", {"1": {"base": [("A", stats(good))]}}, "u")
    for s in (passed, fell, single):
        s["analysis"] = sb.analyze(s)
    order = [r["key"] for r in sb.rank([fell, single, passed])]
    assert order == ["p", "c"]
