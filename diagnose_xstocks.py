"""
Script de diagnóstico para identificar el formato correcto de símbolos xStocks

Prueba diferentes variaciones de formato de símbolo para encontrar
cuál funciona con la API de Bybit.
"""

import httpx
import asyncio
import json
from datetime import datetime

BYBIT_API_URL = "https://api.bybit.com"

# Colores ANSI
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'

def print_success(text: str):
    print(f"{Colors.GREEN}[OK] {text}{Colors.END}")

def print_error(text: str):
    print(f"{Colors.RED}[ERROR] {text}{Colors.END}")

def print_info(text: str):
    print(f"{Colors.CYAN}[INFO] {text}{Colors.END}")

def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'=' * 80}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.CYAN}{text.center(80)}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'=' * 80}{Colors.END}\n")


async def test_symbol_format(base_symbol: str, format_variant: str, category: str = "spot"):
    """
    Prueba un formato específico de símbolo
    """
    url = f"{BYBIT_API_URL}/v5/market/instruments-info"
    params = {
        "category": category,
        "symbol": format_variant
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)
            data = response.json()

            if data.get("retCode") == 0:
                instruments = data.get("result", {}).get("list", [])
                if instruments:
                    instrument = instruments[0]
                    print_success(f"{base_symbol:6} → {format_variant:15} = FOUND!")
                    print(f"         Full symbol: {instrument.get('symbol')}")
                    print(f"         Base coin:   {instrument.get('baseCoin')}")
                    print(f"         Quote coin:  {instrument.get('quoteCoin')}")
                    print(f"         Status:      {instrument.get('status')}")
                    if 'xstockMultiplier' in instrument:
                        print(f"         xStock mult: {instrument.get('xstockMultiplier')}")
                    return True
                else:
                    return False
            else:
                return False

    except Exception as e:
        return False


async def diagnose_symbol(base: str):
    """
    Prueba múltiples variaciones de formato para un símbolo base
    """
    print_header(f"DIAGNOSING: {base}")

    # Variaciones de formato a probar
    variations = [
        f"{base}X",           # AAPLX
        f"{base}x",           # AAPLx
        f"{base}XUSDT",       # AAPLXUSDT
        f"{base}xUSDT",       # AAPLxUSDT
        f"{base}X/USDT",      # AAPLX/USDT
        f"{base}x/USDT",      # AAPLx/USDT
        f"{base}X-USDT",      # AAPLX-USDT
        f"{base}x-USDT",      # AAPLx-USDT
        f"{base}",            # AAPL
        f"{base}USDT",        # AAPLUSDT
        f"{base}/USDT",       # AAPL/USDT
    ]

    found = False
    for variant in variations:
        result = await test_symbol_format(base, variant)
        if result:
            found = True
            break
        await asyncio.sleep(0.2)  # Pequeña pausa entre tests

    if not found:
        print_error(f"No se encontró formato válido para {base}")

    return found


async def list_all_spot_symbols():
    """
    Lista TODOS los símbolos spot para encontrar los xStocks
    """
    print_header("LISTING ALL SPOT SYMBOLS")

    url = f"{BYBIT_API_URL}/v5/market/instruments-info"
    params = {"category": "spot", "limit": 1000}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=30.0)
            data = response.json()

            if data.get("retCode") == 0:
                instruments = data.get("result", {}).get("list", [])
                print_info(f"Total spot symbols found: {len(instruments)}")

                # Buscar xStocks (símbolos con xstockMultiplier o que terminen en X)
                xstocks = []
                for inst in instruments:
                    symbol = inst.get("symbol", "")

                    # Buscar por campo xstockMultiplier
                    if "xstockMultiplier" in inst:
                        xstocks.append({
                            "symbol": symbol,
                            "baseCoin": inst.get("baseCoin"),
                            "quoteCoin": inst.get("quoteCoin"),
                            "multiplier": inst.get("xstockMultiplier"),
                            "status": inst.get("status")
                        })
                    # O por símbolos que contengan X (pero no BTC, ETH, etc.)
                    elif "X" in symbol and symbol.endswith("USDT") and not any(
                        crypto in symbol for crypto in ["BTC", "ETH", "SOL", "XRP", "DOGE"]
                    ):
                        xstocks.append({
                            "symbol": symbol,
                            "baseCoin": inst.get("baseCoin"),
                            "quoteCoin": inst.get("quoteCoin"),
                            "status": inst.get("status")
                        })

                if xstocks:
                    print_success(f"\nFound {len(xstocks)} potential xStocks:\n")
                    for xs in sorted(xstocks, key=lambda x: x["symbol"]):
                        mult = xs.get("multiplier", "N/A")
                        print(f"  {xs['symbol']:20} | Base: {xs['baseCoin']:10} | "
                              f"Quote: {xs['quoteCoin']:6} | Mult: {mult:6} | "
                              f"Status: {xs['status']}")

                    # Guardar en archivo
                    with open("xstocks_found.json", "w") as f:
                        json.dump(xstocks, f, indent=2)
                    print(f"\n{Colors.CYAN}Results saved to: xstocks_found.json{Colors.END}")

                    return xstocks
                else:
                    print_error("No xStocks found in spot market")
                    return []
            else:
                print_error(f"API Error: {data.get('retMsg')}")
                return []

    except Exception as e:
        print_error(f"Error: {str(e)}")
        return []


async def test_specific_symbols():
    """
    Prueba símbolos específicos que sabemos que existen
    """
    print_header("TESTING KNOWN SYMBOLS")

    # Según la búsqueda web, estos símbolos existen
    test_symbols = [
        "AAPLXUSDT",    # Formato común en Bybit
        "NVDAXUSDT",
        "TSLAXUSDT",
        "COINXUSDT",
    ]

    for symbol in test_symbols:
        url = f"{BYBIT_API_URL}/v5/market/instruments-info"
        params = {"category": "spot", "symbol": symbol}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params, timeout=10.0)
                data = response.json()

                if data.get("retCode") == 0:
                    instruments = data.get("result", {}).get("list", [])
                    if instruments:
                        print_success(f"{symbol}: EXISTS ✓")
                        inst = instruments[0]
                        print(f"  baseCoin:  {inst.get('baseCoin')}")
                        print(f"  quoteCoin: {inst.get('quoteCoin')}")
                        print(f"  status:    {inst.get('status')}")
                    else:
                        print_error(f"{symbol}: Not found")
                else:
                    print_error(f"{symbol}: API Error - {data.get('retMsg')}")

        except Exception as e:
            print_error(f"{symbol}: Exception - {str(e)}")

        await asyncio.sleep(0.3)


async def main():
    """Función principal"""
    print_header("xSTOCKS DIAGNOSTIC SCRIPT")

    print(f"{Colors.YELLOW}This script will help identify the correct symbol format{Colors.END}\n")

    # Test 1: Listar todos los símbolos spot y filtrar xStocks
    print_info("Step 1: Scanning all spot symbols for xStocks...")
    xstocks = await list_all_spot_symbols()

    # Test 2: Probar símbolos específicos conocidos
    print_info("\nStep 2: Testing known symbol formats...")
    await test_specific_symbols()

    # Test 3: Si no encontramos nada, probar variaciones
    if not xstocks:
        print_info("\nStep 3: Trying format variations for common stocks...")
        bases = ["AAPL", "TSLA", "NVDA", "MSFT"]
        for base in bases:
            await diagnose_symbol(base)
            await asyncio.sleep(0.5)

    # Conclusión
    print_header("DIAGNOSIS COMPLETE")

    if xstocks:
        print_success(f"Found {len(xstocks)} xStocks!")
        print_info("Check 'xstocks_found.json' for the complete list")
        print_info("\nCorrect symbol format appears to be:")
        if xstocks:
            example = xstocks[0]['symbol']
            print(f"  {Colors.GREEN}{Colors.BOLD}{example}{Colors.END}")
    else:
        print_error("No xStocks found. Possible reasons:")
        print("  1. xStocks may not be available in your region")
        print("  2. xStocks may have been delisted from Bybit")
        print("  3. API access may be restricted")
        print("  4. Symbol format may have changed")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Interrupted by user{Colors.END}")
    except Exception as e:
        print(f"\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
