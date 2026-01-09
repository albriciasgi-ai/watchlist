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
uvicorn main:app --reload --port 8000
```

Backend runs on `http://localhost:8000`

Dependencies:
- fastapi==0.115.0
- uvicorn[standard]==0.32.0
- httpx==0.27.2

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

Frontend dev server runs on `http://localhost:5173` (default Vite port)

## Architecture

### Backend Architecture (backend/main.py)

**Core Responsibilities:**
1. **Historical Data Fetcher**: Fetches OHLCV candles from Bybit API with timeframe-specific limits
2. **Volume Delta Calculator**: Computes Volume Delta and CVD from candle data
3. **Caching Layer**: 30-minute file-based cache to reduce API calls

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
export const API_BASE_URL = "http://localhost:8000";
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
- Check that port 8000 is not in use
- Verify backend/.venv exists or run start_backend.bat

**Frontend chart not loading:**
- Verify backend is running on port 8000
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
