#!/usr/bin/env python3
"""
Script de simulación para encontrar los parámetros óptimos de DTB
para timeframe de 1 minuto
"""

import asyncio
import httpx
import json
from itertools import product
from datetime import datetime
from statistics import mean, stdev

# Configuración del backend
API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"
INTERVAL = "1"  # 1 minuto
DAYS = 1

# Rangos de parámetros ULTRA PERMISIVOS para timeframe 1 minuto
PARAM_RANGES = {
    'maxBreakoutPercent': [15, 20, 25, 30, 50],  # MUY permisivo para micro movimientos
    'lookbackBars': [2, 3, 5, 7],  # Pocas velas para timeframe corto
    'minBarsBetween': [2, 3, 5, 10],  # Separación mínima muy corta
    'patternTimeLimit': [100, 200, 500, 1000],  # Tiempo muy amplio
    'minConfidence': [1, 5, 10, 15],  # Confianza muy baja
    'volumeZScoreThreshold': [0],  # Solo probar sin filtro de volumen
}

# Configuración fija (mejores prácticas conocidas)
FIXED_CONFIG = {
    "doubleTopBottom": {
        "enabled": True,
        "volumeFilter": {"enabled": False},  # Deshabilitado por defecto
        "momentumConfirmation": {
            "enabled": False  # Deshabilitado para máxima detección
        }
    },
    "filters": {
        "volumeFilter": {"enabled": False},  # Deshabilitado
    },
    "postValidation": {
        "enabled": True,
        "requireVolumeIncrease": False,
        "requireMomentumDivergence": False
    }
}


async def test_configuration(config_params):
    """Prueba una configuración específica y retorna los resultados"""

    # Crear la configuración completa
    config = FIXED_CONFIG.copy()
    config["doubleTopBottom"]["maxBreakoutPercent"] = config_params['maxBreakoutPercent']
    config["doubleTopBottom"]["lookbackBars"] = config_params['lookbackBars']
    config["doubleTopBottom"]["lookbackCandles"] = config_params['lookbackBars'] * 10  # También mapear lookbackCandles
    config["doubleTopBottom"]["candlesPerExtreme"] = config_params['lookbackBars']  # Usar mismo valor para candlesPerExtreme
    config["doubleTopBottom"]["minBarsBetween"] = config_params['minBarsBetween']
    config["doubleTopBottom"]["minCandlesBetween"] = config_params['minBarsBetween']  # También mapear minCandlesBetween
    config["doubleTopBottom"]["patternTimeLimit"] = config_params['patternTimeLimit']
    config["filters"]["minConfidence"] = config_params['minConfidence']

    if config_params['volumeZScoreThreshold'] > 0:
        config["filters"]["volumeFilter"] = True
        config["filters"]["volumeZScoreThreshold"] = config_params['volumeZScoreThreshold']

    # Preparar el payload
    payload = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "days": DAYS,
        "config": config
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{API_URL}/api/double-topbottom/detect",
                json=payload
            )

            if response.status_code == 200:
                data = response.json()
                pattern_count = len(data.get("patterns", []))

                # Calcular tipos de patrones
                patterns = data.get("patterns", [])
                double_tops = sum(1 for p in patterns if p.get("type") == "double_top")
                double_bottoms = sum(1 for p in patterns if p.get("type") == "double_bottom")

                # Calcular confianza promedio
                avg_confidence = 0
                if patterns:
                    confidences = [p.get("confidence", 0) for p in patterns]
                    avg_confidence = sum(confidences) / len(confidences)

                return {
                    "success": True,
                    "pattern_count": pattern_count,
                    "double_tops": double_tops,
                    "double_bottoms": double_bottoms,
                    "avg_confidence": avg_confidence,
                    "params": config_params,
                    "error": None
                }
            else:
                return {
                    "success": False,
                    "pattern_count": 0,
                    "params": config_params,
                    "error": f"HTTP {response.status_code}"
                }
    except Exception as e:
        return {
            "success": False,
            "pattern_count": 0,
            "params": config_params,
            "error": str(e)
        }


async def run_simulation():
    """Ejecuta la simulación con todas las combinaciones de parámetros"""

    print("=" * 80)
    print(f"SIMULACIÓN DE PARÁMETROS DTB - {SYMBOL} - {INTERVAL}min - {DAYS} día(s)")
    print("=" * 80)
    print(f"Hora de inicio: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # Generar todas las combinaciones de parámetros
    param_names = list(PARAM_RANGES.keys())
    param_values = [PARAM_RANGES[name] for name in param_names]
    all_combinations = list(product(*param_values))

    total_tests = len(all_combinations)
    print(f"Total de combinaciones a probar: {total_tests}")
    print(f"Tiempo estimado: {total_tests * 2 // 60} minutos\n")

    # Limitar a las primeras 100 combinaciones para no sobrecargar
    if total_tests > 100:
        print(f"[!] Limitando a las primeras 100 combinaciones...")
        all_combinations = all_combinations[:100]

    results = []
    batch_size = 5  # Procesar de a 5 para no saturar el servidor

    for i in range(0, len(all_combinations), batch_size):
        batch = all_combinations[i:i+batch_size]
        batch_configs = []

        for combo in batch:
            config_params = dict(zip(param_names, combo))
            batch_configs.append(config_params)

        # Ejecutar batch en paralelo
        batch_results = await asyncio.gather(*[
            test_configuration(cfg) for cfg in batch_configs
        ])

        results.extend(batch_results)

        # Mostrar progreso
        progress = min(i + batch_size, len(all_combinations))
        print(f"Progreso: {progress}/{len(all_combinations)} ({progress*100//len(all_combinations)}%)")

        # Mostrar mejor resultado hasta ahora
        successful = [r for r in results if r["success"]]
        if successful:
            best = max(successful, key=lambda x: x["pattern_count"])
            print(f"  Mejor hasta ahora: {best['pattern_count']} patrones con:")
            print(f"    - maxBreakout: {best['params']['maxBreakoutPercent']}%")
            print(f"    - lookbackBars: {best['params']['lookbackBars']}")
            print(f"    - minBarsBetween: {best['params']['minBarsBetween']}")
            print(f"    - minConfidence: {best['params']['minConfidence']}%")
            print()

    # Análisis de resultados
    print("\n" + "=" * 80)
    print("ANÁLISIS DE RESULTADOS")
    print("=" * 80)

    successful_results = [r for r in results if r["success"]]

    if not successful_results:
        print("[ERROR] No se obtuvieron resultados exitosos")
        return

    # Ordenar por cantidad de patrones detectados
    sorted_results = sorted(successful_results, key=lambda x: x["pattern_count"], reverse=True)

    # Top 10 mejores configuraciones
    print("\n[TOP 10] TOP 10 MEJORES CONFIGURACIONES:")
    print("-" * 80)

    for idx, result in enumerate(sorted_results[:10], 1):
        print(f"\n{idx}. {result['pattern_count']} patrones detectados")
        print(f"   Tipos: {result['double_tops']} tops, {result['double_bottoms']} bottoms")
        print(f"   Confianza promedio: {result['avg_confidence']:.1f}%")
        print(f"   Parámetros:")
        print(f"   - maxBreakoutPercent: {result['params']['maxBreakoutPercent']}%")
        print(f"   - lookbackBars: {result['params']['lookbackBars']}")
        print(f"   - minBarsBetween: {result['params']['minBarsBetween']}")
        print(f"   - patternTimeLimit: {result['params']['patternTimeLimit']}")
        print(f"   - minConfidence: {result['params']['minConfidence']}%")
        print(f"   - volumeZScore: {result['params']['volumeZScoreThreshold']}")

    # Análisis estadístico
    print("\n[+] ANÁLISIS ESTADÍSTICO:")
    print("-" * 80)

    # Calcular correlación simplificada (sin pandas)
    print("\nImpacto de parámetros en detección de patrones:")
    for param in param_names:
        param_values = [r['params'][param] for r in successful_results]
        pattern_counts = [r['pattern_count'] for r in successful_results]

        # Calcular si valores más altos del parámetro resultan en más patrones
        if len(set(param_values)) > 1:  # Solo si hay variación
            # Dividir en dos grupos: valores bajos y altos
            median_param = sorted(param_values)[len(param_values)//2]
            low_group = [pattern_counts[i] for i, v in enumerate(param_values) if v <= median_param]
            high_group = [pattern_counts[i] for i, v in enumerate(param_values) if v > median_param]

            if low_group and high_group:
                avg_low = mean(low_group)
                avg_high = mean(high_group)
                diff = avg_high - avg_low
                impact = "[+] Positivo" if diff > 0 else "[-] Negativo"
                print(f"  {param}: {impact} (diff: {diff:.1f} patrones)")

    # Valores óptimos promedio del top 25%
    top_25_percent = sorted_results[:max(1, len(sorted_results)//4)]

    print(f"\n[RECOMENDADO] CONFIGURACIÓN RECOMENDADA (promedio del top 25%):")
    print("-" * 80)

    for param in param_names:
        values = [r['params'][param] for r in top_25_percent]
        avg_value = sum(values) / len(values)
        print(f"  {param}: {avg_value:.1f}")

    # Guardar resultados completos
    output_file = f"dtb_simulation_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'symbol': SYMBOL,
            'interval': INTERVAL,
            'days': DAYS,
            'total_tests': len(results),
            'successful_tests': len(successful_results),
            'top_10': sorted_results[:10],
            'all_results': sorted_results
        }, f, indent=2)

    print(f"\n[GUARDADO] Resultados guardados en: {output_file}")
    print(f"\nHora de finalización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    print("Iniciando simulación de parámetros DTB...")
    print("Asegúrate de que el backend esté corriendo en puerto 8000\n")

    try:
        asyncio.run(run_simulation())
    except KeyboardInterrupt:
        print("\n\n[!] Simulación interrumpida por el usuario")
    except Exception as e:
        print(f"\n[ERROR] Error durante la simulación: {e}")