# Documentación Técnica: Sistema de Detección de Patrones

## Índice

1. [Arquitectura General](#arquitectura-general)
2. [Flujo de Datos](#flujo-de-datos)
3. [Backend: Pattern Detector](#backend-pattern-detector)
4. [Frontend: Indicator & UI](#frontend-indicator--ui)
5. [Estructura de Datos](#estructura-de-datos)
6. [Cambios Implementados](#cambios-implementados)

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐      ┌──────────────────────────┐   │
│  │   Watchlist.jsx  │─────▶│ ContinuationPattern      │   │
│  │                  │      │ Settings.jsx             │   │
│  │  - Timeframe     │      │                          │   │
│  │  - Symbol list   │      │  - Parameter controls    │   │
│  │  - Config state  │      │  - Individual toggles    │   │
│  └──────────────────┘      │  - Proximity inversion   │   │
│           │                 └──────────────────────────┘   │
│           │                               │                 │
│           ▼                               │                 │
│  ┌──────────────────┐                    │                 │
│  │  MiniChart.jsx   │◀───────────────────┘                 │
│  │                  │                                       │
│  │  - Chart canvas  │                                       │
│  │  - Indicators    │                                       │
│  └──────────────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────┐       │
│  │  ContinuationPatternIndicator.js                │       │
│  │                                                  │       │
│  │  - fetchData() → API call                       │       │
│  │  - renderOverlay() → Draw patterns on canvas    │       │
│  │  - Filter by type, confidence, individual       │       │
│  └─────────────────────────────────────────────────┘       │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTP POST
                            │ /api/continuation-patterns/detect
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         BACKEND                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────┐       │
│  │  main.py                                        │       │
│  │                                                  │       │
│  │  POST /api/continuation-patterns/detect         │       │
│  │    - Receives: candles, config, levels          │       │
│  │    - Returns: detected patterns with confidence │       │
│  └─────────────────────────────────────────────────┘       │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────┐       │
│  │  pattern_detector_extended.py                   │       │
│  │                                                  │       │
│  │  PatternDetectorExtended.detect_patterns()      │       │
│  │    │                                             │       │
│  │    ├─▶ _detect_continuation_pattern()           │       │
│  │    ├─▶ _detect_breakout_pattern()               │       │
│  │    ├─▶ _detect_momentum_pattern()               │       │
│  │    └─▶ _detect_reversal_pattern()               │       │
│  │                                                  │       │
│  │  Each applies:                                  │       │
│  │    - Parameter validation                       │       │
│  │    - Pattern detection logic                    │       │
│  │    - Confidence calculation                     │       │
│  │    - Proximity inversion (if enabled)           │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Flujo de Datos

### 1. Configuración Inicial

```javascript
// Watchlist.jsx - Estado inicial
const defaultContinuationConfig = {
  // Visibility filters
  showContinuation: true,
  showTrendStart: false,
  showMomentum: false,
  showReversal: true,

  // General settings
  minConfidence: 30,
  showLabels: true,
  showConfidence: true,
  iconSize: 9,

  // Pattern parameters
  patternParams: {
    reversal: {
      minWickRatio: 1.5,
      maxOppositeWick: 0.25,
      minBodyPosition: 0.5,
      engulfingTolerance: 0.02,
      invertProximity: false
    },
    continuation: {
      maxConsolidationRange: 0.03,
      minBreakoutSize: 0.01,
      minTrendStrength: 60,
      invertProximity: false
    },
    trendStart: {
      minBreakoutSize: 0.02,
      invertProximity: false
    },
    momentum: {
      minBodyPercent: 0.3,
      minConsecutive: 3,
      invertProximity: false
    }
  },

  // Individual pattern enables
  patternEnables: {
    // All default to true
    hammer: true,
    shooting_star: true,
    // ... etc
  },

  // Level sources
  includeVWAP: true,
  includeFibonacci: false,
  vwapConfig: { /* ... */ },
  fibonacciConfig: { /* ... */ }
};
```

### 2. Petición al Backend

```javascript
// ContinuationPatternIndicator.js - fetchData()
async fetchData(candles, timeframe) {
  const response = await fetch(
    `${API_BASE_URL}/api/continuation-patterns/detect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candles: candles,

        // Level sources (if enabled)
        vwap_levels: this.includeVWAP ? vwapLevels : null,
        fibonacci_levels: this.includeFibonacci ? fibLevels : null,

        // Pattern parameters
        pattern_params: this.patternParams
      })
    }
  );

  const data = await response.json();
  this.patterns = data.patterns; // Store detected patterns
}
```

### 3. Detección en Backend

```python
# backend/main.py
@app.post("/api/continuation-patterns/detect")
async def detect_continuation_patterns(request: Request):
    data = await request.json()

    candles = data.get('candles', [])
    vwap_levels = data.get('vwap_levels')
    fibonacci_levels = data.get('fibonacci_levels')
    pattern_params = data.get('pattern_params', {})

    # Initialize detector
    detector = PatternDetectorExtended()

    # Detect patterns with parameters
    patterns = detector.detect_patterns(
        candles=candles,
        vwap_levels=vwap_levels,
        fibonacci_levels=fibonacci_levels,
        pattern_params=pattern_params
    )

    return {
        "patterns": [asdict(p) for p in patterns]
    }
```

### 4. Renderizado en Frontend

```javascript
// ContinuationPatternIndicator.js - renderOverlay()
renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
  // Filter patterns
  const filteredPatterns = this.patterns.filter(pattern => {
    // Confidence filter
    if (pattern.confidence < this.minConfidence) return false;

    // Type filter
    if (pattern.pattern_type === 'continuation' && !this.showContinuation) return false;
    if (pattern.pattern_type === 'trend_start' && !this.showTrendStart) return false;
    if (pattern.pattern_type === 'momentum' && !this.showMomentum) return false;
    if (pattern.pattern_type === 'reversal' && !this.showReversal) return false;

    // Individual pattern filter
    if (this.patternEnables && this.patternEnables[pattern.pattern_name] === false) {
      return false;
    }

    return true;
  });

  // Draw each pattern
  filteredPatterns.forEach(pattern => {
    const emoji = this.getPatternEmoji(pattern.pattern_name);
    const color = this.getPatternColor(pattern.pattern_type, pattern.direction);

    // Draw emoji at candle position
    ctx.fillText(emoji, x, y);

    // Draw label if enabled
    if (this.showLabels) {
      ctx.fillText(pattern.pattern_name, x, y + offset);
    }

    // Draw confidence if enabled
    if (this.showConfidence) {
      ctx.fillText(`${pattern.confidence.toFixed(0)}%`, x, y + offset2);
    }
  });
}
```

---

## Backend: Pattern Detector

### Clase Principal: `PatternDetectorExtended`

```python
class PatternDetectorExtended:
    """
    Extended pattern detector for all pattern types
    """

    def __init__(self):
        # Default parameters (can be overridden)
        self.min_body_percent = 0.3
        self.min_volume_ratio = 1.2
        self.lookback_volume = 20
        self.trend_lookback = 100
        self.strong_trend_threshold = 60

    def detect_patterns(
        self,
        candles: List[Dict],
        trend_analysis: Optional[Dict] = None,
        vwap_levels: Optional[List[Dict]] = None,
        fibonacci_levels: Optional[List[Dict]] = None,
        volume_profile_levels: Optional[List[Dict]] = None,
        pattern_params: Optional[Dict] = None
    ) -> List[DetectedPattern]:
        """
        Main detection method

        Returns list of DetectedPattern objects with:
          - timestamp, pattern_type, pattern_name, direction
          - confidence (0-100)
          - body_size, wick_size, volume_ratio
          - in_trend, trend_direction, trend_strength
          - near_level, level_distance, level_type
          - pattern_quality, volume_score, level_proximity
        """
```

### Métodos de Detección

#### 1. Continuation Patterns

```python
def _detect_continuation_pattern(
    self,
    candles: List[Dict],
    index: int,
    trend_analysis: Optional[Dict],
    avg_volume: float,
    levels: List[Dict],
    continuation_params: Optional[Dict] = None
) -> Optional[DetectedPattern]:
    """
    Detect flags and pennants

    Requirements:
      - Strong trend (strength >= 60)
      - Consolidation within maxConsolidationRange
      - Breakout >= minBreakoutSize
      - Breakout direction matches trend

    Returns pattern with confidence:
      confidence = (pattern_quality × 0.4) + (volume_score × 0.3) + (level_proximity × 0.3)

    If invertProximity=True:
      level_proximity = 100 - level_proximity
    """
    if continuation_params is None:
        continuation_params = {}

    # Extract parameters
    max_consolidation_range = continuation_params.get('maxConsolidationRange', 0.03)
    min_breakout_size = continuation_params.get('minBreakoutSize', 0.01)
    min_trend_strength = continuation_params.get('minTrendStrength', 60)
    invert_proximity = continuation_params.get('invertProximity', False)

    # Check trend strength
    if not trend_analysis or trend_analysis.get('strength', 0) < min_trend_strength:
        return None

    # ... detection logic ...

    # Apply proximity inversion
    if invert_proximity:
        level_proximity = 100 - level_proximity

    # Calculate confidence
    confidence = (pattern_quality * 0.4) + (volume_score * 0.3) + (level_proximity * 0.3)

    return DetectedPattern(...)
```

#### 2. Trend Start Patterns (Breakouts)

```python
def _detect_breakout_pattern(
    self,
    candles: List[Dict],
    index: int,
    trend_analysis: Optional[Dict],
    avg_volume: float,
    levels: List[Dict],
    trendStart_params: Optional[Dict] = None
) -> Optional[DetectedPattern]:
    """
    Detect breakouts from ranges

    Requirements:
      - NOT in strong trend
      - Range consolidation (< 5% range)
      - Breakout >= minBreakoutSize
      - Volume >= min_volume_ratio

    Returns pattern with confidence:
      confidence = (pattern_quality × 0.5) + (volume_score × 0.4) + (level_proximity × 0.1)

    Note: Volume is MORE important than levels for breakouts
    """
```

#### 3. Momentum Patterns

```python
def _detect_momentum_pattern(
    self,
    candles: List[Dict],
    index: int,
    trend_analysis: Optional[Dict],
    avg_volume: float,
    levels: List[Dict],
    momentum_params: Optional[Dict] = None
) -> Optional[DetectedPattern]:
    """
    Detect momentum patterns

    Delegates to:
      - _detect_three_soldiers_crows()
      - _detect_marubozu()
    """

def _detect_three_soldiers_crows(
    self,
    candles: List[Dict],
    index: int,
    trend_analysis: Optional[Dict],
    avg_volume: float,
    levels: List[Dict],
    momentum_params: Optional[Dict] = None
) -> Optional[DetectedPattern]:
    """
    Three consecutive candles in same direction

    Requirements:
      - minConsecutive consecutive candles (default 3)
      - Each candle body >= minBodyPercent (default 0.3)
      - Consecutive closes higher/lower

    Returns pattern with confidence:
      confidence = (pattern_quality × 0.6) + (volume_score × 0.3) + (level_proximity × 0.1)

    Note: Pattern quality is MOST important for momentum
    """

def _detect_marubozu(
    self,
    candles: List[Dict],
    index: int,
    trend_analysis: Optional[Dict],
    avg_volume: float,
    levels: List[Dict],
    momentum_params: Optional[Dict] = None
) -> Optional[DetectedPattern]:
    """
    Very strong candle with minimal wicks

    Requirements:
      - Body >= 90% of total range

    Returns pattern with confidence:
      confidence = (pattern_quality × 0.5) + (volume_score × 0.3) + (level_proximity × 0.2)
    """
```

#### 4. Reversal Patterns

```python
def _detect_reversal_pattern(
    self,
    candles: List[Dict],
    index: int,
    trend_analysis: Optional[Dict],
    avg_volume: float,
    levels: List[Dict],
    reversal_params: Optional[Dict]
) -> Optional[DetectedPattern]:
    """
    Detect reversal patterns

    Delegates to:
      - _detect_hammer_shooting_star()
      - _detect_engulfing()
      - _detect_doji()

    Uses reversal_params:
      - minWickRatio
      - maxOppositeWick
      - minBodyPosition
      - engulfingTolerance
      - invertProximity

    Returns pattern with confidence:
      confidence = (pattern_quality × 0.3) + (volume_score × 0.2) + (level_proximity × 0.5)

    Note: Level proximity is MOST important for reversals (50%)
    """
```

### Métodos Auxiliares

```python
def _check_level_proximity(
    self,
    price: float,
    levels: List[Dict],
    threshold: float = 0.01
) -> Tuple[bool, Optional[float], Optional[str]]:
    """
    Check if price is near any level

    Returns:
      - near_level: bool
      - distance: float (% distance to nearest level)
      - level_type: str ('vwap', 'fibonacci', etc.)
    """

def _calculate_level_proximity_score(
    self,
    distance: Optional[float]
) -> float:
    """
    Convert distance to score (0-100)

    0% distance → 100 score
    1% distance → ~50 score
    >2% distance → ~0 score
    """

def _combine_levels(
    self,
    vwap_levels: Optional[List[Dict]],
    fibonacci_levels: Optional[List[Dict]],
    volume_profile_levels: Optional[List[Dict]]
) -> List[Dict]:
    """
    Combine all level sources into single list
    """
```

---

## Frontend: Indicator & UI

### Clase Principal: `ContinuationPatternIndicator`

```javascript
class ContinuationPatternIndicator extends IndicatorBase {
  constructor(manager, symbol, config = {}) {
    super(manager, symbol);

    this.enabled = config.enabled ?? true;

    // Type visibility
    this.showContinuation = config.showContinuation ?? true;
    this.showTrendStart = config.showTrendStart ?? false;
    this.showMomentum = config.showMomentum ?? false;
    this.showReversal = config.showReversal ?? true;

    // General settings
    this.minConfidence = config.minConfidence ?? 30;
    this.showLabels = config.showLabels ?? true;
    this.showConfidence = config.showConfidence ?? true;
    this.iconSize = config.iconSize ?? 9;

    // Pattern parameters (sent to backend)
    this.patternParams = config.patternParams || {
      reversal: {
        minWickRatio: 1.5,
        maxOppositeWick: 0.25,
        minBodyPosition: 0.5,
        engulfingTolerance: 0.02,
        invertProximity: false
      },
      continuation: {
        maxConsolidationRange: 0.03,
        minBreakoutSize: 0.01,
        minTrendStrength: 60,
        invertProximity: false
      },
      trendStart: {
        minBreakoutSize: 0.02,
        invertProximity: false
      },
      momentum: {
        minBodyPercent: 0.3,
        minConsecutive: 3,
        invertProximity: false
      }
    };

    // Individual pattern enables
    this.patternEnables = config.patternEnables || {
      hammer: true,
      shooting_star: true,
      bull_engulfing: true,
      bear_engulfing: true,
      dragonfly_doji: true,
      gravestone_doji: true,
      bull_flag: true,
      bear_flag: true,
      bull_pennant: true,
      bear_pennant: true,
      bull_breakout: true,
      bear_breakout: true,
      three_white_soldiers: true,
      three_black_crows: true,
      bull_marubozu: true,
      bear_marubozu: true
    };

    // Level sources
    this.includeVWAP = config.includeVWAP ?? true;
    this.includeFibonacci = config.includeFibonacci ?? false;
    this.vwapConfig = config.vwapConfig || { /* ... */ };
    this.fibonacciConfig = config.fibonacciConfig || { /* ... */ };

    // Data storage
    this.patterns = [];
    this.trendAnalysis = null;
  }

  async fetchData(candles, timeframe) {
    // Fetch VWAP levels if enabled
    // Fetch Fibonacci levels if enabled
    // POST to /api/continuation-patterns/detect
    // Store results in this.patterns
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    // Filter patterns
    // Draw emojis on canvas
    // Draw labels if enabled
    // Draw confidence if enabled
  }

  getPatternEmoji(patternName) {
    const emojiMap = {
      'hammer': '🔨',
      'shooting_star': '⭐',
      'bull_engulfing': '📈',
      'bear_engulfing': '📉',
      'dragonfly_doji': '🐉',
      'gravestone_doji': '🪦',
      'bull_flag': '🟢',
      'bear_flag': '🔴',
      'bull_pennant': '📐',
      'bear_pennant': '📐',
      'bull_breakout': '⬆️',
      'bear_breakout': '⬇️',
      'three_white_soldiers': '⚪⚪⚪',
      'three_black_crows': '⚫⚫⚫',
      'bull_marubozu': '🟩',
      'bear_marubozu': '🟥'
    };
    return emojiMap[patternName] || '❓';
  }
}
```

### Componente de Configuración: `ContinuationPatternSettings`

```javascript
const ContinuationPatternSettings = ({ config, onConfigChange, currentSymbol }) => {
  // Local state for immediate UI updates
  const [localConfig, setLocalConfig] = useState(config);

  // Expandable sections state
  const [showReversalParams, setShowReversalParams] = useState(false);
  const [showContinuationParams, setShowContinuationParams] = useState(false);
  const [showTrendStartParams, setShowTrendStartParams] = useState(false);
  const [showMomentumParams, setShowMomentumParams] = useState(false);
  const [showPatternEnables, setShowPatternEnables] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Handler functions for each parameter type
  const handleConfigChange = (key, value) => { /* ... */ };
  const handleReversalParamChange = (key, value) => { /* ... */ };
  const handleContinuationParamChange = (key, value) => { /* ... */ };
  const handleTrendStartParamChange = (key, value) => { /* ... */ };
  const handleMomentumParamChange = (key, value) => { /* ... */ };
  const handlePatternEnableChange = (patternName, enabled) => { /* ... */ };

  return (
    <div className="continuation-pattern-settings">
      {/* Type Filters */}
      {/* Confidence Filter */}
      {/* Visual Settings */}

      {/* Reversal Parameters Section */}
      <button onClick={() => setShowReversalParams(!showReversalParams)}>
        ▶ Parámetros de Reversal Patterns
      </button>
      {showReversalParams && (
        <div>
          {/* minWickRatio */}
          {/* maxOppositeWick */}
          {/* minBodyPosition */}
          {/* engulfingTolerance */}
          {/* invertProximity */}
        </div>
      )}

      {/* Similar sections for Continuation, Trend Start, Momentum */}

      {/* Individual Pattern Toggles Section */}
      <button onClick={() => setShowPatternEnables(!showPatternEnables)}>
        ▶ Activar/Desactivar Patrones Individuales
      </button>
      {showPatternEnables && (
        <div>
          {/* Checkboxes for each pattern */}
        </div>
      )}

      {/* Level Sources Section */}
    </div>
  );
};
```

---

## Estructura de Datos

### DetectedPattern (Backend)

```python
@dataclass
class DetectedPattern:
    """Detected pattern with full context"""

    # Basic info
    timestamp: int                    # Unix timestamp
    pattern_type: str                 # 'reversal', 'continuation', 'trend_start', 'momentum'
    pattern_name: str                 # 'hammer', 'bull_flag', etc.
    direction: str                    # 'bullish' or 'bearish'
    confidence: float                 # 0-100

    # Pattern metrics
    body_size: float                  # Body size as % of price
    wick_size: float                  # Wick size as % of price
    volume_ratio: float               # Volume / avg_volume

    # Context
    in_trend: bool                    # Is price in a trend?
    trend_direction: Optional[str]    # 'uptrend', 'downtrend', 'sideways'
    trend_strength: float             # 0-100
    near_level: bool                  # Is price near VWAP/Fibonacci?
    level_distance: Optional[float]   # % distance to nearest level
    level_type: Optional[str]         # 'vwap', 'fibonacci', etc.

    # Scoring components
    pattern_quality: float            # 0-100 (pattern shape quality)
    volume_score: float               # 0-100 (volume strength)
    level_proximity: float            # 0-100 (proximity to levels)

    # Metadata
    candle_index: int                 # Index in candles array
    price: float                      # Close price
```

### Pattern Parameters (Frontend → Backend)

```javascript
{
  reversal: {
    minWickRatio: 1.5,              // float
    maxOppositeWick: 0.25,          // float
    minBodyPosition: 0.5,           // float
    engulfingTolerance: 0.02,       // float
    invertProximity: false          // boolean
  },
  continuation: {
    maxConsolidationRange: 0.03,    // float
    minBreakoutSize: 0.01,          // float
    minTrendStrength: 60,           // int
    invertProximity: false          // boolean
  },
  trendStart: {
    minBreakoutSize: 0.02,          // float
    invertProximity: false          // boolean
  },
  momentum: {
    minBodyPercent: 0.3,            // float
    minConsecutive: 3,              // int
    invertProximity: false          // boolean
  }
}
```

---

## Cambios Implementados

### Sesión del 11-12 de Diciembre 2024

#### 1. Expansión del Modal UI
**Archivos modificados**: `ContinuationPatternSettings.jsx`

**Cambios**:
- Añadidas 3 nuevas secciones expandibles:
  - ▶ Parámetros de Continuation Patterns
  - ▶ Parámetros de Trend Start Patterns
  - ▶ Parámetros de Momentum Patterns
- Añadida sección "Activar/Desactivar Patrones Individuales"
- Cada sección incluye:
  - Controles de parámetros específicos
  - Tooltips explicativos
  - Displays en tiempo real de valores
  - Toggle de invertir proximidad

**Líneas clave**:
- Líneas 12-15: Estados para secciones expandibles
- Líneas 59-107: Handlers para cada tipo de patrón
- Líneas 311-489: Secciones de parámetros (Continuation, Trend Start, Momentum)
- Líneas 491-691: Sección de toggles individuales

#### 2. Backend: Soporte para invertProximity en Todos los Patrones
**Archivos modificados**: `pattern_detector_extended.py`

**Cambios**:
- Añadido parámetro `trendStart_params` (línea 140)
- Logs de debug para cada tipo de patrón (líneas 143-151)
- Pasaje de parámetros a funciones de detección (líneas 168-186)
- Implementación de `invertProximity` en:
  - Continuation patterns (línea 300-301)
  - Trend Start patterns (línea 402-403)
  - Momentum patterns - Soldiers/Crows (línea 550-551)
  - Momentum patterns - Marubozu (línea 646-647)

**Lógica de inversión**:
```python
if continuation_params.get('invertProximity', False):
    level_proximity = 100 - level_proximity
```

#### 3. Frontend: Filtrado Individual de Patrones
**Archivos modificados**: `ContinuationPatternIndicator.js`

**Cambios**:
- Añadida estructura `patternEnables` (línea 20-37)
- Filtro adicional en `renderOverlay()` (línea 318):
```javascript
if (this.patternEnables && this.patternEnables[pattern.pattern_name] === false) {
  return false;
}
```

---

## Testing & Debugging

### Debug Logs en Backend

```python
# Al inicio de detect_patterns()
if reversal_params.get('invertProximity', False):
    print(f"[PATTERN DETECTION] Reversal proximity logic INVERTED: far from levels = high confidence")
if continuation_params.get('invertProximity', False):
    print(f"[PATTERN DETECTION] Continuation proximity logic INVERTED: far from levels = high confidence")
# ... etc
```

### Debug Logs en Frontend

```javascript
// En fetchData() después de recibir patrones
console.log(`[${this.symbol}] 📊 Detected patterns:`, {
  total: this.patterns.length,
  by_type: {
    reversal: this.patterns.filter(p => p.pattern_type === 'reversal').length,
    continuation: this.patterns.filter(p => p.pattern_type === 'continuation').length,
    trend_start: this.patterns.filter(p => p.pattern_type === 'trend_start').length,
    momentum: this.patterns.filter(p => p.pattern_type === 'momentum').length
  },
  avg_confidence: (this.patterns.reduce((sum, p) => sum + p.confidence, 0) / this.patterns.length).toFixed(1)
});
```

### Casos de Prueba

#### Test 1: Verificar Inversión de Proximidad
1. Activar `invertProximity` para Reversal
2. Observar logs del backend: debe aparecer `"Reversal proximity logic INVERTED"`
3. Comparar confianza de patrones cerca vs lejos de VWAP
4. Resultado esperado: Patrones lejos tienen más confianza

#### Test 2: Filtrado Individual
1. Desactivar "Bull Engulfing" en toggles individuales
2. Verificar que no aparece en gráfico
3. Activar de nuevo
4. Resultado esperado: Aparece inmediatamente

#### Test 3: Parámetros Estrictos
1. Configurar Reversal con:
   - minWickRatio = 2.5
   - maxOppositeWick = 0.1
   - minConfidence = 60%
2. Observar cantidad de patrones detectados
3. Resultado esperado: Muy pocos patrones, alta calidad

---

## Extensiones Futuras

### Posibles Mejoras

1. **Backtesting Automático**
   - Calcular % de éxito de patrones
   - Win rate por tipo de patrón
   - Profit factor

2. **Machine Learning**
   - Entrenar modelo con patrones exitosos
   - Ajustar pesos de fórmulas de confianza
   - Detectar nuevos patrones

3. **Alertas Inteligentes**
   - Notificaciones push cuando patrón de alta confianza
   - Filtros por símbolo, tipo, dirección
   - Integración con Telegram/Discord

4. **Análisis Multi-Timeframe**
   - Confirmar patrones en múltiples timeframes
   - Aumentar confianza si patrón aparece en 1h + 4h
   - Filtrar patrones que solo aparecen en 1 timeframe

5. **Parámetros Adaptativos**
   - Ajustar automáticamente basado en volatilidad
   - Diferentes parámetros para mercado bull/bear
   - Optimización automática por símbolo

---

**Última actualización**: 12 de Diciembre, 2024
**Versión**: 2.0 (Parámetros configurables para todos los tipos de patrones)
