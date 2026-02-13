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

def scan_zones(candles: List[Dict], config: VPScannerConfig) -> List[Dict]:
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

    logger.info(f"[VP_SCAN] Inicio: {len(candles)} velas, window={config.window_size}, "
                f"step={step}, total_windows={total_windows}, "
                f"max_range={config.max_range_pct}%, min_d_score={config.min_d_score}")

    for w in range(0, len(candles) - config.window_size + 1, step):
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
        })

    logger.info(f"[VP_SCAN] Ventanas: {total_windows} total, "
                f"skip_range={skip_range} ({skip_range*100//max(total_windows,1)}%), "
                f"skip_volume={skip_volume}, skip_score={skip_score}, "
                f"accepted={accepted} -> {len(raw_hits)} raw_hits")

    if not raw_hits:
        logger.info(f"[VP_SCAN] 0 raw_hits - no se detectaron zonas. "
                    f"Razon principal: {'rango excede max_range_pct' if skip_range > skip_score else 'd_score insuficiente'}")
        return []

    # Paso 2: Fusionar ventanas solapadas o contiguas
    merged_zones = _merge_raw_hits(raw_hits, candles, config)

    logger.info(f"[VP_SCAN] Merge: {len(raw_hits)} hits -> {len(merged_zones)} zonas fusionadas")

    # Paso 3: Simular trades (breakout + SL/TP)
    zones_with_trades = _simulate_trades(merged_zones, candles, config)

    # Logging: resumen de trades
    results_summary = {}
    for z in zones_with_trades:
        r = z.get('trade_result', 'UNKNOWN')
        results_summary[r] = results_summary.get(r, 0) + 1
    logger.info(f"[VP_SCAN] Trades: {results_summary}")

    return zones_with_trades


def scan_zones_progressive(candles: List[Dict],
                           config: VPScannerConfig) -> List[Dict]:
    """
    Deteccion progresiva de zonas VP.
    En vez de ventana fija, crece la ventana vela a vela mientras el perfil
    mejora su d_score.  La zona termina por breakout o degradacion del score.

    Flujo:
    1. Buscar inicio de consolidacion (rango < prog_range_pct)
    2. Expandir ventana mientras precio siga dentro del rango
    3. Calcular VP acumulado y d_score en cada expansion
    4. Cerrar zona por breakout o degradacion
    5. Pasar zonas a _simulate_trades() igual que el metodo fijo

    Returns: lista de zonas con trades simulados (mismo formato que scan_zones).
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

    while i <= n - min_c:
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
        }
        zones.append(zone_dict)

        logger.info(f"[VP_PROG] Zona #{len(zones)}: idx=[{zone_start}-{final_end}] "
                     f"({len(final_candles)} velas), shape={source_shape}, "
                     f"d_score={final_d}, best={best_d_score}, "
                     f"thickness={thickness}, pq={progressive_quality}, "
                     f"history_len={len(d_score_history)}")

        # Avanzar despues de la zona (no solapar)
        i = final_end + 1

    logger.info(f"[VP_PROG] Total: {len(zones)} zonas detectadas de {n} velas")

    if not zones:
        return []

    # Simular trades (reutiliza misma funcion que fixed_window)
    zones_with_trades = _simulate_trades(zones, candles, config)

    results_summary = {}
    for z in zones_with_trades:
        r = z.get('trade_result', 'UNKNOWN')
        results_summary[r] = results_summary.get(r, 0) + 1
    logger.info(f"[VP_PROG] Trades: {results_summary}")

    return zones_with_trades


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
    """Simula trades despues del breakout de cada zona."""
    results = []
    open_trade = None  # Para sequential mode

    logger.info(f"[VP_TRADES] Simulando {len(zones)} zonas, "
                f"mode={config.position_mode}, entry_mode={config.entry_mode}, "
                f"sl_mode={config.sl_mode}, lookforward={config.lookforward_bars}, "
                f"confirm_bars={config.breakout_confirm_bars}, tp_rr={config.tp_rr_ratio}")

    # confirm_bars=0 significa entrar en el close de la misma vela de breakout
    need_confirm = max(0, config.breakout_confirm_bars)

    from datetime import datetime, timezone as tz_utc
    _fmt = lambda ts: datetime.fromtimestamp(ts / 1000, tz=tz_utc.utc).strftime('%m/%d %H:%M') if ts else '?'

    for zone_idx, zone in enumerate(zones):
        zone_end_idx = zone['window_end']
        zone_start_idx = zone['window_start']
        zone_id = f"vp_{zone['start_timestamp']}_{zone_idx}"
        zone['id'] = zone_id
        zone['source'] = 'vp_scanner'

        # Determinar limites de breakout segun entry_mode
        if config.entry_mode == 'zone':
            bo_high = zone.get('full_range_max', zone['max_price'])
            bo_low = zone.get('full_range_min', zone['min_price'])
        else:
            # "va" (default) - Breakout del Value Area
            bo_high = zone['max_price']
            bo_low = zone['min_price']

        zone_high = zone['max_price']  # VA limits (para SL)
        zone_low = zone['min_price']
        zone_range = zone_high - zone_low

        if zone_range <= 0:
            zone['trade_result'] = 'SKIPPED'
            zone['trade_pnl_r'] = 0
            results.append(zone)
            continue

        # ===================================================================
        # FIX: Buscar breakout DENTRO de la zona, no solo despues.
        # Las ultimas velas de la ventana pueden ya estar rompiendo el VA.
        # Empezamos a buscar despues de un minimo de velas de consolidacion
        # para que haya suficiente base antes del breakout.
        # ===================================================================
        breakout_found = False
        confirm_count = 0
        breakout_dir = None

        # Minimo de velas de consolidacion antes de buscar breakout
        # En modo progresivo, respetar prog_min_candles como minimo de consolidacion
        if config.detection_mode == 'progressive':
            min_consol = max(config.prog_min_candles, config.min_zone_candles, 10)
        else:
            min_consol = max(config.min_zone_candles, 10)
        search_start = zone_start_idx + min_consol
        search_end = min(zone_end_idx + config.lookforward_bars, len(candles))

        logger.info(f"[VP_TRADE] #{zone_idx} zone=[{zone_start_idx}-{zone_end_idx}] "
                    f"search=[{search_start}-{search_end}] "
                    f"end_ts={_fmt(candles[zone_end_idx]['timestamp'] if zone_end_idx < len(candles) else 0)} "
                    f"bo_high={bo_high:.2f} bo_low={bo_low:.2f} "
                    f"VA=[{zone_low:.2f}-{zone_high:.2f}] "
                    f"full=[{zone.get('full_range_min', 0):.2f}-{zone.get('full_range_max', 0):.2f}] "
                    f"entry_mode={config.entry_mode} confirm={need_confirm}")

        _bars_searched = 0
        for i in range(search_start, search_end):
            c = candles[i]
            _bars_searched += 1

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

            # confirm_bars=0 o 1: entra en la primera vela que cierra fuera
            # confirm_bars=2+: espera N cierres consecutivos fuera, entra en la vela N
            confirmed = confirm_count >= max(1, need_confirm)
            if breakout_dir and confirmed:
                # Sequential mode: no abrir si hay trade abierto
                if config.position_mode == 'sequential' and open_trade is not None:
                    zone['trade_result'] = 'SKIPPED'
                    zone['trade_pnl_r'] = 0
                    zone['skip_reason'] = 'sequential_blocked'
                    logger.info(f"[VP_TRADE] #{zone_idx} SKIPPED (sequential bloqueado por "
                                f"trade abierto: {open_trade.get('id', '?')}, "
                                f"estado={open_trade.get('trade_result', '?')})")
                    breakout_found = True
                    break

                entry_price = c['close']
                entry_ts = c['timestamp']

                # Calcular SL segun sl_mode
                poc = zone['poc_price']

                if config.sl_mode == 'beyond_poc':
                    # SL detras del POC (mas agresivo)
                    buffer = 1.0 + config.sl_buffer_pct / 100.0
                    if breakout_dir == 'UP':
                        risk = (entry_price - poc) * buffer
                    else:
                        risk = (poc - entry_price) * buffer
                elif config.sl_mode == 'below_va':
                    # SL detras del Value Area
                    buffer = 1.0 + config.sl_buffer_pct / 100.0
                    if breakout_dir == 'UP':
                        risk = (entry_price - zone_low) * buffer
                    else:
                        risk = (zone_high - entry_price) * buffer
                else:
                    # zone_opposite: SL al otro extremo de la zona completa
                    full_low = zone.get('full_range_min', zone_low)
                    full_high = zone.get('full_range_max', zone_high)
                    full_range = full_high - full_low
                    if breakout_dir == 'UP':
                        risk = entry_price - full_low + full_range * config.sl_buffer_pct / 100
                    else:
                        risk = full_high - entry_price + full_range * config.sl_buffer_pct / 100

                if risk <= 0:
                    risk = zone_range * 0.5

                if breakout_dir == 'UP':
                    sl_price = entry_price - risk
                    tp_price = entry_price + risk * config.tp_rr_ratio
                else:
                    sl_price = entry_price + risk
                    tp_price = entry_price - risk * config.tp_rr_ratio

                # Monitorear trade - SL/TP escanea TODAS las velas restantes,
                # no solo las del lookforward de breakout
                trade_result = 'OPEN'
                trade_pnl_r = 0.0
                close_ts = None

                for j in range(i + 1, len(candles)):
                    tc = candles[j]
                    hit_tp = False
                    hit_sl = False

                    if breakout_dir == 'UP':
                        hit_tp = tc['high'] >= tp_price
                        hit_sl = tc['low'] <= sl_price
                    else:
                        hit_tp = tc['low'] <= tp_price
                        hit_sl = tc['high'] >= sl_price

                    if hit_sl and hit_tp:
                        if breakout_dir == 'UP':
                            hit_sl_first = tc['open'] <= sl_price
                        else:
                            hit_sl_first = tc['open'] >= sl_price
                        if hit_sl_first:
                            hit_tp = False
                        else:
                            hit_sl = False

                    if hit_tp:
                        trade_result = 'WIN'
                        trade_pnl_r = config.tp_rr_ratio
                        close_ts = tc['timestamp']
                        break
                    elif hit_sl:
                        trade_result = 'LOSS'
                        trade_pnl_r = -1.0
                        close_ts = tc['timestamp']
                        break

                zone['breakout_direction'] = breakout_dir
                zone['breakout_timestamp'] = c['timestamp']
                zone['entry_price'] = entry_price
                zone['entry_timestamp'] = entry_ts
                zone['sl_price'] = sl_price
                zone['tp_price'] = tp_price
                zone['risk'] = risk
                zone['trade_result'] = trade_result
                zone['trade_pnl_r'] = trade_pnl_r
                zone['trade_close_timestamp'] = close_ts
                zone['state'] = 'RESOLVED' if trade_result in ('WIN', 'LOSS') else 'OPEN'

                # Recortar end_timestamp de la zona a la vela anterior al breakout
                # para que el rectangulo visual termine donde acaba la consolidacion real
                if i > zone_start_idx:
                    breakout_candle_idx = i
                    consol_last_idx = breakout_candle_idx - 1
                    if consol_last_idx >= zone_start_idx:
                        zone['end_timestamp'] = candles[consol_last_idx]['timestamp']
                        zone['window_end'] = consol_last_idx

                        # Recalcular VP solo con velas de consolidacion (sin post-breakout)
                        # para que el perfil visual coincida con el rectangulo
                        consol_candles = candles[zone_start_idx:consol_last_idx + 1]
                        if len(consol_candles) >= 5:
                            consol_vp = compute_volume_profile(
                                consol_candles, bins=config.bins,
                                va_percent=config.va_percent)
                            zone['volume_profile'] = _build_vp_for_frontend(consol_vp)
                            # Actualizar limites VA al VP recortado
                            zone['min_price'] = consol_vp['val_price']
                            zone['max_price'] = consol_vp['vah_price']
                            zone['poc_price'] = consol_vp['poc']['price']
                            zone['full_range_min'] = consol_vp['min_price']
                            zone['full_range_max'] = consol_vp['max_price']
                            zone['candle_count'] = len(consol_candles)

                            # Re-clasificar forma con VP recortado
                            cut_shape = classify_shape(consol_vp)
                            zone['shape_type'] = cut_shape['shape_type']
                            zone['d_score'] = cut_shape['d_score']
                            zone['shape_metrics'] = cut_shape

                            # Validar forma post-recorte
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

                            if not is_d_cut and not is_pb_cut_ok:
                                # Perfil recortado no es D valido -> descartar zona
                                zone['trade_result'] = 'SKIPPED'
                                zone['trade_pnl_r'] = 0
                                zone['skip_reason'] = 'shape_invalid_after_cut'
                                logger.info(f"[VP_TRADE] #{zone_idx} SKIPPED post-cut: "
                                            f"shape={cut_shape['shape_type']} "
                                            f"d_score={cut_shape['d_score']} "
                                            f"(include_pb={config.include_pb_shapes})")
                                breakout_found = True
                                break

                # Logging por trade
                bars_to_close = (j - i) if close_ts else 'N/A'
                bars_searched = i - search_start + 1
                logger.info(f"[VP_TRADE] #{zone_idx} {breakout_dir} entry={entry_price:.2f} "
                            f"SL={sl_price:.2f} TP={tp_price:.2f} risk={risk:.2f} "
                            f"-> {trade_result} (pnl={trade_pnl_r:+.1f}R, bars_to_close={bars_to_close}, "
                            f"bars_searched={bars_searched})")

                # Manejar sequential
                if trade_result == 'OPEN':
                    open_trade = zone
                    logger.warning(f"[VP_TRADE] #{zone_idx} quedo OPEN - no hay mas velas para resolver "
                                   f"(entry_idx={i}, total_candles={len(candles)})")
                elif trade_result in ('WIN', 'LOSS'):
                    open_trade = None

                breakout_found = True
                break

        if not breakout_found:
            zone['trade_result'] = 'NO_BREAKOUT'
            zone['trade_pnl_r'] = 0
            zone['state'] = 'COMPLETE'
            logger.info(f"[VP_TRADE] #{zone_idx} NO_BREAKOUT en {search_end - search_start} velas buscadas "
                        f"(zona: {zone['min_price']:.2f}-{zone['max_price']:.2f})")

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

def backtest_vp(candles: List[Dict], config_overrides: Dict = None) -> Dict:
    """
    Ejecuta backtest historico usando el scanner VP.

    Args:
        candles: Lista de velas OHLCV ordenadas por timestamp asc
        config_overrides: Parametros a sobreescribir

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

    logger.info(f"[VP_BACKTEST] Config: include_pb_shapes={cfg.include_pb_shapes}, "
                f"entry_mode={cfg.entry_mode}, sl_mode={cfg.sl_mode}, "
                f"min_d_score={cfg.min_d_score}, detection_mode={cfg.detection_mode}")

    # Seleccionar metodo de deteccion
    if cfg.detection_mode == 'progressive':
        zones = scan_zones_progressive(candles, cfg)
    else:
        zones = scan_zones(candles, cfg)

    # Filtrar score
    if cfg.min_d_score > 0:
        zones = [z for z in zones if z.get('d_score', 0) >= cfg.min_d_score]

    # Estadisticas
    resolved = [z for z in zones if z.get('trade_result') in ('WIN', 'LOSS')]
    open_trades = [z for z in zones if z.get('trade_result') == 'OPEN']
    wins = [z for z in resolved if z['trade_result'] == 'WIN']
    losses = [z for z in resolved if z['trade_result'] == 'LOSS']

    total_closed = len(wins) + len(losses)
    total_pnl_r = sum(z.get('trade_pnl_r', 0) for z in resolved)
    win_rate = (len(wins) / total_closed * 100) if total_closed > 0 else 0
    expectancy = (total_pnl_r / total_closed) if total_closed > 0 else 0

    gross_profit = sum(z.get('trade_pnl_r', 0) for z in wins)
    gross_loss = abs(sum(z.get('trade_pnl_r', 0) for z in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (
        99.9 if gross_profit > 0 else 0)

    # Equity curve & max drawdown
    trades_sorted = sorted(resolved,
                           key=lambda z: z.get('entry_timestamp', 0))
    max_equity = 0.0
    max_drawdown = 0.0
    equity = 0.0
    equity_curve = []
    for z in trades_sorted:
        equity += z.get('trade_pnl_r', 0)
        if equity > max_equity:
            max_equity = equity
        dd = max_equity - equity
        if dd > max_drawdown:
            max_drawdown = dd
        equity_curve.append({
            'timestamp': z.get('trade_close_timestamp',
                               z.get('entry_timestamp', 0)),
            'equity': round(equity, 2),
        })

    # Progressive quality promedio (solo aplica en modo progresivo)
    pq_values = [z.get('progressive_quality', 0) for z in zones
                 if z.get('progressive_quality') is not None]
    avg_pq = round(sum(pq_values) / len(pq_values), 1) if pq_values else 0
    # Combined: zones * avg_progressive_quality
    zones_x_quality = round(len(zones) * avg_pq, 1)

    return {
        'zones': zones,
        'stats': {
            'total_zones': len(zones),
            'wins': len(wins),
            'losses': len(losses),
            'open': len(open_trades),
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
