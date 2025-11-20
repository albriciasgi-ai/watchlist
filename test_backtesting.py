#!/usr/bin/env python3
"""
Script de prueba para el motor de backtesting
Simula el flujo del frontend para identificar problemas
"""

import json
import sys
from datetime import datetime

# Cargar datos de backtesting
print("=" * 60)
print("TEST DEL MOTOR DE BACKTESTING")
print("=" * 60)

cache_file = "WatchlistConIndicadores/backend/backtesting_cache/BTCUSDT_backtesting_data.json"

print(f"\n📂 Cargando datos desde: {cache_file}")
with open(cache_file, 'r') as f:
    data = json.load(f)

symbol = data['symbol']
timeframes = data['timeframes']
metadata = data['metadata']

print(f"\n✅ Datos cargados:")
print(f"   Symbol: {symbol}")
print(f"   Timeframes: {list(timeframes.keys())}")
print(f"   Date range: {metadata['date_range']['start']} → {metadata['date_range']['end']}")

# Probar timeframe 15m
print("\n" + "=" * 60)
print("PROBANDO TIMEFRAME 15m")
print("=" * 60)

tf_data = timeframes['15m']
main_candles = tf_data['main']
subdivisions = tf_data['subdivisions']

print(f"\n📊 Datos disponibles:")
print(f"   Main candles (15m): {len(main_candles)}")
print(f"   Subdivisions (5m): {len(subdivisions)}")

# Verificar estructura de velas
print(f"\n🔍 Primera vela principal (15m):")
first_main = main_candles[0]
print(f"   Timestamp: {first_main['timestamp']}")
print(f"   Date: {datetime.fromtimestamp(first_main['timestamp'] / 1000)}")
print(f"   OHLC: O={first_main['open']}, H={first_main['high']}, L={first_main['low']}, C={first_main['close']}")
print(f"   Volume: {first_main['volume']}")

print(f"\n🔍 Última vela principal (15m):")
last_main = main_candles[-1]
print(f"   Timestamp: {last_main['timestamp']}")
print(f"   Date: {datetime.fromtimestamp(last_main['timestamp'] / 1000)}")
print(f"   OHLC: O={last_main['open']}, H={last_main['high']}, L={last_main['low']}, C={last_main['close']}")
print(f"   Volume: {last_main['volume']}")

# SIMULACIÓN DEL FLUJO DEL FRONTEND
print("\n" + "=" * 60)
print("SIMULACIÓN DEL FLUJO DEL FRONTEND")
print("=" * 60)

# Usuario selecciona una fecha de inicio (ej: 2023-01-01)
start_date_str = "2023-01-01"
print(f"\n📅 Usuario selecciona fecha de inicio: {start_date_str}")

# Convertir a timestamp
from datetime import timezone, timedelta
COLOMBIA_TZ = timezone(timedelta(hours=-5))
start_timestamp = int(datetime.strptime(start_date_str + ' 00:00:00', '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp() * 1000)

print(f"   Timestamp calculado: {start_timestamp}")
print(f"   Fecha UTC: {datetime.fromtimestamp(start_timestamp / 1000, tz=timezone.utc)}")

# Buscar el índice de la vela que corresponde a esa fecha
print(f"\n🔎 Buscando vela correspondiente...")
first_candle_ts = main_candles[0]['timestamp']
last_candle_ts = main_candles[-1]['timestamp']

print(f"   Primer timestamp disponible: {first_candle_ts} ({datetime.fromtimestamp(first_candle_ts / 1000)})")
print(f"   Último timestamp disponible: {last_candle_ts} ({datetime.fromtimestamp(last_candle_ts / 1000)})")

if start_timestamp < first_candle_ts:
    print(f"   ⚠️ Fecha de inicio es ANTERIOR al primer dato disponible")
    simulation_start_index = 0
    simulation_start_time = first_candle_ts
elif start_timestamp > last_candle_ts:
    print(f"   ⚠️ Fecha de inicio es POSTERIOR al último dato disponible")
    simulation_start_index = len(main_candles) - 1
    simulation_start_time = last_candle_ts
else:
    # Buscar índice exacto
    simulation_start_index = next((i for i, c in enumerate(main_candles) if c['timestamp'] >= start_timestamp), 0)
    simulation_start_time = main_candles[simulation_start_index]['timestamp']
    print(f"   ✅ Vela encontrada en índice {simulation_start_index}")

print(f"   SimulationStartTime: {simulation_start_time} ({datetime.fromtimestamp(simulation_start_time / 1000)})")

# PROBLEMA 1: ¿Qué velas se mostrarán inicialmente?
print("\n" + "=" * 60)
print("PROBLEMA 1: VELAS VISIBLES AL INICIO")
print("=" * 60)

VISIBLE_HISTORY = 200  # Configuración del chart

# Según el código del frontend:
# - currentTime inicia en simulationStartTime
# - El chart muestra las últimas VISIBLE_HISTORY velas antes de currentTime

current_time = simulation_start_time
lastVisibleIndex = simulation_start_index + 1  # +1 porque es exclusivo
startIndex = max(0, lastVisibleIndex - VISIBLE_HISTORY)

visible_candles = main_candles[startIndex:lastVisibleIndex]

print(f"\n📊 Configuración de velas visibles:")
print(f"   currentTime: {current_time} ({datetime.fromtimestamp(current_time / 1000)})")
print(f"   lastVisibleIndex: {lastVisibleIndex}")
print(f"   startIndex: {startIndex}")
print(f"   Velas visibles: {len(visible_candles)}")

if len(visible_candles) > 0:
    print(f"\n   Primera vela visible:")
    print(f"      Timestamp: {visible_candles[0]['timestamp']}")
    print(f"      Date: {datetime.fromtimestamp(visible_candles[0]['timestamp'] / 1000)}")
    print(f"   Última vela visible:")
    print(f"      Timestamp: {visible_candles[-1]['timestamp']}")
    print(f"      Date: {datetime.fromtimestamp(visible_candles[-1]['timestamp'] / 1000)}")

# ¿Cuántas velas hay ANTES de simulationStartTime?
candles_before_simulation = simulation_start_index
print(f"\n   Velas históricas antes de simulationStartTime: {candles_before_simulation}")
print(f"   ¿Se muestran velas anteriores a la fecha seleccionada? {candles_before_simulation > 0 and startIndex < simulation_start_index}")

# PROBLEMA 2: ¿Qué precio se establece inicialmente?
print("\n" + "=" * 60)
print("PROBLEMA 2: PRECIO INICIAL")
print("=" * 60)

# Según el código del frontend (líneas 250-268 de BacktestingApp.jsx):
startCandleIndex = next((i for i, c in enumerate(main_candles) if c['timestamp'] >= current_time), -1)

if startCandleIndex != -1:
    candleIndex = max(0, startCandleIndex - 1)
    startCandle = main_candles[candleIndex]
    initial_price = startCandle['close']
    print(f"\n✅ Precio inicial establecido:")
    print(f"   startCandleIndex: {startCandleIndex}")
    print(f"   candleIndex (usado): {candleIndex}")
    print(f"   Precio: {initial_price}")
    print(f"   Fecha de la vela: {datetime.fromtimestamp(startCandle['timestamp'] / 1000)}")
else:
    lastCandle = main_candles[-1]
    initial_price = lastCandle['close']
    print(f"\n⚠️ Precio inicial (fallback - última vela):")
    print(f"   Precio: {initial_price}")

# PROBLEMA 3: Auto-scroll inicial
print("\n" + "=" * 60)
print("PROBLEMA 3: AUTO-SCROLL INICIAL")
print("=" * 60)

# Según el código (líneas 182-216 de BacktestingChart.jsx):
# Durante !isPlaying, el chart debe mostrar contexto histórico

chartWidth = 1200  # Ancho simulado del chart
CANDLE_WIDTH = 8
CANDLE_SPACING = 2
scaleX = 1

totalCandleWidth = (CANDLE_WIDTH + CANDLE_SPACING) * scaleX
maxVisibleCandles = int((chartWidth - 100) / totalCandleWidth)

print(f"\n📐 Configuración del chart:")
print(f"   Chart width: {chartWidth}px")
print(f"   Candle width: {CANDLE_WIDTH}px")
print(f"   Candle spacing: {CANDLE_SPACING}px")
print(f"   Total per candle: {totalCandleWidth}px")
print(f"   Max visible candles: {maxVisibleCandles}")

candlesBeforeCurrent = len([c for c in visible_candles if c['timestamp'] < current_time])
print(f"\n   Velas antes de currentTime: {candlesBeforeCurrent}")

if len(visible_candles) > maxVisibleCandles:
    contextCandles = min(50, candlesBeforeCurrent, int(maxVisibleCandles * 0.4))
    startCandle = max(0, candlesBeforeCurrent - contextCandles)
    offsetX = -startCandle * totalCandleWidth

    print(f"\n   Auto-scroll aplicado (!isPlaying):")
    print(f"      contextCandles: {contextCandles}")
    print(f"      startCandle: {startCandle}")
    print(f"      offsetX: {offsetX}px")
    print(f"      Primera vela visible en pantalla: índice {startCandle}")
    if startCandle < len(visible_candles):
        first_visible = visible_candles[startCandle]
        print(f"      Fecha: {datetime.fromtimestamp(first_visible['timestamp'] / 1000)}")
else:
    centerOffset = (chartWidth - (len(visible_candles) * totalCandleWidth)) / 2
    offsetX = max(0, centerOffset)
    print(f"\n   Pocas velas - centradas:")
    print(f"      centerOffset: {centerOffset}px")

# RESUMEN DE PROBLEMAS POTENCIALES
print("\n" + "=" * 60)
print("RESUMEN Y DIAGNÓSTICO")
print("=" * 60)

problems = []

# Problema 1: Velas visibles insuficientes
if candles_before_simulation < 50:
    problems.append(f"⚠️ PROBLEMA: Solo hay {candles_before_simulation} velas antes de la fecha seleccionada (se esperaban al menos 50 para contexto)")

# Problema 2: Fecha de inicio fuera de rango
if start_timestamp < first_candle_ts or start_timestamp > last_candle_ts:
    problems.append(f"⚠️ PROBLEMA: La fecha seleccionada está fuera del rango de datos disponibles")

# Problema 3: Precio inicial incorrecto
if startCandleIndex == -1:
    problems.append(f"⚠️ PROBLEMA: No se encontró vela para currentTime, usando fallback")

# Problema 4: Chart muestra todo el historial
if VISIBLE_HISTORY >= len(main_candles):
    problems.append(f"⚠️ PROBLEMA: VISIBLE_HISTORY ({VISIBLE_HISTORY}) es mayor o igual al total de velas ({len(main_candles)}), se cargarán TODAS las velas")

if problems:
    print("\n❌ PROBLEMAS DETECTADOS:")
    for i, p in enumerate(problems, 1):
        print(f"{i}. {p}")
else:
    print("\n✅ No se detectaron problemas obvios en la lógica")

# Test específico: ¿Qué pasa si selecciono 2024-01-01?
print("\n" + "=" * 60)
print("TEST ESPECÍFICO: FECHA 2024-01-01")
print("=" * 60)

test_date = "2024-01-01"
test_timestamp = int(datetime.strptime(test_date + ' 00:00:00', '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp() * 1000)

print(f"\nFecha de prueba: {test_date}")
print(f"Timestamp: {test_timestamp}")
print(f"Primer dato disponible: {datetime.fromtimestamp(first_candle_ts / 1000)}")
print(f"Último dato disponible: {datetime.fromtimestamp(last_candle_ts / 1000)}")

if test_timestamp < first_candle_ts:
    print("❌ La fecha está ANTES del primer dato")
elif test_timestamp > last_candle_ts:
    print("❌ La fecha está DESPUÉS del último dato")
else:
    test_index = next((i for i, c in enumerate(main_candles) if c['timestamp'] >= test_timestamp), 0)
    print(f"✅ La fecha está DENTRO del rango")
    print(f"   Índice de vela: {test_index} de {len(main_candles)}")
    print(f"   Fecha exacta de la vela: {datetime.fromtimestamp(main_candles[test_index]['timestamp'] / 1000)}")
    print(f"   Velas históricas disponibles: {test_index}")
    print(f"   ¿Suficiente contexto? {test_index >= 50}")

print("\n" + "=" * 60)
print("TEST COMPLETADO")
print("=" * 60)
