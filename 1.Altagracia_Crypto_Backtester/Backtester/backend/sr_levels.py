"""
Funciones del Support & Resistance clasico (pivots con volumen), sacadas de main.py sin cambios
para que otro servidor (la suite en tiempo real) las use sin importar main.py.
"""


def calculate_z_score(values: list, period: int = 50):
    """
    Calcula el Z-Score para cada valor en la lista
    Z-Score = (valor - media) / desviación estándar

    Args:
        values: Lista de valores (ej: volúmenes)
        period: Período para calcular media y desviación estándar

    Returns:
        Lista de z-scores
    """
    import statistics

    z_scores = []

    for i in range(len(values)):
        # Tomar ventana de 'period' valores anteriores (incluyendo el actual)
        start_idx = max(0, i - period + 1)
        window = values[start_idx:i + 1]

        if len(window) < 2:
            z_scores.append(0.0)
            continue

        mean = statistics.mean(window)
        stdev = statistics.stdev(window)

        if stdev == 0:
            z_scores.append(0.0)
        else:
            z_score = (values[i] - mean) / stdev
            z_scores.append(z_score)

    return z_scores


def detect_pivots(candles: list, left_bars: int = 15, right_bars: int = 15,
                  z_scores: list = None, z_threshold: float = 1.5):
    """
    Detecta pivots (máximos y mínimos locales) con volumen significativo

    Args:
        candles: Lista de velas con formato {timestamp, open, high, low, close, volume}
        left_bars: Barras a la izquierda que deben ser menores
        right_bars: Barras a la derecha que deben ser menores
        z_scores: Lista de z-scores del volumen (si es None, acepta todos)
        z_threshold: Umbral de z-score para considerar volumen significativo

    Returns:
        Lista de pivots: {type, price, timestamp, volume, z_score, candle_index}
    """
    pivots = []

    # No podemos detectar pivots en los extremos
    for i in range(left_bars, len(candles) - right_bars):
        candle = candles[i]
        high = candle['high']
        low = candle['low']
        volume = candle['volume']

        # Verificar volumen significativo
        if z_scores and z_scores[i] < z_threshold:
            continue

        # Detectar pivot high (resistencia)
        is_pivot_high = True
        for j in range(i - left_bars, i):
            if candles[j]['high'] >= high:
                is_pivot_high = False
                break

        if is_pivot_high:
            for j in range(i + 1, i + right_bars + 1):
                if candles[j]['high'] >= high:
                    is_pivot_high = False
                    break

        if is_pivot_high:
            pivots.append({
                'type': 'resistance',
                'price': high,
                'timestamp': candle['timestamp'],
                'volume': volume,
                'z_score': z_scores[i] if z_scores else 0.0,
                'candle_index': i
            })

        # Detectar pivot low (soporte)
        is_pivot_low = True
        for j in range(i - left_bars, i):
            if candles[j]['low'] <= low:
                is_pivot_low = False
                break

        if is_pivot_low:
            for j in range(i + 1, i + right_bars + 1):
                if candles[j]['low'] <= low:
                    is_pivot_low = False
                    break

        if is_pivot_low:
            pivots.append({
                'type': 'support',
                'price': low,
                'timestamp': candle['timestamp'],
                'volume': volume,
                'z_score': z_scores[i] if z_scores else 0.0,
                'candle_index': i
            })

    return pivots


def cluster_levels(pivots: list, distance_pct: float = 0.5):
    """
    Agrupa pivots que están cercanos entre sí (clustering)

    Args:
        pivots: Lista de pivots detectados
        distance_pct: Distancia máxima en % para considerar niveles como iguales

    Returns:
        Lista de niveles agrupados con sus touches
    """
    if not pivots:
        return []

    # Separar soportes y resistencias
    supports = [p for p in pivots if p['type'] == 'support']
    resistances = [p for p in pivots if p['type'] == 'resistance']

    def cluster_group(group):
        if not group:
            return []

        # Ordenar por precio
        sorted_group = sorted(group, key=lambda x: x['price'])

        clusters = []
        current_cluster = [sorted_group[0]]

        for i in range(1, len(sorted_group)):
            pivot = sorted_group[i]
            cluster_avg_price = sum(p['price'] for p in current_cluster) / len(current_cluster)

            # Calcular distancia porcentual
            distance = abs(pivot['price'] - cluster_avg_price) / cluster_avg_price * 100

            if distance <= distance_pct:
                # Agregar a cluster actual
                current_cluster.append(pivot)
            else:
                # Crear nuevo cluster
                clusters.append(current_cluster)
                current_cluster = [pivot]

        # Agregar último cluster
        clusters.append(current_cluster)

        return clusters

    support_clusters = cluster_group(supports)
    resistance_clusters = cluster_group(resistances)

    # Convertir clusters a niveles con metadata
    levels = []

    for cluster in support_clusters:
        avg_price = sum(p['price'] for p in cluster) / len(cluster)
        avg_volume = sum(p['volume'] for p in cluster) / len(cluster)
        avg_z_score = sum(p['z_score'] for p in cluster) / len(cluster)

        levels.append({
            'type': 'support',
            'price': avg_price,
            'touches': len(cluster),
            'touch_timestamps': [p['timestamp'] for p in cluster],
            'first_touch': min(p['timestamp'] for p in cluster),
            'last_touch': max(p['timestamp'] for p in cluster),
            'avg_volume': avg_volume,
            'avg_z_score': avg_z_score,
            'pivots': cluster
        })

    for cluster in resistance_clusters:
        avg_price = sum(p['price'] for p in cluster) / len(cluster)
        avg_volume = sum(p['volume'] for p in cluster) / len(cluster)
        avg_z_score = sum(p['z_score'] for p in cluster) / len(cluster)

        levels.append({
            'type': 'resistance',
            'price': avg_price,
            'touches': len(cluster),
            'touch_timestamps': [p['timestamp'] for p in cluster],
            'first_touch': min(p['timestamp'] for p in cluster),
            'last_touch': max(p['timestamp'] for p in cluster),
            'avg_volume': avg_volume,
            'avg_z_score': avg_z_score,
            'pivots': cluster
        })

    return levels


def calculate_level_strength(level: dict, current_time_ms: int):
    """
    Calcula la fuerza de un nivel S/R

    Fórmula: Strength = (touches × avg_z_score × recency_factor) / time_spread

    Args:
        level: Diccionario con información del nivel
        current_time_ms: Timestamp actual en millisegundos

    Returns:
        Score de fuerza (0-10)
    """
    touches = level['touches']
    avg_z_score = level['avg_z_score']
    first_touch = level['first_touch']
    last_touch = level['last_touch']

    # Factor de recencia (más reciente = mejor)
    time_since_last_touch_days = (current_time_ms - last_touch) / (1000 * 60 * 60 * 24)
    recency_factor = max(0.1, 1.0 - (time_since_last_touch_days / 30))  # Decay over 30 days

    # Spread temporal (cuánto tiempo ha sido válido el nivel)
    time_spread_days = max(1, (last_touch - first_touch) / (1000 * 60 * 60 * 24))

    # Calcular strength raw
    strength_raw = (touches * avg_z_score * recency_factor) / max(1, time_spread_days)

    # Normalizar a escala 0-10
    # Asumimos que un strength_raw de 5+ es excelente
    strength = min(10.0, (strength_raw / 5.0) * 10.0)

    return round(strength, 2)


def detect_consolidation_zones(levels: list, min_levels: int = 3, max_distance_pct: float = 2.0):
    """
    Detecta zonas de consolidación (múltiples niveles S/R cercanos)

    Args:
        levels: Lista de niveles S/R
        min_levels: Mínimo de niveles para considerar una zona
        max_distance_pct: Distancia máxima en % entre el nivel más alto y más bajo

    Returns:
        Lista de zonas de consolidación
    """
    if len(levels) < min_levels:
        return []

    # Ordenar niveles por precio
    sorted_levels = sorted(levels, key=lambda x: x['price'])

    zones = []

    # Ventana deslizante para encontrar grupos de niveles cercanos
    for i in range(len(sorted_levels) - min_levels + 1):
        for j in range(i + min_levels - 1, len(sorted_levels)):
            window_levels = sorted_levels[i:j + 1]

            if len(window_levels) < min_levels:
                continue

            min_price = min(l['price'] for l in window_levels)
            max_price = max(l['price'] for l in window_levels)

            distance_pct = ((max_price - min_price) / min_price) * 100

            if distance_pct <= max_distance_pct:
                # Zona de consolidación encontrada
                avg_price = (min_price + max_price) / 2
                total_touches = sum(l['touches'] for l in window_levels)
                avg_strength = sum(l.get('strength', 0) for l in window_levels) / len(window_levels)

                zones.append({
                    'center_price': avg_price,
                    'min_price': min_price,
                    'max_price': max_price,
                    'range_pct': distance_pct,
                    'num_levels': len(window_levels),
                    'total_touches': total_touches,
                    'avg_strength': round(avg_strength, 2),
                    'levels': window_levels
                })

    # Eliminar zonas duplicadas/superpuestas (quedarse con las más fuertes)
    unique_zones = []
    for zone in sorted(zones, key=lambda x: x['avg_strength'], reverse=True):
        is_duplicate = False
        for existing_zone in unique_zones:
            # Verificar si hay superposición significativa
            if (zone['min_price'] <= existing_zone['max_price'] and
                zone['max_price'] >= existing_zone['min_price']):
                is_duplicate = True
                break

        if not is_duplicate:
            unique_zones.append(zone)

    return sorted(unique_zones, key=lambda x: x['center_price'])


def determine_level_status(level: dict, current_price: float, candles: list):
    """
    Determina el estado actual del nivel (active, broken, tested)

    Args:
        level: Nivel S/R
        current_price: Precio actual
        candles: Velas históricas para verificar si fue roto

    Returns:
        Estado: "active", "broken", "tested"
        break_volume: Z-score del volumen cuando fue roto (si aplica)
    """
    level_price = level['price']
    level_type = level['type']
    last_touch = level['last_touch']

    # Buscar si el nivel fue roto después del último touch
    break_volume = None
    was_broken = False

    for candle in candles:
        if candle['timestamp'] <= last_touch:
            continue

        # Verificar ruptura
        if level_type == 'resistance' and candle['close'] > level_price:
            was_broken = True
            break
        elif level_type == 'support' and candle['close'] < level_price:
            was_broken = True
            break

    # Determinar estado actual
    if was_broken:
        status = 'broken'
    elif level_type == 'resistance' and current_price < level_price:
        status = 'active'
    elif level_type == 'support' and current_price > level_price:
        status = 'active'
    else:
        status = 'tested'

    return status, break_volume
