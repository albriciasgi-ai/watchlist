# zone_detector.py
# Zone Detector 2.0 - Detecta zonas de consolidación (rangos) usando múltiples métodos
# Permite comparar cuál funciona mejor para el trading

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import numpy as np
from collections import defaultdict


@dataclass
class Zone:
    """Representa una zona de consolidación detectada"""
    id: str
    min_price: float
    max_price: float
    start_timestamp: int
    end_timestamp: int
    touches_support: int
    touches_resistance: int
    total_touches: int
    duration_hours: float
    avg_volume: float
    volume_score: float  # 0-100, qué tan alto es el volumen en esta zona
    method: str  # Método usado para detectar
    score: float  # Score de calidad 0-100
    candles_in_zone: int
    price_range_pct: float  # Rango como % del precio medio

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TradingZone(Zone):
    """
    Zona de consolidacion con metricas de trading para simulacion.
    Extiende Zone con datos de rentabilidad post-breakout.
    """
    # Metricas de Trading (calculadas por el analizador)
    breakout_direction: str = ""  # "UP" o "DOWN"
    breakout_price: float = 0.0
    breakout_timestamp: int = 0

    # Entrada real (puede diferir de breakout_price segun entry_mode)
    entry_mode: str = ""  # "breakout_close", "swing_confirmation"
    entry_price: float = 0.0  # Precio real de entrada
    entry_timestamp: int = 0  # Timestamp de la vela de entrada
    entry_bar_offset: int = 0  # Velas entre breakout y entrada

    # Niveles del trade (para visualizacion)
    sl_price: float = 0.0  # Stop Loss
    tp_price: float = 0.0  # Take Profit

    # Resultado del trade simulado (TP=tp_rr_ratio*R, SL=1R, o cierre al final de datos)
    trade_result: str = ""  # "WIN", "LOSS", "SKIPPED", "NO_ENTRY"
    trade_pnl_r: float = 0.0  # +2 si TP, -1 si SL, parcial si cierre al final
    bars_to_close: int = 0  # Velas desde entrada hasta cierre
    trade_close_timestamp: int = 0  # Timestamp donde cierra el trade (para visualizacion)

    # R-Multiple alcanzado
    r_multiple: float = 0.0
    reached_2r: bool = False
    reached_3r: bool = False

    # Metricas de momentum
    breakout_body_ratio: float = 0.0  # Cuerpo de vela de breakout / ATR
    continuation_bars: int = 0  # Velas consecutivas en direccion del breakout

    # Score de trading (basado en rentabilidad, no solo consolidacion)
    trading_score: float = 0.0  # 0-100 basado en probabilidad de exito

    # Volume Profile de la zona (para entry_mode=va_breakout)
    vp_poc_price: float = 0.0    # Point of Control (precio con mayor volumen)
    vp_vah_price: float = 0.0    # Value Area High
    vp_val_price: float = 0.0    # Value Area Low
    vp_total_volume: float = 0.0 # Volumen total en la zona

    # Indice cronologico (para que frontend muestre numero temporal, no por score)
    timeline_index: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ZoneDetectionParams:
    """Parámetros configurables para detección de zonas"""
    # Filtro global - rangos de precio máximo permitido
    max_price_range_pct: float = 10.0  # Máximo % de rango para considerar zona válida

    # Pivot Cluster Method
    pivot_tolerance_pct: float = 0.3  # % de distancia para agrupar pivots
    pivot_min_touches: int = 3
    pivot_min_duration_hours: float = 4.0
    pivot_swing_bars: int = 5

    # ATR Based Method
    atr_period: int = 14
    atr_threshold: float = 0.7  # Multiplicador de ATR para considerar "bajo"
    atr_min_bars: int = 10

    # Volume Profile Method
    vp_value_area_pct: float = 70  # % del volumen para Value Area
    vp_min_volume_ratio: float = 1.5  # Volumen mínimo vs promedio
    vp_price_bins: int = 50

    # Price Action Method
    pa_touch_tolerance_pct: float = 0.2
    pa_min_touches: int = 3
    pa_lookback_bars: int = 100
    pa_min_separation_bars: int = 5

    # 🎯 NUEVO: Consolidation Method (detecta rangos laterales compactos)
    consol_min_bars: int = 8           # Mínimo de velas en consolidación
    consol_max_bars: int = 50          # Máximo de velas (evita rangos muy largos)
    consol_max_range_pct: float = 3.0  # Máximo % de rango de precio
    consol_atr_ratio: float = 0.6      # ATR de la zona vs ATR global (< 1 = baja volatilidad)
    consol_body_ratio: float = 0.5     # Ratio cuerpo/rango de velas (velas pequeñas)
    consol_max_outside_bars: int = 3   # Máximo velas consecutivas fuera del rango antes de cerrar

    # Trading Zones Method (simulacion de trades)
    tp_rr_ratio: float = 2.0          # Risk:Reward ratio para Take Profit (ej: 2.0 = TP a 2R)
    lookforward_bars: int = 100        # Velas hacia adelante para simular el trade
    breakout_search_bars: int = 20     # Velas para buscar breakout despues de la consolidacion
    include_no_breakout: bool = True   # Incluir zonas sin breakout claro (usa primera vela fuera)
    entry_mode: str = "breakout_close"  # "breakout_close", "swing_confirmation" o "va_breakout"
    position_mode: str = "sequential"   # "sequential" (una a la vez) o "concurrent" (simultaneas)
    swing_bars: int = 5                 # Velas a cada lado para confirmar swing (solo para swing_confirmation)
    sl_mode: str = "zone_opposite"     # "zone_opposite" (SL al lado opuesto del rango) o "swing_previous" (SL al swing H/L anterior)
    sl_poc_buffer_pct: float = 50.0    # % extra de distancia entry->POC para SL (solo va_breakout). Ej: 50 = SL a 1.5x la distancia entry->POC
    vp_bins_per_zone: int = 30         # Bins de precio para VP de cada zona (mas = mas detalle)

    # --- Capas opcionales v3.0 ---

    # Capa 1: Banda ATR dinamica (reemplaza high/low absoluto para definir limites del rango)
    use_atr_band: bool = False
    atr_band_period: int = 200         # Periodo ATR largo para volatilidad de fondo
    atr_band_multiplier: float = 1.0   # Ancho de la banda: SMA +/- ATR*mult
    atr_band_ma_period: int = 20       # Periodo de la SMA central

    # Capa 2: Re-ingreso tolerante (permite velas fuera temporalmente sin romper la zona)
    use_reentry: bool = False
    max_reentry_bars: int = 3          # Max velas fuera antes de romper

    # Capa 3: TTM Squeeze como pre-filtro (solo busca zonas donde volatilidad esta comprimida)
    use_ttm_prefilter: bool = False
    ttm_atr_length: int = 20           # Periodo ATR para Keltner Channels
    ttm_kc_multiplier: float = 1.5     # Multiplicador Keltner: SMA +/- ATR*mult
    ttm_min_squeeze_bars: int = 5      # Minimo velas consecutivas con squeeze ON

    # Capa 4: BBWP como scoring (bonus/penalizacion segun compresion de volatilidad)
    use_bbwp_scoring: bool = False
    bbwp_lookback: int = 252           # Periodos para calcular percentil
    bbwp_squeeze_threshold: int = 20   # BBWP < esto = squeeze (bonus)
    bbwp_history_days: int = 0         # Dias extra de historial para BBWP (0 = usar mismos datos)

    # Capa 5: % velas dentro como validacion (descarta zonas con muchas velas fuera)
    use_inside_pct_filter: bool = False
    min_inside_pct: float = 70.0       # Minimo % de velas con cuerpo dentro del rango

    # --- ATR Dynamic Method (basado en ATRBasedRangeDetector) ---
    # Usa SMA +/- ATR como limites dinamicos del rango
    atr_dyn_period: int = 200          # Periodo del ATR (volatilidad de fondo)
    atr_dyn_ma_period: int = 20        # Periodo de la SMA (tambien minimo velas)
    atr_dyn_multiplier: float = 1.0    # Ancho de banda: SMA +/- ATR*mult
    atr_dyn_min_bars: int = 0          # Minimo velas en zona (0 = usar atr_dyn_ma_period)
    atr_dyn_max_breakout: int = 5      # Velas fuera permitidas antes de romper
    atr_dyn_merge_overlap: bool = True # Mergear rangos que se solapan en tiempo/precio

    # --- Filtro de calidad ---
    min_score_filter: float = 0.0      # Score minimo (0-100) para incluir zona. 0 = sin filtro

    # --- Score intrinseco (sin sesgos post-trade) ---
    use_continuation_score: bool = False  # Solo usar si entry_mode=swing_confirmation (ya pasaron velas)


class ZoneDetector:
    """
    Detecta zonas de consolidación (rangos) usando múltiples métodos.
    Permite comparar cuál funciona mejor.
    """

    METHODS = ["pivot_cluster", "atr_based", "volume_profile", "price_action", "consolidation", "trading_zones", "atr_dynamic"]

    def __init__(self):
        self._zone_counter = 0

    def detect_zones(
        self,
        candles: List[Dict],
        method: str = "pivot_cluster",
        params: Optional[ZoneDetectionParams] = None,
        detection_start_idx: int = 0
    ) -> List[Zone]:
        """
        Detecta zonas de consolidación usando el método especificado.

        Args:
            candles: Lista de velas OHLCV
            method: Método de detección a usar
            params: Parámetros de configuración
            detection_start_idx: Indice desde donde detectar zonas (para BBWP extendido).
                                 Las velas antes de este indice solo se usan para contexto BBWP.

        Returns:
            Lista de zonas detectadas, ordenadas por score descendente
        """
        if params is None:
            params = ZoneDetectionParams()

        if len(candles) < 50:
            return []

        if method == "pivot_cluster":
            zones = self._pivot_cluster_method(candles, params)
        elif method == "atr_based":
            zones = self._atr_based_method(candles, params)
        elif method == "volume_profile":
            zones = self._volume_profile_method(candles, params)
        elif method == "price_action":
            zones = self._price_action_method(candles, params)
        elif method == "consolidation":
            zones = self._consolidation_method(candles, params)
        elif method == "trading_zones":
            zones = self._trading_zones_method(candles, params, params.lookforward_bars)
        elif method == "atr_dynamic":
            zones = self._atr_dynamic_method(candles, params, detection_start_idx=detection_start_idx)
        else:
            raise ValueError(f"Metodo desconocido: {method}. Usar: {self.METHODS}")

        # Filtrar zonas con rango de precio excesivo
        filtered_zones = []
        for zone in zones:
            if zone.price_range_pct <= params.max_price_range_pct:
                filtered_zones.append(zone)
            else:
                print(f"[ZoneDetector] Descartando zona {zone.id} - rango={zone.price_range_pct:.2f}% > máx={params.max_price_range_pct}%")

        # 🎯 NUEVO: Eliminar zonas duplicadas o muy similares
        deduplicated_zones = self._deduplicate_zones(filtered_zones)

        # Ordenar por score descendente
        return sorted(deduplicated_zones, key=lambda z: z.score, reverse=True)

    def detect_all_methods(
        self,
        candles: List[Dict],
        params: Optional[ZoneDetectionParams] = None
    ) -> Dict[str, List[Zone]]:
        """
        Ejecuta todos los métodos y retorna resultados para comparar.
        """
        results = {}
        for method in self.METHODS:
            try:
                results[method] = self.detect_zones(candles, method, params)
            except Exception as e:
                print(f"[ZoneDetector] Error en método {method}: {e}")
                results[method] = []
        return results

    # =========================================================================
    # MÉTODO 1: PIVOT CLUSTER
    # Agrupa swing highs/lows que están cerca en precio
    # =========================================================================

    def _pivot_cluster_method(
        self,
        candles: List[Dict],
        params: ZoneDetectionParams
    ) -> List[Zone]:
        """
        Detecta zonas agrupando pivots (swing highs/lows) por cercanía de precio.
        """
        # 1. Detectar todos los pivots
        pivots = self._detect_pivots(candles, params.pivot_swing_bars)

        if len(pivots) < 2:
            return []

        # 2. Agrupar pivots por precio usando clustering
        clusters = self._cluster_pivots_by_price(
            pivots,
            params.pivot_tolerance_pct
        )

        # 3. Filtrar clusters válidos y convertir a zonas
        zones = []
        for cluster in clusters:
            if len(cluster) < params.pivot_min_touches:
                continue

            # Calcular rango de la zona
            prices = [p['price'] for p in cluster]
            min_price = min(prices)
            max_price = max(prices)

            # Calcular timestamps
            timestamps = [p['timestamp'] for p in cluster]
            start_ts = min(timestamps)
            end_ts = max(timestamps)

            # Calcular duración
            duration_hours = (end_ts - start_ts) / (1000 * 60 * 60)

            if duration_hours < params.pivot_min_duration_hours:
                continue

            # Contar toques en soporte vs resistencia
            mid_price = (min_price + max_price) / 2
            touches_support = sum(1 for p in cluster if p['price'] < mid_price)
            touches_resistance = sum(1 for p in cluster if p['price'] >= mid_price)

            # Calcular volumen promedio en la zona
            zone_candles = [c for c in candles
                          if start_ts <= c['timestamp'] <= end_ts]
            avg_volume = np.mean([c['volume'] for c in zone_candles]) if zone_candles else 0

            # Calcular volume score
            all_volumes = [c['volume'] for c in candles]
            volume_score = self._calculate_volume_score(avg_volume, all_volumes)

            # Calcular score de calidad
            score = self._calculate_zone_score(
                touches=len(cluster),
                duration_hours=duration_hours,
                volume_score=volume_score,
                price_range_pct=((max_price - min_price) / min_price) * 100,
                balance=min(touches_support, touches_resistance) / max(touches_support, touches_resistance, 1)
            )

            zone = Zone(
                id=self._generate_zone_id(),
                min_price=min_price,
                max_price=max_price,
                start_timestamp=start_ts,
                end_timestamp=end_ts,
                touches_support=touches_support,
                touches_resistance=touches_resistance,
                total_touches=len(cluster),
                duration_hours=duration_hours,
                avg_volume=avg_volume,
                volume_score=volume_score,
                method="pivot_cluster",
                score=score,
                candles_in_zone=len(zone_candles),
                price_range_pct=((max_price - min_price) / min_price) * 100
            )
            zones.append(zone)

        return zones

    def _detect_pivots(self, candles: List[Dict], swing_bars: int) -> List[Dict]:
        """
        Detecta swing highs y swing lows.
        Un pivot high requiere 'swing_bars' velas menores a cada lado.
        Un pivot low requiere 'swing_bars' velas mayores a cada lado.
        """
        pivots = []
        n = len(candles)

        for i in range(swing_bars, n - swing_bars):
            candle = candles[i]
            high = candle['high']
            low = candle['low']

            # Check for swing high
            is_swing_high = True
            for j in range(i - swing_bars, i + swing_bars + 1):
                if j != i and candles[j]['high'] >= high:
                    is_swing_high = False
                    break

            if is_swing_high:
                pivots.append({
                    'type': 'high',
                    'price': high,
                    'timestamp': candle['timestamp'],
                    'index': i,
                    'volume': candle['volume']
                })

            # Check for swing low
            is_swing_low = True
            for j in range(i - swing_bars, i + swing_bars + 1):
                if j != i and candles[j]['low'] <= low:
                    is_swing_low = False
                    break

            if is_swing_low:
                pivots.append({
                    'type': 'low',
                    'price': low,
                    'timestamp': candle['timestamp'],
                    'index': i,
                    'volume': candle['volume']
                })

        return pivots

    def _cluster_pivots_by_price(
        self,
        pivots: List[Dict],
        tolerance_pct: float
    ) -> List[List[Dict]]:
        """
        Agrupa pivots que están dentro de tolerance_pct de distancia en precio.
        """
        if not pivots:
            return []

        # Ordenar por precio
        sorted_pivots = sorted(pivots, key=lambda p: p['price'])

        clusters = []
        current_cluster = [sorted_pivots[0]]

        for i in range(1, len(sorted_pivots)):
            pivot = sorted_pivots[i]
            prev_pivot = sorted_pivots[i - 1]

            # Calcular distancia porcentual
            distance_pct = abs(pivot['price'] - prev_pivot['price']) / prev_pivot['price'] * 100

            if distance_pct <= tolerance_pct:
                current_cluster.append(pivot)
            else:
                if len(current_cluster) >= 2:
                    clusters.append(current_cluster)
                current_cluster = [pivot]

        # No olvidar el último cluster
        if len(current_cluster) >= 2:
            clusters.append(current_cluster)

        return clusters

    # =========================================================================
    # MÉTODO 2: ATR BASED
    # Detecta períodos de baja volatilidad
    # =========================================================================

    def _atr_based_method(
        self,
        candles: List[Dict],
        params: ZoneDetectionParams
    ) -> List[Zone]:
        """
        Detecta zonas donde el ATR está por debajo del promedio.
        """
        # Calcular ATR (serie completa)
        atr_values = self._calculate_atr_series(candles, params.atr_period)

        if len(atr_values) < params.atr_min_bars:
            return []

        # Calcular umbral de ATR bajo
        avg_atr = np.mean(atr_values)
        threshold = avg_atr * params.atr_threshold

        # Encontrar períodos donde ATR < threshold
        zones = []
        in_zone = False
        zone_start_idx = 0

        for i, atr in enumerate(atr_values):
            if atr < threshold and not in_zone:
                in_zone = True
                zone_start_idx = i + params.atr_period  # Offset por cálculo de ATR
            elif (atr >= threshold or i == len(atr_values) - 1) and in_zone:
                in_zone = False
                zone_end_idx = i + params.atr_period

                # Verificar duración mínima
                if zone_end_idx - zone_start_idx >= params.atr_min_bars:
                    zone = self._create_zone_from_range(
                        candles,
                        zone_start_idx,
                        zone_end_idx,
                        "atr_based"
                    )
                    if zone:
                        zones.append(zone)

        return zones

    def _calculate_atr_series(self, candles: List[Dict], period: int) -> List[float]:
        """Calcula serie completa de Average True Range (una valor por vela)."""
        if len(candles) < period + 1:
            return []

        tr_values = []
        for i in range(1, len(candles)):
            high = candles[i]['high']
            low = candles[i]['low']
            prev_close = candles[i - 1]['close']

            tr = max(
                high - low,
                abs(high - prev_close),
                abs(low - prev_close)
            )
            tr_values.append(tr)

        # Calcular ATR como SMA de TR
        atr_values = []
        for i in range(period - 1, len(tr_values)):
            atr = np.mean(tr_values[i - period + 1:i + 1])
            atr_values.append(atr)

        return atr_values

    # =========================================================================
    # MÉTODO 3: VOLUME PROFILE
    # Detecta zonas con alto volumen acumulado
    # =========================================================================

    def _volume_profile_method(
        self,
        candles: List[Dict],
        params: ZoneDetectionParams
    ) -> List[Zone]:
        """
        Detecta zonas donde se concentra el volumen (Value Area).
        """
        # Calcular rango de precios
        all_highs = [c['high'] for c in candles]
        all_lows = [c['low'] for c in candles]
        price_high = max(all_highs)
        price_low = min(all_lows)

        # Crear bins de precio
        bin_size = (price_high - price_low) / params.vp_price_bins
        if bin_size == 0:
            return []

        # Acumular volumen por bin
        volume_by_bin = defaultdict(float)
        candles_by_bin = defaultdict(list)

        for i, candle in enumerate(candles):
            # Distribuir volumen del candle entre los bins que toca
            candle_low = candle['low']
            candle_high = candle['high']
            candle_volume = candle['volume']

            low_bin = int((candle_low - price_low) / bin_size)
            high_bin = int((candle_high - price_low) / bin_size)

            bins_touched = high_bin - low_bin + 1
            volume_per_bin = candle_volume / bins_touched

            for b in range(low_bin, high_bin + 1):
                b = min(b, params.vp_price_bins - 1)  # Clamp
                volume_by_bin[b] += volume_per_bin
                candles_by_bin[b].append(i)

        # Encontrar Point of Control (POC) y Value Area
        total_volume = sum(volume_by_bin.values())
        if total_volume == 0:
            return []

        # Ordenar bins por volumen
        sorted_bins = sorted(volume_by_bin.items(), key=lambda x: x[1], reverse=True)

        # Encontrar Value Area (70% del volumen)
        va_volume = 0
        va_bins = []
        target_volume = total_volume * (params.vp_value_area_pct / 100)

        for bin_idx, volume in sorted_bins:
            va_bins.append(bin_idx)
            va_volume += volume
            if va_volume >= target_volume:
                break

        if not va_bins:
            return []

        # Encontrar rangos contiguos en Value Area
        va_bins_sorted = sorted(va_bins)
        zones = []

        # Agrupar bins contiguos
        groups = []
        current_group = [va_bins_sorted[0]]

        for i in range(1, len(va_bins_sorted)):
            if va_bins_sorted[i] - va_bins_sorted[i-1] <= 2:  # Permitir 1 gap
                current_group.append(va_bins_sorted[i])
            else:
                groups.append(current_group)
                current_group = [va_bins_sorted[i]]
        groups.append(current_group)

        # Convertir grupos a zonas
        for group in groups:
            if len(group) < 2:
                continue

            min_bin = min(group)
            max_bin = max(group)

            zone_min_price = price_low + min_bin * bin_size
            zone_max_price = price_low + (max_bin + 1) * bin_size

            # Encontrar candles en este rango
            zone_candle_indices = set()
            for b in group:
                zone_candle_indices.update(candles_by_bin[b])

            if not zone_candle_indices:
                continue

            zone_candles = [candles[i] for i in sorted(zone_candle_indices)]

            # Calcular volumen de la zona
            zone_volume = sum(volume_by_bin[b] for b in group)
            avg_volume = zone_volume / len(group)

            # Calcular timestamps
            start_ts = min(c['timestamp'] for c in zone_candles)
            end_ts = max(c['timestamp'] for c in zone_candles)
            duration_hours = (end_ts - start_ts) / (1000 * 60 * 60)

            # Contar toques
            touches = self._count_touches_in_range(
                candles, zone_min_price, zone_max_price
            )

            # Volume score
            all_volumes = [c['volume'] for c in candles]
            volume_score = self._calculate_volume_score(avg_volume, all_volumes)

            # Score
            score = self._calculate_zone_score(
                touches=touches['total'],
                duration_hours=duration_hours,
                volume_score=volume_score,
                price_range_pct=((zone_max_price - zone_min_price) / zone_min_price) * 100,
                balance=min(touches['support'], touches['resistance']) / max(touches['support'], touches['resistance'], 1)
            )

            zone = Zone(
                id=self._generate_zone_id(),
                min_price=zone_min_price,
                max_price=zone_max_price,
                start_timestamp=start_ts,
                end_timestamp=end_ts,
                touches_support=touches['support'],
                touches_resistance=touches['resistance'],
                total_touches=touches['total'],
                duration_hours=duration_hours,
                avg_volume=avg_volume,
                volume_score=volume_score,
                method="volume_profile",
                score=score,
                candles_in_zone=len(zone_candles),
                price_range_pct=((zone_max_price - zone_min_price) / zone_min_price) * 100
            )
            zones.append(zone)

        return zones

    # =========================================================================
    # MÉTODO 4: PRICE ACTION
    # Detecta niveles con múltiples toques
    # =========================================================================

    def _price_action_method(
        self,
        candles: List[Dict],
        params: ZoneDetectionParams
    ) -> List[Zone]:
        """
        Detecta zonas basándose en múltiples toques a niveles de precio.
        """
        # Recolectar todos los highs y lows
        levels = []
        for i, candle in enumerate(candles):
            levels.append({'price': candle['high'], 'type': 'high', 'index': i, 'timestamp': candle['timestamp']})
            levels.append({'price': candle['low'], 'type': 'low', 'index': i, 'timestamp': candle['timestamp']})

        # Agrupar niveles cercanos
        tolerance = params.pa_touch_tolerance_pct / 100

        # Encontrar niveles con múltiples toques
        price_touches = defaultdict(list)

        for level in levels:
            # Buscar si ya existe un nivel cercano
            found = False
            for existing_price in list(price_touches.keys()):
                if abs(level['price'] - existing_price) / existing_price <= tolerance:
                    price_touches[existing_price].append(level)
                    found = True
                    break

            if not found:
                price_touches[level['price']].append(level)

        # Filtrar niveles con suficientes toques
        strong_levels = []
        for price, touches in price_touches.items():
            if len(touches) >= params.pa_min_touches:
                # Verificar que los toques están separados en el tiempo
                indices = sorted([t['index'] for t in touches])
                valid_touches = [indices[0]]

                for idx in indices[1:]:
                    if idx - valid_touches[-1] >= params.pa_min_separation_bars:
                        valid_touches.append(idx)

                if len(valid_touches) >= params.pa_min_touches:
                    strong_levels.append({
                        'price': price,
                        'touches': touches,
                        'valid_touches': len(valid_touches)
                    })

        # Emparejar niveles cercanos para formar zonas
        zones = []
        used_levels = set()

        # Ordenar por precio
        strong_levels.sort(key=lambda x: x['price'])

        for i, level1 in enumerate(strong_levels):
            if i in used_levels:
                continue

            # Buscar nivel cercano para formar zona
            for j, level2 in enumerate(strong_levels[i+1:], i+1):
                if j in used_levels:
                    continue

                price_diff_pct = (level2['price'] - level1['price']) / level1['price'] * 100

                # Si están suficientemente cerca pero no demasiado
                if 0.1 <= price_diff_pct <= 3.0:
                    used_levels.add(i)
                    used_levels.add(j)

                    # Crear zona
                    all_touches = level1['touches'] + level2['touches']
                    timestamps = [t['timestamp'] for t in all_touches]
                    start_ts = min(timestamps)
                    end_ts = max(timestamps)
                    duration_hours = (end_ts - start_ts) / (1000 * 60 * 60)

                    # Determinar soporte y resistencia
                    mid_price = (level1['price'] + level2['price']) / 2
                    touches_support = sum(1 for t in all_touches if t['price'] < mid_price)
                    touches_resistance = len(all_touches) - touches_support

                    # Calcular volumen
                    zone_candles = [c for c in candles if start_ts <= c['timestamp'] <= end_ts]
                    avg_volume = np.mean([c['volume'] for c in zone_candles]) if zone_candles else 0
                    all_volumes = [c['volume'] for c in candles]
                    volume_score = self._calculate_volume_score(avg_volume, all_volumes)

                    # Score
                    score = self._calculate_zone_score(
                        touches=len(all_touches),
                        duration_hours=duration_hours,
                        volume_score=volume_score,
                        price_range_pct=price_diff_pct,
                        balance=min(touches_support, touches_resistance) / max(touches_support, touches_resistance, 1)
                    )

                    zone = Zone(
                        id=self._generate_zone_id(),
                        min_price=level1['price'],
                        max_price=level2['price'],
                        start_timestamp=start_ts,
                        end_timestamp=end_ts,
                        touches_support=touches_support,
                        touches_resistance=touches_resistance,
                        total_touches=len(all_touches),
                        duration_hours=duration_hours,
                        avg_volume=avg_volume,
                        volume_score=volume_score,
                        method="price_action",
                        score=score,
                        candles_in_zone=len(zone_candles),
                        price_range_pct=price_diff_pct
                    )
                    zones.append(zone)
                    break

        return zones

    # =========================================================================
    # MÉTODO 5: CONSOLIDATION (Rangos laterales compactos)
    # Detecta períodos de baja volatilidad donde el precio se mueve lateralmente
    # =========================================================================

    def _consolidation_method(
        self,
        candles: List[Dict],
        params: ZoneDetectionParams
    ) -> List[Zone]:
        """
        Detecta consolidaciones laterales con detección dinámica de inicio y fin (breakout).

        Algoritmo:
        1. Escanea buscando inicio de consolidación (baja volatilidad)
        2. Extiende la zona mientras el precio se mantenga en el rango
        3. Cierra la zona cuando hay un breakout (vela que cierra fuera del rango)

        Criterios de consolidación:
        - Rango de precio estrecho (< max_range_pct%)
        - ATR local bajo comparado con ATR global
        - Velas con cuerpos pequeños (indecisión)

        Criterios de breakout (fin de zona):
        - Vela cierra fuera del rango (high > range_high O low < range_low)
        - Vela tiene cuerpo grande (momentum)
        """
        if len(candles) < params.consol_min_bars + 20:
            return []

        zones = []

        # Calcular ATR global para referencia
        global_atr = self._calculate_atr(candles, min(14, len(candles) // 4))
        if global_atr == 0:
            return []

        avg_price = np.mean([(c['high'] + c['low']) / 2 for c in candles])
        print(f"[ZoneDetector] Consolidation v2: ATR global = {global_atr:.2f}, precio promedio = {avg_price:.2f}")

        found_ranges = []
        i = 0

        while i < len(candles) - params.consol_min_bars:
            # Intentar iniciar una consolidación desde la posición i
            consol_start = i
            consol_end = i + params.consol_min_bars

            # Calcular rango inicial
            window = candles[consol_start:consol_end]
            range_high = max(c['high'] for c in window)
            range_low = min(c['low'] for c in window)
            range_mid = (range_high + range_low) / 2
            range_pct = ((range_high - range_low) / range_mid) * 100 if range_mid > 0 else 100

            # Verificar si cumple criterios iniciales de consolidación
            local_atr = self._calculate_atr(window, min(5, len(window) // 2))
            atr_ratio = local_atr / global_atr if global_atr > 0 else 1.0

            avg_body_ratio = self._calculate_avg_body_ratio(window)

            # Si no cumple criterios iniciales, avanzar
            if (range_pct > params.consol_max_range_pct or
                atr_ratio > params.consol_atr_ratio or
                avg_body_ratio > params.consol_body_ratio):
                i += 1
                continue

            # ✅ Encontramos inicio de consolidación, ahora extender horizontalmente hasta breakout
            # 🎯 IMPORTANTE: El rango vertical (range_high, range_low) YA NO SE EXPANDE
            # Solo se extiende la zona en el tiempo (horizontalmente)
            consecutive_outside = 0  # Contador de velas consecutivas fuera del rango
            last_valid_end = consol_end  # Última posición válida

            while consol_end < len(candles) and (consol_end - consol_start) < params.consol_max_bars:
                next_candle = candles[consol_end]

                # 🎯 FIX v3: Una vela "toca" el rango si su high/low intersectan con él
                # NO expandimos verticalmente - el rango está fijo desde las primeras velas
                candle_touches_range = not (next_candle['low'] > range_high or next_candle['high'] < range_low)

                if candle_touches_range:
                    # La vela toca el rango - resetear contador y extender horizontalmente
                    consecutive_outside = 0
                    last_valid_end = consol_end + 1
                else:
                    # Vela completamente fuera del rango
                    consecutive_outside += 1

                    # 🎯 Solo cerrar después de N velas consecutivas fuera
                    if consecutive_outside >= params.consol_max_outside_bars:
                        # Cerrar zona en la última posición válida (antes de las velas fuera)
                        consol_end = last_valid_end
                        break

                consol_end += 1

            # Verificar que la consolidación tiene suficiente duración
            consol_length = consol_end - consol_start
            if consol_length >= params.consol_min_bars:
                # Recalcular métricas finales
                final_window = candles[consol_start:consol_end]
                final_range_pct = ((range_high - range_low) / ((range_high + range_low) / 2)) * 100
                final_atr = self._calculate_atr(final_window, min(5, len(final_window) // 2))
                final_atr_ratio = final_atr / global_atr if global_atr > 0 else 1.0
                final_body_ratio = self._calculate_avg_body_ratio(final_window)

                # Calcular score
                range_score = max(0, (params.consol_max_range_pct - final_range_pct) / params.consol_max_range_pct) * 25
                atr_score = max(0, (params.consol_atr_ratio - final_atr_ratio) / params.consol_atr_ratio) * 25
                size_score = min(consol_length / 30, 1) * 25  # Más velas = mejor
                body_score = max(0, (params.consol_body_ratio - final_body_ratio) / params.consol_body_ratio) * 25

                total_score = range_score + atr_score + size_score + body_score

                found_ranges.append({
                    'start_idx': consol_start,
                    'end_idx': consol_end,
                    'score': total_score,
                    'range_pct': final_range_pct,
                    'atr_ratio': final_atr_ratio,
                    'consol_length': consol_length
                })

                # Saltar al final de esta consolidación para buscar la siguiente
                i = consol_end
            else:
                i += 1

        print(f"[ZoneDetector] Consolidation v2: Encontradas {len(found_ranges)} consolidaciones")

        # Eliminar rangos que se solapan mucho (mantener el de mejor score)
        found_ranges.sort(key=lambda x: x['score'], reverse=True)
        selected_ranges = []

        for r in found_ranges:
            overlaps = False
            for selected in selected_ranges:
                overlap_start = max(r['start_idx'], selected['start_idx'])
                overlap_end = min(r['end_idx'], selected['end_idx'])
                if overlap_end > overlap_start:
                    overlap_size = overlap_end - overlap_start
                    min_size = min(r['end_idx'] - r['start_idx'], selected['end_idx'] - selected['start_idx'])
                    if overlap_size / min_size > 0.3:  # Más del 30% overlap
                        overlaps = True
                        break

            if not overlaps:
                selected_ranges.append(r)

        print(f"[ZoneDetector] Consolidation v2: Seleccionadas {len(selected_ranges)} después de deduplicación")

        # Crear zonas a partir de los rangos seleccionados
        for r in selected_ranges:
            zone = self._create_zone_from_range(candles, r['start_idx'], r['end_idx'], "consolidation")
            if zone:
                zone = Zone(
                    id=zone.id,
                    min_price=zone.min_price,
                    max_price=zone.max_price,
                    start_timestamp=zone.start_timestamp,
                    end_timestamp=zone.end_timestamp,
                    touches_support=zone.touches_support,
                    touches_resistance=zone.touches_resistance,
                    total_touches=zone.total_touches,
                    duration_hours=zone.duration_hours,
                    avg_volume=zone.avg_volume,
                    volume_score=zone.volume_score,
                    method="consolidation",
                    score=r['score'],
                    candles_in_zone=zone.candles_in_zone,
                    price_range_pct=zone.price_range_pct
                )
                zones.append(zone)

        return zones

    # =========================================================================
    # MÉTODO 6: TRADING ZONES
    # Detecta zonas de consolidación y calcula métricas de trading (TP=2R, SL=1R)
    # =========================================================================

    def _trading_zones_method(
        self,
        candles: List[Dict],
        params: ZoneDetectionParams,
        lookforward_bars: int = 100
    ) -> List[TradingZone]:
        """
        Detecta zonas de consolidación y calcula métricas de trading para cada una.

        Usa el método de consolidación como base, pero extiende con:
        - Detección de breakout (UP/DOWN)
        - Simulación de trade (TP=2R, SL=1R adverso)
        - Score basado en probabilidad de éxito, no solo calidad de consolidación

        Args:
            candles: Lista de velas OHLCV
            params: Parámetros de detección
            lookforward_bars: Velas a analizar después del breakout

        Returns:
            Lista de TradingZone ordenadas por trading_score descendente
        """
        if len(candles) < params.consol_min_bars + 20:
            print(f"[ZoneDetector] Trading Zones: Insuficientes velas ({len(candles)})")
            return []

        trading_zones = []

        # Calcular ATR global para referencia
        global_atr = self._calculate_atr(candles, min(14, len(candles) // 4))
        if global_atr == 0:
            return []

        # Pre-calcular ATR rolling
        atr_values = self._calculate_rolling_atr_for_trading(candles, 14)

        print(f"[ZoneDetector] ===== VERSION 3.0 (5 capas opcionales) =====")
        print(f"[ZoneDetector] Trading Zones: ATR global = {global_atr:.2f}, velas = {len(candles)}")
        print(f"[ZoneDetector] Config: entry_mode={params.entry_mode}, position_mode={params.position_mode}, swing_bars={params.swing_bars}, sl_mode={params.sl_mode}")

        # --- Pre-calculos condicionales v3.0 ---
        # Solo calculamos lo que el usuario habilito

        # Para capas 1, 3 y 4 necesitamos SMA y std_dev (Bollinger base)
        bb_sma_values = []
        bb_std_values = []
        need_bb_base = params.use_ttm_prefilter or params.use_bbwp_scoring
        if need_bb_base:
            bb_period = params.atr_band_ma_period  # Usamos el mismo periodo (default 20)
            bb_sma_values = self._calculate_sma(candles, bb_period)
            bb_std_values = self._calculate_std_dev(candles, bb_period)

        # Capa 1: Banda ATR dinamica
        atr_band_sma = []
        atr_band_upper = []
        atr_band_lower = []
        if params.use_atr_band:
            atr_band_sma = self._calculate_sma(candles, params.atr_band_ma_period)
            long_atr = self._calculate_rolling_atr_for_trading(candles, params.atr_band_period)
            for idx in range(len(candles)):
                if atr_band_sma[idx] > 0 and long_atr[idx] > 0:
                    atr_band_upper.append(atr_band_sma[idx] + long_atr[idx] * params.atr_band_multiplier)
                    atr_band_lower.append(atr_band_sma[idx] - long_atr[idx] * params.atr_band_multiplier)
                else:
                    atr_band_upper.append(0.0)
                    atr_band_lower.append(0.0)
            print(f"[ZoneDetector] Capa 1 ATR Band: ON (period={params.atr_band_period}, mult={params.atr_band_multiplier}, ma={params.atr_band_ma_period})")

        # Capa 3: TTM Squeeze pre-filtro -> regiones donde buscar
        squeeze_regions = None  # None = buscar en todo el rango
        if params.use_ttm_prefilter:
            if not bb_sma_values:
                bb_sma_values = self._calculate_sma(candles, params.ttm_atr_length)
                bb_std_values = self._calculate_std_dev(candles, params.ttm_atr_length)
            squeeze_vals = self._calculate_ttm_squeeze_values(
                candles, bb_sma_values, bb_std_values,
                params.ttm_atr_length, params.ttm_kc_multiplier
            )
            squeeze_regions = self._find_squeeze_regions(squeeze_vals, params.ttm_min_squeeze_bars)
            print(f"[ZoneDetector] Capa 3 TTM Pre-filter: ON ({len(squeeze_regions)} regiones de squeeze encontradas)")

        # Capa 4: BBWP scoring (pre-calculo)
        bbwp_values = []
        if params.use_bbwp_scoring:
            if not bb_sma_values:
                bb_sma_values = self._calculate_sma(candles, 20)
                bb_std_values = self._calculate_std_dev(candles, 20)
            bbwp_values = self._calculate_bbwp_values(
                candles, bb_sma_values, bb_std_values, params.bbwp_lookback
            )
            print(f"[ZoneDetector] Capa 4 BBWP Scoring: ON (lookback={params.bbwp_lookback}, threshold={params.bbwp_squeeze_threshold})")

        # Log capas habilitadas
        layers_on = []
        if params.use_atr_band: layers_on.append("ATR_Band")
        if params.use_reentry: layers_on.append(f"Reentry({params.max_reentry_bars})")
        if params.use_ttm_prefilter: layers_on.append("TTM_Squeeze")
        if params.use_bbwp_scoring: layers_on.append("BBWP_Score")
        if params.use_inside_pct_filter: layers_on.append(f"InsidePct({params.min_inside_pct}%)")
        if layers_on:
            print(f"[ZoneDetector] Capas v3.0 activas: {', '.join(layers_on)}")
        else:
            print(f"[ZoneDetector] Capas v3.0: ninguna activa (modo clasico)")

        found_ranges = []
        i = 0

        # FASE 1: Detectar consolidaciones
        # Si TTM pre-filter esta activo, solo buscar dentro de squeeze regions
        if squeeze_regions is not None and len(squeeze_regions) > 0:
            search_ranges = squeeze_regions
        else:
            # Sin filtro: buscar en todo el rango de velas
            search_ranges = [(0, len(candles) - params.consol_min_bars)]

        for sr_start, sr_end in search_ranges:
            i = sr_start
            while i < min(sr_end + 1, len(candles) - params.consol_min_bars):
                consol_start = i
                consol_end = i + params.consol_min_bars

                window = candles[consol_start:consol_end]

                # --- Capa 1: Definir limites del rango ---
                if params.use_atr_band and atr_band_upper and atr_band_lower:
                    # Banda ATR: usar SMA +/- ATR*mult como limites
                    # Los limites son los de la vela CENTRAL de la ventana semilla
                    mid_idx = consol_start + params.consol_min_bars // 2
                    if mid_idx < len(atr_band_upper) and atr_band_upper[mid_idx] > 0:
                        range_high = atr_band_upper[mid_idx]
                        range_low = atr_band_lower[mid_idx]
                    else:
                        range_high = max(c['high'] for c in window)
                        range_low = min(c['low'] for c in window)
                else:
                    # Clasico: high/low absoluto de la ventana semilla
                    range_high = max(c['high'] for c in window)
                    range_low = min(c['low'] for c in window)

                range_mid = (range_high + range_low) / 2
                range_pct = ((range_high - range_low) / range_mid) * 100 if range_mid > 0 else 100

                # --- Validacion de semilla (solo si NO usamos ATR band) ---
                if not params.use_atr_band:
                    local_atr = self._calculate_atr(window, min(5, len(window) // 2))
                    atr_ratio = local_atr / global_atr if global_atr > 0 else 1.0
                    avg_body_ratio = self._calculate_avg_body_ratio(window)

                    if (range_pct > params.consol_max_range_pct or
                        atr_ratio > params.consol_atr_ratio or
                        avg_body_ratio > params.consol_body_ratio):
                        i += 1
                        continue
                else:
                    # Con ATR band: solo verificar que la ventana tenga velas DENTRO de la banda
                    inside_count = 0
                    for c in window:
                        if self._is_candle_inside_band(c, range_low, range_high):
                            inside_count += 1
                    if inside_count < len(window) * 0.5:
                        # Menos de 50% de velas dentro de la banda -> no es consolidacion
                        i += 1
                        continue

                # Extender la zona hasta breakout
                consecutive_outside = 0
                last_valid_end = consol_end
                # Capa 2: max_outside usa re-entry si habilitado
                max_outside = params.max_reentry_bars if params.use_reentry else params.consol_max_outside_bars

                while consol_end < len(candles) and (consol_end - consol_start) < params.consol_max_bars:
                    next_candle = candles[consol_end]

                    # Determinar si la vela esta "dentro" del rango
                    if params.use_atr_band and atr_band_upper and consol_end < len(atr_band_upper):
                        # Con ATR band: usar limites dinamicos de la vela actual
                        curr_high = atr_band_upper[consol_end]
                        curr_low = atr_band_lower[consol_end]
                        if curr_high > 0:
                            candle_touches_range = self._is_candle_inside_band(next_candle, curr_low, curr_high)
                        else:
                            candle_touches_range = not (next_candle['low'] > range_high or next_candle['high'] < range_low)
                    else:
                        # Clasico: high/low estatico
                        candle_touches_range = not (next_candle['low'] > range_high or next_candle['high'] < range_low)

                    if candle_touches_range:
                        consecutive_outside = 0
                        last_valid_end = consol_end + 1
                    else:
                        consecutive_outside += 1
                        if consecutive_outside >= max_outside:
                            consol_end = last_valid_end
                            break

                    consol_end += 1

                consol_length = consol_end - consol_start
                if consol_length >= params.consol_min_bars:
                    # Recalcular range_high/range_low con TODAS las velas de la zona final
                    final_zone_candles = candles[consol_start:consol_end]
                    final_range_high = max(c['high'] for c in final_zone_candles)
                    final_range_low = min(c['low'] for c in final_zone_candles)

                    # --- Capa 5: Validar % de velas dentro ---
                    if params.use_inside_pct_filter:
                        inside_count = 0
                        for c in final_zone_candles:
                            if self._is_candle_inside_band(c, final_range_low, final_range_high):
                                inside_count += 1
                        inside_pct = (inside_count / len(final_zone_candles)) * 100
                        if inside_pct < params.min_inside_pct:
                            i = consol_end
                            continue

                    found_ranges.append({
                        'start_idx': consol_start,
                        'end_idx': consol_end,
                        'range_high': final_range_high,
                        'range_low': final_range_low,
                        'consol_length': consol_length
                    })
                    i = consol_end
                else:
                    i += 1

        print(f"[ZoneDetector] Trading Zones: Encontradas {len(found_ranges)} consolidaciones")

        # Eliminar rangos que se solapan mucho
        found_ranges.sort(key=lambda x: x['consol_length'], reverse=True)
        selected_ranges = []

        for r in found_ranges:
            overlaps = False
            for selected in selected_ranges:
                overlap_start = max(r['start_idx'], selected['start_idx'])
                overlap_end = min(r['end_idx'], selected['end_idx'])
                if overlap_end > overlap_start:
                    overlap_size = overlap_end - overlap_start
                    min_size = min(r['end_idx'] - r['start_idx'], selected['end_idx'] - selected['start_idx'])
                    if overlap_size / min_size > 0.3:
                        overlaps = True
                        break

            if not overlaps:
                selected_ranges.append(r)

        print(f"[ZoneDetector] Trading Zones: {len(selected_ranges)} despues de deduplicacion")

        # Ordenar por tiempo para que sequential funcione correctamente
        selected_ranges.sort(key=lambda x: x['start_idx'])

        # FASE 2: Analizar cada zona con metricas de trading
        stats = {"wins": 0, "losses": 0, "open": 0, "skipped": 0}
        # Para modo sequential: timestamp donde cierra el trade activo (0 = sin trade)
        current_trade_close_ts = 0

        all_volumes = [c['volume'] for c in candles]

        print(f"[ZoneDetector] position_mode='{params.position_mode}' (type={type(params.position_mode).__name__})")

        for zone_num, r in enumerate(selected_ranges):
            zone_candles = candles[r['start_idx']:r['end_idx']]
            zone_high = r['range_high']
            zone_low = r['range_low']
            zone_height = zone_high - zone_low
            zone_mid = (zone_high + zone_low) / 2

            start_ts = zone_candles[0]['timestamp']
            end_ts = zone_candles[-1]['timestamp']
            duration_hours = (end_ts - start_ts) / (1000 * 60 * 60)

            # Volumen
            avg_volume = np.mean([c['volume'] for c in zone_candles])
            volume_score = self._calculate_volume_score(avg_volume, all_volumes)

            # Volume Profile
            vp_data = self._calculate_zone_volume_profile(zone_candles, num_bins=params.vp_bins_per_zone)
            poc_price = vp_data["poc_price"]
            vah_price = vp_data["vah_price"]
            val_price = vp_data["val_price"]
            vp_total_volume = vp_data["total_volume"]

            # Detectar breakout: vela que CIERRA fuera del rango
            breakout_idx = r['end_idx']
            breakout_direction = ""
            breakout_close_price = 0.0
            breakout_ts = 0

            search_limit = min(r['end_idx'] + params.breakout_search_bars, len(candles))
            for bi in range(r['end_idx'], search_limit):
                c = candles[bi]
                if c['close'] > zone_high:
                    breakout_direction = "UP"
                    breakout_close_price = c['close']  # Close real de la vela de breakout
                    breakout_ts = c['timestamp']
                    breakout_idx = bi
                    break
                elif c['close'] < zone_low:
                    breakout_direction = "DOWN"
                    breakout_close_price = c['close']
                    breakout_ts = c['timestamp']
                    breakout_idx = bi
                    break

            if not breakout_direction:
                if not params.include_no_breakout:
                    continue
                safe_idx = min(r['end_idx'], len(candles) - 1)
                last_candle = candles[safe_idx]
                if last_candle['close'] > zone_mid:
                    breakout_direction = "UP"
                else:
                    breakout_direction = "DOWN"
                breakout_close_price = last_candle['close']
                breakout_ts = last_candle['timestamp']
                breakout_idx = safe_idx  # Nunca fuera de rango

            # --- Determinar precio de entrada segun entry_mode ---
            entry_price = 0.0
            entry_ts = 0
            entry_idx = breakout_idx
            entry_bar_offset = 0
            entry_found = True

            if params.entry_mode == "swing_confirmation":
                # Buscar swing de confirmacion despues del breakout
                # Un swing en posicion 'si' solo se confirma cuando cierra la vela si+sb
                # (necesita sb velas a cada lado). La entrada es al CLOSE de esa vela de confirmacion.
                entry_found = False
                sb = params.swing_bars
                search_start = breakout_idx + 1
                search_end = min(breakout_idx + lookforward_bars, len(candles) - sb)

                for si in range(max(search_start, sb), search_end):
                    if breakout_direction == "UP":
                        # Tras breakout UP, buscamos swing LOW = fin del pullback
                        if self._is_swing_low_static(candles, si, sb):
                            # La confirmacion ocurre en la vela si+sb (la ultima que valida el swing)
                            confirm_idx = si + sb
                            if confirm_idx < len(candles):
                                entry_price = candles[confirm_idx]['close']
                                entry_ts = candles[confirm_idx]['timestamp']
                                entry_idx = confirm_idx
                                entry_bar_offset = confirm_idx - breakout_idx
                                entry_found = True
                            break
                    else:  # DOWN
                        # Tras breakout DOWN, buscamos swing HIGH = fin del pullback
                        if self._is_swing_high_static(candles, si, sb):
                            confirm_idx = si + sb
                            if confirm_idx < len(candles):
                                entry_price = candles[confirm_idx]['close']
                                entry_ts = candles[confirm_idx]['timestamp']
                                entry_idx = confirm_idx
                                entry_bar_offset = confirm_idx - breakout_idx
                                entry_found = True
                            break
            else:
                # breakout_close: entrada en el close de la vela de breakout
                entry_price = breakout_close_price
                entry_ts = breakout_ts
                entry_idx = breakout_idx
                entry_bar_offset = 0

            # --- Modo sequential: verificar si hay trade abierto ---
            # Comparamos la ENTRADA (entry_ts) de la nueva zona vs el CIERRE del trade anterior
            # Porque la entrada es cuando realmente se abre la posicion
            if params.position_mode == "sequential" and current_trade_close_ts > 0:
                # Usar entry_ts si existe, sino breakout_ts
                check_ts = entry_ts if entry_ts > 0 else breakout_ts
                if check_ts <= current_trade_close_ts:
                    from datetime import datetime
                    entry_dt = datetime.fromtimestamp(check_ts / 1000).strftime('%m/%d %H:%M') if check_ts else '?'
                    cls_dt = datetime.fromtimestamp(current_trade_close_ts / 1000).strftime('%m/%d %H:%M')
                    print(f"[SEQ] Zona#{zone_num} SKIP: entry={entry_dt} <= trade_close_prev={cls_dt}")
                    touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)
                    trading_zone = self._build_trading_zone(
                        zone_low, zone_high, start_ts, end_ts, touches, duration_hours,
                        avg_volume, volume_score, len(zone_candles),
                        breakout_direction, breakout_close_price, breakout_ts,
                        params.entry_mode, entry_price, entry_ts, entry_bar_offset,
                        0.0, 0.0,  # sl_price, tp_price
                        "SKIPPED", 0.0, 0, 0.0, False, False, 0.0, 0, 0.0,
                        vp_poc_price=poc_price, vp_vah_price=vah_price,
                        vp_val_price=val_price, vp_total_volume=vp_total_volume
                    )
                    trading_zones.append(trading_zone)
                    stats["skipped"] += 1
                    continue
                else:
                    from datetime import datetime
                    entry_dt = datetime.fromtimestamp(check_ts / 1000).strftime('%m/%d %H:%M') if check_ts else '?'
                    cls_dt = datetime.fromtimestamp(current_trade_close_ts / 1000).strftime('%m/%d %H:%M')
                    print(f"[SEQ] Zona#{zone_num} OK: entry={entry_dt} > trade_close_prev={cls_dt}")

            if not entry_found:
                # No se encontro swing de confirmacion
                touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)
                trading_zone = self._build_trading_zone(
                    zone_low, zone_high, start_ts, end_ts, touches, duration_hours,
                    avg_volume, volume_score, len(zone_candles),
                    breakout_direction, breakout_close_price, breakout_ts,
                    params.entry_mode, 0.0, 0, 0,
                    0.0, 0.0,  # sl_price, tp_price
                    "NO_ENTRY", 0.0, 0, 0.0, False, False, 0.0, 0, 0.0,
                    vp_poc_price=poc_price, vp_vah_price=vah_price,
                    vp_val_price=val_price, vp_total_volume=vp_total_volume
                )
                trading_zones.append(trading_zone)
                stats["skipped"] += 1
                continue

            # --- Calcular SL/TP desde el precio REAL de entrada ---
            if params.sl_mode == "swing_previous":
                # SL al swing high/low anterior al breakout
                sl_price = self._find_swing_sl(
                    candles, breakout_idx, breakout_direction,
                    params.swing_bars, zone_low, zone_high, entry_price
                )
                # R = distancia de entry a SL (siempre positivo)
                r_distance = abs(entry_price - sl_price)
                if r_distance == 0:
                    r_distance = zone_height  # fallback
                # TP siempre del lado favorable (opuesto al SL)
                _rr = params.tp_rr_ratio
                if breakout_direction == "UP":
                    tp_price = entry_price + (r_distance * _rr)
                else:
                    tp_price = entry_price - (r_distance * _rr)

                from datetime import datetime
                e_dt = datetime.fromtimestamp(entry_ts / 1000).strftime('%m/%d %H:%M') if entry_ts else '?'
                print(f"[SL_MODE] Zona#{zone_num} swing_previous: dir={breakout_direction} entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} R={r_distance:.2f} RR={_rr} ({e_dt})")
            else:
                # zone_opposite: SL al lado opuesto del rango (1R = zone_height)
                r_distance = zone_height
                _rr = params.tp_rr_ratio
                if breakout_direction == "UP":
                    sl_price = entry_price - zone_height
                    tp_price = entry_price + (zone_height * _rr)
                else:
                    sl_price = entry_price + zone_height
                    tp_price = entry_price - (zone_height * _rr)

            # --- Validar coherencia SL/TP ---
            # LONG (UP): SL debe estar DEBAJO de entry, TP ENCIMA
            # SHORT (DOWN): SL debe estar ENCIMA de entry, TP DEBAJO
            _rr = params.tp_rr_ratio
            if breakout_direction == "UP":
                if sl_price >= entry_price:
                    print(f"[SL_FIX] Zona#{zone_num} UP: SL={sl_price:.2f} >= entry={entry_price:.2f}, corrigiendo")
                    sl_price = entry_price - zone_height
                    r_distance = zone_height
                    tp_price = entry_price + (zone_height * _rr)
                if tp_price <= entry_price:
                    print(f"[SL_FIX] Zona#{zone_num} UP: TP={tp_price:.2f} <= entry={entry_price:.2f}, corrigiendo")
                    tp_price = entry_price + (r_distance * _rr)
            else:
                if sl_price <= entry_price:
                    print(f"[SL_FIX] Zona#{zone_num} DOWN: SL={sl_price:.2f} <= entry={entry_price:.2f}, corrigiendo")
                    sl_price = entry_price + zone_height
                    r_distance = zone_height
                    tp_price = entry_price - (zone_height * _rr)
                if tp_price >= entry_price:
                    print(f"[SL_FIX] Zona#{zone_num} DOWN: TP={tp_price:.2f} >= entry={entry_price:.2f}, corrigiendo")
                    tp_price = entry_price - (r_distance * _rr)

            # --- Metricas de momentum ---
            # Proteger contra indice fuera de rango
            if breakout_idx >= len(candles):
                breakout_idx = len(candles) - 1
            if entry_idx >= len(candles):
                entry_idx = len(candles) - 1
            breakout_candle = candles[breakout_idx]
            atr_at_breakout = atr_values[breakout_idx] if breakout_idx < len(atr_values) else zone_height
            breakout_body = abs(breakout_candle['close'] - breakout_candle['open'])
            breakout_body_ratio = breakout_body / atr_at_breakout if atr_at_breakout > 0 else 0

            continuation_bars = 0
            post_breakout_for_cont = candles[breakout_idx + 1:breakout_idx + 21]
            for pc in post_breakout_for_cont:
                if breakout_direction == "UP" and pc['close'] > pc['open']:
                    continuation_bars += 1
                elif breakout_direction == "DOWN" and pc['close'] < pc['open']:
                    continuation_bars += 1
                else:
                    break

            # --- Simular trade desde la vela de entrada hasta TP o SL ---
            trade_result = "PENDING"
            trade_pnl_r = 0.0
            bars_to_close = 0
            r_multiple = 0.0
            reached_2r = False
            reached_3r = False

            # Usar TODAS las velas restantes (sin limite de lookforward)
            post_entry = candles[entry_idx:]

            # MFE y R-Multiple (R = r_distance, que depende de sl_mode)
            if len(post_entry) > 0:
                if breakout_direction == "UP":
                    max_p = max(c['high'] for c in post_entry)
                    r_multiple = float((max_p - entry_price) / r_distance) if r_distance > 0 else 0.0
                else:
                    min_p = min(c['low'] for c in post_entry)
                    r_multiple = float((entry_price - min_p) / r_distance) if r_distance > 0 else 0.0
                reached_2r = bool(r_multiple >= 2.0)
                reached_3r = bool(r_multiple >= 3.0)

            # Simular hit de TP/SL (sin limite de velas)
            _tp_rr = params.tp_rr_ratio
            trade_close_idx = entry_idx  # default si no cierra
            for bar_num, c in enumerate(post_entry):
                if breakout_direction == "UP":
                    tp_hit = c['high'] >= tp_price
                    sl_hit = c['low'] <= sl_price
                else:
                    tp_hit = c['low'] <= tp_price
                    sl_hit = c['high'] >= sl_price

                if tp_hit and sl_hit:
                    # Ambos tocados en la misma vela: inferir cual fue primero
                    # usando la direccion de la vela (open vs close)
                    if breakout_direction == "UP":
                        if c['close'] >= c['open']:
                            trade_result = "WIN"
                            trade_pnl_r = _tp_rr
                        else:
                            trade_result = "LOSS"
                            trade_pnl_r = -1.0
                    else:
                        if c['close'] <= c['open']:
                            trade_result = "WIN"
                            trade_pnl_r = _tp_rr
                        else:
                            trade_result = "LOSS"
                            trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_idx = entry_idx + bar_num
                    break
                elif tp_hit:
                    trade_result = "WIN"
                    trade_pnl_r = _tp_rr
                    bars_to_close = bar_num + 1
                    trade_close_idx = entry_idx + bar_num
                    break
                elif sl_hit:
                    trade_result = "LOSS"
                    trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_idx = entry_idx + bar_num
                    break

            if trade_result == "PENDING":
                # No alcanzo TP ni SL con los datos disponibles
                # Marcar como OPEN con PnL parcial actual
                last_candle = candles[-1]
                if breakout_direction == "UP":
                    pnl = (last_candle['close'] - entry_price) / r_distance if r_distance > 0 else 0
                else:
                    pnl = (entry_price - last_candle['close']) / r_distance if r_distance > 0 else 0

                trade_result = "OPEN"
                trade_pnl_r = max(min(pnl, _tp_rr), -1.0)

                bars_to_close = len(post_entry)
                trade_close_idx = len(candles) - 1

            # Calcular timestamp de cierre del trade
            trade_close_ts = candles[trade_close_idx]['timestamp'] if trade_close_idx < len(candles) else 0

            # Actualizar timestamp de cierre para modo sequential
            if params.position_mode == "sequential":
                from datetime import datetime
                entry_dt = datetime.fromtimestamp(entry_ts / 1000).strftime('%m/%d %H:%M') if entry_ts else '?'
                close_dt = datetime.fromtimestamp(trade_close_ts / 1000).strftime('%m/%d %H:%M') if trade_close_ts else '?'
                print(f"[SEQ] Zona#{zone_num} TRADE: {trade_result} {trade_pnl_r:+.1f}R | dir={breakout_direction} | entry={entry_dt} | close={close_dt} | bars={bars_to_close}")
                current_trade_close_ts = trade_close_ts

            # Estadisticas
            if trade_result == "WIN":
                stats["wins"] += 1
            elif trade_result == "LOSS":
                stats["losses"] += 1
            else:
                stats["open"] += 1

            # Trading score - INTRINSECO (sin sesgos post-trade)
            # El score debe reflejar la calidad de la zona ANTES de abrir el trade
            momentum_score = min(breakout_body_ratio * 40, 30)
            compression_score = max(0, (params.consol_max_range_pct - ((zone_high - zone_low) / zone_mid * 100)) / params.consol_max_range_pct) * 25
            volume_bonus = volume_score * 0.25

            # Continuation score: SOLO si entry_mode=swing_confirmation Y use_continuation_score=True
            # En breakout_close no tiene sentido porque no sabemos si las velas siguientes continuaran
            continuation_score = 0
            if params.use_continuation_score and params.entry_mode == "swing_confirmation":
                continuation_score = min(continuation_bars * 5, 20)

            trading_score = momentum_score + continuation_score + compression_score + volume_bonus

            # --- Capa 4: BBWP scoring bonus ---
            if params.use_bbwp_scoring and bbwp_values:
                # Usar BBWP promedio de la zona de consolidacion
                zone_bbwp_vals = [bbwp_values[idx] for idx in range(r['start_idx'], r['end_idx']) if idx < len(bbwp_values) and bbwp_values[idx] > 0]
                if zone_bbwp_vals:
                    avg_bbwp = sum(zone_bbwp_vals) / len(zone_bbwp_vals)
                    if avg_bbwp <= params.bbwp_squeeze_threshold:
                        # BBWP bajo = volatilidad comprimida = bonus
                        bbwp_bonus = (params.bbwp_squeeze_threshold - avg_bbwp) / params.bbwp_squeeze_threshold * 15
                        trading_score += bbwp_bonus

            # NO aplicamos ajuste por resultado del trade (+15/-10)
            # El score es INTRINSECO a la zona, no depende de si gano o perdio

            touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)

            trading_zone = self._build_trading_zone(
                zone_low, zone_high, start_ts, end_ts, touches, duration_hours,
                avg_volume, volume_score, len(zone_candles),
                breakout_direction, breakout_close_price, breakout_ts,
                params.entry_mode, entry_price, entry_ts, entry_bar_offset,
                sl_price, tp_price,
                trade_result, trade_pnl_r, bars_to_close,
                r_multiple, reached_2r, reached_3r,
                breakout_body_ratio, continuation_bars, trading_score,
                trade_close_timestamp=trade_close_ts,
                vp_poc_price=poc_price, vp_vah_price=vah_price,
                vp_val_price=val_price, vp_total_volume=vp_total_volume
            )
            trading_zones.append(trading_zone)

        # Estadisticas finales - usar PnL real de cada trade (ya no hay OPEN)
        total_closed = stats["wins"] + stats["losses"]
        win_rate = (stats["wins"] / total_closed * 100) if total_closed > 0 else 0
        total_pnl = sum(tz.trade_pnl_r for tz in trading_zones if tz.trade_result in ("WIN", "LOSS"))
        expectancy = total_pnl / total_closed if total_closed > 0 else 0

        print(f"[ZoneDetector] Trading Zones RESULTADOS (mode={params.entry_mode}, pos={params.position_mode}, sl={params.sl_mode}):")
        print(f"  - Total zonas: {len(trading_zones)}")
        print(f"  - Wins: {stats['wins']}, Losses: {stats['losses']}, Skipped: {stats['skipped']}")
        print(f"  - Win Rate: {win_rate:.1f}%")
        print(f"  - Total P&L: {total_pnl:+.1f}R")
        print(f"  - Expectancy: {expectancy:.3f}R por trade")

        # =====================================================================
        # ASIGNAR timeline_index cronologico a cada zona
        # =====================================================================
        from datetime import datetime as _dt
        # Ordenar por entry_timestamp (o start_timestamp si no tiene entry)
        zones_by_time = sorted(trading_zones, key=lambda z: z.entry_timestamp if z.entry_timestamp > 0 else z.start_timestamp)
        for i, tz in enumerate(zones_by_time):
            tz.timeline_index = i + 1  # 1-based

        # =====================================================================
        # LOG DETALLADO: Solo trades activos (WIN/LOSS), ordenados por tiempo
        # Esto muestra la secuencia REAL de posiciones abiertas/cerradas
        # =====================================================================
        active_trades = [tz for tz in zones_by_time if tz.trade_result in ("WIN", "LOSS")]
        print(f"\n{'='*110}")
        print(f"[TIMELINE] TRADES ACTIVOS en orden cronologico (mode={params.position_mode})")
        print(f"{'='*110}")
        print(f"{'TL#':>4} | {'Result':>6} | {'Dir':>5} | {'Entry Date':>14} | {'Close Date':>14} | {'Entry$':>10} | {'SL$':>10} | {'TP$':>10} | {'PnL':>6} | Overlap?")
        print(f"{'-'*4}-+-{'-'*6}-+-{'-'*5}-+-{'-'*14}-+-{'-'*14}-+-{'-'*10}-+-{'-'*10}-+-{'-'*10}-+-{'-'*6}-+-{'-'*10}")

        prev_close_ts = 0
        overlap_count = 0
        for tz in active_trades:
            et = _dt.fromtimestamp(tz.entry_timestamp / 1000).strftime('%m/%d %H:%M') if tz.entry_timestamp else '---'
            tc = _dt.fromtimestamp(tz.trade_close_timestamp / 1000).strftime('%m/%d %H:%M') if tz.trade_close_timestamp else '---'

            overlap_flag = ""
            if prev_close_ts > 0 and tz.entry_timestamp > 0:
                if tz.entry_timestamp <= prev_close_ts:
                    overlap_flag = "OVERLAP!"
                    overlap_count += 1

            print(f"{tz.timeline_index:>4} | {tz.trade_result:>6} | {tz.breakout_direction:>5} | {et:>14} | {tc:>14} | {tz.entry_price:>10.2f} | {tz.sl_price:>10.2f} | {tz.tp_price:>10.2f} | {tz.trade_pnl_r:>+5.1f}R | {overlap_flag}")

            if tz.trade_close_timestamp > 0:
                prev_close_ts = tz.trade_close_timestamp

        if overlap_count > 0:
            print(f"\n*** ALERTA: {overlap_count} SOLAPAMIENTO(S) DETECTADO(S) ***")
        else:
            print(f"\n[OK] Sin solapamientos entre trades activos")
        print(f"{'='*110}\n")

        # Retornar ordenado por tiempo (timeline_index ya asignado)
        return zones_by_time

    # =========================================================================
    # HELPERS para Trading Zones
    # =========================================================================

    @staticmethod
    def _is_swing_high_static(candles: List[Dict], idx: int, bars: int) -> bool:
        """Detecta si la vela en idx es un swing high (high mayor que N velas a cada lado)."""
        if idx < bars or idx >= len(candles) - bars:
            return False
        current_high = candles[idx]['high']
        for j in range(idx - bars, idx):
            if candles[j]['high'] >= current_high:
                return False
        for j in range(idx + 1, idx + bars + 1):
            if candles[j]['high'] >= current_high:
                return False
        return True

    @staticmethod
    def _is_swing_low_static(candles: List[Dict], idx: int, bars: int) -> bool:
        """Detecta si la vela en idx es un swing low (low menor que N velas a cada lado)."""
        if idx < bars or idx >= len(candles) - bars:
            return False
        current_low = candles[idx]['low']
        for j in range(idx - bars, idx):
            if candles[j]['low'] <= current_low:
                return False
        for j in range(idx + 1, idx + bars + 1):
            if candles[j]['low'] <= current_low:
                return False
        return True

    def _find_swing_sl(self, candles: List[Dict], breakout_idx: int,
                       breakout_direction: str, swing_bars: int,
                       zone_low: float, zone_high: float,
                       entry_price: float = 0.0) -> float:
        """
        Busca el swing high/low anterior al breakout para usar como SL.
        - Breakout UP (LONG): SL al swing LOW anterior (DEBAJO del entry)
        - Breakout DOWN (SHORT): SL al swing HIGH anterior (ENCIMA del entry)
        Busca hacia atras desde el breakout, de mas reciente a mas antiguo.
        Solo acepta swings que queden del lado defensivo correcto.
        Si no encuentra, usa zone_low (LONG) o zone_high (SHORT) como fallback.
        """
        search_start = max(swing_bars, 0)
        search_end = breakout_idx - swing_bars

        if search_end <= search_start:
            # No hay espacio para buscar
            return zone_low if breakout_direction == "UP" else zone_high

        if breakout_direction == "UP":
            # LONG: buscar swing LOW que este DEBAJO del entry_price
            for si in range(search_end, search_start - 1, -1):
                if self._is_swing_low_static(candles, si, swing_bars):
                    sl_candidate = candles[si]['low']
                    if entry_price == 0.0 or sl_candidate < entry_price:
                        return sl_candidate
            # Fallback: el low de la zona (siempre debajo del breakout)
            return zone_low
        else:
            # SHORT: buscar swing HIGH que este ENCIMA del entry_price
            for si in range(search_end, search_start - 1, -1):
                if self._is_swing_high_static(candles, si, swing_bars):
                    sl_candidate = candles[si]['high']
                    if entry_price == 0.0 or sl_candidate > entry_price:
                        return sl_candidate
            # Fallback: el high de la zona (siempre encima del breakout)
            return zone_high

    def _build_trading_zone(
        self,
        zone_low: float, zone_high: float,
        start_ts: int, end_ts: int,
        touches: Dict[str, int], duration_hours: float,
        avg_volume: float, volume_score: float, candles_in_zone: int,
        breakout_direction: str, breakout_price: float, breakout_ts: int,
        entry_mode: str, entry_price: float, entry_ts: int, entry_bar_offset: int,
        sl_price: float, tp_price: float,
        trade_result: str, trade_pnl_r: float, bars_to_close: int,
        r_multiple: float, reached_2r: bool, reached_3r: bool,
        breakout_body_ratio: float, continuation_bars: int, trading_score: float,
        trade_close_timestamp: int = 0,
        vp_poc_price: float = 0.0, vp_vah_price: float = 0.0,
        vp_val_price: float = 0.0, vp_total_volume: float = 0.0
    ) -> TradingZone:
        """Construye un objeto TradingZone con todos los campos."""
        zone_mid = (zone_high + zone_low) / 2
        price_range_pct = ((zone_high - zone_low) / zone_mid * 100) if zone_mid > 0 else 0

        return TradingZone(
            id=self._generate_zone_id(),
            min_price=zone_low,
            max_price=zone_high,
            start_timestamp=start_ts,
            end_timestamp=end_ts,
            touches_support=touches.get('support', 0) if isinstance(touches, dict) else 0,
            touches_resistance=touches.get('resistance', 0) if isinstance(touches, dict) else 0,
            total_touches=touches.get('total', 0) if isinstance(touches, dict) else 0,
            duration_hours=duration_hours,
            avg_volume=avg_volume,
            volume_score=volume_score,
            method="trading_zones",
            score=trading_score,
            candles_in_zone=candles_in_zone,
            price_range_pct=price_range_pct,
            breakout_direction=breakout_direction,
            breakout_price=breakout_price,
            breakout_timestamp=breakout_ts,
            entry_mode=entry_mode,
            entry_price=entry_price,
            entry_timestamp=entry_ts,
            entry_bar_offset=entry_bar_offset,
            sl_price=sl_price,
            tp_price=tp_price,
            trade_result=trade_result,
            trade_pnl_r=trade_pnl_r,
            bars_to_close=bars_to_close,
            r_multiple=r_multiple,
            reached_2r=reached_2r,
            reached_3r=reached_3r,
            breakout_body_ratio=breakout_body_ratio,
            continuation_bars=continuation_bars,
            trading_score=trading_score,
            trade_close_timestamp=trade_close_timestamp,
            vp_poc_price=vp_poc_price,
            vp_vah_price=vp_vah_price,
            vp_val_price=vp_val_price,
            vp_total_volume=vp_total_volume,
        )

    def _calculate_rolling_atr_for_trading(self, candles: List[Dict], period: int = 14) -> List[float]:
        """Calcula ATR rolling para cada vela."""
        atr_values = [0.0] * len(candles)

        for i in range(period, len(candles)):
            true_ranges = []
            for j in range(i - period + 1, i + 1):
                high = candles[j]['high']
                low = candles[j]['low']
                prev_close = candles[j - 1]['close'] if j > 0 else candles[j]['open']
                tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
                true_ranges.append(tr)
            atr_values[i] = np.mean(true_ranges)

        # Rellenar primeros valores
        first_valid = atr_values[period] if period < len(atr_values) else 0
        for i in range(period):
            atr_values[i] = first_valid

        return atr_values

    def _calculate_avg_body_ratio(self, candles: List[Dict]) -> float:
        """Calcula el ratio promedio cuerpo/rango de las velas."""
        body_ratios = []
        for c in candles:
            candle_range = c['high'] - c['low']
            if candle_range > 0:
                body = abs(c['close'] - c['open'])
                body_ratios.append(body / candle_range)
        return np.mean(body_ratios) if body_ratios else 0.5

    def _calculate_atr(self, candles: List[Dict], period: int) -> float:
        """Calcula el Average True Range."""
        if len(candles) < period + 1:
            return 0.0

        true_ranges = []
        for i in range(1, len(candles)):
            high = candles[i]['high']
            low = candles[i]['low']
            prev_close = candles[i - 1]['close']

            tr = max(
                high - low,
                abs(high - prev_close),
                abs(low - prev_close)
            )
            true_ranges.append(tr)

        if not true_ranges:
            return 0.0

        # ATR simple (promedio de los últimos 'period' TR)
        return np.mean(true_ranges[-period:])

    # =========================================================================
    # HELPERS v3.0: Banda ATR, TTM Squeeze, BBWP
    # =========================================================================

    def _calculate_sma(self, candles: List[Dict], period: int) -> List[float]:
        """Calcula SMA (Simple Moving Average) del close para cada vela."""
        closes = [c['close'] for c in candles]
        sma = [0.0] * len(candles)
        for i in range(period - 1, len(candles)):
            sma[i] = np.mean(closes[i - period + 1:i + 1])
        # Rellenar primeros valores
        if period - 1 < len(sma):
            first_valid = sma[period - 1]
            for i in range(period - 1):
                sma[i] = first_valid
        return sma

    def _calculate_std_dev(self, candles: List[Dict], period: int) -> List[float]:
        """Calcula desviacion estandar rolling del close."""
        closes = [c['close'] for c in candles]
        std = [0.0] * len(candles)
        for i in range(period - 1, len(candles)):
            std[i] = float(np.std(closes[i - period + 1:i + 1], ddof=1)) if period > 1 else 0.0
        if period - 1 < len(std):
            first_valid = std[period - 1]
            for i in range(period - 1):
                std[i] = first_valid
        return std

    def _calculate_ttm_squeeze_values(
        self, candles: List[Dict],
        bb_sma_values: List[float], bb_std_values: List[float],
        kc_atr_length: int, kc_multiplier: float
    ) -> List[bool]:
        """
        Calcula TTM Squeeze para cada vela.
        Squeeze ON = Bollinger Bands (SMA +/- 1 std) estan DENTRO de Keltner Channels (SMA +/- ATR*mult)
        Retorna lista de bools (True = squeeze ON).
        """
        kc_atr = self._calculate_rolling_atr_for_trading(candles, kc_atr_length)
        squeeze = [False] * len(candles)

        for i in range(len(candles)):
            sma_val = bb_sma_values[i]
            std_val = bb_std_values[i]
            atr_val = kc_atr[i]

            if sma_val == 0 or atr_val == 0:
                continue

            bb_upper = sma_val + std_val
            bb_lower = sma_val - std_val
            kc_upper = sma_val + (atr_val * kc_multiplier)
            kc_lower = sma_val - (atr_val * kc_multiplier)

            # Squeeze ON cuando BB esta DENTRO de KC
            squeeze[i] = (bb_upper < kc_upper) and (bb_lower > kc_lower)

        return squeeze

    def _calculate_bbwp_values(
        self, candles: List[Dict],
        bb_sma_values: List[float], bb_std_values: List[float],
        lookback: int
    ) -> List[float]:
        """
        Calcula BBWP (Bollinger Band Width Percentile) para cada vela.
        BandWidth = (BB_upper - BB_lower) / SMA * 100
        BBWP = percentil del BW actual vs ultimos N periodos
        Retorna lista de floats 0-100.

        Auto-escalado: si lookback es muy pequeno relativo al dataset,
        se escala para usar al menos el 80% de las velas disponibles.
        Esto es critico en timeframes pequenos (1min) donde lookback=252
        solo cubre ~4 horas y no da contraste suficiente para el percentil.
        """
        n = len(candles)

        # Auto-escalar lookback para que cubra un rango significativo
        # El lookback=252 fue disenado para velas diarias (1 anio).
        # En timeframes pequenos necesitamos cubrir mas velas para tener contraste.
        effective_lookback = lookback
        min_coverage = int(n * 0.8)  # Al menos 80% del dataset
        if effective_lookback < min_coverage:
            effective_lookback = min_coverage
            print(f"[ZoneDetector] BBWP auto-escalado: lookback {lookback} -> {effective_lookback} "
                  f"(80% de {n} velas)")

        # Primero calcular bandwidth para cada vela
        bandwidth = [0.0] * n
        for i in range(n):
            if bb_sma_values[i] > 0 and bb_std_values[i] > 0:
                # bw = 2 * std / sma * 100
                bandwidth[i] = (2 * bb_std_values[i] / bb_sma_values[i]) * 100

        # Calcular percentil
        bbwp = [50.0] * n  # default 50 = neutral
        for i in range(n):
            start_idx = max(0, i - effective_lookback + 1)
            historical = bandwidth[start_idx:i + 1]
            if len(historical) < 10:  # minimo para que el percentil tenga sentido
                continue
            count_below = sum(1 for bw in historical if bw < bandwidth[i])
            bbwp[i] = (count_below / len(historical)) * 100

        return bbwp

    def _find_squeeze_regions(self, squeeze_values: List[bool], min_bars: int) -> List[Tuple[int, int]]:
        """
        Encuentra regiones donde TTM Squeeze estuvo ON por >= min_bars consecutivos.
        Retorna lista de (start_idx, end_idx) inclusivo.
        """
        regions = []
        start = None

        for i, is_squeeze in enumerate(squeeze_values):
            if is_squeeze:
                if start is None:
                    start = i
            else:
                if start is not None:
                    length = i - start
                    if length >= min_bars:
                        regions.append((start, i - 1))
                    start = None

        # Ultima region si termina con squeeze
        if start is not None:
            length = len(squeeze_values) - start
            if length >= min_bars:
                regions.append((start, len(squeeze_values) - 1))

        return regions

    def _is_candle_inside_band(self, candle: Dict, band_low: float, band_high: float) -> bool:
        """Verifica si el CUERPO de la vela esta dentro de la banda."""
        body_high = max(candle['open'], candle['close'])
        body_low = min(candle['open'], candle['close'])
        return body_low >= band_low and body_high <= band_high

    # =========================================================================
    # METODO 7: ATR DYNAMIC (basado en ATRBasedRangeDetector del frontend)
    # Usa SMA +/- ATR*mult como limites dinamicos del rango
    # Soporta re-ingreso y merge de rangos solapados
    # =========================================================================

    def _atr_dynamic_method(self, candles: List[Dict], params: ZoneDetectionParams,
                            detection_start_idx: int = 0) -> List[TradingZone]:
        """
        Detecta rangos usando ATR dinamico (inspirado en LuxAlgo Range Detector).
        Luego simula trades igual que trading_zones.

        Algoritmo:
        1. Calcula SMA y ATR para cada vela
        2. Define banda: SMA +/- ATR*mult
        3. Cuenta velas fuera del rango en ventana rolling
        4. countOutside == 0 → todas dentro → rango valido
        5. Permite re-ingreso si sale por menos de max_breakout velas
        6. Post-procesa mergeando rangos solapados
        7. Simula trades con TP=2R, SL=1R

        detection_start_idx: Si > 0, solo retorna zonas que empiecen desde este indice.
                             Las velas anteriores se usan para contexto BBWP/TTM.
        """
        atr_period = params.atr_dyn_period        # 200 default
        ma_period = params.atr_dyn_ma_period      # 20 default (tambien min velas)
        multiplier = params.atr_dyn_multiplier    # 1.0 default
        max_breakout = params.atr_dyn_max_breakout # 5 default
        merge_overlap = params.atr_dyn_merge_overlap
        min_bars = params.atr_dyn_min_bars if params.atr_dyn_min_bars > 0 else ma_period

        min_candles = max(atr_period, ma_period) + 50
        if len(candles) < min_candles:
            print(f"[ZoneDetector] atr_dynamic: No hay suficientes velas ({len(candles)} < {min_candles})")
            return []

        # 1. Calcular ATR y SMA
        atr_values = self._calculate_rolling_atr_for_trading(candles, atr_period)
        sma_values = self._calculate_sma(candles, ma_period)

        # --- Pre-calculos v3.0 opcionales ---
        bb_sma_values = None
        bb_std_values = None
        squeeze_values = None
        bbwp_values = None

        if params.use_ttm_prefilter or params.use_bbwp_scoring:
            bb_sma_values = self._calculate_sma(candles, 20)  # BB usa SMA(20)
            bb_std_values = self._calculate_std_dev(candles, 20)

        if params.use_ttm_prefilter:
            squeeze_values = self._calculate_ttm_squeeze_values(
                candles, bb_sma_values, bb_std_values,
                params.ttm_atr_length, params.ttm_kc_multiplier
            )
            squeeze_regions = self._find_squeeze_regions(squeeze_values, params.ttm_min_squeeze_bars)
            print(f"[ZoneDetector] atr_dynamic TTM Prefilter: {len(squeeze_regions)} regiones de squeeze")

        if params.use_bbwp_scoring:
            bbwp_values = self._calculate_bbwp_values(
                candles, bb_sma_values, bb_std_values, params.bbwp_lookback
            )

        # 2. Detectar rangos
        start_index = max(atr_period, ma_period)
        raw_ranges = []
        current_range = None
        prev_count_outside = None
        breakout_candle_count = 0

        # --- DEBUG: tracking de secciones count_outside==0 ---
        debug_sections = []  # Todas las secciones donde count_outside==0
        current_section_start = None

        from datetime import datetime, timezone

        def _ts_to_str(ts):
            """Timestamp ms -> string legible"""
            return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime('%m/%d %H:%M')

        for i in range(start_index, len(candles)):
            atr_idx = i  # ATR ya esta alineado
            sma_idx = i  # SMA ya esta alineado

            if atr_idx >= len(atr_values) or sma_idx >= len(sma_values):
                continue

            atr_val = atr_values[atr_idx] * multiplier
            ma_val = sma_values[sma_idx]

            if atr_val <= 0 or ma_val <= 0:
                continue

            range_high = ma_val + atr_val
            range_low = ma_val - atr_val

            # Verificar si vela actual esta dentro
            current_close = candles[i]['close']
            is_current_inside = range_low <= current_close <= range_high

            # Contar velas fuera en las ultimas ma_period velas
            count_outside = 0
            for j in range(max(0, i - ma_period + 1), i + 1):
                deviation = abs(candles[j]['close'] - ma_val)
                if deviation > atr_val:
                    count_outside += 1

            # --- DEBUG: trackear secciones azules (count_outside==0) ---
            if count_outside == 0:
                if current_section_start is None:
                    current_section_start = i
            else:
                if current_section_start is not None:
                    section_len = i - current_section_start
                    debug_sections.append({
                        'start_idx': current_section_start,
                        'end_idx': i - 1,
                        'length': section_len,
                        'start_ts': candles[current_section_start]['timestamp'],
                        'end_ts': candles[i - 1]['timestamp'],
                    })
                    current_section_start = None

            # TRANSICION: fuera -> dentro (countOutside == 0)
            if count_outside == 0 and prev_count_outside is not None and prev_count_outside != 0:
                # Verificar re-ingreso
                if current_range and 0 < breakout_candle_count <= max_breakout:
                    # RE-INGRESO: continuar rango existente (breakout no confirmado)
                    current_range['end_idx'] = i
                    current_range['end_ts'] = candles[i]['timestamp']
                    current_range['candle_count'] += 1
                    current_range['high'] = max(current_range['high'], range_high)
                    current_range['low'] = min(current_range['low'], range_low)
                    breakout_candle_count = 0
                elif current_range and breakout_candle_count == 0:
                    # Rango activo sin breakout pendiente: simplemente extender
                    current_range['end_idx'] = i
                    current_range['end_ts'] = candles[i]['timestamp']
                    current_range['candle_count'] += 1
                    current_range['high'] = max(current_range['high'], range_high)
                    current_range['low'] = min(current_range['low'], range_low)
                else:
                    # NUEVO RANGO (current_range es None o breakout ya confirmado)
                    new_start_idx = max(0, i - ma_period + 1)

                    # Verificar overlap con ultimo rango guardado
                    if raw_ranges and new_start_idx <= raw_ranges[-1]['end_idx']:
                        # Mergear con el anterior - sacarlo de raw_ranges y hacerlo current_range
                        merged = raw_ranges.pop()
                        merged['end_idx'] = i
                        merged['end_ts'] = candles[i]['timestamp']
                        merged['high'] = max(merged['high'], range_high)
                        merged['low'] = min(merged['low'], range_low)
                        merged['candle_count'] = merged['end_idx'] - merged['start_idx'] + 1
                        current_range = merged  # Mantener como activo para seguir extendiendo
                    else:
                        current_range = {
                            'start_idx': new_start_idx,
                            'start_ts': candles[new_start_idx]['timestamp'],
                            'end_idx': i,
                            'end_ts': candles[i]['timestamp'],
                            'high': range_high,
                            'low': range_low,
                            'candle_count': ma_period
                        }
                    breakout_candle_count = 0

            elif count_outside == 0:
                # DENTRO DEL RANGO: extender o crear
                if current_range:
                    current_range['end_idx'] = i
                    current_range['end_ts'] = candles[i]['timestamp']
                    current_range['candle_count'] += 1
                    current_range['high'] = max(current_range['high'], range_high)
                    current_range['low'] = min(current_range['low'], range_low)
                else:
                    # No hay rango activo pero count_outside==0: crear nuevo
                    new_start_idx = max(0, i - ma_period + 1)
                    current_range = {
                        'start_idx': new_start_idx,
                        'start_ts': candles[new_start_idx]['timestamp'],
                        'end_idx': i,
                        'end_ts': candles[i]['timestamp'],
                        'high': range_high,
                        'low': range_low,
                        'candle_count': i - new_start_idx + 1
                    }
                breakout_candle_count = 0
            else:
                # HAY VELAS FUERA
                if current_range:
                    if not is_current_inside:
                        breakout_candle_count += 1
                        if breakout_candle_count > max_breakout:
                            # BREAKOUT CONFIRMADO: guardar rango
                            if current_range['candle_count'] >= min_bars:
                                raw_ranges.append(current_range)
                            else:
                                print(f"[ZoneDetector] DEBUG DESCARTADO por min_bars: "
                                      f"{current_range['candle_count']} < {min_bars} velas, "
                                      f"periodo {_ts_to_str(current_range['start_ts'])} - {_ts_to_str(current_range['end_ts'])}")
                            current_range = None
                            breakout_candle_count = 0
                    else:
                        # Vela actual dentro, hay re-ingreso
                        if breakout_candle_count > 0:
                            breakout_candle_count = 0
                        current_range['end_idx'] = i
                        current_range['end_ts'] = candles[i]['timestamp']
                        current_range['candle_count'] += 1
                        # Actualizar limites si el precio expande
                        current_range['high'] = max(current_range['high'], candles[i]['high'])
                        current_range['low'] = min(current_range['low'], candles[i]['low'])

            prev_count_outside = count_outside

        # Cerrar ultima seccion debug si quedo abierta
        if current_section_start is not None:
            section_len = len(candles) - current_section_start
            debug_sections.append({
                'start_idx': current_section_start,
                'end_idx': len(candles) - 1,
                'length': section_len,
                'start_ts': candles[current_section_start]['timestamp'],
                'end_ts': candles[-1]['timestamp'],
            })

        # Guardar ultimo rango
        if current_range and current_range['candle_count'] >= min_bars:
            raw_ranges.append(current_range)
        elif current_range:
            print(f"[ZoneDetector] DEBUG DESCARTADO ultimo rango por min_bars: "
                  f"{current_range['candle_count']} < {min_bars} velas, "
                  f"periodo {_ts_to_str(current_range['start_ts'])} - {_ts_to_str(current_range['end_ts'])}")

        # --- DEBUG: Imprimir todas las secciones azules vs rangos detectados ---
        print(f"\n{'='*80}")
        print(f"[ZoneDetector] DEBUG atr_dynamic: ANALISIS DE SECCIONES AZULES")
        print(f"  Params: ma_period={ma_period}, min_bars={min_bars}, max_breakout={max_breakout}, mult={multiplier}")
        print(f"  Total velas: {len(candles)}, start_index: {start_index}")
        print(f"  Secciones con count_outside==0: {len(debug_sections)}")
        print(f"  Rangos crudos detectados: {len(raw_ranges)}")
        print(f"")

        # Crear set de rangos detectados para marcar cuales secciones fueron capturadas
        range_intervals = []
        for r in raw_ranges:
            range_intervals.append((r['start_idx'], r['end_idx']))

        for si, sec in enumerate(debug_sections):
            # Ver si esta seccion esta contenida en algun rango detectado
            captured = False
            captured_by = None
            for ri, (rs, re) in enumerate(range_intervals):
                if sec['start_idx'] >= rs and sec['end_idx'] <= re:
                    captured = True
                    captured_by = ri
                    break
                # Overlap parcial
                if sec['start_idx'] <= re and sec['end_idx'] >= rs:
                    captured = True
                    captured_by = ri
                    break

            status = f"-> CAPTURADA por rango #{captured_by}" if captured else "-> NO CAPTURADA"
            reason = ""
            if not captured:
                if sec['length'] < min_bars:
                    reason = f" (muy corta: {sec['length']} < {min_bars} min_bars)"
                else:
                    reason = f" (revisar: {sec['length']} velas >= {min_bars} min_bars)"

            print(f"  Seccion #{si}: idx {sec['start_idx']}-{sec['end_idx']} "
                  f"({sec['length']} velas) "
                  f"{_ts_to_str(sec['start_ts'])} - {_ts_to_str(sec['end_ts'])} "
                  f"{status}{reason}")

        print(f"")
        for ri, r in enumerate(raw_ranges):
            print(f"  Rango #{ri}: idx {r['start_idx']}-{r['end_idx']} "
                  f"({r['candle_count']} velas) "
                  f"{_ts_to_str(r['start_ts'])} - {_ts_to_str(r['end_ts'])} "
                  f"precio {r['low']:.2f} - {r['high']:.2f}")
        print(f"{'='*80}\n")

        # 3. Post-proceso: Merge rangos solapados
        if merge_overlap and len(raw_ranges) > 1:
            raw_ranges = self._merge_overlapping_atr_ranges(raw_ranges)

        print(f"[ZoneDetector] atr_dynamic: {len(raw_ranges)} rangos crudos detectados (post-merge)")

        # 3.5. Filtrar por detection_start_idx (BBWP extendido)
        # Solo conservar zonas que terminen dentro del rango de deteccion solicitado
        if detection_start_idx > 0:
            pre_filter_count = len(raw_ranges)
            raw_ranges = [r for r in raw_ranges if r['end_idx'] >= detection_start_idx]
            filtered_out = pre_filter_count - len(raw_ranges)
            if filtered_out > 0:
                print(f"[ZoneDetector] BBWP historial: {filtered_out} rangos descartados "
                      f"(anteriores a idx {detection_start_idx} = {_ts_to_str(candles[detection_start_idx]['timestamp'])})")
            print(f"[ZoneDetector] atr_dynamic: {len(raw_ranges)} rangos en ventana de deteccion")

        # 4. Filtrar rangos y preparar para simulacion de trades
        filtered_ranges = []
        squeeze_regions_list = squeeze_regions if params.use_ttm_prefilter else None

        for r in raw_ranges:
            # --- TTM Squeeze pre-filtro ---
            # Verificar si CUALQUIER parte del rango se solapa con una squeeze region
            if squeeze_regions_list:
                in_squeeze = False
                for (sq_start, sq_end) in squeeze_regions_list:
                    # Overlap: rango y squeeze se solapan si no estan completamente separados
                    if r['start_idx'] <= sq_end and r['end_idx'] >= sq_start:
                        in_squeeze = True
                        break
                if not in_squeeze:
                    print(f"[ZoneDetector] DEBUG FILTRADO por TTM: rango "
                          f"{_ts_to_str(r['start_ts'])} - {_ts_to_str(r['end_ts'])} "
                          f"no se solapa con ninguna squeeze region")
                    continue

            zone_candles = candles[r['start_idx']:r['end_idx'] + 1]
            min_price = r['low']
            max_price = r['high']

            # --- Capa 5: % velas dentro ---
            if params.use_inside_pct_filter:
                inside_count = 0
                for c in zone_candles:
                    if self._is_candle_inside_band(c, min_price, max_price):
                        inside_count += 1
                inside_pct = (inside_count / len(zone_candles)) * 100 if zone_candles else 0
                if inside_pct < params.min_inside_pct:
                    print(f"[ZoneDetector] DEBUG FILTRADO por inside_pct: "
                          f"{inside_pct:.1f}% < {params.min_inside_pct}% en rango "
                          f"{_ts_to_str(r['start_ts'])} - {_ts_to_str(r['end_ts'])}")
                    continue

            filtered_ranges.append(r)

        print(f"[ZoneDetector] atr_dynamic: {len(filtered_ranges)} rangos despues de filtros v3.0")

        # 5. Simular trades igual que trading_zones
        return self._simulate_trades_for_ranges(
            candles=candles,
            ranges=filtered_ranges,
            params=params,
            bbwp_values=bbwp_values,
            method_name="atr_dynamic"
        )

    def _calculate_zone_volume_profile(
        self,
        zone_candles: List[Dict],
        num_bins: int = 30
    ) -> Dict:
        """
        Calcula Volume Profile para una zona especifica.
        Retorna POC, VAH, VAL y distribucion de volumen.

        Args:
            zone_candles: Velas de la zona
            num_bins: Numero de bins de precio

        Returns:
            Dict con poc_price, vah_price, val_price, total_volume
        """
        if not zone_candles or len(zone_candles) < 2:
            return {"poc_price": 0, "vah_price": 0, "val_price": 0, "total_volume": 0}

        price_high = max(c['high'] for c in zone_candles)
        price_low = min(c['low'] for c in zone_candles)

        if price_high == price_low:
            mid = price_high
            return {"poc_price": mid, "vah_price": mid, "val_price": mid, "total_volume": sum(c['volume'] for c in zone_candles)}

        bin_size = (price_high - price_low) / num_bins
        volume_by_bin = [0.0] * num_bins

        total_volume = 0.0
        for c in zone_candles:
            c_low = c['low']
            c_high = c['high']
            c_vol = c['volume']
            total_volume += c_vol

            low_bin = int((c_low - price_low) / bin_size)
            high_bin = int((c_high - price_low) / bin_size)
            low_bin = max(0, min(low_bin, num_bins - 1))
            high_bin = max(0, min(high_bin, num_bins - 1))

            bins_touched = high_bin - low_bin + 1
            vol_per_bin = c_vol / bins_touched if bins_touched > 0 else 0

            for b in range(low_bin, high_bin + 1):
                volume_by_bin[b] += vol_per_bin

        if total_volume == 0:
            mid = (price_high + price_low) / 2
            return {"poc_price": mid, "vah_price": price_high, "val_price": price_low, "total_volume": 0}

        # POC: bin con mayor volumen
        poc_bin = max(range(num_bins), key=lambda i: volume_by_bin[i])
        poc_price = price_low + (poc_bin + 0.5) * bin_size

        # Value Area: 70% del volumen, expandiendo desde POC
        target_volume = total_volume * 0.70
        va_volume = volume_by_bin[poc_bin]
        va_low_bin = poc_bin
        va_high_bin = poc_bin

        while va_volume < target_volume and (va_low_bin > 0 or va_high_bin < num_bins - 1):
            # Expandir hacia el lado con mas volumen
            vol_below = volume_by_bin[va_low_bin - 1] if va_low_bin > 0 else 0
            vol_above = volume_by_bin[va_high_bin + 1] if va_high_bin < num_bins - 1 else 0

            if vol_below >= vol_above and va_low_bin > 0:
                va_low_bin -= 1
                va_volume += volume_by_bin[va_low_bin]
            elif va_high_bin < num_bins - 1:
                va_high_bin += 1
                va_volume += volume_by_bin[va_high_bin]
            elif va_low_bin > 0:
                va_low_bin -= 1
                va_volume += volume_by_bin[va_low_bin]
            else:
                break

        val_price = price_low + va_low_bin * bin_size        # Value Area Low
        vah_price = price_low + (va_high_bin + 1) * bin_size # Value Area High

        return {
            "poc_price": round(poc_price, 8),
            "vah_price": round(vah_price, 8),
            "val_price": round(val_price, 8),
            "total_volume": round(total_volume, 2)
        }

    def _simulate_trades_for_ranges(
        self,
        candles: List[Dict],
        ranges: List[Dict],
        params: ZoneDetectionParams,
        bbwp_values: List[float] = None,
        method_name: str = "atr_dynamic"
    ) -> List[TradingZone]:
        """
        Simula trades para rangos detectados (TP=2R, SL=1R).
        Reutilizable por trading_zones y atr_dynamic.

        Cada rango debe tener:
          - start_idx, end_idx (indices de velas)
          - start_ts, end_ts (timestamps) o se calculan
          - high, low (limites de precio)
          - candle_count (numero de velas)
        """
        from datetime import datetime, timezone

        def _ts_to_str(ts):
            """Timestamp ms -> string legible"""
            return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime('%m/%d %H:%M')

        if not ranges:
            return []

        trading_zones: List[TradingZone] = []
        atr_values = self._calculate_rolling_atr_for_trading(candles, 14)
        all_volumes = [c['volume'] for c in candles]
        stats = {"wins": 0, "losses": 0, "open": 0, "skipped": 0}
        current_trade_close_ts = 0
        lookforward_bars = params.lookforward_bars

        # Ordenar rangos por tiempo
        sorted_ranges = sorted(ranges, key=lambda x: x.get('start_idx', 0))

        print(f"[ZoneDetector] _simulate_trades: position_mode='{params.position_mode}'")

        for zone_num, r in enumerate(sorted_ranges):
            start_idx = r.get('start_idx', 0)
            end_idx = r.get('end_idx', start_idx)
            zone_high = r.get('high', r.get('range_high', 0))
            zone_low = r.get('low', r.get('range_low', 0))

            # Validar indices
            if start_idx >= len(candles) or end_idx >= len(candles):
                continue

            zone_candles = candles[start_idx:end_idx + 1]
            if not zone_candles:
                continue

            zone_height = zone_high - zone_low
            zone_mid = (zone_high + zone_low) / 2

            start_ts = r.get('start_ts', zone_candles[0]['timestamp'])
            end_ts = r.get('end_ts', zone_candles[-1]['timestamp'])
            duration_hours = (end_ts - start_ts) / (1000 * 60 * 60)

            # Volumen
            avg_volume = np.mean([c['volume'] for c in zone_candles])
            volume_score = self._calculate_volume_score(avg_volume, all_volumes)

            # Calcular Volume Profile de la zona
            vp_data = self._calculate_zone_volume_profile(
                zone_candles, num_bins=params.vp_bins_per_zone
            )
            poc_price = vp_data["poc_price"]
            vah_price = vp_data["vah_price"]
            val_price = vp_data["val_price"]

            # Determinar limites de breakout segun entry_mode
            if params.entry_mode == "va_breakout":
                # Breakout del Value Area (mas rapido que breakout de zona completa)
                breakout_upper = vah_price
                breakout_lower = val_price
            else:
                # Breakout de la zona completa (comportamiento original)
                breakout_upper = zone_high
                breakout_lower = zone_low

            # Detectar breakout: vela que CIERRA fuera del limite
            breakout_idx = end_idx
            breakout_direction = ""
            breakout_close_price = 0.0
            breakout_ts = 0

            search_limit = min(end_idx + params.breakout_search_bars, len(candles))
            for bi in range(end_idx, search_limit):
                c = candles[bi]
                if c['close'] > breakout_upper:
                    breakout_direction = "UP"
                    breakout_close_price = c['close']
                    breakout_ts = c['timestamp']
                    breakout_idx = bi
                    break
                elif c['close'] < breakout_lower:
                    breakout_direction = "DOWN"
                    breakout_close_price = c['close']
                    breakout_ts = c['timestamp']
                    breakout_idx = bi
                    break

            if not breakout_direction:
                if not params.include_no_breakout:
                    continue
                safe_idx = min(end_idx, len(candles) - 1)
                last_candle = candles[safe_idx]
                if last_candle['close'] > zone_mid:
                    breakout_direction = "UP"
                else:
                    breakout_direction = "DOWN"
                breakout_close_price = last_candle['close']
                breakout_ts = last_candle['timestamp']
                breakout_idx = safe_idx

            # --- Determinar precio de entrada segun entry_mode ---
            entry_price = 0.0
            entry_ts = 0
            entry_idx = breakout_idx
            entry_bar_offset = 0
            entry_found = True

            if params.entry_mode == "swing_confirmation":
                entry_found = False
                sb = params.swing_bars
                search_start = breakout_idx + 1
                search_end = min(breakout_idx + lookforward_bars, len(candles) - sb)

                for si in range(max(search_start, sb), search_end):
                    if breakout_direction == "UP":
                        if self._is_swing_low_static(candles, si, sb):
                            confirm_idx = si + sb
                            if confirm_idx < len(candles):
                                entry_price = candles[confirm_idx]['close']
                                entry_ts = candles[confirm_idx]['timestamp']
                                entry_idx = confirm_idx
                                entry_bar_offset = confirm_idx - breakout_idx
                                entry_found = True
                            break
                    else:
                        if self._is_swing_high_static(candles, si, sb):
                            confirm_idx = si + sb
                            if confirm_idx < len(candles):
                                entry_price = candles[confirm_idx]['close']
                                entry_ts = candles[confirm_idx]['timestamp']
                                entry_idx = confirm_idx
                                entry_bar_offset = confirm_idx - breakout_idx
                                entry_found = True
                            break
            else:
                entry_price = breakout_close_price
                entry_ts = breakout_ts
                entry_idx = breakout_idx
                entry_bar_offset = 0

            # --- Modo sequential: verificar si hay trade abierto ---
            if params.position_mode == "sequential" and current_trade_close_ts > 0:
                check_ts = entry_ts if entry_ts > 0 else breakout_ts
                if check_ts <= current_trade_close_ts:
                    touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)
                    trading_zone = self._build_trading_zone(
                        zone_low, zone_high, start_ts, end_ts, touches, duration_hours,
                        avg_volume, volume_score, len(zone_candles),
                        breakout_direction, breakout_close_price, breakout_ts,
                        params.entry_mode, entry_price, entry_ts, entry_bar_offset,
                        0.0, 0.0,
                        "SKIPPED", 0.0, 0, 0.0, False, False, 0.0, 0, 0.0,
                        vp_poc_price=poc_price, vp_vah_price=vah_price,
                        vp_val_price=val_price, vp_total_volume=vp_data["total_volume"]
                    )
                    trading_zone.method = method_name
                    trading_zones.append(trading_zone)
                    stats["skipped"] += 1
                    continue

            if not entry_found:
                touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)
                trading_zone = self._build_trading_zone(
                    zone_low, zone_high, start_ts, end_ts, touches, duration_hours,
                    avg_volume, volume_score, len(zone_candles),
                    breakout_direction, breakout_close_price, breakout_ts,
                    params.entry_mode, 0.0, 0, 0,
                    0.0, 0.0,
                    "NO_ENTRY", 0.0, 0, 0.0, False, False, 0.0, 0, 0.0,
                    vp_poc_price=poc_price, vp_vah_price=vah_price,
                    vp_val_price=val_price, vp_total_volume=vp_data["total_volume"]
                )
                trading_zone.method = method_name
                trading_zones.append(trading_zone)
                stats["skipped"] += 1
                continue

            # --- Calcular SL/TP ---
            _rr = params.tp_rr_ratio
            if params.entry_mode == "va_breakout" and poc_price > 0:
                # SL basado en distancia Entry -> POC + buffer %
                dist_to_poc = abs(entry_price - poc_price)
                if dist_to_poc == 0:
                    dist_to_poc = zone_height * 0.3  # fallback: 30% de la zona
                buffer_mult = 1.0 + (params.sl_poc_buffer_pct / 100.0)
                r_distance = dist_to_poc * buffer_mult

                if breakout_direction == "UP":
                    sl_price = entry_price - r_distance
                    tp_price = entry_price + (r_distance * _rr)
                else:
                    sl_price = entry_price + r_distance
                    tp_price = entry_price - (r_distance * _rr)
            elif params.sl_mode == "swing_previous":
                sl_price = self._find_swing_sl(
                    candles, breakout_idx, breakout_direction,
                    params.swing_bars, zone_low, zone_high, entry_price
                )
                r_distance = abs(entry_price - sl_price)
                if r_distance == 0:
                    r_distance = zone_height
                if breakout_direction == "UP":
                    tp_price = entry_price + (r_distance * _rr)
                else:
                    tp_price = entry_price - (r_distance * _rr)
            else:
                r_distance = zone_height
                if breakout_direction == "UP":
                    sl_price = entry_price - zone_height
                    tp_price = entry_price + (zone_height * _rr)
                else:
                    sl_price = entry_price + zone_height
                    tp_price = entry_price - (zone_height * _rr)

            # --- Validar coherencia SL/TP ---
            if breakout_direction == "UP":
                if sl_price >= entry_price:
                    sl_price = entry_price - zone_height
                    r_distance = zone_height
                    tp_price = entry_price + (zone_height * _rr)
                if tp_price <= entry_price:
                    tp_price = entry_price + (r_distance * _rr)
            else:
                if sl_price <= entry_price:
                    sl_price = entry_price + zone_height
                    r_distance = zone_height
                    tp_price = entry_price - (zone_height * _rr)
                if tp_price >= entry_price:
                    tp_price = entry_price - (r_distance * _rr)

            # --- Metricas de momentum ---
            if breakout_idx >= len(candles):
                breakout_idx = len(candles) - 1
            if entry_idx >= len(candles):
                entry_idx = len(candles) - 1
            breakout_candle = candles[breakout_idx]
            atr_at_breakout = atr_values[breakout_idx] if breakout_idx < len(atr_values) else zone_height
            breakout_body = abs(breakout_candle['close'] - breakout_candle['open'])
            breakout_body_ratio = breakout_body / atr_at_breakout if atr_at_breakout > 0 else 0

            continuation_bars = 0
            post_breakout_for_cont = candles[breakout_idx + 1:breakout_idx + 21]
            for pc in post_breakout_for_cont:
                if breakout_direction == "UP" and pc['close'] > pc['open']:
                    continuation_bars += 1
                elif breakout_direction == "DOWN" and pc['close'] < pc['open']:
                    continuation_bars += 1
                else:
                    break

            # --- Simular trade ---
            trade_result = "PENDING"
            trade_pnl_r = 0.0
            bars_to_close = 0
            r_multiple = 0.0
            reached_2r = False
            reached_3r = False

            post_entry = candles[entry_idx:]

            if len(post_entry) > 0:
                if breakout_direction == "UP":
                    max_p = max(c['high'] for c in post_entry)
                    r_multiple = float((max_p - entry_price) / r_distance) if r_distance > 0 else 0.0
                else:
                    min_p = min(c['low'] for c in post_entry)
                    r_multiple = float((entry_price - min_p) / r_distance) if r_distance > 0 else 0.0
                reached_2r = bool(r_multiple >= 2.0)
                reached_3r = bool(r_multiple >= 3.0)

            _tp_rr = params.tp_rr_ratio
            trade_close_idx = entry_idx
            for bar_num, c in enumerate(post_entry):
                if breakout_direction == "UP":
                    tp_hit = c['high'] >= tp_price
                    sl_hit = c['low'] <= sl_price
                else:
                    tp_hit = c['low'] <= tp_price
                    sl_hit = c['high'] >= sl_price

                if tp_hit and sl_hit:
                    if breakout_direction == "UP":
                        if c['close'] >= c['open']:
                            trade_result = "WIN"
                            trade_pnl_r = _tp_rr
                        else:
                            trade_result = "LOSS"
                            trade_pnl_r = -1.0
                    else:
                        if c['close'] <= c['open']:
                            trade_result = "WIN"
                            trade_pnl_r = _tp_rr
                        else:
                            trade_result = "LOSS"
                            trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_idx = entry_idx + bar_num
                    break
                elif tp_hit:
                    trade_result = "WIN"
                    trade_pnl_r = _tp_rr
                    bars_to_close = bar_num + 1
                    trade_close_idx = entry_idx + bar_num
                    break
                elif sl_hit:
                    trade_result = "LOSS"
                    trade_pnl_r = -1.0
                    bars_to_close = bar_num + 1
                    trade_close_idx = entry_idx + bar_num
                    break

            if trade_result == "PENDING":
                last_candle = candles[-1]
                if breakout_direction == "UP":
                    pnl = (last_candle['close'] - entry_price) / r_distance if r_distance > 0 else 0
                else:
                    pnl = (entry_price - last_candle['close']) / r_distance if r_distance > 0 else 0

                trade_result = "OPEN"
                trade_pnl_r = max(min(pnl, _tp_rr), -1.0)

                bars_to_close = len(post_entry)
                trade_close_idx = len(candles) - 1

            trade_close_ts = candles[trade_close_idx]['timestamp'] if trade_close_idx < len(candles) else 0

            if params.position_mode == "sequential":
                current_trade_close_ts = trade_close_ts

            if trade_result == "WIN":
                stats["wins"] += 1
            elif trade_result == "LOSS":
                stats["losses"] += 1
            else:
                stats["open"] += 1

            # Trading score - INTRINSECO (sin sesgos post-trade)
            # El score debe reflejar la calidad de la zona ANTES de abrir el trade
            momentum_score = min(breakout_body_ratio * 40, 30)
            compression_score = max(0, (params.consol_max_range_pct - ((zone_high - zone_low) / zone_mid * 100)) / params.consol_max_range_pct) * 25
            volume_bonus = volume_score * 0.25

            # Continuation score: SOLO si entry_mode=swing_confirmation Y use_continuation_score=True
            continuation_score = 0
            if params.use_continuation_score and params.entry_mode == "swing_confirmation":
                continuation_score = min(continuation_bars * 5, 20)

            base_score = momentum_score + continuation_score + compression_score + volume_bonus

            bbwp_bonus = 0
            avg_bbwp = -1
            if params.use_bbwp_scoring and bbwp_values:
                zone_bbwp_vals = [bbwp_values[idx] for idx in range(start_idx, end_idx + 1) if idx < len(bbwp_values) and bbwp_values[idx] > 0]
                if zone_bbwp_vals:
                    avg_bbwp = sum(zone_bbwp_vals) / len(zone_bbwp_vals)
                    if avg_bbwp <= params.bbwp_squeeze_threshold:
                        bbwp_bonus = (params.bbwp_squeeze_threshold - avg_bbwp) / params.bbwp_squeeze_threshold * 15
                        base_score += bbwp_bonus
                    hist_info = f", history_days={params.bbwp_history_days}" if params.bbwp_history_days > 0 else ""
                    print(f"[ZoneDetector] BBWP DEBUG zona {_ts_to_str(start_ts)}: "
                          f"avg_bbwp={avg_bbwp:.1f}, threshold={params.bbwp_squeeze_threshold}, "
                          f"bonus={bbwp_bonus:.1f}, lookback={params.bbwp_lookback}, "
                          f"vals_count={len(zone_bbwp_vals)}, "
                          f"min={min(zone_bbwp_vals):.1f}, max={max(zone_bbwp_vals):.1f}"
                          f"{hist_info}, total_bbwp_vals={len(bbwp_values)}")

            # --- Filtro de score minimo ---
            if params.min_score_filter > 0 and base_score < params.min_score_filter:
                stats["filtered"] = stats.get("filtered", 0) + 1
                bbwp_bonus_dbg = base_score - (momentum_score + continuation_score + compression_score + volume_bonus)
                print(f"[ZoneDetector] SCORE FILTRADO: {base_score:.1f} < {params.min_score_filter} | "
                      f"zona {_ts_to_str(start_ts)}-{_ts_to_str(end_ts)} | "
                      f"breakout={breakout_direction} result={trade_result} | "
                      f"momentum={momentum_score:.1f} compression={compression_score:.1f} "
                      f"vol={volume_bonus:.1f} bbwp={bbwp_bonus_dbg:.1f} cont={continuation_score:.1f} | "
                      f"body_ratio={breakout_body_ratio:.2f} range_pct={((zone_high - zone_low) / zone_mid * 100):.2f}%")
                # Revertir stats si ya se contabilizo
                if trade_result == "WIN":
                    stats["wins"] -= 1
                elif trade_result == "LOSS":
                    stats["losses"] -= 1
                # Revertir trade_close_ts para sequential
                if params.position_mode == "sequential":
                    current_trade_close_ts = 0  # Reset para que el siguiente trade pueda entrar
                continue  # No incluir esta zona

            # Score final = base_score (NO aplicamos ajuste por resultado)
            trading_score = base_score
            bbwp_bonus_dbg = base_score - (momentum_score + continuation_score + compression_score + volume_bonus)
            print(f"[ZoneDetector] SCORE OK: {base_score:.1f} >= {params.min_score_filter} | "
                  f"zona {_ts_to_str(start_ts)}-{_ts_to_str(end_ts)} | "
                  f"breakout={breakout_direction} result={trade_result} | "
                  f"momentum={momentum_score:.1f} compression={compression_score:.1f} "
                  f"vol={volume_bonus:.1f} bbwp={bbwp_bonus_dbg:.1f} cont={continuation_score:.1f} | "
                  f"body_ratio={breakout_body_ratio:.2f} range_pct={((zone_high - zone_low) / zone_mid * 100):.2f}%")

            touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)

            trading_zone = self._build_trading_zone(
                zone_low, zone_high, start_ts, end_ts, touches, duration_hours,
                avg_volume, volume_score, len(zone_candles),
                breakout_direction, breakout_close_price, breakout_ts,
                params.entry_mode, entry_price, entry_ts, entry_bar_offset,
                sl_price, tp_price,
                trade_result, trade_pnl_r, bars_to_close,
                r_multiple, reached_2r, reached_3r,
                breakout_body_ratio, continuation_bars, trading_score,
                trade_close_timestamp=trade_close_ts,
                vp_poc_price=poc_price, vp_vah_price=vah_price,
                vp_val_price=val_price, vp_total_volume=vp_data["total_volume"]
            )
            trading_zone.method = method_name
            trading_zones.append(trading_zone)

        # Estadisticas finales
        total_closed = stats["wins"] + stats["losses"]
        win_rate = (stats["wins"] / total_closed * 100) if total_closed > 0 else 0
        total_pnl = sum(tz.trade_pnl_r for tz in trading_zones if tz.trade_result in ("WIN", "LOSS"))
        expectancy = total_pnl / total_closed if total_closed > 0 else 0

        filtered_count = stats.get("filtered", 0)
        print(f"[ZoneDetector] {method_name} RESULTADOS (mode={params.entry_mode}, pos={params.position_mode}, sl={params.sl_mode}):")
        print(f"  - Total zonas: {len(trading_zones)}" + (f" (filtradas por score: {filtered_count})" if filtered_count > 0 else ""))
        print(f"  - Wins: {stats['wins']}, Losses: {stats['losses']}, Skipped: {stats['skipped']}")
        print(f"  - Win Rate: {win_rate:.1f}%")
        print(f"  - Total P&L: {total_pnl:+.1f}R")
        print(f"  - Expectancy: {expectancy:.3f}R por trade")
        if params.min_score_filter > 0:
            print(f"  - Min Score Filter: {params.min_score_filter}%")

        # Asignar timeline_index cronologico
        zones_by_time = sorted(trading_zones, key=lambda z: z.entry_timestamp if z.entry_timestamp > 0 else z.start_timestamp)
        for i, tz in enumerate(zones_by_time):
            tz.timeline_index = i + 1

        return zones_by_time

    def _merge_overlapping_atr_ranges(self, ranges: List[Dict]) -> List[Dict]:
        """
        Mergea rangos que se solapan en TIEMPO solamente.
        El merge por precio sin overlap temporal creaba mega-rangos artificiales
        (ej: 3 rangos separados por horas se mergeaban porque tenian precios similares).
        Ordenados por start_idx.
        """
        if not ranges:
            return ranges

        sorted_ranges = sorted(ranges, key=lambda r: r['start_idx'])
        merged = [sorted_ranges[0]]

        for r in sorted_ranges[1:]:
            last = merged[-1]

            # Solo merge por overlap temporal (un rango empieza antes de que el otro termine)
            time_overlap = r['start_idx'] <= last['end_idx']

            if time_overlap:
                # Mergear
                last['end_idx'] = max(last['end_idx'], r['end_idx'])
                last['end_ts'] = max(last['end_ts'], r['end_ts'])
                last['high'] = max(last['high'], r['high'])
                last['low'] = min(last['low'], r['low'])
                last['candle_count'] = last['end_idx'] - last['start_idx'] + 1
            else:
                merged.append(r)

        return merged

    # =========================================================================
    # METODOS AUXILIARES
    # =========================================================================

    def _create_zone_from_range(
        self,
        candles: List[Dict],
        start_idx: int,
        end_idx: int,
        method: str
    ) -> Optional[Zone]:
        """Crea una zona a partir de un rango de índices de velas."""
        if start_idx >= end_idx or start_idx < 0 or end_idx > len(candles):
            return None

        zone_candles = candles[start_idx:end_idx]
        if not zone_candles:
            return None

        min_price = min(c['low'] for c in zone_candles)
        max_price = max(c['high'] for c in zone_candles)
        start_ts = zone_candles[0]['timestamp']
        end_ts = zone_candles[-1]['timestamp']
        duration_hours = (end_ts - start_ts) / (1000 * 60 * 60)

        # Contar toques
        touches = self._count_touches_in_range(candles, min_price, max_price)

        # Volumen
        avg_volume = np.mean([c['volume'] for c in zone_candles])
        all_volumes = [c['volume'] for c in candles]
        volume_score = self._calculate_volume_score(avg_volume, all_volumes)

        # Score
        price_range_pct = ((max_price - min_price) / min_price) * 100
        score = self._calculate_zone_score(
            touches=touches['total'],
            duration_hours=duration_hours,
            volume_score=volume_score,
            price_range_pct=price_range_pct,
            balance=min(touches['support'], touches['resistance']) / max(touches['support'], touches['resistance'], 1)
        )

        return Zone(
            id=self._generate_zone_id(),
            min_price=min_price,
            max_price=max_price,
            start_timestamp=start_ts,
            end_timestamp=end_ts,
            touches_support=touches['support'],
            touches_resistance=touches['resistance'],
            total_touches=touches['total'],
            duration_hours=duration_hours,
            avg_volume=avg_volume,
            volume_score=volume_score,
            method=method,
            score=score,
            candles_in_zone=len(zone_candles),
            price_range_pct=price_range_pct
        )

    def _count_touches_in_range(
        self,
        candles: List[Dict],
        min_price: float,
        max_price: float
    ) -> Dict[str, int]:
        """Cuenta cuántas veces el precio tocó soporte y resistencia de una zona."""
        tolerance = (max_price - min_price) * 0.1  # 10% de la zona

        support_level = min_price
        resistance_level = max_price

        touches_support = 0
        touches_resistance = 0

        for candle in candles:
            # Toque de soporte (low cerca del mínimo)
            if abs(candle['low'] - support_level) <= tolerance:
                touches_support += 1

            # Toque de resistencia (high cerca del máximo)
            if abs(candle['high'] - resistance_level) <= tolerance:
                touches_resistance += 1

        return {
            'support': touches_support,
            'resistance': touches_resistance,
            'total': touches_support + touches_resistance
        }

    def _calculate_volume_score(self, zone_volume: float, all_volumes: List[float]) -> float:
        """Calcula score de volumen (0-100) comparando con el histórico."""
        if not all_volumes or zone_volume == 0:
            return 50.0

        mean_vol = np.mean(all_volumes)
        std_vol = np.std(all_volumes)

        if std_vol == 0:
            return 50.0

        z_score = (zone_volume - mean_vol) / std_vol

        # Convertir z-score a 0-100
        # z-score de -2 = 0, z-score de +2 = 100
        score = (z_score + 2) / 4 * 100
        return max(0, min(100, score))

    def _calculate_zone_score(
        self,
        touches: int,
        duration_hours: float,
        volume_score: float,
        price_range_pct: float,
        balance: float
    ) -> float:
        """
        Calcula score de calidad de una zona (0-100).

        Factores:
        - Más toques = mejor (hasta cierto punto)
        - Mayor duración = más confiable
        - Mayor volumen = más significativo
        - Rango de precio razonable (no muy amplio ni muy estrecho)
        - Balance entre toques de soporte y resistencia
        """
        # Score por toques (0-25)
        touch_score = min(touches / 10, 1) * 25

        # Score por duración (0-25)
        # Ideal: 8-48 horas
        if duration_hours < 4:
            duration_score = duration_hours / 4 * 15
        elif duration_hours <= 48:
            duration_score = 25
        else:
            duration_score = max(15, 25 - (duration_hours - 48) / 24 * 5)

        # Score por volumen (0-25)
        vol_score = volume_score * 0.25

        # Score por rango de precio (0-15)
        # Ideal: 0.5% - 2%
        if price_range_pct < 0.3:
            range_score = price_range_pct / 0.3 * 10
        elif price_range_pct <= 2:
            range_score = 15
        elif price_range_pct <= 5:
            range_score = 15 - (price_range_pct - 2) / 3 * 10
        else:
            range_score = 5

        # Score por balance (0-10)
        balance_score = balance * 10

        total = touch_score + duration_score + vol_score + range_score + balance_score
        return min(100, max(0, total))

    def _generate_zone_id(self) -> str:
        """Genera ID único para una zona."""
        self._zone_counter += 1
        return f"zone_{self._zone_counter}_{int(datetime.now().timestamp())}"

    def _deduplicate_zones(
        self,
        zones: List[Zone],
        price_tolerance_pct: float = 0.5,
        time_overlap_pct: float = 0.5
    ) -> List[Zone]:
        """
        Elimina zonas duplicadas o muy similares.

        Dos zonas se consideran duplicadas si:
        1. Sus rangos de precio se solapan significativamente (>50% de overlap)
        2. Sus rangos de tiempo se solapan significativamente (>50% de overlap)

        De dos zonas duplicadas, se conserva la de mayor score.

        Args:
            zones: Lista de zonas a deduplicar
            price_tolerance_pct: % de tolerancia para considerar precios similares
            time_overlap_pct: % mínimo de overlap temporal para considerar duplicado

        Returns:
            Lista de zonas sin duplicados
        """
        if len(zones) <= 1:
            return zones

        # Ordenar por score descendente (las mejores primero)
        sorted_zones = sorted(zones, key=lambda z: z.score, reverse=True)

        deduplicated = []

        for zone in sorted_zones:
            is_duplicate = False

            for existing in deduplicated:
                # Calcular overlap de precio
                price_overlap = self._calculate_range_overlap(
                    zone.min_price, zone.max_price,
                    existing.min_price, existing.max_price
                )

                # Calcular overlap temporal
                time_overlap = self._calculate_range_overlap(
                    zone.start_timestamp, zone.end_timestamp,
                    existing.start_timestamp, existing.end_timestamp
                )

                # Si hay suficiente overlap en ambas dimensiones, es duplicado
                if price_overlap >= 0.5 and time_overlap >= 0.3:
                    is_duplicate = True
                    print(f"[ZoneDetector] Descartando zona duplicada {zone.id} "
                          f"(precio_overlap={price_overlap:.1%}, tiempo_overlap={time_overlap:.1%})")
                    break

            if not is_duplicate:
                deduplicated.append(zone)

        print(f"[ZoneDetector] Deduplicación: {len(zones)} -> {len(deduplicated)} zonas")
        return deduplicated

    def _calculate_range_overlap(
        self,
        start1: float,
        end1: float,
        start2: float,
        end2: float
    ) -> float:
        """
        Calcula el porcentaje de overlap entre dos rangos.

        Returns:
            Valor entre 0 (sin overlap) y 1 (overlap completo)
        """
        # Calcular intersección
        overlap_start = max(start1, start2)
        overlap_end = min(end1, end2)

        if overlap_start >= overlap_end:
            return 0.0

        overlap_size = overlap_end - overlap_start

        # Usar el rango más pequeño como referencia
        range1_size = end1 - start1
        range2_size = end2 - start2
        min_range_size = min(range1_size, range2_size)

        if min_range_size <= 0:
            return 0.0

        return overlap_size / min_range_size


# Singleton para uso global
zone_detector = ZoneDetector()
