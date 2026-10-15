"""
Script de validación de xStocks API de Bybit

Este script prueba si los xStocks (acciones tokenizadas) funcionan
correctamente con nuestra infraestructura actual de API.

Ejecutar:
    python test_xstocks_api.py
"""

import httpx
import asyncio
import json
from datetime import datetime
from typing import Dict, List, Any

# Configuración
BYBIT_API_URL = "https://api.bybit.com"
SYMBOLS_TO_TEST = [
    "AAPLXUSDT",   # Apple
    "NVDAXUSDT",   # NVIDIA
    "METAXUSDT",   # Meta
    "GOOGLXUSDT",  # Google
    "MCDXUSDT",    # McDonald's
]

class Colors:
    """ANSI color codes para output bonito"""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    BOLD = '\033[1m'
    END = '\033[0m'


def print_header(text: str):
    """Imprime un header destacado"""
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'=' * 80}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.CYAN}{text.center(80)}{Colors.END}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'=' * 80}{Colors.END}\n")


def print_success(text: str):
    """Imprime mensaje de éxito"""
    print(f"{Colors.GREEN}[OK] {text}{Colors.END}")


def print_error(text: str):
    """Imprime mensaje de error"""
    print(f"{Colors.RED}[ERROR] {text}{Colors.END}")


def print_warning(text: str):
    """Imprime mensaje de advertencia"""
    print(f"{Colors.YELLOW}[WARNING] {text}{Colors.END}")


def print_info(text: str):
    """Imprime mensaje informativo"""
    print(f"{Colors.BLUE}[INFO] {text}{Colors.END}")


async def test_instruments_info(symbol: str) -> Dict[str, Any]:
    """
    Test 1: Obtener información del instrumento

    Verifica:
    - Que el símbolo existe
    - Que category=spot funciona
    - Que tiene el campo xstockMultiplier
    """
    print(f"\n{Colors.BOLD}Test 1: Instruments Info - {symbol}{Colors.END}")

    url = f"{BYBIT_API_URL}/v5/market/instruments-info"
    params = {
        "category": "spot",
        "symbol": symbol
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()

            if data.get("retCode") == 0:
                result = data.get("result", {})
                instruments = result.get("list", [])

                if instruments:
                    instrument = instruments[0]

                    # Verificaciones
                    # baseCoin debe ser el símbolo sin USDT (ej: AAPLX, no AAPLXUSDT)
                    expected_base = symbol.replace("USDT", "")

                    # Category está en result, no en instrument
                    category = result.get("category", "")

                    checks = {
                        "Symbol": instrument.get("symbol") == symbol,
                        "Category": category == "spot",
                        "BaseCoin": instrument.get("baseCoin") == expected_base,
                        "QuoteCoin": instrument.get("quoteCoin") == "USDT",
                        "xstockMultiplier": "xstockMultiplier" in instrument,
                    }

                    # Mapeo de check_name a clave real en el objeto
                    value_map = {
                        "Symbol": instrument.get("symbol", "N/A"),
                        "Category": category,
                        "BaseCoin": instrument.get("baseCoin", "N/A"),
                        "QuoteCoin": instrument.get("quoteCoin", "N/A"),
                        "xstockMultiplier": instrument.get("xstockMultiplier", "N/A"),
                    }

                    # Imprimir resultados
                    all_passed = True
                    for check_name, passed in checks.items():
                        if passed:
                            print_success(f"{check_name}: {value_map[check_name]}")
                        else:
                            print_error(f"{check_name}: FAILED")
                            all_passed = False

                    # Información adicional
                    if all_passed:
                        print_info(f"Status: {instrument.get('status')}")
                        print_info(f"Innovation: {instrument.get('innovation')}")

                        return {
                            "success": True,
                            "symbol": symbol,
                            "data": instrument
                        }
                    else:
                        return {"success": False, "symbol": symbol, "error": "Checks failed"}
                else:
                    print_error(f"No instruments found for {symbol}")
                    return {"success": False, "symbol": symbol, "error": "Not found"}
            else:
                print_error(f"API Error: {data.get('retMsg')}")
                return {"success": False, "symbol": symbol, "error": data.get('retMsg')}

    except httpx.HTTPError as e:
        print_error(f"HTTP Error: {str(e)}")
        return {"success": False, "symbol": symbol, "error": str(e)}
    except Exception as e:
        print_error(f"Unexpected Error: {str(e)}")
        return {"success": False, "symbol": symbol, "error": str(e)}


async def test_kline_data(symbol: str, interval: str = "60") -> Dict[str, Any]:
    """
    Test 2: Obtener datos de velas (klines)

    Verifica:
    - Que podemos obtener datos históricos
    - Que el formato es el esperado (7 elementos)
    - Que los timestamps son correctos
    """
    print(f"\n{Colors.BOLD}Test 2: Kline Data - {symbol} @ {interval}min{Colors.END}")

    url = f"{BYBIT_API_URL}/v5/market/kline"
    params = {
        "category": "spot",
        "symbol": symbol,
        "interval": interval,
        "limit": 10  # Solo 10 velas para test
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()

            if data.get("retCode") == 0:
                result = data.get("result", {})
                candles = result.get("list", [])

                if candles:
                    print_success(f"Received {len(candles)} candles")

                    # Analizar primera vela
                    first_candle = candles[0]

                    if len(first_candle) == 7:
                        print_success("Candle format: 7 elements [OK]")

                        # Parsear datos
                        timestamp = int(first_candle[0])
                        open_price = float(first_candle[1])
                        high = float(first_candle[2])
                        low = float(first_candle[3])
                        close = float(first_candle[4])
                        volume = float(first_candle[5])
                        turnover = float(first_candle[6])

                        # Formato de fecha
                        dt = datetime.fromtimestamp(timestamp / 1000)

                        print_info(f"Latest Candle ({dt.strftime('%Y-%m-%d %H:%M')}):")
                        print(f"  Open:     ${open_price:.2f}")
                        print(f"  High:     ${high:.2f}")
                        print(f"  Low:      ${low:.2f}")
                        print(f"  Close:    ${close:.2f}")
                        print(f"  Volume:   {volume:,.0f}")
                        print(f"  Turnover: ${turnover:,.2f}")

                        # Validación OHLC
                        if high >= max(open_price, close) and low <= min(open_price, close):
                            print_success("OHLC logic: Valid [OK]")
                        else:
                            print_warning("OHLC logic: Suspicious values")

                        return {
                            "success": True,
                            "symbol": symbol,
                            "candles_count": len(candles),
                            "latest_price": close
                        }
                    else:
                        print_error(f"Unexpected candle format: {len(first_candle)} elements")
                        return {"success": False, "symbol": symbol, "error": "Invalid format"}
                else:
                    print_error("No candles received")
                    return {"success": False, "symbol": symbol, "error": "No data"}
            else:
                print_error(f"API Error: {data.get('retMsg')}")
                return {"success": False, "symbol": symbol, "error": data.get('retMsg')}

    except httpx.HTTPError as e:
        print_error(f"HTTP Error: {str(e)}")
        return {"success": False, "symbol": symbol, "error": str(e)}
    except Exception as e:
        print_error(f"Unexpected Error: {str(e)}")
        return {"success": False, "symbol": symbol, "error": str(e)}


async def test_ticker_data(symbol: str) -> Dict[str, Any]:
    """
    Test 3: Obtener ticker en tiempo real

    Verifica:
    - Que podemos obtener precio actual
    - Que incluye volumen 24h
    - Que tiene los campos esperados
    """
    print(f"\n{Colors.BOLD}Test 3: Ticker Data - {symbol}{Colors.END}")

    url = f"{BYBIT_API_URL}/v5/market/tickers"
    params = {
        "category": "spot",
        "symbol": symbol
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()

            if data.get("retCode") == 0:
                result = data.get("result", {})
                tickers = result.get("list", [])

                if tickers:
                    ticker = tickers[0]

                    # Campos esperados
                    fields = {
                        "symbol": ticker.get("symbol"),
                        "lastPrice": ticker.get("lastPrice"),
                        "highPrice24h": ticker.get("highPrice24h"),
                        "lowPrice24h": ticker.get("lowPrice24h"),
                        "volume24h": ticker.get("volume24h"),
                        "turnover24h": ticker.get("turnover24h"),
                        "bid1Price": ticker.get("bid1Price"),
                        "ask1Price": ticker.get("ask1Price"),
                    }

                    # Imprimir
                    print_success(f"Symbol: {fields['symbol']}")
                    print_info(f"Last Price: ${float(fields['lastPrice']):.2f}")
                    print_info(f"24h High:   ${float(fields['highPrice24h']):.2f}")
                    print_info(f"24h Low:    ${float(fields['lowPrice24h']):.2f}")
                    print_info(f"24h Volume: {float(fields['volume24h']):,.0f}")
                    print_info(f"Bid:        ${float(fields['bid1Price']):.2f}")
                    print_info(f"Ask:        ${float(fields['ask1Price']):.2f}")

                    # Verificar spread
                    spread = float(fields['ask1Price']) - float(fields['bid1Price'])
                    spread_pct = (spread / float(fields['lastPrice'])) * 100
                    print_info(f"Spread:     ${spread:.2f} ({spread_pct:.3f}%)")

                    return {
                        "success": True,
                        "symbol": symbol,
                        "price": float(fields['lastPrice']),
                        "spread_pct": spread_pct
                    }
                else:
                    print_error("No ticker data received")
                    return {"success": False, "symbol": symbol, "error": "No data"}
            else:
                print_error(f"API Error: {data.get('retMsg')}")
                return {"success": False, "symbol": symbol, "error": data.get('retMsg')}

    except httpx.HTTPError as e:
        print_error(f"HTTP Error: {str(e)}")
        return {"success": False, "symbol": symbol, "error": str(e)}
    except Exception as e:
        print_error(f"Unexpected Error: {str(e)}")
        return {"success": False, "symbol": symbol, "error": str(e)}


async def test_multiple_intervals(symbol: str) -> Dict[str, Any]:
    """
    Test 4: Probar múltiples intervalos

    Verifica que los intervalos comunes funcionan:
    1, 5, 15, 60, 240, D
    """
    print(f"\n{Colors.BOLD}Test 4: Multiple Intervals - {symbol}{Colors.END}")

    intervals = ["1", "5", "15", "60", "240", "D"]
    results = {}

    for interval in intervals:
        url = f"{BYBIT_API_URL}/v5/market/kline"
        params = {
            "category": "spot",
            "symbol": symbol,
            "interval": interval,
            "limit": 1
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params, timeout=10.0)
                data = response.json()

                if data.get("retCode") == 0:
                    candles = data.get("result", {}).get("list", [])
                    if candles:
                        print_success(f"Interval {interval:>3}: [OK]")
                        results[interval] = True
                    else:
                        print_warning(f"Interval {interval:>3}: No data")
                        results[interval] = False
                else:
                    print_error(f"Interval {interval:>3}: API Error")
                    results[interval] = False
        except Exception as e:
            print_error(f"Interval {interval:>3}: {str(e)}")
            results[interval] = False

    success_count = sum(1 for v in results.values() if v)
    print_info(f"\nSupported intervals: {success_count}/{len(intervals)}")

    return {
        "success": success_count > 0,
        "symbol": symbol,
        "intervals": results
    }


async def test_symbol(symbol: str) -> Dict[str, Any]:
    """Ejecuta todos los tests para un símbolo"""
    print_header(f"TESTING: {symbol}")

    results = {
        "symbol": symbol,
        "tests": {}
    }

    # Test 1: Instruments Info
    result1 = await test_instruments_info(symbol)
    results["tests"]["instruments"] = result1["success"]

    if not result1["success"]:
        print_warning(f"Skipping remaining tests for {symbol} - instrument not found")
        return results

    # Test 2: Kline Data
    result2 = await test_kline_data(symbol)
    results["tests"]["kline"] = result2["success"]

    # Test 3: Ticker Data
    result3 = await test_ticker_data(symbol)
    results["tests"]["ticker"] = result3["success"]

    # Test 4: Multiple Intervals
    result4 = await test_multiple_intervals(symbol)
    results["tests"]["intervals"] = result4["success"]

    # Resumen
    passed = sum(1 for v in results["tests"].values() if v)
    total = len(results["tests"])

    print(f"\n{Colors.BOLD}Summary for {symbol}: {passed}/{total} tests passed{Colors.END}")

    if passed == total:
        print_success(f"{symbol} is FULLY COMPATIBLE [OK]")
    elif passed > 0:
        print_warning(f"{symbol} is PARTIALLY COMPATIBLE")
    else:
        print_error(f"{symbol} FAILED all tests")

    results["passed"] = passed
    results["total"] = total
    results["compatible"] = passed == total

    return results


async def main():
    """Función principal"""
    print_header("xSTOCKS API VALIDATION SCRIPT")

    print(f"{Colors.MAGENTA}Testing {len(SYMBOLS_TO_TEST)} xStock symbols...{Colors.END}\n")

    all_results = []

    for symbol in SYMBOLS_TO_TEST:
        result = await test_symbol(symbol)
        all_results.append(result)

        # Esperar un poco entre símbolos para no saturar la API
        await asyncio.sleep(0.5)

    # Reporte final
    print_header("FINAL REPORT")

    compatible = [r for r in all_results if r.get("compatible", False)]
    partial = [r for r in all_results if r.get("passed", 0) > 0 and not r.get("compatible", False)]
    failed = [r for r in all_results if r.get("passed", 0) == 0]

    print(f"{Colors.BOLD}Results Summary:{Colors.END}")
    print_success(f"Fully Compatible:      {len(compatible)}/{len(SYMBOLS_TO_TEST)}")
    if partial:
        print_warning(f"Partially Compatible:  {len(partial)}/{len(SYMBOLS_TO_TEST)}")
    if failed:
        print_error(f"Failed:                {len(failed)}/{len(SYMBOLS_TO_TEST)}")

    if compatible:
        print(f"\n{Colors.BOLD}{Colors.GREEN}Compatible symbols:{Colors.END}")
        for r in compatible:
            print(f"  [OK] {r['symbol']}")

    if partial:
        print(f"\n{Colors.BOLD}{Colors.YELLOW}Partial symbols:{Colors.END}")
        for r in partial:
            failed_tests = [k for k, v in r['tests'].items() if not v]
            print(f"  [WARN] {r['symbol']} - Failed: {', '.join(failed_tests)}")

    if failed:
        print(f"\n{Colors.BOLD}{Colors.RED}Failed symbols:{Colors.END}")
        for r in failed:
            print(f"  [X] {r['symbol']}")

    # Conclusión
    print_header("CONCLUSION")

    if len(compatible) == len(SYMBOLS_TO_TEST):
        print_success("ALL xStocks are fully compatible with our API infrastructure!")
        print_info("We can proceed with implementation immediately.")
    elif len(compatible) > 0:
        print_warning(f"{len(compatible)} symbols work, {len(failed)} don't.")
        print_info("We can implement with the working symbols first.")
    else:
        print_error("No xStocks are compatible. Further investigation needed.")

    # Guardar resultados en JSON
    output_file = "xstocks_validation_results.json"
    with open(output_file, "w") as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "symbols_tested": len(SYMBOLS_TO_TEST),
            "compatible": len(compatible),
            "partial": len(partial),
            "failed": len(failed),
            "details": all_results
        }, f, indent=2)

    print(f"\n{Colors.CYAN}Results saved to: {output_file}{Colors.END}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(f"\n{Colors.YELLOW}Interrupted by user{Colors.END}")
    except Exception as e:
        print(f"\n{Colors.RED}Fatal error: {str(e)}{Colors.END}")
        import traceback
        traceback.print_exc()
