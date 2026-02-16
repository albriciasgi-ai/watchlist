"""
Zone VP Scanner - Deteccion de zonas por forma de Volume Profile
================================================================
Detecta zonas de consolidacion analizando la forma del Volume Profile:
- Perfil D (equilibrio): campana centrada → zona de acumulacion institucional
- Perfil P (compradores): recorta la cola inferior → extrae D interna
- Perfil b (vendedores): recorta la cola superior → extrae D interna

Modos:
- Backtest: scan_zones() con ventana deslizante sobre historico
- Realtime: IncrementalVPScanner vela a vela (actualizacion incremental del VP)
"""
import logging
import math
import time
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger("zone_vp_scanner")

_alert_logger = logging.getLogger("zone_vp_alerts")
if not _alert_logger.handlers:
    import os
    _log_dir = os.path.join(os.path.dirname(__file__), "logs")
    os.makedirs(_log_dir, exist_ok=True)
    _fh = logging.FileHandler(os.path.join(_log_dir, "zone_vp_alerts.log"), encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
    _alert_logger.addHandler(_fh)
    _alert_logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class VPScannerConfig:
    """Configuracion del VP Zone Scanner."""
    # Estado
    enabled: bool = False
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT"])
    interval: str = "5"

    # Ventana deslizante
    window_size: int = 30       # Velas por ventana de VP
    window_step: int = 5        # Paso de deslizamiento (1 para realtime)
    bins: int = 50              # Niveles de precio del VP
    va_percent: float = 0.70    # Porcentaje para Value Area

    # Clasificacion de forma
    min_d_score: int = 40       # Score minimo para considerar zona D
    include_pb_shapes: bool = True  # Incluir P/b recortados como D interna

    # Zona
    min_zone_candles: int = 10  # Minimo de velas para considerar zona
    merge_gap: int = 3          # Velas gap maximo para fusionar zonas contiguas
    max_range_pct: float = 2.0  # Maximo rango de precio % de zona

    # Trade / Backtest
    lookforward_bars: int = 100
    tp_rr_ratio: float = 2.0
    sl_buffer_pct: float = 0.1  # Buffer extra para SL (% del rango)
    sl_mode: str = "below_va"   # "below_va", "zone_opposite", "beyond_poc"
    entry_mode: str = "zone"    # "zone" (breakout del rango completo) o "va" (breakout del Value Area)
    breakout_confirm_bars: int = 0  # 0 = entrada en close de vela de breakout
    position_mode: str = "sequential"

    # Estrategia de trading
    entry_strategy: str = "breakout"  # "breakout" | "retest" | "mean_reversion"

    # --- Mean Reversion ---
    mr_target: str = "poc"         # TP target: "poc" | "opposite_va" | "opposite_zone"
    mr_entry_zone: str = "va"      # Trigger entry at: "va" (VAH/VAL) | "zone" (full range)
    mr_confirm: str = "rejection"  # "touch" | "rejection" | "swing"
    mr_swing_bars: int = 3           # Para confirm=swing: N velas a cada lado
    mr_sl_mode: str = "beyond_zone"  # "beyond_zone" (full range + buffer) | "beyond_va" (VA + buffer)
    mr_sl_buffer_pct: float = 0.15   # Buffer extra para SL en mean reversion (%)
    mr_min_zone_candles: int = 15    # Min velas de consolidacion antes de buscar entries
    mr_max_trades_per_zone: int = 3  # Max trades dentro de una misma zona

    # --- Retest (Breakout + Pullback) ---
    rt_max_bars: int = 30            # Max velas para esperar retest despues del breakout
    rt_level: str = "va"             # Nivel de retest: "va" | "zone" | "poc"
    rt_confirm: str = "rejection"    # "touch" | "rejection" | "swing"
    rt_swing_bars: int = 3           # Para confirm=swing: N velas a cada lado
    rt_sl_mode: str = "below_retest" # "below_retest" | "below_va" | "below_zone"
    rt_must_reenter: bool = True     # La vela de retest debe cerrar dentro de la zona/VA

    # --- Breakout refinado ---
    bo_volume_filter: bool = False   # Filtrar por volumen en vela de breakout
    bo_volume_zscore: float = 1.0    # Z-score minimo de volumen para breakout valido
    bo_momentum_bars: int = 0        # Velas previas para evaluar momentum (0=deshabilitado)

    # Alertas
    alerts_enabled: bool = True
    alert_target_url: str = "http://localhost:5000/api/watchlist-alert"
    cooldown_minutes: int = 5

    # Warmup
    warmup_candles: int = 50

    # Deteccion progresiva (modo alternativo)
    detection_mode: str = "fixed_window"  # "fixed_window" (actual) o "progressive"
    prog_min_candles: int = 30     # Velas minimas para iniciar evaluacion
    prog_range_pct: float = 1.5    # Rango % maximo para considerar vela "dentro" de zona
    prog_stop_mode: str = "breakout"  # "breakout" o "degradation"
    prog_degrade_bars: int = 5     # Velas consecutivas con d_score bajando para cerrar
    prog_close_outside_bars: int = 3  # Cierres consecutivos fuera de referencia para cerrar zona
    prog_close_reference: str = "va"   # "va" (Value Area) o "zone" (full range)
    prog_thickness_metric: str = "kurtosis"  # "kurtosis" o "poc_ratio"


# ---------------------------------------------------------------------------
# Volume Profile Calculation
# ---------------------------------------------------------------------------

def compute_volume_profile(candles: List[Dict], bins: int = 50,
                           va_percent: float = 0.70) -> Dict:
    """
    Calcula el Volume Profile para un grupo de velas.
    Distribuye volumen proporcional por overlap (misma logica del frontend).

    Returns:
        {
            'levels': [{'price', 'volume', 'level_low', 'level_high'}],
            'poc': {'index', 'price', 'volume'},
            'vah_price': float,
            'val_price': float,
            'va_low_idx': int,
            'va_high_idx': int,
            'total_volume': float,
            'max_volume': float,
            'min_price': float,
            'max_price': float,
        }
    """
    if not candles or bins < 2:
        return _empty_profile()

    # Rango de precios
    min_price = min(c['low'] for c in candles)
    max_price = max(c['high'] for c in candles)

    if max_price <= min_price:
        return _empty_profile()

    step = (max_price - min_price) / bins

    # Crear niveles
    levels = []
    for i in range(bins):
        level_low = min_price + i * step
        level_high = level_low + step
        levels.append({
            'price': (level_low + level_high) / 2.0,
            'volume': 0.0,
            'level_low': level_low,
            'level_high': level_high,
        })

    # Acumular volumen por overlap proporcional
    total_volume = 0.0
    for candle in candles:
        c_low = candle['low']
        c_high = candle['high']
        c_vol = candle.get('volume', 0) or 0
        c_range = c_high - c_low

        if c_range <= 0 or c_vol <= 0:
            continue

        for level in levels:
            overlap_low = max(c_low, level['level_low'])
            overlap_high = min(c_high, level['level_high'])
            overlap = max(0.0, overlap_high - overlap_low)

            if overlap > 0:
                fraction = overlap / c_range
                vol_contribution = c_vol * fraction
                level['volume'] += vol_contribution
                total_volume += vol_contribution

    if total_volume <= 0:
        return _empty_profile()

    # POC (nivel con maximo volumen)
    max_vol = 0.0
    poc_idx = 0
    for i, level in enumerate(levels):
        if level['volume'] > max_vol:
            max_vol = level['volume']
            poc_idx = i

    # Value Area (expandir desde POC hasta alcanzar va_percent del volumen)
    va_threshold = total_volume * va_percent
    va_volume = levels[poc_idx]['volume']
    va_low_idx = poc_idx
    va_high_idx = poc_idx

    while va_volume < va_threshold:
        can_go_up = va_high_idx < bins - 1
        can_go_down = va_low_idx > 0

        if not can_go_up and not can_go_down:
            break

        up_vol = levels[va_high_idx + 1]['volume'] if can_go_up else -1
        down_vol = levels[va_low_idx - 1]['volume'] if can_go_down else -1

        if up_vol >= down_vol:
            va_high_idx += 1
            va_volume += levels[va_high_idx]['volume']
        else:
            va_low_idx -= 1
            va_volume += levels[va_low_idx]['volume']

    return {
        'levels': levels,
        'poc': {
            'index': poc_idx,
            'price': levels[poc_idx]['price'],
            'volume': max_vol,
        },
        'vah_price': levels[va_high_idx]['level_high'],
        'val_price': levels[va_low_idx]['level_low'],
        'va_low_idx': va_low_idx,
        'va_high_idx': va_high_idx,
        'total_volume': total_volume,
        'max_volume': max_vol,
        'min_price': min_price,
        'max_price': max_price,
    }


def _empty_profile() -> Dict:
    return {
        'levels': [],
        'poc': {'index': 0, 'price': 0, 'volume': 0},
        'vah_price': 0, 'val_price': 0,
        'va_low_idx': 0, 'va_high_idx': 0,
        'total_volume': 0, 'max_volume': 0,
        'min_price': 0, 'max_price': 0,
    }


def _build_vp_for_frontend(vp: Dict) -> Dict:
    """
    Construye el campo volume_profile para renderizado en el frontend.
    Formato esperado por ZoneVisualizerIndicator._renderZoneOverlay():
      { bins: [{price, volume_norm, in_va}], price_low, price_high,
        poc_price, vah_price, val_price }
    """
    levels = vp.get('levels', [])
    max_vol = vp.get('max_volume', 0)
    va_low_idx = vp.get('va_low_idx', 0)
    va_high_idx = vp.get('va_high_idx', len(levels) - 1)

    if not levels or max_vol <= 0:
        return {'bins': [], 'price_low': 0, 'price_high': 0,
                'poc_price': 0, 'vah_price': 0, 'val_price': 0}

    bins = []
    for i, lv in enumerate(levels):
        bins.append({
            'price': round(lv['price'], 6),
            'volume_norm': round(lv['volume'] / max_vol, 4),
            'in_va': va_low_idx <= i <= va_high_idx,
        })

    return {
        'bins': bins,
        'price_low': vp['min_price'],
        'price_high': vp['max_price'],
        'poc_price': vp['poc']['price'],
        'vah_price': vp['vah_price'],
        'val_price': vp['val_price'],
    }


# ---------------------------------------------------------------------------
# Shape Classification
# ---------------------------------------------------------------------------

def classify_shape(profile: Dict) -> Dict:
    """
    Clasifica la forma del Volume Profile.

    Metricas:
    - poc_centrality: posicion del POC en el rango (0=abajo, 1=arriba). D ideal: 0.3-0.7
    - va_concentration: fraccion del rango que ocupa el VA. D ideal: 0.3-0.65
    - symmetry: balance de volumen arriba vs abajo del POC. D ideal: < 0.35
    - kurtosis_approx: concentracion del vol en centro vs extremos. D ideal: > 0.3

    Returns:
        {
            'shape_type': 'D' | 'P' | 'b' | 'thin',
            'd_score': 0-100,
            'poc_centrality': float,
            'va_concentration': float,
            'symmetry': float,
            'kurtosis_approx': float,
        }
    """
    levels = profile.get('levels', [])
    poc = profile.get('poc', {})
    total_vol = profile.get('total_volume', 0)

    if not levels or total_vol <= 0:
        return {'shape_type': 'thin', 'd_score': 0,
                'poc_centrality': 0.5, 'va_concentration': 1.0,
                'symmetry': 0.5, 'kurtosis_approx': 0}

    n_levels = len(levels)
    poc_idx = poc.get('index', n_levels // 2)
    min_price = profile['min_price']
    max_price = profile['max_price']
    price_range = max_price - min_price

    if price_range <= 0:
        return {'shape_type': 'thin', 'd_score': 0,
                'poc_centrality': 0.5, 'va_concentration': 1.0,
                'symmetry': 0.5, 'kurtosis_approx': 0}

    # 1. POC Centrality (0 = bottom, 1 = top)
    poc_price = poc.get('price', (min_price + max_price) / 2)
    poc_centrality = (poc_price - min_price) / price_range

    # 2. VA Concentration (fraccion del rango que ocupa el VA)
    vah = profile.get('vah_price', max_price)
    val = profile.get('val_price', min_price)
    va_range = vah - val
    va_concentration = va_range / price_range if price_range > 0 else 1.0

    # 3. Symmetry (diferencia de volumen arriba vs abajo del POC)
    vol_above = sum(l['volume'] for i, l in enumerate(levels) if i > poc_idx)
    vol_below = sum(l['volume'] for i, l in enumerate(levels) if i < poc_idx)
    vol_sum = vol_above + vol_below
    symmetry = abs(vol_above - vol_below) / vol_sum if vol_sum > 0 else 0.5

    # 4. Kurtosis aproximada (vol en centro 40% vs extremos)
    center_start = int(n_levels * 0.3)
    center_end = int(n_levels * 0.7)
    vol_center = sum(levels[i]['volume'] for i in range(center_start, center_end))
    kurtosis_approx = vol_center / total_vol if total_vol > 0 else 0

    # Clasificacion de forma
    shape_type = _determine_shape(poc_centrality, va_concentration, symmetry, kurtosis_approx)

    # D-Score (0-100): que tan "D" es el perfil
    d_score = _calculate_d_score(poc_centrality, va_concentration, symmetry, kurtosis_approx)

    return {
        'shape_type': shape_type,
        'd_score': d_score,
        'poc_centrality': round(poc_centrality, 3),
        'va_concentration': round(va_concentration, 3),
        'symmetry': round(symmetry, 3),
        'kurtosis_approx': round(kurtosis_approx, 3),
    }


def _determine_shape(poc_centrality: float, va_concentration: float,
                     symmetry: float, kurtosis: float) -> str:
    """Determina el tipo de forma del perfil."""
    # Thin: sin concentracion real (volumen distribuido uniformemente)
    if kurtosis < 0.25 and va_concentration > 0.85:
        return 'thin'

    # D: POC centrado, simetrico, concentrado
    if 0.25 <= poc_centrality <= 0.75 and symmetry < 0.40:
        return 'D'

    # P: POC en la parte superior (compradores)
    if poc_centrality > 0.60:
        return 'P'

    # b: POC en la parte inferior (vendedores)
    if poc_centrality < 0.40:
        return 'b'

    # Default: D con POC ligeramente descentrado pero simetrico
    return 'D'


def _calculate_d_score(poc_centrality: float, va_concentration: float,
                       symmetry: float, kurtosis: float) -> int:
    """
    Calcula D-Score (0-100). Que tan cercano es al perfil D ideal.
    Ponderacion:
    - POC centrality: 25 pts (ideal 0.5)
    - VA concentration: 25 pts (ideal 0.3-0.6)
    - Symmetry: 25 pts (ideal 0 = perfecta)
    - Kurtosis: 25 pts (ideal > 0.5)
    """
    # POC centrality score (0-25): maximo cuando POC esta en 0.5
    poc_dev = abs(poc_centrality - 0.5)  # 0 a 0.5
    poc_score = max(0, 25 * (1.0 - poc_dev * 2.5))  # 0 a 0.4 dev = OK

    # VA concentration score (0-25): maximo entre 0.3 y 0.6
    if va_concentration < 0.25:
        va_score = va_concentration / 0.25 * 15  # Demasiado estrecho
    elif va_concentration <= 0.65:
        va_score = 25  # Optimo
    elif va_concentration <= 0.85:
        va_score = max(0, 25 * (1.0 - (va_concentration - 0.65) / 0.20 * 0.8))
    else:
        va_score = max(0, 25 * 0.2 * (1.0 - (va_concentration - 0.85) / 0.15))

    # Symmetry score (0-25): maximo cuando symmetry = 0
    sym_score = max(0, 25 * (1.0 - symmetry * 2.0))  # 0 a 0.5 sym = OK

    # Kurtosis score (0-25): maximo cuando kurtosis > 0.5
    if kurtosis >= 0.55:
        kurt_score = 25
    elif kurtosis >= 0.30:
        kurt_score = 25 * (kurtosis - 0.30) / 0.25
    else:
        kurt_score = max(0, 25 * kurtosis / 0.30 * 0.5)

    total = poc_score + va_score + sym_score + kurt_score
    return min(100, max(0, int(round(total))))


# ---------------------------------------------------------------------------
# P/b Trimming
# ---------------------------------------------------------------------------

def trim_pb_to_d(profile: Dict, shape_info: Dict) -> Optional[Dict]:
    """
    Recorta un perfil P o b para extraer la 'D interna'.
    Usa el Value Area como zona recortada (metodo mas robusto).

    Returns:
        {'min_price': float, 'max_price': float, 'poc_price': float,
         'trimmed_from': 'P' | 'b'} o None si no aplica
    """
    shape = shape_info.get('shape_type', '')
    if shape not in ('P', 'b'):
        return None

    vah = profile.get('vah_price', 0)
    val = profile.get('val_price', 0)
    poc_price = profile.get('poc', {}).get('price', 0)

    if vah <= val or vah <= 0:
        return None

    return {
        'min_price': val,
        'max_price': vah,
        'poc_price': poc_price,
        'trimmed_from': shape,
    }


# ---------------------------------------------------------------------------
# Zone Scanner (Backtest - ventana deslizante)
# ---------------------------------------------------------------------------

def scan_zones(candles: List[Dict], config: VPScannerConfig,
               progress_dict: Dict = None) -> List[Dict]:
    """
    Escanea el historico con ventana deslizante buscando perfiles D.
    Fusiona ventanas contiguas con alto d_score en una sola zona.

    Returns:
        Lista de zonas con campos de trade simulado.
    """
    if len(candles) < config.window_size:
        logger.warning(f"Insuficientes velas: {len(candles)} < window_size={config.window_size}")
        return []

    raw_hits = []   # Ventanas con d_score suficiente

    # Paso 1: Escanear ventanas
    step = max(1, config.window_step)
    total_windows = (len(candles) - config.window_size) // step + 1

    # Logging: contadores de diagnostico
    skip_range = 0
    skip_volume = 0
    skip_score = 0
    accepted = 0

    import time as _scan_time
    _scan_start = _scan_time.time()
    logger.info(f"[VP_SCAN] Inicio: {len(candles)} velas, window={config.window_size}, "
                f"step={step}, total_windows={total_windows}, "
                f"max_range={config.max_range_pct}%, min_d_score={config.min_d_score}")
    print(f"[VP_SCAN] Inicio: {len(candles)} velas, {total_windows} ventanas a procesar...")

    _w_count = 0
    for w in range(0, len(candles) - config.window_size + 1, step):
        _w_count += 1
        if _w_count % 200 == 0 or _w_count == total_windows:
            _elapsed = _scan_time.time() - _scan_start
            _pct = _w_count * 100 // max(total_windows, 1)
            print(f"[VP_SCAN] Progreso: {_w_count}/{total_windows} ventanas "
                  f"({_pct}%), "
                  f"aceptadas={accepted}, {_elapsed:.1f}s")
            if progress_dict:
                progress_dict["current"] = _w_count
                progress_dict["total"] = total_windows
                progress_dict["elapsed"] = round(_elapsed, 1)
                progress_dict["zones_found"] = accepted
                if _w_count > 0:
                    avg_per_w = _elapsed / _w_count
                    progress_dict["estimated_remaining"] = round(
                        avg_per_w * (total_windows - _w_count), 1)
        window = candles[w:w + config.window_size]

        # Filtro rapido: rango de precio
        win_min = min(c['low'] for c in window)
        win_max = max(c['high'] for c in window)
        if win_max <= win_min:
            continue
        mid_price = (win_min + win_max) / 2.0
        range_pct = (win_max - win_min) / mid_price * 100
        if range_pct > config.max_range_pct:
            skip_range += 1
            continue

        # Calcular VP
        vp = compute_volume_profile(window, bins=config.bins, va_percent=config.va_percent)
        if vp['total_volume'] <= 0:
            skip_volume += 1
            continue

        # Clasificar forma
        shape = classify_shape(vp)

        # Evaluar si es zona valida
        is_d = shape['shape_type'] == 'D' and shape['d_score'] >= config.min_d_score
        is_pb_trimmed = False
        trimmed = None

        if not is_d and config.include_pb_shapes and shape['shape_type'] in ('P', 'b'):
            # Intentar recortar P/b
            trimmed = trim_pb_to_d(vp, shape)
            if trimmed:
                # Recalcular d_score de la porcion recortada
                # Usamos el VA como zona, asi que la concentracion es alta por definicion
                # Bonus de score por tener D interna detectable
                adjusted_score = int(shape['d_score'] * 0.7 + 20)
                if adjusted_score >= config.min_d_score:
                    is_pb_trimmed = True

        if not is_d and not is_pb_trimmed:
            skip_score += 1
            continue

        accepted += 1

        # Definir limites de la zona
        if is_pb_trimmed and trimmed:
            zone_min = trimmed['min_price']
            zone_max = trimmed['max_price']
            zone_poc = trimmed['poc_price']
            source_shape = f"{shape['shape_type']}_trimmed"
        else:
            zone_min = vp['val_price']
            zone_max = vp['vah_price']
            zone_poc = vp['poc']['price']
            source_shape = 'D'

        raw_hits.append({
            'window_start': w,
            'window_end': w + config.window_size - 1,
            'start_timestamp': window[0]['timestamp'],
            'end_timestamp': window[-1]['timestamp'],
            'min_price': zone_min,
            'max_price': zone_max,
            'poc_price': zone_poc,
            # Rango completo de precios de la ventana (para entry_mode="zone")
            'full_range_min': win_min,
            'full_range_max': win_max,
            'd_score': shape['d_score'] if is_d else adjusted_score,
            'shape_type': source_shape,
            'shape_metrics': shape,
            'vp_summary': {
                'poc_price': vp['poc']['price'],
                'vah_price': vp['vah_price'],
                'val_price': vp['val_price'],
                'total_volume': vp['total_volume'],
            },
            'volume_profile': _build_vp_for_frontend(vp),
            # Indice donde la zona fue detectada por primera vez (fin de esta ventana)
            'detection_candle_idx': w + config.window_size - 1,
        })

    _scan_elapsed = _scan_time.time() - _scan_start
    logger.info(f"[VP_SCAN] Ventanas: {total_windows} total, "
                f"skip_range={skip_range} ({skip_range*100//max(total_windows,1)}%), "
                f"skip_volume={skip_volume}, skip_score={skip_score}, "
                f"accepted={accepted} -> {len(raw_hits)} raw_hits")
    print(f"[VP_SCAN] Escaneo completado en {_scan_elapsed:.1f}s: "
          f"{accepted} aceptadas de {total_windows} ventanas, {len(raw_hits)} raw_hits")

    if not raw_hits:
        logger.info(f"[VP_SCAN] 0 raw_hits - no se detectaron zonas. "
                    f"Razon principal: {'rango excede max_range_pct' if skip_range > skip_score else 'd_score insuficiente'}")
        return []

    # Paso 2: Fusionar ventanas solapadas o contiguas
    merged_zones = _merge_raw_hits(raw_hits, candles, config)

    logger.info(f"[VP_SCAN] Merge: {len(raw_hits)} hits -> {len(merged_zones)} zonas fusionadas")

    return merged_zones


def scan_zones_progressive(candles: List[Dict],
                           config: VPScannerConfig,
                           progress_dict: Dict = None) -> List[Dict]:
    """
    Deteccion progresiva de zonas VP.
    En vez de ventana fija, crece la ventana vela a vela mientras el perfil
    mejora su d_score.  La zona termina por breakout o degradacion del score.

    Flujo:
    1. Buscar inicio de consolidacion (rango < prog_range_pct)
    2. Expandir ventana mientras precio siga dentro del rango
    3. Calcular VP acumulado y d_score en cada expansion
    4. Cerrar zona por breakout o degradacion

    Returns: lista de zonas detectadas (sin trades simulados).
    """
    n = len(candles)
    min_c = max(config.prog_min_candles, 10)

    if n < min_c:
        logger.warning(f"[VP_PROG] Insuficientes velas: {n} < prog_min_candles={min_c}")
        return []

    logger.info(f"[VP_PROG] Inicio: {n} velas, min_candles={min_c}, "
                f"range_pct={config.prog_range_pct}%, stop={config.prog_stop_mode}, "
                f"degrade_bars={config.prog_degrade_bars}, "
                f"thickness={config.prog_thickness_metric}, "
                f"min_d_score={config.min_d_score}")

    zones = []
    i = 0  # Indice de inicio de busqueda

    import time as _prog_time
    _prog_start = _prog_time.time()
    _prog_last_print = _prog_start
    print(f"[VP_PROG] Inicio: {n} velas, min_candles={min_c}, "
          f"range_pct={config.prog_range_pct}%")

    while i <= n - min_c:
        # Progreso periodico (cada 5 segundos)
        _prog_now = _prog_time.time()
        if _prog_now - _prog_last_print >= 5.0:
            _prog_elapsed = _prog_now - _prog_start
            _prog_pct = i * 100 // max(n, 1)
            print(f"[VP_PROG] Progreso: vela {i}/{n} ({_prog_pct}%), "
                  f"zonas={len(zones)}, {_prog_elapsed:.1f}s")
            _prog_last_print = _prog_now
            if progress_dict:
                progress_dict["current"] = i
                progress_dict["total"] = n
                progress_dict["elapsed"] = round(_prog_elapsed, 1)
                progress_dict["zones_found"] = len(zones)
                if i > 0:
                    avg_per_candle = _prog_elapsed / i
                    progress_dict["estimated_remaining"] = round(
                        avg_per_candle * (n - i), 1)
        # --- Fase 1: buscar inicio de consolidacion ---
        # Tomar ventana minima y verificar si el rango es aceptable
        window = candles[i:i + min_c]
        win_min = min(c['low'] for c in window)
        win_max = max(c['high'] for c in window)
        mid = (win_min + win_max) / 2.0
        if mid <= 0:
            i += 1
            continue
        range_pct = (win_max - win_min) / mid * 100

        if range_pct > config.prog_range_pct:
            i += 1
            continue

        # Ventana inicial pasa filtro de rango. Calcular VP y d_score
        vp = compute_volume_profile(window, bins=config.bins, va_percent=config.va_percent)
        if vp['total_volume'] <= 0:
            i += 1
            continue

        shape = classify_shape(vp)

        # Necesitamos que al menos sea clasificable (no thin)
        if shape['shape_type'] == 'thin':
            i += 1
            continue

        # --- Fase 2: expandir ventana progresivamente ---
        zone_start = i
        zone_end = i + min_c - 1  # Ultimo indice incluido
        d_score_history = [shape['d_score']]
        best_d_score = shape['d_score']
        best_end = zone_end
        best_vp = vp
        best_shape = shape
        consecutive_degrade = 0
        consecutive_close_outside = 0
        max_close_outside = max(config.prog_close_outside_bars, 1)
        use_zone_ref = config.prog_close_reference == 'zone'

        # VA actual (del VP inicial)
        current_vah = vp['vah_price']
        current_val = vp['val_price']

        j = zone_end + 1
        while j < n:
            c = candles[j]

            # Verificar si la vela esta dentro del rango de la zona
            # Usamos el rango de la zona acumulada (no el rango fijo del inicio)
            new_min = min(win_min, c['low'])
            new_max = max(win_max, c['high'])
            new_mid = (new_min + new_max) / 2.0
            new_range_pct = (new_max - new_min) / new_mid * 100 if new_mid > 0 else 999

            if new_range_pct > config.prog_range_pct:
                # Vela sale del rango -> breakout natural
                break

            # Check: cierre fuera de referencia (VA o zona completa)
            if use_zone_ref:
                close_high = win_max
                close_low = win_min
            else:
                close_high = current_vah
                close_low = current_val

            if c['close'] > close_high or c['close'] < close_low:
                consecutive_close_outside += 1
                if consecutive_close_outside >= max_close_outside:
                    ref_label = 'zone' if use_zone_ref else 'VA'
                    logger.debug(f"[VP_PROG] Zona cerrada: {consecutive_close_outside} "
                                 f"cierres consecutivos fuera de {ref_label} en idx={j}")
                    break
            else:
                consecutive_close_outside = 0

            # Vela dentro del rango: expandir
            win_min = new_min
            win_max = new_max
            zone_end = j

            # Recalcular VP con toda la ventana expandida
            expanded = candles[zone_start:zone_end + 1]
            vp = compute_volume_profile(expanded, bins=config.bins,
                                        va_percent=config.va_percent)
            if vp['total_volume'] <= 0:
                j += 1
                continue

            shape = classify_shape(vp)
            d_score_history.append(shape['d_score'])

            # Actualizar VA actual con el VP recalculado
            current_vah = vp['vah_price']
            current_val = vp['val_price']

            # Trackear mejor score
            if shape['d_score'] > best_d_score:
                best_d_score = shape['d_score']
                best_end = zone_end
                best_vp = vp
                best_shape = shape
                consecutive_degrade = 0
            else:
                consecutive_degrade += 1

            # Check degradacion (si aplica)
            if config.prog_stop_mode == 'degradation':
                if consecutive_degrade >= config.prog_degrade_bars:
                    logger.debug(f"[VP_PROG] Zona cerrada por degradacion en idx={j}, "
                                 f"best_score={best_d_score}, current={shape['d_score']}")
                    break

            j += 1

        # --- Fase 3: evaluar zona acumulada ---
        n_candles_zone = zone_end - zone_start + 1
        if n_candles_zone < min_c:
            i = zone_end + 1
            continue

        # Usar el VP del mejor momento o el final, segun stop_mode
        if config.prog_stop_mode == 'degradation' and best_end < zone_end:
            # Usar VP hasta el mejor punto (no incluir degradacion)
            final_end = best_end
            final_n = final_end - zone_start + 1
            if final_n < min_c:
                logger.debug(f"[VP_PROG] Zona descartada post-degradation: "
                             f"{final_n} velas < min={min_c}")
                i = zone_end + 1
                continue
            final_candles = candles[zone_start:final_end + 1]
            final_vp = compute_volume_profile(final_candles, bins=config.bins,
                                              va_percent=config.va_percent)
            final_shape = classify_shape(final_vp)
        else:
            final_end = zone_end
            final_candles = candles[zone_start:final_end + 1]
            final_vp = best_vp
            final_shape = best_shape

        final_d = final_shape['d_score']

        # Validar forma: D directo o P/b trimmed
        is_d = final_shape['shape_type'] == 'D' and final_d >= config.min_d_score
        is_pb_ok = False
        trimmed = None

        if not is_d and config.include_pb_shapes and final_shape['shape_type'] in ('P', 'b'):
            trimmed = trim_pb_to_d(final_vp, final_shape)
            if trimmed:
                adj_score = int(final_d * 0.7 + 20)
                if adj_score >= config.min_d_score:
                    is_pb_ok = True
                    final_d = adj_score

        if not is_d and not is_pb_ok:
            logger.debug(f"[VP_PROG] Zona descartada: shape={final_shape['shape_type']} "
                         f"d_score={final_d} < min={config.min_d_score} "
                         f"(start={zone_start}, end={final_end})")
            i = zone_end + 1
            continue

        # Calcular metrica de grosor (thickness)
        if config.prog_thickness_metric == 'poc_ratio':
            poc_vol = final_vp['poc']['volume'] if final_vp.get('poc') else 0
            avg_vol = final_vp['total_volume'] / max(len(final_vp.get('levels', [])), 1)
            thickness = round(poc_vol / avg_vol, 2) if avg_vol > 0 else 0
        else:
            # kurtosis (default)
            thickness = round(final_shape.get('kurtosis_approx', 0), 3)

        # Calcular progressive_quality (metrica sin survival bias)
        # Mide que tan bien la D "engordo" durante la vida de la zona
        d_initial = d_score_history[0] if d_score_history else 0
        d_final = final_d
        # growth_rate: cuanto crecio proporcionalmente (acotado 0-2)
        if d_initial > 0:
            growth_rate = min((d_final - d_initial) / d_initial, 2.0)
        else:
            growth_rate = min(d_final / 50.0, 2.0)  # Normalizar si initial=0
        growth_rate = max(growth_rate, 0.0)  # No penalizar si no crecio

        # consistency: % de transiciones donde el score mejoro o se mantuvo
        if len(d_score_history) > 1:
            improvements = sum(1 for k in range(1, len(d_score_history))
                               if d_score_history[k] >= d_score_history[k - 1])
            consistency = improvements / (len(d_score_history) - 1)
        else:
            consistency = 0.5  # Neutral si solo hay 1 punto

        progressive_quality = round(d_final * (1 + growth_rate) * consistency, 1)

        # Definir limites
        if is_pb_ok and trimmed:
            zone_min = trimmed['min_price']
            zone_max = trimmed['max_price']
            zone_poc = trimmed['poc_price']
            source_shape = f"{final_shape['shape_type']}_trimmed"
        else:
            zone_min = final_vp['val_price']
            zone_max = final_vp['vah_price']
            zone_poc = final_vp['poc']['price']
            source_shape = 'D'

        # detection_candle_idx: la primera vela donde la zona fue "detectable"
        # En progresivo, la zona necesita prog_min_candles para ser evaluada
        # Buscamos el primer momento en d_score_history donde supero min_d_score
        det_offset = 0
        for dsi, ds_val in enumerate(d_score_history):
            if ds_val >= config.min_d_score:
                det_offset = dsi
                break
        else:
            det_offset = len(d_score_history) - 1
        # El d_score_history[0] corresponde a zone_start + min_c - 1
        # Cada entry posterior es zone_start + min_c - 1 + offset
        detection_idx = zone_start + min_c - 1 + det_offset

        zone_dict = {
            'window_start': zone_start,
            'window_end': final_end,
            'start_timestamp': candles[zone_start]['timestamp'],
            'end_timestamp': candles[final_end]['timestamp'],
            'min_price': zone_min,
            'max_price': zone_max,
            'poc_price': zone_poc,
            'full_range_min': final_vp['min_price'],
            'full_range_max': final_vp['max_price'],
            'd_score': final_d,
            'shape_type': source_shape,
            'shape_metrics': final_shape,
            'vp_summary': {
                'poc_price': final_vp['poc']['price'],
                'vah_price': final_vp['vah_price'],
                'val_price': final_vp['val_price'],
                'total_volume': final_vp['total_volume'],
            },
            'volume_profile': _build_vp_for_frontend(final_vp),
            'candle_count': len(final_candles),
            'thickness': thickness,
            'progressive_quality': progressive_quality,
            'd_score_history': d_score_history,
            'detection_mode': 'progressive',
            'detection_candle_idx': detection_idx,
        }
        zones.append(zone_dict)

        logger.info(f"[VP_PROG] Zona #{len(zones)}: idx=[{zone_start}-{final_end}] "
                     f"({len(final_candles)} velas), shape={source_shape}, "
                     f"d_score={final_d}, best={best_d_score}, "
                     f"thickness={thickness}, pq={progressive_quality}, "
                     f"history_len={len(d_score_history)}")

        # Avanzar despues de la zona (no solapar)
        i = final_end + 1

    _prog_elapsed = _prog_time.time() - _prog_start
    logger.info(f"[VP_PROG] Total: {len(zones)} zonas detectadas de {n} velas")
    print(f"[VP_PROG] Completado en {_prog_elapsed:.1f}s: "
          f"{len(zones)} zonas de {n} velas")

    if not zones:
        return []

    return zones


def _merge_raw_hits(raw_hits: List[Dict], candles: List[Dict],
                    config: VPScannerConfig) -> List[Dict]:
    """Fusiona ventanas contiguas/solapadas en zonas unicas."""
    if not raw_hits:
        return []

    merged = []
    current = dict(raw_hits[0])

    for hit in raw_hits[1:]:
        # Verificar si se solapa o esta dentro del gap permitido
        gap = hit['window_start'] - current['window_end']

        if gap <= config.merge_gap:
            # Fusionar: extender zona
            current['window_end'] = max(current['window_end'], hit['window_end'])
            current['end_timestamp'] = max(current['end_timestamp'], hit['end_timestamp'])
            current['min_price'] = min(current['min_price'], hit['min_price'])
            current['max_price'] = max(current['max_price'], hit['max_price'])
            # Fusionar full_range tambien
            current['full_range_min'] = min(
                current.get('full_range_min', current['min_price']),
                hit.get('full_range_min', hit['min_price']))
            current['full_range_max'] = max(
                current.get('full_range_max', current['max_price']),
                hit.get('full_range_max', hit['max_price']))
            # Promediar POC y score
            current['poc_price'] = (current['poc_price'] + hit['poc_price']) / 2.0
            current['d_score'] = max(current['d_score'], hit['d_score'])
            # Preferir D sobre P/b_trimmed
            if hit['shape_type'] == 'D':
                current['shape_type'] = 'D'
            # detection_candle_idx se mantiene del primer hit (ya esta en current)
        else:
            # Nueva zona
            merged.append(current)
            current = dict(hit)

    merged.append(current)

    # Filtrar zonas demasiado cortas, re-validar rango post-merge, recalcular VP
    result = []
    skipped_range = 0
    skipped_short = 0
    skipped_shape = 0
    for zone in merged:
        n_candles = zone['window_end'] - zone['window_start'] + 1
        if n_candles < config.min_zone_candles:
            skipped_short += 1
            continue

        zone['candle_count'] = n_candles

        # Recalcular VP sobre todas las velas de la zona fusionada
        zone_candles = candles[zone['window_start']:zone['window_end'] + 1]
        if zone_candles:
            full_vp = compute_volume_profile(
                zone_candles, bins=config.bins, va_percent=config.va_percent)
            zone['volume_profile'] = _build_vp_for_frontend(full_vp)

            # Re-definir limites de zona usando VA del VP fusionado
            # Esto corrige zonas que se expandieron demasiado durante el merge
            zone['min_price'] = full_vp['val_price']
            zone['max_price'] = full_vp['vah_price']
            zone['poc_price'] = full_vp['poc']['price']
            # Full range = rango completo de precios de las velas de la zona
            zone['full_range_min'] = full_vp['min_price']
            zone['full_range_max'] = full_vp['max_price']

            # Re-clasificar forma del VP fusionado
            # El merge puede cambiar D->B/P, debemos re-validar
            merged_shape = classify_shape(full_vp)
            zone['shape_type'] = merged_shape['shape_type']
            zone['d_score'] = merged_shape['d_score']
            zone['shape_metrics'] = merged_shape

            is_d = merged_shape['shape_type'] == 'D' and merged_shape['d_score'] >= config.min_d_score
            is_pb_ok = False
            if not is_d and config.include_pb_shapes and merged_shape['shape_type'] in ('P', 'b'):
                trimmed = trim_pb_to_d(full_vp, merged_shape)
                if trimmed:
                    adj_score = int(merged_shape['d_score'] * 0.7 + 20)
                    if adj_score >= config.min_d_score:
                        is_pb_ok = True
                        zone['min_price'] = trimmed['min_price']
                        zone['max_price'] = trimmed['max_price']
                        zone['poc_price'] = trimmed['poc_price']
                        zone['d_score'] = adj_score
                        zone['shape_type'] = f"{merged_shape['shape_type']}_trimmed"

            if not is_d and not is_pb_ok:
                skipped_shape += 1
                logger.info(f"[VP_MERGE] Zona descartada post-merge: shape={merged_shape['shape_type']} "
                            f"d_score={merged_shape['d_score']} < min={config.min_d_score} "
                            f"(include_pb={config.include_pb_shapes}, ts={zone['start_timestamp']})")
                continue

        # Re-validar rango post-merge
        mid = (zone['max_price'] + zone['min_price']) / 2.0
        if mid > 0:
            merged_range_pct = (zone['max_price'] - zone['min_price']) / mid * 100
            if merged_range_pct > config.max_range_pct:
                logger.info(f"[VP_MERGE] Zona descartada post-merge: rango={merged_range_pct:.2f}% > max={config.max_range_pct}% "
                            f"(ts={zone['start_timestamp']}, {zone['min_price']:.2f}-{zone['max_price']:.2f})")
                skipped_range += 1
                continue

        result.append(zone)

    if skipped_range > 0 or skipped_short > 0 or skipped_shape > 0:
        logger.info(f"[VP_MERGE] Post-filtro: {len(merged)} merged -> {len(result)} finales "
                    f"(descartadas: {skipped_range} por rango, {skipped_short} por min_candles, "
                    f"{skipped_shape} por forma B/P)")

    return result


def _simulate_trades(zones: List[Dict], candles: List[Dict],
                     config: VPScannerConfig) -> List[Dict]:
    """Despacha simulacion de trades segun entry_strategy."""
    import time as _sim_time
    logger.info(f"[VP_TRADES] Simulando {len(zones)} zonas, strategy={config.entry_strategy}, "
                f"mode={config.position_mode}, sl_mode={config.sl_mode}, tp_rr={config.tp_rr_ratio}")
    print(f"[VP_TRADES] Simulando {len(zones)} zonas, strategy={config.entry_strategy}...")

    _sim_start = _sim_time.time()
    if config.entry_strategy == 'mean_reversion':
        result = _simulate_mean_reversion(zones, candles, config)
    elif config.entry_strategy == 'retest':
        result = _simulate_retest(zones, candles, config)
    else:
        result = _simulate_breakout(zones, candles, config)

    _sim_elapsed = _sim_time.time() - _sim_start
    wins = sum(1 for z in result if z.get('trade_result') == 'WIN')
    losses = sum(1 for z in result if z.get('trade_result') == 'LOSS')
    print(f"[VP_TRADES] Simulacion completada en {_sim_elapsed:.1f}s: "
          f"{wins}W / {losses}L de {len(result)} zonas")
    return result


# ---------------------------------------------------------------------------
# Helpers compartidos entre estrategias
# ---------------------------------------------------------------------------

def _resolve_trade(candles: List[Dict], entry_idx: int, entry_price: float,
                   sl_price: float, tp_price: float,
                   direction: str) -> Tuple[str, float, Optional[int]]:
    """Monitorea SL/TP desde entry_idx+1 hasta el final.
    Returns: (result, pnl_r, close_ts)"""
    tp_rr = abs(tp_price - entry_price) / abs(entry_price - sl_price) if abs(entry_price - sl_price) > 0 else 2.0

    for j in range(entry_idx + 1, len(candles)):
        tc = candles[j]
        if direction == 'UP':
            hit_tp = tc['high'] >= tp_price
            hit_sl = tc['low'] <= sl_price
        else:
            hit_tp = tc['low'] <= tp_price
            hit_sl = tc['high'] >= sl_price

        if hit_sl and hit_tp:
            if direction == 'UP':
                hit_sl_first = tc['open'] <= sl_price
            else:
                hit_sl_first = tc['open'] >= sl_price
            if hit_sl_first:
                hit_tp = False
            else:
                hit_sl = False

        if hit_tp:
            return 'WIN', round(tp_rr, 2), tc['timestamp']
        elif hit_sl:
            return 'LOSS', -1.0, tc['timestamp']

    return 'OPEN', 0.0, None


def _calc_risk_and_sl(config: VPScannerConfig, zone: Dict,
                      entry_price: float, direction: str,
                      sl_mode: str = None, buffer_pct: float = None) -> Tuple[float, float]:
    """Calcula risk y sl_price basado en sl_mode.
    Returns: (risk, sl_price)"""
    _sl_mode = sl_mode or config.sl_mode
    _buffer_pct = buffer_pct if buffer_pct is not None else config.sl_buffer_pct

    zone_high = zone['max_price']
    zone_low = zone['min_price']
    zone_range = zone_high - zone_low
    poc = zone['poc_price']

    if _sl_mode == 'beyond_poc':
        buf = 1.0 + _buffer_pct / 100.0
        if direction == 'UP':
            risk = (entry_price - poc) * buf
        else:
            risk = (poc - entry_price) * buf
    elif _sl_mode == 'below_va' or _sl_mode == 'beyond_va':
        buf = 1.0 + _buffer_pct / 100.0
        if direction == 'UP':
            risk = (entry_price - zone_low) * buf
        else:
            risk = (zone_high - entry_price) * buf
    elif _sl_mode == 'beyond_zone' or _sl_mode == 'below_zone' or _sl_mode == 'zone_opposite':
        full_low = zone.get('full_range_min', zone_low)
        full_high = zone.get('full_range_max', zone_high)
        full_range = full_high - full_low
        if direction == 'UP':
            risk = entry_price - full_low + full_range * _buffer_pct / 100
        else:
            risk = full_high - entry_price + full_range * _buffer_pct / 100
    else:
        # Default: below_va
        buf = 1.0 + _buffer_pct / 100.0
        if direction == 'UP':
            risk = (entry_price - zone_low) * buf
        else:
            risk = (zone_high - entry_price) * buf

    if risk <= 0:
        risk = zone_range * 0.5

    if direction == 'UP':
        sl_price = entry_price - risk
    else:
        sl_price = entry_price + risk

    return risk, sl_price


def _zone_search_bounds(zone: Dict, config: VPScannerConfig, total_candles: int):
    """Calcula indices de busqueda dentro/despues de la zona."""
    zone_start_idx = zone['window_start']
    zone_end_idx = zone['window_end']
    detection_idx = zone.get('detection_candle_idx', zone_end_idx)
    if config.detection_mode == 'progressive':
        min_consol = max(config.prog_min_candles, config.min_zone_candles, 10)
    else:
        min_consol = max(config.min_zone_candles, 10)
    # No buscar entries antes de la deteccion de la zona
    search_start = max(zone_start_idx + min_consol, detection_idx)
    search_end = min(zone_end_idx + config.lookforward_bars, total_candles)
    return zone_start_idx, zone_end_idx, search_start, search_end


def _clip_zone_at_breakout(zone: Dict, breakout_candle_idx: int, candles: List[Dict],
                           config: VPScannerConfig) -> bool:
    """Recorta zona al breakout y revalida VP. Returns True si zona valida, False si descartar."""
    zone_start_idx = zone['window_start']
    if breakout_candle_idx <= zone_start_idx:
        return True

    consol_last_idx = breakout_candle_idx - 1
    if consol_last_idx < zone_start_idx:
        return True

    zone['end_timestamp'] = candles[consol_last_idx]['timestamp']
    zone['window_end'] = consol_last_idx

    consol_candles = candles[zone_start_idx:consol_last_idx + 1]
    if len(consol_candles) < 5:
        return True

    consol_vp = compute_volume_profile(consol_candles, bins=config.bins, va_percent=config.va_percent)
    zone['volume_profile'] = _build_vp_for_frontend(consol_vp)
    zone['min_price'] = consol_vp['val_price']
    zone['max_price'] = consol_vp['vah_price']
    zone['poc_price'] = consol_vp['poc']['price']
    zone['full_range_min'] = consol_vp['min_price']
    zone['full_range_max'] = consol_vp['max_price']
    zone['candle_count'] = len(consol_candles)

    cut_shape = classify_shape(consol_vp)
    zone['shape_type'] = cut_shape['shape_type']
    zone['d_score'] = cut_shape['d_score']
    zone['shape_metrics'] = cut_shape

    is_d_cut = cut_shape['shape_type'] == 'D' and cut_shape['d_score'] >= config.min_d_score
    is_pb_cut_ok = False

    if not is_d_cut and cut_shape['shape_type'] in ('P', 'b'):
        if config.include_pb_shapes:
            cut_trim = trim_pb_to_d(consol_vp, cut_shape)
            if cut_trim:
                adj = int(cut_shape['d_score'] * 0.7 + 20)
                if adj >= config.min_d_score:
                    is_pb_cut_ok = True
                    zone['min_price'] = cut_trim['min_price']
                    zone['max_price'] = cut_trim['max_price']
                    zone['poc_price'] = cut_trim['poc_price']
                    zone['d_score'] = adj
                    zone['shape_type'] = f"{cut_shape['shape_type']}_trimmed"

    return is_d_cut or is_pb_cut_ok


def _calc_volume_zscore(candles: List[Dict], idx: int, lookback: int = 20) -> float:
    """Calcula z-score de volumen de la vela idx vs las anteriores."""
    start = max(0, idx - lookback)
    vols = [c.get('volume', 0) for c in candles[start:idx]]
    if len(vols) < 5:
        return 0.0
    mean_v = sum(vols) / len(vols)
    if mean_v <= 0:
        return 0.0
    variance = sum((v - mean_v) ** 2 for v in vols) / len(vols)
    std_v = variance ** 0.5
    if std_v <= 0:
        return 0.0
    return (candles[idx].get('volume', 0) - mean_v) / std_v


def _prepare_zone_common(zone: Dict, zone_idx: int, strategy: str,
                         candles: List[Dict], config: VPScannerConfig
                         ) -> Optional[Dict]:
    """Preparacion comun para las 3 estrategias:
    - Asigna id, source, entry_strategy
    - Calcula detection_timestamp
    - Busca breakout y recorta zona (clip)
    - Retorna info del breakout o None si zona invalida post-clip

    Returns dict con:
        breakout_found, breakout_idx, breakout_dir,
        zone_start_idx, zone_end_idx, detection_idx,
        bo_high, bo_low, zone_high, zone_low, poc,
        full_high, full_low, zone_range
    O None si la zona debe descartarse (shape invalida post-clip).
    """
    zone_id = f"vp_{zone['start_timestamp']}_{zone_idx}"
    zone['id'] = zone_id
    zone['source'] = 'vp_scanner'
    zone['entry_strategy'] = strategy

    zone_start_idx, zone_end_idx, search_start, search_end = \
        _zone_search_bounds(zone, config, len(candles))

    detection_idx = zone.get('detection_candle_idx', zone_end_idx)
    if detection_idx < len(candles):
        zone['detection_timestamp'] = candles[detection_idx]['timestamp']

    if config.entry_mode == 'zone':
        bo_high = zone.get('full_range_max', zone['max_price'])
        bo_low = zone.get('full_range_min', zone['min_price'])
    else:
        bo_high = zone['max_price']
        bo_low = zone['min_price']

    zone_high = zone['max_price']
    zone_low = zone['min_price']
    zone_range = zone_high - zone_low

    if zone_range <= 0:
        zone['trade_result'] = 'SKIPPED'
        zone['trade_pnl_r'] = 0
        return None

    # Buscar breakout (compartido entre las 3 estrategias)
    need_confirm = max(0, config.breakout_confirm_bars)
    breakout_found = False
    confirm_count = 0
    breakout_dir = None
    breakout_idx = None

    for i in range(search_start, search_end):
        c = candles[i]
        if c['close'] > bo_high:
            if breakout_dir == 'UP':
                confirm_count += 1
            else:
                breakout_dir = 'UP'
                confirm_count = 1
        elif c['close'] < bo_low:
            if breakout_dir == 'DOWN':
                confirm_count += 1
            else:
                breakout_dir = 'DOWN'
                confirm_count = 1
        else:
            confirm_count = 0
            breakout_dir = None

        if breakout_dir and confirm_count >= max(1, need_confirm):
            breakout_idx = i
            breakout_found = True
            break

    # Clip de zona al breakout (recalcula VP, d_score, limites)
    if breakout_found:
        if not _clip_zone_at_breakout(zone, breakout_idx, candles, config):
            zone['trade_result'] = 'SKIPPED'
            zone['trade_pnl_r'] = 0
            zone['skip_reason'] = 'shape_invalid_after_cut'
            return None
        zone['breakout_direction'] = breakout_dir
        zone['breakout_timestamp'] = candles[breakout_idx]['timestamp']
        # Actualizar limites post-clip
        zone_end_idx = zone['window_end']
        zone_high = zone['max_price']
        zone_low = zone['min_price']
        zone_range = zone_high - zone_low
        bo_high = zone.get('full_range_max', zone_high) if config.entry_mode == 'zone' else zone_high
        bo_low = zone.get('full_range_min', zone_low) if config.entry_mode == 'zone' else zone_low

    poc = zone['poc_price']
    full_high = zone.get('full_range_max', zone_high)
    full_low = zone.get('full_range_min', zone_low)

    return {
        'breakout_found': breakout_found,
        'breakout_idx': breakout_idx,
        'breakout_dir': breakout_dir,
        'zone_start_idx': zone_start_idx,
        'zone_end_idx': zone_end_idx,
        'search_start': search_start,
        'search_end': search_end,
        'detection_idx': detection_idx,
        'bo_high': bo_high,
        'bo_low': bo_low,
        'zone_high': zone_high,
        'zone_low': zone_low,
        'poc': poc,
        'full_high': full_high,
        'full_low': full_low,
        'zone_range': zone_range,
    }


# ---------------------------------------------------------------------------
# Estrategia 1: BREAKOUT (original, con filtros refinados)
# ---------------------------------------------------------------------------

def _simulate_breakout(zones: List[Dict], candles: List[Dict],
                       config: VPScannerConfig) -> List[Dict]:
    """Simula trades de breakout (estrategia original, con filtros opcionales)."""
    results = []
    open_trade = None
    _total_zones = len(zones)

    for zone_idx, zone in enumerate(zones):
        if _total_zones > 20 and (zone_idx + 1) % 50 == 0:
            print(f"[VP_BO] Zona {zone_idx + 1}/{_total_zones}...")
        info = _prepare_zone_common(zone, zone_idx, 'breakout', candles, config)
        if info is None:
            results.append(zone)
            continue

        if not info['breakout_found']:
            zone['trade_result'] = 'NO_BREAKOUT'
            zone['trade_pnl_r'] = 0
            zone['state'] = 'COMPLETE'
            results.append(zone)
            continue

        breakout_idx = info['breakout_idx']
        breakout_dir = info['breakout_dir']
        search_start = info['search_start']

        # Filtros adicionales de breakout (volumen y momentum)
        skip_trade = False

        if config.position_mode == 'sequential' and open_trade is not None:
            zone['trade_result'] = 'SKIPPED'
            zone['trade_pnl_r'] = 0
            zone['skip_reason'] = 'sequential_blocked'
            results.append(zone)
            continue

        if config.bo_volume_filter:
            vscore = _calc_volume_zscore(candles, breakout_idx, 20)
            if vscore < config.bo_volume_zscore:
                logger.info(f"[VP_BO] #{zone_idx} breakout filtrado por volumen "
                            f"(zscore={vscore:.2f} < {config.bo_volume_zscore})")
                skip_trade = True

        if not skip_trade and config.bo_momentum_bars > 0:
            mo_start = max(search_start, breakout_idx - config.bo_momentum_bars)
            closes = [candles[k]['close'] for k in range(mo_start, breakout_idx)]
            if len(closes) >= 3:
                trend = closes[-1] - closes[0]
                if (breakout_dir == 'UP' and trend < 0) or \
                   (breakout_dir == 'DOWN' and trend > 0):
                    logger.info(f"[VP_BO] #{zone_idx} breakout filtrado por momentum "
                                f"(dir={breakout_dir}, trend={trend:.2f})")
                    skip_trade = True

        if skip_trade:
            zone['trade_result'] = 'SKIPPED'
            zone['trade_pnl_r'] = 0
            zone['skip_reason'] = 'filter_rejected'
            results.append(zone)
            continue

        # Ejecutar trade de breakout
        c = candles[breakout_idx]
        entry_price = c['close']
        entry_ts = c['timestamp']

        risk, sl_price = _calc_risk_and_sl(config, zone, entry_price, breakout_dir)

        if breakout_dir == 'UP':
            tp_price = entry_price + risk * config.tp_rr_ratio
        else:
            tp_price = entry_price - risk * config.tp_rr_ratio

        trade_result, trade_pnl_r, close_ts = \
            _resolve_trade(candles, breakout_idx, entry_price, sl_price, tp_price, breakout_dir)

        zone['entry_price'] = entry_price
        zone['entry_timestamp'] = entry_ts
        zone['sl_price'] = sl_price
        zone['tp_price'] = tp_price
        zone['risk'] = risk
        zone['trade_result'] = trade_result
        zone['trade_pnl_r'] = trade_pnl_r
        zone['trade_close_timestamp'] = close_ts
        zone['state'] = 'RESOLVED' if trade_result in ('WIN', 'LOSS') else 'OPEN'

        if trade_result == 'OPEN':
            open_trade = zone
        elif trade_result in ('WIN', 'LOSS'):
            open_trade = None

        results.append(zone)

    return results


# ---------------------------------------------------------------------------
# Estrategia 2: MEAN REVERSION (rebote dentro de la zona)
# ---------------------------------------------------------------------------

def _simulate_mean_reversion(zones: List[Dict], candles: List[Dict],
                             config: VPScannerConfig) -> List[Dict]:
    """Simula trades de mean reversion: comprar en VAL, vender en VAH (o POC)."""
    results = []
    open_trade = None

    logger.info(f"[VP_MR] Mean reversion: target={config.mr_target}, "
                f"entry_zone={config.mr_entry_zone}, confirm={config.mr_confirm}, "
                f"max_trades/zone={config.mr_max_trades_per_zone}")
    _total_zones = len(zones)

    for zone_idx, zone in enumerate(zones):
        if _total_zones > 20 and (zone_idx + 1) % 50 == 0:
            print(f"[VP_MR] Zona {zone_idx + 1}/{_total_zones}...")
        info = _prepare_zone_common(zone, zone_idx, 'mean_reversion', candles, config)
        if info is None:
            results.append(zone)
            continue

        # Limites de entry segun mr_entry_zone (post-clip)
        if config.mr_entry_zone == 'zone':
            entry_high = zone.get('full_range_max', zone['max_price'])
            entry_low = zone.get('full_range_min', zone['min_price'])
        else:
            entry_high = info['zone_high']  # VAH
            entry_low = info['zone_low']    # VAL

        poc = info['poc']
        zone_high = info['zone_high']
        zone_low = info['zone_low']
        full_high = info['full_high']
        full_low = info['full_low']
        zone_range = info['zone_range']
        zone_start_idx = info['zone_start_idx']
        zone_end_idx = info['zone_end_idx']
        detection_idx = info['detection_idx']

        # Buscar entries SOLO dentro de la zona y SOLO despues de que fue detectada
        earliest_entry = max(
            zone_start_idx + max(config.mr_min_zone_candles, 10),
            detection_idx
        )
        search_start = earliest_entry
        # Mean reversion opera SOLO dentro de la zona (post-clip)
        search_end = min(zone_end_idx, len(candles))

        mr_trades = []
        trades_in_zone = 0
        cooldown_until_idx = 0

        # Para swing confirmation: rastrear extremos de toques
        swing_candidate_dir = None    # 'UP' o 'DOWN'
        swing_extreme_idx = -1        # indice de la vela con el extremo
        swing_extreme_val = 0         # valor del extremo (low o high)

        i = search_start
        while i < search_end and trades_in_zone < config.mr_max_trades_per_zone:
            c = candles[i]

            if config.position_mode == 'sequential' and open_trade is not None:
                i += 1
                continue

            if i < cooldown_until_idx:
                i += 1
                continue

            if c['close'] > full_high or c['close'] < full_low:
                # Breakout - resetear swing candidate
                swing_candidate_dir = None
                i += 1
                continue

            trade_dir = None
            entry_idx = i  # por defecto, entrada en la vela actual

            if config.mr_confirm == 'swing':
                # --- SWING CONFIRMATION ---
                # Fase 1: Detectar toque y rastrear extremo
                if c['low'] <= entry_low:
                    if swing_candidate_dir != 'UP' or c['low'] < swing_extreme_val:
                        swing_candidate_dir = 'UP'
                        swing_extreme_idx = i
                        swing_extreme_val = c['low']
                elif c['high'] >= entry_high:
                    if swing_candidate_dir != 'DOWN' or c['high'] > swing_extreme_val:
                        swing_candidate_dir = 'DOWN'
                        swing_extreme_idx = i
                        swing_extreme_val = c['high']

                # Fase 2: Verificar si el swing se confirmo
                swing_n = config.mr_swing_bars
                if swing_candidate_dir and swing_extreme_idx >= 0 and i >= swing_extreme_idx + swing_n:
                    is_swing = True
                    for s in range(1, swing_n + 1):
                        check_idx = swing_extreme_idx + s
                        if check_idx >= len(candles):
                            is_swing = False
                            break
                        if swing_candidate_dir == 'UP':
                            if candles[check_idx]['low'] < swing_extreme_val:
                                is_swing = False
                                break
                        else:
                            if candles[check_idx]['high'] > swing_extreme_val:
                                is_swing = False
                                break

                    if is_swing:
                        trade_dir = swing_candidate_dir
                        entry_idx = swing_extreme_idx + swing_n
                        swing_candidate_dir = None
                        swing_extreme_idx = -1
            else:
                # --- TOUCH / REJECTION ---
                if c['low'] <= entry_low:
                    if config.mr_confirm == 'touch':
                        trade_dir = 'UP'
                    elif config.mr_confirm == 'rejection':
                        if c['close'] > entry_low and c['close'] < entry_high:
                            trade_dir = 'UP'

                elif c['high'] >= entry_high:
                    if config.mr_confirm == 'touch':
                        trade_dir = 'DOWN'
                    elif config.mr_confirm == 'rejection':
                        if c['close'] < entry_high and c['close'] > entry_low:
                            trade_dir = 'DOWN'

            if trade_dir:
                entry_price = candles[entry_idx]['close']
                entry_ts = candles[entry_idx]['timestamp']

                if config.mr_target == 'poc':
                    tp_price = poc
                elif config.mr_target == 'opposite_va':
                    tp_price = zone_high if trade_dir == 'UP' else zone_low
                else:  # opposite_zone
                    tp_price = full_high if trade_dir == 'UP' else full_low

                risk, sl_price = _calc_risk_and_sl(
                    config, zone, entry_price, trade_dir,
                    sl_mode=config.mr_sl_mode, buffer_pct=config.mr_sl_buffer_pct)

                if trade_dir == 'UP' and tp_price <= entry_price:
                    tp_price = entry_price + zone_range * 0.3
                elif trade_dir == 'DOWN' and tp_price >= entry_price:
                    tp_price = entry_price - zone_range * 0.3

                trade_result, trade_pnl_r, close_ts = \
                    _resolve_trade(candles, entry_idx, entry_price, sl_price, tp_price, trade_dir)

                mr_trade = {
                    'direction': trade_dir,
                    'entry_price': entry_price,
                    'entry_timestamp': entry_ts,
                    'sl_price': sl_price,
                    'tp_price': tp_price,
                    'risk': risk,
                    'trade_result': trade_result,
                    'trade_pnl_r': trade_pnl_r,
                    'trade_close_timestamp': close_ts,
                }
                mr_trades.append(mr_trade)
                trades_in_zone += 1

                if trade_result == 'OPEN':
                    open_trade = mr_trade
                elif trade_result in ('WIN', 'LOSS'):
                    open_trade = None
                    if close_ts:
                        for skip_j in range(i + 1, len(candles)):
                            if candles[skip_j]['timestamp'] >= close_ts:
                                i = skip_j
                                cooldown_until_idx = skip_j + 3
                                break

            i += 1

        # Guardar resultados en la zona
        if mr_trades:
            best = mr_trades[0]
            zone['entry_price'] = best['entry_price']
            zone['entry_timestamp'] = best['entry_timestamp']
            zone['sl_price'] = best['sl_price']
            zone['tp_price'] = best['tp_price']
            zone['risk'] = best['risk']
            zone['trade_close_timestamp'] = best['trade_close_timestamp']
            zone['state'] = 'RESOLVED'

            zone['mr_trades'] = mr_trades

            total_pnl = sum(t['trade_pnl_r'] for t in mr_trades)
            resolved_trades = [t for t in mr_trades if t['trade_result'] in ('WIN', 'LOSS')]
            zone_wins = sum(1 for t in resolved_trades if t['trade_result'] == 'WIN')

            zone['trade_result'] = 'WIN' if total_pnl > 0 else ('LOSS' if total_pnl < 0 else 'OPEN')
            zone['trade_pnl_r'] = round(total_pnl, 2)
            zone['mr_trade_count'] = len(mr_trades)
            zone['mr_win_count'] = zone_wins
        else:
            zone['trade_result'] = 'NO_ENTRY'
            zone['trade_pnl_r'] = 0
            zone['state'] = 'COMPLETE'

        results.append(zone)

    return results


# ---------------------------------------------------------------------------
# Estrategia 3: RETEST (breakout + pullback a la zona)
# ---------------------------------------------------------------------------

def _simulate_retest(zones: List[Dict], candles: List[Dict],
                     config: VPScannerConfig) -> List[Dict]:
    """Simula trades de retest: espera breakout, luego pullback a la zona antes de entrar."""
    results = []
    open_trade = None

    logger.info(f"[VP_RT] Retest: level={config.rt_level}, confirm={config.rt_confirm}, "
                f"max_bars={config.rt_max_bars}, sl_mode={config.rt_sl_mode}")
    _total_zones = len(zones)

    for zone_idx, zone in enumerate(zones):
        if _total_zones > 20 and (zone_idx + 1) % 50 == 0:
            print(f"[VP_RT] Zona {zone_idx + 1}/{_total_zones}...")
        info = _prepare_zone_common(zone, zone_idx, 'retest', candles, config)
        if info is None:
            results.append(zone)
            continue

        if not info['breakout_found']:
            zone['trade_result'] = 'NO_BREAKOUT'
            zone['trade_pnl_r'] = 0
            zone['state'] = 'COMPLETE'
            results.append(zone)
            continue

        breakout_idx = info['breakout_idx']
        breakout_dir = info['breakout_dir']
        zone_high = info['zone_high']
        zone_low = info['zone_low']
        poc = info['poc']
        full_high = info['full_high']
        full_low = info['full_low']
        zone_range = info['zone_range']

        # Determinar nivel de retest
        if config.rt_level == 'poc':
            rt_target = poc
        elif config.rt_level == 'zone':
            rt_target = full_high if breakout_dir == 'UP' else full_low
        else:  # "va" default
            rt_target = zone_high if breakout_dir == 'UP' else zone_low

        # FASE 2: Buscar retest (pullback al nivel)
        retest_start = breakout_idx + 1
        retest_end = min(breakout_idx + 1 + config.rt_max_bars, len(candles))

        retest_found = False
        retest_low = float('inf')
        retest_high = float('-inf')
        retest_low_idx = -1
        retest_high_idx = -1

        for k in range(retest_start, retest_end):
            rc = candles[k]

            # Rastrear extremos del pullback
            if rc['low'] < retest_low:
                retest_low = rc['low']
                retest_low_idx = k
            if rc['high'] > retest_high:
                retest_high = rc['high']
                retest_high_idx = k

            touched_level = False
            if breakout_dir == 'UP':
                touched_level = rc['low'] <= rt_target
            else:
                touched_level = rc['high'] >= rt_target

            if not touched_level:
                continue

            # Nivel tocado - verificar confirmacion
            entry_ok = False
            entry_idx = k

            if config.rt_confirm == 'touch':
                entry_ok = True

            elif config.rt_confirm == 'rejection':
                if breakout_dir == 'UP':
                    # La vela toca rt_target por abajo pero cierra por encima
                    entry_ok = rc['close'] > rt_target
                    if config.rt_must_reenter:
                        entry_ok = entry_ok and rc['close'] > zone_low
                else:
                    entry_ok = rc['close'] < rt_target
                    if config.rt_must_reenter:
                        entry_ok = entry_ok and rc['close'] < zone_high

            elif config.rt_confirm == 'swing':
                # Buscar swing low (UP) o swing high (DOWN) confirmado por N velas
                swing_n = config.rt_swing_bars
                if breakout_dir == 'UP':
                    # Buscar el swing low del pullback
                    # Necesitamos esperar swing_n velas despues del minimo
                    if retest_low_idx >= 0 and k >= retest_low_idx + swing_n:
                        # Verificar que todas las N velas despues del minimo tienen lows mayores
                        is_swing = True
                        for s in range(1, swing_n + 1):
                            check_idx = retest_low_idx + s
                            if check_idx >= len(candles):
                                is_swing = False
                                break
                            if candles[check_idx]['low'] < retest_low:
                                is_swing = False
                                break
                        if is_swing:
                            entry_ok = True
                            entry_idx = retest_low_idx + swing_n  # Entrar en la vela de confirmacion
                else:
                    if retest_high_idx >= 0 and k >= retest_high_idx + swing_n:
                        is_swing = True
                        for s in range(1, swing_n + 1):
                            check_idx = retest_high_idx + s
                            if check_idx >= len(candles):
                                is_swing = False
                                break
                            if candles[check_idx]['high'] > retest_high:
                                is_swing = False
                                break
                        if is_swing:
                            entry_ok = True
                            entry_idx = retest_high_idx + swing_n

            if entry_ok:
                # Sequential check
                if config.position_mode == 'sequential' and open_trade is not None:
                    zone['trade_result'] = 'SKIPPED'
                    zone['trade_pnl_r'] = 0
                    zone['skip_reason'] = 'sequential_blocked'
                    retest_found = True
                    break

                entry_price = candles[entry_idx]['close']
                entry_ts = candles[entry_idx]['timestamp']

                # Calcular SL segun rt_sl_mode
                if config.rt_sl_mode == 'below_retest':
                    buffer_pct = config.sl_buffer_pct
                    if breakout_dir == 'UP':
                        # SL debajo del punto mas bajo del pullback
                        risk = (entry_price - retest_low) * (1.0 + buffer_pct / 100.0)
                    else:
                        risk = (retest_high - entry_price) * (1.0 + buffer_pct / 100.0)
                    if risk <= 0:
                        risk = zone_range * 0.3
                    if breakout_dir == 'UP':
                        sl_price = entry_price - risk
                    else:
                        sl_price = entry_price + risk
                else:
                    # Usar modos estandar
                    risk, sl_price = _calc_risk_and_sl(
                        config, zone, entry_price, breakout_dir,
                        sl_mode=config.rt_sl_mode, buffer_pct=config.sl_buffer_pct)

                if breakout_dir == 'UP':
                    tp_price = entry_price + risk * config.tp_rr_ratio
                else:
                    tp_price = entry_price - risk * config.tp_rr_ratio

                trade_result, trade_pnl_r, close_ts = \
                    _resolve_trade(candles, entry_idx, entry_price, sl_price, tp_price, breakout_dir)

                zone['entry_price'] = entry_price
                zone['entry_timestamp'] = entry_ts
                zone['retest_timestamp'] = candles[k]['timestamp']
                zone['sl_price'] = sl_price
                zone['tp_price'] = tp_price
                zone['risk'] = risk
                zone['trade_result'] = trade_result
                zone['trade_pnl_r'] = trade_pnl_r
                zone['trade_close_timestamp'] = close_ts
                zone['state'] = 'RESOLVED' if trade_result in ('WIN', 'LOSS') else 'OPEN'

                if trade_result == 'OPEN':
                    open_trade = zone
                elif trade_result in ('WIN', 'LOSS'):
                    open_trade = None

                retest_found = True
                logger.info(f"[VP_RT] #{zone_idx} {breakout_dir} retest entry={entry_price:.2f} "
                            f"SL={sl_price:.2f} TP={tp_price:.2f} -> {trade_result}")
                break

        if not retest_found:
            zone['trade_result'] = 'NO_RETEST'
            zone['trade_pnl_r'] = 0
            zone['state'] = 'COMPLETE'

        results.append(zone)

    return results


# ---------------------------------------------------------------------------
# Incremental VP Scanner (Realtime)
# ---------------------------------------------------------------------------

class IncrementalVPScanner:
    """
    Scanner VP incremental para tiempo real.
    Mantiene buffer circular y actualiza VP vela a vela.

    Estados:
    - SCANNING: Buscando perfil D
    - ZONE_ACTIVE: Zona D detectada, monitoreando estabilidad
    - BREAKOUT_PENDING: Precio salio del VA, esperando confirmacion
    - RESOLVED: Trade cerrado (WIN/LOSS)
    """

    def __init__(self, symbol: str, config: VPScannerConfig,
                 backtest_mode: bool = False):
        self.symbol = symbol
        self.config = config
        self._backtest_mode = backtest_mode

        # Buffer de velas
        self._candles: List[Dict] = []
        self._max_buffer = max(config.window_size * 3, 500)

        # VP State
        self._current_vp: Optional[Dict] = None
        self._current_shape: Optional[Dict] = None
        self._zone_start_ts: Optional[int] = None
        self._zone_min: float = 0
        self._zone_max: float = 0
        self._zone_poc: float = 0
        self._zone_candle_count: int = 0
        self._consecutive_d: int = 0  # Ventanas consecutivas con D

        # State machine
        self._state: str = 'SCANNING'

        # Active zone
        self._active_zone: Optional[Dict] = None

        # Breakout tracking
        self._breakout_dir: Optional[str] = None
        self._breakout_count: int = 0

        # Trades
        self._open_trades: List[Dict] = []
        self._resolved_zones: List[Dict] = []
        self._max_resolved = 50

        # Zone counter
        self._zone_counter: int = 0

    def warmup(self, candles: List[Dict]):
        """Carga velas iniciales sin procesar."""
        for c in candles:
            self._candles.append(c)
        if len(self._candles) > self._max_buffer:
            self._candles = self._candles[-self._max_buffer:]

    def process_candle(self, candle: Dict) -> List[Dict]:
        """
        Procesa una vela nueva. Retorna lista de eventos.
        """
        events = []

        # Agregar al buffer
        self._candles.append(candle)
        if len(self._candles) > self._max_buffer:
            self._candles = self._candles[-self._max_buffer:]

        # Necesitamos suficientes velas
        if len(self._candles) < self.config.window_size:
            return events

        # 1. Monitorear trades abiertos (SL/TP)
        trade_events = self._update_open_trades(candle)
        events.extend(trade_events)

        # 2. Verificar breakouts pendientes
        if self._state == 'BREAKOUT_PENDING':
            bo_events = self._check_breakout(candle)
            events.extend(bo_events)

        # 3. Calcular VP de ventana actual
        window = self._candles[-self.config.window_size:]
        vp = compute_volume_profile(window, self.config.bins, self.config.va_percent)

        if vp['total_volume'] <= 0:
            self._on_no_signal()
            return events

        # 4. Clasificar forma
        shape = classify_shape(vp)
        self._current_vp = vp
        self._current_shape = shape

        # 5. Evaluar si hay senal D
        is_valid_d = self._is_valid_d_signal(shape, vp, window)

        if is_valid_d:
            self._consecutive_d += 1

            if self._state == 'SCANNING':
                if self._consecutive_d >= 2:  # Necesita 2 evaluaciones consecutivas
                    self._start_zone(vp, shape, window)
                    events.append({'type': 'zone_started',
                                   'zone': self._active_zone})

            elif self._state == 'ZONE_ACTIVE':
                # Actualizar zona
                self._update_zone(vp, shape, candle)

        else:
            # No es D
            if self._state == 'ZONE_ACTIVE' and self._active_zone:
                # Zona termina → esperar breakout
                self._state = 'BREAKOUT_PENDING'
                self._breakout_dir = None
                self._breakout_count = 0
                self._active_zone['end_timestamp'] = candle['timestamp']
                self._active_zone['state'] = 'COMPLETE'
                events.append({'type': 'zone_complete',
                               'zone': self._active_zone})

            self._consecutive_d = 0

        return events

    def _is_valid_d_signal(self, shape: Dict, vp: Dict,
                           window: List[Dict]) -> bool:
        """Evalua si la ventana actual tiene senal D valida."""
        # Check D directa
        if shape['shape_type'] == 'D' and shape['d_score'] >= self.config.min_d_score:
            # Filtro de rango
            win_min = min(c['low'] for c in window)
            win_max = max(c['high'] for c in window)
            if win_max > win_min:
                mid = (win_min + win_max) / 2.0
                range_pct = (win_max - win_min) / mid * 100
                if range_pct <= self.config.max_range_pct:
                    return True

        # Check P/b trimmed
        if self.config.include_pb_shapes and shape['shape_type'] in ('P', 'b'):
            trimmed = trim_pb_to_d(vp, shape)
            if trimmed:
                adj_score = int(shape['d_score'] * 0.7 + 20)
                if adj_score >= self.config.min_d_score:
                    return True

        return False

    def _start_zone(self, vp: Dict, shape: Dict, window: List[Dict]):
        """Inicia una nueva zona activa."""
        self._state = 'ZONE_ACTIVE'
        self._zone_counter += 1

        # Definir limites segun shape
        trimmed = None
        if shape['shape_type'] in ('P', 'b') and self.config.include_pb_shapes:
            trimmed = trim_pb_to_d(vp, shape)

        if trimmed:
            z_min = trimmed['min_price']
            z_max = trimmed['max_price']
            z_poc = trimmed['poc_price']
            s_type = f"{shape['shape_type']}_trimmed"
        else:
            z_min = vp['val_price']
            z_max = vp['vah_price']
            z_poc = vp['poc']['price']
            s_type = 'D'

        self._active_zone = {
            'id': f"vp_{self.symbol}_{self._zone_counter}",
            'symbol': self.symbol,
            'state': 'BUILDING',
            'start_timestamp': window[0]['timestamp'],
            'end_timestamp': window[-1]['timestamp'],
            'min_price': z_min,
            'max_price': z_max,
            'poc_price': z_poc,
            'full_range_min': vp['min_price'],
            'full_range_max': vp['max_price'],
            'd_score': shape['d_score'],
            'shape_type': s_type,
            'candle_count': len(window),
            'source': 'vp_scanner',
            'vp_summary': {
                'poc_price': vp['poc']['price'],
                'vah_price': vp['vah_price'],
                'val_price': vp['val_price'],
                'total_volume': vp['total_volume'],
            },
            'volume_profile': _build_vp_for_frontend(vp),
        }

    def _update_zone(self, vp: Dict, shape: Dict, candle: Dict):
        """Actualiza zona activa con nueva vela."""
        if not self._active_zone:
            return

        self._active_zone['end_timestamp'] = candle['timestamp']
        self._active_zone['candle_count'] += 1

        # Actualizar limites progresivamente
        trimmed = None
        if shape['shape_type'] in ('P', 'b') and self.config.include_pb_shapes:
            trimmed = trim_pb_to_d(vp, shape)

        if trimmed:
            new_min = trimmed['min_price']
            new_max = trimmed['max_price']
            new_poc = trimmed['poc_price']
        else:
            new_min = vp['val_price']
            new_max = vp['vah_price']
            new_poc = vp['poc']['price']

        # Smooth update (promedio ponderado)
        alpha = 0.3
        self._active_zone['min_price'] = self._active_zone['min_price'] * (1 - alpha) + new_min * alpha
        self._active_zone['max_price'] = self._active_zone['max_price'] * (1 - alpha) + new_max * alpha
        self._active_zone['poc_price'] = self._active_zone['poc_price'] * (1 - alpha) + new_poc * alpha
        self._active_zone['d_score'] = max(self._active_zone['d_score'], shape['d_score'])
        # Actualizar VP para visualizacion
        self._active_zone['volume_profile'] = _build_vp_for_frontend(vp)

    def _check_breakout(self, candle: Dict) -> List[Dict]:
        """Verifica breakout de la zona completada."""
        events = []
        zone = self._active_zone
        if not zone:
            self._state = 'SCANNING'
            return events

        # Determinar limites de breakout segun entry_mode
        if self.config.entry_mode == 'zone':
            bo_high = zone.get('full_range_max', zone['max_price'])
            bo_low = zone.get('full_range_min', zone['min_price'])
        else:
            bo_high = zone['max_price']
            bo_low = zone['min_price']

        close = candle['close']

        direction = None
        if close > bo_high:
            direction = 'UP'
        elif close < bo_low:
            direction = 'DOWN'

        need_confirm = max(1, self.config.breakout_confirm_bars)

        if direction:
            if self._breakout_dir == direction:
                self._breakout_count += 1
            else:
                self._breakout_dir = direction
                self._breakout_count = 1

            if self._breakout_count >= need_confirm:
                # BREAKOUT CONFIRMADO - entrada al precio de ESTA vela (orden market)
                trade = self._create_trade(zone, candle, direction)

                if trade:
                    # Sequential mode check
                    if self.config.position_mode == 'sequential' and self._open_trades:
                        _alert_logger.info(
                            f"BLOCKED_SEQUENTIAL | {self.symbol} | {zone['id']}")
                    else:
                        self._open_trades.append(trade)
                        events.append({'type': 'breakout', 'trade': trade})
                        _alert_logger.info(
                            f"BREAKOUT | {self.symbol} | {zone['id']} | "
                            f"{direction} | entry={trade['entry_price']:.2f} | "
                            f"SL={trade['sl_price']:.2f} | TP={trade['tp_price']:.2f}")

                self._state = 'SCANNING'
                self._active_zone = None
                self._breakout_dir = None
                self._breakout_count = 0
        else:
            # Dentro de zona - reset
            self._breakout_count = 0
            self._breakout_dir = None

            # Timeout: si han pasado muchas velas sin breakout
            if zone.get('end_timestamp'):
                age = sum(1 for c in self._candles if c['timestamp'] > zone['end_timestamp'])
                if age > self.config.lookforward_bars:
                    _alert_logger.info(
                        f"ZONE_EXPIRED | {self.symbol} | {zone['id']} | age={age}")
                    zone['trade_result'] = 'EXPIRED'
                    zone['trade_pnl_r'] = 0
                    zone['state'] = 'EXPIRED'
                    self._add_resolved(zone)
                    self._state = 'SCANNING'
                    self._active_zone = None

        return events

    def _create_trade(self, zone: Dict, candle: Dict, direction: str) -> Optional[Dict]:
        """Crea un trade a partir de un breakout."""
        entry_price = candle['close']
        entry_ts = candle['timestamp']
        zone_high = zone['max_price']
        zone_low = zone['min_price']
        zone_range = zone_high - zone_low
        poc = zone['poc_price']

        if zone_range <= 0:
            return None

        # Calcular riesgo segun sl_mode
        buffer = 1.0 + self.config.sl_buffer_pct / 100.0

        if self.config.sl_mode == 'beyond_poc':
            if direction == 'UP':
                risk = (entry_price - poc) * buffer
            else:
                risk = (poc - entry_price) * buffer
        elif self.config.sl_mode == 'below_va':
            if direction == 'UP':
                risk = (entry_price - zone_low) * buffer
            else:
                risk = (zone_high - entry_price) * buffer
        else:
            # zone_opposite
            full_low = zone.get('full_range_min', zone_low)
            full_high = zone.get('full_range_max', zone_high)
            full_range = full_high - full_low
            if direction == 'UP':
                risk = entry_price - full_low + full_range * self.config.sl_buffer_pct / 100
            else:
                risk = full_high - entry_price + full_range * self.config.sl_buffer_pct / 100

        if risk <= 0:
            risk = zone_range * 0.5

        if direction == 'UP':
            sl = entry_price - risk
            tp = entry_price + risk * self.config.tp_rr_ratio
        else:
            sl = entry_price + risk
            tp = entry_price - risk * self.config.tp_rr_ratio

        trade = {
            **zone,
            'state': 'OPEN',
            'trade_result': 'OPEN',
            'breakout_direction': direction,
            'breakout_timestamp': entry_ts,
            'entry_price': entry_price,
            'entry_timestamp': entry_ts,
            'sl_price': sl,
            'tp_price': tp,
            'risk': risk,
        }
        return trade

    def _update_open_trades(self, candle: Dict) -> List[Dict]:
        """Monitorea SL/TP de trades abiertos."""
        events = []
        remaining = []

        for trade in self._open_trades:
            direction = trade['breakout_direction']
            hit_tp = False
            hit_sl = False

            if direction == 'UP':
                hit_tp = candle['high'] >= trade['tp_price']
                hit_sl = candle['low'] <= trade['sl_price']
            else:
                hit_tp = candle['low'] <= trade['tp_price']
                hit_sl = candle['high'] >= trade['sl_price']

            if hit_sl and hit_tp:
                if direction == 'UP':
                    hit_sl_first = candle['open'] <= trade['sl_price']
                else:
                    hit_sl_first = candle['open'] >= trade['sl_price']
                if hit_sl_first:
                    hit_tp = False
                else:
                    hit_sl = False

            if hit_tp:
                trade['state'] = 'RESOLVED'
                trade['trade_result'] = 'WIN'
                trade['trade_pnl_r'] = self.config.tp_rr_ratio
                trade['trade_close_timestamp'] = candle['timestamp']
                self._add_resolved(trade)
                _alert_logger.info(
                    f"WIN | {self.symbol} | {trade['id']} | "
                    f"{direction} | pnl=+{self.config.tp_rr_ratio}R")
                events.append({'type': 'win', 'trade': trade})
                continue

            if hit_sl:
                trade['state'] = 'RESOLVED'
                trade['trade_result'] = 'LOSS'
                trade['trade_pnl_r'] = -1.0
                trade['trade_close_timestamp'] = candle['timestamp']
                self._add_resolved(trade)
                _alert_logger.info(
                    f"LOSS | {self.symbol} | {trade['id']} | "
                    f"{direction} | pnl=-1R")
                events.append({'type': 'loss', 'trade': trade})
                continue

            remaining.append(trade)

        self._open_trades = remaining
        return events

    def _on_no_signal(self):
        """Cuando no hay senal D valida."""
        if self._state == 'ZONE_ACTIVE' and self._active_zone:
            self._state = 'BREAKOUT_PENDING'
            self._breakout_dir = None
            self._breakout_count = 0
        self._consecutive_d = 0

    def _add_resolved(self, trade: Dict):
        """Agrega trade resuelto al historial."""
        self._resolved_zones.append(trade)
        if not self._backtest_mode and len(self._resolved_zones) > self._max_resolved:
            self._resolved_zones = self._resolved_zones[-self._max_resolved:]

    def get_all_zones(self) -> List[Dict]:
        """Retorna todas las zonas (activas + resueltas + abiertas)."""
        zones = list(self._resolved_zones)
        zones.extend(self._open_trades)
        if self._active_zone:
            zones.append(self._active_zone)
        return zones

    def get_state(self) -> Dict:
        """Retorna estado actual del scanner."""
        return {
            'state': self._state,
            'candles_in_buffer': len(self._candles),
            'active_zone': self._active_zone is not None,
            'open_trades': len(self._open_trades),
            'resolved_zones': len(self._resolved_zones),
            'consecutive_d': self._consecutive_d,
            'current_d_score': self._current_shape.get('d_score', 0) if self._current_shape else 0,
            'current_shape': self._current_shape.get('shape_type', '') if self._current_shape else '',
        }


# ---------------------------------------------------------------------------
# Backtest wrapper (identico al V2)
# ---------------------------------------------------------------------------

def backtest_vp(candles: List[Dict], config_overrides: Dict = None,
                progress_dict: Dict = None) -> Dict:
    """
    Ejecuta backtest historico usando el scanner VP.

    Args:
        candles: Lista de velas OHLCV ordenadas por timestamp asc
        config_overrides: Parametros a sobreescribir
        progress_dict: Diccionario compartido para reportar progreso al frontend

    Returns:
        Dict con zones, stats, equity_curve
    """
    cfg = VPScannerConfig()
    if config_overrides:
        for key, val in config_overrides.items():
            if hasattr(cfg, key):
                expected_type = type(getattr(cfg, key))
                # Convertir tipo si es necesario (ej: int enviado como float desde JSON)
                if expected_type == bool and not isinstance(val, bool):
                    val = bool(val)
                elif expected_type == int and isinstance(val, float):
                    val = int(val)
                elif expected_type == float and isinstance(val, int):
                    val = float(val)
                setattr(cfg, key, val)

    import time as _bt_time
    _bt_start = _bt_time.time()

    logger.info(f"[VP_BACKTEST] Config: strategy={cfg.entry_strategy}, "
                f"include_pb_shapes={cfg.include_pb_shapes}, "
                f"entry_mode={cfg.entry_mode}, sl_mode={cfg.sl_mode}, "
                f"min_d_score={cfg.min_d_score}, detection_mode={cfg.detection_mode}")
    print(f"[VP_BACKTEST] Inicio: {len(candles)} velas, "
          f"mode={cfg.detection_mode}, strategy={cfg.entry_strategy}")

    # Seleccionar metodo de deteccion (solo detecta zonas, NO simula trades)
    _det_start = _bt_time.time()
    if cfg.detection_mode == 'progressive':
        zones = scan_zones_progressive(candles, cfg, progress_dict=progress_dict)
    else:
        zones = scan_zones(candles, cfg, progress_dict=progress_dict)
    _det_elapsed = _bt_time.time() - _det_start
    print(f"[VP_BACKTEST] Deteccion completada en {_det_elapsed:.1f}s: {len(zones)} zonas")

    # Filtrar score ANTES de simular trades (usa d_score original de deteccion)
    if cfg.min_d_score > 0:
        pre_filter = len(zones)
        zones = [z for z in zones if z.get('d_score', 0) >= cfg.min_d_score]
        if pre_filter != len(zones):
            logger.info(f"[VP_BACKTEST] Filtro d_score>={cfg.min_d_score}: "
                        f"{pre_filter} -> {len(zones)} zonas")

    # Simular trades sobre las zonas filtradas
    if progress_dict:
        progress_dict["phase"] = "simulating"
        progress_dict["zones_found"] = len(zones)
        progress_dict["current"] = 0
        progress_dict["total"] = len(zones)
    zones = _simulate_trades(zones, candles, cfg)

    # Estadisticas - expandir sub-trades de mean_reversion para conteo individual
    all_trades = []
    for z in zones:
        if z.get('mr_trades'):
            for t in z['mr_trades']:
                all_trades.append(t)
        elif z.get('trade_result') in ('WIN', 'LOSS', 'OPEN'):
            all_trades.append(z)

    resolved = [t for t in all_trades if t.get('trade_result') in ('WIN', 'LOSS')]
    open_trades_list = [t for t in all_trades if t.get('trade_result') == 'OPEN']
    wins = [t for t in resolved if t['trade_result'] == 'WIN']
    losses = [t for t in resolved if t['trade_result'] == 'LOSS']

    total_closed = len(wins) + len(losses)
    total_pnl_r = sum(t.get('trade_pnl_r', 0) for t in resolved)
    win_rate = (len(wins) / total_closed * 100) if total_closed > 0 else 0
    expectancy = (total_pnl_r / total_closed) if total_closed > 0 else 0

    gross_profit = sum(t.get('trade_pnl_r', 0) for t in wins)
    gross_loss = abs(sum(t.get('trade_pnl_r', 0) for t in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (
        99.9 if gross_profit > 0 else 0)

    # Equity curve & max drawdown
    trades_sorted = sorted(resolved,
                           key=lambda t: t.get('entry_timestamp', 0))
    max_equity = 0.0
    max_drawdown = 0.0
    equity = 0.0
    equity_curve = []
    for t in trades_sorted:
        equity += t.get('trade_pnl_r', 0)
        if equity > max_equity:
            max_equity = equity
        dd = max_equity - equity
        if dd > max_drawdown:
            max_drawdown = dd
        equity_curve.append({
            'timestamp': t.get('trade_close_timestamp',
                               t.get('entry_timestamp', 0)),
            'equity': round(equity, 2),
        })

    # Progressive quality promedio (solo aplica en modo progresivo)
    pq_values = [z.get('progressive_quality', 0) for z in zones
                 if z.get('progressive_quality') is not None]
    avg_pq = round(sum(pq_values) / len(pq_values), 1) if pq_values else 0
    # Combined: zones * avg_progressive_quality
    zones_x_quality = round(len(zones) * avg_pq, 1)

    _bt_total = _bt_time.time() - _bt_start
    print(f"[VP_BACKTEST] COMPLETADO en {_bt_total:.1f}s: "
          f"{len(zones)} zonas, {len(wins)}W/{len(losses)}L, "
          f"WR={round(win_rate, 1)}%, PnL={round(total_pnl_r, 2)}R")

    return {
        'zones': zones,
        'stats': {
            'entry_strategy': cfg.entry_strategy,
            'total_zones': len(zones),
            'total_trades': len(all_trades),
            'wins': len(wins),
            'losses': len(losses),
            'open': len(open_trades_list),
            'total_closed': total_closed,
            'win_rate': round(win_rate, 1),
            'total_pnl_r': round(total_pnl_r, 2),
            'expectancy': round(expectancy, 3),
            'profit_factor': round(profit_factor, 2),
            'max_drawdown_r': round(max_drawdown, 2),
            'avg_progressive_quality': avg_pq,
            'zones_x_quality': zones_x_quality,
        },
        'equity_curve': equity_curve,
        'candles_processed': len(candles),
    }


# ---------------------------------------------------------------------------
# Strategy-only optimization (zonas fijas, varía solo parámetros de trading)
# ---------------------------------------------------------------------------

# Parámetros de trading que NO afectan la detección de zonas
_STRATEGY_PARAM_DEFS = {
    # --- Comunes ---
    'entry_mode':             {'type': 'enum', 'values': ['zone', 'va']},
    'sl_mode':                {'type': 'enum', 'values': ['beyond_poc', 'below_va', 'zone_opposite']},
    'tp_rr_ratio':            {'type': 'range', 'min': 1.0, 'max': 5.0, 'step': 0.5},
    'sl_buffer_pct':          {'type': 'range', 'min': 0.0, 'max': 0.5, 'step': 0.05},
    'lookforward_bars':       {'type': 'range', 'min': 50, 'max': 300, 'step': 25},
    'breakout_confirm_bars':  {'type': 'range', 'min': 0, 'max': 5, 'step': 1},
    'position_mode':          {'type': 'enum', 'values': ['sequential', 'concurrent']},
    # --- Breakout ---
    'bo_volume_zscore':       {'type': 'range', 'min': 0.5, 'max': 3.0, 'step': 0.25},
    'bo_momentum_bars':       {'type': 'range', 'min': 0, 'max': 20, 'step': 2},
    # --- Retest ---
    'rt_max_bars':            {'type': 'range', 'min': 5, 'max': 100, 'step': 5},
    'rt_level':               {'type': 'enum', 'values': ['va', 'zone', 'poc']},
    'rt_confirm':             {'type': 'enum', 'values': ['touch', 'rejection', 'swing']},
    'rt_swing_bars':          {'type': 'range', 'min': 2, 'max': 10, 'step': 1},
    'rt_sl_mode':             {'type': 'enum', 'values': ['below_retest', 'beyond_poc', 'below_va', 'below_zone']},
    'rt_must_reenter':        {'type': 'enum', 'values': [True, False]},
    # --- Mean Reversion ---
    'mr_target':              {'type': 'enum', 'values': ['poc', 'opposite_va', 'opposite_zone']},
    'mr_entry_zone':          {'type': 'enum', 'values': ['va', 'zone']},
    'mr_confirm':             {'type': 'enum', 'values': ['touch', 'rejection', 'swing']},
    'mr_swing_bars':          {'type': 'range', 'min': 2, 'max': 10, 'step': 1},
    'mr_sl_mode':             {'type': 'enum', 'values': ['beyond_zone', 'beyond_va']},
    'mr_sl_buffer_pct':       {'type': 'range', 'min': 0.05, 'max': 0.5, 'step': 0.05},
    'mr_min_zone_candles':    {'type': 'range', 'min': 5, 'max': 50, 'step': 5},
    'mr_max_trades_per_zone': {'type': 'range', 'min': 1, 'max': 10, 'step': 1},
}


def simulate_strategy_only(base_zones: List[Dict], candles: List[Dict],
                           config_overrides: Dict) -> Dict:
    """
    Simula trades sobre zonas pre-detectadas (no modifica la deteccion).
    Hace deep copy de las zonas para no contaminar el original.

    Args:
        base_zones: Zonas detectadas (no se modifican)
        candles: Velas OHLCV
        config_overrides: Parametros de trading a aplicar

    Returns:
        Dict con stats (sin zones para reducir memoria en grid search)
    """
    import copy

    cfg = VPScannerConfig()
    if config_overrides:
        for key, val in config_overrides.items():
            if hasattr(cfg, key):
                expected_type = type(getattr(cfg, key))
                if expected_type == bool and not isinstance(val, bool):
                    val = bool(val)
                elif expected_type == int and isinstance(val, float):
                    val = int(val)
                elif expected_type == float and isinstance(val, int):
                    val = float(val)
                setattr(cfg, key, val)

    # Deep copy para no modificar las zonas originales
    zones = copy.deepcopy(base_zones)

    # Solo simular trades (las zonas ya vienen detectadas)
    zones = _simulate_trades(zones, candles, cfg)

    # Estadisticas
    all_trades = []
    for z in zones:
        if z.get('mr_trades'):
            for t in z['mr_trades']:
                all_trades.append(t)
        elif z.get('trade_result') in ('WIN', 'LOSS', 'OPEN'):
            all_trades.append(z)

    resolved = [t for t in all_trades if t.get('trade_result') in ('WIN', 'LOSS')]
    wins = [t for t in resolved if t['trade_result'] == 'WIN']
    losses = [t for t in resolved if t['trade_result'] == 'LOSS']

    total_closed = len(wins) + len(losses)
    total_pnl_r = sum(t.get('trade_pnl_r', 0) for t in resolved)
    win_rate = (len(wins) / total_closed * 100) if total_closed > 0 else 0
    expectancy = (total_pnl_r / total_closed) if total_closed > 0 else 0

    gross_profit = sum(t.get('trade_pnl_r', 0) for t in wins)
    gross_loss = abs(sum(t.get('trade_pnl_r', 0) for t in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (
        99.9 if gross_profit > 0 else 0)

    # Max drawdown
    trades_sorted = sorted(resolved, key=lambda t: t.get('entry_timestamp', 0))
    max_equity = 0.0
    max_drawdown = 0.0
    equity = 0.0
    for t in trades_sorted:
        equity += t.get('trade_pnl_r', 0)
        if equity > max_equity:
            max_equity = equity
        dd = max_equity - equity
        if dd > max_drawdown:
            max_drawdown = dd

    return {
        'entry_strategy': cfg.entry_strategy,
        'total_zones': len(zones),
        'total_trades': len(all_trades),
        'wins': len(wins),
        'losses': len(losses),
        'open': len([t for t in all_trades if t.get('trade_result') == 'OPEN']),
        'total_closed': total_closed,
        'win_rate': round(win_rate, 1),
        'total_pnl_r': round(total_pnl_r, 2),
        'expectancy': round(expectancy, 3),
        'profit_factor': round(profit_factor, 2),
        'max_drawdown_r': round(max_drawdown, 2),
    }


def get_strategy_param_defs() -> Dict:
    """Retorna las definiciones de parametros de estrategia optimizables."""
    return _STRATEGY_PARAM_DEFS


# ---------------------------------------------------------------------------
# Zone Cache en disco (evita re-deteccion cuando solo cambian params de estrategia)
# ---------------------------------------------------------------------------

# Parametros que afectan la DETECCION de zonas (no la simulacion de trades)
_DETECTION_PARAMS = [
    'window_size', 'window_step', 'bins', 'va_percent', 'min_d_score',
    'include_pb_shapes', 'min_zone_candles', 'merge_gap', 'max_range_pct',
    'warmup_candles',
    # Deteccion progresiva
    'detection_mode', 'prog_min_candles', 'prog_range_pct', 'prog_stop_mode',
    'prog_degrade_bars', 'prog_close_outside_bars', 'prog_close_reference',
    'prog_thickness_metric',
]


def _get_detection_fingerprint(config_overrides: Dict, symbol: str,
                               interval: str, days: int) -> str:
    """
    Genera un hash unico basado en los parametros de deteccion + datos.
    Si este hash coincide con uno guardado, las zonas se pueden reusar.
    """
    import hashlib
    import json

    # Extraer solo los params de deteccion del config
    cfg = VPScannerConfig()
    if config_overrides:
        for key, val in config_overrides.items():
            if hasattr(cfg, key):
                setattr(cfg, key, val)

    det_values = {}
    for p in _DETECTION_PARAMS:
        det_values[p] = getattr(cfg, p, None)

    # Incluir datos del dataset (misma moneda, intervalo y dias = mismas velas)
    det_values['_symbol'] = symbol
    det_values['_interval'] = interval
    det_values['_days'] = days

    fingerprint_str = json.dumps(det_values, sort_keys=True, default=str)
    return hashlib.sha256(fingerprint_str.encode()).hexdigest()[:16]


def _get_zone_cache_dir() -> str:
    """Retorna el directorio para almacenar cache de zonas."""
    import os
    cache_dir = os.path.join(os.path.dirname(__file__), "zones_cache")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def save_zone_cache(zones: List[Dict], config_overrides: Dict,
                    symbol: str, interval: str, days: int,
                    candles_count: int) -> str:
    """
    Guarda las zonas detectadas (SIN datos de trade) a disco.
    Retorna el path del archivo guardado.
    """
    import json
    import os

    fingerprint = _get_detection_fingerprint(config_overrides, symbol, interval, days)
    cache_dir = _get_zone_cache_dir()
    filename = f"{symbol}_{interval}_{days}d_{fingerprint}.json"
    filepath = os.path.join(cache_dir, filename)

    # Limpiar campos de trade de las zonas (solo guardar datos de deteccion)
    clean_zones = []
    trade_fields = [
        'trade_result', 'trade_pnl_r', 'r_multiple', 'entry_price',
        'exit_price', 'sl_price', 'tp_price', 'entry_timestamp',
        'exit_timestamp', 'trade_close_timestamp', 'bars_to_close',
        'breakout_direction', 'breakout_price', 'breakout_timestamp',
        'reached_2r', 'reached_3r', 'trading_score', 'mr_trades',
        'entry_bar_index', 'exit_bar_index',
    ]
    for z in zones:
        clean = {k: v for k, v in z.items() if k not in trade_fields}
        clean_zones.append(clean)

    cache_data = {
        'fingerprint': fingerprint,
        'symbol': symbol,
        'interval': interval,
        'days': days,
        'candles_count': candles_count,
        'zones_count': len(clean_zones),
        'timestamp': time.time(),
        'detection_params': {p: config_overrides.get(p, getattr(VPScannerConfig(), p, None))
                             for p in _DETECTION_PARAMS},
        'zones': clean_zones,
    }

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(cache_data, f, ensure_ascii=False)

    size_kb = os.path.getsize(filepath) / 1024
    logger.info(f"[ZONE_CACHE] Guardado: {filename} ({len(clean_zones)} zonas, {size_kb:.0f}KB)")
    print(f"[ZONE_CACHE] Guardado: {filename} ({len(clean_zones)} zonas, {size_kb:.0f}KB)")
    return filepath


def load_zone_cache(config_overrides: Dict, symbol: str,
                    interval: str, days: int) -> Optional[Dict]:
    """
    Intenta cargar zonas cacheadas que coincidan con los params de deteccion.
    Retorna dict con 'zones' y metadata si hay match, None si no.
    """
    import json
    import os

    fingerprint = _get_detection_fingerprint(config_overrides, symbol, interval, days)
    cache_dir = _get_zone_cache_dir()
    filename = f"{symbol}_{interval}_{days}d_{fingerprint}.json"
    filepath = os.path.join(cache_dir, filename)

    if not os.path.exists(filepath):
        logger.info(f"[ZONE_CACHE] MISS: {filename} no existe")
        print(f"[ZONE_CACHE] MISS: {filename}")
        return None

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            cache_data = json.load(f)

        # Verificar integridad basica
        if cache_data.get('fingerprint') != fingerprint:
            logger.warning(f"[ZONE_CACHE] Fingerprint mismatch en {filename}")
            os.remove(filepath)
            return None

        age_hours = (time.time() - cache_data.get('timestamp', 0)) / 3600
        zones = cache_data.get('zones', [])
        logger.info(f"[ZONE_CACHE] HIT: {filename} ({len(zones)} zonas, {age_hours:.1f}h)")
        print(f"[ZONE_CACHE] HIT: {filename} ({len(zones)} zonas, {age_hours:.1f}h de antiguedad)")
        return cache_data

    except Exception as e:
        logger.error(f"[ZONE_CACHE] Error leyendo {filename}: {e}")
        return None


def is_strategy_only_change(current_overrides: Dict, cached_detection_params: Dict) -> bool:
    """
    Compara params actuales vs los de deteccion cacheados.
    Retorna True si solo cambiaron params de estrategia (no de deteccion).
    """
    cfg_current = VPScannerConfig()
    if current_overrides:
        for key, val in current_overrides.items():
            if hasattr(cfg_current, key):
                setattr(cfg_current, key, val)

    for p in _DETECTION_PARAMS:
        current_val = getattr(cfg_current, p, None)
        cached_val = cached_detection_params.get(p)
        # Comparar con tolerancia para floats
        if isinstance(current_val, float) and isinstance(cached_val, float):
            if abs(current_val - cached_val) > 1e-9:
                return False
        elif current_val != cached_val:
            return False
    return True


def get_detection_param_names() -> List[str]:
    """Retorna la lista de nombres de parametros que afectan la deteccion."""
    return list(_DETECTION_PARAMS)


# ---------------------------------------------------------------------------
# Persistencia de estado incremental (zonas parciales/completas con trades)
# ---------------------------------------------------------------------------

def _get_incremental_cache_dir() -> str:
    """Retorna el directorio para almacenar estado incremental."""
    import os
    cache_dir = os.path.join(os.path.dirname(__file__), "zones_cache", "incremental")
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def save_incremental_state(state: Dict) -> str:
    """
    Guarda el estado incremental a disco (zonas CON datos de trade).
    Se llama al detener, pausar o completar una deteccion incremental.
    Retorna el path del archivo guardado.
    """
    import json
    import os

    symbol = state.get("symbol", "UNKNOWN")
    interval = state.get("interval", "60")
    days = state.get("days", 0)
    config_overrides = state.get("config_overrides", {})

    fingerprint = _get_detection_fingerprint(config_overrides, symbol, interval, days)
    cache_dir = _get_incremental_cache_dir()
    filename = f"inc_{symbol}_{interval}_{days}d_{fingerprint}.json"
    filepath = os.path.join(cache_dir, filename)

    save_data = {
        'fingerprint': fingerprint,
        'symbol': symbol,
        'interval': interval,
        'days': days,
        'config_overrides': config_overrides,
        'zones': state.get("zones", []),
        'chunks_completed': state.get("chunks_completed", []),
        'chunk_boundaries': state.get("chunk_boundaries", []),
        'total_chunks': state.get("total_chunks", 0),
        'phase': state.get("phase", "stopped"),
        'elapsed': state.get("elapsed", 0),
        'timestamp': time.time(),
        'detection_params': {p: config_overrides.get(p, getattr(VPScannerConfig(), p, None))
                             for p in _DETECTION_PARAMS},
    }

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(save_data, f, ensure_ascii=False)

    size_kb = os.path.getsize(filepath) / 1024
    n_zones = len(save_data['zones'])
    n_done = len(save_data['chunks_completed'])
    n_total = save_data['total_chunks']
    logger.info(f"[INC_CACHE] Guardado: {filename} ({n_zones} zonas, "
                f"chunks {n_done}/{n_total}, {size_kb:.0f}KB)")
    print(f"[INC_CACHE] Guardado: {filename} ({n_zones} zonas, "
          f"chunks {n_done}/{n_total}, {size_kb:.0f}KB)")
    return filepath


def load_incremental_state(config_overrides: Dict, symbol: str,
                           interval: str, days: int) -> Optional[Dict]:
    """
    Carga estado incremental guardado que coincida con los params de deteccion.
    Retorna dict con zonas, chunks_completed, etc. si hay match, None si no.
    """
    import json
    import os

    fingerprint = _get_detection_fingerprint(config_overrides, symbol, interval, days)
    cache_dir = _get_incremental_cache_dir()
    filename = f"inc_{symbol}_{interval}_{days}d_{fingerprint}.json"
    filepath = os.path.join(cache_dir, filename)

    if not os.path.exists(filepath):
        logger.info(f"[INC_CACHE] MISS: {filename}")
        print(f"[INC_CACHE] MISS: {filename}")
        return None

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Verificar fingerprint
        if data.get('fingerprint') != fingerprint:
            logger.warning(f"[INC_CACHE] Fingerprint mismatch en {filename}")
            os.remove(filepath)
            return None

        age_hours = (time.time() - data.get('timestamp', 0)) / 3600
        n_zones = len(data.get('zones', []))
        n_done = len(data.get('chunks_completed', []))
        n_total = data.get('total_chunks', 0)
        is_complete = n_done >= n_total and n_total > 0

        logger.info(f"[INC_CACHE] HIT: {filename} ({n_zones} zonas, "
                    f"chunks {n_done}/{n_total}, {age_hours:.1f}h, "
                    f"complete={is_complete})")
        print(f"[INC_CACHE] HIT: {filename} ({n_zones} zonas, "
              f"chunks {n_done}/{n_total}, {age_hours:.1f}h)")

        data['is_complete'] = is_complete
        return data

    except Exception as e:
        logger.error(f"[INC_CACHE] Error leyendo {filename}: {e}")
        return None


def delete_incremental_state(config_overrides: Dict, symbol: str,
                             interval: str, days: int) -> bool:
    """Elimina estado incremental guardado."""
    import os

    fingerprint = _get_detection_fingerprint(config_overrides, symbol, interval, days)
    cache_dir = _get_incremental_cache_dir()
    filename = f"inc_{symbol}_{interval}_{days}d_{fingerprint}.json"
    filepath = os.path.join(cache_dir, filename)

    if os.path.exists(filepath):
        os.remove(filepath)
        print(f"[INC_CACHE] Eliminado: {filename}")
        return True
    return False
