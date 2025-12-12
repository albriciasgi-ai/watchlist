# -*- coding: utf-8 -*-
"""
Pattern Detector Extended Module
=================================
Detects continuation patterns, trend start patterns, and momentum patterns
Classifies patterns based on location and context
"""

import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum


class PatternType(Enum):
    """Pattern classification types"""
    REVERSAL = "reversal"  # At trend extreme (rejection patterns)
    CONTINUATION = "continuation"  # In middle of trend
    TREND_START = "trend_start"  # Breakout from range
    MOMENTUM = "momentum"  # Strong directional move


class PatternName(Enum):
    """Specific pattern names"""
    # Continuation patterns
    FLAG_BULL = "bull_flag"
    FLAG_BEAR = "bear_flag"
    PENNANT_BULL = "bull_pennant"
    PENNANT_BEAR = "bear_pennant"

    # Trend start patterns
    BREAKOUT_BULL = "bull_breakout"
    BREAKOUT_BEAR = "bear_breakout"

    # Momentum patterns
    THREE_WHITE_SOLDIERS = "three_white_soldiers"
    THREE_BLACK_CROWS = "three_black_crows"
    MARUBOZU_BULL = "bull_marubozu"
    MARUBOZU_BEAR = "bear_marubozu"

    # Reversal patterns (from existing rejection detector)
    HAMMER = "hammer"
    SHOOTING_STAR = "shooting_star"
    ENGULFING_BULL = "bull_engulfing"
    ENGULFING_BEAR = "bear_engulfing"
    DOJI_DRAGONFLY = "dragonfly_doji"
    DOJI_GRAVESTONE = "gravestone_doji"


@dataclass
class DetectedPattern:
    """Represents a detected pattern with context"""
    timestamp: int
    pattern_type: str  # PatternType enum value
    pattern_name: str  # PatternName enum value
    direction: str  # 'bullish' or 'bearish'
    confidence: float  # 0-100

    # Pattern-specific metrics
    body_size: float
    wick_size: float
    volume_ratio: float  # Relative to average

    # Context information
    in_trend: bool
    trend_direction: Optional[str]  # From TrendAnalyzer
    trend_strength: float
    near_level: bool
    level_distance: Optional[float]
    level_type: Optional[str]  # 'vwap', 'fibonacci', 'volume_profile', etc.

    # Scoring components
    pattern_quality: float  # 0-100
    volume_score: float  # 0-100
    level_proximity: float  # 0-100

    # Metadata
    candle_index: int
    price: float


class PatternDetectorExtended:
    """
    Extended pattern detector that identifies continuation, trend start, and momentum patterns

    Classifies patterns based on location:
    - At extreme → REVERSAL (rejection patterns)
    - In trend → CONTINUATION (flags, pennants)
    - At breakout → TREND_START (breakouts)
    - Strong consecutive → MOMENTUM (soldiers, crows, marubozu)
    """

    def __init__(self):
        # Pattern detection parameters
        self.min_body_percent = 0.3  # Minimum body size as % of total range
        self.min_volume_ratio = 1.2  # Minimum volume vs average
        self.lookback_volume = 20  # Candles for volume average

        # Trend parameters
        self.trend_lookback = 100  # Candles for trend analysis
        self.strong_trend_threshold = 60.0  # Min strength to consider "in trend"

        # Level proximity parameters
        self.level_tolerance = 0.5  # % distance to consider "near" a level


    def detect_patterns(
        self,
        candles: List[Dict],
        trend_analysis: Optional[Dict] = None,
        vwap_levels: Optional[List[Dict]] = None,
        fibonacci_levels: Optional[List[Dict]] = None,
        volume_profile_levels: Optional[List[Dict]] = None
    ) -> List[DetectedPattern]:
        """
        Detect all pattern types in the candles

        Args:
            candles: List of candles (most recent last)
            trend_analysis: Optional trend analysis from TrendAnalyzer
            vwap_levels: Optional VWAP levels for context
            fibonacci_levels: Optional Fibonacci levels for context
            volume_profile_levels: Optional VP levels (POC, VAH, VAL)

        Returns:
            List of detected patterns with classification
        """
        if not candles or len(candles) < 3:
            return []

        patterns = []

        # Calculate volume average for comparison
        avg_volume = self._calculate_average_volume(candles)

        # Combine all levels for proximity checks
        all_levels = self._combine_levels(vwap_levels, fibonacci_levels, volume_profile_levels)

        # Detect each pattern type
        for i in range(2, len(candles)):  # Start at index 2 for 3-candle patterns
            current_candle = candles[i]

            # Skip if in_progress candle
            if current_candle.get('in_progress', False):
                continue

            # Detect continuation patterns (flags, pennants)
            continuation_pattern = self._detect_continuation_pattern(
                candles, i, trend_analysis, avg_volume, all_levels
            )
            if continuation_pattern:
                patterns.append(continuation_pattern)

            # Detect trend start patterns (breakouts)
            breakout_pattern = self._detect_breakout_pattern(
                candles, i, trend_analysis, avg_volume, all_levels
            )
            if breakout_pattern:
                patterns.append(breakout_pattern)

            # Detect momentum patterns (soldiers, crows, marubozu)
            momentum_pattern = self._detect_momentum_pattern(
                candles, i, trend_analysis, avg_volume, all_levels
            )
            if momentum_pattern:
                patterns.append(momentum_pattern)

        return patterns


    # ==================== CONTINUATION PATTERNS ====================

    def _detect_continuation_pattern(
        self,
        candles: List[Dict],
        index: int,
        trend_analysis: Optional[Dict],
        avg_volume: float,
        levels: List[Dict]
    ) -> Optional[DetectedPattern]:
        """
        Detect continuation patterns (flags, pennants)

        These appear in the middle of a trend and signal continuation
        """
        # Need to be in a strong trend for continuation pattern
        if not trend_analysis or trend_analysis.get('strength', 0) < self.strong_trend_threshold:
            return None

        trend_dir = trend_analysis.get('direction')
        if trend_dir == 'sideways':
            return None

        # Look for consolidation after strong move (flag pattern)
        flag_pattern = self._detect_flag(candles, index, trend_dir, avg_volume, levels)
        if flag_pattern:
            return flag_pattern

        return None


    def _detect_flag(
        self,
        candles: List[Dict],
        index: int,
        trend_dir: str,
        avg_volume: float,
        levels: List[Dict]
    ) -> Optional[DetectedPattern]:
        """
        Detect flag pattern: consolidation after strong move

        Bull flag: Strong up move → small down/sideways consolidation → breakout up
        Bear flag: Strong down move → small up/sideways consolidation → breakout down
        """
        if index < 5:
            return None  # Need at least 5 candles

        # Look at last 5 candles
        prev_candles = candles[index-4:index+1]
        current = prev_candles[-1]

        # Calculate price range of consolidation
        highs = [c['high'] for c in prev_candles]
        lows = [c['low'] for c in prev_candles]
        consolidation_range = (max(highs) - min(lows)) / min(lows)

        # Flag should be tight consolidation (< 3% range)
        if consolidation_range > 0.03:
            return None

        # Check for breakout from consolidation
        if trend_dir == 'uptrend':
            # Bull flag: breakout above consolidation high
            consolidation_high = max(highs[:-1])  # Exclude current candle
            if current['close'] <= consolidation_high:
                return None

            pattern_name = PatternName.FLAG_BULL.value
            direction = 'bullish'

        else:  # downtrend
            # Bear flag: breakout below consolidation low
            consolidation_low = min(lows[:-1])
            if current['close'] >= consolidation_low:
                return None

            pattern_name = PatternName.FLAG_BEAR.value
            direction = 'bearish'

        # Calculate metrics
        body_size = abs(current['close'] - current['open']) / current['close']
        total_range = current['high'] - current['low']
        wick_size = (total_range - abs(current['close'] - current['open'])) / current['close']
        volume_ratio = current['volume'] / avg_volume if avg_volume > 0 else 1.0

        # Quality: breakout candle should have decent body and volume
        pattern_quality = min(100, (body_size * 100) + (volume_ratio * 20))
        volume_score = min(100, volume_ratio * 50)

        # Check proximity to levels
        near_level, level_dist, level_type = self._check_level_proximity(
            current['close'], levels
        )
        level_proximity = self._calculate_level_proximity_score(level_dist)

        # Calculate confidence
        confidence = (pattern_quality * 0.4) + (volume_score * 0.3) + (level_proximity * 0.3)

        return DetectedPattern(
            timestamp=current['timestamp'],
            pattern_type=PatternType.CONTINUATION.value,
            pattern_name=pattern_name,
            direction=direction,
            confidence=confidence,
            body_size=body_size,
            wick_size=wick_size,
            volume_ratio=volume_ratio,
            in_trend=True,
            trend_direction=trend_dir,
            trend_strength=0.0,  # Will be filled by caller if available
            near_level=near_level,
            level_distance=level_dist,
            level_type=level_type,
            pattern_quality=pattern_quality,
            volume_score=volume_score,
            level_proximity=level_proximity,
            candle_index=index,
            price=current['close']
        )


    # ==================== TREND START PATTERNS ====================

    def _detect_breakout_pattern(
        self,
        candles: List[Dict],
        index: int,
        trend_analysis: Optional[Dict],
        avg_volume: float,
        levels: List[Dict]
    ) -> Optional[DetectedPattern]:
        """
        Detect trend start patterns (breakouts from ranges)

        These appear when price breaks out of consolidation/range
        """
        # Should NOT be in a strong trend (breaking out of range/sideways)
        if trend_analysis and trend_analysis.get('strength', 0) > self.strong_trend_threshold:
            return None

        if index < 10:
            return None

        # Look for range breakout
        lookback = min(20, index)
        prev_candles = candles[index-lookback:index]
        current = candles[index]

        # Calculate range high/low
        range_high = max(c['high'] for c in prev_candles)
        range_low = min(c['low'] for c in prev_candles)
        range_size = (range_high - range_low) / range_low

        # Need a defined range (not too wide)
        if range_size > 0.05:  # More than 5% range = not a consolidation
            return None

        # Check for breakout
        body_size = abs(current['close'] - current['open']) / current['close']
        total_range = current['high'] - current['low']
        wick_size = (total_range - abs(current['close'] - current['open'])) / current['close']
        volume_ratio = current['volume'] / avg_volume if avg_volume > 0 else 1.0

        # Breakout requires strong volume
        if volume_ratio < self.min_volume_ratio:
            return None

        if current['close'] > range_high * 1.001:
            # Bull breakout
            pattern_name = PatternName.BREAKOUT_BULL.value
            direction = 'bullish'
        elif current['close'] < range_low * 0.999:
            # Bear breakout
            pattern_name = PatternName.BREAKOUT_BEAR.value
            direction = 'bearish'
        else:
            return None

        # Quality: strong body + high volume = better breakout
        pattern_quality = min(100, (body_size * 150) + (volume_ratio * 25))
        volume_score = min(100, volume_ratio * 50)

        # Check proximity to levels
        near_level, level_dist, level_type = self._check_level_proximity(
            current['close'], levels
        )
        level_proximity = self._calculate_level_proximity_score(level_dist)

        # Calculate confidence
        confidence = (pattern_quality * 0.5) + (volume_score * 0.4) + (level_proximity * 0.1)

        return DetectedPattern(
            timestamp=current['timestamp'],
            pattern_type=PatternType.TREND_START.value,
            pattern_name=pattern_name,
            direction=direction,
            confidence=confidence,
            body_size=body_size,
            wick_size=wick_size,
            volume_ratio=volume_ratio,
            in_trend=False,
            trend_direction='sideways',
            trend_strength=0.0,
            near_level=near_level,
            level_distance=level_dist,
            level_type=level_type,
            pattern_quality=pattern_quality,
            volume_score=volume_score,
            level_proximity=level_proximity,
            candle_index=index,
            price=current['close']
        )


    # ==================== MOMENTUM PATTERNS ====================

    def _detect_momentum_pattern(
        self,
        candles: List[Dict],
        index: int,
        trend_analysis: Optional[Dict],
        avg_volume: float,
        levels: List[Dict]
    ) -> Optional[DetectedPattern]:
        """
        Detect momentum patterns (three white soldiers, three black crows, marubozu)

        These show strong consecutive candles indicating force/momentum
        """
        # Three white soldiers / three black crows
        if index >= 2:
            soldiers_pattern = self._detect_three_soldiers_crows(
                candles, index, trend_analysis, avg_volume, levels
            )
            if soldiers_pattern:
                return soldiers_pattern

        # Marubozu (strong single candle)
        marubozu_pattern = self._detect_marubozu(
            candles, index, trend_analysis, avg_volume, levels
        )
        if marubozu_pattern:
            return marubozu_pattern

        return None


    def _detect_three_soldiers_crows(
        self,
        candles: List[Dict],
        index: int,
        trend_analysis: Optional[Dict],
        avg_volume: float,
        levels: List[Dict]
    ) -> Optional[DetectedPattern]:
        """
        Detect three white soldiers (bullish) or three black crows (bearish)

        Three consecutive candles closing higher/lower with good bodies
        """
        if index < 2:
            return None

        # Get last 3 candles
        candle1 = candles[index - 2]
        candle2 = candles[index - 1]
        candle3 = candles[index]

        # Check for three white soldiers (bullish)
        if (candle1['close'] > candle1['open'] and
            candle2['close'] > candle2['open'] and
            candle3['close'] > candle3['open'] and
            candle2['close'] > candle1['close'] and
            candle3['close'] > candle2['close']):

            # All should have decent bodies (> 30% of range)
            body1 = abs(candle1['close'] - candle1['open']) / (candle1['high'] - candle1['low'])
            body2 = abs(candle2['close'] - candle2['open']) / (candle2['high'] - candle2['low'])
            body3 = abs(candle3['close'] - candle3['open']) / (candle3['high'] - candle3['low'])

            if body1 < self.min_body_percent or body2 < self.min_body_percent or body3 < self.min_body_percent:
                return None

            pattern_name = PatternName.THREE_WHITE_SOLDIERS.value
            direction = 'bullish'
            current = candle3

        # Check for three black crows (bearish)
        elif (candle1['close'] < candle1['open'] and
              candle2['close'] < candle2['open'] and
              candle3['close'] < candle3['open'] and
              candle2['close'] < candle1['close'] and
              candle3['close'] < candle2['close']):

            body1 = abs(candle1['close'] - candle1['open']) / (candle1['high'] - candle1['low'])
            body2 = abs(candle2['close'] - candle2['open']) / (candle2['high'] - candle2['low'])
            body3 = abs(candle3['close'] - candle3['open']) / (candle3['high'] - candle3['low'])

            if body1 < self.min_body_percent or body2 < self.min_body_percent or body3 < self.min_body_percent:
                return None

            pattern_name = PatternName.THREE_BLACK_CROWS.value
            direction = 'bearish'
            current = candle3

        else:
            return None

        # Calculate metrics
        body_size = abs(current['close'] - current['open']) / current['close']
        total_range = current['high'] - current['low']
        wick_size = (total_range - abs(current['close'] - current['open'])) / current['close']
        volume_ratio = current['volume'] / avg_volume if avg_volume > 0 else 1.0

        # Quality: consistent momentum across 3 candles
        avg_body = (body1 + body2 + body3) / 3
        pattern_quality = min(100, avg_body * 200)
        volume_score = min(100, volume_ratio * 50)

        # Check proximity to levels
        near_level, level_dist, level_type = self._check_level_proximity(
            current['close'], levels
        )
        level_proximity = self._calculate_level_proximity_score(level_dist)

        # Momentum patterns are less dependent on levels
        confidence = (pattern_quality * 0.6) + (volume_score * 0.3) + (level_proximity * 0.1)

        # Get trend context
        in_trend = False
        trend_dir = 'sideways'
        trend_strength = 0.0
        if trend_analysis:
            trend_strength = trend_analysis.get('strength', 0)
            trend_dir = trend_analysis.get('direction', 'sideways')
            in_trend = trend_strength >= self.strong_trend_threshold

        return DetectedPattern(
            timestamp=current['timestamp'],
            pattern_type=PatternType.MOMENTUM.value,
            pattern_name=pattern_name,
            direction=direction,
            confidence=confidence,
            body_size=body_size,
            wick_size=wick_size,
            volume_ratio=volume_ratio,
            in_trend=in_trend,
            trend_direction=trend_dir,
            trend_strength=trend_strength,
            near_level=near_level,
            level_distance=level_dist,
            level_type=level_type,
            pattern_quality=pattern_quality,
            volume_score=volume_score,
            level_proximity=level_proximity,
            candle_index=index,
            price=current['close']
        )


    def _detect_marubozu(
        self,
        candles: List[Dict],
        index: int,
        trend_analysis: Optional[Dict],
        avg_volume: float,
        levels: List[Dict]
    ) -> Optional[DetectedPattern]:
        """
        Detect marubozu: very strong candle with almost no wicks

        Bull marubozu: open = low, close = high (or very close)
        Bear marubozu: open = high, close = low (or very close)
        """
        current = candles[index]

        total_range = current['high'] - current['low']
        if total_range == 0:
            return None

        body_size = abs(current['close'] - current['open'])
        body_percent = body_size / total_range

        # Marubozu should have > 90% body
        if body_percent < 0.90:
            return None

        # Check direction
        if current['close'] > current['open']:
            # Bull marubozu
            pattern_name = PatternName.MARUBOZU_BULL.value
            direction = 'bullish'
        elif current['close'] < current['open']:
            # Bear marubozu
            pattern_name = PatternName.MARUBOZU_BEAR.value
            direction = 'bearish'
        else:
            return None

        # Calculate metrics
        body_size_percent = body_size / current['close']
        wick_size = (total_range - body_size) / current['close']
        volume_ratio = current['volume'] / avg_volume if avg_volume > 0 else 1.0

        # Quality: very high for marubozu (clean candle)
        pattern_quality = min(100, body_percent * 100)
        volume_score = min(100, volume_ratio * 50)

        # Check proximity to levels
        near_level, level_dist, level_type = self._check_level_proximity(
            current['close'], levels
        )
        level_proximity = self._calculate_level_proximity_score(level_dist)

        confidence = (pattern_quality * 0.5) + (volume_score * 0.3) + (level_proximity * 0.2)

        # Get trend context
        in_trend = False
        trend_dir = 'sideways'
        trend_strength = 0.0
        if trend_analysis:
            trend_strength = trend_analysis.get('strength', 0)
            trend_dir = trend_analysis.get('direction', 'sideways')
            in_trend = trend_strength >= self.strong_trend_threshold

        return DetectedPattern(
            timestamp=current['timestamp'],
            pattern_type=PatternType.MOMENTUM.value,
            pattern_name=pattern_name,
            direction=direction,
            confidence=confidence,
            body_size=body_size_percent,
            wick_size=wick_size,
            volume_ratio=volume_ratio,
            in_trend=in_trend,
            trend_direction=trend_dir,
            trend_strength=trend_strength,
            near_level=near_level,
            level_distance=level_dist,
            level_type=level_type,
            pattern_quality=pattern_quality,
            volume_score=volume_score,
            level_proximity=level_proximity,
            candle_index=index,
            price=current['close']
        )


    # ==================== HELPER METHODS ====================

    def _calculate_average_volume(self, candles: List[Dict]) -> float:
        """Calculate average volume over lookback period"""
        lookback = min(self.lookback_volume, len(candles))
        recent_candles = candles[-lookback:]

        total_volume = sum(c['volume'] for c in recent_candles)
        return total_volume / lookback if lookback > 0 else 1.0


    def _combine_levels(
        self,
        vwap_levels: Optional[List[Dict]],
        fibonacci_levels: Optional[List[Dict]],
        volume_profile_levels: Optional[List[Dict]]
    ) -> List[Dict]:
        """Combine levels from all sources into single list"""
        all_levels = []

        if vwap_levels:
            all_levels.extend(vwap_levels)

        if fibonacci_levels:
            all_levels.extend(fibonacci_levels)

        if volume_profile_levels:
            all_levels.extend(volume_profile_levels)

        return all_levels


    def _check_level_proximity(
        self,
        price: float,
        levels: List[Dict]
    ) -> Tuple[bool, Optional[float], Optional[str]]:
        """
        Check if price is near any level

        Returns:
            Tuple of (is_near, distance_percent, level_type)
        """
        if not levels:
            return False, None, None

        closest_level = None
        closest_distance = float('inf')
        closest_type = None

        for level in levels:
            level_price = level.get('price')
            if level_price is None:
                continue

            distance_percent = abs(price - level_price) / price * 100

            if distance_percent < closest_distance:
                closest_distance = distance_percent
                closest_level = level_price
                closest_type = level.get('type', 'unknown')

        is_near = closest_distance <= self.level_tolerance

        return is_near, closest_distance if is_near else None, closest_type if is_near else None


    def _calculate_level_proximity_score(self, distance_percent: Optional[float]) -> float:
        """
        Convert distance to a 0-100 score

        Closer = higher score
        """
        if distance_percent is None:
            return 0.0

        # Within 0.1% = 100 score
        # At 0.5% tolerance = 0 score
        # Linear interpolation
        score = max(0, 100 - (distance_percent / self.level_tolerance * 100))
        return score


# Singleton instance for use across API
pattern_detector_extended = PatternDetectorExtended()
