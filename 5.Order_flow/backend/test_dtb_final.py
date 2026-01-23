#!/usr/bin/env python3
"""
Test final con parámetros ajustados para alcanzar 17 patrones
"""

import httpx
import json
from datetime import datetime
from double_topbottom_detector_fixed import DoubleTopBottomDetectorFixed

API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"
INTERVAL = "1"
DAYS = 1

# Diferentes configuraciones para probar
CONFIGS = [
    {
        "name": "Más Permisivo (7% tolerancia)",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 50,
                "lookbackBars": 2,
                "lookbackCandles": 30,
                "candlesPerExtreme": 2,
                "minBarsBetween": 1,  # Reducido a 1
                "minCandlesBetween": 1,
                "maxCandlesBetween": 150,  # Ampliado
                "patternTimeLimit": 2000,
                "priceMarginPercent": 7.0,  # Aumentado a 7%
                "volumeFilter": {"enabled": False},
                "momentumConfirmation": {"enabled": False}
            },
            "filters": {
                "minConfidence": 0,  # Sin filtro
                "volumeFilter": {"enabled": False}
            },
            "postValidation": {
                "enabled": False
            }
        }
    },
    {
        "name": "Ultra Permisivo (10% tolerancia)",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 100,
                "lookbackBars": 1,
                "lookbackCandles": 50,
                "candlesPerExtreme": 1,
                "minBarsBetween": 1,
                "minCandlesBetween": 1,
                "maxCandlesBetween": 200,
                "patternTimeLimit": 5000,
                "priceMarginPercent": 10.0,  # 10% tolerancia
                "volumeFilter": {"enabled": False},
                "momentumConfirmation": {"enabled": False}
            },
            "filters": {
                "minConfidence": 0,
                "volumeFilter": {"enabled": False}
            },
            "postValidation": {
                "enabled": False
            }
        }
    },
    {
        "name": "Balanceado (confianza 50%)",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 40,
                "lookbackBars": 2,
                "lookbackCandles": 40,
                "candlesPerExtreme": 2,
                "minBarsBetween": 2,
                "minCandlesBetween": 2,
                "maxCandlesBetween": 120,
                "patternTimeLimit": 1500,
                "priceMarginPercent": 6.0,
                "volumeFilter": {"enabled": False},
                "momentumConfirmation": {"enabled": False}
            },
            "filters": {
                "minConfidence": 50,  # Filtro de confianza medio
                "volumeFilter": {"enabled": False}
            },
            "postValidation": {
                "enabled": False
            }
        }
    }
]

def test_configuration(config_data, detector, candles):
    """Prueba una configuración específica"""
    name = config_data["name"]
    config = config_data["config"]

    print(f"\n{'='*60}")
    print(f"Probando: {name}")
    print(f"{'='*60}")

    # Mostrar parámetros clave
    dtb = config["doubleTopBottom"]
    print(f"Configuración:")
    print(f"  - priceMarginPercent: {dtb['priceMarginPercent']}%")
    print(f"  - minCandlesBetween: {dtb['minCandlesBetween']}")
    print(f"  - maxCandlesBetween: {dtb['maxCandlesBetween']}")
    print(f"  - candlesPerExtreme: {dtb['candlesPerExtreme']}")
    print(f"  - minConfidence: {config['filters']['minConfidence']}%")

    patterns = detector.detect_patterns(SYMBOL, candles, config, INTERVAL, DAYS)

    double_tops = sum(1 for p in patterns if p.type == "DOUBLE_TOP")
    double_bottoms = sum(1 for p in patterns if p.type == "DOUBLE_BOTTOM")

    print(f"\nResultados:")
    print(f"  TOTAL: {len(patterns)} patrones")
    print(f"  - Double Tops: {double_tops}")
    print(f"  - Double Bottoms: {double_bottoms}")

    if patterns:
        confidences = [p.confidence for p in patterns]
        print(f"  - Confianza promedio: {sum(confidences)/len(confidences):.1f}%")

    efficiency = len(patterns) * 100 / 17
    print(f"\nEficiencia: {efficiency:.1f}% ({len(patterns)}/17)")

    # Análisis de cercanía al objetivo
    diff = abs(17 - len(patterns))
    if diff == 0:
        print("¡OBJETIVO ALCANZADO! Exactamente 17 patrones")
    elif diff <= 3:
        print(f"MUY CERCA del objetivo (diferencia: {diff})")
    elif diff <= 7:
        print(f"CERCA del objetivo (diferencia: {diff})")
    else:
        print(f"Lejos del objetivo (diferencia: {diff})")

    return len(patterns), patterns

def main():
    print("="*80)
    print("TEST FINAL DTB - OBJETIVO: 17 PATRONES")
    print("="*80)
    print(f"Symbol: {SYMBOL}")
    print(f"Interval: {INTERVAL} minuto")
    print(f"Days: {DAYS}")
    print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Obtener datos
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{API_URL}/api/historical/{SYMBOL}",
                params={"interval": INTERVAL, "days": DAYS}
            )

            if response.status_code == 200:
                data = response.json()
                candles = data.get("data", [])
                print(f"\nVelas obtenidas: {len(candles)}")
            else:
                print(f"Error obteniendo datos: {response.status_code}")
                return
    except Exception as e:
        print(f"Error: {e}")
        return

    if not candles:
        print("No hay datos disponibles")
        return

    # Crear detector
    detector = DoubleTopBottomDetectorFixed()

    # Probar todas las configuraciones
    best_config = None
    best_count = 0
    best_diff = 100

    for config_data in CONFIGS:
        count, patterns = test_configuration(config_data, detector, candles)

        # Buscar la configuración más cercana a 17
        diff = abs(17 - count)
        if diff < best_diff:
            best_diff = diff
            best_count = count
            best_config = (config_data["name"], patterns)

    # Resumen final
    print("\n" + "="*80)
    print("RESUMEN FINAL")
    print("="*80)

    if best_config:
        name, patterns = best_config
        print(f"\nMEJOR CONFIGURACIÓN: {name}")
        print(f"Patrones detectados: {best_count}")
        print(f"Eficiencia: {best_count*100/17:.1f}%")

        if best_count == 17:
            print("\n¡ÉXITO! Se detectaron exactamente 17 patrones como el objetivo.")
        elif best_count < 17:
            print(f"\nFaltan {17 - best_count} patrones.")
            print("Recomendaciones:")
            print("1. Aumentar priceMarginPercent gradualmente")
            print("2. Verificar visualmente los patrones no detectados")
            print("3. Considerar que algunos patrones visuales pueden no cumplir criterios técnicos estrictos")
        else:
            print(f"\nSe detectan {best_count - 17} patrones adicionales.")
            print("Recomendaciones:")
            print("1. Aumentar minConfidence gradualmente")
            print("2. Reducir priceMarginPercent")
            print("3. Aumentar minCandlesBetween")

        # Mostrar primeros patrones si son pocos
        if patterns and len(patterns) <= 25:
            print(f"\nPatrones detectados (índices de velas):")
            for i, p in enumerate(patterns, 1):
                print(f"  {i}. {p.type[7:]} [{p.first_extreme['candle_index']}->{p.second_extreme['candle_index']}] "
                      f"Conf:{p.confidence:.0f}%")

    print(f"\nHora finalización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()