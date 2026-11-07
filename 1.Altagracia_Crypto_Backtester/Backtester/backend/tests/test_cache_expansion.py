"""Un símbolo que nació después del máximo configurado recibe velas nuevas y su caché se guarda.

Bybit simulado con httpx.MockTransport: entrega las primeras velas desde "start", y si "start" es
anterior al listado entrega desde el listado (lo que hace Bybit real: ver los logs de ARB, SUI y TRX).
Uso (desde la carpeta del backend): python -m pytest -q -p no:cacheprovider tests/test_cache_expansion.py
"""
import copy
import gzip
import json
import time
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

import main

H4 = 4 * 60 * 60 * 1000
NOW = int(time.time() * 1000)
LAST_CLOSED = (NOW // H4) * H4 - H4          # última vela de 4h que Bybit ya tiene
LISTING = LAST_CLOSED - 400 * 6 * H4          # el símbolo nació hace 400 días: 22% de 1825
STALE_LAST = LAST_CLOSED - 15 * 6 * H4        # el caché se quedó 15 días atrás


def candle(ts):
    return {"timestamp": ts, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10.0}


class FakeBybit:
    def __init__(self):
        self.calls = []

    def handler(self, request):
        q = parse_qs(request.url.query.decode())
        start, limit = int(q["start"][0]), int(q["limit"][0])
        self.calls.append(start)
        first = max(start, LISTING)
        first = LISTING + -(-(first - LISTING) // H4) * H4   # primera vela >= start en la grilla
        rows = []
        ts = first
        while ts <= LAST_CLOSED and len(rows) < limit:
            rows.append([str(ts), "1", "2", "0.5", "1.5", "10", "15"])
            ts += H4
        return httpx.Response(200, json={"retCode": 0, "retMsg": "OK", "result": {"list": rows[::-1]}})


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "BACKTESTING_CACHE_DIR", tmp_path)
    monkeypatch.setattr(main, "BACKTESTING_CONFIG", {"4h": copy.deepcopy(main.BACKTESTING_CONFIG["4h"])})
    fake = FakeBybit()
    real_client = httpx.AsyncClient

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(fake.handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", client)

    rows = [candle(ts) for ts in range(LISTING, STALE_LAST + 1, H4)]
    data = {"symbol": "ARBUSDT",
            "timeframes": {"4h": {"main": rows, "subdivisions": copy.deepcopy(rows), "subdivision_count": 4,
                                   "open_interest": [{"timestamp": LISTING, "value": 1.0}, {"timestamp": STALE_LAST, "value": 1.0}]}},
            "metadata": {"cached_at": NOW - 15 * 24 * 3600 * 1000, "date_range": {"start": "x", "end": "y"}}}
    path = tmp_path / "ARBUSDT_backtesting_data.json.gz"
    with gzip.open(path, "wb") as f:
        f.write(json.dumps(data).encode("utf-8"))
    return fake, path, rows


def read_gz(path):
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


@pytest.mark.parametrize("query", ["?timeframe=4h", ""])
def test_simbolo_nuevo_recibe_velas_nuevas_y_se_guarda(env, query):
    fake, path, rows = env
    before = path.read_bytes()

    body = TestClient(main.app).get(f"/api/backtesting/bulk-data/ARBUSDT{query}").json()

    tf = body["timeframes"]["4h"]
    assert tf["main"][0]["timestamp"] == LISTING
    assert tf["main"][-1]["timestamp"] == LAST_CLOSED, "no llegaron las velas nuevas"
    assert path.read_bytes() != before, "el caché no se guardó"
    saved = read_gz(path)["timeframes"]["4h"]
    assert "subdivisions" not in saved
    assert saved["main"][-1]["timestamp"] == LAST_CLOSED
    assert saved.get("first_available_ts") == LISTING


def test_la_expansion_no_se_repite_en_cada_carga(env):
    fake, path, rows = env
    client = TestClient(main.app)
    client.get("/api/backtesting/bulk-data/ARBUSDT?timeframe=4h")
    calls_after_first = len(fake.calls)

    # Pasada 1 h: solo busca velas nuevas desde la última, no vuelve a pedir velas viejas
    data = read_gz(path)
    data["metadata"]["cached_at"] = NOW - 2 * 3600 * 1000
    with gzip.open(path, "wb") as f:
        f.write(json.dumps(data).encode("utf-8"))
    body = client.get("/api/backtesting/bulk-data/ARBUSDT?timeframe=4h").json()

    new_calls = fake.calls[calls_after_first:]
    assert all(start > LISTING for start in new_calls), f"volvió a expandir hacia atrás: {new_calls}"
    assert not body.get("backwards_expansion")


def test_un_error_de_bybit_no_marca_el_inicio(env, monkeypatch):
    fake, path, rows = env

    def failing(request):
        return httpx.Response(200, json={"retCode": 10006, "retMsg": "Too many visits!", "result": {}})

    monkeypatch.setattr(fake, "handler", failing)
    TestClient(main.app).get("/api/backtesting/bulk-data/ARBUSDT?timeframe=4h")
    if path.exists():
        saved = read_gz(path)["timeframes"]["4h"]
        assert "first_available_ts" not in saved


def test_si_fallan_las_velas_nuevas_se_reintenta_en_la_siguiente_carga(env, monkeypatch):
    fake, path, rows = env
    normal = fake.handler
    state = {"fail": True}

    def flaky(request):
        start = int(parse_qs(request.url.query.decode())["start"][0])
        if start > LISTING and state["fail"]:
            fake.calls.append(start)
            return httpx.Response(200, json={"retCode": 10006, "retMsg": "Too many visits!", "result": {}})
        return normal(request)

    monkeypatch.setattr(fake, "handler", flaky)
    client = TestClient(main.app)
    first = client.get("/api/backtesting/bulk-data/ARBUSDT?timeframe=4h").json()
    assert first["timeframes"]["4h"]["main"][-1]["timestamp"] == STALE_LAST
    saved = read_gz(path)
    assert saved["timeframes"]["4h"].get("first_available_ts") == LISTING
    assert saved["metadata"]["cached_at"] < NOW - 3600 * 1000, "un intento fallido no debe posponer el siguiente 1 h"

    state["fail"] = False
    second = client.get("/api/backtesting/bulk-data/ARBUSDT?timeframe=4h").json()
    assert second["timeframes"]["4h"]["main"][-1]["timestamp"] == LAST_CLOSED
    assert not second.get("backwards_expansion")


def test_el_oi_largo_no_se_cambia_por_el_cache_permanente_corto(tmp_path, monkeypatch):
    """Rama incremental: si el OI cubre menos del 50% de las velas, get_open_interest devuelve el
    caché permanente (unas semanas). La serie larga no debe quedar reemplazada por la corta."""
    monkeypatch.setattr(main, "BACKTESTING_CACHE_DIR", tmp_path)
    monkeypatch.setattr(main, "BACKTESTING_CONFIG", {"4h": copy.deepcopy(main.BACKTESTING_CONFIG["4h"])})
    fake = FakeBybit()
    real_client = httpx.AsyncClient

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(fake.handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(main.httpx, "AsyncClient", client)
    start = STALE_LAST - 10950 * H4                      # 5 años completos: no hay expansión
    rows = [candle(ts) for ts in range(start, STALE_LAST + 1, H4)]
    oi_long = [{"timestamp": ts, "openInterest": 1.0} for ts in range(STALE_LAST, STALE_LAST - 4380 * H4, -H4)]
    oi_short = [{"timestamp": ts, "openInterest": 2.0} for ts in range(STALE_LAST, STALE_LAST - 120 * H4, -H4)]
    data = {"symbol": "ETHUSDT", "timeframes": {"4h": {"main": rows, "subdivision_count": 4, "open_interest": oi_long}},
            "metadata": {"cached_at": NOW - 15 * 24 * 3600 * 1000, "date_range": {"start": "x", "end": "y"}}}
    with gzip.open(tmp_path / "ETHUSDT_backtesting_data.json.gz", "wb") as f:
        f.write(json.dumps(data).encode("utf-8"))
    with gzip.open(tmp_path / "ETHUSDT_240_oi.json.gz", "wb") as f:
        f.write(json.dumps({"symbol": "ETHUSDT", "interval": "240", "data": oi_short}).encode("utf-8"))

    body = TestClient(main.app).get("/api/backtesting/bulk-data/ETHUSDT?timeframe=4h").json()

    assert body["timeframes"]["4h"]["main"][-1]["timestamp"] == LAST_CLOSED
    assert len(body["timeframes"]["4h"]["open_interest"]) >= len(oi_long), "el OI largo quedó cambiado por el corto"
