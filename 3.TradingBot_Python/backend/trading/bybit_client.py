"""
Bybit API Client
Handles all interactions with Bybit API including signing, timestamp sync, and order execution

Optimizations (January 2026):
- Global HTTP client with connection pooling
- Integrated rate limiter with token bucket
- Granular timeouts per operation type
- Detailed logging of request/response times

Robustez (Noviembre 2026):
- order/create nunca se reenvia a ciegas si se pierde la respuesta: se busca la orden por orderLinkId
- El modo de posicion se detecta solo leyendo posiciones (nunca se llama a switch-mode)
- TP/SL a nivel de posicion con /v5/position/trading-stop (idempotente, uno solo para toda la posicion)
- Apalancamiento fijado por simbolo desde la configuracion del bot
- Precision real (qtyStep, tickSize, minOrderQty) leida de instruments-info y cacheada
"""

import hmac
import hashlib
import time
import json
import logging
import httpx
import asyncio
from typing import Optional, Dict, Any, List
from decimal import Decimal
from datetime import datetime, timezone

from .rate_limiter import get_rate_limiter, RateLimiter

logger = logging.getLogger("bybit_client")

# retCode propio: la peticion pudo llegar a Bybit pero no se sabe que paso
UNKNOWN_OUTCOME = -10

# retCodes de Bybit que se usan en la logica
RET_DUPLICATE_LINK_ID = 110072      # OrderLinkedID is duplicate
RET_TPSL_NOT_MODIFIED = 34040       # trading-stop: Not modified
RET_LEVERAGE_NOT_MODIFIED = 110043  # set-leverage: leverage not modified

# Tipos de orden condicional que Bybit crea para TP/SL de posicion (no son entradas)
_TPSL_ORDER_TYPES = {"TakeProfit", "StopLoss", "TrailingStop", "PartialTakeProfit", "PartialStopLoss", "tpslOrder"}

PRECISION_CACHE_TTL_S = 6 * 3600


class _BadResponse(Exception):
    """Bybit (o un proxy delante) respondio algo que no es JSON."""


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

        # Position index cache: "{symbol}_{lado de la posicion}" -> positionIdx
        self._position_idx_cache: Dict[str, Optional[int]] = {}

        # Position mode: None=unknown, "one_way"=posIdx 0, "hedge"=posIdx 1/2
        self._position_mode: Optional[str] = None

        # Simbolos con apalancamiento ya fijado en esta sesion ("SYMBOL:10")
        self._leverage_set: set = set()

        # Precision real por simbolo (instruments-info)
        self._precision_cache: Dict[str, Dict[str, Any]] = {}

        # Statistics
        self._request_count = 0
        self._total_request_time_ms = 0.0

        logger.info(f"[BYBIT] Client initialized: {self.base_url} (mode: {self.mode})")

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
            logger.info(f"[BYBIT] HTTP client created with connection pooling")

        return self._http_client

    async def close(self) -> None:
        """Close the HTTP client gracefully"""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None
            logger.info(f"[BYBIT] HTTP client closed")

    async def _get_server_time(self, client: httpx.AsyncClient) -> Optional[int]:
        """Get server time from Bybit. None si no se pudo leer."""
        try:
            start_time = time.monotonic()
            response = await client.get(f"{self.base_url}/v5/market/time")
            elapsed_ms = (time.monotonic() - start_time) * 1000

            data = response.json()
            if data.get("retCode") == 0:
                server_time = int(data["result"]["timeNano"]) // 1000000  # Convert to ms
                logger.debug(f"[BYBIT] Server time fetched in {elapsed_ms:.0f}ms")
                return server_time
        except Exception as e:
            logger.error(f"[BYBIT] Error getting server time: {e}")
        return None

    async def _sync_time(self, client: httpx.AsyncClient) -> None:
        """Synchronize local time with Bybit server"""
        current_time = time.time()
        if current_time - self.last_sync > self.sync_interval:
            server_time = await self._get_server_time(client)
            if server_time is None:
                # Sin hora del servidor se conserva el desfase anterior y se reintenta en 10 s
                self.last_sync = current_time - self.sync_interval + 10
                return
            local_time = int(time.time() * 1000)
            self.time_offset = server_time - local_time
            self.last_sync = current_time
            logger.debug(f"[BYBIT] Time synced: offset = {self.time_offset}ms")

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
        max_retries: int = 3,
        retry_unsafe: bool = True
    ) -> Dict[str, Any]:
        """
        Make authenticated request to Bybit API with retries and rate limiting.

        retry_unsafe=False se usa en order/create: si la peticion pudo llegar a Bybit
        (timeout de lectura, conexion cortada, respuesta que no es JSON) NO se reenvia.
        Se devuelve retCode UNKNOWN_OUTCOME y quien llama busca la orden por orderLinkId.
        Los errores en los que Bybit rechazo la peticion (10006, 10002) si se reintentan.
        """
        client = await self._get_client()

        # Sync time if needed (only once per sync_interval)
        await self._sync_time(client)

        for attempt in range(max_retries):
            try:
                # Acquire rate limit token
                wait_time = await self._rate_limiter.acquire()
                if wait_time > 0:
                    logger.info(f"[BYBIT] [RATE] Waited {wait_time*1000:.0f}ms for rate limit")

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
                try:
                    data = response.json()
                except Exception:
                    raise _BadResponse(f"HTTP {response.status_code}: {response.text[:120]!r}")

                # Update rate limiter with Bybit headers
                self._rate_limiter.update_from_headers(dict(response.headers))

                # Log request details
                ret_code = data.get("retCode", -1)
                status_symbol = "OK" if ret_code == 0 else "ERR"
                logger.info(f"[BYBIT] [{status_symbol}] {method} {endpoint} -> retCode={ret_code} ({elapsed_ms:.0f}ms)")

                # Log API errors for debugging
                if ret_code != 0:
                    error_msg = data.get("retMsg", "Unknown error")
                    logger.warning(f"[BYBIT] API Error: {error_msg} (retCode={ret_code})")

                    # Report error to rate limiter
                    self._rate_limiter.report_error(ret_code)

                    # Handle rate limit error (Bybit rechazo la peticion: reintentar es seguro)
                    if ret_code == 10006:  # Too many visits
                        logger.warning(f"[BYBIT] [RATE] Rate limit hit! Backing off...")
                        await self._rate_limiter.wait_for_backoff()
                        continue  # Retry
                else:
                    self._rate_limiter.report_success()

                # Check for timestamp errors and resync (Bybit rechazo la peticion: reintentar es seguro)
                if ret_code == 10002:  # Timestamp error
                    logger.warning(f"[BYBIT] Timestamp error, resyncing... (attempt {attempt + 1})")
                    self.last_sync = 0  # Force resync
                    await self._sync_time(client)
                    await asyncio.sleep(0.5)
                    continue

                return data

            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as e:
                # La conexion no llego a abrirse: la peticion no salio, reintentar es seguro
                logger.error(f"[BYBIT] Connection error to {endpoint} (attempt {attempt + 1}/{max_retries}): {type(e).__name__}: {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(2.0 * (attempt + 1))
                else:
                    return {"retCode": -3, "retMsg": f"Connection error: {str(e)}"}

            except Exception as e:
                # Timeout de lectura/escritura, conexion cortada a mitad o respuesta ilegible:
                # Bybit pudo haber recibido y ejecutado la peticion.
                kind = type(e).__name__
                if not retry_unsafe:
                    logger.error(f"[BYBIT] {method} {endpoint}: resultado desconocido ({kind}: {e}). No se reenvia.")
                    return {"retCode": UNKNOWN_OUTCOME, "retMsg": f"Resultado desconocido ({kind}): {e}", "outcome_unknown": True}
                logger.warning(f"[BYBIT] {kind} {method} {endpoint} (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
                else:
                    if isinstance(e, httpx.TimeoutException):
                        return {"retCode": -2, "retMsg": f"Timeout after {max_retries} attempts"}
                    return {"retCode": -1, "retMsg": f"Error: {str(e)}"}

        return {"retCode": -1, "retMsg": "Max retries exceeded"}

    # ------------------------------------------------------------------
    # Modo de posicion
    # ------------------------------------------------------------------

    def _learn_mode_from_entries(self, entries: List[Dict[str, Any]]) -> None:
        """Bybit devuelve positionIdx en cada entrada: 0 = one-way, 1/2 = hedge."""
        for p in entries or []:
            try:
                idx = int(p.get("positionIdx", 0) or 0)
            except (TypeError, ValueError):
                continue
            mode = "one_way" if idx == 0 else "hedge"
            if self._position_mode != mode:
                logger.info(f"[BYBIT] Position mode learned from positions: {mode} (posIdx={idx})")
            self._position_mode = mode
            return

    async def detect_position_mode(self, symbol: str = "BTCUSDT", category: str = "linear") -> str:
        """
        Detecta el modo de posicion SOLO leyendo posiciones. Nunca cambia la cuenta.
        1. /v5/position/list del simbolo (Bybit suele devolver la entrada aunque el tamano sea 0)
        2. /v5/position/list de todas las posiciones USDT
        Si no se puede saber devuelve "unknown" y las ordenes prueban positionIdx 0 y luego 1/2
        (un positionIdx equivocado Bybit lo rechaza sin ejecutar nada).
        """
        if self._position_mode:
            return self._position_mode

        for params in ({"category": category, "symbol": symbol}, {"category": category, "settleCoin": "USDT"}):
            try:
                result = await self._make_request("GET", "/v5/position/list", params)
                if result.get("retCode") == 0:
                    entries = result.get("result", {}).get("list", []) or []
                    if entries:
                        self._learn_mode_from_entries(entries)
                        if self._position_mode:
                            return self._position_mode
            except Exception as e:
                logger.error(f"[BYBIT] Error checking positions: {e}")

        logger.warning(f"[BYBIT] Position mode unknown: orders will try positionIdx 0 and then 1/2")
        return "unknown"

    def _idx_candidates(self, opening_side: str) -> List[int]:
        """positionIdx a probar, el mas probable primero. El otro solo se usa si Bybit rechaza por modo."""
        hedge_idx = 1 if opening_side == "Buy" else 2
        if self._position_mode == "hedge":
            return [hedge_idx, 0]
        return [0, hedge_idx]

    def _idx_for_position(self, symbol: str, position_side: str) -> int:
        cached = self._position_idx_cache.get(f"{symbol}_{position_side}")
        if cached is not None:
            return cached
        if self._position_mode == "hedge":
            return 1 if position_side == "Buy" else 2
        return 0

    def _learn_idx(self, cache_key: str, pos_idx: int) -> None:
        self._position_idx_cache[cache_key] = pos_idx
        self._position_mode = "one_way" if pos_idx == 0 else "hedge"

    @staticmethod
    def _is_idx_mismatch(ret_code: Any, ret_msg: str) -> bool:
        """Solo el error especifico de positionIdx, no cualquier 10001 (que es el error generico de parametros)."""
        msg = (ret_msg or "").lower()
        return ret_code == 10001 and "position idx" in msg

    def _get_position_configs(self, side: str) -> list:
        """Compatibilidad: positionIdx a probar para abrir del lado indicado."""
        return self._idx_candidates(side)

    # ------------------------------------------------------------------
    # Ordenes
    # ------------------------------------------------------------------

    async def find_order(
        self,
        symbol: str,
        order_link_id: Optional[str] = None,
        order_id: Optional[str] = None,
        category: str = "linear",
        attempts: int = 4,
        delay: float = 0.7
    ) -> Optional[Dict[str, Any]]:
        """Busca una orden por orderLinkId u orderId en ordenes activas y en el historial."""
        params: Dict[str, Any] = {"category": category, "symbol": symbol}
        if order_link_id:
            params["orderLinkId"] = order_link_id
        if order_id:
            params["orderId"] = order_id
        for i in range(attempts):
            for endpoint in ("/v5/order/realtime", "/v5/order/history"):
                result = await self._make_request("GET", endpoint, params)
                if result.get("retCode") == 0:
                    found = result.get("result", {}).get("list", []) or []
                    if found:
                        return found[0]
            if i < attempts - 1:
                await asyncio.sleep(delay)
        return None

    async def _create_order(
        self,
        base_params: Dict[str, Any],
        symbol: str,
        side: str,
        prefix: str,
        reduce_only: bool = False,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Envia /v5/order/create eligiendo positionIdx y sin reenviar a ciegas.
        - Respuesta perdida o orderLinkId duplicado: busca la orden por orderLinkId.
          Si existe la da por creada; si no aparece devuelve UNKNOWN_OUTCOME.
        - Solo prueba otro positionIdx si Bybit rechaza por modo de posicion.
        """
        if not self._position_mode:
            await self.detect_position_mode(symbol, category)

        opening_side = side if not reduce_only else ("Buy" if side == "Sell" else "Sell")
        cache_key = f"{symbol}_{opening_side}"
        candidates = self._idx_candidates(opening_side)
        cached = self._position_idx_cache.get(cache_key)
        if cached is not None:
            candidates = [cached] + [i for i in candidates if i != cached]

        last_result: Optional[Dict[str, Any]] = None
        for attempt_num, pos_idx in enumerate(candidates):
            # orderLinkId unico por intento (Bybit rechaza IDs repetidos)
            order_link_id = f"{prefix}_{int(time.time() * 1000)}_{attempt_num}"
            params = dict(base_params)
            params["positionIdx"] = pos_idx
            params["orderLinkId"] = order_link_id

            logger.debug(f"[BYBIT] order/create attempt {attempt_num+1}/{len(candidates)} positionIdx={pos_idx} (mode={self._position_mode})")
            result = await self._make_request("POST", "/v5/order/create", params, retry_unsafe=False)
            ret_code = result.get("retCode")
            ret_msg = result.get("retMsg", "") or ""

            if ret_code == 0:
                self._learn_idx(cache_key, pos_idx)
                result["orderLinkId"] = order_link_id
                return result

            if ret_code in (UNKNOWN_OUTCOME, RET_DUPLICATE_LINK_ID):
                logger.warning(f"[BYBIT] order/create {order_link_id}: {ret_msg}. Buscando la orden en Bybit...")
                found = await self.find_order(symbol, order_link_id=order_link_id, category=category)
                if found:
                    self._learn_idx(cache_key, pos_idx)
                    logger.warning(f"[BYBIT] Orden {order_link_id} encontrada en Bybit (orderId={found.get('orderId')}, "
                                   f"estado={found.get('orderStatus')}): se da por creada")
                    return {
                        "retCode": 0,
                        "retMsg": "OK (orden encontrada tras perder la respuesta)",
                        "result": {"orderId": found.get("orderId"), "orderLinkId": order_link_id},
                        "recovered": True,
                        "order": found,
                        "orderLinkId": order_link_id,
                    }
                logger.error(f"[BYBIT] Orden {order_link_id} no aparece en Bybit: resultado desconocido")
                return {
                    "retCode": UNKNOWN_OUTCOME,
                    "retMsg": f"No se sabe si la orden {order_link_id} llego a Bybit ({ret_msg})",
                    "outcome_unknown": True,
                    "orderLinkId": order_link_id,
                }

            last_result = result
            if self._is_idx_mismatch(ret_code, ret_msg):
                logger.warning(f"[BYBIT] positionIdx={pos_idx} no corresponde al modo de la cuenta ({ret_msg}), probando el otro")
                self._position_idx_cache.pop(cache_key, None)
                self._position_mode = None
                continue

            logger.error(f"[BYBIT] order/create rechazada: {ret_msg} (retCode={ret_code})")
            return result

        logger.error(f"[BYBIT] order/create failed after {len(candidates)} positionIdx attempts")
        return last_result or {"retCode": -1, "retMsg": "All position index attempts failed"}

    async def get_instrument_info(
        self,
        symbol: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Get instrument/symbol information from Bybit API
        This includes tickSize, qtyStep (stepSize), minOrderQty, maxOrderQty, etc.

        This is a PUBLIC endpoint - no authentication required

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            category: "linear" for USDT perpetual, "spot", "inverse", "option"

        Returns:
            Dict with instrument info or error
        """
        try:
            client = await self._get_client()

            url = f"{self.base_url}/v5/market/instruments-info"
            params = {"category": category, "symbol": symbol}
            query_string = "&".join([f"{k}={v}" for k, v in params.items()])

            start_time = time.monotonic()
            response = await client.get(f"{url}?{query_string}")
            elapsed_ms = (time.monotonic() - start_time) * 1000

            data = response.json()

            if data.get("retCode") != 0:
                logger.error(f"[BYBIT] GET /v5/market/instruments-info -> retCode={data.get('retCode')} ({elapsed_ms:.0f}ms) Error: {data.get('retMsg')}")
                return {"success": False, "error": data.get("retMsg", "Unknown error")}

            # Extract the instrument info from response
            result = data.get("result", {})
            instruments = result.get("list", [])

            if not instruments:
                logger.warning(f"[BYBIT] No instrument found for {symbol}")
                return {"success": False, "error": f"Symbol {symbol} not found"}

            instrument = instruments[0]

            # Extract relevant fields for linear futures
            lot_size = instrument.get("lotSizeFilter", {})
            price_filter = instrument.get("priceFilter", {})
            leverage_filter = instrument.get("leverageFilter", {})

            info = {
                "success": True,
                "symbol": instrument.get("symbol"),
                "status": instrument.get("status"),
                # Quantity precision
                "qtyStep": lot_size.get("qtyStep"),           # Step size for quantity
                "minOrderQty": lot_size.get("minOrderQty"),   # Minimum order quantity
                "maxOrderQty": lot_size.get("maxOrderQty"),   # Maximum order quantity (market)
                "maxMktOrderQty": lot_size.get("maxMktOrderQty"),  # Max market order qty
                # Price precision
                "tickSize": price_filter.get("tickSize"),     # Step size for price
                "minPrice": price_filter.get("minPrice"),
                "maxPrice": price_filter.get("maxPrice"),
                # Leverage
                "minLeverage": leverage_filter.get("minLeverage"),
                "maxLeverage": leverage_filter.get("maxLeverage"),
            }

            logger.info(f"[BYBIT] Instrument info {symbol} ({elapsed_ms:.0f}ms): qtyStep={info['qtyStep']}, tickSize={info['tickSize']}, minQty={info['minOrderQty']}, maxQty={info['maxMktOrderQty'] or info['maxOrderQty']}")

            return info

        except Exception as e:
            logger.error(f"[BYBIT] Failed to get instrument info for {symbol}: {e}")
            return {"success": False, "error": str(e)}

    async def get_precision(self, symbol: str, category: str = "linear") -> Optional[Dict[str, Any]]:
        """Paso de cantidad, tick y minimo reales de Bybit, cacheados unas horas. None si no se pudo leer."""
        now = time.time()
        cached = self._precision_cache.get(symbol)
        if cached and now - cached["t"] < PRECISION_CACHE_TTL_S:
            return cached
        info = await self.get_instrument_info(symbol, category)
        if info.get("success") and info.get("qtyStep") and info.get("tickSize"):
            try:
                cached = {
                    "t": now,
                    "qty_step": Decimal(str(info["qtyStep"])),
                    "tick_size": Decimal(str(info["tickSize"])),
                    "min_qty": Decimal(str(info.get("minOrderQty") or "0")),
                    "max_qty": Decimal(str(info.get("maxMktOrderQty") or info.get("maxOrderQty") or "0")),
                    "status": info.get("status"),
                }
            except Exception as e:
                logger.warning(f"[BYBIT] Precision for {symbol} unreadable: {e}")
                return None
            self._precision_cache[symbol] = cached
            return cached
        return None

    async def get_last_price(self, symbol: str, category: str = "linear") -> Optional[Decimal]:
        """
        Get the current last traded price for a symbol from Bybit.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            category: "linear" for USDT perpetual

        Returns:
            Decimal price or None if failed
        """
        try:
            result = await self._make_request(
                "GET",
                "/v5/market/tickers",
                params={"category": category, "symbol": symbol}
            )
            if result.get("retCode") == 0:
                tickers = result.get("result", {}).get("list", [])
                if tickers:
                    last_price = tickers[0].get("lastPrice", "0")
                    price = Decimal(str(last_price))
                    return price if price > 0 else None
            logger.warning(f"[BYBIT] Could not get last price for {symbol}: {result.get('retMsg', 'Unknown')}")
            return None
        except Exception as e:
            logger.error(f"[BYBIT] Error getting last price for {symbol}: {e}")
            return None

    async def place_market_order(
        self,
        symbol: str,
        side: str,
        qty: str,
        category: str = "linear",
        reduce_only: bool = False
    ) -> Dict[str, Any]:
        """
        Place a market order with automatic position index detection

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            side: "Buy" or "Sell"
            qty: Quantity as string (formatted to StepSize)
            category: "linear" for USDT perpetual
            reduce_only: True para cerrar una posicion (no puede abrir ni aumentar)
        """
        logger.info(f"[BYBIT] [ORDER] Placing Market Order: {side} {symbol} qty={qty}{' reduceOnly' if reduce_only else ''}")
        params: Dict[str, Any] = {
            "category": category,
            "symbol": symbol,
            "side": side,
            "orderType": "Market",
            "qty": qty,
        }
        if reduce_only:
            params["reduceOnly"] = True
        result = await self._create_order(params, symbol, side, "close" if reduce_only else "mkt",
                                          reduce_only=reduce_only, category=category)
        if result.get("retCode") == 0:
            logger.info(f"[BYBIT] [OK] Market Order placed: orderId={result.get('result', {}).get('orderId')}")
        return result

    async def place_order_with_tpsl(
        self,
        symbol: str,
        side: str,
        qty: str,
        order_type: str = "Market",
        limit_price: Optional[str] = None,
        take_profit: Optional[str] = None,
        stop_loss: Optional[str] = None,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place an order (Market or Limit) with integrated Take Profit and Stop Loss.
        This sends a single API call instead of 3 separate calls.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            side: "Buy" or "Sell"
            qty: Quantity as string (formatted to StepSize)
            order_type: "Market" or "Limit"
            limit_price: Required if order_type is "Limit"
            take_profit: Take profit trigger price (optional)
            stop_loss: Stop loss trigger price (optional)
            category: "linear" for USDT perpetual

        Returns:
            Dict with order result
        """
        order_type_display = order_type.upper()
        logger.info(f"[BYBIT] [ORDER+TPSL] Placing {order_type_display} {side} {symbol} qty={qty} TP={take_profit} SL={stop_loss}{' limit=' + str(limit_price) if limit_price else ''}")

        # Validate limit order has price
        if order_type.upper() == "LIMIT" and not limit_price:
            logger.error(f"[BYBIT] Limit order requires limit_price")
            return {"retCode": -1, "retMsg": "Limit order requires limit_price"}

        params: Dict[str, Any] = {
            "category": category,
            "symbol": symbol,
            "side": side,
            "orderType": order_type.capitalize(),  # "Market" or "Limit"
            "qty": qty,
            "timeInForce": "GTC" if order_type.upper() == "LIMIT" else "IOC",
        }

        # Add limit price if Limit order
        if order_type.upper() == "LIMIT" and limit_price:
            params["price"] = limit_price

        # Add Take Profit if provided
        if take_profit:
            params["takeProfit"] = take_profit
            params["tpTriggerBy"] = "LastPrice"
            params["tpOrderType"] = "Market"  # TP executes as market order

        # Add Stop Loss if provided
        if stop_loss:
            params["stopLoss"] = stop_loss
            params["slTriggerBy"] = "LastPrice"
            params["slOrderType"] = "Market"  # SL executes as market order

        # Set tpslMode if either TP or SL is provided
        if take_profit or stop_loss:
            params["tpslMode"] = "Full"  # Apply to entire position

        result = await self._create_order(params, symbol, side, "tpsl", category=category)
        if result.get("retCode") == 0:
            logger.info(f"[BYBIT] [OK] {order_type_display}+TPSL placed: orderId={result.get('result', {}).get('orderId')}")
        return result

    async def set_trading_stop(
        self,
        symbol: str,
        position_side: str,
        take_profit: Optional[str] = None,
        stop_loss: Optional[str] = None,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Fija TP/SL de TODA la posicion (tpslMode Full) con /v5/position/trading-stop.
        Es idempotente: repetirlo no crea ordenes nuevas. Bybit lo borra solo al cerrar la posicion,
        y si salta uno el otro desaparece (no quedan patas sueltas).
        """
        params: Dict[str, Any] = {
            "category": category,
            "symbol": symbol,
            "tpslMode": "Full",
            "positionIdx": self._idx_for_position(symbol, position_side),
        }
        if take_profit:
            params.update({"takeProfit": take_profit, "tpTriggerBy": "LastPrice", "tpOrderType": "Market"})
        if stop_loss:
            params.update({"stopLoss": stop_loss, "slTriggerBy": "LastPrice", "slOrderType": "Market"})
        logger.info(f"[BYBIT] [TP/SL] trading-stop {symbol} {position_side}: SL={stop_loss} TP={take_profit} (posIdx={params['positionIdx']})")
        result = await self._make_request("POST", "/v5/position/trading-stop", params)
        if result.get("retCode") == RET_TPSL_NOT_MODIFIED:
            return {"retCode": 0, "retMsg": "Not modified (ya estaba puesto)", "result": {}}
        return result

    async def ensure_leverage(self, symbol: str, leverage: Any, category: str = "linear") -> Dict[str, Any]:
        """Fija el apalancamiento de la configuracion una vez por simbolo y sesion."""
        try:
            lev = Decimal(str(leverage))
        except Exception:
            return {"retCode": -1, "retMsg": f"Apalancamiento invalido: {leverage}"}
        if lev <= 0:
            return {"retCode": -1, "retMsg": f"Apalancamiento invalido: {leverage}"}
        lev_str = format(lev.normalize(), "f")
        key = f"{symbol}:{lev_str}"
        if key in self._leverage_set:
            return {"retCode": 0, "retMsg": "OK (ya fijado)"}
        result = await self._make_request("POST", "/v5/position/set-leverage", {
            "category": category,
            "symbol": symbol,
            "buyLeverage": lev_str,
            "sellLeverage": lev_str,
        })
        code = result.get("retCode")
        if code in (0, RET_LEVERAGE_NOT_MODIFIED):
            self._leverage_set.add(key)
            logger.info(f"[BYBIT] Leverage {symbol} = {lev_str}x")
            return {"retCode": 0, "retMsg": "OK"}
        logger.warning(f"[BYBIT] No se pudo fijar apalancamiento {lev_str}x en {symbol}: {result.get('retMsg')} (retCode={code})")
        return result

    async def get_open_orders(self, symbol: str, category: str = "linear") -> Optional[List[Dict[str, Any]]]:
        """Ordenes activas del simbolo. None si Bybit no respondio (no se pudo verificar)."""
        result = await self._make_request("GET", "/v5/order/realtime", {"category": category, "symbol": symbol})
        if result.get("retCode") != 0:
            logger.warning(f"[BYBIT] Could not read open orders for {symbol}: {result.get('retMsg')}")
            return None
        return result.get("result", {}).get("list", []) or []

    @staticmethod
    def is_entry_order(order: Dict[str, Any]) -> bool:
        """True si la orden abre o aumenta posicion (no es TP/SL ni reduce-only)."""
        if order.get("reduceOnly") in (True, "true", "True") or order.get("closeOnTrigger") in (True, "true", "True"):
            return False
        return (order.get("stopOrderType") or "") not in _TPSL_ORDER_TYPES

    async def get_position(
        self,
        symbol: str,
        category: str = "linear",
        side_filter: str = None
    ) -> Dict[str, Any]:
        """
        Get current position for a symbol.
        In hedge mode, a symbol can have up to 2 positions (Buy + Sell).

        Args:
            symbol: Trading pair
            category: "linear" or "inverse"
            side_filter: "Buy" or "Sell" - in hedge mode, only return position for this side.
                         If None, returns the first non-empty position found.

        Returns:
            Dict with position info including size, side, entry price, SL/TP.
            "positions" trae TODAS las posiciones abiertas del simbolo (ambos lados en hedge).
        """
        params = {
            "category": category,
            "symbol": symbol
        }

        result = await self._make_request("GET", "/v5/position/list", params)

        if result.get("retCode") == 0:
            positions = result["result"]["list"] or []
            # Cada entrada trae positionIdx: sirve para conocer el modo sin enviar ordenes
            self._learn_mode_from_entries(positions)

            def parse_price(val):
                try:
                    f = float(val) if val else 0
                    return f if f > 0 else None
                except (ValueError, TypeError):
                    return None

            def describe(p):
                return {
                    "side": p.get("side", ""),
                    "size": float(p.get("size", "0") or 0),
                    "sizeRaw": p.get("size", "0"),
                    "entryPrice": p.get("avgPrice", "0"),
                    "markPrice": p.get("markPrice", "0"),
                    "unrealizedPnl": p.get("unrealisedPnl", "0"),
                    "leverage": p.get("leverage", "0"),
                    "liqPrice": p.get("liqPrice", "0"),
                    "positionValue": p.get("positionValue"),
                    "stopLoss": parse_price(p.get("stopLoss", "0")),
                    "takeProfit": parse_price(p.get("takeProfit", "0")),
                    "positionIdx": p.get("positionIdx"),
                    "createdTime": p.get("createdTime"),
                    "updatedTime": p.get("updatedTime"),
                }

            open_positions = [p for p in positions if float(p.get("size", "0") or 0) > 0 and p.get("side", "")]

            # En hedge mode, filtrar por side si se especifica
            matched_pos = None
            if open_positions:
                if side_filter and self._position_mode == "hedge":
                    for p in open_positions:
                        if p.get("side", "") == side_filter:
                            matched_pos = p
                            break
                else:
                    # one_way, modo desconocido o sin filtro: primera posicion abierta
                    matched_pos = open_positions[0]

            all_open = [describe(p) for p in open_positions]

            if matched_pos:
                pos = matched_pos
                size = float(pos.get("size", "0"))
                side = pos.get("side", "")
                trailing_stop = parse_price(pos.get("trailingStop", "0"))

                return {
                    "success": True,
                    "hasPosition": size > 0 and side != "",
                    "size": size,
                    "side": side,
                    "entryPrice": pos.get("avgPrice", "0"),
                    "unrealizedPnl": pos.get("unrealisedPnl", "0"),
                    "markPrice": pos.get("markPrice", "0"),
                    "leverage": pos.get("leverage", "0"),
                    "liqPrice": pos.get("liqPrice", "0"),
                    "positionValue": pos.get("positionValue"),
                    "stopLoss": parse_price(pos.get("stopLoss", "0")),
                    "takeProfit": parse_price(pos.get("takeProfit", "0")),
                    "trailingStop": trailing_stop,
                    "tpslMode": pos.get("tpslMode", ""),
                    "createdTime": pos.get("createdTime"),
                    "updatedTime": pos.get("updatedTime"),
                    "positions": all_open,
                    "positionMode": self._position_mode or "unknown",
                    "data": pos
                }
            else:
                return {
                    "success": True,
                    "hasPosition": False,
                    "size": 0,
                    "side": "",
                    "entryPrice": "0",
                    "unrealizedPnl": "0",
                    "stopLoss": None,
                    "takeProfit": None,
                    "positions": all_open,
                    "positionMode": self._position_mode or "unknown",
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

    async def check_api_key(self) -> Dict[str, Any]:
        """Valida las claves con un endpoint privado de solo lectura (/v5/user/query-api)."""
        result = await self._make_request("GET", "/v5/user/query-api")
        if result.get("retCode") == 0:
            info = result.get("result", {}) or {}
            return {"valid": True, "readOnly": str(info.get("readOnly")) == "1", "permissions": info.get("permissions"), "retMsg": "OK"}
        return {"valid": False, "retCode": result.get("retCode"), "retMsg": result.get("retMsg", "Unknown error")}

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
            "position_mode": self._position_mode or "unknown",
            "time_offset_ms": self.time_offset
        }
