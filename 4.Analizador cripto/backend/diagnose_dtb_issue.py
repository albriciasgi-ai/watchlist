#!/usr/bin/env python3
"""
Diagnóstico del problema DTB en timeframe de 1 minuto
"""

import httpx
import json
from datetime import datetime

API_URL = "http://localhost:8000"
SYMBOL = "BTCUSDT"

def get_historical_data(interval="1", days=1):
    """Obtener datos históricos del API"""
    url = f"{API_URL}/api/historical/{SYMBOL}"
    params = {
        "interval": interval,
        "days": days
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                # Retornar solo el array de velas
                return data.get("data", [])
            else:
                print(f"[ERROR] HTTP {response.status_code} al obtener datos")
                return None
    except Exception as e:
        print(f"[ERROR] {e}")
        return None


def analyze_data(candles):
    """Analizar los datos recibidos"""
    if not candles:
        print("[ERROR] No hay datos de velas")
        return

    print(f"\n[ANÁLISIS DE DATOS]")
    print("-" * 60)
    print(f"Total de velas recibidas: {len(candles)}")

    if len(candles) > 0:
        # Primera y última vela
        first = candles[0]
        last = candles[-1]

        print(f"Primera vela:")
        print(f"  - Timestamp: {first.get('timestamp')}")
        print(f"  - Open: {first.get('open')}")
        print(f"  - High: {first.get('high')}")
        print(f"  - Low: {first.get('low')}")
        print(f"  - Close: {first.get('close')}")
        print(f"  - Volume: {first.get('volume')}")

        print(f"\nÚltima vela:")
        print(f"  - Timestamp: {last.get('timestamp')}")
        print(f"  - Open: {last.get('open')}")
        print(f"  - High: {last.get('high')}")
        print(f"  - Low: {last.get('low')}")
        print(f"  - Close: {last.get('close')}")
        print(f"  - Volume: {last.get('volume')}")

        # Análisis de rangos de precio
        prices = []
        for candle in candles:
            if candle.get('high') and candle.get('low'):
                prices.append(float(candle['high']))
                prices.append(float(candle['low']))

        if prices:
            min_price = min(prices)
            max_price = max(prices)
            price_range = max_price - min_price
            price_range_pct = (price_range / min_price) * 100

            print(f"\n[RANGO DE PRECIOS]")
            print(f"  - Mínimo: ${min_price:.2f}")
            print(f"  - Máximo: ${max_price:.2f}")
            print(f"  - Rango: ${price_range:.2f} ({price_range_pct:.2f}%)")

        # Buscar extremos locales manualmente
        highs = []
        lows = []
        lookback = 10  # Barras para considerar como extremo local

        for i in range(lookback, len(candles) - lookback):
            candle = candles[i]

            # Es un high local?
            is_high = True
            for j in range(i - lookback, i + lookback + 1):
                if j != i and candles[j]['high'] >= candle['high']:
                    is_high = False
                    break
            if is_high:
                highs.append(i)

            # Es un low local?
            is_low = True
            for j in range(i - lookback, i + lookback + 1):
                if j != i and candles[j]['low'] <= candle['low']:
                    is_low = False
                    break
            if is_low:
                lows.append(i)

        print(f"\n[EXTREMOS LOCALES (lookback={lookback})]")
        print(f"  - Highs encontrados: {len(highs)}")
        print(f"  - Lows encontrados: {len(lows)}")

        # Detectar patrones manualmente (simplificado)
        if len(highs) >= 2:
            print(f"\n[POSIBLES DOUBLE TOPS]")
            for i in range(len(highs) - 1):
                idx1 = highs[i]
                idx2 = highs[i + 1]
                price1 = float(candles[idx1]['high'])
                price2 = float(candles[idx2]['high'])
                diff_pct = abs(price1 - price2) / price1 * 100

                if diff_pct < 5:  # Diferencia menor al 5%
                    bars_between = idx2 - idx1
                    print(f"  - Índices {idx1} y {idx2}")
                    print(f"    Precios: ${price1:.2f} y ${price2:.2f}")
                    print(f"    Diferencia: {diff_pct:.2f}%")
                    print(f"    Barras entre: {bars_between}")

        if len(lows) >= 2:
            print(f"\n[POSIBLES DOUBLE BOTTOMS]")
            for i in range(len(lows) - 1):
                idx1 = lows[i]
                idx2 = lows[i + 1]
                price1 = float(candles[idx1]['low'])
                price2 = float(candles[idx2]['low'])
                diff_pct = abs(price1 - price2) / price1 * 100

                if diff_pct < 5:  # Diferencia menor al 5%
                    bars_between = idx2 - idx1
                    print(f"  - Índices {idx1} y {idx2}")
                    print(f"    Precios: ${price1:.2f} y ${price2:.2f}")
                    print(f"    Diferencia: {diff_pct:.2f}%")
                    print(f"    Barras entre: {bars_between}")


def test_dtb_endpoint():
    """Probar el endpoint DTB directamente"""
    print("\n[TEST ENDPOINT DTB]")
    print("-" * 60)

    config = {
        "doubleTopBottom": {
            "enabled": True,
            "maxBreakoutPercent": 20,  # MUY permisivo
            "lookbackBars": 3,
            "minBarsBetween": 3,
            "patternTimeLimit": 500,
            "volumeFilter": {"enabled": False},
            "momentumConfirmation": {"enabled": False}
        },
        "filters": {
            "minConfidence": 5,  # MUY bajo
            "volumeFilter": False
        },
        "postValidation": {
            "enabled": False  # Deshabilitado
        }
    }

    payload = {
        "symbol": SYMBOL,
        "interval": "1",
        "days": 1,
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
                print(f"Patrones detectados: {len(patterns)}")

                if patterns:
                    print("\nPrimeros 5 patrones:")
                    for i, p in enumerate(patterns[:5], 1):
                        print(f"  {i}. {p.get('type')} - Conf: {p.get('confidence')}%")
                else:
                    print("\n[!] No se detectaron patrones con configuración ultra permisiva")
                    print("    Esto confirma un problema en el algoritmo o en los datos")

                return data
            else:
                print(f"[ERROR] HTTP {response.status_code}")
                return None
    except Exception as e:
        print(f"[ERROR] {e}")
        return None


def main():
    print("=" * 80)
    print("DIAGNÓSTICO DTB - TIMEFRAME 1 MINUTO")
    print("=" * 80)
    print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. Obtener datos históricos
    print("[1] OBTENIENDO DATOS HISTÓRICOS...")
    candles = get_historical_data(interval="1", days=1)

    if not candles:
        print("[ERROR] No se pudieron obtener datos")
        return

    # 2. Analizar los datos
    print("\n[2] ANALIZANDO DATOS...")
    analyze_data(candles)

    # 3. Probar endpoint DTB
    print("\n[3] PROBANDO ENDPOINT DTB...")
    result = test_dtb_endpoint()

    # Conclusiones
    print("\n" + "=" * 80)
    print("CONCLUSIONES")
    print("=" * 80)

    if candles and len(candles) > 0:
        print(f"[OK] Los datos están llegando correctamente ({len(candles)} velas)")
    else:
        print("[ERROR] No hay datos disponibles")

    if result and len(result.get("patterns", [])) == 0:
        print("[PROBLEMA] El algoritmo NO detecta patrones incluso con parámetros ultra permisivos")
        print("\nPosibles causas:")
        print("1. El algoritmo de búsqueda de extremos locales no funciona para 1-min")
        print("2. Hay un filtro adicional que rechaza todos los patrones")
        print("3. Bug en el código introducido recientemente")
        print("4. Los datos tienen algún formato incompatible")
        print("\nRecomendación: Revisar el código del detector DTB,")
        print("específicamente la función que encuentra extremos locales")


if __name__ == "__main__":
    main()