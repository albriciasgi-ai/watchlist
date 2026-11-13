"""Tabla de medidas: reglas, recorte y lectura desde cada lado. Uso: python -m pytest tests/test_measures.py"""
import json

import numpy as np
import pytest

import footprint_store
import measures
import oi_store

MINUTE = 60000
DAY = 86400000
T0 = 1780444800000  # 2026-06-03 00:00 UTC


def candles(rows, start=T0, step=15 * MINUTE):
    """Velas desde [apertura, cierre, volumen]"""
    opens = np.array([row[0] for row in rows], dtype=float)
    closes = np.array([row[1] for row in rows], dtype=float)
    return {
        "ts": start + np.arange(len(rows), dtype=np.int64) * step, "open": opens, "close": closes,
        "high": np.maximum(opens, closes), "low": np.minimum(opens, closes),
        "volume": np.array([row[2] if len(row) > 2 else 10.0 for row in rows], dtype=float),
    }


def walk(count, seed=3, start=T0):
    """Velas de 15 minutos con subidas, bajadas y volumen variable, y sus marcos mayores"""
    rng = np.random.default_rng(seed)
    close = 1000 + np.cumsum(rng.normal(0, 5, count))
    open_ = np.r_[1000.0, close[:-1]]
    wick = rng.random(count) * 3
    base = {
        "ts": start + np.arange(count, dtype=np.int64) * 15 * MINUTE, "open": open_, "close": close,
        "high": np.maximum(open_, close) + wick, "low": np.minimum(open_, close) - wick,
        "volume": 10 + rng.random(count) * 90,
    }
    return {"15m": base, "1h": group(base, 4), "4h": group(base, 16)}


def group(base, size):
    usable = len(base["ts"]) // size * size
    shape = (-1, size)
    return {
        "ts": base["ts"][:usable:size], "open": base["open"][:usable:size], "close": base["close"][:usable].reshape(shape)[:, -1],
        "high": base["high"][:usable].reshape(shape).max(axis=1), "low": base["low"][:usable].reshape(shape).min(axis=1),
        "volume": base["volume"][:usable].reshape(shape).sum(axis=1),
    }


@pytest.fixture(autouse=True)
def no_external_data(monkeypatch, tmp_path):
    monkeypatch.setattr(oi_store, "points", lambda symbol: None)
    monkeypatch.setattr(footprint_store, "STORE_DIR", tmp_path / "store")
    monkeypatch.setenv("ORDERFLOW_OBSERVER", str(tmp_path / "observer"))
    measures._tables.clear()
    measures._builds.clear()


def test_atr_promedia_el_rango_verdadero():
    frame = candles([[100, 101], [101, 102], [110, 111]])
    assert measures.atr(frame["high"], frame["low"], frame["close"], 2).tolist() == [1.0, 1.0, 5.0]


def test_el_tramo_cambia_con_un_cierre_lejos_del_extremo_y_empieza_en_el():
    rows = [[100, 101], [101, 102], [102, 103], [103, 104], [104, 105], [105, 106], [105.5, 105], [105, 104.5], [104.5, 103.5]]
    frame = candles(rows)
    values = measures.atr(frame["high"], frame["low"], frame["close"])
    direction, start, extreme = measures.zigzag(frame["high"], frame["low"], frame["close"], values, 2)
    assert direction[7] == 1 and direction[8] == -1
    assert start[8] == 5
    assert extreme[8] == 103.5


def test_la_distancia_del_giro_se_mide_en_atr():
    rows = [[100, 101], [101, 102], [102, 103], [103, 104], [104, 105], [105, 106], [105.5, 105], [105, 104.5], [104.5, 103.5]]
    frame = candles([[open_ * 10, close * 10] for open_, close in rows])
    values = measures.atr(frame["high"], frame["low"], frame["close"])
    direction, _, _ = measures.zigzag(frame["high"], frame["low"], frame["close"], values, 2)
    assert direction[7] == 1 and direction[8] == -1, "con precios diez veces mayores el giro no cambia"


def test_volumen_contra_lo_normal_de_su_hora():
    rows = [10.0] * 7
    rows[4] = 50.0
    rows[6] = 30.0
    ts = T0 + np.arange(7, dtype=np.int64) * DAY
    result = measures.hour_volume(ts, np.array(rows))
    assert result[6] == 3
    assert result[4] == 1, "con menos de 5 días queda en lo normal"


def test_la_vela_no_entra_en_su_propio_normal():
    ts = T0 + np.arange(6, dtype=np.int64) * DAY
    assert measures.hour_volume(ts, np.array([10.0, 10, 10, 30, 30, 100]))[5] == 10


def test_cada_hora_tiene_su_normal():
    ts = T0 + np.arange(14, dtype=np.int64) * (DAY // 2)  # Dos velas por día
    volume = np.array([10.0, 1000.0] * 7)
    assert measures.hour_volume(ts, volume)[12:].tolist() == [1, 1]


def test_balance_y_equilibrio():
    side = np.array([1, -1, -1, -1, 1, -1], dtype=np.int8)
    weight = np.array([100.0, 30, 100, 110, 300, 300])
    direction = np.ones(6, dtype=np.int8)
    start = np.zeros(6, dtype=np.int64)
    values = measures.balance(side, weight, direction, start)
    assert values[0] == 10
    assert values[2] == pytest.approx(100 / 65)
    found = measures.equilibrium(np.array([10.0, 3.3, 1.0, 0.9, 2.7, 1.0]), direction, start)
    assert found.tolist() == [False, False, True, False, False, True]


def test_balance_usa_las_cinco_principales_y_la_ventana():
    side = np.array([1] * 12 + [-1], dtype=np.int8)
    weight = np.array([900.0] + [10.0] * 11 + [5.0])
    direction = np.ones(13, dtype=np.int8)
    start = np.zeros(13, dtype=np.int64)
    assert measures.balance(side, weight, direction, start)[12] == 2, "la vela de 900 quedó fuera de las últimas 10"


def test_balance_no_pasa_del_inicio_del_tramo():
    side = np.array([-1, -1, -1, 1, -1], dtype=np.int8)
    weight = np.array([900.0, 900, 10, 5, 10])
    direction = np.full(5, -1, dtype=np.int8)
    start = np.full(5, 2, dtype=np.int64)
    assert measures.balance(side, weight, direction, start)[4] == 2


def test_cambiar_de_tramo_desarma_el_equilibrio():
    values = np.array([3.0, 0.5])
    found = measures.equilibrium(values, np.array([1, -1], dtype=np.int8), np.array([0, 0]))
    assert found.tolist() == [False, False]


def test_eficiencia_con_signo():
    assert measures.efficiency(np.array([1.0, 2, 3, 4]), 3)[3] == 1
    assert measures.efficiency(np.array([4.0, 3, 2, 1]), 3)[3] == -1
    assert measures.efficiency(np.array([1.0, 2, 1, 2]), 3)[3] == pytest.approx(1 / 3)
    assert np.isnan(measures.efficiency(np.array([1.0, 2]), 3)).all()


def test_sesgo_de_volumen():
    open_ = np.array([1.0, 2, 3])
    close = np.array([2.0, 1, 4])
    result = measures.volume_bias(open_, close, np.array([30.0, 10, 10]), 3)
    assert np.isnan(result[1])
    assert result[2] == pytest.approx(2 * 40 / 50 - 1)


def test_perfil_del_dia_concentra_el_poc_donde_hay_volumen():
    high = np.array([110.0, 101, 101, 101])
    low = np.array([100.0, 100, 100, 100])
    volume = np.array([10.0, 1000, 1000, 1000])
    poc, vah, val = measures.day_profile(high, low, volume)
    assert 100 < poc < 101
    assert val <= poc <= vah


def test_perfil_sin_rango_no_existe_y_vela_plana_no_se_pierde():
    assert measures.day_profile(np.array([5.0, 5]), np.array([5.0, 5]), np.array([1.0, 1])) is None
    poc, _, _ = measures.day_profile(np.array([100.0, 110]), np.array([100.0, 109]), np.array([500.0, 1]))
    assert poc < 101


def test_valor_del_dia_anterior_y_vwap_del_dia():
    rows = [[100, 101, 10]] * 96 + [[200, 201, 10]] * 3
    frame = candles(rows)
    poc, vah, val, vwap = measures.profile_columns(frame, frame["ts"] + 15 * MINUTE)
    assert np.isnan(poc[95]), "el primer día no tiene anterior"
    assert 100 <= poc[96] <= 101
    assert vwap[96] == pytest.approx((201 + 200 + 201) / 3)


def test_un_dia_vacio_no_da_valor():
    first = candles([[100, 101, 10]] * 96)
    second = candles([[200, 201, 10]] * 2, start=T0 + 2 * DAY)
    frame = {key: np.r_[first[key], second[key]] for key in first}
    poc, _, _, _ = measures.profile_columns(frame, frame["ts"] + 15 * MINUTE)
    assert np.isnan(poc[96]), "el día anterior no es el que falta"


def gap_frame(rows):
    frame = candles(rows)
    frame["high"] = np.array([row[3] for row in rows], dtype=float) if len(rows[0]) > 3 else frame["high"]
    frame["low"] = np.array([row[4] for row in rows], dtype=float) if len(rows[0]) > 4 else frame["low"]
    return frame


def test_gap_alcista_queda_detras_y_se_recorta():
    rows = [[100, 100, 1, 101, 99], [100, 110, 1, 111, 100], [112, 113, 1, 114, 105], [113, 113, 1, 114, 112], [113, 113, 1, 114, 103]]
    frame = gap_frame(rows)
    columns = measures.gap_columns(frame, np.full(5, 2.0))
    assert columns["below_dist"][2] == pytest.approx((113 - 105) / 2)
    assert columns["below_size"][2] == pytest.approx((105 - 101) / 2)
    assert columns["below_size"][4] == pytest.approx((103 - 101) / 2), "el precio entró en el gap y lo recortó"


def test_gap_bajista_queda_delante():
    rows = [[100, 100, 1, 101, 99], [100, 92, 1, 100, 91], [90, 89, 1, 95, 88], [89, 89, 1, 92, 88]]
    columns = measures.gap_columns(gap_frame(rows), np.full(4, 1.0))
    assert columns["above_dist"][3] == pytest.approx(95 - 89)
    assert columns["above_size"][3] == pytest.approx(99 - 95)
    assert np.isnan(columns["below_dist"][3])


def test_gap_cerrado_o_muy_viejo_desaparece(monkeypatch):
    rows = [[100, 100, 1, 101, 99], [100, 110, 1, 111, 100], [112, 113, 1, 114, 105], [113, 100, 1, 114, 100]]
    assert np.isnan(measures.gap_columns(gap_frame(rows), np.full(4, 1.0))["below_dist"][3])

    monkeypatch.setattr(measures, "FVG_MAX_AGE", 1)
    rows = [[100, 100, 1, 101, 99], [100, 110, 1, 111, 100], [112, 113, 1, 114, 105], [113, 113, 1, 114, 110.5], [113, 113, 1, 114, 110.5]]
    columns = measures.gap_columns(gap_frame(rows), np.full(5, 1.0))
    assert np.isfinite(columns["below_dist"][3]) and np.isnan(columns["below_dist"][4])


def test_precio_dentro_de_un_gap_vale_cero():
    rows = [[100, 100, 1, 101, 99], [100, 110, 1, 111, 100], [112, 103, 1, 114, 105]]
    frame = gap_frame(rows)
    columns = measures.gap_columns(frame, np.full(3, 1.0))
    assert columns["below_dist"][2] == 0


def oi_series(values, start_minute=1000):
    times = start_minute + np.arange(len(values), dtype=np.int64) * 5
    return times, np.array(values, dtype=float)


def test_oi_usa_cada_dato_cuando_ya_estaba_publicado(monkeypatch):
    values = [100.0] * 100 + [200.0]
    monkeypatch.setattr(oi_store, "points", lambda symbol: oi_series(values))
    last = 1000 + 100 * 5
    columns = measures.oi_columns("X", np.array([last + 4, last + 5]))
    assert columns["oi_chg_1h"][0] == 0, "cuatro minutos después de su marca aún no se conoce"
    assert columns["oi_chg_1h"][1] == 100


def test_oi_viejo_no_se_usa(monkeypatch):
    monkeypatch.setattr(oi_store, "points", lambda symbol: oi_series([100.0] * 100))
    last = 1000 + 99 * 5
    columns = measures.oi_columns("X", np.array([last + 29, last + 31]))
    assert np.isfinite(columns["oi_chg_1h"][0])
    assert np.isnan(columns["oi_chg_1h"][1])


def test_oi_bloques_en_alza(monkeypatch):
    values = np.repeat([100.0, 110, 120, 130, 140], 12)
    monkeypatch.setattr(oi_store, "points", lambda symbol: oi_series(values.tolist()))
    now = 1000 + 59 * 5 + 5
    assert measures.oi_columns("X", np.array([now]))["oi_rises"][0] == 3
    down = values[::-1].copy()
    monkeypatch.setattr(oi_store, "points", lambda symbol: oi_series(down.tolist()))
    assert measures.oi_columns("X", np.array([now]))["oi_rises"][0] == 0


def test_sin_oi_todo_queda_vacio():
    assert np.isnan(measures.oi_columns("X", np.array([1, 2]))["oi_chg_4h"]).all()


def test_oi_de_una_serie_pasada_sin_la_local():
    # La suite (13/11/2026) pasa la serie local mas lo reciente de Bybit; la local no existe aqui
    values = [100.0] * 100 + [200.0]
    last = 1000 + 100 * 5
    columns = measures.oi_columns("X", np.array([last + 4, last + 5]), oi_series(values))
    assert columns["oi_chg_1h"][0] == 0 and columns["oi_chg_1h"][1] == 100


def write_day(folder, minutes, buy, sell, scale=10):
    folder.mkdir(parents=True, exist_ok=True)
    np.savez(folder / "X_2026-06-03.npz", m=np.array(minutes), buy=(np.array(buy) * scale).astype(np.int64),
             sell=(np.array(sell) * scale).astype(np.int64), info=np.array([1, scale, 1]))


def test_delta_solo_con_la_vela_completa(tmp_path):
    start = T0 // MINUTE
    minutes = list(range(start, start + 15)) + list(range(start + 15, start + 20))
    write_day(tmp_path / "store" / "X" / "2026", minutes, [3.0] * 20, [1.0] * 20)
    delta, wide = measures.flow_columns("X", np.array([start, start + 15]))
    assert delta[0] == pytest.approx(0.5)
    assert np.isnan(delta[1]), "le faltan minutos"
    assert np.isnan(wide[0]), "cuatro horas necesitan todas sus velas"


def test_delta_de_cuatro_horas(tmp_path):
    start = T0 // MINUTE
    minutes = list(range(start, start + 240))
    write_day(tmp_path / "store" / "X" / "2026", minutes, [3.0] * 240, [1.0] * 240)
    rows = start + np.arange(16) * 15
    _, wide = measures.flow_columns("X", rows)
    assert wide[15] == pytest.approx(0.5)


def live_day(tmp_path, monkeypatch, gaps, saved_at):
    """Un dia de la nube y el PC (como los baja sync_nube.py): 6 velas de 15m completas, con sus huecos y su guardado."""
    import collections
    import json as json_lib
    live = tmp_path / "live" / "store"
    monkeypatch.setattr(footprint_store, "LIVE_DIR", live)
    monkeypatch.setattr(footprint_store, "_days", collections.OrderedDict())
    start = T0 // MINUTE
    write_day(live / "X" / "2026", list(range(start, start + 90)), [3.0] * 90, [1.0] * 90)
    state = live.parent / "tape" / "X" / "2026"
    state.mkdir(parents=True, exist_ok=True)
    (state / "X_2026-06-03.json").write_text(json_lib.dumps({"gaps": gaps, "saved_at": saved_at, "final": False}), encoding="utf-8")
    return start + np.arange(6) * 15


def test_delta_de_un_dia_en_vivo_sin_las_velas_con_hueco(tmp_path, monkeypatch):
    bar = 15 * MINUTE
    rows = live_day(tmp_path, monkeypatch, gaps=[[T0 + bar + 60000, T0 + bar + 120000],  # 60 s en la vela 1
                                                 [T0 + 2 * bar + 60000, T0 + 2 * bar + 65000]],  # 5 s en la vela 2
                    saved_at=T0 + 4 * bar + 7 * MINUTE)  # guardado a mitad de la vela 4
    delta, _ = measures.flow_columns("X", rows, live=True)
    assert delta[0] == pytest.approx(0.5)
    assert np.isnan(delta[1]), "un hueco de 60 s deja la vela sin delta"
    assert delta[2] == pytest.approx(0.5), "una reconexion de 5 s no"
    assert delta[3] == pytest.approx(0.5)
    assert np.isnan(delta[4]) and np.isnan(delta[5]), "despues del ultimo guardado no se sabe si llego todo"
    assert np.isnan(measures.flow_columns("X", rows)[0]).all(), "App 1 no lee los dias en vivo"


def test_el_dia_oficial_manda_sobre_el_en_vivo(tmp_path, monkeypatch):
    rows = live_day(tmp_path, monkeypatch, gaps=[], saved_at=None)
    start = T0 // MINUTE
    write_day(tmp_path / "store" / "X" / "2026", list(range(start, start + 90)), [1.0] * 90, [3.0] * 90)
    delta, _ = measures.flow_columns("X", rows, live=True)
    assert delta[0] == pytest.approx(-0.5), "el oficial, no el de la nube"


def test_las_filas_no_cambian_con_velas_posteriores():
    full = measures.compute("X", walk(3000))
    frames = walk(3000)
    limit = int(frames["15m"]["ts"][2000])
    short = {tag: {key: value[frame["ts"] < limit] for key, value in frame.items()} for tag, frame in frames.items()}
    partial = measures.compute("X", short)
    rows = len(partial["close_time"])
    for key, value in partial.items():
        same = np.array_equal(value[:rows], full[key][:rows], equal_nan=value.dtype.kind == "f")
        assert same, key


def test_marcos_mayores_solo_con_velas_ya_cerradas():
    frames = walk(400)
    table = measures.compute("X", frames)
    hour_close = frames["1h"]["ts"] + 60 * MINUTE
    row = 41  # 10:30: la vela de 10:00 sigue abierta
    expected = measures.frame_columns(frames["1h"], 60)["balance"][int(np.searchsorted(hour_close, table["close_time"][row], side="right")) - 1]
    assert table["balance_1h"][row] == pytest.approx(expected, rel=1e-5)
    assert hour_close[9] <= table["close_time"][row] < hour_close[10]


def test_fila_de_la_vela_cerrada():
    table = measures.compute("X", walk(200))
    first = int(table["close_time"][0])
    assert measures.row_at(table, first) == 0
    assert measures.row_at(table, first + 14 * MINUTE) == 0
    assert measures.row_at(table, first + 15 * MINUTE) == 1
    assert measures.row_at(table, first - 1) is None
    assert measures.row_at(table, int(table["close_time"][-1]) + 15 * MINUTE) is None, "fuera de la tabla no hay lectura"


def test_medidas_vistas_desde_cada_lado():
    table = {"pressure_15m": np.array([1.5]), "value_pos": np.array([0.2]), "fvg_below_dist_15m": np.array([3.0]), "fvg_above_dist_15m": np.array([7.0]), "balance_1h": np.array([2.0])}
    catalog = {item[0]: item for item in measures.MEASURES}
    assert measures.value_at(table, catalog["pressure_15m"], 0, -1) == -1.5
    assert measures.value_at(table, catalog["value_pos"], 0, -1) == 0.8
    assert measures.value_at(table, catalog["fvg_behind_15m"], 0, 1) == 3
    assert measures.value_at(table, catalog["fvg_behind_15m"], 0, -1) == 7
    assert measures.value_at(table, catalog["fvg_ahead_15m"], 0, -1) == 3
    assert measures.value_at(table, catalog["balance_1h"], 0, -1) == 2
    assert measures.column(table, catalog["pressure_15m"], -1).tolist() == [-1.5]
    assert measures.column(table, catalog["value_pos"], -1).tolist() == [0.8]
    assert measures.column(table, catalog["fvg_ahead_15m"], 1).tolist() == [7]


def test_sin_dato_la_medida_queda_vacia():
    table = {"poc_dist": np.array([np.nan])}
    catalog = {item[0]: item for item in measures.MEASURES}
    assert measures.value_at(table, catalog["poc_dist"], 0, 1) is None


def test_cada_medida_tiene_su_columna():
    table = measures.compute("X", walk(300))
    row = measures.read_row(table, 299, 1)
    assert set(row) == {item[0] for item in measures.MEASURES}
    assert measures.read_row(table, 299, -1)["leg_15m"] == -row["leg_15m"]


def test_sin_sesion_del_mercado():
    """Cripto opera 24/7: la tabla mide la hora UTC y no la sesión del mercado"""
    table = measures.compute("X", walk(300))
    assert "session" not in {item[0] for item in measures.MEASURES}
    assert "session" not in measures.read_row(table, 299, 1)
    assert table["hour"][0] == (int(table["close_time"][0]) // 3600000) % 24


def test_la_columna_vieja_de_sesion_sigue_para_el_codigo_anterior():
    """Sin uso aquí: una tabla con VERSION 1 debe servirle también al código anterior, que la lee"""
    table = measures.compute("X", walk(300))
    hours = table["hour"]
    expected = [0 if hour < 7 else 1 if hour < 13 else 2 if hour < 21 else 3 for hour in hours]
    assert list(table["session"]) == expected


def test_tabla_se_guarda_y_vuelve(monkeypatch):
    monkeypatch.setattr(measures, "read_candles", lambda symbol: walk(300))
    assert measures.build("X") == 300
    table = measures._load("X")
    assert len(table["close_time"]) == 300
    assert not list(measures.table_dir().glob("*.tmp.npz"))


def test_tabla_de_otra_version_se_descarta(monkeypatch):
    monkeypatch.setattr(measures, "read_candles", lambda symbol: walk(300))
    measures.build("X")
    monkeypatch.setattr(measures, "VERSION", measures.VERSION + 1)
    measures._tables.clear()
    assert measures._load("X") is None


def test_tabla_hecha_con_la_sesion_sigue_sirviendo(monkeypatch):
    """Quitar la sesión no cambió ninguna fórmula: una tabla ya construida se lee sin reconstruirla"""
    monkeypatch.setattr(measures, "read_candles", lambda symbol: walk(300))
    measures.build("X")
    path = measures._table_path("X")
    with np.load(path) as stored:
        old = {name: stored[name] for name in stored.files}
    old["session"] = np.zeros(len(old["close_time"]), dtype=np.float32)
    np.savez_compressed(path, **old)
    measures._tables.clear()
    table = measures._load("X")
    assert table is not None
    assert set(measures.read_row(table, 299, 1)) == {item[0] for item in measures.MEASURES}


def fake_cache(tmp_path, monkeypatch):
    path = tmp_path / "X_cache.gz"
    path.write_bytes(b"x")
    monkeypatch.setattr(measures, "_cache_path", lambda symbol: path)
    starts = []
    monkeypatch.setattr(measures, "_start_build", lambda symbol: starts.append(symbol))
    return path, starts


def test_sin_tabla_se_prepara_aparte(tmp_path, monkeypatch):
    _, starts = fake_cache(tmp_path, monkeypatch)
    assert measures.table_for("X") is None
    assert starts == ["X"]
    assert measures.status("X") == "missing"


def test_sin_cache_no_hay_nada_que_preparar(tmp_path, monkeypatch):
    monkeypatch.setattr(measures, "_cache_path", lambda symbol: tmp_path / "no.gz")
    assert measures.table_for("X") is None
    assert measures.status("X") == "unavailable"


def test_tabla_vieja_se_rehace_solo_si_hay_velas_nuevas(tmp_path, monkeypatch):
    monkeypatch.setattr(measures, "read_candles", lambda symbol: walk(300))
    measures.build("X")
    path, starts = fake_cache(tmp_path, monkeypatch)
    table = measures._load("X")
    later = int(table["close_time"][-1]) + DAY

    import os
    stamp = measures._table_path("X").stat().st_mtime
    os.utime(path, (stamp - 100, stamp - 100))
    assert measures.table_for("X", later) is not None
    assert starts == []

    os.utime(path, (stamp + 100, stamp + 100))
    measures.table_for("X", later)
    assert starts == ["X"]

    starts.clear()
    measures.table_for("X", int(table["close_time"][10]))
    assert starts == [], "cubre esa fecha: no hace falta rehacerla"


def test_lee_velas_del_cache_sin_repetidos_ni_la_ultima(tmp_path, monkeypatch):
    import gzip
    rows = [{"timestamp": t, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 3} for t in (300, 100, 200, 200, 400)]
    data = {"timeframes": {tag: {"main": rows} for tag in ("5m", "15m", "1h", "4h")}}
    path = tmp_path / "X.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as file:
        json.dump(data, file)
    monkeypatch.setattr(measures, "_cache_path", lambda symbol: path)
    assert measures.read_candles("X")["15m"]["ts"].tolist() == [100, 200, 300]
