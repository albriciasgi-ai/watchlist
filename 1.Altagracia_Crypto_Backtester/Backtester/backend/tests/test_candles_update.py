"""Descargador de velas de las monedas nuevas (protocolo de pruebas, F-02 y F-03, 22/11/2026).
Uso: python -m pytest tests/test_candles_update.py"""
import time

import candles_update as cu

STEP = 3600000  # 1 hora


class FakeBybit:
    """Como /v5/market/kline: las velas de [start, end], las `limit` más recientes, de la más nueva a la más vieja.
    errors: cuántas respuestas con retCode de error ("Too many visits") da antes de responder bien."""

    def __init__(self, first, errors=0):
        self.first, self.errors, self.calls = first, errors, 0

    def get(self, url, params):
        self.calls += 1
        if self.errors:
            self.errors -= 1
            return Resp({"retCode": 10006, "retMsg": "Too many visits", "result": {}})
        step = int(params["interval"]) * 60000
        now = int(time.time() * 1000)
        start = max(params["start"], self.first)
        end = min(params["end"], now)
        times = list(range(start - (start - self.first) % step if start > self.first else self.first, end + 1, step))
        times = [t for t in times if params["start"] <= t <= params["end"]][-params["limit"]:]
        rows = [[str(t), "1", "2", "0.5", "1.5", str(t % 997)] for t in reversed(times)]
        return Resp({"retCode": 0, "result": {"list": rows}})


class Resp:
    def __init__(self, body):
        self.body = body

    def json(self):
        return self.body


def hour(ms):
    return ms - ms % STEP


def test_las_paginas_no_pierden_su_primera_vela():
    """F-02: cada pedido iba de start a start + 1,000 velas (1,001) y Bybit devolvía las 1,000 más recientes."""
    now = hour(int(time.time() * 1000))
    first = now - 2600 * STEP
    rows = {}
    cu._fetch("X", "60", rows, FakeBybit(first), start=first)
    times = sorted(rows)
    assert times[0] == first and len(times) == 2600
    assert all(b - a == STEP for a, b in zip(times, times[1:])), "sin huecos entre páginas"


def test_un_error_de_bybit_se_reintenta_y_no_salta_la_pagina(monkeypatch):
    """F-02: "Too many visits" llega como retCode, sin excepción; antes la página se saltaba entera."""
    monkeypatch.setattr(cu.time, "sleep", lambda s: None)
    now = hour(int(time.time() * 1000))
    first = now - 1500 * STEP
    rows = {}
    cu._fetch("X", "60", rows, FakeBybit(first, errors=2), start=first)
    assert len(rows) == 1500


def test_la_vela_en_formacion_no_se_guarda_y_la_ultima_se_vuelve_a_pedir():
    """F-03: la vela abierta al actualizar quedaba guardada a medio formar y no se volvía a pedir."""
    now = int(time.time() * 1000)
    last_closed = hour(now) - STEP
    half = [last_closed, 1.0, 2.0, 0.5, 1.2, 3.0]  # Guardada a medio formar: otro cierre y poco volumen
    rows = {last_closed - STEP: [last_closed - STEP, 1, 2, 0.5, 1.5, 9.0], last_closed: half}
    cu._fetch("X", "60", rows, FakeBybit(last_closed - 10 * STEP))
    assert rows[last_closed] != half and rows[last_closed][4] == 1.5, "la última guardada se volvió a pedir"
    assert hour(now) not in rows, "la vela en formación no se guarda"


def test_reparar_rellena_los_huecos(tmp_path, monkeypatch):
    monkeypatch.setattr(cu, "DIR", tmp_path)
    now = hour(int(time.time() * 1000))
    first = now - 50 * STEP
    full = {}
    cu._fetch("X", "60", full, FakeBybit(first), start=first)
    holed = {t: r for t, r in full.items() if t not in (first + 10 * STEP, first + 20 * STEP, first + 21 * STEP)}
    cu._save(cu._path("X", "60"), {"60": [holed[t] for t in sorted(holed)], "240": []})
    assert cu.gaps(holed, STEP) == [(first + 10 * STEP, first + 10 * STEP), (first + 20 * STEP, first + 21 * STEP)]
    assert cu.repair("X", "60", FakeBybit(first)) == 3
    saved = {r[0] for r in cu._load(cu._path("X", "60"))["60"]}
    assert saved == set(full)
