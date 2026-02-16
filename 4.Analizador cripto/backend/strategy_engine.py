"""
Strategy Engine - Motor Modular de Backtesting
===============================================
Sistema composable de estrategias de trading basado en 5 bloques:
  1. Niveles de Referencia (donde operar)
  2. Senales de Entrada (cuando entrar)
  3. Filtros de Contexto (bajo que condiciones)
  4. Gestion de Riesgo (SL/TP)
  5. Exit Rules (salida adaptativa)

Reutiliza calculadores existentes: VP Periodic, S&R v2, VWAP Rolling,
Swing Detector, Double Top/Bottom.
"""

import math
import time
import logging
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Any

# Reutilizar helpers existentes
from backtest_vp_periodic import (
    compute_volume_profile,
    compute_vwap_rolling,
    get_vp_segments,
    build_segment_lookup,
    resolve_trade,
    calculate_metrics,
)
from sr_detector import SRDetector
from double_topbottom_detector import DoubleTopBottomDetector

logger = logging.getLogger(__name__)


# ===========================================================================
# Dataclasses de Configuracion
# ===========================================================================

@dataclass
class LevelSourceConfig:
    source: str      # 'vp_periodic', 'sr_v2', 'vwap_bands', 'swing_levels', 'dtb_neckline'
    enabled: bool = False
    params: Dict = field(default_factory=dict)


@dataclass
class EntrySignalConfig:
    signal_type: str = 'price_touch'   # 'swing_confirm', 'price_touch', 'breakout_close',
                                        # 'rejection_candle', 'pattern_match', 'squeeze_release',
                                        # 'cvd_divergence', 'dtb_confirm'
    params: Dict = field(default_factory=dict)


@dataclass
class ContextFilterConfig:
    filter_type: str = ''   # 'vwap_trend', 'vwap_position', 'ttm_squeeze', 'bbwp_range',
                             # 'volume_zscore', 'cvd_trend', 'dtb_bias', 'direction'
    enabled: bool = False
    params: Dict = field(default_factory=dict)


@dataclass
class RiskConfig:
    sl_method: str = 'below_level'    # 'below_level', 'below_swing', 'atr_multiple', 'fixed_pct'
    sl_params: Dict = field(default_factory=lambda: {'buffer_pct': 0.1})
    tp_method: str = 'rr_fixed'       # 'rr_fixed', 'opposite_level', 'next_swing', 'atr_multiple', 'fixed_pct'
    tp_params: Dict = field(default_factory=lambda: {'rr': 2.0})
    max_trades_per_segment: int = 1
    trailing_stop: bool = False


@dataclass
class ExitRuleConfig:
    rule_type: str = ''   # 'vwap_reverse', 'reenter_zone', 'squeeze_activate', 'cvd_diverge', 'timeout'
    enabled: bool = False
    params: Dict = field(default_factory=dict)


@dataclass
class StrategyConfig:
    level_sources: List[Dict] = field(default_factory=list)
    entry_signal: Dict = field(default_factory=lambda: {'signal_type': 'price_touch', 'params': {}})
    context_filters: List[Dict] = field(default_factory=list)
    risk: Dict = field(default_factory=lambda: {
        'sl_method': 'below_level', 'sl_params': {'buffer_pct': 0.1},
        'tp_method': 'rr_fixed', 'tp_params': {'rr': 2.0},
        'max_trades_per_segment': 1, 'trailing_stop': False
    })
    exit_rules: List[Dict] = field(default_factory=list)
    confluence_mode: str = 'any'       # 'any' o 'score'
    min_confluence_score: int = 0
    vwap_period: int = 20


# ===========================================================================
# Nivel unificado
# ===========================================================================

@dataclass
class Level:
    price: float
    level_type: str       # 'support' o 'resistance'
    source: str           # 'vp_poc', 'vp_vah', 'vp_val', 'sr_v2', 'vwap', 'vwap_upper_1', etc.
    strength: float = 50  # 0-100
    valid_from_idx: int = 0
    valid_until_idx: Optional[int] = None  # None = vigente hasta el final
    extra: Dict = field(default_factory=dict)


# ===========================================================================
# BLOQUE 1: Calculadores de Niveles
# ===========================================================================

def compute_vp_levels(candles: List[Dict], period: int = 240, bins: int = 50) -> List[Level]:
    """Calcula niveles POC/VAH/VAL por segmento VP Periodic.
    Cada segmento genera 3 niveles (activos solo DESPUES de que el segmento cierra)."""
    segments = get_vp_segments(candles, period, bins)
    levels = []

    for seg in segments:
        prof = seg['profile']
        end_idx = seg['end_idx']

        # Determinar hasta cuando es valido (hasta que cierre el siguiente segmento)
        next_end = None
        for s2 in segments:
            if s2['start_idx'] > seg['start_idx']:
                next_end = s2['end_idx']
                break

        current_price_at_end = candles[min(end_idx, len(candles) - 1)]['close']

        poc = prof['poc_price']
        vah = prof['vah_price']
        val_ = prof['val_price']

        # POC: soporte si precio > POC, resistencia si precio < POC
        poc_type = 'support' if current_price_at_end > poc else 'resistance'
        levels.append(Level(
            price=poc, level_type=poc_type, source='vp_poc',
            strength=70, valid_from_idx=end_idx, valid_until_idx=next_end,
            extra={'vah': vah, 'val': val_, 'seg_start_idx': seg['start_idx']}
        ))

        # VAH siempre como resistencia
        levels.append(Level(
            price=vah, level_type='resistance', source='vp_vah',
            strength=60, valid_from_idx=end_idx, valid_until_idx=next_end,
            extra={'poc': poc, 'val': val_, 'seg_start_idx': seg['start_idx']}
        ))

        # VAL siempre como soporte
        levels.append(Level(
            price=val_, level_type='support', source='vp_val',
            strength=60, valid_from_idx=end_idx, valid_until_idx=next_end,
            extra={'poc': poc, 'vah': vah, 'seg_start_idx': seg['start_idx']}
        ))

    return levels


def compute_sr_levels(candles: List[Dict], params: Dict) -> List[Level]:
    """Calcula niveles S&R v2 usando swing points clusterizados.
    Se recalculan cada `recalc_every` velas."""
    detector = SRDetector()
    swing_bars = params.get('swing_bars', 3)
    cluster_dist = params.get('cluster_distance_pct', 0.3)
    min_touches = params.get('min_touches', 2)
    max_levels = params.get('max_levels', 10)
    recalc_every = params.get('recalc_every', 100)  # Recalcular cada N velas

    levels = []
    last_calc_idx = -recalc_every  # Forzar primer calculo

    for i in range(0, len(candles), recalc_every):
        window_end = min(i + recalc_every, len(candles))
        window_candles = candles[:window_end]

        if len(window_candles) < swing_bars * 2 + 1:
            continue

        result = detector.detect_levels(
            candles=window_candles,
            swing_bars=swing_bars,
            cluster_distance_pct=cluster_dist,
            min_touches=min_touches,
            max_levels=max_levels,
            price_range_pct=10.0,
        )

        valid_until = min(i + recalc_every, len(candles))

        for r in result.get('resistances', []):
            if r.get('status') == 'active':
                levels.append(Level(
                    price=r['price'], level_type='resistance', source='sr_v2',
                    strength=r.get('strength', 50), valid_from_idx=i,
                    valid_until_idx=valid_until,
                    extra={'touches': r.get('touches', 0)}
                ))

        for s in result.get('supports', []):
            if s.get('status') == 'active':
                levels.append(Level(
                    price=s['price'], level_type='support', source='sr_v2',
                    strength=s.get('strength', 50), valid_from_idx=i,
                    valid_until_idx=valid_until,
                    extra={'touches': s.get('touches', 0)}
                ))

    return levels


def compute_vwap_band_levels(vwap_data: List[Dict]) -> List[Level]:
    """Convierte datos VWAP en niveles dinamicos por vela.
    Cada vela tiene VWAP + bandas como niveles."""
    levels = []

    for i, vp in enumerate(vwap_data):
        current_price = vp.get('close', vp['vwap'])  # Estimacion

        # VWAP central
        levels.append(Level(
            price=vp['vwap'], level_type='support', source='vwap',
            strength=50, valid_from_idx=i, valid_until_idx=i + 1
        ))

        # Bandas superiores (resistencia)
        levels.append(Level(
            price=vp['upper_1'], level_type='resistance', source='vwap_upper_1',
            strength=55, valid_from_idx=i, valid_until_idx=i + 1
        ))
        levels.append(Level(
            price=vp['upper_2'], level_type='resistance', source='vwap_upper_2',
            strength=60, valid_from_idx=i, valid_until_idx=i + 1
        ))

        # Bandas inferiores (soporte)
        levels.append(Level(
            price=vp['lower_1'], level_type='support', source='vwap_lower_1',
            strength=55, valid_from_idx=i, valid_until_idx=i + 1
        ))
        levels.append(Level(
            price=vp['lower_2'], level_type='support', source='vwap_lower_2',
            strength=60, valid_from_idx=i, valid_until_idx=i + 1
        ))

    return levels


def compute_swing_as_levels(candles: List[Dict], swing_bars: int = 5) -> List[Level]:
    """Detecta swing highs/lows y los convierte en niveles S/R dinamicos."""
    levels = []

    for i in range(swing_bars, len(candles) - swing_bars):
        # Swing Low -> Soporte
        is_low = True
        ref_low = candles[i]['low']
        for j in range(1, swing_bars + 1):
            if candles[i - j]['low'] <= ref_low or candles[i + j]['low'] <= ref_low:
                is_low = False
                break
        if is_low:
            levels.append(Level(
                price=ref_low, level_type='support', source='swing_low',
                strength=55, valid_from_idx=i + swing_bars,
                valid_until_idx=None,
                extra={'pivot_idx': i}
            ))

        # Swing High -> Resistencia
        is_high = True
        ref_high = candles[i]['high']
        for j in range(1, swing_bars + 1):
            if candles[i - j]['high'] >= ref_high or candles[i + j]['high'] >= ref_high:
                is_high = False
                break
        if is_high:
            levels.append(Level(
                price=ref_high, level_type='resistance', source='swing_high',
                strength=55, valid_from_idx=i + swing_bars,
                valid_until_idx=None,
                extra={'pivot_idx': i}
            ))

    return levels


def compute_dtb_levels(candles: List[Dict], params: Dict) -> Tuple[List[Level], List[Dict]]:
    """Detecta Double Top/Bottom y extrae necklines como niveles.
    Retorna (levels, patterns) para uso en senales y filtros."""
    detector = DoubleTopBottomDetector()
    config = {
        'doubleTopBottom': {
            'lookbackCandles': len(candles),
            'candlesPerExtreme': params.get('candles_per_extreme', 5),
            'priceMarginPercent': params.get('price_margin_pct', 2.0),
            'minCandlesBetween': params.get('min_candles_between', 10),
            'maxCandlesBetween': params.get('max_candles_between', 100),
            'volumeFilter': {'enabled': False},
        }
    }
    patterns = detector.detect_patterns('BACKTEST', candles, config)

    levels = []
    serialized_patterns = []

    for p in patterns:
        neckline = p.level_price
        p_type = p.type  # DOUBLE_TOP o DOUBLE_BOTTOM

        # DT neckline = soporte (el precio rebota abajo), DB neckline = resistencia
        if p_type == 'DOUBLE_TOP':
            level_type = 'support'
        else:
            level_type = 'resistance'

        second_idx = p.second_extreme.get('candle_index', 0) if isinstance(p.second_extreme, dict) else 0
        levels.append(Level(
            price=neckline, level_type=level_type, source='dtb_neckline',
            strength=p.confidence * 0.7,
            valid_from_idx=second_idx,
            valid_until_idx=None,
            extra={'pattern_type': p_type, 'confidence': p.confidence}
        ))

        serialized_patterns.append({
            'type': p_type,
            'timestamp': p.timestamp,
            'confidence': p.confidence,
            'level_price': p.level_price,
            'first_extreme_idx': p.first_extreme.get('candle_index', 0) if isinstance(p.first_extreme, dict) else 0,
            'second_extreme_idx': second_idx,
            'price_variance': p.price_variance,
        })

    return levels, serialized_patterns


# ===========================================================================
# BLOQUE 2: Generadores de Senales
# ===========================================================================

def _get_active_levels_at(levels: List[Level], idx: int, price: float,
                          tolerance_pct: float = 0.3,
                          direction: Optional[str] = None) -> List[Level]:
    """Obtiene niveles activos y cercanos al precio en el indice dado.
    Si direction='LONG' solo retorna soportes, 'SHORT' solo resistencias."""
    active = []
    tol = price * tolerance_pct / 100.0

    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue
        if abs(lv.price - price) > tol:
            continue
        if direction == 'LONG' and lv.level_type != 'support':
            continue
        if direction == 'SHORT' and lv.level_type != 'resistance':
            continue
        active.append(lv)

    return active


def signal_price_touch(candles: List[Dict], idx: int, levels: List[Level],
                       tolerance_pct: float = 0.1) -> Optional[Dict]:
    """Precio toca un nivel (simple)."""
    curr = candles[idx]
    price = curr['close']

    # Buscar en soportes (LONG) y resistencias (SHORT)
    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue

        tol = lv.price * tolerance_pct / 100.0

        if lv.level_type == 'support' and curr['low'] <= lv.price + tol and curr['close'] > lv.price:
            return {
                'triggered': True, 'direction': 'LONG',
                'level_price': lv.price, 'level_source': lv.source,
                'entry_price': curr['close'], 'confidence': lv.strength,
            }
        elif lv.level_type == 'resistance' and curr['high'] >= lv.price - tol and curr['close'] < lv.price:
            return {
                'triggered': True, 'direction': 'SHORT',
                'level_price': lv.price, 'level_source': lv.source,
                'entry_price': curr['close'], 'confidence': lv.strength,
            }

    return None


def signal_swing_confirm(candles: List[Dict], idx: int, levels: List[Level],
                         swing_bars: int = 3, tolerance_pct: float = 0.3) -> Optional[Dict]:
    """Swing Low/High confirmado cerca de un nivel."""
    if idx < swing_bars * 2:
        return None

    pivot_idx = idx - swing_bars

    # Swing Low -> LONG
    is_low = True
    ref_low = candles[pivot_idx]['low']
    for j in range(1, swing_bars + 1):
        if (pivot_idx - j < 0 or pivot_idx + j >= len(candles)):
            is_low = False
            break
        if candles[pivot_idx - j]['low'] <= ref_low or candles[pivot_idx + j]['low'] <= ref_low:
            is_low = False
            break

    if is_low:
        nearby = _get_active_levels_at(levels, pivot_idx, ref_low, tolerance_pct, 'LONG')
        if nearby:
            best = max(nearby, key=lambda l: l.strength)
            return {
                'triggered': True, 'direction': 'LONG',
                'level_price': best.price, 'level_source': best.source,
                'entry_price': candles[idx]['close'], 'confidence': best.strength,
                'pivot_idx': pivot_idx, 'pivot_price': ref_low,
            }

    # Swing High -> SHORT
    is_high = True
    ref_high = candles[pivot_idx]['high']
    for j in range(1, swing_bars + 1):
        if (pivot_idx - j < 0 or pivot_idx + j >= len(candles)):
            is_high = False
            break
        if candles[pivot_idx - j]['high'] >= ref_high or candles[pivot_idx + j]['high'] >= ref_high:
            is_high = False
            break

    if is_high:
        nearby = _get_active_levels_at(levels, pivot_idx, ref_high, tolerance_pct, 'SHORT')
        if nearby:
            best = max(nearby, key=lambda l: l.strength)
            return {
                'triggered': True, 'direction': 'SHORT',
                'level_price': best.price, 'level_source': best.source,
                'entry_price': candles[idx]['close'], 'confidence': best.strength,
                'pivot_idx': pivot_idx, 'pivot_price': ref_high,
            }

    return None


def signal_breakout_close(candles: List[Dict], idx: int, levels: List[Level],
                          confirm_bars: int = 2, tolerance_pct: float = 0.1) -> Optional[Dict]:
    """N cierres consecutivos al otro lado del nivel."""
    if idx < confirm_bars:
        return None

    curr = candles[idx]

    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue

        # Breakout alcista de resistencia
        if lv.level_type == 'resistance':
            all_above = all(candles[idx - k]['close'] > lv.price for k in range(confirm_bars))
            if all_above:
                return {
                    'triggered': True, 'direction': 'LONG',
                    'level_price': lv.price, 'level_source': lv.source,
                    'entry_price': curr['close'], 'confidence': lv.strength,
                }

        # Breakout bajista de soporte
        elif lv.level_type == 'support':
            all_below = all(candles[idx - k]['close'] < lv.price for k in range(confirm_bars))
            if all_below:
                return {
                    'triggered': True, 'direction': 'SHORT',
                    'level_price': lv.price, 'level_source': lv.source,
                    'entry_price': curr['close'], 'confidence': lv.strength,
                }

    return None


def signal_rejection_candle(candles: List[Dict], idx: int, levels: List[Level],
                            wick_ratio: float = 0.6, tolerance_pct: float = 0.2) -> Optional[Dict]:
    """Vela de rechazo (wick largo) en un nivel."""
    curr = candles[idx]
    candle_range = curr['high'] - curr['low']
    if candle_range <= 0:
        return None

    body_top = max(curr['open'], curr['close'])
    body_bot = min(curr['open'], curr['close'])
    lower_wick = body_bot - curr['low']
    upper_wick = curr['high'] - body_top

    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue

        tol = lv.price * tolerance_pct / 100.0

        # Rechazo en soporte (wick inferior largo) -> LONG
        if (lv.level_type == 'support' and
            curr['low'] <= lv.price + tol and curr['close'] > lv.price and
            lower_wick / candle_range >= wick_ratio):
            return {
                'triggered': True, 'direction': 'LONG',
                'level_price': lv.price, 'level_source': lv.source,
                'entry_price': curr['close'], 'confidence': lv.strength,
                'wick_ratio': round(lower_wick / candle_range, 2),
            }

        # Rechazo en resistencia (wick superior largo) -> SHORT
        if (lv.level_type == 'resistance' and
            curr['high'] >= lv.price - tol and curr['close'] < lv.price and
            upper_wick / candle_range >= wick_ratio):
            return {
                'triggered': True, 'direction': 'SHORT',
                'level_price': lv.price, 'level_source': lv.source,
                'entry_price': curr['close'], 'confidence': lv.strength,
                'wick_ratio': round(upper_wick / candle_range, 2),
            }

    return None


def signal_pattern_match(candles: List[Dict], idx: int, levels: List[Level],
                         pattern_type: str = 'hammer',
                         min_confidence: int = 50,
                         tolerance_pct: float = 0.5) -> Optional[Dict]:
    """Deteccion de patrones de velas clasicos cerca de un nivel."""
    if idx < 1:
        return None

    curr = candles[idx]
    prev = candles[idx - 1]
    candle_range = curr['high'] - curr['low']
    if candle_range <= 0:
        return None

    body = abs(curr['close'] - curr['open'])
    body_top = max(curr['open'], curr['close'])
    body_bot = min(curr['open'], curr['close'])
    lower_wick = body_bot - curr['low']
    upper_wick = curr['high'] - body_top
    is_bullish = curr['close'] > curr['open']

    detected_dir = None
    confidence = 0

    if pattern_type == 'hammer':
        # Hammer: mecha inferior >= 2x cuerpo, mecha superior pequena
        if lower_wick >= body * 2 and upper_wick < body * 0.5 and body > 0:
            detected_dir = 'LONG'
            confidence = min(100, 50 + (lower_wick / body) * 10)

    elif pattern_type == 'shooting_star':
        if upper_wick >= body * 2 and lower_wick < body * 0.5 and body > 0:
            detected_dir = 'SHORT'
            confidence = min(100, 50 + (upper_wick / body) * 10)

    elif pattern_type == 'engulfing_bullish':
        prev_body = abs(prev['close'] - prev['open'])
        if (prev['close'] < prev['open'] and is_bullish and
            body > prev_body and curr['open'] <= prev['close']):
            detected_dir = 'LONG'
            confidence = min(100, 60 + (body / prev_body) * 10) if prev_body > 0 else 60

    elif pattern_type == 'engulfing_bearish':
        prev_body = abs(prev['close'] - prev['open'])
        if (prev['close'] > prev['open'] and not is_bullish and
            body > prev_body and curr['open'] >= prev['close']):
            detected_dir = 'SHORT'
            confidence = min(100, 60 + (body / prev_body) * 10) if prev_body > 0 else 60

    elif pattern_type == 'doji':
        if body < candle_range * 0.1:  # Cuerpo < 10% del rango
            # Doji en soporte = LONG, en resistencia = SHORT
            nearby_sup = _get_active_levels_at(levels, idx, curr['close'], tolerance_pct, 'LONG')
            nearby_res = _get_active_levels_at(levels, idx, curr['close'], tolerance_pct, 'SHORT')
            if nearby_sup:
                detected_dir = 'LONG'
                confidence = 55
            elif nearby_res:
                detected_dir = 'SHORT'
                confidence = 55

    if detected_dir is None or confidence < min_confidence:
        return None

    # Verificar que hay un nivel cercano
    nearby = _get_active_levels_at(
        levels, idx, curr['close'], tolerance_pct,
        'LONG' if detected_dir == 'LONG' else 'SHORT'
    )
    if not nearby:
        return None

    best = max(nearby, key=lambda l: l.strength)
    return {
        'triggered': True, 'direction': detected_dir,
        'level_price': best.price, 'level_source': best.source,
        'entry_price': curr['close'], 'confidence': confidence,
        'pattern': pattern_type,
    }


def signal_squeeze_release(vwap_data: List[Dict], idx: int,
                           levels: List[Level]) -> Optional[Dict]:
    """TTM Squeeze pasa de True a False (release)."""
    if idx < 2 or idx >= len(vwap_data):
        return None

    curr_vwap = vwap_data[idx]
    prev_vwap = vwap_data[idx - 1]

    # Necesitamos que el VWAP tenga datos de squeeze
    curr_squeeze = curr_vwap.get('squeeze', None)
    prev_squeeze = prev_vwap.get('squeeze', None)

    if prev_squeeze is None or curr_squeeze is None:
        return None

    # Squeeze release: estaba en squeeze, ya no lo esta
    if prev_squeeze and not curr_squeeze:
        # Direccion basada en momentum (pendiente del VWAP)
        vwap_now = curr_vwap['vwap']
        vwap_prev = vwap_data[max(0, idx - 5)]['vwap']
        direction = 'LONG' if vwap_now > vwap_prev else 'SHORT'

        return {
            'triggered': True, 'direction': direction,
            'level_price': vwap_now, 'level_source': 'ttm_squeeze',
            'entry_price': vwap_now,  # Se sobreescribe con candle close
            'confidence': 60,
        }

    return None


def signal_cvd_divergence(candles: List[Dict], idx: int, levels: List[Level],
                          lookback: int = 20) -> Optional[Dict]:
    """Divergencia entre precio y CVD acumulado."""
    if idx < lookback + 5:
        return None

    # Calcular CVD simple sobre la ventana
    window = candles[idx - lookback:idx + 1]
    cvd = []
    cum = 0.0
    for c in window:
        # Aproximacion: si close > open -> +volume, else -volume
        delta = c['volume'] if c['close'] > c['open'] else -c['volume']
        cum += delta
        cvd.append(cum)

    # Buscar swing lows del precio y del CVD
    prices_low = [c['low'] for c in window]
    prices_high = [c['high'] for c in window]

    # Encontrar los dos minimos mas recientes del precio
    price_mins = []
    for i in range(2, len(prices_low) - 2):
        if prices_low[i] < prices_low[i-1] and prices_low[i] < prices_low[i-2] and \
           prices_low[i] < prices_low[i+1] and prices_low[i] < prices_low[i+2]:
            price_mins.append((i, prices_low[i], cvd[i]))

    if len(price_mins) >= 2:
        prev_min = price_mins[-2]
        curr_min = price_mins[-1]
        # Divergencia alcista: precio hace lower low, CVD hace higher low
        if curr_min[1] < prev_min[1] and curr_min[2] > prev_min[2]:
            return {
                'triggered': True, 'direction': 'LONG',
                'level_price': candles[idx]['close'],
                'level_source': 'cvd_divergence',
                'entry_price': candles[idx]['close'],
                'confidence': 55,
            }

    # Encontrar los dos maximos mas recientes
    price_maxs = []
    for i in range(2, len(prices_high) - 2):
        if prices_high[i] > prices_high[i-1] and prices_high[i] > prices_high[i-2] and \
           prices_high[i] > prices_high[i+1] and prices_high[i] > prices_high[i+2]:
            price_maxs.append((i, prices_high[i], cvd[i]))

    if len(price_maxs) >= 2:
        prev_max = price_maxs[-2]
        curr_max = price_maxs[-1]
        # Divergencia bajista: precio hace higher high, CVD hace lower high
        if curr_max[1] > prev_max[1] and curr_max[2] < prev_max[2]:
            return {
                'triggered': True, 'direction': 'SHORT',
                'level_price': candles[idx]['close'],
                'level_source': 'cvd_divergence',
                'entry_price': candles[idx]['close'],
                'confidence': 55,
            }

    return None


def signal_dtb_confirm(dtb_patterns: List[Dict], idx: int,
                       candles: List[Dict], lookback: int = 50,
                       min_confidence: float = 50) -> Optional[Dict]:
    """Double Top/Bottom confirmado como senal de entrada."""
    curr = candles[idx]

    for p in dtb_patterns:
        second_idx = p.get('second_extreme_idx', 0)
        # Solo considerar patrones recientes (dentro del lookback)
        if second_idx < idx - lookback or second_idx > idx:
            continue
        if p['confidence'] < min_confidence:
            continue

        if p['type'] == 'DOUBLE_BOTTOM':
            return {
                'triggered': True, 'direction': 'LONG',
                'level_price': p['level_price'], 'level_source': 'dtb_double_bottom',
                'entry_price': curr['close'], 'confidence': p['confidence'],
            }
        elif p['type'] == 'DOUBLE_TOP':
            return {
                'triggered': True, 'direction': 'SHORT',
                'level_price': p['level_price'], 'level_source': 'dtb_double_top',
                'entry_price': curr['close'], 'confidence': p['confidence'],
            }

    return None


# Mapa de funciones de senal
SIGNAL_FUNCTIONS = {
    'price_touch': signal_price_touch,
    'swing_confirm': signal_swing_confirm,
    'breakout_close': signal_breakout_close,
    'rejection_candle': signal_rejection_candle,
    'pattern_match': signal_pattern_match,
    'squeeze_release': signal_squeeze_release,
    'cvd_divergence': signal_cvd_divergence,
    'dtb_confirm': signal_dtb_confirm,
}


# ===========================================================================
# BLOQUE 3: Filtros de Contexto
# ===========================================================================

def filter_vwap_trend(vwap_data: List[Dict], idx: int, direction: str,
                      lookback: int = 10) -> bool:
    """VWAP subiendo = solo LONG, bajando = solo SHORT."""
    if idx < lookback or idx >= len(vwap_data):
        return True  # No hay suficientes datos, no filtrar

    vwap_now = vwap_data[idx]['vwap']
    vwap_prev = vwap_data[idx - lookback]['vwap']

    if direction == 'LONG':
        return vwap_now > vwap_prev
    elif direction == 'SHORT':
        return vwap_now < vwap_prev
    return True


def filter_vwap_position(candles: List[Dict], vwap_data: List[Dict],
                         idx: int, direction: str,
                         reference: str = 'vwap') -> bool:
    """Precio debe estar encima/debajo del VWAP o banda."""
    if idx >= len(vwap_data):
        return True

    price = candles[idx]['close']
    vp = vwap_data[idx]

    ref_price = vp.get(reference, vp['vwap'])

    if direction == 'LONG':
        return price > ref_price
    elif direction == 'SHORT':
        return price < ref_price
    return True


def filter_ttm_squeeze(vwap_data: List[Dict], idx: int,
                       require_squeeze: bool = True) -> bool:
    """Filtro por estado de TTM Squeeze."""
    if idx >= len(vwap_data):
        return True

    squeeze = vwap_data[idx].get('squeeze', None)
    if squeeze is None:
        return True  # Sin datos de squeeze, no filtrar

    return squeeze == require_squeeze


def filter_bbwp_range(vwap_data: List[Dict], idx: int,
                      min_val: float = 0, max_val: float = 100) -> bool:
    """Filtro por rango de BBWP (percentil de volatilidad)."""
    if idx >= len(vwap_data):
        return True

    bbwp = vwap_data[idx].get('bbwp', None)
    if bbwp is None:
        return True

    return min_val <= bbwp <= max_val


def filter_volume_zscore(candles: List[Dict], idx: int,
                         min_zscore: float = 1.5, lookback: int = 20) -> bool:
    """Filtro por volumen anomalo (z-score)."""
    if idx < lookback:
        return True

    volumes = [candles[i]['volume'] for i in range(max(0, idx - lookback), idx)]
    if not volumes or len(volumes) < 2:
        return True

    mean_vol = sum(volumes) / len(volumes)
    if mean_vol <= 0:
        return True

    var_vol = sum((v - mean_vol) ** 2 for v in volumes) / len(volumes)
    std_vol = math.sqrt(var_vol) if var_vol > 0 else 0

    if std_vol <= 0:
        return True

    zscore = (candles[idx]['volume'] - mean_vol) / std_vol
    return zscore >= min_zscore


def filter_cvd_trend(candles: List[Dict], idx: int, direction: str,
                     lookback: int = 20) -> bool:
    """Filtro por tendencia del CVD."""
    if idx < lookback:
        return True

    # CVD al inicio y al final de la ventana
    cvd_start = 0.0
    cvd_end = 0.0
    for i in range(idx - lookback, idx + 1):
        delta = candles[i]['volume'] if candles[i]['close'] > candles[i]['open'] else -candles[i]['volume']
        if i == idx - lookback:
            cvd_start = delta
        cvd_end += delta

    if direction == 'LONG':
        return cvd_end > 0  # CVD positivo = acumulacion
    elif direction == 'SHORT':
        return cvd_end < 0  # CVD negativo = distribucion
    return True


def filter_dtb_bias(dtb_patterns: List[Dict], idx: int, direction: str,
                    lookback: int = 50, min_confidence: float = 50) -> bool:
    """DTB reciente sesga la direccion."""
    for p in dtb_patterns:
        second_idx = p.get('second_extreme_idx', 0)
        if second_idx < idx - lookback or second_idx > idx:
            continue
        if p['confidence'] < min_confidence:
            continue

        if p['type'] == 'DOUBLE_BOTTOM' and direction == 'LONG':
            return True
        if p['type'] == 'DOUBLE_TOP' and direction == 'SHORT':
            return True
        # Si hay DTB en contra, bloquear
        if p['type'] == 'DOUBLE_TOP' and direction == 'LONG':
            return False
        if p['type'] == 'DOUBLE_BOTTOM' and direction == 'SHORT':
            return False

    return True  # Sin DTB relevante, no filtrar


def filter_direction(direction: str, allowed: str = 'both') -> bool:
    """Filtro de direccion simple."""
    if allowed == 'both':
        return True
    return direction.lower() == allowed.lower()


# ===========================================================================
# BLOQUE 4: Calculadores de SL/TP
# ===========================================================================

def _find_nearest_level(levels: List[Level], idx: int, price: float,
                        target_type: str, direction: str) -> Optional[float]:
    """Encuentra el nivel mas cercano de un tipo dado."""
    candidates = []
    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue
        if lv.level_type != target_type:
            continue

        # Para LONG TP queremos resistencia ARRIBA del precio
        if direction == 'LONG' and target_type == 'resistance' and lv.price > price:
            candidates.append(lv.price)
        # Para SHORT TP queremos soporte ABAJO del precio
        elif direction == 'SHORT' and target_type == 'support' and lv.price < price:
            candidates.append(lv.price)
        # Para LONG SL queremos soporte ABAJO del precio
        elif direction == 'LONG' and target_type == 'support' and lv.price < price:
            candidates.append(lv.price)
        # Para SHORT SL queremos resistencia ARRIBA del precio
        elif direction == 'SHORT' and target_type == 'resistance' and lv.price > price:
            candidates.append(lv.price)

    if not candidates:
        return None

    # Mas cercano al precio
    return min(candidates, key=lambda p: abs(p - price))


def _find_last_swing(candles: List[Dict], idx: int, direction: str,
                     lookback: int = 50) -> Optional[float]:
    """Encuentra el ultimo swing high/low antes del indice."""
    start = max(0, idx - lookback)

    if direction == 'LONG':
        # Buscar el minimo mas reciente
        min_low = float('inf')
        for i in range(start, idx):
            if candles[i]['low'] < min_low:
                min_low = candles[i]['low']
        return min_low if min_low < float('inf') else None

    else:
        # Buscar el maximo mas reciente
        max_high = 0.0
        for i in range(start, idx):
            if candles[i]['high'] > max_high:
                max_high = candles[i]['high']
        return max_high if max_high > 0 else None


def _calculate_atr(candles: List[Dict], idx: int, period: int = 14) -> float:
    """Calcula Average True Range."""
    start = max(0, idx - period)
    trs = []
    for i in range(start + 1, idx + 1):
        tr = max(
            candles[i]['high'] - candles[i]['low'],
            abs(candles[i]['high'] - candles[i - 1]['close']),
            abs(candles[i]['low'] - candles[i - 1]['close'])
        )
        trs.append(tr)

    return sum(trs) / len(trs) if trs else 0


def compute_sl(candles: List[Dict], idx: int, entry_price: float,
               direction: str, level_price: float, levels: List[Level],
               risk_config: Dict, signal: Dict) -> Optional[float]:
    """Calcula el Stop Loss segun el metodo configurado."""
    method = risk_config.get('sl_method', 'below_level')
    params = risk_config.get('sl_params', {})
    buffer_pct = params.get('buffer_pct', 0.1) / 100.0

    if method == 'below_level':
        if direction == 'LONG':
            sl = level_price * (1 - buffer_pct)
        else:
            sl = level_price * (1 + buffer_pct)

    elif method == 'below_swing':
        swing_price = signal.get('pivot_price')
        if swing_price is None:
            swing_price = _find_last_swing(candles, idx, direction)
        if swing_price is None:
            return None
        if direction == 'LONG':
            sl = swing_price * (1 - buffer_pct)
        else:
            sl = swing_price * (1 + buffer_pct)

    elif method == 'atr_multiple':
        atr_mult = params.get('atr_multiplier', 1.5)
        atr = _calculate_atr(candles, idx)
        if atr <= 0:
            return None
        if direction == 'LONG':
            sl = entry_price - atr * atr_mult
        else:
            sl = entry_price + atr * atr_mult

    elif method == 'fixed_pct':
        pct = params.get('fixed_pct', 1.0) / 100.0
        if direction == 'LONG':
            sl = entry_price * (1 - pct)
        else:
            sl = entry_price * (1 + pct)

    else:
        return None

    return sl


def compute_tp(candles: List[Dict], idx: int, entry_price: float,
               sl_price: float, direction: str, levels: List[Level],
               risk_config: Dict) -> Optional[float]:
    """Calcula el Take Profit segun el metodo configurado."""
    method = risk_config.get('tp_method', 'rr_fixed')
    params = risk_config.get('tp_params', {})
    risk = abs(entry_price - sl_price)

    if risk <= 0:
        return None

    if method == 'rr_fixed':
        rr = params.get('rr', 2.0)
        if direction == 'LONG':
            tp = entry_price + risk * rr
        else:
            tp = entry_price - risk * rr

    elif method == 'opposite_level':
        if direction == 'LONG':
            tp = _find_nearest_level(levels, idx, entry_price, 'resistance', direction)
        else:
            tp = _find_nearest_level(levels, idx, entry_price, 'support', direction)

        if tp is None:
            # Fallback a R:R 2.0
            rr = params.get('fallback_rr', 2.0)
            tp = entry_price + risk * rr if direction == 'LONG' else entry_price - risk * rr

        # Verificar que el TP ofrece al menos 0.5R
        tp_rr = abs(tp - entry_price) / risk
        if tp_rr < 0.5:
            rr = params.get('fallback_rr', 2.0)
            tp = entry_price + risk * rr if direction == 'LONG' else entry_price - risk * rr

    elif method == 'next_swing':
        swing_price = _find_last_swing(candles, idx,
                                        'SHORT' if direction == 'LONG' else 'LONG')
        if swing_price and abs(swing_price - entry_price) / risk >= 0.5:
            tp = swing_price
        else:
            rr = params.get('fallback_rr', 2.0)
            tp = entry_price + risk * rr if direction == 'LONG' else entry_price - risk * rr

    elif method == 'atr_multiple':
        atr_mult = params.get('atr_multiplier', 3.0)
        atr = _calculate_atr(candles, idx)
        if atr <= 0:
            return None
        if direction == 'LONG':
            tp = entry_price + atr * atr_mult
        else:
            tp = entry_price - atr * atr_mult

    elif method == 'fixed_pct':
        pct = params.get('fixed_pct', 2.0) / 100.0
        if direction == 'LONG':
            tp = entry_price * (1 + pct)
        else:
            tp = entry_price * (1 - pct)

    else:
        return None

    return tp


# ===========================================================================
# BLOQUE 5: Exit Rules
# ===========================================================================

def check_exit_rules(candles: List[Dict], trade_entry_idx: int, current_idx: int,
                     direction: str, vwap_data: List[Dict],
                     exit_rules: List[Dict], level_price: float) -> bool:
    """Verifica si alguna regla de salida se activa (OR logico).
    Retorna True si debe cerrar el trade."""

    for rule in exit_rules:
        if not rule.get('enabled', False):
            continue

        rule_type = rule.get('rule_type', '')
        params = rule.get('params', {})

        if rule_type == 'vwap_reverse':
            lookback = params.get('lookback', 10)
            if current_idx < lookback or current_idx >= len(vwap_data):
                continue
            vwap_now = vwap_data[current_idx]['vwap']
            vwap_prev = vwap_data[current_idx - lookback]['vwap']
            if direction == 'LONG' and vwap_now < vwap_prev:
                return True
            if direction == 'SHORT' and vwap_now > vwap_prev:
                return True

        elif rule_type == 'reenter_zone':
            price = candles[current_idx]['close']
            if direction == 'LONG' and price < level_price:
                return True
            if direction == 'SHORT' and price > level_price:
                return True

        elif rule_type == 'squeeze_activate':
            if current_idx < len(vwap_data):
                squeeze = vwap_data[current_idx].get('squeeze', None)
                if squeeze is True:
                    return True

        elif rule_type == 'timeout':
            max_bars = params.get('max_bars', 50)
            if current_idx - trade_entry_idx >= max_bars:
                return True

    return False


# ===========================================================================
# Confluence Scoring
# ===========================================================================

def compute_confluence_score(levels: List[Level], idx: int, price: float,
                             tolerance_pct: float = 0.3) -> int:
    """Calcula score de confluencia: cuantos niveles de diferentes fuentes
    estan cerca del precio."""
    tol = price * tolerance_pct / 100.0
    sources_found = set()

    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue
        if abs(lv.price - price) <= tol:
            sources_found.add(lv.source.split('_')[0])  # Agrupar por fuente base

    # Score: cada fuente unica = 15 puntos, max 100
    return min(100, len(sources_found) * 15)


# ===========================================================================
# Motor Principal
# ===========================================================================

def resolve_trade_with_exit_rules(candles: List[Dict], entry_idx: int,
                                  entry_price: float, sl_price: float,
                                  tp_price: float, direction: str,
                                  vwap_data: List[Dict],
                                  exit_rules: List[Dict],
                                  level_price: float) -> Tuple[str, float, Optional[int], int]:
    """Monitorea SL/TP barra a barra + exit rules adaptativas."""
    risk = abs(entry_price - sl_price)
    if risk <= 0:
        return 'SKIP', 0.0, None, 0

    tp_rr = abs(tp_price - entry_price) / risk

    for j in range(entry_idx + 1, len(candles)):
        tc = candles[j]

        # Verificar SL/TP primero
        if direction == 'LONG':
            hit_tp = tc['high'] >= tp_price
            hit_sl = tc['low'] <= sl_price
        else:
            hit_tp = tc['low'] <= tp_price
            hit_sl = tc['high'] >= sl_price

        if hit_sl and hit_tp:
            if direction == 'LONG':
                hit_sl_first = tc['open'] <= sl_price
            else:
                hit_sl_first = tc['open'] >= sl_price
            if hit_sl_first:
                hit_tp = False
            else:
                hit_sl = False

        if hit_tp:
            return 'WIN', round(tp_rr, 2), tc['timestamp'], j - entry_idx
        elif hit_sl:
            return 'LOSS', -1.0, tc['timestamp'], j - entry_idx

        # Verificar exit rules
        if exit_rules and check_exit_rules(candles, entry_idx, j, direction,
                                            vwap_data, exit_rules, level_price):
            # Cerrar al close de la vela actual
            if direction == 'LONG':
                pnl = (tc['close'] - entry_price) / risk
            else:
                pnl = (entry_price - tc['close']) / risk
            result = 'WIN' if pnl > 0 else 'LOSS'
            return result, round(pnl, 2), tc['timestamp'], j - entry_idx

    # DEBUG: trade llego al final sin hit SL/TP
    remaining = len(candles) - entry_idx - 1
    # Verificar si el TP fue alcanzado revisando min/max del rango
    if direction == 'LONG':
        max_high = max(c['high'] for c in candles[entry_idx+1:]) if entry_idx+1 < len(candles) else 0
        print(f"[SB_RESOLVE] OPEN trade: dir={direction} entry={entry_price:.2f} tp={tp_price:.2f} sl={sl_price:.2f} "
              f"max_high_after_entry={max_high:.2f} bars_remaining={remaining}")
    else:
        min_low = min(c['low'] for c in candles[entry_idx+1:]) if entry_idx+1 < len(candles) else 0
        print(f"[SB_RESOLVE] OPEN trade: dir={direction} entry={entry_price:.2f} tp={tp_price:.2f} sl={sl_price:.2f} "
              f"min_low_after_entry={min_low:.2f} bars_remaining={remaining}")

    return 'OPEN', 0.0, None, remaining


def run_modular_backtest(candles: List[Dict], config: Dict,
                         progress_callback=None) -> Dict:
    """Motor principal del Strategy Builder modular.

    Args:
        candles: Lista de velas OHLCV
        config: Diccionario con la configuracion de los 5 bloques
        progress_callback: Funcion opcional (phase, percent, message)

    Returns:
        Dict con trades, zones, metrics
    """
    t0 = time.time()

    def _progress(phase, percent, message):
        if progress_callback:
            try:
                progress_callback(phase, percent, message)
            except Exception:
                pass

    # Parsear configuracion
    level_sources = config.get('level_sources', [])
    entry_cfg = config.get('entry_signal', {'signal_type': 'price_touch', 'params': {}})
    context_filters = config.get('context_filters', [])
    risk_cfg = config.get('risk', {})
    exit_rules = config.get('exit_rules', [])
    confluence_mode = config.get('confluence_mode', 'any')
    min_confluence = config.get('min_confluence_score', 0)
    vwap_period = config.get('vwap_period', 20)

    # --- PASO 1: Pre-calcular indicadores ---
    _progress('indicators', 5, 'Calculando indicadores...')

    # VWAP siempre se calcula (usado por filtros)
    vwap_data = compute_vwap_rolling(candles, period=vwap_period)

    # Niveles
    all_levels: List[Level] = []
    dtb_patterns: List[Dict] = []

    for src in level_sources:
        if not src.get('enabled', False):
            continue

        source_name = src.get('source', '')
        params = src.get('params', {})

        if source_name == 'vp_periodic':
            _progress('indicators', 10, 'Calculando VP Periodic...')
            vp_levels = compute_vp_levels(
                candles,
                period=params.get('period', 240),
                bins=params.get('bins', 50)
            )
            all_levels.extend(vp_levels)

        elif source_name == 'sr_v2':
            _progress('indicators', 15, 'Calculando S&R v2...')
            sr_levels = compute_sr_levels(candles, params)
            all_levels.extend(sr_levels)

        elif source_name == 'vwap_bands':
            _progress('indicators', 20, 'Calculando VWAP Bands como niveles...')
            vwap_levels = compute_vwap_band_levels(vwap_data)
            all_levels.extend(vwap_levels)

        elif source_name == 'swing_levels':
            _progress('indicators', 25, 'Calculando Swing H/L como niveles...')
            swing_bars = params.get('swing_bars', 5)
            swing_lvls = compute_swing_as_levels(candles, swing_bars)
            all_levels.extend(swing_lvls)

        elif source_name == 'dtb_neckline':
            _progress('indicators', 30, 'Detectando Double Top/Bottom...')
            dtb_lvls, dtb_patterns = compute_dtb_levels(candles, params)
            all_levels.extend(dtb_lvls)

    if not all_levels:
        return {
            'success': False,
            'error': 'No se activaron fuentes de niveles. Activa al menos una.'
        }

    _progress('indicators', 35, f'{len(all_levels)} niveles calculados de {sum(1 for s in level_sources if s.get("enabled"))} fuentes')

    # --- PASO 2: Iterar vela por vela ---
    _progress('backtest', 40, 'Ejecutando backtest...')

    trades = []
    used_seg_dir: set = set()
    max_trades_per_seg = risk_cfg.get('max_trades_per_segment', 1)

    # Extraer configuracion de senal
    signal_type = entry_cfg.get('signal_type', 'price_touch')
    signal_params = entry_cfg.get('params', {})

    # Extraer filtro de direccion
    allowed_direction = 'both'
    for f in context_filters:
        if f.get('filter_type') == 'direction' and f.get('enabled'):
            allowed_direction = f.get('params', {}).get('allowed', 'both')

    report_interval = max(1, len(candles) // 20)  # Reportar progreso cada 5%

    for i in range(1, len(candles)):
        if i % report_interval == 0:
            pct = 40 + int(50 * i / len(candles))
            _progress('backtest', pct, f'Vela {i:,}/{len(candles):,}...')

        # 2a. Generar senal
        signal = None

        if signal_type == 'price_touch':
            signal = signal_price_touch(candles, i, all_levels,
                                        tolerance_pct=signal_params.get('tolerance_pct', 0.1))
        elif signal_type == 'swing_confirm':
            signal = signal_swing_confirm(candles, i, all_levels,
                                          swing_bars=signal_params.get('swing_bars', 3),
                                          tolerance_pct=signal_params.get('tolerance_pct', 0.3))
        elif signal_type == 'breakout_close':
            signal = signal_breakout_close(candles, i, all_levels,
                                           confirm_bars=signal_params.get('confirm_bars', 2),
                                           tolerance_pct=signal_params.get('tolerance_pct', 0.1))
        elif signal_type == 'rejection_candle':
            signal = signal_rejection_candle(candles, i, all_levels,
                                             wick_ratio=signal_params.get('wick_ratio', 0.6),
                                             tolerance_pct=signal_params.get('tolerance_pct', 0.2))
        elif signal_type == 'pattern_match':
            signal = signal_pattern_match(candles, i, all_levels,
                                          pattern_type=signal_params.get('pattern_type', 'hammer'),
                                          min_confidence=signal_params.get('min_confidence', 50),
                                          tolerance_pct=signal_params.get('tolerance_pct', 0.5))
        elif signal_type == 'squeeze_release':
            signal = signal_squeeze_release(vwap_data, i, all_levels)
        elif signal_type == 'cvd_divergence':
            signal = signal_cvd_divergence(candles, i, all_levels,
                                           lookback=signal_params.get('lookback', 20))
        elif signal_type == 'dtb_confirm':
            signal = signal_dtb_confirm(dtb_patterns, i, candles,
                                        lookback=signal_params.get('lookback', 50),
                                        min_confidence=signal_params.get('min_confidence', 50))

        if signal is None or not signal.get('triggered'):
            continue

        direction = signal['direction']

        # 2b. Filtro de direccion
        if not filter_direction(direction, allowed_direction):
            continue

        # 2c. Confluencia
        if confluence_mode == 'score' and min_confluence > 0:
            score = compute_confluence_score(all_levels, i, signal['entry_price'])
            if score < min_confluence:
                continue

        # 2d. Max trades por segmento (usar source del nivel para agrupar)
        seg_key = signal.get('level_source', 'global')
        # Para VP, usar el segmento como key
        if 'vp_' in seg_key:
            # Buscar el nivel que disparo la senal y obtener su seg_start_idx
            for lv in all_levels:
                if (lv.source == signal['level_source'] and
                    abs(lv.price - signal['level_price']) < 0.01 and
                    lv.valid_from_idx <= i):
                    seg_key = f"seg_{lv.extra.get('seg_start_idx', 0)}"
                    break

        trade_key = (seg_key, direction)
        count_for_key = sum(1 for t in trades if
                           t.get('_seg_key') == seg_key and t['direction'] == direction)
        if count_for_key >= max_trades_per_seg:
            continue

        # 2e. Aplicar filtros de contexto (AND)
        all_filters_pass = True
        for f in context_filters:
            if not f.get('enabled', False):
                continue

            ft = f.get('filter_type', '')
            fp = f.get('params', {})

            if ft == 'vwap_trend':
                if not filter_vwap_trend(vwap_data, i, direction,
                                         lookback=fp.get('lookback', 10)):
                    all_filters_pass = False
                    break
            elif ft == 'vwap_position':
                if not filter_vwap_position(candles, vwap_data, i, direction,
                                            reference=fp.get('reference', 'vwap')):
                    all_filters_pass = False
                    break
            elif ft == 'ttm_squeeze':
                if not filter_ttm_squeeze(vwap_data, i,
                                          require_squeeze=fp.get('require_squeeze', True)):
                    all_filters_pass = False
                    break
            elif ft == 'bbwp_range':
                if not filter_bbwp_range(vwap_data, i,
                                         min_val=fp.get('min', 0),
                                         max_val=fp.get('max', 100)):
                    all_filters_pass = False
                    break
            elif ft == 'volume_zscore':
                if not filter_volume_zscore(candles, i,
                                            min_zscore=fp.get('min_zscore', 1.5),
                                            lookback=fp.get('lookback', 20)):
                    all_filters_pass = False
                    break
            elif ft == 'cvd_trend':
                if not filter_cvd_trend(candles, i, direction,
                                        lookback=fp.get('lookback', 20)):
                    all_filters_pass = False
                    break
            elif ft == 'dtb_bias':
                if not filter_dtb_bias(dtb_patterns, i, direction,
                                       lookback=fp.get('lookback', 50),
                                       min_confidence=fp.get('min_confidence', 50)):
                    all_filters_pass = False
                    break

        if not all_filters_pass:
            continue

        # 2f. Calcular SL
        entry_price = signal['entry_price']
        level_price = signal['level_price']

        sl_price = compute_sl(candles, i, entry_price, direction, level_price,
                              all_levels, risk_cfg, signal)
        if sl_price is None:
            continue

        # Verificar que SL tiene sentido
        if direction == 'LONG' and sl_price >= entry_price:
            continue
        if direction == 'SHORT' and sl_price <= entry_price:
            continue

        # 2g. Calcular TP
        tp_price = compute_tp(candles, i, entry_price, sl_price, direction,
                              all_levels, risk_cfg)
        if tp_price is None:
            continue

        # 2h. Resolver trade (con exit rules)
        active_exit_rules = [r for r in exit_rules if r.get('enabled', False)]

        if active_exit_rules:
            result, pnl_r, close_ts, bars = resolve_trade_with_exit_rules(
                candles, i, entry_price, sl_price, tp_price, direction,
                vwap_data, active_exit_rules, level_price)
        else:
            result, pnl_r, close_ts, bars = resolve_trade_with_exit_rules(
                candles, i, entry_price, sl_price, tp_price, direction,
                vwap_data, [], level_price)

        if result == 'SKIP':
            continue

        # DEBUG: Imprimir detalles de cada trade para diagnosticar
        from datetime import datetime, timezone
        _entry_dt = datetime.fromtimestamp(candles[i]['timestamp']/1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M')
        _close_dt = datetime.fromtimestamp(close_ts/1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M') if close_ts else 'OPEN'
        print(f"[SB_TRADE] #{len(trades)+1} {direction} entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} "
              f"result={result} pnl_r={pnl_r} bars={bars} "
              f"entry_time={_entry_dt} close_time={_close_dt} "
              f"level={level_price:.2f} src={signal.get('level_source','')}")

        trades.append({
            'entry_idx': i, 'entry_ts': candles[i]['timestamp'],
            'entry_price': entry_price, 'direction': direction,
            'sl': sl_price, 'tp': tp_price,
            'level_price': level_price, 'level_source': signal.get('level_source', ''),
            'signal_type': signal_type,
            'result': result, 'pnl_r': pnl_r,
            'close_ts': close_ts, 'bars_held': bars,
            '_seg_key': seg_key,
        })

    # --- PASO 3: Metricas ---
    _progress('metrics', 92, f'Calculando metricas ({len(trades)} trades)...')
    metrics = calculate_metrics(trades)

    # --- PASO 4: Convertir a zonas para visualizacion ---
    _progress('zones', 95, 'Construyendo zonas para chart...')
    zones = []
    for idx_t, trade in enumerate(trades):
        if trade['result'] == 'SKIP':
            continue

        entry_ts = trade['entry_ts']
        # Zona visual: extender un poco antes del entry
        zone_start_ts = entry_ts - 60000 * 10  # 10 velas atras (aproximado)

        zone = {
            'timeline_index': idx_t + 1,
            'start_timestamp': zone_start_ts,
            'end_timestamp': entry_ts,
            'min_price': min(trade['sl'], trade['tp'], trade['entry_price']),
            'max_price': max(trade['sl'], trade['tp'], trade['entry_price']),
            'entry_price': trade['entry_price'],
            'sl_price': trade['sl'],
            'tp_price': trade['tp'],
            'entry_timestamp': entry_ts,
            'trade_result': trade['result'],
            'trade_close_timestamp': trade.get('close_ts'),
            'trade_pnl_r': trade.get('pnl_r', 0),
            'direction': trade['direction'],
            'level_price': trade.get('level_price'),
            'level_source': trade.get('level_source', ''),
            'signal_type': trade.get('signal_type', ''),
            'bars_held': trade.get('bars_held', 0),
            '_source': 'strategy',
        }
        zones.append(zone)

    elapsed = time.time() - t0
    _progress('done', 100, f'Completado: {len(zones)} trades en {elapsed:.1f}s')

    return {
        'success': True,
        'trades': trades,
        'zones': zones,
        'metrics': metrics,
        'candles_count': len(candles),
        'levels_count': len(all_levels),
        'elapsed_seconds': round(elapsed, 2),
    }


# ===========================================================================
# Optimizador Grid Search
# ===========================================================================

def _generate_range_values(rng: Dict) -> List:
    """Genera valores para un rango de optimizacion."""
    min_val = rng['min']
    max_val = rng['max']
    step = rng['step']
    values = []
    current = min_val
    while current <= max_val + step * 0.01:
        values.append(round(current, 6))
        current += step
    # Limitar a 20 valores
    if len(values) > 20:
        indices = [int(i * (len(values) - 1) / 19) for i in range(20)]
        values = [values[i] for i in indices]
    return values


def _apply_param_to_config(config: Dict, param_path: str, value) -> Dict:
    """Aplica un valor de parametro a la configuracion.
    param_path formato: 'block.source.param' ej: 'level.vp_periodic.period'"""
    import copy
    cfg = copy.deepcopy(config)

    parts = param_path.split('.')

    if parts[0] == 'level':
        # Buscar la fuente de nivel y cambiar el parametro
        source_name = parts[1]
        param_name = parts[2]
        for src in cfg.get('level_sources', []):
            if src.get('source') == source_name:
                src.setdefault('params', {})[param_name] = value

    elif parts[0] == 'entry':
        param_name = parts[1]
        cfg.setdefault('entry_signal', {}).setdefault('params', {})[param_name] = value

    elif parts[0] == 'filter':
        filter_type = parts[1]
        param_name = parts[2]
        for f in cfg.get('context_filters', []):
            if f.get('filter_type') == filter_type:
                f.setdefault('params', {})[param_name] = value

    elif parts[0] == 'risk':
        param_name = parts[1]
        if param_name == 'rr':
            cfg.setdefault('risk', {}).setdefault('tp_params', {})['rr'] = value
        elif param_name == 'buffer_pct':
            cfg.setdefault('risk', {}).setdefault('sl_params', {})['buffer_pct'] = value
        elif param_name == 'atr_multiplier':
            cfg.setdefault('risk', {}).setdefault('sl_params', {})['atr_multiplier'] = value
        else:
            cfg.setdefault('risk', {})[param_name] = value

    elif parts[0] == 'vwap_period':
        cfg['vwap_period'] = int(value)

    return cfg


def estimate_modular_optimization(candles: List[Dict], config: Dict,
                                  param_ranges: Dict) -> Dict:
    """Ejecuta 2 combos de prueba y extrapola el tiempo total."""
    import itertools

    all_values = {}
    for param_path, rng in param_ranges.items():
        all_values[param_path] = _generate_range_values(rng)

    keys = list(all_values.keys())
    value_lists = [all_values[k] for k in keys]
    total_combos = 1
    for vl in value_lists:
        total_combos *= len(vl)

    if total_combos > 5000:
        return {
            'success': False,
            'error': f'Demasiadas combinaciones: {total_combos}. Maximo 5000.',
            'total_combos': total_combos,
        }

    # Ejecutar 2 combos de prueba
    all_combos = list(itertools.product(*value_lists))
    sample_combos = [all_combos[0], all_combos[-1]] if len(all_combos) >= 2 else all_combos[:1]

    times = []
    for combo in sample_combos:
        combo_dict = dict(zip(keys, combo))
        test_config = config.copy()
        for param_path, value in combo_dict.items():
            test_config = _apply_param_to_config(test_config, param_path, value)

        t0 = time.time()
        run_modular_backtest(candles, test_config)
        times.append(time.time() - t0)

    avg_per_combo = sum(times) / len(times)
    estimated_seconds = avg_per_combo * total_combos

    return {
        'success': True,
        'total_combos': total_combos,
        'candles': len(candles),
        'avg_per_combo': round(avg_per_combo, 3),
        'estimated_seconds': round(estimated_seconds, 1),
        'sample_combos_run': len(sample_combos),
    }


def run_modular_optimization(candles: List[Dict], config: Dict,
                             param_ranges: Dict, metric: str = 'expectancy',
                             top_n: int = 15) -> Dict:
    """Grid search completo. DEBE ejecutarse en thread pool."""
    import itertools

    all_values = {}
    for param_path, rng in param_ranges.items():
        all_values[param_path] = _generate_range_values(rng)

    keys = list(all_values.keys())
    value_lists = [all_values[k] for k in keys]
    all_combos = list(itertools.product(*value_lists))

    if len(all_combos) > 5000:
        return {
            'success': False,
            'error': f'Demasiadas combinaciones: {len(all_combos)}. Maximo 5000.',
        }

    t0 = time.time()
    results = []

    for i, combo in enumerate(all_combos):
        combo_dict = dict(zip(keys, combo))
        test_config = config.copy()
        for param_path, value in combo_dict.items():
            test_config = _apply_param_to_config(test_config, param_path, value)

        result = run_modular_backtest(candles, test_config)

        if result.get('success'):
            m = result['metrics']
            results.append({
                'params': combo_dict,
                'total_zones': m.get('total_trades', 0),
                'wins': m.get('wins', 0),
                'losses': m.get('losses', 0),
                'total_closed': m.get('closed', 0),
                'win_rate': m.get('win_rate', 0),
                'total_pnl_r': m.get('total_pnl_r', 0),
                'expectancy': m.get('expectancy', 0),
                'profit_factor': m.get('profit_factor', 0),
                'max_drawdown_r': m.get('max_drawdown_r', 0),
            })

        if (i + 1) % 10 == 0:
            logger.info(f"[OPTIMIZE] Progreso: {i+1}/{len(all_combos)}")

    # Ordenar por metrica
    reverse = True
    if metric == 'max_drawdown_r':
        reverse = False  # Menor drawdown es mejor

    results.sort(key=lambda r: r.get(metric, 0), reverse=reverse)

    elapsed = time.time() - t0

    return {
        'success': True,
        'total_combos': len(all_combos),
        'elapsed': round(elapsed, 2),
        'candles': len(candles),
        'metric': metric,
        'results': results[:top_n],
        'all_results_count': len(results),
    }
