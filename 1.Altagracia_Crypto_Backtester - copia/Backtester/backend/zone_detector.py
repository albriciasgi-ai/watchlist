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


class ZoneDetector:
    """
    Detecta zonas de consolidación (rangos) usando múltiples métodos.
    Permite comparar cuál funciona mejor.
    """

    METHODS = ["pivot_cluster", "atr_based", "volume_profile", "price_action"]

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
        else:
            raise ValueError(f"Método desconocido: {method}. Usar: {self.METHODS}")

        # Filtrar zonas con rango de precio excesivo
        filtered_zones = []
        for zone in zones:
            if zone.price_range_pct <= params.max_price_range_pct:
                filtered_zones.append(zone)
            else:
                print(f"[ZoneDetector] Descartando zona {zone.id} - rango={zone.price_range_pct:.2f}% > máx={params.max_price_range_pct}%")

        # Ordenar por score descendente
        return sorted(filtered_zones, key=lambda z: z.score, reverse=True)

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


# Singleton para uso global
zone_detector = ZoneDetector()
