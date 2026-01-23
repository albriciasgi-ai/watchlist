#!/usr/bin/env python3
"""
Test de implementación del detector DTB Fixed en producción
"""

import httpx
import json
from datetime import datetime

API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"

# Configuración optimizada
CONFIG = {
    "doubleTopBottom": {
        "enabled": True,
        "maxBreakoutPercent": 50,
        "lookbackBars": 2,
        "lookbackCandles": 30,
        "candlesPerExtreme": 2,
        "minBarsBetween": 1,
        "minCandlesBetween": 1,
        "maxCandlesBetween": 150,
        "patternTimeLimit": 2000,
        "priceMarginPercent": 10.0,
        "volumeFilter": {"enabled": False},
        "momentumConfirmation": {"enabled": False}
    },
    "filters": {
        "minConfidence": 70,
        "volumeFilter": {"enabled": False}
    },
    "postValidation": {
        "enabled": False
    }
}

def test_timeframe(interval, days):
    """Prueba un timeframe específico"""
    payload = {
        "symbol": SYMBOL,
        "interval": interval,
        "days": days,
        "config": CONFIG
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

                double_tops = sum(1 for p in patterns if "TOP" in str(p.get("type", "")))
                double_bottoms = sum(1 for p in patterns if "BOTTOM" in str(p.get("type", "")))

                return {
                    "success": True,
                    "total": len(patterns),
                    "tops": double_tops,
                    "bottoms": double_bottoms
                }
            else:
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}"
                }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    print("="*80)
    print("TEST DE IMPLEMENTACIÓN DTB FIXED")
    print("="*80)
    print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Symbol: {SYMBOL}")
    print()

    # Probar diferentes timeframes
    tests = [
        ("1", 1, "FIXED"),      # Debe usar detector fixed
        ("3", 1, "FIXED"),      # Debe usar detector fixed
        ("5", 1, "FIXED"),      # Debe usar detector fixed
        ("15", 3, "ORIGINAL"),  # Debe usar detector original
        ("60", 7, "ORIGINAL"),  # Debe usar detector original
    ]

    print("Probando diferentes timeframes:")
    print("-" * 60)

    for interval, days, expected_detector in tests:
        print(f"\nTimeframe: {interval} min, Days: {days}")
        print(f"Esperado: Detector {expected_detector}")

        result = test_timeframe(interval, days)

        if result["success"]:
            print(f"Resultado: {result['total']} patrones")
            print(f"  - Double Tops: {result['tops']}")
            print(f"  - Double Bottoms: {result['bottoms']}")

            # Verificación de mejora para timeframes cortos
            if interval in ["1", "3", "5"]:
                if result["total"] >= 8:
                    print("  ✓ MEJORA CONFIRMADA (8+ patrones)")
                elif result["total"] >= 5:
                    print("  ~ Mejora parcial (5-7 patrones)")
                else:
                    print("  ! Pocos patrones detectados")
        else:
            print(f"Error: {result['error']}")

    print("\n" + "="*80)
    print("CONCLUSIÓN")
    print("="*80)
    print("Si los timeframes 1, 3, 5 muestran 8+ patrones,")
    print("la implementación del detector FIXED está funcionando correctamente.")
    print("\nPara verificar en el frontend:")
    print("1. Abrir la aplicación en http://localhost:5173")
    print("2. Seleccionar timeframe 1 minuto")
    print("3. Verificar que aparezcan ~10 patrones DTB")

if __name__ == "__main__":
    main()