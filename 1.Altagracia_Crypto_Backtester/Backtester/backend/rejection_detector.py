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

import candle_patterns


@dataclass
class ReferenceLevel:
    """Represents a key level from a reference context"""
    price: float
    type: str  # "POC", "VAH", "VAL", "TOP", "BOTTOM", "MIDDLE"
    source_id: str  # ID of the source context
    source_type: str  # "VOLUME_PROFILE_DYNAMIC", "VOLUME_PROFILE_FIXED", "RANGE_DETECTOR"
    weight: float  # Weight in confidence calculation (0.0 - 1.0)
    known_from: Optional[int] = None  # Ultima vela que usa el nivel: antes no se conocia


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
        reference_contexts: List[Dict],
        known_levels_only: bool = False
    ) -> List[RejectionPattern]:
        """
        Detects rejection patterns validated by reference contexts

        Args:
            symbol: Cryptocurrency symbol
            candles: List of OHLCV candles
            config: Pattern detection configuration
            reference_contexts: List of active reference contexts
            known_levels_only: En backtesting, cada vela solo se valida con niveles ya formados

        Returns:
            List of detected patterns with validation
        """
        detected_patterns = []

        # 1. Extract levels from all active contexts
        reference_levels = self._extract_reference_levels(
            symbol,
            reference_contexts
        )

        if not reference_levels:
            print(f"[WARN] No reference levels for {symbol}. "
                  f"Detection disabled to avoid false positives.")
            return []

        all_levels = reference_levels

        # 2. Patrones con la regla comun (candle_patterns.py, 16/11/2026: la misma del navegador). Solo velas
        #    cerradas: un patron es la forma final de la vela, y la vela en formacion todavia no la tiene
        candles = [c for c in candles if not c.get('in_progress')]
        opts = candle_patterns.rule_options(config)
        for hit in candle_patterns.find_patterns(candles, opts):
            i = hit['index']
            candle = candles[i]
            prev_candles = candles[max(0, i - 20):i]  # 20 previous candles for context

            if known_levels_only:
                reference_levels = [
                    level for level in all_levels
                    if level.known_from is not None and level.known_from <= candle['timestamp']
                ]
                if not reference_levels:
                    continue

            pattern = self._create_pattern(candle, hit['type'], reference_levels, config, prev_candles)
            if pattern:
                pattern.metrics['volume_z'] = None if hit['volumeZ'] is None else round(hit['volumeZ'], 2)
                detected_patterns.append(pattern)

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
            known_from = metadata.get('endTimestamp')

            if context_type in ["VOLUME_PROFILE_DYNAMIC", "VOLUME_PROFILE_FIXED"]:
                # Extract VP levels from metadata
                for level_type in context.get('levels', ['POC', 'VAH', 'VAL']):
                    level_key = level_type.lower()
                    if metadata.get(level_key) is not None:
                        levels.append(ReferenceLevel(
                            price=float(metadata[level_key]),
                            type=level_type,
                            source_id=context_id,
                            source_type=context_type,
                            weight=weight,
                            known_from=known_from
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
                        weight=weight,
                        known_from=known_from
                    ))
                    levels.append(ReferenceLevel(
                        price=bottom,
                        type='BOTTOM',
                        source_id=context_id,
                        source_type=context_type,
                        weight=weight,
                        known_from=known_from
                    ))
                    levels.append(ReferenceLevel(
                        price=(top + bottom) / 2,
                        type='MIDDLE',
                        source_id=context_id,
                        source_type=context_type,
                        weight=weight * 0.7,  # Lower weight for middle level
                        known_from=known_from
                    ))

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
        # 16/11/2026: el rechazo se mide en la mecha que toca el nivel (el minimo en un patron alcista, el maximo en
        # uno bajista) y la vela tiene que cerrar de su lado: sobre el nivel uno alcista, bajo el nivel uno bajista.
        # Antes se media con el cierre y sin lado: un martillo que cerro 0.72% bajo un VAL contaba como "cerca"
        bullish = pattern_type in candle_patterns.BULLISH
        touch = candle['low'] if bullish else candle['high']

        def touch_distance(level):
            return abs(touch - level.price) / level.price if level.price else float('inf')

        def closes_on_side(level):
            return close_price >= level.price if bullish else close_price <= level.price

        near_levels = [level for level in reference_levels
                       if touch_distance(level) <= proximity_pct and closes_on_side(level)]

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
            proximity_score = max(0, 1 - (touch_distance(level) / proximity_pct)) if proximity_pct > 0 else 1
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
            # El mejor nivel: su peso por lo cerca que toco la mecha (la mitad por tocarlo, la otra mitad por la
            # distancia). Antes era solo el peso del contexto
            bullish = pattern_type in candle_patterns.BULLISH
            touch = candle['low'] if bullish else candle['high']
            prox = config.get('filters', {}).get('proximityPercent', 1.0) / 100
            proximity_score = max(
                level.weight * (0.5 + 0.5 * max(0.0, 1 - (abs(touch - level.price) / level.price) / prox if prox > 0 else 1))
                for level in near_levels)
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

    # Las formas (martillo, estrella, envolvente y doji) estan en candle_patterns.py desde el 16/11/2026.


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
