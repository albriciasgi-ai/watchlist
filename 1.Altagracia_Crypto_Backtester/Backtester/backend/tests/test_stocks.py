"""Acciones de Alpaca en el probador: velas con su hora, noches que no son huecos, costos, elementos y el régimen medido
en 1D. Uso: python -m pytest tests/test_stocks.py"""
import gzip
import json
import math

import pytest

import rule_tester as rt
import strategy_board as sb

H, DAY = 3600000, 86400000


def session_bars(days, start_price=100.0, first=None):
    """Velas de 1 hora de 09:30 a 16:00 de Nueva York (14:30 a 21:00 UTC en invierno), de lunes a viernes."""
    first = first or rt._ms("2017-01-02")
    rows, price, d = [], start_price, 0
    while len(rows) < days * 7:
        day = first + d * DAY
        d += 1
        if (day // DAY + 3) % 7 >= 5:  # Sábado y domingo
            continue
        for h in range(7):
            t = day + 14 * H + 30 * 60000 + h * H
            rows.append([t, price, price + 1, price - 1, price + 0.2, 1000.0, 10, price])
            price += 0.2
    return rows


def range_then_trend(days=300):
    """Velas de 1 hora de la sesión: 180 días que van y vienen (un rango) y después una subida (una tendencia)."""
    first, rows, prev, d, k = rt._ms("2017-01-02"), [], 100.0, 0, 0
    while k < days:
        day = first + d * DAY
        d += 1
        if (day // DAY + 3) % 7 >= 5:
            continue
        target = 100 + 4 * math.sin(2 * math.pi * k / 9) if k < 180 else prev + 1.5
        for h in range(7):
            o, c = prev + (target - prev) * h / 7, prev + (target - prev) * (h + 1) / 7
            rows.append({"t": day + 14 * H + 30 * 60000 + h * H, "o": o, "h": max(o, c) + 0.3, "l": min(o, c) - 0.3, "c": c, "delta": 0.0, "vol": 1000.0})
        prev, k = target, k + 1
    return rows


@pytest.fixture
def stock(tmp_path, monkeypatch):
    stocks, base, extra = tmp_path / "acciones", tmp_path / "base", tmp_path / "extra"
    for p in (stocks, base, extra):
        p.mkdir()
    rows = session_bars(800)
    with gzip.open(stocks / "AAA.json.gz", "wt", encoding="utf-8") as fh:
        json.dump({"symbol": "AAA", "15": rows, "60": rows, "240": rows[::4], "1440": rows[::7]}, fh)
    monkeypatch.setattr(rt, "STOCK_DIR", stocks)
    monkeypatch.setattr(rt, "CANDLE_DIR", base)
    monkeypatch.setattr(rt, "EXTRA_DIR", extra)
    monkeypatch.setattr(rt.fs, "coverage", lambda symbol: {"first": None, "last": None, "days": 0})
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path / "observer")
    rt._candles.clear()
    return rows


def test_las_acciones_son_su_propio_grupo_y_sus_velas_conservan_la_hora(stock):
    assert rt.candle_symbols("stocks") == ["AAA"] and rt.is_stock("AAA") and not rt.is_stock("BTCUSDT")
    assert "AAA" not in rt.candle_symbols("all")  # "todas" son las monedas: las acciones son otro mercado
    bars = rt.candle_bars("AAA", 60)
    assert len(bars) == len(stock)
    assert all(b["t"] % H == 30 * 60000 for b in bars)  # 09:30 de Nueva York: no se llevan a la hora en punto
    assert rt.phases("AAA")[0]["available"]
    assert not rt.has_store("AAA") and rt._on_candles("AAA", 60)
    assert rt.codes_for("AAA", 60) == set(rt.CANDLE_CODES) - {"LIQ"}


def test_la_noche_no_cierra_el_trade_y_una_apertura_mas_alla_se_llena_ahi(stock):
    bars = rt.candle_bars("AAA", 60)[:60]
    ctx = rt._context("AAA", 60, bars)
    ctx["minutes"] = None
    assert ctx["gap"] == rt.STOCK_GAP_MS and ctx["taker"] == rt.STOCK_FEE
    rule = rt.clean_rule({"tf": 60, "recipe": {"slots": [{"codes": ["IM"]}]}, "stop": {"type": "atr", "atr": 2, "maxAtr": 50}, "exit": {"targetR": 50}})
    # La señal en la última vela de un día: entra en la apertura del siguiente y sigue días después
    k = 6
    t = rt.simulate(rule, ctx, k, 1)
    assert t["entry_t"] == bars[7]["t"] and t.get("reason") != "hueco de datos"
    # Una apertura muy por debajo del stop: sale en la apertura, no en el stop
    gapped = [dict(b) for b in bars]
    for b in gapped[14:]:
        for key in ("o", "h", "l", "c"):
            b[key] -= 30
    ctx2 = rt._context("AAA", 60, gapped)
    ctx2["minutes"] = None
    t2 = rt.simulate(rule, ctx2, k, 1)
    assert t2["reason"] == "stop" and t2["exit"] == pytest.approx(gapped[14]["o"]) and t2["exit"] < t2["stop"]
    # El costo es el de las acciones: con una regla que gana 0, el R neto solo pierde el spread de entrada y salida
    assert rt.STOCK_FEE < rt.TAKER_FEE


def test_una_regla_con_liquidaciones_no_corre_en_acciones(stock):
    rule = {"tf": 60, "recipe": {"slots": [{"codes": ["LIQ"]}]}}
    res = rt.start("AAA", rule, 1)
    assert not res["success"] and "acción" in res["message"]
    plan = rt._plan(rt.clean_rule(rule), 1, "stocks")
    assert plan[0]["action"] == "skip" and "Barrido de liquidaciones" in plan[0]["reason"]


def test_el_tablero_pone_las_acciones_en_su_grupo_y_cuentan_como_comprobacion():
    item = {"key": "k", "name": "R", "names": ["R"], "rule": {}, "tf": 60, "lastAt": 0, "runs": 1,
            "cells": {"1": {"stocks": sb._pool([("AAA", {"n": 40, "sum": 8.0, "sumsq": 40.0, "wins": 20, "longN": 40, "longSum": 8.0,
                                                          "shortN": 0, "shortSum": 0.0, "years": {}, "quarters": {},
                                                          "base": {"avgR": 0.0, "seR": 0.01}, "leg": {"avgR": 0.0, "seR": 0.01}})])}}}
    cells = sb._cells(item)
    assert cells[0][1] == "stocks" and cells[0][3] is True


def test_el_regimen_medido_en_1d_vale_en_acciones_y_cada_vela_usa_el_dia_de_sesion_anterior(stock):
    # Una acción no tiene 24 horas de velas por día: antes ningún día contaba como completo y el filtro descartaba todo
    bars = range_then_trend()
    reg = {"mode": "inside", "major": False, "majorOut": 6, "after": 6, "tf": 1440}
    mask = rt.regime_mask(reg, bars, session=True)
    assert mask.any() and not mask.all()
    days = [b["t"] // DAY for b in bars]
    assert not mask[:7].any()  # El primer día no tiene un día anterior
    assert all(mask[i] == mask[i - 1] for i in range(1, len(bars)) if days[i] == days[i - 1])  # Todo el día usa el anterior
    # Sin futuro: cortar las velas a mitad de un día no cambia lo ya conocido
    cut = 7 * 150 + 3
    assert (rt.regime_mask(reg, bars[:cut], session=True) == mask[:cut]).all()
    # La regla y sus controles lo usan en las acciones
    rule = rt.clean_rule({"tf": 60, "recipe": {"slots": [{"codes": ["IM"]}]}, "regime": reg})
    assert (rt._control_context("AAA", rule, {"bars": bars})["regimeOK"] == mask).all()


def test_las_corridas_de_acciones_que_toco_el_fallo_del_regimen_no_se_reusan(stock):
    path = rt._runs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    daily = {"regime": {"mode": "outside", "tf": 1440}}
    records = [
        {"id": "antes", "symbol": "AAA", "tf": 240, "phase": 1, "hash": "h", "rule": daily},               # con el fallo: no cuenta
        # Desde el motor 6 (22/11/2026) solo cuentan las de ese motor
        {"id": "despues", "symbol": "AAA", "tf": 240, "phase": 1, "hash": "h", "rule": daily, "engine": rt.ENGINE},
        {"id": "moneda", "symbol": "BTCUSDT", "tf": 240, "phase": 1, "hash": "h", "rule": daily, "engine": rt.ENGINE},
        {"id": "sin", "symbol": "AAA", "tf": 240, "phase": 1, "hash": "g", "rule": {}, "engine": rt.ENGINE},
        {"id": "diaria", "symbol": "AAA", "tf": 1440, "phase": 1, "hash": "k", "rule": daily, "engine": rt.ENGINE},
        {"id": "vieja", "symbol": "BTCUSDT", "tf": 240, "phase": 1, "hash": "h", "rule": daily, "engine": 5},
    ]
    path.write_text("".join(json.dumps(r) + chr(10) for r in records), encoding="utf-8")
    assert [r["id"] for r in rt.history()] == ["despues", "moneda", "sin", "diaria"]
