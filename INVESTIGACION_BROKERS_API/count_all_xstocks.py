"""
Script para contar y listar todos los xStocks disponibles en Bybit
"""
import httpx
import asyncio

BYBIT_API_URL = "https://api.bybit.com"

async def count_all_xstocks():
    """Cuenta y lista todos los xStocks disponibles"""

    print("=" * 80)
    print("CONTEO DE xSTOCKS DISPONIBLES EN BYBIT")
    print("=" * 80)
    print()

    async with httpx.AsyncClient() as client:
        url = f"{BYBIT_API_URL}/v5/market/instruments-info"
        params = {
            "category": "spot",
            "limit": 1000
        }

        response = await client.get(url, params=params, timeout=10.0)
        data = response.json()

        if data.get("retCode") == 0:
            instruments = data.get("result", {}).get("list", [])

            # Filtrar solo xStocks (xstockMultiplier presente y diferente de '1')
            xstocks = []
            for inst in instruments:
                multiplier = inst.get("xstockMultiplier", "1")
                if "xstockMultiplier" in inst and multiplier != "1":
                    xstocks.append(inst)

            print(f"Total de instrumentos spot: {len(instruments)}")
            print(f"Total de xStocks: {len(xstocks)}")
            print()

            # Contar por status
            trading_count = sum(1 for x in xstocks if x.get("status") == "Trading")
            margin_count = sum(1 for x in xstocks if x.get("marginTrading") == "utaOnly")

            print(f"xStocks activos (Trading): {trading_count}")
            print(f"xStocks con margin trading: {margin_count}")
            print()

            print("Lista de xStocks disponibles:")
            print("=" * 80)
            print(f"{'#':<4} {'Símbolo':<15} {'Status':<12} {'Margin':<6} {'Multiplicador':<12}")
            print("-" * 80)

            for idx, xstock in enumerate(xstocks, 1):
                symbol = xstock.get("symbol", "N/A")
                status = xstock.get("status", "N/A")
                margin = xstock.get("marginTrading", "none")
                multiplier = xstock.get("xstockMultiplier", "N/A")

                margin_icon = "[M]" if margin == "utaOnly" else "[ ]"

                print(f"{idx:<4} {symbol:<15} {status:<12} {margin_icon:<6} {multiplier:<12}")

            print()
            print("=" * 80)
            print("Leyenda:")
            print("  [M] = Margin trading habilitado (LONG + SHORT disponibles)")
            print("  [ ] = Solo spot normal (solo LONG)")
            print("=" * 80)
        else:
            print(f"[ERROR] API retornó código: {data.get('retCode')}")
            print(f"Mensaje: {data.get('retMsg')}")

if __name__ == "__main__":
    asyncio.run(count_all_xstocks())
