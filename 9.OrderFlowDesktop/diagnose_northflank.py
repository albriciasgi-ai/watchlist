#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de diagnóstico avanzado para el Cloud Collector en Northflank.
"""

import httpx
import asyncio
import sys
import io
from datetime import datetime

# Fix encoding para Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"
TIMEOUT = 15.0

# Endpoints a probar
ENDPOINTS = [
    "/",
    "/health",
    "/api/symbols",
    "/api/stats",
    "/api/footprints/BTCUSDT?hours=1&interval=1",
]

# Puertos comunes a probar (si el puerto 443 no funciona)
PORTS = [443, 8000, 80]


async def test_endpoint(client: httpx.AsyncClient, url: str, endpoint: str):
    """Prueba un endpoint específico."""
    full_url = f"{url}{endpoint}"

    try:
        print(f"\n🔍 Probando: {full_url}")
        print(f"   Timeout: {TIMEOUT}s")

        response = await client.get(full_url)

        print(f"   ✅ Status: {response.status_code}")
        print(f"   📦 Content-Type: {response.headers.get('content-type', 'N/A')}")
        print(f"   📏 Content-Length: {len(response.content)} bytes")

        if response.status_code == 200:
            try:
                data = response.json()
                print(f"   📄 JSON Response:")

                # Mostrar primeras 5 claves o todo si es pequeño
                if isinstance(data, dict):
                    keys = list(data.keys())[:5]
                    for key in keys:
                        value = data[key]
                        if isinstance(value, (str, int, float, bool)):
                            print(f"      {key}: {value}")
                        elif isinstance(value, list):
                            print(f"      {key}: [{len(value)} items]")
                        else:
                            print(f"      {key}: {type(value).__name__}")
                else:
                    print(f"      {str(data)[:200]}")
            except:
                print(f"   📄 Text Response: {response.text[:200]}")

        return True

    except httpx.TimeoutException:
        print(f"   ⏱️  TIMEOUT después de {TIMEOUT}s")
        return False
    except httpx.ConnectError as e:
        print(f"   ❌ CONNECTION ERROR: {e}")
        return False
    except httpx.HTTPStatusError as e:
        print(f"   ❌ HTTP ERROR: {e.response.status_code}")
        return False
    except Exception as e:
        print(f"   ❌ ERROR: {type(e).__name__}: {e}")
        return False


async def test_port(port: int):
    """Prueba un puerto específico."""
    if port == 443:
        url = BASE_URL
    else:
        # Extraer host sin https
        host = BASE_URL.replace("https://", "").replace("http://", "")
        url = f"http://{host}:{port}"

    print(f"\n{'='*80}")
    print(f"🔌 Probando puerto {port}: {url}")
    print(f"{'='*80}")

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        success_count = 0

        for endpoint in ENDPOINTS:
            success = await test_endpoint(client, url, endpoint)
            if success:
                success_count += 1
            await asyncio.sleep(0.5)  # Pequeña pausa entre requests

        print(f"\n📊 Resumen puerto {port}: {success_count}/{len(ENDPOINTS)} exitosos")
        return success_count


async def check_dns():
    """Verifica resolución DNS."""
    print("\n🌐 Verificando DNS...")

    import socket
    try:
        host = BASE_URL.replace("https://", "").replace("http://", "")
        ip = socket.gethostbyname(host)
        print(f"   ✅ Host: {host}")
        print(f"   ✅ IP: {ip}")
        return True
    except Exception as e:
        print(f"   ❌ Error DNS: {e}")
        return False


async def main():
    """Función principal."""
    print("=" * 80)
    print("DIAGNÓSTICO AVANZADO - CLOUD FOOTPRINT COLLECTOR")
    print("=" * 80)
    print(f"URL Base: {BASE_URL}")
    print(f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # 1. Verificar DNS
    dns_ok = await check_dns()

    if not dns_ok:
        print("\n❌ No se pudo resolver DNS. Abortando.")
        return

    # 2. Probar diferentes puertos
    results = {}

    for port in PORTS:
        try:
            success_count = await test_port(port)
            results[port] = success_count
        except Exception as e:
            print(f"\n❌ Error probando puerto {port}: {e}")
            results[port] = 0

    # 3. Resumen final
    print("\n" + "=" * 80)
    print("📊 RESUMEN FINAL")
    print("=" * 80)

    total_success = sum(results.values())
    total_tests = len(PORTS) * len(ENDPOINTS)

    print(f"\nTotal de tests: {total_tests}")
    print(f"Exitosos: {total_success}")
    print(f"Fallidos: {total_tests - total_success}")

    print("\nResultados por puerto:")
    for port, success in results.items():
        status = "✅" if success > 0 else "❌"
        print(f"  {status} Puerto {port}: {success}/{len(ENDPOINTS)} endpoints OK")

    if total_success == 0:
        print("\n❌ DIAGNÓSTICO: El servicio NO está respondiendo en ningún puerto")
        print("\nPosibles causas:")
        print("  1. La app no está corriendo (revisar logs en Northflank)")
        print("  2. Public access no está habilitado (revisar Networking)")
        print("  3. Puerto incorrecto configurado (revisar variables de entorno)")
        print("  4. El servicio crasheó al iniciar (revisar logs)")
        print("\nAcciones recomendadas:")
        print("  1. Ve a Northflank > tu servicio > Logs")
        print("  2. Busca errores de Python o mensajes de inicio")
        print("  3. Verifica Networking > Public access = ON")
        print("  4. Verifica Environment > PORT = 8000")
    else:
        print(f"\n✅ DIAGNÓSTICO: El servicio responde en {len([s for s in results.values() if s > 0])} puerto(s)")

    print()


if __name__ == "__main__":
    asyncio.run(main())
