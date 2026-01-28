"""
Real-time Pattern Detection Service

Orchestrates pattern detection using:
- WebSocketManager for real-time candle data
- ConfigStore for synchronized configurations
- PatternStateManager for cooldown/deduplication
- Existing detectors (rejection_detector, double_topbottom_detector)
- AlertSender for sending alerts

Author: Claude Code
Date: 2025-01-16
"""

import asyncio
import time
import logging
import hashlib
import json
import httpx
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

from websocket_manager import WebSocketManager, Candle, get_websocket_manager
from config_store import ConfigStore, get_config_store
from pattern_state_manager import PatternStateManager, AlertRecord, get_pattern_state_manager
from rejection_detector import RejectionDetector
from double_topbottom_detector import DoubleTopBottomDetector
from alert_sender import AlertSender, alert_sender as _alert_sender_instance

logger = logging.getLogger(__name__)


@dataclass
class DetectionResult:
    """Result of pattern detection"""
    symbol: str
    interval: str
    indicator_type: str
    patterns: List[Dict]
    timestamp: int
    candle_count: int


class RealtimePatternService:
    """
    Main service that coordinates real-time pattern detection.

    Flow:
    1. WebSocketManager receives candle close event
    2. Service retrieves config from ConfigStore
    3. Service runs appropriate detector
    4. Service applies filters (cooldown, deduplication, VWAP, S/R)
    5. Service sends alerts via AlertSender

    The service uses the same detection logic as the frontend but runs
    independently in the backend.
    """

    # Default symbols and intervals to monitor
    DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT"]
    DEFAULT_INTERVALS = ["1", "5", "15", "30", "60", "240", "D"]  # 1m, 5m, 15m, 30m, 1h, 4h, 1D

    def __init__(self):
        self.ws_manager: WebSocketManager = get_websocket_manager()
        self.config_store: ConfigStore = get_config_store()
        self.state_manager: PatternStateManager = get_pattern_state_manager()
        self.alert_sender: AlertSender = _alert_sender_instance

        # Detectors
        self.rejection_detector = RejectionDetector()
        self.dbt_detector = DoubleTopBottomDetector()

        # Service state
        self.running = False
        self.symbols: List[str] = []
        self.intervals: List[str] = []

        # Statistics
        self.stats = {
            'candles_processed': 0,
            'patterns_detected': 0,
            'alerts_sent': 0,
            'alerts_blocked_cooldown': 0,
            'alerts_blocked_duplicate': 0,
            'alerts_blocked_rate_limit': 0,
            'alerts_blocked_too_old': 0,
            'start_time': 0
        }

        # Rate limiting state
        self._last_alert_time: float = 0  # Timestamp of last sent alert
        self._service_start_time: float = 0  # When service started (for skipHistoricalOnLoad)
        self._rate_limit_config = {
            'enabled': True,
            'minIntervalSeconds': 5,
            'maxPatternAgeMinutes': 2,
            'skipHistoricalOnLoad': True
        }

        # ✅ Storage for detected patterns - frontend will query this to display
        # Structure: {symbol: {interval: {indicator: [patterns]}}}
        self._detected_patterns: Dict[str, Dict[str, Dict[str, List[Dict]]]] = {}
        self._patterns_lock = asyncio.Lock()
        self._max_patterns_per_symbol = 100  # Keep last 100 patterns per symbol/interval/indicator

        # Cleanup task
        self._cleanup_task: Optional[asyncio.Task] = None

        # ✅ OPTIMIZACIÓN: Rastrear tasks activas para cancelación limpia
        self._active_tasks: set = set()

        logger.info("RealtimePatternService initialized")

    async def start(self, symbols: List[str] = None, intervals: List[str] = None):
        """
        Start the real-time pattern detection service.

        Args:
            symbols: List of symbols to monitor (default: BTCUSDT, ETHUSDT)
            intervals: List of intervals to monitor (default: 15m, 1h, 4h)
        """
        if self.running:
            logger.warning("Service already running")
            return

        self.symbols = symbols or self.DEFAULT_SYMBOLS
        self.intervals = intervals or self.DEFAULT_INTERVALS
        self.running = True
        self.stats['start_time'] = time.time()
        self._service_start_time = time.time()  # Track service start for skipHistoricalOnLoad

        logger.info(f"Starting RealtimePatternService")
        logger.info(f"Symbols: {self.symbols}")
        logger.info(f"Intervals: {self.intervals}")

        # Set up callbacks
        self.ws_manager.on_candle_close = self._on_candle_close
        self.ws_manager.on_connection_change = self._on_connection_change

        # ✅ OPTIMIZACIÓN: Iniciar WebSocket INMEDIATAMENTE, cargar histórico en background
        # Esto permite que el servicio responda rápido mientras se carga el histórico
        await self.ws_manager.start(self.symbols, self.intervals)
        logger.info("WebSocket started, loading historical data in background...")

        # ✅ Cargar histórico en background (no-bloqueante)
        preload_task = asyncio.create_task(self._preload_historical_candles())
        self._active_tasks.add(preload_task)
        preload_task.add_done_callback(self._active_tasks.discard)

        # Start cleanup task
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

        logger.info("RealtimePatternService started successfully (historical data loading in background)")

    async def _preload_historical_candles(self):
        """
        Pre-load historical candles for all symbol/interval combinations.
        This ensures pattern detection works immediately after service start.
        """
        logger.info("[PRELOAD] Starting historical candle preload...")

        # We need at least 100 candles for reliable pattern detection
        # For 1-minute candles, load last 200 candles (about 3.3 hours)
        candles_to_load = 200

        async with httpx.AsyncClient(timeout=30) as client:
            for symbol in self.symbols:
                for interval in self.intervals:
                    try:
                        # Calculate how much data to request
                        # Bybit API returns candles in descending order (newest first)
                        url = (
                            "https://api.bybit.com/v5/market/kline?"
                            f"category=linear&symbol={symbol}&interval={interval}"
                            f"&limit={candles_to_load}"
                        )

                        logger.info(f"[PRELOAD] Fetching {candles_to_load} candles for {symbol}/{interval}...")
                        response = await client.get(url)
                        data = response.json()

                        if data.get("retCode") != 0:
                            logger.error(f"[PRELOAD] API error for {symbol}/{interval}: {data.get('retMsg')}")
                            continue

                        result = data.get("result", {})
                        raw_candles = result.get("list", [])

                        if not raw_candles:
                            logger.warning(f"[PRELOAD] No candles returned for {symbol}/{interval}")
                            continue

                        # Convert Bybit format to our format
                        # Bybit returns: [startTime, open, high, low, close, volume, turnover]
                        candles_data = []
                        for c in raw_candles:
                            candles_data.append({
                                'timestamp': int(c[0]),
                                'open': float(c[1]),
                                'high': float(c[2]),
                                'low': float(c[3]),
                                'close': float(c[4]),
                                'volume': float(c[5]),
                                'turnover': float(c[6]) if len(c) > 6 else 0
                            })

                        # Preload into WebSocket buffer
                        self.ws_manager.preload_historical(symbol, interval, candles_data)
                        logger.info(f"[PRELOAD] ✅ {symbol}/{interval}: Loaded {len(candles_data)} candles")

                    except Exception as e:
                        logger.error(f"[PRELOAD] Error loading {symbol}/{interval}: {e}")

        logger.info("[PRELOAD] Historical candle preload complete")

    async def stop(self):
        """Stop the service"""
        logger.info("Stopping RealtimePatternService...")
        self.running = False

        # Stop cleanup task
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # ✅ OPTIMIZACIÓN: Cancelar todas las tasks de detección activas
        if self._active_tasks:
            logger.info(f"Cancelling {len(self._active_tasks)} active detection tasks...")
            for task in list(self._active_tasks):
                if not task.done():
                    task.cancel()
            # Esperar que todas terminen
            if self._active_tasks:
                await asyncio.gather(*self._active_tasks, return_exceptions=True)
            self._active_tasks.clear()

        # Stop WebSocket manager
        await self.ws_manager.stop()

        # Save config store
        self.config_store.save()

        logger.info("RealtimePatternService stopped")

    def _on_connection_change(self, connected: bool):
        """Handle WebSocket connection state changes"""
        status = "connected" if connected else "disconnected"
        logger.info(f"WebSocket {status}")

    def _on_candle_close(self, symbol: str, interval: str, candle: Candle):
        """
        Handle candle close event - this is where detection happens.
        Called by WebSocketManager when a candle closes.
        """
        self.stats['candles_processed'] += 1

        logger.info(f"Candle closed: {symbol} {interval}m @ {candle.close:.2f}")

        # ✅ OPTIMIZACIÓN: Rastrear task para cancelación limpia en shutdown
        task = asyncio.create_task(self._detect_patterns(symbol, interval, candle))
        self._active_tasks.add(task)
        task.add_done_callback(self._active_tasks.discard)

        # ✅ Evaluate pending trades against this candle
        asyncio.create_task(self._evaluate_pending_trades(symbol, interval, candle))

    def _check_rate_limit(self, symbol: str, interval: str, indicator_type: str,
                          pattern_timestamp: int, config: Dict) -> tuple[bool, str]:
        """
        Check if an alert should be rate limited.

        Args:
            symbol: Trading pair symbol
            interval: Timeframe
            indicator_type: 'doubleTopBottom' or 'rejection'
            pattern_timestamp: Timestamp of the pattern (in milliseconds)
            config: Indicator configuration with rateLimiting settings

        Returns:
            Tuple of (can_send, reason) - can_send is True if alert should be sent
        """
        # Get rate limiting config from indicator config, fallback to defaults
        rate_limit = config.get('rateLimiting', self._rate_limit_config)

        if not rate_limit.get('enabled', True):
            return True, "rate_limiting_disabled"

        current_time = time.time()
        min_interval_seconds = rate_limit.get('minIntervalSeconds', 5)
        max_pattern_age_minutes = rate_limit.get('maxPatternAgeMinutes', 2)
        skip_historical = rate_limit.get('skipHistoricalOnLoad', True)

        # Convert pattern timestamp from ms to seconds
        pattern_time_seconds = pattern_timestamp / 1000

        # Check 1: Skip historical patterns on service load
        if skip_historical:
            # If pattern is from before service started, skip it
            # Add 30 second grace period for patterns detected shortly after service start
            grace_period = 30
            if pattern_time_seconds < (self._service_start_time - grace_period):
                self.stats['alerts_blocked_too_old'] += 1
                logger.info(f"[RATE LIMIT] {symbol}/{interval}: Skipping historical pattern "
                           f"(pattern: {pattern_time_seconds:.0f}, service start: {self._service_start_time:.0f})")
                return False, "historical_pattern_skipped"

        # Check 2: Pattern age - only alert patterns from last X minutes
        pattern_age_seconds = current_time - pattern_time_seconds
        max_age_seconds = max_pattern_age_minutes * 60

        if pattern_age_seconds > max_age_seconds:
            self.stats['alerts_blocked_too_old'] += 1
            logger.info(f"[RATE LIMIT] {symbol}/{interval}: Pattern too old "
                       f"({pattern_age_seconds:.0f}s > {max_age_seconds}s max)")
            return False, "pattern_too_old"

        # Check 3: Minimum interval between alerts (debounce)
        time_since_last_alert = current_time - self._last_alert_time

        if time_since_last_alert < min_interval_seconds:
            self.stats['alerts_blocked_rate_limit'] += 1
            logger.info(f"[RATE LIMIT] {symbol}/{interval}: Rate limited "
                       f"({time_since_last_alert:.1f}s < {min_interval_seconds}s min)")
            return False, "rate_limited"

        return True, "passed"

    def _update_rate_limit_config(self, indicator_type: str, config: Dict):
        """
        Update rate limit config from indicator configuration.
        Called when config is synchronized from frontend.
        """
        rate_limit = config.get('rateLimiting')
        if rate_limit:
            self._rate_limit_config = rate_limit
            logger.debug(f"[RATE LIMIT] Updated config for {indicator_type}: {rate_limit}")

    async def _detect_patterns(self, symbol: str, interval: str, closed_candle: Candle):
        """
        Run pattern detection for a symbol/interval after candle close.
        """
        try:
            # Get all candles from buffer
            candles = self.ws_manager.get_candles(symbol, interval)

            if len(candles) < 50:
                logger.warning(f"[REALTIME] {symbol}/{interval}: Not enough candles ({len(candles)}), need at least 50")
                return

            logger.info(f"[REALTIME] {symbol}/{interval}: Running detection with {len(candles)} candles")

            # Detect Double Top/Bottom patterns
            await self._detect_dbt_patterns(symbol, interval, candles)

            # Detect Rejection patterns
            await self._detect_rejection_patterns(symbol, interval, candles)

        except Exception as e:
            logger.error(f"Error detecting patterns for {symbol}/{interval}: {e}")

    async def _detect_dbt_patterns(self, symbol: str, interval: str, candles: List[Dict]):
        """Detect Double Top/Bottom patterns"""
        indicator_type = 'doubleTopBottom'

        # Get config from store
        config = self.config_store.get_config(symbol, interval, indicator_type)

        if not config:
            logger.debug(f"{symbol}/{interval}: No DBT config synced, using defaults")
            config = self._get_default_dbt_config()

        # Check if alerts are enabled
        if not config.get('alertsEnabled', False):
            return

        # Get calculated levels
        levels = self.config_store.get_levels(symbol, interval, indicator_type)

        # Run detector
        try:
            patterns = self.dbt_detector.detect_patterns(
                symbol=symbol,
                candles=candles,
                config=config,
                interval=interval,
                days=30  # Default
            )

            if patterns:
                logger.info(f"[REALTIME] {symbol}/{interval}: Detected {len(patterns)} DBT patterns")
                self.stats['patterns_detected'] += len(patterns)

                # Store ALL detected patterns for frontend display
                for pattern in patterns:
                    # Convert pattern to dict for storage
                    pattern_dict = {
                        'type': pattern.get('type') if isinstance(pattern, dict) else getattr(pattern, 'type', 'UNKNOWN'),
                        'timestamp': pattern.get('timestamp') if isinstance(pattern, dict) else getattr(pattern, 'timestamp', 0),
                        'levelPrice': pattern.get('levelPrice') if isinstance(pattern, dict) else getattr(pattern, 'levelPrice', 0),
                        'confidence': pattern.get('confidence') if isinstance(pattern, dict) else getattr(pattern, 'confidence', 0),
                        'firstExtreme': pattern.get('firstExtreme') if isinstance(pattern, dict) else getattr(pattern, 'firstExtreme', {}),
                        'secondExtreme': pattern.get('secondExtreme') if isinstance(pattern, dict) else getattr(pattern, 'secondExtreme', {}),
                        'priceTolerance': pattern.get('priceTolerance') if isinstance(pattern, dict) else getattr(pattern, 'priceTolerance', 0),
                        'detectedAt': int(time.time() * 1000)
                    }
                    await self.store_detected_pattern(symbol, interval, 'doubleTopBottom', pattern_dict)

                    # Process for alerting (may be filtered by cooldown, rate limit, etc.)
                    await self._process_dbt_pattern(symbol, interval, pattern, config, levels, candles)

        except Exception as e:
            logger.error(f"DBT detection error for {symbol}/{interval}: {e}")

    async def _detect_rejection_patterns(self, symbol: str, interval: str, candles: List[Dict]):
        """Detect Rejection patterns"""
        indicator_type = 'rejection'

        # Get config from store
        config = self.config_store.get_config(symbol, interval, indicator_type)

        if not config:
            logger.debug(f"{symbol}/{interval}: No Rejection config synced, using defaults")
            config = self._get_default_rejection_config()

        # Check if alerts are enabled
        if not config.get('alertsEnabled', False):
            logger.debug(f"{symbol}/{interval}: Rejection alerts disabled (alertsEnabled=False)")
            return

        # Get calculated levels
        levels = self.config_store.get_levels(symbol, interval, indicator_type)

        # Build reference contexts from levels
        reference_contexts = self._build_reference_contexts(levels, config)

        # Run detector
        try:
            logger.debug(f"[REALTIME] {symbol}/{interval}: Running rejection detection with {len(candles)} candles, {len(reference_contexts)} contexts")

            patterns = self.rejection_detector.detect_patterns(
                symbol=symbol,
                candles=candles,
                config=config,
                reference_contexts=reference_contexts
            )

            if patterns:
                logger.info(f"[REALTIME] {symbol}/{interval}: Detected {len(patterns)} Rejection patterns")
                self.stats['patterns_detected'] += len(patterns)

                # Store ALL detected patterns for frontend display
                for pattern in patterns:
                    # Convert RejectionPattern dataclass to dict
                    pattern_dict = {
                        'type': pattern.pattern_type,
                        'patternType': pattern.pattern_type,
                        'timestamp': pattern.timestamp,
                        'price': pattern.price,
                        'confidence': pattern.confidence,
                        'direction': pattern.direction,
                        'nearSRLevel': getattr(pattern, 'near_sr_level', None),
                        'nearLevel': getattr(pattern, 'near_level', None),
                        'detectedAt': int(time.time() * 1000)
                    }
                    await self.store_detected_pattern(symbol, interval, 'rejection', pattern_dict)

                    # Process for alerting (may be filtered by cooldown, rate limit, etc.)
                    await self._process_rejection_pattern(symbol, interval, pattern, config, levels, candles)
            else:
                logger.debug(f"[REALTIME] {symbol}/{interval}: No rejection patterns detected")

        except Exception as e:
            logger.error(f"Rejection detection error for {symbol}/{interval}: {e}")

    async def _process_dbt_pattern(self, symbol: str, interval: str, pattern,
                                    config: Dict, levels: Dict, candles: List[Dict]):
        """Process a detected Double Top/Bottom pattern"""
        # Extract pattern info
        pattern_type = pattern.type
        price = pattern.level_price
        confidence = pattern.confidence
        timestamp = pattern.second_extreme['timestamp']
        direction = 'LONG' if pattern_type == 'DOUBLE_BOTTOM' else 'SHORT'

        # Check minimum confidence
        min_confidence = config.get('filters', {}).get('minConfidence', 60)
        if confidence < min_confidence:
            logger.debug(f"{symbol}: DBT pattern rejected (confidence {confidence:.1f}% < {min_confidence}%)")
            return

        # Check deduplication
        if self.state_manager.is_pattern_alerted(symbol, interval, pattern_type, timestamp, price):
            logger.debug(f"{symbol}: DBT pattern already alerted")
            self.stats['alerts_blocked_duplicate'] += 1
            return

        # Check cooldown
        alert_settings = config.get('alertSettings', {})
        cooldown_config = alert_settings.get('globalCooldown', {})
        cooldown_enabled = cooldown_config.get('enabled', False)
        cooldown_minutes = cooldown_config.get('minutes', 30)

        if cooldown_enabled and self.state_manager.is_in_cooldown(symbol, interval, cooldown_minutes):
            logger.debug(f"{symbol}: DBT pattern blocked by cooldown")
            self.stats['alerts_blocked_cooldown'] += 1
            return

        # Check rate limiting (anti-burst protection)
        can_send, rate_limit_reason = self._check_rate_limit(
            symbol, interval, 'doubleTopBottom', timestamp, config
        )
        if not can_send:
            logger.info(f"[REALTIME] {symbol}: DBT pattern blocked by rate limit ({rate_limit_reason})")
            return

        # Check VWAP filter (if enabled and levels available)
        vwap_filter = alert_settings.get('vwapFilter', {})
        if vwap_filter.get('enabled', False):
            if not self._check_vwap_alignment(price, direction, levels, vwap_filter):
                logger.debug(f"{symbol}: DBT pattern rejected by VWAP filter")
                return

        # Pattern passed all filters - send alert!
        logger.info(f"{symbol}/{interval}: Sending DBT alert - {pattern_type} @ {price:.2f} ({confidence:.1f}%)")

        # Calculate strategy levels if available
        entry = price
        stop_loss = None
        take_profit = None

        strategy_config = config.get('strategy', {})
        if strategy_config.get('enabled', False) and hasattr(pattern, '_strategy'):
            strategy = getattr(pattern, '_strategy', None)
            if strategy:
                entry = strategy.get('entry', price)
                stop_loss = strategy.get('stopLoss')
                take_profit = strategy.get('takeProfit')

        # Send alert
        success = await self._send_alert(
            symbol=symbol,
            interval=interval,
            indicator='DTB',
            pattern_type=pattern_type,
            direction=direction,
            price=price,
            confidence=confidence,
            timestamp=timestamp,
            entry=entry,
            stop_loss=stop_loss,
            take_profit=take_profit,
            config=config
        )

        if success:
            # Mark pattern as alerted
            self.state_manager.mark_pattern_alerted(symbol, interval, pattern_type, timestamp, price)

            # Update cooldown
            if cooldown_enabled:
                self.state_manager.update_cooldown(symbol, interval)

            # Update rate limit timestamp
            self._last_alert_time = time.time()

            self.stats['alerts_sent'] += 1

    async def _process_rejection_pattern(self, symbol: str, interval: str, pattern,
                                          config: Dict, levels: Dict, candles: List[Dict]):
        """Process a detected Rejection pattern"""
        # Extract pattern info (RejectionPattern dataclass)
        pattern_type = pattern.pattern_type
        price = pattern.price
        confidence = pattern.confidence
        timestamp = pattern.timestamp

        # Determine direction
        bullish_patterns = ["HAMMER", "ENGULFING_BULLISH", "DOJI_DRAGONFLY", "SWING_LOW"]
        bearish_patterns = ["SHOOTING_STAR", "ENGULFING_BEARISH", "DOJI_GRAVESTONE", "SWING_HIGH"]
        direction = 'LONG' if pattern_type in bullish_patterns else 'SHORT'

        # Check minimum confidence
        min_confidence = config.get('filters', {}).get('minConfidence', 50)
        if confidence < min_confidence:
            logger.debug(f"{symbol}: Rejection pattern rejected (confidence {confidence:.1f}% < {min_confidence}%)")
            return

        # Check deduplication
        if self.state_manager.is_pattern_alerted(symbol, interval, pattern_type, timestamp, price):
            logger.debug(f"{symbol}: Rejection pattern already alerted")
            self.stats['alerts_blocked_duplicate'] += 1
            return

        # Check cooldown
        cooldown_config = config.get('alertCooldown', {})
        cooldown_enabled = cooldown_config.get('enabled', False)
        cooldown_minutes = cooldown_config.get('minutes', 30)

        if cooldown_enabled and self.state_manager.is_in_cooldown(symbol, interval, cooldown_minutes):
            logger.debug(f"{symbol}: Rejection pattern blocked by cooldown")
            self.stats['alerts_blocked_cooldown'] += 1
            return

        # Check rate limiting (anti-burst protection)
        can_send, rate_limit_reason = self._check_rate_limit(
            symbol, interval, 'rejection', timestamp, config
        )
        if not can_send:
            logger.debug(f"{symbol}: Rejection pattern blocked by rate limit ({rate_limit_reason})")
            return

        # Check VWAP filter (if enabled and levels available)
        vwap_filter = config.get('vwapFilter', {})
        if vwap_filter.get('enabled', False):
            if not self._check_vwap_alignment(price, direction, levels, vwap_filter):
                logger.debug(f"{symbol}: Rejection pattern rejected by VWAP filter")
                return

        # Pattern passed all filters - send alert!
        logger.info(f"{symbol}/{interval}: Sending Rejection alert - {pattern_type} @ {price:.2f} ({confidence:.1f}%)")

        # Send alert
        success = await self._send_alert(
            symbol=symbol,
            interval=interval,
            indicator='REJ',
            pattern_type=pattern_type,
            direction=direction,
            price=price,
            confidence=confidence,
            timestamp=timestamp,
            config=config
        )

        if success:
            # Mark pattern as alerted
            self.state_manager.mark_pattern_alerted(symbol, interval, pattern_type, timestamp, price)

            # Update cooldown
            if cooldown_enabled:
                self.state_manager.update_cooldown(symbol, interval)

            # Update rate limit timestamp
            self._last_alert_time = time.time()

            self.stats['alerts_sent'] += 1

    def _check_vwap_alignment(self, price: float, direction: str, levels: Dict,
                              vwap_filter: Dict) -> bool:
        """
        Check if price is aligned with VWAP deviations.

        For LONG: price should be near lower deviations (-2σ, -3σ)
        For SHORT: price should be near upper deviations (+2σ, +3σ)
        """
        vwap_levels = levels.get('vwap', {})
        if not vwap_levels:
            return True  # No VWAP data, don't block

        tolerance_pct = vwap_filter.get('deviationTolerance', 10) / 100
        required_devs = vwap_filter.get('requiredDeviations', {'second': True, 'third': False})

        if direction == 'LONG':
            # Check lower deviations
            if required_devs.get('second') and 'lower2' in vwap_levels:
                dev2 = vwap_levels['lower2']
                if abs(price - dev2) / dev2 <= tolerance_pct:
                    return True

            if required_devs.get('third') and 'lower3' in vwap_levels:
                dev3 = vwap_levels['lower3']
                if abs(price - dev3) / dev3 <= tolerance_pct:
                    return True
        else:
            # Check upper deviations
            if required_devs.get('second') and 'upper2' in vwap_levels:
                dev2 = vwap_levels['upper2']
                if abs(price - dev2) / dev2 <= tolerance_pct:
                    return True

            if required_devs.get('third') and 'upper3' in vwap_levels:
                dev3 = vwap_levels['upper3']
                if abs(price - dev3) / dev3 <= tolerance_pct:
                    return True

        return False

    def _build_reference_contexts(self, levels: Dict, config: Dict) -> List[Dict]:
        """Build reference contexts from synchronized levels"""
        contexts = []

        # Manual zones
        manual_zones = levels.get('manualZones', [])
        for zone in manual_zones:
            if zone.get('enabled', True):
                contexts.append({
                    'id': zone.get('id', f"zone_{len(contexts)}"),
                    'type': 'manual_zone',
                    'enabled': True,
                    'minPrice': zone.get('minPrice'),
                    'maxPrice': zone.get('maxPrice'),
                    'signalDirection': zone.get('signalDirection', 'BOTH'),
                    'weight': 1.0
                })

        # Fixed ranges (VP)
        fixed_ranges = levels.get('fixedRanges', [])
        for fr in fixed_ranges:
            contexts.append({
                'id': fr.get('rangeId', f"fr_{len(contexts)}"),
                'type': 'VOLUME_PROFILE_FIXED',
                'enabled': True,
                'levels': ['POC', 'VAH', 'VAL'],
                'metadata': {
                    'poc': fr.get('poc'),
                    'vah': fr.get('vah'),
                    'val': fr.get('val')
                },
                'weight': 1.0
            })

        # S/R levels
        sr_levels = levels.get('supportResistance', {})
        if sr_levels.get('supports') or sr_levels.get('resistances'):
            contexts.append({
                'id': 'sr_levels',
                'type': 'SUPPORT_RESISTANCE',
                'enabled': True,
                'metadata': sr_levels,
                'weight': 0.8
            })

        return contexts

    async def _send_alert(self, symbol: str, interval: str, indicator: str,
                          pattern_type: str, direction: str, price: float,
                          confidence: float, timestamp: int,
                          entry: float = None, stop_loss: float = None,
                          take_profit: float = None, config: Dict = None) -> bool:
        """Send alert via AlertSender and record in history"""

        # Generate config hash for sync validation
        config_hash = None
        if config:
            config_hash = hashlib.md5(json.dumps(config, sort_keys=True).encode()).hexdigest()[:8]

        # Build alert payload
        alert_data = {
            'symbol': symbol,
            'interval': interval,
            'pattern': {
                'patternType': pattern_type,
                'price': price,
                'confidence': round(confidence, 1),
                'timestamp': timestamp,
                'direction': direction,
                'metadata': {
                    'source': 'backend_realtime',
                    'configHash': config_hash
                }
            }
        }

        if entry:
            alert_data['pattern']['entry'] = entry
        if stop_loss:
            alert_data['pattern']['stopLoss'] = stop_loss
        if take_profit:
            alert_data['pattern']['takeProfit'] = take_profit

        # Send via AlertSender (async call)
        success = await self.alert_sender.send_rejection_pattern_alert(
            symbol=symbol,
            interval=interval,
            pattern=alert_data['pattern']
        )

        # Record in history
        alert_id = f"{indicator}_alert_{int(time.time() * 1000)}_{symbol}"
        record = AlertRecord(
            id=alert_id,
            timestamp=int(time.time() * 1000),
            symbol=symbol,
            interval=interval,
            indicator=indicator,
            pattern_type=pattern_type,
            direction=direction,
            price=price,
            confidence=confidence,
            status='sent' if success else 'failed',
            entry=entry,
            stop_loss=stop_loss,
            take_profit=take_profit,
            config_hash=config_hash
        )

        self.state_manager.add_alert_record(record)

        return success

    async def _evaluate_pending_trades(self, symbol: str, interval: str, candle: Candle):
        """
        Evaluate pending trades against a candle's high/low to check for SL/TP hits.
        Called on each candle close to track trade outcomes in real-time.
        """
        try:
            # Get pending alerts for this symbol/interval
            pending_alerts = self.state_manager.get_pending_alerts(symbol, interval)

            if not pending_alerts:
                return

            high = candle.high
            low = candle.low
            candle_time = candle.timestamp

            for alert in pending_alerts:
                if not alert.entry or not alert.stop_loss or not alert.take_profit:
                    continue

                outcome = None

                if alert.direction == 'LONG':
                    # For LONG: SL hit if low <= stop_loss, TP hit if high >= take_profit
                    if low <= alert.stop_loss:
                        outcome = 'LOSS'
                    elif high >= alert.take_profit:
                        outcome = 'WIN'
                elif alert.direction == 'SHORT':
                    # For SHORT: SL hit if high >= stop_loss, TP hit if low <= take_profit
                    if high >= alert.stop_loss:
                        outcome = 'LOSS'
                    elif low <= alert.take_profit:
                        outcome = 'WIN'

                if outcome:
                    # Update the outcome in state manager
                    success = self.state_manager.update_alert_outcome(
                        alert.id,
                        outcome,
                        candle_time
                    )

                    if success:
                        logger.info(f"[TRADE] Trade {outcome}: {symbol}/{interval} {alert.pattern_type} "
                                    f"(entry: {alert.entry:.2f}, SL: {alert.stop_loss:.2f}, TP: {alert.take_profit:.2f})")

                        # Update stats
                        if outcome == 'WIN':
                            self.stats['trades_won'] = self.stats.get('trades_won', 0) + 1
                        else:
                            self.stats['trades_lost'] = self.stats.get('trades_lost', 0) + 1

                        # ✅ Send outcome notification to trading bot
                        await self._send_trade_outcome_alert(alert, outcome, candle_time)

        except Exception as e:
            logger.error(f"Error evaluating pending trades: {e}")

    async def _send_trade_outcome_alert(self, alert, outcome: str, outcome_timestamp: int):
        """Send trade outcome notification to trading bot"""
        try:
            outcome_data = {
                'type': 'TRADE_OUTCOME',
                'symbol': alert.symbol,
                'interval': alert.interval,
                'alertId': alert.id,
                'pattern': {
                    'patternType': alert.pattern_type,
                    'direction': alert.direction,
                    'entry': alert.entry,
                    'stopLoss': alert.stop_loss,
                    'takeProfit': alert.take_profit,
                    'confidence': alert.confidence
                },
                'outcome': outcome,
                'outcomeTimestamp': outcome_timestamp,
                'originalTimestamp': alert.timestamp,
                'metadata': {
                    'source': 'backend_realtime',
                    'indicator': alert.indicator
                }
            }

            await self.alert_sender.send_rejection_pattern_alert(
                symbol=alert.symbol,
                interval=alert.interval,
                pattern=outcome_data.get('pattern', {})
            )
            logger.info(f"[OUTCOME] Sent trade outcome alert: {alert.symbol} {outcome}")

        except Exception as e:
            logger.error(f"Error sending trade outcome alert: {e}")

    async def _cleanup_loop(self):
        """Periodic cleanup of old data"""
        while self.running:
            try:
                await asyncio.sleep(3600)  # Run every hour
                removed = self.state_manager.cleanup_old_data()
                if removed > 0:
                    logger.info(f"Cleanup: removed {removed} old patterns")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Cleanup error: {e}")

    def _get_default_dbt_config(self) -> Dict:
        """Get default DBT config (mirrors frontend defaults)"""
        return {
            'alertsEnabled': True,  # Habilitado por defecto para enviar al trading bot
            'filters': {
                'minConfidence': 60
            },
            'alertSettings': {
                'mode': 'smart',
                'globalCooldown': {
                    'enabled': True,
                    'minutes': 30
                },
                'vwapFilter': {
                    'enabled': False
                }
            }
        }

    def _get_default_rejection_config(self) -> Dict:
        """Get default Rejection config (mirrors frontend defaults)"""
        return {
            'alertsEnabled': True,  # Habilitado por defecto para enviar al trading bot
            'filters': {
                'minConfidence': 50,
                'requireNearLevel': False
            },
            'patterns': {
                'hammer': {
                    'enabled': True,
                    'minWickRatio': 1.5,
                    'maxUpperWickRatio': 0.3,
                    'minBodyPosition': 0.5,
                    'debug': False
                },
                'shootingStar': {
                    'enabled': True,
                    'minWickRatio': 1.5,
                    'maxLowerWickRatio': 0.3,
                    'minBodyPosition': 0.5,
                    'debug': False
                },
                'engulfing': {
                    'enabled': True
                },
                'doji': {
                    'enabled': False,
                    'maxBodyRatio': 0.08,
                    'minLongWick': 0.5,
                    'maxShortWick': 0.15,
                    'debug': False
                }
            },
            'alertCooldown': {
                'enabled': True,
                'minutes': 30
            },
            'vwapFilter': {
                'enabled': False
            },
            'swingDetection': {
                'enabled': True,
                'leftBars': 5,
                'rightBars': 5,
                'required': False,
                'swingOnlyMode': False
            }
        }

    async def update_intervals(self, intervals: List[str]) -> bool:
        """
        Dynamically update the intervals being monitored.
        Called when frontend changes the active timeframe.

        Args:
            intervals: List of intervals to monitor (e.g., ["60"] for 1h only)

        Returns:
            True if update was successful
        """
        if not self.running:
            logger.warning("[REALTIME] Cannot update intervals: service not running")
            return False

        old_intervals = self.intervals.copy()
        self.intervals = intervals

        logger.info(f"[REALTIME] Updating intervals: {old_intervals} -> {intervals}")

        # ✅ CRITICAL: Pre-load historical candles for NEW intervals
        # This ensures we have enough data for pattern detection immediately
        new_intervals = set(intervals) - set(old_intervals)
        if new_intervals:
            logger.info(f"[REALTIME] Pre-loading historical data for new intervals: {new_intervals}")
            await self._preload_intervals(list(new_intervals))

        # Update WebSocket subscriptions
        success = await self.ws_manager.update_subscriptions(self.symbols, intervals)

        if success:
            logger.info(f"[REALTIME] Now monitoring intervals: {intervals}")
        else:
            logger.error("[REALTIME] Failed to update WebSocket subscriptions")
            self.intervals = old_intervals  # Rollback

        return success

    async def _preload_intervals(self, intervals: List[str]):
        """
        Pre-load historical candles for specific intervals.
        Called when new intervals are added dynamically.
        """
        candles_to_load = 200

        async with httpx.AsyncClient(timeout=30) as client:
            for symbol in self.symbols:
                for interval in intervals:
                    try:
                        # Check if buffer already has enough candles
                        existing_candles = self.ws_manager.get_candles(symbol, interval)
                        if len(existing_candles) >= 50:
                            logger.info(f"[PRELOAD] {symbol}/{interval}: Already has {len(existing_candles)} candles, skipping")
                            continue

                        url = (
                            "https://api.bybit.com/v5/market/kline?"
                            f"category=linear&symbol={symbol}&interval={interval}"
                            f"&limit={candles_to_load}"
                        )

                        logger.info(f"[PRELOAD] Fetching {candles_to_load} candles for {symbol}/{interval}...")
                        response = await client.get(url)
                        data = response.json()

                        if data.get("retCode") != 0:
                            logger.error(f"[PRELOAD] API error for {symbol}/{interval}: {data.get('retMsg')}")
                            continue

                        result = data.get("result", {})
                        raw_candles = result.get("list", [])

                        if not raw_candles:
                            logger.warning(f"[PRELOAD] No candles returned for {symbol}/{interval}")
                            continue

                        # Convert Bybit format to our format
                        candles_data = []
                        for c in raw_candles:
                            candles_data.append({
                                'timestamp': int(c[0]),
                                'open': float(c[1]),
                                'high': float(c[2]),
                                'low': float(c[3]),
                                'close': float(c[4]),
                                'volume': float(c[5]),
                                'turnover': float(c[6]) if len(c) > 6 else 0
                            })

                        # Preload into WebSocket buffer
                        self.ws_manager.preload_historical(symbol, interval, candles_data)
                        logger.info(f"[PRELOAD] ✅ {symbol}/{interval}: Loaded {len(candles_data)} candles")

                    except Exception as e:
                        logger.error(f"[PRELOAD] Error loading {symbol}/{interval}: {e}")

    async def update_symbols(self, symbols: List[str]) -> bool:
        """
        Dynamically update the symbols being monitored.

        Args:
            symbols: List of symbols to monitor

        Returns:
            True if update was successful
        """
        if not self.running:
            logger.warning("[REALTIME] Cannot update symbols: service not running")
            return False

        old_symbols = self.symbols.copy()
        self.symbols = symbols

        logger.info(f"[REALTIME] Updating symbols: {old_symbols} -> {symbols}")

        # Update WebSocket subscriptions
        success = await self.ws_manager.update_subscriptions(symbols, self.intervals)

        if success:
            logger.info(f"[REALTIME] Now monitoring symbols: {symbols}")
        else:
            logger.error("[REALTIME] Failed to update WebSocket subscriptions")
            self.symbols = old_symbols  # Rollback

        return success

    async def store_detected_pattern(self, symbol: str, interval: str, indicator: str, pattern: Dict):
        """
        Store a detected pattern for frontend display.
        This is called after pattern detection (regardless of whether alert was sent).

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            interval: Timeframe (e.g., "1", "60")
            indicator: Indicator type ("doubleTopBottom" or "rejection")
            pattern: Pattern data dict
        """
        async with self._patterns_lock:
            # Initialize nested structure if needed
            if symbol not in self._detected_patterns:
                self._detected_patterns[symbol] = {}
            if interval not in self._detected_patterns[symbol]:
                self._detected_patterns[symbol][interval] = {}
            if indicator not in self._detected_patterns[symbol][interval]:
                self._detected_patterns[symbol][interval][indicator] = []

            patterns_list = self._detected_patterns[symbol][interval][indicator]

            # Check for duplicate (same timestamp and type)
            pattern_key = f"{pattern.get('timestamp')}_{pattern.get('type', pattern.get('patternType'))}"
            for existing in patterns_list:
                existing_key = f"{existing.get('timestamp')}_{existing.get('type', existing.get('patternType'))}"
                if pattern_key == existing_key:
                    return  # Already stored

            # Add pattern
            patterns_list.append(pattern)

            # Trim if too many
            if len(patterns_list) > self._max_patterns_per_symbol:
                # Remove oldest patterns
                patterns_list.sort(key=lambda p: p.get('timestamp', 0))
                self._detected_patterns[symbol][interval][indicator] = patterns_list[-self._max_patterns_per_symbol:]

            logger.debug(f"[PATTERNS] Stored {indicator} pattern for {symbol}/{interval}")

    def get_detected_patterns(self, symbol: str, interval: str, indicator: str = None,
                              since_timestamp: int = None) -> Dict:
        """
        Get detected patterns for a symbol/interval.
        Frontend calls this to display patterns on chart.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            interval: Timeframe (e.g., "1", "60")
            indicator: Optional - filter by indicator type
            since_timestamp: Optional - only return patterns newer than this timestamp (ms)

        Returns:
            Dict with patterns by indicator type
        """
        result = {
            'symbol': symbol,
            'interval': interval,
            'patterns': {
                'doubleTopBottom': [],
                'rejection': []
            },
            'timestamp': int(time.time() * 1000)
        }

        if symbol not in self._detected_patterns:
            return result
        if interval not in self._detected_patterns[symbol]:
            return result

        symbol_patterns = self._detected_patterns[symbol][interval]

        for ind_type in ['doubleTopBottom', 'rejection']:
            if indicator and ind_type != indicator:
                continue

            if ind_type in symbol_patterns:
                patterns = symbol_patterns[ind_type]

                # Filter by timestamp if specified
                if since_timestamp:
                    patterns = [p for p in patterns if p.get('timestamp', 0) > since_timestamp]

                result['patterns'][ind_type] = patterns

        return result

    def clear_detected_patterns(self, symbol: str = None, interval: str = None):
        """Clear stored patterns (useful when config changes significantly)"""
        if symbol is None:
            self._detected_patterns = {}
            logger.info("[PATTERNS] Cleared all detected patterns")
        elif interval is None:
            if symbol in self._detected_patterns:
                del self._detected_patterns[symbol]
                logger.info(f"[PATTERNS] Cleared patterns for {symbol}")
        else:
            if symbol in self._detected_patterns and interval in self._detected_patterns[symbol]:
                del self._detected_patterns[symbol][interval]
                logger.info(f"[PATTERNS] Cleared patterns for {symbol}/{interval}")

    def get_status(self) -> Dict:
        """Get service status and statistics"""
        uptime = time.time() - self.stats['start_time'] if self.stats['start_time'] > 0 else 0

        # Count stored patterns
        total_patterns = 0
        for symbol in self._detected_patterns:
            for interval in self._detected_patterns[symbol]:
                for indicator in self._detected_patterns[symbol][interval]:
                    total_patterns += len(self._detected_patterns[symbol][interval][indicator])

        return {
            'running': self.running,
            'connected': self.ws_manager.is_connected(),
            'symbols': self.symbols,
            'intervals': self.intervals,
            'uptime_seconds': int(uptime),
            'stats': self.stats,
            'stored_patterns_count': total_patterns,
            'buffer_stats': self.ws_manager.get_buffer_stats(),
            'state_stats': self.state_manager.get_stats(),
            'config_stats': self.config_store.get_stats(),
            'ws_subscriptions': self.ws_manager.get_current_subscriptions()
        }


# Singleton instance
_service_instance: Optional[RealtimePatternService] = None


def get_realtime_pattern_service() -> RealtimePatternService:
    """Get or create the singleton RealtimePatternService instance"""
    global _service_instance
    if _service_instance is None:
        _service_instance = RealtimePatternService()
    return _service_instance
