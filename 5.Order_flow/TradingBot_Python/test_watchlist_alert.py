"""
Test script para probar el endpoint /api/watchlist-alert
Este script simula una alerta enviada por la watchlist
"""

import httpx
import json
import sys

# Configuración
TRADING_BOT_URL = "http://localhost:5000"
ENDPOINT = f"{TRADING_BOT_URL}/api/watchlist-alert"

def test_watchlist_alert(pattern, symbol, price, confidence=None):
    """
    Envía una alerta de prueba al Trading Bot

    Args:
        pattern (str): Nombre del patrón (ej: "HAMMER (ABRIR LONG)")
        symbol (str): Símbolo del activo (ej: "BTCUSDT")
        price (float): Precio actual
        confidence (float, optional): Nivel de confianza del patrón

    Returns:
        dict: Respuesta del Trading Bot
    """

    # Construir payload
    payload = {
        "pattern": pattern,
        "symbol": symbol,
        "price": price
    }

    if confidence is not None:
        payload["confidence"] = confidence

    print("=" * 60)
    print("📨 Enviando alerta de prueba al Trading Bot")
    print("=" * 60)
    print(f"Endpoint: {ENDPOINT}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    print("=" * 60)

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(ENDPOINT, json=payload)

            print(f"\n✅ Status Code: {response.status_code}")
            print(f"📋 Respuesta:")
            print(json.dumps(response.json(), indent=2))

            return response.json()

    except httpx.ConnectError:
        print("\n❌ Error: No se pudo conectar al Trading Bot")
        print("   Asegúrate de que el backend esté corriendo en puerto 5000")
        return None

    except httpx.TimeoutException:
        print("\n⏱️ Error: Timeout - El servidor tardó demasiado en responder")
        return None

    except Exception as e:
        print(f"\n❌ Error inesperado: {str(e)}")
        return None


def test_check_status():
    """Verifica que el Trading Bot esté corriendo"""
    print("\n🔍 Verificando status del Trading Bot...")

    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(f"{TRADING_BOT_URL}/api/status")

            if response.status_code == 200:
                data = response.json()
                print("✅ Trading Bot está corriendo")
                print(f"   - Credenciales configuradas: {data.get('credentials_configured')}")
                print(f"   - Símbolos configurados: {data.get('symbols_configured')}")
                print(f"   - Conexiones activas: {data.get('active_connections')}")
                return True
            else:
                print(f"⚠️ Status inesperado: {response.status_code}")
                return False

    except httpx.ConnectError:
        print("❌ Trading Bot no está corriendo en puerto 5000")
        print("   Ejecuta: START_HERE.bat")
        return False
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("🧪 TEST - Trading Bot Watchlist Integration")
    print("=" * 60)

    # Verificar que el bot esté corriendo
    if not test_check_status():
        print("\n⚠️ Por favor inicia el Trading Bot primero")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("Ejemplos de Prueba")
    print("=" * 60)

    # Ejemplo 1: LONG en BTCUSDT
    print("\n1️⃣ Prueba: HAMMER (ABRIR LONG) en BTCUSDT")
    result1 = test_watchlist_alert(
        pattern="HAMMER (ABRIR LONG)",
        symbol="BTCUSDT",
        price=45000.5,
        confidence=85.5
    )

    input("\n⏸️ Presiona Enter para continuar con la siguiente prueba...")

    # Ejemplo 2: SHORT en ETHUSDT
    print("\n2️⃣ Prueba: SHOOTING STAR (ABRIR SHORT) en ETHUSDT")
    result2 = test_watchlist_alert(
        pattern="SHOOTING STAR (ABRIR SHORT)",
        symbol="ETHUSDT",
        price=3200.75,
        confidence=78.3
    )

    input("\n⏸️ Presiona Enter para continuar con la siguiente prueba...")

    # Ejemplo 3: Otro patrón LONG
    print("\n3️⃣ Prueba: MORNING STAR (ABRIR LONG) en SOLUSDT")
    result3 = test_watchlist_alert(
        pattern="MORNING STAR (ABRIR LONG)",
        symbol="SOLUSDT",
        price=150.25,
        confidence=92.1
    )

    print("\n" + "=" * 60)
    print("✅ Pruebas completadas")
    print("=" * 60)
    print("\n📝 Revisa los logs en http://localhost:3000")
    print("   Dashboard → Recent Logs\n")
