"""Carga inicial de velas: cada vela viaja una sola vez. Uso: python -m pytest tests/test_bulk_data.py"""
import copy
import gzip
import json
import time

import pytest
from fastapi.testclient import TestClient

import main

H4 = 4 * 60 * 60 * 1000


def candles(n, step=H4, start=1_700_000_000_000):
    return [{"timestamp": start + i * step, "open": 100.0 + i, "high": 101.0 + i, "low": 99.0 + i, "close": 100.5 + i, "volume": 1.5}
            for i in range(n)]


def old_format(tf_candles, subdivisions=None):
    """Caché como se guardaba antes: subdivisions repetía main en cada marco."""
    timeframes = {}
    for tf, rows in tf_candles.items():
        subs = (subdivisions or {}).get(tf, rows)
        timeframes[tf] = {"main": rows, "subdivisions": copy.deepcopy(subs), "subdivision_count": 4, "open_interest": [{"timestamp": rows[0]["timestamp"], "value": 1.0}]}
    return {"symbol": "BTCUSDT", "timeframes": timeframes,
            "metadata": {"cached_at": int(time.time() * 1000), "date_range": {"start": "x", "end": "y"}}}


def write_gz(folder, data, symbol="BTCUSDT"):
    path = folder / f"{symbol}_backtesting_data.json.gz"
    with gzip.open(path, "wb") as f:
        f.write(json.dumps(data).encode("utf-8"))
    return path


def read_gz(path):
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


@pytest.fixture
def cache_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "BACKTESTING_CACHE_DIR", tmp_path)
    return tmp_path


def test_un_cache_viejo_se_carga_sin_la_copia(cache_dir):
    rows = {"4h": candles(200), "1h": candles(10, step=H4 // 4)}
    write_gz(cache_dir, old_format(rows))
    data = main.load_backtesting_cache("BTCUSDT")
    for tf, tf_rows in rows.items():
        assert "subdivisions" not in data["timeframes"][tf]
        assert data["timeframes"][tf]["main"] == tf_rows
        assert data["timeframes"][tf]["subdivision_count"] == 4
        assert len(data["timeframes"][tf]["open_interest"]) == 1


def test_subdivisiones_distintas_de_main_no_se_quitan(cache_dir):
    rows = {"5m": candles(10, step=5 * 60 * 1000)}
    one_minute = candles(50, step=60 * 1000)
    write_gz(cache_dir, old_format(rows, subdivisions={"5m": one_minute}))
    data = main.load_backtesting_cache("BTCUSDT")
    assert data["timeframes"]["5m"]["subdivisions"] == one_minute
    assert data["timeframes"]["5m"]["main"] == rows["5m"]


def test_al_guardar_otra_vez_el_disco_pierde_la_copia(cache_dir):
    path = write_gz(cache_dir, old_format({"4h": candles(20)}))
    main.save_backtesting_cache("BTCUSDT", main.load_backtesting_cache("BTCUSDT"))
    saved = read_gz(path)
    assert "subdivisions" not in saved["timeframes"]["4h"]
    assert saved["timeframes"]["4h"]["main"] == candles(20)


def test_el_json_antiguo_migra_a_gzip_sin_la_copia(cache_dir):
    (cache_dir / "BTCUSDT_backtesting_data.json").write_text(json.dumps(old_format({"4h": candles(20)})), encoding="utf-8")
    data = main.load_backtesting_cache("BTCUSDT")
    assert "subdivisions" not in data["timeframes"]["4h"]
    assert not (cache_dir / "BTCUSDT_backtesting_data.json").exists()
    assert "subdivisions" not in read_gz(cache_dir / "BTCUSDT_backtesting_data.json.gz")["timeframes"]["4h"]


def test_bulk_data_envia_cada_vela_una_sola_vez(cache_dir, monkeypatch):
    # Con 30 días configurados en 4h, 180 velas son un caché completo: no consulta a Bybit
    config = copy.deepcopy(main.BACKTESTING_CONFIG)
    config["4h"]["days"] = 30
    monkeypatch.setattr(main, "BACKTESTING_CONFIG", config)
    rows = {"4h": candles(180), "1m": candles(30, step=60 * 1000)}
    path = write_gz(cache_dir, old_format(rows))
    before = path.read_bytes()

    response = TestClient(main.app).get("/api/backtesting/bulk-data/BTCUSDT?timeframe=4h")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] and body["from_cache"]
    for tf, tf_rows in rows.items():
        assert "subdivisions" not in body["timeframes"][tf]
        assert body["timeframes"][tf]["main"] == tf_rows
        assert body["timeframes"][tf]["open_interest"]
    # Un caché reciente se lee sin volver a escribirlo
    assert path.read_bytes() == before
