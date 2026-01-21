# CLAUDE.md - Crypto Backtester

Sistema profesional de backtesting para criptomonedas con análisis avanzado de patrones, volumen y momentum.

---

## COMANDOS DE INICIO

```bash
# Backend (Puerto 9000)
cd 1.Altagracia_Crypto_Backtester/Backtester/backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000

# Frontend (Puerto 5173)
cd 1.Altagracia_Crypto_Backtester/Backtester/frontend
npm install && npm run dev
```

---

## ESTRUCTURA DE ARCHIVOS

```
1.Altagracia_Crypto_Backtester/Backtester/
├── backend/
│   ├── main.py                      # Servidor FastAPI (~94KB, ~2400 líneas)
│   ├── double_topbottom_detector.py # Detector DTB (~60KB, ~1350 líneas)
│   ├── rejection_detector.py        # Detector patrones rechazo (~19KB)
│   ├── alert_sender.py              # Sistema alertas (~10KB)
│   ├── vwap_calculator.py           # Calculador VWAP (~13KB)
│   ├── cache/                       # Caché datos históricos
│   ├── backtesting_cache/           # Caché específico backtesting
│   └── drawings/                    # Dibujos guardados (JSON)
│
├── frontend/
│   ├── src/components/
│   │   ├── backtesting/
│   │   │   ├── BacktestingApp.jsx   # Componente raíz (~84KB)
│   │   │   ├── BacktestingChart.jsx # Gráfico principal (~43KB)
│   │   │   ├── TimeController.js    # Control temporal (~12KB)
│   │   │   ├── OrderManager.js      # Gestor órdenes (~18KB)
│   │   │   ├── TradingControls.jsx  # Controles trading (~11KB)
│   │   │   ├── PerformancePanel.jsx # Métricas (~11KB)
│   │   │   ├── TradeHistory.jsx     # Historial (~7KB)
│   │   │   └── SessionManager.js    # Sesiones (~9KB)
│   │   ├── indicators/              # Sistema indicadores (compartido)
│   │   │   ├── IndicatorManager.js  # Orquestador (~56KB)
│   │   │   ├── DoubleTopBottomIndicator.js  # DTB (~96KB) ⭐
│   │   │   ├── RejectionPatternIndicator.js # Rejection (~114KB)
│   │   │   └── ... (otros indicadores)
│   │   ├── MiniChart.jsx            # Gráfico con indicadores (~92KB)
│   │   └── Watchlist.jsx            # Watchlist (~13KB)
│   └── dist/                        # Build producción
```

---

## CARACTERÍSTICAS PRINCIPALES

- **29 pares de criptomonedas** soportados (BTCUSDT, ETHUSDT, SOLUSDT, etc.)
- **10+ indicadores técnicos** simultáneos
- **Detección automática** de patrones (Double Top/Bottom, Rejection Patterns)
- **Backtesting realista** con órdenes market/limit/stop
- **TimeController** con subdivisiones intravela (1x, 2x, 5x, 10x)
- **Métricas**: Win Rate, Drawdown, Sharpe Ratio
- **Zoom dinámico v3.0** similar a TradingView
- **Exportación**: Excel, CSV, PNG
- **Persistencia de sesiones**
- **Timeframes**: 15m, 1h, 4h (tabs independientes)

---

## ENDPOINTS BACKEND

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/status` | GET | Estado servidor, caché, zona horaria |
| `/api/historical/{symbol}` | GET | Datos OHLCV (params: interval, days) |
| `/api/volume-delta/{symbol}` | GET | Volume Delta + CVD |
| `/api/rejection-patterns/detect` | POST | Detecta patrones de rechazo |
| `/api/rejection-patterns/available-contexts/{symbol}` | GET | Contextos de referencia |
| `/api/double-topbottom/detect` | POST | Detecta Double Top/Bottom ⭐ |
| `/api/double-topbottom/chunk` | POST | Obtiene patrones por chunks ⭐ |
| `/api/clear-cache` | POST | Limpia caché |

---

## LÍMITES POR TIMEFRAME

**CRÍTICO: Deben coincidir en backend Y frontend**

```python
MAX_DAYS_BY_INTERVAL = {
    "1": 5,      # 1 minuto: máx 5 días
    "3": 10,     # 3 minutos: máx 10 días
    "5": 5,      # 5 minutos: máx 5 días
    "15": 15,    # 15 minutos: máx 15 días
    "30": 30,    # 30 minutos: máx 30 días
    "60": 120,   # 1 hora: máx 120 días
    "120": 180,  # 2 horas: máx 180 días
    "240": 300,  # 4 horas: máx 300 días
    "D": 730,    # Diario: máx 730 días
    "W": 730     # Semanal: máx 730 días
}
```

---

# ⭐ SISTEMA DOUBLE TOP/BOTTOM (Documentación Detallada)

Este sistema fue complejo de implementar. Requirió múltiples iteraciones para:
1. Manejar correctamente las fechas y timestamps
2. Implementar sistema de chunks para evitar sesgo de supervivencia
3. Sincronizar el playback con la visualización de patrones
4. Optimizar carga de datos (~11MB de velas para 3 años)

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DOUBLE TOP/BOTTOM DETECTION SYSTEM                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐                    ┌─────────────────────────────────┐ │
│  │   FRONTEND      │                    │        BACKEND                  │ │
│  │   (React)       │                    │        (FastAPI)                │ │
│  │                 │                    │                                 │ │
│  │ BacktestingApp  │──── Velas ────────▶│  POST /api/double-topbottom/   │ │
│  │      ↓          │    (~11MB)         │       detect                    │ │
│  │ IndicatorManager│                    │         ↓                       │ │
│  │      ↓          │                    │  DoubleTopBottomDetector        │ │
│  │ DTBIndicator    │                    │    .detect_patterns()           │ │
│  │                 │                    │         ↓                       │ │
│  │                 │◀── Chunks ─────────│  divide_patterns_into_chunks()  │ │
│  │                 │   metadata         │         ↓                       │ │
│  │                 │                    │  DTB_PATTERNS_CACHE[key]        │ │
│  │                 │                    │    (por trimestres)             │ │
│  │                 │                    │                                 │ │
│  │ precalculate    │──── upTo ─────────▶│  POST /api/double-topbottom/   │ │
│  │ WithCandles()   │   timestamp        │       chunk                     │ │
│  │      ↓          │                    │         ↓                       │ │
│  │ fetchPatterns   │◀── Patrones ───────│  Filtra por timestamp           │ │
│  │ UpTo()          │   filtrados        │  (evita sesgo supervivencia)    │ │
│  │      ↓          │                    │                                 │ │
│  │ renderOverlay() │                    │                                 │ │
│  │  (filtra por    │                    │                                 │ │
│  │   playbackTime) │                    │                                 │ │
│  │                 │                    │                                 │ │
│  └─────────────────┘                    └─────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Flujo de Detección (Backend)

### 1. Endpoint Principal: `/api/double-topbottom/detect`

```python
@app.post("/api/double-topbottom/detect")
async def detect_double_topbottom(request: Request):
    # Body esperado:
    # {
    #   "symbol": "BTCUSDT",
    #   "interval": "240",      # 4 horas
    #   "days": 730,            # 2 años de datos
    #   "config": {...},        # Configuración del detector
    #   "candles": [...]        # OPCIONAL: velas (solo primera vez)
    # }
```

**Flujo interno:**

```
1. Recibe request con symbol, interval, days, config
   ↓
2. Verifica si las velas están en caché (DTB_CANDLES_CACHE)
   - SI: Usa caché (~instantáneo)
   - NO: Espera que frontend envíe velas (~11MB)
   ↓
3. Crea instancia de DoubleTopBottomDetector
   ↓
4. detector.detect_patterns(symbol, candles, config)
   ↓
5. Serializa patrones con serialize_pattern()
   ↓
6. divide_patterns_into_chunks() → por trimestre (2023-Q1, 2023-Q2, etc.)
   ↓
7. Guarda en DTB_PATTERNS_CACHE[cache_key]
   ↓
8. Retorna metadata de chunks (NO los patrones completos)
   {
     "success": true,
     "cached": true,
     "chunks": ["2022-Q1", "2022-Q2", ...],
     "totalPatterns": 150,
     "message": "Use /api/double-topbottom/chunk para obtenerlos"
   }
```

### 2. Endpoint de Chunks: `/api/double-topbottom/chunk`

```python
@app.post("/api/double-topbottom/chunk")
async def get_dtb_chunk(request: Request):
    # Body esperado (opción A - chunk específico):
    # {
    #   "symbol": "BTCUSDT",
    #   "interval": "240",
    #   "chunk": "2023-Q1"
    # }
    #
    # Body esperado (opción B - hasta timestamp):
    # {
    #   "symbol": "BTCUSDT",
    #   "interval": "240",
    #   "upTo": 1705500000000  # Timestamp límite
    # }
```

**Flujo con `upTo` (usado por playback):**

```
1. Recibe upTo timestamp (ej: fecha actual del playback)
   ↓
2. Calcula limit_key = timestamp → "2023-Q4" (trimestre)
   ↓
3. Itera chunks ordenados cronológicamente
   ↓
4. Para cada chunk <= limit_key:
   - Filtra patrones donde secondExtreme.timestamp <= upTo
   ↓
5. Retorna SOLO patrones que ya "existían" en ese momento
   (evita sesgo de supervivencia)
```

### 3. Algoritmo de Detección (DoubleTopBottomDetector)

```python
def detect_patterns(self, symbol, candles, config):
    """
    Pipeline de detección en 7 pasos:

    1. FIND LOCAL EXTREMES
       - Busca máximos locales (highs) para Double Tops
       - Busca mínimos locales (lows) para Double Bottoms
       - Usa ventana de N velas a cada lado (candlesPerExtreme)

    2. FILTER BY VOLUME (opcional)
       - Si requireHighVolumeAtExtremes.enabled:
         - Busca volumen alto en ventana ±N velas del extremo
         - zScoreThresholdFirst: umbral para primer extremo (default 1.5)
         - zScoreThresholdSecond: umbral para segundo extremo (default 0.5)

    3. FIND DOUBLE TOPS
       - Emparejar highs que cumplan:
         - Distancia: minCandlesBetween <= dist <= maxCandlesBetween
         - Precio similar: abs(h1-h2)/avg < priceMarginPercent
         - Sin breakout entre extremos: maxBreakoutPercent
         - Patrones de rechazo (Shooting Star, Engulfing Bearish)

    4. FIND DOUBLE BOTTOMS
       - Igual que tops pero con lows
       - Patrones de rechazo: Hammer, Engulfing Bullish

    5. POST-PATTERN VALIDATION
       - Verifica movimiento direccional después del patrón
       - Double Top: precio debe bajar después
       - Double Bottom: precio debe subir después
       - Añade bonus de confianza si se confirma

    6. FILTER DUPLICATES
       - Elimina patrones en misma zona precio/tiempo
       - Mantiene el de mayor confianza

    7. MOMENTUM CONFIRMATION (Phase 2, opcional)
       - Busca patrones de momentum después del segundo extremo
       - Marubozu, White Soldiers, Black Crows, Big Body
       - Añade entry_signal con dirección LONG/SHORT
    """
```

### 4. Estructura de un Patrón Detectado

```python
@dataclass
class DoublePattern:
    type: str                    # "DOUBLE_TOP" o "DOUBLE_BOTTOM"
    timestamp: int               # Timestamp del segundo extremo (confirmación)
    confidence: float            # 0-100

    first_extreme: Dict          # {
                                 #   timestamp: int,
                                 #   price: float,
                                 #   candle_index: int,
                                 #   rejection_pattern: str,  # "HAMMER", "SHOOTING_STAR", etc.
                                 #   pattern_quality: float,
                                 #   volume_zscore: float
                                 # }

    second_extreme: Dict         # Misma estructura que first_extreme

    level_price: float           # Precio del nivel (resistencia/soporte)
                                 # Double Top: min(h1, h2) - el techo que no pudo romper
                                 # Double Bottom: max(l1, l2) - el piso que no pudo romper

    price_variance: float        # % diferencia entre extremos

    entry_signal: Optional[Dict] # Solo si momentum habilitado:
                                 # {
                                 #   has_momentum: bool,
                                 #   momentum_pattern: str,  # "BULLISH_MARUBOZU", etc.
                                 #   entry_candle_timestamp: int,
                                 #   entry_price: float,
                                 #   direction: str,  # "LONG" o "SHORT"
                                 #   momentum_quality: float,
                                 #   volume_zscore: float
                                 # }

    candles_between_extremes: int
    pattern_duration_hours: float
    volume_average: float
    meets_volume_criteria: bool
```

## Flujo Frontend (DoubleTopBottomIndicator.js)

### 1. Inicialización

```javascript
class DoubleTopBottomIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 90, config = {}) {
    // 🎯 CRÍTICO: Modo backtesting deshabilita fetch directo
    this.backtestingMode = config.backtestingMode || false;

    // Flag para optimización: solo enviar velas la primera vez
    this.candlesSentToBackend = false;

    // Sistema de alertas
    this.alertedPatterns = new Set();
    this.alertCooldownMs = 5 * 60 * 1000; // 5 min

    // Control de playback
    this._currentPlaybackTime = null;
  }
}
```

### 2. Precálculo con Velas (Modo Backtesting)

```javascript
async precalculateWithCandles(candles, playbackStartTime = null) {
  /**
   * FLUJO:
   * 1. Envía velas al backend (solo primera vez, ~11MB)
   * 2. Backend detecta patrones y los divide en chunks
   * 3. Frontend solicita TODOS los patrones (upTo: 2030)
   * 4. Guarda en this.patterns
   * 5. Inicializa _currentPlaybackTime
   * 6. renderOverlay filtrará según avanza el playback
   */

  const payload = {
    symbol: this.symbol,
    interval: this.interval,
    days: this.days,
    config: this.config
  };

  // Solo primera vez: enviar velas
  if (!this.candlesSentToBackend) {
    payload.candles = candles;  // ~11MB para 3 años de 4h
  }

  const response = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // Si el backend tiene chunks, solicitar todos
  if (result.success && result.cached && result.chunks) {
    const futureTimestamp = new Date(2030, 0, 1).getTime();
    const patternsResult = await this.fetchPatternsUpTo(futureTimestamp);
    this.patterns = patternsResult.patterns;

    // Inicializar tiempo de playback
    this._currentPlaybackTime = playbackStartTime || candles[0].timestamp;
  }
}
```

### 3. Solicitar Patrones por Chunks

```javascript
async fetchPatternsUpTo(timestamp) {
  /**
   * Solicita patrones hasta cierto timestamp.
   * El backend filtra y solo devuelve patrones que
   * ya "existían" en ese momento temporal.
   */
  const response = await fetch(`${API_BASE_URL}/api/double-topbottom/chunk`, {
    method: 'POST',
    body: JSON.stringify({
      symbol: this.symbol,
      interval: this.interval,
      upTo: timestamp  // Solo patrones hasta esta fecha
    })
  });

  return await response.json();
}
```

### 4. Actualización Durante Playback

```javascript
async updatePlaybackDate(timestamp) {
  // Simplemente guarda el timestamp actual
  // El filtrado se hace en renderOverlay
  this._currentPlaybackTime = timestamp;
}
```

### 5. Renderizado (Filtrado por Tiempo)

```javascript
renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
  // 🎯 CRÍTICO: Filtrar patrones según el tiempo del playback
  // Esto evita el sesgo de supervivencia (ver patrones futuros)
  const currentTime = this._currentPlaybackTime || Date.now();

  const visiblePatterns = this.patterns.filter(pattern =>
    pattern.secondExtreme.timestamp <= currentTime
  );

  // Solo renderizar patrones que ya existían en currentTime
  visiblePatterns.forEach(pattern => {
    // Verificar si está en rango de precios visible
    if (pattern.levelPrice < minPrice || pattern.levelPrice > maxPrice) {
      return;  // Fuera del rango visible
    }

    // Dibujar línea de nivel
    if (this.config.visualization.showLines) {
      this._drawLevelLine(ctx, pattern, ...);
    }

    // Dibujar iconos de rechazo en extremos
    if (this.config.visualization.showRejectionIcons) {
      this._drawRejectionIcons(ctx, pattern, ...);
    }

    // Dibujar momentum y flecha de entrada (si Phase 2 habilitada)
    if (pattern.entrySignal?.has_momentum) {
      this._drawMomentumIcon(ctx, pattern, ...);
      this._drawEntryArrow(ctx, pattern, ...);
    }
  });
}
```

## Sistema de Chunks por Trimestre

### Por qué se implementó

**Problema original:** Al cargar 3 años de datos (730 días en 4h = ~4380 velas), la detección producía cientos de patrones. Enviarlos todos al frontend de una vez causaba:
1. Respuestas HTTP enormes
2. Sesgo de supervivencia (ver patrones "futuros" durante backtesting)

**Solución:** Dividir patrones en chunks trimestrales y filtrar por timestamp.

### Implementación Backend

```python
def divide_patterns_into_chunks(patterns):
    """
    Divide patrones en chunks por trimestre.

    Ejemplo de salida:
    {
        "2022-Q1": [pattern1, pattern2, ...],
        "2022-Q2": [pattern3, pattern4, ...],
        "2022-Q3": [...],
        ...
    }
    """
    chunks = defaultdict(list)

    for pattern in patterns:
        # Usar timestamp del segundo extremo (confirmación)
        dt = datetime.fromtimestamp(pattern['timestamp'] / 1000)
        quarter = (dt.month - 1) // 3 + 1
        chunk_key = f"{dt.year}-Q{quarter}"
        chunks[chunk_key].append(pattern)

    return dict(sorted(chunks.items()))
```

### Caché en Memoria

```python
# En main.py
DTB_CANDLES_CACHE = {}    # Velas: ~11MB por símbolo/intervalo
DTB_PATTERNS_CACHE = {}   # Patrones divididos por chunks

# Estructura de DTB_PATTERNS_CACHE:
# {
#   "BTCUSDT_240": {
#     "2022-Q1": [p1, p2, ...],
#     "2022-Q2": [p3, p4, ...],
#     ...
#   },
#   "ETHUSDT_240": {...}
# }
```

## Problemas Resueltos y Lecciones Aprendidas

### 1. Orden de Velas (Cronológico vs Inverso)

**Problema:** Bybit API devuelve velas en orden inverso (recientes primero).

**Síntomas:** Patrones detectados con timestamps incorrectos, índices de velas invertidos.

**Solución:** El backend verifica y logea el orden:
```python
# En double_topbottom_detector.py:99-108
if len(candles) > 0:
    first_ts = candles[0].get('timestamp', 0)
    last_ts = candles[-1].get('timestamp', 0)
    print(f"Orden: {'OK Cronológico' if last_ts > first_ts else 'WARN INVERSO'}")
```

**Fix:** El frontend invierte las velas antes de enviar si es necesario.

### 2. Timestamps de Patrones vs Velas Visibles

**Problema:** Los patrones se detectaban pero no se dibujaban.

**Diagnóstico:**
```javascript
// En renderOverlay - logs de diagnóstico
console.log(`Rango timestamps PATRONES:`);
console.log(`  Inicio: ${formatDate(minPatternTimestamp)}`);
console.log(`  Fin: ${formatDate(maxPatternTimestamp)}`);
console.log(`Rango timestamps VELAS VISIBLES:`);
console.log(`  Inicio: ${formatDate(minVisibleTimestamp)}`);
console.log(`  Fin: ${formatDate(maxVisibleTimestamp)}`);
```

**Causa:** Los timestamps de patrones no coincidían con los de las velas visibles (diferente rango temporal).

**Solución:** Verificar que `timeToX()` retorna valores válidos antes de dibujar.

### 3. Sesgo de Supervivencia en Backtesting

**Problema:** Durante el playback, se veían patrones que aún no se habían formado.

**Ejemplo:** En fecha 2023-06-01 del playback, se veían patrones de 2023-09.

**Solución:**
1. Backend: Dividir patrones en chunks temporales
2. Frontend: Filtrar por `_currentPlaybackTime` en `renderOverlay`

```javascript
const visiblePatterns = this.patterns.filter(pattern =>
  pattern.secondExtreme.timestamp <= currentTime
);
```

### 4. Optimización de Carga de Velas (~11MB)

**Problema:** Enviar 11MB de velas en cada request era lento.

**Solución:** Flag `candlesSentToBackend`:
```javascript
if (!this.candlesSentToBackend) {
  payload.candles = candles;  // Solo primera vez
  this.candlesSentToBackend = true;
}
// Subsecuentes requests usan caché del backend
```

### 5. Level Price Incorrecto

**Problema inicial:** Se usaba promedio de extremos como `level_price`.

**Problema:** No representa el nivel real de resistencia/soporte.

**Fix:**
```python
# Para Double Top: el nivel es el TOP MÁS BAJO
# (el precio que ambos extremos NO pudieron superar)
resistance_level = min(h1_price, h2_price)

# Para Double Bottom: el nivel es el BOTTOM MÁS ALTO
# (el precio que ambos extremos NO pudieron romper)
support_level = max(l1_price, l2_price)
```

### 6. Breakout Entre Extremos

**Problema:** Patrones inválidos donde el precio rompía el primer extremo entre los dos picos.

**Solución:** Validación de breakout:
```python
breakout_tolerance_pct = config.get('maxBreakoutPercent', 2.0) / 100.0
candles_between = all_candles[h1['candle_index']:h2['candle_index'] + 1]

highest_high_between = max(c.get('high', 0) for c in candles_between)
breakout_amount = (highest_high_between - h1_price) / h1_price

if breakout_amount > breakout_tolerance_pct:
    # Patrón invalidado por breakout
    continue
```

## Configuración del Indicador

### Config por Defecto

```javascript
getDefaultConfig() {
  return {
    enabled: true,

    doubleTopBottom: {
      lookbackCandles: 50,
      candlesPerExtreme: 5,       // Velas a cada lado para confirmar extremo
      priceMarginPercent: 2.0,    // Max diferencia entre extremos
      minCandlesBetween: 5,
      maxCandlesBetween: 50,
      maxBreakoutPercent: 2.0,    // Max % de breakout permitido

      rejectionPatterns: {
        hammer: true,
        shootingStar: true,
        bullishEngulfing: true,
        bearishEngulfing: true
      },

      volumeFilter: {
        enabled: false,
        zScoreThreshold: 1.5,
        zScorePeriod: 20
      },

      requireHighVolumeAtExtremes: {
        enabled: false,
        zScoreThresholdFirst: 1.5,
        zScoreThresholdSecond: 0.5,
        zScorePeriod: 20,
        volumeWindowCandles: 3
      }
    },

    momentumConfirmation: {
      enabled: false,
      patterns: {
        marubozu: { enabled: true, minBodyRatio: 0.8 },
        soldiers_crows: { enabled: true, minBodyRatio: 0.6 },
        bigBody: { enabled: true, minBodyRatio: 0.7, allowBigWick: true }
      },
      lookbackAfterPattern: 10,
      requireMomentum: false
    },

    filters: {
      minConfidence: 60,
      requireBothRejections: true,
      minPatternDuration: 3,      // horas
      maxPatternDuration: 72,     // horas
      applyPostValidationToRealtimeSignals: false,
      postPatternValidationCandles: 5,
      minPostPatternMovePercent: 0.5,
      postPatternConfidenceBonus: 20,
      duplicatePriceTolerancePercent: 2.0,
      duplicateTimeToleranceHours: 24
    },

    visualization: {
      showLines: true,
      showRejectionIcons: true,
      showMomentumIcons: true,
      showEntryArrows: true,
      colors: {
        doubleTopLine: '#FF5722',
        doubleBottomLine: '#4CAF50',
        rejectionIcon: '#FFC107',
        entryLong: '#00E676',
        entryShort: '#FF1744'
      }
    },

    alertsEnabled: false
  };
}
```

---

## OTROS COMPONENTES PRINCIPALES

### BacktestingApp.jsx (Raíz)

Estado global de la aplicación:

```javascript
const [symbol, setSymbol] = useState('');
const [activeTimeframe, setActiveTimeframe] = useState('15m');
const [marketData, setMarketData] = useState(null);
const [currentTime, setCurrentTime] = useState(null);
const [isPlaying, setIsPlaying] = useState(false);
const [playbackSpeed, setPlaybackSpeed] = useState(1);

// Estado por timeframe independiente
const [tabStates, setTabStates] = useState({
  '15m': { indicatorStates, vpConfig, ... },
  '1h': { ... },
  '4h': { ... }
});
```

### TimeController.js (Control Temporal)

Control de reproducción con subdivisiones intravela:

```javascript
subdivisionConfig = {
  "15m": { interval: 5, count: 3 },   // 3 estados de 5min
  "1h": { interval: 15, count: 4 },   // 4 estados de 15min
  "4h": { interval: 60, count: 4 }    // 4 estados de 1h
};
```

### OrderManager.js (Gestión de Órdenes)

**Tipos de órdenes:**
1. **Market**: Ejecuta inmediatamente
2. **Limit**: Ejecuta si precio llega al nivel
3. **Stop**: Ejecuta si precio cae por debajo (SL)

**Métricas calculadas:**
- Unrealized PnL, Realized PnL
- Win Rate, Drawdown máximo, Sharpe Ratio

---

## PATRONES DETECTADOS

### Rejection Patterns

| Patrón | Emoji | Dirección |
|--------|-------|-----------|
| HAMMER | 🔨 | Alcista |
| SHOOTING_STAR | ⭐ | Bajista |
| ENGULFING_BULLISH | 📈 | Alcista |
| ENGULFING_BEARISH | 📉 | Bajista |
| DOJI_DRAGONFLY | 🐉 | Alcista |
| DOJI_GRAVESTONE | 🪦 | Bajista |

### Double Top/Bottom

| Patrón | Emoji | Dirección |
|--------|-------|-----------|
| DOUBLE_TOP | 🔻 (DT) | Bajista (SHORT) |
| DOUBLE_BOTTOM | 🔺 (DB) | Alcista (LONG) |

---

## CACHÉ

### Backend

```python
DTB_CANDLES_CACHE = {}    # Velas: ~11MB por símbolo/intervalo
DTB_PATTERNS_CACHE = {}   # Patrones divididos por chunks trimestrales
```

**TTL general:** 30 minutos (CACHE_MAX_AGE = 1800)

### Frontend (localStorage)

```javascript
'double_topbottom_config_{symbol}'
'rejection_pattern_config_{symbol}'
'volumeprofile_fixed_ranges_v2'
'backtesting_session_{sessionId}'
```

---

## TROUBLESHOOTING

**Patrones DTB no aparecen:**
1. Verificar que el indicador está habilitado en config
2. Verificar logs de backend: `[PRUEBA_DBT]`
3. Verificar que hay suficientes velas (mínimo 50)
4. Verificar rango de precios visible vs rango de patrones
5. Verificar `_currentPlaybackTime` está correctamente inicializado

**Patrones aparecen en fechas incorrectas:**
1. Verificar orden de velas (cronológico vs inverso)
2. Verificar que `timeToX()` devuelve valores correctos
3. Verificar logs de timestamps en renderOverlay

**Carga muy lenta:**
1. Primera carga siempre es lenta (~11MB de velas)
2. Subsecuentes deberían usar caché
3. Verificar `candlesSentToBackend` flag

**Sesgo de supervivencia (ver patrones futuros):**
1. Verificar `_currentPlaybackTime` se actualiza con playback
2. Verificar filtro en `renderOverlay`:
   ```javascript
   pattern.secondExtreme.timestamp <= currentTime
   ```

---

## STACK TECNOLÓGICO

| Capa | Tecnología |
|------|-----------|
| **Backend** | Python 3.10+, FastAPI, Uvicorn |
| **HTTP Client** | httpx |
| **Frontend** | React 18, Vite |
| **Gráficos** | uPlot, Chart.js |
| **Export** | ExcelJS, html2canvas |
| **Utilidades** | Lodash |

---

## DIFERENCIAS CON WATCHLIST

| Aspecto | Backtester | Watchlist |
|---------|-----------|----------|
| **Modo** | Histórico (reproducción) | Tiempo real (WebSocket) |
| **Timeframes** | 3 fijos (15m, 1h, 4h) | Múltiples (1m-D) |
| **Datos** | Bybit REST API | Bybit WebSocket |
| **Órdenes** | Simuladas | No ejecuta |
| **TimeController** | SÍ | NO |
| **DTB Chunks** | SÍ (evita sesgo) | NO (tiempo real) |
