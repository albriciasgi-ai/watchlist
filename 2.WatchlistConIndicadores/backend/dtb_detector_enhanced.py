#!/usr/bin/env python3
"""
Enhanced Double Top/Bottom Detector for Short Timeframes
Optimizado para detectar micro-patrones en timeframes de 1 minuto
"""

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import statistics

@dataclass
class SimplePattern:
    """Patrón simplificado para diagnóstico"""
    type: str  # "DOUBLE_TOP" or "DOUBLE_BOTTOM"
    idx1: int  # Índice del primer extremo
    idx2: int  # Índice del segundo extremo
    price1: float
    price2: float
    price_diff_pct: float  # Diferencia porcentual entre extremos
    candles_between: int
    confidence: float
    timestamp1: int
    timestamp2: int

class EnhancedDTBDetector:
    """Detector mejorado para timeframes cortos"""

    def detect_patterns_enhanced(
        self,
        candles: List[Dict],
        config: Dict = None
    ) -> Tuple[List[SimplePattern], Dict]:
        """
        Detecta patrones DTB con algoritmo optimizado para 1-minuto

        Returns:
            Tuple de (patrones detectados, estadísticas de diagnóstico)
        """
        if not config:
            # Configuración por defecto ultra-permisiva
            config = {
                "price_tolerance_pct": 5.0,  # Tolerancia de precio entre extremos
                "min_candles_between": 2,    # Mínimo de velas entre extremos
                "max_candles_between": 100,  # Máximo de velas entre extremos
                "lookback_for_extreme": 3,   # Velas para considerar un extremo
                "min_confidence": 0,          # Confianza mínima
                "use_adaptive_detection": True  # Detección adaptativa para micro-movimientos
            }

        patterns = []
        stats = {
            "total_candles": len(candles),
            "highs_found": 0,
            "lows_found": 0,
            "double_tops": 0,
            "double_bottoms": 0,
            "filtered_by_price": 0,
            "filtered_by_distance": 0
        }

        if len(candles) < 10:
            return patterns, stats

        # Paso 1: Encontrar extremos locales con método ADAPTATIVO
        highs = self._find_extremes_adaptive(candles, 'high', config)
        lows = self._find_extremes_adaptive(candles, 'low', config)

        stats["highs_found"] = len(highs)
        stats["lows_found"] = len(lows)

        print(f"[ENHANCED] Encontrados {len(highs)} highs y {len(lows)} lows")

        # Paso 2: Buscar Double Tops
        patterns.extend(self._find_double_patterns(
            highs, candles, 'DOUBLE_TOP', config, stats
        ))

        # Paso 3: Buscar Double Bottoms
        patterns.extend(self._find_double_patterns(
            lows, candles, 'DOUBLE_BOTTOM', config, stats
        ))

        stats["double_tops"] = sum(1 for p in patterns if p.type == 'DOUBLE_TOP')
        stats["double_bottoms"] = sum(1 for p in patterns if p.type == 'DOUBLE_BOTTOM')

        return patterns, stats

    def _find_extremes_adaptive(
        self,
        candles: List[Dict],
        extreme_type: str,
        config: Dict
    ) -> List[Dict]:
        """
        Encuentra extremos usando detección adaptativa
        Más permisivo para timeframes cortos
        """
        extremes = []
        price_key = extreme_type  # 'high' or 'low'
        is_high = extreme_type == 'high'

        # Método 1: Extremos simples con ventana pequeña
        window = config.get("lookback_for_extreme", 3)

        # IMPORTANTE: Incluir TODOS los índices, incluso los bordes
        for i in range(len(candles)):
            current_price = float(candles[i][price_key])

            # Para los bordes, ajustar la ventana
            left_start = max(0, i - window)
            left_end = i
            right_start = i + 1
            right_end = min(len(candles), i + window + 1)

            # Verificar si es un extremo local
            is_extreme = True

            # Comparar con velas a la izquierda
            for j in range(left_start, left_end):
                compare_price = float(candles[j][price_key])
                if is_high:
                    if compare_price >= current_price:  # >= en lugar de >
                        is_extreme = False
                        break
                else:
                    if compare_price <= current_price:  # <= en lugar de <
                        is_extreme = False
                        break

            if not is_extreme:
                continue

            # Comparar con velas a la derecha
            for j in range(right_start, right_end):
                if j < len(candles):
                    compare_price = float(candles[j][price_key])
                    if is_high:
                        if compare_price >= current_price:
                            is_extreme = False
                            break
                    else:
                        if compare_price <= current_price:
                            is_extreme = False
                            break

            if is_extreme:
                extremes.append({
                    'index': i,
                    'price': current_price,
                    'timestamp': candles[i].get('timestamp'),
                    'volume': candles[i].get('volume', 0)
                })

        # Método 2: Si la detección adaptativa está habilitada,
        # agregar extremos adicionales basados en cambios de dirección
        if config.get("use_adaptive_detection", True) and len(extremes) < 10:
            # Detectar cambios de dirección significativos
            additional = self._find_directional_extremes(candles, extreme_type)

            # Combinar y eliminar duplicados
            for add_extreme in additional:
                if not any(e['index'] == add_extreme['index'] for e in extremes):
                    extremes.append(add_extreme)

        # Ordenar por índice
        extremes.sort(key=lambda x: x['index'])

        return extremes

    def _find_directional_extremes(
        self,
        candles: List[Dict],
        extreme_type: str
    ) -> List[Dict]:
        """
        Encuentra extremos basados en cambios de dirección
        Útil para micro-movimientos en timeframes cortos
        """
        extremes = []
        price_key = extreme_type
        is_high = extreme_type == 'high'

        if len(candles) < 3:
            return extremes

        for i in range(1, len(candles) - 1):
            prev_price = float(candles[i-1][price_key])
            curr_price = float(candles[i][price_key])
            next_price = float(candles[i+1][price_key])

            # Detectar pico (high) o valle (low)
            if is_high:
                # Es un pico si el precio actual es mayor o igual que sus vecinos
                if curr_price >= prev_price and curr_price >= next_price:
                    extremes.append({
                        'index': i,
                        'price': curr_price,
                        'timestamp': candles[i].get('timestamp'),
                        'volume': candles[i].get('volume', 0)
                    })
            else:
                # Es un valle si el precio actual es menor o igual que sus vecinos
                if curr_price <= prev_price and curr_price <= next_price:
                    extremes.append({
                        'index': i,
                        'price': curr_price,
                        'timestamp': candles[i].get('timestamp'),
                        'volume': candles[i].get('volume', 0)
                    })

        return extremes

    def _find_double_patterns(
        self,
        extremes: List[Dict],
        candles: List[Dict],
        pattern_type: str,
        config: Dict,
        stats: Dict
    ) -> List[SimplePattern]:
        """
        Encuentra patrones dobles a partir de extremos
        """
        patterns = []

        price_tolerance = config.get("price_tolerance_pct", 5.0) / 100
        min_between = config.get("min_candles_between", 2)
        max_between = config.get("max_candles_between", 100)
        min_confidence = config.get("min_confidence", 0)

        # Comparar cada par de extremos
        for i in range(len(extremes)):
            for j in range(i + 1, len(extremes)):
                ext1 = extremes[i]
                ext2 = extremes[j]

                # Verificar distancia entre extremos
                candles_between = ext2['index'] - ext1['index']

                if candles_between < min_between:
                    continue
                if candles_between > max_between:
                    stats["filtered_by_distance"] += 1
                    continue

                # Verificar similitud de precios
                price_diff = abs(ext1['price'] - ext2['price'])
                price_diff_pct = (price_diff / ext1['price']) * 100

                if price_diff_pct > price_tolerance * 100:
                    stats["filtered_by_price"] += 1
                    continue

                # Calcular confianza basada en:
                # 1. Similitud de precios (más similar = mayor confianza)
                # 2. Distancia apropiada (ni muy cerca ni muy lejos)
                # 3. Volumen en los extremos

                price_confidence = max(0, 100 - price_diff_pct * 10)

                distance_confidence = 100
                if candles_between < 5:
                    distance_confidence = 50  # Muy cerca, menor confianza
                elif candles_between > 50:
                    distance_confidence = 70  # Muy lejos, confianza media

                # Confianza final
                confidence = (price_confidence + distance_confidence) / 2

                if confidence >= min_confidence:
                    pattern = SimplePattern(
                        type=pattern_type,
                        idx1=ext1['index'],
                        idx2=ext2['index'],
                        price1=ext1['price'],
                        price2=ext2['price'],
                        price_diff_pct=price_diff_pct,
                        candles_between=candles_between,
                        confidence=confidence,
                        timestamp1=ext1['timestamp'],
                        timestamp2=ext2['timestamp']
                    )
                    patterns.append(pattern)

        return patterns

def test_enhanced_detector():
    """Prueba el detector mejorado"""
    import httpx
    import json
    from datetime import datetime

    API_URL = "http://localhost:8000"
    SYMBOL = "BTCUSDT"
    INTERVAL = "1"
    DAYS = 1

    print("="*80)
    print("PRUEBA DETECTOR DTB MEJORADO")
    print("="*80)
    print(f"Symbol: {SYMBOL}")
    print(f"Interval: {INTERVAL} min")
    print(f"Days: {DAYS}")
    print(f"Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # Obtener datos históricos
    url = f"{API_URL}/api/historical/{SYMBOL}"
    params = {"interval": INTERVAL, "days": DAYS}

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                candles = data.get("data", [])
                print(f"Velas obtenidas: {len(candles)}")
            else:
                print(f"Error obteniendo datos: {response.status_code}")
                return
    except Exception as e:
        print(f"Error: {e}")
        return

    if not candles:
        print("No hay datos disponibles")
        return

    # Probar detector mejorado con diferentes configuraciones
    configs = [
        {
            "name": "Ultra Permisivo",
            "config": {
                "price_tolerance_pct": 10.0,
                "min_candles_between": 1,
                "max_candles_between": 200,
                "lookback_for_extreme": 2,
                "min_confidence": 0,
                "use_adaptive_detection": True
            }
        },
        {
            "name": "Permisivo",
            "config": {
                "price_tolerance_pct": 5.0,
                "min_candles_between": 3,
                "max_candles_between": 100,
                "lookback_for_extreme": 3,
                "min_confidence": 0,
                "use_adaptive_detection": True
            }
        },
        {
            "name": "Micro Patrones",
            "config": {
                "price_tolerance_pct": 3.0,
                "min_candles_between": 2,
                "max_candles_between": 30,
                "lookback_for_extreme": 1,
                "min_confidence": 0,
                "use_adaptive_detection": True
            }
        }
    ]

    detector = EnhancedDTBDetector()
    best_result = None
    best_count = 0

    for cfg in configs:
        print(f"\n{'='*60}")
        print(f"Probando: {cfg['name']}")
        print(f"{'='*60}")

        patterns, stats = detector.detect_patterns_enhanced(candles, cfg['config'])

        print(f"Estadísticas:")
        print(f"  - Total velas: {stats['total_candles']}")
        print(f"  - Highs encontrados: {stats['highs_found']}")
        print(f"  - Lows encontrados: {stats['lows_found']}")
        print(f"  - Double Tops: {stats['double_tops']}")
        print(f"  - Double Bottoms: {stats['double_bottoms']}")
        print(f"  - Total patrones: {len(patterns)}")
        print(f"  - Filtrados por precio: {stats['filtered_by_price']}")
        print(f"  - Filtrados por distancia: {stats['filtered_by_distance']}")

        if len(patterns) > 0:
            confidences = [p.confidence for p in patterns]
            print(f"  - Confianza promedio: {sum(confidences)/len(confidences):.1f}%")

        print(f"\nEficiencia vs objetivo: {len(patterns)*100/17:.1f}% ({len(patterns)}/17)")

        if len(patterns) > best_count:
            best_count = len(patterns)
            best_result = (cfg['name'], patterns, stats)

    # Resumen final
    if best_result:
        name, patterns, stats = best_result
        print(f"\n{'='*80}")
        print(f"MEJOR RESULTADO: {name}")
        print(f"{'='*80}")
        print(f"Patrones detectados: {len(patterns)}")
        print(f"Eficiencia: {len(patterns)*100/17:.1f}%")

        # Mostrar algunos patrones
        if patterns:
            print(f"\nPrimeros 10 patrones detectados:")
            for i, p in enumerate(patterns[:10], 1):
                print(f"  {i}. {p.type}")
                print(f"     - Índices: {p.idx1} -> {p.idx2}")
                print(f"     - Precios: ${p.price1:.2f} -> ${p.price2:.2f}")
                print(f"     - Diferencia: {p.price_diff_pct:.2f}%")
                print(f"     - Velas entre: {p.candles_between}")
                print(f"     - Confianza: {p.confidence:.1f}%")

if __name__ == "__main__":
    test_enhanced_detector()