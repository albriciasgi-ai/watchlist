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
import bisect
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
        config: Dict,
        vwap_data: Optional[List[Dict]] = None
    ) -> List[SwingSignal]:
        """
        Detect swing signals in candles.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            interval: Timeframe (e.g., "1", "60")
            candles: List of candle dicts with keys: timestamp, open, high, low, close, volume
            config: Detection configuration
            vwap_data: Optional VWAP data from VWAPService for VWAP filter validation

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

        # VWAP filter config
        vwap_config = config.get('vwapFilter', {})
        vwap_filter_enabled = vwap_config.get('enabled', False)
        vwap_deviations = vwap_config.get('deviations', [1, 2, 3])
        vwap_margin_percent = vwap_config.get('marginPercent', 20)
        skip_volume_in_rectangle = vwap_config.get('skipVolumeInRectangle', False)

        # Build VWAP data map for quick lookup by timestamp
        vwap_map = {}
        vwap_timestamps_sorted = []  # Sorted list for binary search
        if vwap_filter_enabled and vwap_data:
            for point in vwap_data:
                ts = point.get('timestamp')
                if ts:
                    vwap_map[ts] = point

            if vwap_map:
                vwap_timestamps_sorted = sorted(vwap_map.keys())
                # Log sample timestamps for debugging
                sample_vwap_ts = vwap_timestamps_sorted[:3]
                sample_candle_ts = [c.get('timestamp') for c in candles[:3]] if candles else []
                logger.info(
                    f"[{self.name}] {symbol}: VWAP map built with {len(vwap_map)} points. "
                    f"Sample VWAP ts: {sample_vwap_ts}, Sample candle ts: {sample_candle_ts}"
                )

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

            # 4. Check if we're inside ANY active rectangle (independent of zone_match)
            # This is used for VWAP filter and volume skip logic
            is_in_rectangle = self._is_inside_active_rectangle(price, candle_timestamp, price_zones)

            # 5. VWAP Filter - only applies when inside a rectangle
            if vwap_filter_enabled and is_in_rectangle:
                logger.debug(
                    f"[{self.name}] {symbol}: Inside rectangle, price=${price:.2f}, ts={candle_timestamp}"
                )

            if vwap_filter_enabled and is_in_rectangle:
                vwap_direction = self._check_vwap_filter(
                    price,
                    candle_timestamp,
                    vwap_map,
                    vwap_timestamps_sorted,
                    vwap_deviations,
                    vwap_margin_percent
                )

                if vwap_direction is None:
                    logger.debug(f"[{self.name}] {symbol}: Swing rejected - price between VWAP bands")
                    continue

                # Get the zone's direction constraint (if any)
                zone_direction = zone_match.get('direction', 'BOTH') if zone_match else 'BOTH'
                signal_direction = "SHORT" if is_swing_high else "LONG"

                # VWAP filter logic depends on zone direction:
                # - If zone is BOTH: VWAP determines allowed direction
                # - If zone has specific direction: VWAP validates price position is correct for that direction
                #   (LONG needs price below bands, SHORT needs price above bands)

                if vwap_direction == "BOTH":
                    # No VWAP data, allow signal
                    pass
                elif zone_direction == "BOTH":
                    # Zone allows both, let VWAP determine direction
                    if vwap_direction != signal_direction:
                        logger.debug(
                            f"[{self.name}] {symbol}: Swing rejected - VWAP wants {vwap_direction}, "
                            f"but signal is {signal_direction}"
                        )
                        continue
                else:
                    # Zone has specific direction - validate VWAP position matches zone direction
                    # For LONG zone: price should be below bands (vwap_direction = LONG)
                    # For SHORT zone: price should be above bands (vwap_direction = SHORT)
                    if vwap_direction != zone_direction:
                        logger.debug(
                            f"[{self.name}] {symbol}: Swing rejected - zone wants {zone_direction}, "
                            f"but price position indicates {vwap_direction}"
                        )
                        continue

            # 6. Filter by volume z-score
            # Skip volume filter if inside a rectangle and skipVolumeInRectangle is enabled
            should_check_volume = volume_enabled and not (is_in_rectangle and skip_volume_in_rectangle)

            if should_check_volume:
                zscore = self._calculate_volume_zscore(candles, i, lookback)
                if zscore < min_zscore:
                    logger.debug(f"[{self.name}] {symbol}: Swing rejected - z-score {zscore:.2f} < {min_zscore}")
                    continue
            else:
                zscore = 0.0
                if is_in_rectangle and skip_volume_in_rectangle and volume_enabled:
                    logger.debug(f"[{self.name}] {symbol}: Volume filter skipped (inside rectangle)")

            # 7. Valid signal!
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

            # DEBUG level for individual signals (only visible with DEBUG logging)
            logger.debug(
                f"[{self.name}] {symbol}/{interval}: {signal.signal_type} @ ${price:.2f} "
                f"(z-score: {zscore:.2f}, direction: {signal.direction})"
            )

        # Summary log (INFO level) - one line instead of thousands
        if signals:
            high_count = sum(1 for s in signals if s.signal_type == "SWING_HIGH")
            low_count = sum(1 for s in signals if s.signal_type == "SWING_LOW")
            logger.info(
                f"[{self.name}] {symbol}/{interval}: Detected {len(signals)} swing signals "
                f"({high_count} HIGH, {low_count} LOW)"
            )

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
                    logger.debug(
                        f"[{self.name}] Zone {zone.get('id')[:20]} matched - "
                        f"price ${price:.2f} in [{min_price:.2f}, {max_price:.2f}]"
                    )
                    return zone
                else:
                    logger.debug(
                        f"[{self.name}] Manual zone {zone.get('id')} direction mismatch - "
                        f"zone={zone_direction}, signal={signal_direction}"
                    )

        return None

    def _is_inside_active_rectangle(
        self,
        price: float,
        timestamp: int,
        zones: List[Dict]
    ) -> bool:
        """
        Check if price is inside ANY active rectangle zone.
        A zone is considered a rectangle if it has a sourceRectId (created from drawing).
        This is independent of direction matching - just checks if we're inside a rectangle.

        Args:
            price: Current price
            timestamp: Current timestamp
            zones: List of all zone configs

        Returns:
            True if inside any active rectangle zone, False otherwise
        """
        for zone in zones:
            if not zone.get('enabled', True):
                continue

            # A zone is from a rectangle if it has sourceRectId
            if not zone.get('sourceRectId'):
                continue

            min_price = zone.get('min', 0)
            max_price = zone.get('max', float('inf'))

            # Check if price is within the rectangle's price range
            if min_price <= price <= max_price:
                # If timeBound, also check time range
                if zone.get('timeBound', False):
                    time_start = zone.get('timeStart')
                    time_end = zone.get('timeEnd')
                    if time_start and time_end:
                        if not (time_start <= timestamp <= time_end):
                            continue  # Outside time range, check next zone

                logger.debug(
                    f"[{self.name}] Price ${price:.2f} is inside rectangle zone {zone.get('id')}"
                )
                return True

        return False

    def _check_vwap_filter(
        self,
        price: float,
        timestamp: int,
        vwap_map: Dict[int, Dict],
        vwap_timestamps_sorted: List[int],
        deviations: List[int],
        margin_percent: float
    ) -> Optional[str]:
        """
        Check if price is outside VWAP bands and determine allowed direction.

        Logic:
        - Price BELOW lower bands (with margin tolerance) → LONG signals allowed
        - Price ABOVE upper bands (with margin tolerance) → SHORT signals allowed
        - Price BETWEEN the bands (inside deviations) → NO signals allowed (returns None)
        - Margin allows some tolerance: price can be slightly inside the band

        Args:
            price: Current candle price
            timestamp: Candle timestamp to lookup VWAP data
            vwap_map: Map of timestamp -> VWAP point data
            vwap_timestamps_sorted: Sorted list of VWAP timestamps for binary search
            deviations: List of deviations to check (e.g., [1, 2, 3])
            margin_percent: % tolerance - how far inside the band price can be

        Returns:
            "LONG" if below lower band, "SHORT" if above upper band, None if between bands
        """
        vwap_point = vwap_map.get(timestamp)
        if not vwap_point and vwap_timestamps_sorted:
            # No exact match - use binary search to find closest VWAP point <= this timestamp
            idx = bisect.bisect_right(vwap_timestamps_sorted, timestamp)
            if idx > 0:
                closest_ts = vwap_timestamps_sorted[idx - 1]
                vwap_point = vwap_map.get(closest_ts)

        if not vwap_point:
            # No VWAP data before this timestamp - skip VWAP validation
            return "BOTH"

        bands = vwap_point.get('bands', {})
        vwap_value = vwap_point.get('vwap')

        if not bands or not vwap_value:
            logger.debug(f"[{self.name}] VWAP filter: No bands or VWAP value")
            return None

        margin_factor = margin_percent / 100.0

        # Check each deviation level (from innermost to outermost)
        # We want to find if price is outside ANY of the selected deviations
        for dev in sorted(deviations):
            upper_key = f'upper_{dev}'
            lower_key = f'lower_{dev}'

            upper_band = bands.get(upper_key)
            lower_band = bands.get(lower_key)

            if upper_band is None or lower_band is None:
                continue

            # Calculate the band distance from VWAP for margin calculation
            upper_distance = upper_band - vwap_value
            lower_distance = vwap_value - lower_band

            # Calculate margin (tolerance zone)
            # Margin allows price to be slightly INSIDE the band
            upper_margin = upper_distance * margin_factor
            lower_margin = lower_distance * margin_factor

            # Upper threshold: price must be above (upper_band - margin) for SHORT
            upper_threshold = upper_band - upper_margin

            # Lower threshold: price must be below (lower_band + margin) for LONG
            lower_threshold = lower_band + lower_margin

            # Check if price is ABOVE the upper band (with margin tolerance) → SHORT
            if price >= upper_threshold:
                logger.info(
                    f"[{self.name}] VWAP filter PASSED: price ${price:.2f} >= upper_{dev} threshold "
                    f"(${upper_threshold:.2f}, band=${upper_band:.2f}, margin={margin_percent}%) → SHORT"
                )
                return "SHORT"

            # Check if price is BELOW the lower band (with margin tolerance) → LONG
            if price <= lower_threshold:
                logger.info(
                    f"[{self.name}] VWAP filter PASSED: price ${price:.2f} <= lower_{dev} threshold "
                    f"(${lower_threshold:.2f}, band=${lower_band:.2f}, margin={margin_percent}%) → LONG"
                )
                return "LONG"

        # Price is between all the bands - no signal allowed
        logger.debug(
            f"[{self.name}] VWAP filter REJECTED: price ${price:.2f} is between VWAP bands "
            f"(VWAP=${vwap_value:.2f})"
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
