#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verifica configuración de almacenamiento del Cloud Collector.
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


async def check_root_endpoint():
    """Verifica el endpoint raíz que muestra data_dir."""
    print("\n1️⃣ Verificando configuración del servidor...")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get(f"{CLOUD_URL}/")
        data = response.json()

        service = data.get("service")
        status = data.get("status")
        data_dir = data.get("data_dir")
        symbols = data.get("symbols", [])
        interval = data.get("interval")

        print(f"   ✅ Servicio: {service}")
        print(f"   ✅ Estado: {status}")
        print(f"   📁 Directorio de datos: {data_dir}")
        print(f"   📊 Símbolos: {len(symbols)}")
        print(f"   ⏱️  Intervalo: {interval} minuto(s)")

        return data_dir


async def analyze_storage_by_symbol():
    """Analiza almacenamiento por símbolo probando diferentes períodos."""
    print("\n2️⃣ Analizando datos almacenados por símbolo...")

    symbols_to_test = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"]
    hours = 720  # 30 días

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        storage_info = []

        for symbol in symbols_to_test:
            try:
                print(f"\n   🔍 {symbol}...")

                response = await client.get(
                    f"{CLOUD_URL}/api/footprints/{symbol}",
                    params={"hours": hours, "interval": "1"}
                )

                if response.status_code == 200:
                    data = response.json()
                    count = data.get("count", 0)
                    oldest = data.get("oldest")
                    newest = data.get("newest")

                    if count > 0:
                        oldest_dt = datetime.fromtimestamp(oldest / 1000)
                        newest_dt = datetime.fromtimestamp(newest / 1000)

                        # Estimar tamaño (promedio ~1KB por footprint comprimido)
                        estimated_mb = (count * 1.0) / 1024

                        print(f"      ✅ Footprints: {count:,}")
                        print(f"      📅 Desde: {oldest_dt.strftime('%Y-%m-%d %H:%M')}")
                        print(f"      📅 Hasta: {newest_dt.strftime('%Y-%m-%d %H:%M')}")
                        print(f"      💾 Tamaño estimado: ~{estimated_mb:.1f} MB")

                        storage_info.append({
                            "symbol": symbol,
                            "count": count,
                            "oldest": oldest_dt,
                            "newest": newest_dt,
                            "size_mb": estimated_mb
                        })
                    else:
                        print(f"      ⚠️  Sin datos")
                else:
                    print(f"      ❌ Error HTTP: {response.status_code}")

            except Exception as e:
                print(f"      ❌ Error: {e}")

        return storage_info


async def main():
    """Función principal."""
    print("=" * 80)
    print("VERIFICACIÓN DE ALMACENAMIENTO PERSISTENTE")
    print("=" * 80)
    print(f"URL: {CLOUD_URL}")
    print()

    try:
        # 1. Verificar configuración
        data_dir = await check_root_endpoint()

        # 2. Analizar datos almacenados
        storage_info = await analyze_storage_by_symbol()

        # 3. Resumen y recomendaciones
        print(f"\n{'='*80}")
        print("📊 RESUMEN DE ALMACENAMIENTO")
        print(f"{'='*80}")

        if storage_info:
            total_footprints = sum(s["count"] for s in storage_info)
            total_mb = sum(s["size_mb"] for s in storage_info)

            print(f"\n✅ Total footprints analizados: {total_footprints:,}")
            print(f"✅ Tamaño estimado (4 símbolos): ~{total_mb:.1f} MB")
            print(f"✅ Estimación 21 símbolos: ~{total_mb * 5.25:.1f} MB")

            # Calcular rango de datos
            oldest_overall = min(s["oldest"] for s in storage_info)
            newest_overall = max(s["newest"] for s in storage_info)
            days_stored = (newest_overall - oldest_overall).days

            print(f"\n📅 Rango de datos almacenados:")
            print(f"   Desde: {oldest_overall.strftime('%Y-%m-%d %H:%M')}")
            print(f"   Hasta: {newest_overall.strftime('%Y-%m-%d %H:%M')}")
            print(f"   Días: ~{days_stored} días")

        print(f"\n{'='*80}")
        print("🔍 VERIFICACIÓN EN NORTHFLANK")
        print(f"{'='*80}")

        print(f"\n📍 Directorio configurado: {data_dir}")
        print("\nPara verificar que el volumen persistente está correctamente configurado:")
        print("\n1. Ve a Northflank > Tu servicio > 'Volumes'")
        print("\n2. Verifica que existe un volumen:")
        print("   ✅ Name: footprint-data (o similar)")
        print("   ✅ Size: 1 GB o más")
        print(f"   ✅ Mount path: {data_dir}")
        print("   ✅ Status: Attached")

        print("\n3. Si NO existe volumen:")
        print("   ⚠️  Los datos se perderán al reiniciar el pod")
        print("   ⚠️  Necesitas crear un volumen persistente")

        print("\n4. Si SÍ existe volumen:")
        print("   ✅ Los datos persistirán entre redeploys")
        print("   ✅ El histórico seguirá creciendo")

        print(f"\n{'='*80}")
        print("📋 SIGUIENTES PASOS")
        print(f"{'='*80}")

        print("\n¿Qué ver en Northflank?")
        print("\n1. Ve a: https://northflank.com")
        print("2. Login > Tu proyecto > Servicio 'altagracia'")
        print("3. Tab 'Volumes' (barra lateral izquierda)")
        print("4. Captura screenshot o copia la información del volumen")
        print("\nBusca específicamente:")
        print("   - Volume name")
        print("   - Size (GB)")
        print("   - Mount path")
        print("   - Status")

        print()

    except Exception as e:
        print(f"\n❌ Error: {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
