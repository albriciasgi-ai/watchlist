"""
SWING_DETECTOR - Simple and robust swing high/low detector

Detects swing highs and lows with:
- Volume z-score validation
- Price zone filtering
- Direction filtering (LONG/SHORT/BOTH)

Author: Claude Code
Date: 2026-01-17
"""

import logging
from dataclasses import dataclass
from typing import List, Dict, Optional, Literal
import statistics

logger = logging.getLogger(__name__)


@dataclass
class SwingSignal:
    """Represents a detected swing signal"""
    signal_type: Literal["SWING_HIGH", "SWING_LOW"]
    timestamp: int
    price: float
    volume_zscore: float
    direction: Literal["LONG", "SHORT"]
    symbol: str
    interval: str
    zone_id: Optional[str] = None  # Which zone triggered the signal


class SwingDetector:
    """
    Simple swing high/low detector with volume and zone validation.

    Logic:
    1. Detect swing highs/lows (local max/min over N bars)
    2. Filter by direction (LONG wants swing lows, SHORT wants swing highs)
    3. Filter by price zone (must be within a defined zone)
    4. Filter by volume z-score (must exceed threshold)
    """

    def __init__(self):
        self.name = "SWING_DETECTOR"
        logger.info(f"[{self.name}] Initialized")

    def detect(
        self,
        symbol: str,
        interval: str,
        candles: List[Dict],
        config: Dict
    ) -> List[SwingSignal]:
        """
        Detect swing signals in candles.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            interval: Timeframe (e.g., "1", "60")
            candles: List of candle dicts with keys: timestamp, open, high, low, close, volume
            config: Detection configuration

        Returns:
            List of SwingSignal objects
        """
        if not config.get('enabled', True):
            return []

        if len(candles) < 20:
            logger.debug(f"[{self.name}] {symbol}: Not enough candles ({len(candles)})")
            return []

        swing_bars = config.get('swingBars', 5)
        direction_filter = config.get('direction', 'BOTH')  # LONG, SHORT, BOTH
        all_price_zones = config.get('priceZones', [])
        # Filter zones by symbol (zones without symbol field apply to all symbols for backwards compatibility)
        price_zones = [z for z in all_price_zones if not z.get('symbol') or z.get('symbol') == symbol]
        volume_config = config.get('volumeFilter', {})
        volume_enabled = volume_config.get('enabled', True)
        min_zscore = volume_config.get('minZScore', 1.5)
        lookback = volume_config.get('lookbackBars', 20)

        signals = []

        # Need enough bars on both sides for swing detection
        start_idx = max(swing_bars, lookback)
        end_idx = len(candles) - swing_bars

        for i in range(start_idx, end_idx):
            candle = candles[i]

            # 1. Check if swing high or swing low
            is_swing_high = self._is_swing_high(candles, i, swing_bars)
            is_swing_low = self._is_swing_low(candles, i, swing_bars)

            if not is_swing_high and not is_swing_low:
                continue

            # 2. Filter by direction
            # LONG signals come from swing lows (buy the dip)
            # SHORT signals come from swing highs (sell the top)
            if direction_filter == "LONG" and is_swing_high:
                continue
            if direction_filter == "SHORT" and is_swing_low:
                continue

            price = float(candle.get('close', candle.get('low' if is_swing_low else 'high', 0)))
            candle_timestamp = int(candle.get('timestamp', 0))

            # 3. Filter by price zone (including time bounds if applicable)
            zone_match = self._check_price_zones(
                price,
                price_zones,
                "SHORT" if is_swing_high else "LONG",
                timestamp=candle_timestamp
            )

            if price_zones and not zone_match:
                continue

            # 4. Filter by volume z-score
            if volume_enabled:
                zscore = self._calculate_volume_zscore(candles, i, lookback)
                if zscore < min_zscore:
                    logger.debug(f"[{self.name}] {symbol}: Swing rejected - z-score {zscore:.2f} < {min_zscore}")
                    continue
            else:
                zscore = 0.0

            # 5. Valid signal!
            signal = SwingSignal(
                signal_type="SWING_HIGH" if is_swing_high else "SWING_LOW",
                timestamp=int(candle.get('timestamp', 0)),
                price=price,
                volume_zscore=round(zscore, 2),
                direction="SHORT" if is_swing_high else "LONG",
                symbol=symbol,
                interval=interval,
                zone_id=zone_match.get('id') if zone_match else None
            )
            signals.append(signal)

            logger.info(
                f"[{self.name}] {symbol}/{interval}: {signal.signal_type} @ ${price:.2f} "
                f"(z-score: {zscore:.2f}, direction: {signal.direction})"
            )

        if signals:
            logger.info(f"[{self.name}] {symbol}/{interval}: Detected {len(signals)} swing signals")

        return signals

    def _is_swing_high(self, candles: List[Dict], idx: int, bars: int) -> bool:
        """Check if candle at idx is a swing high (local maximum)"""
        current_high = float(candles[idx].get('high', 0))

        # Check left side
        for i in range(idx - bars, idx):
            if float(candles[i].get('high', 0)) >= current_high:
                return False

        # Check right side
        for i in range(idx + 1, idx + bars + 1):
            if float(candles[i].get('high', 0)) >= current_high:
                return False

        return True

    def _is_swing_low(self, candles: List[Dict], idx: int, bars: int) -> bool:
        """Check if candle at idx is a swing low (local minimum)"""
        current_low = float(candles[idx].get('low', 0))

        # Check left side
        for i in range(idx - bars, idx):
            if float(candles[i].get('low', 0)) <= current_low:
                return False

        # Check right side
        for i in range(idx + 1, idx + bars + 1):
            if float(candles[i].get('low', 0)) <= current_low:
                return False

        return True

    def _calculate_volume_zscore(self, candles: List[Dict], idx: int, lookback: int) -> float:
        """Calculate z-score of volume at idx compared to previous N candles"""
        if idx < lookback:
            return 0.0

        # Get volumes for lookback period (excluding current candle)
        volumes = [float(candles[i].get('volume', 0)) for i in range(idx - lookback, idx)]

        if not volumes or len(volumes) < 2:
            return 0.0

        current_volume = float(candles[idx].get('volume', 0))
        mean = statistics.mean(volumes)

        try:
            stdev = statistics.stdev(volumes)
        except statistics.StatisticsError:
            return 0.0

        if stdev == 0:
            return 0.0

        zscore = (current_volume - mean) / stdev
        return zscore

    def _check_price_zones(
        self,
        price: float,
        zones: List[Dict],
        signal_direction: str,
        timestamp: int = None
    ) -> Optional[Dict]:
        """
        Check if price is within any valid zone with nested zone priority.

        Priority system:
        1. Time-bound zones (rectangles) have highest priority when price AND time are within bounds
        2. Manual zones (no time bounds) have lower priority
        3. If a time-bound zone contains the price but time is outside bounds, fall back to manual zones

        Args:
            price: Current price
            zones: List of zone configs with min, max, direction
            signal_direction: The direction of the signal (LONG or SHORT)
            timestamp: Signal timestamp (for time-bound zones)

        Returns:
            The matching zone dict, or None if no match
        """
        # Separate zones into time-bound (rectangles) and manual (no time bounds)
        time_bound_zones = []
        manual_zones = []

        for zone in zones:
            if not zone.get('enabled', True):
                continue
            if zone.get('timeBound', False) and zone.get('timeStart') and zone.get('timeEnd'):
                time_bound_zones.append(zone)
            else:
                manual_zones.append(zone)

        # PRIORITY 1: Check time-bound zones first (rectangles)
        # These have priority when price AND time are within bounds
        for zone in time_bound_zones:
            min_price = zone.get('min', 0)
            max_price = zone.get('max', float('inf'))
            zone_direction = zone.get('direction', 'BOTH')
            time_start = zone.get('timeStart')
            time_end = zone.get('timeEnd')

            # Check if price is within zone
            if min_price <= price <= max_price:
                # Check if timestamp is within time bounds
                if timestamp and time_start <= timestamp <= time_end:
                    # Time-bound zone is ACTIVE - it has priority
                    # Check direction compatibility
                    if zone_direction == 'BOTH' or zone_direction == signal_direction:
                        logger.info(
                            f"[{self.name}] Time-bound zone {zone.get('id')} MATCHED (priority) - "
                            f"price ${price:.2f} in [{min_price:.2f}, {max_price:.2f}], "
                            f"direction={zone_direction}, signal={signal_direction}"
                        )
                        return zone
                    else:
                        # Time-bound zone is active but direction doesn't match
                        # This BLOCKS the signal even if a manual zone would allow it
                        logger.debug(
                            f"[{self.name}] Time-bound zone {zone.get('id')} BLOCKS signal - "
                            f"zone direction={zone_direction}, signal direction={signal_direction}"
                        )
                        return None  # Block the signal, don't fall through to manual zones

        # PRIORITY 2: Check manual zones (no time bounds)
        # Only reached if no active time-bound zone matched or blocked
        for zone in manual_zones:
            min_price = zone.get('min', 0)
            max_price = zone.get('max', float('inf'))
            zone_direction = zone.get('direction', 'BOTH')

            # Check if price is within zone
            if min_price <= price <= max_price:
                # Check direction compatibility
                if zone_direction == 'BOTH' or zone_direction == signal_direction:
                    logger.info(
                        f"[{self.name}] Manual zone {zone.get('id')} MATCHED - "
                        f"price ${price:.2f} in [{min_price:.2f}, {max_price:.2f}], "
                        f"direction={zone_direction}"
                    )
                    return zone
                else:
                    logger.debug(
                        f"[{self.name}] Manual zone {zone.get('id')} direction mismatch - "
                        f"zone={zone_direction}, signal={signal_direction}"
                    )

        return None


# Singleton instance
_detector_instance: Optional[SwingDetector] = None


def get_swing_detector() -> SwingDetector:
    """Get or create the singleton SwingDetector instance"""
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = SwingDetector()
    return _detector_instance
