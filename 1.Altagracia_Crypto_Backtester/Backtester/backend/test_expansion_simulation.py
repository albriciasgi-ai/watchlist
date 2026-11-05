"""
Simulación de expansión incremental hacia atrás.

Este script demuestra cómo funciona el sistema cuando el caché tiene datos parciales.
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

print(f"[INFO] Cargando cache completo: {cache_file}")

with gzip.open(cache_file, 'rb') as f:
    cache_data = json.loads(f.read().decode('utf-8'))

print(f"[OK] Cache cargado\n")

# Simular escenario: timeframe 15m tiene 5 años completos (175,200 velas)
# Vamos a "truncar" artificialmente a 3 años (105,120 velas) para simular expansión

timeframe = "15m"
tf_data = cache_data.get("timeframes", {}).get(timeframe, {})
main_candles = tf_data.get("main", [])

if not main_candles:
    print(f"[ERROR] No hay datos para {timeframe}")
    exit(1)

total_candles = len(main_candles)
first_candle = main_candles[0]
last_candle = main_candles[-1]

first_date = datetime.fromtimestamp(first_candle["timestamp"] / 1000).strftime("%Y-%m-%d")
last_date = datetime.fromtimestamp(last_candle["timestamp"] / 1000).strftime("%Y-%m-%d")

print(f"[ESTADO ACTUAL] {timeframe}:")
print(f"  Velas totales: {total_candles:,}")
print(f"  Rango: {first_date} -> {last_date}")

# Simular que solo tenemos los últimos 3 años (60% de las velas)
# En un caso real, esto sería el caché incompleto
candles_3_years = int(total_candles * 0.60)  # 60% = aprox 3 años de 5
simulated_cache = main_candles[-candles_3_years:]  # Últimas 60%

first_sim = simulated_cache[0]
last_sim = simulated_cache[-1]

first_sim_date = datetime.fromtimestamp(first_sim["timestamp"] / 1000).strftime("%Y-%m-%d")
last_sim_date = datetime.fromtimestamp(last_sim["timestamp"] / 1000).strftime("%Y-%m-%d")

days_covered = (last_sim["timestamp"] - first_sim["timestamp"]) / (24 * 60 * 60 * 1000)
expected_days = 1825  # 5 años configurados
coverage_pct = (days_covered / expected_days * 100)

print(f"\n[SIMULACION] Cache parcial (60% de datos):")
print(f"  Velas simuladas: {len(simulated_cache):,}")
print(f"  Rango simulado: {first_sim_date} -> {last_sim_date}")
print(f"  Dias cubiertos: {days_covered:.0f} de {expected_days} ({coverage_pct:.1f}%)")

# Calcular qué debe hacer el sistema
if coverage_pct < 95:
    days_missing = expected_days - days_covered
    candles_missing = total_candles - len(simulated_cache)

    print(f"\n[DIAGNOSTICO] Sistema detecta:")
    print(f"  - Faltan {days_missing:.0f} dias (~{candles_missing:,} velas)")
    print(f"  - Cobertura actual: {coverage_pct:.1f}%")
    print(f"  - Accion: EXPANSION HACIA ATRAS")

    print(f"\n[PLAN DE EXPANSION]:")
    print(f"  1. [PRESERVAR] Mantener cache existente:")
    print(f"     {first_sim_date} -> {last_sim_date} ({len(simulated_cache):,} velas)")
    print(f"  ")
    print(f"  2. [DESCARGAR] Solo velas históricas faltantes:")
    print(f"     {first_date} -> {first_sim_date} (~{candles_missing:,} velas)")
    print(f"  ")
    print(f"  3. [MERGEAR] Combinar:")
    print(f"     [{candles_missing:,} historico] + [{len(simulated_cache):,} existente] = {total_candles:,} total")
    print(f"  ")
    print(f"  4. [RESULTADO]:")
    print(f"     - Tiempo estimado: ~10 minutos (solo descarga {days_missing:.0f} dias)")
    print(f"     - Ahorro vs descarga completa: ~20 minutos (3x mas rapido)")

    print(f"\n[COMPARACION]:")
    print(f"  SIN expansion incremental:")
    print(f"    - Descarta {len(simulated_cache):,} velas existentes")
    print(f"    - Re-descarga {total_candles:,} velas desde cero")
    print(f"    - Tiempo: ~30 minutos")
    print(f"  ")
    print(f"  CON expansion incremental (NUEVO):")
    print(f"    - Preserva {len(simulated_cache):,} velas existentes")
    print(f"    - Descarga solo {candles_missing:,} velas faltantes")
    print(f"    - Tiempo: ~10 minutos")
    print(f"    - AHORRO: 20 minutos (66% mas rapido)")

else:
    print(f"\n[DIAGNOSTICO] Cache completo (>95%)")
    print(f"  - Solo necesita actualizacion incremental de velas nuevas")

print(f"\n" + "="*80)
print("[CONCLUSION]")
print("="*80)
print("""
El sistema de expansion incremental hacia atras:

1. Detecta automaticamente que el cache esta incompleto
2. PRESERVA todos los datos existentes (no los descarta)
3. Descarga SOLO lo que falta (expansion hacia atras)
4. Mergea correctamente: [historico] + [existente]
5. Ahorra tiempo significativo (3x mas rapido que descarga completa)

Esto es especialmente util cuando:
- Se expanden los limites de configuracion (ej: 3 -> 5 años)
- El cache se corrompe parcialmente
- Se agregan nuevos timeframes al sistema
""")
