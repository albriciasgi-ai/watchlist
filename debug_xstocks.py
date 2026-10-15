"""
Debug script para ver la respuesta RAW de la API de Bybit para xStocks
"""
import httpx
import asyncio
import json

BYBIT_API_URL = "https://api.bybit.com"
SYMBOL = "AAPLXUSDT"

async def debug_instrument():
    url = f"{BYBIT_API_URL}/v5/market/instruments-info"
    params = {
        "category": "spot",
        "symbol": SYMBOL
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, timeout=10.0)
        data = response.json()

        print(f"Status Code: {response.status_code}")
        print(f"ret Code: {data.get('retCode')}")
        print(f"ret Msg: {data.get('retMsg')}")
        print(f"\nFull Response:")
        print(json.dumps(data, indent=2))

if __name__ == "__main__":
    asyncio.run(debug_instrument())
