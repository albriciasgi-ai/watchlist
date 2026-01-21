#!/usr/bin/env python3
"""
Comparación de detectores DTB para timeframe 1 minuto
Objetivo: 17 patrones identificados visualmente
"""

import httpx
import json
from datetime import datetime
from double_topbottom_detector_fixed import DoubleTopBottomDetectorFixed

API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"
INTERVAL = "1"
DAYS = 1

# Configuración optimizada para 1 minuto
OPTIMAL_CONFIG = {
    "doubleTopBottom": {
        "enabled": True,
        "maxBreakoutPercent": 30,
        "lookbackBars": 2,
        "lookbackCandles": 20,
        "candlesPerExtreme": 2,
        "minBarsBetween": 2,
        "minCandlesBetween": 2,
        "maxCandlesBetween": 100,
        "patternTimeLimit": 1000,
        "priceMarginPercent": 5.0,
        "volumeFilter": {"enabled": False},
        "momentumConfirmation": {"enabled": False}
    },
    "filters": {
        "minConfidence": 1,
        "volumeFilter": {"enabled": False}
    },
    "postValidation": {
        "enabled": False
    }
}

def test_original_detector():
    """Prueba el detector original vía API"""
    print("\n" + "="*60)
    print("DETECTOR ORIGINAL (vía API)")
    print("="*60)

    payload = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "days": DAYS,
        "config": OPTIMAL_CONFIG
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

                double_tops = sum(1 for p in patterns if "top" in str(p.get("type", "")).lower())
                double_bottoms = sum(1 for p in patterns if "bottom" in str(p.get("type", "")).lower())

                print(f"Patrones detectados: {len(patterns)}")
                print(f"  - Double Tops: {double_tops}")
                print(f"  - Double Bottoms: {double_bottoms}")
                print(f"Eficiencia: {len(patterns)*100/17:.1f}% ({len(patterns)}/17)")

                return len(patterns)
            else:
                print(f"Error: HTTP {response.status_code}")
                return 0
    except Exception as e:
        print(f"Error: {e}")
        return 0

def test_fixed_detector():
    """Prueba el detector fixed directamente"""
    print("\n" + "="*60)
    print("DETECTOR FIXED (algoritmo mejorado)")
    print("="*60)

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
                print(f"Velas obtenidas: {len(candles)}")
            else:
                print(f"Error obteniendo datos: {response.status_code}")
                return 0
    except Exception as e:
        print(f"Error: {e}")
        return 0

    if not candles:
        print("No hay datos disponibles")
        return 0

    # Probar detector fixed
    detector = DoubleTopBottomDetectorFixed()
    patterns = detector.detect_patterns(SYMBOL, candles, OPTIMAL_CONFIG, INTERVAL, DAYS)

    double_tops = sum(1 for p in patterns if p.type == "DOUBLE_TOP")
    double_bottoms = sum(1 for p in patterns if p.type == "DOUBLE_BOTTOM")

    print(f"\nResultado final:")
    print(f"Patrones detectados: {len(patterns)}")
    print(f"  - Double Tops: {double_tops}")
    print(f"  - Double Bottoms: {double_bottoms}")

    if patterns:
        confidences = [p.confidence for p in patterns]
        print(f"  - Confianza promedio: {sum(confidences)/len(confidences):.1f}%")

    print(f"Eficiencia: {len(patterns)*100/17:.1f}% ({len(patterns)}/17)")

    # Mostrar algunos patrones
    if patterns and len(patterns) <= 20:
        print(f"\nTodos los patrones detectados:")
        for i, p in enumerate(patterns, 1):
            print(f"  {i}. {p.type}")
            print(f"     - Índices: {p.first_extreme['candle_index']} -> {p.second_extreme['candle_index']}")
            print(f"     - Precios: ${p.first_extreme['price']:.2f} -> ${p.second_extreme['price']:.2f}")
            print(f"     - Varianza: {p.price_variance:.2f}%")
            print(f"     - Confianza: {p.confidence:.1f}%")

    return len(patterns)

def main():
    print("="*80)
    print("COMPARACIÓN DE DETECTORES DTB")
    print("="*80)
    print(f"Symbol: {SYMBOL}")
    print(f"Interval: {INTERVAL} minuto")
    print(f"Days: {DAYS}")
    print(f"Objetivo: 17 patrones (identificados visualmente)")
    print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Probar detectores
    original_count = test_original_detector()
    fixed_count = test_fixed_detector()

    # Resumen comparativo
    print("\n" + "="*80)
    print("RESUMEN COMPARATIVO")
    print("="*80)
    print(f"Objetivo visual:    17 patrones (100%)")
    print(f"Detector Original:  {original_count} patrones ({original_count*100/17:.1f}%)")
    print(f"Detector Fixed:     {fixed_count} patrones ({fixed_count*100/17:.1f}%)")

    # Recomendación
    print("\n[ANÁLISIS]")
    if fixed_count > original_count and fixed_count <= 30:
        print("El detector FIXED muestra mejora significativa.")
        if fixed_count < 17:
            print(f"Aún faltan {17 - fixed_count} patrones por detectar.")
            print("Sugerencias:")
            print("1. Ajustar priceMarginPercent a 7-10%")
            print("2. Reducir minCandlesBetween a 1")
            print("3. Revisar visualmente qué patrones no se están detectando")
        elif fixed_count == 17:
            print("¡OBJETIVO ALCANZADO! El detector fixed detecta exactamente 17 patrones.")
        else:
            print(f"Se detectan {fixed_count - 17} patrones adicionales.")
            print("Considerar ajustar filtros de confianza para mayor precisión.")
    elif fixed_count > 30:
        print("El detector fixed está siendo demasiado permisivo.")
        print("Necesita ajustes para reducir falsos positivos.")
    else:
        print("El detector fixed no muestra mejora.")
        print("Se requiere revisión más profunda del algoritmo.")

    print(f"\nHora finalización: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()