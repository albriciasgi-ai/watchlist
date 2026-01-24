"""
Test unitario para FootprintCalculator.

Ejecutar con: python test_footprint_calculator.py
"""

import sys
from footprint_calculator import FootprintCalculator, FootprintLevel, Footprint


def test_create_levels_normal():
    """Test: crea 6 niveles para una vela normal."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95100.0,
        candle_low=95000.0,
        candle_close=95050.0
    )

    fp = calc.get_footprint()
    assert fp is not None, "Footprint no debe ser None"
    assert len(fp.levels) == 6, f"Debe haber 6 niveles, hay {len(fp.levels)}"

    # Verificar que los niveles cubren todo el rango
    assert fp.levels[0].price_min == 95000.0, "Primer nivel debe empezar en low"
    assert abs(fp.levels[-1].price_max - 95100.0) < 0.01, "Ultimo nivel debe terminar en high"

    # Verificar que los niveles son continuos
    for i in range(len(fp.levels) - 1):
        assert abs(fp.levels[i].price_max - fp.levels[i+1].price_min) < 0.001, \
            f"Niveles {i} y {i+1} no son continuos"

    print("OK: test_create_levels_normal")


def test_create_levels_doji():
    """Test: vela doji (high == low) crea un solo nivel."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95000.0,
        candle_low=95000.0,
        candle_close=95000.0
    )

    fp = calc.get_footprint()
    assert fp is not None, "Footprint no debe ser None"
    assert len(fp.levels) == 1, f"Vela doji debe tener 1 nivel, hay {len(fp.levels)}"

    print("OK: test_create_levels_doji")


def test_process_trade_buy():
    """Test: trade Buy suma a ask_volume."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95100.0,
        candle_low=95000.0,
        candle_close=95050.0
    )

    # Procesar un trade Buy
    result = calc.process_trade(price=95050.0, volume=1.5, side="Buy")
    assert result is True, "process_trade debe retornar True"

    fp = calc.get_footprint()
    # Encontrar el nivel donde cayo el trade
    total_ask = sum(level.ask_volume for level in fp.levels)
    total_bid = sum(level.bid_volume for level in fp.levels)

    assert total_ask == 1.5, f"ask_volume total debe ser 1.5, es {total_ask}"
    assert total_bid == 0.0, f"bid_volume total debe ser 0, es {total_bid}"

    print("OK: test_process_trade_buy")


def test_process_trade_sell():
    """Test: trade Sell suma a bid_volume."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95100.0,
        candle_low=95000.0,
        candle_close=95050.0
    )

    # Procesar un trade Sell
    result = calc.process_trade(price=95020.0, volume=2.0, side="Sell")
    assert result is True, "process_trade debe retornar True"

    fp = calc.get_footprint()
    total_ask = sum(level.ask_volume for level in fp.levels)
    total_bid = sum(level.bid_volume for level in fp.levels)

    assert total_bid == 2.0, f"bid_volume total debe ser 2.0, es {total_bid}"
    assert total_ask == 0.0, f"ask_volume total debe ser 0, es {total_ask}"

    print("OK: test_process_trade_sell")


def test_delta_calculation():
    """Test: delta = ask_volume - bid_volume."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95100.0,
        candle_low=95000.0,
        candle_close=95050.0
    )

    # Procesar trades
    calc.process_trade(price=95050.0, volume=3.0, side="Buy")
    calc.process_trade(price=95050.0, volume=1.0, side="Sell")

    fp = calc.get_footprint()
    assert abs(fp.total_delta - 2.0) < 0.001, f"total_delta debe ser 2.0, es {fp.total_delta}"

    print("OK: test_delta_calculation")


def test_poc_detection():
    """Test: POC es el nivel con mayor volumen total."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95060.0,  # 60 puntos de rango = 10 por nivel
        candle_low=95000.0,
        candle_close=95030.0
    )

    # Poner mucho volumen en el nivel del medio (nivel 3, precio ~95030-95040)
    calc.process_trade(price=95005.0, volume=1.0, side="Buy")  # nivel 0
    calc.process_trade(price=95035.0, volume=10.0, side="Buy")  # nivel 3 (maximo)
    calc.process_trade(price=95055.0, volume=1.0, side="Sell")  # nivel 5

    fp = calc.get_footprint()
    poc = calc.get_poc()

    assert poc is not None, "POC no debe ser None"
    assert poc.total_volume == 10.0, f"POC debe tener volumen 10.0, tiene {poc.total_volume}"
    assert fp.poc_index == 3, f"POC debe estar en indice 3, esta en {fp.poc_index}"

    print("OK: test_poc_detection")


def test_imbalance_detection():
    """Test: detecta imbalance cuando ratio >= threshold."""
    calc = FootprintCalculator(num_levels=6, imbalance_threshold=3.0)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95060.0,
        candle_low=95000.0,
        candle_close=95030.0
    )

    # Crear un imbalance fuerte: 4 Buy vs 1 Sell (ratio 4:1)
    calc.process_trade(price=95025.0, volume=4.0, side="Buy")
    calc.process_trade(price=95025.0, volume=1.0, side="Sell")

    imbalances = calc.detect_imbalances()

    assert len(imbalances) >= 1, f"Debe detectar al menos 1 imbalance, hay {len(imbalances)}"
    assert imbalances[0]["type"] == "BUY", f"Imbalance debe ser tipo BUY"
    assert imbalances[0]["ratio"] >= 3.0, f"Ratio debe ser >= 3.0"

    print("OK: test_imbalance_detection")


def test_stacked_imbalance_detection():
    """Test: detecta stacked imbalance con 3+ niveles consecutivos."""
    calc = FootprintCalculator(num_levels=6, imbalance_threshold=3.0)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95060.0,  # 6 niveles de 10 puntos cada uno
        candle_low=95000.0,
        candle_close=95030.0
    )

    # Crear stacked imbalance BUY en niveles 0, 1, 2 (3 consecutivos)
    # Nivel 0: 95000-95010
    calc.process_trade(price=95005.0, volume=4.0, side="Buy")
    calc.process_trade(price=95005.0, volume=1.0, side="Sell")

    # Nivel 1: 95010-95020
    calc.process_trade(price=95015.0, volume=5.0, side="Buy")
    calc.process_trade(price=95015.0, volume=1.0, side="Sell")

    # Nivel 2: 95020-95030
    calc.process_trade(price=95025.0, volume=6.0, side="Buy")
    calc.process_trade(price=95025.0, volume=1.0, side="Sell")

    stacked = calc.detect_stacked_imbalances(min_consecutive=3)

    assert len(stacked) >= 1, f"Debe detectar al menos 1 stacked imbalance, hay {len(stacked)}"
    assert stacked[0]["direction"] == "BUY", f"Direccion debe ser BUY"
    assert stacked[0]["levels_count"] >= 3, f"Debe tener al menos 3 niveles"

    print("OK: test_stacked_imbalance_detection")


def test_to_dict_serialization():
    """Test: to_dict() serializa correctamente para la API."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95100.0,
        candle_low=95000.0,
        candle_close=95050.0
    )

    calc.process_trade(price=95050.0, volume=1.0, side="Buy")

    fp = calc.get_footprint()
    data = fp.to_dict()

    assert "candle_timestamp" in data, "Debe incluir candle_timestamp"
    assert "symbol" in data, "Debe incluir symbol"
    assert "levels" in data, "Debe incluir levels"
    assert "poc_index" in data, "Debe incluir poc_index"
    assert "total_delta" in data, "Debe incluir total_delta"
    assert "imbalances" in data, "Debe incluir imbalances"

    assert isinstance(data["levels"], list), "levels debe ser una lista"
    assert len(data["levels"]) == 6, f"Debe haber 6 niveles en la serializacion"

    print("OK: test_to_dict_serialization")


def test_reset():
    """Test: reset() limpia el footprint actual."""
    calc = FootprintCalculator(num_levels=6)
    calc.set_candle(
        candle_timestamp=1700000000000,
        symbol="BTCUSDT",
        interval="1",
        candle_open=95000.0,
        candle_high=95100.0,
        candle_low=95000.0,
        candle_close=95050.0
    )

    calc.process_trade(price=95050.0, volume=1.0, side="Buy")

    calc.reset()

    fp = calc.get_footprint()
    assert fp is None, "Despues de reset(), footprint debe ser None"

    stats = calc.get_stats()
    assert stats["has_footprint"] is False, "has_footprint debe ser False"
    assert stats["trades_processed"] == 0, "trades_processed debe ser 0"

    print("OK: test_reset")


def run_all_tests():
    """Ejecuta todos los tests."""
    print("=" * 50)
    print("Ejecutando tests de FootprintCalculator...")
    print("=" * 50)

    tests = [
        test_create_levels_normal,
        test_create_levels_doji,
        test_process_trade_buy,
        test_process_trade_sell,
        test_delta_calculation,
        test_poc_detection,
        test_imbalance_detection,
        test_stacked_imbalance_detection,
        test_to_dict_serialization,
        test_reset,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"FAIL: {test.__name__} - {e}")
            failed += 1
        except Exception as e:
            print(f"ERROR: {test.__name__} - {type(e).__name__}: {e}")
            failed += 1

    print("=" * 50)
    print(f"Resultados: {passed} OK, {failed} FAIL")
    print("=" * 50)

    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
