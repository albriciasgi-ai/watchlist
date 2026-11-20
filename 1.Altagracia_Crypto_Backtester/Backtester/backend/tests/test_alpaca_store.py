"""Acciones de Alpaca en App 1: almacén y flujo (alpaca_store.py) y su lectura (footprint_store, of_elements).

Sin conexión: trades armados a mano en carpetas temporales. Uso: python -m pytest tests/test_alpaca_store.py
"""
import datetime as dt

import numpy as np
import pytest

import alpaca_store as al
import footprint_store as fs
import of_elements as oe

SYM = "ZZZZ"
# 2026-11-16 (lunes): 09:30 de Nueva York = 14:30 UTC (horario de invierno)
OPEN_US = int(dt.datetime(2026, 11, 16, 14, 30, tzinfo=dt.timezone.utc).timestamp()) * 1_000_000
DAY_US = 86_400 * 1_000_000


def trades_of_day(day_offset, seed):
    """Un día con premarket, sesión regular y postmarket. Precios con fracciones de centavo y lados mezclados."""
    rng = np.random.default_rng(seed)
    base = OPEN_US + day_offset * DAY_US
    n = 6000
    # 1 h antes de abrir hasta 1 h después de cerrar
    t = np.sort(rng.integers(base - 3_600_000_000, base + int(7.5 * 3_600_000_000), n)).astype(np.int64)
    p = np.round(200 + np.cumsum(rng.normal(0, 0.01, n)), 4)
    s = rng.integers(1, 400, n).astype(np.float64)
    s[::17] += 0.5  # fracciones de acción
    side = rng.choice(np.array([-1, 1, 0], np.int8), n, p=[0.48, 0.48, 0.04])
    return {"t": t, "p": p, "s": s, "side": side, "complete": True}


@pytest.fixture
def stock(tmp_path, monkeypatch):
    store, flow = tmp_path / "alpaca" / "store", tmp_path / "alpaca" / "flow"
    monkeypatch.setattr(fs, "ALPACA_STORE_DIR", store)
    monkeypatch.setattr(fs, "STORE_DIR", tmp_path / "store")
    monkeypatch.setattr(oe, "ALPACA_FLOW_DIR", flow)
    monkeypatch.setattr(oe, "FLOW_DIR", tmp_path / "flow")
    fs._days.clear()
    oe._cache.clear()
    days = {}
    for k in range(3):
        day = (dt.date(2026, 11, 16) + dt.timedelta(days=k)).isoformat()
        days[day] = trades_of_day(k, 10 + k)
        al.write_day(SYM, day, days[day], store, flow)
    yield days
    fs._days.clear()
    oe._cache.clear()


def direct(trades, tf_min, step):
    """Footprint calculado a mano desde los trades de la sesión regular."""
    t, p, s, side = trades["t"], trades["p"], trades["s"], trades["side"]
    keep = al.rth_mask(t)
    t, p, s, side = t[keep], p[keep], s[keep], side[keep]
    out = {}
    for ti, pi, si, sd in zip(t.tolist(), p.tolist(), s.tolist(), side.tolist()):
        start = ti // 60_000_000 // tf_min * tf_min * 60_000
        cents = round(pi * 10_000) // 100  # celda de 0.01, hacia abajo
        level = cents // round(step / 0.01)
        q = round(si * 100)
        buy = q if sd > 0 else (q // 2 if sd == 0 else 0)
        c = out.setdefault(start, {"buy": 0, "sell": 0, "levels": {}, "o": pi, "h": pi, "l": pi, "c": pi})
        c["buy"] += buy
        c["sell"] += q - buy
        c["h"], c["l"], c["c"] = max(c["h"], pi), min(c["l"], pi), pi
        lv = c["levels"].setdefault(level, [0, 0])
        lv[0] += buy
        lv[1] += q - buy
    return out


@pytest.mark.parametrize("tf,step", [(1, 0.01), (5, 0.01), (15, 0.05), (60, 0.1)])
def test_footprint_igual_al_calculo_directo_de_los_trades(stock, tf, step):
    day = "2026-11-17"
    start_ms = (OPEN_US + DAY_US) // 1000
    end_ms = start_ms + 390 * 60_000
    got = fs.footprints(SYM, tf, start_ms, end_ms, step=step)
    want = direct(stock[day], tf, step)
    assert got["cell_size"] == pytest.approx(0.01)
    assert [f["candle_timestamp"] for f in got["footprints"]] == sorted(want)
    for f in got["footprints"]:
        w = want[f["candle_timestamp"]]
        assert f["candle_open"] == pytest.approx(w["o"]) and f["candle_close"] == pytest.approx(w["c"])
        assert f["candle_high"] == pytest.approx(w["h"]) and f["candle_low"] == pytest.approx(w["l"])
        assert f["total_volume"] == pytest.approx((w["buy"] + w["sell"]) / 100)
        assert f["delta"] == pytest.approx((w["buy"] - w["sell"]) / 100)
        levels = {round(lv["price_min"] / step): (lv["ask_volume"], lv["bid_volume"]) for lv in f["levels"]}
        for level, (b, s) in w["levels"].items():
            assert levels[level] == pytest.approx((b / 100, s / 100))
        assert sum(a + b for a, b in levels.values()) == pytest.approx((w["buy"] + w["sell"]) / 100)


def test_solo_la_sesion_regular_y_corte_en_la_hora_simulada(stock):
    start_ms = OPEN_US // 1000 - 3_600_000  # una hora antes de abrir
    got = fs.footprints(SYM, 15, start_ms, start_ms + 12 * 3_600_000)
    times = [f["candle_timestamp"] for f in got["footprints"]]
    assert times[0] == OPEN_US // 1000 and times[-1] == OPEN_US // 1000 + 375 * 60_000  # 09:30 a 15:45
    cut = OPEN_US // 1000 + 40 * 60_000
    partial = fs.footprints(SYM, 15, start_ms, start_ms + 12 * 3_600_000, known_until_ms=cut)["footprints"]
    assert [f["candle_timestamp"] for f in partial] == times[:3] and not partial[-1]["complete"]


def test_las_monedas_no_cambian(stock, tmp_path):
    assert fs.is_stock(SYM) and fs.store_root(SYM) == fs.ALPACA_STORE_DIR
    (fs.ALPACA_STORE_DIR / "BTCUSDT").mkdir(parents=True)  # ni con una carpeta ahí
    assert not fs.is_stock("BTCUSDT") and fs.store_root("BTCUSDT") == fs.STORE_DIR
    assert not fs.is_stock("TEST") and fs.store_root("TEST") == fs.STORE_DIR
    assert fs._day_path("BTCUSDT", "2026-11-17") == tmp_path / "store" / "BTCUSDT" / "2026" / "BTCUSDT_2026-11-17.npz"
    assert oe._flow_path("BTCUSDT", dt.date(2026, 11, 17)).parent.parent == tmp_path / "flow" / "BTCUSDT"
    assert fs.coverage(SYM) == {"first": "2026-11-16", "last": "2026-11-18", "days": 3}


def test_delta_dentro_del_minuto_exacto():
    t = OPEN_US + np.array([1, 2, 3, 4, 60_000_001, 60_000_002], np.int64)
    p = np.array([10.0, 10.01, 10.0, 9.99, 9.99, 10.0])
    s = np.array([5, 3, 9, 1, 4, 4], float)
    side = np.array([1, 1, -1, -1, 1, 0], np.int8)
    f = al.build_flow_day(t, p, s, side)
    # Minuto 1: +5, +8, -1, -2 → máx 8, mín -2. Minuto 2: +4, luego mitad y mitad → máx 4
    assert f["dmx"].tolist() == [800, 400] and f["dmn"].tolist() == [-200, 0]
    assert f["info"].tolist() == [10_000, 100, 1, 6]


def test_ordenes_juntan_trades_seguidos_del_mismo_lado():
    # Barrido de 3 precios en 0.6 ms (en varios mercados), y una compra grande sola 5 ms después
    t = OPEN_US + np.array([0, 300, 600, 5_600], np.int64)
    p = np.array([100.00, 100.01, 100.02, 100.02])
    s = np.array([400, 400, 400, 6000], float)
    side = np.array([1, 1, 1, 1], np.int8)
    f = al.build_flow_day(t, p, s, side)
    assert f["on"].tolist() == [3, 1]
    assert f["oq"].tolist() == [120_000, 600_000]
    assert f["op0"].tolist() == [1_000_000, 1_000_200] and f["op1"].tolist() == [1_000_200, 1_000_200]
    assert f["ot"].tolist() == [OPEN_US // 1000, (OPEN_US + 5_600) // 1000]
    # Un trade del otro lado corta la orden
    side2 = np.array([1, -1, 1, 1], np.int8)
    assert al.build_flow_day(t, p, s, side2)["on"].tolist() == [1]


def test_elementos_of_leen_el_flujo_de_las_acciones(stock):
    day = "2026-11-18"
    start_ms = (OPEN_US + 2 * DAY_US) // 1000
    end_ms = start_ms + 390 * 60_000
    res = oe.detect(SYM, 15, start_ms, end_ms, end_ms)
    bars = res["bars"]
    assert len(bars) == 26 and res["warming"]  # 3 días no alcanzan para los umbrales de 30 días
    # Máx y Mín Δ exactos de la primera vela, desde los trades
    tr = stock[day]
    k = al.rth_mask(tr["t"]) & (tr["t"] < OPEN_US + 2 * DAY_US + 15 * 60_000_000)
    q = np.round(tr["s"][k] * 100).astype(np.int64)
    sd = tr["side"][k]
    buy = np.where(sd > 0, q, np.where(sd == 0, q // 2, 0))
    cum = np.cumsum(buy - (q - buy)) / 100
    assert bars[0]["maxd"] == pytest.approx(max(0.0, cum.max()))
    assert bars[0]["mind"] == pytest.approx(min(0.0, cum.min()))
    assert bars[0]["delta"] == pytest.approx(cum[-1])
