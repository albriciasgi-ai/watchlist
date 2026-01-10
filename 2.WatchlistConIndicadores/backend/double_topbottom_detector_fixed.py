"""
Double Top/Bottom Pattern Detector Module - FIXED VERSION
Optimizado para detectar patrones en timeframes de 1 minuto

Fixes principales:
1. Incluye extremos en los bordes (primeras y últimas velas)
2. Permite tolerancia en la comparación de precios
3. Ajusta ventana de búsqueda para timeframes cortos
"""

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
import math


@dataclass
class DoublePattern:
    """Represents a detected double top/bottom pattern"""
    type: str  # "DOUBLE_TOP" or "DOUBLE_BOTTOM"
    timestamp: int  # Timestamp of the second extreme (confirmation point)
    confidence: float  # 0-100

    # Pattern coordinates
    first_extreme: Dict  # {timestamp, price, candle_index, rejection_pattern, pattern_quality, volume_zscore}
    second_extreme: Dict  # {timestamp, price, candle_index, rejection_pattern, pattern_quality, volume_zscore}

    # Level information
    level_price: float  # Average of the two extremes
    price_variance: float  # % difference between extremes

    # Entry signal (Phase 2 - momentum confirmation)
    entry_signal: Optional[Dict] = None  # {has_momentum, momentum_pattern, entry_candle_timestamp, entry_price, direction, momentum_quality}

    # Metrics
    candles_between_extremes: int = 0
    pattern_duration_hours: float = 0.0
    volume_average: float = 0.0
    meets_volume_criteria: bool = False


class DoubleTopBottomDetectorFixed:
    """Fixed version optimized for 1-minute timeframes"""

    def __init__(self):
        self.patterns_cache = {}

    def detect_patterns(
        self,
        symbol: str,
        candles: List[Dict],
        config: Dict,
        interval: str = None,
        days: int = None
    ) -> List[DoublePattern]:
        """
        Detects double top/bottom patterns - FIXED VERSION
        """
        detected_patterns = []

        if len(candles) < 10:
            print(f"WARNING: Not enough candles for {symbol}. Need at least 10.")
            return []

        # Extract configuration
        lookback_candles = config.get('doubleTopBottom', {}).get('lookbackCandles', 50)
        candles_per_extreme = config.get('doubleTopBottom', {}).get('candlesPerExtreme', 5)

        # AJUSTE PARA TIMEFRAME DE 1 MINUTO
        if interval == "1":
            # Reducir ventana para timeframes cortos
            candles_per_extreme = min(candles_per_extreme, 3)

        price_margin_pct = config.get('doubleTopBottom', {}).get('priceMarginPercent', 2.0) / 100
        min_candles_between = config.get('doubleTopBottom', {}).get('minCandlesBetween', 5)
        max_candles_between = config.get('doubleTopBottom', {}).get('maxCandlesBetween', 50)

        volume_filter_enabled = config.get('doubleTopBottom', {}).get('volumeFilter', {}).get('enabled', False)
        z_score_threshold = config.get('doubleTopBottom', {}).get('volumeFilter', {}).get('zScoreThreshold', 1.5)
        z_score_period = config.get('doubleTopBottom', {}).get('volumeFilter', {}).get('zScorePeriod', 20)

        # High-volume extreme filter (different thresholds for each extreme)
        high_vol_extremes_config = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {})
        high_vol_extremes_enabled = high_vol_extremes_config.get('enabled', False)
        z_score_threshold_first = high_vol_extremes_config.get('zScoreThresholdFirst', 1.5)
        z_score_threshold_second = high_vol_extremes_config.get('zScoreThresholdSecond', 0.5)
        volume_window_candles = high_vol_extremes_config.get('volumeWindowCandles', 3)

        # Calculate z-scores if any volume filter is enabled
        z_scores = []
        if volume_filter_enabled or high_vol_extremes_enabled:
            z_scores = self._calculate_z_scores(candles, z_score_period)

        # Use ALL available candles
        search_candles = candles

        print(f"[DTB_FIXED] {symbol} - Detection Started")
        print(f"  Interval: {interval}, Days: {days}")
        print(f"  Total candles: {len(candles)}")
        print(f"  Window size: {candles_per_extreme}")
        print(f"  Price margin: {price_margin_pct*100:.2f}% | Min candles: {min_candles_between} | Max candles: {max_candles_between}")

        # Find local extremes with FIXED algorithm
        local_highs = self._find_local_extremes_fixed(
            search_candles,
            candles_per_extreme,
            'high',
            interval
        )

        local_lows = self._find_local_extremes_fixed(
            search_candles,
            candles_per_extreme,
            'low',
            interval
        )

        print(f"  Found {len(local_highs)} highs, {len(local_lows)} lows")

        # Find double tops
        double_tops = self._find_double_tops(
            local_highs,
            candles,
            config,
            price_margin_pct,
            min_candles_between,
            max_candles_between,
            z_scores,
            z_score_threshold,
            volume_filter_enabled,
            high_vol_extremes_enabled,
            z_score_threshold_first,
            z_score_threshold_second,
            volume_window_candles
        )

        detected_patterns.extend(double_tops)

        # Find double bottoms
        double_bottoms = self._find_double_bottoms(
            local_lows,
            candles,
            config,
            price_margin_pct,
            min_candles_between,
            max_candles_between,
            z_scores,
            z_score_threshold,
            volume_filter_enabled,
            high_vol_extremes_enabled,
            z_score_threshold_first,
            z_score_threshold_second,
            volume_window_candles
        )

        detected_patterns.extend(double_bottoms)

        print(f"  Before filtering: {len(detected_patterns)} patterns")

        # Remove duplicates
        detected_patterns = self._filter_duplicate_patterns(detected_patterns, config)

        # Filter by confidence
        min_confidence = config.get('filters', {}).get('minConfidence', 60)
        detected_patterns = [p for p in detected_patterns if p.confidence >= min_confidence]

        print(f"  After filtering: {len(detected_patterns)} patterns")
        print(f"[DTB_FIXED] Complete: {len(detected_patterns)} patterns")

        return detected_patterns

    def _find_local_extremes_fixed(
        self,
        candles: List[Dict],
        window_size: int,
        extreme_type: str,
        interval: str = None
    ) -> List[Dict]:
        """
        FIXED VERSION: Encuentra extremos locales VERDADEROS.

        Un punto es un extremo local si y solo si:
        - Para highs: es el HIGH más alto en su ventana
        - Para lows: es el LOW más bajo en su ventana

        Se permite una pequeña tolerancia para precios "iguales" (0.01%)
        """
        extremes = []
        price_key = 'high' if extreme_type == 'high' else 'low'
        is_high = extreme_type == 'high'

        # Tolerancia para considerar precios como "iguales" (0.01%)
        price_tolerance = 0.0001

        for i in range(len(candles)):
            candle = candles[i]
            current_price = float(candle[price_key])

            # Definir ventana de comparación
            window_start = max(0, i - window_size)
            window_end = min(len(candles), i + window_size + 1)

            # Verificar que sea el extremo verdadero en la ventana
            is_extreme = True

            for j in range(window_start, window_end):
                if j == i:
                    continue  # No comparar consigo mismo

                compare_price = float(candles[j][price_key])

                if is_high:
                    # Para un HIGH: ninguna vela en la ventana debe tener un high mayor
                    # (con tolerancia para precios "iguales")
                    if compare_price > current_price * (1 + price_tolerance):
                        is_extreme = False
                        break
                else:
                    # Para un LOW: ninguna vela en la ventana debe tener un low menor
                    if compare_price < current_price * (1 - price_tolerance):
                        is_extreme = False
                        break

            if is_extreme:
                extremes.append({
                    'candle_index': i,
                    'timestamp': candle.get('timestamp'),
                    'price': current_price,
                    'volume': candle.get('volume', 0),
                    'high': candle.get('high'),
                    'low': candle.get('low'),
                    'open': candle.get('open'),
                    'close': candle.get('close')
                })

        # Ordenar por índice
        extremes.sort(key=lambda x: x['candle_index'])

        return extremes

    def _find_swing_extremes(
        self,
        candles: List[Dict],
        extreme_type: str
    ) -> List[Dict]:
        """
        Encuentra extremos basados en cambios de dirección (swings)
        Útil para timeframes de 1 minuto
        """
        extremes = []
        price_key = extreme_type  # 'high' or 'low'
        is_high = extreme_type == 'high'

        # Buscar puntos de cambio de dirección significativos
        for i in range(2, len(candles) - 2):
            # Obtener precios circundantes
            price_2before = float(candles[i-2][price_key])
            price_1before = float(candles[i-1][price_key])
            price_current = float(candles[i][price_key])
            price_1after = float(candles[i+1][price_key])
            price_2after = float(candles[i+2][price_key])

            if is_high:
                # Es un swing high si forma una "montaña"
                if (price_current > price_1before and
                    price_current > price_1after and
                    price_current >= price_2before and
                    price_current >= price_2after):

                    extremes.append({
                        'candle_index': i,
                        'timestamp': candles[i].get('timestamp'),
                        'price': price_current,
                        'volume': candles[i].get('volume', 0),
                        'high': candles[i].get('high'),
                        'low': candles[i].get('low'),
                        'open': candles[i].get('open'),
                        'close': candles[i].get('close')
                    })
            else:
                # Es un swing low si forma un "valle"
                if (price_current < price_1before and
                    price_current < price_1after and
                    price_current <= price_2before and
                    price_current <= price_2after):

                    extremes.append({
                        'candle_index': i,
                        'timestamp': candles[i].get('timestamp'),
                        'price': price_current,
                        'volume': candles[i].get('volume', 0),
                        'high': candles[i].get('high'),
                        'low': candles[i].get('low'),
                        'open': candles[i].get('open'),
                        'close': candles[i].get('close')
                    })

        return extremes

    def _calculate_z_scores(self, candles: List[Dict], period: int) -> List[float]:
        """Calculate z-scores for volume"""
        z_scores = []
        volumes = [c.get('volume', 0) for c in candles]

        for i in range(len(volumes)):
            start_idx = max(0, i - period + 1)
            end_idx = i + 1
            window = volumes[start_idx:end_idx]

            if len(window) >= 2:
                mean = sum(window) / len(window)
                variance = sum((x - mean) ** 2 for x in window) / len(window)
                stdev = math.sqrt(variance) if variance > 0 else 0

                if stdev > 0:
                    z_score = (volumes[i] - mean) / stdev
                else:
                    z_score = 0
            else:
                z_score = 0

            z_scores.append(z_score)

        return z_scores

    def _get_max_zscore_in_window(self, z_scores: List[float], center_idx: int, window: int) -> float:
        """Get max z-score in ±window candles around center_idx"""
        if not z_scores:
            return 0
        start = max(0, center_idx - window)
        end = min(len(z_scores), center_idx + window + 1)
        window_scores = z_scores[start:end]
        return max(window_scores) if window_scores else 0

    def _find_double_tops(
        self,
        highs: List[Dict],
        candles: List[Dict],
        config: Dict,
        price_margin_pct: float,
        min_candles_between: int,
        max_candles_between: int,
        z_scores: List[float],
        z_score_threshold: float,
        volume_filter_enabled: bool,
        high_vol_extremes_enabled: bool = False,
        z_score_threshold_first: float = 1.5,
        z_score_threshold_second: float = 0.5,
        volume_window_candles: int = 3
    ) -> List[DoublePattern]:
        """Find double top patterns with dominance validation and volume filters"""
        patterns = []

        # Diagnostic stats
        stats = {
            'pairs_evaluated': 0,
            'rejected_too_close': 0,
            'rejected_too_far': 0,
            'rejected_price_diff': 0,
            'rejected_dominance': 0,
            'rejected_volume': 0,
            'rejected_volume_extremes': 0,
            'accepted': 0
        }

        for i in range(len(highs)):
            for j in range(i + 1, len(highs)):
                first = highs[i]
                second = highs[j]
                stats['pairs_evaluated'] += 1

                # Check distance
                candles_between = second['candle_index'] - first['candle_index']
                if candles_between < min_candles_between:
                    stats['rejected_too_close'] += 1
                    continue
                if candles_between > max_candles_between:
                    stats['rejected_too_far'] += 1
                    continue

                # Check price similarity
                price_diff = abs(first['price'] - second['price'])
                avg_price = (first['price'] + second['price']) / 2
                price_variance = (price_diff / avg_price) * 100

                if price_variance > price_margin_pct * 100:
                    stats['rejected_price_diff'] += 1
                    continue

                # DOMINANCE VALIDATION: No high between the two extremes should exceed both of them
                max_extreme_price = max(first['price'], second['price'])
                has_higher_between = False

                for k in range(first['candle_index'] + 1, second['candle_index']):
                    if k < len(candles):
                        between_high = float(candles[k].get('high', 0))
                        if between_high > max_extreme_price * 1.0001:
                            has_higher_between = True
                            break

                if has_higher_between:
                    stats['rejected_dominance'] += 1
                    continue

                # Get z-scores (with window search for high_vol_extremes)
                if high_vol_extremes_enabled and z_scores:
                    first_zscore = self._get_max_zscore_in_window(z_scores, first['candle_index'], volume_window_candles)
                    second_zscore = self._get_max_zscore_in_window(z_scores, second['candle_index'], volume_window_candles)
                else:
                    first_zscore = z_scores[first['candle_index']] if z_scores and first['candle_index'] < len(z_scores) else 0
                    second_zscore = z_scores[second['candle_index']] if z_scores and second['candle_index'] < len(z_scores) else 0

                # VOLUME FILTER 1: Basic (max of both >= threshold)
                if volume_filter_enabled and z_scores:
                    if max(first_zscore, second_zscore) < z_score_threshold:
                        stats['rejected_volume'] += 1
                        continue

                # VOLUME FILTER 2: High-volume extremes (different thresholds for each)
                if high_vol_extremes_enabled and z_scores:
                    if first_zscore < z_score_threshold_first or second_zscore < z_score_threshold_second:
                        stats['rejected_volume_extremes'] += 1
                        continue

                stats['accepted'] += 1

                # ====== CALCULATE CONFIDENCE (weighted system) ======
                # Base: 25, Max contributions: 75, Total range: 25-100
                confidence = 25  # Base (reduced from 50 for better discrimination)

                # Price variance contribution (0-25 points)
                if price_variance < 0.3:
                    confidence += 25
                elif price_variance < 0.5:
                    confidence += 20
                elif price_variance < 1.0:
                    confidence += 12
                elif price_variance < 2.0:
                    confidence += 6

                # Volume contribution (0-25 points) - use MAX of both extremes
                max_zscore = max(first_zscore, second_zscore)
                if max_zscore >= 2.5:
                    confidence += 25
                elif max_zscore >= 2.0:
                    confidence += 18
                elif max_zscore >= 1.5:
                    confidence += 12
                elif max_zscore >= 1.0:
                    confidence += 6

                # Bonus if BOTH extremes have good volume (0-15 points)
                min_zscore = min(first_zscore, second_zscore)
                if min_zscore >= 1.5:
                    confidence += 15
                elif min_zscore >= 1.0:
                    confidence += 8

                # Distance contribution (0-10 points)
                if 20 <= candles_between <= 100:
                    confidence += 10
                elif 10 <= candles_between <= 150:
                    confidence += 5

                # Rejection pattern bonus (0-10 points)
                first_candle = candles[first['candle_index']]
                second_candle = candles[second['candle_index']]
                rejection_bonus = 0

                for candle in [first_candle, second_candle]:
                    body = abs(float(candle.get('close', 0)) - float(candle.get('open', 0)))
                    upper_wick = float(candle.get('high', 0)) - max(float(candle.get('close', 0)), float(candle.get('open', 0)))
                    total_range = float(candle.get('high', 0)) - float(candle.get('low', 0))

                    if total_range > 0:
                        if upper_wick / total_range > 0.6 and body / total_range < 0.3:
                            rejection_bonus += 5

                confidence += min(rejection_bonus, 10)

                # Create pattern
                pattern = DoublePattern(
                    type="DOUBLE_TOP",
                    timestamp=second['timestamp'],
                    confidence=min(confidence, 100),
                    first_extreme={
                        'timestamp': first['timestamp'],
                        'price': first['price'],
                        'candle_index': first['candle_index'],
                        'volume_zscore': first_zscore
                    },
                    second_extreme={
                        'timestamp': second['timestamp'],
                        'price': second['price'],
                        'candle_index': second['candle_index'],
                        'volume_zscore': second_zscore
                    },
                    level_price=avg_price,
                    price_variance=price_variance,
                    candles_between_extremes=candles_between
                )

                patterns.append(pattern)

        print(f"  [DT] Pairs: {stats['pairs_evaluated']} | Rejected: close={stats['rejected_too_close']}, far={stats['rejected_too_far']}, price={stats['rejected_price_diff']}, dom={stats['rejected_dominance']}, vol={stats['rejected_volume']}, volExt={stats['rejected_volume_extremes']} | Accepted: {stats['accepted']}")

        return patterns

    def _find_double_bottoms(
        self,
        lows: List[Dict],
        candles: List[Dict],
        config: Dict,
        price_margin_pct: float,
        min_candles_between: int,
        max_candles_between: int,
        z_scores: List[float],
        z_score_threshold: float,
        volume_filter_enabled: bool,
        high_vol_extremes_enabled: bool = False,
        z_score_threshold_first: float = 1.5,
        z_score_threshold_second: float = 0.5,
        volume_window_candles: int = 3
    ) -> List[DoublePattern]:
        """Find double bottom patterns with dominance validation and volume filters"""
        patterns = []

        # Diagnostic stats
        stats = {
            'pairs_evaluated': 0,
            'rejected_too_close': 0,
            'rejected_too_far': 0,
            'rejected_price_diff': 0,
            'rejected_dominance': 0,
            'rejected_volume': 0,
            'rejected_volume_extremes': 0,
            'accepted': 0
        }

        for i in range(len(lows)):
            for j in range(i + 1, len(lows)):
                first = lows[i]
                second = lows[j]
                stats['pairs_evaluated'] += 1

                # Check distance
                candles_between = second['candle_index'] - first['candle_index']
                if candles_between < min_candles_between:
                    stats['rejected_too_close'] += 1
                    continue
                if candles_between > max_candles_between:
                    stats['rejected_too_far'] += 1
                    continue

                # Check price similarity
                price_diff = abs(first['price'] - second['price'])
                avg_price = (first['price'] + second['price']) / 2
                price_variance = (price_diff / avg_price) * 100

                if price_variance > price_margin_pct * 100:
                    stats['rejected_price_diff'] += 1
                    continue

                # DOMINANCE VALIDATION: No low between the two extremes should be lower than both
                min_extreme_price = min(first['price'], second['price'])
                has_lower_between = False

                for k in range(first['candle_index'] + 1, second['candle_index']):
                    if k < len(candles):
                        between_low = float(candles[k].get('low', float('inf')))
                        if between_low < min_extreme_price * 0.9999:
                            has_lower_between = True
                            break

                if has_lower_between:
                    stats['rejected_dominance'] += 1
                    continue

                # Get z-scores (with window search for high_vol_extremes)
                if high_vol_extremes_enabled and z_scores:
                    first_zscore = self._get_max_zscore_in_window(z_scores, first['candle_index'], volume_window_candles)
                    second_zscore = self._get_max_zscore_in_window(z_scores, second['candle_index'], volume_window_candles)
                else:
                    first_zscore = z_scores[first['candle_index']] if z_scores and first['candle_index'] < len(z_scores) else 0
                    second_zscore = z_scores[second['candle_index']] if z_scores and second['candle_index'] < len(z_scores) else 0

                # VOLUME FILTER 1: Basic (max of both >= threshold)
                if volume_filter_enabled and z_scores:
                    if max(first_zscore, second_zscore) < z_score_threshold:
                        stats['rejected_volume'] += 1
                        continue

                # VOLUME FILTER 2: High-volume extremes (different thresholds for each)
                if high_vol_extremes_enabled and z_scores:
                    if first_zscore < z_score_threshold_first or second_zscore < z_score_threshold_second:
                        stats['rejected_volume_extremes'] += 1
                        continue

                stats['accepted'] += 1

                # ====== CALCULATE CONFIDENCE (weighted system) ======
                # Base: 25, Max contributions: 75, Total range: 25-100
                confidence = 25  # Base (reduced from 50 for better discrimination)

                # Price variance contribution (0-25 points)
                if price_variance < 0.3:
                    confidence += 25
                elif price_variance < 0.5:
                    confidence += 20
                elif price_variance < 1.0:
                    confidence += 12
                elif price_variance < 2.0:
                    confidence += 6

                # Volume contribution (0-25 points) - use MAX of both extremes
                max_zscore = max(first_zscore, second_zscore)
                if max_zscore >= 2.5:
                    confidence += 25
                elif max_zscore >= 2.0:
                    confidence += 18
                elif max_zscore >= 1.5:
                    confidence += 12
                elif max_zscore >= 1.0:
                    confidence += 6

                # Bonus if BOTH extremes have good volume (0-15 points)
                min_zscore = min(first_zscore, second_zscore)
                if min_zscore >= 1.5:
                    confidence += 15
                elif min_zscore >= 1.0:
                    confidence += 8

                # Distance contribution (0-10 points)
                if 20 <= candles_between <= 100:
                    confidence += 10
                elif 10 <= candles_between <= 150:
                    confidence += 5

                # Rejection pattern bonus (0-10 points) - Hammer for bottoms
                first_candle = candles[first['candle_index']]
                second_candle = candles[second['candle_index']]
                rejection_bonus = 0

                for candle in [first_candle, second_candle]:
                    body = abs(float(candle.get('close', 0)) - float(candle.get('open', 0)))
                    lower_wick = min(float(candle.get('close', 0)), float(candle.get('open', 0))) - float(candle.get('low', 0))
                    total_range = float(candle.get('high', 0)) - float(candle.get('low', 0))

                    if total_range > 0:
                        if lower_wick / total_range > 0.6 and body / total_range < 0.3:
                            rejection_bonus += 5

                confidence += min(rejection_bonus, 10)

                # Create pattern
                pattern = DoublePattern(
                    type="DOUBLE_BOTTOM",
                    timestamp=second['timestamp'],
                    confidence=min(confidence, 100),
                    first_extreme={
                        'timestamp': first['timestamp'],
                        'price': first['price'],
                        'candle_index': first['candle_index'],
                        'volume_zscore': first_zscore
                    },
                    second_extreme={
                        'timestamp': second['timestamp'],
                        'price': second['price'],
                        'candle_index': second['candle_index'],
                        'volume_zscore': second_zscore
                    },
                    level_price=avg_price,
                    price_variance=price_variance,
                    candles_between_extremes=candles_between
                )

                patterns.append(pattern)

        print(f"  [DB] Pairs: {stats['pairs_evaluated']} | Rejected: close={stats['rejected_too_close']}, far={stats['rejected_too_far']}, price={stats['rejected_price_diff']}, dom={stats['rejected_dominance']}, vol={stats['rejected_volume']}, volExt={stats['rejected_volume_extremes']} | Accepted: {stats['accepted']}")

        return patterns

    def _filter_duplicate_patterns(self, patterns: List[DoublePattern], config: Dict) -> List[DoublePattern]:
        """
        Remove duplicate patterns in the same zone AND time period.

        Two patterns are duplicates only if:
        1. Same type (DOUBLE_TOP or DOUBLE_BOTTOM)
        2. Price within 0.5% tolerance
        3. Second extreme timestamps within 30 candles of each other

        This allows multiple patterns at the same price level but different times
        (e.g., testing support at 10am and again at 8pm are separate patterns)
        """
        if not patterns:
            return patterns

        filtered = []
        price_tolerance = 0.005  # 0.5% tolerance
        candle_time_tolerance = 30  # Consider patterns within 30 candles as potential duplicates

        # Sort patterns by timestamp to process chronologically
        sorted_patterns = sorted(patterns, key=lambda p: p.second_extreme['timestamp'])

        stats = {'total': len(patterns), 'kept': 0, 'removed_price': 0, 'removed_time_and_price': 0}

        for pattern in sorted_patterns:
            is_duplicate = False
            for existing in filtered:
                if pattern.type == existing.type:
                    # Check price similarity
                    price_diff = abs(pattern.level_price - existing.level_price) / existing.level_price
                    price_similar = price_diff < price_tolerance

                    # Check temporal proximity (by candle index, not timestamp)
                    candle_diff = abs(pattern.second_extreme['candle_index'] - existing.second_extreme['candle_index'])
                    time_close = candle_diff < candle_time_tolerance

                    # Only consider duplicate if BOTH price AND time are close
                    if price_similar and time_close:
                        # Keep the one with higher confidence
                        if pattern.confidence > existing.confidence:
                            filtered.remove(existing)
                            filtered.append(pattern)
                        is_duplicate = True
                        stats['removed_time_and_price'] += 1
                        break

            if not is_duplicate:
                filtered.append(pattern)
                stats['kept'] += 1

        print(f"  [FILTER] {stats['total']} candidates -> {stats['kept']} kept ({stats['removed_time_and_price']} duplicates removed)")

        return filtered