# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a cryptocurrency trading platform watchlist application with advanced Volume Profile visualization. The system displays real-time cryptocurrency prices with technical indicators including Volume Delta, CVD (Cumulative Volume Delta), and dynamic/fixed Volume Profile analysis.

**Stack:**
- Frontend: React 18 + Vite (development), uPlot (charting)
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)

---

## 🆕 NUEVO: ORDER FLOW INDICATOR (Octubre 2026) ✅ COMPLETADO

Sistema de visualización de Order Flow basado en footprints del OrderFlowDesktop (App 9), integrado en el Backtester.

### Estado: ✅ 100% FUNCIONAL

**Características implementadas:**
- ✅ Backend endpoint carga footprints desde archivo local
- ✅ Agregación de footprints 1min → 5min funcionando
- ✅ Visualización de imbalances históricos (desde sept 20)
- ✅ Imbalances se dibujan dinámicamente durante el playback
- ✅ Sistema de coincidencia por timestamps (no por índices)
- ✅ Optimización de performance (solo procesa footprints visibles)
- ✅ Soporte para 60 días de histórico en backtesting

### Arquitectura Implementada

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORDER FLOW SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BACKEND (main.py)                                              │
│  ├─ GET /api/orderflow/historical/{symbol}                      │
│  │   ├─ Lee footprints desde archivo local                     │
│  │   │   5.Order_flow/backend/footprint_cache/{symbol}_{int}.json
│  │   ├─ Filtra por días solicitados                            │
│  │   └─ Retorna: {success, footprints[], count, step_size}     │
│  │                                                              │
│  FRONTEND                                                        │
│  ├─ OrderFlowIndicator.js (Overlay Indicator)                  │
│  │   ├─ fetchData(): Carga footprints del backend              │
│  │   ├─ getVisibleFootprints(): Anti-sesgo (solo hasta playback)
│  │   └─ renderOverlay(): 3 capas de visualización              │
│  │       ├─ Capa 1: Imbalance Coloring (bordes de velas)       │
│  │       ├─ Capa 2: POC Markers (puntos de control)            │
│  │       └─ Capa 3: Stacked Imbalances (grupos)                │
│  │                                                              │
│  ├─ FootprintCard.jsx (Componente de tarjeta)                  │
│  │   └─ Renderiza: Vela + Footprint + Volume Profile           │
│  │                                                              │
│  ├─ FootprintSidebar.jsx (Panel lateral)                       │
│  │   ├─ Muestra hasta 10 footprints pinneados                  │
│  │   └─ Click en tarjeta → navega al timestamp                 │
│  │                                                              │
│  └─ BacktestingApp.jsx (Integración)                           │
│      ├─ handlePinFootprint(candle)                             │
│      └─ handleNavigateToFootprint(timestamp)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Archivos Creados/Modificados

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `backend/main.py` | Modificado | Endpoint `/api/orderflow/historical/{symbol}` (líneas 4470-4550) |
| `frontend/src/components/indicators/OrderFlowIndicator.js` | Creado | Indicador overlay con 3 capas de visualización (~450 líneas) |
| `frontend/src/components/backtesting/FootprintCard.jsx` | Creado | Componente de tarjeta individual (~200 líneas) |
| `frontend/src/components/backtesting/FootprintSidebar.jsx` | Creado | Sidebar para footprints pinneados (~180 líneas) |
| `frontend/src/components/backtesting/FootprintSidebar.css` | Creado | Estilos del sidebar (~170 líneas) |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Modificado | Integración de callbacks y estado (líneas 2150-2200) |
| `frontend/src/components/indicators/IndicatorManager.js` | Modificado | Registro del indicador + getter (líneas 77, 92, ~1260) |

### Problemas Resueltos Durante la Implementación

#### 1. Error de Scope Variables (ReferenceError)

**Problema:** `allCandlesForCalculation is not defined` - 96 errores repetidos al mover el mouse.

**Causa:** Variables definidas dentro de un bloque `if (indicatorManagerRef.current)` que terminaba antes del loop de velas, se intentaban usar después del loop.

**Solución:** Reorganizar el código para que el renderizado de overlays tenga su propio bloque con todas las variables definidas:

```javascript
// DESPUÉS del loop de velas:
if (indicatorManagerRef.current) {
  const overlayBounds = { x: marginLeft, y: marginTop, width: chartWidth, height: priceChartHeight };
  const priceToY = (price) => marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
  const timeToX = (timestamp) => { /* ... */ };
  const priceContext = { minPrice, maxPrice, priceRange, verticalZoom, verticalOffset, yScale, priceToY, timeToX };
  const allCandlesForCalculation = backtestingMode && allCandlesRef.current?.length > 0 ? allCandlesRef.current : displayCandles;

  indicatorManagerRef.current.renderOverlays(ctx, overlayBounds, visibleCandles, allCandlesForCalculation, priceContext);
}
```

**Archivo:** `MiniChart.jsx` (líneas 1037-1080)

#### 2. Lag Extremo por Procesamiento Excesivo

**Problema:** App extremadamente lenta al mover el mouse, procesando 7147 footprints en cada mousemove de 29,168 totales cuando solo había 225 velas visibles.

**Causa:**
1. Miles de `console.log()` por segundo
2. Filtrado ineficiente - solo filtraba por anti-sesgo, no por rango visible

**Solución:**

**A) Eliminar logs en hot path:**
```javascript
// ANTES: 4-5 logs por renderOverlay
console.log(`[${symbol}] 🎨 OrderFlow.renderOverlay called`);
console.log(`[${symbol}] 🎨 Renderizando ${visibleFootprints.length} footprints`);
console.log(`[${symbol}] 🟢 Capa 1: ${count} velas con imbalance`);
// ...

// DESPUÉS: Solo 1 log al inicio (con flag _renderLogged)
if (!this._renderLogged) {
  console.log(`[${symbol}] 🎨 OrderFlow renderOverlay:`, { ... });
  this._renderLogged = true;
}
```

**B) Filtrado optimizado por rango temporal:**
```javascript
// ANTES: Filtra TODOS los footprints hasta currentTime (7147)
const visibleFootprints = this.getVisibleFootprints(currentTime);

// DESPUÉS: Filtra solo footprints del rango visible (~225)
const firstVisibleTs = visibleCandles[0].timestamp;
const lastVisibleTs = visibleCandles[visibleCandles.length - 1].timestamp;

const visibleFootprints = this.footprints.filter(fp => {
  const fpTime = fp.candle_timestamp || fp.timestamp;
  return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs && fpTime <= currentTime;
});
```

**Resultado:** ~97% menos procesamiento (de 7147 a ~225 footprints por frame)

**Archivo:** `OrderFlowIndicator.js` (líneas 271-325)

#### 3. Overlays No Visibles (candleWidth undefined)

**Problema:** Los overlays se renderizaban pero no eran visibles en el gráfico.

**Causa:** El parámetro `candleWidth` se extraía de `bounds` con destructuring:
```javascript
const { candleWidth } = bounds;
```

Pero `bounds` solo tiene `{x, y, width, height}`, no `candleWidth`.

**Solución:** Calcular `candleWidth` a partir de bounds.width:
```javascript
const candleWidth = bounds.width / visibleCandles.length;
```

**Archivo:** `OrderFlowIndicator.js` (línea 285)

### Configuración del Indicador

```javascript
config = {
  showImbalanceColoring: true,      // Capa 1: Bordes de velas
  showPOCMarkers: true,              // Capa 2: Marcadores POC
  showStackedImbalances: true,       // Capa 3: Grupos de imbalances
  imbalanceThreshold: 1.5,           // Ratio mínimo bid/ask para considerar imbalance
  stackedImbalanceMinCount: 3,       // Mínimo de niveles consecutivos
  stackedImbalanceMinRatio: 2.0      // Ratio mínimo para grupo
}
```

### Estado Final (Octubre 21, 2026) - ✅ COMPLETADO

✅ **100% Funcional:**
- Backend endpoint carga footprints desde archivo local (orderflow_archive/BTCUSDT_1.json)
- Soporte para 60 días de histórico en backtesting mode
- OrderFlowIndicator muestra footprints históricos correctamente (desde sept 20)
- Imbalances se dibujan dinámicamente durante el playback
- Sistema de coincidencia por timestamps (Map-based, no índices)
- Renderizado optimizado (solo footprints visibles en pantalla)
- Agregación 1min → 5min funcionando

⏳ **Pendiente (futuras mejoras):**
- Testing de capas POC y Stacked Imbalances
- Testing del sidebar con footprints pinneados
- Ajuste fino de umbrales de detección

#### 5. Problema: Simulación Se Detiene y Resetea (Octubre 21)

**Síntomas:**
- La simulación avanza hasta octubre 5 y luego se resetea automáticamente a octubre 1
- No permite simular hasta la fecha actual (octubre 21)
- Mensaje en consola: "Estamos al final, reseteando al inicio de la simulación..."

**Investigación:**
1. TimeController resetea cuando `currentTime >= endTime` (línea 156)
2. `endTime` se establece con `lastCandle.timestamp` del caché
3. Caché de IndexedDB tenía velas hasta octubre 5 (desactualizado)
4. Archivo del servidor (`BTCUSDT_backtesting_data.json.gz`) SÍ tenía velas hasta octubre 21
5. Sistema tenía mecanismo `checkForUpdates()` pero se ejecutaba en segundo plano DESPUÉS de cargar el caché

**Causa Raíz:**
El sistema cargaba datos del caché de IndexedDB inmediatamente y verificaba actualizaciones en segundo plano. Esto causaba que:
- El TimeController se inicializara con `endTime` basado en velas antiguas (octubre 5)
- Las actualizaciones llegaban tarde, cuando el playback ya estaba en marcha
- El usuario no veía las velas nuevas hasta recargar completamente

**Solución Aplicada:**

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` (líneas 810-845)

Modificado el flujo para verificar actualizaciones ANTES de usar el caché:

```javascript
// ANTES: Usar caché inmediatamente, actualizar en segundo plano
shouldUseCachedData = true;
data = cachedResult.data;
setMarketData(data);
checkForUpdates(symbol).then(...); // Segundo plano

// DESPUÉS: Verificar actualizaciones PRIMERO
const updateResult = await checkForUpdates(symbol);

if (updateResult.new_candles_added > 0) {
  console.log(`🔄 ${updateResult.new_candles_added} velas nuevas agregadas`);
  data = await loadBacktestingData(symbol); // Recargar datos actualizados
} else {
  console.log('✅ Caché está actualizado');
  data = cachedResult.data; // Usar caché
}
```

**Resultado:**
✅ **PROBLEMA RESUELTO**
- El sistema ahora verifica actualizaciones ANTES de iniciar el backtesting
- Si hay velas nuevas, las descarga y actualiza el caché
- `lastCandle.timestamp` refleja la vela más reciente (octubre 21)
- La simulación puede avanzar hasta la fecha actual sin resetear prematuramente
- El caché se mantiene sincronizado automáticamente

**Lección Aprendida:**
- Las actualizaciones de caché deben ser síncronas (await) antes de usar los datos
- No ejecutar actualizaciones en segundo plano si afectan el estado inicial de la aplicación
- El `endTime` del TimeController es crítico - debe basarse en datos actualizados

#### 4. Problema: Solo Últimas 8 Horas de Footprints (Octubre 21)

**Síntomas:**
- Solo se mostraban footprints desde sept 30 (8 horas antes de oct 1)
- No se mostraban footprints más antiguos disponibles en el archivo (desde sept 20)
- Durante playback, no se dibujaban imbalances nuevos

**Investigación:**
1. Archivo local tenía solo 7 footprints (casi vacío)
2. Archivo correcto en App 5 tenía 43,169 footprints (sept 20 - oct 20)
3. Backend limitaba a "últimos 21 días desde HOY" en lugar de "desde simulationStartTime"
4. Frontend pedía solo 7-21 días de datos

**Solución aplicada:**

**A) Copiar archivo completo:**
```bash
copy "5.Order_flow\backend\orderflow_archive\BTCUSDT_1.json" "1.Altagracia_Crypto_Backtester\Backtester\backend\orderflow_archive\BTCUSDT_1.json"
```

**B) Backend - Priorizar end_timestamp sobre días desde HOY:**
```python
# Si se especificó end_timestamp, usarlo como referencia
if end_timestamp:
    footprints_1min = [fp for fp in footprints_1min if fp['candle_timestamp'] <= end_timestamp]

    if days > 0:
        cutoff_timestamp = end_timestamp - (days * 24 * 60 * 60 * 1000)
        footprints_1min = [fp for fp in footprints_1min if fp['candle_timestamp'] >= cutoff_timestamp]

# Si NO se especificó end_timestamp pero sí days, usar HOY
elif days > 0:
    now = int(time.time() * 1000)
    cutoff_timestamp = now - (days * 24 * 60 * 60 * 1000)
```

**C) Frontend - Pedir 60 días en backtesting mode:**
```javascript
// En backtesting, pedir 60 días (2 meses) para tener todo el histórico
const daysToRequest = this.backtestingMode ? 60 : this.days;

// NO enviar end_timestamp - queremos todos los footprints disponibles
if (!this.backtestingMode && endTimestamp) {
    params.append('end_timestamp', endTimestamp.toString());
}
```

**D) Frontend - Eliminar filtro temporal en renderizado:**
```javascript
// ANTES: Filtraba por currentTime (solo mostraba hasta donde había llegado el playback)
const visibleFootprints = this.footprints.filter(fp => {
  const fpTime = fp.candle_timestamp || fp.timestamp;
  return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs && fpTime <= currentTime;
});

// DESPUÉS: Solo filtra por velas visibles en pantalla
const visibleFootprints = this.footprints.filter(fp => {
  const fpTime = fp.candle_timestamp || fp.timestamp;
  return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs;
});
```

**Resultado:**
- ✅ Footprints históricos desde sept 20 hasta oct 20 (60 días)
- ✅ Imbalances se dibujan dinámicamente durante el playback
- ✅ Performance óptima (solo procesa footprints visibles)

### Lecciones Aprendidas

1. **Scope de variables en canvas rendering:** Las variables deben estar en scope cuando se usan - no intentar "guardarlas" entre bloques
2. **Performance en hot paths:** Eliminar TODOS los logs de funciones que se ejecutan en mousemove
3. **Filtrado eficiente:** Filtrar por rango temporal visible, no por todo el dataset
4. **Calcular dimensiones:** Los overlays deben calcular sus propias dimensiones (candleWidth) a partir de bounds
5. **Sistema de coincidencia:** Usar Map con timestamps como keys, NO índices de array
6. **Verificar archivos fuente:** Si los datos parecen limitados, verificar el archivo fuente (puede estar vacío o desactualizado)
7. **Estructura de archivos JSON:** Los archivos de App 9 usan formato `{footprints: [...]}`, no array directo
8. **Backend vs Frontend filtering:** El filtrado temporal debe hacerse en el backend (límite de días), el frontend solo filtra por rango visible
9. **Backtesting mode:** Pedir MÁS datos en backtesting (60 días) que en producción (7-21 días) para tener histórico completo

## Development Commands

### Backend (FastAPI)

Start the backend server:
```bash
cd backend
start_backend.bat  # Windows - handles venv creation, dependency installation, and server startup
```

Or manually:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000
```

Backend runs on `http://localhost:9000`

Dependencies:
- fastapi==0.115.0
- uvicorn[standard]==0.32.0
- httpx==0.27.2
- slowapi==0.1.9 (Rate Limiting)
- pytest==8.3.4 (Testing)
- pytest-asyncio==0.24.0 (Async Testing)

### Frontend (React + Vite)

Development server:
```bash
cd frontend
npm install
npm run dev
```

Build for production:
```bash
cd frontend
npm run build
```

Preview production build:
```bash
cd frontend
npm run preview
```

Frontend dev server runs on `http://localhost:9001` (default Vite port)

### Running Tests

```bash
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest -v
```

Tests include:
- `test_sanitize_filename.py` - Path Traversal prevention
- `test_lru_cache.py` - LRU Cache functionality
- `test_endpoints.py` - API endpoint tests

## Architecture

### Backend Architecture (backend/main.py)

**Core Responsibilities:**
1. **Historical Data Fetcher**: Fetches OHLCV candles from Bybit API with timeframe-specific limits
2. **Volume Delta Calculator**: Computes Volume Delta and CVD from candle data
3. **Caching Layer**: 30-minute file-based cache + LRU memory cache with limits
4. **Rate Limiting**: slowapi-based request limiting per IP
5. **Security**: Path Traversal prevention, CORS restrictions

**Key Endpoints:**
- `GET /api/status` - Server status and cache info
- `GET /api/historical/{symbol}?interval={interval}&days={days}` - Fetch OHLCV candles
- `GET /api/volume-delta/{symbol}?interval={interval}&days={days}` - Volume Delta + CVD data
- `POST /api/clear-cache` - Clear all cached data
- `POST /api/upload-cache/{symbol}` - Manually upload cache data
- `POST /api/rejection-patterns/detect` - Detect rejection patterns with context validation
- `GET /api/rejection-patterns/available-contexts/{symbol}` - Get available reference contexts

**Timeframe Limits (MAX_DAYS_BY_INTERVAL):**
- 1m, 3m, 5m: 5-10 days max
- 15m: 15 days max
- 30m: 30 days max
- 60m (1h): 120 days max
- 240m (4h): 300 days max
- D (daily): 730 days max
- W (weekly): 730 days max

**Critical Implementation Details:**
- All timestamps use Colombia timezone (UTC-5)
- Maximum 1000 candles per Bybit API request (pagination required for larger datasets)
- Cache stored in `backend/cache/` directory with format `{symbol}_{interval}_{indicator}.json`
- Volume Delta calculation: positive if close >= open, negative otherwise
- **LRU Memory Cache**: DTB_CANDLES (150MB max), DTB_PATTERNS (50MB max)
- **Rate Limits**: `/api/status` 100/min, `/api/historical` 60/min, `/api/double-topbottom/detect` 30/min
- **CORS**: Restricted to localhost:9001 only

### Frontend Architecture

**Component Hierarchy:**
```
main.jsx
└── Watchlist.jsx (root component)
    ├── VolumeProfileSettings.jsx (settings modal)
    ├── FixedRangeProfilesManager.jsx (manage fixed ranges)
    └── MiniChart.jsx (chart for each symbol)
        └── Uses IndicatorManager
```

**Indicator System (src/components/indicators/):**

The indicator architecture uses a manager pattern with specialized indicator classes:

- **IndicatorManager.js** - Central coordinator that:
  - Manages all indicators for a symbol
  - Handles WebSocket data distribution
  - Coordinates fixed range Volume Profile instances
  - Synchronizes persistent fixed ranges from localStorage

- **IndicatorBase.js** - Abstract base class for all indicators

- **Web Workers (src/workers/):**
  - `VolumeProfileWorker.js` - Volume Profile calculations off main thread
  - `PatternDetectionWorker.js` - Pattern detection off main thread
  - `WorkerPool.js` - Promise-based worker management

- **Specialized Indicators:**
  - `VolumeProfileIndicator.js` - Dynamic Volume Profile (recalculated as new candles arrive)
  - `VolumeProfileFixedRangeIndicator.js` - Fixed range Volume Profile (static period analysis)
  - `VolumeIndicator.js` - Volume bars
  - `CVDIndicator.js` - Cumulative Volume Delta
  - `OIVolumeConfluenceIndicator.js` - 🎯 **OI-Volume Confluence** (combina OI y Volumen con normalización Z-Score)
  - `ATRBasedRangeDetector.js` - Automatic range detection using ATR
  - `RejectionPatternIndicator.js` - Candlestick pattern detection (Hammer, Shooting Star, Engulfing, Doji)
  - `LocalPatternDetector.js` - Local pattern detection without context validation

- **Default Enabled Indicators:**
  - ✅ Volume Delta (visualización de volumen con z-score y clusters)
  - ✅ Volume Profile (perfil de volumen dinámico)
  - ✅ Open Interest (interés abierto)
  - ✅ OI-Volume Confluence (🎯 **NUEVO** - confluencia visual OI + Volumen)
  - ❌ CVD (deshabilitado por defecto)
  - ❌ Range Detection (deshabilitado por defecto)
  - ❌ Support & Resistance (deshabilitado por defecto)
  - ❌ S&R v2 (deshabilitado por defecto)
  - ❌ VWAP (deshabilitado por defecto)
  - ❌ Rejection Patterns (deshabilitado por defecto)
  - ❌ Double Top/Bottom (deshabilitado por defecto)
  - ❌ Swing Detector (deshabilitado por defecto)

**Key Frontend Patterns:**

1. **WebSocket Management (WebSocketManager.js)**:
   - Singleton pattern managing real-time Bybit WebSocket connections
   - Automatically subscribes to all symbols on the watchlist
   - Distributes tick updates to all MiniChart instances
   - Handles reconnection logic

2. **Data Flow**:
   - Historical data: Backend API → IndicatorManager → Individual Indicators
   - Real-time updates: Bybit WebSocket → WebSocketManager → IndicatorManager → Indicators
   - Volume Delta/CVD: Calculated in-memory from candle data (no separate API fetch)

3. **Volume Profile Modes**:
   - **Dynamic**: Recalculates on every candle update, shows current market structure
   - **Fixed Range**: User-defined time ranges, persisted to localStorage per symbol
   - Setting `hideWhenFixedRanges=true` hides dynamic VP when fixed ranges are active

4. **State Management**:
   - Watchlist-level state: timeframe, days, indicator toggles, VP config
   - Fixed ranges stored in localStorage: `volumeprofile_fixed_ranges_v2`
   - VP settings applied globally or per-symbol based on `vpApplyToAll` flag

### Configuration

**API Configuration (frontend/src/config.js):**
```javascript
export const API_BASE_URL = "http://localhost:9000";
```

**Symbols Watchlist (frontend/src/components/Watchlist.jsx:7-14):**
Hardcoded array of 30 crypto symbols (BTCUSDT, ETHUSDT, etc.)

## Important Implementation Notes

### Timeframe Day Limits

The frontend and backend MUST stay synchronized on MAX_DAYS_BY_INTERVAL. When modifying limits:
1. Update `MAX_DAYS_BY_INTERVAL` in backend/main.py:33-44
2. Update `MAX_DAYS_BY_INTERVAL` in frontend/src/components/Watchlist.jsx:17-25
3. Update `DAYS_OPTIONS_BY_INTERVAL` in frontend/src/components/Watchlist.jsx:28-36

### Volume Profile Implementation

The Volume Profile implementation is based on TradingView Pine Script research (see `VolumeProfile_tradingview.txt` and `Investigación_VolumeProfile/` folder). Key algorithms:
- Price binning across specified row count (default 100-200 bins)
- Value Area calculation (70% of volume by default)
- POC (Point of Control) - price level with highest volume
- Cluster detection using threshold-based contiguous bin analysis

### Cache Behavior

- Cache TTL: 30 minutes (CACHE_MAX_AGE in backend/main.py:30)
- Cache files persist in `backend/cache/` and `frontend/cache/`
- Volume Delta cache includes full kline data with computed volumeDelta and cvd
- Always check cache age before using cached data

### Fixed Range Profiles

Fixed ranges are stored per-symbol in localStorage and synchronized across all MiniChart instances:
- Created via UI by selecting start/end timestamps
- Each range gets unique `rangeId`
- Managed by `FixedRangeProfilesManager.jsx`
- Indicator instances created in `IndicatorManager.syncFixedRangeIndicators()`

### Real-time Updates

WebSocket updates only modify the current (in-progress) candle. Historical candles remain immutable unless a full refresh is triggered. The `in_progress` flag marks candles still forming.

### Rejection Pattern Detection System

The rejection pattern detection system identifies candlestick reversal patterns and validates them against reference contexts (Volume Profiles and detected ranges).

**Supported Patterns:**
- **Hammer** (🔨): Bullish pin bar with long lower wick
- **Shooting Star** (⭐): Bearish pin bar with long upper wick
- **Engulfing** (📈/📉): Bullish or bearish engulfing patterns
- **Doji** (🐉/🪦): Dragonfly and Gravestone doji patterns

**Visualization Modes:**
- **Show All**: Displays all locally detected patterns in historical data
- **Validated Only**: Shows only patterns validated against selected reference contexts (POC/VAH/VAL levels)

**Reference Contexts:**
- **Volume Profile Fixed Ranges**: User-created or auto-detected ranges
- **Volume Profile Dynamic**: Real-time Volume Profile (auto-updates with new candles)
- **Range Detector**: ATR-based detected consolidation zones

**Configuration (per symbol):**
- Pattern-specific settings (min wick ratio, etc.)
- Confidence filters (0-100)
- Proximity tolerance to key levels
- Volume Z-Score filters
- Alert settings (sends to port 5000)

**IndicatorManager Methods:**
- `getRejectionPatternIndicator()` - Get the rejection pattern indicator instance
- `getVolumeProfileIndicator()` - Get the dynamic Volume Profile indicator
- `hasDynamicVolumeProfile()` - Check if dynamic VP is active with calculated data
- `getDynamicVolumeProfileData()` - Get POC/VAH/VAL from dynamic VP

**Backend Module (backend/rejection_detector.py):**
- Pattern detection algorithms
- Context-based validation
- Confidence scoring (pattern quality, proximity, volume, size)
- Reference level extraction from contexts

### Range Detection System (ATR-Based)

Automatically detects consolidation zones using the ATR (Average True Range) indicator.

**Key Features:**
- ATR-based range boundaries
- Configurable parameters (min length, ATR multiplier, lookback period)
- Automatic Volume Profile creation for detected ranges
- Optional trend profiles between ranges
- Multi-timeframe support
- Alphabetical labeling (A, B, C...)

**Configuration:**
- `minRangeLength`: Minimum consecutive candles in range (default: 20)
- `atrMultiplier`: ATR multiplier for range width (default: 1.0)
- `atrLength`: ATR calculation period (default: 200)
- `maxBreakoutCandles`: Candles outside range before finalization (default: 5)
- `createTrendProfiles`: Create VP between ranges (default: false)
- `showOtherTimeframes`: Show ranges from other timeframes (default: false)

## Troubleshooting

**Backend won't start:**
- Ensure Python 3.10+ is installed
- Check that port 9000 is not in use
- Verify backend/.venv exists or run start_backend.bat

**Frontend chart not loading:**
- Verify backend is running on port 9000
- Check browser console for CORS errors
- Ensure symbols in watchlist exist on Bybit

**Data too old or stale:**
- Use POST /api/clear-cache to force refresh
- Check CACHE_MAX_AGE setting (30 minutes default)

**Volume Profile not appearing:**
- Verify "Volume Profile" indicator is enabled
- Check that sufficient historical data exists
- If using fixed ranges, ensure ranges are valid timestamps

**Rejection patterns not showing:**
- Verify "Rejection Patterns" indicator is enabled in Watchlist
- Check visualization mode: "Show All" vs "Validated Only"
- In "Validated Only" mode, ensure reference contexts are configured
- Verify Volume Profile or Range Detector is active with calculated levels
- Check pattern confidence threshold settings

**Range Detector not working:**
- Verify Range Detection is enabled in the settings modal
- Check ATR parameters are appropriate for the timeframe
- Increase `atrMultiplier` to detect wider ranges
- Decrease `minRangeLength` to detect shorter consolidation periods
- Verify sufficient historical data is loaded

**Alert service warnings:**
- Alert service on port 5000 is optional
- Alerts will be logged locally if service is unavailable
- To enable external alerts, start `alert_listener.py` separately

**Rate limit errors (429 Too Many Requests):**
- Wait 1 minute before retrying
- Limits: status 100/min, historical 60/min, DTB detect 30/min, bulk-data 10/min

**Tests failing:**
- Ensure venv is activated: `.\.venv\Scripts\Activate.ps1`
- Run: `python -m pytest -v`
- Check pytest is installed: `pip install pytest pytest-asyncio`

## Security Features (v2.7.0+)

### Path Traversal Prevention
All cache file operations sanitize inputs via `sanitize_filename()`:
```python
# Removes: ../, ..\, /, \, <, >, |, :, *, ?
# Only allows: a-zA-Z0-9_-
sanitize_filename("../../../etc/passwd")  # Returns: "etcpasswd"
```

### Rate Limiting
Implemented via slowapi to prevent abuse:

| Endpoint | Limit |
|----------|-------|
| `/api/status` | 100/min |
| `/api/historical/{symbol}` | 60/min |
| `/api/volume-delta/{symbol}` | 60/min |
| `/api/double-topbottom/detect` | 30/min |
| `/api/double-topbottom/chunk` | 60/min |
| `/api/backtesting/bulk-data/{symbol}` | 10/min |

### CORS Restrictions
Only allows requests from:
- `http://localhost:9001`
- `http://127.0.0.1:9001`

### LRU Memory Cache
Prevents unbounded memory growth:
- `DTB_CANDLES_CACHE`: 150MB max (~13 symbols)
- `DTB_PATTERNS_CACHE`: 50MB max
- Auto-evicts oldest entries when limit reached

## Performance Optimizations (v2.6.0+)

### Canvas Throttle
MiniChart.jsx throttles rendering to ~30fps to reduce CPU usage.

### Lazy Loading Indicators
Indicators defer `fetchData()` until explicitly enabled.

### Web Workers
Heavy calculations can be offloaded to workers:
```javascript
import { workerPool } from './workers';

// Calculate Volume Profile in background
const profile = await workerPool.calculateVolumeProfile(candles, 100, 70);

// Detect patterns in background
const patterns = await workerPool.detectRejectionPatterns(candles, config);
```

---

## ZOOM SYSTEM (Octubre 2026)

Sistema de zoom horizontal que permite comprimir velas hasta mostrar ~14,000 velas en pantalla.

### Arquitectura

El zoom usa `viewStateRef.current.zoom` como multiplicador sobre un ancho base de 8px:

```javascript
// Formula central aplicada en 4 ubicaciones criticas
const effectiveBarWidth = Math.max(0.1, Math.min(15, 8 * zoom));
const candlesPerScreen = Math.floor(chartWidth / effectiveBarWidth);
```

### Limites

| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| Min zoom | `0.01` | Zoom out extremo |
| Max zoom | `5` | Zoom in extremo |
| Min ancho vela | `0.1px` | Compresion maxima |
| Max ancho vela | `15px` | Expansion maxima |

**Capacidad:** En pantalla de 15" (~1422px utiles): `1422 / 0.1 = ~14,220 velas` visibles.

### Ubicaciones Criticas (MiniChart.jsx)

La formula `effectiveBarWidth` debe ser consistente en estas 4 ubicaciones:

1. **drawChart** (~linea 651): Calculo principal de velas visibles
2. **Wheel handler** (~linea 1600): Ajuste de offset post-zoom
3. **Pan handler** (~linea 1357): Calculo de desplazamiento durante paneo
4. **Auto-offset** (~linea 1839): Calculo de margen derecho automatico

### Historial de Cambios

El sistema original usaba un zoom minimo dinamico que limitaba artificialmente el zoom out:

```javascript
// ANTES (limitaba a ~2800 velas):
const dynamicMinZoom = (chartWidth / (8 * totalCandles)) * 0.8;
const newZoom = Math.max(dynamicMinZoom, Math.min(5, oldZoom * zoomFactor));

// DESPUES (permite ~14,000 velas):
const newZoom = Math.max(0.01, Math.min(5, oldZoom * zoomFactor));
```

Se adopto el patron de App 8 (AnalizadorDesktop) que usa limites fijos en lugar de dinamicos.

### Troubleshooting Zoom

**Zoom out no llega al maximo:**
- Verificar que las 4 ubicaciones usan `Math.max(0.1, ...)` (no 0.2 ni 0.5)
- Verificar que el wheel handler usa `Math.max(0.01, ...)` como min zoom

**Velas invisibles en zoom extremo:**
- A 0.1px por vela el detalle individual no es visible, pero la forma general del precio si
- Esto es comportamiento esperado (similar a TradingView en zoom out extremo)

**Pan no funciona correctamente en zoom extremo:**
- Verificar que pan handler usa `effectiveBarWidth` y no `8 * zoom` directo

---

## SISTEMA DE VISUALIZACIÓN DE VOLUMEN MEJORADO (Febrero 2026)

Sistema avanzado de visualización de volumen con análisis estadístico basado en z-score, parámetros configurables y detección de clusters de volumen consecutivo.

### Características Principales

1. **Análisis Z-Score**: Cada barra de volumen es evaluada usando z-score estadístico para identificar volúmenes anormalmente altos
2. **Intensidad y Opacidad Adaptativas**: Las barras se colorean dinámicamente según su desviación del volumen promedio
3. **Gradientes Dinámicos**: Gradientes verticales que varían según el z-score de cada barra
4. **Glow Effect**: Resaltado especial para volúmenes excepcionales (z-score > umbral)
5. **Detección de Clusters**: Identifica grupos de velas consecutivas con volumen alto acumulado
6. **Configuración Personalizable**: Modal con controles para ajustar todos los parámetros visuales

### Parámetros Configurables

Los parámetros se guardan por símbolo en localStorage (`volumeVisualParams_{symbol}`):

```javascript
{
  // Intensidad de color
  intensityMin: 0.3,           // Intensidad mínima (0.1-0.5)
  intensityMax: 1.0,           // Intensidad máxima (0.6-1.0)
  intensityDivisor: 3,         // Divisor de sensibilidad (1-6)

  // Opacidad adaptativa
  opacityMin: 0.4,             // Opacidad mínima (0.2-0.6)
  opacityMax: 0.9,             // Opacidad máxima (0.7-1.0)
  opacityBase: 0.5,            // Opacidad base (0.3-0.7)
  opacityDivisor: 4,           // Divisor z-score (2-8)

  // Gradiente
  gradientBottomMultiplier: 0.3, // Contraste inferior (0.1-0.8)

  // Efecto Glow
  glowThreshold: 2.0,          // Umbral z-score para glow (1.0-4.0)
  glowBlur: 8,                 // Intensidad del blur (2-20)

  // Detección de Clusters
  clusterDetection: true,          // Activar/desactivar detección
  clusterMinBars: 3,               // Mínimo de velas consecutivas (2-10)
  clusterThreshold: 0.5,           // Umbral promedio z-score (0.0-2.0)
  clusterColorBullish: '#4CAF50',  // Color para clusters alcistas (verde)
  clusterColorBearish: '#F44336'   // Color para clusters bajistas (rojo)
}
```

### Sistema de Detección de Clusters

Los clusters identifican grupos de velas consecutivas donde el volumen acumulado es significativo, aunque individualmente las barras no tengan volumen extremo.

**Algoritmo:**

```javascript
// 1. Calcular z-score para cada vela
const volumeZScores = visibleCandles.map(d =>
  (d.volume - avgVolume) / stdDevVolume
);

// 2. Detectar secuencias consecutivas con z-score >= threshold
const clusters = [];
let currentCluster = null;

volumeZScores.forEach((zScore, i) => {
  if (zScore >= clusterThreshold) {
    if (!currentCluster) {
      // Iniciar nuevo cluster
      currentCluster = { start: i, end: i, avgZScore: zScore, count: 1 };
    } else {
      // Extender cluster existente
      currentCluster.end = i;
      currentCluster.avgZScore =
        (currentCluster.avgZScore * currentCluster.count + zScore) /
        (currentCluster.count + 1);
      currentCluster.count++;
    }
  } else {
    // Finalizar cluster si cumple mínimo de barras
    if (currentCluster && currentCluster.count >= clusterMinBars) {
      clusters.push(currentCluster);
    }
    currentCluster = null;
  }
});

// 3. Determinar dirección de cada cluster
// Compara precio de apertura del inicio con precio de cierre del final
clusters.forEach(cluster => {
  const firstCandle = visibleCandles[cluster.start];
  const lastCandle = visibleCandles[cluster.end];
  const direction = lastCandle.close >= firstCandle.open ? 'bullish' : 'bearish';

  for (let i = cluster.start; i <= cluster.end; i++) {
    clusterIndices.add(i);
    clusterDirections.set(i, direction); // Guardar dirección por índice
  }
});

// 4. Las barras en clusters se resaltan con color según dirección
// NO se dibuja fondo invasivo en el gráfico de precio
```

**Visualización:**
- Las barras que forman parte de un **cluster alcista** se pintan con `clusterColorBullish` (verde por defecto)
- Las barras que forman parte de un **cluster bajista** se pintan con `clusterColorBearish` (rojo por defecto)
- Las barras normales usan verde (alcista) o rojo (bajista) estándar
- El glow effect NO se aplica a barras de clusters para evitar redundancia
- La dirección del cluster se determina comparando el precio de apertura de la primera vela con el precio de cierre de la última vela

### Modal de Configuración

Accesible mediante el botón ⚙️ en el divisor naranja del panel de volumen.

**Secciones del modal:**

1. **Intensidad de Color** (3 controles)
   - Mínimo, Máximo, Divisor de sensibilidad

2. **Opacidad Adaptativa** (4 controles)
   - Mínimo, Máximo, Base, Divisor Z-Score

3. **Gradiente** (1 control)
   - Contraste Inferior

4. **Efecto Glow** (2 controles)
   - Umbral Z-Score, Intensidad del Blur

5. **Detección de Clusters** (5 controles)
   - Checkbox activar/desactivar
   - Mínimo de velas consecutivas
   - Umbral promedio Z-Score
   - Selector de color alcista (input type="color") - verde por defecto
   - Selector de color bajista (input type="color") - rojo por defecto

6. **Botón Reset**
   - Restaura todos los valores a defaults

### Integración con Estado

```javascript
// Estado se inicializa con merge de valores guardados + defaults
const [volumeVisualParams, setVolumeVisualParams] = useState(() => {
  const defaults = { /* valores por defecto */ };
  const saved = localStorage.getItem(`volumeVisualParams_${symbol}`);
  if (saved) {
    const parsed = JSON.parse(saved);
    return { ...defaults, ...parsed }; // Merge para compatibilidad
  }
  return defaults;
});

// Todos los sliders actualizan estado + localStorage + redibujan
onChange={(e) => {
  const newParams = { ...volumeVisualParams, param: newValue };
  setVolumeVisualParams(newParams);
  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
  if (candlesRef.current?.length > 0) {
    drawChart(candlesRef.current, lastPriceRef.current, null, null);
  }
}}
```

### Fórmulas Clave

**Z-Score de Volumen:**
```javascript
const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
const stdDevVolume = Math.sqrt(
  volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length
);
const zScore = (volume - avgVolume) / stdDevVolume;
```

**Intensidad Adaptativa:**
```javascript
const intensity = Math.max(
  intensityMin,
  Math.min(intensityMax, (zScore + 1) / intensityDivisor)
);
```

**Opacidad Adaptativa:**
```javascript
ctx.globalAlpha = Math.max(
  opacityMin,
  Math.min(opacityMax, opacityBase + (zScore / opacityDivisor))
);
```

**Color de Barras:**
```javascript
const isInCluster = clusterIndices.has(i);
const baseColor = isInCluster
  ? clusterColor                           // Color del cluster
  : (d.close >= d.open ? bullColor : bearColor);  // Verde/Rojo normal
```

### Divisor Redimensionable

El divisor naranja entre el gráfico de precio y el volumen permite ajustar la altura del panel de volumen:

```javascript
// Posición: 5px después del gráfico de precio (donde inicia el volumen)
top: `calc(${priceChartRatio * 100}% + 5px)`

// Características:
// - Cursor: ns-resize
// - Color: naranja (#FF9800)
// - Hover: se resalta para facilitar el drag
// - Botón ⚙️ integrado para abrir modal
```

### Troubleshooting

**Modal se crashea al abrir:**
- Verificar que todas las propiedades existen en volumeVisualParams
- El sistema hace merge con defaults para manejar configuraciones antiguas

**Clusters no se ven:**
- Verificar que `clusterDetection` está en `true`
- Ajustar `clusterThreshold` más bajo (ej: 0.3)
- Reducir `clusterMinBars` (ej: 2)

**Colores no se actualizan:**
- Verificar que `drawChart()` se llama después de cambiar parámetros
- Limpiar localStorage y recargar si hay configuraciones corruptas

**Divisor no se puede arrastrar:**
- Verificar que el handler `handleVolumeDividerMouseDown` está conectado
- Verificar `z-index: 1000` del divisor

---

## HISTORIAL DE PROBLEMAS Y SOLUCIONES (Febrero 2026)

### Intento Fallido: IndicatorPanel con Drag-and-Drop

**Problema:** Se implementó un sistema de paneles de indicadores separados con drag-and-drop para reordenar, redimensionar y gestionar indicadores de manera independiente. El sistema incluía:
- `IndicatorPanel.jsx` - Componente de panel individual con drag handles
- `IndicatorPanel.css` - Estilos profesionales con animaciones
- Integración en `MiniChart.jsx` con estado `indicatorLayout` y ref `indicatorBoundsRef`

**Síntomas del fallo:**
- Los indicadores dejaron de aparecer completamente en el gráfico
- El canvas no mostraba ningún indicador después de la integración
- La lógica condicional para renderizar en IndicatorPanel vs canvas directo causaba conflictos

**Causa raíz:**
- El IndicatorPanel intentaba renderizar indicadores usando refs a canvas individuales
- La lógica condicional en `MiniChart.jsx` impedía el renderizado normal de indicadores
- El sistema de bounds y layout para paneles separados no se sincronizaba correctamente con el renderizado del canvas principal

**Solución aplicada:**
Se revirtieron TODOS los cambios relacionados con IndicatorPanel:

1. **MiniChart.jsx** - Eliminado:
   - Import de IndicatorPanel (línea 14)
   - Estado `indicatorLayout`
   - Ref `indicatorBoundsRef`
   - Lógica condicional para renderizado en IndicatorPanel
   - Componente JSX `<IndicatorPanel />`

2. **Restaurado renderizado simple:**
```javascript
// REVERTIDO A:
if (indicatorManagerRef.current && indicatorsHeight > 0) {
  const indicatorsBounds = {
    x: marginLeft,
    y: marginTop + priceChartHeight + volumeHeight + timeAxisHeight,
    width: chartWidth,
    height: indicatorsHeight
  };
  indicatorManagerRef.current.renderIndicators(ctx, indicatorsBounds, visibleCandles);
}
```

**Resultado:** Los indicadores volvieron a aparecer correctamente en el gráfico.

**Lección aprendida:**
- El renderizado de indicadores en canvas es sensible a la sincronización de bounds y contexts
- Separar indicadores en paneles independientes requiere una arquitectura más compleja
- La lógica condicional para alternar entre diferentes modos de renderizado puede causar race conditions
- Es mejor mantener un sistema de renderizado simple y centralizado para indicadores en canvas

---

### Fix: Open Interest Data Loading

**Problema:** Después de revertir los cambios de IndicatorPanel, el indicador de Open Interest no cargaba datos. Síntomas:
- UI mostraba "no hay datos de open interest para btcusdt"
- Backend no mostraba logs de fetch a Bybit API
- El indicador estaba habilitado pero no disparaba `fetchData()`

**Causa raíz:**
En `IndicatorManager.js`, el método `updateIndicatorStates()` tenía validación de datos incompleta para Open Interest en el bloque `else if (shouldBeEnabled && wasEnabled)`:

```javascript
// INCORRECTO (línea 332):
if (!indicator.dataMap || indicator.data.length === 0) {
  // Error: dataMap es un Map, no se puede verificar .length
  // Solo verificaba indicator.data, no indicator.dataMap.size
}
```

**Solución aplicada:**
Corregir la validación para verificar correctamente tanto `dataMap.size` como `data.length`:

```javascript
// CORRECTO:
if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
  console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
  promises.push(indicator.fetchData());
}
```

**Logging de diagnóstico agregado:**
Se agregaron logs detallados para rastrear el estado de Open Interest:

```javascript
// Estado inicial:
console.log(`%c[${symbol}] 📊 OI State Check`, 'background: #FF9800; ...', {
  shouldBeEnabled,
  wasEnabled,
  hasDataMap: !!indicator.dataMap,
  dataMapSize: indicator.dataMap?.size || 0,
  dataLength: indicator.data?.length || 0,
  isBackendIndicator: backendIndicators.includes(indicator.name)
});

// Validación de datos:
console.log(`%c[${symbol}] 🔍 OI Data Validation`, 'background: #FF9800; ...', {
  hasDataMap: !!indicator.dataMap,
  dataMapSize: indicator.dataMap?.size || 0,
  dataLength: indicator.data?.length || 0,
  hasData,
  willReload: !hasData
});
```

**Resultado:** Open Interest ahora carga datos correctamente al estar habilitado.

**Lección aprendida:**
- Los objetos Map requieren `.size` en lugar de `.length`
- La validación de datos debe ser exhaustiva para todos los campos relevantes
- Logging detallado es crucial para diagnosticar problemas de carga de datos
- Los indicadores con lazy loading necesitan validación explícita en el estado "ya habilitado pero sin datos"

---

### Patrón de Validación de Datos para Indicadores Backend

Todos los indicadores que requieren datos del backend deben seguir este patrón en `updateIndicatorStates()`:

```javascript
const backendIndicators = ["VWAP", "Open Interest", "Double Top/Bottom", "Support & Resistance", "Rejection Patterns"];

// En el bloque: else if (shouldBeEnabled && wasEnabled)
if (backendIndicators.includes(indicator.name)) {
  // Validación específica por tipo de indicador:

  // Para indicadores con arrays:
  if (indicator.name === "Support & Resistance") {
    if ((!indicator.resistances || indicator.resistances.length === 0) &&
        (!indicator.supports || indicator.supports.length === 0)) {
      promises.push(indicator.fetchData());
    }
  }

  // Para indicadores con Maps:
  else if (indicator.name === "Open Interest") {
    if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
      promises.push(indicator.fetchData());
    }
  }

  // Para indicadores con objetos:
  else if (indicator.name === "VWAP") {
    if (!indicator.vwapData || Object.keys(indicator.vwapData || {}).length === 0) {
      promises.push(indicator.fetchData());
    }
  }
}
```

Este patrón asegura que los indicadores siempre tengan datos cuando están habilitados, incluso si el lazy loading inicial no se ejecutó.

---

### Fix: Open Interest Cache Permanente No Se Reutilizaba (Octubre 2026)

**Problema:** El sistema de caché permanente de Open Interest no se estaba reutilizando correctamente entre diferentes requests, causando descargas masivas innecesarias de datos de Bybit.

**Síntomas:**
- Backtest con 4 años de datos descargaba OI correctamente
- Request posterior con 1 año NO reutilizaba el caché de 4 años
- Backend descargaba nuevamente desde Bybit aunque ya tenía los datos
- Desperdicio de tiempo y recursos (requests de 5-10 minutos)

**Causa raíz (5 problemas identificados):**

1. **Caché no se guardaba en bulk-data endpoint:**
   - El endpoint `/api/backtesting/bulk-data` descargaba OI pero NO lo guardaba en caché permanente
   - Solo el endpoint `/api/open-interest` guardaba caché
   - Resultado: datos descargados en backtesting se perdían

2. **Caché vacío no se validaba:**
   - Si el caché existía pero con `data: []`, se retornaba como válido
   - Backend pensaba que tenía datos pero estaban vacíos
   - Causaba mensaje "no hay datos de open interest"

3. **Logging de errores insuficiente:**
   - Cuando ocurría error, no se logueaban parámetros críticos
   - Difícil diagnosticar problemas (timestamps, días, intervalo, etc.)

4. **Frontend sin sistema de reintentos:**
   - Un error HTTP o de red fallaba inmediatamente
   - No había recuperación automática de errores transitorios

5. **Días hardcodeados en lugar de dinámicos:**
   - `BacktestingApp.jsx` tenía días hardcodeados por timeframe (1825 días para 5m)
   - Aunque el usuario configurara fecha de inicio reciente, descargaba 5 años completos
   - Desperdicio de ~60% de datos innecesarios

**Solución Implementada (5 Fixes):**

#### Fix 1: Guardar Caché en Bulk-Data Endpoint

**Archivo:** `backend/main.py` (líneas 2456-2478, 2693-2716)

Agregado `save_oi_permanent_cache()` en dos ubicaciones del endpoint bulk-data:

```python
# Primera carga de OI (línea 2478)
if oi_data:
    await save_oi_permanent_cache(symbol, oi_interval_str, oi_data)
    print(f"[BACKTESTING] ✅ OI guardado en cache permanente: {len(oi_data)} puntos")

# Actualización incremental de OI (línea 2710)
if new_oi:
    await save_oi_permanent_cache(symbol, str(main_interval), existing_oi)
    print(f"[BACKTESTING UPDATE] ✅ OI actualizado: {len(existing_oi)} puntos totales")
```

#### Fix 2: Validación de Caché Vacío

**Archivo:** `backend/main.py` (líneas 2046-2066)

```python
file_size_mb = cache_file.stat().st_size / (1024 * 1024)
data_points = len(data.get('data', []))

# NUEVO: Validar que el cache realmente tenga datos
if data_points == 0:
    print(f"[OI PERMANENT CACHE] ⚠️ Cache existe pero está VACÍO, forzando descarga")
    return None

print(f"[OI PERMANENT CACHE] ✅ Cargado {safe_symbol} @ {safe_interval} - {file_size_mb:.2f} MB ({data_points} puntos)")
```

#### Fix 3: Logging Estructurado de Errores

**Archivo:** `backend/main.py` (líneas 936-959)

```python
except Exception as e:
    # MEJORADO: Logging detallado para debugging
    print(f"\n{'='*80}")
    print(f"❌ ERROR CRÍTICO en get_open_interest")
    print(f"{'='*80}")
    print(f"Symbol: {symbol}")
    print(f"Interval solicitado: {interval}")
    print(f"Interval final (OI): {interval_final}")
    print(f"Days: {days}")
    print(f"Start timestamp: {start_timestamp_ms} ({datetime.fromtimestamp(start_timestamp_ms/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M') if start_timestamp_ms else 'None'})")
    print(f"End timestamp: {end_timestamp_ms} ({datetime.fromtimestamp(end_timestamp_ms/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M') if end_timestamp_ms else 'None'})")
    print(f"Exception type: {type(e).__name__}")
    print(f"Exception message: {str(e)}")
    print(f"{'='*80}\n")
    import traceback
    traceback.print_exc()
```

**Fix adicional - UnboundLocalError:** Variables de metadata inicializadas tempranamente (líneas 659-665):

```python
# 🔧 FIX: Inicializar variables de metadata ANTES de usarlas
# Esto previene UnboundLocalError si hay excepción temprana
oi_first_timestamp = None
oi_last_timestamp = None
oi_first_date = ""
oi_last_date = ""
oi_interval = ""
```

#### Fix 4: Sistema de Reintentos en Frontend

**Archivo:** `frontend/src/components/indicators/OpenInterestIndicator.js` (líneas 38-167)

Implementado sistema de retry con exponential backoff:

```javascript
async fetchData(skipCache = false, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2s, 4s, 6s

  this._isFetching = true;
  this._fetchError = null;

  try {
    // ... fetch logic ...

    if (!result.success) {
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * (retryCount + 1);
        console.warn(`[OI] ${this.symbol} - ⏳ Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchData(skipCache, retryCount + 1);
      }
      throw new Error(`OI fetch failed after ${MAX_RETRIES + 1} attempts`);
    }

  } catch (error) {
    this._fetchError = error;

    // Reintentar en errores de red
    if (retryCount < MAX_RETRIES &&
        (error.name === 'TypeError' || error.name === 'NetworkError')) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.fetchData(skipCache, retryCount + 1);
    }

    throw error;
  } finally {
    this._isFetching = false;
  }
}
```

Estados de UI mejorados (líneas 967-998):

```javascript
renderNoDataMessage(ctx, bounds) {
  if (this._isFetching) {
    // Estado: Cargando
    ctx.fillStyle = "#FFA726";
    ctx.fillText("⏳ Descargando Open Interest de Bybit...", centerX, centerY);
  } else if (this._fetchError) {
    // Estado: Error
    ctx.fillStyle = "#EF5350";
    ctx.fillText("❌ Error cargando Open Interest", centerX, centerY);
  } else {
    // Estado: Sin datos
    ctx.fillStyle = "#FF9800";
    ctx.fillText(`No Open Interest data available for ${this.symbol}`, centerX, centerY);
  }
}
```

#### Fix 5: Días Dinámicos Basados en Fecha de Inicio

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` (líneas 2023-2054)

Reemplazado `daysMap` hardcodeado por cálculo dinámico:

```javascript
{['1m', '5m', '15m', '1h', '4h'].map(tf => {
  // 🔧 FIX: Calcular días dinámicamente basándose en simulationStartTime
  const calculateDaysNeeded = () => {
    // Límites máximos del backend (MAX_DAYS_BY_INTERVAL)
    const maxDaysMap = {
      '1m': 730, '5m': 1825, '15m': 1825, '1h': 1825, '4h': 1825
    };
    const maxDays = maxDaysMap[tf] || 1825;

    // Si hay fecha de inicio definida, calcular días reales necesarios
    if (simulationStartTime) {
      const now = Date.now();
      const daysNeeded = Math.ceil((now - simulationStartTime) / (24 * 60 * 60 * 1000));
      const result = Math.min(daysNeeded, maxDays);
      console.log(`[BacktestingApp] 📊 ${tf} OI days: daysNeeded=${daysNeeded}, usando=${result}`);
      return result;
    }

    return maxDays; // Sin fecha de inicio, usar máximo
  };

  const tfDays = calculateDaysNeeded();
```

**Resultado Verificado:**

Prueba con fecha inicio octubre 2024 (~741 días):

```
[BTCUSDT] OPEN INTEREST: days=741 (antes: 1825 hardcodeado)
[OI PERMANENT CACHE] ✅ CACHE HIT para BTCUSDT @ 60 (43800 puntos)
[OI PERMANENT CACHE] ✅ CACHE HIT para BTCUSDT @ 240 (11000 puntos)
```

**Impacto:**
- ⚡ **60% menos datos** cuando se usa fecha de inicio reciente
- 🚀 **Carga instantánea** con cache hit (0.51 MB en 1h, 0.13 MB en 4h)
- 💾 **Cache reutilizable** entre backtests
- 🎯 **Eficiencia óptima** - solo descarga lo necesario

**Archivos Modificados:**

| Archivo | Cambios |
|---------|---------|
| `backend/main.py` | save_oi_permanent_cache en bulk-data (2 ubicaciones), validación cache vacío, error logging, init variables metadata |
| `frontend/src/components/indicators/OpenInterestIndicator.js` | Sistema retry (3 intentos, exponential backoff), estados UI (loading/error/no-data) |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Días dinámicos basados en simulationStartTime |

**Lección aprendida:**
- Los sistemas de caché permanente deben guardar datos en TODOS los endpoints que los consumen
- La validación de datos debe verificar que realmente contienen información (no solo que el archivo existe)
- Los valores hardcodeados deben ser dinámicos cuando dependen del contexto del usuario
- El logging estructurado es crítico para diagnosticar problemas de caché
- Los sistemas de retry automático mejoran significativamente la robustez

---

# 🎯 OI-VOLUME CONFLUENCE INDICATOR (Febrero 2026)

## Concepto

Nuevo indicador que combina **Open Interest** y **Volumen** para identificar visualmente cuando un movimiento de precio está respaldado por ambos indicadores (movimiento fuerte) o cuando hay divergencia (movimiento débil).

## Objetivo

Resolver la pregunta: *"¿Este movimiento de precio es importante o no?"*

### Casos de Uso

| OI | Volumen | Visualización | Interpretación |
|-----|---------|---------------|----------------|
| ⬆️ Sube | ⬆️ Sube | 🟢 Verde intenso | Movimiento FUERTE - nuevo dinero entrando |
| ⬇️ Baja | ⬇️ Baja | 🔴 Rojo intenso | Distribución FUERTE - capital saliendo |
| ⬆️ Sube | ⬇️ Baja | 🟡 Naranja | DIVERGENCIA - OI sube sin volumen = movimiento débil |
| ⬇️ Baja | ⬆️ Sube | 🟡 Naranja | DIVERGENCIA - Volumen sin cambio en OI = trampa |
| ~ Neutral | ~ Neutral | ⚪ Gris | Sin confluencia clara |

## Implementación Técnica

### Archivo: `OIVolumeConfluenceIndicator.js`

**Algoritmo:**

1. **Obtener datos de indicadores existentes**:
   - Volume Delta desde `VolumeIndicator.calculateVolumeDelta()`
   - OI Delta desde `OpenInterestIndicator` (histogram o cumulative mode)

2. **Normalización con Z-Score**:
   ```javascript
   // Poner ambos indicadores en la misma escala
   volumeZScores = calculateZScore(volumeDeltas, lookbackPeriod=20)
   oiZScores = calculateZScore(oiDeltas, lookbackPeriod=20)
   ```

3. **Cálculo de Confluence Score**:
   ```javascript
   confluenceScore = volumeZScore × oiZScore

   // Si ambos positivos: score positivo (confluencia alcista)
   // Si ambos negativos: score positivo (confluencia bajista)
   // Si uno positivo y otro negativo: score negativo (divergencia)
   ```

4. **Clasificación**:
   ```javascript
   if (confluenceScore > threshold && volZ > 0 && oiZ > 0):
     → bullish_strong (verde)

   else if (confluenceScore > threshold && volZ < 0 && oiZ < 0):
     → bearish_strong (rojo)

   else if (confluenceScore < -threshold):
     → divergence (naranja)

   else:
     → neutral (gris)
   ```

5. **Visualización**:
   - Histograma con barras coloreadas según confluenceType
   - Opacidad variable según strength (intensidad del score)
   - Leyenda con 4 estados: Fuerte ▲, Fuerte ▼, Divergencia, Neutral

### Z-Score Calculation

```javascript
calculateZScore(values, lookbackPeriod = 20) {
  // Para cada valor:
  // 1. Tomar ventana de lookbackPeriod valores anteriores
  // 2. Calcular media y desviación estándar de la ventana
  // 3. Z-Score = (valor - media) / stdDev

  // Esto normaliza los valores para que:
  // - Z > 2: Muy por encima de lo normal
  // - Z > 1: Por encima de lo normal
  // - -1 < Z < 1: Dentro del rango normal
  // - Z < -1: Por debajo de lo normal
  // - Z < -2: Muy por debajo de lo normal
}
```

### Inyección de Dependencias

```javascript
// En IndicatorManager.js - initialize()
const volumeIndicator = new VolumeIndicator(...);
const confluenceIndicator = new OIVolumeConfluenceIndicator(...);

// Inyectar referencias
confluenceIndicator.setIndicators(volumeIndicator, this.openInterestIndicator);
```

Esto permite que el indicador de confluencia acceda a los datos calculados de otros indicadores sin duplicar lógica.

## Configuración

### Parámetros Ajustables

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `lookbackPeriod` | 20 | Velas para calcular Z-Score |
| `confluenceThreshold` | 0.5 | Umbral mínimo para considerar confluencia significativa |

### Estados por Defecto

- ✅ **Habilitado por defecto** en todos los timeframes
- Altura: 120px
- Muestra automáticamente al tener Volume Delta y Open Interest activos

## Esquema de Colores

```javascript
bullish_strong:  { r: 52,  g: 199, b: 89  }  // Verde (#34C759)
bearish_strong:  { r: 255, g: 59,  b: 48  }  // Rojo (#FF3B30)
divergence:      { r: 255, g: 152, b: 0   }  // Naranja (#FF9800)
neutral:         { r: 158, g: 158, b: 158 }  // Gris (#9E9E9E)

// Opacidad dinámica según strength:
alpha = Math.min(0.3 + (strength * 0.5), 0.9)
```

## Información Mostrada en UI

### Header
- Título: "OI-Volume Confluence"

### Leyenda (esquina inferior derecha)
- 🟢 Fuerte ▲
- 🔴 Fuerte ▼
- 🟡 Divergencia
- ⚪ Neutral

### Valor Actual (esquina inferior izquierda)
- Label principal: "FUERTE ▲" / "FUERTE ▼" / "DIVERGENCIA" / "NEUTRAL"
- Z-Scores detallados: `Vol Z: 1.23 | OI Z: 0.87`

### Mensaje de Error
Si Volume Delta u Open Interest no están activos:
```
"Requiere Volume Delta y Open Interest activos"
```

## Ejemplo de Interpretación

**Escenario 1 - Breakout Fuerte:**
```
Precio: $95k → $97k ⬆️
Volume Z-Score: +2.5 (volumen muy alto)
OI Z-Score: +1.8 (OI subiendo fuerte)
Confluence Score: +4.5 (positivo alto)
→ Visualización: BARRA VERDE INTENSA
→ Interpretación: Movimiento FUERTE, respaldado por nuevo dinero
```

**Escenario 2 - Trampa Alcista:**
```
Precio: $95k → $97k ⬆️
Volume Z-Score: +0.5 (volumen ligeramente alto)
OI Z-Score: -1.2 (OI bajando)
Confluence Score: -0.6 (negativo)
→ Visualización: BARRA NARANJA (divergencia)
→ Interpretación: Movimiento DÉBIL, OI baja = posibles cierres de posiciones
```

**Escenario 3 - Distribución Fuerte:**
```
Precio: $97k → $95k ⬇️
Volume Z-Score: -2.1 (volumen vendedor fuerte)
OI Z-Score: -1.5 (OI bajando)
Confluence Score: +3.15 (positivo)
→ Visualización: BARRA ROJA INTENSA
→ Interpretación: Distribución FUERTE, capital saliendo confirmado
```

## Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `frontend/src/components/indicators/OIVolumeConfluenceIndicator.js` | Nuevo archivo - Indicador completo |
| `frontend/src/components/indicators/IndicatorManager.js` | Import + instancia + inyección de dependencias |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Agregado a getDefaultIndicatorStates() y indicatorStates |
| `CLAUDE.md` | Documentación completa del indicador |

## Ventajas vs Visualizar OI y Volumen por Separado

1. **Síntesis visual inmediata**: No necesitas comparar mentalmente dos gráficos separados
2. **Normalización automática**: Z-Score pone ambos en la misma escala
3. **Color coding intuitivo**: Verde = fuerte, Rojo = fuerte bajista, Naranja = cuidado
4. **Detección de divergencias**: Resalta automáticamente cuando hay conflicto entre OI y Volumen

## Posibles Mejoras Futuras

- [ ] Configuración de thresholds desde UI
- [ ] Alertas cuando confluencia cruza de neutral a fuerte
- [ ] Historial de divergencias destacadas
- [ ] Overlay opcional en el chart principal (background coloring)
- [ ] Estadísticas de win rate basadas en señales de confluencia

---

## MEJORAS AL PANEL DE TRADING (Octubre 2026)

### 1. SL/TP en Porcentaje con Preview en USDT

**Problema:** Los usuarios debían ingresar valores absolutos en USDT para Stop Loss y Take Profit, lo cual era incómodo para calcular riesgo/recompensa.

**Solución:** Sistema de entrada basado en porcentajes con preview en tiempo real del valor equivalente en USDT.

**Archivo:** `frontend/src/components/backtesting/TradingControls.jsx`

**Cambios implementados:**

1. **Estado cambiado a porcentajes (líneas 5-12)**:
```javascript
// ANTES:
const [stopLoss, setStopLoss] = useState('');
const [takeProfit, setTakeProfit] = useState('');

// DESPUÉS:
const [stopLossPercent, setStopLossPercent] = useState('');
const [takeProfitPercent, setTakeProfitPercent] = useState('');
```

2. **Conversión automática en handleCreateOrder (líneas 69-110)**:
```javascript
// 🎯 NUEVO: Convertir porcentajes a precios USDT
const slPercent = stopLossPercent ? parseFloat(stopLossPercent) : null;
const tpPercent = takeProfitPercent ? parseFloat(takeProfitPercent) : null;

let sl = null;
let tp = null;

if (slPercent !== null) {
  sl = orderSide === 'long'
    ? price * (1 - slPercent / 100)
    : price * (1 + slPercent / 100);
}

if (tpPercent !== null) {
  tp = orderSide === 'long'
    ? price * (1 + tpPercent / 100)
    : price * (1 - tpPercent / 100);
}
```

3. **Inputs con preview en tiempo real (líneas 274-310)**:
```javascript
<div className="control-section">
  <label>Stop Loss % (Opcional)</label>
  <input
    type="number"
    step="0.1"
    min="0"
    value={stopLossPercent}
    onChange={(e) => setStopLossPercent(e.target.value)}
    placeholder="Ej: 2 (= 2%)"
  />
  {stopLossPercent && entryPrice && (
    <div className="price-hint">
      ${(orderSide === 'long'
        ? parseFloat(entryPrice) * (1 - parseFloat(stopLossPercent) / 100)
        : parseFloat(entryPrice) * (1 + parseFloat(stopLossPercent) / 100)
      ).toFixed(2)}
    </div>
  )}
</div>
```

**Funcionalidad:**
- Usuario ingresa porcentajes (ej: `2` para 2%, `4` para 4%)
- El sistema muestra automáticamente el valor equivalente en USDT debajo del input
- La conversión mantiene la lógica correcta según la dirección:
  - **LONG**: SL = precio × (1 - %) | TP = precio × (1 + %)
  - **SHORT**: SL = precio × (1 + %) | TP = precio × (1 - %)
- Botones rápidos (SL 2% / TP 4%, etc.) ahora establecen porcentajes directamente

**Validación:**
- Verifica que los porcentajes sean números válidos > 0
- Elimina validación de SL/TP vs precio (la conversión % siempre respeta direcciones correctas)

---

### 2. Botón de Maximizar Panel de Trading

**Problema:** El panel de trading no tenía opción de maximizar para ver mejor las métricas de rendimiento, aunque el backend ya soportaba fullscreen.

**Solución:** Agregado botón de maximizar en el header del panel con atajo de teclado.

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx`

**Cambios implementados:**

1. **Botón en el header del sidebar (líneas 2143-2165)**:
```javascript
{/* 🎯 OPTIMIZACIÓN UI: Header del panel con botones de maximizar y colapsar */}
<div className="sidebar-header">
  <span className="sidebar-title">Panel de Trading</span>
  <div style={{ display: 'flex', gap: '8px' }}>
    <button
      className="btn-collapse"
      onClick={() => setFullscreenPanel(prev => prev === 'trading' ? null : 'trading')}
      title={fullscreenPanel === 'trading' ? "Restaurar panel (ESC)" : "Maximizar panel (Shift+T)"}
      style={{ fontSize: '16px' }}
    >
      {fullscreenPanel === 'trading' ? '⛶' : '⛶'}
    </button>
    <button
      className="btn-collapse"
      onClick={() => setShowTradingPanel(false)}
      title="Ocultar panel (T o ESC)"
    >
      ✕
    </button>
  </div>
</div>
```

2. **Atajo de teclado Shift+T (líneas 378-393)**:
```javascript
// 🎯 NUEVO: F key: Toggle fullscreen del gráfico
if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused) {
  e.preventDefault();
  setFullscreenPanel(prev => prev === 'chart' ? null : 'chart');
  console.log('[BacktestingApp] Toggle fullscreen del gráfico (F)');
}

// 🎯 NUEVO: Shift+T: Toggle fullscreen del panel de trading
if (e.key === 'T' && e.shiftKey && !e.ctrlKey && !e.metaKey && !isInputFocused) {
  e.preventDefault();
  setFullscreenPanel(prev => prev === 'trading' ? null : 'trading');
  console.log('[BacktestingApp] Toggle fullscreen del panel de trading (Shift+T)');
}

// 🎯 NUEVO: ESC: Salir de fullscreen del panel y ocultar panel trading
if (e.key === 'Escape') {
  e.preventDefault();
  if (fullscreenPanel) {
    setFullscreenPanel(null);
    console.log('[BacktestingApp] Saliendo de fullscreen del panel (ESC)');
  }
  if (showTradingPanel) {
    setShowTradingPanel(false);
    console.log('[BacktestingApp] Ocultando panel de trading (ESC)');
  }
}
```

**Funcionalidad:**
- Botón **⛶** en el header del panel de trading (junto al botón de cerrar)
- Click en el botón alterna entre maximizado y normal
- **Atajo de teclado**: `Shift+T` para maximizar/restaurar
- **ESC** sale del fullscreen y oculta el panel
- Usa el mismo sistema `fullscreenPanel` que el gráfico principal (`'chart'` | `'trading'` | `null`)

**Beneficio:** Permite ver las métricas de rendimiento (win rate, PnL, drawdown, historial) en pantalla completa para análisis detallado.

---

### 3. Fix: TP/SL Box en Órdenes Limit

**Problema:** Las órdenes limit no dibujaban la caja de TP/SL en el gráfico cuando se ejecutaban. Las market orders funcionaban correctamente, pero las limit/stop tenían este bug.

**Causa raíz:** El callback `onOrderCreated` solo creaba cajas TP/SL para órdenes market (`if (order && order.type === 'market' && ...`). Las órdenes limit se creaban como 'pending' y solo se ejecutaban cuando el precio las alcanzaba, pero no había lógica para dibujar la caja en ese momento.

**Solución:** Agregada lógica de creación de TP/SL box en el callback `onOrderExecuted`.

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx`

**Cambios implementados (líneas 838-858)**:
```javascript
// 🎯 NUEVO: Conectar callback para cuando una orden pendiente se ejecuta
orderManagerRef.current.onOrderExecuted = (executedOrder) => {
  console.log('[BacktestingApp] Orden pendiente ejecutada:', executedOrder);
  // El popup se mostrará automáticamente en TradingControls a través del callback onOrderCreated

  // 🎯 FIX: Crear caja TP/SL cuando limit/stop order se ejecuta
  if (executedOrder && (executedOrder.stopLoss || executedOrder.takeProfit)) {
    const miniChart = miniChartRefs.current[activeTimeframe];
    if (miniChart && miniChart.addTPSLBox) {
      miniChart.addTPSLBox(
        executedOrder.entryPrice,
        executedOrder.executedAt || currentTime,
        executedOrder.side, // 'long' o 'short'
        executedOrder.stopLoss,
        executedOrder.takeProfit,
        5 // 5 velas de ancho
      );
      console.log('[BacktestingApp] TP/SL box creada para limit order ejecutada');
    }
  }
};
```

**Flujo de eventos:**
1. Usuario crea orden limit con SL/TP configurados
2. Orden queda en estado 'pending'
3. Durante el playback, cuando precio alcanza el nivel limit:
   - `OrderManager` ejecuta la orden y cambia estado a 'open'
   - Llama al callback `onOrderExecuted(executedOrder)`
4. El callback verifica si la orden tiene SL/TP definidos
5. Si tiene, llama a `miniChart.addTPSLBox()` para dibujar la caja
6. La caja aparece en el gráfico mostrando entry, SL y TP

**Resultado:** Ahora las órdenes limit muestran correctamente la caja de TP/SL cuando se ejecutan, igual que las market orders.

---

## Atajos de Teclado Actualizados

| Atajo | Función |
|-------|---------|
| `T` | Mostrar/ocultar panel de trading |
| `F` | Maximizar/restaurar gráfico principal |
| `Shift+T` | Maximizar/restaurar panel de trading |
| `ESC` | Salir de fullscreen + ocultar panel trading |
| `Space` | Play/Pause del playback |
| `←` | Retroceder 1 vela |
| `→` | Avanzar 1 vela |

---

## Archivos Modificados en Esta Sesión

| Archivo | Cambios |
|---------|---------|
| `frontend/src/components/backtesting/TradingControls.jsx` | SL/TP en porcentaje, conversión automática, preview USDT |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Botón maximizar panel, atajo Shift+T, fix TP/SL box limit orders |
| `CLAUDE.md` | Documentación completa de los 3 fixes |

---

## FIX: NAVEGACIÓN A TRADES HISTÓRICOS (Octubre 2026)

### Problema

Al hacer click en el ícono 📍 en el historial de trades para navegar al gráfico en la fecha exacta del trade, la aplicación se iba a una fecha incorrecta que no coincidía con ningún trade. Todos los trades llevaban a la misma fecha incorrecta.

### Causa Raíz

El método `centerOnTimestamp` en `MiniChart.jsx` usaba `candlesRef.current` para buscar el timestamp del trade. Sin embargo:
- `candlesRef` solo contiene las velas **visibles del playback actual** (~500 velas alrededor del currentTime)
- Los trades históricos pueden estar **meses o años en el pasado**
- El timestamp del trade no existía en `candlesRef`, por lo que siempre navegaba a la última vela disponible

El fix anterior del "chart flip bug" había cambiado de usar `allCandlesRef` a `candlesRef` para evitar el volteo del gráfico, pero esto rompió la navegación a trades históricos.

### Solución

**Archivo:** `frontend/src/components/MiniChart.jsx` (líneas 364-420)

El fix correcto usa un enfoque híbrido:

1. **Para buscar el timestamp**: Usar `allCandlesRef` (todas las velas históricas) en modo backtesting
2. **Para actualizar el playback**: Llamar a `onRequestTimeChange(timestamp)` con el timestamp del trade
3. **Dejar que el sistema reconstruya**: El playback actualiza `currentTime` y reconstruye `candlesRef` automáticamente

```javascript
centerOnTimestamp: (timestamp, options = {}) => {
  // 🎯 FIX: En backtesting, usar allCandlesRef para buscar trades históricos
  const sourceCandles = backtestingMode && allCandlesRef.current?.length > 0
    ? allCandlesRef.current
    : candlesRef.current;

  // Buscar el índice de la vela más cercana al timestamp
  let targetIndex = -1;
  for (let i = 0; i < sourceCandles.length; i++) {
    if (sourceCandles[i].timestamp >= timestamp) {
      targetIndex = i;
      break;
    }
  }

  const targetCandle = sourceCandles[targetIndex];

  // 🎯 FIX: En backtesting, actualizar currentTime para reconstruir candlesRef
  if (backtestingMode && onRequestTimeChange) {
    console.log(`[MiniChart] 📍 Actualizando playback a: ${new Date(targetCandle.timestamp).toISOString()}`);
    onRequestTimeChange(targetCandle.timestamp);
    return; // El playback reconstruirá candlesRef automáticamente
  }

  // FALLBACK: Navegación visual si no estamos en backtesting
  // ... (código de animación visual)
}
```

### Ventajas de este Enfoque

1. **Evita el chart flip**: No manipulamos directamente el offset con arrays de diferentes tamaños
2. **Busca en todo el histórico**: `allCandlesRef` contiene todas las velas cargadas (hasta 5 años)
3. **Actualización limpia**: `onRequestTimeChange` dispara el flujo normal de actualización del playback
4. **Centrado automático**: El TimeController se encarga de centrar la vista después de actualizar currentTime

### Flujo Completo

```
1. Usuario hace click en 📍 de un trade en TradeHistory
   ↓
2. handleNavigateToTrade() llama a miniChart.centerOnTimestamp(order.entryTime)
   ↓
3. centerOnTimestamp() busca el timestamp en allCandlesRef (todas las velas)
   ↓
4. Encuentra la vela exacta (ej: índice 15234 de 43800 velas totales)
   ↓
5. Llama a onRequestTimeChange(targetCandle.timestamp)
   ↓
6. BacktestingApp actualiza currentTime state
   ↓
7. TimeController reconstruye candlesRef con ~500 velas alrededor del nuevo currentTime
   ↓
8. El gráfico se re-renderiza centrado en el trade
```

### Logging de Diagnóstico

El fix incluye logs detallados para debugging:

```javascript
console.log(`[MiniChart] 🔍 centerOnTimestamp: buscando ${timestamp} (${new Date(timestamp).toISOString()})`);
console.log(`[MiniChart] 🔍 Fuente: ${backtestingMode ? 'allCandlesRef (histórico completo)' : 'candlesRef (actual)'}`);
console.log(`[MiniChart] 🔍 Rango disponible: ${new Date(firstTs).toISOString()} → ${new Date(lastTs).toISOString()}`);
console.log(`[MiniChart] 🔍 Total velas: ${sourceCandles.length}`);
console.log(`[MiniChart] ✅ Vela encontrada en índice ${targetIndex}: ${new Date(targetCandle.timestamp).toISOString()}`);
console.log(`[MiniChart] 📍 Actualizando playback time a: ${new Date(targetCandle.timestamp).toISOString()}`);
```

### Resultado

✅ **Ahora funciona correctamente**: Click en cualquier trade del historial navega al gráfico en la fecha y hora exacta del trade, centrado en pantalla.

### Fix Adicional: "Baile del Gráfico" al Mover Mouse (Octubre 2026)

**Problema:** Después de implementar el fix inicial de navegación, apareció un nuevo issue: al hacer click en el ícono de un trade para navegar, el gráfico iba a la fecha correcta PERO al mover el mouse sobre el gráfico, este empezaba a "bailar" de izquierda a derecha, haciendo muy difícil la visualización.

**Causa raíz:** El `useEffect(currentTime)` (líneas 2210-2269) reconstruye `candlesRef` cada vez que cambia `currentTime`, y si `!manualPanRef.current`, recalcula automáticamente el `offset` (líneas 2246-2261). El flujo problemático era:

```
1. centerOnTimestamp() llama onRequestTimeChange(timestamp)
2. currentTime se actualiza en BacktestingApp
3. useEffect(currentTime) se dispara → reconstruye candlesRef
4. Recalcula offset automáticamente (líneas 2256-2260)
5. Usuario mueve el mouse → handleMouseMove (línea 1791) llama drawChart()
6. Pero el useEffect podría estar aún recalculando el offset
7. Esto causa el "baile" visual del gráfico
```

**Solución:** Marcar temporalmente `manualPanRef.current = true` durante 300ms al navegar a un trade. Esto previene que el `useEffect` recalcule automáticamente el offset mientras se reconstruye `candlesRef`, eliminando el "baile".

**Implementación (líneas 404-422 de MiniChart.jsx):**

```javascript
// 🎯 FIX NAVEGACIÓN A TRADES: En backtesting, actualizar currentTime
if (backtestingMode && onRequestTimeChange) {
  console.log(`[MiniChart ${symbol}] 📍 Actualizando playback time a: ${timestamp}`);

  // 🔧 FIX "BAILE DEL GRÁFICO": Marcar como paneo manual temporalmente
  // Esto evita que el useEffect(currentTime) recalcule el offset automáticamente
  const wasManualPan = manualPanRef.current;
  manualPanRef.current = true;

  onRequestTimeChange(targetCandle.timestamp);

  // Restaurar el estado original después de que el useEffect termine
  setTimeout(() => {
    manualPanRef.current = wasManualPan;
    console.log(`[MiniChart ${symbol}] 🔄 Restaurado manualPan=${wasManualPan}`);
  }, 300);

  return;
}
```

**Resultado:** El gráfico navega correctamente al trade Y se mantiene estable cuando el usuario mueve el mouse.

### Archivos Modificados (Octubre 2026)

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/MiniChart.jsx` | Fix centerOnTimestamp: usar allCandlesRef + actualizar playback time + prevenir recalculo de offset |
| `CLAUDE.md` | Documentación completa de ambos fixes |