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
from zone_vp_scanner import (
    scan_zones as vp_scan_zones,
    scan_zones_progressive as vp_scan_zones_progressive,
    classify_shape,
    VPScannerConfig,
    load_zone_cache,
    save_zone_cache,
)
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

def compute_vp_levels(candles: List[Dict], period: int = 240, bins: int = 50,
                      use_poc: bool = True, use_vah: bool = True,
                      use_val: bool = True,
                      lookback_segments: int = 1) -> List[Level]:
    """Calcula niveles POC/VAH/VAL por segmento VP Periodic.
    Cada segmento genera hasta 3 niveles (activos solo DESPUES de que el segmento cierra).
    El usuario puede elegir cuales niveles incluir via use_poc/use_vah/use_val.
    lookback_segments: cuantos segmentos futuros mantiene activos los niveles.
      1 = solo el periodo inmediatamente siguiente (default).
      2 = el nivel se mantiene activo durante 2 periodos futuros, etc.
      0 = el nivel permanece activo para siempre (hasta el final de los datos)."""
    segments = get_vp_segments(candles, period, bins)
    levels = []
    lookback_segments = max(0, int(lookback_segments))

    for idx_seg, seg in enumerate(segments):
        prof = seg['profile']
        end_idx = seg['end_idx']

        # Determinar hasta cuando es valido
        # valid_until_idx usa comparacion <= idx para saltar, asi que el nivel
        # deja de ser valido EN ese indice. Usamos end_idx + 1 del segmento
        # futuro para que el nivel expire cuando el nuevo segmento empiece
        # a generar sus propios niveles.
        if lookback_segments == 0:
            next_end = None
        else:
            future_idx = idx_seg + lookback_segments
            if future_idx < len(segments):
                next_end = segments[future_idx]['end_idx'] + 1
            else:
                next_end = None

        poc = prof['poc_price']
        vah = prof['vah_price']
        val_ = prof['val_price']

        # Clasificar forma del perfil (D, P, b, thin)
        # Adaptar formato de profile al que espera classify_shape
        prof_levels = prof.get('levels', [])
        poc_idx = 0
        if prof_levels:
            poc_idx = max(range(len(prof_levels)),
                         key=lambda j: prof_levels[j]['volume'])
        shape_data = classify_shape({
            'levels': prof_levels,
            'poc': {'index': poc_idx, 'price': poc},
            'total_volume': prof.get('total_volume', 0),
            'min_price': prof.get('min_price', val_),
            'max_price': prof.get('max_price', vah),
            'vah_price': vah,
            'val_price': val_,
        })
        shape_type = shape_data.get('shape_type', 'thin')
        d_score = shape_data.get('d_score', 0)

        seg_extra_base = {
            'seg_start_idx': seg['start_idx'],
            'shape_type': shape_type,
            'd_score': d_score,
        }

        # POC: emitir como soporte Y resistencia (es nivel dual, depende de
        # donde venga el precio). La senal de entrada filtra la direccion correcta.
        # CRITICO: Los niveles son validos DESPUES de que el segmento cierra,
        # es decir, a partir de la primera vela del siguiente segmento (end_idx + 1).
        # Usar end_idx permitiria que niveles del segmento actual se usen
        # en la ultima vela de ese mismo segmento (antes de confirmarse).
        valid_start = end_idx + 1

        if use_poc:
            levels.append(Level(
                price=poc, level_type='support', source='vp_poc',
                strength=70, valid_from_idx=valid_start, valid_until_idx=next_end,
                extra={**seg_extra_base, 'vah': vah, 'val': val_}
            ))
            levels.append(Level(
                price=poc, level_type='resistance', source='vp_poc',
                strength=70, valid_from_idx=valid_start, valid_until_idx=next_end,
                extra={**seg_extra_base, 'vah': vah, 'val': val_}
            ))

        # VAH siempre como resistencia
        if use_vah:
            levels.append(Level(
                price=vah, level_type='resistance', source='vp_vah',
                strength=60, valid_from_idx=valid_start, valid_until_idx=next_end,
                extra={**seg_extra_base, 'poc': poc, 'val': val_}
            ))

        # VAL siempre como soporte
        if use_val:
            levels.append(Level(
                price=val_, level_type='support', source='vp_val',
                strength=60, valid_from_idx=valid_start, valid_until_idx=next_end,
                extra={**seg_extra_base, 'poc': poc, 'vah': vah}
            ))

    return levels


def compute_vp_zone_levels(candles: List[Dict], params: Dict,
                           progress_callback=None,
                           symbol: str = '', interval: str = '',
                           days: int = 0) -> Tuple[List[Level], List[Dict]]:
    """Calcula niveles POC/VAH/VAL usando el VP Zone Scanner (deteccion de perfiles D/P/b).

    A diferencia de compute_vp_levels que usa segmentos periodicos fijos,
    esta funcion detecta zonas de consolidacion reales y las clasifica
    por forma (D, P, b, thin). Es mas pesada pero mas precisa.

    Intenta cargar zonas desde el cache de disco (zones_cache/) si hay match
    de fingerprint. Si no hay cache, escanea normalmente y guarda el resultado.

    Params:
        candles: lista de velas OHLCV
        params: dict con configuracion del scanner
        progress_callback: fn(phase, pct, msg) para reportar progreso
        symbol: simbolo (para cache lookup)
        interval: timeframe (para cache lookup)
        days: dias de datos (para cache lookup)

    Returns:
        (levels, zone_details) donde zone_details contiene info de cada zona
        incluyendo shape_type para filtrado posterior.
    """
    _progress = progress_callback or (lambda *_: None)

    detection_mode = params.get('detection_mode', 'fixed_window')
    zones = None
    from_cache = False

    # --- Intentar cargar desde cache ---
    if symbol and interval and days:
        _progress('vp_zones', 8, 'Buscando zonas en cache...')
        cache_hit = load_zone_cache(params, symbol, interval, days, candles_count=len(candles))
        if cache_hit:
            zones = cache_hit.get('zones', [])
            from_cache = True
            print(f"[SB_VP_ZONES] CACHE HIT: {len(zones)} zonas desde disco")
            _progress('vp_zones', 12, f'Cache: {len(zones)} zonas cargadas')

    # --- Si no hay cache, escanear ---
    if zones is None:
        # Construir VPScannerConfig desde params
        cfg = VPScannerConfig()
        cfg.window_size = params.get('window_size', 30)
        cfg.window_step = params.get('window_step', 5)
        cfg.bins = params.get('bins', 50)
        cfg.va_percent = params.get('va_percent', 0.70)
        cfg.min_d_score = params.get('min_d_score', 40)
        cfg.include_pb_shapes = params.get('include_pb_shapes', True)
        cfg.max_range_pct = params.get('max_range_pct', 2.0)
        cfg.min_zone_candles = params.get('min_zone_candles', 10)
        cfg.merge_gap = params.get('merge_gap', 3)
        # Deteccion progresiva
        cfg.prog_min_candles = params.get('prog_min_candles', 15)
        cfg.prog_range_pct = params.get('prog_range_pct', 2.0)
        cfg.prog_stop_mode = params.get('prog_stop_mode', 'breakout')
        cfg.prog_degrade_bars = params.get('prog_degrade_bars', 5)
        cfg.prog_close_outside_bars = params.get('prog_close_outside_bars', 3)
        cfg.prog_close_reference = params.get('prog_close_reference', 'zone')
        cfg.prog_thickness_metric = params.get('prog_thickness_metric', 'va_pct')
        # No simular trades (eso lo hace el strategy engine)
        cfg.lookforward_bars = 0

        _progress('vp_zones', 12, f'Escaneando VP Zones ({detection_mode})...')

        if detection_mode == 'progressive':
            zones = vp_scan_zones_progressive(candles, cfg)
        else:
            zones = vp_scan_zones(candles, cfg)

        print(f"[SB_VP_ZONES] Detectadas {len(zones)} zonas via {detection_mode}")

        # Guardar en cache para futuro
        if symbol and interval and days:
            try:
                save_zone_cache(zones, params, symbol, interval, days, len(candles))
                print(f"[SB_VP_ZONES] Zonas guardadas en cache")
            except Exception as e:
                print(f"[SB_VP_ZONES] Error guardando cache: {e}")

    use_poc = params.get('use_poc', True)
    use_vah = params.get('use_vah', True)
    use_val = params.get('use_val', True)

    levels = []
    zone_details = []

    for zone in zones:
        # Indice de vela donde la zona fue detectada (fin de la zona)
        end_idx = zone.get('detection_candle_idx', zone.get('window_end', 0))
        start_idx = zone.get('window_start', 0)

        # Info de VP
        vp = zone.get('vp_summary', zone.get('volume_profile', {}))
        poc = vp.get('poc_price', zone.get('poc_price', 0))
        vah = vp.get('vah_price', 0)
        val_ = vp.get('val_price', 0)

        # Info de shape
        shape_info = zone.get('shape_metrics', {})
        shape_type = shape_info.get('shape_type', zone.get('shape_type', 'D'))
        d_score = shape_info.get('d_score', zone.get('d_score', 0))

        if poc == 0 and vah == 0:
            continue

        # valid_from: solo despues de que la zona este completa (+1 para que
        # no se use en la ultima vela de la zona, sino a partir de la siguiente)
        valid_from = end_idx + 1
        # valid_until: None = activo para siempre (el strategy engine filtra por precio)
        valid_until = None

        current_price = candles[min(end_idx, len(candles) - 1)]['close']

        extra_common = {
            'shape_type': shape_type,
            'd_score': d_score,
            'zone_start_idx': start_idx,
            'zone_end_idx': end_idx,
            'zone_min': zone.get('min_price', val_),
            'zone_max': zone.get('max_price', vah),
        }

        if use_poc and poc > 0:
            poc_type = 'support' if current_price > poc else 'resistance'
            levels.append(Level(
                price=poc, level_type=poc_type, source='vpz_poc',
                strength=min(100, d_score + 10),
                valid_from_idx=valid_from, valid_until_idx=valid_until,
                extra={**extra_common, 'vah': vah, 'val': val_}
            ))

        if use_vah and vah > 0:
            levels.append(Level(
                price=vah, level_type='resistance', source='vpz_vah',
                strength=min(100, d_score),
                valid_from_idx=valid_from, valid_until_idx=valid_until,
                extra={**extra_common, 'poc': poc, 'val': val_}
            ))

        if use_val and val_ > 0:
            levels.append(Level(
                price=val_, level_type='support', source='vpz_val',
                strength=min(100, d_score),
                valid_from_idx=valid_from, valid_until_idx=valid_until,
                extra={**extra_common, 'poc': poc, 'vah': vah}
            ))

        zone_details.append({
            'start_idx': start_idx,
            'end_idx': end_idx,
            'shape_type': shape_type,
            'd_score': d_score,
            'poc': poc,
            'vah': vah,
            'val': val_,
        })

    print(f"[SB_VP_ZONES] Generados {len(levels)} niveles de {len(zone_details)} zonas")
    return levels, zone_details


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
        # ANTI LOOK-AHEAD: solo usar velas HASTA i (el pasado conocido)
        # La primera ventana necesita al menos swing_bars*2+1 velas
        window_candles = candles[:i] if i > 0 else candles[:window_end]

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

        # Niveles validos DESDE i (cuando ya se procesaron las velas del window)
        # hasta el proximo recalculo
        valid_from = i if i > 0 else window_end
        valid_until = min(i + recalc_every, len(candles))

        for r in result.get('resistances', []):
            if r.get('status') == 'active':
                levels.append(Level(
                    price=r['price'], level_type='resistance', source='sr_v2',
                    strength=r.get('strength', 50), valid_from_idx=valid_from,
                    valid_until_idx=valid_until,
                    extra={'touches': r.get('touches', 0)}
                ))

        for s in result.get('supports', []):
            if s.get('status') == 'active':
                levels.append(Level(
                    price=s['price'], level_type='support', source='sr_v2',
                    strength=s.get('strength', 50), valid_from_idx=valid_from,
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


# ---------------------------------------------------------------------------
# Gaussian Channel (Ehlers Gaussian Filter)
# ---------------------------------------------------------------------------

def _gaussian_filt9x(alpha: float, source: List[float], poles: int) -> List[float]:
    """Implementacion Python del filtro gaussiano multi-polo de Ehlers.
    Traduccion directa del Pine Script f_filt9x / f_pole.
    Usa coeficientes binomiales (triangulo de Pascal) hasta 9 polos."""

    n = len(source)
    if n == 0:
        return []

    # Coeficientes binomiales C(poles, k) para k=2..9
    # Precalculados del triangulo de Pascal (igual que el Pine Script original)
    binom = {
        2: {2: 1},
        3: {2: 3, 3: 1},
        4: {2: 6, 3: 4, 4: 1},
        5: {2: 10, 3: 10, 4: 5, 5: 1},
        6: {2: 15, 3: 20, 4: 15, 5: 6, 6: 1},
        7: {2: 21, 3: 35, 4: 35, 5: 21, 6: 7, 7: 1},
        8: {2: 28, 3: 56, 4: 70, 5: 56, 6: 28, 7: 8, 8: 1},
        9: {2: 36, 3: 84, 4: 126, 5: 126, 6: 84, 7: 36, 8: 9, 9: 1},
    }

    x = 1.0 - alpha  # (1 - alpha) elevado a potencias
    ap = alpha ** poles  # alpha^poles

    # Obtener coeficientes para este numero de polos
    coeffs = binom.get(poles, {})

    filt = [0.0] * n
    filt[0] = source[0]

    for i in range(1, n):
        val = ap * source[i]

        # Termino 1: poles * (1-alpha)^1 * filt[i-1]
        val += poles * x * filt[i - 1]

        # Terminos 2..poles: coeficientes binomiales con signos alternados
        for k in range(2, poles + 1):
            if i < k:
                break
            m = coeffs.get(k, 0)
            if m == 0:
                continue
            sign = -1.0 if k % 2 == 0 else 1.0
            val += sign * m * (x ** k) * filt[i - k]

        filt[i] = val

    return filt


def compute_gaussian_channel(candles: List[Dict],
                             poles: int = 4,
                             period: int = 144,
                             multiplier: float = 1.414,
                             reduced_lag: bool = False,
                             fast_response: bool = False,
                             source_type: str = 'hlc3') -> Dict:
    """Calcula Gaussian Channel completo para una lista de velas.

    Retorna dict con arrays paralelos a candles:
      filt[]: linea central (filtro gaussiano)
      hband[]: banda superior
      lband[]: banda inferior
    """
    n = len(candles)
    if n < 2:
        return {'filt': [], 'hband': [], 'lband': []}

    # 1. Source data
    src = []
    for c in candles:
        h, l, cl = c['high'], c['low'], c['close']
        if source_type == 'hlc3':
            src.append((h + l + cl) / 3.0)
        elif source_type == 'close':
            src.append(cl)
        elif source_type == 'hl2':
            src.append((h + l) / 2.0)
        elif source_type == 'ohlc4':
            src.append((c['open'] + h + l + cl) / 4.0)
        else:
            src.append((h + l + cl) / 3.0)

    # 2. True Range
    tr = [0.0] * n
    tr[0] = candles[0]['high'] - candles[0]['low']
    for i in range(1, n):
        h = candles[i]['high']
        l = candles[i]['low']
        pc = candles[i - 1]['close']
        tr[i] = max(h - l, abs(h - pc), abs(l - pc))

    # 3. Beta y Alpha
    beta = (1.0 - math.cos(4.0 * math.asin(1.0) / period)) / (1.414 ** (2.0 / poles) - 1.0)
    alpha = -beta + math.sqrt(beta * beta + 2.0 * beta)

    # 4. Lag reduction (truncation adjustment)
    if reduced_lag:
        lag = int((period - 1) / (2 * poles))
        src_data = [0.0] * n
        tr_data = [0.0] * n
        for i in range(n):
            prev_i = max(0, i - lag)
            src_data[i] = src[i] + (src[i] - src[prev_i])
            tr_data[i] = tr[i] + (tr[i] - tr[prev_i])
    else:
        src_data = src
        tr_data = tr

    # 5. Aplicar filtro N-polo
    filtn = _gaussian_filt9x(alpha, src_data, poles)
    filtn_tr = _gaussian_filt9x(alpha, tr_data, poles)

    # 6. Fast response: promediar N-polo con 1-polo
    if fast_response:
        filt1 = _gaussian_filt9x(alpha, src_data, 1)
        filt1_tr = _gaussian_filt9x(alpha, tr_data, 1)
        filt = [(filtn[i] + filt1[i]) / 2.0 for i in range(n)]
        filt_tr = [(filtn_tr[i] + filt1_tr[i]) / 2.0 for i in range(n)]
    else:
        filt = filtn
        filt_tr = filtn_tr

    # 7. Bandas
    hband = [filt[i] + filt_tr[i] * multiplier for i in range(n)]
    lband = [filt[i] - filt_tr[i] * multiplier for i in range(n)]

    return {
        'filt': filt,
        'hband': hband,
        'lband': lband,
    }


def _serialize_gc_channel(gc_data: Dict, candles: List[Dict]) -> Dict:
    """Serializa los arrays del Gaussian Channel para enviarlos al frontend.
    Devuelve timestamps + arrays filt/hband/lband listos para renderizar."""
    filt = gc_data.get('filt', [])
    hband = gc_data.get('hband', [])
    lband = gc_data.get('lband', [])
    n = min(len(filt), len(hband), len(lband), len(candles))
    if n == 0:
        return None
    # Solo enviar puntos con datos validos (no NaN/0 del warmup)
    points = []
    for i in range(n):
        if filt[i] == 0 and hband[i] == 0 and lband[i] == 0:
            continue
        points.append({
            'ts': candles[i]['timestamp'],
            'f': round(filt[i], 2),
            'h': round(hband[i], 2),
            'l': round(lband[i], 2),
        })
    return {'points': points} if points else None


def compute_gaussian_channel_levels(candles: List[Dict], params: Dict) -> Tuple[List[Level], Dict]:
    """Level source: Gaussian Channel.
    Produce 3 niveles DINAMICOS por vela (upper, lower, center).
    Retorna (levels, gc_data) donde gc_data contiene los arrays filt/hband/lband."""

    gc_data = compute_gaussian_channel(
        candles,
        poles=params.get('poles', 4),
        period=params.get('period', 144),
        multiplier=params.get('multiplier', 1.414),
        reduced_lag=params.get('reduced_lag', False),
        fast_response=params.get('fast_response', False),
        source_type=params.get('source_type', 'hlc3'),
    )

    levels = []
    n = len(candles)

    # Warmup: necesitamos al menos period velas para que el filtro estabilice
    warmup = max(params.get('period', 144), 20)

    for i in range(warmup, n):
        hb = gc_data['hband'][i]
        lb = gc_data['lband'][i]
        fc = gc_data['filt'][i]

        # Upper band = resistencia (precio debe cruzar arriba para LONG)
        levels.append(Level(
            price=hb, level_type='resistance', source='gc_upper',
            strength=60, valid_from_idx=i, valid_until_idx=i + 1,
            extra={'gc_filt': fc, 'gc_lower': lb}
        ))

        # Lower band = soporte (precio debe cruzar abajo para SHORT)
        levels.append(Level(
            price=lb, level_type='support', source='gc_lower',
            strength=60, valid_from_idx=i, valid_until_idx=i + 1,
            extra={'gc_filt': fc, 'gc_upper': hb}
        ))

        # Center (filtro) = soporte Y resistencia dual
        levels.append(Level(
            price=fc, level_type='support', source='gc_center',
            strength=50, valid_from_idx=i, valid_until_idx=i + 1,
            extra={'gc_upper': hb, 'gc_lower': lb}
        ))
        levels.append(Level(
            price=fc, level_type='resistance', source='gc_center',
            strength=50, valid_from_idx=i, valid_until_idx=i + 1,
            extra={'gc_upper': hb, 'gc_lower': lb}
        ))

    return levels, gc_data


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
    """Precio toca un nivel (simple).
    La tolerancia se aplica tanto para detectar el toque (low/high vs nivel)
    como para validar que el entry (close) no se aleje demasiado del nivel.
    El close no puede estar mas lejos de tolerance_pct del nivel."""
    curr = candles[idx]
    price = curr['close']

    # Margen maximo para el precio de entrada (close) respecto al nivel.
    # Usa 1x la tolerancia: si tolerance_pct = 0.15%, el close puede estar
    # hasta 0.15% del nivel. Esto garantiza entries cercanos al nivel.
    entry_margin_mult = 1.0

    # Buscar en soportes (LONG) y resistencias (SHORT)
    for lv in levels:
        if lv.valid_from_idx > idx:
            continue
        if lv.valid_until_idx is not None and lv.valid_until_idx <= idx:
            continue

        tol = lv.price * tolerance_pct / 100.0
        entry_max_dist = lv.price * tolerance_pct * entry_margin_mult / 100.0

        if lv.level_type == 'support':
            # LONG: low toca nivel (con tolerancia) Y close por encima Y close no muy lejos
            if (curr['low'] <= lv.price + tol
                    and curr['close'] > lv.price
                    and curr['close'] - lv.price <= entry_max_dist):
                return {
                    'triggered': True, 'direction': 'LONG',
                    'level_price': lv.price, 'level_source': lv.source,
                    'entry_price': curr['close'], 'confidence': lv.strength,
                }
        elif lv.level_type == 'resistance':
            # SHORT: high toca nivel (con tolerancia) Y close por debajo Y close no muy lejos
            if (curr['high'] >= lv.price - tol
                    and curr['close'] < lv.price
                    and lv.price - curr['close'] <= entry_max_dist):
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


def signal_band_crossover(candles: List[Dict], idx: int,
                          gc_data: Optional[Dict],
                          tolerance_pct: float = 0.05) -> Optional[Dict]:
    """Senal de entrada por crossover/crossunder de bandas del Gaussian Channel.

    LONG:  close cruza ARRIBA de hband (crossover)
    SHORT: close cruza ABAJO de lband (crossunder)

    Opcionalmente se puede usar tolerance_pct para detectar toques cercanos
    a la banda sin requerir cruce exacto.
    """
    if gc_data is None or idx < 2:
        return None

    hband = gc_data.get('hband')
    lband = gc_data.get('lband')
    filt = gc_data.get('filt')
    if hband is None or lband is None or filt is None:
        return None
    if idx >= len(hband) or idx >= len(candles):
        return None

    curr = candles[idx]
    prev = candles[idx - 1]
    close_now = curr['close']
    close_prev = prev['close']
    hb_now = hband[idx]
    hb_prev = hband[idx - 1]
    lb_now = lband[idx]
    lb_prev = lband[idx - 1]

    # Tolerancia en precio absoluto (basada en hband)
    tol = hb_now * tolerance_pct / 100.0

    # Crossover de hband: prev estaba debajo/cerca, ahora esta arriba
    if close_prev <= hb_prev + tol and close_now > hb_now - tol and close_now >= hb_now:
        return {
            'triggered': True,
            'direction': 'LONG',
            'level_price': hb_now,
            'level_source': 'gc_upper',
            'entry_price': close_now,
            'gc_filt': filt[idx],
        }

    # Crossunder de lband: prev estaba arriba/cerca, ahora esta abajo
    if close_prev >= lb_prev - tol and close_now < lb_now + tol and close_now <= lb_now:
        return {
            'triggered': True,
            'direction': 'SHORT',
            'level_price': lb_now,
            'level_source': 'gc_lower',
            'entry_price': close_now,
            'gc_filt': filt[idx],
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
    'band_crossover': signal_band_crossover,
}


# ===========================================================================
# BLOQUE 3: Filtros de Contexto
# ===========================================================================

def filter_vwap_trend(vwap_data: List[Dict], idx: int, direction: str,
                      lookback: int = 10, min_diff_pct: float = 0) -> bool:
    """VWAP subiendo = solo LONG, bajando = solo SHORT.
    Si min_diff_pct > 0, descarta cuando la diferencia % entre VWAP actual
    y VWAP hace `lookback` velas es menor al umbral (precio estancado)."""
    if idx < lookback or idx >= len(vwap_data):
        return True  # No hay suficientes datos, no filtrar

    vwap_now = vwap_data[idx]['vwap']
    vwap_prev = vwap_data[idx - lookback]['vwap']

    if vwap_prev == 0:
        return True

    diff_pct = abs(vwap_now - vwap_prev) / vwap_prev * 100
    if min_diff_pct > 0 and diff_pct < min_diff_pct:
        return False  # Precio estancado

    if direction == 'LONG':
        return vwap_now > vwap_prev
    elif direction == 'SHORT':
        return vwap_now < vwap_prev
    return True


def filter_vwap_position(candles: List[Dict], vwap_data: List[Dict],
                         idx: int, direction: str,
                         mode: str = 'trend',
                         long_ref: str = 'vwap',
                         short_ref: str = 'vwap',
                         reference: str = '') -> bool:
    """Filtra por posicion del precio respecto a VWAP/bandas.

    Modo 'trend' (a favor):
      LONG  -> precio ARRIBA de long_ref  (ej: arriba de upper_1)
      SHORT -> precio ABAJO de short_ref  (ej: abajo de lower_1)

    Modo 'counter' (contratendencia):
      LONG  -> precio ABAJO de long_ref   (ej: abajo de lower_2 = sobreventa)
      SHORT -> precio ARRIBA de short_ref  (ej: arriba de upper_2 = sobrecompra)
    """
    if idx >= len(vwap_data):
        return True

    # Retrocompatibilidad: si viene 'reference' antiguo, usarlo para ambos
    if reference and not long_ref and not short_ref:
        long_ref = reference
        short_ref = reference

    price = candles[idx]['close']
    vp = vwap_data[idx]

    if direction == 'LONG':
        ref_price = vp.get(long_ref, vp['vwap'])
        if mode == 'counter':
            return price < ref_price   # Contratendencia: precio debajo
        else:
            return price > ref_price   # Tendencia: precio arriba
    elif direction == 'SHORT':
        ref_price = vp.get(short_ref, vp['vwap'])
        if mode == 'counter':
            return price > ref_price   # Contratendencia: precio arriba
        else:
            return price < ref_price   # Tendencia: precio abajo
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


def filter_vp_shape(level: 'Level', allowed_shapes: List[str]) -> bool:
    """Filtra niveles por tipo de perfil VP (shape_type en extra).

    Solo aplica a niveles con source vpz_* o vp_*. Si el nivel no tiene
    shape_type en extra (por ejemplo, niveles de S&R o VWAP), pasa siempre.

    allowed_shapes: lista de shapes permitidos, ej: ['D'], ['D', 'P_trimmed'], ['all']
    """
    if not allowed_shapes or 'all' in allowed_shapes:
        return True

    source = level.source if hasattr(level, 'source') else ''
    if not source.startswith(('vp_', 'vpz_')):
        # No es nivel VP, no aplicar filtro
        return True

    shape = level.extra.get('shape_type', '') if hasattr(level, 'extra') else ''
    if not shape:
        return True  # Sin info de shape, dejar pasar

    return shape in allowed_shapes


def filter_gaussian_trend(gc_data: Optional[Dict], idx: int,
                          direction: str,
                          lookback: int = 1) -> bool:
    """Filtra por tendencia del Gaussian Channel.

    Si filt[idx] > filt[idx - lookback] → tendencia alcista → solo LONG
    Si filt[idx] < filt[idx - lookback] → tendencia bajista → solo SHORT

    lookback controla la sensibilidad: 1 = cada vela, 5 = pendiente de 5 velas.
    """
    if gc_data is None:
        return True  # Sin datos, no filtrar

    filt = gc_data.get('filt')
    if filt is None or idx < lookback or idx >= len(filt):
        return True

    filt_now = filt[idx]
    filt_prev = filt[idx - lookback]

    if filt_now > filt_prev:
        # Tendencia alcista: solo LONG
        return direction.upper() == 'LONG'
    elif filt_now < filt_prev:
        # Tendencia bajista: solo SHORT
        return direction.upper() == 'SHORT'
    else:
        # Plano: ambos permitidos
        return True


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
                     lookback: int = 50, swing_bars: int = 3) -> Optional[float]:
    """Encuentra el ultimo swing high/low confirmado antes del indice.

    Usa deteccion de pivots N-bar: un swing low es una vela cuyo low es
    menor que los lows de las N velas anteriores y N velas posteriores.
    Busca el pivot mas reciente dentro del lookback.
    Fallback: si no encuentra pivot, usa el min/max absoluto.
    """
    start = max(0, idx - lookback)
    n = swing_bars

    if direction == 'LONG':
        # Buscar swing lows (pivots bajos) de mas reciente a mas antiguo
        for i in range(idx - n - 1, start - 1, -1):
            if i < n:
                continue
            low_i = candles[i]['low']
            is_pivot = True
            for j in range(1, n + 1):
                if i - j < 0 or i + j >= len(candles) or i + j > idx:
                    is_pivot = False
                    break
                if candles[i - j]['low'] <= low_i or candles[i + j]['low'] <= low_i:
                    is_pivot = False
                    break
            if is_pivot:
                return low_i
        # Fallback: minimo absoluto del lookback
        min_low = float('inf')
        for i in range(start, idx):
            if candles[i]['low'] < min_low:
                min_low = candles[i]['low']
        return min_low if min_low < float('inf') else None

    else:
        # Buscar swing highs (pivots altos) de mas reciente a mas antiguo
        for i in range(idx - n - 1, start - 1, -1):
            if i < n:
                continue
            high_i = candles[i]['high']
            is_pivot = True
            for j in range(1, n + 1):
                if i - j < 0 or i + j >= len(candles) or i + j > idx:
                    is_pivot = False
                    break
                if candles[i - j]['high'] >= high_i or candles[i + j]['high'] >= high_i:
                    is_pivot = False
                    break
            if is_pivot:
                return high_i
        # Fallback: maximo absoluto del lookback
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
                         progress_callback=None,
                         symbol: str = '', interval: str = '',
                         days: int = 0) -> Dict:
    """Motor principal del Strategy Builder modular.

    Args:
        candles: Lista de velas OHLCV
        config: Diccionario con la configuracion de los 5 bloques
        progress_callback: Funcion opcional (phase, percent, message)
        symbol: Simbolo (para cache de VP Zones)
        interval: Timeframe (para cache de VP Zones)
        days: Dias de datos (para cache de VP Zones)

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
    diag_level_proximity_pct = config.get('diag_level_proximity_pct', 0.15)

    # --- PASO 1: Pre-calcular indicadores ---
    _progress('indicators', 5, 'Calculando indicadores...')

    # VWAP siempre se calcula (usado por filtros)
    vwap_data = compute_vwap_rolling(candles, period=vwap_period)

    # Niveles
    all_levels: List[Level] = []
    dtb_patterns: List[Dict] = []
    vp_profiles: List[Dict] = []  # Perfiles VP para visualizacion en chart
    gc_data: Optional[Dict] = None  # Gaussian Channel data (filt/hband/lband)

    for src in level_sources:
        if not src.get('enabled', False):
            continue

        source_name = src.get('source', '')
        params = src.get('params', {})

        if source_name == 'vp_periodic':
            _progress('indicators', 10, 'Calculando VP Periodic...')
            vp_period = params.get('period', 240)
            vp_bins = params.get('bins', 50)
            vp_levels = compute_vp_levels(
                candles,
                period=vp_period,
                bins=vp_bins,
                use_poc=params.get('use_poc', True),
                use_vah=params.get('use_vah', True),
                use_val=params.get('use_val', True),
                lookback_segments=params.get('lookback_segments', 1),
            )
            all_levels.extend(vp_levels)
            # Recolectar perfiles VP Periodic para visualizacion
            vp_segs = get_vp_segments(candles, vp_period, vp_bins)
            for seg in vp_segs:
                prof = seg['profile']
                vp_profiles.append({
                    'source': 'vp_periodic',
                    'start_ts': seg['start_ts'],
                    'end_ts': seg['end_ts'],
                    'start_idx': seg['start_idx'],
                    'end_idx': seg['end_idx'],
                    'poc': prof['poc_price'],
                    'vah': prof['vah_price'],
                    'val': prof['val_price'],
                })

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

        elif source_name == 'vp_zones':
            _progress('indicators', 12, 'Escaneando VP Zones (pesado)...')
            vpz_levels, vpz_details = compute_vp_zone_levels(
                candles, params, progress_callback,
                symbol=symbol, interval=interval, days=days,
            )
            all_levels.extend(vpz_levels)
            # Recolectar perfiles VP Zones para visualizacion
            for zd in vpz_details:
                si = zd.get('start_idx', 0)
                ei = zd.get('end_idx', 0)
                st = candles[si]['timestamp'] if si < len(candles) else 0
                et = candles[min(ei, len(candles) - 1)]['timestamp']
                vp_profiles.append({
                    'source': 'vp_zones',
                    'start_ts': st,
                    'end_ts': et,
                    'start_idx': si,
                    'end_idx': ei,
                    'poc': zd.get('poc', 0),
                    'vah': zd.get('vah', 0),
                    'val': zd.get('val', 0),
                    'shape_type': zd.get('shape_type', ''),
                    'd_score': zd.get('d_score', 0),
                })

        elif source_name == 'gaussian_channel':
            _progress('indicators', 28, 'Calculando Gaussian Channel...')
            gc_lvls, gc_data = compute_gaussian_channel_levels(candles, params)
            all_levels.extend(gc_lvls)

    if not all_levels:
        _progress('done', 100, '0 niveles activos - 0 trades')
        return {
            'success': True,
            'trades': [],
            'zones': [],
            'metrics': calculate_metrics([]),
            'candles_count': len(candles),
            'levels_count': 0,
            'elapsed_seconds': round(time.time() - t0, 2),
            'filter_stats': {
                'signals_generated': 0, 'filtered_direction': 0,
                'filtered_confluence': 0, 'filtered_max_trades_seg': 0,
                'filtered_cooldown': 0, 'filtered_context': {},
                'filtered_sl_invalid': 0, 'filtered_sl_direction': 0,
                'filtered_tp_invalid': 0, 'trades_opened': 0,
            },
            'vp_profiles': vp_profiles,
        }

    _progress('indicators', 35, f'{len(all_levels)} niveles calculados de {sum(1 for s in level_sources if s.get("enabled"))} fuentes')

    # --- PASO 2: Iterar vela por vela ---
    _progress('backtest', 40, 'Ejecutando backtest...')

    trades = []
    used_seg_dir: set = set()
    max_trades_per_seg = risk_cfg.get('max_trades_per_segment', 1)
    cooldown_bars = risk_cfg.get('cooldown_bars', 0)
    # Cooldown global: indice minimo para siguiente trade (cualquier direccion)
    cooldown_until_idx = 0

    # Contadores de filtrado para diagnostico
    filter_stats = {
        'signals_generated': 0,
        'filtered_direction': 0,
        'filtered_confluence': 0,
        'filtered_max_trades_seg': 0,
        'filtered_cooldown': 0,
        'filtered_context': {},  # por tipo de filtro
        'filtered_sl_invalid': 0,
        'filtered_tp_invalid': 0,
        'filtered_sl_direction': 0,
        'trades_opened': 0,
    }

    # Extraer configuracion de senal
    signal_type = entry_cfg.get('signal_type', 'price_touch')
    signal_params = entry_cfg.get('params', {})

    # Extraer filtro de direccion
    allowed_direction = 'both'
    for f in context_filters:
        if f.get('filter_type') == 'direction' and f.get('enabled'):
            allowed_direction = f.get('params', {}).get('allowed', 'both')

    report_interval = max(1, len(candles) // 20)  # Reportar progreso cada 5%

    # --- Diagnostics: semaforo por vela ---
    # Lista paralela a candles: cada entrada es dict de flags booleanos
    diagnostics = [None] * len(candles)
    # Determinar que filtros de contexto estan activos (para las capas del semaforo)
    active_ctx_filters = [f.get('filter_type') for f in context_filters
                          if f.get('enabled', False) and f.get('filter_type') != 'direction']

    for i in range(1, len(candles)):
        if i % report_interval == 0:
            pct = 40 + int(50 * i / len(candles))
            _progress('backtest', pct, f'Vela {i:,}/{len(candles):,}...')

        # Inicializar diagnostico de esta vela
        diag = {
            'has_level': False,
            'entry_signal': False,
            'direction_ok': False,
            'confluence_ok': False,
            'context_ok': False,
            'sl_valid': False,
            'tp_valid': False,
            'trade_opened': False,
        }

        # Check si hay niveles activos cerca de esta vela
        # Usa diag_level_proximity_pct (parametro global configurable desde la UI)
        candle = candles[i]
        candle_close = candle['close']
        candle_low = candle['low']
        candle_high = candle['high']
        level_tol = diag_level_proximity_pct / 100.0
        for lv in all_levels:
            if lv.valid_from_idx <= i and (lv.valid_until_idx is None or lv.valid_until_idx >= i):
                dist = min(abs(candle_close - lv.price), abs(candle_low - lv.price), abs(candle_high - lv.price))
                if dist / candle_close <= level_tol:
                    diag['has_level'] = True
                    break

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
        elif signal_type == 'band_crossover':
            signal = signal_band_crossover(candles, i, gc_data,
                                           tolerance_pct=signal_params.get('tolerance_pct', 0.05))

        if signal is None or not signal.get('triggered'):
            diagnostics[i] = diag
            continue

        diag['entry_signal'] = True
        direction = signal['direction']
        filter_stats['signals_generated'] += 1

        # 2a-bis. Resolver trigger_level (Level object que disparo la senal)
        trigger_level = None
        sig_source = signal.get('level_source', '')
        sig_price = signal.get('level_price', 0)
        if sig_source and sig_price:
            for lv in all_levels:
                if (lv.source == sig_source and
                    abs(lv.price - sig_price) < 0.01 and
                    lv.valid_from_idx <= i and
                    (lv.valid_until_idx is None or lv.valid_until_idx >= i)):
                    trigger_level = lv
                    break
        signal['trigger_level'] = trigger_level

        # 2a-ter. Validar distancia entry-nivel (excluye breakout y squeeze/cvd)
        # Para senales de proximidad, el entry no debe estar demasiado lejos del nivel.
        _proximity_signals = ('price_touch', 'swing_confirm', 'rejection_candle',
                              'pattern_match', 'dtb_confirm')
        if signal_type in _proximity_signals and sig_price > 0:
            entry_price_pre = signal['entry_price']
            entry_dist_pct = abs(entry_price_pre - sig_price) / sig_price * 100.0
            # Maximo: 1x la tolerancia de la senal. Con 0.15% tol, el entry
            # no puede estar a mas de 0.15% del nivel.
            sig_tol = signal_params.get('tolerance_pct', 0.1)
            max_entry_dist_pct = sig_tol * 1.0
            if entry_dist_pct > max_entry_dist_pct:
                filter_stats['filtered_entry_distance'] = filter_stats.get('filtered_entry_distance', 0) + 1
                diagnostics[i] = diag
                continue

        # 2b. Filtro de direccion
        if not filter_direction(direction, allowed_direction):
            filter_stats['filtered_direction'] += 1
            diagnostics[i] = diag
            continue

        diag['direction_ok'] = True

        # 2c. Confluencia
        if confluence_mode == 'score' and min_confluence > 0:
            score = compute_confluence_score(all_levels, i, signal['entry_price'])
            if score < min_confluence:
                filter_stats['filtered_confluence'] += 1
                diagnostics[i] = diag
                continue

        diag['confluence_ok'] = True

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
            filter_stats['filtered_max_trades_seg'] += 1
            diagnostics[i] = diag
            continue

        # 2d-bis. Cooldown check (global, aplica a cualquier direccion)
        if cooldown_bars > 0 and i < cooldown_until_idx:
            filter_stats['filtered_cooldown'] += 1
            diagnostics[i] = diag
            continue

        # 2e. Aplicar filtros de contexto (AND)
        all_filters_pass = True
        blocking_filter = None
        for f in context_filters:
            if not f.get('enabled', False):
                continue

            ft = f.get('filter_type', '')
            fp = f.get('params', {})
            passed = True

            if ft == 'vwap_trend':
                passed = filter_vwap_trend(vwap_data, i, direction,
                                           lookback=fp.get('lookback', 10),
                                           min_diff_pct=fp.get('min_diff_pct', 0))
            elif ft == 'vwap_position':
                passed = filter_vwap_position(candles, vwap_data, i, direction,
                                              mode=fp.get('mode', 'trend'),
                                              long_ref=fp.get('long_ref', 'vwap'),
                                              short_ref=fp.get('short_ref', 'vwap'),
                                              reference=fp.get('reference', ''))
            elif ft == 'ttm_squeeze':
                passed = filter_ttm_squeeze(vwap_data, i,
                                            require_squeeze=fp.get('require_squeeze', True))
            elif ft == 'bbwp_range':
                passed = filter_bbwp_range(vwap_data, i,
                                           min_val=fp.get('min_val', fp.get('min', 0)),
                                           max_val=fp.get('max_val', fp.get('max', 100)))
            elif ft == 'volume_zscore':
                passed = filter_volume_zscore(candles, i,
                                              min_zscore=fp.get('min_zscore', 1.5),
                                              lookback=fp.get('lookback', 20))
            elif ft == 'cvd_trend':
                passed = filter_cvd_trend(candles, i, direction,
                                          lookback=fp.get('lookback', 20))
            elif ft == 'dtb_bias':
                passed = filter_dtb_bias(dtb_patterns, i, direction,
                                         lookback=fp.get('lookback', 50),
                                         min_confidence=fp.get('min_confidence', 50))
            elif ft == 'direction':
                passed = filter_direction(direction, fp.get('allowed', 'both'))
            elif ft == 'vp_shape':
                allowed_shapes = fp.get('allowed_shapes', ['all'])
                if isinstance(allowed_shapes, str):
                    allowed_shapes = [allowed_shapes]
                # El nivel que disparo la senal
                trigger_level = signal.get('trigger_level')
                if trigger_level:
                    passed = filter_vp_shape(trigger_level, allowed_shapes)
                # Si no hay trigger_level, pasa (no es nivel VP)
            elif ft == 'gaussian_trend':
                passed = filter_gaussian_trend(gc_data, i, direction,
                                               lookback=fp.get('lookback', 1))

            if not passed:
                all_filters_pass = False
                blocking_filter = ft
                filter_stats['filtered_context'][ft] = filter_stats['filtered_context'].get(ft, 0) + 1
                break

        if not all_filters_pass:
            diagnostics[i] = diag
            continue

        diag['context_ok'] = True

        # 2f. Calcular SL
        entry_price = signal['entry_price']
        level_price = signal['level_price']

        sl_price = compute_sl(candles, i, entry_price, direction, level_price,
                              all_levels, risk_cfg, signal)
        if sl_price is None:
            filter_stats['filtered_sl_invalid'] += 1
            diagnostics[i] = diag
            continue

        # Verificar que SL tiene sentido
        if direction == 'LONG' and sl_price >= entry_price:
            filter_stats['filtered_sl_direction'] += 1
            diagnostics[i] = diag
            continue
        if direction == 'SHORT' and sl_price <= entry_price:
            filter_stats['filtered_sl_direction'] += 1
            diagnostics[i] = diag
            continue

        diag['sl_valid'] = True

        # 2g. Calcular TP
        tp_price = compute_tp(candles, i, entry_price, sl_price, direction,
                              all_levels, risk_cfg)
        if tp_price is None:
            filter_stats['filtered_tp_invalid'] += 1
            diagnostics[i] = diag
            continue

        diag['tp_valid'] = True

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
            diagnostics[i] = diag
            continue

        diag['trade_opened'] = True
        filter_stats['trades_opened'] += 1

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

        diagnostics[i] = diag

        # Set cooldown after trade entry (global)
        if cooldown_bars > 0:
            cooldown_until_idx = i + cooldown_bars

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

    # Log resumen de filtros
    print(f"[SB_BACKTEST] Filter stats: signals={filter_stats['signals_generated']}, "
          f"dir={filter_stats['filtered_direction']}, conf={filter_stats['filtered_confluence']}, "
          f"maxSeg={filter_stats['filtered_max_trades_seg']}, context={filter_stats['filtered_context']}, "
          f"slInv={filter_stats['filtered_sl_invalid']}, slDir={filter_stats['filtered_sl_direction']}, "
          f"tpInv={filter_stats['filtered_tp_invalid']}, opened={filter_stats['trades_opened']}")

    # --- Comprimir diagnostics: solo velas con al menos 1 flag True ---
    diag_compressed = {}
    diag_keys = ['has_level', 'entry_signal', 'direction_ok', 'confluence_ok',
                 'context_ok', 'sl_valid', 'tp_valid', 'trade_opened']
    diag_timestamps = []
    diag_flags = {k: [] for k in diag_keys}
    for idx_d, d in enumerate(diagnostics):
        if d is None:
            continue
        # Solo incluir velas con al menos 1 flag True
        if not any(d.get(k, False) for k in diag_keys):
            continue
        diag_timestamps.append(candles[idx_d]['timestamp'])
        for k in diag_keys:
            diag_flags[k].append(d.get(k, False))

    diag_compressed = {
        'timestamps': diag_timestamps,
        'flags': diag_flags,
        'keys': diag_keys,
    }

    return {
        'success': True,
        'trades': trades,
        'zones': zones,
        'metrics': metrics,
        'candles_count': len(candles),
        'levels_count': len(all_levels),
        'elapsed_seconds': round(elapsed, 2),
        'filter_stats': filter_stats,
        'diagnostics': diag_compressed,
        'vp_profiles': vp_profiles,
        'gc_channel': _serialize_gc_channel(gc_data, candles) if gc_data else None,
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
        elif param_name == 'tp_fallback_rr':
            cfg.setdefault('risk', {}).setdefault('tp_params', {})['fallback_rr'] = value
        elif param_name == 'tp_atr_multiplier':
            cfg.setdefault('risk', {}).setdefault('tp_params', {})['atr_multiplier'] = value
        elif param_name == 'fixed_pct':
            # Determinar si es SL o TP por el metodo activo
            if cfg.get('risk', {}).get('sl_method') == 'fixed_pct':
                cfg.setdefault('risk', {}).setdefault('sl_params', {})['fixed_pct'] = value
            if cfg.get('risk', {}).get('tp_method') == 'fixed_pct':
                cfg.setdefault('risk', {}).setdefault('tp_params', {})['fixed_pct'] = value
        else:
            cfg.setdefault('risk', {})[param_name] = value

    elif parts[0] == 'vwap_period':
        cfg['vwap_period'] = int(value)

    return cfg


def estimate_modular_optimization(candles: List[Dict], config: Dict,
                                  param_ranges: Dict,
                                  symbol: str = '', interval: str = '',
                                  days: int = 0) -> Dict:
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
        run_modular_backtest(candles, test_config,
                             symbol=symbol, interval=interval, days=days)
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
                             top_n: int = 15,
                             symbol: str = '', interval: str = '',
                             days: int = 0) -> Dict:
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

        result = run_modular_backtest(candles, test_config,
                                      symbol=symbol, interval=interval, days=days)

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


# ===========================================================================
# Auto-Optimize: Busqueda inteligente en 3 fases
# ===========================================================================

# Definicion de opciones categoricas del Strategy Builder
_LEVEL_SOURCE_IDS = ['vp_periodic', 'vp_zones', 'sr_v2', 'vwap_bands', 'swing_levels', 'dtb_neckline']
_ENTRY_SIGNAL_IDS = ['price_touch', 'swing_confirm', 'breakout_close', 'rejection_candle',
                     'pattern_match', 'squeeze_release', 'cvd_divergence', 'dtb_confirm']
_SL_METHOD_IDS = ['below_level', 'below_swing', 'atr_multiple', 'fixed_pct']
_TP_METHOD_IDS = ['rr_fixed', 'opposite_level', 'next_swing', 'atr_multiple', 'fixed_pct']
_EXIT_RULE_IDS = ['vwap_reverse', 'reenter_zone', 'squeeze_activate', 'timeout']
_CONTEXT_FILTER_IDS = ['vwap_trend', 'vwap_position', 'ttm_squeeze', 'bbwp_range',
                       'volume_zscore', 'cvd_trend', 'dtb_bias']

# Defaults de parametros por fuente/senal/metodo para que funcionen con valores razonables
_LEVEL_DEFAULTS = {
    'vp_periodic': {'period': 240, 'bins': 50, 'use_poc': True, 'use_vah': True, 'use_val': True, 'lookback_segments': 1},
    'vp_zones':    {'window_size': 30, 'window_step': 5, 'bins': 50, 'va_percent': 0.70,
                    'min_d_score': 40, 'include_pb_shapes': True, 'max_range_pct': 2.0,
                    'detection_mode': 'fixed_window', 'use_poc': True, 'use_vah': True, 'use_val': True},
    'sr_v2':       {'swing_bars': 3, 'cluster_distance_pct': 0.3, 'min_touches': 2, 'max_levels': 10, 'recalc_every': 100},
    'vwap_bands':  {},
    'swing_levels': {'swing_bars': 5},
    'dtb_neckline': {'candles_per_extreme': 5, 'price_margin_pct': 2.0, 'min_candles_between': 10},
}

_ENTRY_DEFAULTS = {
    'price_touch':      {'tolerance_pct': 0.05},
    'swing_confirm':    {'tolerance_pct': 0.3, 'swing_bars': 3},
    'breakout_close':   {'tolerance_pct': 0.1},
    'rejection_candle': {'tolerance_pct': 0.2, 'wick_ratio': 0.6},
    'pattern_match':    {'tolerance_pct': 0.3, 'pattern_type': 'any'},
    'squeeze_release':  {},
    'cvd_divergence':   {'lookback': 20},
    'dtb_confirm':      {'lookback': 50, 'min_confidence': 50},
}

_SL_DEFAULTS = {
    'below_level':  {'buffer_pct': 0.1},
    'below_swing':  {'buffer_pct': 0.1},
    'atr_multiple': {'atr_multiplier': 1.5},
    'fixed_pct':    {'fixed_pct': 1.0},
}

_TP_DEFAULTS = {
    'rr_fixed':        {'rr': 2.0},
    'opposite_level':  {'fallback_rr': 2.0},
    'next_swing':      {'fallback_rr': 2.0},
    'atr_multiple':    {'atr_multiplier': 3.0},
    'fixed_pct':       {'fixed_pct': 2.0},
}

_EXIT_DEFAULTS = {
    'vwap_reverse':     {'lookback': 10},
    'reenter_zone':     {},
    'squeeze_activate': {},
    'timeout':          {'max_bars': 50},
}

_FILTER_DEFAULTS = {
    'vwap_trend':    {'lookback': 10, 'min_diff_pct': 0},
    'vwap_position': {'mode': 'trend', 'long_ref': 'vwap', 'short_ref': 'vwap'},
    'ttm_squeeze':   {'require_squeeze': True},
    'bbwp_range':    {'min_val': 0, 'max_val': 50},
    'volume_zscore': {'min_zscore': 1.5, 'lookback': 20},
    'cvd_trend':     {'lookback': 20},
    'dtb_bias':      {'lookback': 50, 'min_confidence': 50},
}

# Parametros numericos a afinar en Fase 3, por bloque activo
_NUMERIC_TUNING = {
    'vp_periodic':      [('level.vp_periodic.period', 120, 480, 60), ('level.vp_periodic.bins', 30, 80, 10)],
    'sr_v2':            [('level.sr_v2.swing_bars', 2, 6, 1), ('level.sr_v2.cluster_distance_pct', 0.1, 0.6, 0.1)],
    'swing_levels':     [('level.swing_levels.swing_bars', 2, 8, 1)],
    'dtb_neckline':     [('level.dtb_neckline.candles_per_extreme', 3, 8, 1)],
    'price_touch':      [('entry.tolerance_pct', 0.02, 0.15, 0.02)],
    'swing_confirm':    [('entry.tolerance_pct', 0.1, 0.5, 0.1), ('entry.swing_bars', 2, 5, 1)],
    'breakout_close':   [('entry.tolerance_pct', 0.05, 0.3, 0.05)],
    'rejection_candle': [('entry.tolerance_pct', 0.1, 0.5, 0.1), ('entry.wick_ratio', 0.3, 0.9, 0.1)],
    'below_level':      [('risk.buffer_pct', 0.05, 0.3, 0.05)],
    'below_swing':      [('risk.buffer_pct', 0.05, 0.3, 0.05)],
    'atr_multiple_sl':  [('risk.atr_multiplier', 0.5, 3.0, 0.5)],
    'rr_fixed':         [('risk.rr', 1.0, 4.0, 0.5)],
    'opposite_level':   [('risk.tp_fallback_rr', 1.0, 4.0, 0.5)],
    'next_swing':       [('risk.tp_fallback_rr', 1.0, 4.0, 0.5)],
    'atr_multiple_tp':  [('risk.tp_atr_multiplier', 1.5, 6.0, 0.5)],
    'vwap_period':      [('vwap_period', 10, 40, 5)],
}


def _build_config_for_auto(level_ids, entry_id, sl_id, tp_id, exit_ids, filter_ids, vwap_period=20):
    """Construye un config dict completo a partir de IDs categoricos."""
    config = {
        'level_sources': [],
        'entry_signal': {
            'signal_type': entry_id,
            'params': dict(_ENTRY_DEFAULTS.get(entry_id, {})),
        },
        'context_filters': [],
        'risk': {
            'sl_method': sl_id,
            'sl_params': dict(_SL_DEFAULTS.get(sl_id, {})),
            'tp_method': tp_id,
            'tp_params': dict(_TP_DEFAULTS.get(tp_id, {})),
            'max_trades_per_segment': 2,
            'cooldown_bars': 0,
            'trailing_stop': False,
        },
        'exit_rules': [],
        'confluence_mode': 'any',
        'min_confluence_score': 0,
        'vwap_period': vwap_period,
    }

    for lid in level_ids:
        config['level_sources'].append({
            'source': lid,
            'enabled': True,
            'params': dict(_LEVEL_DEFAULTS.get(lid, {})),
        })

    for fid in filter_ids:
        config['context_filters'].append({
            'filter_type': fid,
            'enabled': True,
            'params': dict(_FILTER_DEFAULTS.get(fid, {})),
        })

    # direction=both siempre activo
    config['context_filters'].append({
        'filter_type': 'direction',
        'enabled': True,
        'params': {'allowed': 'both'},
    })

    for eid in exit_ids:
        config['exit_rules'].append({
            'rule_type': eid,
            'enabled': True,
            'params': dict(_EXIT_DEFAULTS.get(eid, {})),
        })

    return config


def _score_result(metrics, ranking_metric='recovery_factor', min_trades=15):
    """
    Calcula score para ranking con penalizacion agresiva por pocos trades
    y tiebreaker multi-criterio para evitar empates.

    Penalizacion: factor = min(1.0, (closed / min_trades)^2)
      - 4 trades con min_trades=15: factor = (4/15)^2 = 0.071
      - 10 trades: factor = (10/15)^2 = 0.444
      - 15+ trades: factor = 1.0 (sin penalizacion)

    Tiebreaker: se agrega una fraccion basada en PnL, expectancy y trades
    para romper empates en el score primario.
    """
    closed = metrics.get('closed', 0)
    if closed < 3:
        return -999
    pnl = metrics.get('total_pnl_r', 0)
    if pnl <= 0:
        return -100 + pnl  # negativo pero menos peor

    val = metrics.get(ranking_metric, 0)
    # max_drawdown_r: menor es mejor -> invertir
    if ranking_metric == 'max_drawdown_r':
        val = -val if val != 0 else 0

    # Penalizacion agresiva por pocos trades (cuadratica)
    if min_trades > 0 and closed < min_trades:
        factor = (closed / min_trades) ** 2
        val *= factor

    # Tiebreaker multi-criterio (fraccion < 0.01 para no alterar ranking primario)
    # Prioridad: PnL total -> expectancy -> trades
    tb_pnl = min(max(pnl, -50), 50) / 10000         # [-0.005, +0.005]
    tb_exp = min(max(metrics.get('expectancy', 0), -5), 5) / 100000  # [-0.00005, +0.00005]
    tb_trades = min(closed, 200) / 10000000           # [0, 0.00002]
    val += tb_pnl + tb_exp + tb_trades

    return val


def run_auto_optimize(candles: List[Dict], progress_cb=None,
                      symbol: str = '', interval: str = '', days: int = 0,
                      ranking_metric: str = 'recovery_factor',
                      top_n: int = 20,
                      min_trades: int = 15) -> Dict:
    """
    Auto-optimizacion en 3 fases:
      Fase 1 - Categorical sweep: prueba cada opcion por separado
              (1a: niveles+entries con base fija,
               1b: SL/TP/exits/filters con base ADAPTATIVA = mejor nivel+entry)
      Fase 2 - Combo generation: combina los mejores de cada categoria
              (incluye diversity pool: candidatos por volumen de trades)
      Fase 3 - Numeric fine-tuning: afina parametros numericos del top combo

    min_trades: umbral para penalizacion cuadratica (configurable por usuario).
    DEBE ejecutarse en thread pool (es CPU-bound).
    progress_cb(phase, percent, message) para reportar progreso via SSE.
    """
    import copy
    import itertools

    t0 = time.time()
    total_backtests = 0

    def _run(config):
        nonlocal total_backtests
        total_backtests += 1
        result = run_modular_backtest(candles, config, symbol=symbol, interval=interval, days=days)
        if result.get('success'):
            return result['metrics']
        return None

    def _score(m):
        """Shortcut para scoring con min_trades del usuario."""
        return _score_result(m, ranking_metric, min_trades) if m else -999

    def _progress(phase, pct, msg):
        if progress_cb:
            progress_cb(phase, pct, msg)

    # =====================================================
    # FASE 1a: Niveles y Entries (base fija)
    # =====================================================
    _progress('phase1', 5, 'Fase 1a: Evaluando niveles y senales...')

    # Base fija para evaluacion inicial de niveles y entries
    base_levels = ['vp_periodic']
    base_entry = 'price_touch'
    base_sl = 'below_level'
    base_tp = 'rr_fixed'
    base_exits = []
    base_filters = []

    # 1a-1. Level sources (probar cada una individualmente)
    level_scores = {}
    for i, lid in enumerate(_LEVEL_SOURCE_IDS):
        cfg = _build_config_for_auto([lid], base_entry, base_sl, base_tp, base_exits, base_filters)
        m = _run(cfg)
        score = _score(m)
        level_scores[lid] = {'score': score, 'metrics': m}
        pct = 5 + int(i / len(_LEVEL_SOURCE_IDS) * 5)
        _progress('phase1', pct, f'Nivel: {lid} -> {m.get("closed", 0) if m else 0} trades')

    # 1a-2. Entry signals (con vp_periodic como base)
    entry_scores = {}
    for i, eid in enumerate(_ENTRY_SIGNAL_IDS):
        cfg = _build_config_for_auto(base_levels, eid, base_sl, base_tp, base_exits, base_filters)
        m = _run(cfg)
        score = _score(m)
        entry_scores[eid] = {'score': score, 'metrics': m}
        pct = 10 + int(i / len(_ENTRY_SIGNAL_IDS) * 5)
        _progress('phase1', pct, f'Senal: {eid} -> {m.get("closed", 0) if m else 0} trades')

    # Determinar mejor nivel + entry para base adaptativa
    top_levels_prelim = sorted(level_scores.items(), key=lambda x: x[1]['score'], reverse=True)
    top_entries_prelim = sorted(entry_scores.items(), key=lambda x: x[1]['score'], reverse=True)

    # Mejor nivel: preferir el que tiene mas trades con score positivo (diversidad)
    adapt_level = base_levels[0]
    for lid, data in top_levels_prelim:
        if data['score'] > -100 and data.get('metrics') and data['metrics'].get('closed', 0) >= 5:
            adapt_level = lid
            break
    # Fallback: si ninguno tiene 5+ trades, usar el de mayor score
    if adapt_level == base_levels[0] and top_levels_prelim and top_levels_prelim[0][1]['score'] > -999:
        adapt_level = top_levels_prelim[0][0]

    adapt_entry = base_entry
    for eid, data in top_entries_prelim:
        if data['score'] > -100 and data.get('metrics') and data['metrics'].get('closed', 0) >= 5:
            adapt_entry = eid
            break
    if adapt_entry == base_entry and top_entries_prelim and top_entries_prelim[0][1]['score'] > -999:
        adapt_entry = top_entries_prelim[0][0]

    _progress('phase1', 16, f'Base adaptativa: {adapt_level} + {adapt_entry}')

    # =====================================================
    # FASE 1b: SL/TP/Exits/Filters con BASE ADAPTATIVA
    # =====================================================
    adapt_levels = [adapt_level]

    # 1b-1. SL methods (con base adaptativa)
    sl_scores = {}
    for i, sid in enumerate(_SL_METHOD_IDS):
        cfg = _build_config_for_auto(adapt_levels, adapt_entry, sid, base_tp, base_exits, base_filters)
        m = _run(cfg)
        score = _score(m)
        sl_scores[sid] = {'score': score, 'metrics': m}
        pct = 17 + int(i / len(_SL_METHOD_IDS) * 4)
        _progress('phase1', pct, f'SL: {sid} -> {m.get("closed", 0) if m else 0} trades')

    # 1b-2. TP methods (con base adaptativa)
    tp_scores = {}
    for i, tid in enumerate(_TP_METHOD_IDS):
        cfg = _build_config_for_auto(adapt_levels, adapt_entry, base_sl, tid, base_exits, base_filters)
        m = _run(cfg)
        score = _score(m)
        tp_scores[tid] = {'score': score, 'metrics': m}
        pct = 21 + int(i / len(_TP_METHOD_IDS) * 4)
        _progress('phase1', pct, f'TP: {tid} -> {m.get("closed", 0) if m else 0} trades')

    # 1b-3. Exit rules (con base adaptativa)
    exit_scores = {}
    for i, xid in enumerate(_EXIT_RULE_IDS):
        cfg = _build_config_for_auto(adapt_levels, adapt_entry, base_sl, base_tp, [xid], base_filters)
        m = _run(cfg)
        score = _score(m)
        exit_scores[xid] = {'score': score, 'metrics': m}

    # 1b-4. Context filters (con base adaptativa)
    filter_scores = {}
    for i, fid in enumerate(_CONTEXT_FILTER_IDS):
        cfg = _build_config_for_auto(adapt_levels, adapt_entry, base_sl, base_tp, base_exits, [fid])
        m = _run(cfg)
        score = _score(m)
        filter_scores[fid] = {'score': score, 'metrics': m}

    _progress('phase1', 35, f'Fase 1 completa: {total_backtests} backtests (base: {adapt_level}+{adapt_entry})')

    # Seleccionar top de cada categoria (con scores de base adaptativa)
    top_levels = sorted(level_scores.items(), key=lambda x: x[1]['score'], reverse=True)
    top_entries = sorted(entry_scores.items(), key=lambda x: x[1]['score'], reverse=True)
    top_sls = sorted(sl_scores.items(), key=lambda x: x[1]['score'], reverse=True)
    top_tps = sorted(tp_scores.items(), key=lambda x: x[1]['score'], reverse=True)

    # Top 3 de cada grupo principal (por score)
    best_levels_by_score = [x[0] for x in top_levels[:3] if x[1]['score'] > -999]
    best_entries_by_score = [x[0] for x in top_entries[:3] if x[1]['score'] > -999]

    # DIVERSITY POOL: incluir candidatos por volumen de trades (PnL > 0)
    # Esto evita que solo entren los de pocos trades con 100% WR
    levels_by_trades = sorted(
        [(lid, d) for lid, d in level_scores.items()
         if d.get('metrics') and d['metrics'].get('total_pnl_r', 0) > 0],
        key=lambda x: x[1]['metrics'].get('closed', 0), reverse=True
    )
    entries_by_trades = sorted(
        [(eid, d) for eid, d in entry_scores.items()
         if d.get('metrics') and d['metrics'].get('total_pnl_r', 0) > 0],
        key=lambda x: x[1]['metrics'].get('closed', 0), reverse=True
    )

    # Combinar: top por score + top por trades (sin duplicados)
    best_levels = list(dict.fromkeys(
        best_levels_by_score + [x[0] for x in levels_by_trades[:2]]
    ))[:4]  # max 4
    best_entries = list(dict.fromkeys(
        best_entries_by_score + [x[0] for x in entries_by_trades[:2]]
    ))[:4]  # max 4

    best_sls = [x[0] for x in top_sls[:2] if x[1]['score'] > -999]
    best_tps = [x[0] for x in top_tps[:2] if x[1]['score'] > -999]

    # Exit rules y filtros que mejoraron la base adaptativa
    baseline_cfg = _build_config_for_auto(adapt_levels, adapt_entry, base_sl, base_tp, [], [])
    baseline_m = _run(baseline_cfg)
    baseline_score = _score(baseline_m)

    beneficial_exits = [xid for xid, data in exit_scores.items() if data['score'] > baseline_score]
    beneficial_filters = [fid for fid, data in filter_scores.items() if data['score'] > baseline_score]

    # Fallbacks
    if not best_levels:
        best_levels = ['vp_periodic']
    if not best_entries:
        best_entries = ['price_touch']
    if not best_sls:
        best_sls = ['below_level']
    if not best_tps:
        best_tps = ['rr_fixed']

    # =====================================================
    # FASE 2: Combo Generation
    # =====================================================
    _progress('phase2', 36, 'Fase 2: Generando combinaciones...')

    # Generar combos de niveles (1 o 2 fuentes juntas)
    level_combos = [[l] for l in best_levels]
    if len(best_levels) >= 2:
        for i in range(len(best_levels)):
            for j in range(i + 1, len(best_levels)):
                level_combos.append([best_levels[i], best_levels[j]])

    # Exit combos: sin exits, cada beneficial solo, y todos juntos si hay
    exit_combos = [[]]
    for xid in beneficial_exits:
        exit_combos.append([xid])
    if len(beneficial_exits) >= 2:
        exit_combos.append(beneficial_exits)

    # Filter combos: sin filtros, cada beneficial solo, y todos juntos
    filter_combos = [[]]
    for fid in beneficial_filters:
        filter_combos.append([fid])
    if len(beneficial_filters) >= 2:
        filter_combos.append(beneficial_filters)

    # Limitar combinaciones totales (max ~200 para Fase 2)
    all_combos = list(itertools.product(level_combos, best_entries, best_sls, best_tps, exit_combos, filter_combos))
    max_phase2 = 200
    if len(all_combos) > max_phase2:
        step = len(all_combos) / max_phase2
        indices = [int(i * step) for i in range(max_phase2)]
        all_combos = [all_combos[i] for i in indices]

    phase2_results = []
    for i, (lvls, entry, sl, tp, exits, filters) in enumerate(all_combos):
        cfg = _build_config_for_auto(lvls, entry, sl, tp, exits, filters)
        m = _run(cfg)
        if m:
            score = _score(m)
            phase2_results.append({
                'levels': lvls, 'entry': entry, 'sl': sl, 'tp': tp,
                'exits': exits, 'filters': filters,
                'config': cfg, 'metrics': m, 'score': score,
            })
        if (i + 1) % 10 == 0:
            pct = 36 + int((i + 1) / len(all_combos) * 24)
            _progress('phase2', pct, f'Combo {i+1}/{len(all_combos)}')

    phase2_results.sort(key=lambda x: x['score'], reverse=True)

    _progress('phase2', 60, f'Fase 2 completa: {len(phase2_results)} combos evaluados')

    # =====================================================
    # FASE 3: Numeric Fine-Tuning del top 3
    # =====================================================
    _progress('phase3', 61, 'Fase 3: Afinando parametros numericos...')

    final_results = []
    top_combos = phase2_results[:3] if len(phase2_results) >= 3 else phase2_results

    for combo_idx, combo in enumerate(top_combos):
        best_config = copy.deepcopy(combo['config'])
        best_metrics = combo['metrics']
        best_score = combo['score']

        # Determinar que parametros numericos afinar
        tune_params = list(_NUMERIC_TUNING.get('vwap_period', []))
        for lid in combo['levels']:
            tune_params.extend(_NUMERIC_TUNING.get(lid, []))
        tune_params.extend(_NUMERIC_TUNING.get(combo['entry'], []))
        sl_key = combo['sl'] + ('_sl' if combo['sl'] == 'atr_multiple' else '')
        tune_params.extend(_NUMERIC_TUNING.get(sl_key, []))
        tp_key = combo['tp'] + ('_tp' if combo['tp'] == 'atr_multiple' else '')
        tune_params.extend(_NUMERIC_TUNING.get(tp_key, []))

        # Coordinate descent: un parametro a la vez
        improved = True
        max_rounds = 2
        round_num = 0
        while improved and round_num < max_rounds:
            improved = False
            round_num += 1
            for param_path, p_min, p_max, p_step in tune_params:
                current = p_min
                values_to_try = []
                while current <= p_max + p_step * 0.01:
                    values_to_try.append(round(current, 6))
                    current += p_step

                for val in values_to_try:
                    test_cfg = _apply_param_to_config(best_config, param_path, val)
                    m = _run(test_cfg)
                    if m:
                        s = _score(m)
                        if s > best_score:
                            best_score = s
                            best_metrics = m
                            best_config = copy.deepcopy(test_cfg)
                            improved = True

        pct = 61 + int((combo_idx + 1) / len(top_combos) * 34)
        _progress('phase3', pct, f'Top {combo_idx+1}: score={best_score:.2f}')

        final_results.append({
            'levels': combo['levels'],
            'entry': combo['entry'],
            'sl': combo['sl'],
            'tp': combo['tp'],
            'exits': combo['exits'],
            'filters': combo['filters'],
            'config': best_config,
            'metrics': best_metrics,
            'score': best_score,
        })

    # Ordenar por score final
    final_results.sort(key=lambda x: x['score'], reverse=True)

    # Agregar tambien los restantes de fase 2 no afinados (para diversidad)
    seen_configs = set()
    for r in final_results:
        key = f"{r['levels']}{r['entry']}{r['sl']}{r['tp']}"
        seen_configs.add(key)

    for r in phase2_results:
        key = f"{r['levels']}{r['entry']}{r['sl']}{r['tp']}"
        if key not in seen_configs and len(final_results) < top_n:
            final_results.append(r)
            seen_configs.add(key)

    elapsed = time.time() - t0
    _progress('done', 100, f'Completado: {total_backtests} backtests en {elapsed:.1f}s')

    # Helper para formatear un resultado
    def _fmt_row(r, rank=0):
        m = r.get('metrics') or {}
        cfg = r.get('config') or {}
        # Construir resumen de parametros legible para Excel
        param_parts = []
        for ls in cfg.get('level_sources', []):
            src = ls.get('source', '?')
            ps = ls.get('params', {})
            ps_str = ', '.join(f'{k}={v}' for k, v in ps.items() if k not in ('use_poc', 'use_vah', 'use_val', 'include_pb_shapes'))
            param_parts.append(f'L:{src}({ps_str})' if ps_str else f'L:{src}')
        es = cfg.get('entry_signal', {})
        if es.get('signal_type'):
            eps = es.get('params', {})
            eps_str = ', '.join(f'{k}={v}' for k, v in eps.items())
            param_parts.append(f'E:{es["signal_type"]}({eps_str})' if eps_str else f'E:{es["signal_type"]}')
        risk = cfg.get('risk', {})
        if risk.get('sl_method'):
            sp = risk.get('sl_params', {})
            sp_str = ', '.join(f'{k}={v}' for k, v in sp.items())
            param_parts.append(f'SL:{risk["sl_method"]}({sp_str})' if sp_str else f'SL:{risk["sl_method"]}')
        if risk.get('tp_method'):
            tp = risk.get('tp_params', {})
            tp_str = ', '.join(f'{k}={v}' for k, v in tp.items())
            param_parts.append(f'TP:{risk["tp_method"]}({tp_str})' if tp_str else f'TP:{risk["tp_method"]}')
        if risk.get('max_trades_per_segment', 1) != 1:
            param_parts.append(f'maxTrades={risk["max_trades_per_segment"]}')
        if risk.get('cooldown_bars', 0) > 0:
            param_parts.append(f'cooldown={risk["cooldown_bars"]}')
        for xr in cfg.get('exit_rules', []):
            xp = xr.get('params', {})
            xp_str = ', '.join(f'{k}={v}' for k, v in xp.items())
            param_parts.append(f'X:{xr.get("rule_type", "?")}({xp_str})' if xp_str else f'X:{xr.get("rule_type", "?")}')
        for cf in cfg.get('context_filters', []):
            if cf.get('filter_type') == 'direction':
                continue  # direction=both siempre presente, omitir
            cp = cf.get('params', {})
            cp_str = ', '.join(f'{k}={v}' for k, v in cp.items())
            param_parts.append(f'F:{cf.get("filter_type", "?")}({cp_str})' if cp_str else f'F:{cf.get("filter_type", "?")}')
        if cfg.get('vwap_period', 20) != 20:
            param_parts.append(f'vwap_period={cfg["vwap_period"]}')

        # Construir columnas de parametros individuales para Excel
        level_params_parts = []
        for ls in cfg.get('level_sources', []):
            src = ls.get('source', '?')
            ps = ls.get('params', {})
            ps_str = ', '.join(f'{k}={v}' for k, v in ps.items() if k not in ('use_poc', 'use_vah', 'use_val', 'include_pb_shapes'))
            level_params_parts.append(f'{src}({ps_str})' if ps_str else src)
        entry_params_str = ''
        es = cfg.get('entry_signal', {})
        if es.get('signal_type'):
            eps = es.get('params', {})
            eps_str = ', '.join(f'{k}={v}' for k, v in eps.items())
            entry_params_str = f'{es["signal_type"]}({eps_str})' if eps_str else es["signal_type"]
        sl_params_str = ''
        risk = cfg.get('risk', {})
        if risk.get('sl_method'):
            sp = risk.get('sl_params', {})
            sp_str = ', '.join(f'{k}={v}' for k, v in sp.items())
            sl_params_str = f'{risk["sl_method"]}({sp_str})' if sp_str else risk["sl_method"]
        tp_params_str = ''
        if risk.get('tp_method'):
            tp = risk.get('tp_params', {})
            tp_str = ', '.join(f'{k}={v}' for k, v in tp.items())
            tp_params_str = f'{risk["tp_method"]}({tp_str})' if tp_str else risk["tp_method"]
        risk_extra_parts = []
        if risk.get('max_trades_per_segment', 1) != 1:
            risk_extra_parts.append(f'maxTrades={risk["max_trades_per_segment"]}')
        if risk.get('cooldown_bars', 0) > 0:
            risk_extra_parts.append(f'cooldown={risk["cooldown_bars"]}')
        exit_params_parts = []
        for xr in cfg.get('exit_rules', []):
            xp = xr.get('params', {})
            xp_str = ', '.join(f'{k}={v}' for k, v in xp.items())
            exit_params_parts.append(f'{xr.get("rule_type", "?")}({xp_str})' if xp_str else xr.get("rule_type", "?"))
        filter_params_parts = []
        for cf in cfg.get('context_filters', []):
            if cf.get('filter_type') == 'direction':
                continue
            cp = cf.get('params', {})
            cp_str = ', '.join(f'{k}={v}' for k, v in cp.items())
            filter_params_parts.append(f'{cf.get("filter_type", "?")}({cp_str})' if cp_str else cf.get("filter_type", "?"))
        if cfg.get('vwap_period', 20) != 20:
            filter_params_parts.append(f'vwap_period={cfg["vwap_period"]}')

        return {
            'rank': rank,
            'levels': r.get('levels', []),
            'entry': r.get('entry', ''),
            'sl': r.get('sl', ''),
            'tp': r.get('tp', ''),
            'exits': r.get('exits', []),
            'filters': r.get('filters', []),
            'score': round(r.get('score', 0), 2),
            'win_rate': m.get('win_rate', 0),
            'total_pnl_r': m.get('total_pnl_r', 0),
            'expectancy': m.get('expectancy', 0),
            'profit_factor': m.get('profit_factor', 0),
            'max_drawdown_r': m.get('max_drawdown_r', 0),
            'recovery_factor': m.get('recovery_factor', 0),
            'closed': m.get('closed', 0),
            'wins': m.get('wins', 0),
            'losses': m.get('losses', 0),
            'avg_bars_held': m.get('avg_bars_held', 0),
            'config': cfg,
            'config_summary': ' | '.join(param_parts),
            # Columnas individuales de parametros para Excel
            'param_levels': ' | '.join(level_params_parts),
            'param_entry': entry_params_str,
            'param_sl': sl_params_str,
            'param_tp': tp_params_str,
            'param_risk_extra': ' | '.join(risk_extra_parts),
            'param_exits': ' | '.join(exit_params_parts),
            'param_filters': ' | '.join(filter_params_parts),
        }

    # Formatear top results
    output_rows = []
    for i, r in enumerate(final_results[:top_n]):
        output_rows.append(_fmt_row(r, i + 1))

    # Formatear ALL results (fase 1 individuales + fase 2 combos)
    all_rows = []
    # Phase 1 individuales (con config para boton "Aplicar")
    phase1_all = []
    for lid, data in level_scores.items():
        phase1_all.append({'levels': [lid], 'entry': base_entry, 'sl': base_sl, 'tp': base_tp,
                          'exits': [], 'filters': [], 'score': data['score'], 'metrics': data['metrics'],
                          'config': _build_config_for_auto([lid], base_entry, base_sl, base_tp, [], []),
                          'phase': 'phase1_level'})
    for eid, data in entry_scores.items():
        phase1_all.append({'levels': base_levels, 'entry': eid, 'sl': base_sl, 'tp': base_tp,
                          'exits': [], 'filters': [], 'score': data['score'], 'metrics': data['metrics'],
                          'config': _build_config_for_auto(base_levels, eid, base_sl, base_tp, [], []),
                          'phase': 'phase1_entry'})
    # FASE 1b uso adapt_levels/adapt_entry como base → los resultados deben reflejarlo
    for sid, data in sl_scores.items():
        phase1_all.append({'levels': adapt_levels, 'entry': adapt_entry, 'sl': sid, 'tp': base_tp,
                          'exits': [], 'filters': [], 'score': data['score'], 'metrics': data['metrics'],
                          'config': _build_config_for_auto(adapt_levels, adapt_entry, sid, base_tp, [], []),
                          'phase': 'phase1_sl'})
    for tid, data in tp_scores.items():
        phase1_all.append({'levels': adapt_levels, 'entry': adapt_entry, 'sl': base_sl, 'tp': tid,
                          'exits': [], 'filters': [], 'score': data['score'], 'metrics': data['metrics'],
                          'config': _build_config_for_auto(adapt_levels, adapt_entry, base_sl, tid, [], []),
                          'phase': 'phase1_tp'})
    for xid, data in exit_scores.items():
        phase1_all.append({'levels': adapt_levels, 'entry': adapt_entry, 'sl': base_sl, 'tp': base_tp,
                          'exits': [xid], 'filters': [], 'score': data['score'], 'metrics': data['metrics'],
                          'config': _build_config_for_auto(adapt_levels, adapt_entry, base_sl, base_tp, [xid], []),
                          'phase': 'phase1_exit'})
    for fid, data in filter_scores.items():
        phase1_all.append({'levels': adapt_levels, 'entry': adapt_entry, 'sl': base_sl, 'tp': base_tp,
                          'exits': [], 'filters': [fid], 'score': data['score'], 'metrics': data['metrics'],
                          'config': _build_config_for_auto(adapt_levels, adapt_entry, base_sl, base_tp, [], [fid]),
                          'phase': 'phase1_filter'})

    for r in phase1_all:
        row = _fmt_row(r, 0)
        row['phase'] = r.get('phase', '')
        all_rows.append(row)

    # Phase 2 combos
    for r in phase2_results:
        row = _fmt_row(r, 0)
        row['phase'] = 'phase2'
        all_rows.append(row)

    # Phase 3 (final tuned) - ya estan en output_rows
    for i, r in enumerate(final_results[:top_n]):
        row = _fmt_row(r, i + 1)
        row['phase'] = 'phase3'
        all_rows.append(row)

    return {
        'success': True,
        'total_backtests': total_backtests,
        'elapsed': round(elapsed, 1),
        'candles': len(candles),
        'ranking_metric': ranking_metric,
        'min_trades': min_trades,
        'phase1_summary': {
            'adaptive_base': f'{adapt_level}+{adapt_entry}',
            'best_levels': [(k, round(v['score'], 2)) for k, v in top_levels[:5]],
            'best_entries': [(k, round(v['score'], 2)) for k, v in top_entries[:5]],
            'best_sls': [(k, round(v['score'], 2)) for k, v in top_sls],
            'best_tps': [(k, round(v['score'], 2)) for k, v in top_tps],
            'beneficial_exits': beneficial_exits,
            'beneficial_filters': beneficial_filters,
            'diversity_pool': {
                'levels_added': [x[0] for x in levels_by_trades[:2] if x[0] not in best_levels_by_score],
                'entries_added': [x[0] for x in entries_by_trades[:2] if x[0] not in best_entries_by_score],
            },
        },
        'results': output_rows,
        'all_results': all_rows,
    }
