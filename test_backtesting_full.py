#!/usr/bin/env python3
"""
Test completo del motor de backtesting
Simula el flujo completo del usuario desde la inicialización hasta la reproducción
"""

import json
import sys
from datetime import datetime, timezone, timedelta

class BacktestingSimulator:
    def __init__(self, cache_file):
        print("=" * 80)
        print("SIMULADOR COMPLETO DEL MOTOR DE BACKTESTING")
        print("=" * 80)

        with open(cache_file, 'r') as f:
            self.data = json.load(f)

        self.symbol = self.data['symbol']
        self.timeframes = self.data['timeframes']
        self.metadata = self.data['metadata']

        print(f"\n✅ Datos cargados: {self.symbol}")
        print(f"   Timeframes: {list(self.timeframes.keys())}")
        print(f"   Rango: {self.metadata['date_range']['start']} → {self.metadata['date_range']['end']}")

    def test_initialization(self, timeframe, start_date=None):
        """Simula la inicialización del backtesting"""
        print("\n" + "=" * 80)
        print(f"TEST 1: INICIALIZACIÓN CON TIMEFRAME {timeframe}")
        print("=" * 80)

        if timeframe not in self.timeframes:
            print(f"❌ ERROR: Timeframe {timeframe} no disponible")
            return None

        tf_data = self.timeframes[timeframe]
        main_candles = tf_data['main']
        subdivisions = tf_data['subdivisions']

        print(f"\n📊 Datos del timeframe:")
        print(f"   Main candles: {len(main_candles)}")
        print(f"   Subdivisions: {len(subdivisions)}")

        # Determinar simulationStartTime
        first_candle = main_candles[0]
        last_candle = main_candles[-1]

        simulation_start_time = None
        simulation_start_index = None

        if start_date:
            print(f"\n📅 Fecha de inicio especificada: {start_date}")
            # Convertir fecha a timestamp
            start_timestamp = int(datetime.strptime(start_date + ' 00:00:00', '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp() * 1000)

            # Buscar vela
            first_ts = first_candle['timestamp']
            last_ts = last_candle['timestamp']

            if start_timestamp < first_ts:
                print(f"   ⚠️ Fecha anterior al primer dato, usando primera vela")
                simulation_start_index = 0
                simulation_start_time = first_ts
            elif start_timestamp > last_ts:
                print(f"   ⚠️ Fecha posterior al último dato, usando última vela")
                simulation_start_index = len(main_candles) - 1
                simulation_start_time = last_ts
            else:
                simulation_start_index = next((i for i, c in enumerate(main_candles) if c['timestamp'] >= start_timestamp), 0)
                simulation_start_time = main_candles[simulation_start_index]['timestamp']
                print(f"   ✅ Vela encontrada en índice {simulation_start_index}")
        else:
            print(f"\n📅 Sin fecha de inicio, usando primera vela")
            simulation_start_index = 0
            simulation_start_time = first_candle['timestamp']

        print(f"   SimulationStartTime: {datetime.fromtimestamp(simulation_start_time / 1000)}")
        print(f"   Índice: {simulation_start_index} de {len(main_candles)}")
        print(f"   Velas históricas disponibles: {simulation_start_index}")

        # Calcular precio inicial (según la lógica corregida)
        startCandleIndex = simulation_start_index
        if startCandleIndex > 0:
            candleIndex = startCandleIndex - 1
        else:
            candleIndex = 0

        start_candle = main_candles[candleIndex]
        initial_price = start_candle['close']

        print(f"\n💰 Precio inicial:")
        print(f"   Índice de vela usado: {candleIndex}")
        print(f"   Fecha de la vela: {datetime.fromtimestamp(start_candle['timestamp'] / 1000)}")
        print(f"   Precio: ${initial_price:,.2f}")

        return {
            'timeframe': timeframe,
            'main_candles': main_candles,
            'subdivisions': subdivisions,
            'simulation_start_time': simulation_start_time,
            'simulation_start_index': simulation_start_index,
            'initial_price': initial_price,
            'start_candle_index': candleIndex
        }

    def test_initial_display(self, state):
        """Simula cómo se muestran las velas inicialmente"""
        print("\n" + "=" * 80)
        print("TEST 2: DISPLAY INICIAL DEL CHART")
        print("=" * 80)

        main_candles = state['main_candles']
        current_time = state['simulation_start_time']
        simulation_start_index = state['simulation_start_index']

        # Según el código de BacktestingChart.jsx (líneas 105-217)
        VISIBLE_HISTORY = 200  # Línea 34

        # Calcular velas visibles
        lastVisibleIndex = simulation_start_index + 1
        startIndex = max(0, lastVisibleIndex - VISIBLE_HISTORY)
        visible_candles = main_candles[startIndex:lastVisibleIndex]

        print(f"\n📊 Velas visibles calculadas:")
        print(f"   VISIBLE_HISTORY: {VISIBLE_HISTORY}")
        print(f"   currentTime: {datetime.fromtimestamp(current_time / 1000)}")
        print(f"   lastVisibleIndex: {lastVisibleIndex}")
        print(f"   startIndex: {startIndex}")
        print(f"   Velas a mostrar: {len(visible_candles)}")

        if len(visible_candles) > 0:
            first_visible = visible_candles[0]
            last_visible = visible_candles[-1]

            print(f"\n   Primera vela visible:")
            print(f"      Fecha: {datetime.fromtimestamp(first_visible['timestamp'] / 1000)}")
            print(f"      Precio: ${first_visible['close']:,.2f}")

            print(f"   Última vela visible:")
            print(f"      Fecha: {datetime.fromtimestamp(last_visible['timestamp'] / 1000)}")
            print(f"      Precio: ${last_visible['close']:,.2f}")

            # Verificar si la última vela coincide con currentTime
            if last_visible['timestamp'] == current_time:
                print(f"   ✅ La última vela visible coincide con currentTime")
            else:
                print(f"   ⚠️ La última vela visible NO coincide con currentTime")
                print(f"      Diferencia: {(current_time - last_visible['timestamp']) / (1000 * 60)} minutos")

        # Auto-scroll inicial (según líneas 182-216 de BacktestingChart.jsx)
        print(f"\n📐 Auto-scroll inicial:")

        chartWidth = 1200  # Ancho simulado
        CANDLE_WIDTH = 8
        CANDLE_SPACING = 2
        scaleX = 1
        isPlaying = False  # Al inicio NO está reproduciendo

        totalCandleWidth = (CANDLE_WIDTH + CANDLE_SPACING) * scaleX
        maxVisibleCandles = int((chartWidth - 100) / totalCandleWidth)

        print(f"   Max visible candles on screen: {maxVisibleCandles}")

        if len(visible_candles) > maxVisibleCandles:
            candlesBeforeCurrent = len([c for c in visible_candles if c['timestamp'] < current_time])
            print(f"   Velas antes de currentTime: {candlesBeforeCurrent}")

            # Lógica de auto-scroll (!isPlaying)
            contextCandles = min(50, candlesBeforeCurrent, int(maxVisibleCandles * 0.4))
            startCandle = max(0, candlesBeforeCurrent - contextCandles)
            offsetX = -startCandle * totalCandleWidth

            print(f"   Auto-scroll (!isPlaying):")
            print(f"      contextCandles: {contextCandles}")
            print(f"      startCandle: {startCandle}")
            print(f"      offsetX: {offsetX}px")

            # Calcular qué velas se ven en pantalla
            first_on_screen_index = startCandle
            last_on_screen_index = min(len(visible_candles), first_on_screen_index + maxVisibleCandles)

            if first_on_screen_index < len(visible_candles):
                print(f"\n   Velas REALMENTE visibles en pantalla:")
                print(f"      Desde índice: {first_on_screen_index} (de {len(visible_candles)})")
                print(f"      Hasta índice: {last_on_screen_index} (de {len(visible_candles)})")
                print(f"      Total en pantalla: {last_on_screen_index - first_on_screen_index}")

                first_on_screen = visible_candles[first_on_screen_index]
                last_on_screen = visible_candles[min(last_on_screen_index - 1, len(visible_candles) - 1)]

                print(f"\n      Primera vela en pantalla:")
                print(f"         Fecha: {datetime.fromtimestamp(first_on_screen['timestamp'] / 1000)}")
                print(f"         Precio: ${first_on_screen['close']:,.2f}")

                print(f"      Última vela en pantalla:")
                print(f"         Fecha: {datetime.fromtimestamp(last_on_screen['timestamp'] / 1000)}")
                print(f"         Precio: ${last_on_screen['close']:,.2f}")

                # ¿Está visible el currentTime?
                current_time_visible = any(c['timestamp'] == current_time for c in visible_candles[first_on_screen_index:last_on_screen_index])
                if current_time_visible:
                    print(f"      ✅ currentTime está visible en pantalla")
                else:
                    print(f"      ⚠️ currentTime NO está visible en pantalla")
        else:
            print(f"   Pocas velas - todas visibles y centradas")

        return {
            **state,
            'visible_candles': visible_candles,
            'start_index': startIndex,
            'last_visible_index': lastVisibleIndex
        }

    def test_playback(self, state, seconds_to_simulate=60):
        """Simula la reproducción del backtesting"""
        print("\n" + "=" * 80)
        print(f"TEST 3: REPRODUCCIÓN (simulando {seconds_to_simulate} segundos)")
        print("=" * 80)

        main_candles = state['main_candles']
        current_time = state['simulation_start_time']
        current_index = state['simulation_start_index']

        # Simular avance del tiempo
        # Cada vela de 15m = 900000ms
        timeframe_duration = {
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000
        }

        tf = state['timeframe']
        candle_duration = timeframe_duration.get(tf, 15 * 60 * 1000)

        # Velocidad de reproducción (ej: 1x = 1 segundo real = 1 segundo simulado)
        playback_speed = 1  # 1x

        # Cuánto tiempo avanza por tick
        time_per_tick = 1000  # 1 segundo por tick
        ms_to_advance = time_per_tick * playback_speed

        print(f"\n⏩ Configuración de reproducción:")
        print(f"   Timeframe: {tf}")
        print(f"   Duración de vela: {candle_duration / 1000 / 60} minutos")
        print(f"   Velocidad: {playback_speed}x")
        print(f"   Avance por tick: {ms_to_advance}ms")

        # Simular algunos ticks
        ticks_to_simulate = 5
        print(f"\n   Simulando {ticks_to_simulate} ticks...")

        for tick in range(ticks_to_simulate):
            current_time += ms_to_advance

            # Buscar nueva vela visible
            new_index = next((i for i, c in enumerate(main_candles) if c['timestamp'] > current_time), len(main_candles))
            last_visible_index = new_index

            # Obtener velas visibles
            VISIBLE_HISTORY = 200
            start_index = max(0, last_visible_index - VISIBLE_HISTORY)
            visible_candles = main_candles[start_index:last_visible_index]

            if len(visible_candles) > 0:
                last_candle = visible_candles[-1]
                current_price = last_candle['close']

                print(f"   Tick {tick + 1}:")
                print(f"      currentTime: {datetime.fromtimestamp(current_time / 1000)}")
                print(f"      Velas visibles: {len(visible_candles)}")
                print(f"      Precio actual: ${current_price:,.2f}")

        return state

    def run_complete_test(self, timeframe='15m', start_date='2023-01-01'):
        """Ejecuta el test completo"""
        state = self.test_initialization(timeframe, start_date)
        if state:
            state = self.test_initial_display(state)
            state = self.test_playback(state)

        print("\n" + "=" * 80)
        print("TEST COMPLETADO")
        print("=" * 80)

        return state


if __name__ == "__main__":
    cache_file = "WatchlistConIndicadores/backend/backtesting_cache/BTCUSDT_backtesting_data.json"

    simulator = BacktestingSimulator(cache_file)

    # Test 1: Sin fecha de inicio
    print("\n\n")
    print("#" * 80)
    print("ESCENARIO 1: INICIALIZAR SIN FECHA DE INICIO")
    print("#" * 80)
    state = simulator.run_complete_test('15m', start_date=None)

    # Test 2: Con fecha 2023-01-01
    print("\n\n")
    print("#" * 80)
    print("ESCENARIO 2: INICIALIZAR CON FECHA 2023-01-01")
    print("#" * 80)
    state = simulator.run_complete_test('15m', start_date='2023-01-01')

    # Test 3: Con fecha 2024-01-01
    print("\n\n")
    print("#" * 80)
    print("ESCENARIO 3: INICIALIZAR CON FECHA 2024-01-01")
    print("#" * 80)
    state = simulator.run_complete_test('15m', start_date='2024-01-01')
