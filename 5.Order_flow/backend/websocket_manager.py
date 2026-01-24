"""
WebSocket Manager for Bybit Real-time Data

Maintains persistent WebSocket connection to Bybit for real-time kline data.
Handles reconnection, heartbeat, and candle buffer management.

Author: Claude Code
Date: 2025-01-16
"""

import asyncio
import json
import time
import logging
from typing import Dict, List, Callable, Optional, Set
from dataclasses import dataclass, field
from collections import defaultdict

try:
    import websockets
    from websockets.exceptions import ConnectionClosed, ConnectionClosedError
except ImportError:
    print("ERROR: websockets library not installed. Run: pip install websockets>=12.0")
    raise

try:
    import httpx
except ImportError:
    httpx = None

logger = logging.getLogger(__name__)


@dataclass
class Candle:
    """Represents a single OHLCV candle"""
    timestamp: int  # Open time in milliseconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    turnover: float
    confirm: bool  # True if candle is closed/confirmed

    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp,
            'open': self.open,
            'high': self.high,
            'low': self.low,
            'close': self.close,
            'volume': self.volume,
            'turnover': self.turnover,
            'confirm': self.confirm,
            'in_progress': not self.confirm
        }


@dataclass
class Trade:
    """Represents a single trade from publicTrade stream"""
    timestamp: int      # Trade execution time in milliseconds
    symbol: str         # Trading pair (e.g., "BTCUSDT")
    side: str           # "Buy" or "Sell" (taker side)
    price: float        # Trade price
    size: float         # Trade size in base currency
    trade_id: str       # Unique trade ID

    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp,
            'symbol': self.symbol,
            'side': self.side,
            'price': self.price,
            'size': self.size,
            'trade_id': self.trade_id
        }


@dataclass
class CandleBuffer:
    """Buffer for storing candles per symbol/interval"""
    candles: List[Candle] = field(default_factory=list)
    max_candles: int = 500  # Keep last 500 candles
    last_update: float = 0
    preloaded: bool = False  # Flag to indicate if historical data was preloaded

    def preload_candles(self, historical_candles: List[Candle]):
        """
        Preload historical candles into the buffer.
        Called once at startup to provide enough data for pattern detection.
        """
        if self.preloaded:
            logger.debug("Buffer already preloaded, skipping")
            return

        # Sort by timestamp and add all historical candles
        sorted_candles = sorted(historical_candles, key=lambda c: c.timestamp)

        for candle in sorted_candles:
            # Check if candle already exists
            exists = any(c.timestamp == candle.timestamp for c in self.candles)
            if not exists:
                self.candles.append(candle)

        # Sort final buffer by timestamp
        self.candles.sort(key=lambda c: c.timestamp)

        # Trim if too large
        if len(self.candles) > self.max_candles:
            self.candles = self.candles[-self.max_candles:]

        self.preloaded = True
        self.last_update = time.time()
        logger.info(f"Preloaded {len(sorted_candles)} candles, buffer now has {len(self.candles)} candles")

    def add_or_update(self, candle: Candle) -> bool:
        """
        Add or update a candle in the buffer.
        Returns True if this is a NEW closed candle (trigger for pattern detection).
        """
        self.last_update = time.time()

        # Find existing candle with same timestamp
        for i, existing in enumerate(self.candles):
            if existing.timestamp == candle.timestamp:
                # Update existing candle
                was_open = not existing.confirm
                self.candles[i] = candle

                # Return True only if candle just closed (was open, now confirmed)
                if was_open and candle.confirm:
                    return True
                return False

        # New candle - add to buffer
        self.candles.append(candle)

        # Trim buffer if too large
        if len(self.candles) > self.max_candles:
            self.candles = self.candles[-self.max_candles:]

        # If new candle is already confirmed, it's a closed candle
        return candle.confirm

    def get_candles(self, limit: int = None) -> List[Dict]:
        """Get candles as list of dicts"""
        candles = self.candles if limit is None else self.candles[-limit:]
        return [c.to_dict() for c in candles]

    def get_last_closed_candle(self) -> Optional[Candle]:
        """Get the most recent closed candle"""
        for candle in reversed(self.candles):
            if candle.confirm:
                return candle
        return None


class WebSocketManager:
    """
    Manages WebSocket connection to Bybit for real-time kline data.

    Features:
    - Automatic reconnection with exponential backoff
    - Heartbeat/ping to keep connection alive
    - Candle buffer per symbol/interval
    - Callback on candle close for pattern detection
    """

    BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/linear"
    PING_INTERVAL = 20  # seconds
    MAX_RECONNECT_DELAY = 60  # seconds

    def __init__(self):
        self.ws = None
        self.running = False
        self.connected = False
        self.subscriptions: Set[str] = set()  # "kline.{interval}.{symbol}"
        self._trade_subscriptions: Set[str] = set()  # "publicTrade.{symbol}"

        # Candle buffers: {symbol: {interval: CandleBuffer}}
        self.buffers: Dict[str, Dict[str, CandleBuffer]] = defaultdict(lambda: defaultdict(CandleBuffer))

        # Callbacks - support multiple listeners
        self._candle_close_callbacks: List[Callable[[str, str, Candle], None]] = []
        self._candle_update_callbacks: List[Callable[[str, str, Candle], None]] = []
        self._trade_callbacks: List[Callable[[str, Trade], None]] = []  # Trade callbacks
        self.on_connection_change: Optional[Callable[[bool], None]] = None

        # Legacy single callback support (for backwards compatibility)
        self._legacy_on_candle_close: Optional[Callable[[str, str, Candle], None]] = None
        self._legacy_on_trade: Optional[Callable[[str, Trade], None]] = None

        # Trade statistics (for debugging/verification)
        self._trade_count: int = 0
        self._trade_count_per_symbol: Dict[str, int] = defaultdict(int)
        self._last_trade_log_time: float = 0

        # Reconnection state
        self.reconnect_attempts = 0
        self.last_message_time = 0
        self._last_disconnect_time: float = 0  # Track when we disconnected for gap filling

        # Tasks
        self._ws_task: Optional[asyncio.Task] = None
        self._ping_task: Optional[asyncio.Task] = None

        logger.info("WebSocketManager initialized")

    @property
    def on_candle_close(self):
        """Legacy getter for backwards compatibility"""
        return self._legacy_on_candle_close

    @on_candle_close.setter
    def on_candle_close(self, callback):
        """
        Legacy setter - adds callback to the list if not already present.
        For backwards compatibility with services that set this property directly.
        """
        if callback is None:
            return
        # Remove any previous legacy callback
        if self._legacy_on_candle_close and self._legacy_on_candle_close in self._candle_close_callbacks:
            self._candle_close_callbacks.remove(self._legacy_on_candle_close)
        # Add new callback
        if callback not in self._candle_close_callbacks:
            self._candle_close_callbacks.append(callback)
        self._legacy_on_candle_close = callback
        logger.info(f"Candle close callback registered (total: {len(self._candle_close_callbacks)})")

    def add_candle_close_listener(self, callback: Callable[[str, str, Candle], None]):
        """Add a candle close listener (preferred method for multiple listeners)"""
        if callback not in self._candle_close_callbacks:
            self._candle_close_callbacks.append(callback)
            logger.info(f"Candle close listener added (total: {len(self._candle_close_callbacks)})")

    def remove_candle_close_listener(self, callback: Callable[[str, str, Candle], None]):
        """Remove a candle close listener"""
        if callback in self._candle_close_callbacks:
            self._candle_close_callbacks.remove(callback)
            logger.info(f"Candle close listener removed (total: {len(self._candle_close_callbacks)})")

    def add_trade_listener(self, callback: Callable[[str, 'Trade'], None]):
        """Add a trade listener callback"""
        if callback not in self._trade_callbacks:
            self._trade_callbacks.append(callback)
            logger.info(f"Trade listener added (total: {len(self._trade_callbacks)})")

    def remove_trade_listener(self, callback: Callable[[str, 'Trade'], None]):
        """Remove a trade listener callback"""
        if callback in self._trade_callbacks:
            self._trade_callbacks.remove(callback)
            logger.info(f"Trade listener removed (total: {len(self._trade_callbacks)})")

    @property
    def on_trade(self):
        """Legacy getter for backwards compatibility with trade callbacks"""
        return self._legacy_on_trade

    @on_trade.setter
    def on_trade(self, callback):
        """
        Legacy setter for trade callback - adds callback to the list if not already present.
        For backwards compatibility with services that set this property directly.

        The callback signature is: callback(symbol: str, trade: Trade)
        """
        if callback is None:
            return
        # Remove any previous legacy callback
        if self._legacy_on_trade and self._legacy_on_trade in self._trade_callbacks:
            self._trade_callbacks.remove(self._legacy_on_trade)
        # Add new callback
        if callback not in self._trade_callbacks:
            self._trade_callbacks.append(callback)
        self._legacy_on_trade = callback
        logger.info(f"Trade callback registered (total: {len(self._trade_callbacks)})")

    async def _notify_trade_listeners(self, symbol: str, trade: Trade):
        """
        Internal method to notify all trade listeners when a new trade arrives.
        Called from _handle_trade() after parsing the trade message.
        Supports both sync and async callbacks.
        """
        if not self._trade_callbacks:
            return

        for callback in self._trade_callbacks:
            try:
                result = callback(symbol, trade)
                # If callback is async, await it
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                logger.error(f"Error in trade callback: {e}")

    async def subscribe_trades(self, symbols: List[str]):
        """
        Subscribe to publicTrade stream for the given symbols.
        This allows receiving individual trade data for Order Flow analysis.

        Args:
            symbols: List of symbols to subscribe (e.g., ["BTCUSDT", "ETHUSDT"])
        """
        new_trade_subs = {f"publicTrade.{symbol}" for symbol in symbols}

        # Filter out already subscribed
        subs_to_add = new_trade_subs - self._trade_subscriptions

        if not subs_to_add:
            logger.info(f"[TRADES] All {len(new_trade_subs)} trade subscriptions already exist")
            return

        # Track subscriptions
        self._trade_subscriptions.update(subs_to_add)
        # Also add to main subscriptions set for reconnection
        self.subscriptions.update(subs_to_add)

        logger.info(f"[TRADES] Adding {len(subs_to_add)} trade subscriptions: {sorted(subs_to_add)}")

        # Wait for connection if not yet connected
        if not self.connected:
            logger.info(f"[TRADES] WebSocket not yet connected, waiting...")
            for i in range(20):  # 10 seconds max
                await asyncio.sleep(0.5)
                if self.connected:
                    logger.info(f"[TRADES] WebSocket connected after {(i+1)*0.5}s")
                    break
            else:
                logger.warning(f"[TRADES] Timeout waiting for connection, subscriptions will be sent on reconnect")
                return

        # Send subscribe message
        if self.connected and self.ws:
            try:
                subs_list = list(subs_to_add)
                batch_size = 10  # Bybit limit

                for i in range(0, len(subs_list), batch_size):
                    batch = subs_list[i:i + batch_size]
                    subscribe_msg = {
                        "op": "subscribe",
                        "args": batch
                    }
                    await self.ws.send(json.dumps(subscribe_msg))
                    logger.info(f"[TRADES] Subscribed to batch: {batch}")

                    if i + batch_size < len(subs_list):
                        await asyncio.sleep(0.1)

                logger.info(f"[TRADES] Total trade subscriptions: {len(self._trade_subscriptions)}")
            except Exception as e:
                logger.error(f"[TRADES] Failed to subscribe: {e}")

    async def start(self, symbols: List[str], intervals: List[str]):
        """
        Start WebSocket connection and subscribe to klines.

        Args:
            symbols: List of symbols (e.g., ["BTCUSDT", "ETHUSDT"])
            intervals: List of intervals (e.g., ["15", "60", "240"])
        """
        if self.running:
            logger.warning("WebSocketManager already running")
            return

        self.running = True
        self.subscriptions = {
            f"kline.{interval}.{symbol}"
            for symbol in symbols
            for interval in intervals
        }

        logger.info(f"Starting WebSocketManager with {len(self.subscriptions)} subscriptions")
        logger.info(f"Symbols: {symbols}")
        logger.info(f"Intervals: {intervals}")

        # Start WebSocket task
        self._ws_task = asyncio.create_task(self._run_websocket())

    async def add_subscriptions(self, symbols: List[str], intervals: List[str]):
        """
        Add new subscriptions to an already running WebSocket.
        Will wait up to 10 seconds for connection if not yet connected.

        Args:
            symbols: List of symbols to add
            intervals: List of intervals to add
        """
        new_subs = {
            f"kline.{interval}.{symbol}"
            for symbol in symbols
            for interval in intervals
        }

        # DEBUG: Log what we're trying to subscribe to
        logger.info(f"[WS_MANAGER] add_subscriptions called: symbols={symbols}, intervals={intervals}")
        logger.info(f"[WS_MANAGER] Requested subscriptions: {sorted(new_subs)}")
        logger.info(f"[WS_MANAGER] Existing subscriptions: {sorted(self.subscriptions)}")

        # Filter out already existing subscriptions
        subs_to_add = new_subs - self.subscriptions

        if not subs_to_add:
            logger.info(f"[WS_MANAGER] All {len(new_subs)} subscriptions already exist")
            return

        # Add to our tracking set FIRST (so reconnect will include them)
        self.subscriptions.update(subs_to_add)

        logger.info(f"[WS_MANAGER] Adding {len(subs_to_add)} new subscriptions: {sorted(subs_to_add)}")
        logger.info(f"[WS_MANAGER] Total subscriptions now: {len(self.subscriptions)}")

        # Wait for connection if not yet connected (up to 10 seconds)
        if not self.connected:
            logger.info(f"[WS_MANAGER] WebSocket not yet connected, waiting...")
            for i in range(20):  # 20 * 0.5s = 10 seconds max
                await asyncio.sleep(0.5)
                if self.connected:
                    logger.info(f"[WS_MANAGER] WebSocket connected after {(i+1)*0.5}s")
                    break
            else:
                logger.warning(f"[WS_MANAGER] Timeout waiting for connection, subscriptions will be sent on reconnect")
                return

        # Send subscribe message (Bybit limits to 10 args per subscribe request)
        if self.connected and self.ws:
            try:
                subs_list = list(subs_to_add)
                batch_size = 10  # Bybit WebSocket limit per subscribe request
                total_batches = (len(subs_list) + batch_size - 1) // batch_size

                logger.info(f"[WS_MANAGER] Sending {len(subs_list)} new subscriptions in {total_batches} batch(es)")

                for i in range(0, len(subs_list), batch_size):
                    batch = subs_list[i:i + batch_size]
                    subscribe_msg = {
                        "op": "subscribe",
                        "args": batch
                    }
                    await self.ws.send(json.dumps(subscribe_msg))
                    logger.info(f"[WS_MANAGER] Sent add_subscriptions batch {i // batch_size + 1}/{total_batches}: {batch}")

                    # Small delay between batches
                    if i + batch_size < len(subs_list):
                        await asyncio.sleep(0.1)

                logger.info(f"[WS_MANAGER] Sent subscribe request for {len(subs_to_add)} new channels")
            except Exception as e:
                logger.error(f"[WS_MANAGER] Failed to send subscribe request: {e}")

    async def stop(self):
        """Stop WebSocket connection and cleanup"""
        logger.info("Stopping WebSocketManager...")
        self.running = False

        if self._ping_task:
            self._ping_task.cancel()
            try:
                await self._ping_task
            except asyncio.CancelledError:
                pass

        if self.ws:
            await self.ws.close()

        if self._ws_task:
            self._ws_task.cancel()
            try:
                await self._ws_task
            except asyncio.CancelledError:
                pass

        self.connected = False
        logger.info("WebSocketManager stopped")

    async def _run_websocket(self):
        """Main WebSocket loop with reconnection logic"""
        while self.running:
            try:
                await self._connect_and_subscribe()
                await self._message_loop()
            except ConnectionClosed as e:
                logger.warning(f"WebSocket connection closed: {e}")
            except ConnectionClosedError as e:
                logger.warning(f"WebSocket connection closed with error: {e}")
            except Exception as e:
                logger.error(f"WebSocket error: {e}")

            if not self.running:
                break

            # Reconnection with exponential backoff
            self.connected = False
            self._last_disconnect_time = time.time()  # Track disconnect time for gap filling
            if self.on_connection_change:
                self.on_connection_change(False)

            delay = min(2 ** self.reconnect_attempts, self.MAX_RECONNECT_DELAY)
            self.reconnect_attempts += 1
            logger.info(f"Reconnecting in {delay} seconds (attempt {self.reconnect_attempts})...")
            await asyncio.sleep(delay)

        logger.info("WebSocket loop ended")

    async def _connect_and_subscribe(self):
        """Connect to Bybit and subscribe to channels"""
        logger.info(f"Connecting to {self.BYBIT_WS_URL}...")

        self.ws = await websockets.connect(
            self.BYBIT_WS_URL,
            ping_interval=None,  # We handle pings manually
            ping_timeout=None
        )

        self.connected = True
        self.reconnect_attempts = 0
        self.last_message_time = time.time()

        logger.info("Connected to Bybit WebSocket")

        if self.on_connection_change:
            self.on_connection_change(True)

        # Fill gaps if we were disconnected for a while
        if self._last_disconnect_time > 0:
            gap_duration = time.time() - self._last_disconnect_time
            if gap_duration > 60:  # Only fill if gap > 1 minute
                logger.info(f"[GAP_FILL] Detected gap of {gap_duration:.0f}s, filling missing candles...")
                asyncio.create_task(self._fill_gaps_after_reconnect())
            self._last_disconnect_time = 0

        # Subscribe to all channels (Bybit limits to 10 args per subscribe message)
        if self.subscriptions:
            subs_list = list(self.subscriptions)
            batch_size = 10  # Bybit WebSocket limit per subscribe request
            total_batches = (len(subs_list) + batch_size - 1) // batch_size

            logger.info(f"[WS_MANAGER] Subscribing to {len(subs_list)} channels in {total_batches} batch(es)")

            for i in range(0, len(subs_list), batch_size):
                batch = subs_list[i:i + batch_size]
                subscribe_msg = {
                    "op": "subscribe",
                    "args": batch
                }
                await self.ws.send(json.dumps(subscribe_msg))
                logger.info(f"[WS_MANAGER] Sent subscribe batch {i // batch_size + 1}/{total_batches}: {batch}")

                # Small delay between batches to avoid rate limiting
                if i + batch_size < len(subs_list):
                    await asyncio.sleep(0.1)

            logger.info(f"[WS_MANAGER] Subscribed to {len(self.subscriptions)} channels total")

        # Start ping task
        if self._ping_task:
            self._ping_task.cancel()
        self._ping_task = asyncio.create_task(self._ping_loop())

    async def _message_loop(self):
        """Process incoming WebSocket messages"""
        async for message in self.ws:
            self.last_message_time = time.time()

            try:
                data = json.loads(message)
                await self._handle_message(data)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse message: {e}")
            except Exception as e:
                logger.error(f"Error handling message: {e}")

    async def _handle_message(self, data: Dict):
        """Handle a single WebSocket message"""
        # Handle pong response
        if data.get("op") == "pong":
            return

        # Handle subscription confirmation
        if data.get("op") == "subscribe":
            if data.get("success"):
                # Log which subscriptions were confirmed
                conn_id = data.get("conn_id", "unknown")
                logger.info(f"[WS_SUBSCRIPTION] Confirmed: conn_id={conn_id}, data={data}")
            else:
                logger.error(f"[WS_SUBSCRIPTION] FAILED: {data.get('ret_msg')} - data={data}")
            return

        # Handle kline data
        topic = data.get("topic", "")
        if topic.startswith("kline."):
            await self._handle_kline(data)
        elif topic.startswith("publicTrade."):
            await self._handle_trade(data)

    async def _handle_kline(self, data: Dict):
        """Handle kline/candlestick data"""
        topic = data.get("topic", "")
        # topic format: "kline.{interval}.{symbol}"
        parts = topic.split(".")
        if len(parts) != 3:
            return

        _, interval, symbol = parts
        kline_data = data.get("data", [])

        # DEBUG: Log all kline data received (not just closes)
        # This helps verify which symbols are actually subscribed
        if kline_data:
            logger.debug(f"[WS_KLINE] Received: {symbol}/{interval} confirm={kline_data[0].get('confirm', False)}")

        for kline in kline_data:
            candle = Candle(
                timestamp=int(kline.get("start", 0)),
                open=float(kline.get("open", 0)),
                high=float(kline.get("high", 0)),
                low=float(kline.get("low", 0)),
                close=float(kline.get("close", 0)),
                volume=float(kline.get("volume", 0)),
                turnover=float(kline.get("turnover", 0)),
                confirm=kline.get("confirm", False)
            )

            # Add to buffer
            buffer = self.buffers[symbol][interval]
            is_new_closed = buffer.add_or_update(candle)

            # Trigger callbacks
            if self._candle_update_callbacks:
                for callback in self._candle_update_callbacks:
                    try:
                        callback(symbol, interval, candle)
                    except Exception as e:
                        logger.error(f"Error in candle update callback: {e}")

            if is_new_closed and self._candle_close_callbacks:
                logger.info(f"Candle closed: {symbol} {interval} @ {candle.close} (notifying {len(self._candle_close_callbacks)} listeners)")
                for callback in self._candle_close_callbacks:
                    try:
                        callback(symbol, interval, candle)
                    except Exception as e:
                        logger.error(f"Error in candle close callback: {e}")

    async def _handle_trade(self, data: Dict):
        """
        Handle publicTrade data from Bybit WebSocket.

        Bybit publicTrade message format:
        {
            "topic": "publicTrade.BTCUSDT",
            "type": "snapshot",
            "ts": 1672304486868,
            "data": [
                {
                    "T": 1672304486865,  # Trade timestamp (ms)
                    "s": "BTCUSDT",       # Symbol
                    "S": "Buy",           # Side: "Buy" or "Sell"
                    "v": "0.001",         # Volume/size
                    "p": "95000.50",      # Price
                    "L": "PlusTick",      # Tick direction
                    "i": "trade-id",      # Trade ID
                    "BT": false           # Block trade flag
                }
            ]
        }
        """
        topic = data.get("topic", "")
        # topic format: "publicTrade.{symbol}"
        parts = topic.split(".")
        if len(parts) != 2:
            return

        symbol = parts[1]
        trades_data = data.get("data", [])

        if not trades_data:
            return

        for trade_data in trades_data:
            try:
                # Parse trade from Bybit format
                trade = Trade(
                    timestamp=int(trade_data.get("T", 0)),
                    symbol=trade_data.get("s", symbol),
                    side=trade_data.get("S", "Buy"),  # "Buy" or "Sell"
                    price=float(trade_data.get("p", 0)),
                    size=float(trade_data.get("v", 0)),
                    trade_id=str(trade_data.get("i", ""))
                )

                # Update trade counters
                self._trade_count += 1
                self._trade_count_per_symbol[symbol] += 1

                # Log trades periodically (every 5 seconds) to avoid spam
                now = time.time()
                if now - self._last_trade_log_time >= 5.0:
                    logger.info(f"[TRADE] {symbol}: {trade.side} {trade.size} @ {trade.price} (total: {self._trade_count})")
                    self._last_trade_log_time = now
                else:
                    logger.debug(f"[TRADE] {symbol}: {trade.side} {trade.size} @ {trade.price}")

                # Notify all trade listeners
                await self._notify_trade_listeners(symbol, trade)

            except Exception as e:
                logger.error(f"[TRADE] Error parsing trade: {e}, data={trade_data}")

    async def _ping_loop(self):
        """Send periodic pings to keep connection alive"""
        while self.running and self.connected:
            try:
                await asyncio.sleep(self.PING_INTERVAL)

                if self.ws and self.connected:
                    ping_msg = {"op": "ping"}
                    await self.ws.send(json.dumps(ping_msg))
                    logger.debug("Ping sent")

                    # Check for stale connection (no messages in 60 seconds)
                    if time.time() - self.last_message_time > 60:
                        logger.warning("Connection seems stale, reconnecting...")
                        await self.ws.close()
                        break
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Ping error: {e}")
                break

    async def _fill_gaps_after_reconnect(self):
        """
        Fill gaps in candle buffers after WebSocket reconnection.
        Fetches missing candles from Bybit REST API for each symbol/interval.
        """
        if httpx is None:
            logger.warning("[GAP_FILL] httpx not available, cannot fill gaps")
            return

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                for symbol, intervals in self.buffers.items():
                    for interval, buffer in intervals.items():
                        if len(buffer.candles) == 0:
                            continue

                        # Find the last candle timestamp
                        last_candle = buffer.get_last_closed_candle()
                        if not last_candle:
                            continue

                        last_ts = last_candle.timestamp
                        now_ts = int(time.time() * 1000)

                        # Calculate how many candles we might be missing
                        interval_ms = self._interval_to_ms(interval)
                        if interval_ms == 0:
                            continue

                        gap_candles = (now_ts - last_ts) // interval_ms
                        if gap_candles <= 1:
                            continue  # No significant gap

                        logger.info(f"[GAP_FILL] {symbol}/{interval}: Last candle at {last_ts}, missing ~{gap_candles} candles")

                        # Fetch missing candles from REST API
                        try:
                            url = "https://api.bybit.com/v5/market/kline"
                            params = {
                                "category": "linear",
                                "symbol": symbol,
                                "interval": interval,
                                "start": last_ts + interval_ms,  # Start after last known candle
                                "limit": min(gap_candles + 5, 200)  # Fetch a bit extra
                            }

                            response = await client.get(url, params=params)
                            data = response.json()

                            if data.get("retCode") == 0 and data.get("result", {}).get("list"):
                                klines = data["result"]["list"]
                                filled_count = 0

                                for kline in klines:
                                    # Bybit returns [timestamp, open, high, low, close, volume, turnover]
                                    candle = Candle(
                                        timestamp=int(kline[0]),
                                        open=float(kline[1]),
                                        high=float(kline[2]),
                                        low=float(kline[3]),
                                        close=float(kline[4]),
                                        volume=float(kline[5]),
                                        turnover=float(kline[6]) if len(kline) > 6 else 0,
                                        confirm=True  # Historical candles are confirmed
                                    )

                                    # Only add if newer than last known candle
                                    if candle.timestamp > last_ts:
                                        buffer.add_or_update(candle)
                                        filled_count += 1

                                if filled_count > 0:
                                    logger.info(f"[GAP_FILL] {symbol}/{interval}: Filled {filled_count} missing candles")

                        except Exception as e:
                            logger.error(f"[GAP_FILL] Error fetching {symbol}/{interval}: {e}")

        except Exception as e:
            logger.error(f"[GAP_FILL] Error in gap filling: {e}")

    def _interval_to_ms(self, interval: str) -> int:
        """Convert interval string to milliseconds"""
        interval_map = {
            "1": 60 * 1000,
            "3": 3 * 60 * 1000,
            "5": 5 * 60 * 1000,
            "15": 15 * 60 * 1000,
            "30": 30 * 60 * 1000,
            "60": 60 * 60 * 1000,
            "120": 2 * 60 * 60 * 1000,
            "240": 4 * 60 * 60 * 1000,
            "360": 6 * 60 * 60 * 1000,
            "720": 12 * 60 * 60 * 1000,
            "D": 24 * 60 * 60 * 1000,
            "W": 7 * 24 * 60 * 60 * 1000,
        }
        return interval_map.get(interval, 0)

    def get_candles(self, symbol: str, interval: str, limit: int = None) -> List[Dict]:
        """Get buffered candles for a symbol/interval"""
        return self.buffers[symbol][interval].get_candles(limit)

    def preload_historical(self, symbol: str, interval: str, candles_data: List[Dict]):
        """
        Preload historical candles into the buffer.
        Called at startup to ensure enough data for pattern detection.

        Args:
            symbol: Trading pair symbol (e.g., "BTCUSDT")
            interval: Timeframe (e.g., "1", "60")
            candles_data: List of candle dicts with keys: timestamp, open, high, low, close, volume
        """
        historical_candles = []
        for c in candles_data:
            candle = Candle(
                timestamp=int(c.get('timestamp', 0)),
                open=float(c.get('open', 0)),
                high=float(c.get('high', 0)),
                low=float(c.get('low', 0)),
                close=float(c.get('close', 0)),
                volume=float(c.get('volume', 0)),
                turnover=float(c.get('turnover', 0)),
                confirm=True  # Historical candles are always confirmed
            )
            historical_candles.append(candle)

        buffer = self.buffers[symbol][interval]
        buffer.preload_candles(historical_candles)
        logger.info(f"[PRELOAD] {symbol}/{interval}: Preloaded {len(historical_candles)} historical candles")

    def get_buffer_stats(self) -> Dict:
        """Get statistics about all buffers"""
        stats = {}
        for symbol, intervals in self.buffers.items():
            stats[symbol] = {}
            for interval, buffer in intervals.items():
                stats[symbol][interval] = {
                    'candle_count': len(buffer.candles),
                    'last_update': buffer.last_update,
                    'last_closed': buffer.get_last_closed_candle().to_dict() if buffer.get_last_closed_candle() else None
                }
        return stats

    def get_trade_stats(self) -> Dict:
        """Get trade reception statistics for debugging"""
        return {
            'total_trades': self._trade_count,
            'trades_per_symbol': dict(self._trade_count_per_symbol),
            'trade_subscriptions': list(self._trade_subscriptions)
        }

    def is_connected(self) -> bool:
        """Check if WebSocket is connected"""
        return self.connected and self.ws is not None

    async def update_subscriptions(self, symbols: List[str], intervals: List[str]):
        """
        Update WebSocket subscriptions dynamically.
        Unsubscribes from old channels and subscribes to new ones.

        Args:
            symbols: New list of symbols to monitor
            intervals: New list of intervals to monitor
        """
        if not self.ws or not self.connected:
            logger.warning("Cannot update subscriptions: WebSocket not connected")
            return False

        new_subscriptions = {
            f"kline.{interval}.{symbol}"
            for symbol in symbols
            for interval in intervals
        }

        # Calculate channels to unsubscribe and subscribe
        to_unsubscribe = self.subscriptions - new_subscriptions
        to_subscribe = new_subscriptions - self.subscriptions

        logger.info(f"[WS] Updating subscriptions: -{len(to_unsubscribe)} +{len(to_subscribe)}")

        try:
            # Unsubscribe from old channels
            if to_unsubscribe:
                unsubscribe_msg = {
                    "op": "unsubscribe",
                    "args": list(to_unsubscribe)
                }
                await self.ws.send(json.dumps(unsubscribe_msg))
                logger.info(f"[WS] Unsubscribed from {len(to_unsubscribe)} channels: {to_unsubscribe}")

            # Subscribe to new channels
            if to_subscribe:
                subscribe_msg = {
                    "op": "subscribe",
                    "args": list(to_subscribe)
                }
                await self.ws.send(json.dumps(subscribe_msg))
                logger.info(f"[WS] Subscribed to {len(to_subscribe)} channels: {to_subscribe}")

            # Update internal state
            self.subscriptions = new_subscriptions
            logger.info(f"[WS] Now monitoring {len(self.subscriptions)} channels")
            return True

        except Exception as e:
            logger.error(f"[WS] Error updating subscriptions: {e}")
            return False

    def get_current_subscriptions(self) -> Dict:
        """Get current subscription info"""
        return {
            'count': len(self.subscriptions),
            'channels': list(self.subscriptions),
            'connected': self.connected
        }


# Singleton instance
_manager_instance: Optional[WebSocketManager] = None


def get_websocket_manager() -> WebSocketManager:
    """Get or create the singleton WebSocketManager instance"""
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = WebSocketManager()
    return _manager_instance
