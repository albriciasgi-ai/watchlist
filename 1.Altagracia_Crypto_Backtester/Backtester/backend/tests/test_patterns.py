"""Registro automático, patrones y reglas. Uso: python -m pytest tests/test_patterns.py"""
import csv
import io
import json

import numpy as np
import pytest

import footprint_store
import measures
import observer
import oi_store
import patterns

MINUTE = 60000
DAY = 86400000
T0 = 1780444800000


def walk(count=3000, seed=3):
    rng = np.random.default_rng(seed)
    close = 1000 + np.cumsum(rng.normal(0, 5, count))
    open_ = np.r_[1000.0, close[:-1]]
    wick = rng.random(count) * 3
    base = {
        "ts": T0 + np.arange(count, dtype=np.int64) * 15 * MINUTE, "open": open_, "close": close,
        "high": np.maximum(open_, close) + wick, "low": np.minimum(open_, close) - wick, "volume": 10 + rng.random(count) * 90,
    }

    def group(size):
        usable = count // size * size
        return {
            "ts": base["ts"][:usable:size], "open": base["open"][:usable:size], "close": base["close"][:usable].reshape(-1, size)[:, -1],
            "high": base["high"][:usable].reshape(-1, size).max(axis=1), "low": base["low"][:usable].reshape(-1, size).min(axis=1),
            "volume": base["volume"][:usable].reshape(-1, size).sum(axis=1),
        }

    return {"15m": base, "1h": group(4), "4h": group(16)}


@pytest.fixture(scope="module")
def table():
    original = oi_store.points
    oi_store.points = lambda symbol: None
    built = measures.compute("BTCUSDT", walk())
    oi_store.points = original
    built["m5_time"] = built["close_time"] - 15 * MINUTE
    built["m5_high"] = built["high"]
    built["m5_low"] = built["low"]
    return built


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path, table, request):
    monkeypatch.setattr(observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(footprint_store, "STORE_DIR", tmp_path / "store")
    monkeypatch.setattr(measures, "table_for", lambda symbol, until_ms=None: table)
    monkeypatch.setattr(measures, "status", lambda symbol: "ready")
    monkeypatch.setattr(observer, "read_at", lambda symbol, time, side, entry=None: {"available": False, "missing": "trades", "time": time})


def trade(**changes):
    return {
        "id": "a", "symbol": "BTCUSDT", "side": "long", "time": T0 + 1000 * 15 * MINUTE, "type": "limit", "entry": 100.0, "stop": 98.0,
        "target": 104.0, "market": 101.0, "quantity": 1, "status": "pending", **changes,
    }


def record(identifier, row, table, side="long", won=None, **changes):
    """Orden registrada en una vela. won cierra la orden ganando o perdiendo."""
    time = int(table["close_time"][row]) + MINUTE
    price = float(table["close"][row])
    sign = 1 if side == "long" else -1
    observer.record_order({
        "id": identifier, "symbol": "BTCUSDT", "side": side, "time": time, "type": "market", "entry": price, "stop": price - sign * 10,
        "target": price + sign * 20, "market": price, "quantity": 1, "session": "s", "fill_time": time, "fill_price": price, **changes,
    })
    if won is not None:
        observer.record_event(identifier, "close", {"time": time + 60 * MINUTE, "price": price + sign * (20 if won else -10), "reason": "tp" if won else "sl", "pnl": 20 if won else -10})
    return time


def test_la_orden_en_unidades_comparables():
    result = patterns.order_measures(trade(), 2.0)
    assert result == {"order_type": "limit", "stop_atr": 1, "reward_risk": 2, "entry_gap_atr": 0.5}


def test_entrada_mejor_que_el_mercado_tambien_en_cortos():
    assert patterns.order_measures(trade(side="short", market=99.0), 2.0)["entry_gap_atr"] == 0.5


def test_orden_sin_stop_ni_objetivo():
    result = patterns.order_measures(trade(stop=None, target=None), 2.0)
    assert result["stop_atr"] is None and result["reward_risk"] is None


def test_precios_de_cada_dibujo():
    assert patterns.drawing_prices({"type": "horizontal", "price": 105}, 0) == [("Línea horizontal", 105)]
    line = {"type": "trendline", "price1": 100, "time1": 0, "price2": 110, "time2": 10}
    assert patterns.drawing_prices(line, 20) == [("Línea de tendencia", 120)], "se prolonga hasta la orden"
    assert patterns.drawing_prices({**line, "time2": 0}, 20) == []
    assert [price for _, price in patterns.drawing_prices({"type": "rectangle", "high": 9, "low": 7}, 0)] == [9, 7]
    fib = {"type": "fibonacci", "levels": [{"label": "50%", "price": 5}]}
    assert patterns.drawing_prices(fib, 0) == [("Fibonacci 50%", 5)]
    assert patterns.drawing_prices({"type": "vertical", "time": 5}, 0) == []


def test_referencias_desde_la_entrada():
    item = trade(levels=[{"source": "VP Fixed Range", "kind": "POC", "price": 99.6}], drawings=[{"type": "horizontal", "price": 104.2}])
    result = patterns.references(item, 2.0)
    assert result["ref_count"] == 2 and result["ref_levels"] == 1 and result["ref_drawings"] == 1
    assert result["ref_behind_atr"] == 0.2
    assert result["ref_ahead_atr"] == 2.1
    assert result["ref_nearest_label"] == "POC · VP Fixed Range"
    assert result["ref_at_entry"] is True
    assert result["ref_stop_behind"] is True, "el stop está más lejos que el nivel que protege"
    assert result["ref_target_at"] is True


def test_una_marca_sin_papel_no_es_una_referencia():
    item = trade(levels=[{"source": "Volumen de Respuesta", "kind": "Rombo", "price": 99.6, "role": "", "mark": True, "time": 5}])
    assert patterns.references(item, 2.0) == {"items": [], "ref_count": 0}


def test_referencias_con_su_papel():
    levels = [
        {"source": "Order Flow", "kind": "POC de la vela", "price": 99.8, "role": "entry"},
        {"source": "S&R v2", "kind": "Resistencia", "price": 104.6, "role": "target"},
        {"source": "Volume Profile", "kind": "VAL", "price": 98.0, "role": "support"},
        {"source": "Volume Profile", "kind": "POC", "price": 101.0},
        {"source": "Volumen de Respuesta", "kind": "Rombo", "price": 97.0, "role": "support", "mark": True},
    ]
    result = patterns.references(trade(levels=levels), 2.0)
    assert [item.get("role") for item in result["items"]] == ["Entrada", "Objetivo", "Soporte", None, "Soporte"]
    assert result["ref_entry_atr"] == 0.1, "la entrada en 100 quedó a 0.2 de su nivel de entrada"
    assert result["ref_target_atr"] == 0.3, "el objetivo en 104 quedó a 0.6 de su nivel objetivo"


def test_sin_nivel_con_ese_papel_no_hay_distancia():
    result = patterns.references(trade(levels=[{"source": "VP", "kind": "POC", "price": 99.0, "role": "support"}]), 2.0)
    assert result["ref_entry_atr"] is None and result["ref_target_atr"] is None


def test_referencias_en_cortos_se_miran_al_reves():
    item = trade(side="short", stop=102.0, target=96.0, drawings=[{"type": "horizontal", "price": 101.0}])
    result = patterns.references(item, 2.0)
    assert result["ref_behind_atr"] == 0.5
    assert result["ref_ahead_atr"] is None
    assert result["ref_stop_behind"] is True


def test_stop_delante_del_nivel():
    item = trade(stop=99.8, drawings=[{"type": "horizontal", "price": 99.0}])
    assert patterns.references(item, 1.0)["ref_stop_behind"] is False


def test_sin_referencias():
    assert patterns.references(trade(), 2.0) == {"items": [], "ref_count": 0}


def test_referencia_lejos_no_cuenta_como_en_el_nivel():
    item = trade(drawings=[{"type": "horizontal", "price": 90.0}])
    result = patterns.references(item, 2.0)
    assert result["ref_at_entry"] is False and result["ref_target_at"] is False


def closed_trade(table, row, **changes):
    fill = int(table["m5_time"][row])
    price = float(table["close"][row - 1])
    return {
        **trade(), "time": fill - 30 * MINUTE, "fill_time": fill, "fill_price": price, "stop": price - 10, "status": "closed",
        "exit_time": fill + 75 * MINUTE, "exit_price": price + 5, "exit_reason": "manual", "pnl": 5, "quantity": 1, "entry": price, **changes,
    }


def test_resultado_en_riesgo_y_excursion(table):
    item = closed_trade(table, 500)
    result = patterns.outcome(item, table)
    assert result["filled"] is True and result["wait_minutes"] == 30 and result["duration_minutes"] == 75
    assert result["r"] == 0.5
    start = item["fill_price"]
    assert result["best_r"] == pytest.approx((max(float(table["m5_high"][500:505].max()), start + 5) - start) / 10, abs=1e-3)
    assert result["worst_r"] == pytest.approx((min(float(table["m5_low"][500:505].min()), start) - start) / 10, abs=1e-3)


def test_excursion_de_un_corto(table):
    item = closed_trade(table, 500, side="short", stop=None)
    start = item["fill_price"]
    item["stop"] = start + 10
    item["exit_price"] = start - 5
    result = patterns.outcome(item, table)
    assert result["best_r"] == pytest.approx((start - min(float(table["m5_low"][500:505].min()), start - 5)) / 10, abs=1e-3)
    assert result["worst_r"] == pytest.approx((start - max(float(table["m5_high"][500:505].max()), start)) / 10, abs=1e-3)


def test_orden_sin_llenar_no_tiene_excursion(table):
    result = patterns.outcome(trade(status="cancelled"), table)
    assert result["filled"] is False and result["r"] is None and result["best_r"] is None


def test_lectura_al_decidir_y_al_llenarse(table):
    decision = int(table["close_time"][1000]) + MINUTE
    fill = int(table["close_time"][1010]) + MINUTE
    result = patterns.reading(trade(time=decision, fill_time=fill, fill_price=100.0), table)
    assert result["available"] is True
    assert result["decision"] == measures.read_row(table, 1000, 1)
    assert result["fill"] == measures.read_row(table, 1010, 1)
    assert result["decision_candle"] == int(table["close_time"][1000])
    assert result["fill_candle"] == int(table["close_time"][1010])


def test_si_se_llena_en_la_misma_vela_no_repite_lectura(table):
    decision = int(table["close_time"][1000]) + MINUTE
    result = patterns.reading(trade(time=decision, fill_time=decision + MINUTE, fill_price=100.0), table)
    assert "fill" not in result and "fill_candle" not in result


def test_lectura_sin_tabla_o_fuera_de_ella(table, monkeypatch):
    monkeypatch.setattr(measures, "table_for", lambda symbol, until_ms=None: None)
    monkeypatch.setattr(measures, "status", lambda symbol: "building")
    assert patterns.reading(trade()) == {"available": False, "status": "building"}
    assert patterns.reading(trade(time=0), table) == {"available": False, "status": "outside"}


def test_las_medidas_solo_aparecen_cuando_la_orden_termina(table):
    record("abierta", 1000, table)
    record("cerrada", 1100, table, won=True)
    views = {item["id"]: item for item in patterns.orders()}
    assert "automatic" not in views["abierta"]
    assert views["cerrada"]["automatic"]["available"] is True


def test_una_orden_cancelada_tambien_muestra_sus_medidas(table):
    record("c", 1000, table, fill_time=None, fill_price=None)
    observer.record_event("c", "cancel", {"time": int(table["close_time"][1001])})
    assert "automatic" in patterns.orders()[0]


def test_controles_lejos_de_las_entradas_y_repetibles(table):
    rows = [1000, 1400]
    group = [trade(id=str(row), time=int(table["close_time"][row]) + MINUTE) for row in rows]
    first = patterns.control_rows(table, group)
    assert len(first) == 2 * patterns.CONTROLS_PER_TRADE
    assert first == patterns.control_rows(table, group)


def test_control_no_cae_cerca_de_otra_entrada(table, monkeypatch):
    picked = []
    original = measures.read_row
    monkeypatch.setattr(measures, "read_row", lambda data, index, side: picked.append(index) or original(data, index, side))
    time = int(table["close_time"][1000])
    patterns.control_rows(table, [trade(id=str(i), time=time) for i in range(30)])
    assert picked
    assert all(abs(int(table["close_time"][index]) - time) > patterns.CONTROL_GAP_MINUTES * MINUTE for index in picked)
    assert all(abs(int(table["close_time"][index]) - time) <= patterns.CONTROL_WINDOW_DAYS * DAY for index in picked)


def test_control_mira_desde_el_lado_de_la_orden(table, monkeypatch):
    sides = []
    original = measures.read_row
    monkeypatch.setattr(measures, "read_row", lambda data, index, side: sides.append(side) or original(data, index, side))
    patterns.control_rows(table, [trade(side="short")])
    assert set(sides) == {-1}


LABELS = {"a": ("Medida A", "G"), "b": ("Medida B", "G")}


def test_una_diferencia_real_se_marca():
    first = [{"a": float(value)} for value in range(100, 130)]
    second = [{"a": float(value)} for value in range(0, 60)]
    result = patterns.compare_groups(first, second, ["a"], LABELS)
    row = result["rows"][0]
    assert row["share"] == 1
    assert row["clear"] is True
    assert row["first_median"] == 114.5


def test_el_azar_no_se_marca():
    rng = np.random.default_rng(1)
    first = [{f"m{i}": float(rng.normal()) for i in range(30)} for _ in range(30)]
    second = [{f"m{i}": float(rng.normal()) for i in range(30)} for _ in range(120)]
    labels = {f"m{i}": (f"M{i}", "G") for i in range(30)}
    result = patterns.compare_groups(first, second, list(labels), labels)
    assert sum(row["clear"] for row in result["rows"]) <= 1, "revisar 30 medidas no debe llenar de falsos patrones"


def test_pocos_datos_no_se_comparan():
    first = [{"a": 1.0}] * 3
    second = [{"a": 2.0}] * 40
    assert patterns.compare_groups(first, second, ["a"], LABELS)["rows"] == []


def test_medida_vacia_o_igual_no_se_compara():
    first = [{"a": None, "b": 1.0}] * 20
    second = [{"a": None, "b": 1.0}] * 20
    assert patterns.compare_groups(first, second, ["a", "b"], LABELS)["rows"] == []


def test_ordena_por_lo_que_mas_separa():
    first = [{"a": float(i % 2), "b": 10.0 + i} for i in range(20)]
    second = [{"a": float(i % 2), "b": float(i % 5)} for i in range(20)]
    assert patterns.compare_groups(first, second, ["a", "b"], LABELS)["rows"][0]["key"] == "b"


def test_informe_cuenta_entradas_controles_y_resultados(table):
    for index in range(12):
        record(f"t{index}", 800 + index * 150, table, won=index % 2 == 0)
    result = patterns.report("BTCUSDT")
    assert result["status"] == "ready"
    assert result["counts"]["entries"] == 12
    assert result["counts"]["controls"] == 120
    assert result["counts"]["winners"] == 6 and result["counts"]["losers"] == 6
    assert result["small_sample"] is True
    assert result["entries"]["rows"], "ya alcanza para comparar con los controles"


def test_informe_no_compara_categorias(table):
    for index in range(12):
        record(f"t{index}", 800 + index * 150, table, won=True)
    keys = {row["key"] for row in patterns.report("BTCUSDT")["entries"]["rows"]}
    assert "hour" not in keys


def test_informe_excluye_retrocesos_salvo_que_se_pida(table):
    record("a", 1000, table, won=True)
    record("b", 1100, table, won=True, rewound=True)
    assert patterns.report("BTCUSDT")["counts"]["entries"] == 1
    assert patterns.report("BTCUSDT", include_rewound=True)["counts"]["entries"] == 2


def test_informe_por_fecha_oculta_y_simbolo(table):
    record("a", 1000, table, won=True, blind=True)
    record("b", 1100, table, won=False)
    record("c", 1200, table, won=True, symbol="ETHUSDT")
    assert patterns.report("BTCUSDT", blind="only")["counts"]["entries"] == 1
    assert patterns.report("BTCUSDT", blind="none")["counts"]["entries"] == 1


def test_informe_compara_entrar_en_el_nivel(table):
    near = {"drawings": [{"type": "horizontal", "price": float(table["close"][1000])}]}
    record("cerca", 1000, table, won=True, **near)
    far = {"drawings": [{"type": "horizontal", "price": float(table["close"][1100]) - 1000}]}
    record("lejos", 1100, table, won=False, **far)
    record("sin", 1200, table, won=True)
    references = patterns.report("BTCUSDT")["references"]
    assert references == {"with_reference": 2, "closed_at_level": 1, "closed_away": 1, "win_at_level": 1, "win_away": 0}


def test_sin_sesion_del_mercado(table):
    """Cripto opera 24/7: ni el informe ni la lectura de cada orden usan sesiones del mercado. La hora sigue"""
    record("a", 1000, table, won=True)
    assert "sessions" not in patterns.report("BTCUSDT")
    decision = patterns.orders()[0]["automatic"]["decision"]
    assert "session" not in decision and "hour" in decision


def test_informe_avisa_si_la_tabla_no_esta(monkeypatch):
    monkeypatch.setattr(measures, "table_for", lambda symbol, until_ms=None: None)
    monkeypatch.setattr(measures, "status", lambda symbol: "building")
    assert patterns.report("BTCUSDT") == {"status": "building"}


def test_registro_en_tabla(table):
    record("a", 1000, table, won=True, drawings=[{"type": "horizontal", "price": float(table["close"][1000])}])
    rows = list(csv.reader(io.StringIO(patterns.export_csv("BTCUSDT"))))
    head, row = rows[0], rows[1]
    data = dict(zip(head, row))
    assert data["id"] == "a" and data["lado"] == "long" and data["estado"] == "closed"
    assert data["r"] == "2.0"
    assert data["en_referencia"] == "True"
    assert data["entrada_contra_nivel_atr"] == "" and "objetivo_contra_nivel_atr" in head
    assert data["pressure_15m"] != "" and "llenado_pressure_15m" in head
    assert "session" not in head and "llenado_session" not in head and "hour" in head
    assert data["sesion"] == "s", "la sesión de trabajo de la orden sigue en el registro"


def test_registro_sin_tabla_guarda_los_hechos(table, monkeypatch):
    record("a", 1000, table, won=True)
    monkeypatch.setattr(measures, "table_for", lambda symbol, until_ms=None: None)
    rows = list(csv.reader(io.StringIO(patterns.export_csv("BTCUSDT"))))
    assert rows[1][0] == "a"


def test_marcar_motivos_despues_de_cerrar(table):
    record("a", 1000, table, won=True)
    observer.record_event("a", "marks", {"marks": {"reasons": ["fvg"], "context4h": None, "context1h": None}})
    assert observer.trades()["a"]["marks"]["reasons"] == ["fvg"]


def rule_table(highs, lows, closes, atr=10.0):
    count = len(closes)
    return {
        "close_time": T0 + np.arange(count, dtype=np.int64) * 15 * MINUTE, "high": np.array(highs, dtype=float), "low": np.array(lows, dtype=float),
        "close": np.array(closes, dtype=float), "atr": np.full(count, atr),
    }


def test_simulacion_objetivo_stop_y_salida_por_tiempo():
    data = rule_table([100, 125, 100], [100, 100, 100], [100, 100, 100])
    result = patterns._simulate(data, [0], 1, 1, 2, 2)
    assert result[0][1] == pytest.approx(2 - 2 * patterns.TAKER_FEE * 100 / 10)

    data = rule_table([100, 100, 100], [100, 85, 100], [100, 100, 100])
    assert patterns._simulate(data, [0], 1, 1, 2, 2)[0][1] == pytest.approx(-1 - 2 * patterns.TAKER_FEE * 100 / 10)

    data = rule_table([100, 105, 105], [100, 95, 95], [100, 102, 105])
    assert patterns._simulate(data, [0], 1, 1, 2, 2)[0][1] == pytest.approx(0.5 - 2 * patterns.TAKER_FEE * 100 / 10)


def test_simulacion_si_ambos_caen_en_la_misma_vela_cuenta_el_stop():
    data = rule_table([100, 125, 100], [100, 85, 100], [100, 100, 100])
    assert patterns._simulate(data, [0], 1, 1, 2, 2)[0][1] < 0


def test_simulacion_de_un_corto():
    data = rule_table([100, 100, 100], [100, 75, 100], [100, 100, 100])
    assert patterns._simulate(data, [0], -1, 1, 2, 2)[0][1] > 0


def test_simulacion_ignora_el_final_sin_horizonte():
    data = rule_table([100, 100], [100, 100], [100, 100])
    assert patterns._simulate(data, [0], 1, 1, 2, 5) == []


def test_senales_separadas():
    assert patterns._spaced([1, 2, 3, 10, 11, 30], 5) == [1, 10, 30]


CONDITION = [{"key": "pressure_15m", "op": ">=", "value": 0.5}]


def test_regla_cuenta_senales_y_compara_con_la_base():
    result = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=8)
    assert result["status"] == "ready"
    assert result["signals"] > 20
    assert result["base"]["signals"] > result["signals"]
    assert result["difference_r"] == pytest.approx(result["avg_r"] - result["base"]["avg_r"])
    assert sum(item["signals"] for item in result["years"]) == result["signals"]


def test_regla_ambos_lados_suma_las_dos_direcciones():
    long_side = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=8)
    short_side = patterns.rule_test("BTCUSDT", CONDITION, side="short", horizon=20, cooldown=8)
    both = patterns.rule_test("BTCUSDT", CONDITION, side="both", horizon=20, cooldown=8)
    assert both["signals"] == long_side["signals"] + short_side["signals"]


def test_regla_condiciones_se_suman():
    wide = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=1)
    narrow = patterns.rule_test("BTCUSDT", CONDITION + [{"key": "vol_rel_15m", "op": ">=", "value": 1.2}], side="long", horizon=20, cooldown=1)
    assert 0 < narrow["signals"] < wide["signals"]


def test_regla_no_se_prueba_en_fechas_operadas(table):
    before = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=1)
    record("a", 1000, table, won=True)
    after = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=1)
    assert after["excluded_periods"] == 1
    assert after["signals"] < before["signals"]


def test_regla_invalida():
    for conditions in ([], CONDITION * 4, [{"key": "nada", "op": ">=", "value": 1}], [{"key": "session", "op": ">=", "value": 1}],
                       [{"key": "pressure_15m", "op": "==", "value": 1}], [{"key": "pressure_15m", "op": ">=", "value": "x"}]):
        with pytest.raises(ValueError):
            patterns.rule_test("BTCUSDT", conditions)
    with pytest.raises(ValueError):
        patterns.rule_test("BTCUSDT", CONDITION, stop_atr=0)
    with pytest.raises(ValueError):
        patterns.rule_test("BTCUSDT", CONDITION, side="otro")


def test_regla_sin_senales_no_falla():
    result = patterns.rule_test("BTCUSDT", [{"key": "pressure_15m", "op": ">=", "value": 99}], side="long", horizon=20)
    assert result["signals"] == 0 and result["avg_r"] is None and result["difference_r"] is None


def test_regla_avisa_si_la_tabla_no_esta(monkeypatch):
    monkeypatch.setattr(measures, "table_for", lambda symbol, until_ms=None: None)
    monkeypatch.setattr(measures, "status", lambda symbol: "missing")
    assert patterns.rule_test("BTCUSDT", CONDITION) == {"status": "missing"}


def test_una_orden_viva_no_entra_en_el_informe_ni_en_el_csv(table):
    row = 1000
    observer.record_order({
        "id": "viva", "symbol": "BTCUSDT", "time": int(table["close_time"][row]) + MINUTE, "timeframe": "15m", "type": "limit", "side": "long",
        "entry": 100.0, "stop": 99.0, "target": 102.0, "quantity": 1.0, "marks": {},
    })
    assert patterns.report("BTCUSDT", "all", False)["counts"]["entries"] == 0
    assert observer.report("BTCUSDT")["counts"]["without_reading"] == 0

    lines = list(csv.reader(io.StringIO(patterns.export_csv("BTCUSDT"))))
    row_values = dict(zip(lines[0], lines[1]))
    assert row_values["estado"] == "pending"
    assert row_values[measures.MEASURES[0][0]] == ""


def test_el_csv_oculta_las_fechas_de_una_orden_con_fecha_oculta(table):
    record("a", 1000, table, won=True, blind=True)
    record("b", 1100, table, won=True)

    def dates(hide):
        lines = list(csv.reader(io.StringIO(patterns.export_csv("BTCUSDT", hide))))
        return {row[0]: (row[lines[0].index("decision_utc")], row[lines[0].index("llenado_utc")], row[lines[0].index("cierre_utc")]) for row in lines[1:]}

    assert dates(True)["a"] == ("", "", "")
    assert all(dates(True)["b"]) and all(dates(False)["a"])


def test_el_csv_no_acota_la_fecha_oculta_con_su_lugar(table):
    record("mayo", 1000, table, won=True)
    record("oculta", 1100, table, won=True, blind=True)
    record("julio", 1200, table, won=True)

    def order(hide):
        lines = list(csv.reader(io.StringIO(patterns.export_csv("BTCUSDT", hide))))
        return [row[0] for row in lines[1:]]

    assert order(True) == ["mayo", "julio", "oculta"]
    assert order(False) == ["mayo", "oculta", "julio"]


def test_los_controles_no_pasan_de_lo_vivido(table):
    record("a", 1000, table, won=True)
    group = [trade for trade in observer.trades().values()]
    until = int(table["close_time"][1000]) + 2 * 3600000
    seen = []
    original = measures.read_row

    def spy(source, row, side):
        seen.append(int(source["close_time"][row]))
        return original(source, row, side)

    measures.read_row = spy
    try:
        patterns.control_rows(table, group, until)
    finally:
        measures.read_row = original
    assert seen and max(seen) <= until


def test_una_regla_solo_usa_resultados_ya_vividos(table):
    whole = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=8)
    until = int(table["close_time"][1500])
    limited = patterns.rule_test("BTCUSDT", CONDITION, side="long", horizon=20, cooldown=8, until=until)
    assert 0 < limited["signals"] < whole["signals"]
