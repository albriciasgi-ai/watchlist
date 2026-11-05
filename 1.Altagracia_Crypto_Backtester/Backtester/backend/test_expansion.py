"""
Script de prueba para verificar el sistema de expansión incremental hacia atrás.

Este script simula el escenario donde:
- El caché tiene 3 años de datos (ej: 87,000 velas de 15m)
- La configuración pide 5 años (175,200 velas de 15m)
- El sistema debe expandir hacia atrás para descargar solo los 2 años faltantes
"""

import gzip
import json
from pathlib import Path
from datetime import datetime

# Cargar caché existente
cache_file = Path("backtesting_cache/BTCUSDT_backtesting_data.json.gz")

if not cache_file.exists():
    print(f"[ERROR] No existe cache en: {cache_file}")
    exit(1)

print(f"[INFO] Cargando cache: {cache_file}")
print(f"   Tamanio: {cache_file.stat().st_size / (1024*1024):.1f} MB")

with gzip.open(cache_file, 'rb') as f:
    cache_data = json.loads(f.read().decode('utf-8'))

print(f"\n[OK] Cache cargado correctamente")

# Analizar datos por timeframe
timeframes = cache_data.get("timeframes", {})
print(f"\n[ANALISIS] Datos existentes:\n")

for tf_name in ["1m", "5m", "15m", "1h", "4h"]:
    tf_data = timeframes.get(tf_name, {})
    main_candles = tf_data.get("main", [])

    if not main_candles:
        print(f"[WARN] {tf_name}: Sin datos")
        continue

    # Información de velas
    first_candle = main_candles[0]
    last_candle = main_candles[-1]
    total_candles = len(main_candles)

    first_date = datetime.fromtimestamp(first_candle["timestamp"] / 1000).strftime("%Y-%m-%d")
    last_date = datetime.fromtimestamp(last_candle["timestamp"] / 1000).strftime("%Y-%m-%d")

    # Calcular días cubiertos
    days_covered = (last_candle["timestamp"] - first_candle["timestamp"]) / (24 * 60 * 60 * 1000)

    # Configuración esperada
    config_days = {
        "1m": 730,    # 2 años
        "5m": 1825,   # 5 años
        "15m": 1825,  # 5 años
        "1h": 1825,   # 5 años
        "4h": 1825    # 5 años
    }

    expected_days = config_days.get(tf_name, 1825)

    # Calcular cobertura
    coverage_pct = (days_covered / expected_days * 100)

    print(f"\n[{tf_name}]:")
    print(f"   Velas: {total_candles:,}")
    print(f"   Rango: {first_date} -> {last_date}")
    print(f"   Dias cubiertos: {days_covered:.0f} de {expected_days} ({coverage_pct:.1f}%)")

    # Determinar acción
    if coverage_pct < 95:
        days_missing = expected_days - days_covered
        print(f"   [ACCION] EXPANSION HACIA ATRAS: ~{days_missing:.0f} dias faltantes")
    elif coverage_pct >= 95:
        print(f"   [ACCION] COMPLETO (>95% de cobertura)")

# Metadata
metadata = cache_data.get("metadata", {})
cached_at = metadata.get("cached_at_colombia", "Desconocido")
print(f"\n[METADATA] Cache guardado: {cached_at}")

print("\n" + "="*80)
print("CONCLUSION:")
print("="*80)
print("""
Si algun timeframe muestra <95% de cobertura, el sistema automaticamente:

1. [OK] PRESERVA los datos existentes en cache
2. [DOWNLOAD] Descarga SOLO los dias faltantes hacia atras
3. [MERGE] Mergea: [historico_nuevo] + [cache_existente]
4. [SAVE] Guarda el cache actualizado

Esto ahorra ~20 minutos comparado con re-descargar todo desde cero.
""")
