"""Elementos de Orderflows Unlocked. Uso: python -m pytest tests/test_of_elements.py"""
import datetime as dt

import numpy as np
import pytest

import footprint_store as fs
import of_elements as oe


def facts(ask, bid, o, c):
    return oe.bar_facts(np.array(ask, float), np.array(bid, float), o, c)


def test_step_de_analisis_redondo_y_multiplo_de_la_celda():
    assert oe.analysis_step(80000, 15, 1.0) == 10
    assert oe.analysis_step(80000, 60, 1.0) == 20
    assert oe.analysis_step(80000, 240, 1.0) == 50
    # Con celda de 0.2 no sale 2.4 ni 2.5: queda un valor de 1, 2 o 5
    assert oe.analysis_step(20000, 15, 0.2) == 2


def test_exhaustion_y_zero_se_miden_en_el_lado_pasivo_del_inicio():
    # Vela verde: el mínimo es el inicio y su lado pasivo es la venta (bid)
    f = facts(ask=[0, 40, 50, 60, 70], bid=[2, 30, 30, 30, 30], o=100, c=104)
    assert f["col"] == 1
    assert f["exh"] == pytest.approx(2 / f["meanlv"])
    assert not f["zero"]
    # Vela roja: el inicio es el máximo y su lado pasivo es la compra (ask) del nivel más alto
    f = facts(ask=[30, 30, 30, 30, 0], bid=[70, 60, 50, 40, 9], o=104, c=100)
    assert f["col"] == -1
    assert f["zero"]
    assert f["exh"] is None


def test_delta_tail_extremo_contrario_y_el_resto_a_favor():
    assert facts(ask=[0, 47, 27, 68], bid=[2, 10, 3, 26], o=1, c=4)["tail"]
    assert not facts(ask=[0, 47, 1, 68], bid=[2, 10, 3, 26], o=1, c=4)["tail"]


def test_retail_suck_decrece_desde_el_extremo():
    f = facts(ask=[10, 10, 10, 10, 10], bid=[584, 271, 258, 5, 5], o=1, c=5)
    assert f["suck"] == pytest.approx(584 / f["meanlv"])
    assert facts(ask=[10] * 5, bid=[17, 64, 207, 5, 5], o=1, c=5)["suck"] is None


def test_sequencing_cuenta_niveles_crecientes_desde_el_inicio():
    assert facts(ask=[41, 42, 81, 98, 193, 528], bid=[9] * 6, o=1, c=6)["seq"] == 6
    assert facts(ask=[41, 30, 81, 98], bid=[9] * 4, o=1, c=4)["seq"] == 1


def test_barrido_son_niveles_interiores_casi_sin_contrapartida():
    f = facts(ask=[5, 24, 10, 20, 50, 5], bid=[7, 0, 0, 0, 40, 5], o=1, c=6)
    assert f["sweep"] == (3, 1, 3)


def test_inverse_desequilibrios_contrarios_en_la_mitad_lejana():
    # Vela verde con dos ventas apiladas arriba: bid(p) >= 4 x ask(p+1)
    f = facts(ask=[20, 20, 20, 20, 10, 50], bid=[5, 5, 5, 5, 55, 235], o=1, c=6)
    # Nivel 4: venta 55 contra compra 50 de arriba no alcanza; nivel 3: 5 contra 10 tampoco.
    assert f["inverse"][0] == 0
    f = facts(ask=[20, 20, 20, 2, 10, 50], bid=[5, 5, 5, 55, 235, 300], o=1, c=6)
    assert f["inverse"][0] >= 2


def test_acumulacion_mayor_celda_pasiva_en_el_tercio_del_inicio():
    f = facts(ask=[20, 98, 60, 60, 60, 60], bid=[90, 158, 20, 20, 20, 20], o=1, c=6)
    assert f["accdist"][1] == 1
    assert facts(ask=[20, 98, 60, 60, 60, 60], bid=[90, 20, 20, 20, 158, 20], o=1, c=6)["accdist"] is None


def test_desequilibrios_apilados_reversal_decline_thin_y_ratio():
    # Vela verde: compra del nivel contra venta del nivel inferior, 4x o más
    f = facts(ask=[5, 40, 40, 40, 0, 30], bid=[9, 2, 1, 1, 5, 20], o=1, c=6)
    # Niveles 1, 2 y 3 seguidos, y el 5 suelto (30 contra 5): tres apilados y cuatro en total
    assert f["stacked"][0] == 3 and f["imb_count"] == 4
    assert f["thin_rows"] == []
    # Venta del inicio contra la compra del nivel de arriba: desequilibrio contrario en el mínimo
    f = facts(ask=[5, 5, 30, 30, 30, 30], bid=[60, 3, 2, 1, 0, 9], o=1, c=6)
    assert f["reversal_rows"] == [0]
    assert f["decline"] is False  # El pasivo baja al alejarse del inicio: es Retail Suck, no Volume Decline
    f = facts(ask=[5, 10, 30, 30, 30], bid=[2, 4, 8, 0, 9], o=1, c=5)
    assert f["decline"] is True
    assert f["thin_rows"] == [3]
    assert f["ratio"] is False  # 4 / 2 = 2: entre 0.70 y 30
    assert facts(ask=[5, 10, 30], bid=[10, 3, 8], o=1, c=3)["ratio"] is True  # 3 / 10 = 0.3


def test_area_de_valor_crece_de_a_un_nivel():
    # Total 73, 70% = 51.1: al POC (50) se suma el vecino mayor, 10 abajo, y ya alcanza
    poc, lo, hi = oe._value_area(np.array([1, 2, 10, 50, 9, 1, 0], float))
    assert (poc, lo, hi) == (3, 2, 3)
    poc, lo, hi = oe._value_area(np.array([1, 2, 10, 50, 12, 1, 0], float))
    assert (poc, lo, hi) == (3, 3, 4)


# ---------------- Almacén sintético: sin futuro ----------------

SYMBOL = "TESTELEMENTS"
DAY0 = dt.date(2026, 3, 1)


def _write_day(root, day, rng, price):
    """Un día de minutos con celdas de 1 USD, en el formato de build_store.py."""
    ps, qs, ticks = 10, 1000, 10
    start = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp()) // 60
    m, o, h, l, c, buy, sell, n, cr, cl, cb, cs, cn = ([] for _ in range(13))
    for k in range(1440):
        drift = rng.normal(0, 6)
        lo_p, hi_p = sorted((price, price + drift))
        lo_p -= abs(rng.normal(0, 3)); hi_p += abs(rng.normal(0, 3))
        levels = np.arange(int(lo_p), int(hi_p) + 1)
        b = rng.integers(0, 4000, len(levels)); s = rng.integers(0, 4000, len(levels))
        m.append(start + k); o.append(int(price * ps)); c.append(int((price + drift) * ps))
        h.append(int(hi_p * ps)); l.append(int(lo_p * ps))
        buy.append(int(b.sum())); sell.append(int(s.sum())); n.append(len(levels) * 3)
        cr += [k] * len(levels); cl += levels.tolist(); cb += b.tolist(); cs += s.tolist(); cn += [3] * len(levels)
        price += drift
    path = root / SYMBOL / str(day.year) / f"{SYMBOL}_{day.isoformat()}.npz"
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, m=np.array(m, np.int64), o=np.array(o), h=np.array(h), l=np.array(l), c=np.array(c),
                        buy=np.array(buy), sell=np.array(sell), n=np.array(n, np.int32), cr=np.array(cr, np.int32),
                        cl=np.array(cl, np.int64), cb=np.array(cb, np.int64), cs=np.array(cs, np.int64),
                        cn=np.array(cn, np.int32), info=np.array([ps, qs, ticks], np.int64))
    return price


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    root = tmp_path_factory.mktemp("store")
    rng = np.random.default_rng(7)
    price = 80000.0
    for k in range(34):
        price = _write_day(root, DAY0 + dt.timedelta(days=k), rng, price)
    old = fs.STORE_DIR
    fs.STORE_DIR = root
    fs._days.clear(); oe._cache.clear()
    yield root
    fs.STORE_DIR = old
    fs._days.clear(); oe._cache.clear()


def _ms(day, hour=0):
    return int(dt.datetime(day.year, day.month, day.day, hour, tzinfo=dt.timezone.utc).timestamp()) * 1000


def _key(e):
    return (e["code"], e["dir"], e["t"], e["lo"], e["hi"])


def test_lo_conocido_no_cambia_al_avanzar_la_hora(store):
    day = DAY0 + dt.timedelta(days=32)
    start, end = _ms(day), _ms(day + dt.timedelta(days=1))
    cut = _ms(day, 12)
    full = oe.detect(SYMBOL, 15, start, end, end, band_days=0)
    early = oe.detect(SYMBOL, 15, start, end, cut, band_days=0)
    assert not full["warming"] and early["events"]
    known_full = {_key(e) for e in full["events"] if e["known"] <= cut}
    assert {_key(e) for e in early["events"]} == known_full
    assert all(e["known"] <= cut for e in early["events"])
    assert all(b["t"] + 15 * 60000 <= cut for b in early["bars"])


def test_frecuencia_cerca_del_objetivo(store):
    day = DAY0 + dt.timedelta(days=31)
    r = oe.detect(SYMBOL, 15, _ms(day), _ms(day + dt.timedelta(days=2)), _ms(day + dt.timedelta(days=2)), target=0.05, band_days=0)
    n = len(r["bars"])
    for code in ("DV", "AD", "OG"):
        share = sum(e["code"] == code for e in r["events"]) / n
        assert share < 0.15, (code, share)


def test_filtro_de_volumen_solo_deja_velas_de_mucho_volumen(store):
    day = DAY0 + dt.timedelta(days=31)
    start, end = _ms(day), _ms(day + dt.timedelta(days=2))
    every = oe.detect(SYMBOL, 15, start, end, end, band_days=0, vol_filter=0)
    strict = oe.detect(SYMBOL, 15, start, end, end, band_days=0, vol_filter=1.2)
    count = lambda r: sum(e["code"] in oe.VOLUME_FILTERED for e in r["events"])
    assert count(every) > count(strict)
    # Lo que queda con filtro también estaba sin él, y los demás elementos no cambian
    keys = lambda r, filtered: {_key(e) for e in r["events"] if (e["code"] in oe.VOLUME_FILTERED) == filtered}
    assert keys(strict, True) <= keys(every, True)
    assert keys(strict, False) == keys(every, False)
    assert all(e["value"] >= 1.2 for e in strict["events"] if e["code"] in oe.VOLUME_FILTERED and e["code"] != "VI")


def test_sin_historia_avisa_y_no_marca_relativos(store):
    r = oe.detect(SYMBOL, 15, _ms(DAY0 + dt.timedelta(days=1)), _ms(DAY0 + dt.timedelta(days=2)), _ms(DAY0 + dt.timedelta(days=2)), band_days=0)
    assert r["warming"]
    assert not any(oe.CATALOG[e["code"]][2] for e in r["events"])
