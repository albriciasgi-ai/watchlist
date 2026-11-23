"""
Orden de las órdenes que se llenan en la misma vela (motor 5, F-04 del protocolo de pruebas, 21/11/2026).

Con limit u orden stop y una posición a la vez, el motor toma las señales por la vela del llenado. Si dos órdenes se
llenan en la misma vela, entra la que se llenó primero: por los minutos de la moneda o, sin ellos, por el recorrido
supuesto de la vela. Antes entraba la de la señal más vieja, que con limit suele estar más adentro y llenarse después.
Uso: python -m pytest tests/test_fill_order.py
"""
import numpy as np
import pytest

import rule_tester as rt

TF = 15
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}
FILL_BAR = 33


def flat(n=400, price=100.0):
    """Velas planas: abren y cierran en `price`, con medio punto de mecha a cada lado (ATR 1)."""
    return [{"t": k * MS, "o": price, "h": price + 0.5, "l": price - 0.5, "c": price, "delta": 0.0, "vol": 10.0} for k in range(n)]


def ev(bar, lo, hi, d=1):
    return {"code": "EX", "dir": d, "t": bar * MS, "known": (bar + 1) * MS, "lo": lo, "hi": hi}


def rule(entry, **kw):
    base = {"name": "R", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1},
            "entry": entry, "stop": {"type": "atr", "atr": 3.0, "minAtr": 0, "maxAtr": 100},
            "exit": {"targetR": None, "horizon": 3}}
    base.update(kw)
    return rt.clean_rule(base)


def go(bars, events, r, monkeypatch, minutes_of_fill_bar=None):
    """minutes_of_fill_bar: [(alto, bajo), ...] de los minutos de la vela del llenado; las demás velas, sin minutos."""
    first = FILL_BAR * TF

    def minutes(symbol, a, b):
        if minutes_of_fill_bar is None or a != first:
            return None
        rows = minutes_of_fill_bar
        return {"m": np.arange(first, first + len(rows)), "h": np.array([h for h, _ in rows]), "l": np.array([l for _, l in rows])}

    monkeypatch.setattr(rt.fs, "minutes", minutes)
    return rt.run("TEST", r, {"bars": bars, "events": events}, PHASE, None, base=False)


def two_limits():
    """Dos largos con limit en el borde cercano: la señal 30 en 98.5 (más adentro) y la 31 en 99.4 (más cerca).
    En la vela 33 el precio baja a 98.3 y las cruza a las dos."""
    bars = flat()
    bars[FILL_BAR].update(o=100.0, h=100.5, l=98.3, c=99.0)
    events = [ev(30, 98.0, 98.5), ev(31, 99.0, 99.4)]
    return bars, events, rule({"type": "limit", "at": "near", "expiry": 5})


def test_con_minutos_entra_la_limit_que_se_lleno_primero(monkeypatch):
    bars, events, r = two_limits()
    # Minuto 0: baja a 99.3 (llena la de 99.4). Minuto 1: baja a 98.3 (llena la de 98.5)
    result = go(bars, events, r, monkeypatch, [(100.2, 99.3), (99.6, 98.3)])
    assert [t["entry"] for t in result["trades"]] == [99.4]
    assert result["trades"][0]["signal"] == 31 * MS and result["busy"] == 1
    assert "fill_t" not in result["trades"][0]


def test_sin_minutos_decide_el_recorrido_supuesto(monkeypatch):
    bars, events, r = two_limits()
    # Apertura 100, máximo 100.5, mínimo 98.3: en el tramo que baja del máximo al mínimo, 99.4 llega antes que 98.5
    result = go(bars, events, r, monkeypatch)
    assert [t["entry"] for t in result["trades"]] == [99.4]


def test_en_el_mismo_minuto_va_primero_la_senal_mas_vieja(monkeypatch):
    bars, events, r = two_limits()
    # Un solo minuto cruza las dos: no se sabe cuál fue antes y empatan
    result = go(bars, events, r, monkeypatch, [(100.2, 98.3)])
    assert [t["entry"] for t in result["trades"]] == [98.5]


def test_ordenes_stop_entra_la_que_se_lleno_primero(monkeypatch):
    bars = flat()
    bars[FILL_BAR].update(o=100.0, h=101.8, l=99.8, c=101.6)
    # Largos con orden stop en el borde de la zona: la señal 30 en 101.5 y la 31 en 100.8
    events = [ev(30, 101.0, 101.5), ev(31, 100.3, 100.8)]
    r = rule({"type": "stop", "offset": 0.0, "expiry": 5, "cancel": False})
    result = go(bars, events, r, monkeypatch, [(100.9, 100.0), (101.8, 100.7)])
    assert result["skipped"] == {}, result["skipped"]
    assert [t["entry"] for t in result["trades"]] == [100.8]
    assert result["trades"][0]["order"] == "stop"


def test_sin_una_posicion_a_la_vez_entran_las_dos(monkeypatch):
    bars, events, _ = two_limits()
    r = rule({"type": "limit", "at": "near", "expiry": 5}, oneAtATime=False)
    result = go(bars, events, r, monkeypatch, [(100.2, 99.3), (99.6, 98.3)])
    assert sorted(t["entry"] for t in result["trades"]) == [98.5, 99.4]
    assert all("fill_t" not in t for t in result["trades"])


@pytest.mark.parametrize("engine, entry, one, stale", [
    (4, "limit", True, True), (4, "stop", True, True), (4, "straddle", True, True),
    # Desde el motor 6 (22/11/2026) ninguna anterior se reusa: tampoco a mercado, sin una posición a la vez o del motor 5
    (4, "market", True, True), (4, "limit", False, True), (5, "limit", True, True),
    (6, "limit", True, False), (6, "market", True, False),
])
def test_corridas_anteriores_con_ordenes_que_esperan_quedan_fuera(engine, entry, one, stale):
    record = {"engine": engine, "symbol": "BTCUSDT", "tf": 240,
              "rule": {"entry": {"type": entry}, "oneAtATime": one, "recipe": {"slots": [{"codes": ["FV"]}]}}}
    assert rt._stale(record) is stale
