# -*- coding: utf-8 -*-
"""
VWAP Calculator Module
=====================
Calculates Volume Weighted Average Price with standard deviation bands
Supports session, anchored, and rolling VWAP types
"""

import numpy as np
from typing import List, Dict, Optional
from datetime import datetime, timezone


class VWAPCalculator:
    """
    Volume Weighted Average Price calculator with multiple modes

    Features:
    - Session VWAP (daily reset)
    - Anchored VWAP (from specific timestamp)
    - Rolling VWAP (fixed lookback window)
    - Standard deviation bands with crypto adjustment
    """

    def __init__(self):
        self.crypto_adjustment = 1.15  # +15% for crypto volatility


    def calculate_session_vwap(
        self,
        candles: List[Dict],
        reset_hour: int = 0
    ) -> List[Dict]:
        """
        Calculate VWAP with daily reset at specified hour (UTC)

        Args:
            candles: List of candles with format {timestamp, high, low, close, volume}
            reset_hour: Hour (0-23) when VWAP resets, in UTC (default: 0 = midnight)

        Returns:
            List of VWAP data points with cumulative calculations
        """
        if not candles or len(candles) == 0:
            return []

        results = []
        cumulative_pv = 0.0
        cumulative_volume = 0.0
        last_session_start = None

        for candle in candles:
            timestamp_ms = candle['timestamp']

            # Convert to datetime UTC for hour check
            dt_utc = datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
            current_hour = dt_utc.hour

            # Reset on new session (when hour matches reset_hour)
            if last_session_start is None or current_hour == reset_hour:
                # Check if we're actually at a new day (not just same hour different candle)
                if last_session_start is None:
                    cumulative_pv = 0.0
                    cumulative_volume = 0.0
                    last_session_start = timestamp_ms
                else:
                    # Only reset if at least 1 day has passed
                    time_since_session = timestamp_ms - last_session_start
                    if time_since_session >= (23 * 60 * 60 * 1000):  # At least 23 hours
                        cumulative_pv = 0.0
                        cumulative_volume = 0.0
                        last_session_start = timestamp_ms

            # Calculate typical price
            typical_price = (candle['high'] + candle['low'] + candle['close']) / 3.0
            volume = candle['volume']

            # Accumulate
            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            # Calculate VWAP
            if cumulative_volume > 0:
                vwap = cumulative_pv / cumulative_volume
            else:
                vwap = typical_price  # Fallback if no volume

            results.append({
                'timestamp': timestamp_ms,
                'vwap': vwap,
                'typical_price': typical_price,
                'volume': volume,
                'cumulative_volume': cumulative_volume,
                'cumulative_pv': cumulative_pv,
                'session_start': last_session_start
            })

        return results


    def calculate_anchored_vwap(
        self,
        candles: List[Dict],
        anchor_timestamp: int
    ) -> List[Dict]:
        """
        Calculate VWAP from specific anchor point (does not reset)

        Args:
            candles: List of candles
            anchor_timestamp: Timestamp (ms) to start VWAP calculation from

        Returns:
            List of VWAP data points from anchor to end
        """
        if not candles or len(candles) == 0:
            return []

        # Find anchor index
        anchor_index = None
        for i, candle in enumerate(candles):
            if candle['timestamp'] >= anchor_timestamp:
                anchor_index = i
                break

        if anchor_index is None:
            # Anchor not found in dataset, use first candle
            anchor_index = 0

        results = []
        cumulative_pv = 0.0
        cumulative_volume = 0.0

        for i in range(anchor_index, len(candles)):
            candle = candles[i]

            # Calculate typical price
            typical_price = (candle['high'] + candle['low'] + candle['close']) / 3.0
            volume = candle['volume']

            # Accumulate
            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            # Calculate VWAP
            if cumulative_volume > 0:
                vwap = cumulative_pv / cumulative_volume
            else:
                vwap = typical_price

            results.append({
                'timestamp': candle['timestamp'],
                'vwap': vwap,
                'typical_price': typical_price,
                'volume': volume,
                'cumulative_volume': cumulative_volume,
                'cumulative_pv': cumulative_pv,
                'anchor_index': anchor_index,
                'anchor_timestamp': candles[anchor_index]['timestamp']
            })

        return results


    def calculate_rolling_vwap(
        self,
        candles: List[Dict],
        period: int = 20
    ) -> List[Dict]:
        """
        Calculate rolling VWAP with fixed lookback window

        Args:
            candles: List of candles
            period: Number of candles in rolling window (default: 20)

        Returns:
            List of VWAP data points with rolling calculation
        """
        if not candles or len(candles) == 0:
            return []

        results = []

        for i in range(len(candles)):
            # Define window
            start_idx = max(0, i - period + 1)
            window = candles[start_idx:i + 1]

            # Calculate VWAP for window
            cumulative_pv = 0.0
            cumulative_volume = 0.0

            for candle in window:
                typical_price = (candle['high'] + candle['low'] + candle['close']) / 3.0
                volume = candle['volume']

                cumulative_pv += typical_price * volume
                cumulative_volume += volume

            # Calculate VWAP
            if cumulative_volume > 0:
                vwap = cumulative_pv / cumulative_volume
            else:
                current_typical = (candles[i]['high'] + candles[i]['low'] + candles[i]['close']) / 3.0
                vwap = current_typical

            results.append({
                'timestamp': candles[i]['timestamp'],
                'vwap': vwap,
                'typical_price': (candles[i]['high'] + candles[i]['low'] + candles[i]['close']) / 3.0,
                'volume': candles[i]['volume'],
                'window_size': len(window),
                'period': period
            })

        return results


    def calculate_std_bands(
        self,
        candles: List[Dict],
        vwap_data: List[Dict],
        multipliers: List[float] = [1.0, 2.0, 3.0],
        apply_crypto_adjustment: bool = True
    ) -> List[Dict]:
        """
        Calculate standard deviation bands around VWAP

        Args:
            candles: Original candles for typical price calculation
            vwap_data: VWAP data from one of the calculate methods
            multipliers: List of multipliers for bands (default: [1.0, 2.0, 3.0])
            apply_crypto_adjustment: Apply +15% crypto volatility adjustment (default: True)

        Returns:
            vwap_data with added 'bands' dictionary for each point
        """
        if len(candles) != len(vwap_data):
            raise ValueError("Candles and VWAP data must have same length")

        # Apply crypto adjustment to multipliers if enabled
        if apply_crypto_adjustment:
            adjusted_multipliers = [m * self.crypto_adjustment for m in multipliers]
        else:
            adjusted_multipliers = multipliers

        # For session/anchored VWAP, we need to track cumulative variance
        # For each point, calculate variance from session/anchor start

        for i in range(len(vwap_data)):
            vwap_point = vwap_data[i]
            vwap_value = vwap_point['vwap']

            # Determine calculation window based on VWAP type
            if 'session_start' in vwap_point:
                # Session VWAP - use from session start to current
                session_start_ts = vwap_point['session_start']
                start_idx = 0
                for j in range(i + 1):
                    if vwap_data[j]['timestamp'] >= session_start_ts:
                        start_idx = j
                        break
                window_candles = candles[start_idx:i + 1]

            elif 'anchor_index' in vwap_point:
                # Anchored VWAP - use from anchor to current
                anchor_idx = vwap_point['anchor_index']
                actual_idx = anchor_idx + (i - 0)  # Index in original candles array
                window_candles = candles[anchor_idx:actual_idx + 1]

            elif 'window_size' in vwap_point:
                # Rolling VWAP - use rolling window
                period = vwap_point['period']
                start_idx = max(0, i - period + 1)
                window_candles = candles[start_idx:i + 1]

            else:
                # Fallback: use all candles up to current
                window_candles = candles[:i + 1]

            # Calculate variance
            if len(window_candles) < 2:
                # Not enough data for variance, use zero bands
                vwap_point['bands'] = {}
                for j, mult in enumerate(adjusted_multipliers):
                    vwap_point['bands'][f'upper_{j+1}'] = vwap_value
                    vwap_point['bands'][f'lower_{j+1}'] = vwap_value
                continue

            # Calculate weighted variance
            total_weighted_sq_diff = 0.0
            total_volume = 0.0

            for candle in window_candles:
                typical_price = (candle['high'] + candle['low'] + candle['close']) / 3.0
                volume = candle['volume']

                sq_diff = (typical_price - vwap_value) ** 2
                weighted_sq_diff = sq_diff * volume

                total_weighted_sq_diff += weighted_sq_diff
                total_volume += volume

            # Variance and standard deviation
            if total_volume > 0:
                variance = total_weighted_sq_diff / total_volume
                std_dev = np.sqrt(variance)
            else:
                std_dev = 0.0

            # Calculate bands
            vwap_point['bands'] = {}
            vwap_point['std_dev'] = std_dev

            for j, mult in enumerate(adjusted_multipliers):
                vwap_point['bands'][f'upper_{j+1}'] = vwap_value + (std_dev * mult)
                vwap_point['bands'][f'lower_{j+1}'] = vwap_value - (std_dev * mult)

        return vwap_data


    def calculate_vwap_with_bands(
        self,
        candles: List[Dict],
        vwap_type: str = 'session',
        config: Optional[Dict] = None
    ) -> List[Dict]:
        """
        Convenience method to calculate VWAP with bands in one call

        Args:
            candles: List of candles
            vwap_type: Type of VWAP ('session', 'anchored', 'rolling')
            config: Configuration dict with optional parameters:
                - reset_hour: For session VWAP (default: 0)
                - anchor_timestamp: For anchored VWAP (required if type='anchored')
                - rolling_period: For rolling VWAP (default: 20)
                - band_multipliers: List of multipliers (default: [1.0, 2.0, 3.0])
                - apply_crypto_adjustment: bool (default: True)

        Returns:
            List of VWAP data points with bands
        """
        if config is None:
            config = {}

        # Calculate VWAP based on type
        if vwap_type == 'session':
            reset_hour = config.get('reset_hour', 0)
            vwap_data = self.calculate_session_vwap(candles, reset_hour)

        elif vwap_type == 'anchored':
            anchor_timestamp = config.get('anchor_timestamp')
            if anchor_timestamp is None:
                raise ValueError("anchor_timestamp is required for anchored VWAP")
            vwap_data = self.calculate_anchored_vwap(candles, anchor_timestamp)

        elif vwap_type == 'rolling':
            rolling_period = config.get('rolling_period', 20)
            vwap_data = self.calculate_rolling_vwap(candles, rolling_period)

        else:
            raise ValueError(f"Invalid vwap_type: {vwap_type}. Must be 'session', 'anchored', or 'rolling'")

        # Calculate bands
        band_multipliers = config.get('band_multipliers', [1.0, 2.0, 3.0])
        apply_crypto_adjustment = config.get('apply_crypto_adjustment', True)

        vwap_data_with_bands = self.calculate_std_bands(
            candles,
            vwap_data,
            band_multipliers,
            apply_crypto_adjustment
        )

        return vwap_data_with_bands


# Singleton instance for use across API
vwap_calculator = VWAPCalculator()
