"""Velas históricas de acciones (alpaca_candles.py), sin conexión. Uso: python -m pytest tests/test_alpaca_candles.py"""
import asyncio
import datetime as dt

import numpy as np
import pytest

import alpaca_candles as ac
from alpaca_store import _suite

ad = _suite()
UTC = dt.timezone.utc


def iso(y, m, d, h, mi):
    return dt.datetime(y, m, d, h, mi, tzinfo=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_rows(y, m, d, open_utc_h, seed, n_min=15):
    """Velas de 15 minutos de las 04:00 a las 20:00 de Nueva York (con premarket y postmarket)."""
    rng = np.random.default_rng(seed)
    start = dt.datetime(y, m, d, open_utc_h, 30, tzinfo=UTC) - dt.timedelta(hours=5, minutes=30)
    rows, price = [], 100.0
    for k in range(64):
        t = start + dt.timedelta(minutes=n_min * k)
        o = price
        c = round(o + rng.normal(0, 0.3), 2)
        rows.append({"t": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "o": o, "h": max(o, c) + 0.1, "l": min(o, c) - 0.1, "c": c,
                     "v": int(rng.integers(1000, 5000)), "n": int(rng.integers(10, 50)), "vw": round((o + c) / 2, 3)})
        price = c
    return rows


def test_solo_sesion_regular_y_velas_cerradas():
    rows = day_rows(2026, 11, 18, 14, 1)  # invierno: 09:30 de NY = 14:30 UTC
    out = ac.rth_rows(rows, ad, end_ms=10**15)
    hours = [dt.datetime.fromtimestamp(r[0] / 1000, UTC).strftime("%H:%M") for r in out]
    assert len(out) == 26 and hours[0] == "14:30" and hours[-1] == "20:45"
    cut = int(dt.datetime(2026, 11, 18, 15, 10, tzinfo=UTC).timestamp() * 1000)  # 15:00 sin cerrar
    assert len(ac.rth_rows(rows, ad, end_ms=cut)) == 2
    summer = ac.rth_rows(day_rows(2026, 7, 15, 13, 2), ad, end_ms=10**15)  # verano: 13:30 UTC
    assert dt.datetime.fromtimestamp(summer[0][0] / 1000, UTC).strftime("%H:%M") == "13:30" and len(summer) == 26


def test_marcos_mayores_desde_la_apertura_de_nueva_york():
    base = ac.rth_rows(day_rows(2026, 11, 18, 14, 3) + day_rows(2026, 11, 19, 14, 4), ad, end_ms=10**15)
    a = np.array(base)
    h1 = ac.aggregate(base, 60, ad)
    hm = [dt.datetime.fromtimestamp(r[0] / 1000, UTC).strftime("%d %H:%M") for r in h1]
    assert hm[:7] == ["18 14:30", "18 15:30", "18 16:30", "18 17:30", "18 18:30", "18 19:30", "18 20:30"] and len(h1) == 14
    h4 = ac.aggregate(base, 240, ad)
    assert [dt.datetime.fromtimestamp(r[0] / 1000, UTC).strftime("%d %H:%M") for r in h4] == \
        ["18 14:30", "18 18:30", "19 14:30", "19 18:30"]
    d1 = ac.aggregate(base, 1440, ad)
    assert len(d1) == 2
    first = a[:26]
    o, h, l, c, v = d1[0][1:6]
    assert (o, h, l, c) == (first[0, 1], first[:, 2].max(), first[:, 3].min(), first[-1, 4])
    assert v == first[:, 5].sum() and d1[0][6] == first[:, 6].sum()
    assert d1[0][7] == pytest.approx((first[:, 7] * first[:, 5]).sum() / v, abs=1e-4)
    # La última vela de 1 h dura 30 minutos (15:30 a 16:00) y la segunda de 4 h, 2.5 horas
    assert h1[6][5] == first[-2:, 5].sum() and h4[1][5] == first[16:, 5].sum()


class FakeAlpaca:
    """El conector con la descarga reemplazada: sirve las velas de un diccionario por fecha."""

    def __init__(self, days):
        self.days, self.calls = days, []

    def install(self, monkeypatch):
        async def pages(base, path, params, key):
            self.calls.append(params["start"])
            start = ad.ts_us(params["start"]) // 1000
            yield [r for rows in self.days.values() for r in rows if ad.ts_us(r["t"]) // 1000 >= start]
        monkeypatch.setattr(ad, "_pages", pages)
        monkeypatch.setattr(ad, "feed", lambda: "sip")


def test_actualizar_suma_lo_nuevo_y_rehace_si_cambio_el_ajuste(tmp_path, monkeypatch):
    monkeypatch.setattr(ac, "DIR", tmp_path)
    days = {d: day_rows(2026, 10, d, 13, d) for d in (13, 14, 15)}
    fake = FakeAlpaca(days)
    fake.install(monkeypatch)
    first = asyncio.run(ac.update("ZZZZ", ad))
    assert len(first["1440"]) == 3 and len(first["15"]) == 78 and fake.calls[0].startswith("2016-01-01")
    days[16] = day_rows(2026, 10, 16, 13, 16)
    second = asyncio.run(ac.update("ZZZZ", ad))
    assert len(second["1440"]) == 4 and not fake.calls[-1].startswith("2016") and second["15"][:78] == first["15"]
    for rows in days.values():  # un split: todos los precios anteriores cambian
        for r in rows:
            r["c"] = round(r["c"] / 2, 4)
    third = asyncio.run(ac.update("ZZZZ", ad))
    assert fake.calls[-1].startswith("2016-01-01") and third["15"][0][4] == pytest.approx(first["15"][0][4] / 2)


def test_cierre_temprano_y_feriado_con_el_calendario():
    rows = day_rows(2025, 11, 28, 14, 5) + day_rows(2025, 11, 27, 14, 6)  # viernes tras Acción de Gracias y el feriado
    cal = {"2025-11-28": (570, 780)}  # 09:30 a 13:00; el 27 no está: feriado
    out = ac.rth_rows(rows, ad, end_ms=10**15, cal=cal)
    hours = [dt.datetime.fromtimestamp(r[0] / 1000, UTC).strftime("%d %H:%M") for r in out]
    assert len(out) == 14 and hours[0] == "28 14:30" and hours[-1] == "28 17:45"
    assert len(ac.rth_rows(rows, ad, end_ms=10**15)) == 52  # sin calendario se colaba el horario extendido


def test_dias_casi_vacios_quedan_como_hueco():
    full = ac.rth_rows(day_rows(2026, 10, 13, 13, 7), ad, end_ms=10**15)
    thin = ac.rth_rows(day_rows(2026, 10, 14, 13, 8), ad, end_ms=10**15)[:1]
    cal = {"2026-10-13": (570, 960), "2026-10-14": (570, 960)}
    kept, gone = ac.drop_thin_days(full + thin, ad, cal)
    assert kept == full and gone == ["2026-10-14"]
    assert len(ac.aggregate(kept, 1440, ad)) == 1


def test_ticker_que_fue_de_otra_empresa_empieza_en_su_fecha(tmp_path, monkeypatch):
    monkeypatch.setattr(ac, "DIR", tmp_path)
    monkeypatch.setitem(ac.START, "ZZZZ", "2026-10-14")
    FakeAlpaca({d: day_rows(2026, 10, d, 13, d) for d in (13, 14, 15)}).install(monkeypatch)
    data = asyncio.run(ac.update("ZZZZ", ad))
    assert [ad.day_str(r[0] + 6 * 3600 * 1000) for r in data["1440"]] == ["2026-10-14", "2026-10-15"]
