#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para verificar el estado de los footprints en Northflank.

Uso:
    python check_footprints.py
"""

import httpx
import asyncio
import json
import sys
from datetime import datetime

# Fix encoding para Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CLOUD_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"
TIMEOUT = 30.0

# Símbolos principales a verificar
SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "XRPUSDT", "SOLUSDT",
    "BNBUSDT", "ADAUSDT", "DOGEUSDT", "TRXUSDT"
]

INTERVALS = ["1", "5", "15"]
HOURS_TO_CHECK = [1, 6, 12]


async def check_footprint(symbol: str, interval: str, hours: int):
    """Verifica footprints para un símbolo específico."""
    try:
        url = f"{CLOUD_URL}/api/footprints/{symbol}"
        params = {"hours": hours, "interval": interval}

        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(url, params=params)

            if response.status_code == 200:
                data = response.json()
                footprints = data.get("footprints", [])

                if footprints:
                    # Analizar timestamps
                    timestamps = [fp.get("candle_timestamp", 0) for fp in footprints]
                    timestamps.sort()

                    first_ts = timestamps[0] / 1000
                    last_ts = timestamps[-1] / 1000

                    first_dt = datetime.fromtimestamp(first_ts).strftime("%Y-%m-%d %H:%M:%S")
                    last_dt = datetime.fromtimestamp(last_ts).strftime("%Y-%m-%d %H:%M:%S")

                    # Detectar gaps
                    interval_ms = int(interval) * 60 * 1000
                    gaps = []
                    for i in range(1, len(timestamps)):
                        expected_next = timestamps[i-1] + interval_ms
                        actual_gap = timestamps[i] - timestamps[i-1]

                        if actual_gap > interval_ms * 1.5:  # Gap mayor al esperado
                            gap_minutes = (actual_gap - interval_ms) / (60 * 1000)
                            gaps.append(gap_minutes)

                    return {
                        "symbol": symbol,
                        "interval": interval,
                        "hours": hours,
                        "status": "OK",
                        "count": len(footprints),
                        "first_timestamp": first_dt,
                        "last_timestamp": last_dt,
                        "gaps_detected": len(gaps),
                        "total_gap_minutes": sum(gaps) if gaps else 0
                    }
                else:
                    return {
                        "symbol": symbol,
                        "interval": interval,
                        "hours": hours,
                        "status": "EMPTY",
                        "count": 0,
                        "error": "No hay footprints"
                    }
            else:
                return {
                    "symbol": symbol,
                    "interval": interval,
                    "hours": hours,
                    "status": "ERROR",
                    "error": f"HTTP {response.status_code}"
                }

    except httpx.TimeoutException:
        return {
            "symbol": symbol,
            "interval": interval,
            "hours": hours,
            "status": "TIMEOUT",
            "error": "Timeout"
        }
    except Exception as e:
        return {
            "symbol": symbol,
            "interval": interval,
            "hours": hours,
            "status": "ERROR",
            "error": str(e)
        }


async def check_health():
    """Verifica el endpoint de health."""
    try:
        url = f"{CLOUD_URL}/health"

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)

            if response.status_code == 200:
                data = response.json()
                print("✅ CLOUD COLLECTOR ACTIVO")
                print(f"   Status: {data.get('status', 'unknown')}")
                print(f"   Service: {data.get('service', 'unknown')}")
                print()
                return True
            else:
                print(f"❌ CLOUD COLLECTOR ERROR: HTTP {response.status_code}")
                return False

    except Exception as e:
        print(f"❌ CLOUD COLLECTOR NO DISPONIBLE: {e}")
        return False


async def main():
    """Función principal."""
    print("=" * 80)
    print("VERIFICACIÓN DE FOOTPRINTS EN NORTHFLANK")
    print("=" * 80)
    print()

    # Verificar health
    print("🔍 Verificando estado del servidor...")
    print()
    is_healthy = await check_health()

    if not is_healthy:
        print("⚠️  El servidor no está disponible. Terminando verificación.")
        return

    # Verificar footprints
    print("🔍 Verificando footprints para símbolos principales...")
    print()

    results_by_symbol = {}

    # Realizar todas las consultas en paralelo
    tasks = []
    for symbol in SYMBOLS:
        for interval in INTERVALS:
            for hours in HOURS_TO_CHECK:
                tasks.append(check_footprint(symbol, interval, hours))

    results = await asyncio.gather(*tasks)

    # Organizar resultados por símbolo
    for result in results:
        symbol = result["symbol"]
        if symbol not in results_by_symbol:
            results_by_symbol[symbol] = []
        results_by_symbol[symbol].append(result)

    # Mostrar resultados
    for symbol in SYMBOLS:
        symbol_results = results_by_symbol.get(symbol, [])

        print(f"\n{'='*80}")
        print(f"  {symbol}")
        print(f"{'='*80}")

        for result in symbol_results:
            interval = result["interval"]
            hours = result["hours"]
            status = result["status"]

            print(f"\n  Interval: {interval}m | Hours: {hours}h")
            print(f"  {'─'*76}")

            if status == "OK":
                count = result["count"]
                first = result["first_timestamp"]
                last = result["last_timestamp"]
                gaps = result["gaps_detected"]
                gap_mins = result["total_gap_minutes"]

                print(f"  ✅ Status:      {status}")
                print(f"  📊 Footprints:  {count}")
                print(f"  📅 Desde:       {first}")
                print(f"  📅 Hasta:       {last}")

                if gaps > 0:
                    print(f"  ⚠️  Gaps:        {gaps} gaps ({gap_mins:.0f} minutos faltantes)")
                else:
                    print(f"  ✅ Gaps:        Sin gaps")
            else:
                error = result.get("error", "Unknown")
                print(f"  ❌ Status:      {status}")
                print(f"  ⚠️  Error:       {error}")

    print("\n" + "=" * 80)

    # Resumen final
    print("\n📊 RESUMEN")
    print("=" * 80)

    total_checks = len(results)
    successful = sum(1 for r in results if r["status"] == "OK")
    with_gaps = sum(1 for r in results if r["status"] == "OK" and r["gaps_detected"] > 0)
    errors = sum(1 for r in results if r["status"] in ["ERROR", "TIMEOUT", "EMPTY"])

    print(f"  Total verificaciones:    {total_checks}")
    print(f"  ✅ Exitosas:             {successful} ({successful/total_checks*100:.1f}%)")
    print(f"  ⚠️  Con gaps:             {with_gaps}")
    print(f"  ❌ Errores:              {errors}")
    print()

    # Guardar resultados en JSON
    output_file = "footprint_response.json"
    with open(output_file, 'w') as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "cloud_url": CLOUD_URL,
            "summary": {
                "total_checks": total_checks,
                "successful": successful,
                "with_gaps": with_gaps,
                "errors": errors
            },
            "results": results
        }, f, indent=2)

    print(f"💾 Resultados guardados en: {output_file}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
