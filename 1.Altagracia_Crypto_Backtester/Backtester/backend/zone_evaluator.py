# zone_evaluator.py
# Zone Evaluator - Evalúa la calidad de las zonas detectadas usando datos históricos
# Permite determinar qué método de detección funciona mejor

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict, field
from datetime import datetime
import numpy as np

from zone_detector import Zone, ZoneDetector, ZoneDetectionParams


@dataclass
class BounceEvent:
    """Representa un rebote válido en una zona"""
    timestamp: int
    entry_price: float
    exit_price: float
    direction: str  # "long" (rebote en soporte) o "short" (rebote en resistencia)
    profit_pct: float  # % de ganancia si se hubiera tomado el trade
    holding_bars: int  # Velas hasta alcanzar target o stop
    result: str  # "win", "loss", "breakeven"


@dataclass
class FakeoutEvent:
    """Representa un fakeout (ruptura falsa)"""
    timestamp: int
    breakout_price: float
    return_price: float
    direction: str  # "up" o "down"
    bars_outside: int  # Velas fuera de la zona antes de volver


@dataclass
class BreakoutEvent:
    """Representa una ruptura válida de la zona"""
    timestamp: int
    breakout_price: float
    direction: str  # "up" o "down"
    continuation_pct: float  # % de continuación después de la ruptura
    volume_spike: float  # Ratio de volumen vs promedio


@dataclass
class ZoneEvaluation:
    """Evaluación completa de una zona"""
    zone: Zone

    # Métricas de rebotes
    bounces: List[BounceEvent] = field(default_factory=list)
    total_bounces: int = 0
    successful_bounces: int = 0
    bounce_win_rate: float = 0.0
    avg_bounce_profit: float = 0.0

    # Métricas de fakeouts
    fakeouts: List[FakeoutEvent] = field(default_factory=list)
    total_fakeouts: int = 0
    fakeout_rate: float = 0.0

    # Métricas de ruptura
    breakout: Optional[BreakoutEvent] = None
    breakout_quality: float = 0.0  # 0-100

    # Score final
    overall_score: float = 0.0
    tradeable: bool = False  # Si la zona es apta para trading
    recommended_strategy: str = ""  # "range_trade", "breakout", "avoid"

    def to_dict(self) -> dict:
        result = {
            'zone': self.zone.to_dict(),
            'total_bounces': self.total_bounces,
            'successful_bounces': self.successful_bounces,
            'bounce_win_rate': self.bounce_win_rate,
            'avg_bounce_profit': self.avg_bounce_profit,
            'total_fakeouts': self.total_fakeouts,
            'fakeout_rate': self.fakeout_rate,
            'breakout_quality': self.breakout_quality,
            'overall_score': self.overall_score,
            'tradeable': self.tradeable,
            'recommended_strategy': self.recommended_strategy,
            'bounces': [asdict(b) for b in self.bounces],
            'fakeouts': [asdict(f) for f in self.fakeouts],
            'breakout': asdict(self.breakout) if self.breakout else None
        }
        return result


@dataclass
class EvaluationParams:
    """Parámetros para la evaluación de zonas"""
    # Rebotes
    bounce_entry_tolerance_pct: float = 0.3  # Tolerancia para considerar entrada válida
    bounce_target_pct: float = 0.8  # Target como % del rango de la zona
    bounce_stop_pct: float = 0.3  # Stop loss como % del rango (fuera de zona)
    bounce_max_bars: int = 50  # Máximo de velas para evaluar un trade

    # Fakeouts
    fakeout_tolerance_pct: float = 0.5  # % fuera de zona para considerar breakout
    fakeout_return_bars: int = 10  # Velas para volver a la zona

    # Breakouts
    breakout_confirmation_pct: float = 1.0  # % de continuación para confirmar breakout
    breakout_volume_ratio: float = 1.5  # Ratio de volumen mínimo para breakout válido

    # Scoring
    min_bounces_for_tradeable: int = 2
    min_win_rate_for_tradeable: float = 0.5
    max_fakeout_rate_for_tradeable: float = 0.4


class ZoneEvaluator:
    """
    Evalúa zonas detectadas usando datos históricos posteriores a la detección.
    Permite determinar qué tan "buenas" son las zonas para trading.
    """

    def __init__(self):
        pass

    def evaluate_zone(
        self,
        zone: Zone,
        candles: List[Dict],
        params: Optional[EvaluationParams] = None
    ) -> ZoneEvaluation:
        """
        Evalúa una zona usando velas posteriores a su formación.

        Args:
            zone: Zona a evaluar
            candles: Todas las velas (incluyendo las posteriores a la zona)
            params: Parámetros de evaluación

        Returns:
            ZoneEvaluation con métricas detalladas
        """
        if params is None:
            params = EvaluationParams()

        # Inicializar evaluación
        evaluation = ZoneEvaluation(zone=zone)

        # Filtrar velas posteriores a la zona
        post_zone_candles = [
            c for c in candles
            if c['timestamp'] > zone.end_timestamp
        ]

        if len(post_zone_candles) < 10:
            # No hay suficientes datos para evaluar
            evaluation.recommended_strategy = "insufficient_data"
            return evaluation

        # 1. Detectar y evaluar rebotes
        self._evaluate_bounces(evaluation, zone, post_zone_candles, params)

        # 2. Detectar fakeouts
        self._evaluate_fakeouts(evaluation, zone, post_zone_candles, params)

        # 3. Detectar breakout final
        self._evaluate_breakout(evaluation, zone, post_zone_candles, params)

        # 4. Calcular score final y recomendación
        self._calculate_final_score(evaluation, params)

        return evaluation

    def evaluate_zones_batch(
        self,
        zones: List[Zone],
        candles: List[Dict],
        params: Optional[EvaluationParams] = None
    ) -> List[ZoneEvaluation]:
        """Evalúa múltiples zonas"""
        return [self.evaluate_zone(z, candles, params) for z in zones]

    def compare_methods(
        self,
        candles: List[Dict],
        detection_params: Optional[ZoneDetectionParams] = None,
        eval_params: Optional[EvaluationParams] = None
    ) -> Dict[str, Dict]:
        """
        Compara todos los métodos de detección de zonas.

        Divide los datos en:
        - 70% para detección
        - 30% para evaluación
        """
        if detection_params is None:
            detection_params = ZoneDetectionParams()
        if eval_params is None:
            eval_params = EvaluationParams()

        # Dividir datos
        split_idx = int(len(candles) * 0.7)
        detection_candles = candles[:split_idx]
        all_candles = candles  # Para evaluación necesitamos todas

        detector = ZoneDetector()
        results = {}

        for method in detector.METHODS:
            # Detectar zonas con datos de entrenamiento
            zones = detector.detect_zones(detection_candles, method, detection_params)

            # Evaluar con todos los datos
            evaluations = self.evaluate_zones_batch(zones, all_candles, eval_params)

            # Calcular métricas agregadas
            results[method] = self._aggregate_method_results(evaluations)

        return results

    # =========================================================================
    # EVALUACIÓN DE REBOTES
    # =========================================================================

    def _evaluate_bounces(
        self,
        evaluation: ZoneEvaluation,
        zone: Zone,
        candles: List[Dict],
        params: EvaluationParams
    ):
        """Detecta y evalúa rebotes en la zona"""
        zone_range = zone.max_price - zone.min_price
        entry_tolerance = zone_range * (params.bounce_entry_tolerance_pct / 100)

        support_level = zone.min_price
        resistance_level = zone.max_price
        target_distance = zone_range * (params.bounce_target_pct)
        stop_distance = zone_range * (params.bounce_stop_pct)

        bounces = []
        i = 0

        while i < len(candles):
            candle = candles[i]

            # Verificar toque de soporte (potencial long)
            if candle['low'] <= support_level + entry_tolerance and candle['low'] >= support_level - stop_distance:
                bounce = self._simulate_bounce_trade(
                    candles[i:],
                    entry_price=support_level,
                    direction="long",
                    target_price=support_level + target_distance,
                    stop_price=support_level - stop_distance,
                    max_bars=params.bounce_max_bars
                )
                if bounce:
                    bounces.append(bounce)
                    i += bounce.holding_bars  # Saltar velas del trade
                    continue

            # Verificar toque de resistencia (potencial short)
            if candle['high'] >= resistance_level - entry_tolerance and candle['high'] <= resistance_level + stop_distance:
                bounce = self._simulate_bounce_trade(
                    candles[i:],
                    entry_price=resistance_level,
                    direction="short",
                    target_price=resistance_level - target_distance,
                    stop_price=resistance_level + stop_distance,
                    max_bars=params.bounce_max_bars
                )
                if bounce:
                    bounces.append(bounce)
                    i += bounce.holding_bars
                    continue

            i += 1

        # Guardar resultados
        evaluation.bounces = bounces
        evaluation.total_bounces = len(bounces)
        evaluation.successful_bounces = sum(1 for b in bounces if b.result == "win")

        if bounces:
            evaluation.bounce_win_rate = evaluation.successful_bounces / len(bounces)
            evaluation.avg_bounce_profit = np.mean([b.profit_pct for b in bounces])

    def _simulate_bounce_trade(
        self,
        candles: List[Dict],
        entry_price: float,
        direction: str,
        target_price: float,
        stop_price: float,
        max_bars: int
    ) -> Optional[BounceEvent]:
        """Simula un trade de rebote y retorna el resultado"""
        if len(candles) < 2:
            return None

        entry_candle = candles[0]

        for i, candle in enumerate(candles[1:min(len(candles), max_bars + 1)], 1):
            if direction == "long":
                # Check target hit
                if candle['high'] >= target_price:
                    profit_pct = ((target_price - entry_price) / entry_price) * 100
                    return BounceEvent(
                        timestamp=entry_candle['timestamp'],
                        entry_price=entry_price,
                        exit_price=target_price,
                        direction=direction,
                        profit_pct=profit_pct,
                        holding_bars=i,
                        result="win"
                    )
                # Check stop hit
                if candle['low'] <= stop_price:
                    profit_pct = ((stop_price - entry_price) / entry_price) * 100
                    return BounceEvent(
                        timestamp=entry_candle['timestamp'],
                        entry_price=entry_price,
                        exit_price=stop_price,
                        direction=direction,
                        profit_pct=profit_pct,
                        holding_bars=i,
                        result="loss"
                    )
            else:  # short
                # Check target hit
                if candle['low'] <= target_price:
                    profit_pct = ((entry_price - target_price) / entry_price) * 100
                    return BounceEvent(
                        timestamp=entry_candle['timestamp'],
                        entry_price=entry_price,
                        exit_price=target_price,
                        direction=direction,
                        profit_pct=profit_pct,
                        holding_bars=i,
                        result="win"
                    )
                # Check stop hit
                if candle['high'] >= stop_price:
                    profit_pct = ((entry_price - stop_price) / entry_price) * 100
                    return BounceEvent(
                        timestamp=entry_candle['timestamp'],
                        entry_price=entry_price,
                        exit_price=stop_price,
                        direction=direction,
                        profit_pct=profit_pct,
                        holding_bars=i,
                        result="loss"
                    )

        # Timeout - cerrar al último precio
        last_candle = candles[min(len(candles) - 1, max_bars)]
        exit_price = last_candle['close']

        if direction == "long":
            profit_pct = ((exit_price - entry_price) / entry_price) * 100
        else:
            profit_pct = ((entry_price - exit_price) / entry_price) * 100

        result = "win" if profit_pct > 0 else ("loss" if profit_pct < 0 else "breakeven")

        return BounceEvent(
            timestamp=entry_candle['timestamp'],
            entry_price=entry_price,
            exit_price=exit_price,
            direction=direction,
            profit_pct=profit_pct,
            holding_bars=min(len(candles) - 1, max_bars),
            result=result
        )

    # =========================================================================
    # EVALUACIÓN DE FAKEOUTS
    # =========================================================================

    def _evaluate_fakeouts(
        self,
        evaluation: ZoneEvaluation,
        zone: Zone,
        candles: List[Dict],
        params: EvaluationParams
    ):
        """Detecta fakeouts (rupturas falsas)"""
        zone_range = zone.max_price - zone.min_price
        fakeout_threshold = zone_range * (params.fakeout_tolerance_pct / 100)

        fakeouts = []
        i = 0

        while i < len(candles) - params.fakeout_return_bars:
            candle = candles[i]

            # Fakeout hacia arriba
            if candle['high'] > zone.max_price + fakeout_threshold:
                # Verificar si vuelve a la zona
                returned = False
                bars_outside = 0

                for j in range(i + 1, min(i + params.fakeout_return_bars + 1, len(candles))):
                    next_candle = candles[j]
                    bars_outside += 1

                    if next_candle['low'] <= zone.max_price:
                        returned = True
                        break

                if returned:
                    fakeouts.append(FakeoutEvent(
                        timestamp=candle['timestamp'],
                        breakout_price=candle['high'],
                        return_price=candles[i + bars_outside]['low'],
                        direction="up",
                        bars_outside=bars_outside
                    ))
                    i += bars_outside
                    continue

            # Fakeout hacia abajo
            if candle['low'] < zone.min_price - fakeout_threshold:
                returned = False
                bars_outside = 0

                for j in range(i + 1, min(i + params.fakeout_return_bars + 1, len(candles))):
                    next_candle = candles[j]
                    bars_outside += 1

                    if next_candle['high'] >= zone.min_price:
                        returned = True
                        break

                if returned:
                    fakeouts.append(FakeoutEvent(
                        timestamp=candle['timestamp'],
                        breakout_price=candle['low'],
                        return_price=candles[i + bars_outside]['high'],
                        direction="down",
                        bars_outside=bars_outside
                    ))
                    i += bars_outside
                    continue

            i += 1

        evaluation.fakeouts = fakeouts
        evaluation.total_fakeouts = len(fakeouts)

        # Calcular fakeout rate (fakeouts / intentos de ruptura)
        total_breakout_attempts = len(fakeouts) + (1 if evaluation.breakout else 0)
        if total_breakout_attempts > 0:
            evaluation.fakeout_rate = len(fakeouts) / total_breakout_attempts

    # =========================================================================
    # EVALUACIÓN DE BREAKOUT
    # =========================================================================

    def _evaluate_breakout(
        self,
        evaluation: ZoneEvaluation,
        zone: Zone,
        candles: List[Dict],
        params: EvaluationParams
    ):
        """Detecta el breakout final de la zona (si existe)"""
        zone_range = zone.max_price - zone.min_price
        confirmation_distance = zone_range * (params.breakout_confirmation_pct / 100)

        # Calcular volumen promedio
        avg_volume = np.mean([c['volume'] for c in candles]) if candles else 0

        for i, candle in enumerate(candles):
            # Breakout hacia arriba
            if candle['close'] > zone.max_price + confirmation_distance:
                # Calcular continuación
                continuation = self._calculate_continuation(
                    candles[i:],
                    zone.max_price,
                    "up"
                )

                volume_ratio = candle['volume'] / avg_volume if avg_volume > 0 else 1

                evaluation.breakout = BreakoutEvent(
                    timestamp=candle['timestamp'],
                    breakout_price=candle['close'],
                    direction="up",
                    continuation_pct=continuation,
                    volume_spike=volume_ratio
                )

                # Calcular calidad del breakout
                evaluation.breakout_quality = self._calculate_breakout_quality(
                    continuation, volume_ratio, params
                )
                return

            # Breakout hacia abajo
            if candle['close'] < zone.min_price - confirmation_distance:
                continuation = self._calculate_continuation(
                    candles[i:],
                    zone.min_price,
                    "down"
                )

                volume_ratio = candle['volume'] / avg_volume if avg_volume > 0 else 1

                evaluation.breakout = BreakoutEvent(
                    timestamp=candle['timestamp'],
                    breakout_price=candle['close'],
                    direction="down",
                    continuation_pct=continuation,
                    volume_spike=volume_ratio
                )

                evaluation.breakout_quality = self._calculate_breakout_quality(
                    continuation, volume_ratio, params
                )
                return

    def _calculate_continuation(
        self,
        candles: List[Dict],
        breakout_level: float,
        direction: str,
        lookforward: int = 20
    ) -> float:
        """Calcula % de continuación después del breakout"""
        if len(candles) < 2:
            return 0

        max_extension = 0

        for candle in candles[1:min(len(candles), lookforward + 1)]:
            if direction == "up":
                extension = (candle['high'] - breakout_level) / breakout_level * 100
            else:
                extension = (breakout_level - candle['low']) / breakout_level * 100

            max_extension = max(max_extension, extension)

        return max_extension

    def _calculate_breakout_quality(
        self,
        continuation_pct: float,
        volume_ratio: float,
        params: EvaluationParams
    ) -> float:
        """Calcula calidad del breakout (0-100)"""
        # Score por continuación (0-50)
        cont_score = min(continuation_pct / 3, 1) * 50

        # Score por volumen (0-50)
        if volume_ratio >= params.breakout_volume_ratio:
            vol_score = 50
        else:
            vol_score = (volume_ratio / params.breakout_volume_ratio) * 50

        return cont_score + vol_score

    # =========================================================================
    # SCORE FINAL Y RECOMENDACIÓN
    # =========================================================================

    def _calculate_final_score(
        self,
        evaluation: ZoneEvaluation,
        params: EvaluationParams
    ):
        """Calcula score final y determina estrategia recomendada"""
        zone = evaluation.zone

        # Componentes del score
        # 1. Score base de la zona (0-30)
        base_score = zone.score * 0.30

        # 2. Score por rebotes (0-40)
        if evaluation.total_bounces >= params.min_bounces_for_tradeable:
            bounce_score = evaluation.bounce_win_rate * 40
        else:
            bounce_score = (evaluation.total_bounces / params.min_bounces_for_tradeable) * 20

        # 3. Penalización por fakeouts (0 a -20)
        fakeout_penalty = evaluation.fakeout_rate * 20

        # 4. Score por breakout (0-30) - solo si no hay más rebotes
        if evaluation.breakout:
            breakout_score = evaluation.breakout_quality * 0.30
        else:
            breakout_score = 15  # Zona aún vigente = bonus

        # Score total
        total_score = base_score + bounce_score - fakeout_penalty + breakout_score
        evaluation.overall_score = max(0, min(100, total_score))

        # Determinar si es tradeable
        evaluation.tradeable = (
            evaluation.total_bounces >= params.min_bounces_for_tradeable and
            evaluation.bounce_win_rate >= params.min_win_rate_for_tradeable and
            evaluation.fakeout_rate <= params.max_fakeout_rate_for_tradeable
        )

        # Determinar estrategia recomendada
        if not evaluation.tradeable:
            if evaluation.fakeout_rate > 0.5:
                evaluation.recommended_strategy = "avoid_high_fakeouts"
            elif evaluation.total_bounces < params.min_bounces_for_tradeable:
                evaluation.recommended_strategy = "avoid_low_activity"
            else:
                evaluation.recommended_strategy = "avoid_low_winrate"
        else:
            if evaluation.breakout and evaluation.breakout_quality > 60:
                evaluation.recommended_strategy = "breakout_trade"
            elif evaluation.bounce_win_rate > 0.6 and evaluation.total_bounces >= 4:
                evaluation.recommended_strategy = "range_trade_aggressive"
            else:
                evaluation.recommended_strategy = "range_trade_conservative"

    def _aggregate_method_results(
        self,
        evaluations: List[ZoneEvaluation]
    ) -> Dict:
        """Agrega resultados de múltiples evaluaciones de un método"""
        if not evaluations:
            return {
                'zones_detected': 0,
                'zones_tradeable': 0,
                'avg_score': 0,
                'avg_win_rate': 0,
                'avg_bounces': 0,
                'avg_fakeout_rate': 0,
                'total_bounces': 0,
                'successful_bounces': 0,
                'strategies': {}
            }

        tradeable_zones = [e for e in evaluations if e.tradeable]

        # Contar estrategias recomendadas
        strategies = {}
        for e in evaluations:
            strat = e.recommended_strategy
            strategies[strat] = strategies.get(strat, 0) + 1

        return {
            'zones_detected': len(evaluations),
            'zones_tradeable': len(tradeable_zones),
            'tradeable_rate': len(tradeable_zones) / len(evaluations) if evaluations else 0,
            'avg_score': np.mean([e.overall_score for e in evaluations]),
            'avg_win_rate': np.mean([e.bounce_win_rate for e in evaluations if e.total_bounces > 0]) if any(e.total_bounces > 0 for e in evaluations) else 0,
            'avg_bounces': np.mean([e.total_bounces for e in evaluations]),
            'avg_fakeout_rate': np.mean([e.fakeout_rate for e in evaluations]),
            'total_bounces': sum(e.total_bounces for e in evaluations),
            'successful_bounces': sum(e.successful_bounces for e in evaluations),
            'overall_win_rate': sum(e.successful_bounces for e in evaluations) / max(1, sum(e.total_bounces for e in evaluations)),
            'strategies': strategies,
            'best_zones': [e.to_dict() for e in sorted(evaluations, key=lambda x: x.overall_score, reverse=True)[:5]]
        }


# Singleton para uso global
zone_evaluator = ZoneEvaluator()
