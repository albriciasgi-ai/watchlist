"""
SWING_SERVICE - Real-time swing detection service

Integrates SwingDetector with WebSocket candle feeds and alert sending.

Author: Claude Code
Date: 2026-01-17
"""

import asyncio
import time
import logging
import json
import httpx
from typing import Dict, List, Optional
from dataclasses import dataclass, field, asdict
from pathlib import Path

from swing_detector import SwingDetector, SwingSignal, get_swing_detector
from websocket_manager import WebSocketManager, get_websocket_manager

logger = logging.getLogger(__name__)

# Config file path
CONFIG_DIR = Path(__file__).parent / "config"
CONFIG_FILE = CONFIG_DIR / "swing_config.json"
SIGNALS_FILE = CONFIG_DIR / "swing_signals.json"

# Dedicated alert log file
ALERT_LOG_FILE = Path(__file__).parent / "logs" / "swing_alerts.log"


def setup_alert_logger():
    """Setup dedicated file logger for swing alerts"""
    alert_logger = logging.getLogger("swing_alerts")
    alert_logger.setLevel(logging.INFO)

    # Avoid duplicate handlers
    if alert_logger.handlers:
        return alert_logger

    # Create logs directory
    ALERT_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    # File handler with rotation-friendly naming
    file_handler = logging.FileHandler(ALERT_LOG_FILE, encoding='utf-8')
    file_handler.setLevel(logging.INFO)

    # Format: timestamp | level | message
    formatter = logging.Formatter(
        '%(asctime)s | %(levelname)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(formatter)
    alert_logger.addHandler(file_handler)

    return alert_logger


# Initialize alert logger
alert_logger = setup_alert_logger()


@dataclass
class SwingServiceConfig:
    """Configuration for the swing detection service"""
    enabled: bool = True
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"])
    interval: str = "1"
    days: int = 1  # Days of historical data to analyze

    # Per-symbol configurations (overrides defaults)
    symbolConfigs: Dict[str, Dict] = field(default_factory=dict)

    # Default swing detection params (used if symbol has no specific config)
    swingBars: int = 5
    direction: str = "BOTH"  # LONG, SHORT, BOTH

    # Price zones (legacy - now zones should have 'symbol' field)
    priceZones: List[Dict] = field(default_factory=list)
    useDrawingZones: bool = True

    # Default volume filter
    volumeFilter: Dict = field(default_factory=lambda: {
        "enabled": True,
        "minZScore": 1.5,
        "lookbackBars": 20
    })

    # Cooldown
    cooldownMinutes: int = 30

    # Alert target
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"

    def get_symbol_config(self, symbol: str) -> Dict:
        """
        Get configuration for a specific symbol, merging with defaults.
        Symbol-specific settings override defaults.
        """
        # Start with defaults
        config = {
            'enabled': self.enabled,
            'swingBars': self.swingBars,
            'direction': self.direction,
            'volumeFilter': self.volumeFilter.copy(),
            'priceZones': [z for z in self.priceZones if not z.get('symbol') or z.get('symbol') == symbol],
            'useDrawingZones': self.useDrawingZones,
            'cooldownMinutes': self.cooldownMinutes,
        }

        # Override with symbol-specific config if exists
        if symbol in self.symbolConfigs:
            symbol_cfg = self.symbolConfigs[symbol]
            if 'enabled' in symbol_cfg:
                config['enabled'] = symbol_cfg['enabled']
            if 'swingBars' in symbol_cfg:
                config['swingBars'] = symbol_cfg['swingBars']
            if 'direction' in symbol_cfg:
                config['direction'] = symbol_cfg['direction']
            if 'volumeFilter' in symbol_cfg:
                config['volumeFilter'] = {**config['volumeFilter'], **symbol_cfg['volumeFilter']}
            if 'priceZones' in symbol_cfg:
                # Symbol-specific zones override (but also include global zones for this symbol)
                config['priceZones'] = symbol_cfg['priceZones']

        return config


def calculate_candles_for_days(interval: str, days: int) -> int:
    """
    Calculate how many candles are needed for the given number of days.

    Args:
        interval: Timeframe string (e.g., "1", "5", "15", "60", "240", "D")
        days: Number of days

    Returns:
        Number of candles needed
    """
    # Minutes per candle based on interval
    interval_minutes = {
        "1": 1,
        "3": 3,
        "5": 5,
        "15": 15,
        "30": 30,
        "60": 60,
        "120": 120,
        "240": 240,
        "360": 360,
        "720": 720,
        "D": 1440,
        "W": 10080,
    }

    minutes_per_candle = interval_minutes.get(interval, 1)
    minutes_per_day = 24 * 60
    total_minutes = days * minutes_per_day

    return total_minutes // minutes_per_candle


class SwingService:
    """
    Real-time swing detection service.

    - Listens to WebSocket candle closes
    - Runs SwingDetector on each close
    - Sends alerts to Trading Bot
    - Stores signals for frontend display
    """

    def __init__(self):
        self.detector = get_swing_detector()
        self.ws_manager = get_websocket_manager()
        self.config = SwingServiceConfig()
        self.running = False

        # Cooldown tracking: {symbol_interval: last_alert_timestamp}
        self._cooldowns: Dict[str, float] = {}

        # Recent signals for frontend: {symbol: [signals]}
        self._recent_signals: Dict[str, List[Dict]] = {}
        self._max_signals_per_symbol = 50

        # Stats
        self.stats = {
            'signals_detected': 0,
            'alerts_sent': 0,
            'alerts_blocked_cooldown': 0,
            'start_time': 0
        }

        # HTTP client for alerts
        self._http_client: Optional[httpx.AsyncClient] = None

        # Load saved config
        self._load_config()

        logger.info("[SWING_SERVICE] Initialized")

    def _load_config(self):
        """Load config from file if exists"""
        try:
            if CONFIG_FILE.exists():
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    self.config = SwingServiceConfig(**data)
                    logger.info(f"[SWING_SERVICE] Loaded config: {len(self.config.symbols)} symbols")
        except Exception as e:
            logger.warning(f"[SWING_SERVICE] Could not load config: {e}")

    def _save_config(self):
        """Save config to file"""
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump(asdict(self.config), f, indent=2)
            logger.info("[SWING_SERVICE] Config saved")
        except Exception as e:
            logger.error(f"[SWING_SERVICE] Could not save config: {e}")

    def _sync_candle_close_handler(self, symbol: str, interval: str, candle):
        """
        Synchronous wrapper for the async candle close handler.
        WebSocketManager calls this synchronously, we schedule the async work.
        """
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._on_candle_close(symbol, interval, candle))
        except RuntimeError:
            # No running loop, try to get or create one
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._on_candle_close(symbol, interval, candle))
            except Exception as e:
                logger.error(f"[SWING_SERVICE] Could not schedule candle handler: {e}")

    async def start(self):
        """Start the swing detection service"""
        if self.running:
            logger.warning("[SWING_SERVICE] Already running")
            return

        self.running = True
        self.stats['start_time'] = time.time()

        # Create HTTP client
        self._http_client = httpx.AsyncClient(timeout=15.0)

        # Register candle close callback (sync wrapper for async handler)
        # Use add_candle_close_listener to avoid overwriting other callbacks
        self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)

        # Start WebSocket if not already running
        if not self.ws_manager.is_connected():
            await self.ws_manager.start(
                self.config.symbols,
                [self.config.interval]
            )

        logger.info(f"[SWING_SERVICE] Started - monitoring {self.config.symbols} @ {self.config.interval}m")

        # Analyze historical data for display (don't send alerts for historical)
        await self._analyze_historical()

    async def stop(self):
        """Stop the service"""
        self.running = False

        # Remove our callback from the websocket manager
        self.ws_manager.remove_candle_close_listener(self._sync_candle_close_handler)

        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("[SWING_SERVICE] Stopped")

    async def _analyze_historical(self, delay_seconds: float = 2.0):
        """
        Analyze historical candles for all symbols to populate signals for display.
        Does NOT send alerts - only stores signals for frontend visualization.
        Loads extended history from Bybit API if WebSocket buffer is insufficient.

        Args:
            delay_seconds: Wait time before analysis to ensure WebSocket has data
        """
        # Wait for WebSocket to have data
        if delay_seconds > 0:
            logger.info(f"[SWING_SERVICE] Waiting {delay_seconds}s for WebSocket data...")
            await asyncio.sleep(delay_seconds)

        logger.info("[SWING_SERVICE] Analyzing historical data...")

        # Calculate how many candles based on user's days setting
        desired_candles = calculate_candles_for_days(self.config.interval, self.config.days)
        logger.info(f"[SWING_SERVICE] Days={self.config.days}, Interval={self.config.interval} -> {desired_candles} candles")

        for symbol in self.config.symbols:
            try:
                # Get candles from WebSocket buffer first
                candles = self.ws_manager.get_candles(symbol, self.config.interval)
                logger.info(f"[SWING_SERVICE] {symbol}: WebSocket buffer has {len(candles)} candles")

                # If not enough candles, load more from Bybit API
                if len(candles) < desired_candles:
                    logger.info(f"[SWING_SERVICE] {symbol}: Loading extended history from API...")
                    candles = await self._fetch_historical_candles(symbol, desired_candles)

                if len(candles) < 20:
                    logger.warning(f"[SWING_SERVICE] {symbol}: Not enough historical candles ({len(candles)})")
                    continue

                logger.info(f"[SWING_SERVICE] {symbol}: Analyzing {len(candles)} candles...")

                # Run detection on historical data with symbol-specific config
                symbol_config = self.config.get_symbol_config(symbol)
                signals = self.detector.detect(
                    symbol=symbol,
                    interval=self.config.interval,
                    candles=candles,
                    config=symbol_config
                )

                if signals:
                    logger.info(f"[SWING_SERVICE] {symbol}: Found {len(signals)} historical signals")

                    # Store signals for frontend display (without sending alerts)
                    for signal in signals:
                        self._store_signal(signal)

                    self.stats['signals_detected'] += len(signals)
                else:
                    logger.info(f"[SWING_SERVICE] {symbol}: No historical signals found")

            except Exception as e:
                logger.error(f"[SWING_SERVICE] Error analyzing historical data for {symbol}: {e}")

        logger.info(f"[SWING_SERVICE] Historical analysis complete. Total signals: {self.stats['signals_detected']}")

    async def _fetch_historical_candles(self, symbol: str, limit: int = 1000) -> List[Dict]:
        """
        Fetch historical candles from Bybit API.
        Bybit max limit is 200 per request, so we make multiple requests if needed.
        """
        all_candles = []
        remaining = limit
        end_time = None  # Start from now

        async with httpx.AsyncClient(timeout=30) as client:
            while remaining > 0:
                batch_size = min(200, remaining)

                url = (
                    f"https://api.bybit.com/v5/market/kline?"
                    f"category=linear&symbol={symbol}&interval={self.config.interval}"
                    f"&limit={batch_size}"
                )

                if end_time:
                    url += f"&end={end_time}"

                try:
                    response = await client.get(url)
                    data = response.json()

                    if data.get("retCode") != 0:
                        logger.error(f"[SWING_SERVICE] API error for {symbol}: {data.get('retMsg')}")
                        break

                    raw_candles = data.get("result", {}).get("list", [])

                    if not raw_candles:
                        break

                    # Convert Bybit format to our format
                    # Bybit returns: [startTime, open, high, low, close, volume, turnover]
                    for c in raw_candles:
                        all_candles.append({
                            'timestamp': int(c[0]),
                            'open': float(c[1]),
                            'high': float(c[2]),
                            'low': float(c[3]),
                            'close': float(c[4]),
                            'volume': float(c[5]),
                            'turnover': float(c[6]) if len(c) > 6 else 0
                        })

                    # Get the oldest timestamp for next request
                    oldest_ts = min(int(c[0]) for c in raw_candles)
                    end_time = oldest_ts - 1  # Go back before the oldest candle

                    remaining -= len(raw_candles)

                    # Small delay to avoid rate limiting
                    await asyncio.sleep(0.1)

                except Exception as e:
                    logger.error(f"[SWING_SERVICE] Error fetching candles: {e}")
                    break

        # Sort by timestamp ascending (oldest first)
        all_candles.sort(key=lambda c: c['timestamp'])

        logger.info(f"[SWING_SERVICE] {symbol}: Fetched {len(all_candles)} candles from API")
        return all_candles

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Called when a candle closes. Candle can be a Candle object or dict."""
        if not self.running or not self.config.enabled:
            return

        if symbol not in self.config.symbols:
            return

        if interval != self.config.interval:
            return

        # Handle both Candle object and dict
        close_price = candle.close if hasattr(candle, 'close') else candle.get('close', 0)
        candle_timestamp = candle.timestamp if hasattr(candle, 'timestamp') else candle.get('timestamp', 0)
        logger.info(f"[SWING_SERVICE] Candle closed: {symbol} {interval}m @ {close_price} (ts={candle_timestamp})")

        # Get candles from buffer
        candles = self.ws_manager.get_candles(symbol, interval)

        if len(candles) < 20:
            logger.debug(f"[SWING_SERVICE] {symbol}: Not enough candles ({len(candles)})")
            return

        # Run detection with symbol-specific config
        try:
            symbol_config = self.config.get_symbol_config(symbol)
            signals = self.detector.detect(
                symbol=symbol,
                interval=interval,
                candles=candles,
                config=symbol_config
            )

            if signals:
                # IMPORTANT: Only process the signal from the NEWEST confirmed swing
                # A swing at position -N needs N more candles after it to be confirmed
                # So the most recent CONFIRMABLE swing is at position -(swingBars+1) from end
                # We only want to alert on swings that were JUST confirmed by this candle close

                swing_bars = self.config.swingBars

                # The swing that was JUST confirmed is at index -(swingBars+1)
                # Its timestamp should match the candle at that position
                if len(candles) > swing_bars:
                    # Get the timestamp of the candle that could have just been confirmed as a swing
                    just_confirmed_idx = -(swing_bars + 1)
                    just_confirmed_candle = candles[just_confirmed_idx]
                    just_confirmed_ts = just_confirmed_candle.timestamp if hasattr(just_confirmed_candle, 'timestamp') else just_confirmed_candle.get('timestamp', 0)

                    # Filter to only signals matching this specific timestamp
                    new_signals = [s for s in signals if s.timestamp == just_confirmed_ts]

                    if new_signals:
                        logger.info(f"[SWING_SERVICE] {symbol}: {len(new_signals)} newly confirmed signal(s) at ts={just_confirmed_ts}")
                        self.stats['signals_detected'] += len(new_signals)

                        for signal in new_signals:
                            await self._process_signal(signal)
                    else:
                        logger.debug(f"[SWING_SERVICE] {symbol}: No new swings confirmed (checked ts={just_confirmed_ts})")

        except Exception as e:
            logger.error(f"[SWING_SERVICE] Detection error for {symbol}: {e}")

    async def _process_signal(self, signal: SwingSignal):
        """Process a detected signal - check cooldown and send alert"""
        # Use symbol + direction for cooldown (separate cooldowns for LONG and SHORT)
        cooldown_key = f"{signal.symbol}_{signal.direction}"

        # Log signal detection
        alert_logger.info(
            f"SIGNAL_DETECTED | {signal.symbol} | {signal.signal_type} | "
            f"price={signal.price:.2f} | direction={signal.direction} | "
            f"volume_zscore={signal.volume_zscore:.2f} | interval={signal.interval}"
        )

        # Check cooldown
        last_alert = self._cooldowns.get(cooldown_key, 0)
        cooldown_seconds = self.config.cooldownMinutes * 60
        now = time.time()

        if now - last_alert < cooldown_seconds:
            remaining = cooldown_seconds - (now - last_alert)
            logger.info(
                f"[SWING_SERVICE] {signal.symbol}: Signal blocked by cooldown "
                f"({remaining:.0f}s remaining)"
            )
            alert_logger.info(
                f"BLOCKED_COOLDOWN | {signal.symbol} | {signal.signal_type} | "
                f"remaining={remaining:.0f}s"
            )
            self.stats['alerts_blocked_cooldown'] += 1
            return

        # Store signal for frontend
        self._store_signal(signal)

        # Send alert to Trading Bot
        success = await self._send_alert(signal)

        if success:
            self._cooldowns[cooldown_key] = now
            self.stats['alerts_sent'] += 1
            logger.info(
                f"[SWING_SERVICE] ✅ Alert sent: {signal.symbol} {signal.signal_type} "
                f"@ ${signal.price:.2f} ({signal.direction})"
            )
            alert_logger.info(
                f"ALERT_SENT | {signal.symbol} | {signal.signal_type} | "
                f"price={signal.price:.2f} | direction={signal.direction} | "
                f"target={self.config.alertTargetUrl}"
            )

    def _store_signal(self, signal: SwingSignal):
        """Store signal for frontend display"""
        symbol = signal.symbol

        if symbol not in self._recent_signals:
            self._recent_signals[symbol] = []

        signal_dict = {
            'type': signal.signal_type,
            'timestamp': signal.timestamp,
            'price': signal.price,
            'volumeZScore': signal.volume_zscore,
            'direction': signal.direction,
            'interval': signal.interval,
            'detectedAt': int(time.time() * 1000)
        }

        self._recent_signals[symbol].append(signal_dict)

        # Trim old signals
        if len(self._recent_signals[symbol]) > self._max_signals_per_symbol:
            self._recent_signals[symbol] = self._recent_signals[symbol][-self._max_signals_per_symbol:]

    async def _send_alert(self, signal: SwingSignal) -> bool:
        """Send alert to Trading Bot"""
        if not self._http_client:
            logger.error("[SWING_SERVICE] HTTP client not initialized")
            return False

        payload = {
            "source": "SWING_DETECTOR",
            "symbol": signal.symbol,
            "interval": signal.interval,
            "pattern": {
                "patternType": signal.signal_type,
                "price": signal.price,
                "confidence": min(100, 50 + signal.volume_zscore * 20),  # z-score to confidence
                "timestamp": signal.timestamp,
                "direction": signal.direction,
                "volumeZScore": signal.volume_zscore
            }
        }

        try:
            response = await self._http_client.post(
                self.config.alertTargetUrl,
                json=payload
            )

            if response.status_code == 200:
                return True
            else:
                logger.warning(
                    f"[SWING_SERVICE] Alert failed: HTTP {response.status_code}"
                )
                alert_logger.error(
                    f"ALERT_FAILED | {signal.symbol} | HTTP {response.status_code} | "
                    f"url={self.config.alertTargetUrl}"
                )
                return False

        except httpx.TimeoutException:
            logger.error("[SWING_SERVICE] Alert timeout - Trading Bot not responding")
            alert_logger.error(
                f"ALERT_TIMEOUT | {signal.symbol} | Trading Bot not responding | "
                f"url={self.config.alertTargetUrl}"
            )
            return False
        except Exception as e:
            logger.error(f"[SWING_SERVICE] Alert error: {e}")
            alert_logger.error(f"ALERT_ERROR | {signal.symbol} | {str(e)}")
            return False

    def update_config(self, new_config: Dict) -> bool:
        """Update service configuration"""
        try:
            # Update config fields
            for key, value in new_config.items():
                if hasattr(self.config, key):
                    setattr(self.config, key, value)

            self._save_config()
            logger.info(f"[SWING_SERVICE] Config updated: {new_config.keys()}")
            return True

        except Exception as e:
            logger.error(f"[SWING_SERVICE] Config update error: {e}")
            return False

    def get_signals(self, symbol: str, since_timestamp: int = None) -> List[Dict]:
        """Get recent signals for a symbol"""
        signals = self._recent_signals.get(symbol, [])

        if since_timestamp:
            signals = [s for s in signals if s.get('timestamp', 0) > since_timestamp]

        return signals

    async def reanalyze_historical(self):
        """
        Clear existing signals and re-analyze historical data.
        Called when config changes to refresh signals with new parameters.
        """
        logger.info("[SWING_SERVICE] Re-analyzing historical data with new config...")

        # Clear existing signals
        self._recent_signals = {}
        self.stats['signals_detected'] = 0

        # Re-analyze without delay (data is already loaded)
        await self._analyze_historical(delay_seconds=0)

    def get_status(self, symbol: str = None) -> Dict:
        """
        Get service status.
        If symbol is provided, returns merged config for that symbol.
        """
        uptime = time.time() - self.stats['start_time'] if self.stats['start_time'] > 0 else 0

        status = {
            'running': self.running,
            'enabled': self.config.enabled,
            'symbols': self.config.symbols,
            'interval': self.config.interval,
            'days': self.config.days,
            # Default values (for backwards compatibility)
            'direction': self.config.direction,
            'swingBars': self.config.swingBars,
            'volumeFilter': self.config.volumeFilter,
            'priceZones': self.config.priceZones,  # All zones
            'priceZonesCount': len(self.config.priceZones),
            'cooldownMinutes': self.config.cooldownMinutes,
            # Per-symbol configs
            'symbolConfigs': self.config.symbolConfigs,
            'uptime_seconds': int(uptime),
            'stats': self.stats,
            'cooldowns': {k: int(time.time() - v) for k, v in self._cooldowns.items()}
        }

        # If symbol provided, also include the merged config for that symbol
        if symbol:
            status['symbolConfig'] = self.config.get_symbol_config(symbol)

        return status

    def clear_cooldowns(self):
        """Clear all cooldowns (for testing)"""
        self._cooldowns = {}
        logger.info("[SWING_SERVICE] Cooldowns cleared")


# Singleton instance
_service_instance: Optional[SwingService] = None


def get_swing_service() -> SwingService:
    """Get or create the singleton SwingService instance"""
    global _service_instance
    if _service_instance is None:
        _service_instance = SwingService()
    return _service_instance
