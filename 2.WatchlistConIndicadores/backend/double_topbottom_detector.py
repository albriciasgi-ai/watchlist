"""
Double Top/Bottom Pattern Detector Module

Detects double top and double bottom patterns with rejection pattern validation
and optional volume significance filtering.

Author: Claude Code
Date: 2025-12-25
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


class DoubleTopBottomDetector:
    """Main class for detecting double top/bottom patterns"""

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
        Detects double top/bottom patterns in candlestick data

        Args:
            symbol: Cryptocurrency symbol
            candles: List of OHLCV candles
            config: Detection configuration

        Returns:
            List of detected double top/bottom patterns
        """
        detected_patterns = []

        if len(candles) < 10:
            print(f"WARNING: Not enough candles for {symbol}. Need at least 10.")
            return []

        # Extract configuration
        lookback_candles = config.get('doubleTopBottom', {}).get('lookbackCandles', 50)
        candles_per_extreme = config.get('doubleTopBottom', {}).get('candlesPerExtreme', 5)
        price_margin_pct = config.get('doubleTopBottom', {}).get('priceMarginPercent', 2.0) / 100
        min_candles_between = config.get('doubleTopBottom', {}).get('minCandlesBetween', 5)
        max_candles_between = config.get('doubleTopBottom', {}).get('maxCandlesBetween', 50)

        volume_filter_enabled = config.get('doubleTopBottom', {}).get('volumeFilter', {}).get('enabled', False)
        z_score_threshold = config.get('doubleTopBottom', {}).get('volumeFilter', {}).get('zScoreThreshold', 1.5)
        z_score_period = config.get('doubleTopBottom', {}).get('volumeFilter', {}).get('zScorePeriod', 20)

        require_high_volume_config = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {})
        require_high_volume_enabled = require_high_volume_config.get('enabled', False)
        require_high_volume_period = require_high_volume_config.get('zScorePeriod', 20)

        # Calculate z-scores if ANY volume filter is enabled
        z_scores = []
        if volume_filter_enabled or require_high_volume_enabled:
            # Use the period from whichever filter is enabled (or max if both)
            period = max(z_score_period, require_high_volume_period) if (volume_filter_enabled and require_high_volume_enabled) else (z_score_period if volume_filter_enabled else require_high_volume_period)
            z_scores = self._calculate_z_scores(candles, period)

        # Use ALL available candles (no lookback limit)
        search_start = 0
        search_candles = candles

        print(f"[PRUEBA_DBT] {symbol} - Double Top/Bottom Detection Started")
        print(f"  [PRUEBA_DBT] Interval: {interval}, Days: {days}")
        print(f"  [PRUEBA_DBT] Total candles available: {len(candles)}")
        print(f"  [PRUEBA_DBT] Config Parameters:")
        print(f"    - Lookback candles: {lookback_candles}")
        print(f"    - Searching ALL {len(search_candles)} candles (no lookback limit)")
        print(f"    - Extremes window: {candles_per_extreme} candles")
        print(f"    - Price margin: {price_margin_pct * 100:.1f}%")
        print(f"    - Min candles between: {min_candles_between}")
        print(f"    - Max candles between: {max_candles_between}")
        print(f"    - Volume filter: {'enabled' if volume_filter_enabled else 'disabled'}")
        if volume_filter_enabled:
            print(f"      - Z-Score threshold: {z_score_threshold}")
            print(f"      - Z-Score period: {z_score_period}")
        print(f"    - High volume at extremes: {'enabled' if require_high_volume_enabled else 'disabled'}")
        if require_high_volume_enabled:
            z_threshold_first = require_high_volume_config.get('zScoreThresholdFirst', 1.5)
            z_threshold_second = require_high_volume_config.get('zScoreThresholdSecond', 0.5)
            print(f"      - First extreme z-score: {z_threshold_first}")
            print(f"      - Second extreme z-score: {z_threshold_second}")
            print(f"      - Z-Score period: {require_high_volume_period}")
        breakout_tolerance = config.get('doubleTopBottom', {}).get('maxBreakoutPercent', 2.0)
        print(f"    - Max breakout %: {breakout_tolerance}%")

        # Step 1: Find local extremes (highs and lows)
        local_highs = self._find_local_extremes(
            search_candles,
            candles_per_extreme,
            'high',
            search_start
        )

        local_lows = self._find_local_extremes(
            search_candles,
            candles_per_extreme,
            'low',
            search_start
        )

        print(f"  [PRUEBA_DBT] Found {len(local_highs)} local highs")
        print(f"  [PRUEBA_DBT] Found {len(local_lows)} local lows")

        # Filter extremes by volume if required
        require_high_volume = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {})
        if require_high_volume.get('enabled', False):
            local_highs = self._filter_extremes_by_volume(
                local_highs,
                candles,
                require_high_volume,
                z_scores
            )
            local_lows = self._filter_extremes_by_volume(
                local_lows,
                candles,
                require_high_volume,
                z_scores
            )
            print(f"  [PRUEBA_DBT] After volume filter: {len(local_highs)} highs, {len(local_lows)} lows")

        # Step 2: Find double tops
        double_tops = self._find_double_tops(
            local_highs,
            candles,
            config,
            price_margin_pct,
            min_candles_between,
            max_candles_between,
            z_scores,
            z_score_threshold,
            volume_filter_enabled
        )

        detected_patterns.extend(double_tops)

        # Step 3: Find double bottoms
        double_bottoms = self._find_double_bottoms(
            local_lows,
            candles,
            config,
            price_margin_pct,
            min_candles_between,
            max_candles_between,
            z_scores,
            z_score_threshold,
            volume_filter_enabled
        )

        detected_patterns.extend(double_bottoms)

        print(f"  [PRUEBA_DBT] Before post-validation: {len(detected_patterns)} patterns")

        # Step 4: Post-pattern validation (confirm directional movement)
        detected_patterns = self._validate_post_pattern_movement(
            detected_patterns,
            candles,
            config
        )

        print(f"  [PRUEBA_DBT] After post-validation: {len(detected_patterns)} patterns")

        # Step 5: Remove duplicate patterns in same zone
        detected_patterns = self._filter_duplicate_patterns(
            detected_patterns,
            config
        )

        print(f"  [PRUEBA_DBT] After deduplication: {len(detected_patterns)} patterns")

        # Step 6: Apply momentum confirmation if enabled (Phase 2)
        if config.get('momentumConfirmation', {}).get('enabled', False):
            detected_patterns = self._add_momentum_confirmation(
                detected_patterns,
                candles,
                config
            )
            print(f"  [PRUEBA_DBT] After momentum: {len(detected_patterns)} patterns")

        # Step 7: Filter by minimum confidence
        min_confidence = config.get('filters', {}).get('minConfidence', 60)
        patterns_before_conf_filter = len(detected_patterns)

        print(f"  [PRUEBA_DBT] ===== CONFIDENCE FILTER ANALYSIS =====")
        print(f"  [PRUEBA_DBT] Min confidence threshold: {min_confidence}%")
        print(f"  [PRUEBA_DBT] Patterns before filter: {patterns_before_conf_filter}")

        if patterns_before_conf_filter > 0:
            confidence_values = [p.confidence for p in detected_patterns]
            print(f"  [PRUEBA_DBT] Confidence values: {confidence_values[:10]}{'...' if len(confidence_values) > 10 else ''}")
            print(f"  [PRUEBA_DBT] Min confidence in patterns: {min(confidence_values):.1f}%")
            print(f"  [PRUEBA_DBT] Max confidence in patterns: {max(confidence_values):.1f}%")
            print(f"  [PRUEBA_DBT] Avg confidence in patterns: {sum(confidence_values)/len(confidence_values):.1f}%")

        detected_patterns = [p for p in detected_patterns if p.confidence >= min_confidence]
        filtered_count = patterns_before_conf_filter - len(detected_patterns)

        print(f"  [PRUEBA_DBT] After min_confidence filter: {len(detected_patterns)} patterns")
        print(f"  [PRUEBA_DBT] Filtered out: {filtered_count} patterns (confidence < {min_confidence}%)")
        print(f"[PRUEBA_DBT] {symbol} - Detection Complete: {len(detected_patterns)} patterns returned")
        print(f"  [OK] Detected {len(detected_patterns)} patterns (after all filtering)")

        return detected_patterns

    def _calculate_z_scores(self, candles: List[Dict], period: int) -> List[float]:
        """
        Calculate z-scores for volume in candles

        Z-Score = (value - mean) / stdev
        """
        z_scores = []
        volumes = [c.get('volume', 0) for c in candles]

        for i in range(len(volumes)):
            if i < period:
                z_scores.append(0.0)
                continue

            window = volumes[i - period + 1:i + 1]
            mean = sum(window) / period
            variance = sum((x - mean) ** 2 for x in window) / period
            stdev = variance ** 0.5

            if stdev == 0:
                z_scores.append(0.0)
            else:
                z_score = (volumes[i] - mean) / stdev
                z_scores.append(z_score)

        return z_scores

    def _find_local_extremes(
        self,
        candles: List[Dict],
        window_size: int,
        extreme_type: str,
        offset: int = 0
    ) -> List[Dict]:
        """
        Find local highs or lows using a sliding window

        Args:
            candles: List of candles to search
            window_size: Number of candles on each side to compare
            extreme_type: 'high' or 'low'
            offset: Offset to add to candle_index (for global indexing)

        Returns:
            List of extreme points with metadata
        """
        extremes = []
        price_key = 'high' if extreme_type == 'high' else 'low'
        is_high = extreme_type == 'high'

        for i in range(window_size, len(candles) - window_size):
            candle = candles[i]
            current_price = candle[price_key]

            # Check if this is an extreme point
            is_extreme = True

            # Check left side
            for j in range(i - window_size, i):
                compare_price = candles[j][price_key]
                if is_high:
                    if compare_price > current_price:
                        is_extreme = False
                        break
                else:
                    if compare_price < current_price:
                        is_extreme = False
                        break

            if not is_extreme:
                continue

            # Check right side
            for j in range(i + 1, i + window_size + 1):
                compare_price = candles[j][price_key]
                if is_high:
                    if compare_price > current_price:
                        is_extreme = False
                        break
                else:
                    if compare_price < current_price:
                        is_extreme = False
                        break

            if is_extreme:
                extremes.append({
                    'candle_index': i + offset,
                    'timestamp': candle['timestamp'],
                    'price': current_price,
                    'candle': candle
                })

        return extremes

    def _filter_extremes_by_volume(
        self,
        extremes: List[Dict],
        all_candles: List[Dict],
        config: Dict,
        z_scores: List[float]
    ) -> List[Dict]:
        """
        Filter extremes by volume requirement.
        Searches for high volume in a window of candles around the extreme.

        This ensures that highs/lows are formed with big player involvement,
        allowing for volume to appear in adjacent candles (not just the exact extreme).

        Args:
            extremes: List of extreme points to filter
            all_candles: All candles for z-score calculation
            config: requireHighVolumeAtExtremes configuration
            z_scores: Pre-calculated z-scores for all candles

        Returns:
            Filtered list of extremes with high volume in window
        """
        if not z_scores:
            print(f"  - WARNING: Volume filter enabled but z-scores not available")
            return extremes

        z_threshold = config.get('zScoreThreshold', 1.0)
        window_size = config.get('volumeWindowCandles', 3)  # NUEVO: ventana de busqueda
        filtered_extremes = []

        print(f"  [PRUEBA_DBT] Filtering {len(extremes)} extremes by volume (z-threshold={z_threshold:.1f}, window=±{window_size})")

        for extreme in extremes:
            candle_idx = extreme['candle_index']

            # MEJORADO: Buscar volumen alto en ventana de velas alrededor del extremo
            start_idx = max(0, candle_idx - window_size)
            end_idx = min(len(z_scores), candle_idx + window_size + 1)

            # Obtener z-scores en la ventana
            window_zscores = z_scores[start_idx:end_idx]

            if window_zscores:
                # Usar el MÁXIMO z-score de la ventana
                max_zscore = max(window_zscores)
                max_zscore_idx = start_idx + window_zscores.index(max_zscore)
                offset = max_zscore_idx - candle_idx

                # Debug detallado
                extreme_price = extreme['price']
                extreme_ts = extreme['candle'].get('timestamp', 'N/A')

                if max_zscore >= z_threshold:
                    # Volumen alto encontrado en ventana
                    filtered_extremes.append(extreme)
                    print(f"    [OK] ACCEPTED: Extreme at idx={candle_idx} (price={extreme_price:.2f}, ts={extreme_ts}) | "
                          f"Max z-score={max_zscore:.2f} at offset={offset:+d} (threshold={z_threshold:.1f})")
                else:
                    # Volumen bajo en toda la ventana
                    print(f"    [REJECTED] Extreme at idx={candle_idx} (price={extreme_price:.2f}, ts={extreme_ts}) | "
                          f"Max z-score={max_zscore:.2f} < threshold={z_threshold:.1f}")
            else:
                # Edge case: sin z-scores disponibles, mantener
                filtered_extremes.append(extreme)

        print(f"  [PRUEBA_DBT] Volume filter result: {len(extremes)} -> {len(filtered_extremes)} extremes")
        return filtered_extremes

    def _find_double_tops(
        self,
        highs: List[Dict],
        all_candles: List[Dict],
        config: Dict,
        price_margin: float,
        min_candles: int,
        max_candles: int,
        z_scores: List[float],
        z_threshold: float,
        volume_filter_enabled: bool
    ) -> List[DoublePattern]:
        """
        Find double top patterns from local highs
        """
        patterns = []

        # ✅ DIAGNÓSTICO: Contadores para entender rechazos
        stats = {
            'pairs_evaluated': 0,
            'rejected_too_close': 0,
            'rejected_too_far': 0,
            'rejected_price_diff': 0,
            'rejected_breakout': 0,
            'rejected_no_rejection_pattern': 0,
            'rejected_volume': 0,
            'accepted': 0
        }

        # Try to pair each high with subsequent highs
        for i in range(len(highs) - 1):
            h1 = highs[i]

            for j in range(i + 1, len(highs)):
                h2 = highs[j]
                stats['pairs_evaluated'] += 1

                # Check distance constraints
                candles_distance = h2['candle_index'] - h1['candle_index']

                if candles_distance < min_candles:
                    stats['rejected_too_close'] += 1
                    continue  # Too close

                if candles_distance > max_candles:
                    stats['rejected_too_far'] += 1
                    break  # Too far, no need to check further

                # Check price similarity
                # MEJORADO: Usar el CIERRE de la vela si el extremo sobrepasa
                # Esto permite que el high sobrepase pero el close esté dentro del rango
                h1_price = h1['price']
                h2_price = h2['price']
                h2_close = h2['candle'].get('close', h2_price)

                # Si el h2 sobrepasa significativamente a h1, usar el close en su lugar
                if h2_price > h1_price:
                    price_diff_extremes = abs(h1_price - h2_price)
                    if price_diff_extremes / h1_price > price_margin:
                        # El extremo está fuera de rango, verificar si el close está dentro
                        h2_price = h2_close

                price_diff = abs(h1_price - h2_price)
                price_avg = (h1_price + h2_price) / 2
                variance_pct = price_diff / price_avg

                if variance_pct > price_margin:
                    stats['rejected_price_diff'] += 1
                    continue  # Prices too different

                # NUEVO: Validar que el precio ENTRE los extremos no sobrepase el primer extremo
                # Para double top: el precio entre h1 y h2 no debe superar h1 significativamente
                # Si lo hace, indica un breakout y el patrón se invalida
                breakout_tolerance_pct = config.get('doubleTopBottom', {}).get('maxBreakoutPercent', 2.0) / 100.0
                candles_between = all_candles[h1['candle_index']:h2['candle_index'] + 1]

                if candles_between:
                    highest_high_between = max(c.get('high', 0) for c in candles_between)
                    breakout_amount = (highest_high_between - h1_price) / h1_price

                    if breakout_amount > breakout_tolerance_pct:
                        # El precio sobrepasó el primer extremo - patrón invalidado
                        stats['rejected_breakout'] += 1
                        print(f"    [PRUEBA_DBT] Double top REJECTED: Breakout entre extremos ({breakout_amount*100:.2f}% > {breakout_tolerance_pct*100:.2f}%)")
                        continue

                # NUEVO: Verificar si se requiere validación de patrones
                require_patterns = config.get('doubleTopBottom', {}).get('rejectionPatterns', {}).get('requirePatterns', True)

                if require_patterns:
                    # Validate rejection patterns at both extremes
                    rejection_h1 = self._validate_rejection_pattern(
                        h1['candle'],
                        all_candles[:h1['candle_index']],
                        config,
                        'bearish'  # Double top expects bearish rejection
                    )

                    rejection_h2 = self._validate_rejection_pattern(
                        h2['candle'],
                        all_candles[:h2['candle_index']],
                        config,
                        'bearish'
                    )

                    # Check if both rejections are required
                    require_both = config.get('filters', {}).get('requireBothRejections', True)

                    if require_both and (not rejection_h1['has_pattern'] or not rejection_h2['has_pattern']):
                        stats['rejected_no_rejection_pattern'] += 1
                        continue
                else:
                    # Sin validación de patrones - aceptar todos los extremos
                    rejection_h1 = {'has_pattern': True, 'pattern_type': 'NO_VALIDATION', 'quality': 0.5}
                    rejection_h2 = {'has_pattern': True, 'pattern_type': 'NO_VALIDATION', 'quality': 0.5}
                    print(f"    [PRUEBA_DBT] Pattern validation disabled - accepting extremes without rejection patterns")

                # Check volume significance if enabled
                volume_ok_h1 = True
                volume_ok_h2 = True
                zscore_h1 = 0.0
                zscore_h2 = 0.0

                if volume_filter_enabled and z_scores:
                    # Get separate thresholds for first and second extremes
                    # First extreme usually has higher volume (strong initial move)
                    # Second extreme usually has lower volume (weakness/divergence)
                    z_threshold_first = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {}).get('zScoreThresholdFirst', z_threshold)
                    z_threshold_second = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {}).get('zScoreThresholdSecond', z_threshold)

                    if h1['candle_index'] < len(z_scores):
                        zscore_h1 = z_scores[h1['candle_index']]
                        volume_ok_h1 = zscore_h1 >= z_threshold_first

                    if h2['candle_index'] < len(z_scores):
                        zscore_h2 = z_scores[h2['candle_index']]
                        volume_ok_h2 = zscore_h2 >= z_threshold_second

                    if not (volume_ok_h1 and volume_ok_h2):
                        continue  # Volume not significant enough

                # Calculate pattern metrics
                # Para Double Top: usar el máximo de los highs de los extremos
                level_price = max(h1['candle']['high'], h2['candle']['high'])
                time_diff_ms = h2['timestamp'] - h1['timestamp']
                duration_hours = time_diff_ms / (1000 * 60 * 60)

                # Calculate average volume
                volume_sum = sum(
                    c.get('volume', 0)
                    for c in all_candles[h1['candle_index']:h2['candle_index'] + 1]
                )
                volume_avg = volume_sum / candles_distance if candles_distance > 0 else 0

                # Calculate confidence
                confidence = self._calculate_confidence(
                    variance_pct,
                    rejection_h1,
                    rejection_h2,
                    volume_ok_h1,
                    volume_ok_h2,
                    zscore_h1,
                    zscore_h2
                )

                # Create pattern
                pattern = DoublePattern(
                    type="DOUBLE_TOP",
                    timestamp=h2['timestamp'],
                    confidence=confidence,
                    first_extreme={
                        'timestamp': h1['timestamp'],
                        'price': h1['price'],
                        'candle_index': h1['candle_index'],
                        'rejection_pattern': rejection_h1['pattern_type'],
                        'pattern_quality': rejection_h1['quality'],
                        'volume_zscore': zscore_h1
                    },
                    second_extreme={
                        'timestamp': h2['timestamp'],
                        'price': h2['price'],
                        'candle_index': h2['candle_index'],
                        'rejection_pattern': rejection_h2['pattern_type'],
                        'pattern_quality': rejection_h2['quality'],
                        'volume_zscore': zscore_h2
                    },
                    level_price=level_price,
                    price_variance=variance_pct * 100,
                    candles_between_extremes=candles_distance,
                    pattern_duration_hours=duration_hours,
                    volume_average=volume_avg,
                    meets_volume_criteria=volume_ok_h1 and volume_ok_h2
                )

                patterns.append(pattern)
                stats['accepted'] += 1

                # Detailed logging for detected pattern
                print(f"    [PRUEBA_DBT] [OK] DOUBLE TOP detected:")
                print(f"      Level Price: ${level_price:.2f}")
                print(f"      First extreme:  ${h1['price']:.2f} @ {h1['timestamp']} (candle {h1['candle_index']}) | Rejection: {rejection_h1['pattern_type']} (quality: {rejection_h1['quality']:.2f}) | Vol Z-Score: {zscore_h1:.2f}")
                print(f"      Second extreme: ${h2['price']:.2f} @ {h2['timestamp']} (candle {h2['candle_index']}) | Rejection: {rejection_h2['pattern_type']} (quality: {rejection_h2['quality']:.2f}) | Vol Z-Score: {zscore_h2:.2f}")
                print(f"      Price variance: {variance_pct * 100:.2f}%")
                print(f"      Candles between: {candles_distance}")
                print(f"      Duration: {duration_hours:.2f} hours")
                print(f"      Avg volume: {volume_avg:.2f}")
                print(f"      Confidence: {confidence:.1f}/100")

        # DIAGNOSTICO: Imprimir resumen de rechazos
        print(f"  [PRUEBA_DBT] [STATS] DOUBLE TOP Stats:")
        print(f"    - Pairs evaluated: {stats['pairs_evaluated']}")
        print(f"    - Rejected (too close): {stats['rejected_too_close']}")
        print(f"    - Rejected (too far): {stats['rejected_too_far']}")
        print(f"    - Rejected (price diff): {stats['rejected_price_diff']}")
        print(f"    - Rejected (breakout): {stats['rejected_breakout']}")
        print(f"    - Rejected (no rejection pattern): {stats['rejected_no_rejection_pattern']}")
        print(f"    - Rejected (volume): {stats['rejected_volume']}")
        print(f"    - [OK] ACCEPTED: {stats['accepted']}")

        return patterns

    def _find_double_bottoms(
        self,
        lows: List[Dict],
        all_candles: List[Dict],
        config: Dict,
        price_margin: float,
        min_candles: int,
        max_candles: int,
        z_scores: List[float],
        z_threshold: float,
        volume_filter_enabled: bool
    ) -> List[DoublePattern]:
        """
        Find double bottom patterns from local lows
        """
        patterns = []

        # ✅ DIAGNÓSTICO: Contadores para entender rechazos
        stats = {
            'pairs_evaluated': 0,
            'rejected_too_close': 0,
            'rejected_too_far': 0,
            'rejected_price_diff': 0,
            'rejected_breakout': 0,
            'rejected_no_rejection_pattern': 0,
            'rejected_volume': 0,
            'accepted': 0
        }

        # Try to pair each low with subsequent lows
        for i in range(len(lows) - 1):
            l1 = lows[i]

            for j in range(i + 1, len(lows)):
                l2 = lows[j]
                stats['pairs_evaluated'] += 1

                # Check distance constraints
                candles_distance = l2['candle_index'] - l1['candle_index']

                if candles_distance < min_candles:
                    stats['rejected_too_close'] += 1
                    continue

                if candles_distance > max_candles:
                    stats['rejected_too_far'] += 1
                    break

                # Check price similarity
                # MEJORADO: Usar el CIERRE de la vela si el extremo sobrepasa
                # Esto permite que el low sobrepase hacia abajo pero el close esté dentro del rango
                l1_price = l1['price']
                l2_price = l2['price']
                l2_close = l2['candle'].get('close', l2_price)

                # Si el l2 está significativamente más abajo que l1, usar el close en su lugar
                if l2_price < l1_price:
                    price_diff_extremes = abs(l1_price - l2_price)
                    if price_diff_extremes / l1_price > price_margin:
                        # El extremo está fuera de rango, verificar si el close está dentro
                        l2_price = l2_close

                price_diff = abs(l1_price - l2_price)
                price_avg = (l1_price + l2_price) / 2
                variance_pct = price_diff / price_avg

                if variance_pct > price_margin:
                    stats['rejected_price_diff'] += 1
                    continue

                # NUEVO: Validar que el precio ENTRE los extremos no caiga por debajo del primer extremo
                # Para double bottom: el precio entre l1 y l2 no debe caer por debajo de l1 significativamente
                # Si lo hace, indica un breakdown y el patrón se invalida
                breakout_tolerance_pct = config.get('doubleTopBottom', {}).get('maxBreakoutPercent', 2.0) / 100.0
                candles_between = all_candles[l1['candle_index']:l2['candle_index'] + 1]

                if candles_between:
                    lowest_low_between = min(c.get('low', float('inf')) for c in candles_between)
                    breakdown_amount = (l1_price - lowest_low_between) / l1_price

                    if breakdown_amount > breakout_tolerance_pct:
                        # El precio cayó por debajo del primer extremo - patrón invalidado
                        stats['rejected_breakout'] += 1
                        print(f"    [PRUEBA_DBT] Double bottom REJECTED: Breakdown entre extremos ({breakdown_amount*100:.2f}% > {breakout_tolerance_pct*100:.2f}%)")
                        continue

                # NUEVO: Verificar si se requiere validación de patrones
                require_patterns = config.get('doubleTopBottom', {}).get('rejectionPatterns', {}).get('requirePatterns', True)

                if require_patterns:
                    # Validate rejection patterns
                    rejection_l1 = self._validate_rejection_pattern(
                        l1['candle'],
                        all_candles[:l1['candle_index']],
                        config,
                        'bullish'  # Double bottom expects bullish rejection
                    )

                    rejection_l2 = self._validate_rejection_pattern(
                        l2['candle'],
                        all_candles[:l2['candle_index']],
                        config,
                        'bullish'
                    )

                    require_both = config.get('filters', {}).get('requireBothRejections', True)

                    if require_both and (not rejection_l1['has_pattern'] or not rejection_l2['has_pattern']):
                        stats['rejected_no_rejection_pattern'] += 1
                        continue
                else:
                    # Sin validación de patrones - aceptar todos los extremos
                    rejection_l1 = {'has_pattern': True, 'pattern_type': 'NO_VALIDATION', 'quality': 0.5}
                    rejection_l2 = {'has_pattern': True, 'pattern_type': 'NO_VALIDATION', 'quality': 0.5}
                    print(f"    [PRUEBA_DBT] Pattern validation disabled - accepting extremes without rejection patterns")

                # Check volume significance
                volume_ok_l1 = True
                volume_ok_l2 = True
                zscore_l1 = 0.0
                zscore_l2 = 0.0

                if volume_filter_enabled and z_scores:
                    # Get separate thresholds for first and second extremes
                    # First extreme usually has higher volume (strong initial move)
                    # Second extreme usually has lower volume (weakness/divergence)
                    z_threshold_first = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {}).get('zScoreThresholdFirst', z_threshold)
                    z_threshold_second = config.get('doubleTopBottom', {}).get('requireHighVolumeAtExtremes', {}).get('zScoreThresholdSecond', z_threshold)

                    if l1['candle_index'] < len(z_scores):
                        zscore_l1 = z_scores[l1['candle_index']]
                        volume_ok_l1 = zscore_l1 >= z_threshold_first

                    if l2['candle_index'] < len(z_scores):
                        zscore_l2 = z_scores[l2['candle_index']]
                        volume_ok_l2 = zscore_l2 >= z_threshold_second

                    if not (volume_ok_l1 and volume_ok_l2):
                        continue

                # Calculate metrics
                # Para Double Bottom: usar el mínimo de los lows de los extremos
                level_price = min(l1['candle']['low'], l2['candle']['low'])
                time_diff_ms = l2['timestamp'] - l1['timestamp']
                duration_hours = time_diff_ms / (1000 * 60 * 60)

                volume_sum = sum(
                    c.get('volume', 0)
                    for c in all_candles[l1['candle_index']:l2['candle_index'] + 1]
                )
                volume_avg = volume_sum / candles_distance if candles_distance > 0 else 0

                confidence = self._calculate_confidence(
                    variance_pct,
                    rejection_l1,
                    rejection_l2,
                    volume_ok_l1,
                    volume_ok_l2,
                    zscore_l1,
                    zscore_l2
                )

                pattern = DoublePattern(
                    type="DOUBLE_BOTTOM",
                    timestamp=l2['timestamp'],
                    confidence=confidence,
                    first_extreme={
                        'timestamp': l1['timestamp'],
                        'price': l1['price'],
                        'candle_index': l1['candle_index'],
                        'rejection_pattern': rejection_l1['pattern_type'],
                        'pattern_quality': rejection_l1['quality'],
                        'volume_zscore': zscore_l1
                    },
                    second_extreme={
                        'timestamp': l2['timestamp'],
                        'price': l2['price'],
                        'candle_index': l2['candle_index'],
                        'rejection_pattern': rejection_l2['pattern_type'],
                        'pattern_quality': rejection_l2['quality'],
                        'volume_zscore': zscore_l2
                    },
                    level_price=level_price,
                    price_variance=variance_pct * 100,
                    candles_between_extremes=candles_distance,
                    pattern_duration_hours=duration_hours,
                    volume_average=volume_avg,
                    meets_volume_criteria=volume_ok_l1 and volume_ok_l2
                )

                patterns.append(pattern)
                stats['accepted'] += 1

                # Detailed logging for detected pattern
                print(f"    [PRUEBA_DBT] [OK] DOUBLE BOTTOM detected:")
                print(f"      Level Price: ${level_price:.2f}")
                print(f"      First extreme:  ${l1['price']:.2f} @ {l1['timestamp']} (candle {l1['candle_index']}) | Rejection: {rejection_l1['pattern_type']} (quality: {rejection_l1['quality']:.2f}) | Vol Z-Score: {zscore_l1:.2f}")
                print(f"      Second extreme: ${l2['price']:.2f} @ {l2['timestamp']} (candle {l2['candle_index']}) | Rejection: {rejection_l2['pattern_type']} (quality: {rejection_l2['quality']:.2f}) | Vol Z-Score: {zscore_l2:.2f}")
                print(f"      Price variance: {variance_pct * 100:.2f}%")
                print(f"      Candles between: {candles_distance}")
                print(f"      Duration: {duration_hours:.2f} hours")
                print(f"      Avg volume: {volume_avg:.2f}")
                print(f"      Confidence: {confidence:.1f}/100")

        # DIAGNOSTICO: Imprimir resumen de rechazos
        print(f"  [PRUEBA_DBT] [STATS] DOUBLE BOTTOM Stats:")
        print(f"    - Pairs evaluated: {stats['pairs_evaluated']}")
        print(f"    - Rejected (too close): {stats['rejected_too_close']}")
        print(f"    - Rejected (too far): {stats['rejected_too_far']}")
        print(f"    - Rejected (price diff): {stats['rejected_price_diff']}")
        print(f"    - Rejected (breakout): {stats['rejected_breakout']}")
        print(f"    - Rejected (no rejection pattern): {stats['rejected_no_rejection_pattern']}")
        print(f"    - Rejected (volume): {stats['rejected_volume']}")
        print(f"    - [OK] ACCEPTED: {stats['accepted']}")

        return patterns

    def _validate_rejection_pattern(
        self,
        candle: Dict,
        prev_candles: List[Dict],
        config: Dict,
        expected_direction: str  # 'bullish' or 'bearish'
    ) -> Dict:
        """
        Validates if candle has a rejection pattern in the expected direction

        Returns:
            {
                'has_pattern': bool,
                'pattern_type': str,  # HAMMER, SHOOTING_STAR, ENGULFING_BULLISH, ENGULFING_BEARISH
                'quality': float  # 0.0 - 1.0
            }
        """
        rejection_patterns = config.get('doubleTopBottom', {}).get('rejectionPatterns', {})

        o = candle.get('open', 0)
        h = candle.get('high', 0)
        l = candle.get('low', 0)
        c = candle.get('close', 0)

        body = abs(c - o)
        lower_shadow = min(o, c) - l
        upper_shadow = h - max(o, c)
        total_range = h - l

        if total_range == 0:
            return {'has_pattern': False, 'pattern_type': None, 'quality': 0.0}

        # Check for Hammer (bullish)
        if expected_direction == 'bullish' and rejection_patterns.get('hammer', True):
            if lower_shadow >= 1.5 * body and upper_shadow <= 0.3 * body and (c - l) / total_range >= 0.5:
                # Protección contra división por cero
                quality = min(1.0, (lower_shadow / body) / 3.0) if body > 0 else 0.8
                return {'has_pattern': True, 'pattern_type': 'HAMMER', 'quality': quality}

        # Check for Shooting Star (bearish)
        if expected_direction == 'bearish' and rejection_patterns.get('shootingStar', True):
            if upper_shadow >= 1.5 * body and lower_shadow <= 0.3 * body and (h - c) / total_range >= 0.5:
                # Protección contra división por cero
                quality = min(1.0, (upper_shadow / body) / 3.0) if body > 0 else 0.8
                return {'has_pattern': True, 'pattern_type': 'SHOOTING_STAR', 'quality': quality}

        # Check for Engulfing patterns
        if len(prev_candles) > 0 and rejection_patterns.get('bullishEngulfing', True):
            prev_candle = prev_candles[-1]

            prev_body_top = max(prev_candle['open'], prev_candle['close'])
            prev_body_bottom = min(prev_candle['open'], prev_candle['close'])
            curr_body_top = max(o, c)
            curr_body_bottom = min(o, c)

            # Bullish engulfing
            if expected_direction == 'bullish':
                if (prev_candle['close'] < prev_candle['open'] and
                    c > o and
                    curr_body_bottom < prev_body_bottom and
                    curr_body_top > prev_body_top):
                    quality = min(1.0, body / total_range * 1.2)
                    return {'has_pattern': True, 'pattern_type': 'ENGULFING_BULLISH', 'quality': quality}

            # Bearish engulfing
            if expected_direction == 'bearish' and rejection_patterns.get('bearishEngulfing', True):
                if (prev_candle['close'] > prev_candle['open'] and
                    c < o and
                    curr_body_top > prev_body_top and
                    curr_body_bottom < prev_body_bottom):
                    quality = min(1.0, body / total_range * 1.2)
                    return {'has_pattern': True, 'pattern_type': 'ENGULFING_BEARISH', 'quality': quality}

        return {'has_pattern': False, 'pattern_type': None, 'quality': 0.0}

    def _calculate_confidence(
        self,
        price_variance: float,
        rejection1: Dict,
        rejection2: Dict,
        volume_ok1: bool,
        volume_ok2: bool,
        zscore1: float,
        zscore2: float
    ) -> float:
        """
        Calculate pattern confidence (0-100) based on multiple factors

        Factors:
        - Rejection quality at extreme 1: 25 points
        - Rejection quality at extreme 2: 25 points
        - Price similarity (lower variance = higher score): 20 points
        - Volume significance: 15 points
        - Pattern symmetry: 15 points
        """
        confidence = 0.0

        # 1. Rejection quality at extreme 1 (25 points)
        if rejection1['has_pattern']:
            confidence += rejection1['quality'] * 25

        # 2. Rejection quality at extreme 2 (25 points)
        if rejection2['has_pattern']:
            confidence += rejection2['quality'] * 25

        # 3. Price similarity (20 points)
        # Lower variance = higher score
        # variance_pct is already between 0 and price_margin (e.g., 0.02 for 2%)
        # Invert it so that 0 variance = 20 points
        price_score = max(0, 1 - (price_variance / 0.02))  # Normalize to 2% margin
        confidence += price_score * 20

        # 4. Volume significance (15 points)
        if volume_ok1 and volume_ok2:
            # Average z-score quality
            avg_zscore = (abs(zscore1) + abs(zscore2)) / 2
            volume_score = min(1.0, avg_zscore / 3.0)  # Normalize to z-score of 3
            confidence += volume_score * 15

        # 5. Pattern symmetry (15 points)
        # If both have same quality of rejection, it's more symmetric
        if rejection1['has_pattern'] and rejection2['has_pattern']:
            quality_diff = abs(rejection1['quality'] - rejection2['quality'])
            symmetry_score = 1.0 - quality_diff
            confidence += symmetry_score * 15

        return min(100.0, round(confidence, 2))

    def _add_momentum_confirmation(
        self,
        patterns: List[DoublePattern],
        all_candles: List[Dict],
        config: Dict
    ) -> List[DoublePattern]:
        """
        Add momentum confirmation to detected patterns (Phase 2)

        Looks for momentum patterns after the second extreme:
        - Marubozu (body >= 80% of range)
        - White Soldiers / Black Crows (3+ consecutive candles)
        - Big Body (body >= 70% with optional big wick)

        Now includes volume validation to ensure institutional backing.
        """
        lookback_after = config.get('momentumConfirmation', {}).get('lookbackAfterPattern', 10)
        require_momentum = config.get('momentumConfirmation', {}).get('requireMomentum', False)

        # Calculate z-scores for volume validation
        volume_config = config.get('momentumConfirmation', {}).get('volumeFilter', {})
        volume_enabled = volume_config.get('enabled', False)
        z_scores = []

        if volume_enabled:
            z_period = volume_config.get('zScorePeriod', 20)
            z_scores = self._calculate_z_scores(all_candles, z_period)

        updated_patterns = []

        for pattern in patterns:
            second_extreme_index = pattern.second_extreme['candle_index']

            # Search for momentum in the candles after the second extreme
            search_end = min(second_extreme_index + lookback_after, len(all_candles))
            search_range = all_candles[second_extreme_index:search_end]

            # Get z-scores for the search range
            z_scores_range = z_scores[second_extreme_index:search_end] if z_scores else []

            # Determine expected momentum direction
            expected_direction = 'bearish' if pattern.type == 'DOUBLE_TOP' else 'bullish'

            # Search for momentum patterns with volume validation
            momentum = self._detect_momentum(
                search_range,
                config,
                expected_direction,
                z_scores_range,
                second_extreme_index
            )

            if momentum['has_momentum']:
                pattern.entry_signal = momentum
            elif require_momentum:
                # Skip this pattern if momentum is required but not found
                continue

            updated_patterns.append(pattern)

        return updated_patterns

    def _validate_post_pattern_movement(
        self,
        patterns: List[DoublePattern],
        all_candles: List[Dict],
        config: Dict
    ) -> List[DoublePattern]:
        """
        Validate that after the second extreme, price moves in the expected direction.
        This helps filter out false patterns and prioritize real rejections.

        - For DOUBLE_TOP: Verify price moves DOWN after second peak
        - For DOUBLE_BOTTOM: Verify price moves UP after second low

        Adds bonus to confidence if strong directional movement is confirmed.

        IMPORTANT for real-time trading:
        - If applyPostValidationToRealtimeSignals is False (default):
          * Most recent pattern is NOT validated (immediate signal for trading)
          * Historical patterns ARE validated (for accuracy/filtering)
        - If applyPostValidationToRealtimeSignals is True:
          * All patterns are validated (better for backtesting)
        """
        # Get validation parameters
        apply_to_realtime = config.get('filters', {}).get('applyPostValidationToRealtimeSignals', False)
        validation_candles = config.get('filters', {}).get('postPatternValidationCandles', 5)
        min_move_percent = config.get('filters', {}).get('minPostPatternMovePercent', 0.5)
        confidence_bonus = config.get('filters', {}).get('postPatternConfidenceBonus', 20)

        # Find the most recent pattern (highest second extreme timestamp)
        most_recent_timestamp = 0
        if patterns:
            most_recent_timestamp = max(p.second_extreme['timestamp'] for p in patterns)

        validated_patterns = []
        patterns_with_bonus = 0
        patterns_skipped_realtime = 0

        for pattern in patterns:
            second_idx = pattern.second_extreme['candle_index']
            second_price = pattern.second_extreme['price']
            is_most_recent = pattern.second_extreme['timestamp'] == most_recent_timestamp

            # Skip validation for most recent pattern if apply_to_realtime is False
            # This allows immediate real-time signals without waiting for confirmation
            if not apply_to_realtime and is_most_recent:
                patterns_skipped_realtime += 1
                validated_patterns.append(pattern)
                continue

            # Get candles after the second extreme
            search_end = min(second_idx + 1 + validation_candles, len(all_candles))
            if search_end <= second_idx + 1:
                # Not enough candles after pattern
                validated_patterns.append(pattern)
                continue

            post_candles = all_candles[second_idx + 1:search_end]

            if not post_candles:
                validated_patterns.append(pattern)
                continue

            # Calculate price movement after pattern
            if pattern.type == 'DOUBLE_TOP':
                # For double top, we want price to go DOWN
                # Find lowest low in post candles
                lowest_low = min(c.get('low', float('inf')) for c in post_candles)
                price_move_pct = ((second_price - lowest_low) / second_price) * 100

                if price_move_pct >= min_move_percent:
                    # Strong bearish movement confirmed
                    pattern.confidence += confidence_bonus
                    pattern.confidence = min(100.0, pattern.confidence)  # Cap at 100
                    patterns_with_bonus += 1

            else:  # DOUBLE_BOTTOM
                # For double bottom, we want price to go UP
                # Find highest high in post candles
                highest_high = max(c.get('high', 0) for c in post_candles)
                price_move_pct = ((highest_high - second_price) / second_price) * 100

                if price_move_pct >= min_move_percent:
                    # Strong bullish movement confirmed
                    pattern.confidence += confidence_bonus
                    pattern.confidence = min(100.0, pattern.confidence)  # Cap at 100
                    patterns_with_bonus += 1

            validated_patterns.append(pattern)

        print(f"    Post-validation: {len(validated_patterns)} patterns kept, {patterns_with_bonus} got bonus, {patterns_skipped_realtime} skipped (real-time mode)")

        return validated_patterns

    def _filter_duplicate_patterns(
        self,
        patterns: List[DoublePattern],
        config: Dict
    ) -> List[DoublePattern]:
        """
        Remove duplicate patterns that are in the same price/time zone.

        Strategy:
        - Group patterns by type and similar level price
        - Within each group, keep only the BEST pattern based on:
          1. Earliest first extreme (first rejection is prioritized)
          2. Higher confidence
          3. Stronger rejection patterns
        """
        if not patterns:
            return patterns

        # Get deduplication parameters
        price_tolerance_pct = config.get('filters', {}).get('duplicatePriceTolerancePercent', 2.0)
        time_tolerance_hours = config.get('filters', {}).get('duplicateTimeToleranceHours', 24)

        # Separate by type
        double_tops = [p for p in patterns if p.type == 'DOUBLE_TOP']
        double_bottoms = [p for p in patterns if p.type == 'DOUBLE_BOTTOM']

        # Deduplicate each type separately
        filtered_tops = self._deduplicate_by_zone(double_tops, price_tolerance_pct, time_tolerance_hours)
        filtered_bottoms = self._deduplicate_by_zone(double_bottoms, price_tolerance_pct, time_tolerance_hours)

        return filtered_tops + filtered_bottoms

    def _deduplicate_by_zone(
        self,
        patterns: List[DoublePattern],
        price_tolerance_pct: float,
        time_tolerance_hours: float
    ) -> List[DoublePattern]:
        """
        Helper to deduplicate patterns of the same type by grouping similar zones.
        """
        if len(patterns) <= 1:
            return patterns

        # Sort by first extreme timestamp (earlier patterns first)
        sorted_patterns = sorted(patterns, key=lambda p: p.first_extreme['timestamp'])

        kept_patterns = []

        for pattern in sorted_patterns:
            # Check if this pattern is a duplicate of any kept pattern
            is_duplicate = False

            for kept in kept_patterns:
                # Check price similarity
                price_diff = abs(pattern.level_price - kept.level_price)
                price_avg = (pattern.level_price + kept.level_price) / 2
                price_diff_pct = (price_diff / price_avg) * 100

                # Check time overlap
                time_diff_ms = abs(pattern.first_extreme['timestamp'] - kept.first_extreme['timestamp'])
                time_diff_hours = time_diff_ms / (1000 * 60 * 60)

                if price_diff_pct <= price_tolerance_pct and time_diff_hours <= time_tolerance_hours:
                    # This is a duplicate - check which one is better
                    # Prioritize: 1) Earlier first extreme, 2) Higher confidence, 3) Better rejections

                    if pattern.first_extreme['timestamp'] < kept.first_extreme['timestamp']:
                        # New pattern is earlier - replace
                        kept_patterns.remove(kept)
                        kept_patterns.append(pattern)
                    elif pattern.first_extreme['timestamp'] == kept.first_extreme['timestamp']:
                        # Same first extreme - compare confidence
                        if pattern.confidence > kept.confidence:
                            kept_patterns.remove(kept)
                            kept_patterns.append(pattern)

                    is_duplicate = True
                    break

            if not is_duplicate:
                kept_patterns.append(pattern)

        return kept_patterns

    def _detect_momentum(
        self,
        candles: List[Dict],
        config: Dict,
        expected_direction: str,
        z_scores: List[float] = None,
        base_index: int = 0
    ) -> Dict:
        """
        Detect momentum patterns in the given candles with volume validation

        Args:
            candles: List of candles to search
            config: Configuration dict
            expected_direction: 'bullish' or 'bearish'
            z_scores: Optional z-scores for volume validation
            base_index: Base index offset for z-score lookup

        Returns:
            {
                'has_momentum': bool,
                'momentum_pattern': str,
                'entry_candle_timestamp': int,
                'entry_price': float,
                'direction': str,  # 'LONG' or 'SHORT'
                'momentum_quality': float,
                'volume_zscore': float  # Average z-score of momentum candles
            }
        """
        patterns_config = config.get('momentumConfirmation', {}).get('patterns', {})
        volume_config = config.get('momentumConfirmation', {}).get('volumeFilter', {})
        volume_enabled = volume_config.get('enabled', False)
        min_zscore = volume_config.get('zScoreThreshold', 1.0)

        for i, candle in enumerate(candles):
            o = candle.get('open', 0)
            h = candle.get('high', 0)
            l = candle.get('low', 0)
            c = candle.get('close', 0)

            body = abs(c - o)
            total_range = h - l

            if total_range == 0:
                continue

            body_ratio = body / total_range
            is_bullish = c > o
            is_bearish = c < o

            # Check Marubozu
            if patterns_config.get('marubozu', {}).get('enabled', True):
                min_body_ratio = patterns_config.get('marubozu', {}).get('minBodyRatio', 0.8)

                upper_wick = h - max(o, c)
                lower_wick = min(o, c) - l

                if (body_ratio >= min_body_ratio and
                    upper_wick / total_range < 0.1 and
                    lower_wick / total_range < 0.1):

                    if (expected_direction == 'bullish' and is_bullish) or \
                       (expected_direction == 'bearish' and is_bearish):

                        # Volume validation
                        avg_zscore = 0.0
                        if volume_enabled and z_scores and i < len(z_scores):
                            avg_zscore = z_scores[i]
                            if avg_zscore < min_zscore:
                                continue  # Skip pattern with insufficient volume

                        return {
                            'has_momentum': True,
                            'momentum_pattern': 'BULLISH_MARUBOZU' if is_bullish else 'BEARISH_MARUBOZU',
                            'entry_candle_timestamp': candle['timestamp'],
                            'entry_price': c,
                            'direction': 'LONG' if is_bullish else 'SHORT',
                            'momentum_quality': body_ratio,
                            'volume_zscore': avg_zscore
                        }

            # Check Big Body
            if patterns_config.get('bigBody', {}).get('enabled', True):
                min_body_ratio = patterns_config.get('bigBody', {}).get('minBodyRatio', 0.7)
                allow_big_wick = patterns_config.get('bigBody', {}).get('allowBigWick', True)

                if body_ratio >= min_body_ratio:
                    upper_wick = h - max(o, c)
                    lower_wick = min(o, c) - l

                    wicks_ok = allow_big_wick or (upper_wick / total_range < 0.3 and lower_wick / total_range < 0.3)

                    if wicks_ok and ((expected_direction == 'bullish' and is_bullish) or \
                                     (expected_direction == 'bearish' and is_bearish)):

                        # Volume validation
                        avg_zscore = 0.0
                        if volume_enabled and z_scores and i < len(z_scores):
                            avg_zscore = z_scores[i]
                            if avg_zscore < min_zscore:
                                continue  # Skip pattern with insufficient volume

                        return {
                            'has_momentum': True,
                            'momentum_pattern': 'BIG_BODY_BULLISH' if is_bullish else 'BIG_BODY_BEARISH',
                            'entry_candle_timestamp': candle['timestamp'],
                            'entry_price': c,
                            'direction': 'LONG' if is_bullish else 'SHORT',
                            'momentum_quality': body_ratio,
                            'volume_zscore': avg_zscore
                        }

            # Check Soldiers/Crows (need at least 3 candles)
            if i >= 2 and patterns_config.get('soldiers_crows', {}).get('enabled', True):
                three_candles = candles[i-2:i+1]
                min_body_ratio = patterns_config.get('soldiers_crows', {}).get('minBodyRatio', 0.6)

                soldiers_crows = self._is_soldiers_or_crows(three_candles, min_body_ratio, expected_direction)

                if soldiers_crows:
                    # Volume validation (average z-score of the 3 candles)
                    avg_zscore = 0.0
                    if volume_enabled and z_scores and i < len(z_scores):
                        # Average z-score of the 3 candles
                        z_score_sum = sum(z_scores[j] for j in range(i-2, i+1) if j < len(z_scores))
                        avg_zscore = z_score_sum / 3
                        if avg_zscore < min_zscore:
                            continue  # Skip pattern with insufficient volume

                    return {
                        'has_momentum': True,
                        'momentum_pattern': 'WHITE_SOLDIERS' if expected_direction == 'bullish' else 'BLACK_CROWS',
                        'entry_candle_timestamp': candle['timestamp'],
                        'entry_price': c,
                        'direction': 'LONG' if expected_direction == 'bullish' else 'SHORT',
                        'momentum_quality': 0.9,  # High quality for 3-candle patterns
                        'volume_zscore': avg_zscore
                    }

        return {'has_momentum': False}

    def _is_soldiers_or_crows(
        self,
        three_candles: List[Dict],
        min_body_ratio: float,
        expected_direction: str
    ) -> bool:
        """
        Check if three candles form White Soldiers or Black Crows pattern
        """
        if len(three_candles) != 3:
            return False

        # Check all candles have sufficient body ratio
        for candle in three_candles:
            body = abs(candle['close'] - candle['open'])
            total_range = candle['high'] - candle['low']

            if total_range == 0 or body / total_range < min_body_ratio:
                return False

        # Check direction consistency
        if expected_direction == 'bullish':
            # All should be bullish and progressive
            if not all(c['close'] > c['open'] for c in three_candles):
                return False

            # Check progression
            if not (three_candles[1]['close'] > three_candles[0]['close'] and
                    three_candles[2]['close'] > three_candles[1]['close']):
                return False

        elif expected_direction == 'bearish':
            # All should be bearish and progressive
            if not all(c['close'] < c['open'] for c in three_candles):
                return False

            # Check progression
            if not (three_candles[1]['close'] < three_candles[0]['close'] and
                    three_candles[2]['close'] < three_candles[1]['close']):
                return False

        return True


def serialize_pattern(pattern: DoublePattern) -> Dict:
    """Serializes a DoublePattern to JSON-compatible dict"""
    return {
        "type": pattern.type,
        "timestamp": pattern.timestamp,
        "confidence": pattern.confidence,
        "firstExtreme": pattern.first_extreme,
        "secondExtreme": pattern.second_extreme,
        "levelPrice": pattern.level_price,
        "priceVariance": pattern.price_variance,
        "entrySignal": pattern.entry_signal,
        "candlesBetweenExtremes": pattern.candles_between_extremes,
        "patternDurationHours": pattern.pattern_duration_hours,
        "volumeAverage": pattern.volume_average,
        "meetsVolumeCriteria": pattern.meets_volume_criteria
    }
