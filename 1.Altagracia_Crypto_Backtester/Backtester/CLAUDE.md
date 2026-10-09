# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a cryptocurrency trading platform watchlist application with advanced Volume Profile visualization. The system displays real-time cryptocurrency prices with technical indicators including Volume Delta, CVD (Cumulative Volume Delta), and dynamic/fixed Volume Profile analysis.

**Stack:**
- Frontend: React 18 + Vite (development), uPlot (charting)
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)

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
  - `ATRBasedRangeDetector.js` - Automatic range detection using ATR
  - `RejectionPatternIndicator.js` - Candlestick pattern detection (Hammer, Shooting Star, Engulfing, Doji)
  - `LocalPatternDetector.js` - Local pattern detection without context validation

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