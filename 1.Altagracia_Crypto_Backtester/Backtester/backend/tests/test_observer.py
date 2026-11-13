"""Observador de App 1: lectura, registro, lectura oculta e informe. Uso: python -m pytest tests/test_observer.py"""
import json

import numpy as np
import pytest

import footprint_store
import observer
import oi_store

MINUTE = 60000
DAY = 86400000
T0 = 1780444800000 // MINUTE  # 2026-06-03 00:00 UTC, en minutos


# ==================== DATOS SINTETICOS ====================

def minutes_of(closes, volumes=None, start=T0):
    """Minutos consecutivos: cada uno abre donde cerro el anterior."""
    closes = np.asarray(closes, dtype=float)
    opens = np.r_[closes[0], closes[:-1]]
    return {
        "m": start + np.arange(len(closes)), "o": opens, "c": closes,
        "h": np.maximum(opens, closes), "l": np.minimum(opens, closes),
        "v": np.ones(len(closes)) if volumes is None else np.asarray(volumes, dtype=float),
    }


def test_velas_completas_y_sin_la_vela_en_formacion():
    data = minutes_of(np.arange(100.0, 145.0))  # 45 minutos: tres velas de 15
    bars = observer._bars(data, 15)
    assert bars["t"].tolist() == [T0, T0 + 15, T0 + 30]
    assert bars["o"][0] == 100 and bars["c"][0] == 114
    assert bars["v"].tolist() == [15, 15, 15]

    data = minutes_of(np.arange(100.0, 140.0))  # 40 minutos: la tercera sigue abierta
    assert observer._bars(data, 15)["t"].tolist() == [T0, T0 + 15]


def bars_from(rows, tf=15, start=T0):
    o, h, l, c, v = (np.array(col, dtype=float) for col in zip(*rows))
    return {"t": start + tf * np.arange(len(rows)), "o": o, "h": h, "l": l, "c": c, "v": v}


def test_contexto_mide_eficiencia_y_volumen_alcista():
    # Cierres 100, 110, 105, 115: neto 15, recorrido 25
    rows = [(100, 100, 100, 100, 10), (100, 110, 100, 110, 30), (110, 110, 105, 105, 10), (105, 115, 105, 115, 60)]
    bars = bars_from(rows)
    t = T0 + 4 * 15
    context = observer._context(bars, 15, t, 3)
    assert context["efficiency"] == pytest.approx(0.6)
    assert context["up_volume"] == pytest.approx(0.9)
    assert context["state"] == "up"


def test_contexto_solo_usa_velas_cerradas():
    rows = [(100, 100, 100, 100, 10), (100, 110, 100, 110, 30), (110, 110, 105, 105, 10), (105, 115, 105, 115, 60)]
    bars = bars_from(rows)
    early = observer._context(bars, 15, T0 + 3 * 15 + 14, 2)  # La cuarta vela cierra un minuto despues
    assert early["net"] == 5


def test_contexto_sin_velas_suficientes():
    bars = bars_from([(100, 100, 100, 100, 10)] * 3)
    assert observer._context(bars, 15, T0 + 45, 3) is None


def flat(count, price=100.0, volume=10.0):
    # Velas neutras con un rango de 1 para fijar el ATR
    return [(price, price + 0.5, price - 0.5, price, volume)] * count


def test_movimiento_con_volumen_se_conoce_al_terminar():
    up = [(100, 104, 100, 104, 30), (104, 108, 104, 108, 30), (108, 112, 108, 112, 30)]
    pause = [(112, 112.2, 111.8, 112, 10)] * 4
    bars = bars_from(flat(25) + up + pause)
    moves = observer._impulses(bars, 15)
    assert len(moves) == 1
    move = moves[0]
    assert move["d"] == 1 and move["hi"] == 112.2 and move["lo"] == 99.5, "el extremo sigue mientras dura el movimiento"
    assert move["first"] == T0 + 25 * 15
    # Ultima vela fuerte en 27. Pasan mas de 2 velas sin vela fuerte en la 30, y se conoce a su cierre
    assert move["known"] == T0 + 31 * 15
    assert move["t1"] == T0 + 29 * 15, "termina con la vela del extremo, la 28"


def test_movimiento_pequeno_no_cuenta():
    small = [(100, 100.6, 100, 100.6, 30)]
    pause = [(100.6, 100.7, 100.5, 100.6, 10)] * 4
    assert observer._impulses(bars_from(flat(25) + small + pause), 15) == []


def test_movimiento_sin_terminar_no_existe_todavia():
    up = [(100, 104, 100, 104, 30), (104, 108, 104, 108, 30)]
    assert observer._impulses(bars_from(flat(25) + up), 15) == []


def test_clusters_quedan_dentro_del_retroceso_permitido():
    prices = np.array([100.5, 105.0, 105.0, 195.0])
    volumes = np.array([1.0, 50.0, 50.0, 900.0])
    clusters = observer._volume_clusters(prices, volumes, 100.0, 200.0, 1)
    # El mayor volumen esta cerca del extremo, fuera del 85% al 20% de retroceso, asi que no cuenta
    assert all(cluster["x0"] >= 110 or cluster["x1"] <= 185 for cluster in clusters)
    assert not any(cluster["x0"] < 195 < cluster["x1"] for cluster in clusters)


def test_gap_del_movimiento_solo_si_sigue_abierto():
    highs = np.array([100.0, 110.0, 130.0, 135.0, 136.0])
    lows = np.array([95.0, 100.0, 99.0, 120.0, 125.0])
    bars15 = {"h": highs, "l": lows}
    gaps = observer._move_gaps(bars15, 0, 4, 4, 1)
    assert [(gap["x0"], gap["x1"]) for gap in gaps] == [(110.0, 120.0)]

    filled = {"h": highs, "l": np.array([95.0, 100.0, 99.0, 120.0, 109.0])}
    assert observer._move_gaps(filled, 0, 4, 4, 1) == []


def test_distancia_a_zona():
    zone = {"x0": 100.0, "x1": 110.0}
    assert observer._zone_gap(105, zone) == 0
    assert observer._zone_gap(111.1, zone) == pytest.approx(0.01)
    assert observer._zone_gap(99, zone) == pytest.approx(100 / 99 - 1)


def test_azar_cuenta_precios_del_lado_de_la_orden():
    zones = [{"x0": 99.0, "x1": 99.5}]
    chance = observer._zone_chance(zones, 100.0, 1, 0)
    # Precios de 99.98 a 98: entran los que caen entre 99.5 y 99
    assert chance == pytest.approx(0.26)
    assert observer._zone_chance(zones, 100.0, -1, 0) == 0


# ==================== OPEN INTEREST ====================

def fake_oi(monkeypatch, step_values, end=T0):
    times = end - 5 * np.arange(len(step_values))[::-1]
    monkeypatch.setattr(oi_store, "points", lambda symbol: (times, np.array(step_values, dtype=float)))


def test_oi_creciendo_en_cuatro_bloques(monkeypatch):
    fake_oi(monkeypatch, np.arange(1000.0, 1100.0))
    oi = observer._oi_window("BTCUSDT", T0 + 5)
    assert oi["dir"] == "up" and oi["rises"] == 3 and oi["change"] > 0


def test_oi_cayendo(monkeypatch):
    fake_oi(monkeypatch, np.arange(1100.0, 1000.0, -1))
    assert observer._oi_window("BTCUSDT", T0 + 5)["dir"] == "down"


def test_oi_mixto_si_un_bloque_se_devuelve(monkeypatch):
    values = list(range(1000, 1012)) * 8
    fake_oi(monkeypatch, values)
    assert observer._oi_window("BTCUSDT", T0 + 5)["dir"] == "mixed"


def test_oi_no_usa_un_dato_antes_de_publicarse(monkeypatch):
    values = [1000.0] * 60 + [9000.0]
    fake_oi(monkeypatch, values)
    before = observer._oi_window("BTCUSDT", T0 + 4)  # El ultimo dato se publica en T0 + 5
    after = observer._oi_window("BTCUSDT", T0 + 5)
    assert before["change"] == 0
    assert after["change"] > 0


def test_oi_sin_serie_o_vencido(monkeypatch):
    monkeypatch.setattr(oi_store, "points", lambda symbol: None)
    assert observer._oi_window("BTCUSDT", T0) is None
    fake_oi(monkeypatch, np.arange(1000.0, 1100.0))
    assert observer._oi_window("BTCUSDT", T0 + 31 + 5) is None, "serie terminada antes de la orden"


def test_oi_de_una_serie_pasada_sin_la_local(monkeypatch):
    # La suite (13/11/2026) pasa la serie local mas lo reciente de Bybit
    monkeypatch.setattr(oi_store, "points", lambda symbol: None)
    values = np.arange(1000.0, 1100.0)
    series = (T0 - 5 * np.arange(len(values))[::-1], values)
    oi = observer._oi_window("BTCUSDT", T0 + 5, series)
    assert oi["dir"] == "up" and oi["rises"] == 3


def test_la_suite_pide_los_dias_en_vivo_y_app_1_no(monkeypatch):
    asked = []

    def minutes(symbol, start, end, **kw):
        asked.append(kw)
        return minutes_of(np.arange(100.0, 160.0), start=end - 60)

    monkeypatch.setattr(footprint_store, "minutes", minutes)
    monkeypatch.setattr(oi_store, "points", lambda symbol: None)
    time = (T0 + 60) * MINUTE
    plain = observer.read_at("BTCUSDT", time, 1)
    values = np.arange(1000.0, 1100.0)
    suite = observer.read_at("BTCUSDT", time, 1, live=True, oi=(T0 + 55 - 5 * np.arange(len(values))[::-1], values))
    assert asked == [{}, {"live": True}], "App 1 llama al almacen como siempre"
    assert plain["oi"] is None and suite["oi"]["dir"] == "up"


# ==================== REGISTRO ====================

@pytest.fixture
def journal(tmp_path, monkeypatch):
    monkeypatch.setattr(observer, "OBSERVER_DIR", tmp_path)
    return tmp_path


READING = {
    "available": True, "time": 1, "price": 100.0, "side": 1,
    "context": {
        "240": {"state": "up", "efficiency": 0.4, "up_volume": 0.6},
        "60": {"state": "range", "efficiency": 0.2, "up_volume": 0.45},
    },
    "moves": {
        "240": {"count": 1, "chosen": {"t0": 1000, "t1": 1100, "d": 1, "lo": 90, "hi": 110, "ratio": 2, "atrs": 3, "score": 6, "known": 1100}},
        "60": {"count": 0, "chosen": None},
        "15": {"count": 0, "chosen": None},
    },
    "zones": [{"typ": "HVN", "tf": 240, "rank": 1, "x0": 95, "x1": 99}],
    "entry": {"zone": {"typ": "HVN", "tf": 240, "rank": 1, "x0": 95, "x1": 99}, "gap": 0.0, "near": True, "chance": 0.4},
    "oi": {"dir": "up", "change": 0.01, "rises": 3, "falls": 0},
    "volume": {"last_15m_ratio": 1.8},
}


def order(order_id="a", side="long", marks=None, **extra):
    return {
        "id": order_id, "symbol": "BTCUSDT", "time": 1780444800000, "timeframe": "15m", "type": "limit", "side": side,
        "entry": 100.0, "stop": 99.0, "target": 102.0, "quantity": 1.0, "marks": marks or {}, **extra,
    }


def with_reading(monkeypatch, reading=None):
    monkeypatch.setattr(observer, "read_at", lambda *args: reading or READING)


def close(order_id, pnl, price=102.0):
    observer.record_event(order_id, "close", {"time": 5, "price": price, "reason": "take_profit", "pnl": pnl, "pnl_percent": 1})


def test_la_lectura_no_sale_mientras_la_orden_sigue_viva(journal, monkeypatch):
    with_reading(monkeypatch)
    answer = observer.record_order(order())
    assert answer == {"id": "a"}, "la confirmacion no trae la lectura"

    pending = observer.list_trades()[0]
    assert pending["status"] == "pending"
    assert "reading" not in pending and "comparison" not in pending

    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    open_trade = observer.list_trades()[0]
    assert open_trade["status"] == "open"
    assert "reading" not in open_trade and "comparison" not in open_trade


def test_al_cerrar_se_revela_la_comparacion(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order(marks={"context4h": "up", "context1h": "up", "reasons": ["volume", "profile", "oi_up"]}))
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    close("a", 2.0)

    trade = observer.list_trades()[0]
    assert trade["status"] == "closed"
    assert "reading" not in trade, "solo se entrega la comparacion"
    rows = {row["block"]: row for row in trade["comparison"]["rows"]}
    assert rows["context_240"]["agree"] is True and rows["context_240"]["favor"] == "favor"
    assert rows["context_60"]["agree"] is False and rows["context_60"]["favor"] == "range"
    assert rows["move"]["agree"] is True
    assert rows["zone"]["agree"] is True and rows["zone"]["chance"] == 0.4
    assert rows["oi"]["agree"] is True
    assert rows["volume"]["rule"] == 1.8


def test_al_cancelar_tambien_se_revela(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("a", "cancel", {"time": 3})
    trade = observer.list_trades()[0]
    assert trade["status"] == "cancelled" and trade["comparison"]["available"] is True


def test_sin_marca_no_hay_coincidencia_ni_desacuerdo(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    close("a", 1.0)
    rows = observer.list_trades()[0]["comparison"]["rows"]
    assert all(row["agree"] is None for row in rows)


def test_orden_a_mercado_nace_abierta(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order(type="market", fill_time=1, fill_price=100.0))
    assert observer.trades()["a"]["status"] == "open"


def test_una_falla_de_lectura_no_pierde_la_orden(journal, monkeypatch):
    def broken(*args):
        raise RuntimeError("sin datos")
    monkeypatch.setattr(observer, "read_at", broken)
    observer.record_order(order())
    trade = observer.trades()["a"]
    assert trade["reading"]["available"] is False
    close("a", 1.0)
    assert observer.list_trades()[0]["comparison"]["available"] is False


def test_una_linea_cortada_no_invalida_el_registro(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order("a"))
    with open(journal / observer.JOURNAL_NAME, "a", encoding="utf-8") as file:
        file.write('{"event": "order", "id": "b", "sym')
        file.write("\n")
    observer.record_order(order("c"))
    assert set(observer.trades()) == {"a", "c"}


def test_el_registro_solo_agrega_lineas(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order("a"))
    first = (journal / observer.JOURNAL_NAME).read_text(encoding="utf-8")
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    second = (journal / observer.JOURNAL_NAME).read_text(encoding="utf-8")
    assert second.startswith(first)
    assert len(second.splitlines()) == 2
    assert all(json.loads(line) for line in second.splitlines())


def test_evento_desconocido():
    with pytest.raises(ValueError):
        observer.record_event("a", "borrar", {})


def test_resultado_en_r_incluye_costos():
    trade = {"status": "closed", "stop": 99.0, "fill_price": 100.0, "quantity": 2.0, "pnl": 3.0}
    assert observer.r_multiple(trade) == pytest.approx(1.5)
    assert observer.r_multiple({**trade, "stop": None}) is None
    assert observer.r_multiple({**trade, "status": "open"}) is None


def test_mismo_movimiento_por_solapamiento():
    move = {"t0": 1000, "t1": 1100}
    assert observer._overlap(1000 * MINUTE, 1100 * MINUTE, move) == 1
    assert observer._overlap(1050 * MINUTE, 1100 * MINUTE, move) == 1, "un rango mas corto dentro del movimiento"
    assert observer._overlap(1050 * MINUTE, 1150 * MINUTE, move) == pytest.approx(0.5)
    assert observer._overlap(1200 * MINUTE, 1300 * MINUTE, move) == 0


def test_comparacion_usa_el_rango_del_usuario(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order(ranges=[{"start": 1010 * MINUTE, "end": 1090 * MINUTE}, {"start": 1, "end": 2}]))
    close("a", 1.0)
    row = next(row for row in observer.list_trades()[0]["comparison"]["rows"] if row["block"] == "move")
    assert row["same"] is True and row["same_move"]["tf"] == "240"


# ==================== INFORME ====================

def fill_report(monkeypatch):
    plain = {**READING, "oi": {"dir": "down", "change": -0.01, "rises": 0, "falls": 3}}
    far = {**READING, "entry": {**READING["entry"], "near": False, "gap": 0.01}}
    monkeypatch.setattr(observer, "read_at", lambda *args: READING)
    for index, pnl in enumerate((2, 2, -1)):
        observer.record_order(order(f"w{index}", marks={"reasons": ["profile"]}))
        observer.record_event(f"w{index}", "fill", {"time": 2, "price": 100.0})
        close(f"w{index}", pnl)
    monkeypatch.setattr(observer, "read_at", lambda *args: plain)
    for index in range(3):
        observer.record_order(order(f"l{index}", marks={"reasons": ["oi_up"]}, blind=True))
        observer.record_event(f"l{index}", "fill", {"time": 2, "price": 100.0})
        close(f"l{index}", -1)
    monkeypatch.setattr(observer, "read_at", lambda *args: far)
    observer.record_order(order("r", rewound=True))
    close("r", 5)
    observer.record_order(order("p"))
    observer.record_order(order("c"))
    observer.record_event("c", "cancel", {"time": 3})


def row_of(result, key, table="conditions"):
    return next(row for row in result[table] if row["id"] == key)


def test_informe_cuenta_y_excluye_retrocesos(journal, monkeypatch):
    fill_report(monkeypatch)
    result = observer.report()
    assert result["counts"]["total"] == 8
    assert result["counts"]["closed"] == 6
    assert result["counts"]["pending"] == 1 and result["counts"]["cancelled"] == 1
    assert result["counts"]["rewound"] == 1
    assert result["overall"]["n"] == 6 and result["overall"]["wins"] == 2
    assert result["overall"]["avg_r"] == pytest.approx(0.0 / 6 + (2 + 2 - 1 - 3) / 6)
    assert result["small_sample"] is True

    with_rewound = observer.report(include_rewound=True)
    assert with_rewound["overall"]["n"] == 7


def test_informe_filtra_fecha_oculta(journal, monkeypatch):
    fill_report(monkeypatch)
    assert observer.report(blind="only")["overall"]["n"] == 3
    assert observer.report(blind="none")["overall"]["n"] == 3


def test_informe_compara_con_y_sin_cada_condicion(journal, monkeypatch):
    fill_report(monkeypatch)
    row = row_of(observer.report(), "oi_up")
    assert row["with"]["n"] == 3 and row["with"]["wins"] == 2
    assert row["without"]["n"] == 3 and row["without"]["wins"] == 0
    assert row["share"] == pytest.approx(0.5)


def test_informe_de_marcas_y_coincidencias(journal, monkeypatch):
    fill_report(monkeypatch)
    result = observer.report()
    assert row_of(result, "profile", "marks")["with"]["wins"] == 2
    agreement = {row["block"]: row for row in result["agreement"]}
    assert agreement["oi"] == {"block": "oi", "marked": 3, "agreed": 0}, "marco OI creciendo y la regla leyo caida"
    assert agreement["zone"]["agreed"] == 3


def test_informe_compara_zona_contra_azar(journal, monkeypatch):
    fill_report(monkeypatch)
    zones = observer.report()["zones"]
    assert zones["orders"] == 7 and zones["near"] == 6 and zones["chance"] == pytest.approx(0.4)


def test_mejores_contra_peores(journal, monkeypatch):
    fill_report(monkeypatch)
    rows = observer.report()["best_worst"]
    oi = next(row for row in rows if row["id"] == "oi_up")
    assert oi["best"] == 1 and oi["worst"] == 0.5, "el peor tercio son las dos primeras perdidas: una con OI y otra sin"


def test_informe_ordena_lo_que_mas_se_repite(journal, monkeypatch):
    fill_report(monkeypatch)
    habits = observer.report()["habits"]
    shares = [row["share"] for row in habits]
    assert shares == sorted(shares, reverse=True)
    assert {row["id"] for row in habits} == set(observer.RULE_PARTS)
    oi = next(row for row in habits if row["id"] == "oi_up")
    assert oi["share"] == pytest.approx(4 / 7), "las terminadas con lectura, cerradas o canceladas, no las vivas"


def test_informe_vacio(journal):
    result = observer.report()
    assert result["counts"]["total"] == 0 and result["overall"]["win_rate"] is None
    assert result["habits"] == [] and result["best_worst"] == []


def test_intervalo_de_acierto_es_ancho_con_pocas_operaciones():
    low, high = observer._wilson(4, 5)
    assert low < 0.4 and high > 0.95
    low, high = observer._wilson(400, 500)
    assert 0.76 < low < 0.8 < high < 0.84


# ==================== SIN FUTURO ====================

@pytest.fixture
def real_store():
    if footprint_store.continuous_days("BTCUSDT") is None:
        pytest.skip("Sin almacén local")


def cut_days(monkeypatch, end_min):
    """Hace que el almacén solo conozca lo ocurrido antes de end_min."""
    real_minutes, real_cells = footprint_store.minutes, footprint_store.cells
    monkeypatch.setattr(footprint_store, "minutes", lambda s, a, b: real_minutes(s, a, min(b, end_min)))
    monkeypatch.setattr(footprint_store, "cells", lambda s, a, b: real_cells(s, a, min(b, end_min)))


def test_recortar_los_datos_no_cambia_la_lectura(real_store, monkeypatch):
    day = 1787000000000 // DAY * DAY
    for offset in (3 * 3600000 + 17 * MINUTE, 11 * 3600000 + 45 * MINUTE, 22 * 3600000):
        time = day + offset
        for side in (1, -1):
            full = observer.read_at("BTCUSDT", time, side, 80000.0)
            with monkeypatch.context() as patched:
                cut_days(patched, time // MINUTE)
                short = observer.read_at("BTCUSDT", time, side, 80000.0)
            assert json.dumps(full, sort_keys=True) == json.dumps(short, sort_keys=True)


def test_el_precio_es_el_ultimo_minuto_cerrado(real_store):
    time = 1787000000000 // MINUTE * MINUTE
    reading = observer.read_at("BTCUSDT", time, 1)
    data = footprint_store.minutes("BTCUSDT", time // MINUTE - 5, time // MINUTE)
    assert reading["price"] == pytest.approx(float(data["c"][-1]))


def test_fecha_sin_trades(real_store):
    assert observer.read_at("BTCUSDT", 1500000000000, 1)["available"] is False


# ==================== FECHA OCULTA ====================

def fake_span(monkeypatch, first, last):
    import datetime as dt
    monkeypatch.setattr(footprint_store, "continuous_days", lambda symbol: (dt.date.fromisoformat(first), dt.date.fromisoformat(last)))


def test_fecha_oculta_respeta_los_margenes(journal, monkeypatch):
    fake_span(monkeypatch, "2025-01-01", "2026-01-01")
    start = 1735689600000  # 2025-01-01
    for _ in range(20):
        result = observer.blind_start("BTCUSDT", 0, 1 << 60)
        assert start + 45 * DAY <= result["timestamp"] <= start + (365 - 14) * DAY
        (journal / observer.JOURNAL_NAME).unlink()


def test_fecha_oculta_no_repite_cerca_de_las_usadas(journal, monkeypatch):
    fake_span(monkeypatch, "2025-01-01", "2026-01-01")
    used = []
    while True:
        result = observer.blind_start("BTCUSDT", 0, 1 << 60)
        if result["timestamp"] is None:
            break
        assert all(abs(result["timestamp"] - time) >= (14 - 1) * DAY for time in used)
        used.append(result["timestamp"])
    assert 8 <= len(used) <= 22
    assert "No quedan" in result["reason"]


def test_fecha_oculta_respeta_las_velas_cargadas(journal, monkeypatch):
    fake_span(monkeypatch, "2025-01-01", "2026-01-01")
    first = 1735689600000 + 200 * DAY
    result = observer.blind_start("BTCUSDT", first, 1 << 60)
    assert result["timestamp"] >= first + 45 * DAY


def test_fecha_oculta_sin_almacen(journal, monkeypatch):
    monkeypatch.setattr(footprint_store, "continuous_days", lambda symbol: None)
    assert observer.blind_start("BTCUSDT", 0, 1)["timestamp"] is None


def image(kind, path, sim_time=2):
    return {"kind": kind, "path": path, "sim_time": sim_time, "frame": "15m"}


def test_la_imagen_no_sale_mientras_la_orden_sigue_viva(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("a", "image", image("decision", "s/a.png"))
    assert "images" not in observer.list_trades()[0]
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    observer.record_event("a", "image", image("entry", "s/b.png"))
    assert "images" not in observer.list_trades()[0]
    close("a", 5.0)
    assert observer.list_trades()[0]["images"] == {
        "decision": {"path": "s/a.png", "sim_time": 2, "frame": "15m"},
        "entry": {"path": "s/b.png", "sim_time": 2, "frame": "15m"},
    }


def test_la_imagen_guarda_donde_quedo_cada_marca(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    markers = [{"id": "Volumen de Respuesta|Rombo|7", "x": 0.4, "y": 0.6}]
    observer.record_event("a", "image", {**image("entry", "s/b.png"), "markers": markers})
    close("a", 5.0)
    assert observer.list_trades()[0]["images"]["entry"]["markers"] == markers


def test_la_imagen_de_cierre_llega_despues_de_cerrar(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    close("a", 5.0)
    observer.record_event("a", "image", image("exit", "s/c.png", 9))
    assert observer.list_trades()[0]["images"]["exit"]["sim_time"] == 9


def test_una_orden_cancelada_muestra_la_imagen_de_su_decision(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("a", "image", image("decision", "s/a.png"))
    observer.record_event("a", "cancel", {"time": 3})
    assert list(observer.list_trades()[0]["images"]) == ["decision"]


def test_imagen_de_una_orden_desconocida_se_ignora(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("otra", "image", image("entry", "s/a.png"))
    assert "images" not in observer.trades()["a"]


def test_la_imagen_no_cambia_la_orden(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order())
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    before = dict(observer.trades()["a"])
    observer.record_event("a", "image", image("entry", "s/a.png"))
    after = dict(observer.trades()["a"])
    after.pop("images")
    assert after == before


def test_el_informe_no_cuenta_los_motivos_de_una_orden_viva(journal, monkeypatch):
    with_reading(monkeypatch)
    observer.record_order(order(marks={"reasons": ["volume", "profile"]}))
    assert observer.report()["agreement"] == []


def test_informe_por_setup_cuenta_los_setups_elegidos(journal, monkeypatch):
    with_reading(monkeypatch)
    s14 = {"source": "Elementos OF", "kind": "Setup S14 (Delta Breakout) alcista: DB, ST", "price": 100.0, "role": "mark"}
    s14_otra_vela = {**s14, "kind": "Setup S14 (Delta Breakout) alcista: DB"}
    propia = {"source": "Elementos OF", "kind": "Setup MR bajista: SW", "price": 100.0}
    otro = {"source": "S&R", "kind": "Setup S99 alcista", "price": 100.0}
    observer.record_order(order("a", levels=[s14, s14_otra_vela]))
    observer.record_event("a", "fill", {"time": 2, "price": 100.0})
    close("a", 2.0)
    observer.record_order(order("b", levels=[s14, propia]))
    observer.record_event("b", "fill", {"time": 2, "price": 100.0})
    close("b", -1.0, price=99.0)
    observer.record_order(order("c", levels=[otro]))
    observer.record_event("c", "fill", {"time": 2, "price": 100.0})
    close("c", 1.0)
    observer.record_order(order("d", levels=[s14]))  # Sin cerrar: no cuenta

    rows = {row["id"]: row for row in observer.report()["setups"]}
    assert set(rows) == {"S14", "MR"}, "solo setups de Elementos OF"
    assert rows["S14"]["name"] == "Delta Breakout"
    assert rows["S14"]["with"]["n"] == 2 and rows["S14"]["with"]["wins"] == 1, "una orden cuenta una vez cada setup"
    assert rows["S14"]["without"]["n"] == 1
    assert rows["MR"]["with"]["n"] == 1 and rows["MR"]["name"] == "MR"
