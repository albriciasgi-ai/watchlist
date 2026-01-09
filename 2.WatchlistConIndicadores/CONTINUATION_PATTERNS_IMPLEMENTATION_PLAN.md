# CONTINUATION PATTERNS - IMPLEMENTATION PLAN

**Project:** Cryptocurrency Trading Watchlist - Advanced Pattern Detection System
**Version:** 2.0
**Created:** 2025-12-10
**Status:** Implementation Ready

---

## 1. PROJECT OVERVIEW

### Objective
Expand the existing rejection pattern detection system to include continuation patterns, trend start patterns, and momentum patterns, using VWAP as the primary dynamic level source instead of lagging moving averages.

### Key Improvements
- **VWAP Integration**: Real-time volume-weighted price levels with standard deviation bands
- **Adaptive Scoring**: Confidence formula adjusts based on active level sources
- **Context-Aware Classification**: Same pattern reclassified based on location (reversal vs continuation)
- **User-Configurable Sources**: Support & Resistance, Volume Profile, VWAP, Fibonacci, Manual Levels
- **Volume Compensation**: Momentum patterns accept fewer candles if backed by high volume

---

## 2. ARCHITECTURE LAYERS

### Layer 1: Base Pattern Detection
**Component:** `PatternDetectorExtended.js`

Detects raw patterns without context:
- Inside Bar
- False Breakout
- Momentum (3+ consecutive strong candles)
- Existing patterns: Hammer, Shooting Star, Engulfing, Doji

**Key Methods:**
```javascript
detectInsideBar(candles, index, params)
detectFalseBreakout(candles, index, params)
detectMomentum(candles, index, params, volumes)
```

### Layer 2: Level Source Management
**Component:** `LevelSourceManager.js`

Consolidates levels from multiple sources:
- Support & Resistance (existing)
- Volume Profile Fixed Ranges (existing)
- **VWAP + Bands** (NEW)
- **Fibonacci Retracements** (NEW - optional)
- Manual Levels (existing)

**Key Methods:**
```javascript
getAllLevels(options) {
  return {
    vwapLevels: [...],      // VWAP + σ bands
    fibLevels: [...],       // 0.236, 0.382, 0.5, 0.618, 0.786
    srLevels: [...],        // Support/Resistance
    vpLevels: [...],        // Volume Profile POC/VAH/VAL
    manualLevels: [...]     // User-defined
  }
}

getActiveSourceWeights(config) {
  // Returns adaptive weights for confidence scoring
}
```

### Layer 3: Trend Analysis
**Component:** `TrendAnalyzer.js`

Calculates trend strength using two components:

**Component 1: Swing Consistency (60% weight)**
- Identifies swing highs/lows using configurable lookback
- Counts Higher Highs/Higher Lows (uptrend) or Lower Highs/Lower Lows (downtrend)
- Formula: `consistencyScore = (validSwings / totalSwings) * 100`

**Component 2: Progression Angle (40% weight)**
- Linear regression on recent candle closes
- Converts slope to angle: `angle = atan(slope) * (180/π)`
- Normalizes to 0-100 scale

**Final Formula:**
```javascript
trendStrength = (consistencyScore * 0.6) + (angleScore * 0.4)

if (trendStrength >= 70) return 'STRONG';
if (trendStrength >= 40) return 'MODERATE';
return 'WEAK';
```

### Layer 4: Context Classification
**Component:** `ContinuationPatternIndicator.js`

Determines pattern type based on:
- Current trend strength
- Location in trend (pullback vs extreme)
- Proximity to key levels
- Volume characteristics

**Classification Matrix:**

| Pattern | At Extreme | In Middle of Trend | At Breakout |
|---------|------------|-------------------|-------------|
| Hammer | REVERSAL | CONTINUATION | TREND_START |
| Shooting Star | REVERSAL | CONTINUATION | - |
| Engulfing | REVERSAL | CONTINUATION | TREND_START |
| Inside Bar | - | CONTINUATION | - |
| False Breakout | REVERSAL | CONTINUATION | - |
| Momentum | - | CONTINUATION | TREND_START |

### Layer 5: Adaptive Confidence Scoring
**Component:** `ContinuationPatternIndicator.js` - `calculateAdaptiveConfidence()`

**Base Factors (60% total):**
- Pattern Quality: 25%
- Relative Size: 20%
- Volume Z-Score: 15%

**Level Factors (40% total - distributed among active sources):**

Example with 3 sources active (S/R + VWAP + VP):
- Support/Resistance: 13.3%
- VWAP Proximity: 13.3%
- Volume Profile: 13.3%

Example with 1 source active (S/R only):
- Support/Resistance: 40%

**Formula:**
```javascript
const baseScore =
  (patternQuality * 0.25) +
  (relativeSize * 0.20) +
  (volumeScore * 0.15);

const levelScore = activeSources.reduce((sum, source) => {
  return sum + (source.score * source.weight);
}, 0);

confidence = (baseScore * 0.6) + (levelScore * 0.4);
```

---

## 3. IMPLEMENTATION PHASES

### PHASE 1: Foundation & VWAP (5-7 days)

#### 1.1 Frontend Components

**VWAPIndicator.js** - NEW
```javascript
class VWAPIndicator extends IndicatorBase {
  calculate(candles) {
    // Session VWAP (daily reset)
    // Anchored VWAP (weekly, monthly, custom)
    // Rolling VWAP (fixed lookback)
    // Standard deviation bands (±1σ, ±2σ, ±3σ)
  }

  draw(ctx, viewport) {
    // Draw VWAP line + bands
    // Crypto-adjusted multipliers: 1.15, 2.3, 3.45
  }
}
```

**LevelSourceManager.js** - NEW
```javascript
class LevelSourceManager {
  constructor(indicatorManager) {
    this.indicatorManager = indicatorManager;
  }

  getAllLevels(config) {
    const levels = {
      vwap: [],
      fibonacci: [],
      sr: [],
      vp: [],
      manual: []
    };

    if (config.levelSources.vwap) {
      levels.vwap = this._getVWAPLevels();
    }

    if (config.levelSources.fibonacci) {
      levels.fibonacci = this._getFibonacciLevels(config.fibonacci);
    }

    // ... other sources

    return levels;
  }

  getActiveSourceWeights(config) {
    const activeSources = [];
    if (config.levelSources.supportResistance) activeSources.push('sr');
    if (config.levelSources.vwap) activeSources.push('vwap');
    // ...

    const weight = 0.40 / activeSources.length;
    return activeSources.map(s => ({ source: s, weight }));
  }
}
```

**FibonacciLevelCalculator.js** - NEW
```javascript
class FibonacciLevelCalculator {
  calculateLevels(candles, swingHigh, swingLow, direction) {
    const range = swingHigh - swingLow;
    const levels = [0.236, 0.382, 0.5, 0.618, 0.786];

    return levels.map(ratio => {
      const price = direction === 'RETRACEMENT'
        ? swingHigh - (range * ratio)
        : swingLow + (range * ratio);

      return { level: ratio, price, type: direction };
    });
  }

  autoDetectSwings(candles, lookback = 50) {
    // Detect significant swing high/low
  }
}
```

**IndicatorManager.js** - MODIFY
```javascript
// Add to IndicatorManager class:

initializeLevelSourceManager() {
  this.levelSourceManager = new LevelSourceManager(this);
}

getAllReferenceLevels(options = {}) {
  // EXISTING CODE for SR, VP, Range Detection

  // ADD: VWAP levels
  if (options.sources?.vwap) {
    const vwapIndicator = this.indicators.get('vwap');
    if (vwapIndicator) {
      const vwapData = vwapIndicator.getLastData();
      levels.vwapLevels = [
        { price: vwapData.vwap, type: 'vwap', strength: 80 },
        { price: vwapData.bands.upper1, type: 'vwap_band', strength: 60 },
        { price: vwapData.bands.lower1, type: 'vwap_band', strength: 60 },
        // ... additional bands
      ];
    }
  }

  // ADD: Fibonacci levels
  if (options.sources?.fibonacci) {
    const fibLevels = this.levelSourceManager.getFibonacciLevels(options.fibonacci);
    levels.fibonacciLevels = fibLevels;
  }

  return levels;
}
```

#### 1.2 Backend Components

**backend/vwap_calculator.py** - NEW
```python
from typing import List, Dict
import numpy as np

class VWAPCalculator:
    def calculate_session_vwap(self, candles: List[Dict], reset_hour: int = 0):
        """Calculate VWAP with daily reset at specified hour (UTC)"""
        results = []
        cumulative_pv = 0
        cumulative_volume = 0
        last_session_start = None

        for candle in candles:
            timestamp = candle['timestamp']
            hour = datetime.fromtimestamp(timestamp / 1000).hour

            # Reset on new session
            if last_session_start is None or hour == reset_hour:
                cumulative_pv = 0
                cumulative_volume = 0
                last_session_start = timestamp

            typical_price = (candle['high'] + candle['low'] + candle['close']) / 3
            volume = candle['volume']

            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            results.append({
                'timestamp': timestamp,
                'vwap': vwap,
                'typical_price': typical_price,
                'cumulative_volume': cumulative_volume
            })

        return results

    def calculate_std_bands(self, candles: List[Dict], vwap_data: List[Dict],
                           multipliers: List[float] = [1.0, 2.0, 3.0]):
        """Calculate standard deviation bands around VWAP"""
        # Crypto adjustment: multiply by 1.15
        crypto_multipliers = [m * 1.15 for m in multipliers]

        for i, candle in enumerate(candles):
            typical_price = (candle['high'] + candle['low'] + candle['close']) / 3
            vwap = vwap_data[i]['vwap']

            # Calculate variance
            squared_diff = (typical_price - vwap) ** 2
            volume = candle['volume']

            # Cumulative variance calculation
            # ... (implementation)

            std_dev = np.sqrt(variance)

            vwap_data[i]['bands'] = {
                f'upper_{j+1}': vwap + (std_dev * m) for j, m in enumerate(crypto_multipliers)
            }
            vwap_data[i]['bands'].update({
                f'lower_{j+1}': vwap - (std_dev * m) for j, m in enumerate(crypto_multipliers)
            })

        return vwap_data

    def calculate_anchored_vwap(self, candles: List[Dict], anchor_index: int):
        """Calculate VWAP from specific anchor point"""
        results = []
        cumulative_pv = 0
        cumulative_volume = 0

        for i in range(anchor_index, len(candles)):
            candle = candles[i]
            typical_price = (candle['high'] + candle['low'] + candle['close']) / 3
            volume = candle['volume']

            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            results.append({
                'timestamp': candle['timestamp'],
                'vwap': vwap,
                'anchor_index': anchor_index
            })

        return results
```

**backend/fibonacci_calculator.py** - NEW
```python
from typing import List, Dict, Tuple

class FibonacciCalculator:
    LEVELS = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]

    def calculate_retracement(self, swing_high: float, swing_low: float) -> List[Dict]:
        """Calculate Fibonacci retracement levels"""
        range_size = swing_high - swing_low

        levels = []
        for ratio in self.LEVELS:
            price = swing_high - (range_size * ratio)
            levels.append({
                'level': ratio,
                'price': price,
                'type': 'retracement'
            })

        return levels

    def calculate_extension(self, swing_high: float, swing_low: float) -> List[Dict]:
        """Calculate Fibonacci extension levels"""
        range_size = swing_high - swing_low
        extension_ratios = [1.272, 1.414, 1.618, 2.0, 2.618]

        levels = []
        for ratio in extension_ratios:
            price = swing_high + (range_size * (ratio - 1.0))
            levels.append({
                'level': ratio,
                'price': price,
                'type': 'extension'
            })

        return levels

    def auto_detect_swing(self, candles: List[Dict], lookback: int = 50) -> Tuple[float, float]:
        """Auto-detect significant swing high and low"""
        if len(candles) < lookback:
            lookback = len(candles)

        recent_candles = candles[-lookback:]

        swing_high = max(c['high'] for c in recent_candles)
        swing_low = min(c['low'] for c in recent_candles)

        return swing_high, swing_low
```

#### 1.3 API Endpoints

**backend/main.py** - ADD
```python
from vwap_calculator import VWAPCalculator
from fibonacci_calculator import FibonacciCalculator

vwap_calc = VWAPCalculator()
fib_calc = FibonacciCalculator()

@app.get("/api/vwap/{symbol}")
async def get_vwap(
    symbol: str,
    interval: str = "60",
    days: int = 7,
    vwap_type: str = "session",  # session, anchored, rolling
    anchor_timestamp: Optional[int] = None
):
    """Get VWAP data with standard deviation bands"""

    # Get historical candles
    candles = await fetch_historical_data(symbol, interval, days)

    if vwap_type == "session":
        vwap_data = vwap_calc.calculate_session_vwap(candles)
    elif vwap_type == "anchored" and anchor_timestamp:
        anchor_index = find_candle_index(candles, anchor_timestamp)
        vwap_data = vwap_calc.calculate_anchored_vwap(candles, anchor_index)

    # Add standard deviation bands
    vwap_data = vwap_calc.calculate_std_bands(candles, vwap_data)

    return {
        "symbol": symbol,
        "interval": interval,
        "vwap_type": vwap_type,
        "data": vwap_data
    }

@app.post("/api/fibonacci/calculate")
async def calculate_fibonacci(
    symbol: str,
    swing_high: Optional[float] = None,
    swing_low: Optional[float] = None,
    auto_detect: bool = False,
    interval: str = "60",
    days: int = 30
):
    """Calculate Fibonacci levels"""

    if auto_detect or (swing_high is None or swing_low is None):
        candles = await fetch_historical_data(symbol, interval, days)
        swing_high, swing_low = fib_calc.auto_detect_swing(candles)

    retracements = fib_calc.calculate_retracement(swing_high, swing_low)
    extensions = fib_calc.calculate_extension(swing_high, swing_low)

    return {
        "symbol": symbol,
        "swing_high": swing_high,
        "swing_low": swing_low,
        "retracements": retracements,
        "extensions": extensions
    }
```

#### 1.4 Testing Criteria
- [ ] VWAP matches TradingView calculations (±0.1%)
- [ ] Standard deviation bands adjust correctly for crypto (+15%)
- [ ] Session VWAP resets at midnight UTC
- [ ] Anchored VWAP recalculates from specific event
- [ ] Fibonacci levels match manual calculations
- [ ] Auto-detect finds major swing points
- [ ] Level source manager consolidates all sources correctly
- [ ] Adaptive weights distribute correctly (sum = 1.0)

---

### PHASE 2: Trend Analysis & Pattern Extension (5-6 days)

#### 2.1 Frontend Components

**TrendAnalyzer.js** - NEW
```javascript
class TrendAnalyzer {
  constructor(config = {}) {
    this.swingLookback = config.swingLookback || 5;
    this.trendLookback = config.trendLookback || 20;
    this.angleNormalizationMax = config.angleNormalizationMax || 45; // degrees
  }

  analyzeTrend(candles) {
    if (candles.length < this.trendLookback) {
      return { direction: 'NONE', strength: 0, components: {} };
    }

    const recent = candles.slice(-this.trendLookback);

    // Component 1: Swing Consistency (60%)
    const swings = this.identifySwings(recent);
    const consistencyScore = this.calculateSwingConsistency(swings);

    // Component 2: Progression Angle (40%)
    const angleScore = this.calculateProgressionAngle(recent);

    // Combined score
    const trendStrength = (consistencyScore * 0.6) + (angleScore * 0.4);

    // Determine direction
    const direction = this.determineDirection(swings, recent);

    // Classify strength
    let strengthLabel = 'WEAK';
    if (trendStrength >= 70) strengthLabel = 'STRONG';
    else if (trendStrength >= 40) strengthLabel = 'MODERATE';

    return {
      direction,
      strength: trendStrength,
      strengthLabel,
      components: {
        consistency: consistencyScore,
        angle: angleScore
      },
      swings
    };
  }

  identifySwings(candles) {
    const swings = { highs: [], lows: [] };

    for (let i = this.swingLookback; i < candles.length - this.swingLookback; i++) {
      const slice = candles.slice(i - this.swingLookback, i + this.swingLookback + 1);
      const current = candles[i];

      // Swing High: higher than all candles in lookback window
      const isSwingHigh = slice.every(c => c !== current ? c.high <= current.high : true);
      if (isSwingHigh) {
        swings.highs.push({ index: i, price: current.high, timestamp: current.timestamp });
      }

      // Swing Low: lower than all candles in lookback window
      const isSwingLow = slice.every(c => c !== current ? c.low >= current.low : true);
      if (isSwingLow) {
        swings.lows.push({ index: i, price: current.low, timestamp: current.timestamp });
      }
    }

    return swings;
  }

  calculateSwingConsistency(swings) {
    const { highs, lows } = swings;

    if (highs.length < 2 || lows.length < 2) return 0;

    // Check for Higher Highs + Higher Lows (uptrend)
    let hhCount = 0, hlCount = 0;
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price > highs[i-1].price) hhCount++;
    }
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price > lows[i-1].price) hlCount++;
    }
    const uptrendScore = ((hhCount / (highs.length - 1)) + (hlCount / (lows.length - 1))) / 2;

    // Check for Lower Highs + Lower Lows (downtrend)
    let lhCount = 0, llCount = 0;
    for (let i = 1; i < highs.length; i++) {
      if (highs[i].price < highs[i-1].price) lhCount++;
    }
    for (let i = 1; i < lows.length; i++) {
      if (lows[i].price < lows[i-1].price) llCount++;
    }
    const downtrendScore = ((lhCount / (highs.length - 1)) + (llCount / (lows.length - 1))) / 2;

    // Return the stronger score (0-100)
    return Math.max(uptrendScore, downtrendScore) * 100;
  }

  calculateProgressionAngle(candles) {
    // Linear regression on close prices
    const closes = candles.map(c => c.close);
    const n = closes.length;

    // Calculate slope using least squares
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += closes[i];
      sumXY += i * closes[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Convert slope to angle
    const angleRadians = Math.atan(slope);
    const angleDegrees = angleRadians * (180 / Math.PI);

    // Normalize to 0-100 scale
    const normalizedAngle = Math.min(
      Math.abs(angleDegrees) / this.angleNormalizationMax,
      1.0
    );

    return normalizedAngle * 100;
  }

  determineDirection(swings, candles) {
    const { highs, lows } = swings;

    if (highs.length < 2 || lows.length < 2) return 'NONE';

    // Recent trend based on last 2 swings
    const recentHighs = highs.slice(-2);
    const recentLows = lows.slice(-2);

    const isUptrend =
      recentHighs[1].price > recentHighs[0].price &&
      recentLows[1].price > recentLows[0].price;

    const isDowntrend =
      recentHighs[1].price < recentHighs[0].price &&
      recentLows[1].price < recentLows[0].price;

    if (isUptrend) return 'UP';
    if (isDowntrend) return 'DOWN';
    return 'RANGE';
  }

  isInPullback(candles, trendInfo) {
    if (trendInfo.direction === 'NONE' || trendInfo.direction === 'RANGE') {
      return false;
    }

    const recentCandles = candles.slice(-5);
    const currentClose = recentCandles[recentCandles.length - 1].close;

    if (trendInfo.direction === 'UP') {
      // In uptrend, pullback means recent candles moving down
      const highestHigh = Math.max(...recentCandles.map(c => c.high));
      const pullbackSize = (highestHigh - currentClose) / highestHigh;
      return pullbackSize > 0.01; // 1% pullback
    } else {
      // In downtrend, pullback means recent candles moving up
      const lowestLow = Math.min(...recentCandles.map(c => c.low));
      const pullbackSize = (currentClose - lowestLow) / lowestLow;
      return pullbackSize > 0.01;
    }
  }
}
```

**PatternDetectorExtended.js** - NEW
```javascript
class PatternDetectorExtended {
  detectInsideBar(candles, index, params = {}) {
    if (index < 1) return null;

    const mother = candles[index - 1];
    const child = candles[index];

    const {
      requireFullContainment = true,
      minMotherCandleSize = 0.005 // 0.5% of price
    } = params;

    // Mother candle must be significant size
    const motherRange = mother.high - mother.low;
    const motherSizePercent = motherRange / mother.close;
    if (motherSizePercent < minMotherCandleSize) return null;

    // Child must be inside mother's range
    const isInside = child.high <= mother.high && child.low >= mother.low;
    if (!isInside) return null;

    // Optional: require child to be fully contained (not just touching edges)
    if (requireFullContainment) {
      const touchMargin = motherRange * 0.05; // 5% margin
      if (child.high > (mother.high - touchMargin) ||
          child.low < (mother.low + touchMargin)) {
        return null;
      }
    }

    return {
      type: 'INSIDE_BAR',
      index,
      timestamp: child.timestamp,
      motherIndex: index - 1,
      motherRange,
      childRange: child.high - child.low,
      compressionRatio: (child.high - child.low) / motherRange,
      quality: this._calculateInsideBarQuality(mother, child)
    };
  }

  detectFalseBreakout(candles, index, params = {}) {
    // Requires inside bar + breakout + reversal
    const insideBar = this.detectInsideBar(candles, index - 1, params);
    if (!insideBar) return null;

    const {
      lookforwardCandles = 3,
      minReversalPercent = 0.01,
      requireVolumeSpike = true
    } = params;

    if (index + lookforwardCandles >= candles.length) return null;

    const mother = candles[insideBar.motherIndex];
    const breakoutCandle = candles[index];

    // Check for breakout
    const breaksHigh = breakoutCandle.high > mother.high;
    const breaksLow = breakoutCandle.low < mother.low;

    if (!breaksHigh && !breaksLow) return null;

    // Check for reversal in lookforward window
    const lookforwardCandles_data = candles.slice(index + 1, index + 1 + lookforwardCandles);

    if (breaksHigh) {
      // False breakout to upside, should reverse down
      const reversalClose = Math.min(...lookforwardCandles_data.map(c => c.close));
      const reversalPercent = (mother.high - reversalClose) / mother.high;

      if (reversalPercent >= minReversalPercent) {
        return {
          type: 'FALSE_BREAKOUT',
          index,
          timestamp: breakoutCandle.timestamp,
          direction: 'BEARISH',
          insideBarData: insideBar,
          fakeLevel: mother.high,
          reversalPercent,
          quality: this._calculateFalseBreakoutQuality(reversalPercent, breakoutCandle)
        };
      }
    } else if (breaksLow) {
      // False breakout to downside, should reverse up
      const reversalClose = Math.max(...lookforwardCandles_data.map(c => c.close));
      const reversalPercent = (reversalClose - mother.low) / mother.low;

      if (reversalPercent >= minReversalPercent) {
        return {
          type: 'FALSE_BREAKOUT',
          index,
          timestamp: breakoutCandle.timestamp,
          direction: 'BULLISH',
          insideBarData: insideBar,
          fakeLevel: mother.low,
          reversalPercent,
          quality: this._calculateFalseBreakoutQuality(reversalPercent, breakoutCandle)
        };
      }
    }

    return null;
  }

  detectMomentum(candles, index, params = {}, volumes = []) {
    const {
      minConsecutiveCandles = 3,
      minBodyPercent = 0.6,
      minCandleSize = 0.003,
      volumeCompensation = {
        enabled: false,
        highVolumeThreshold: 2.0,
        minCandlesWithHighVolume: 2
      }
    } = params;

    if (index < minConsecutiveCandles) return null;

    let consecutiveCount = 0;
    let direction = null;
    let totalRange = 0;
    let hasHighVolume = false;

    // Calculate average volume for comparison
    let avgVolume = 0;
    if (volumeCompensation.enabled && volumes.length > 0) {
      const recentVolumes = volumes.slice(Math.max(0, index - 20), index);
      avgVolume = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length;
    }

    // Look backward from current candle
    for (let i = index; i >= 0; i--) {
      const candle = candles[i];
      const range = candle.high - candle.low;
      const body = Math.abs(candle.close - candle.open);
      const bodyRatio = body / range;
      const candleSizePercent = range / candle.close;

      // Check if candle is strong (large body, significant size)
      if (bodyRatio < minBodyPercent || candleSizePercent < minCandleSize) {
        break;
      }

      // Determine direction
      const isBullish = candle.close > candle.open;
      const currentDirection = isBullish ? 'BULLISH' : 'BEARISH';

      // First candle sets direction
      if (direction === null) {
        direction = currentDirection;
      } else if (direction !== currentDirection) {
        // Direction changed, stop counting
        break;
      }

      consecutiveCount++;
      totalRange += range;

      // Check for high volume
      if (volumeCompensation.enabled && volumes[i]) {
        if (volumes[i] >= avgVolume * volumeCompensation.highVolumeThreshold) {
          hasHighVolume = true;
        }
      }
    }

    // Adjust required candles if volume compensation is active
    let requiredCandles = minConsecutiveCandles;
    if (volumeCompensation.enabled && hasHighVolume) {
      requiredCandles = Math.min(requiredCandles, volumeCompensation.minCandlesWithHighVolume);
    }

    if (consecutiveCount >= requiredCandles) {
      return {
        type: 'MOMENTUM',
        index,
        timestamp: candles[index].timestamp,
        direction,
        consecutiveCount,
        totalRange,
        avgCandleSize: totalRange / consecutiveCount,
        hasHighVolume,
        quality: this._calculateMomentumQuality(consecutiveCount, totalRange, hasHighVolume)
      };
    }

    return null;
  }

  _calculateInsideBarQuality(mother, child) {
    const motherRange = mother.high - mother.low;
    const childRange = child.high - child.low;
    const compressionRatio = childRange / motherRange;

    // Tighter compression = higher quality (more coiling)
    let quality = 50;
    if (compressionRatio < 0.3) quality += 30;
    else if (compressionRatio < 0.5) quality += 20;
    else if (compressionRatio < 0.7) quality += 10;

    // Mother candle size (larger = better)
    const motherSize = motherRange / mother.close;
    if (motherSize > 0.02) quality += 20; // 2%+ range
    else if (motherSize > 0.01) quality += 10;

    return Math.min(quality, 100);
  }

  _calculateFalseBreakoutQuality(reversalPercent, breakoutCandle) {
    let quality = 50;

    // Strong reversal = higher quality
    if (reversalPercent > 0.03) quality += 30;
    else if (reversalPercent > 0.02) quality += 20;
    else if (reversalPercent > 0.01) quality += 10;

    // Breakout candle with long wick = better trap
    const range = breakoutCandle.high - breakoutCandle.low;
    const body = Math.abs(breakoutCandle.close - breakoutCandle.open);
    const wickRatio = (range - body) / range;

    if (wickRatio > 0.6) quality += 20;
    else if (wickRatio > 0.4) quality += 10;

    return Math.min(quality, 100);
  }

  _calculateMomentumQuality(consecutiveCount, totalRange, hasHighVolume) {
    let quality = 50;

    // More consecutive candles = higher quality
    if (consecutiveCount >= 5) quality += 30;
    else if (consecutiveCount >= 4) quality += 20;
    else if (consecutiveCount >= 3) quality += 10;

    // Large total move = higher quality
    if (totalRange > 0.05) quality += 20; // 5%+ total
    else if (totalRange > 0.03) quality += 10;

    // High volume boost
    if (hasHighVolume) quality += 20;

    return Math.min(quality, 100);
  }
}
```

#### 2.2 Backend Components

**backend/trend_analyzer.py** - NEW
```python
import numpy as np
from typing import List, Dict

class TrendAnalyzer:
    def __init__(self, swing_lookback: int = 5, trend_lookback: int = 20):
        self.swing_lookback = swing_lookback
        self.trend_lookback = trend_lookback

    def analyze_trend(self, candles: List[Dict]) -> Dict:
        """Analyze trend strength and direction"""
        if len(candles) < self.trend_lookback:
            return {
                'direction': 'NONE',
                'strength': 0,
                'strengthLabel': 'WEAK',
                'components': {}
            }

        recent = candles[-self.trend_lookback:]

        # Component 1: Swing Consistency (60%)
        swings = self._identify_swings(recent)
        consistency_score = self._calculate_swing_consistency(swings)

        # Component 2: Progression Angle (40%)
        angle_score = self._calculate_progression_angle(recent)

        # Combined score
        trend_strength = (consistency_score * 0.6) + (angle_score * 0.4)

        # Determine direction
        direction = self._determine_direction(swings, recent)

        # Classify strength
        strength_label = 'WEAK'
        if trend_strength >= 70:
            strength_label = 'STRONG'
        elif trend_strength >= 40:
            strength_label = 'MODERATE'

        return {
            'direction': direction,
            'strength': trend_strength,
            'strengthLabel': strength_label,
            'components': {
                'consistency': consistency_score,
                'angle': angle_score
            },
            'swings': swings
        }

    def _identify_swings(self, candles: List[Dict]) -> Dict:
        """Identify swing highs and lows"""
        swings = {'highs': [], 'lows': []}

        for i in range(self.swing_lookback, len(candles) - self.swing_lookback):
            window = candles[i - self.swing_lookback:i + self.swing_lookback + 1]
            current = candles[i]

            # Swing High
            is_swing_high = all(
                c['high'] <= current['high']
                for j, c in enumerate(window)
                if j != self.swing_lookback
            )
            if is_swing_high:
                swings['highs'].append({
                    'index': i,
                    'price': current['high'],
                    'timestamp': current['timestamp']
                })

            # Swing Low
            is_swing_low = all(
                c['low'] >= current['low']
                for j, c in enumerate(window)
                if j != self.swing_lookback
            )
            if is_swing_low:
                swings['lows'].append({
                    'index': i,
                    'price': current['low'],
                    'timestamp': current['timestamp']
                })

        return swings

    def _calculate_swing_consistency(self, swings: Dict) -> float:
        """Calculate swing consistency score (0-100)"""
        highs = swings['highs']
        lows = swings['lows']

        if len(highs) < 2 or len(lows) < 2:
            return 0

        # Uptrend: Higher Highs + Higher Lows
        hh_count = sum(1 for i in range(1, len(highs)) if highs[i]['price'] > highs[i-1]['price'])
        hl_count = sum(1 for i in range(1, len(lows)) if lows[i]['price'] > lows[i-1]['price'])
        uptrend_score = ((hh_count / (len(highs) - 1)) + (hl_count / (len(lows) - 1))) / 2

        # Downtrend: Lower Highs + Lower Lows
        lh_count = sum(1 for i in range(1, len(highs)) if highs[i]['price'] < highs[i-1]['price'])
        ll_count = sum(1 for i in range(1, len(lows)) if lows[i]['price'] < lows[i-1]['price'])
        downtrend_score = ((lh_count / (len(highs) - 1)) + (ll_count / (len(lows) - 1))) / 2

        return max(uptrend_score, downtrend_score) * 100

    def _calculate_progression_angle(self, candles: List[Dict]) -> float:
        """Calculate trend angle using linear regression (0-100)"""
        closes = [c['close'] for c in candles]
        n = len(closes)

        # Linear regression
        x = np.arange(n)
        y = np.array(closes)

        # Calculate slope
        slope = np.polyfit(x, y, 1)[0]

        # Convert to angle
        angle_rad = np.arctan(slope)
        angle_deg = np.degrees(angle_rad)

        # Normalize to 0-100 (assuming max 45 degrees)
        normalized = min(abs(angle_deg) / 45.0, 1.0)

        return normalized * 100

    def _determine_direction(self, swings: Dict, candles: List[Dict]) -> str:
        """Determine trend direction"""
        highs = swings['highs']
        lows = swings['lows']

        if len(highs) < 2 or len(lows) < 2:
            return 'NONE'

        # Recent trend based on last 2 swings
        recent_highs = highs[-2:]
        recent_lows = lows[-2:]

        is_uptrend = (
            recent_highs[1]['price'] > recent_highs[0]['price'] and
            recent_lows[1]['price'] > recent_lows[0]['price']
        )

        is_downtrend = (
            recent_highs[1]['price'] < recent_highs[0]['price'] and
            recent_lows[1]['price'] < recent_lows[0]['price']
        )

        if is_uptrend:
            return 'UP'
        elif is_downtrend:
            return 'DOWN'
        return 'RANGE'
```

**backend/pattern_detector_extended.py** - NEW
```python
from typing import List, Dict, Optional

class PatternDetectorExtended:
    def detect_inside_bar(self, candles: List[Dict], index: int, params: Dict) -> Optional[Dict]:
        """Detect inside bar pattern"""
        if index < 1:
            return None

        mother = candles[index - 1]
        child = candles[index]

        # Mother must be significant size
        mother_range = mother['high'] - mother['low']
        mother_size_pct = mother_range / mother['close']

        min_mother_size = params.get('minMotherCandleSize', 0.005)
        if mother_size_pct < min_mother_size:
            return None

        # Child must be inside mother
        if not (child['high'] <= mother['high'] and child['low'] >= mother['low']):
            return None

        # Optional: full containment check
        if params.get('requireFullContainment', True):
            touch_margin = mother_range * 0.05
            if (child['high'] > mother['high'] - touch_margin or
                child['low'] < mother['low'] + touch_margin):
                return None

        child_range = child['high'] - child['low']
        compression_ratio = child_range / mother_range

        return {
            'type': 'INSIDE_BAR',
            'index': index,
            'timestamp': child['timestamp'],
            'motherIndex': index - 1,
            'motherRange': mother_range,
            'childRange': child_range,
            'compressionRatio': compression_ratio,
            'quality': self._calculate_inside_bar_quality(mother, child)
        }

    def detect_momentum(self, candles: List[Dict], index: int,
                       params: Dict, volumes: List[float]) -> Optional[Dict]:
        """Detect momentum pattern"""
        min_consecutive = params.get('minConsecutiveCandles', 3)
        min_body_pct = params.get('minBodyPercent', 0.6)
        min_candle_size = params.get('minCandleSize', 0.003)

        volume_comp = params.get('volumeCompensation', {})

        if index < min_consecutive:
            return None

        consecutive_count = 0
        direction = None
        total_range = 0
        has_high_volume = False

        # Calculate average volume
        avg_volume = 0
        if volume_comp.get('enabled', False) and volumes:
            recent_vols = volumes[max(0, index - 20):index]
            avg_volume = sum(recent_vols) / len(recent_vols) if recent_vols else 0

        # Count consecutive strong candles
        for i in range(index, -1, -1):
            candle = candles[i]
            candle_range = candle['high'] - candle['low']
            body = abs(candle['close'] - candle['open'])
            body_ratio = body / candle_range if candle_range > 0 else 0
            candle_size_pct = candle_range / candle['close']

            if body_ratio < min_body_pct or candle_size_pct < min_candle_size:
                break

            is_bullish = candle['close'] > candle['open']
            current_direction = 'BULLISH' if is_bullish else 'BEARISH'

            if direction is None:
                direction = current_direction
            elif direction != current_direction:
                break

            consecutive_count += 1
            total_range += candle_range

            # Check volume
            if volume_comp.get('enabled', False) and i < len(volumes):
                high_vol_threshold = volume_comp.get('highVolumeThreshold', 2.0)
                if volumes[i] >= avg_volume * high_vol_threshold:
                    has_high_volume = True

        # Adjust required candles with volume compensation
        required_candles = min_consecutive
        if volume_comp.get('enabled', False) and has_high_volume:
            required_candles = min(required_candles, volume_comp.get('minCandlesWithHighVolume', 2))

        if consecutive_count >= required_candles:
            return {
                'type': 'MOMENTUM',
                'index': index,
                'timestamp': candles[index]['timestamp'],
                'direction': direction,
                'consecutiveCount': consecutive_count,
                'totalRange': total_range,
                'avgCandleSize': total_range / consecutive_count,
                'hasHighVolume': has_high_volume,
                'quality': self._calculate_momentum_quality(consecutive_count, total_range, has_high_volume)
            }

        return None

    def _calculate_inside_bar_quality(self, mother: Dict, child: Dict) -> float:
        """Calculate inside bar quality score"""
        mother_range = mother['high'] - mother['low']
        child_range = child['high'] - child['low']
        compression_ratio = child_range / mother_range

        quality = 50

        # Tight compression
        if compression_ratio < 0.3:
            quality += 30
        elif compression_ratio < 0.5:
            quality += 20
        elif compression_ratio < 0.7:
            quality += 10

        # Mother size
        mother_size = mother_range / mother['close']
        if mother_size > 0.02:
            quality += 20
        elif mother_size > 0.01:
            quality += 10

        return min(quality, 100)

    def _calculate_momentum_quality(self, consecutive_count: int,
                                   total_range: float, has_high_volume: bool) -> float:
        """Calculate momentum pattern quality"""
        quality = 50

        if consecutive_count >= 5:
            quality += 30
        elif consecutive_count >= 4:
            quality += 20
        elif consecutive_count >= 3:
            quality += 10

        if total_range > 0.05:
            quality += 20
        elif total_range > 0.03:
            quality += 10

        if has_high_volume:
            quality += 20

        return min(quality, 100)
```

#### 2.3 Testing Criteria
- [ ] Trend analyzer identifies uptrends/downtrends correctly
- [ ] Swing consistency calculates HH/HL and LH/LL accurately
- [ ] Progression angle matches manual linear regression
- [ ] Inside bar detection finds only valid patterns
- [ ] False breakout requires inside bar + breakout + reversal
- [ ] Momentum detector counts consecutive candles correctly
- [ ] Volume compensation reduces candle requirement with high volume
- [ ] Pattern quality scores are consistent and logical

---

### PHASE 3: Continuation Indicator & Adaptive Scoring (4-5 days)

#### 3.1 Frontend Component

**ContinuationPatternIndicator.js** - NEW
```javascript
import IndicatorBase from './IndicatorBase.js';
import LocalPatternDetector from '../LocalPatternDetector.js';
import PatternDetectorExtended from '../PatternDetectorExtended.js';
import TrendAnalyzer from '../TrendAnalyzer.js';

class ContinuationPatternIndicator extends IndicatorBase {
  constructor(symbol, indicatorManager) {
    super(symbol, 'continuation-patterns', indicatorManager);

    this.localDetector = new LocalPatternDetector();
    this.extendedDetector = new PatternDetectorExtended();
    this.trendAnalyzer = new TrendAnalyzer();

    this.patterns = [];
    this.trendInfo = null;
  }

  async calculate(candles, config) {
    if (!candles || candles.length < 30) {
      this.patterns = [];
      return;
    }

    // Analyze trend
    this.trendInfo = this.trendAnalyzer.analyzeTrend(candles);

    // Get all level sources
    const levelSourceManager = this.indicatorManager.levelSourceManager;
    const allLevels = levelSourceManager.getAllLevels(config);

    // Detect patterns
    const detectedPatterns = [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // NEW PATTERNS

      // Inside Bar
      if (config.patterns.insideBar.enabled) {
        const insideBar = this.extendedDetector.detectInsideBar(
          candles, i, config.patterns.insideBar
        );
        if (insideBar) {
          detectedPatterns.push(insideBar);
        }
      }

      // False Breakout
      if (config.patterns.falseBreakout.enabled && i >= 2) {
        const falseBreakout = this.extendedDetector.detectFalseBreakout(
          candles, i, config.patterns.falseBreakout
        );
        if (falseBreakout) {
          detectedPatterns.push(falseBreakout);
        }
      }

      // Momentum
      if (config.patterns.momentum.enabled) {
        const volumes = candles.map(c => c.volume);
        const momentum = this.extendedDetector.detectMomentum(
          candles, i, config.patterns.momentum, volumes
        );
        if (momentum) {
          detectedPatterns.push(momentum);
        }
      }

      // EXISTING PATTERNS (with optional reclassification)

      if (config.patterns.hammer.enabled || config.patterns.shootingStar.enabled ||
          config.patterns.engulfing.enabled || config.patterns.doji.enabled) {

        const localPatterns = this.localDetector.detectPatterns(candles, config);

        for (const pattern of localPatterns) {
          if (pattern.index === i) {
            detectedPatterns.push(pattern);
          }
        }
      }
    }

    // Classify and score patterns
    this.patterns = detectedPatterns.map(pattern => {
      const classification = this.classifyPattern(pattern, candles, this.trendInfo);
      const confidence = this.calculateAdaptiveConfidence(
        pattern, classification, allLevels, config, candles
      );

      return {
        ...pattern,
        classification,
        confidence,
        trendContext: {
          direction: this.trendInfo.direction,
          strength: this.trendInfo.strength,
          strengthLabel: this.trendInfo.strengthLabel
        }
      };
    });

    // Filter by minimum confidence
    if (config.filters.minConfidence) {
      this.patterns = this.patterns.filter(p => p.confidence >= config.filters.minConfidence);
    }

    // Filter by trend requirement
    if (config.filters.requireTrend) {
      this.patterns = this.patterns.filter(p =>
        this.trendInfo.direction !== 'NONE' && this.trendInfo.direction !== 'RANGE'
      );
    }
  }

  classifyPattern(pattern, candles, trendInfo) {
    const patternIndex = pattern.index;
    const candle = candles[patternIndex];

    // Default classification
    let classification = 'REVERSAL';

    // Check if user wants reclassification by context
    const reclassifyEnabled = pattern.reclassifyByContext !== undefined
      ? pattern.reclassifyByContext
      : true;

    if (!reclassifyEnabled) {
      return classification;
    }

    // Pattern-specific classification
    switch (pattern.type) {
      case 'INSIDE_BAR':
        // Inside bar in middle of trend = continuation
        if (trendInfo.direction !== 'NONE' && trendInfo.direction !== 'RANGE') {
          const isInPullback = this.trendAnalyzer.isInPullback(
            candles.slice(0, patternIndex + 1), trendInfo
          );
          classification = isInPullback ? 'CONTINUATION' : 'REVERSAL';
        }
        break;

      case 'FALSE_BREAKOUT':
        // False breakout typically signals continuation after trap
        if (trendInfo.direction !== 'NONE') {
          classification = 'CONTINUATION';
        } else {
          classification = 'REVERSAL';
        }
        break;

      case 'MOMENTUM':
        // Momentum patterns
        if (trendInfo.strengthLabel === 'WEAK') {
          classification = 'TREND_START';
        } else {
          classification = 'MOMENTUM';
        }
        break;

      case 'HAMMER':
      case 'SHOOTING_STAR':
      case 'ENGULFING':
      case 'DOJI':
        // Existing patterns: check location
        if (trendInfo.direction === 'UP') {
          const isAtTop = this._isNearSwingHigh(candle, trendInfo.swings);
          classification = isAtTop ? 'REVERSAL' : 'CONTINUATION';
        } else if (trendInfo.direction === 'DOWN') {
          const isAtBottom = this._isNearSwingLow(candle, trendInfo.swings);
          classification = isAtBottom ? 'REVERSAL' : 'CONTINUATION';
        }
        break;
    }

    return classification;
  }

  calculateAdaptiveConfidence(pattern, classification, allLevels, config, candles) {
    // BASE FACTORS (60%)
    const patternQuality = pattern.quality || 50;
    const relativeSize = this._calculateRelativeSize(pattern, candles);
    const volumeScore = this._calculateVolumeScore(pattern, candles);

    const baseScore =
      (patternQuality * 0.25) +
      (relativeSize * 0.20) +
      (volumeScore * 0.15);

    // LEVEL FACTORS (40% - distributed among active sources)
    const activeWeights = this._getActiveSourceWeights(config);
    let levelScore = 0;

    const patternPrice = candles[pattern.index].close;

    for (const { source, weight } of activeWeights) {
      let sourceScore = 0;

      switch (source) {
        case 'sr':
          sourceScore = this._calculateProximityScore(patternPrice, allLevels.srLevels);
          break;
        case 'vwap':
          sourceScore = this._calculateProximityScore(patternPrice, allLevels.vwapLevels);
          break;
        case 'vp':
          sourceScore = this._calculateProximityScore(patternPrice, allLevels.vpLevels);
          break;
        case 'fibonacci':
          sourceScore = this._calculateProximityScore(patternPrice, allLevels.fibonacciLevels);
          break;
        case 'manual':
          sourceScore = this._calculateProximityScore(patternPrice, allLevels.manualLevels);
          break;
      }

      levelScore += sourceScore * weight;
    }

    // Final confidence
    const confidence = (baseScore * 0.6) + (levelScore * 0.4);

    return Math.min(Math.round(confidence), 100);
  }

  _getActiveSourceWeights(config) {
    const sources = [];

    if (config.levelSources.supportResistance) sources.push('sr');
    if (config.levelSources.vwap) sources.push('vwap');
    if (config.levelSources.volumeProfile) sources.push('vp');
    if (config.levelSources.fibonacci) sources.push('fibonacci');
    if (config.levelSources.manualLevels) sources.push('manual');

    if (sources.length === 0) {
      return [{ source: 'none', weight: 0 }];
    }

    const weight = 0.40 / sources.length;
    return sources.map(s => ({ source: s, weight }));
  }

  _calculateProximityScore(price, levels) {
    if (!levels || levels.length === 0) return 0;

    let bestProximity = Infinity;

    for (const level of levels) {
      const levelPrice = level.price || level;
      const distance = Math.abs(price - levelPrice);
      const proximityPercent = distance / price;

      if (proximityPercent < bestProximity) {
        bestProximity = proximityPercent;
      }
    }

    // Convert proximity to score (closer = higher)
    if (bestProximity < 0.002) return 100; // Within 0.2%
    if (bestProximity < 0.005) return 80;  // Within 0.5%
    if (bestProximity < 0.01) return 60;   // Within 1%
    if (bestProximity < 0.02) return 40;   // Within 2%
    return 20;
  }

  _calculateRelativeSize(pattern, candles) {
    const patternCandle = candles[pattern.index];
    const range = patternCandle.high - patternCandle.low;

    // Compare to recent average
    const recentCandles = candles.slice(Math.max(0, pattern.index - 20), pattern.index);
    const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;

    const relativeSize = range / avgRange;

    if (relativeSize >= 2.0) return 100;
    if (relativeSize >= 1.5) return 80;
    if (relativeSize >= 1.2) return 60;
    if (relativeSize >= 1.0) return 40;
    return 20;
  }

  _calculateVolumeScore(pattern, candles) {
    if (!candles[pattern.index].volume) return 50;

    const patternVolume = candles[pattern.index].volume;
    const recentCandles = candles.slice(Math.max(0, pattern.index - 20), pattern.index);
    const avgVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;

    const volumeRatio = patternVolume / avgVolume;

    if (volumeRatio >= 3.0) return 100;
    if (volumeRatio >= 2.0) return 80;
    if (volumeRatio >= 1.5) return 60;
    if (volumeRatio >= 1.0) return 40;
    return 20;
  }

  _isNearSwingHigh(candle, swings) {
    if (!swings || !swings.highs || swings.highs.length === 0) return false;

    const recentHigh = swings.highs[swings.highs.length - 1];
    const proximity = Math.abs(candle.close - recentHigh.price) / candle.close;

    return proximity < 0.01; // Within 1%
  }

  _isNearSwingLow(candle, swings) {
    if (!swings || !swings.lows || swings.lows.length === 0) return false;

    const recentLow = swings.lows[swings.lows.length - 1];
    const proximity = Math.abs(candle.close - recentLow.price) / candle.close;

    return proximity < 0.01; // Within 1%
  }

  draw(ctx, viewport) {
    // Visualization similar to RejectionPatternIndicator
    // Draw markers on chart for patterns
    // Color-coded by classification (REVERSAL, CONTINUATION, TREND_START, MOMENTUM)
    // Show confidence scores
  }

  getPatterns() {
    return this.patterns;
  }
}

export default ContinuationPatternIndicator;
```

#### 3.2 Backend Component

**backend/continuation_detector.py** - NEW
```python
from typing import List, Dict
from trend_analyzer import TrendAnalyzer
from pattern_detector_extended import PatternDetectorExtended

class ContinuationDetector:
    def __init__(self):
        self.trend_analyzer = TrendAnalyzer()
        self.pattern_detector = PatternDetectorExtended()

    def detect_patterns(self, symbol: str, candles: List[Dict],
                       config: Dict, all_levels: Dict) -> List[Dict]:
        """Detect continuation patterns with context classification"""

        if len(candles) < 30:
            return []

        # Analyze trend
        trend_info = self.trend_analyzer.analyze_trend(candles)

        # Detect patterns
        detected_patterns = []

        for i in range(len(candles)):
            # Inside Bar
            if config['patterns']['insideBar']['enabled']:
                inside_bar = self.pattern_detector.detect_inside_bar(
                    candles, i, config['patterns']['insideBar']
                )
                if inside_bar:
                    detected_patterns.append(inside_bar)

            # Momentum
            if config['patterns']['momentum']['enabled']:
                volumes = [c['volume'] for c in candles]
                momentum = self.pattern_detector.detect_momentum(
                    candles, i, config['patterns']['momentum'], volumes
                )
                if momentum:
                    detected_patterns.append(momentum)

        # Classify and score
        results = []
        for pattern in detected_patterns:
            classification = self._classify_pattern(pattern, candles, trend_info)
            confidence = self._calculate_adaptive_confidence(
                pattern, classification, all_levels, config, candles
            )

            results.append({
                **pattern,
                'classification': classification,
                'confidence': confidence,
                'trendContext': {
                    'direction': trend_info['direction'],
                    'strength': trend_info['strength'],
                    'strengthLabel': trend_info['strengthLabel']
                }
            })

        # Filter
        if config['filters'].get('minConfidence'):
            results = [p for p in results if p['confidence'] >= config['filters']['minConfidence']]

        return results

    def _classify_pattern(self, pattern: Dict, candles: List[Dict],
                         trend_info: Dict) -> str:
        """Classify pattern based on context"""
        classification = 'REVERSAL'

        if pattern['type'] == 'INSIDE_BAR':
            if trend_info['direction'] in ['UP', 'DOWN']:
                classification = 'CONTINUATION'

        elif pattern['type'] == 'MOMENTUM':
            if trend_info['strengthLabel'] == 'WEAK':
                classification = 'TREND_START'
            else:
                classification = 'MOMENTUM'

        return classification

    def _calculate_adaptive_confidence(self, pattern: Dict, classification: str,
                                      all_levels: Dict, config: Dict,
                                      candles: List[Dict]) -> int:
        """Calculate adaptive confidence score"""
        # Base factors (60%)
        pattern_quality = pattern.get('quality', 50)
        relative_size = self._calculate_relative_size(pattern, candles)
        volume_score = self._calculate_volume_score(pattern, candles)

        base_score = (pattern_quality * 0.25) + (relative_size * 0.20) + (volume_score * 0.15)

        # Level factors (40%)
        active_weights = self._get_active_source_weights(config)
        level_score = 0

        pattern_price = candles[pattern['index']]['close']

        for source_data in active_weights:
            source = source_data['source']
            weight = source_data['weight']

            source_score = 0

            if source in all_levels and all_levels[source]:
                source_score = self._calculate_proximity_score(
                    pattern_price, all_levels[source]
                )

            level_score += source_score * weight

        confidence = (base_score * 0.6) + (level_score * 0.4)

        return min(round(confidence), 100)

    def _get_active_source_weights(self, config: Dict) -> List[Dict]:
        """Get weights for active level sources"""
        sources = []

        level_sources = config.get('levelSources', {})

        if level_sources.get('supportResistance'):
            sources.append('sr')
        if level_sources.get('vwap'):
            sources.append('vwap')
        if level_sources.get('volumeProfile'):
            sources.append('vp')
        if level_sources.get('fibonacci'):
            sources.append('fibonacci')
        if level_sources.get('manualLevels'):
            sources.append('manual')

        if not sources:
            return [{'source': 'none', 'weight': 0}]

        weight = 0.40 / len(sources)
        return [{'source': s, 'weight': weight} for s in sources]

    def _calculate_proximity_score(self, price: float, levels: List) -> float:
        """Calculate proximity score to nearest level"""
        if not levels:
            return 0

        best_proximity = float('inf')

        for level in levels:
            level_price = level.get('price', level)
            distance = abs(price - level_price)
            proximity_pct = distance / price

            if proximity_pct < best_proximity:
                best_proximity = proximity_pct

        # Convert to score
        if best_proximity < 0.002:
            return 100
        elif best_proximity < 0.005:
            return 80
        elif best_proximity < 0.01:
            return 60
        elif best_proximity < 0.02:
            return 40
        return 20

    def _calculate_relative_size(self, pattern: Dict, candles: List[Dict]) -> float:
        """Calculate relative candle size score"""
        pattern_candle = candles[pattern['index']]
        candle_range = pattern_candle['high'] - pattern_candle['low']

        # Recent average
        start_idx = max(0, pattern['index'] - 20)
        recent = candles[start_idx:pattern['index']]
        avg_range = sum(c['high'] - c['low'] for c in recent) / len(recent) if recent else candle_range

        relative_size = candle_range / avg_range if avg_range > 0 else 1.0

        if relative_size >= 2.0:
            return 100
        elif relative_size >= 1.5:
            return 80
        elif relative_size >= 1.2:
            return 60
        elif relative_size >= 1.0:
            return 40
        return 20

    def _calculate_volume_score(self, pattern: Dict, candles: List[Dict]) -> float:
        """Calculate volume score"""
        pattern_candle = candles[pattern['index']]

        if 'volume' not in pattern_candle:
            return 50

        pattern_volume = pattern_candle['volume']

        start_idx = max(0, pattern['index'] - 20)
        recent = candles[start_idx:pattern['index']]
        avg_volume = sum(c['volume'] for c in recent) / len(recent) if recent else pattern_volume

        volume_ratio = pattern_volume / avg_volume if avg_volume > 0 else 1.0

        if volume_ratio >= 3.0:
            return 100
        elif volume_ratio >= 2.0:
            return 80
        elif volume_ratio >= 1.5:
            return 60
        elif volume_ratio >= 1.0:
            return 40
        return 20
```

#### 3.3 API Endpoint

**backend/main.py** - ADD
```python
from continuation_detector import ContinuationDetector

continuation_detector = ContinuationDetector()

@app.post("/api/continuation-patterns/detect")
async def detect_continuation_patterns(request: Request):
    """Detect continuation patterns with context validation"""
    body = await request.json()

    symbol = body.get('symbol')
    config = body.get('config', {})
    interval = body.get('interval', '60')
    days = body.get('days', 7)

    # Get historical data
    candles = await fetch_historical_data(symbol, interval, days)

    # Get all level sources
    all_levels = {}

    # Support & Resistance
    if config.get('levelSources', {}).get('supportResistance'):
        sr_levels = await get_support_resistance_levels(symbol, interval, days)
        all_levels['sr'] = sr_levels

    # VWAP
    if config.get('levelSources', {}).get('vwap'):
        vwap_data = await get_vwap(symbol, interval, days, 'session')
        all_levels['vwap'] = vwap_data['data']

    # Volume Profile
    if config.get('levelSources', {}).get('volumeProfile'):
        vp_levels = await get_volume_profile_levels(symbol, interval, days)
        all_levels['vp'] = vp_levels

    # Fibonacci
    if config.get('levelSources', {}).get('fibonacci'):
        fib_config = config.get('fibonacci', {})
        fib_data = await calculate_fibonacci(
            symbol,
            fib_config.get('swingHigh'),
            fib_config.get('swingLow'),
            fib_config.get('autoDetect', True),
            interval,
            days
        )
        all_levels['fibonacci'] = fib_data['retracements'] + fib_data['extensions']

    # Detect patterns
    patterns = continuation_detector.detect_patterns(symbol, candles, config, all_levels)

    return {
        'symbol': symbol,
        'interval': interval,
        'patterns': patterns,
        'trendInfo': patterns[0]['trendContext'] if patterns else None
    }
```

#### 3.4 Testing Criteria
- [ ] Patterns classified correctly (REVERSAL vs CONTINUATION vs TREND_START vs MOMENTUM)
- [ ] Adaptive confidence adjusts weights based on active sources
- [ ] Base factors (quality, size, volume) contribute 60%
- [ ] Level factors contribute 40%, distributed among active sources
- [ ] Reclassification toggle works for existing patterns
- [ ] Filter by minimum confidence works
- [ ] Filter by trend requirement works
- [ ] API returns all pattern data correctly

---

### PHASE 4: UI, Configuration & Documentation (3-4 days)

#### 4.1 UI Components

**ContinuationPatternSettings.jsx** - NEW

Complete modal matching RejectionPatternSettings.jsx style with:
- Toggle for each pattern (Inside Bar, False Breakout, Momentum, Hammer, Shooting Star, Engulfing, Doji)
- Pattern-specific parameters (collapsible sections)
- Level source toggles (S/R, VWAP, VP, Fibonacci, Manual)
- VWAP configuration (session/anchored/rolling, bands)
- Fibonacci configuration (auto-detect, manual swing selection)
- Filter settings (min confidence, require trend)
- Export/Import configuration
- Reset to defaults

#### 4.2 Integration Points

**Watchlist.jsx** - MODIFY
```javascript
// Add state
const [continuationPatternsEnabled, setContinuationPatternsEnabled] = useState(false);
const [continuationPatternsConfig, setContinuationPatternsConfig] = useState(DEFAULT_CONFIG);

// Add indicator toggle
<input
  type="checkbox"
  checked={continuationPatternsEnabled}
  onChange={(e) => setContinuationPatternsEnabled(e.target.checked)}
/>
Continuation Patterns

// Add settings button
<button onClick={() => setShowContinuationSettings(true)}>
  ⚙️ Configure
</button>

// Pass to MiniChart
<MiniChart
  continuationPatternsEnabled={continuationPatternsEnabled}
  continuationPatternsConfig={continuationPatternsConfig}
  ...
/>
```

**IndicatorManager.js** - MODIFY
```javascript
// Add to initializeIndicators()
if (config.continuationPatternsEnabled) {
  const continuationIndicator = new ContinuationPatternIndicator(this.symbol, this);
  this.indicators.set('continuation-patterns', continuationIndicator);
  await continuationIndicator.calculate(this.candles, config.continuationPatternsConfig);
}
```

#### 4.3 Export/Import Functionality

```javascript
function exportConfig(config) {
  const dataStr = JSON.stringify(config, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `continuation-patterns-config-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importConfig(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const config = JSON.parse(e.target.result);
      callback(config);
      alert('Configuration imported successfully!');
    } catch (error) {
      alert('Error parsing configuration file');
    }
  };
  reader.readAsText(file);
}
```

#### 4.4 Final Documentation

- Complete inline code comments
- Update CLAUDE.md with new architecture
- Create migration guide from old system
- Performance benchmarking report

#### 4.5 Testing Criteria
- [ ] UI settings modal opens and closes correctly
- [ ] All pattern toggles work
- [ ] Parameter inputs validate correctly
- [ ] Level source toggles enable/disable features
- [ ] VWAP appears on chart when enabled
- [ ] Fibonacci levels draw correctly
- [ ] Export creates valid JSON file
- [ ] Import loads configuration correctly
- [ ] Reset to defaults works
- [ ] Configuration persists in localStorage
- [ ] Patterns visualize on chart correctly
- [ ] Confidence scores display accurately
- [ ] No performance degradation with all indicators enabled
- [ ] WebSocket updates work correctly
- [ ] Cache system functions properly

---

## 4. CONFIGURATION SCHEMA

### Complete Configuration Object

```javascript
const DEFAULT_CONTINUATION_PATTERNS_CONFIG = {
  // Pattern toggles and parameters
  patterns: {
    insideBar: {
      enabled: true,
      requireFullContainment: true,
      minMotherCandleSize: 0.005,
      reclassifyByContext: true
    },
    falseBreakout: {
      enabled: true,
      lookforwardCandles: 3,
      minReversalPercent: 0.01,
      requireVolumeSpike: false,
      reclassifyByContext: true
    },
    momentum: {
      enabled: true,
      minConsecutiveCandles: 3,
      minBodyPercent: 0.6,
      minCandleSize: 0.003,
      volumeCompensation: {
        enabled: true,
        highVolumeThreshold: 2.0,
        minCandlesWithHighVolume: 2
      },
      reclassifyByContext: true
    },
    hammer: {
      enabled: true,
      minWickRatio: 2.0,
      maxUpperWickRatio: 0.2,
      minBodyPosition: 0.6,
      reclassifyByContext: true
    },
    shootingStar: {
      enabled: true,
      minWickRatio: 2.0,
      maxLowerWickRatio: 0.2,
      maxBodyPosition: 0.4,
      reclassifyByContext: true
    },
    engulfing: {
      enabled: true,
      minEngulfPercent: 1.0,
      requireBodyEngulf: true,
      reclassifyByContext: true
    },
    doji: {
      enabled: true,
      maxBodyPercent: 0.1,
      minWickRatio: 3.0,
      reclassifyByContext: true
    }
  },

  // Level sources
  levelSources: {
    supportResistance: true,
    volumeProfile: true,
    vwap: false, // Optional
    fibonacci: false, // Optional
    manualLevels: true
  },

  // VWAP configuration
  vwap: {
    type: 'session', // 'session' | 'anchored' | 'rolling'
    sessionResetHour: 0, // UTC hour for session reset
    anchoredTimestamp: null, // For anchored VWAP
    rollingPeriod: 20, // For rolling VWAP
    showBands: true,
    bandMultipliers: [1.0, 2.0, 3.0], // σ multipliers (crypto-adjusted internally)
    color: 'rgba(255, 152, 0, 0.8)',
    bandColors: {
      band1: 'rgba(255, 152, 0, 0.3)',
      band2: 'rgba(255, 152, 0, 0.2)',
      band3: 'rgba(255, 152, 0, 0.1)'
    }
  },

  // Fibonacci configuration
  fibonacci: {
    autoDetect: true,
    swingHigh: null, // Manual swing high price
    swingLow: null, // Manual swing low price
    lookback: 50, // For auto-detection
    showRetracements: true,
    showExtensions: false,
    levels: [0.236, 0.382, 0.5, 0.618, 0.786],
    extensionLevels: [1.272, 1.414, 1.618, 2.0, 2.618],
    color: 'rgba(33, 150, 243, 0.6)'
  },

  // Trend analysis
  trendAnalysis: {
    swingLookback: 5,
    trendLookback: 20,
    angleNormalizationMax: 45
  },

  // Filters
  filters: {
    minConfidence: 50,
    requireTrend: false,
    showOnlyValidated: false
  },

  // Visualization
  visualization: {
    showConfidenceLabels: true,
    showClassificationLabels: true,
    colorByClassification: true,
    colors: {
      REVERSAL: 'rgba(244, 67, 54, 0.8)',
      CONTINUATION: 'rgba(76, 175, 80, 0.8)',
      TREND_START: 'rgba(33, 150, 243, 0.8)',
      MOMENTUM: 'rgba(255, 152, 0, 0.8)'
    }
  },

  // Alerts (optional)
  alerts: {
    enabled: false,
    minConfidence: 70,
    patterns: ['INSIDE_BAR', 'FALSE_BREAKOUT', 'MOMENTUM'],
    classifications: ['CONTINUATION', 'TREND_START']
  }
};
```

---

## 5. SUCCESS METRICS

### Performance Targets
- Pattern detection: < 100ms for 1000 candles
- VWAP calculation: < 50ms for 1000 candles
- Fibonacci calculation: < 20ms
- Total indicator load time: < 500ms
- WebSocket update latency: < 50ms

### Accuracy Targets
- Trend direction accuracy: > 85%
- Pattern classification consistency: > 90%
- Confidence score correlation with outcome: > 0.7
- VWAP calculation accuracy vs TradingView: ± 0.1%

### User Experience
- Configuration modal loads in < 200ms
- No visual lag when toggling indicators
- Export/import works in < 1 second
- Settings persist across sessions
- No browser console errors

---

## 6. RISK MITIGATION

### Technical Risks

**Risk 1: Performance Degradation**
- Mitigation: Implement debouncing on WebSocket updates
- Mitigation: Use Web Workers for heavy calculations
- Mitigation: Cache calculated data when possible

**Risk 2: VWAP Calculation Inconsistencies**
- Mitigation: Extensive testing against TradingView
- Mitigation: Unit tests for edge cases (session boundaries, missing data)
- Mitigation: Clear documentation of calculation method

**Risk 3: Fibonacci Auto-Detection Failures**
- Mitigation: Fallback to manual swing selection
- Mitigation: Clear UI feedback when auto-detection fails
- Mitigation: Configurable lookback period

**Risk 4: Adaptive Scoring Complexity**
- Mitigation: Comprehensive unit tests for all weight combinations
- Mitigation: Debug mode to show scoring breakdown
- Mitigation: Default to simple scoring if calculation fails

### Integration Risks

**Risk 1: Breaking Existing Patterns**
- Mitigation: Comprehensive regression testing
- Mitigation: Feature flags to disable new features
- Mitigation: Backward compatibility layer

**Risk 2: Level Source Conflicts**
- Mitigation: Clear precedence rules
- Mitigation: UI feedback showing active sources
- Mitigation: Validation to prevent invalid combinations

---

## 7. TIMELINE SUMMARY

| Phase | Duration | Completion Date |
|-------|----------|----------------|
| Phase 0: Documentation | 0.5 days | Immediate |
| Phase 1: Foundation & VWAP | 5-7 days | +7 days |
| Phase 2: Trend & Patterns | 5-6 days | +13 days |
| Phase 3: Continuation & Scoring | 4-5 days | +18 days |
| Phase 4: UI & Documentation | 3-4 days | +22 days |
| **Total** | **17-22 days** | **~3-4 weeks** |

---

## 8. NEXT STEPS

### Immediate Actions (Phase 0 - Complete)
- [x] Create CONTINUATION_PATTERNS_USER_GUIDE.md
- [x] Create CONTINUATION_PATTERNS_IMPLEMENTATION_PLAN.md (this file)
- [ ] Create VWAP_RESEARCH_SUMMARY.md
- [ ] Create TREND_STRENGTH_FORMULA.md
- [ ] Create PATTERN_CONFIGURATION_REFERENCE.md

### Phase 1 Kickoff (After Phase 0)
1. Set up development branch: `feature/continuation-patterns`
2. Create component files with skeleton code
3. Implement VWAP calculator (backend first)
4. Create VWAPIndicator.js
5. Begin testing VWAP against TradingView

---

**END OF IMPLEMENTATION PLAN**
