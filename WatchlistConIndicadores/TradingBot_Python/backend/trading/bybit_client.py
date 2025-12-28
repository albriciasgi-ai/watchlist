"""
Bybit API Client
Handles all interactions with Bybit API including signing, timestamp sync, and order execution
"""

import hmac
import hashlib
import time
import httpx
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime, timezone


class BybitClient:
    """
    Client for interacting with Bybit API v5
    Implements HMAC-SHA256 signing and automatic timestamp synchronization
    """

    def __init__(self, api_key: str, api_secret: str, testnet: bool = True, demo: bool = False):
        self.api_key = api_key
        self.api_secret = api_secret

        # Determine base URL based on mode
        if demo:
            self.base_url = "https://api-demo.bybit.com"  # Demo Trading
            self.mode = "demo"
        elif testnet:
            self.base_url = "https://api-testnet.bybit.com"  # Testnet (deprecated by user)
            self.mode = "testnet"
        else:
            self.base_url = "https://api.bybit.com"  # Real Trading
            self.mode = "live"

        self.recv_window = 5000
        self.time_offset = 0
        self.last_sync = 0
        self.sync_interval = 300  # Sync every 5 minutes

        print(f"[BYBIT] Client initialized: {self.base_url} (mode: {self.mode})")

    async def _get_server_time(self, client: httpx.AsyncClient) -> int:
        """Get server time from Bybit"""
        try:
            response = await client.get(f"{self.base_url}/v5/market/time")
            data = response.json()
            if data.get("retCode") == 0:
                return int(data["result"]["timeNano"]) // 1000000  # Convert to ms
        except Exception as e:
            print(f"[ERROR] Error getting server time: {e}")
        return int(time.time() * 1000)

    async def _sync_time(self, client: httpx.AsyncClient):
        """Synchronize local time with Bybit server"""
        current_time = time.time()
        if current_time - self.last_sync > self.sync_interval:
            server_time = await self._get_server_time(client)
            local_time = int(time.time() * 1000)
            self.time_offset = server_time - local_time
            self.last_sync = current_time
            print(f"[SYNC] Time synced: offset = {self.time_offset}ms")

    def _get_timestamp(self) -> int:
        """Get current timestamp adjusted with offset"""
        return int(time.time() * 1000) + self.time_offset

    def _generate_signature(self, timestamp: int, params: str = "") -> str:
        """Generate HMAC SHA256 signature for API requests"""
        param_str = f"{timestamp}{self.api_key}{self.recv_window}{params}"
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            param_str.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        return signature

    def _get_headers(self, timestamp: int, signature: str) -> Dict[str, str]:
        """Get request headers with authentication"""
        return {
            "X-BAPI-API-KEY": self.api_key,
            "X-BAPI-SIGN": signature,
            "X-BAPI-TIMESTAMP": str(timestamp),
            "X-BAPI-RECV-WINDOW": str(self.recv_window),
            "Content-Type": "application/json"
        }

    async def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """Make authenticated request to Bybit API with retries"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Sync time if needed
            await self._sync_time(client)

            for attempt in range(max_retries):
                try:
                    timestamp = self._get_timestamp()

                    if method.upper() == "GET":
                        # For GET requests, params go in query string
                        query_string = "&".join([f"{k}={v}" for k, v in (params or {}).items()])
                        signature = self._generate_signature(timestamp, query_string)
                        headers = self._get_headers(timestamp, signature)

                        url = f"{self.base_url}{endpoint}"
                        if query_string:
                            url += f"?{query_string}"

                        response = await client.get(url, headers=headers)
                    else:
                        # For POST requests, params go in body
                        import json
                        body = json.dumps(params or {})
                        signature = self._generate_signature(timestamp, body)
                        headers = self._get_headers(timestamp, signature)

                        response = await client.post(
                            f"{self.base_url}{endpoint}",
                            headers=headers,
                            content=body
                        )

                    data = response.json()

                    # Log API errors for debugging
                    if data.get("retCode") != 0:
                        error_code = data.get("retCode")
                        error_msg = data.get("retMsg", "Unknown error")
                        print(f"[ERROR] Bybit API Error {error_code}: {error_msg}")
                        print(f"   Endpoint: {method} {endpoint}")
                        print(f"   Using: {self.base_url}")

                    # Check for timestamp errors and resync
                    if data.get("retCode") == 10002:  # Timestamp error
                        print(f"[WARNING] Timestamp error, resyncing... (attempt {attempt + 1})")
                        self.last_sync = 0  # Force resync
                        await self._sync_time(client)
                        await asyncio.sleep(1)
                        continue

                    return data

                except Exception as e:
                    print(f"[ERROR] Request error (attempt {attempt + 1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 ** attempt)  # Exponential backoff
                    else:
                        raise

            return {"retCode": -1, "retMsg": "Max retries exceeded"}

    async def place_market_order(
        self,
        symbol: str,
        side: str,
        qty: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place a market order

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            side: "Buy" or "Sell"
            qty: Quantity as string (formatted to StepSize)
            category: "linear" for USDT perpetual
        """
        params = {
            "category": category,
            "symbol": symbol,
            "side": side,
            "orderType": "Market",
            "qty": qty,
            "orderLinkId": f"mkt_{int(time.time() * 1000)}"
        }

        print(f"[ORDER] Placing Market Order: {side} {symbol} qty={qty}")
        result = await self._make_request("POST", "/v5/order/create", params)

        if result.get("retCode") == 0:
            order_id = result["result"]["orderId"]
            print(f"[OK] Market Order placed: {order_id}")
        else:
            print(f"[ERROR] Market Order failed: {result.get('retMsg')}")

        return result

    async def place_stop_loss_order(
        self,
        symbol: str,
        side: str,
        qty: str,
        trigger_price: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place a stop loss order with trigger

        Args:
            symbol: Trading pair
            side: "Buy" (to close short) or "Sell" (to close long)
            qty: Quantity as string
            trigger_price: Price at which to trigger the stop loss
            category: "linear" for USDT perpetual
        """
        # Determine trigger direction
        # For closing LONG (side="Sell"): trigger when price falls -> direction=2
        # For closing SHORT (side="Buy"): trigger when price rises -> direction=1
        trigger_direction = 2 if side == "Sell" else 1

        params = {
            "category": category,
            "symbol": symbol,
            "side": side,
            "orderType": "Market",
            "qty": qty,
            "triggerPrice": trigger_price,
            "triggerDirection": trigger_direction,
            "triggerBy": "LastPrice",
            "orderLinkId": f"sl_{int(time.time() * 1000)}",
            "timeInForce": "GTC",
            "closeOnTrigger": True,
            "positionIdx": 0
        }

        print(f"[SL] Placing Stop Loss: {side} {symbol} @ {trigger_price} (direction={trigger_direction})")
        result = await self._make_request("POST", "/v5/order/create", params)

        if result.get("retCode") == 0:
            order_id = result["result"]["orderId"]
            print(f"[OK] Stop Loss placed: {order_id}")
        else:
            print(f"[ERROR] Stop Loss failed: {result.get('retMsg')}")

        return result

    async def place_take_profit_order(
        self,
        symbol: str,
        side: str,
        qty: str,
        price: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place a take profit limit order

        Args:
            symbol: Trading pair
            side: "Buy" (to close short) or "Sell" (to close long)
            qty: Quantity as string
            price: Limit price for take profit
            category: "linear" for USDT perpetual
        """
        params = {
            "category": category,
            "symbol": symbol,
            "side": side,
            "orderType": "Limit",
            "qty": qty,
            "price": price,
            "orderLinkId": f"tp_{int(time.time() * 1000)}",
            "timeInForce": "GTC",
            "reduceOnly": True,
            "positionIdx": 0
        }

        print(f"[TP] Placing Take Profit: {side} {symbol} @ {price}")
        result = await self._make_request("POST", "/v5/order/create", params)

        if result.get("retCode") == 0:
            order_id = result["result"]["orderId"]
            print(f"[OK] Take Profit placed: {order_id}")
        else:
            print(f"[ERROR] Take Profit failed: {result.get('retMsg')}")

        return result

    async def get_position(
        self,
        symbol: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Get current position for a symbol

        Returns:
            Dict with position info including size, side, entry price
        """
        params = {
            "category": category,
            "symbol": symbol
        }

        result = await self._make_request("GET", "/v5/position/list", params)

        if result.get("retCode") == 0:
            positions = result["result"]["list"]
            if positions:
                pos = positions[0]
                size = float(pos.get("size", "0"))
                side = pos.get("side", "")
                entry_price = pos.get("avgPrice", "0")
                unrealized_pnl = pos.get("unrealisedPnl", "0")
                mark_price = pos.get("markPrice", "0")
                leverage = pos.get("leverage", "0")
                liq_price = pos.get("liqPrice", "0")

                has_position = size > 0 and side != ""

                return {
                    "success": True,
                    "hasPosition": has_position,
                    "size": size,
                    "side": side,
                    "entryPrice": entry_price,
                    "unrealizedPnl": unrealized_pnl,
                    "markPrice": mark_price,
                    "leverage": leverage,
                    "liqPrice": liq_price,
                    "data": pos
                }
            else:
                return {
                    "success": True,
                    "hasPosition": False,
                    "size": 0,
                    "side": "",
                    "entryPrice": "0",
                    "unrealizedPnl": "0"
                }
        else:
            return {
                "success": False,
                "hasPosition": False,
                "error": result.get("retMsg", "Unknown error")
            }

    async def get_wallet_balance(self) -> Dict[str, Any]:
        """Get wallet balance"""
        params = {
            "accountType": "UNIFIED"
        }

        result = await self._make_request("GET", "/v5/account/wallet-balance", params)
        return result

    async def get_order_history(
        self,
        symbol: Optional[str] = None,
        limit: int = 20,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """Get order history"""
        params = {
            "category": category,
            "limit": limit
        }

        if symbol:
            params["symbol"] = symbol

        result = await self._make_request("GET", "/v5/order/history", params)
        return result
