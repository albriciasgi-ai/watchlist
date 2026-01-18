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

        # Candle buffers: {symbol: {interval: CandleBuffer}}
        self.buffers: Dict[str, Dict[str, CandleBuffer]] = defaultdict(lambda: defaultdict(CandleBuffer))

        # Callbacks - support multiple listeners
        self._candle_close_callbacks: List[Callable[[str, str, Candle], None]] = []
        self._candle_update_callbacks: List[Callable[[str, str, Candle], None]] = []
        self.on_connection_change: Optional[Callable[[bool], None]] = None

        # Legacy single callback support (for backwards compatibility)
        self._legacy_on_candle_close: Optional[Callable[[str, str, Candle], None]] = None

        # Reconnection state
        self.reconnect_attempts = 0
        self.last_message_time = 0

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

        # Subscribe to all channels
        if self.subscriptions:
            subscribe_msg = {
                "op": "subscribe",
                "args": list(self.subscriptions)
            }
            await self.ws.send(json.dumps(subscribe_msg))
            logger.info(f"Subscribed to {len(self.subscriptions)} channels")

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
                logger.debug("Subscription confirmed")
            else:
                logger.error(f"Subscription failed: {data.get('ret_msg')}")
            return

        # Handle kline data
        topic = data.get("topic", "")
        if topic.startswith("kline."):
            await self._handle_kline(data)

    async def _handle_kline(self, data: Dict):
        """Handle kline/candlestick data"""
        topic = data.get("topic", "")
        # topic format: "kline.{interval}.{symbol}"
        parts = topic.split(".")
        if len(parts) != 3:
            return

        _, interval, symbol = parts
        kline_data = data.get("data", [])

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
