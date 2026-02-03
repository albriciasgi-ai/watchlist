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
    Zona de consolidación con métricas de trading para simulación.
    Extiende Zone con datos de rentabilidad post-breakout.
    """
    # Métricas de Trading (calculadas por el analizador)
    breakout_direction: str = ""  # "UP" o "DOWN"
    breakout_price: float = 0.0
    breakout_timestamp: int = 0

    # Resultado del trade simulado (TP=2R, SL=1R)
    trade_result: str = ""  # "WIN", "LOSS", "OPEN", "PENDING"
    trade_pnl_r: float = 0.0  # +2 si WIN, -1 si LOSS, 0 si OPEN/PENDING
    bars_to_close: int = 0  # Velas desde breakout hasta cierre

    # R-Multiple alcanzado
    r_multiple: float = 0.0
    reached_2r: bool = False
    reached_3r: bool = False

    # Métricas de momentum
    breakout_body_ratio: float = 0.0  # Cuerpo de vela de breakout / ATR
    continuation_bars: int = 0  # Velas consecutivas en dirección del breakout

    # Score de trading (basado en rentabilidad, no solo consolidación)
    trading_score: float = 0.0  # 0-100 basado en probabilidad de éxito

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

    # 🎯 NUEVO: Trading Zones Method (simulación de trades)
    lookforward_bars: int = 100        # Velas hacia adelante para simular el trade
    breakout_search_bars: int = 20     # Velas para buscar breakout después de la consolidación
    include_no_breakout: bool = True   # Incluir zonas sin breakout claro (usa primera vela fuera)


class ZoneDetector:
    """
    Detecta zonas de consolidación (rangos) usando múltiples métodos.
    Permite comparar cuál funciona mejor.
    """

    METHODS = ["pivot_cluster", "atr_based", "volume_profile", "price_action", "consolidation", "trading_zones"]

    def __init__(self):
        self._zone_counter = 0

    def detect_zones(
        self,
        candles: List[Dict],
        method: str = "pivot_cluster",
        params: Optional[ZoneDetectionParams] = None
    ) -> List[Zone]:
        """
        Detecta zonas de consolidación usando el método especificado.

        Args:
            candles: Lista de velas OHLCV
            method: Método de detección a usar
            params: Parámetros de configuración

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
        else:
            raise ValueError(f"Método desconocido: {method}. Usar: {self.METHODS}")

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
        # Calcular ATR
        atr_values = self._calculate_atr(candles, params.atr_period)

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

    def _calculate_atr(self, candles: List[Dict], period: int) -> List[float]:
        """Calcula Average True Range"""
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
        if len(candles) < params.consol_min_bars + lookforward_bars + 20:
            print(f"[ZoneDetector] Trading Zones: Insuficientes velas ({len(candles)})")
            return []

        trading_zones = []

        # Calcular ATR global para referencia
        global_atr = self._calculate_atr(candles, min(14, len(candles) // 4))
        if global_atr == 0:
            return []

        # Pre-calcular ATR rolling
        atr_values = self._calculate_rolling_atr_for_trading(candles, 14)

        print(f"[ZoneDetector] Trading Zones: ATR global = {global_atr:.2f}, velas = {len(candles)}")

        found_ranges = []
        i = 0

        # FASE 1: Detectar consolidaciones (igual que consolidation_method)
        while i < len(candles) - params.consol_min_bars - lookforward_bars:
            consol_start = i
            consol_end = i + params.consol_min_bars

            window = candles[consol_start:consol_end]
            range_high = max(c['high'] for c in window)
            range_low = min(c['low'] for c in window)
            range_mid = (range_high + range_low) / 2
            range_pct = ((range_high - range_low) / range_mid) * 100 if range_mid > 0 else 100

            local_atr = self._calculate_atr(window, min(5, len(window) // 2))
            atr_ratio = local_atr / global_atr if global_atr > 0 else 1.0
            avg_body_ratio = self._calculate_avg_body_ratio(window)

            if (range_pct > params.consol_max_range_pct or
                atr_ratio > params.consol_atr_ratio or
                avg_body_ratio > params.consol_body_ratio):
                i += 1
                continue

            # Extender la zona hasta breakout
            consecutive_outside = 0
            last_valid_end = consol_end

            while consol_end < len(candles) - lookforward_bars and (consol_end - consol_start) < params.consol_max_bars:
                next_candle = candles[consol_end]
                candle_touches_range = not (next_candle['low'] > range_high or next_candle['high'] < range_low)

                if candle_touches_range:
                    consecutive_outside = 0
                    last_valid_end = consol_end + 1
                else:
                    consecutive_outside += 1
                    if consecutive_outside >= params.consol_max_outside_bars:
                        consol_end = last_valid_end
                        break

                consol_end += 1

            consol_length = consol_end - consol_start
            if consol_length >= params.consol_min_bars:
                found_ranges.append({
                    'start_idx': consol_start,
                    'end_idx': consol_end,
                    'range_high': range_high,
                    'range_low': range_low,
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

        print(f"[ZoneDetector] Trading Zones: {len(selected_ranges)} después de deduplicación")

        # FASE 2: Analizar cada zona con métricas de trading
        stats = {"wins": 0, "losses": 0, "open": 0}

        for r in selected_ranges:
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
            all_volumes = [c['volume'] for c in candles]
            volume_score = self._calculate_volume_score(avg_volume, all_volumes)

            # Detectar breakout
            breakout_idx = r['end_idx']
            breakout_direction = ""
            breakout_price = 0.0
            breakout_ts = 0

            # Buscar vela que cierra fuera del rango (breakout)
            search_limit = min(r['end_idx'] + params.breakout_search_bars, len(candles) - lookforward_bars)
            for bi in range(r['end_idx'], search_limit):
                c = candles[bi]
                if c['close'] > zone_high:
                    breakout_direction = "UP"
                    breakout_price = zone_high
                    breakout_ts = c['timestamp']
                    breakout_idx = bi
                    break
                elif c['close'] < zone_low:
                    breakout_direction = "DOWN"
                    breakout_price = zone_low
                    breakout_ts = c['timestamp']
                    breakout_idx = bi
                    break

            if not breakout_direction:
                if not params.include_no_breakout:
                    # Sin breakout claro, omitir esta zona
                    continue
                # Si include_no_breakout=True, usar la última vela de la zona como "breakout"
                # y determinar dirección por el cierre respecto al medio
                last_candle = candles[min(r['end_idx'], len(candles) - lookforward_bars - 1)]
                if last_candle['close'] > zone_mid:
                    breakout_direction = "UP"
                else:
                    breakout_direction = "DOWN"
                breakout_price = zone_high if breakout_direction == "UP" else zone_low
                breakout_ts = last_candle['timestamp']
                breakout_idx = r['end_idx']

            # Simulación de trading: TP=2R, SL=1R adverso
            if breakout_direction == "UP":
                tp_price = breakout_price + (zone_height * 2)
                sl_price = breakout_price - zone_height
            else:
                tp_price = breakout_price - (zone_height * 2)
                sl_price = breakout_price + zone_height

            trade_result = "PENDING"
            trade_pnl_r = 0.0
            bars_to_close = 0
            r_multiple = 0.0
            reached_2r = False
            reached_3r = False
            breakout_body_ratio = 0.0
            continuation_bars = 0

            # Analizar velas post-breakout
            post_breakout = candles[breakout_idx:]
            breakout_candle = candles[breakout_idx]

            # Ratio del cuerpo de breakout
            atr_at_breakout = atr_values[breakout_idx] if breakout_idx < len(atr_values) else zone_height
            breakout_body = abs(breakout_candle['close'] - breakout_candle['open'])
            breakout_body_ratio = breakout_body / atr_at_breakout if atr_at_breakout > 0 else 0

            # Contar velas de continuación
            for pc in post_breakout[1:min(20, len(post_breakout))]:
                if breakout_direction == "UP" and pc['close'] > pc['open']:
                    continuation_bars += 1
                elif breakout_direction == "DOWN" and pc['close'] < pc['open']:
                    continuation_bars += 1
                else:
                    break

            # Calcular MFE y R-Multiple
            if breakout_direction == "UP":
                max_price = max(c['high'] for c in post_breakout[:lookforward_bars])
                r_multiple = (max_price - breakout_price) / zone_height if zone_height > 0 else 0
            else:
                min_price = min(c['low'] for c in post_breakout[:lookforward_bars])
                r_multiple = (breakout_price - min_price) / zone_height if zone_height > 0 else 0

            reached_2r = r_multiple >= 2.0
            reached_3r = r_multiple >= 3.0

            # Simular trade (sin timeout)
            for bar_num, c in enumerate(post_breakout):
                if breakout_direction == "UP":
                    tp_hit = c['high'] >= tp_price
                    sl_hit = c['low'] <= sl_price

                    if tp_hit and sl_hit:
                        trade_result = "LOSS"
                        trade_pnl_r = -1.0
                        bars_to_close = bar_num + 1
                        break
                    elif tp_hit:
                        trade_result = "WIN"
                        trade_pnl_r = 2.0
                        bars_to_close = bar_num + 1
                        break
                    elif sl_hit:
                        trade_result = "LOSS"
                        trade_pnl_r = -1.0
                        bars_to_close = bar_num + 1
                        break
                else:  # DOWN
                    tp_hit = c['low'] <= tp_price
                    sl_hit = c['high'] >= sl_price

                    if tp_hit and sl_hit:
                        trade_result = "LOSS"
                        trade_pnl_r = -1.0
                        bars_to_close = bar_num + 1
                        break
                    elif tp_hit:
                        trade_result = "WIN"
                        trade_pnl_r = 2.0
                        bars_to_close = bar_num + 1
                        break
                    elif sl_hit:
                        trade_result = "LOSS"
                        trade_pnl_r = -1.0
                        bars_to_close = bar_num + 1
                        break

            if trade_result == "PENDING":
                trade_result = "OPEN"

            # Actualizar estadísticas
            if trade_result == "WIN":
                stats["wins"] += 1
            elif trade_result == "LOSS":
                stats["losses"] += 1
            else:
                stats["open"] += 1

            # Calcular trading_score basado en factores que predicen éxito
            # - Breakout body ratio alto = momentum fuerte = mejor
            # - Continuation bars alto = confirmación = mejor
            # - Range % bajo = compresión = mejor
            # - Resultado histórico similar (aproximación)
            momentum_score = min(breakout_body_ratio * 40, 30)  # 0-30
            continuation_score = min(continuation_bars * 5, 20)  # 0-20
            compression_score = max(0, (params.consol_max_range_pct - ((zone_high - zone_low) / zone_mid * 100)) / params.consol_max_range_pct) * 25  # 0-25
            volume_bonus = volume_score * 0.25  # 0-25

            trading_score = momentum_score + continuation_score + compression_score + volume_bonus

            # Bonus si el trade ya cerró como WIN
            if trade_result == "WIN":
                trading_score = min(100, trading_score + 15)
            elif trade_result == "LOSS":
                trading_score = max(0, trading_score - 10)

            # Toques
            touches = self._count_touches_in_range(zone_candles, zone_low, zone_high)

            # Crear TradingZone
            trading_zone = TradingZone(
                id=self._generate_zone_id(),
                min_price=zone_low,
                max_price=zone_high,
                start_timestamp=start_ts,
                end_timestamp=end_ts,
                touches_support=touches['support'],
                touches_resistance=touches['resistance'],
                total_touches=touches['total'],
                duration_hours=duration_hours,
                avg_volume=avg_volume,
                volume_score=volume_score,
                method="trading_zones",
                score=trading_score,  # Usar trading_score como score principal
                candles_in_zone=len(zone_candles),
                price_range_pct=((zone_high - zone_low) / zone_low) * 100,
                # Campos de TradingZone
                breakout_direction=breakout_direction,
                breakout_price=breakout_price,
                breakout_timestamp=breakout_ts,
                trade_result=trade_result,
                trade_pnl_r=trade_pnl_r,
                bars_to_close=bars_to_close,
                r_multiple=r_multiple,
                reached_2r=reached_2r,
                reached_3r=reached_3r,
                breakout_body_ratio=breakout_body_ratio,
                continuation_bars=continuation_bars,
                trading_score=trading_score
            )

            trading_zones.append(trading_zone)

        # Calcular estadísticas finales
        total_closed = stats["wins"] + stats["losses"]
        win_rate = (stats["wins"] / total_closed * 100) if total_closed > 0 else 0
        total_pnl = (stats["wins"] * 2) - stats["losses"]
        expectancy = total_pnl / total_closed if total_closed > 0 else 0

        print(f"[ZoneDetector] Trading Zones RESULTADOS:")
        print(f"  - Total zonas: {len(trading_zones)}")
        print(f"  - Wins: {stats['wins']}, Losses: {stats['losses']}, Open: {stats['open']}")
        print(f"  - Win Rate: {win_rate:.1f}%")
        print(f"  - Total P&L: {total_pnl:+.0f}R")
        print(f"  - Expectancy: {expectancy:.3f}R por trade")

        # Ordenar por trading_score descendente
        return sorted(trading_zones, key=lambda z: z.trading_score, reverse=True)

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
    # MÉTODOS AUXILIARES
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
