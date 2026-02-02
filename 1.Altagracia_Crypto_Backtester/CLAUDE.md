# CLAUDE.md - Crypto Backtester

Sistema profesional de backtesting para criptomonedas con análisis avanzado de patrones, volumen y momentum.

---

## 🚨 TRABAJO EN PROGRESO (Enero 2026)

### Tarea Actual: Expansión de Timeframes (1m y 5m)

**Objetivo:** Expandir de 3 timeframes (15m, 1h, 4h) a 5 timeframes añadiendo 1m y 5m.

**Configuración de días por timeframe:**
- 1m: 365 días (1 año = 525,600 velas)
- 5m: 1095 días (3 años = 315,360 velas)
- 15m/1h/4h: 730 días (2 años)

### Estado de la Implementación

**✅ COMPLETADO:**
1. Backend `main.py`:
   - `MAX_DAYS_BY_INTERVAL` actualizado (1m=365, 5m=1095)
   - `BACKTESTING_CONFIG` con 5 timeframes
   - Variable `days` corregida a `tf_days` en endpoint bulk-data
   - Metadata usa `days_by_timeframe` en vez de `days`
   - Open Interest deshabilitado para 1m y 5m (demasiados datos)

2. Frontend:
   - `TimeframeTabs.jsx`: 5 tabs (1m, 5m, 15m, 1h, 4h)
   - `TimeController.js`: Subdivisiones para 1m y 5m
   - `BacktestingApp.jsx`: Estados para 5 timeframes

**❌ PROBLEMA ACTUAL:**
- Error: "name 'days' is not defined" aparece después de 30+ min de carga
- El error NO aparece en la consola del backend
- El código fuente está correcto (verificado con scripts de prueba)
- El servidor parece ejecutar código viejo a pesar de reinicios

**🔧 DIAGNÓSTICO REALIZADO:**
1. Script `test_days_bug.py` confirma que el código Python es correcto
2. Script `check_days_error.py` no encuentra errores en main.py
3. Endpoint `/api/backtesting/test-metadata` creado pero no se carga en el servidor
4. Múltiples procesos zombie en puerto 9000 detectados
5. **Solución pendiente:** Reiniciar PC para liberar puerto 9000

### Próximos Pasos (después del reinicio)

1. Verificar que puerto 9000 está libre: `netstat -ano | findstr :9000`
2. Iniciar backend: `python -m uvicorn main:app --port 9000`
3. Probar endpoint: `http://localhost:9000/api/backtesting/test-metadata`
4. Si funciona, probar carga completa de datos
5. Si el error persiste, revisar dónde exactamente aparece (navegador F12, terminal, UI)

### Archivos de Diagnóstico Creados

- `backend/limpiar_cache.bat` - Limpia caché de Python y backtesting
- `backend/reiniciar_backend.bat` - Mata procesos y reinicia servidor
- `backend/test_days_bug.py` - Prueba aislada del código de metadata
- `backend/check_days_error.py` - Analiza main.py buscando usos de 'days'

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
│   │   │   ├── SupportResistance2Indicator.js # S&R v2 basado en Swing Points ⭐
│   │   │   └── ... (otros indicadores)
│   │   ├── SupportResistance2Settings.jsx # Modal config S&R v2
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
- **Timeframes**: 1m, 5m, 15m, 1h, 4h (5 tabs independientes)
  - 1m: 1 año de datos (525,600 velas)
  - 5m: 3 años de datos (315,360 velas)
  - 15m/1h/4h: 2 años de datos

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
    "1": 365,    # 1 minuto: 1 año (525,600 velas) - BACKTESTING
    "3": 10,     # 3 minutos: máx 10 días
    "5": 1095,   # 5 minutos: 3 años (315,360 velas) - BACKTESTING
    "15": 730,   # 15 minutos: máx 2 años
    "30": 730,   # 30 minutos: máx 2 años
    "60": 730,   # 1 hora: máx 2 años
    "120": 730,  # 2 horas: máx 2 años
    "240": 730,  # 4 horas: máx 2 años
    "D": 730,    # Diario: máx 730 días
    "W": 730     # Semanal: máx 730 días
}
```

### Configuración de Backtesting (BACKTESTING_CONFIG)

```python
BACKTESTING_CONFIG = {
    "1m": { "interval": "1", "days": 365, "subdivisions": { "interval": "1", "count": 1 } },
    "5m": { "interval": "5", "days": 1095, "subdivisions": { "interval": "1", "count": 5 } },
    "15m": { "interval": "15", "days": 730, "subdivisions": { "interval": "5", "count": 3 } },
    "1h": { "interval": "60", "days": 730, "subdivisions": { "interval": "15", "count": 4 } },
    "4h": { "interval": "240", "days": 730, "subdivisions": { "interval": "60", "count": 4 } }
}
```

**Nota:** Open Interest se omite para 1m y 5m (demasiados datos).

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

# ⭐ INDICADOR S&R v2 (Support & Resistance basado en Swing Points)

Sistema de detección de soportes y resistencias más preciso que el original, basado en Swing Points con clustering.

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `SupportResistance2Indicator.js` | Indicador principal (~750 líneas) |
| `SupportResistance2Settings.jsx` | Modal de configuración |

## Algoritmo

```
1. DETECCIÓN DE SWING POINTS
   - Swing High: máximo local confirmado (N barras a cada lado más bajas)
   - Swing Low: mínimo local confirmado (N barras a cada lado más altas)
   - Parámetro: swingBars (default: 5)

2. FILTRO POR RANGO DE PRECIO
   - Solo busca niveles dentro de ±priceRangePct% del precio actual
   - Parámetro: priceRangePct (default: 10%)

3. CLUSTERING
   - Agrupa swings cercanos en precio
   - Parámetro: clusterDistancePct (default: 0.3%)

4. CÁLCULO DE STRENGTH
   - strength = (touches × 2) + volumeBonus + recencyBonus
   - volumeBonus: 0-3 puntos según z-score del volumen
   - recencyBonus: 0-3 puntos según qué tan reciente es el nivel

5. CLASIFICACIÓN ACTIVO/ROTO
   - Activo: precio no ha cruzado el nivel recientemente
   - Roto: precio cruzó el nivel en las últimas N velas
```

## Parámetros de Configuración

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `swingBars` | 5 | Velas a cada lado para confirmar swing (2-15) |
| `priceRangePct` | 10.0 | % arriba/abajo del precio actual para buscar niveles |
| `clusterDistancePct` | 0.3 | % máximo de distancia para agrupar swings |
| `minTouches` | 1 | Toques mínimos para considerar nivel válido |
| `maxLevels` | 5 | Máximo niveles por lado (resistencias/soportes) |
| `minVolumeZScore` | 0 | Filtro de volumen (0 = sin filtro) |
| `volumeLookbackBars` | 50 | Velas para calcular z-score de volumen |

## Visualización

- **Líneas rojas**: Resistencias (niveles arriba del precio actual)
- **Líneas verdes**: Soportes (niveles debajo del precio actual)
- **Líneas sólidas**: Niveles activos (no rotos)
- **Líneas punteadas**: Niveles rotos recientemente
- **Etiquetas**: Lado izquierdo, formato `R1: $price (Nt, S★)`

## Diferencias con S&R Original

| Aspecto | S&R Original | S&R v2 |
|---------|--------------|--------|
| Método | Pivots simples | Swing Points confirmados |
| Filtro de precio | No | Sí (±priceRangePct%) |
| Clustering | Básico | Avanzado con distancia % |
| Strength | touches × 2 | touches + volume + recency |
| Clasificación | Activo/Roto | Activo/Roto con detección reciente |

## Uso en Backtesting

El indicador se sincroniza con el playback:
- `updatePlaybackDate(timestamp)`: Actualiza el tiempo de referencia
- Recalcula niveles cuando cambia el precio de referencia
- Invalida caché automáticamente al cambiar parámetros

## Caché

- **IndexedDB**: Almacena swings detectados para evitar recálculos
- **Memoria**: `_cachedRawLevels` para acceso rápido
- **Invalidación**: Automática al cambiar parámetros o precio de referencia (>2%)

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

---

# ⭐ ZONE DETECTOR 2.0 (Febrero 2026)

Sistema de detección automática de zonas de consolidación (rangos laterales) para identificar áreas de acumulación/distribución antes de breakouts.

## Archivos del Sistema

| Archivo | Descripción |
|---------|-------------|
| `backend/zone_detector.py` | Algoritmos de detección (~1100 líneas) |
| `backend/zone_evaluator.py` | Evaluación de calidad de zonas |
| `backend/zone_optimizer.py` | Optimización de parámetros (grid search, walk-forward) |
| `frontend/src/components/ZoneDetectorTester.jsx` | UI modal para testing |
| `frontend/src/components/ZoneDetectorTester.css` | Estilos del modal |
| `frontend/src/components/indicators/ZoneVisualizerIndicator.js` | Renderiza zonas en el gráfico |

## Métodos de Detección Disponibles

| Método | Descripción | Mejor para |
|--------|-------------|------------|
| `pivot_cluster` | Agrupa pivots cercanos en precio | Zonas de S/R tradicionales |
| `atr_based` | Detecta períodos de baja volatilidad | Consolidaciones por ATR |
| `volume_profile` | Identifica zonas de alto volumen | POC, VAH, VAL |
| `price_action` | Cuenta toques a niveles de precio | Niveles psicológicos |
| `consolidation` | **RECOMENDADO** - Detecta rangos laterales compactos | Acumulación/Distribución |

## Método Consolidation (Algoritmo Principal)

### Concepto

Detecta zonas de consolidación lateral donde el precio se mueve horizontalmente antes de un breakout. Ideal para identificar:
- Zonas de acumulación (antes de subida)
- Zonas de distribución (antes de bajada)
- Rangos de trading laterales

### Algoritmo v3 (Febrero 2026)

```python
def _consolidation_method(self, candles, params):
    """
    Algoritmo de detección de consolidaciones laterales.

    FASE 1: BÚSQUEDA DE INICIO
    - Escanea velas buscando inicio de consolidación
    - Ventana inicial de consol_min_bars velas
    - Verifica criterios:
      * Rango de precio <= consol_max_range_pct%
      * ATR local / ATR global <= consol_atr_ratio
      * Ratio cuerpo/rango promedio <= consol_body_ratio

    FASE 2: EXTENSIÓN HORIZONTAL
    - El rango vertical (high/low) SE FIJA con las primeras velas
    - La zona solo crece HORIZONTALMENTE (en tiempo)
    - Una vela "toca" el rango si su high/low intersectan con él

    FASE 3: DETECCIÓN DE BREAKOUT
    - Cuenta velas consecutivas COMPLETAMENTE fuera del rango
    - Si consecutive_outside >= consol_max_outside_bars → cierra zona
    - Si una vela vuelve a tocar el rango → resetea contador

    CLAVE: El rango vertical NUNCA se expande después de fijarse
    """
```

### Parámetros de Configuración

| Parámetro | Default | Rango | Descripción |
|-----------|---------|-------|-------------|
| `consol_min_bars` | 8 | 5-30 | Mínimo de velas para considerar consolidación |
| `consol_max_bars` | 50 | 20-300 | Máximo de velas en una zona |
| `consol_max_range_pct` | 3.0 | 1.0-10.0 | Máximo % de rango vertical de precio |
| `consol_atr_ratio` | 0.6 | 0.3-2.0 | ATR local / ATR global (menor = menos volátil) |
| `consol_body_ratio` | 0.5 | 0.3-0.8 | Ratio cuerpo/rango promedio (menor = más indecisión) |
| `consol_max_outside_bars` | 3 | 1-10 | Velas consecutivas fuera antes de cerrar zona |

### Comportamiento del Algoritmo

```
EJEMPLO VISUAL:

Precio
  |     ┌─────────────────────────────────┐
  |  ───┤     Zona de Consolidación       ├─── range_high (FIJO)
  |     │   /\    /\    /\                │
  |     │  /  \  /  \  /  \    BREAKOUT   │
  |     │ /    \/    \/    \      ↓       │
  |  ───┤                    \────────────┴─── range_low (FIJO)
  |     └─────────────────────────────────┘
  |                                    ↑
  |                          consol_max_outside_bars
  └──────────────────────────────────────────────── Tiempo

1. Se detecta inicio cuando hay consol_min_bars velas dentro del rango
2. El rango vertical (range_high, range_low) SE FIJA y no cambia
3. La zona se extiende horizontalmente mientras velas toquen el rango
4. Si una vela sale pero vuelve antes de N velas → zona sigue
5. Si N velas consecutivas están COMPLETAMENTE fuera → zona termina
```

### Lecciones Aprendidas (Iteraciones del Algoritmo)

**Problema v1**: Las zonas se cortaban prematuramente
- Causa: Cualquier vela con close fuera del rango cortaba la zona
- Fix: Usar intersección de high/low en lugar de solo close

**Problema v2**: Las zonas incluían movimientos direccionales completos
- Causa: El rango se expandía verticalmente para incluir nuevas velas
- Fix: Fijar el rango vertical con las primeras velas y NUNCA expandirlo

**Problema v3**: Velas de momentum cortaban inmediatamente
- Causa: Condición `is_momentum_candle` tenía prioridad sobre contador
- Fix: Eliminar condición de momentum, usar solo `consol_max_outside_bars`

## Endpoints API

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/zones/methods` | GET | Lista métodos disponibles y sus parámetros |
| `/api/zones/detect` | POST | Detecta zonas con método especificado |
| `/api/zones/evaluate` | POST | Evalúa calidad de zonas detectadas |
| `/api/zones/compare-methods` | POST | Compara todos los métodos |
| `/api/zones/optimize` | POST | Optimiza parámetros (grid search / walk-forward) |

### Ejemplo de Request

```json
POST /api/zones/detect
{
  "symbol": "BTCUSDT",
  "interval": "15",
  "days": 365,
  "method": "consolidation",
  "end_timestamp": 1706745600000,
  "params": {
    "consol_min_bars": 8,
    "consol_max_bars": 100,
    "consol_max_range_pct": 5.0,
    "consol_atr_ratio": 0.8,
    "consol_body_ratio": 0.5,
    "consol_max_outside_bars": 10
  }
}
```

### Estructura de una Zona

```python
@dataclass
class Zone:
    id: str                    # UUID único
    min_price: float           # Precio mínimo del rango
    max_price: float           # Precio máximo del rango
    start_timestamp: int       # Timestamp inicio (ms)
    end_timestamp: int         # Timestamp fin (ms)
    touches_support: int       # Toques al soporte
    touches_resistance: int    # Toques a la resistencia
    total_touches: int         # Total de toques
    duration_hours: float      # Duración en horas
    avg_volume: float          # Volumen promedio
    volume_score: float        # Score de volumen (0-100)
    method: str                # Método de detección usado
    score: float               # Score total (0-100)
    candles_in_zone: int       # Cantidad de velas en la zona
    price_range_pct: float     # % de rango de precio
```

## Visualización (ZoneVisualizerIndicator.js)

### Colores por Método

```javascript
colors: {
  pivot_cluster: { fill: 'rgba(74, 111, 165, 0.15)', border: '#4a6fa5' },
  atr_based: { fill: 'rgba(165, 74, 74, 0.15)', border: '#a54a4a' },
  volume_profile: { fill: 'rgba(74, 165, 74, 0.15)', border: '#4aa54a' },
  price_action: { fill: 'rgba(165, 165, 74, 0.15)', border: '#a5a54a' },
  consolidation: { fill: 'rgba(255, 152, 0, 0.20)', border: '#FF9800' }  // Naranja
}
```

### Renderizado de Zonas

- **Rectángulo con relleno semitransparente**
- **Bordes horizontales punteados** (soporte/resistencia)
- **Bordes verticales sólidos** (inicio/fin temporal)
- **Label con número de zona** (`#1`, `#2`, etc.) en fuente bold 16px

### Ordenamiento

Las zonas se ordenan **cronológicamente** (por `start_timestamp`):
- Zona #1 = la más antigua
- Zona #N = la más reciente

Esto permite al usuario navegar las zonas en orden temporal.

## Integración con Backtesting

### Anti-Sesgo de Supervivencia

El parámetro `end_timestamp` filtra las velas para usar solo datos ANTERIORES a la fecha de inicio del playback:

```javascript
// En ZoneDetectorTester.jsx
if (playbackStartTime) {
  requestBody.end_timestamp = playbackStartTime;
}
```

```python
# En main.py - /api/zones/detect
if end_timestamp:
    candles = [c for c in candles if c['timestamp'] < end_timestamp]
```

### Navegación a Zonas

Al hacer click en una zona de la lista:
1. `ZoneDetectorTester` llama a `onZoneClick(zone)`
2. `BacktestingApp` calcula `midTimestamp` y llama a `miniChart.centerOnTimestamp()`
3. `MiniChart` usa `allCandlesRef` para encontrar la vela y actualiza `currentTime`
4. El playback navega a esa fecha mostrando la zona

```javascript
// MiniChart.jsx - centerOnTimestamp
centerOnTimestamp: (timestamp) => {
  // En modo backtesting, usar allCandlesRef para buscar en TODAS las velas
  const sourceCandles = backtestingMode && allCandlesRef.current.length > 0
    ? allCandlesRef.current
    : candlesRef.current;

  // Encontrar vela y actualizar currentTime
  if (backtestingMode && onRequestTimeChange) {
    onRequestTimeChange(targetCandle.timestamp);
  }
}
```

## UI del Modal (ZoneDetectorTester.jsx)

### Tabs Disponibles

1. **Detectar**: Detecta zonas con parámetros configurables
2. **Evaluar**: Evalúa calidad de zonas (win rate, bounces, fakeouts)
3. **Comparar**: Compara todos los métodos entre sí
4. **Optimizar**: Grid search o walk-forward para encontrar mejores parámetros

### Lista de Zonas Detectadas

Cada zona muestra:
- **Número** (#1, #2, etc.) - ordenado cronológicamente
- **Score** (0-100)
- **Método** usado
- **Rango de precios** ($min - $max)
- **Fechas** (inicio → fin)
- **Estadísticas** (toques, duración, vol score)

Click en una zona navega el chart a esa fecha.

## Troubleshooting

**Zonas no aparecen en el gráfico:**
1. Verificar que ZoneVisualizerIndicator está habilitado
2. Verificar `onZonesDetected` llama a `miniChart.setZones()`
3. Revisar consola por logs `[ZoneVisualizer]`

**Zonas demasiado pequeñas/grandes:**
- Ajustar `consol_min_bars` / `consol_max_bars`
- Ajustar `consol_max_range_pct` para el rango vertical

**Zonas se cortan prematuramente:**
- Aumentar `consol_max_outside_bars` (ej: 10-15)
- Verificar que el algoritmo usa la versión v3

**Zonas incluyen movimientos direccionales:**
- El rango vertical NO debe expandirse
- Verificar que `range_high` y `range_low` se fijan en la fase inicial

**Click en zona no navega correctamente:**
- Verificar `onRequestTimeChange` está conectado en BacktestingApp
- Verificar `allCandlesRef` tiene todas las velas cargadas

**Parámetros no se actualizan:**
- Los parámetros vienen del endpoint `/api/zones/methods`
- Reiniciar el backend después de modificar `main.py`
- Verificar que no hay procesos zombie en puerto 9000:
  ```bash
  netstat -ano | findstr :9000
  taskkill /F /PID <pid>
  ```
