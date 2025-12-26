# Double Top/Bottom Indicator - Documentación Técnica

**Versión:** 1.0.1
**Fecha:** 2025-12-25
**Autor:** Claude Code

---

## 🆕 v1.0.1 - Volume Divergence Support

**Cambios técnicos:**

1. **Backend:** Parámetros separados para z-scores en `_find_double_tops` y `_find_double_bottoms`
   - `zScoreThresholdFirst` → Valida volumen en primer extremo
   - `zScoreThresholdSecond` → Valida volumen en segundo extremo
   - Permite detectar divergencia de volumen (señal de reversión)

2. **Frontend:** Dos sliders independientes en la UI
   - "Z-Score Threshold (First Extreme) 🔥" (0.5-3.0, default: 1.5)
   - "Z-Score Threshold (Second Extreme) 📉" (0.0-3.0, default: 0.5)

3. **Defaults actualizados:**
   - `DoubleTopBottomSettings.jsx:33-34`
   - `DoubleTopBottomIndicator.js:62-63`

---

## 📋 Tabla de Contenidos

1. [Arquitectura General](#arquitectura-general)
2. [Flujo de Detección](#flujo-de-detección)
3. [Algoritmos Implementados](#algoritmos-implementados)
4. [API Reference](#api-reference)
5. [Estructuras de Datos](#estructuras-de-datos)
6. [Optimizaciones](#optimizaciones)

---

## 🏗️ Arquitectura General

### Stack Tecnológico

**Backend:**
- Python 3.10+
- FastAPI para endpoints REST
- NumPy/Pandas para cálculos (implícito)

**Frontend:**
- React 18
- Vite (build tool)
- uPlot (charting library)

### Componentes Principales

```
backend/
└── double_topbottom_detector.py
    ├── DoubleTopBottomDetector (clase principal)
    ├── DoublePattern (dataclass)
    └── Funciones auxiliares

frontend/
├── components/
│   ├── indicators/
│   │   ├── DoubleTopBottomIndicator.js (lógica indicador)
│   │   └── IndicatorManager.js (orquestador)
│   ├── DoubleTopBottomSettings.jsx (UI config)
│   ├── MiniChart.jsx (gráfico)
│   └── Watchlist.jsx (root component)
```

---

## 🔄 Flujo de Detección

### 1. Pipeline Completo

```
Usuario configura parámetros
         ↓
Frontend envía POST /api/double-topbottom/detect
         ↓
Backend fetch candles de Bybit API
         ↓
Calcula z-scores de volumen (si enabled)
         ↓
Encuentra local extremes (highs y lows)
         ↓
Filtra extremos por volumen (si enabled)
         ↓
Busca pares de extremos similares (double tops/bottoms)
         ↓
Valida patrones de rechazo (velas)
         ↓
Valida movimiento post-patrón
         ↓
Filtra duplicados
         ↓
Aplica momentum confirmation (si enabled)
         ↓
Filtra por confianza mínima
         ↓
Retorna JSON con patrones
         ↓
Frontend renderiza en gráfico
```

### 2. Flujo Detallado de Detección

#### Paso 1: Búsqueda de Extremos Locales
```python
def _find_local_extremes(candles, window_size, extreme_type, offset):
    """
    Encuentra highs/lows locales usando ventana deslizante

    Args:
        candles: Lista de velas OHLCV
        window_size: Tamaño de ventana (candlesPerExtreme)
        extreme_type: 'high' o 'low'
        offset: Índice global de inicio

    Returns:
        Lista de extremos con {candle_index, timestamp, price, candle}
    """

    # Para cada vela i:
    # - Compara con window_size velas a la izquierda
    # - Compara con window_size velas a la derecha
    # - Si es mayor/menor que todas → es extremo
```

**Ejemplo:**
```
Velas:  [50, 52, 55, 58, 60, 62, 59, 57, 55]
Window: 2

Análisis vela[4] (precio 60):
- Izquierda: [52, 55, 58] → 60 > todos ✓
- Derecha: [62, 59, 57] → 60 < 62 ✗
→ NO es extremo

Análisis vela[5] (precio 62):
- Izquierda: [55, 58, 60] → 62 > todos ✓
- Derecha: [59, 57, 55] → 62 > todos ✓
→ SÍ es extremo (local high)
```

#### Paso 2: Filtrado por Volumen (opcional)
```python
def _filter_extremes_by_volume(extremes, all_candles, config, z_scores):
    """
    Rechaza extremos con volumen bajo

    Solo conserva extremos donde:
    z_score(volumen) >= threshold
    """

    filtered = []
    for extreme in extremes:
        candle_idx = extreme['candle_index']
        volume_zscore = z_scores[candle_idx]

        if volume_zscore >= z_threshold:
            filtered.append(extreme)  # Mantener
        else:
            pass  # Rechazar (volumen bajo)

    return filtered
```

**Cálculo de Z-Score:**
```python
def _calculate_z_scores(candles, period):
    """
    Z-Score = (value - mean) / stdev

    Para cada vela i:
    - Toma ventana de 'period' velas anteriores
    - Calcula mean y stdev del volumen
    - Calcula z-score del volumen actual
    """

    for i in range(len(volumes)):
        window = volumes[i - period + 1 : i + 1]
        mean = sum(window) / period
        stdev = sqrt(variance)

        z_scores[i] = (volumes[i] - mean) / stdev
```

#### Paso 3: Búsqueda de Double Tops
```python
def _find_double_tops(highs, all_candles, config, ...):
    """
    Busca pares de highs similares

    Para cada par (h1, h2):
    1. Verifica distancia temporal (min/max candles between)
    2. Calcula varianza de precio
    3. Permite overshoot si close está dentro del rango
    4. Verifica patrones de rechazo
    5. Verifica volumen significativo
    6. Calcula confianza
    7. Crea patrón si pasa filtros
    """

    patterns = []

    for i in range(len(highs)):
        h1 = highs[i]

        for j in range(i + 1, len(highs)):
            h2 = highs[j]

            # 1. Distancia temporal
            candles_distance = h2['candle_index'] - h1['candle_index']
            if not (min_candles <= candles_distance <= max_candles):
                continue

            # 2. Validación de precio (con overshoot)
            h1_price = h1['price']
            h2_price = h2['price']
            h2_close = h2['candle'].get('close', h2_price)

            # Si h2 sobrepasa significativamente a h1
            if h2_price > h1_price:
                price_diff_extremes = abs(h1_price - h2_price)
                if price_diff_extremes / h1_price > price_margin:
                    # Usar close en lugar de high
                    h2_price = h2_close

            # Calcular varianza final
            price_diff = abs(h1_price - h2_price)
            price_avg = (h1_price + h2_price) / 2
            variance_pct = price_diff / price_avg

            if variance_pct > price_margin:
                continue  # Precios demasiado diferentes

            # 3. Validar patrones de rechazo
            rejection_h1 = _validate_rejection_pattern(
                h1['candle'],
                prev_candles,
                config,
                'bearish'  # Esperamos rechazo bajista en top
            )

            rejection_h2 = _validate_rejection_pattern(
                h2['candle'],
                prev_candles,
                config,
                'bearish'
            )

            # 4. Verificar si requiere ambos rechazos
            require_both = config['filters']['requireBothRejections']
            if require_both and (not rejection_h1['has_pattern'] or
                               not rejection_h2['has_pattern']):
                continue

            # 5. Verificar volumen (si enabled)
            if volume_filter_enabled:
                # Obtener z-scores de ambos extremos
                # Rechazar si alguno no cumple threshold
                pass

            # 6. Calcular confianza
            confidence = _calculate_confidence(
                variance_pct,
                rejection_h1,
                rejection_h2,
                volume_ok_h1,
                volume_ok_h2,
                zscore_h1,
                zscore_h2
            )

            # 7. Crear patrón
            pattern = DoublePattern(
                type="DOUBLE_TOP",
                timestamp=h2['timestamp'],
                confidence=confidence,
                first_extreme={...},
                second_extreme={...},
                level_price=price_avg,
                ...
            )

            patterns.append(pattern)

    return patterns
```

#### Paso 4: Validación Post-Patrón
```python
def _validate_post_pattern_movement(patterns, all_candles, config):
    """
    Valida movimiento direccional después del patrón

    Para double tops:
    - Busca el low más bajo en N velas siguientes
    - Calcula % de caída
    - Si cae >= threshold → +bonus confianza

    Para double bottoms:
    - Busca el high más alto en N velas siguientes
    - Calcula % de subida
    - Si sube >= threshold → +bonus confianza
    """

    apply_to_realtime = config['filters']['applyPostValidationToRealtimeSignals']
    validation_candles = config['filters']['postPatternValidationCandles']
    min_move_percent = config['filters']['minPostPatternMovePercent']
    confidence_bonus = config['filters']['postPatternConfidenceBonus']

    # Encontrar patrón más reciente
    most_recent_timestamp = max(p.second_extreme['timestamp'] for p in patterns)

    for pattern in patterns:
        is_most_recent = (pattern.second_extreme['timestamp'] == most_recent_timestamp)

        # Skip validación para patrón más reciente si modo real-time
        if not apply_to_realtime and is_most_recent:
            continue  # Señal inmediata para trading

        # Obtener velas posteriores al segundo extremo
        second_idx = pattern.second_extreme['candle_index']
        post_candles = all_candles[second_idx + 1 : second_idx + 1 + validation_candles]

        if not post_candles:
            continue

        # Calcular movimiento
        second_price = pattern.second_extreme['price']

        if pattern.type == 'DOUBLE_TOP':
            # Buscar lowest low
            lowest_low = min(c['low'] for c in post_candles)
            price_move_pct = ((second_price - lowest_low) / second_price) * 100

            if price_move_pct >= min_move_percent:
                pattern.confidence += confidence_bonus
                pattern.confidence = min(100.0, pattern.confidence)

        else:  # DOUBLE_BOTTOM
            # Buscar highest high
            highest_high = max(c['high'] for c in post_candles)
            price_move_pct = ((highest_high - second_price) / second_price) * 100

            if price_move_pct >= min_move_percent:
                pattern.confidence += confidence_bonus
                pattern.confidence = min(100.0, pattern.confidence)

    return patterns
```

#### Paso 5: Filtrado de Duplicados
```python
def _filter_duplicate_patterns(patterns, config):
    """
    Elimina patrones redundantes en misma zona

    Algoritmo:
    1. Separar por tipo (double tops vs double bottoms)
    2. Para cada tipo, deduplicar por zona
    3. Combinar resultados
    """

    double_tops = [p for p in patterns if p.type == 'DOUBLE_TOP']
    double_bottoms = [p for p in patterns if p.type == 'DOUBLE_BOTTOM']

    filtered_tops = _deduplicate_by_zone(double_tops, ...)
    filtered_bottoms = _deduplicate_by_zone(double_bottoms, ...)

    return filtered_tops + filtered_bottoms

def _deduplicate_by_zone(patterns, price_tolerance_pct, time_tolerance_hours):
    """
    Deduplicación inteligente

    Ordena por first_extreme timestamp (más temprano primero)
    Para cada patrón:
        Si es similar a uno ya guardado:
            Compara timestamps
            Si es más temprano → reemplaza
            Si mismo timestamp → compara confianza
        Si no es similar:
            Guarda como nuevo
    """

    # Ordenar por primer extremo (más temprano primero)
    sorted_patterns = sorted(patterns, key=lambda p: p.first_extreme['timestamp'])

    kept_patterns = []

    for pattern in sorted_patterns:
        is_duplicate = False

        for kept in kept_patterns:
            # Verificar similitud de precio
            price_diff = abs(pattern.level_price - kept.level_price)
            price_avg = (pattern.level_price + kept.level_price) / 2
            price_diff_pct = (price_diff / price_avg) * 100

            # Verificar similitud de tiempo
            time_diff_ms = abs(pattern.first_extreme['timestamp'] -
                             kept.first_extreme['timestamp'])
            time_diff_hours = time_diff_ms / (1000 * 60 * 60)

            # Son duplicados?
            if (price_diff_pct <= price_tolerance_pct and
                time_diff_hours <= time_tolerance_hours):

                # Priorizar primer extremo más temprano
                if pattern.first_extreme['timestamp'] < kept.first_extreme['timestamp']:
                    kept_patterns.remove(kept)
                    kept_patterns.append(pattern)

                # Si mismo first extreme, priorizar mayor confianza
                elif pattern.first_extreme['timestamp'] == kept.first_extreme['timestamp']:
                    if pattern.confidence > kept.confidence:
                        kept_patterns.remove(kept)
                        kept_patterns.append(pattern)

                is_duplicate = True
                break

        if not is_duplicate:
            kept_patterns.append(pattern)

    return kept_patterns
```

---

## 🧮 Algoritmos Implementados

### 1. Detección de Patrones de Rechazo

#### Hammer (Bullish)
```python
def _validate_rejection_pattern_hammer(candle):
    o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']

    body = abs(c - o)
    lower_shadow = min(o, c) - l
    upper_shadow = h - max(o, c)
    total_range = h - l

    # Condiciones:
    # 1. Sombra inferior >= 1.5× cuerpo
    # 2. Sombra superior <= 0.3× cuerpo
    # 3. Close está en top 50% del rango

    is_hammer = (
        lower_shadow >= 1.5 * body and
        upper_shadow <= 0.3 * body and
        (c - l) / total_range >= 0.5
    )

    if is_hammer:
        quality = min(1.0, (lower_shadow / body) / 3.0)
        return {'has_pattern': True, 'pattern_type': 'HAMMER', 'quality': quality}

    return {'has_pattern': False, 'pattern_type': None, 'quality': 0.0}
```

**Calidad:**
- Sombra 3× cuerpo → quality 1.0
- Sombra 1.5× cuerpo → quality 0.5

#### Shooting Star (Bearish)
```python
def _validate_rejection_pattern_shooting_star(candle):
    # Similar a Hammer pero invertido

    # Condiciones:
    # 1. Sombra superior >= 1.5× cuerpo
    # 2. Sombra inferior <= 0.3× cuerpo
    # 3. Close está en bottom 50% del rango

    is_shooting_star = (
        upper_shadow >= 1.5 * body and
        lower_shadow <= 0.3 * body and
        (h - c) / total_range >= 0.5
    )
```

#### Engulfing (Bullish/Bearish)
```python
def _validate_rejection_pattern_engulfing(candle, prev_candle, direction):
    prev_body_top = max(prev_candle['open'], prev_candle['close'])
    prev_body_bottom = min(prev_candle['open'], prev_candle['close'])
    curr_body_top = max(candle['open'], candle['close'])
    curr_body_bottom = min(candle['open'], candle['close'])

    if direction == 'bullish':
        # Vela anterior bajista, actual alcista
        # Cuerpo actual envuelve completamente al anterior
        is_engulfing = (
            prev_candle['close'] < prev_candle['open'] and  # Anterior bajista
            candle['close'] > candle['open'] and            # Actual alcista
            curr_body_bottom < prev_body_bottom and          # Envuelve abajo
            curr_body_top > prev_body_top                    # Envuelve arriba
        )

    quality = min(1.0, body / total_range * 1.2)
```

### 2. Cálculo de Confianza Multi-Factor

```python
def _calculate_confidence(
    price_variance,     # float: % diferencia de precios
    rejection1,         # dict: {has_pattern, pattern_type, quality}
    rejection2,         # dict: {has_pattern, pattern_type, quality}
    volume_ok1,         # bool: volumen significativo en extremo 1
    volume_ok2,         # bool: volumen significativo en extremo 2
    zscore1,            # float: z-score volumen extremo 1
    zscore2             # float: z-score volumen extremo 2
):
    confidence = 0.0

    # FACTOR 1: Rejection quality at extreme 1 (25 pts)
    if rejection1['has_pattern']:
        confidence += rejection1['quality'] * 25

    # FACTOR 2: Rejection quality at extreme 2 (25 pts)
    if rejection2['has_pattern']:
        confidence += rejection2['quality'] * 25

    # FACTOR 3: Price similarity (20 pts)
    # variance_pct está en rango [0, price_margin]
    # Normalizar a 2% margin como baseline
    price_score = max(0, 1 - (price_variance / 0.02))
    confidence += price_score * 20

    # FACTOR 4: Volume significance (15 pts)
    if volume_ok1 and volume_ok2:
        avg_zscore = (abs(zscore1) + abs(zscore2)) / 2
        volume_score = min(1.0, avg_zscore / 3.0)  # Normalizar a z-score 3
        confidence += volume_score * 15

    # FACTOR 5: Pattern symmetry (15 pts)
    if rejection1['has_pattern'] and rejection2['has_pattern']:
        quality_diff = abs(rejection1['quality'] - rejection2['quality'])
        symmetry_score = 1.0 - quality_diff
        confidence += symmetry_score * 15

    return min(100.0, round(confidence, 2))
```

**Ejemplo de cálculo:**
```
Pattern: DOUBLE_BOTTOM
- Extremo 1: Sin patrón → 0 pts
- Extremo 2: Hammer perfecto (quality 1.0) → 25 pts
- Price variance: 0.0366% → (1 - 0.0366/0.02) × 20 ≈ 16.3 pts
- Volume filter: Disabled → 0 pts
- Symmetry: Solo un patrón → 0 pts

Subtotal: 41.3 pts
Post-validation bonus: +20 pts (confirmó movimiento)
TOTAL: 61.3 pts
```

---

## 🔌 API Reference

### Endpoint Principal

**POST** `/api/double-topbottom/detect`

**Request Body:**
```json
{
  "symbol": "BTCUSDT",
  "interval": "1h",
  "days": 7,
  "config": {
    "doubleTopBottom": {
      "lookbackCandles": 100,
      "candlesPerExtreme": 3,
      "priceMarginPercent": 5.0,
      "minCandlesBetween": 3,
      "maxCandlesBetween": 80,

      "rejectionPatterns": {
        "hammer": true,
        "shootingStar": true,
        "bullishEngulfing": true,
        "bearishEngulfing": true
      },

      "volumeFilter": {
        "enabled": false,
        "zScoreThreshold": 1.5,
        "zScorePeriod": 20
      },

      "requireHighVolumeAtExtremes": {
        "enabled": false,
        "zScoreThresholdFirst": 1.5,   // v1.0.1: Primer extremo (volumen alto)
        "zScoreThresholdSecond": 0.5,  // v1.0.1: Segundo extremo (volumen bajo)
        "zScorePeriod": 20
      }
    },

    "filters": {
      "minConfidence": 20,
      "requireBothRejections": false,
      "minPatternDuration": 1,
      "maxPatternDuration": 168,

      "applyPostValidationToRealtimeSignals": false,
      "postPatternValidationCandles": 5,
      "minPostPatternMovePercent": 0.5,
      "postPatternConfidenceBonus": 20,

      "duplicatePriceTolerancePercent": 2.0,
      "duplicateTimeToleranceHours": 24
    },

    "momentumConfirmation": {
      "enabled": false,
      "lookbackAfterPattern": 10,
      "requireMomentum": false,
      "patterns": {
        "marubozu": {"enabled": true, "minBodyRatio": 0.8},
        "soldiers_crows": {"enabled": true, "minBodyRatio": 0.6},
        "bigBody": {"enabled": true, "minBodyRatio": 0.7, "allowBigWick": true}
      }
    },

    "visualization": {
      "showLines": true,
      "showRejectionIcons": true,
      "showMomentumIcons": true,
      "showEntryArrows": true,
      "extendLineToRight": true,
      "colors": {
        "doubleTopLine": "#FF5722",
        "doubleBottomLine": "#4CAF50",
        "rejectionIcon": "#FFC107",
        "entryLong": "#00E676",
        "entryShort": "#FF1744"
      },
      "lineStyle": {
        "width": 2,
        "dash": [10, 5]
      }
    },

    "debugMode": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1h",
  "totalPatterns": 10,
  "patterns": [
    {
      "type": "DOUBLE_TOP",
      "timestamp": 1766674800000,
      "confidence": 64.63,

      "firstExtreme": {
        "timestamp": 1766282400000,
        "price": 87812.7,
        "candle_index": 47,
        "rejection_pattern": null,
        "pattern_quality": 0.0,
        "volume_zscore": 0.0
      },

      "secondExtreme": {
        "timestamp": 1766368800000,
        "price": 87844.9,
        "candle_index": 71,
        "rejection_pattern": "HAMMER",
        "pattern_quality": 1.0,
        "volume_zscore": 0.0
      },

      "levelPrice": 87828.8,
      "priceVariance": 0.0366,
      "candlesBetweenExtremes": 24,
      "patternDurationHours": 24.0,
      "volumeAverage": 1939.83,
      "meetsVolumeCriteria": true,

      "entrySignal": null
    }
  ]
}
```

---

## 📦 Estructuras de Datos

### DoublePattern (Backend)
```python
@dataclass
class DoublePattern:
    type: str                    # "DOUBLE_TOP" | "DOUBLE_BOTTOM"
    timestamp: int               # Unix timestamp ms (segundo extremo)
    confidence: float            # 0-100

    first_extreme: Dict          # {timestamp, price, candle_index, rejection_pattern, ...}
    second_extreme: Dict         # {timestamp, price, candle_index, rejection_pattern, ...}

    level_price: float           # Precio promedio del nivel
    price_variance: float        # % diferencia entre extremos

    candles_between_extremes: int
    pattern_duration_hours: float

    volume_average: float
    meets_volume_criteria: bool

    entry_signal: Optional[Dict] # Momentum confirmation (Phase 2)
```

### Config Object (Frontend)
```javascript
{
  doubleTopBottom: {
    lookbackCandles: number,
    candlesPerExtreme: number,
    priceMarginPercent: number,
    minCandlesBetween: number,
    maxCandlesBetween: number,

    rejectionPatterns: {
      hammer: boolean,
      shootingStar: boolean,
      bullishEngulfing: boolean,
      bearishEngulfing: boolean
    },

    volumeFilter: {
      enabled: boolean,
      zScoreThreshold: number,
      zScorePeriod: number
    },

    requireHighVolumeAtExtremes: {
      enabled: boolean,
      zScoreThresholdFirst: number,   // v1.0.1: Z-score mínimo en primer extremo
      zScoreThresholdSecond: number,  // v1.0.1: Z-score mínimo en segundo extremo
      zScorePeriod: number
    }
  },

  filters: {
    minConfidence: number,
    requireBothRejections: boolean,
    minPatternDuration: number,
    maxPatternDuration: number,

    applyPostValidationToRealtimeSignals: boolean,
    postPatternValidationCandles: number,
    minPostPatternMovePercent: number,
    postPatternConfidenceBonus: number,

    duplicatePriceTolerancePercent: number,
    duplicateTimeToleranceHours: number
  },

  momentumConfirmation: {...},
  visualization: {...},
  debugMode: boolean
}
```

---

## ⚡ Optimizaciones

### 1. Caching de Z-Scores
Los z-scores de volumen se calculan UNA vez por request y se reutilizan en:
- Volume filter (confidence scoring)
- High-volume extreme filter

```python
# Calcular z-scores solo si algún filtro lo requiere
if volume_filter_enabled or require_high_volume_enabled:
    period = max(z_score_period, require_high_volume_period)
    z_scores = self._calculate_z_scores(candles, period)
```

### 2. Early Exit en Búsqueda de Pares
```python
# Saltar comparaciones innecesarias
for i in range(len(highs)):
    for j in range(i + 1, len(highs)):
        # Verificar distancia temporal PRIMERO (más rápido)
        candles_distance = highs[j]['candle_index'] - highs[i]['candle_index']
        if not (min_candles <= candles_distance <= max_candles):
            continue  # Early exit - no calcular más

        # Luego verificar precio (más costoso)
        # Luego verificar patrones (aún más costoso)
```

### 3. Deduplicación Eficiente
```python
# Ordenar UNA vez al inicio
sorted_patterns = sorted(patterns, key=lambda p: p.first_extreme['timestamp'])

# Luego iterar linealmente (O(n²) en peor caso, O(n) en mejor caso)
```

### 4. Lazy Loading de Configuración
```javascript
// Frontend: Solo cargar config cuando se abre el modal
const [config, setConfig] = useState(null);

useEffect(() => {
  if (isOpen) {
    const saved = localStorage.getItem(`double_topbottom_config_${symbol}`);
    setConfig(saved ? JSON.parse(saved) : getDefaultConfig());
  }
}, [isOpen, symbol]);
```

---

## 🔍 Debugging

### Modo Debug
```javascript
config.debugMode = true
```

**Logs adicionales:**
- Lista completa de patrones detectados
- Detalles de cada extremo encontrado
- Razones de rechazo de patrones
- Valores de confianza intermedios

### Endpoints de Utilidad
```bash
# Ver estado del backend
curl http://localhost:8000/api/status

# Limpiar cache
curl -X POST http://localhost:8000/api/clear-cache
```

---

## 📝 Notas de Implementación

### Timestamps
- Todos los timestamps son Unix milliseconds (UTC)
- Frontend usa timezone Colombia (UTC-5) para display
- Backend trabaja en UTC internamente

### Limitaciones
- Máximo 1000 velas por request de Bybit
- Pagination automática para períodos largos
- Cache de 30 minutos para datos históricos

### Compatibilidad
- Python 3.10+
- React 18
- Navegadores modernos (ES6+)

---

**Última actualización:** 2025-12-25
**Versión:** 1.0.0
