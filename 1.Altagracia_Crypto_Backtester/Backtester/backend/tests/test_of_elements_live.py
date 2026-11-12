"""Elementos OF con los dias de la nube y el PC (live=True). Uso: python -m pytest tests/test_of_elements_live.py

App 1 usa live=False (por defecto): todo queda como antes. La app en tiempo real usa live=True.
"""
import datetime as dt
import json
import os

import numpy as np
import pytest

import footprint_store as fs
import of_elements as oe
import of_setups as osu
from tests.test_of_elements import SYMBOL, _write_day

DAY0 = dt.date(2026, 3, 1)
OFFICIAL_DAYS = 32                      # DAY0 .. DAY0+31 oficiales; DAY0+32 solo en la nube
LIVE_DAY = DAY0 + dt.timedelta(days=OFFICIAL_DAYS)


def _ms(day, hour=0):
    return int(dt.datetime(day.year, day.month, day.day, hour, tzinfo=dt.timezone.utc).timestamp()) * 1000


def _state(live_root, day, **info):
    path = live_root.parent / "tape" / SYMBOL / str(day.year) / f"{SYMBOL}_{day.isoformat()}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    base = {"day": day.isoformat(), "gaps": [], "covered_from": _ms(day), "complete": True, "final": True,
            "saved_at": _ms(day + dt.timedelta(days=1))}
    base.update(info)
    path.write_text(json.dumps(base), encoding="utf-8")


def _flow(root, day, store_root):
    with np.load(store_root / SYMBOL / str(day.year) / f"{SYMBOL}_{day.isoformat()}.npz") as z:
        minutes = z["m"]
    path = root / SYMBOL / str(day.year) / f"{SYMBOL}_{day.isoformat()}.npz"
    path.parent.mkdir(parents=True, exist_ok=True)
    zeros = np.zeros(len(minutes), np.int64)
    np.savez(path, m=minutes, dmx=zeros, dmn=zeros, ot=np.zeros(0, np.int64), os=np.zeros(0, np.int8),
             oq=np.zeros(0, np.int64), op0=np.zeros(0, np.int64), op1=np.zeros(0, np.int64), on=np.zeros(0, np.int32),
             info=np.array([10, 1000, 1, 4]))


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    store = tmp_path / "store"
    live = tmp_path / "live" / "store"
    rng = np.random.default_rng(11)
    price = 80000.0
    for k in range(OFFICIAL_DAYS):
        price = _write_day(store, DAY0 + dt.timedelta(days=k), rng, price)
    _write_day(live, LIVE_DAY, rng, price)
    _state(live, LIVE_DAY)
    monkeypatch.setattr(fs, "STORE_DIR", store)
    monkeypatch.setattr(fs, "LIVE_DIR", live)
    monkeypatch.setattr(fs, "USE_LIVE", False)
    monkeypatch.setattr(oe, "FLOW_DIR", tmp_path / "flow")
    monkeypatch.setattr(oe, "LIVE_FLOW_DIR", None)
    fs._days.clear(); oe._cache.clear()
    yield store, live
    fs._days.clear(); oe._cache.clear()


def _detect(live, **kw):
    start, end = _ms(LIVE_DAY), _ms(LIVE_DAY + dt.timedelta(days=1))
    return oe.detect(SYMBOL, 15, start, end, end, band_days=0, live=live, **kw)


def test_por_defecto_no_lee_la_nube(dirs):
    r = oe.detect(SYMBOL, 15, _ms(LIVE_DAY), _ms(LIVE_DAY + dt.timedelta(days=1)), _ms(LIVE_DAY + dt.timedelta(days=1)), band_days=0)
    assert r["bars"] == [] and r["events"] == []


def test_con_live_lee_el_dia_de_la_nube_con_umbrales_de_los_oficiales(dirs):
    r = _detect(True)
    assert len(r["bars"]) == 96 and r["events"]
    assert not r["warming"]  # los 30 dias anteriores son oficiales


def test_flujo_de_la_nube_desde_live_flow(dirs):
    store, live = dirs
    assert all(b["maxd"] is None for b in _detect(True)["bars"])
    _flow(live.parent / "flow", LIVE_DAY, live)
    oe._cache.clear()
    assert all(b["maxd"] is not None for b in _detect(True)["bars"])


def test_velas_que_tocan_un_hueco_no_cuentan(dirs):
    _, live = dirs
    _state(live, LIVE_DAY, gaps=[[_ms(LIVE_DAY, 6), _ms(LIVE_DAY, 6) + 60_000]])
    os.utime(live / SYMBOL / str(LIVE_DAY.year) / f"{SYMBOL}_{LIVE_DAY.isoformat()}.npz", (1, 1))  # se relee el dia
    bars = _detect(True)["bars"]
    assert len(bars) == 95
    assert _ms(LIVE_DAY, 6) not in {b["t"] for b in bars}


def test_lo_que_pasa_del_ultimo_guardado_no_esta_cerrado(dirs):
    _, live = dirs
    _state(live, LIVE_DAY, final=False, complete=False, saved_at=_ms(LIVE_DAY, 12) + 7 * 60_000)
    os.utime(live / SYMBOL / str(LIVE_DAY.year) / f"{SYMBOL}_{LIVE_DAY.isoformat()}.npz", (2, 2))
    bars = _detect(True)["bars"]
    assert bars and max(b["t"] for b in bars) + 15 * 60_000 <= _ms(LIVE_DAY, 12) + 7 * 60_000
    assert len(bars) == 48


def test_el_dia_oficial_manda(dirs):
    store, live = dirs
    with_cloud = _detect(True)
    rng = np.random.default_rng(99)
    _write_day(store, LIVE_DAY, rng, 50000.0)  # aparece el oficial, con otros precios
    fs._days.clear()
    official = _detect(True)
    assert official["bars"] and official["bars"][0]["o"] != with_cloud["bars"][0]["o"]
    assert official["bars"] == _detect(False)["bars"]


def test_dia_de_la_nube_se_recalcula_si_cambia(dirs):
    _, live = dirs
    first = _detect(True)["bars"]
    rng = np.random.default_rng(5)
    _write_day(live, LIVE_DAY, rng, 60000.0)
    path = live / SYMBOL / str(LIVE_DAY.year) / f"{SYMBOL}_{LIVE_DAY.isoformat()}.npz"
    os.utime(path, (3, 3))
    assert _detect(True)["bars"][0]["o"] != first[0]["o"]


def test_un_dia_que_falta_con_live_no_queda_guardado_vacio(dirs):
    store, live = dirs
    missing = LIVE_DAY + dt.timedelta(days=1)
    end = _ms(missing + dt.timedelta(days=1))
    assert oe.detect(SYMBOL, 15, _ms(missing), end, end, band_days=0, live=True)["bars"] == []
    _write_day(live, missing, np.random.default_rng(3), 80000.0)
    _state(live, missing)
    assert len(oe.detect(SYMBOL, 15, _ms(missing), end, end, band_days=0, live=True)["bars"]) == 96


def test_app1_sin_cambios_en_dias_oficiales(dirs):
    day = DAY0 + dt.timedelta(days=31)
    args = (SYMBOL, 15, _ms(day), _ms(day + dt.timedelta(days=1)), _ms(day + dt.timedelta(days=1)))
    off = oe.detect(*args, band_days=0)
    oe._cache.clear(); fs._days.clear()
    on = oe.detect(*args, band_days=0, live=True)
    assert off == on and off["bars"]


def test_setups_pasan_live(dirs, monkeypatch):
    seen = {}
    real = oe.detect

    def spy(*a, **kw):
        seen.update(kw)
        return real(*a, **kw)

    monkeypatch.setattr(oe, "detect", spy)
    end = _ms(LIVE_DAY + dt.timedelta(days=1))
    osu.setups(SYMBOL, 15, _ms(LIVE_DAY), end, end, [{"id": "x", "slots": [{"codes": ["DV"]}], "mode": "strict"}], live=True)
    assert seen.get("live") is True
    seen.clear()
    osu.setups(SYMBOL, 15, _ms(LIVE_DAY), end, end, [{"id": "x", "slots": [{"codes": ["DV"]}], "mode": "strict"}])
    assert "live" not in seen
