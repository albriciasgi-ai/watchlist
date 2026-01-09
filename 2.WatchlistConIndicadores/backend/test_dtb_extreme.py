#!/usr/bin/env python3
"""
Prueba con configuraciones EXTREMADAMENTE permisivas para DTB
Objetivo: Detectar los 17 patrones identificados visualmente en 1 minuto
"""

import httpx
import json
from datetime import datetime

API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"
INTERVAL = "1"
DAYS = 1

# Configuraciones EXTREMAS - máxima permisividad posible
EXTREME_CONFIGS = [
    {
        "name": "ULTRA EXTREMO v1",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 50,  # EXTREMADAMENTE permisivo
                "lookbackBars": 1,  # MÍNIMO ABSOLUTO
                "lookbackCandles": 10,  # Ventana muy corta
                "candlesPerExtreme": 1,  # MÍNIMO
                "minBarsBetween": 1,  # MÍNIMO
                "minCandlesBetween": 1,  # MÍNIMO
                "maxCandlesBetween": 1000,  # Sin límite
                "patternTimeLimit": 10000,  # Sin restricción
                "priceMarginPercent": 10.0,  # Muy tolerante
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
        "name": "ULTRA EXTREMO v2 - Ventana amplia",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 100,  # Sin límite práctico
                "lookbackBars": 2,
                "lookbackCandles": 50,  # Ventana más amplia
                "candlesPerExtreme": 2,
                "minBarsBetween": 1,
                "minCandlesBetween": 1,
                "maxCandlesBetween": 1000,
                "patternTimeLimit": 10000,
                "priceMarginPercent": 15.0,  # Extremadamente tolerante
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
        "name": "MICRO PATRONES",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 25,
                "lookbackBars": 1,
                "lookbackCandles": 5,  # MUY corto para micro patrones
                "candlesPerExtreme": 1,
                "minBarsBetween": 1,
                "minCandlesBetween": 1,
                "maxCandlesBetween": 20,  # Limitar a patrones muy pequeños
                "patternTimeLimit": 30,  # Patrones muy recientes
                "priceMarginPercent": 20.0,
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
        "name": "SIN RESTRICCIONES",
        "config": {
            "doubleTopBottom": {
                "enabled": True,
                "maxBreakoutPercent": 1000,  # Sin límite
                "lookbackBars": 1,
                "lookbackCandles": 100,
                "candlesPerExtreme": 1,
                "minBarsBetween": 0,  # CERO restricción
                "minCandlesBetween": 0,  # CERO restricción
                "maxCandlesBetween": 10000,
                "patternTimeLimit": 100000,
                "priceMarginPercent": 50.0,  # 50% tolerancia
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
    }
]

def test_configuration(config_data):
    """Prueba una configuración específica"""

    name = config_data["name"]
    config = config_data["config"]

    payload = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "days": DAYS,
        "config": config
    }

    print(f"\n{'='*60}")
    print(f"PROBANDO: {name}")
    print(f"{'='*60}")

    # Mostrar parámetros clave
    dtb = config["doubleTopBottom"]
    print(f"Configuración:")
    print(f"  - maxBreakoutPercent: {dtb['maxBreakoutPercent']}%")
    print(f"  - lookbackBars: {dtb['lookbackBars']}")
    print(f"  - lookbackCandles: {dtb['lookbackCandles']}")
    print(f"  - minBarsBetween: {dtb['minBarsBetween']}")
    print(f"  - priceMarginPercent: {dtb['priceMarginPercent']}%")

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{API_URL}/api/double-topbottom/detect",
                json=payload
            )

            if response.status_code == 200:
                data = response.json()
                patterns = data.get("patterns", [])

                # Contar por tipo
                double_tops = sum(1 for p in patterns if "top" in str(p.get("type", "")).lower())
                double_bottoms = sum(1 for p in patterns if "bottom" in str(p.get("type", "")).lower())

                # Calcular confianza promedio
                avg_confidence = 0
                if patterns:
                    confidences = [p.get("confidence", 0) for p in patterns]
                    avg_confidence = sum(confidences) / len(confidences)

                print(f"\nResultados:")
                print(f"  TOTAL PATRONES: {len(patterns)}")
                print(f"  - Double Tops: {double_tops}")
                print(f"  - Double Bottoms: {double_bottoms}")
                print(f"  - Confianza promedio: {avg_confidence:.1f}%")

                # Eficiencia vs objetivo
                efficiency = len(patterns) * 100 / 17
                print(f"\n  Eficiencia: {efficiency:.1f}% ({len(patterns)}/17)")

                # Mostrar primeros patrones
                if patterns and len(patterns) <= 10:
                    print(f"\n  Todos los patrones detectados:")
                    for i, p in enumerate(patterns, 1):
                        print(f"    {i}. {p.get('type', 'unknown')} - Conf: {p.get('confidence', 0):.1f}%")
                elif patterns:
                    print(f"\n  Primeros 10 patrones:")
                    for i, p in enumerate(patterns[:10], 1):
                        print(f"    {i}. {p.get('type', 'unknown')} - Conf: {p.get('confidence', 0):.1f}%")

                return len(patterns), data

            else:
                print(f"[ERROR] HTTP {response.status_code}")
                print(f"Respuesta: {response.text[:500]}")
                return 0, None

    except Exception as e:
        print(f"[ERROR] {e}")
        return 0, None

def main():
    print("="*80)
    print("PRUEBA EXTREMA DTB - OBJETIVO: 17 PATRONES")
    print("="*80)
    print(f"Symbol: {SYMBOL}")
    print(f"Interval: {INTERVAL} minuto")
    print(f"Days: {DAYS}")
    print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    best_count = 0
    best_config = None
    best_data = None

    # Probar todas las configuraciones extremas
    for config in EXTREME_CONFIGS:
        count, data = test_configuration(config)

        if count > best_count:
            best_count = count
            best_config = config
            best_data = data

    # Resumen final
    print("\n" + "="*80)
    print("RESUMEN FINAL")
    print("="*80)

    if best_config:
        print(f"\nMEJOR CONFIGURACIÓN: {best_config['name']}")
        print(f"Patrones detectados: {best_count}")
        print(f"Eficiencia: {best_count*100/17:.1f}% vs objetivo de 17 patrones")

        if best_count < 17:
            print(f"\n[ANÁLISIS]")
            print(f"Faltantes: {17 - best_count} patrones")
            print(f"\nPosibles razones para la diferencia:")
            print("1. El algoritmo puede tener restricciones internas no configurables")
            print("2. Diferencia en la definición visual vs algorítmica de un patrón")
            print("3. Los micro-movimientos en 1-min pueden ser muy sutiles")
            print("4. Puede haber un bug en el código de detección de extremos")

            print(f"\nRECOMENDACIONES:")
            print("1. Revisar el código de _find_local_extremes() en double_topbottom_detector.py")
            print("2. Verificar si hay restricciones hardcodeadas en el algoritmo")
            print("3. Considerar implementar un algoritmo alternativo para 1-min")
            print("4. Analizar manualmente los patrones no detectados")
        else:
            print(f"\n[ÉXITO] Se alcanzó o superó el objetivo de detección!")
    else:
        print("[ERROR] No se obtuvieron resultados de ninguna configuración")

    print(f"\nHora finalización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()