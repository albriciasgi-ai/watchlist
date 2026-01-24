# -*- coding: utf-8 -*-
"""
VWAP Service - Backend Native VWAP Calculator
==============================================
Real-time VWAP calculation with standard deviation bands and volatility indicators.
Replaces frontend calculation with centralized backend service.
"""

import asyncio
import logging
import time
import json
import math
import aiohttp
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Set VWAP service logging to WARNING to reduce noise
logger.setLevel(logging.WARNING)

# Bybit API for historical data
BYBIT_API_URL = "https://api.bybit.com/v5/market/kline"

# Config file path
CONFIG_DIR = Path(__file__).parent / "config"
CONFIG_FILE = CONFIG_DIR / "vwap_config.json"


@dataclass
class VWAPServiceConfig:
    """Configuration for VWAP Service"""
    enabled: bool = True
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"])
    interval: str = "60"  # Default to 1h (matches frontend default)

    # Historical data loading - minimal initial load, frontend will request more as needed
    historyDays: int = 1  # Start small, frontend will request what it needs

    # VWAP Type: 'session', 'rolling', 'anchored'
    vwapType: str = "session"
    resetHour: int = 0  # UTC hour for session reset
    rollingPeriod: int = 20  # Candles for rolling VWAP
    anchorTimestamp: Optional[int] = None  # For anchored VWAP

    # Bands configuration
    showBands: bool = True
    bandMultipliers: List[float] = field(default_factory=lambda: [1.0, 2.0, 3.0])
    applyCryptoAdjustment: bool = True
    cryptoAdjustmentFactor: float = 1.15

    # Volatility indicators
    showBandWidth: bool = True
    showBBWP: bool = False
    showTTMSqueeze: bool = False

    # BandWidth thresholds (adaptive by timeframe)
    bandWidthThresholds: Dict = field(default_factory=lambda: {
        "squeeze": 2.0,
        "consolidation": 5.0,
        "normal": 10.0
    })

    # BBWP configuration
    bbwpLookback: int = 252
    bbwpThresholds: Dict = field(default_factory=lambda: {
        "squeeze": 20,
        "normal": 80
    })

    # TTM Squeeze configuration
    ttmATRLength: int = 20
    ttmATRMultiplier: float = 1.5


def get_default_bandwidth_thresholds(interval: str) -> Dict:
    """Get recommended BandWidth thresholds based on timeframe"""
    thresholds = {
        '1': {'squeeze': 8, 'consolidation': 12, 'normal': 18},
        '3': {'squeeze': 6, 'consolidation': 10, 'normal': 15},
        '5': {'squeeze': 5, 'consolidation': 8, 'normal': 12},
        '15': {'squeeze': 3.5, 'consolidation': 6, 'normal': 10},
        '30': {'squeeze': 3, 'consolidation': 5, 'normal': 8},
        '60': {'squeeze': 2.5, 'consolidation': 4.5, 'normal': 7},
        '240': {'squeeze': 2, 'consolidation': 4, 'normal': 6},
        'D': {'squeeze': 1.5, 'consolidation': 3, 'normal': 5},
        'W': {'squeeze': 1, 'consolidation': 2, 'normal': 4}
    }
    return thresholds.get(interval, {'squeeze': 2, 'consolidation': 5, 'normal': 10})


@dataclass
class VWAPPoint:
    """Single VWAP data point"""
    timestamp: int
    vwap: float
    typical_price: float
    volume: float
    cumulative_volume: float
    cumulative_pv: float

    # Bands
    upper_1: Optional[float] = None
    lower_1: Optional[float] = None
    upper_2: Optional[float] = None
    lower_2: Optional[float] = None
    upper_3: Optional[float] = None
    lower_3: Optional[float] = None
    std_dev: Optional[float] = None

    # Volatility indicators
    bandwidth: Optional[float] = None
    bandwidth_state: Optional[str] = None
    bbwp: Optional[float] = None
    bbwp_state: Optional[str] = None
    squeeze: Optional[bool] = None
    squeeze_state: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp,
            'vwap': self.vwap,
            'typical_price': self.typical_price,
            'volume': self.volume,
            'bands': {
                'upper_1': self.upper_1,
                'lower_1': self.lower_1,
                'upper_2': self.upper_2,
                'lower_2': self.lower_2,
                'upper_3': self.upper_3,
                'lower_3': self.lower_3,
            },
            'std_dev': self.std_dev,
            'bandwidth': self.bandwidth,
            'bandwidth_state': self.bandwidth_state,
            'bbwp': self.bbwp,
            'bbwp_state': self.bbwp_state,
            'squeeze': self.squeeze,
            'squeeze_state': self.squeeze_state
        }


class VWAPCalculator:
    """Core VWAP calculation engine"""

    def __init__(self, config: VWAPServiceConfig):
        self.config = config

    def update_config(self, config: VWAPServiceConfig):
        self.config = config

    def calculate(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate VWAP with bands and volatility indicators"""
        if not candles or len(candles) == 0:
            return []

        # Step 1: Calculate base VWAP
        if self.config.vwapType == 'session':
            vwap_points = self._calculate_session_vwap(candles)
        elif self.config.vwapType == 'rolling':
            vwap_points = self._calculate_rolling_vwap(candles)
        elif self.config.vwapType == 'anchored':
            vwap_points = self._calculate_anchored_vwap(candles)
        else:
            vwap_points = self._calculate_session_vwap(candles)

        # Step 2: Calculate standard deviation bands
        if self.config.showBands:
            self._calculate_std_bands(candles, vwap_points)

        # Step 3: Calculate volatility indicators (always calculate for availability)
        self._calculate_bandwidth(vwap_points)
        self._calculate_bbwp(vwap_points)
        self._calculate_ttm_squeeze(candles, vwap_points)

        return vwap_points

    def _calculate_session_vwap(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate session VWAP with daily reset"""
        points = []
        cumulative_pv = 0.0
        cumulative_volume = 0.0
        session_start_ts = None

        for candle in candles:
            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            # Check for session reset
            dt_utc = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
            current_hour = dt_utc.hour

            if session_start_ts is None or current_hour == self.config.resetHour:
                if session_start_ts is None:
                    cumulative_pv = 0.0
                    cumulative_volume = 0.0
                    session_start_ts = timestamp
                else:
                    time_since_session = timestamp - session_start_ts
                    if time_since_session >= (23 * 60 * 60 * 1000):
                        cumulative_pv = 0.0
                        cumulative_volume = 0.0
                        session_start_ts = timestamp

            # Get OHLCV
            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)
            close = candle.get('close') or (candle.close if hasattr(candle, 'close') else 0)
            volume = candle.get('volume') or (candle.volume if hasattr(candle, 'volume') else 0)

            typical_price = (high + low + close) / 3.0

            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=typical_price,
                volume=volume,
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _calculate_rolling_vwap(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate rolling VWAP with fixed window"""
        points = []
        period = self.config.rollingPeriod

        for i in range(len(candles)):
            start_idx = max(0, i - period + 1)
            window = candles[start_idx:i + 1]

            cumulative_pv = 0.0
            cumulative_volume = 0.0

            for c in window:
                high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
                low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
                close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
                volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)

                tp = (high + low + close) / 3.0
                cumulative_pv += tp * volume
                cumulative_volume += volume

            candle = candles[i]
            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)
            close = candle.get('close') or (candle.close if hasattr(candle, 'close') else 0)
            volume = candle.get('volume') or (candle.volume if hasattr(candle, 'volume') else 0)

            typical_price = (high + low + close) / 3.0
            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=typical_price,
                volume=volume,
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _calculate_anchored_vwap(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate anchored VWAP from specific timestamp"""
        points = []

        # Find anchor index
        anchor_idx = 0
        if self.config.anchorTimestamp:
            for i, candle in enumerate(candles):
                ts = candle.get('timestamp') or candle.get('open_time', 0)
                if hasattr(candle, 'timestamp'):
                    ts = candle.timestamp
                if ts >= self.config.anchorTimestamp:
                    anchor_idx = i
                    break

        cumulative_pv = 0.0
        cumulative_volume = 0.0

        for i in range(anchor_idx, len(candles)):
            candle = candles[i]
            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)
            close = candle.get('close') or (candle.close if hasattr(candle, 'close') else 0)
            volume = candle.get('volume') or (candle.volume if hasattr(candle, 'volume') else 0)

            typical_price = (high + low + close) / 3.0

            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=typical_price,
                volume=volume,
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _calculate_std_bands(self, candles: List[Dict], vwap_points: List[VWAPPoint]):
        """Calculate standard deviation bands"""
        if len(candles) != len(vwap_points):
            logger.warning(f"Candle/VWAP length mismatch: {len(candles)} vs {len(vwap_points)}")
            return

        # Apply crypto adjustment if enabled
        multipliers = self.config.bandMultipliers.copy()
        if self.config.applyCryptoAdjustment:
            multipliers = [m * self.config.cryptoAdjustmentFactor for m in multipliers]

        for i, point in enumerate(vwap_points):
            vwap_value = point.vwap

            # Determine window based on VWAP type
            if self.config.vwapType == 'rolling':
                start_idx = max(0, i - self.config.rollingPeriod + 1)
                window_candles = candles[start_idx:i + 1]
            elif self.config.vwapType == 'session':
                # Find session start
                start_idx = 0
                for j in range(i, -1, -1):
                    if j == 0:
                        start_idx = 0
                        break
                    ts = candles[j].get('timestamp') or (candles[j].timestamp if hasattr(candles[j], 'timestamp') else 0)
                    dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                    if dt.hour == self.config.resetHour and j < i:
                        prev_ts = candles[i].get('timestamp') or (candles[i].timestamp if hasattr(candles[i], 'timestamp') else 0)
                        if prev_ts - ts >= (23 * 60 * 60 * 1000):
                            start_idx = j
                            break
                window_candles = candles[start_idx:i + 1]
            else:
                window_candles = candles[:i + 1]

            if len(window_candles) < 2:
                point.upper_1 = vwap_value
                point.lower_1 = vwap_value
                point.upper_2 = vwap_value
                point.lower_2 = vwap_value
                point.upper_3 = vwap_value
                point.lower_3 = vwap_value
                point.std_dev = 0
                continue

            # Calculate weighted variance
            total_weighted_sq_diff = 0.0
            total_volume = 0.0

            for c in window_candles:
                high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
                low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
                close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
                volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)

                tp = (high + low + close) / 3.0
                sq_diff = (tp - vwap_value) ** 2
                total_weighted_sq_diff += sq_diff * volume
                total_volume += volume

            variance = total_weighted_sq_diff / total_volume if total_volume > 0 else 0
            std_dev = math.sqrt(variance)

            point.std_dev = std_dev

            # Set bands
            if len(multipliers) >= 1:
                point.upper_1 = vwap_value + (std_dev * multipliers[0])
                point.lower_1 = vwap_value - (std_dev * multipliers[0])
            if len(multipliers) >= 2:
                point.upper_2 = vwap_value + (std_dev * multipliers[1])
                point.lower_2 = vwap_value - (std_dev * multipliers[1])
            if len(multipliers) >= 3:
                point.upper_3 = vwap_value + (std_dev * multipliers[2])
                point.lower_3 = vwap_value - (std_dev * multipliers[2])

    def _calculate_bandwidth(self, vwap_points: List[VWAPPoint]):
        """Calculate BandWidth indicator"""
        thresholds = self.config.bandWidthThresholds

        for point in vwap_points:
            if point.upper_1 is None or point.lower_1 is None or point.vwap == 0:
                point.bandwidth = 0
                point.bandwidth_state = 'unknown'
                continue

            bandwidth = ((point.upper_1 - point.lower_1) / point.vwap) * 100
            point.bandwidth = bandwidth

            # Determine state
            if bandwidth < thresholds.get('squeeze', 2):
                point.bandwidth_state = 'squeeze'
            elif bandwidth < thresholds.get('consolidation', 5):
                point.bandwidth_state = 'consolidation'
            elif bandwidth < thresholds.get('normal', 10):
                point.bandwidth_state = 'normal'
            else:
                point.bandwidth_state = 'trending'

    def _calculate_bbwp(self, vwap_points: List[VWAPPoint]):
        """Calculate BandWidth Percentile (BBWP)"""
        lookback = min(self.config.bbwpLookback, len(vwap_points))
        thresholds = self.config.bbwpThresholds

        for i, point in enumerate(vwap_points):
            if point.bandwidth is None:
                point.bbwp = 0
                point.bbwp_state = 'unknown'
                continue

            start_idx = max(0, i - lookback + 1)
            historical_bws = [p.bandwidth for p in vwap_points[start_idx:i + 1] if p.bandwidth is not None]

            if len(historical_bws) == 0:
                point.bbwp = 0
                point.bbwp_state = 'unknown'
                continue

            count_below = sum(1 for bw in historical_bws if bw < point.bandwidth)
            percentile = (count_below / len(historical_bws)) * 100

            point.bbwp = percentile

            # Determine state
            if percentile < thresholds.get('squeeze', 20):
                point.bbwp_state = 'squeeze'
            elif percentile < thresholds.get('normal', 80):
                point.bbwp_state = 'normal'
            else:
                point.bbwp_state = 'trending'

    def _calculate_ttm_squeeze(self, candles: List[Dict], vwap_points: List[VWAPPoint]):
        """Calculate TTM Squeeze (BB inside Keltner Channels)"""
        atr_length = self.config.ttmATRLength
        atr_mult = self.config.ttmATRMultiplier

        # Calculate ATR
        atr_values = self._calculate_atr(candles, atr_length)

        for i, point in enumerate(vwap_points):
            if i >= len(atr_values) or point.upper_1 is None or point.lower_1 is None:
                point.squeeze = False
                point.squeeze_state = 'off'
                continue

            atr = atr_values[i]

            # Bollinger Bands (VWAP std dev bands)
            bb_upper = point.upper_1
            bb_lower = point.lower_1

            # Keltner Channels
            kc_upper = point.vwap + (atr * atr_mult)
            kc_lower = point.vwap - (atr * atr_mult)

            # Squeeze ON when BB inside KC
            squeeze = (bb_upper < kc_upper) and (bb_lower > kc_lower)

            point.squeeze = squeeze
            point.squeeze_state = 'on' if squeeze else 'off'

    def _calculate_atr(self, candles: List[Dict], length: int) -> List[float]:
        """Calculate Average True Range"""
        atr_values = []
        true_ranges = []

        for i, candle in enumerate(candles):
            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)

            if i == 0:
                tr = high - low
            else:
                prev_close = candles[i-1].get('close') or (candles[i-1].close if hasattr(candles[i-1], 'close') else 0)
                tr = max(high - low, abs(high - prev_close), abs(low - prev_close))

            true_ranges.append(tr)

            if i >= length - 1:
                atr = sum(true_ranges[i - length + 1:i + 1]) / length
            else:
                atr = tr

            atr_values.append(atr)

        return atr_values


class VWAPService:
    """
    VWAP Service - Manages real-time VWAP calculation for multiple symbols
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.config = self._load_config()
        self.calculator = VWAPCalculator(self.config)
        self.ws_manager = None
        self.running = False
        self.start_time = None

        # VWAP data per symbol
        self._vwap_data: Dict[str, List[VWAPPoint]] = {}

        # Historical candle cache per symbol (loaded from Bybit API)
        self._historical_candles: Dict[str, List[Dict]] = {}

        # Stats
        self.stats = {
            'calculations': 0,
            'last_update': {},
            'candles_loaded': {}
        }

        self._initialized = True
        logger.info("[VWAP_SERVICE] Initialized")

    def _load_config(self) -> VWAPServiceConfig:
        """Load config from file or use defaults"""
        try:
            if CONFIG_FILE.exists():
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    # Update bandWidthThresholds based on interval
                    if 'interval' in data and 'bandWidthThresholds' not in data:
                        data['bandWidthThresholds'] = get_default_bandwidth_thresholds(data['interval'])
                    return VWAPServiceConfig(**data)
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Error loading config: {e}")

        return VWAPServiceConfig()

    def _save_config(self):
        """Save current config to file"""
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump(asdict(self.config), f, indent=2)
            logger.info("[VWAP_SERVICE] Config saved")
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Error saving config: {e}")

    async def start(self, ws_manager=None):
        """Start the VWAP service"""
        if self.running:
            logger.warning("[VWAP_SERVICE] Already running")
            return

        self.ws_manager = ws_manager
        self.running = True
        self.start_time = time.time()

        # Register for candle close events
        if self.ws_manager:
            self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)
            logger.info("[VWAP_SERVICE] Registered candle close listener")

        # Load historical data in background (non-blocking)
        logger.info(f"[VWAP_SERVICE] Starting background load of {self.config.historyDays} day(s) historical data...")
        asyncio.create_task(self._background_init())

        logger.info(f"[VWAP_SERVICE] Started for symbols: {self.config.symbols}")

    async def _background_init(self):
        """Background initialization - load historical data without blocking startup"""
        try:
            await self._load_historical_data()
            await self._calculate_all_symbols()
            logger.info("[VWAP_SERVICE] Background initialization complete")
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Background init error: {e}")

    async def stop(self):
        """Stop the VWAP service"""
        if not self.running:
            return

        self.running = False

        if self.ws_manager:
            self.ws_manager.remove_candle_close_listener(self._sync_candle_close_handler)

        logger.info("[VWAP_SERVICE] Stopped")

    async def _load_historical_data(self):
        """Load historical candle data from Bybit API for all symbols"""
        for symbol in self.config.symbols:
            try:
                candles = await self._fetch_historical_candles(symbol)
                if candles:
                    self._historical_candles[symbol] = candles
                    self.stats['candles_loaded'][symbol] = len(candles)
                    logger.info(f"[VWAP_SERVICE] {symbol}: Loaded {len(candles)} historical candles")
                else:
                    logger.warning(f"[VWAP_SERVICE] {symbol}: No historical data loaded")
            except Exception as e:
                logger.error(f"[VWAP_SERVICE] {symbol}: Error loading historical data: {e}")

    async def _fetch_historical_candles(self, symbol: str) -> List[Dict]:
        """
        Fetch historical candles from Bybit API.
        Bybit max limit is 200 per request, so we make multiple requests if needed.
        """
        # Calculate how many candles we need based on days and interval
        interval_minutes = self._interval_to_minutes(self.config.interval)
        candles_per_day = (24 * 60) // interval_minutes
        total_candles_needed = candles_per_day * self.config.historyDays

        logger.info(f"[VWAP_SERVICE] {symbol}: Need {total_candles_needed} candles ({self.config.historyDays} days @ {self.config.interval}m)")

        all_candles = []
        end_time = None  # None means current time

        async with aiohttp.ClientSession() as session:
            while len(all_candles) < total_candles_needed:
                batch_size = min(200, total_candles_needed - len(all_candles))

                url = (
                    f"{BYBIT_API_URL}?"
                    f"category=linear&symbol={symbol}&interval={self.config.interval}"
                    f"&limit={batch_size}"
                )
                if end_time:
                    url += f"&end={end_time}"

                try:
                    async with session.get(url) as response:
                        if response.status != 200:
                            logger.error(f"[VWAP_SERVICE] {symbol}: API error {response.status}")
                            break

                        data = await response.json()

                        if data.get('retCode') != 0:
                            logger.error(f"[VWAP_SERVICE] {symbol}: API returned error: {data.get('retMsg')}")
                            break

                        klines = data.get('result', {}).get('list', [])
                        if not klines:
                            logger.info(f"[VWAP_SERVICE] {symbol}: No more data available")
                            break

                        # Bybit returns: [timestamp, open, high, low, close, volume, turnover]
                        # Data is in descending order (newest first)
                        for kline in klines:
                            candle = {
                                'timestamp': int(kline[0]),
                                'open': float(kline[1]),
                                'high': float(kline[2]),
                                'low': float(kline[3]),
                                'close': float(kline[4]),
                                'volume': float(kline[5]),
                                'turnover': float(kline[6]) if len(kline) > 6 else 0
                            }
                            all_candles.append(candle)

                        # Get oldest timestamp for next request
                        oldest_ts = int(klines[-1][0])
                        end_time = oldest_ts - 1  # 1ms before oldest

                        logger.debug(f"[VWAP_SERVICE] {symbol}: Fetched {len(klines)} candles, total: {len(all_candles)}")

                        # Small delay to avoid rate limiting
                        await asyncio.sleep(0.1)

                except Exception as e:
                    logger.error(f"[VWAP_SERVICE] {symbol}: Fetch error: {e}")
                    break

        # Sort by timestamp ascending (oldest first) for VWAP calculation
        all_candles.sort(key=lambda x: x['timestamp'])

        logger.info(f"[VWAP_SERVICE] {symbol}: Total {len(all_candles)} candles loaded")
        return all_candles

    def _interval_to_minutes(self, interval: str) -> int:
        """Convert interval string to minutes"""
        mapping = {
            '1': 1,
            '3': 3,
            '5': 5,
            '15': 15,
            '30': 30,
            '60': 60,
            '120': 120,
            '240': 240,
            '360': 360,
            '720': 720,
            'D': 1440,
            'W': 10080
        }
        return mapping.get(interval, 1)

    def _sync_candle_close_handler(self, symbol: str, interval: str, candle):
        """Sync wrapper for async candle handler"""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._on_candle_close(symbol, interval, candle))
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._on_candle_close(symbol, interval, candle))
            except Exception as e:
                logger.error(f"[VWAP_SERVICE] Could not schedule candle handler: {e}")

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Called when a candle closes"""
        if not self.running or not self.config.enabled:
            return

        if symbol not in self.config.symbols:
            return

        if interval != self.config.interval:
            return

        # Recalculate VWAP for this symbol
        await self._calculate_symbol(symbol)

    async def _calculate_all_symbols(self):
        """Calculate VWAP for all configured symbols"""
        for symbol in self.config.symbols:
            await self._calculate_symbol(symbol)

    async def _calculate_symbol(self, symbol: str):
        """Calculate VWAP for a single symbol using historical data + real-time updates"""
        # Start with historical candles
        historical = self._historical_candles.get(symbol, [])

        # Get recent candles from WebSocket buffer (if available)
        ws_candles = []
        if self.ws_manager:
            ws_data = self.ws_manager.get_candles(symbol, self.config.interval)
            if ws_data:
                for c in ws_data:
                    if hasattr(c, 'timestamp'):
                        ws_candles.append({
                            'timestamp': c.timestamp,
                            'open': c.open,
                            'high': c.high,
                            'low': c.low,
                            'close': c.close,
                            'volume': c.volume
                        })
                    else:
                        ws_candles.append(c)

        # Merge historical + websocket candles
        # Use a dict to avoid duplicates (by timestamp)
        candle_map = {}

        # Add historical first
        for c in historical:
            candle_map[c['timestamp']] = c

        # WebSocket candles override historical (they may have updated data)
        for c in ws_candles:
            candle_map[c['timestamp']] = c

        # Sort by timestamp and convert back to list
        all_candles = sorted(candle_map.values(), key=lambda x: x['timestamp'])

        if not all_candles or len(all_candles) < 5:
            logger.debug(f"[VWAP_SERVICE] {symbol}: Not enough candles ({len(all_candles)})")
            return

        # Update historical cache with merged data (keep it fresh)
        self._historical_candles[symbol] = all_candles

        # Calculate VWAP
        try:
            vwap_points = self.calculator.calculate(all_candles)
            self._vwap_data[symbol] = vwap_points
            self.stats['calculations'] += 1
            self.stats['last_update'][symbol] = time.time()
            self.stats['candles_loaded'][symbol] = len(all_candles)

            logger.debug(f"[VWAP_SERVICE] {symbol}: Calculated {len(vwap_points)} VWAP points from {len(all_candles)} candles")
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] {symbol}: Calculation error: {e}")

    def get_vwap_data(self, symbol: str) -> List[Dict]:
        """Get VWAP data for a symbol"""
        points = self._vwap_data.get(symbol, [])
        return [p.to_dict() for p in points]

    def get_latest_vwap(self, symbol: str) -> Optional[Dict]:
        """Get latest VWAP point for a symbol"""
        points = self._vwap_data.get(symbol, [])
        if not points:
            return None
        return points[-1].to_dict()

    def get_status(self) -> Dict:
        """Get service status"""
        uptime = time.time() - self.start_time if self.start_time else 0

        return {
            'running': self.running,
            'enabled': self.config.enabled,
            'symbols': self.config.symbols,
            'interval': self.config.interval,
            'historyDays': self.config.historyDays,
            'vwapType': self.config.vwapType,
            'resetHour': self.config.resetHour,
            'rollingPeriod': self.config.rollingPeriod,
            'showBands': self.config.showBands,
            'bandMultipliers': self.config.bandMultipliers,
            'applyCryptoAdjustment': self.config.applyCryptoAdjustment,
            'showBandWidth': self.config.showBandWidth,
            'showBBWP': self.config.showBBWP,
            'showTTMSqueeze': self.config.showTTMSqueeze,
            'bandWidthThresholds': self.config.bandWidthThresholds,
            'bbwpThresholds': self.config.bbwpThresholds,
            'ttmATRLength': self.config.ttmATRLength,
            'ttmATRMultiplier': self.config.ttmATRMultiplier,
            'uptime_seconds': int(uptime),
            'stats': self.stats
        }

    def update_config(self, new_config: Dict) -> bool:
        """Update service configuration"""
        try:
            # Update config fields
            for key, value in new_config.items():
                if hasattr(self.config, key):
                    setattr(self.config, key, value)

            # Update calculator config
            self.calculator.update_config(self.config)

            # Save to file
            self._save_config()

            # Recalculate if running
            if self.running:
                asyncio.create_task(self._calculate_all_symbols())

            logger.info(f"[VWAP_SERVICE] Config updated: {list(new_config.keys())}")
            return True
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Config update error: {e}")
            return False

    async def recalculate(self):
        """Force recalculation for all symbols"""
        logger.info("[VWAP_SERVICE] Force recalculating all symbols...")
        await self._calculate_all_symbols()
        return True

    async def reload_symbol_data(self, symbol: str, days: int, interval: str = None):
        """
        Reload historical data for a specific symbol with specified days and interval.
        Uses local variables for fetch config to avoid race conditions with concurrent requests.
        """
        fetch_interval = interval or self.config.interval
        logger.info(f"[VWAP_SERVICE] Reloading {symbol} with {days} days @ {fetch_interval} interval...")

        try:
            # Fetch candles using LOCAL parameters (not modifying global config during fetch)
            candles = await self._fetch_historical_candles_with_params(symbol, days, fetch_interval)
            if candles:
                self._historical_candles[symbol] = candles
                self.stats['candles_loaded'][symbol] = len(candles)
                logger.info(f"[VWAP_SERVICE] {symbol}: Reloaded {len(candles)} candles for {days} days @ {fetch_interval}")

                # Update config interval only AFTER successful fetch (for future polling)
                if interval:
                    self.config.interval = interval
                    self.config.historyDays = days

                # Recalculate VWAP for this symbol
                await self._calculate_symbol(symbol)
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] {symbol}: Reload error: {e}")

    async def _fetch_historical_candles_with_params(self, symbol: str, days: int, interval: str) -> List[Dict]:
        """
        Fetch historical candles from Bybit API with explicit parameters.
        This method doesn't modify global config, avoiding race conditions.
        """
        # Calculate how many candles we need based on days and interval
        interval_minutes = self._interval_to_minutes(interval)
        candles_per_day = (24 * 60) // interval_minutes
        total_candles_needed = candles_per_day * days

        logger.info(f"[VWAP_SERVICE] {symbol}: Need {total_candles_needed} candles ({days} days @ {interval}m)")

        all_candles = []
        end_time = None  # None means current time

        async with aiohttp.ClientSession() as session:
            while len(all_candles) < total_candles_needed:
                batch_size = min(200, total_candles_needed - len(all_candles))

                url = (
                    f"{BYBIT_API_URL}?"
                    f"category=linear&symbol={symbol}&interval={interval}"
                    f"&limit={batch_size}"
                )
                if end_time:
                    url += f"&end={end_time}"

                try:
                    async with session.get(url) as response:
                        if response.status != 200:
                            logger.error(f"[VWAP_SERVICE] {symbol}: API error {response.status}")
                            break

                        data = await response.json()

                        if data.get('retCode') != 0:
                            logger.error(f"[VWAP_SERVICE] {symbol}: API returned error: {data.get('retMsg')}")
                            break

                        klines = data.get('result', {}).get('list', [])
                        if not klines:
                            logger.info(f"[VWAP_SERVICE] {symbol}: No more data available")
                            break

                        # Bybit returns: [timestamp, open, high, low, close, volume, turnover]
                        for kline in klines:
                            candle = {
                                'timestamp': int(kline[0]),
                                'open': float(kline[1]),
                                'high': float(kline[2]),
                                'low': float(kline[3]),
                                'close': float(kline[4]),
                                'volume': float(kline[5]),
                                'turnover': float(kline[6]) if len(kline) > 6 else 0
                            }
                            all_candles.append(candle)

                        # Get oldest timestamp for next request
                        oldest_ts = int(klines[-1][0])
                        end_time = oldest_ts - 1  # 1ms before oldest

                        logger.debug(f"[VWAP_SERVICE] {symbol}: Fetched {len(klines)} candles, total: {len(all_candles)}")

                        # Small delay to avoid rate limiting
                        await asyncio.sleep(0.1)

                except Exception as e:
                    logger.error(f"[VWAP_SERVICE] {symbol}: Fetch error: {e}")
                    break

        # Sort by timestamp ascending (oldest first) for VWAP calculation
        all_candles.sort(key=lambda x: x['timestamp'])

        logger.info(f"[VWAP_SERVICE] {symbol}: Total {len(all_candles)} candles loaded @ {interval}")
        return all_candles


# Singleton accessor
_vwap_service: Optional[VWAPService] = None


def get_vwap_service() -> VWAPService:
    """Get or create the VWAP service singleton"""
    global _vwap_service
    if _vwap_service is None:
        _vwap_service = VWAPService()
    return _vwap_service
