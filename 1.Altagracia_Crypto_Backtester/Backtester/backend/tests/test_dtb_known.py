"""Double Top/Bottom sin futuro: cuando se conoce cada patron. Uso: python -m pytest tests/test_dtb_known.py"""
import copy

import pytest
from fastapi.testclient import TestClient

import main
from double_topbottom_detector import DoubleTopBottomDetector, DoublePattern, serialize_pattern

HOUR = 3600000
START = 1780444800000


def candle(i, low, high, open_=None, close=None, volume=100.0):
    return {
        "timestamp": START + i * HOUR, "open": low + 1 if open_ is None else open_, "high": high, "low": low,
        "close": high - 1 if close is None else close, "volume": volume,
    }


def series(count=60):
    return [candle(i, 95, 105) for i in range(count)]


def pattern(first, second, index, level=100.0, confidence=70.0, kind="DOUBLE_TOP"):
    extreme = lambda ts, i: {"timestamp": ts, "price": level, "candle_index": i, "rejection_pattern": "SHOOTING_STAR", "pattern_quality": 1.0, "volume_zscore": 0.0}
    return DoublePattern(
        type=kind, timestamp=second, confidence=confidence, first_extreme=extreme(first, index - 5),
        second_extreme=extreme(second, index), level_price=level, price_variance=0.0,
    )


CONFIG = {"doubleTopBottom": {"candlesPerExtreme": 5}, "filters": {"postPatternValidationCandles": 5}}


def test_se_conoce_al_cerrar_la_ultima_vela_de_la_derecha():
    candles = series()
    item = pattern(START, START + 20 * HOUR, 20)
    DoubleTopBottomDetector()._set_known_times([item], candles, CONFIG)
    assert item.known_at == START + 26 * HOUR, "vela 25 cierra a la hora 26"


def test_la_validacion_posterior_puede_alargar_la_espera():
    config = copy.deepcopy(CONFIG)
    config["filters"]["postPatternValidationCandles"] = 9
    item = pattern(START, START + 20 * HOUR, 20)
    DoubleTopBottomDetector()._set_known_times([item], series(), config)
    assert item.known_at == START + 30 * HOUR


def test_el_filtro_de_volumen_tambien_cuenta_si_esta_activo():
    config = copy.deepcopy(CONFIG)
    config["doubleTopBottom"]["requireHighVolumeAtExtremes"] = {"enabled": True, "volumeWindowCandles": 8}
    item = pattern(START, START + 20 * HOUR, 20)
    DoubleTopBottomDetector()._set_known_times([item], series(), config)
    assert item.known_at == START + 29 * HOUR

    config["doubleTopBottom"]["requireHighVolumeAtExtremes"]["enabled"] = False
    DoubleTopBottomDetector()._set_known_times([item], series(), config)
    assert item.known_at == START + 26 * HOUR


def test_cerca_del_final_no_pasa_de_la_ultima_vela():
    item = pattern(START, START + 58 * HOUR, 58)
    DoubleTopBottomDetector()._set_known_times([item], series(60), CONFIG)
    assert item.known_at == START + 60 * HOUR


def dedupe(items):
    return DoubleTopBottomDetector()._deduplicate_by_zone(items, 2.0, 24)


def known(item, hours):
    item.known_at = START + hours * HOUR
    return item


def test_un_patron_mejor_reemplaza_solo_desde_que_se_conoce():
    first = known(pattern(START, START + 10 * HOUR, 10, confidence=60), 16)
    better = known(pattern(START, START + 20 * HOUR, 20, confidence=90), 26)
    result = dedupe([better, first])
    assert first in result and better in result
    assert first.replaced_at == START + 26 * HOUR
    assert better.replaced_at is None


def test_uno_peor_que_llega_despues_no_borra_al_anterior():
    first = known(pattern(START, START + 10 * HOUR, 10, confidence=90), 16)
    worse = known(pattern(START, START + 20 * HOUR, 20, confidence=60), 26)
    result = dedupe([first, worse])
    assert result == [first]
    assert first.replaced_at is None


def test_un_duplicado_posterior_no_cambia_lo_que_ya_se_mostraba():
    # El que empezó antes se conoce después: reemplaza desde esa hora, no desde el principio
    late_start = known(pattern(START + 2 * HOUR, START + 8 * HOUR, 8), 14)
    early_start = known(pattern(START, START + 12 * HOUR, 12), 18)
    result = dedupe([early_start, late_start])
    assert late_start in result
    assert late_start.replaced_at == START + 18 * HOUR


def test_zonas_distintas_no_se_tocan():
    a = known(pattern(START, START + 10 * HOUR, 10, level=100), 16)
    b = known(pattern(START, START + 20 * HOUR, 20, level=200), 26)
    assert set(map(id, dedupe([a, b]))) == {id(a), id(b)}
    assert a.replaced_at is None and b.replaced_at is None


def test_el_patron_viaja_con_sus_horas():
    item = known(pattern(START, START + 10 * HOUR, 10), 16)
    item.replaced_at = START + 20 * HOUR
    data = serialize_pattern(item)
    assert data["knownAt"] == START + 16 * HOUR
    assert data["replacedAt"] == START + 20 * HOUR


MOMENTUM = {"momentumConfirmation": {"enabled": True, "lookbackAfterPattern": 10, "requireMomentum": False}}


def add_momentum(item, candles, config):
    return DoubleTopBottomDetector()._add_momentum_confirmation([item], candles, config)


def marubozu_after(index):
    candles = series()
    candles[index] = {**candles[index], "open": 105.0, "close": 95.0, "high": 105.0, "low": 95.0}
    return candles


def test_la_entrada_se_conoce_al_cerrar_su_vela():
    item = known(pattern(START, START + 20 * HOUR, 20), 26)
    add_momentum(item, marubozu_after(27), MOMENTUM)
    assert item.entry_signal["entry_candle_timestamp"] == START + 27 * HOUR
    assert item.entry_signal["known_at"] == START + 28 * HOUR
    assert item.known_at == START + 26 * HOUR, "sin exigir momentum el patron no espera a la entrada"


def test_si_el_momentum_es_obligatorio_el_patron_espera_a_la_entrada():
    config = copy.deepcopy(MOMENTUM)
    config["momentumConfirmation"]["requireMomentum"] = True
    item = known(pattern(START, START + 20 * HOUR, 20), 26)
    add_momentum(item, marubozu_after(27), config)
    assert item.known_at == START + 28 * HOUR


def full_config():
    return {
        "doubleTopBottom": {
            "candlesPerExtreme": 3, "priceMarginPercent": 2.0, "minCandlesBetween": 5, "maxCandlesBetween": 50, "maxBreakoutPercent": 2.0,
            "rejectionPatterns": {"hammer": True, "shootingStar": True, "bullishEngulfing": True, "bearishEngulfing": True},
        },
        "filters": {
            "minConfidence": 0, "requireBothRejections": False, "postPatternValidationCandles": 3,
            "applyPostValidationToRealtimeSignals": True, "minPostPatternMovePercent": 0.5, "postPatternConfidenceBonus": 20,
        },
    }


def wave(count=240):
    """Picos parecidos cada 12 velas: muchos patrones repetidos en la misma zona."""
    candles = []
    for i in range(count):
        height = abs((i % 12) - 6)
        high = 110 - height * 2 + (i % 5) * 0.1
        candles.append(candle(i, high - 6, high, open_=high - 4, close=high - 3))
    return candles


def visible(items, now):
    return {
        (p["type"], p["firstExtreme"]["timestamp"], p["secondExtreme"]["timestamp"]) for p in items
        if p["knownAt"] <= now and (p["replacedAt"] is None or now < p["replacedAt"])
    }


def test_el_patron_usa_solo_la_vela_anterior_a_cada_extremo():
    """El detector ya no copia todo el historial: solo la vela previa, que es la que lee."""
    detector = DoubleTopBottomDetector()
    seen = []
    original = detector._validate_rejection_pattern

    def spy(candle, previous, config, direction):
        seen.append((candle["timestamp"], [c["timestamp"] for c in previous]))
        return original(candle, previous, config, direction)

    detector._validate_rejection_pattern = spy
    detector.detect_patterns("BTCUSDT", wave(), full_config())
    assert seen
    assert all(len(previous) == 1 and previous[0] == stamp - HOUR for stamp, previous in seen)


def test_sin_velas_en_memoria_backtesting_las_vuelve_a_pedir(monkeypatch):
    async def fail(*args, **kwargs):
        raise AssertionError("no debe pedir velas recientes de Bybit")

    monkeypatch.setattr(main, "_fetch_historical_internal", fail)
    key = "PRUEBAUSDT_1h"
    assert key not in main.DTB_CANDLES_CACHE
    response = TestClient(main.app).post("/api/double-topbottom/detect", json={
        "symbol": "PRUEBAUSDT", "interval": "1h", "config": full_config(), "backtesting": True,
    })
    assert response.json()["needsCandles"] is True


def test_con_todos_los_datos_se_ve_lo_mismo_que_con_solo_lo_cerrado():
    candles = wave()
    everything = [serialize_pattern(p) for p in DoubleTopBottomDetector().detect_patterns("BTCUSDT", candles, full_config())]
    assert len(everything) > 10
    for end in range(60, len(candles), 7):
        now = candles[end - 1]["timestamp"] + HOUR
        closed = [serialize_pattern(p) for p in DoubleTopBottomDetector().detect_patterns("BTCUSDT", candles[:end], full_config())]
        assert visible(everything, now) == visible(closed, now), f"hora {end}"
