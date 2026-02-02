# zone_quality_analyzer.py
# Analiza la calidad de zonas de consolidación basándose en el comportamiento post-breakout
# Objetivo: Identificar parámetros óptimos para detectar zonas que preceden movimientos significativos

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import numpy as np
from collections import defaultdict
import json


@dataclass
class BreakoutAnalysis:
    """Análisis detallado del breakout de una zona"""
    zone_id: str
    zone_start_ts: int
    zone_end_ts: int
    zone_height: float  # range_high - range_low
    zone_height_pct: float  # altura como % del precio
    zone_duration_bars: int
    zone_avg_volume: float

    # Dirección del breakout
    breakout_direction: str  # "UP" o "DOWN"
    breakout_ts: int
    breakout_price: float

    # Métricas R-Multiple (Enfoque 1)
    max_favorable_excursion: float  # MFE - máximo movimiento a favor
    max_adverse_excursion: float  # MAE - máximo movimiento en contra (antes de MFE)
    r_multiple: float  # MFE / zone_height
    reached_2r: bool
    reached_3r: bool
    bars_to_2r: Optional[int]  # Velas hasta alcanzar 2R (None si no alcanzó)

    # Métricas de Trading Real (SL/TP)
    tp_hit_first: bool  # ¿El TP (2R) se alcanzó ANTES que el SL?
    sl_hit_first: bool  # ¿El SL (1R adverso) se alcanzó ANTES que el TP?
    trade_result: str   # "WIN", "LOSS", "OPEN" (trade aún no cerrado al final de datos)
    trade_pnl_r: float  # P&L en R: +2 si WIN, -1 si LOSS, 0 si OPEN
    bars_to_close: Optional[int]  # Velas desde breakout hasta TP/SL (None si OPEN)
    trade_close_ts: Optional[int]  # Timestamp de cierre del trade (None si OPEN)

    # Métricas Momentum (Enfoque 2)
    breakout_candle_body: float  # Tamaño del cuerpo de vela de breakout
    breakout_candle_body_ratio: float  # cuerpo / ATR
    continuation_bars: int  # Velas consecutivas en dirección del breakout
    max_pullback_pct: float  # Máximo retroceso como % del movimiento
    pullback_reentered_zone: bool  # ¿El pullback volvió a entrar a la zona?

    # Métricas Volumen (Enfoque 3)
    zone_volume_vs_avg: float  # Volumen de zona vs promedio histórico
    breakout_volume_spike: float  # Volumen de breakout vs promedio de zona
    volume_confirmation_bars: int  # Velas con volumen > promedio después del breakout

    # Score compuesto
    quality_score: float  # 0-100

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class OptimizationResult:
    """Resultado de una combinación de parámetros"""
    params: Dict
    total_zones: int
    quality_zones: int  # Zonas con quality_score >= threshold
    avg_r_multiple: float
    median_r_multiple: float
    pct_reached_2r: float
    pct_reached_3r: float
    avg_quality_score: float
    avg_bars_to_2r: float

    # MÉTRICAS DE TRADING REAL
    real_win_rate: float  # % trades donde TP (2R) se alcanzó ANTES que SL (1R adverso)
    total_wins: int
    total_losses: int
    total_still_open: int  # Trades que no llegaron a TP ni SL
    total_pnl_r: float  # P&L total en R
    expectancy_r: float  # E = (Win% × 2R) - (Loss% × 1R)
    is_profitable: bool

    # DURACIÓN DE TRADES
    avg_bars_to_close: Optional[float]  # Duración promedio de trades cerrados
    avg_win_duration: Optional[float]  # Duración promedio de wins
    avg_loss_duration: Optional[float]  # Duración promedio de losses

    # Distribución de scores
    score_distribution: Dict[str, int]  # {"0-20": N, "20-40": N, ...}

    def to_dict(self) -> dict:
        return asdict(self)


class ZoneQualityAnalyzer:
    """
    Analiza la calidad de zonas de consolidación midiendo el comportamiento post-breakout.

    Usa 3 enfoques:
    1. R-Multiple: Distancia del movimiento vs altura de la zona
    2. Momentum: Fuerza y persistencia del breakout
    3. Volumen: Acumulación pre-breakout y confirmación post-breakout
    """

    def __init__(self, candles: List[Dict], atr_period: int = 14):
        """
        Args:
            candles: Lista de velas OHLCV ordenadas cronológicamente
            atr_period: Período para calcular ATR
        """
        self.candles = candles
        self.atr_period = atr_period

        # Pre-calcular ATR para cada vela
        self.atr_values = self._calculate_rolling_atr()

        # Pre-calcular volumen promedio rolling
        self.avg_volume_values = self._calculate_rolling_avg_volume(period=50)

        print(f"[ZoneQualityAnalyzer] Inicializado con {len(candles)} velas")
        print(f"[ZoneQualityAnalyzer] Rango: {datetime.fromtimestamp(candles[0]['timestamp']/1000)} - {datetime.fromtimestamp(candles[-1]['timestamp']/1000)}")

    def _calculate_rolling_atr(self) -> List[float]:
        """Calcula ATR rolling para cada vela."""
        atr_values = [0.0] * len(self.candles)

        for i in range(self.atr_period, len(self.candles)):
            true_ranges = []
            for j in range(i - self.atr_period + 1, i + 1):
                high = self.candles[j]['high']
                low = self.candles[j]['low']
                prev_close = self.candles[j - 1]['close'] if j > 0 else self.candles[j]['open']

                tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
                true_ranges.append(tr)

            atr_values[i] = np.mean(true_ranges)

        # Rellenar los primeros valores con el primer ATR válido
        first_valid = atr_values[self.atr_period] if self.atr_period < len(atr_values) else 0
        for i in range(self.atr_period):
            atr_values[i] = first_valid

        return atr_values

    def _calculate_rolling_avg_volume(self, period: int = 50) -> List[float]:
        """Calcula volumen promedio rolling."""
        avg_volumes = [0.0] * len(self.candles)

        for i in range(period, len(self.candles)):
            volumes = [self.candles[j]['volume'] for j in range(i - period, i)]
            avg_volumes[i] = np.mean(volumes)

        # Rellenar los primeros valores
        first_valid = avg_volumes[period] if period < len(avg_volumes) else 0
        for i in range(period):
            avg_volumes[i] = first_valid if first_valid > 0 else 1

        return avg_volumes

    def _find_candle_index_by_timestamp(self, timestamp: int) -> Optional[int]:
        """Encuentra el índice de una vela por su timestamp."""
        for i, c in enumerate(self.candles):
            if c['timestamp'] == timestamp:
                return i
            if c['timestamp'] > timestamp:
                return i - 1 if i > 0 else 0
        return len(self.candles) - 1

    def analyze_zone_breakout(
        self,
        zone: Dict,
        lookforward_bars: int = 100,
        target_r: float = 2.0
    ) -> Optional[BreakoutAnalysis]:
        """
        Analiza el breakout de una zona específica.

        Args:
            zone: Diccionario con datos de la zona (min_price, max_price, start_timestamp, end_timestamp)
            lookforward_bars: Velas a analizar después del breakout
            target_r: Objetivo de R-multiple

        Returns:
            BreakoutAnalysis con todas las métricas, o None si no hay datos suficientes
        """
        zone_end_idx = self._find_candle_index_by_timestamp(zone['end_timestamp'])
        zone_start_idx = self._find_candle_index_by_timestamp(zone['start_timestamp'])

        if zone_end_idx is None or zone_start_idx is None:
            return None

        # Verificar que hay suficientes velas después del breakout
        if zone_end_idx + lookforward_bars >= len(self.candles):
            lookforward_bars = len(self.candles) - zone_end_idx - 1
            if lookforward_bars < 10:  # Mínimo 10 velas para analizar
                return None

        zone_high = zone['max_price']
        zone_low = zone['min_price']
        zone_height = zone_high - zone_low
        zone_mid = (zone_high + zone_low) / 2
        zone_height_pct = (zone_height / zone_mid) * 100
        zone_duration = zone_end_idx - zone_start_idx + 1

        # Calcular volumen promedio de la zona
        zone_candles = self.candles[zone_start_idx:zone_end_idx + 1]
        zone_avg_volume = np.mean([c['volume'] for c in zone_candles])

        # Determinar dirección del breakout (primera vela que cierra fuera)
        breakout_idx = zone_end_idx + 1
        breakout_candle = self.candles[breakout_idx]

        if breakout_candle['close'] > zone_high:
            direction = "UP"
            breakout_price = zone_high
        elif breakout_candle['close'] < zone_low:
            direction = "DOWN"
            breakout_price = zone_low
        else:
            # Si la primera vela no cierra fuera, buscar la siguiente que sí lo haga
            for i in range(zone_end_idx + 1, min(zone_end_idx + 10, len(self.candles))):
                c = self.candles[i]
                if c['close'] > zone_high:
                    direction = "UP"
                    breakout_price = zone_high
                    breakout_idx = i
                    breakout_candle = c
                    break
                elif c['close'] < zone_low:
                    direction = "DOWN"
                    breakout_price = zone_low
                    breakout_idx = i
                    breakout_candle = c
                    break
            else:
                # No hubo breakout claro en las primeras 10 velas
                return None

        # =====================
        # ENFOQUE 1: R-Multiple
        # =====================
        post_breakout_candles = self.candles[breakout_idx:breakout_idx + lookforward_bars]

        if direction == "UP":
            # MFE = máximo high alcanzado - precio de breakout
            max_price_reached = max(c['high'] for c in post_breakout_candles)
            mfe = max_price_reached - breakout_price

            # MAE = máximo movimiento adverso (hacia abajo) antes de alcanzar MFE
            mfe_idx = next(i for i, c in enumerate(post_breakout_candles) if c['high'] == max_price_reached)
            pre_mfe_candles = post_breakout_candles[:mfe_idx + 1] if mfe_idx > 0 else post_breakout_candles[:1]
            min_low_before_mfe = min(c['low'] for c in pre_mfe_candles)
            mae = breakout_price - min_low_before_mfe
        else:  # DOWN
            # MFE = precio de breakout - mínimo low alcanzado
            min_price_reached = min(c['low'] for c in post_breakout_candles)
            mfe = breakout_price - min_price_reached

            # MAE = máximo movimiento adverso (hacia arriba) antes de alcanzar MFE
            mfe_idx = next(i for i, c in enumerate(post_breakout_candles) if c['low'] == min_price_reached)
            pre_mfe_candles = post_breakout_candles[:mfe_idx + 1] if mfe_idx > 0 else post_breakout_candles[:1]
            max_high_before_mfe = max(c['high'] for c in pre_mfe_candles)
            mae = max_high_before_mfe - breakout_price

        r_multiple = mfe / zone_height if zone_height > 0 else 0
        reached_2r = r_multiple >= 2.0
        reached_3r = r_multiple >= 3.0

        # Calcular velas hasta alcanzar 2R
        bars_to_2r = None
        target_price_2r = breakout_price + (zone_height * 2) if direction == "UP" else breakout_price - (zone_height * 2)
        for i, c in enumerate(post_breakout_candles):
            if direction == "UP" and c['high'] >= target_price_2r:
                bars_to_2r = i + 1
                break
            elif direction == "DOWN" and c['low'] <= target_price_2r:
                bars_to_2r = i + 1
                break

        # =====================
        # SIMULACIÓN DE TRADING REAL: TP vs SL
        # =====================
        # TP = 2R (objetivo de beneficio)
        # SL = 1R adverso (stop loss)
        # Analizar TODAS las velas disponibles hasta que cierre el trade
        # No hay timeout - el trade se queda abierto hasta TP o SL

        if direction == "UP":
            # LONG: Entry = breakout_price
            # TP = breakout_price + 2 * zone_height
            # SL = breakout_price - 1 * zone_height (movimiento adverso)
            tp_price = breakout_price + (zone_height * 2)
            sl_price = breakout_price - zone_height
        else:  # DOWN
            # SHORT: Entry = breakout_price
            # TP = breakout_price - 2 * zone_height
            # SL = breakout_price + 1 * zone_height (movimiento adverso)
            tp_price = breakout_price - (zone_height * 2)
            sl_price = breakout_price + zone_height

        tp_hit_first = False
        sl_hit_first = False
        trade_result = "OPEN"  # Default: trade aún abierto (no llegó a TP ni SL)
        trade_pnl_r = 0.0
        bars_to_close = None
        trade_close_ts = None

        # Usar TODAS las velas disponibles desde breakout hasta el final
        all_post_breakout = self.candles[breakout_idx:]

        for bar_num, c in enumerate(all_post_breakout):
            if direction == "UP":
                # Para LONG:
                # - TP hit si high >= tp_price
                # - SL hit si low <= sl_price
                tp_reached_this_candle = c['high'] >= tp_price
                sl_reached_this_candle = c['low'] <= sl_price

                if tp_reached_this_candle and sl_reached_this_candle:
                    # Ambos niveles tocados en la misma vela
                    # Asumimos el peor caso (SL primero) para ser conservadores
                    sl_hit_first = True
                    trade_result = "LOSS"
                    trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_ts = c['timestamp']
                    break
                elif tp_reached_this_candle:
                    tp_hit_first = True
                    trade_result = "WIN"
                    trade_pnl_r = 2.0
                    bars_to_close = bar_num + 1
                    trade_close_ts = c['timestamp']
                    break
                elif sl_reached_this_candle:
                    sl_hit_first = True
                    trade_result = "LOSS"
                    trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_ts = c['timestamp']
                    break
            else:  # DOWN (SHORT)
                # Para SHORT:
                # - TP hit si low <= tp_price
                # - SL hit si high >= sl_price
                tp_reached_this_candle = c['low'] <= tp_price
                sl_reached_this_candle = c['high'] >= sl_price

                if tp_reached_this_candle and sl_reached_this_candle:
                    # Ambos tocados - asumimos peor caso (SL)
                    sl_hit_first = True
                    trade_result = "LOSS"
                    trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_ts = c['timestamp']
                    break
                elif tp_reached_this_candle:
                    tp_hit_first = True
                    trade_result = "WIN"
                    trade_pnl_r = 2.0
                    bars_to_close = bar_num + 1
                    trade_close_ts = c['timestamp']
                    break
                elif sl_reached_this_candle:
                    sl_hit_first = True
                    trade_result = "LOSS"
                    trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_ts = c['timestamp']
                    break

        # =====================
        # ENFOQUE 2: Momentum
        # =====================
        breakout_body = abs(breakout_candle['close'] - breakout_candle['open'])
        atr_at_breakout = self.atr_values[breakout_idx] if breakout_idx < len(self.atr_values) else zone_height
        breakout_body_ratio = breakout_body / atr_at_breakout if atr_at_breakout > 0 else 0

        # Contar velas consecutivas en la dirección del breakout
        continuation_bars = 0
        for c in post_breakout_candles[1:]:  # Empezar después de la vela de breakout
            if direction == "UP" and c['close'] > c['open']:
                continuation_bars += 1
            elif direction == "DOWN" and c['close'] < c['open']:
                continuation_bars += 1
            else:
                break

        # Calcular máximo pullback
        if direction == "UP":
            # Encontrar el pico más alto en las primeras 20 velas
            peak_candles = post_breakout_candles[:min(20, len(post_breakout_candles))]
            peak_price = max(c['high'] for c in peak_candles)
            peak_idx = next(i for i, c in enumerate(peak_candles) if c['high'] == peak_price)

            # Buscar el pullback después del pico
            post_peak = peak_candles[peak_idx:]
            if len(post_peak) > 1:
                pullback_low = min(c['low'] for c in post_peak)
                move_from_breakout = peak_price - breakout_price
                pullback_amount = peak_price - pullback_low
                max_pullback_pct = (pullback_amount / move_from_breakout * 100) if move_from_breakout > 0 else 0
                pullback_reentered = pullback_low < zone_high
            else:
                max_pullback_pct = 0
                pullback_reentered = False
        else:  # DOWN
            trough_candles = post_breakout_candles[:min(20, len(post_breakout_candles))]
            trough_price = min(c['low'] for c in trough_candles)
            trough_idx = next(i for i, c in enumerate(trough_candles) if c['low'] == trough_price)

            post_trough = trough_candles[trough_idx:]
            if len(post_trough) > 1:
                pullback_high = max(c['high'] for c in post_trough)
                move_from_breakout = breakout_price - trough_price
                pullback_amount = pullback_high - trough_price
                max_pullback_pct = (pullback_amount / move_from_breakout * 100) if move_from_breakout > 0 else 0
                pullback_reentered = pullback_high > zone_low
            else:
                max_pullback_pct = 0
                pullback_reentered = False

        # =====================
        # ENFOQUE 3: Volumen
        # =====================
        # Volumen de la zona vs promedio histórico
        hist_avg_volume = self.avg_volume_values[zone_start_idx]
        zone_volume_vs_avg = zone_avg_volume / hist_avg_volume if hist_avg_volume > 0 else 1

        # Volumen de breakout vs promedio de zona
        breakout_volume = breakout_candle['volume']
        breakout_volume_spike = breakout_volume / zone_avg_volume if zone_avg_volume > 0 else 1

        # Velas con volumen > promedio después del breakout
        volume_confirmation_bars = 0
        for c in post_breakout_candles[1:6]:  # Primeras 5 velas después del breakout
            if c['volume'] > zone_avg_volume:
                volume_confirmation_bars += 1

        # =====================
        # SCORE COMPUESTO
        # =====================
        # R-Multiple Score (40%)
        r_score = min(r_multiple / 3.0, 1.0) * 100  # Normalizado a 3R = 100

        # Momentum Score (35%)
        body_score = min(breakout_body_ratio / 2.0, 1.0) * 40  # Cuerpo >= 2x ATR = 40 puntos
        continuation_score = min(continuation_bars / 5.0, 1.0) * 30  # 5+ velas = 30 puntos
        pullback_score = max(0, (100 - max_pullback_pct) / 100) * 30  # Menos pullback = mejor
        momentum_score = body_score + continuation_score + pullback_score

        # Volume Score (25%)
        vol_zone_score = min(zone_volume_vs_avg / 1.5, 1.0) * 40  # Volumen zona >= 1.5x = 40 puntos
        vol_spike_score = min(breakout_volume_spike / 2.0, 1.0) * 40  # Spike >= 2x = 40 puntos
        vol_confirm_score = (volume_confirmation_bars / 5.0) * 20  # 5/5 confirmaciones = 20 puntos
        volume_score = vol_zone_score + vol_spike_score + vol_confirm_score

        # Score final ponderado
        quality_score = (0.40 * r_score) + (0.35 * momentum_score) + (0.25 * volume_score)

        return BreakoutAnalysis(
            zone_id=zone.get('id', 'unknown'),
            zone_start_ts=zone['start_timestamp'],
            zone_end_ts=zone['end_timestamp'],
            zone_height=zone_height,
            zone_height_pct=zone_height_pct,
            zone_duration_bars=zone_duration,
            zone_avg_volume=zone_avg_volume,
            breakout_direction=direction,
            breakout_ts=self.candles[breakout_idx]['timestamp'],
            breakout_price=breakout_price,
            max_favorable_excursion=mfe,
            max_adverse_excursion=mae,
            r_multiple=r_multiple,
            reached_2r=reached_2r,
            reached_3r=reached_3r,
            bars_to_2r=bars_to_2r,
            # Métricas de Trading Real
            tp_hit_first=tp_hit_first,
            sl_hit_first=sl_hit_first,
            trade_result=trade_result,
            trade_pnl_r=trade_pnl_r,
            bars_to_close=bars_to_close,
            trade_close_ts=trade_close_ts,
            # Momentum
            breakout_candle_body=breakout_body,
            breakout_candle_body_ratio=breakout_body_ratio,
            continuation_bars=continuation_bars,
            max_pullback_pct=max_pullback_pct,
            pullback_reentered_zone=pullback_reentered,
            zone_volume_vs_avg=zone_volume_vs_avg,
            breakout_volume_spike=breakout_volume_spike,
            volume_confirmation_bars=volume_confirmation_bars,
            quality_score=quality_score
        )

    def analyze_multiple_zones(
        self,
        zones: List[Dict],
        lookforward_bars: int = 100
    ) -> List[BreakoutAnalysis]:
        """
        Analiza múltiples zonas y retorna sus análisis de breakout.
        MODO SIMULTÁNEO: Cada zona se analiza independientemente.
        """
        analyses = []
        for zone in zones:
            analysis = self.analyze_zone_breakout(zone, lookforward_bars)
            if analysis:
                analyses.append(analysis)

        return analyses

    def analyze_zones_sequential(
        self,
        zones: List[Dict],
        lookforward_bars: int = 100
    ) -> Tuple[List[BreakoutAnalysis], Dict]:
        """
        Analiza zonas en MODO SECUENCIAL: solo se abre un trade nuevo cuando el anterior cierra.

        Simula trading más realista donde no se pueden tener múltiples posiciones abiertas.
        Solo toma trades que NO se solapan en tiempo.

        Returns:
            Tuple[List[BreakoutAnalysis], Dict]: (análisis de trades ejecutados, estadísticas de secuencialidad)
        """
        if not zones:
            return [], {"error": "No zones provided"}

        # Ordenar zonas por timestamp de fin (cuando ocurre el breakout)
        sorted_zones = sorted(zones, key=lambda z: z['end_timestamp'])

        executed_trades = []
        skipped_trades = []
        current_trade_close_ts = 0  # Timestamp de cierre del trade actual

        for zone in sorted_zones:
            # Solo analizar si la zona empieza después de que cerró el trade anterior
            zone_breakout_ts = zone['end_timestamp']

            if zone_breakout_ts < current_trade_close_ts:
                # Esta zona inicia mientras hay un trade abierto -> SKIP
                skipped_trades.append({
                    'zone_id': zone.get('id', 'unknown'),
                    'zone_end_ts': zone_breakout_ts,
                    'reason': 'trade_already_open',
                    'current_trade_closes': current_trade_close_ts
                })
                continue

            # Analizar la zona
            analysis = self.analyze_zone_breakout(zone, lookforward_bars)

            if analysis is None:
                continue

            executed_trades.append(analysis)

            # Actualizar el timestamp de cierre del trade actual
            if analysis.trade_close_ts is not None:
                current_trade_close_ts = analysis.trade_close_ts
            else:
                # Trade aún abierto (OPEN) - usar un timestamp muy grande para bloquear
                # todos los trades siguientes (no podemos abrir otro mientras esté abierto)
                current_trade_close_ts = float('inf')

        sequential_stats = {
            "total_zones_available": len(zones),
            "trades_executed": len(executed_trades),
            "trades_skipped": len(skipped_trades),
            "skip_rate_pct": (len(skipped_trades) / len(zones) * 100) if zones else 0,
            "skipped_details": skipped_trades[:10]  # Solo los primeros 10 para no saturar
        }

        return executed_trades, sequential_stats

    def generate_statistics(
        self,
        analyses: List[BreakoutAnalysis],
        quality_threshold: float = 60.0
    ) -> Dict:
        """
        Genera estadísticas agregadas de los análisis.
        """
        if not analyses:
            return {"error": "No hay análisis disponibles"}

        r_multiples = [a.r_multiple for a in analyses]
        quality_scores = [a.quality_score for a in analyses]

        quality_zones = [a for a in analyses if a.quality_score >= quality_threshold]

        # Distribución de scores
        score_distribution = {
            "0-20": len([s for s in quality_scores if 0 <= s < 20]),
            "20-40": len([s for s in quality_scores if 20 <= s < 40]),
            "40-60": len([s for s in quality_scores if 40 <= s < 60]),
            "60-80": len([s for s in quality_scores if 60 <= s < 80]),
            "80-100": len([s for s in quality_scores if 80 <= s <= 100]),
        }

        # Distribución por dirección
        up_breakouts = [a for a in analyses if a.breakout_direction == "UP"]
        down_breakouts = [a for a in analyses if a.breakout_direction == "DOWN"]

        # Métricas de las zonas de calidad
        quality_r_multiples = [a.r_multiple for a in quality_zones] if quality_zones else [0]

        # =====================
        # MÉTRICAS DE TRADING REAL (TP vs SL)
        # =====================
        wins = [a for a in analyses if a.trade_result == "WIN"]
        losses = [a for a in analyses if a.trade_result == "LOSS"]
        still_open = [a for a in analyses if a.trade_result == "OPEN"]

        # Win rate REAL: % de trades donde TP (2R) se alcanzó ANTES que SL (1R adverso)
        total_resolved = len(wins) + len(losses)
        real_win_rate = (len(wins) / total_resolved) * 100 if total_resolved > 0 else 0

        # Total P&L en R
        total_pnl_r = sum(a.trade_pnl_r for a in analyses)

        # Expectancy: (Win% × 2R) - (Loss% × 1R)
        # Si win_rate_real = 40% → Expectancy = (0.40 × 2) - (0.60 × 1) = 0.8 - 0.6 = 0.2R por trade
        win_pct = len(wins) / total_resolved if total_resolved > 0 else 0
        loss_pct = len(losses) / total_resolved if total_resolved > 0 else 0
        expectancy_r = (win_pct * 2.0) - (loss_pct * 1.0)

        # Win rate viejo (para comparación - NO usar para trading)
        wins_old = [a for a in analyses if a.r_multiple >= 1.0 and a.max_pullback_pct < 50]
        win_rate_old = (len(wins_old) / len(analyses)) * 100 if analyses else 0

        # Bars to 2R promedio (solo los que lo alcanzaron)
        bars_to_2r_list = [a.bars_to_2r for a in analyses if a.bars_to_2r is not None]
        avg_bars_to_2r = np.mean(bars_to_2r_list) if bars_to_2r_list else None

        # Duración real de trades cerrados (en velas)
        bars_to_close_list = [a.bars_to_close for a in analyses if a.bars_to_close is not None]
        avg_bars_to_close = np.mean(bars_to_close_list) if bars_to_close_list else None
        min_bars_to_close = min(bars_to_close_list) if bars_to_close_list else None
        max_bars_to_close = max(bars_to_close_list) if bars_to_close_list else None

        # Duración por resultado
        win_durations = [a.bars_to_close for a in wins if a.bars_to_close is not None]
        loss_durations = [a.bars_to_close for a in losses if a.bars_to_close is not None]
        avg_win_duration = np.mean(win_durations) if win_durations else None
        avg_loss_duration = np.mean(loss_durations) if loss_durations else None

        return {
            "total_zones": len(analyses),
            "quality_zones": len(quality_zones),
            "quality_threshold": quality_threshold,

            # R-Multiple stats
            "avg_r_multiple": float(np.mean(r_multiples)),
            "median_r_multiple": float(np.median(r_multiples)),
            "max_r_multiple": float(max(r_multiples)),
            "min_r_multiple": float(min(r_multiples)),
            "std_r_multiple": float(np.std(r_multiples)),

            # Quality zones R-Multiple
            "quality_avg_r": float(np.mean(quality_r_multiples)),
            "quality_median_r": float(np.median(quality_r_multiples)),

            # Porcentajes
            "pct_reached_2r": (len([a for a in analyses if a.reached_2r]) / len(analyses)) * 100,
            "pct_reached_3r": (len([a for a in analyses if a.reached_3r]) / len(analyses)) * 100,

            # MÉTRICAS DE TRADING REAL (las importantes)
            "real_win_rate": real_win_rate,  # % trades donde TP (2R) se alcanzó ANTES que SL
            "total_wins": len(wins),
            "total_losses": len(losses),
            "total_still_open": len(still_open),  # Trades que no llegaron a TP ni SL
            "total_pnl_r": total_pnl_r,  # P&L total en R (+2 por win, -1 por loss)
            "expectancy_r": expectancy_r,  # E = (Win% × 2R) - (Loss% × 1R)
            "is_profitable": expectancy_r > 0,  # ¿Sistema rentable con 2R:1R?

            # Win rate viejo (OBSOLETO - solo para comparación)
            "win_rate_old": win_rate_old,

            # Tiempo
            "avg_bars_to_2r": float(avg_bars_to_2r) if avg_bars_to_2r else None,

            # DURACIÓN REAL DE TRADES (en velas)
            "avg_bars_to_close": float(avg_bars_to_close) if avg_bars_to_close else None,
            "min_bars_to_close": int(min_bars_to_close) if min_bars_to_close else None,
            "max_bars_to_close": int(max_bars_to_close) if max_bars_to_close else None,
            "avg_win_duration": float(avg_win_duration) if avg_win_duration else None,
            "avg_loss_duration": float(avg_loss_duration) if avg_loss_duration else None,

            # Score stats
            "avg_quality_score": float(np.mean(quality_scores)),
            "median_quality_score": float(np.median(quality_scores)),
            "score_distribution": score_distribution,

            # Por dirección
            "breakout_direction_stats": {
                "UP": {
                    "count": len(up_breakouts),
                    "avg_r": float(np.mean([a.r_multiple for a in up_breakouts])) if up_breakouts else 0,
                    "pct_reached_2r": (len([a for a in up_breakouts if a.reached_2r]) / len(up_breakouts) * 100) if up_breakouts else 0
                },
                "DOWN": {
                    "count": len(down_breakouts),
                    "avg_r": float(np.mean([a.r_multiple for a in down_breakouts])) if down_breakouts else 0,
                    "pct_reached_2r": (len([a for a in down_breakouts if a.reached_2r]) / len(down_breakouts) * 100) if down_breakouts else 0
                }
            },

            # Características de zonas de calidad
            "quality_zone_characteristics": self._analyze_quality_zone_characteristics(quality_zones) if quality_zones else None
        }

    def _analyze_quality_zone_characteristics(self, quality_zones: List[BreakoutAnalysis]) -> Dict:
        """Analiza las características comunes de las zonas de alta calidad."""
        return {
            "avg_zone_height_pct": float(np.mean([z.zone_height_pct for z in quality_zones])),
            "avg_zone_duration_bars": float(np.mean([z.zone_duration_bars for z in quality_zones])),
            "avg_breakout_body_ratio": float(np.mean([z.breakout_candle_body_ratio for z in quality_zones])),
            "avg_continuation_bars": float(np.mean([z.continuation_bars for z in quality_zones])),
            "avg_volume_vs_avg": float(np.mean([z.zone_volume_vs_avg for z in quality_zones])),
            "avg_breakout_volume_spike": float(np.mean([z.breakout_volume_spike for z in quality_zones])),
            "median_zone_height_pct": float(np.median([z.zone_height_pct for z in quality_zones])),
            "median_zone_duration_bars": float(np.median([z.zone_duration_bars for z in quality_zones])),
        }


class ZoneParameterOptimizer:
    """
    Optimiza los parámetros del ZoneDetector para encontrar zonas de alta calidad.

    Usa grid search para probar múltiples combinaciones de parámetros
    y evalúa cada combinación con el ZoneQualityAnalyzer.
    """

    def __init__(self, candles: List[Dict]):
        self.candles = candles
        self.quality_analyzer = ZoneQualityAnalyzer(candles)
        print(f"[ZoneParameterOptimizer] Inicializado con {len(candles)} velas")

    def run_optimization(
        self,
        zone_detector,  # Instancia de ZoneDetector
        param_grid: Dict[str, List],
        quality_threshold: float = 60.0,
        lookforward_bars: int = 100
    ) -> List[OptimizationResult]:
        """
        Ejecuta grid search sobre los parámetros.

        Args:
            zone_detector: Instancia de ZoneDetector
            param_grid: Diccionario con listas de valores a probar
                       Ej: {"consol_min_bars": [5, 8, 10], "consol_max_range_pct": [2, 3, 5]}
            quality_threshold: Umbral de score para considerar zona de calidad
            lookforward_bars: Velas a analizar después del breakout

        Returns:
            Lista de OptimizationResult ordenada por mejor rendimiento
        """
        from itertools import product
        from zone_detector import ZoneDetectionParams

        # Generar todas las combinaciones de parámetros
        param_names = list(param_grid.keys())
        param_values = list(param_grid.values())
        combinations = list(product(*param_values))

        print(f"[Optimizer] Probando {len(combinations)} combinaciones de parámetros...")

        results = []

        for i, combo in enumerate(combinations):
            params_dict = dict(zip(param_names, combo))

            # Crear objeto de parámetros
            params = ZoneDetectionParams(**params_dict)

            # Detectar zonas con estos parámetros
            zones = zone_detector.detect_zones(self.candles, method="consolidation", params=params)

            if len(zones) < 3:  # Necesitamos al menos 3 zonas para estadísticas significativas
                continue

            # Convertir zonas a diccionarios
            zones_dict = [z.to_dict() for z in zones]

            # Analizar calidad de las zonas
            analyses = self.quality_analyzer.analyze_multiple_zones(zones_dict, lookforward_bars)

            if len(analyses) < 3:
                continue

            # Generar estadísticas
            stats = self.quality_analyzer.generate_statistics(analyses, quality_threshold)

            # Calcular score de distribución
            score_dist = stats['score_distribution']

            result = OptimizationResult(
                params=params_dict,
                total_zones=stats['total_zones'],
                quality_zones=stats['quality_zones'],
                avg_r_multiple=stats['avg_r_multiple'],
                median_r_multiple=stats['median_r_multiple'],
                pct_reached_2r=stats['pct_reached_2r'],
                pct_reached_3r=stats['pct_reached_3r'],
                avg_quality_score=stats['avg_quality_score'],
                avg_bars_to_2r=stats['avg_bars_to_2r'] if stats['avg_bars_to_2r'] else 0,
                # Métricas de trading real
                real_win_rate=stats['real_win_rate'],
                total_wins=stats['total_wins'],
                total_losses=stats['total_losses'],
                total_still_open=stats['total_still_open'],
                total_pnl_r=stats['total_pnl_r'],
                expectancy_r=stats['expectancy_r'],
                is_profitable=stats['is_profitable'],
                # Duración de trades
                avg_bars_to_close=stats['avg_bars_to_close'],
                avg_win_duration=stats['avg_win_duration'],
                avg_loss_duration=stats['avg_loss_duration'],
                score_distribution=score_dist
            )

            results.append(result)

            if (i + 1) % 10 == 0:
                print(f"[Optimizer] Progreso: {i + 1}/{len(combinations)} combinaciones")

        # Ordenar por mejor rendimiento de TRADING REAL
        # Priorizar: 1) Expectancy (E>0 = rentable), 2) Real Win Rate, 3) Avg quality score
        results.sort(key=lambda x: (x.expectancy_r, x.real_win_rate, x.avg_quality_score), reverse=True)

        print(f"[Optimizer] Completado. {len(results)} combinaciones válidas")

        return results

    def get_recommended_params(self, results: List[OptimizationResult], top_n: int = 5) -> Dict:
        """
        Analiza los mejores resultados y recomienda parámetros.
        """
        if not results:
            return {"error": "No hay resultados de optimización"}

        top_results = results[:top_n]

        # Analizar parámetros comunes en los mejores resultados
        param_analysis = defaultdict(list)
        for r in top_results:
            for param, value in r.params.items():
                param_analysis[param].append(value)

        # Calcular valores recomendados (mediana de los mejores)
        recommended = {}
        for param, values in param_analysis.items():
            recommended[param] = {
                "recommended": float(np.median(values)),
                "range": [float(min(values)), float(max(values))],
                "values_in_top": values
            }

        return {
            "best_result": top_results[0].to_dict() if top_results else None,
            "top_5_summary": [r.to_dict() for r in top_results],
            "recommended_params": recommended,
            "analysis": {
                # Métricas de trading REAL
                "best_real_win_rate": max(r.real_win_rate for r in results),
                "best_expectancy_r": max(r.expectancy_r for r in results),
                "profitable_combinations": len([r for r in results if r.is_profitable]),
                "unprofitable_combinations": len([r for r in results if not r.is_profitable]),
                # Métricas auxiliares
                "best_pct_2r": max(r.pct_reached_2r for r in results),
                "best_avg_r": max(r.avg_r_multiple for r in results),
                "total_combinations_tested": len(results)
            }
        }
