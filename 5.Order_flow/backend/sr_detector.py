"""
SR_DETECTOR v2 - Support & Resistance detector basado en Swing Points

Detecta niveles S&R usando:
1. Swing Highs/Lows confirmados (N barras a cada lado)
2. Filtro por posicion relativa al precio (R arriba, S abajo)
3. Clustering de swings cercanos en precio
4. Filtro por cantidad de toques (min_touches)
5. Filtro opcional de volumen (min_volume_zscore)
6. Clasificacion active/broken basada en recentHigh/recentLow
7. Priorizacion: activos mas cercanos primero

Basado en la logica del Backtester que da mejores resultados.

Author: Claude Code
Date: 2026-01-21
"""

import logging
import statistics
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Literal

logger = logging.getLogger(__name__)


@dataclass
class SRLevel:
    """Represents a Support or Resistance level"""
    price: float
    level_type: Literal["resistance", "support"]
    touches: int
    strength: float
    avg_volume_zscore: float
    first_touch: int  # timestamp
    last_touch: int   # timestamp
    recency: float    # 0-1, donde 1 es el mas reciente
    distance_to_price: float  # distancia absoluta al precio actual
    status: Literal["active", "broken"] = "active"

    def to_dict(self) -> Dict:
        return asdict(self)


class SRDetector:
    """
    Support & Resistance detector basado en Swing Points.

    LOGICA CLAVE (del Backtester):
    - Resistencias = SOLO niveles ARRIBA del precio actual
    - Soportes = SOLO niveles DEBAJO del precio actual
    - Active = nivel no tocado por recentHigh/recentLow
    - Broken = nivel tocado/cruzado por recentHigh/recentLow
    - Priorizar activos mas cercanos al precio
    """

    def __init__(self):
        self.name = "SR_DETECTOR_V2"
        logger.info(f"[{self.name}] Initialized")

    def detect_levels(
        self,
        candles: List[Dict],
        swing_bars: int = 3,
        cluster_distance_pct: float = 0.5,
        min_touches: int = 2,
        max_levels: int = 5,
        lookback_bars: int = 50,
        price_range_pct: float = 5.0,
        min_volume_zscore: float = 0.0,  # 0 = sin filtro
        recent_bars_for_break: int = 50   # velas recientes para determinar broken
    ) -> Dict:
        """
        Detecta niveles S&R basados en swing points.

        Args:
            candles: Lista de velas con keys: timestamp, open, high, low, close, volume
            swing_bars: Barras a cada lado para confirmar un swing (default: 3)
            cluster_distance_pct: % maximo de distancia para agrupar swings (default: 0.5%)
            min_touches: Minimo de toques para considerar nivel valido (default: 2)
            max_levels: Maximo de niveles a retornar por tipo (default: 5)
            lookback_bars: Barras para calcular z-score de volumen (default: 50)
            price_range_pct: % arriba/abajo del precio actual para buscar (default: 5%)
            min_volume_zscore: Z-score minimo de volumen para considerar swing (default: 0 = sin filtro)
            recent_bars_for_break: Velas recientes para determinar si nivel fue roto (default: 50)

        Returns:
            {
                "resistances": [SRLevel, ...],
                "supports": [SRLevel, ...],
                "currentPrice": float,
                "stats": {...}
            }
        """
        if not candles or len(candles) < swing_bars * 2 + 1:
            logger.warning(f"[{self.name}] Not enough candles: {len(candles) if candles else 0}")
            return {
                "resistances": [],
                "supports": [],
                "currentPrice": 0,
                "stats": {"error": "Not enough candles"}
            }

        current_price = float(candles[-1]['close'])
        total_candles = len(candles)

        # 1. Calcular z-scores de volumen para todas las velas
        volume_zscores = self._calculate_all_volume_zscores(candles, lookback_bars)

        # 2. Detectar TODOS los swings
        swing_highs = self._detect_swing_highs(candles, swing_bars)
        swing_lows = self._detect_swing_lows(candles, swing_bars)

        total_swings_found = len(swing_highs) + len(swing_lows)
        logger.info(f"[{self.name}] Found {len(swing_highs)} swing highs, {len(swing_lows)} swing lows")

        # 3. Calcular rango de precio para filtrar
        price_min = current_price * (1 - price_range_pct / 100)
        price_max = current_price * (1 + price_range_pct / 100)

        # 4. Filtrar por rango de precio
        swing_highs = [s for s in swing_highs if price_min <= s['price'] <= price_max]
        swing_lows = [s for s in swing_lows if price_min <= s['price'] <= price_max]

        logger.info(f"[{self.name}] After price filter (+-{price_range_pct}%): {len(swing_highs)} highs, {len(swing_lows)} lows")

        # 5. Filtrar por volumen minimo (si esta configurado)
        if min_volume_zscore > 0:
            swing_highs = [s for s in swing_highs if volume_zscores[s['index']] >= min_volume_zscore]
            swing_lows = [s for s in swing_lows if volume_zscores[s['index']] >= min_volume_zscore]
            logger.info(f"[{self.name}] After volume filter (z>={min_volume_zscore}): {len(swing_highs)} highs, {len(swing_lows)} lows")

        # 6. Clustering por precio
        resistance_clusters = self._cluster_swings(swing_highs, cluster_distance_pct)
        support_clusters = self._cluster_swings(swing_lows, cluster_distance_pct)

        logger.info(f"[{self.name}] Clusters: {len(resistance_clusters)} resistance, {len(support_clusters)} support")

        # 7. Convertir clusters a niveles con stats
        resistances = self._clusters_to_levels(
            resistance_clusters, candles, volume_zscores, 'resistance', current_price, total_candles
        )
        supports = self._clusters_to_levels(
            support_clusters, candles, volume_zscores, 'support', current_price, total_candles
        )

        # 8. Filtrar por min_touches
        resistances = [r for r in resistances if r.touches >= min_touches]
        supports = [s for s in supports if s.touches >= min_touches]

        logger.info(f"[{self.name}] After min_touches filter ({min_touches}): {len(resistances)} R, {len(supports)} S")

        # 9. CLAVE: Filtrar por posicion relativa al precio
        # Resistencias = SOLO arriba del precio actual
        # Soportes = SOLO abajo del precio actual
        resistances = [r for r in resistances if r.price > current_price]
        supports = [s for s in supports if s.price < current_price]

        logger.info(f"[{self.name}] After position filter: {len(resistances)} R (above price), {len(supports)} S (below price)")

        # 10. Clasificar active/broken usando recentHigh/recentLow
        recent_bars = min(recent_bars_for_break, max(10, total_candles // 10))
        recent_candles = candles[-recent_bars:]
        recent_high = max(float(c['high']) for c in recent_candles)
        recent_low = min(float(c['low']) for c in recent_candles)

        # Separar resistencias activas y rotas
        active_resistances = []
        broken_resistances = []
        for r in resistances:
            r.distance_to_price = r.price - current_price
            if recent_high >= r.price:
                r.status = "broken"
                broken_resistances.append(r)
            else:
                r.status = "active"
                active_resistances.append(r)

        # Separar soportes activos y rotos
        active_supports = []
        broken_supports = []
        for s in supports:
            s.distance_to_price = current_price - s.price
            if recent_low <= s.price:
                s.status = "broken"
                broken_supports.append(s)
            else:
                s.status = "active"
                active_supports.append(s)

        # 11. Ordenar por distancia al precio (mas cercanos primero)
        active_resistances.sort(key=lambda x: x.distance_to_price)
        broken_resistances.sort(key=lambda x: x.distance_to_price)
        active_supports.sort(key=lambda x: x.distance_to_price)
        broken_supports.sort(key=lambda x: x.distance_to_price)

        # 12. PRIORIZAR activos sobre broken, limitar cantidad
        # Primero los activos mas cercanos, luego los broken si hay espacio
        final_resistances = active_resistances[:max_levels]
        remaining_slots = max(0, max_levels - len(final_resistances))
        if remaining_slots > 0:
            final_resistances.extend(broken_resistances[:remaining_slots])

        final_supports = active_supports[:max_levels]
        remaining_slots = max(0, max_levels - len(final_supports))
        if remaining_slots > 0:
            final_supports.extend(broken_supports[:remaining_slots])

        logger.info(
            f"[{self.name}] FINAL: {len(final_resistances)} R ({len(active_resistances)} active), "
            f"{len(final_supports)} S ({len(active_supports)} active)"
        )

        return {
            "resistances": [r.to_dict() for r in final_resistances],
            "supports": [s.to_dict() for s in final_supports],
            "currentPrice": current_price,
            "stats": {
                "totalSwingsFound": total_swings_found,
                "swingsInPriceRange": len(swing_highs) + len(swing_lows),
                "resistanceClusters": len(resistance_clusters),
                "supportClusters": len(support_clusters),
                "activeResistances": len(active_resistances),
                "brokenResistances": len(broken_resistances),
                "activeSupports": len(active_supports),
                "brokenSupports": len(broken_supports),
                "finalResistances": len(final_resistances),
                "finalSupports": len(final_supports),
                "recentHigh": recent_high,
                "recentLow": recent_low,
                "priceRangeMin": price_min,
                "priceRangeMax": price_max
            }
        }

    def _detect_swing_highs(self, candles: List[Dict], bars: int) -> List[Dict]:
        """Detecta todos los swing highs (maximos locales)"""
        swings = []

        for i in range(bars, len(candles) - bars):
            current_high = float(candles[i]['high'])
            is_swing = True

            # Verificar lado izquierdo (debe ser ESTRICTAMENTE mayor)
            for j in range(i - bars, i):
                if float(candles[j]['high']) >= current_high:
                    is_swing = False
                    break

            if not is_swing:
                continue

            # Verificar lado derecho (debe ser ESTRICTAMENTE mayor)
            for j in range(i + 1, i + bars + 1):
                if float(candles[j]['high']) >= current_high:
                    is_swing = False
                    break

            if is_swing:
                swings.append({
                    'price': current_high,
                    'timestamp': int(candles[i]['timestamp']),
                    'index': i,
                    'volume': float(candles[i]['volume'])
                })

        return swings

    def _detect_swing_lows(self, candles: List[Dict], bars: int) -> List[Dict]:
        """Detecta todos los swing lows (minimos locales)"""
        swings = []

        for i in range(bars, len(candles) - bars):
            current_low = float(candles[i]['low'])
            is_swing = True

            # Verificar lado izquierdo (debe ser ESTRICTAMENTE menor)
            for j in range(i - bars, i):
                if float(candles[j]['low']) <= current_low:
                    is_swing = False
                    break

            if not is_swing:
                continue

            # Verificar lado derecho (debe ser ESTRICTAMENTE menor)
            for j in range(i + 1, i + bars + 1):
                if float(candles[j]['low']) <= current_low:
                    is_swing = False
                    break

            if is_swing:
                swings.append({
                    'price': current_low,
                    'timestamp': int(candles[i]['timestamp']),
                    'index': i,
                    'volume': float(candles[i]['volume'])
                })

        return swings

    def _calculate_all_volume_zscores(self, candles: List[Dict], lookback: int) -> List[float]:
        """Calcula z-score de volumen para todas las velas"""
        zscores = []
        volumes = [float(c['volume']) for c in candles]

        for i in range(len(candles)):
            if i < lookback:
                zscores.append(0.0)
                continue

            # Volumen de las ultimas N velas (excluyendo la actual)
            lookback_volumes = volumes[i - lookback:i]
            current_volume = volumes[i]

            if len(lookback_volumes) < 2:
                zscores.append(0.0)
                continue

            mean = statistics.mean(lookback_volumes)
            try:
                stdev = statistics.stdev(lookback_volumes)
            except statistics.StatisticsError:
                zscores.append(0.0)
                continue

            if stdev == 0:
                zscores.append(0.0)
            else:
                zscores.append((current_volume - mean) / stdev)

        return zscores

    def _cluster_swings(self, swings: List[Dict], distance_pct: float) -> List[List[Dict]]:
        """Agrupa swings cercanos en precio"""
        if not swings:
            return []

        # Ordenar por precio
        sorted_swings = sorted(swings, key=lambda x: x['price'])

        clusters = []
        current_cluster = [sorted_swings[0]]

        for i in range(1, len(sorted_swings)):
            swing = sorted_swings[i]
            cluster_avg_price = sum(s['price'] for s in current_cluster) / len(current_cluster)

            # Calcular distancia porcentual
            distance = abs(swing['price'] - cluster_avg_price) / cluster_avg_price * 100

            if distance <= distance_pct:
                # Agregar al cluster actual
                current_cluster.append(swing)
            else:
                # Iniciar nuevo cluster
                clusters.append(current_cluster)
                current_cluster = [swing]

        # No olvidar el ultimo cluster
        clusters.append(current_cluster)

        return clusters

    def _clusters_to_levels(
        self,
        clusters: List[List[Dict]],
        candles: List[Dict],
        volume_zscores: List[float],
        level_type: str,
        current_price: float,
        total_candles: int
    ) -> List[SRLevel]:
        """Convierte clusters de swings en niveles S&R con estadisticas"""
        levels = []

        for cluster in clusters:
            if not cluster:
                continue

            # Precio promedio del cluster
            avg_price = sum(s['price'] for s in cluster) / len(cluster)

            # Cantidad de toques
            touches = len(cluster)

            # Timestamps
            first_touch = min(s['timestamp'] for s in cluster)
            last_touch = max(s['timestamp'] for s in cluster)

            # Indice del ultimo toque (para calcular recencia)
            last_index = max(s['index'] for s in cluster)

            # Recencia: 0-1, donde 1 es el mas reciente
            recency = last_index / total_candles if total_candles > 0 else 0

            # Volumen z-score promedio del cluster
            avg_zscore = 0.0
            zscore_count = 0
            for swing in cluster:
                idx = swing['index']
                if 0 <= idx < len(volume_zscores):
                    avg_zscore += volume_zscores[idx]
                    zscore_count += 1

            if zscore_count > 0:
                avg_zscore = avg_zscore / zscore_count

            # Calcular strength (formula del Backtester)
            # Strength: (toques * 2) + (volumeZScore normalizado 0-3) + (recencia * 3)
            volume_bonus = max(0, min(3, avg_zscore))  # 0-3 puntos
            recency_bonus = recency * 3  # 0-3 puntos
            strength = min(10, (touches * 2) + volume_bonus + recency_bonus)

            level = SRLevel(
                price=round(avg_price, 8),  # Precision para cryptos
                level_type=level_type,
                touches=touches,
                strength=round(strength, 2),
                avg_volume_zscore=round(avg_zscore, 2),
                first_touch=first_touch,
                last_touch=last_touch,
                recency=round(recency, 3),
                distance_to_price=0,  # Se calcula despues
                status="active"
            )
            levels.append(level)

        return levels


# Singleton instance
_sr_detector_instance: Optional[SRDetector] = None


def get_sr_detector() -> SRDetector:
    """Get or create the singleton SRDetector instance"""
    global _sr_detector_instance
    if _sr_detector_instance is None:
        _sr_detector_instance = SRDetector()
    return _sr_detector_instance
