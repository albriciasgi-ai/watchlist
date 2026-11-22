"""OI de 5 minutos de Bybit y Binance (21/11). Uso: python -m pytest tests/test_oi_history.py"""
import calendar
import io
import os
import re
import time
import zipfile

import numpy as np
import pytest

import oi_history as oh

STEP = 5 * 60000
T0 = 1704067200000  # 2024-01-01 00:00 UTC
DAY = 86400000


@pytest.fixture(autouse=True)
def tmp_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(oh, "DIR", tmp_path)
    monkeypatch.setattr(oh.time, "sleep", lambda s: None)  # Los reintentos no esperan
    oh._cache.clear()
    return tmp_path


class Resp:
    def __init__(self, status=200, payload=None, content=b""):
        self.status_code, self._payload, self.content = status, payload, content

    def json(self):
        return self._payload


# ---------------------------------------------------------------- Bybit

class FakeBybit:
    """La API de Bybit sobre una serie de 5 minutos: hasta `limit` datos en el rango, los más nuevos primero."""

    def __init__(self, n, start=T0):
        self.times = [start + i * STEP for i in range(n)]
        self.calls, self.busy, self.broken_after = 0, 0, None

    def value(self, t):
        return 1000.0 + (t - T0) / STEP

    def get(self, url, params=None):
        self.calls += 1
        if self.broken_after is not None and self.calls > self.broken_after:
            return Resp(500)
        if self.busy:
            self.busy -= 1
            return Resp(200, {"retCode": 10006, "retMsg": "Too many visits!"})
        inside = [t for t in self.times if params["startTime"] <= t <= params["endTime"]]
        page = sorted(inside, reverse=True)[:params["limit"]]
        return Resp(200, {"retCode": 0, "result": {"list": [
            {"openInterest": f"{self.value(t):.3f}", "singleOpenInterest": f"{self.value(t) / 2:.4f}", "timestamp": str(t)}
            for t in page]}})


def test_bybit_baja_hacia_atras_y_despues_solo_lo_nuevo(monkeypatch):
    monkeypatch.setattr(oh, "CHECKPOINT", 2)  # Guarda cada 400 datos al ir hacia atrás
    api = FakeBybit(3 * 288)
    data = oh.update_bybit("XUSDT", api, backfill=True)
    assert len(data["t"]) == 864 and np.all(np.diff(data["t"]) == STEP) and int(data["done"]) == 1
    assert data["oi"][0] == 1000.0 and data["oi"][-1] == 1000.0 + 863
    # Un día más: sin backfill solo pide lo nuevo (dos páginas y la vacía que lo cierra)
    api.times += [T0 + i * STEP for i in range(864, 1152)]
    api.calls = 0
    data = oh.update_bybit("XUSDT", api)
    assert api.calls == 3 and len(data["t"]) == 1152 and np.all(np.diff(data["t"]) == STEP)


def test_bybit_sin_archivo_solo_empieza_con_la_bajada_completa():
    api = FakeBybit(100)
    assert oh.update_bybit("XUSDT", api) is None and api.calls == 0


def test_bybit_reintenta_si_frena_y_falla_si_no_existe_la_moneda():
    api = FakeBybit(300)
    api.busy = 2  # "Too many visits" dos veces
    data = oh.update_bybit("XUSDT", api, backfill=True)
    assert len(data["t"]) == 300

    class Missing:
        def get(self, url, params=None):
            return Resp(200, {"retCode": 10001, "retMsg": "params error: symbol invalid"})
    with pytest.raises(oh.NotListed):
        oh.update_bybit("NOPEUSDT", Missing(), backfill=True)


def test_bybit_un_corte_deja_lo_guardado_seguido_y_se_retoma(monkeypatch):
    monkeypatch.setattr(oh, "CHECKPOINT", 2)
    api = FakeBybit(3 * 288)
    api.broken_after = 3  # Tres páginas y se cae la red
    with pytest.raises(RuntimeError):
        oh.update_bybit("XUSDT", api, backfill=True)
    saved = oh.load("bybit", "XUSDT")
    assert len(saved["t"]) == 400 and int(saved["done"]) == 0  # Las dos páginas del guardado, lo más nuevo
    assert np.all(np.diff(saved["t"]) == STEP) and saved["t"][-1] == api.times[-1]
    api.broken_after, api.calls = None, 0
    data = oh.update_bybit("XUSDT", api, backfill=True)
    assert len(data["t"]) == 864 and int(data["done"]) == 1
    assert api.calls <= 5  # Lo nuevo (vacío) y lo que faltaba hacia atrás, sin repetir lo guardado


# ---------------------------------------------------------------- Binance

def metrics_zip(day, rows=288, header=True, oi0=500.0):
    t0 = calendar.timegm(time.strptime(day, "%Y-%m-%d"))
    lines = [",".join(oh.BINANCE_ORDER)] if header else []
    for i in range(rows):
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(t0 + i * 300))
        lines.append(f"{stamp},XUSDT,{oi0 + i},{(oi0 + i) * 10},1.5,1.6,1.1,0.9")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(f"XUSDT-metrics-{day}.csv", "\n".join(lines))
    return buf.getvalue()


class FakeBinance:
    """El listado de S3 por páginas (`page` días cada una) y los archivos diarios."""

    def __init__(self, days, page=2):
        self.days, self.page = list(days), page
        self.fetched, self.prefixes, self.broken = [], [], set()

    def get(self, url, params=None):
        if url == oh.BINANCE_LIST:
            prefix, marker = params["prefix"], params.get("marker") or ""
            self.prefixes.append(prefix)
            pair = prefix.rstrip("/").split("/")[-1]
            keys = [k for d in self.days for k in (f"{prefix}{pair}-metrics-{d}.zip", f"{prefix}{pair}-metrics-{d}.zip.CHECKSUM")]
            keys = [k for k in sorted(keys) if k > marker]
            page = keys[:2 * self.page]
            truncated = len(keys) > len(page)
            body = "".join(f"<Contents><Key>{k}</Key></Contents>" for k in page)
            nxt = f"<NextMarker>{page[-1]}</NextMarker>" if truncated else ""
            xml = (f'<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                   f'<IsTruncated>{"true" if truncated else "false"}</IsTruncated>{nxt}{body}</ListBucketResult>')
            return Resp(200, content=xml.encode())
        day = re.search(r"-metrics-(\d{4}-\d{2}-\d{2})\.zip$", url).group(1)
        self.fetched.append(day)
        return Resp(200, content=b"no es un zip" if day in self.broken else metrics_zip(day))


def days_from(first, n):
    return [time.strftime("%Y-%m-%d", time.gmtime(first / 1000 + i * 86400)) for i in range(n)]


def test_binance_lee_el_archivo_con_y_sin_encabezado():
    a = oh.parse_metrics(metrics_zip("2024-03-01"))
    b = oh.parse_metrics(metrics_zip("2024-03-01", header=False))
    assert len(a["t"]) == 288 and np.array_equal(a["t"], b["t"]) and np.array_equal(a["oi"], b["oi"])
    assert a["t"][0] == 1709251200000 and np.all(np.diff(a["t"]) == STEP)
    assert a["oi"][1] == 501.0 and a["usd"][1] == 5010.0
    assert a["top_acc"][0] == pytest.approx(1.5) and a["taker"][0] == pytest.approx(0.9)


def test_binance_lista_por_paginas_y_despues_baja_solo_los_dias_nuevos(monkeypatch):
    monkeypatch.setattr(oh, "BINANCE_WORKERS", 1)
    monkeypatch.setattr(oh, "BINANCE_BATCH", 2)
    days = days_from(T0, 5)
    api = FakeBinance(days)
    data = oh.update_binance("XUSDT", api, backfill=True)
    assert sorted(api.fetched) == days and len(data["t"]) == 5 * 288
    assert np.all(np.diff(data["t"]) == STEP) and len(data["days"]) == 5
    api.days += days_from(T0 + 5 * DAY, 2)
    api.fetched = []
    data = oh.update_binance("XUSDT", api)
    assert sorted(api.fetched) == api.days[5:] and len(data["t"]) == 7 * 288


def test_binance_guarda_el_dia_que_no_se_lee_y_la_bajada_completa_lo_repite(monkeypatch):
    monkeypatch.setattr(oh, "BINANCE_WORKERS", 1)
    days = days_from(T0, 3)
    api = FakeBinance(days)
    api.broken = {days[1]}
    data = oh.update_binance("XUSDT", api, backfill=True)
    assert len(data["t"]) == 2 * 288 and data["bad"].tolist() == [oh._day_num(days[1])]
    api.broken, api.fetched = set(), []
    data = oh.update_binance("XUSDT", api, backfill=True)
    assert api.fetched == [days[1]] and len(data["t"]) == 3 * 288 and len(data["bad"]) == 0


def test_shib_se_llama_1000shib_en_binance_y_una_moneda_que_no_esta_no_deja_archivo(monkeypatch):
    monkeypatch.setattr(oh, "BINANCE_WORKERS", 1)
    api = FakeBinance([])
    assert oh.update_binance("SHIB1000USDT", api, backfill=True) is None
    assert api.prefixes[0].endswith("/1000SHIBUSDT/") and not oh.path("binance", "SHIB1000USDT").exists()


# ---------------------------------------------------------------- Lectura

def write(source, t, **fields):
    oh.save(source, "XUSDT", {"t": np.asarray(t, dtype=np.int64), **{k: np.asarray(v, dtype=float) for k, v in fields.items()}})


def bars(n, start, tf):
    return [{"t": start + i * tf * 60000} for i in range(n)]


def test_cada_dato_se_usa_5_minutos_despues_de_su_marca():
    t = T0 + np.arange(600) * STEP
    write("bybit", t, oi=np.arange(600) + 1000)  # El dato i vale 1000 + i
    h1 = oh.at_close("XUSDT", bars(3, T0, 60), 60)
    assert h1.tolist() == [1011.0, 1023.0, 1035.0]  # La vela de 00:00 a 01:00 ve el dato de las 00:55, no el de la 01:00
    m5 = oh.at_close("XUSDT", bars(3, T0, 5), 5)
    assert m5.tolist() == [1000.0, 1001.0, 1002.0]
    h4 = oh.at_close("XUSDT", bars(2, T0, 240), 240)
    assert h4.tolist() == [1047.0, 1095.0]  # Lo mismo que tomar la serie de 5 minutos en cada marca


def test_un_hueco_deja_la_vela_sin_dato_segun_su_marco():
    t = T0 + np.r_[np.arange(0, 30), np.arange(40, 200)] * STEP  # Faltan los datos 30 a 39
    write("bybit", t, oi=np.arange(len(t)))
    m5 = oh.at_close("XUSDT", bars(50, T0, 5), 5)
    assert np.isfinite(m5[30]) and np.isnan(m5[33]) and np.isfinite(m5[41])  # Un dato faltante se tolera; varios no
    h1 = oh.at_close("XUSDT", bars(3, T0, 60), 60)
    assert np.isfinite(h1).all()  # En 1 hora, 50 minutos sin datos no llegan a 2 velas


def test_un_cero_suelto_no_es_un_oi_y_la_vela_usa_el_dato_anterior():
    oi = np.arange(1.0, 101.0)
    oi[50] = 0.0  # Binance trae ceros sueltos
    write("bybit", T0 + np.arange(100) * STEP, oi=oi)
    m5 = oh.at_close("XUSDT", bars(100, T0, 5), 5)
    assert m5[50] == 50.0 and m5[51] == 52.0  # La vela que vería el cero ve el dato anterior


def test_la_suma_es_binance_mas_la_mitad_de_bybit_donde_estan_los_dos():
    write("bybit", T0 + np.arange(0, 10) * STEP, oi=np.full(10, 200.0))
    write("binance", T0 + np.arange(5, 15) * STEP, **{f: np.full(10, 50.0) for f in oh.BINANCE_COLUMNS})
    t, v = oh.series("XUSDT", "sum")
    assert (t - T0).tolist() == [i * STEP for i in range(5, 10)] and v.tolist() == [150.0] * 5
    taker = oh.at_close("XUSDT", bars(1, T0 + 5 * STEP, 5), 5, source="binance", field="taker")
    assert taker.tolist() == [50.0]


# ---------------------------------------------------------------- Bajada

def test_una_bajada_a_la_vez_y_el_candado_viejo_vence():
    assert oh.take_lock() and not oh.take_lock()
    old = time.time() - 3 * 3600
    os.utime(oh._lock_path(), (old, old))
    assert oh.take_lock()
    oh.release_lock()


def test_una_moneda_que_falla_no_detiene_a_las_demas(monkeypatch):
    done = []

    def by(s, c, backfill, pace, log):
        if s == "BADUSDT":
            raise RuntimeError("sin respuesta")
        done.append(s)
        return None

    monkeypatch.setattr(oh, "update_bybit", by)
    logs = []
    failed = oh.run(["AUSDT", "BADUSDT", "CUSDT"], ("bybit",), log=logs.append)
    assert sorted(done) == ["AUSDT", "CUSDT"] and failed == [("bybit", "BADUSDT", "sin respuesta")]
    assert not oh._lock_path().exists()
    assert oh.take_lock()
    assert oh.run(["AUSDT"], ("bybit",), log=logs.append) is None and "sigue corriendo" in logs[-1]
    oh.release_lock()
