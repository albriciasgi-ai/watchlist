#!/usr/bin/env python3
"""
Prueba rápida de configuraciones DTB específicas para 1 minuto
Basado en que el usuario ya detecta 5 de 17 patrones visualmente identificados
"""

import httpx
import json
from datetime import datetime

# Configuración
API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"
INTERVAL = "1"
DAYS = 1

# Configuraciones específicas a probar (más permisivas para 1-min)
TEST_CONFIGS = [
    {
        "name": "Ultra Permisivo",
        "params": {
            "maxBreakoutPercent": 15,  # Muy permisivo
            "lookbackBars": 3,  # Pocas barras para timeframe corto
            "minBarsBetween": 5,  # Separación mínima
            "patternTimeLimit": 300,  # Tiempo amplio
            "minConfidence": 10,  # Confianza muy baja
            "volumeZScoreThreshold": 0  # Sin filtro de volumen
        }
    },
    {
        "name": "Permisivo Balanceado",
        "params": {
            "maxBreakoutPercent": 10,
            "lookbackBars": 5,
            "minBarsBetween": 10,
            "patternTimeLimit": 200,
            "minConfidence": 20,
            "volumeZScoreThreshold": 0
        }
    },
    {
        "name": "Moderado",
        "params": {
            "maxBreakoutPercent": 7,  # Como tienes configurado
            "lookbackBars": 10,
            "minBarsBetween": 15,
            "patternTimeLimit": 150,
            "minConfidence": 30,
            "volumeZScoreThreshold": 0
        }
    },
    {
        "name": "Lookback Corto",
        "params": {
            "maxBreakoutPercent": 10,
            "lookbackBars": 3,  # MUY corto para 1-min
            "minBarsBetween": 8,
            "patternTimeLimit": 100,
            "minConfidence": 15,
            "volumeZScoreThreshold": 0
        }
    },
    {
        "name": "Sin Restricciones Temporales",
        "params": {
            "maxBreakoutPercent": 12,
            "lookbackBars": 5,
            "minBarsBetween": 3,  # Muy corto
            "patternTimeLimit": 500,  # Muy largo
            "minConfidence": 10,
            "volumeZScoreThreshold": 0
        }
    }
]

def test_configuration(name, params):
    """Prueba una configuración específica"""

    # Crear la configuración completa
    config = {
        "doubleTopBottom": {
            "enabled": True,
            "maxBreakoutPercent": params['maxBreakoutPercent'],
            "lookbackBars": params['lookbackBars'],
            "minBarsBetween": params['minBarsBetween'],
            "patternTimeLimit": params['patternTimeLimit'],
            "volumeFilter": {"enabled": False},
            "momentumConfirmation": {
                "enabled": False
            }
        },
        "filters": {
            "minConfidence": params['minConfidence'],
            "volumeFilter": False
        },
        "postValidation": {
            "enabled": True,
            "requireVolumeIncrease": False,
            "requireMomentumDivergence": False
        }
    }

    # Payload completo
    payload = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "days": DAYS,
        "config": config
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{API_URL}/api/double-topbottom/detect",
                json=payload
            )

            if response.status_code == 200:
                data = response.json()
                patterns = data.get("patterns", [])
                pattern_count = len(patterns)

                # Analizar tipos
                double_tops = sum(1 for p in patterns if p.get("type") == "double_top")
                double_bottoms = sum(1 for p in patterns if p.get("type") == "double_bottom")

                # Confianza promedio
                avg_confidence = 0
                if patterns:
                    confidences = [p.get("confidence", 0) for p in patterns]
                    avg_confidence = sum(confidences) / len(confidences)

                print(f"\n[RESULTADO] {name}:")
                print("-" * 60)
                print(f"  Patrones detectados: {pattern_count}")
                print(f"  - Double Tops: {double_tops}")
                print(f"  - Double Bottoms: {double_bottoms}")
                print(f"  Confianza promedio: {avg_confidence:.1f}%")
                print(f"  Parámetros:")
                print(f"  - maxBreakoutPercent: {params['maxBreakoutPercent']}%")
                print(f"  - lookbackBars: {params['lookbackBars']}")
                print(f"  - minBarsBetween: {params['minBarsBetween']}")
                print(f"  - patternTimeLimit: {params['patternTimeLimit']}")
                print(f"  - minConfidence: {params['minConfidence']}%")

                # Mostrar algunos patrones de ejemplo
                if patterns:
                    print(f"\n  Primeros 3 patrones:")
                    for i, p in enumerate(patterns[:3], 1):
                        print(f"    {i}. {p.get('type', 'unknown')} - "
                              f"Conf: {p.get('confidence', 0):.1f}% - "
                              f"Time: {p.get('first_extreme_time', 'N/A')}")

                return pattern_count, patterns

            else:
                print(f"\n[ERROR] {name}: HTTP {response.status_code}")
                return 0, []

    except Exception as e:
        print(f"\n[ERROR] {name}: {e}")
        return 0, []


def main():
    print("=" * 80)
    print(f"PRUEBA RÁPIDA DE CONFIGURACIONES DTB")
    print(f"Symbol: {SYMBOL} | Interval: {INTERVAL}min | Days: {DAYS}")
    print("=" * 80)
    print(f"Hora de inicio: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    results = []

    # Probar cada configuración
    for config in TEST_CONFIGS:
        count, patterns = test_configuration(config["name"], config["params"])
        results.append({
            "name": config["name"],
            "count": count,
            "params": config["params"],
            "patterns": patterns
        })

    # Resumen final
    print("\n" + "=" * 80)
    print("RESUMEN DE RESULTADOS")
    print("=" * 80)

    # Ordenar por cantidad de patrones
    sorted_results = sorted(results, key=lambda x: x["count"], reverse=True)

    print("\nRanking de configuraciones:")
    for i, result in enumerate(sorted_results, 1):
        status = "[MEJOR]" if i == 1 else ""
        print(f"{i}. {result['name']}: {result['count']} patrones {status}")

    # Mejor configuración
    if sorted_results:
        best = sorted_results[0]
        print(f"\n[CONFIGURACIÓN ÓPTIMA ENCONTRADA]")
        print("-" * 60)
        print(f"Nombre: {best['name']}")
        print(f"Patrones detectados: {best['count']}")
        print(f"Parámetros recomendados:")
        print(f"  - maxBreakoutPercent: {best['params']['maxBreakoutPercent']}%")
        print(f"  - lookbackBars: {best['params']['lookbackBars']}")
        print(f"  - minBarsBetween: {best['params']['minBarsBetween']}")
        print(f"  - patternTimeLimit: {best['params']['patternTimeLimit']}")
        print(f"  - minConfidence: {best['params']['minConfidence']}%")

        # Análisis vs objetivo
        print(f"\n[ANÁLISIS]")
        print("-" * 60)
        print(f"Objetivo: 17 patrones (identificados visualmente)")
        print(f"Actual mejor: {best['count']} patrones")
        print(f"Eficiencia: {best['count']*100/17:.1f}%")

        if best['count'] < 17:
            print(f"\nSugerencias para mejorar:")
            print("1. Aumentar maxBreakoutPercent (probar 20-25%)")
            print("2. Reducir lookbackBars a 2-3")
            print("3. Reducir minBarsBetween a 3-5")
            print("4. Reducir minConfidence a 5-10%")
            print("5. Verificar que el algoritmo detecte patrones muy pequeños")

    print(f"\nHora de finalización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()