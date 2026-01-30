"""
Bybit API Client
Handles all interactions with Bybit API including signing, timestamp sync, and order execution

Optimizations (January 2026):
- Global HTTP client with connection pooling
- Integrated rate limiter with token bucket
- Granular timeouts per operation type
- Detailed logging of request/response times
"""

import hmac
import hashlib
import time
import json
import httpx
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime, timezone

from .rate_limiter import get_rate_limiter, RateLimiter


class BybitClient:
    """
    Client for interacting with Bybit API v5
    Implements HMAC-SHA256 signing and automatic timestamp synchronization

    Features:
    - Connection pooling for HTTP requests
    - Integrated rate limiting with token bucket
    - Automatic time synchronization
    - Detailed logging for debugging
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
        self.sync_interval = 60  # Sync every 1 minute (improved from 5 minutes)

        # Global HTTP client with connection pooling
        self._http_client: Optional[httpx.AsyncClient] = None

        # Rate limiter
        self._rate_limiter = get_rate_limiter()

        # Position index cache
        self._position_idx_cache: Dict[str, Optional[int]] = {}

        # Statistics
        self._request_count = 0
        self._total_request_time_ms = 0.0

        print(f"[BYBIT] Client initialized: {self.base_url} (mode: {self.mode})")

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client with connection pooling"""
        if self._http_client is None or self._http_client.is_closed:
            # Granular timeouts
            timeout = httpx.Timeout(
                connect=5.0,    # Connection timeout
                read=10.0,      # Read timeout
                write=5.0,      # Write timeout
                pool=5.0        # Pool timeout
            )

            # Connection limits for pooling
            limits = httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=30.0
            )

            self._http_client = httpx.AsyncClient(
                timeout=timeout,
                limits=limits,
                http2=False  # HTTP/1.1 is more reliable for trading APIs
            )
            print(f"[BYBIT] HTTP client created with connection pooling")

        return self._http_client

    async def close(self) -> None:
        """Close the HTTP client gracefully"""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None
            print(f"[BYBIT] HTTP client closed")

    async def _get_server_time(self, client: httpx.AsyncClient) -> int:
        """Get server time from Bybit"""
        try:
            start_time = time.monotonic()
            response = await client.get(f"{self.base_url}/v5/market/time")
            elapsed_ms = (time.monotonic() - start_time) * 1000

            data = response.json()
            if data.get("retCode") == 0:
                server_time = int(data["result"]["timeNano"]) // 1000000  # Convert to ms
                print(f"[SYNC] Server time fetched in {elapsed_ms:.0f}ms")
                return server_time
        except Exception as e:
            print(f"[ERROR] Error getting server time: {e}")
        return int(time.time() * 1000)

    async def _sync_time(self, client: httpx.AsyncClient) -> None:
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
        """Make authenticated request to Bybit API with retries and rate limiting"""
        client = await self._get_client()

        # Sync time if needed (only once per sync_interval)
        await self._sync_time(client)

        for attempt in range(max_retries):
            try:
                # Acquire rate limit token
                wait_time = await self._rate_limiter.acquire()
                if wait_time > 0:
                    print(f"[RATE] Waited {wait_time*1000:.0f}ms for rate limit")

                timestamp = self._get_timestamp()
                start_time = time.monotonic()

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
                    body = json.dumps(params or {})
                    signature = self._generate_signature(timestamp, body)
                    headers = self._get_headers(timestamp, signature)

                    response = await client.post(
                        f"{self.base_url}{endpoint}",
                        headers=headers,
                        content=body
                    )

                # Calculate request time
                elapsed_ms = (time.monotonic() - start_time) * 1000
                self._request_count += 1
                self._total_request_time_ms += elapsed_ms

                # Parse response
                data = response.json()

                # Update rate limiter with Bybit headers
                self._rate_limiter.update_from_headers(dict(response.headers))

                # Log request details
                ret_code = data.get("retCode", -1)
                status_symbol = "OK" if ret_code == 0 else "ERR"
                print(f"[{status_symbol}] {method} {endpoint} -> {ret_code} ({elapsed_ms:.0f}ms)")

                # Log API errors for debugging
                if ret_code != 0:
                    error_msg = data.get("retMsg", "Unknown error")
                    print(f"   Error: {error_msg}")

                    # Report error to rate limiter
                    self._rate_limiter.report_error(ret_code)

                    # Handle rate limit error
                    if ret_code == 10006:  # Too many visits
                        print(f"[RATE] Rate limit hit! Backing off...")
                        await self._rate_limiter.wait_for_backoff()
                        continue  # Retry
                else:
                    self._rate_limiter.report_success()

                # Check for timestamp errors and resync
                if ret_code == 10002:  # Timestamp error
                    print(f"[WARNING] Timestamp error, resyncing... (attempt {attempt + 1})")
                    self.last_sync = 0  # Force resync
                    await self._sync_time(client)
                    await asyncio.sleep(0.5)
                    continue

                return data

            except httpx.TimeoutException as e:
                print(f"[TIMEOUT] {method} {endpoint} timed out (attempt {attempt + 1}/{max_retries})")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
                else:
                    return {"retCode": -2, "retMsg": f"Timeout after {max_retries} attempts"}

            except httpx.ConnectError as e:
                print(f"[CONNECT] Connection error to {endpoint} (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2.0 * (attempt + 1))
                else:
                    return {"retCode": -3, "retMsg": f"Connection error: {str(e)}"}

            except Exception as e:
                print(f"[ERROR] Request error (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
                else:
                    return {"retCode": -1, "retMsg": f"Error: {str(e)}"}

        return {"retCode": -1, "retMsg": "Max retries exceeded"}

    async def place_market_order(
        self,
        symbol: str,
        side: str,
        qty: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place a market order with automatic position index detection

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            side: "Buy" or "Sell"
            qty: Quantity as string (formatted to StepSize)
            category: "linear" for USDT perpetual
        """
        print(f"[ORDER] Placing Market Order: {side} {symbol} qty={qty}")

        # List of position index configurations to try
        # Different symbols might need different configurations
        position_configs = [
            None,  # No positionIdx (works for BTCUSDT)
            0,     # One-way mode
            1 if side == "Buy" else 2,  # Hedge mode
        ]

        last_error = None
        order_link_id = f"mkt_{int(time.time() * 1000)}"

        for pos_idx in position_configs:
            params = {
                "category": category,
                "symbol": symbol,
                "side": side,
                "orderType": "Market",
                "qty": qty,
                "orderLinkId": order_link_id
            }

            # Add positionIdx if not None
            if pos_idx is not None:
                params["positionIdx"] = pos_idx
                print(f"[DEBUG] Trying with positionIdx: {pos_idx}")
            else:
                print(f"[DEBUG] Trying without positionIdx")

            result = await self._make_request("POST", "/v5/order/create", params)

            if result.get("retCode") == 0:
                order_id = result["result"]["orderId"]
                print(f"[OK] Market Order placed: {order_id} (positionIdx: {pos_idx})")
                # Store successful config for this symbol
                self._position_idx_cache[f"{symbol}_{side}"] = pos_idx
                return result
            else:
                last_error = result.get("retMsg")
                if result.get("retCode") != 10001:  # If it's not position mode error, stop trying
                    print(f"[ERROR] Market Order failed: {last_error}")
                    return result
                # Continue trying other position index values

        # All attempts failed
        print(f"[ERROR] Market Order failed after all attempts: {last_error}")
        return {"retCode": -1, "retMsg": last_error or "All position index attempts failed"}

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

        # Use cached positionIdx if available, otherwise use 0
        # Note: for SL, side is opposite of opening position
        # So we need to get the cached index for the opening side
        opening_side = "Buy" if side == "Sell" else "Sell"
        cache_key = f"{symbol}_{opening_side}"

        # Get cached position index or default to 0
        pos_idx = 0
        if cache_key in self._position_idx_cache:
            cached = self._position_idx_cache[cache_key]
            if cached is not None:
                pos_idx = cached

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
            "positionIdx": pos_idx  # Use cached or default
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
        # Use cached positionIdx if available, otherwise use 0
        # Note: for TP, side is opposite of opening position
        # So we need to get the cached index for the opening side
        opening_side = "Buy" if side == "Sell" else "Sell"
        cache_key = f"{symbol}_{opening_side}"

        # Get cached position index or default to 0
        pos_idx = 0
        if cache_key in self._position_idx_cache:
            cached = self._position_idx_cache[cache_key]
            if cached is not None:
                pos_idx = cached

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
            "positionIdx": pos_idx  # Use cached or default
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

    def get_statistics(self) -> Dict[str, Any]:
        """Get client statistics"""
        avg_request_time = (
            self._total_request_time_ms / self._request_count
            if self._request_count > 0 else 0
        )

        return {
            "request_count": self._request_count,
            "total_request_time_ms": round(self._total_request_time_ms, 2),
            "avg_request_time_ms": round(avg_request_time, 2),
            "rate_limiter": self._rate_limiter.get_statistics(),
            "mode": self.mode,
            "time_offset_ms": self.time_offset
        }
