# -*- coding: utf-8 -*-
"""
Fibonacci Level Calculator Module
==================================
Calculates Fibonacci retracement and extension levels
Supports auto-detection of swing highs/lows
"""

from typing import List, Dict, Tuple, Optional


class FibonacciCalculator:
    """
    Fibonacci retracement and extension level calculator

    Features:
    - Manual swing high/low input
    - Auto-detection of significant swings
    - Retracement levels (0.236, 0.382, 0.5, 0.618, 0.786)
    - Extension levels (1.272, 1.414, 1.618, 2.0, 2.618)
    """

    # Standard Fibonacci ratios
    RETRACEMENT_LEVELS = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    EXTENSION_LEVELS = [1.272, 1.414, 1.618, 2.0, 2.618, 3.618]

    def __init__(self):
        pass


    def calculate_retracement(
        self,
        swing_high: float,
        swing_low: float,
        direction: str = 'uptrend'
    ) -> List[Dict]:
        """
        Calculate Fibonacci retracement levels

        Args:
            swing_high: High point of the swing
            swing_low: Low point of the swing
            direction: 'uptrend' (retracing from high to low) or 'downtrend' (retracing from low to high)

        Returns:
            List of retracement levels with prices
        """
        if swing_high <= swing_low:
            raise ValueError("swing_high must be greater than swing_low")

        range_size = swing_high - swing_low
        levels = []

        for ratio in self.RETRACEMENT_LEVELS:
            if direction == 'uptrend':
                # Uptrend retracement: measure from high down
                price = swing_high - (range_size * ratio)
            else:
                # Downtrend retracement: measure from low up
                price = swing_low + (range_size * ratio)

            levels.append({
                'level': ratio,
                'price': price,
                'type': 'retracement',
                'direction': direction,
                'swing_high': swing_high,
                'swing_low': swing_low,
                'range': range_size
            })

        return levels


    def calculate_extension(
        self,
        swing_high: float,
        swing_low: float,
        direction: str = 'uptrend'
    ) -> List[Dict]:
        """
        Calculate Fibonacci extension levels

        Args:
            swing_high: High point of the swing
            swing_low: Low point of the swing
            direction: 'uptrend' (extending above high) or 'downtrend' (extending below low)

        Returns:
            List of extension levels with prices
        """
        if swing_high <= swing_low:
            raise ValueError("swing_high must be greater than swing_low")

        range_size = swing_high - swing_low
        levels = []

        for ratio in self.EXTENSION_LEVELS:
            if direction == 'uptrend':
                # Uptrend extension: measure above high
                price = swing_low + (range_size * ratio)
            else:
                # Downtrend extension: measure below low
                price = swing_high - (range_size * ratio)

            levels.append({
                'level': ratio,
                'price': price,
                'type': 'extension',
                'direction': direction,
                'swing_high': swing_high,
                'swing_low': swing_low,
                'range': range_size
            })

        return levels


    def auto_detect_swing(
        self,
        candles: List[Dict],
        lookback: int = 50,
        mode: str = 'absolute'
    ) -> Tuple[float, float, int, int]:
        """
        Auto-detect significant swing high and low from recent data

        Args:
            candles: List of candles
            lookback: Number of recent candles to analyze (default: 50)
            mode: 'absolute' (highest/lowest in period) or 'local' (local extremes with pattern)

        Returns:
            Tuple of (swing_high, swing_low, high_index, low_index)
        """
        if not candles or len(candles) == 0:
            raise ValueError("Candles list is empty")

        # Use only recent candles
        if len(candles) > lookback:
            recent_candles = candles[-lookback:]
            offset = len(candles) - lookback
        else:
            recent_candles = candles
            offset = 0

        if mode == 'absolute':
            # Simple: find absolute highest and lowest
            swing_high = max(c['high'] for c in recent_candles)
            swing_low = min(c['low'] for c in recent_candles)

            # Find indices
            high_index = None
            low_index = None
            for i, candle in enumerate(recent_candles):
                if candle['high'] == swing_high and high_index is None:
                    high_index = offset + i
                if candle['low'] == swing_low and low_index is None:
                    low_index = offset + i

        elif mode == 'local':
            # More sophisticated: find local extremes with significance
            swing_high, swing_low, high_index, low_index = self._detect_local_extremes(
                recent_candles,
                offset
            )

        else:
            raise ValueError(f"Invalid mode: {mode}. Must be 'absolute' or 'local'")

        return swing_high, swing_low, high_index, low_index


    def _detect_local_extremes(
        self,
        candles: List[Dict],
        offset: int = 0
    ) -> Tuple[float, float, int, int]:
        """
        Detect local extremes using swing pivot logic

        Args:
            candles: List of candles to analyze
            offset: Offset to add to indices (for partial array)

        Returns:
            Tuple of (swing_high, swing_low, high_index, low_index)
        """
        if len(candles) < 10:
            # Fallback to absolute if not enough data
            swing_high = max(c['high'] for c in candles)
            swing_low = min(c['low'] for c in candles)

            high_index = offset
            low_index = offset
            for i, candle in enumerate(candles):
                if candle['high'] == swing_high:
                    high_index = offset + i
                    break
            for i, candle in enumerate(candles):
                if candle['low'] == swing_low:
                    low_index = offset + i
                    break

            return swing_high, swing_low, high_index, low_index

        # Detect swing pivots
        lookback_bars = 5

        pivot_highs = []
        pivot_lows = []

        for i in range(lookback_bars, len(candles) - lookback_bars):
            candle = candles[i]

            # Check for pivot high
            is_pivot_high = True
            for j in range(i - lookback_bars, i + lookback_bars + 1):
                if j != i and candles[j]['high'] >= candle['high']:
                    is_pivot_high = False
                    break

            if is_pivot_high:
                pivot_highs.append({
                    'price': candle['high'],
                    'index': offset + i,
                    'timestamp': candle['timestamp']
                })

            # Check for pivot low
            is_pivot_low = True
            for j in range(i - lookback_bars, i + lookback_bars + 1):
                if j != i and candles[j]['low'] <= candle['low']:
                    is_pivot_low = False
                    break

            if is_pivot_low:
                pivot_lows.append({
                    'price': candle['low'],
                    'index': offset + i,
                    'timestamp': candle['timestamp']
                })

        # Select most significant pivots
        if pivot_highs:
            # Most recent significant pivot high
            swing_high_data = max(pivot_highs, key=lambda x: x['price'])
            swing_high = swing_high_data['price']
            high_index = swing_high_data['index']
        else:
            # Fallback to absolute high
            swing_high = max(c['high'] for c in candles)
            high_index = offset + next(i for i, c in enumerate(candles) if c['high'] == swing_high)

        if pivot_lows:
            # Most recent significant pivot low
            swing_low_data = min(pivot_lows, key=lambda x: x['price'])
            swing_low = swing_low_data['price']
            low_index = swing_low_data['index']
        else:
            # Fallback to absolute low
            swing_low = min(c['low'] for c in candles)
            low_index = offset + next(i for i, c in enumerate(candles) if c['low'] == swing_low)

        return swing_high, swing_low, high_index, low_index


    def calculate_all_levels(
        self,
        candles: List[Dict],
        swing_high: Optional[float] = None,
        swing_low: Optional[float] = None,
        auto_detect: bool = True,
        lookback: int = 50,
        include_extensions: bool = False
    ) -> Dict:
        """
        Convenience method to calculate all Fibonacci levels

        Args:
            candles: List of candles
            swing_high: Manual swing high (optional)
            swing_low: Manual swing low (optional)
            auto_detect: Auto-detect swings if manual not provided (default: True)
            lookback: Lookback period for auto-detection (default: 50)
            include_extensions: Include extension levels (default: False)

        Returns:
            Dict with retracements, extensions (optional), and swing info
        """
        # Determine swings
        if swing_high is None or swing_low is None:
            if not auto_detect:
                raise ValueError("Must provide swing_high and swing_low, or enable auto_detect")

            detected_high, detected_low, high_idx, low_idx = self.auto_detect_swing(
                candles, lookback, mode='absolute'
            )

            if swing_high is None:
                swing_high = detected_high
            if swing_low is None:
                swing_low = detected_low

            swing_info = {
                'swing_high': swing_high,
                'swing_low': swing_low,
                'high_index': high_idx,
                'low_index': low_idx,
                'auto_detected': True
            }
        else:
            swing_info = {
                'swing_high': swing_high,
                'swing_low': swing_low,
                'high_index': None,
                'low_index': None,
                'auto_detected': False
            }

        # Determine direction based on which came first (if indices available)
        if swing_info.get('high_index') is not None and swing_info.get('low_index') is not None:
            if swing_info['high_index'] < swing_info['low_index']:
                direction = 'downtrend'  # High came first, then low
            else:
                direction = 'uptrend'  # Low came first, then high
        else:
            # Default to uptrend if no temporal information
            direction = 'uptrend'

        swing_info['direction'] = direction

        # Calculate retracements
        retracements = self.calculate_retracement(swing_high, swing_low, direction)

        result = {
            'swing_info': swing_info,
            'retracements': retracements
        }

        # Calculate extensions if requested
        if include_extensions:
            extensions = self.calculate_extension(swing_high, swing_low, direction)
            result['extensions'] = extensions

        return result


# Singleton instance for use across API
fibonacci_calculator = FibonacciCalculator()
