"""Dias de la nube en el lector del almacen. Uso: python -m pytest tests/test_footprint_live.py"""
import json
import os

import numpy as np
import pytest

import footprint_store as fs

DAY = "2026-11-12"
DAY_MS = 1794441600000  # 2026-11-12 00:00 UTC
DAY_MIN = DAY_MS // 60000


def write_day(path, minutes=60, qty=1000):
    """Un dia con un trade por minuto en una sola celda: precio 100.0, compra = qty / 1000."""
    path.parent.mkdir(parents=True, exist_ok=True)
    n = minutes
    m = np.arange(DAY_MIN, DAY_MIN + n, dtype=np.int64)
    price = np.full(n, 1000, dtype=np.int64)  # 100.0 con price_scale 10
    np.savez(
        path, m=m, o=price, h=price, l=price, c=price,
        buy=np.full(n, qty, dtype=np.int64), sell=np.zeros(n, dtype=np.int64), n=np.ones(n, dtype=np.int32),
        cr=np.arange(n, dtype=np.int32), cl=np.full(n, 100, dtype=np.int64),
        cb=np.full(n, qty, dtype=np.int64), cs=np.zeros(n, dtype=np.int64), cn=np.ones(n, dtype=np.int32),
        info=np.array([10, 1000, 10], dtype=np.int64),
    )


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    store = tmp_path / "store"
    live = tmp_path / "live" / "store"
    monkeypatch.setattr(fs, "STORE_DIR", store)
    monkeypatch.setattr(fs, "LIVE_DIR", live)
    monkeypatch.setattr(fs, "USE_LIVE", False)
    fs._days.clear()
    yield store, live
    fs._days.clear()


def live_day(live, gaps=(), covered_from=None, complete=False, qty=1000, saved_at=None, final=True):
    write_day(live / "BTCUSDT" / "2026" / f"BTCUSDT_{DAY}.npz", qty=qty)
    state = live.parent / "tape" / "BTCUSDT" / "2026" / f"BTCUSDT_{DAY}.json"
    state.parent.mkdir(parents=True, exist_ok=True)
    state.write_text(json.dumps({"day": DAY, "gaps": [list(g) for g in gaps],
                                 "covered_from": covered_from if covered_from is not None else DAY_MS,
                                 "complete": complete, "final": final,
                                 "saved_at": saved_at if saved_at is not None else DAY_MS + 86_400_000}),
                     encoding="utf-8")


def fps(**kw):
    return fs.footprints("BTCUSDT", 15, DAY_MS, DAY_MS + 3_600_000, **kw)


def test_apagado_por_defecto_no_lee_la_nube(dirs):
    _, live = dirs
    live_day(live)
    assert fps()["footprints"] == []
    assert fs.minutes("BTCUSDT", DAY_MIN, DAY_MIN + 60) is None


def test_encendido_lee_el_dia_de_la_nube_y_lo_marca(dirs):
    _, live = dirs
    live_day(live, complete=True)
    out = fps(live=True)
    assert [f["candle_timestamp"] for f in out["footprints"]] == [DAY_MS + i * 900_000 for i in range(4)]
    assert all(f["source"] == "live" and f["gap"] is False for f in out["footprints"])
    assert out["footprints"][0]["total_volume"] == 15.0
    assert out["live_days"] == [{"day": DAY, "complete": True, "until": None}]


def test_variable_de_entorno_lo_enciende(dirs, monkeypatch):
    _, live = dirs
    live_day(live)
    monkeypatch.setattr(fs, "USE_LIVE", True)
    assert len(fps()["footprints"]) == 4
    assert len(fps(live=False)["footprints"]) == 0


def test_velas_que_tocan_un_hueco_quedan_marcadas(dirs):
    _, live = dirs
    # Corte del minuto 10 al 20, con el dia grabado desde su inicio
    live_day(live, gaps=[[DAY_MS + 10 * 60000, DAY_MS + 20 * 60000]])
    gap = {f["candle_timestamp"]: f["gap"] for f in fps(live=True)["footprints"]}
    assert gap == {DAY_MS: True, DAY_MS + 900_000: True, DAY_MS + 1_800_000: False, DAY_MS + 2_700_000: False}


def test_grabacion_que_empezo_a_mitad_del_dia_cuenta_como_hueco(dirs):
    _, live = dirs
    live_day(live, covered_from=DAY_MS + 2 * 60000)
    gap = {f["candle_timestamp"]: f["gap"] for f in fps(live=True)["footprints"]}
    assert gap[DAY_MS] is True and gap[DAY_MS + 900_000] is False


def test_el_dia_oficial_manda(dirs):
    store, live = dirs
    live_day(live, qty=1000)
    write_day(store / "BTCUSDT" / "2026" / f"BTCUSDT_{DAY}.npz", qty=3000)
    out = fps(live=True)
    assert out["footprints"][0]["total_volume"] == 45.0
    assert "source" not in out["footprints"][0] and "live_days" not in out


def test_dia_de_la_nube_se_relee_si_cambia_el_archivo(dirs):
    _, live = dirs
    live_day(live, qty=1000)
    assert fps(live=True)["footprints"][0]["total_volume"] == 15.0
    path = live / "BTCUSDT" / "2026" / f"BTCUSDT_{DAY}.npz"
    write_day(path, qty=2000)
    st = os.stat(path)
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert fps(live=True)["footprints"][0]["total_volume"] == 30.0


def test_sin_estado_de_la_nube_no_inventa_huecos(dirs):
    _, live = dirs
    write_day(live / "BTCUSDT" / "2026" / f"BTCUSDT_{DAY}.npz")
    out = fps(live=True)
    assert all(f["source"] == "live" and f["gap"] is False for f in out["footprints"])
    assert out["live_days"] == [{"day": DAY, "complete": False, "until": None}]


def test_vela_que_pasa_del_ultimo_guardado_de_la_nube_queda_incompleta(dirs):
    _, live = dirs
    # Dia en curso guardado en la nube a las 00:31:20: la vela de 00:30 tiene solo parte de sus trades
    live_day(live, final=False, saved_at=DAY_MS + 31 * 60000 + 20_000)
    out = fps(live=True, known_until_ms=DAY_MS + 3_600_000)
    complete = {f["candle_timestamp"]: f["complete"] for f in out["footprints"]}
    assert complete[DAY_MS + 900_000] is True and complete[DAY_MS + 1_800_000] is False
    assert out["live_days"][0]["until"] == DAY_MS + 31 * 60000
