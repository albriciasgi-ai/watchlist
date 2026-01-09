#!/usr/bin/env python3
"""
Test directo con configuración óptima para 1 minuto
Basado en análisis manual que detectó 40+ patrones
"""

import httpx
import json
from datetime import datetime

API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"
INTERVAL = "1"
DAYS = 1

# Configuración ULTRA PERMISIVA basada en análisis manual
OPTIMAL_CONFIG = {
    "doubleTopBottom": {
        "enabled": True,
        "maxBreakoutPercent": 30,  # MUY permisivo
        "lookbackBars": 2,  # Mínimo absoluto
        "lookbackCandles": 20,  # Ventana de búsqueda
        "candlesPerExtreme": 2,  # Mínimo para detectar extremos
        "minBarsBetween": 2,  # Separación mínima
        "minCandlesBetween": 2,  # Mismo valor
        "maxCandlesBetween": 100,  # Amplio rango
        "patternTimeLimit": 1000,  # Sin restricción temporal
        "priceMarginPercent": 5.0,  # Tolerancia de precio alta
        "volumeFilter": {"enabled": False},
        "momentumConfirmation": {"enabled": False}
    },
    "filters": {
        "minConfidence": 1,  # Sin filtro de confianza
        "volumeFilter": {"enabled": False}
    },
    "postValidation": {
        "enabled": False  # Sin validación posterior
    }
}

def test_configuration():
    """Prueba la configuración óptima"""

    payload = {
        "symbol": SYMBOL,
        "interval": INTERVAL,
        "days": DAYS,
        "config": OPTIMAL_CONFIG
    }

    print("=" * 80)
    print("TEST CONFIGURACIÓN ÓPTIMA DTB - 1 MINUTO")
    print("=" * 80)
    print(f"Symbol: {SYMBOL}")
    print(f"Interval: {INTERVAL} min")
    print(f"Days: {DAYS}")
    print()
    print("Configuración:")
    print(f"  maxBreakoutPercent: {OPTIMAL_CONFIG['doubleTopBottom']['maxBreakoutPercent']}%")
    print(f"  lookbackBars: {OPTIMAL_CONFIG['doubleTopBottom']['lookbackBars']}")
    print(f"  minBarsBetween: {OPTIMAL_CONFIG['doubleTopBottom']['minBarsBetween']}")
    print(f"  minConfidence: {OPTIMAL_CONFIG['filters']['minConfidence']}%")
    print()

    try:
        with httpx.Client(timeout=30.0) as client:
            print("Enviando solicitud al backend...")
            response = client.post(
                f"{API_URL}/api/double-topbottom/detect",
                json=payload
            )

            if response.status_code == 200:
                data = response.json()
                patterns = data.get("patterns", [])

                print(f"\n[RESULTADO]")
                print("-" * 60)
                print(f"Patrones detectados: {len(patterns)}")

                # Contar por tipo
                double_tops = sum(1 for p in patterns if p.get("type") == "double_top" or p.get("type") == "DOUBLE_TOP")
                double_bottoms = sum(1 for p in patterns if p.get("type") == "double_bottom" or p.get("type") == "DOUBLE_BOTTOM")

                print(f"  - Double Tops: {double_tops}")
                print(f"  - Double Bottoms: {double_bottoms}")

                # Confianza promedio
                if patterns:
                    confidences = [p.get("confidence", 0) for p in patterns]
                    avg_confidence = sum(confidences) / len(confidences)
                    print(f"  - Confianza promedio: {avg_confidence:.1f}%")

                # Mostrar primeros 10 patrones
                if patterns:
                    print(f"\nPrimeros 10 patrones:")
                    for i, p in enumerate(patterns[:10], 1):
                        print(f"  {i}. {p.get('type', 'unknown')} - Conf: {p.get('confidence', 0):.1f}%")

                # Análisis vs objetivo
                print(f"\n[ANÁLISIS]")
                print("-" * 60)
                print(f"Objetivo visual: 17 patrones")
                print(f"Detectados: {len(patterns)} patrones")
                print(f"Eficiencia: {len(patterns)*100/17:.1f}%")

                if len(patterns) < 17:
                    print(f"\n[SUGERENCIAS]")
                    print("Si aún faltan patrones, considerar:")
                    print("1. Aumentar maxBreakoutPercent a 50%")
                    print("2. Reducir lookbackBars a 1")
                    print("3. Aumentar priceMarginPercent a 10%")
                    print("4. Revisar si el algoritmo maneja correctamente micro-movimientos")

                return patterns

            else:
                print(f"[ERROR] HTTP {response.status_code}")
                print(f"Respuesta: {response.text}")
                return []

    except Exception as e:
        print(f"[ERROR] {e}")
        return []


if __name__ == "__main__":
    patterns = test_configuration()

    print(f"\nHora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")