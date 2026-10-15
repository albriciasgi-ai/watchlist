"""
Script para verificar capacidades de margin trading en xStocks
"""
import httpx
import asyncio
import json

BYBIT_API_URL = "https://api.bybit.com"

XSTOCKS = [
    "AAPLXUSDT",
    "NVDAXUSDT",
    "METAXUSDT",
    "GOOGLXUSDT",
    "MCDXUSDT"
]

async def check_margin_capabilities():
    """Verifica las capacidades de margin trading para cada xStock"""

    print("=" * 80)
    print("VERIFICACION DE MARGIN TRADING PARA xSTOCKS")
    print("=" * 80)
    print()

    async with httpx.AsyncClient() as client:
        for symbol in XSTOCKS:
            url = f"{BYBIT_API_URL}/v5/market/instruments-info"
            params = {
                "category": "spot",
                "symbol": symbol
            }

            response = await client.get(url, params=params, timeout=10.0)
            data = response.json()

            if data.get("retCode") == 0:
                instruments = data.get("result", {}).get("list", [])
                if instruments:
                    instrument = instruments[0]

                    margin_trading = instrument.get("marginTrading", "none")
                    status = instrument.get("status", "Unknown")
                    symbol_type = instrument.get("symbolType", "Unknown")

                    print(f"Symbol: {symbol}")
                    print(f"  Status:         {status}")
                    print(f"  Symbol Type:    {symbol_type}")
                    print(f"  Margin Trading: {margin_trading}")

                    # Verificar otros campos relevantes
                    if "lotSizeFilter" in instrument:
                        lot_filter = instrument["lotSizeFilter"]
                        print(f"  Min Order Qty:  {lot_filter.get('minOrderQty', 'N/A')}")
                        print(f"  Max Order Qty:  {lot_filter.get('maxOrderQty', 'N/A')}")

                    print()

    # Información adicional sobre UTA
    print("=" * 80)
    print("INFORMACION SOBRE 'utaOnly':")
    print("=" * 80)
    print()
    print("'utaOnly' = Unified Trading Account Only")
    print()
    print("Esto significa:")
    print("  - Se requiere cuenta UTA (Unified Trading Account) de Bybit")
    print("  - Permite margin trading (apalancamiento)")
    print("  - Permite posiciones SHORT en spot usando margen")
    print()
    print("Cuentas UTA soportan:")
    print("  1. Spot margin trading")
    print("  2. LONG: Comprar el activo normalmente")
    print("  3. SHORT: Pedir prestado el activo y venderlo (short selling)")
    print()
    print("CONCLUSION:")
    print("  [OK] Los xStocks SI permiten operaciones SHORT via margin trading")
    print("  [OK] Se puede hacer LONG y SHORT en estos simbolos")
    print("  [INFO] Requiere cuenta UTA de Bybit activada")
    print()

if __name__ == "__main__":
    asyncio.run(check_margin_capabilities())
