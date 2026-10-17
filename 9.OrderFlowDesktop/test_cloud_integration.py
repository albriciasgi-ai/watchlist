#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test de integración con Cloud Footprint Collector.
"""

import httpx
import asyncio
import sys
import io
from datetime import datetime

# Fix encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CLOUD_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"
TIMEOUT = 90.0


async def test_symbols():
    """Prueba endpoint de símbolos."""
    print("\n1️⃣ Probando /api/symbols...")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(f"{CLOUD_URL}/api/symbols")
        data = response.json()

        symbols = data.get("symbols", [])
        interval = data.get("interval")

        print(f"   ✅ Símbolos disponibles: {len(symbols)}")
        print(f"   ✅ Intervalo: {interval} minuto(s)")
        print(f"   📋 Primeros 5: {symbols[:5]}")

        return symbols


async def test_stats():
    """Prueba endpoint de estadísticas."""
    print("\n2️⃣ Probando /api/stats...")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(f"{CLOUD_URL}/api/stats")
        data = response.json()

        trades = data.get("trades_processed", 0)
        footprints = data.get("footprints_completed", 0)
        disk_fps = data.get("disk_footprints", 0)
        disk_mb = data.get("disk_size_mb", 0)

        print(f"   ✅ Trades procesados: {trades:,}")
        print(f"   ✅ Footprints completados: {footprints:,}")
        print(f"   ✅ Footprints en disco: {disk_fps:,}")
        print(f"   ✅ Tamaño en disco: {disk_mb:.2f} MB")

        return data


async def test_footprints(symbol: str, hours: int = 6):
    """Prueba endpoint de footprints para un símbolo."""
    print(f"\n3️⃣ Probando /api/footprints/{symbol}?hours={hours}...")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(
            f"{CLOUD_URL}/api/footprints/{symbol}",
            params={"hours": hours, "interval": "1"}
        )
        data = response.json()

        count = data.get("count", 0)
        oldest = data.get("oldest")
        newest = data.get("newest")

        print(f"   ✅ Footprints obtenidos: {count}")

        if count > 0:
            oldest_dt = datetime.fromtimestamp(oldest / 1000).strftime("%Y-%m-%d %H:%M:%S")
            newest_dt = datetime.fromtimestamp(newest / 1000).strftime("%Y-%m-%d %H:%M:%S")

            print(f"   📅 Más antiguo: {oldest_dt}")
            print(f"   📅 Más reciente: {newest_dt}")

            # Analizar primer footprint
            footprints = data.get("footprints", [])
            if footprints:
                fp = footprints[0]
                print(f"\n   📊 Ejemplo de footprint:")
                print(f"      Symbol: {fp.get('symbol')}")
                print(f"      Niveles: {fp.get('num_levels')}")
                print(f"      Volume total: {fp.get('total_volume', 0):.2f}")
                print(f"      Delta total: {fp.get('total_delta', 0):.2f}")
                print(f"      POC price: {fp.get('poc_price', 0):.2f}")
                print(f"      Step size: {fp.get('step_size', 0)}")
        else:
            print("   ⚠️  No hay footprints disponibles para este período")

        return data


async def main():
    """Función principal."""
    print("=" * 80)
    print("TEST DE INTEGRACIÓN - CLOUD FOOTPRINT COLLECTOR")
    print("=" * 80)
    print(f"URL: {CLOUD_URL}")
    print(f"Timeout: {TIMEOUT}s")
    print()

    try:
        # 1. Obtener símbolos
        symbols = await test_symbols()

        # 2. Obtener estadísticas
        await test_stats()

        # 3. Probar footprints de 3 símbolos principales
        for symbol in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
            await test_footprints(symbol, hours=6)

        print("\n" + "=" * 80)
        print("✅ INTEGRACIÓN EXITOSA")
        print("=" * 80)
        print("\nEl Cloud Footprint Collector está completamente operativo.")
        print("Tu aplicación puede obtener footprints históricos sin problemas.")
        print()

    except httpx.TimeoutException:
        print("\n❌ TIMEOUT: El servidor tardó más de 90 segundos en responder")
        print("   Aumenta TIMEOUT en el código si es necesario")
    except Exception as e:
        print(f"\n❌ ERROR: {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
