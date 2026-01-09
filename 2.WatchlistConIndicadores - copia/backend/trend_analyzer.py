# -*- coding: utf-8 -*-
"""
Trend Analyzer Module
=====================
Analyzes trend strength and direction using swing patterns and linear regression
"""

import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass


@dataclass
class SwingPoint:
    """Represents a swing high or swing low point"""
    timestamp: int
    price: float
    index: int
    swing_type: str  # 'high' or 'low'


@dataclass
class TrendAnalysis:
    """Results of trend analysis"""
    strength: float  # 0-100
    direction: str  # 'uptrend', 'downtrend', 'sideways'
    swing_consistency_score: float  # 0-100
    progression_angle_score: float  # 0-100
    swing_pattern: str  # 'HH-HL', 'LH-LL', 'mixed', 'none'
    slope: float  # Linear regression slope
    swing_points: List[SwingPoint]
    confidence: float  # 0-100


class TrendAnalyzer:
    """
    Analyzes trend strength and direction using two components:

    1. Swing Consistency (60% weight):
       - Detects Higher Highs + Higher Lows (HH-HL) for uptrends
       - Detects Lower Highs + Lower Lows (LH-LL) for downtrends
       - Mixed or no pattern indicates sideways/weak trend

    2. Progression Angle (40% weight):
       - Uses linear regression on swing points
       - Steep positive slope = strong uptrend
       - Steep negative slope = strong downtrend
       - Flat slope = sideways

    Final strength = (swing_consistency * 0.6) + (progression_angle * 0.4)
    """

    def __init__(self):
        self.swing_lookback = 5  # Bars before/after to confirm swing point
        self.min_swings = 3  # Minimum swing points needed for analysis
        self.angle_threshold = 0.001  # Minimum slope to consider trending


    def analyze_trend(
        self,
        candles: List[Dict],
        lookback: int = 100,
        vwap_levels: Optional[List[float]] = None
    ) -> TrendAnalysis:
        """
        Analyze trend strength and direction

        Args:
            candles: List of candles (most recent last)
            lookback: Number of recent candles to analyze (default: 100)
            vwap_levels: Optional VWAP levels for additional context

        Returns:
            TrendAnalysis object with complete trend information
        """
        if not candles or len(candles) < self.min_swings * 2:
            return self._create_no_trend_result()

        # Use only recent candles for analysis
        recent_candles = candles[-lookback:] if len(candles) > lookback else candles

        # Step 1: Detect swing points
        swing_highs = self._detect_swing_highs(recent_candles)
        swing_lows = self._detect_swing_lows(recent_candles)

        if len(swing_highs) < 2 or len(swing_lows) < 2:
            return self._create_no_trend_result()

        # Step 2: Analyze swing consistency (HH-HL or LH-LL)
        swing_consistency_score, swing_pattern, direction = self._analyze_swing_consistency(
            swing_highs, swing_lows
        )

        # Step 3: Calculate progression angle (linear regression)
        all_swings = sorted(swing_highs + swing_lows, key=lambda s: s.index)
        progression_angle_score, slope = self._calculate_progression_angle(all_swings)

        # Adjust direction based on slope if swing pattern is mixed
        if swing_pattern == 'mixed' and abs(slope) > self.angle_threshold:
            direction = 'uptrend' if slope > 0 else 'downtrend'

        # Step 4: Calculate final trend strength (weighted combination)
        strength = (swing_consistency_score * 0.6) + (progression_angle_score * 0.4)

        # Step 5: Calculate confidence based on data quality
        confidence = self._calculate_confidence(
            len(swing_highs),
            len(swing_lows),
            swing_consistency_score,
            progression_angle_score
        )

        return TrendAnalysis(
            strength=strength,
            direction=direction,
            swing_consistency_score=swing_consistency_score,
            progression_angle_score=progression_angle_score,
            swing_pattern=swing_pattern,
            slope=slope,
            swing_points=all_swings,
            confidence=confidence
        )


    def _detect_swing_highs(self, candles: List[Dict]) -> List[SwingPoint]:
        """
        Detect swing high points (local maxima)

        A swing high is a candle whose high is higher than N candles before and after it
        """
        swing_highs = []
        lookback = self.swing_lookback

        for i in range(lookback, len(candles) - lookback):
            current_high = candles[i]['high']

            # Check if current high is higher than surrounding candles
            is_swing_high = True
            for j in range(i - lookback, i + lookback + 1):
                if j != i and candles[j]['high'] >= current_high:
                    is_swing_high = False
                    break

            if is_swing_high:
                swing_highs.append(SwingPoint(
                    timestamp=candles[i]['timestamp'],
                    price=current_high,
                    index=i,
                    swing_type='high'
                ))

        return swing_highs


    def _detect_swing_lows(self, candles: List[Dict]) -> List[SwingPoint]:
        """
        Detect swing low points (local minima)

        A swing low is a candle whose low is lower than N candles before and after it
        """
        swing_lows = []
        lookback = self.swing_lookback

        for i in range(lookback, len(candles) - lookback):
            current_low = candles[i]['low']

            # Check if current low is lower than surrounding candles
            is_swing_low = True
            for j in range(i - lookback, i + lookback + 1):
                if j != i and candles[j]['low'] <= current_low:
                    is_swing_low = False
                    break

            if is_swing_low:
                swing_lows.append(SwingPoint(
                    timestamp=candles[i]['timestamp'],
                    price=current_low,
                    index=i,
                    swing_type='low'
                ))

        return swing_lows


    def _analyze_swing_consistency(
        self,
        swing_highs: List[SwingPoint],
        swing_lows: List[SwingPoint]
    ) -> Tuple[float, str, str]:
        """
        Analyze swing consistency to detect HH-HL or LH-LL patterns

        Returns:
            Tuple of (consistency_score, pattern, direction)
        """
        # Count higher highs and higher lows
        hh_count = 0
        hl_count = 0
        lh_count = 0
        ll_count = 0

        # Analyze highs
        for i in range(1, len(swing_highs)):
            if swing_highs[i].price > swing_highs[i-1].price:
                hh_count += 1
            else:
                lh_count += 1

        # Analyze lows
        for i in range(1, len(swing_lows)):
            if swing_lows[i].price > swing_lows[i-1].price:
                hl_count += 1
            else:
                ll_count += 1

        total_swings = (len(swing_highs) - 1) + (len(swing_lows) - 1)

        if total_swings == 0:
            return 0.0, 'none', 'sideways'

        # Calculate uptrend consistency (HH + HL)
        uptrend_swings = hh_count + hl_count
        uptrend_consistency = (uptrend_swings / total_swings) * 100

        # Calculate downtrend consistency (LH + LL)
        downtrend_swings = lh_count + ll_count
        downtrend_consistency = (downtrend_swings / total_swings) * 100

        # Determine pattern and direction
        if uptrend_consistency >= 70:
            # Strong uptrend pattern (HH-HL)
            pattern = 'HH-HL'
            direction = 'uptrend'
            consistency_score = uptrend_consistency
        elif downtrend_consistency >= 70:
            # Strong downtrend pattern (LH-LL)
            pattern = 'LH-LL'
            direction = 'downtrend'
            consistency_score = downtrend_consistency
        else:
            # Mixed or weak pattern
            pattern = 'mixed'
            direction = 'sideways'
            # Use the stronger of the two, but cap at 50
            consistency_score = min(50, max(uptrend_consistency, downtrend_consistency))

        return consistency_score, pattern, direction


    def _calculate_progression_angle(
        self,
        swing_points: List[SwingPoint]
    ) -> Tuple[float, float]:
        """
        Calculate progression angle using linear regression on swing points

        Returns:
            Tuple of (angle_score, slope)
        """
        if len(swing_points) < 2:
            return 0.0, 0.0

        # Prepare data for linear regression
        x = np.array([s.index for s in swing_points])
        y = np.array([s.price for s in swing_points])

        # Calculate linear regression slope
        n = len(x)
        slope = (n * np.sum(x * y) - np.sum(x) * np.sum(y)) / (n * np.sum(x**2) - np.sum(x)**2)

        # Normalize slope to a 0-100 score
        # We need to scale slope relative to price range
        price_range = max(y) - min(y)
        if price_range == 0:
            return 0.0, slope

        # Normalize: steep slope relative to price range = high score
        # slope / (price_range / len(swing_points)) gives us slope per bar relative to range
        normalized_slope = abs(slope) / (price_range / len(swing_points))

        # Convert to 0-100 scale (cap at 1.0 = 100% score)
        angle_score = min(100, normalized_slope * 100)

        return angle_score, slope


    def _calculate_confidence(
        self,
        num_highs: int,
        num_lows: int,
        swing_consistency: float,
        angle_score: float
    ) -> float:
        """
        Calculate confidence in trend analysis based on data quality

        Factors:
        - Number of swing points (more = higher confidence)
        - Agreement between swing consistency and angle (higher = higher confidence)
        """
        # Data quality factor (more swing points = better)
        total_swings = num_highs + num_lows
        data_quality = min(100, (total_swings / 10) * 100)  # 10+ swings = 100%

        # Agreement factor (how well do the two metrics agree?)
        # If both are high or both are low, confidence is high
        avg_score = (swing_consistency + angle_score) / 2
        score_difference = abs(swing_consistency - angle_score)
        agreement = max(0, 100 - score_difference)

        # Weighted combination
        confidence = (data_quality * 0.4) + (agreement * 0.3) + (avg_score * 0.3)

        return confidence


    def _create_no_trend_result(self) -> TrendAnalysis:
        """Create a default result for when no trend can be determined"""
        return TrendAnalysis(
            strength=0.0,
            direction='sideways',
            swing_consistency_score=0.0,
            progression_angle_score=0.0,
            swing_pattern='none',
            slope=0.0,
            swing_points=[],
            confidence=0.0
        )


    def is_trending(self, trend_analysis: TrendAnalysis, threshold: float = 60.0) -> bool:
        """
        Determine if market is trending based on strength threshold

        Args:
            trend_analysis: TrendAnalysis result
            threshold: Minimum strength to consider trending (default: 60)

        Returns:
            True if trending, False if sideways
        """
        return trend_analysis.strength >= threshold and trend_analysis.direction != 'sideways'


    def get_trend_summary(self, trend_analysis: TrendAnalysis) -> Dict:
        """
        Get a human-readable summary of trend analysis

        Returns:
            Dictionary with summary information
        """
        return {
            'direction': trend_analysis.direction,
            'strength': round(trend_analysis.strength, 1),
            'confidence': round(trend_analysis.confidence, 1),
            'pattern': trend_analysis.swing_pattern,
            'is_trending': self.is_trending(trend_analysis),
            'swing_consistency': round(trend_analysis.swing_consistency_score, 1),
            'angle_score': round(trend_analysis.progression_angle_score, 1),
            'slope': trend_analysis.slope,
            'swing_point_count': len(trend_analysis.swing_points)
        }


# Singleton instance for use across API
trend_analyzer = TrendAnalyzer()
