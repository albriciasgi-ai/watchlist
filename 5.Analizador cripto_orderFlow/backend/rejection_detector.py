"""
Rejection Pattern Detector Module

Detects candlestick rejection patterns (Pin Bars, Engulfing, etc.)
validated against user-selected reference contexts (Volume Profiles, Range Detector).

Author: Claude Code
Date: 2025-11-11
"""

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
import math


@dataclass
class ReferenceLevel:
    """Represents a key level from a reference context"""
    price: float
    type: str  # "POC", "VAH", "VAL", "TOP", "BOTTOM", "MIDDLE", "ZONE_TOP", "ZONE_BOTTOM", "ZONE_MIDDLE"
    source_id: str  # ID of the source context
    source_type: str  # "VOLUME_PROFILE_DYNAMIC", "VOLUME_PROFILE_FIXED", "RANGE_DETECTOR", "MANUAL_ZONE"
    weight: float  # Weight in confidence calculation (0.0 - 1.0)
    signal_direction: Optional[str] = None  # "LONG", "SHORT", "BOTH" or None (for zones only)
    min_price: Optional[float] = None  # For zones: minimum price of the zone
    max_price: Optional[float] = None  # For zones: maximum price of the zone


@dataclass
class RejectionPattern:
    """Represents a detected rejection pattern with validation"""
    timestamp: int
    pattern_type: str  # "HAMMER", "SHOOTING_STAR", "ENGULFING_BULLISH", "ENGULFING_BEARISH", "DOJI_DRAGONFLY", "DOJI_GRAVESTONE"
    confidence: float  # 0-100
    price: float  # Close price of the pattern candle
    candle_data: Dict
    near_levels: List[ReferenceLevel]
    context_scores: Dict[str, float]  # Score per context
    metrics: Dict[str, float]  # Pattern-specific metrics


class RejectionDetector:
    """Main class for detecting rejection patterns"""

    def __init__(self):
        self.proximity_threshold = 0.01  # 1% default

    def detect_patterns(
        self,
        symbol: str,
        candles: List[Dict],
        config: Dict,
        reference_contexts: List[Dict]
    ) -> List[RejectionPattern]:
        """
        Detects rejection patterns validated by reference contexts

        Args:
            symbol: Cryptocurrency symbol
            candles: List of OHLCV candles
            config: Pattern detection configuration
            reference_contexts: List of active reference contexts

        Returns:
            List of detected patterns with validation
        """
        detected_patterns = []

        # Check if near level validation is required
        require_near_level = config.get('filters', {}).get('requireNearLevel', True)

        # 1. Extract levels from all active contexts
        reference_levels = self._extract_reference_levels(
            symbol,
            reference_contexts
        )

        if not reference_levels and require_near_level:
            print(f"[WARN] No reference levels for {symbol}. "
                  f"Detection disabled to avoid false positives.")
            return []
        elif not reference_levels:
            print(f"[INFO] No reference levels for {symbol}, but requireNearLevel=False. "
                  f"Detecting all patterns without level validation.")

        # Log enabled patterns for debugging
        patterns_config = config.get('patterns', {})
        enabled_patterns = [p for p, cfg in patterns_config.items() if cfg.get('enabled', False)]
        print(f"[REJECTION] {symbol}: Enabled patterns: {enabled_patterns}, swing detection: {config.get('swingDetection', {}).get('enabled', False)}")

        # 2. Detect patterns in each candle
        for i in range(1, len(candles)):  # Start at 1 to have at least 1 previous candle
            candle = candles[i]
            prev_candles = candles[max(0, i-20):i]  # 20 previous candles for context

            # Detect each pattern type if enabled
            if config.get('patterns', {}).get('hammer', {}).get('enabled', False):
                if self._is_hammer(candle, prev_candles, config['patterns']['hammer']):
                    pattern = self._create_pattern(
                        candle,
                        "HAMMER",
                        reference_levels,
                        config,
                        prev_candles
                    )
                    if pattern:
                        detected_patterns.append(pattern)

            if config.get('patterns', {}).get('shootingStar', {}).get('enabled', False):
                if self._is_shooting_star(candle, prev_candles, config['patterns']['shootingStar']):
                    pattern = self._create_pattern(
                        candle,
                        "SHOOTING_STAR",
                        reference_levels,
                        config,
                        prev_candles
                    )
                    if pattern:
                        detected_patterns.append(pattern)

            if config.get('patterns', {}).get('engulfing', {}).get('enabled', False) and i > 0:
                engulfing_type = self._is_engulfing(candles[i-1], candle)
                if engulfing_type:
                    pattern = self._create_pattern(
                        candle,
                        engulfing_type,
                        reference_levels,
                        config,
                        prev_candles
                    )
                    if pattern:
                        detected_patterns.append(pattern)

            if config.get('patterns', {}).get('doji', {}).get('enabled', False):
                doji_type = self._is_doji(candle, prev_candles)
                if doji_type:
                    pattern = self._create_pattern(
                        candle,
                        doji_type,
                        reference_levels,
                        config,
                        prev_candles
                    )
                    if pattern:
                        detected_patterns.append(pattern)

            # Swing Detection (SWING_LOW / SWING_HIGH)
            swing_config = config.get('swingDetection', {})
            if swing_config.get('enabled', False):
                left_bars = swing_config.get('leftBars', 5)
                right_bars = swing_config.get('rightBars', 5)

                # Check for Swing Low
                if self._is_swing_low(candles, i, left_bars, right_bars):
                    pattern = self._create_pattern(
                        candle,
                        "SWING_LOW",
                        reference_levels,
                        config,
                        prev_candles
                    )
                    if pattern:
                        detected_patterns.append(pattern)

                # Check for Swing High
                if self._is_swing_high(candles, i, left_bars, right_bars):
                    pattern = self._create_pattern(
                        candle,
                        "SWING_HIGH",
                        reference_levels,
                        config,
                        prev_candles
                    )
                    if pattern:
                        detected_patterns.append(pattern)

        print(f"[REJECTION] {symbol}: Found {len(detected_patterns)} patterns before filtering")
        return detected_patterns

    def _extract_reference_levels(
        self,
        symbol: str,
        reference_contexts: List[Dict]
    ) -> List[ReferenceLevel]:
        """
        Extracts all key levels from active reference contexts

        Note: This is a placeholder. In production, this would query
        actual Volume Profile and Range Detector data.
        """
        levels = []

        for context in reference_contexts:
            if not context.get('enabled', False):
                continue

            context_type = context['type']
            context_id = context['id']
            weight = context.get('weight', 0.5)

            # Get metadata which should contain the actual levels
            metadata = context.get('metadata', {})

            if context_type in ["VOLUME_PROFILE_DYNAMIC", "VOLUME_PROFILE_FIXED"]:
                # Extract VP levels from metadata
                for level_type in context.get('levels', ['POC', 'VAH', 'VAL']):
                    level_key = level_type.lower()
                    if level_key in metadata:
                        levels.append(ReferenceLevel(
                            price=float(metadata[level_key]),
                            type=level_type,
                            source_id=context_id,
                            source_type=context_type,
                            weight=weight
                        ))

            elif context_type == "RANGE_DETECTOR":
                # Extract range levels from metadata
                if 'top' in metadata and 'bottom' in metadata:
                    top = float(metadata['top'])
                    bottom = float(metadata['bottom'])

                    levels.append(ReferenceLevel(
                        price=top,
                        type='TOP',
                        source_id=context_id,
                        source_type=context_type,
                        weight=weight
                    ))
                    levels.append(ReferenceLevel(
                        price=bottom,
                        type='BOTTOM',
                        source_id=context_id,
                        source_type=context_type,
                        weight=weight
                    ))
                    levels.append(ReferenceLevel(
                        price=(top + bottom) / 2,
                        type='MIDDLE',
                        source_id=context_id,
                        source_type=context_type,
                        weight=weight * 0.7  # Lower weight for middle level
                    ))

            elif context_type == "manual_zone":
                # ✅ NUEVO: Extract levels from manual price zones
                min_price = context.get('minPrice')
                max_price = context.get('maxPrice')
                signal_direction = context.get('signalDirection', 'BOTH')  # Get signal direction from context

                if min_price is not None and max_price is not None:
                    # Agregar 3 niveles: min, max, mid
                    # IMPORTANTE: Todos los niveles comparten el signalDirection y el rango completo
                    levels.append(ReferenceLevel(
                        price=float(max_price),
                        type='ZONE_TOP',
                        source_id=context_id,
                        source_type='MANUAL_ZONE',
                        weight=weight,
                        signal_direction=signal_direction,
                        min_price=float(min_price),
                        max_price=float(max_price)
                    ))
                    levels.append(ReferenceLevel(
                        price=float(min_price),
                        type='ZONE_BOTTOM',
                        source_id=context_id,
                        source_type='MANUAL_ZONE',
                        weight=weight,
                        signal_direction=signal_direction,
                        min_price=float(min_price),
                        max_price=float(max_price)
                    ))
                    levels.append(ReferenceLevel(
                        price=(float(min_price) + float(max_price)) / 2,
                        type='ZONE_MIDDLE',
                        source_id=context_id,
                        source_type='MANUAL_ZONE',
                        weight=weight * 0.9,  # High weight for middle level
                        signal_direction=signal_direction,
                        min_price=float(min_price),
                        max_price=float(max_price)
                    ))

                    print(f"  [OK] Manual Zone '{context.get('name', context_id)}': {min_price:.2f} - {max_price:.2f} (signalDirection={signal_direction})")
                    print(f"      [TARGET] Zone will filter patterns to: {signal_direction}")

        print(f"[LEVELS] [{symbol}] Extracted {len(levels)} reference levels from {len([c for c in reference_contexts if c.get('enabled', False)])} active contexts")

        return levels

    def _create_pattern(
        self,
        candle: Dict,
        pattern_type: str,
        reference_levels: List[ReferenceLevel],
        config: Dict,
        prev_candles: List[Dict]
    ) -> Optional[RejectionPattern]:
        """
        Creates a pattern validated by reference contexts
        """
        close_price = candle['close']
        proximity_pct = config.get('filters', {}).get('proximityPercent', 1.0) / 100

        # ✅ NUEVO: Determinar dirección del patrón
        bullish_patterns = ["HAMMER", "ENGULFING_BULLISH", "DOJI_DRAGONFLY", "SWING_LOW"]
        bearish_patterns = ["SHOOTING_STAR", "ENGULFING_BEARISH", "DOJI_GRAVESTONE", "SWING_HIGH"]

        pattern_direction = None
        if pattern_type in bullish_patterns:
            pattern_direction = "LONG"
        elif pattern_type in bearish_patterns:
            pattern_direction = "SHORT"

        # Find nearby levels and validate zone constraints
        near_levels = []

        for level in reference_levels:
            # ✅ Para zonas manuales, validar que el precio esté DENTRO del rango
            if level.source_type == 'MANUAL_ZONE':
                # 1. Verificar que el precio esté dentro del rango de la zona
                if level.min_price is not None and level.max_price is not None:
                    if close_price < level.min_price or close_price > level.max_price:
                        # Fuera de esta zona, probar la siguiente
                        print(f"    [SKIP] Pattern at {close_price:.2f} outside zone range {level.min_price:.2f}-{level.max_price:.2f}")
                        continue

                    # 2. Precio DENTRO de la zona, verificar dirección
                    print(f"    [OK] Pattern at {close_price:.2f} IS INSIDE zone range {level.min_price:.2f}-{level.max_price:.2f}")

                    # 3. Verificar signal_direction de la zona
                    if level.signal_direction and level.signal_direction != 'BOTH':
                        if pattern_direction and pattern_direction != level.signal_direction:
                            # Dirección no coincide con ESTA zona, probar la siguiente
                            print(f"    [REJECT] Pattern {pattern_type} ({pattern_direction}) rejected by zone '{level.context_id}' (requires {level.signal_direction})")
                            continue

                    # 4. Pasó ambas validaciones (rango + dirección), agregar nivel
                    print(f"    [OK] Pattern {pattern_type} ({pattern_direction}) accepted by zone '{level.context_id}' (allows {level.signal_direction or 'BOTH'})")
                    near_levels.append(level)
                    print(f"    [OK] Added manual zone level to near_levels (no proximity check needed)")
            else:
                # Para otros tipos de niveles (VP, S&R), usar proximidad normal
                distance_pct = abs(close_price - level.price) / close_price
                if distance_pct <= proximity_pct:
                    near_levels.append(level)

        # If near level is required and there are none, reject
        if config.get('filters', {}).get('requireNearLevel', True) and not near_levels:
            return None

        # Calculate confidence based on contexts
        confidence, metrics = self._calculate_confidence(
            candle,
            pattern_type,
            near_levels,
            config,
            prev_candles
        )

        # Filter by minimum confidence
        min_confidence = config.get('filters', {}).get('minConfidence', 60)
        if confidence < min_confidence:
            return None

        # Calculate scores per context
        context_scores = {}
        for level in near_levels:
            source_key = f"{level.source_type}_{level.source_id}"
            if source_key not in context_scores:
                context_scores[source_key] = 0
            # Score based on proximity and weight
            distance_pct = abs(close_price - level.price) / close_price
            proximity_score = max(0, 1 - (distance_pct / proximity_pct))
            context_scores[source_key] += proximity_score * level.weight * 100

        return RejectionPattern(
            timestamp=candle['timestamp'],
            pattern_type=pattern_type,
            confidence=round(confidence, 2),
            price=close_price,
            candle_data=candle,
            near_levels=near_levels,
            context_scores=context_scores,
            metrics=metrics
        )

    def _calculate_confidence(
        self,
        candle: Dict,
        pattern_type: str,
        near_levels: List[ReferenceLevel],
        config: Dict,
        prev_candles: List[Dict]
    ) -> Tuple[float, Dict[str, float]]:
        """
        Calculates pattern confidence based on:
        1. Pattern quality (30 points)
        2. Proximity to key levels (40 points)
        3. Volume (15 points)
        4. Relative size (15 points)

        Returns:
            Tuple of (confidence, metrics_dict)
        """
        confidence = 0
        metrics = {}

        # 1. Pattern quality (30 points)
        pattern_quality = self._assess_pattern_quality(candle, pattern_type)
        confidence += pattern_quality * 30
        metrics['pattern_quality'] = round(pattern_quality, 3)

        # 2. Proximity to levels (40 points)
        if near_levels:
            # Use the highest weight among near levels
            max_weight = max(level.weight for level in near_levels)
            proximity_score = max_weight
            confidence += proximity_score * 40
            metrics['proximity_score'] = round(proximity_score, 3)
            metrics['near_levels_count'] = len(near_levels)
        else:
            metrics['proximity_score'] = 0
            metrics['near_levels_count'] = 0

        # 3. Volume (15 points)
        volume_score = self._assess_volume(candle, prev_candles)
        if config.get('filters', {}).get('requireVolumeSpike', False):
            confidence += volume_score * 15
        metrics['volume_score'] = round(volume_score, 3)

        # 4. Relative size (15 points)
        size_score = self._assess_relative_size(candle, prev_candles)
        confidence += size_score * 15
        metrics['size_score'] = round(size_score, 3)

        return min(confidence, 100), metrics

    def _assess_pattern_quality(self, candle: Dict, pattern_type: str) -> float:
        """
        Assesses the quality of the pattern (0.0 - 1.0)
        Higher quality = more pronounced pattern characteristics
        """
        o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
        body = abs(c - o)
        lower_shadow = min(o, c) - l
        upper_shadow = h - max(o, c)
        total_range = h - l

        if total_range == 0:
            return 0

        if pattern_type == "HAMMER":
            # Quality based on wick ratio and body position
            wick_ratio = lower_shadow / body if body > 0 else 0
            body_position = (c - l) / total_range
            quality = min(1.0, (wick_ratio / 3.0) * 0.7 + body_position * 0.3)
            return quality

        elif pattern_type == "SHOOTING_STAR":
            wick_ratio = upper_shadow / body if body > 0 else 0
            body_position = (h - c) / total_range
            quality = min(1.0, (wick_ratio / 3.0) * 0.7 + body_position * 0.3)
            return quality

        elif pattern_type in ["ENGULFING_BULLISH", "ENGULFING_BEARISH"]:
            # Quality based on body size
            body_ratio = body / total_range
            return min(1.0, body_ratio * 1.2)

        elif pattern_type in ["DOJI_DRAGONFLY", "DOJI_GRAVESTONE"]:
            # Quality based on how small the body is
            body_ratio = body / total_range
            quality = 1.0 - min(1.0, body_ratio * 10)  # Smaller body = higher quality
            return quality

        elif pattern_type in ["SWING_LOW", "SWING_HIGH"]:
            # Swings have fixed quality - they're structural points
            # Quality is determined by the prominence of the swing
            return 0.75  # Fixed quality for swings

        return 0.5  # Default

    def _assess_volume(self, candle: Dict, prev_candles: List[Dict]) -> float:
        """
        Assesses if volume is elevated (0.0 - 1.0)
        """
        if not prev_candles or 'volume' not in candle:
            return 0.5

        current_volume = candle['volume']
        avg_volume = sum(c.get('volume', 0) for c in prev_candles[-10:]) / min(10, len(prev_candles))

        if avg_volume == 0:
            return 0.5

        volume_ratio = current_volume / avg_volume

        # Score increases with volume ratio
        if volume_ratio >= 2.0:
            return 1.0
        elif volume_ratio >= 1.5:
            return 0.8
        elif volume_ratio >= 1.2:
            return 0.6
        elif volume_ratio >= 1.0:
            return 0.4
        else:
            return 0.2

    def _assess_relative_size(self, candle: Dict, prev_candles: List[Dict]) -> float:
        """
        Assesses if candle is larger than average (0.0 - 1.0)
        """
        if not prev_candles:
            return 0.5

        current_range = candle['high'] - candle['low']
        avg_range = sum(c['high'] - c['low'] for c in prev_candles[-10:]) / min(10, len(prev_candles))

        if avg_range == 0:
            return 0.5

        size_ratio = current_range / avg_range

        if size_ratio >= 2.0:
            return 1.0
        elif size_ratio >= 1.5:
            return 0.8
        elif size_ratio >= 1.2:
            return 0.6
        elif size_ratio >= 1.0:
            return 0.4
        else:
            return 0.2

    # ==================== PATTERN DETECTION FUNCTIONS ====================

    def _is_hammer(self, candle: Dict, prev_candles: List[Dict], config: Dict) -> bool:
        """
        Detects Hammer (bullish pin bar)
        - Long lower shadow (>= 2x body)
        - Small upper shadow (<= 10% of body)
        - Close in upper third of range
        """
        o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
        body = abs(c - o)
        lower_shadow = min(o, c) - l
        upper_shadow = h - max(o, c)
        total_range = h - l

        if total_range == 0:
            return False

        min_wick_ratio = config.get('minWickRatio', 2.0)

        # Conditions
        return (
            lower_shadow >= min_wick_ratio * body and
            upper_shadow <= 0.1 * body and
            (c - l) / total_range >= 0.6
        )

    def _is_shooting_star(self, candle: Dict, prev_candles: List[Dict], config: Dict) -> bool:
        """
        Detects Shooting Star (bearish pin bar)
        - Long upper shadow (>= 2x body)
        - Small lower shadow (<= 10% of body)
        - Close in lower third of range
        """
        o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
        body = abs(c - o)
        lower_shadow = min(o, c) - l
        upper_shadow = h - max(o, c)
        total_range = h - l

        if total_range == 0:
            return False

        min_wick_ratio = config.get('minWickRatio', 2.0)

        return (
            upper_shadow >= min_wick_ratio * body and
            lower_shadow <= 0.1 * body and
            (h - c) / total_range >= 0.6
        )

    def _is_engulfing(self, prev_candle: Dict, curr_candle: Dict) -> Optional[str]:
        """
        Detects Engulfing pattern (bullish or bearish)
        Returns pattern type or None
        """
        prev_body_top = max(prev_candle['open'], prev_candle['close'])
        prev_body_bottom = min(prev_candle['open'], prev_candle['close'])
        curr_body_top = max(curr_candle['open'], curr_candle['close'])
        curr_body_bottom = min(curr_candle['open'], curr_candle['close'])

        # Bullish engulfing
        if (prev_candle['close'] < prev_candle['open'] and  # Prev bearish
            curr_candle['close'] > curr_candle['open'] and  # Curr bullish
            curr_body_bottom < prev_body_bottom and
            curr_body_top > prev_body_top):
            return "ENGULFING_BULLISH"

        # Bearish engulfing
        if (prev_candle['close'] > prev_candle['open'] and  # Prev bullish
            curr_candle['close'] < curr_candle['open'] and  # Curr bearish
            curr_body_top > prev_body_top and
            curr_body_bottom < prev_body_bottom):
            return "ENGULFING_BEARISH"

        return None

    def _is_doji(self, candle: Dict, prev_candles: List[Dict]) -> Optional[str]:
        """
        Detects Doji patterns (Dragonfly or Gravestone)
        Returns pattern type or None
        """
        o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
        body = abs(c - o)
        lower_shadow = min(o, c) - l
        upper_shadow = h - max(o, c)
        total_range = h - l

        if total_range == 0:
            return None

        # Doji = very small body (< 5% of range)
        if body / total_range > 0.05:
            return None

        # Dragonfly Doji: long lower shadow, no upper shadow
        if lower_shadow > total_range * 0.6 and upper_shadow < total_range * 0.1:
            return "DOJI_DRAGONFLY"

        # Gravestone Doji: long upper shadow, no lower shadow
        if upper_shadow > total_range * 0.6 and lower_shadow < total_range * 0.1:
            return "DOJI_GRAVESTONE"

        return None

    # ==================== SWING DETECTION FUNCTIONS ====================

    def _is_swing_low(self, candles: List[Dict], index: int, left_bars: int = 5, right_bars: int = 5) -> bool:
        """
        Detects Swing Low - the candle's low is the minimum of the surrounding window

        A swing low occurs when a candle's low is lower than all candles
        to its left (left_bars) and right (right_bars).

        Args:
            candles: List of candle data
            index: Current candle index to check
            left_bars: Number of bars to check on the left
            right_bars: Number of bars to check on the right

        Returns:
            True if this is a swing low
        """
        # Need enough bars on both sides
        if index < left_bars or index >= len(candles) - right_bars:
            return False

        current_low = candles[index]['low']

        # Check all bars in the window
        for i in range(index - left_bars, index + right_bars + 1):
            if i != index and candles[i]['low'] <= current_low:
                return False

        return True

    def _is_swing_high(self, candles: List[Dict], index: int, left_bars: int = 5, right_bars: int = 5) -> bool:
        """
        Detects Swing High - the candle's high is the maximum of the surrounding window

        A swing high occurs when a candle's high is higher than all candles
        to its left (left_bars) and right (right_bars).

        Args:
            candles: List of candle data
            index: Current candle index to check
            left_bars: Number of bars to check on the left
            right_bars: Number of bars to check on the right

        Returns:
            True if this is a swing high
        """
        # Need enough bars on both sides
        if index < left_bars or index >= len(candles) - right_bars:
            return False

        current_high = candles[index]['high']

        # Check all bars in the window
        for i in range(index - left_bars, index + right_bars + 1):
            if i != index and candles[i]['high'] >= current_high:
                return False

        return True


def serialize_pattern(pattern: RejectionPattern) -> Dict:
    """Serializes a RejectionPattern to JSON-compatible dict"""
    return {
        "timestamp": pattern.timestamp,
        "patternType": pattern.pattern_type,
        "confidence": pattern.confidence,
        "price": pattern.price,
        "candle": pattern.candle_data,
        "nearLevels": [
            {
                "price": level.price,
                "type": level.type,
                "sourceType": level.source_type,
                "sourceId": level.source_id,
                "weight": level.weight
            }
            for level in pattern.near_levels
        ],
        "contextScores": pattern.context_scores,
        "metrics": pattern.metrics
    }
