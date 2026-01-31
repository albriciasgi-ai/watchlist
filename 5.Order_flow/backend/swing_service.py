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
from vwap_service import get_vwap_service

logger = logging.getLogger(__name__)

# ============================================================================
# LIMITS: Maximum days allowed by timeframe (must match frontend/backend)
# ============================================================================
MAX_DAYS_BY_INTERVAL = {
    "1": 5,       # 1 min -> max 5 days (7,200 candles)
    "3": 10,      # 3 min -> max 10 days
    "5": 30,      # 5 min -> max 30 days (8,640 candles)
    "15": 90,     # 15 min -> max 90 days (8,640 candles)
    "30": 150,    # 30 min -> max 150 days
    "60": 360,    # 1 hour -> max 360 days (8,640 candles)
    "120": 180,   # 2 hours -> max 180 days
    "240": 720,   # 4 hours -> max 720 days (4,320 candles)
    "D": 1440,    # 1 day -> max 1440 days
    "W": 730,     # 1 week -> max 730 days
}

# Absolute safety limit to prevent runaway processing
MAX_CANDLES_ABSOLUTE = 10000


def validate_days_for_interval(days: int, interval: str) -> int:
    """
    Validate and cap days to the maximum allowed for the given interval.

    Args:
        days: Requested number of days
        interval: Timeframe string (e.g., "1", "5", "60", "D")

    Returns:
        Validated days (capped to max if exceeded)
    """
    max_days = MAX_DAYS_BY_INTERVAL.get(interval, 30)
    if days > max_days:
        logger.warning(
            f"[SWING_SERVICE] Days {days} exceeds max {max_days} for interval {interval}, "
            f"truncating to {max_days}"
        )
        return max_days
    return days


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

    # Alerts enabled - controls whether alerts are sent to Trading Bot
    # Default is False - user must explicitly enable alerts per symbol
    alertsEnabled: bool = False

    # Price zones (legacy - now zones should have 'symbol' field)
    priceZones: List[Dict] = field(default_factory=list)
    useDrawingZones: bool = True

    # Default volume filter
    volumeFilter: Dict = field(default_factory=lambda: {
        "enabled": True,
        "minZScore": 1.5,
        "lookbackBars": 20
    })

    # VWAP filter - validates signals against VWAP bands
    vwapFilter: Dict = field(default_factory=lambda: {
        "enabled": False,
        "deviations": [1, 2, 3],  # Which deviations to check (1σ, 2σ, 3σ)
        "marginPercent": 20,  # % margin relative to the deviation band width
        "skipVolumeInRectangle": False  # If true, skip volume filter when inside a rectangle
    })

    # Cooldown
    cooldownMinutes: int = 30

    # Alert target
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"

    def get_symbol_config(self, symbol: str, interval: str = None) -> Dict:
        """
        Get configuration for a specific symbol, merging with defaults.
        Symbol-specific settings override defaults.
        Days are automatically validated against MAX_DAYS_BY_INTERVAL.

        Args:
            symbol: The trading symbol (e.g., "BTCUSDT")
            interval: Optional interval to validate days against. If not provided,
                     uses self.interval from the service config.
        """
        # Use provided interval or fall back to config interval
        effective_interval = interval or self.interval

        # Start with defaults
        config = {
            'enabled': self.enabled,
            'alertsEnabled': self.alertsEnabled,  # Global alerts setting as default
            'days': self.days,  # Include days in config
            'swingBars': self.swingBars,
            'direction': self.direction,
            'volumeFilter': self.volumeFilter.copy(),
            'vwapFilter': self.vwapFilter.copy(),
            'priceZones': [z for z in self.priceZones if not z.get('symbol') or z.get('symbol') == symbol],
            'useDrawingZones': self.useDrawingZones,
            'cooldownMinutes': self.cooldownMinutes,
        }

        # Override with symbol-specific config if exists
        if symbol in self.symbolConfigs:
            symbol_cfg = self.symbolConfigs[symbol]
            if 'enabled' in symbol_cfg:
                config['enabled'] = symbol_cfg['enabled']
            if 'alertsEnabled' in symbol_cfg:
                config['alertsEnabled'] = symbol_cfg['alertsEnabled']
            if 'days' in symbol_cfg:
                config['days'] = symbol_cfg['days']
            if 'swingBars' in symbol_cfg:
                config['swingBars'] = symbol_cfg['swingBars']
            if 'direction' in symbol_cfg:
                config['direction'] = symbol_cfg['direction']
            if 'volumeFilter' in symbol_cfg:
                config['volumeFilter'] = {**config['volumeFilter'], **symbol_cfg['volumeFilter']}
            if 'vwapFilter' in symbol_cfg:
                config['vwapFilter'] = {**config['vwapFilter'], **symbol_cfg['vwapFilter']}
            if 'priceZones' in symbol_cfg:
                # Symbol-specific zones override (but also include global zones for this symbol)
                config['priceZones'] = symbol_cfg['priceZones']

        # CRITICAL: Validate days against MAX_DAYS_BY_INTERVAL
        config['days'] = validate_days_for_interval(config['days'], effective_interval)

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
        self._max_signals_per_symbol = 300  # Balanced: enough for multi-day, not too heavy on memory

        # Stats
        self.stats = {
            'signals_detected': 0,
            'alerts_sent': 0,
            'alerts_blocked_cooldown': 0,
            'alerts_blocked_historical': 0,
            'start_time': 0
        }

        # HTTP client for alerts
        self._http_client: Optional[httpx.AsyncClient] = None

        # Service start time for filtering historical signals (prevents alerts on load)
        self._service_start_time: float = 0
        self._grace_period_seconds: int = 60  # Ignore signals older than this after service start
        self._warmup_period_seconds: int = 120  # Block ALL alerts for this many seconds after start

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
        self._service_start_time = time.time()  # For filtering historical signals

        logger.info(
            f"[SWING_SERVICE] Started with {self._warmup_period_seconds}s warmup period "
            f"(alerts blocked until warmup completes)"
        )

        # Create HTTP client
        self._http_client = httpx.AsyncClient(timeout=15.0)

        # Register candle close callback (sync wrapper for async handler)
        # Use add_candle_close_listener to avoid overwriting other callbacks
        self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)

        # Start WebSocket if not already running
        if not self.ws_manager.running:
            logger.info(f"[SWING_SERVICE] WebSocket NOT running, starting with {len(self.config.symbols)} symbols")
            await self.ws_manager.start(
                self.config.symbols,
                [self.config.interval]
            )
        else:
            # WebSocket already running - ALWAYS add our subscriptions
            # This ensures our symbols/intervals are subscribed even if WS started with different ones
            logger.info(f"[SWING_SERVICE] WebSocket already running, adding subscriptions for {len(self.config.symbols)} symbols")
            logger.info(f"[SWING_SERVICE] Symbols to subscribe: {self.config.symbols}")
            logger.info(f"[SWING_SERVICE] Interval to subscribe: {self.config.interval}")
            await self.ws_manager.add_subscriptions(
                self.config.symbols,
                [self.config.interval]
            )
            # Verify subscriptions were added
            current_subs = self.ws_manager.get_current_subscriptions()
            logger.info(f"[SWING_SERVICE] After add_subscriptions: {current_subs['count']} total subscriptions")

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

    async def _analyze_historical(self, delay_seconds: float = 0.5):
        """
        Analyze historical candles for all symbols to populate signals for display.
        Does NOT send alerts - only stores signals for frontend visualization.
        Loads extended history from Bybit API if WebSocket buffer is insufficient.

        Args:
            delay_seconds: Wait time before analysis to ensure WebSocket has data
        """
        # Wait for WebSocket to have data (reduced from 2s to 0.5s)
        if delay_seconds > 0:
            logger.info(f"[SWING_SERVICE] Waiting {delay_seconds}s for WebSocket data...")
            await asyncio.sleep(delay_seconds)

        logger.info("[SWING_SERVICE] Analyzing historical data...")

        # 🚀 OPTIMIZACION: Analizar simbolos en paralelo
        async def analyze_symbol(symbol):
            try:
                # Get symbol-specific config (includes days override AND validation)
                symbol_config = self.config.get_symbol_config(symbol, self.config.interval)
                symbol_days = symbol_config.get('days', self.config.days)

                # Calculate how many candles based on symbol's VALIDATED days setting
                desired_candles = calculate_candles_for_days(self.config.interval, symbol_days)

                # SAFETY: Apply absolute candle limit
                if desired_candles > MAX_CANDLES_ABSOLUTE:
                    logger.warning(
                        f"[SWING_SERVICE] {symbol}: Candles {desired_candles} exceeds absolute limit "
                        f"{MAX_CANDLES_ABSOLUTE}, truncating"
                    )
                    desired_candles = MAX_CANDLES_ABSOLUTE

                logger.info(f"[SWING_SERVICE] {symbol}: Days={symbol_days}, Interval={self.config.interval} -> {desired_candles} candles")

                # Get candles from WebSocket buffer first
                candles = self.ws_manager.get_candles(symbol, self.config.interval)
                logger.info(f"[SWING_SERVICE] {symbol}: WebSocket buffer has {len(candles)} candles")

                # If not enough candles, load more from Bybit API
                if len(candles) < desired_candles:
                    logger.info(f"[SWING_SERVICE] {symbol}: Loading extended history from API...")
                    candles = await self._fetch_historical_candles(symbol, desired_candles)

                    # IMPORTANT: Preload fetched candles to WebSocket buffer
                    # This ensures real-time detection has enough data from the start
                    if candles:
                        self.ws_manager.preload_historical(symbol, self.config.interval, candles)
                        logger.info(f"[SWING_SERVICE] {symbol}: Preloaded {len(candles)} candles to WebSocket buffer")

                if len(candles) < 20:
                    logger.warning(f"[SWING_SERVICE] {symbol}: Not enough historical candles ({len(candles)})")
                    return  # Exit this symbol's analysis

                logger.info(f"[SWING_SERVICE] {symbol}: Analyzing {len(candles)} candles...")

                # symbol_config already obtained above (includes days override)

                # Get VWAP data if VWAP filter is enabled
                vwap_data = None
                if symbol_config.get('vwapFilter', {}).get('enabled', False):
                    try:
                        vwap_service = get_vwap_service()
                        vwap_data = vwap_service.get_vwap_data(symbol)
                        logger.info(f"[SWING_SERVICE] {symbol}: Got {len(vwap_data)} VWAP points for filtering")
                    except Exception as e:
                        logger.warning(f"[SWING_SERVICE] {symbol}: Could not get VWAP data: {e}")

                signals = self.detector.detect(
                    symbol=symbol,
                    interval=self.config.interval,
                    candles=candles,
                    config=symbol_config,
                    vwap_data=vwap_data
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

        # 🚀 Run all symbol analyses in parallel
        await asyncio.gather(*[analyze_symbol(symbol) for symbol in self.config.symbols])

        logger.info(f"[SWING_SERVICE] Historical analysis complete. Total signals: {self.stats['signals_detected']}")

    async def _fetch_historical_candles(self, symbol: str, limit: int = 1000) -> List[Dict]:
        """
        Fetch historical candles from Bybit API.
        Bybit max limit is 200 per request, so we make multiple parallel requests.

        Respects MAX_DAYS_BY_INTERVAL and MAX_CANDLES_ABSOLUTE limits.
        Max candles by timeframe (based on MAX_DAYS_BY_INTERVAL):
        - 1m/5 days = 7,200 candles
        - 5m/30 days = 8,640 candles
        - 15m/90 days = 8,640 candles
        - 60m/360 days = 8,640 candles
        - 4h/720 days = 4,320 candles
        - D/1440 days = 1,440 candles
        """
        # SAFETY: Apply absolute candle limit
        if limit > MAX_CANDLES_ABSOLUTE:
            logger.warning(
                f"[SWING_SERVICE] {symbol}: Fetch limit {limit} exceeds MAX_CANDLES_ABSOLUTE "
                f"{MAX_CANDLES_ABSOLUTE}, truncating"
            )
            limit = MAX_CANDLES_ABSOLUTE

        logger.info(f"[SWING_SERVICE] {symbol}: Fetching {limit} candles from API...")

        # Calculate time ranges for parallel fetches
        # Handle daily/weekly intervals differently
        interval_str = self.config.interval
        if interval_str == "D":
            interval_ms = 24 * 60 * 60 * 1000  # 1 day in ms
        elif interval_str == "W":
            interval_ms = 7 * 24 * 60 * 60 * 1000  # 1 week in ms
        else:
            interval_ms = int(interval_str) * 60 * 1000  # interval in ms
        now = int(time.time() * 1000)

        # Build list of time ranges to fetch (each batch of 200 candles)
        batches = []
        remaining = limit
        end_time = now

        while remaining > 0:
            batch_size = min(200, remaining)
            batches.append({'end': end_time, 'limit': batch_size})
            end_time = end_time - (batch_size * interval_ms)
            remaining -= batch_size

        all_candles = []

        async def fetch_batch(client, batch):
            """Fetch a single batch of candles"""
            url = (
                f"https://api.bybit.com/v5/market/kline?"
                f"category=linear&symbol={symbol}&interval={self.config.interval}"
                f"&limit={batch['limit']}&end={batch['end']}"
            )
            try:
                response = await client.get(url)
                data = response.json()

                if data.get("retCode") != 0:
                    return []

                raw_candles = data.get("result", {}).get("list", [])
                return [
                    {
                        'timestamp': int(c[0]),
                        'open': float(c[1]),
                        'high': float(c[2]),
                        'low': float(c[3]),
                        'close': float(c[4]),
                        'volume': float(c[5]),
                        'turnover': float(c[6]) if len(c) > 6 else 0
                    }
                    for c in raw_candles
                ]
            except Exception as e:
                logger.error(f"[SWING_SERVICE] Error fetching batch: {e}")
                return []

        # Fetch all batches in parallel (max 10 concurrent to balance speed vs rate limiting)
        # 10 concurrent = 2000 candles per group, so 8640 candles = 5 groups = ~1 second
        async with httpx.AsyncClient(timeout=60) as client:
            # Process in groups of 10 to avoid rate limiting while being faster
            for i in range(0, len(batches), 10):
                batch_group = batches[i:i+10]
                results = await asyncio.gather(*[
                    fetch_batch(client, batch) for batch in batch_group
                ])
                for candles in results:
                    all_candles.extend(candles)

                # Small delay between groups to respect API rate limits
                if i + 10 < len(batches):
                    await asyncio.sleep(0.15)

        # Remove duplicates and sort by timestamp ascending
        seen = set()
        unique_candles = []
        for c in all_candles:
            if c['timestamp'] not in seen:
                seen.add(c['timestamp'])
                unique_candles.append(c)

        unique_candles.sort(key=lambda c: c['timestamp'])

        logger.info(f"[SWING_SERVICE] {symbol}: Fetched {len(unique_candles)} candles from API (parallel)")
        return unique_candles

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Called when a candle closes. Candle can be a Candle object or dict."""
        # DEBUG: Log ALL candle close events to see what's arriving
        close_price = candle.close if hasattr(candle, 'close') else candle.get('close', 0)
        candle_timestamp = candle.timestamp if hasattr(candle, 'timestamp') else candle.get('timestamp', 0)

        # Log BEFORE any filtering
        logger.debug(f"[SWING_SERVICE] RAW candle close: {symbol} {interval}m @ {close_price}")

        if not self.running or not self.config.enabled:
            logger.debug(f"[SWING_SERVICE] {symbol}: Skipped - service not running or disabled")
            return

        if symbol not in self.config.symbols:
            logger.debug(f"[SWING_SERVICE] {symbol}: Skipped - not in monitored symbols list")
            return

        if interval != self.config.interval:
            logger.debug(f"[SWING_SERVICE] {symbol}: Skipped - interval {interval} != config interval {self.config.interval}")
            return

        # Made it through filters - log as INFO
        logger.info(f"[SWING_SERVICE] Candle closed: {symbol} {interval}m @ {close_price} (ts={candle_timestamp})")

        # Get candles from buffer
        candles = self.ws_manager.get_candles(symbol, interval)

        if len(candles) < 20:
            logger.debug(f"[SWING_SERVICE] {symbol}: Not enough candles ({len(candles)})")
            return

        # Run detection with symbol-specific config
        try:
            symbol_config = self.config.get_symbol_config(symbol)

            # Get VWAP data if VWAP filter is enabled
            vwap_data = None
            if symbol_config.get('vwapFilter', {}).get('enabled', False):
                try:
                    vwap_service = get_vwap_service()
                    vwap_data = vwap_service.get_vwap_data(symbol)
                except Exception as e:
                    logger.warning(f"[SWING_SERVICE] {symbol}: Could not get VWAP data for realtime: {e}")

            signals = self.detector.detect(
                symbol=symbol,
                interval=interval,
                candles=candles,
                config=symbol_config,
                vwap_data=vwap_data
            )

            # DEBUG: Log detection results
            swing_bars = symbol_config.get('swingBars', self.config.swingBars)
            logger.info(f"[SWING_SERVICE] {symbol}: Detection complete - found {len(signals)} total signals, swingBars={swing_bars}")

            if signals:
                # IMPORTANT: Only process the signal from the NEWEST confirmed swing
                # A swing at position -N needs N more candles after it to be confirmed
                # So the most recent CONFIRMABLE swing is at position -(swingBars+1) from end
                # We only want to alert on swings that were JUST confirmed by this candle close

                # The swing that was JUST confirmed is at index -(swingBars+1)
                # Its timestamp should match the candle at that position
                if len(candles) > swing_bars:
                    # Get the timestamp of the candle that could have just been confirmed as a swing
                    just_confirmed_idx = -(swing_bars + 1)
                    just_confirmed_candle = candles[just_confirmed_idx]
                    just_confirmed_ts = just_confirmed_candle.timestamp if hasattr(just_confirmed_candle, 'timestamp') else just_confirmed_candle.get('timestamp', 0)

                    # DEBUG: Log what we're checking
                    logger.info(f"[SWING_SERVICE] {symbol}: Checking for signal at ts={just_confirmed_ts} (idx={just_confirmed_idx})")

                    # Filter to only signals matching this specific timestamp
                    new_signals = [s for s in signals if s.timestamp == just_confirmed_ts]

                    if new_signals:
                        logger.info(f"[SWING_SERVICE] {symbol}: {len(new_signals)} newly confirmed signal(s) at ts={just_confirmed_ts}")
                        self.stats['signals_detected'] += len(new_signals)

                        for signal in new_signals:
                            await self._process_signal(signal)
                    else:
                        # DEBUG: Log the timestamps of ALL signals found
                        signal_timestamps = [s.timestamp for s in signals[-5:]]  # Last 5
                        logger.debug(f"[SWING_SERVICE] {symbol}: No new swings confirmed (checked ts={just_confirmed_ts}, recent signals at: {signal_timestamps})")
            else:
                logger.debug(f"[SWING_SERVICE] {symbol}: No signals found in {len(candles)} candles")

        except Exception as e:
            logger.error(f"[SWING_SERVICE] Detection error for {symbol}: {e}")

    async def _process_signal(self, signal: SwingSignal):
        """Process a detected signal - check cooldown and send alert"""
        # Use symbol + direction for cooldown (separate cooldowns for LONG and SHORT)
        cooldown_key = f"{signal.symbol}_{signal.direction}"
        now = time.time()

        # Check 0: Warmup period - block ALL alerts for N seconds after service start
        # This prevents any alerts during initial historical analysis
        time_since_start = now - self._service_start_time
        if time_since_start < self._warmup_period_seconds:
            remaining = self._warmup_period_seconds - time_since_start
            logger.debug(
                f"[SWING_SERVICE] {signal.symbol}: Signal blocked - warmup period "
                f"({remaining:.0f}s remaining)"
            )
            alert_logger.info(
                f"BLOCKED_WARMUP | {signal.symbol} | {signal.signal_type} | "
                f"price={signal.price:.2f} | warmup_remaining={remaining:.0f}s"
            )
            self.stats['alerts_blocked_historical'] += 1
            return

        # Check 1: Skip historical signals (grace period after service start)
        # This prevents alerts from being sent for signals detected in historical analysis
        signal_time_seconds = signal.timestamp / 1000
        if signal_time_seconds < (self._service_start_time - self._grace_period_seconds):
            logger.debug(
                f"[SWING_SERVICE] {signal.symbol}: Signal blocked - historical "
                f"(signal: {signal_time_seconds:.0f}, service start: {self._service_start_time:.0f})"
            )
            alert_logger.info(
                f"BLOCKED_HISTORICAL | {signal.symbol} | {signal.signal_type} | "
                f"price={signal.price:.2f} | signal_ts={signal_time_seconds:.0f} | "
                f"service_start={self._service_start_time:.0f}"
            )
            self.stats['alerts_blocked_historical'] += 1
            return

        # Log signal detection
        alert_logger.info(
            f"SIGNAL_DETECTED | {signal.symbol} | {signal.signal_type} | "
            f"price={signal.price:.2f} | direction={signal.direction} | "
            f"volume_zscore={signal.volume_zscore:.2f} | interval={signal.interval}"
        )

        # Check 2: Cooldown
        last_alert = self._cooldowns.get(cooldown_key, 0)
        cooldown_seconds = self.config.cooldownMinutes * 60
        # 'now' already defined at start of method

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
        # Check if alerts are enabled for this symbol
        # First check symbol-specific config, then fall back to global config
        symbol_config = self.config.get_symbol_config(signal.symbol)
        alerts_enabled = symbol_config.get('alertsEnabled', self.config.alertsEnabled)

        if not alerts_enabled:
            logger.debug(f"[SWING_SERVICE] Alerts disabled for {signal.symbol}, skipping {signal.signal_type}")
            alert_logger.info(
                f"BLOCKED_ALERTS_DISABLED | {signal.symbol} | {signal.signal_type} | "
                f"price={signal.price:.2f}"
            )
            return False

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
            # Detectar si cambiaron interval o days para re-analizar
            old_interval = self.config.interval
            old_days = self.config.days

            # Update config fields
            for key, value in new_config.items():
                if hasattr(self.config, key):
                    setattr(self.config, key, value)

            self._save_config()
            logger.info(f"[SWING_SERVICE] Config updated: {new_config.keys()}")

            # Si cambió interval o days, re-analizar datos históricos
            needs_reanalyze = (
                'interval' in new_config and new_config['interval'] != old_interval or
                'days' in new_config and new_config['days'] != old_days
            )

            if needs_reanalyze:
                logger.info(f"[SWING_SERVICE] Interval/days changed, triggering re-analysis...")
                import asyncio
                asyncio.create_task(self.reanalyze_historical())

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
            'alertsEnabled': self.config.alertsEnabled,
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
