"""Almacen de liquidaciones: lo que aun no se conocia nunca sale. Uso: python -m pytest tests/test_liq_store.py"""
import csv
import importlib

import pytest

D = 86400000
DAY0 = 1780444800000  # 2026-06-03 00:00 UTC


def write(path, header, rows):
    with open(path, "w", newline="", encoding="ascii") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("ORDERFLOW_LIQ", str(tmp_path))
    import liq_store
    module = importlib.reload(liq_store)
    write(tmp_path / "BTCUSDT_marginpad.csv", ["date_utc", "price_low", "price_high", "long_usd", "short_usd", "events"], [
        ["2026-06-03", 74975, 75025, 1000.5, 0, 3],
        ["2026-06-03", 75025, 75075, 0, 250, 1],
        ["2026-06-04", 76975, 77025, 5000, 10, 9],
    ])
    write(tmp_path / "BTCUSDT_binance_cm.csv", ["time_ms", "side", "price", "usd"], [
        [DAY0 + 3600000, "long", 74990.5, 700],
        [DAY0 + 7200000, "short", 75500, 300],
        [DAY0 + D + 60000, "long", 76000, 100],
    ])
    yield module
    importlib.reload(liq_store)


def known(result):
    return [cell[0] for cell in result["cells"]]


def test_un_dia_se_conoce_al_cerrar(store):
    # A las 23:59 del 3 de junio todavia no se conoce ese dia de MarginPad
    early = store.window("BTCUSDT", DAY0 - D, DAY0 + D - 60000)
    assert all(cell[7] != 0 for cell in early["cells"]), "ninguna celda de MarginPad antes de cerrar el dia"
    closed = store.window("BTCUSDT", DAY0 - D, DAY0 + D)
    days = [cell for cell in closed["cells"] if cell[7] == 0]
    assert len(days) == 2
    assert days[0][:5] == [DAY0 + D, DAY0, DAY0 + D, 74975.0, 75025.0]
    assert days[0][5:7] == [1000.5, 0.0]


def test_un_evento_se_conoce_en_su_hora(store):
    result = store.window("BTCUSDT", DAY0, DAY0 + D, known_until=DAY0 + 3600000)
    assert known(result) == [DAY0 + 3600000]
    assert result["cells"][0][3:8] == [74990.5, 74990.5, 700.0, 0.0, 1]
    later = store.window("BTCUSDT", DAY0, DAY0 + D, known_until=DAY0 + 7200000)
    assert later["cells"][1][5:7] == [0.0, 300.0], "BUY cierra un corto"


def test_known_until_corta_aunque_end_sea_posterior(store):
    result = store.window("BTCUSDT", DAY0 - D, DAY0 + 10 * D, known_until=DAY0 + 2 * 3600000)
    assert max(known(result)) <= DAY0 + 2 * 3600000
    assert result["known_until"] == DAY0 + 2 * 3600000


def test_inicio_excluido_y_orden_por_known(store):
    result = store.window("BTCUSDT", DAY0 + 3600000, DAY0 + 3 * D)
    assert DAY0 + 3600000 not in known(result), "(start, cut]: el inicio no entra"
    assert known(result) == sorted(known(result))


def test_fuentes_en_orden_de_prioridad_con_su_tramo(store):
    sources = store.window("BTCUSDT", DAY0, DAY0 + D)["sources"]
    assert [s["id"] for s in sources] == ["marginpad", "binance_cm"]
    assert sources[0]["kind"] == "days" and sources[1]["kind"] == "events"
    assert sources[0]["first"] == DAY0 and sources[0]["last"] == DAY0 + 2 * D
    assert sources[0]["days"] == 2 and sources[0]["cell_width"] == 50.0
    assert sources[1]["first"] == DAY0 + 3600000 and sources[1]["last"] == DAY0 + D + 60000
    assert sources[1]["cell_width"] == 0.0
    assert sources[0]["ranges"] == [[DAY0, DAY0 + 2 * D]]


def test_un_hueco_de_mas_de_una_semana_parte_el_tramo(store, tmp_path):
    write(tmp_path / "ETHUSDT_bitfinex.csv", ["time_ms", "side", "price", "usd"], [
        [DAY0 + 1000, "long", 2000, 10], [DAY0 + 6 * D, "short", 2100, 10], [DAY0 + 20 * D + 5, "long", 1900, 10]
    ])
    [source] = store.window("ETHUSDT", DAY0, DAY0 + 30 * D)["sources"]
    assert source["id"] == "bitfinex" and source["scope"] == "un mercado pequeño"
    assert source["ranges"] == [[DAY0, DAY0 + 7 * D], [DAY0 + 20 * D, DAY0 + 21 * D]]


def test_tramos_estimados_se_conocen_al_cerrar_el_intervalo(store, tmp_path):
    write(tmp_path / "SOLUSDT_coinalyze.csv", ["start_ms", "end_ms", "price_low", "price_high", "long_usd", "short_usd", "interval"], [
        [DAY0, DAY0 + 3600000, 150.0, 150.075, 1000, 0, "1hour"]
    ])
    assert store.window("SOLUSDT", DAY0 - D, DAY0 + 3599999)["cells"] == []
    [cell] = store.window("SOLUSDT", DAY0 - D, DAY0 + 3600000)["cells"]
    assert cell[:3] == [DAY0 + 3600000, DAY0, DAY0 + 3600000]
    assert store.window("SOLUSDT", DAY0 - D, DAY0 + D)["sources"][0]["kind"] == "spans"


def test_simbolo_sin_archivos(store):
    result = store.window("ETHUSDT", DAY0, DAY0 + D)
    assert result["cells"] == [] and result["sources"] == []


def test_archivo_nuevo_se_vuelve_a_leer(store, tmp_path):
    assert len(store.window("BTCUSDT", DAY0, DAY0 + 3 * D)["cells"]) == 6
    write(tmp_path / "BTCUSDT_binance_cm.csv", ["time_ms", "side", "price", "usd"], [[DAY0 + 3600000, "long", 74990.5, 700]])
    import os
    stamp = os.path.getmtime(tmp_path / "BTCUSDT_binance_cm.csv")
    os.utime(tmp_path / "BTCUSDT_binance_cm.csv", (stamp + 5, stamp + 5))
    assert len(store.window("BTCUSDT", DAY0, DAY0 + 3 * D)["cells"]) == 4


def test_ventana_demasiado_larga_se_acorta(store):
    result = store.window("BTCUSDT", 0, DAY0 + 3 * D)
    assert result["start"] == DAY0 + 3 * D - store.MAX_SPAN_MS
