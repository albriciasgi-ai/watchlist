# PATTERN CONFIGURATION REFERENCE

**Complete Configuration Schema & Parameter Guide**
**Created:** 2025-12-10
**Purpose:** Comprehensive reference for all pattern detection parameters and settings

---

## 1. CONFIGURATION OVERVIEW

### Schema Structure

```javascript
{
  patterns: { /* Individual pattern configs */ },
  levelSources: { /* Reference level toggles */ },
  vwap: { /* VWAP settings */ },
  fibonacci: { /* Fibonacci settings */ },
  trendAnalysis: { /* Trend analyzer settings */ },
  filters: { /* Global filters */ },
  visualization: { /* Display settings */ },
  alerts: { /* Alert configuration */ }
}
```

### Default Configuration Object

**Location:** `frontend/src/config/defaultContinuationPatternsConfig.js`

```javascript
export const DEFAULT_CONTINUATION_PATTERNS_CONFIG = {
  patterns: {
    insideBar: {
      enabled: true,
      requireFullContainment: true,
      minMotherCandleSize: 0.005,
      maxCompressionRatio: 0.7,
      reclassifyByContext: true
    },
    falseBreakout: {
      enabled: true,
      lookforwardCandles: 3,
      minReversalPercent: 0.01,
      requireVolumeSpike: false,
      volumeSpikeThreshold: 1.5,
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
      volumeFilter: {
        enabled: false,
        minZScore: 0.5
      },
      reclassifyByContext: true
    },
    shootingStar: {
      enabled: true,
      minWickRatio: 2.0,
      maxLowerWickRatio: 0.2,
      maxBodyPosition: 0.4,
      volumeFilter: {
        enabled: false,
        minZScore: 0.5
      },
      reclassifyByContext: true
    },
    engulfing: {
      enabled: true,
      minEngulfPercent: 1.0,
      requireBodyEngulf: true,
      requireVolumeIncrease: false,
      minVolumeRatio: 1.2,
      reclassifyByContext: true
    },
    doji: {
      enabled: true,
      maxBodyPercent: 0.1,
      minWickRatio: 3.0,
      requireSymmetry: false,
      symmetryTolerance: 0.3,
      reclassifyByContext: true
    }
  },

  levelSources: {
    supportResistance: true,
    volumeProfile: true,
    vwap: false,
    fibonacci: false,
    manualLevels: true
  },

  vwap: {
    type: 'session',
    sessionResetHour: 0,
    anchoredTimestamp: null,
    rollingPeriod: 20,
    showBands: true,
    bandMultipliers: [1.0, 2.0, 3.0],
    cryptoAdjustment: 1.15,
    color: 'rgba(255, 152, 0, 0.8)',
    bandColors: {
      band1: 'rgba(255, 152, 0, 0.3)',
      band2: 'rgba(255, 152, 0, 0.2)',
      band3: 'rgba(255, 152, 0, 0.1)'
    }
  },

  fibonacci: {
    autoDetect: true,
    swingHigh: null,
    swingLow: null,
    lookback: 50,
    showRetracements: true,
    showExtensions: false,
    levels: [0.236, 0.382, 0.5, 0.618, 0.786],
    extensionLevels: [1.272, 1.414, 1.618, 2.0, 2.618],
    color: 'rgba(33, 150, 243, 0.6)',
    lineWidth: 1,
    labelPosition: 'right'
  },

  trendAnalysis: {
    swingLookback: 5,
    trendLookback: 20,
    angleNormalizationMax: 45
  },

  filters: {
    minConfidence: 50,
    requireTrend: false,
    showOnlyValidated: false,
    minPatternSize: 0.002
  },

  visualization: {
    showConfidenceLabels: true,
    showClassificationLabels: true,
    colorByClassification: true,
    markerSize: 8,
    labelFontSize: 10,
    colors: {
      REVERSAL: 'rgba(244, 67, 54, 0.8)',
      CONTINUATION: 'rgba(76, 175, 80, 0.8)',
      TREND_START: 'rgba(33, 150, 243, 0.8)',
      MOMENTUM: 'rgba(255, 152, 0, 0.8)'
    }
  },

  alerts: {
    enabled: false,
    minConfidence: 70,
    patterns: ['INSIDE_BAR', 'FALSE_BREAKOUT', 'MOMENTUM'],
    classifications: ['CONTINUATION', 'TREND_START'],
    sound: true,
    popup: false,
    webhook: null
  }
};
```

---

## 2. PATTERN PARAMETERS

### 2.1 Inside Bar

**Pattern Description:**
A candle whose entire range (high to low) is contained within the previous candle's range. Indicates consolidation and potential breakout.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable inside bar detection
- When disabled, pattern will not be detected or displayed

#### `requireFullContainment` (boolean, default: `true`)
- **true**: Child candle must be fully inside mother (not touching edges)
- **false**: Child can touch mother's high/low (looser definition)

**Example:**
```
requireFullContainment = true:
Mother: High=105, Low=100
Child acceptable: High=104, Low=101 (5% margin from edges)
Child rejected: High=105, Low=100 (touching edges)

requireFullContainment = false:
Child acceptable: High=105, Low=100 (touching is OK)
```

#### `minMotherCandleSize` (float, default: `0.005`)
- Minimum size of mother candle as percentage of price
- Prevents detection on insignificant small candles
- Range: 0.001 - 0.02 (0.1% - 2%)

**Calculation:**
```javascript
motherRange = mother.high - mother.low;
motherSizePercent = motherRange / mother.close;

if (motherSizePercent < minMotherCandleSize) {
  return null; // Reject pattern
}
```

**Recommended Values:**
- 1m-5m timeframes: 0.003 (0.3%)
- 15m-1h timeframes: 0.005 (0.5%)
- 4h-Daily timeframes: 0.01 (1%)

#### `maxCompressionRatio` (float, default: `0.7`)
- Maximum ratio of child range to mother range
- Lower value = tighter coiling (higher quality)
- Range: 0.3 - 0.9

**Calculation:**
```javascript
compressionRatio = childRange / motherRange;

if (compressionRatio > maxCompressionRatio) {
  return null; // Too loose, not a quality inside bar
}
```

**Recommended Values:**
- Tight coiling: 0.5 (child is 50% of mother or less)
- Standard: 0.7
- Loose: 0.9

#### `reclassifyByContext` (boolean, default: `true`)
- **true**: Pattern classification depends on location (at extreme = REVERSAL, in trend = CONTINUATION)
- **false**: Always classified as original type

---

### 2.2 False Breakout

**Pattern Description:**
An inside bar that breaks out in one direction but quickly reverses, trapping traders. High-probability setup.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable false breakout detection

#### `lookforwardCandles` (integer, default: `3`)
- Number of candles to look ahead for reversal confirmation
- Range: 2 - 10

**Effect:**
- Lower (2-3): Faster signals, more false positives
- Higher (5-10): More reliable, but may miss some setups

**Recommended Values:**
- 1m-5m: 2-3 (fast reversals)
- 15m-1h: 3-5
- 4h-Daily: 5-10 (slower reversals)

#### `minReversalPercent` (float, default: `0.01`)
- Minimum reversal distance as percentage
- Measures how far price reversed from the fakeout level
- Range: 0.005 - 0.03 (0.5% - 3%)

**Calculation:**
```javascript
// For upside fakeout (should reverse down)
reversalPercent = (fakeLevel - lowestClose) / fakeLevel;

if (reversalPercent < minReversalPercent) {
  return null; // Reversal not significant enough
}
```

**Recommended Values:**
- Crypto (volatile): 0.01 - 0.015 (1-1.5%)
- Forex (less volatile): 0.005 - 0.01 (0.5-1%)

#### `requireVolumeSpike` (boolean, default: `false`)
- **true**: Requires volume spike on reversal candle
- **false**: Volume not considered

#### `volumeSpikeThreshold` (float, default: `1.5`)
- Only used if `requireVolumeSpike = true`
- Minimum volume ratio compared to average
- Range: 1.2 - 3.0

**Calculation:**
```javascript
avgVolume = calculateAverageVolume(recentCandles, 20);
reversalVolume = reversalCandle.volume;

if (reversalVolume < avgVolume * volumeSpikeThreshold) {
  return null; // Volume not high enough
}
```

#### `reclassifyByContext` (boolean, default: `true`)
- Context-based classification (same as inside bar)

---

### 2.3 Momentum

**Pattern Description:**
Multiple consecutive strong candles in the same direction, indicating powerful trend continuation or initiation.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable momentum pattern detection

#### `minConsecutiveCandles` (integer, default: `3`)
- Minimum number of consecutive strong candles required
- Range: 2 - 10

**Recommended Values:**
- Scalping (1m-5m): 2-3
- Intraday (15m-1h): 3-5
- Swing (4h-Daily): 5-7

#### `minBodyPercent` (float, default: `0.6`)
- Minimum body size as percentage of total range
- Ensures candles are "strong" (not dojis or spinning tops)
- Range: 0.5 - 0.8

**Calculation:**
```javascript
range = candle.high - candle.low;
body = Math.abs(candle.close - candle.open);
bodyRatio = body / range;

if (bodyRatio < minBodyPercent) {
  return null; // Candle not strong enough
}
```

**Recommended Values:**
- Strong momentum: 0.7 (70% body)
- Standard: 0.6 (60% body)
- Lenient: 0.5 (50% body)

#### `minCandleSize` (float, default: `0.003`)
- Minimum candle range as percentage of price
- Prevents counting tiny candles as "momentum"
- Range: 0.001 - 0.01 (0.1% - 1%)

**Calculation:**
```javascript
candleRange = candle.high - candle.low;
candleSizePercent = candleRange / candle.close;

if (candleSizePercent < minCandleSize) {
  return null; // Candle too small
}
```

#### `volumeCompensation` (object)

**Purpose:** Allow fewer consecutive candles if backed by high volume.

**Sub-parameters:**

##### `enabled` (boolean, default: `true`)
- Enable volume compensation feature

##### `highVolumeThreshold` (float, default: `2.0`)
- Volume must be this many times the average to qualify
- Range: 1.5 - 3.0

##### `minCandlesWithHighVolume` (integer, default: `2`)
- If volume compensation active, require at least this many candles
- Range: 1 - 5

**Logic:**
```javascript
requiredCandles = minConsecutiveCandles; // e.g., 3

if (volumeCompensation.enabled && hasHighVolume) {
  requiredCandles = Math.min(
    requiredCandles,
    volumeCompensation.minCandlesWithHighVolume  // e.g., 2
  );
}

if (consecutiveCount >= requiredCandles) {
  // Pattern detected
}
```

**Example:**
- Normal: Require 3 consecutive candles
- With high volume (2x average): Require only 2 candles
- Rationale: High volume indicates institutional participation, compensates for fewer candles

#### `reclassifyByContext` (boolean, default: `true`)
- **true**: In weak trend → TREND_START, in strong trend → MOMENTUM
- **false**: Always classified as MOMENTUM

---

### 2.4 Hammer (Existing Pattern)

**Pattern Description:**
Bullish reversal pattern with long lower wick, small body at top of range.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable hammer detection

#### `minWickRatio` (float, default: `2.0`)
- Minimum ratio of lower wick to body
- Lower wick must be at least this many times the body size
- Range: 1.5 - 4.0

**Calculation:**
```javascript
body = Math.abs(candle.close - candle.open);
lowerWick = Math.min(candle.open, candle.close) - candle.low;

wickRatio = lowerWick / body;

if (wickRatio < minWickRatio) {
  return null; // Lower wick not long enough
}
```

**Recommended Values:**
- Strict: 3.0 (lower wick 3× body)
- Standard: 2.0 (2× body)
- Lenient: 1.5 (1.5× body)

#### `maxUpperWickRatio` (float, default: `0.2`)
- Maximum ratio of upper wick to body
- Upper wick should be small (body near top)
- Range: 0.1 - 0.5

**Calculation:**
```javascript
upperWick = candle.high - Math.max(candle.open, candle.close);
upperWickRatio = upperWick / body;

if (upperWickRatio > maxUpperWickRatio) {
  return null; // Upper wick too large
}
```

#### `minBodyPosition` (float, default: `0.6`)
- Minimum position of body in total range (0 = bottom, 1 = top)
- Ensures body is in upper portion of candle
- Range: 0.5 - 0.8

**Calculation:**
```javascript
range = candle.high - candle.low;
bodyLow = Math.min(candle.open, candle.close);
bodyPosition = (bodyLow - candle.low) / range;

if (bodyPosition < minBodyPosition) {
  return null; // Body too low in the range
}
```

#### `volumeFilter` (object)

##### `enabled` (boolean, default: `false`)
- Enable volume filtering

##### `minZScore` (float, default: `0.5`)
- Minimum volume Z-score required
- Z-score = (volume - mean) / stdDev
- Range: 0.0 - 2.0

**Calculation:**
```javascript
const zScore = calculateVolumeZScore(candle, recentCandles, 20);

if (volumeFilter.enabled && zScore < volumeFilter.minZScore) {
  return null; // Volume too low
}
```

**Recommended Values:**
- No filter: enabled=false
- Weak filter: minZScore=0.5
- Moderate filter: minZScore=1.0
- Strong filter: minZScore=1.5

#### `reclassifyByContext` (boolean, default: `true`)
- At bottom of downtrend → REVERSAL
- In middle of uptrend (pullback) → CONTINUATION

---

### 2.5 Shooting Star (Existing Pattern)

**Pattern Description:**
Bearish reversal pattern with long upper wick, small body at bottom of range.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable shooting star detection

#### `minWickRatio` (float, default: `2.0`)
- Minimum ratio of upper wick to body
- Upper wick must be at least this many times the body
- Range: 1.5 - 4.0

#### `maxLowerWickRatio` (float, default: `0.2`)
- Maximum ratio of lower wick to body
- Lower wick should be small (body near bottom)
- Range: 0.1 - 0.5

#### `maxBodyPosition` (float, default: `0.4`)
- Maximum position of body in total range
- Ensures body is in lower portion of candle
- Range: 0.2 - 0.5

**Calculation:**
```javascript
bodyHigh = Math.max(candle.open, candle.close);
bodyPosition = (bodyHigh - candle.low) / range;

if (bodyPosition > maxBodyPosition) {
  return null; // Body too high
}
```

#### `volumeFilter` (object)
- Same as hammer

#### `reclassifyByContext` (boolean, default: `true`)
- At top of uptrend → REVERSAL
- In middle of downtrend (rally) → CONTINUATION

---

### 2.6 Engulfing (Existing Pattern)

**Pattern Description:**
Two-candle pattern where second candle "engulfs" the first. Reversal or continuation.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable engulfing detection

#### `minEngulfPercent` (float, default: `1.0`)
- Minimum percentage of first candle that must be engulfed
- Range: 0.8 - 1.2 (80% - 120%)

**Calculation:**
```javascript
firstCandleBody = Math.abs(firstCandle.close - firstCandle.open);
engulfedPercent = (secondCandleBody / firstCandleBody) * 100;

if (engulfedPercent < minEngulfPercent * 100) {
  return null; // Not fully engulfed
}
```

**Recommended Values:**
- Strict: 1.1 (110% engulfment)
- Standard: 1.0 (100% engulfment)
- Lenient: 0.9 (90% engulfment)

#### `requireBodyEngulf` (boolean, default: `true`)
- **true**: Only body of first candle must be engulfed (wicks can extend beyond)
- **false**: Entire range (including wicks) must be engulfed

**Example:**
```
Candle 1: Open=100, Close=102, High=103, Low=99
Candle 2: Open=103, Close=98

requireBodyEngulf = true:
  Body1 = 100-102 (engulfed by 98-103) ✓ Valid

requireBodyEngulf = false:
  Range1 = 99-103 (NOT fully engulfed by 98-103) ✗ Invalid
```

#### `requireVolumeIncrease` (boolean, default: `false`)
- **true**: Second candle must have higher volume than first
- **false**: Volume not considered

#### `minVolumeRatio` (float, default: `1.2`)
- Only used if `requireVolumeIncrease = true`
- Second candle volume must be this many times the first
- Range: 1.0 - 2.0

**Calculation:**
```javascript
volumeRatio = secondCandle.volume / firstCandle.volume;

if (requireVolumeIncrease && volumeRatio < minVolumeRatio) {
  return null; // Volume increase insufficient
}
```

#### `reclassifyByContext` (boolean, default: `true`)
- At extreme → REVERSAL
- In trend → CONTINUATION

---

### 2.7 Doji (Existing Pattern)

**Pattern Description:**
Candle with very small body (open ≈ close) and long wicks. Indecision pattern.

**Parameters:**

#### `enabled` (boolean, default: `true`)
- Enable/disable doji detection

#### `maxBodyPercent` (float, default: `0.1`)
- Maximum body size as percentage of total range
- Range: 0.05 - 0.2 (5% - 20%)

**Calculation:**
```javascript
range = candle.high - candle.low;
body = Math.abs(candle.close - candle.open);
bodyPercent = body / range;

if (bodyPercent > maxBodyPercent) {
  return null; // Body too large, not a doji
}
```

**Recommended Values:**
- Strict: 0.05 (body ≤ 5% of range)
- Standard: 0.1 (body ≤ 10% of range)
- Lenient: 0.15 (body ≤ 15% of range)

#### `minWickRatio` (float, default: `3.0`)
- Minimum ratio of total wick length to body
- Ensures wicks are significant
- Range: 2.0 - 5.0

**Calculation:**
```javascript
totalWickLength = (candle.high - Math.max(candle.open, candle.close)) +
                  (Math.min(candle.open, candle.close) - candle.low);

wickRatio = totalWickLength / body;

if (wickRatio < minWickRatio) {
  return null; // Wicks not long enough
}
```

#### `requireSymmetry` (boolean, default: `false`)
- **true**: Upper and lower wicks must be approximately equal (Dragonfly/Gravestone dojis excluded)
- **false**: Asymmetric dojis allowed

#### `symmetryTolerance` (float, default: `0.3`)
- Only used if `requireSymmetry = true`
- Maximum allowed difference between upper and lower wicks as percentage
- Range: 0.2 - 0.5

**Calculation:**
```javascript
upperWick = candle.high - Math.max(candle.open, candle.close);
lowerWick = Math.min(candle.open, candle.close) - candle.low;

wickDifference = Math.abs(upperWick - lowerWick) / range;

if (requireSymmetry && wickDifference > symmetryTolerance) {
  return null; // Wicks not symmetric enough
}
```

#### `reclassifyByContext` (boolean, default: `true`)
- At extreme → REVERSAL (high probability)
- In trend → CONTINUATION (pause before continuation)

---

## 3. LEVEL SOURCES

### 3.1 Support & Resistance

#### `supportResistance` (boolean, default: `true`)
- Enable/disable Support & Resistance indicator as level source
- Uses existing SupportResistanceIndicator levels

**Integration:**
```javascript
if (config.levelSources.supportResistance) {
  const srIndicator = indicatorManager.indicators.get('support-resistance');
  if (srIndicator) {
    levels.srLevels = srIndicator.getLevels();
  }
}
```

### 3.2 Volume Profile

#### `volumeProfile` (boolean, default: `true`)
- Enable/disable Volume Profile (POC, VAH, VAL) as level source
- Includes both dynamic and fixed range profiles

**Integration:**
```javascript
if (config.levelSources.volumeProfile) {
  const vpDynamic = indicatorManager.indicators.get('volume-profile');
  const vpFixed = indicatorManager.getFixedRangeProfiles();

  levels.vpLevels = [
    ...vpDynamic.getPOCLevels(),
    ...vpDynamic.getVALevels(),
    ...vpFixed.getAllLevels()
  ];
}
```

### 3.3 VWAP

#### `vwap` (boolean, default: `false`)
- Enable/disable VWAP and standard deviation bands as level source
- Optional feature (not enabled by default)

**Integration:**
```javascript
if (config.levelSources.vwap) {
  const vwapIndicator = indicatorManager.indicators.get('vwap');
  if (vwapIndicator) {
    const vwapData = vwapIndicator.getCurrentData();
    levels.vwapLevels = [
      { price: vwapData.vwap, strength: 90, type: 'vwap' },
      { price: vwapData.bands.upper1, strength: 70, type: 'vwap_band' },
      { price: vwapData.bands.lower1, strength: 70, type: 'vwap_band' },
      { price: vwapData.bands.upper2, strength: 85, type: 'vwap_band' },
      { price: vwapData.bands.lower2, strength: 85, type: 'vwap_band' }
    ];
  }
}
```

### 3.4 Fibonacci

#### `fibonacci` (boolean, default: `false`)
- Enable/disable Fibonacci retracement/extension levels as level source
- Optional feature (not enabled by default)

**Integration:**
```javascript
if (config.levelSources.fibonacci) {
  const fibCalculator = new FibonacciLevelCalculator();
  const fibLevels = fibCalculator.calculateLevels(
    config.fibonacci.swingHigh,
    config.fibonacci.swingLow,
    config.fibonacci.autoDetect
  );

  levels.fibonacciLevels = fibLevels;
}
```

### 3.5 Manual Levels

#### `manualLevels` (boolean, default: `true`)
- Enable/disable user-drawn manual levels as level source
- Levels drawn by user on chart

**Integration:**
```javascript
if (config.levelSources.manualLevels && manualLevels.length > 0) {
  levels.manualLevels = manualLevels.map(level => ({
    price: level.price,
    strength: level.strength || 80,
    type: 'manual'
  }));
}
```

---

## 4. VWAP CONFIGURATION

### 4.1 Type

#### `type` (string, default: `'session'`)
- Type of VWAP calculation
- Options: `'session'`, `'anchored'`, `'rolling'`

**Session:**
- Resets daily at `sessionResetHour`
- Most common for intraday trading

**Anchored:**
- Starts from specific timestamp (`anchoredTimestamp`)
- Used for event-based analysis

**Rolling:**
- Fixed lookback window (`rollingPeriod`)
- Volume-weighted moving average

### 4.2 Session VWAP Settings

#### `sessionResetHour` (integer, default: `0`)
- Hour (UTC) when session VWAP resets
- Range: 0-23
- Default: 0 (midnight UTC)

**Recommended Values:**
- Crypto: 0 (UTC midnight, 24-hour market)
- US Stocks: 13 (9:30 AM ET = 13:30 UTC, market open)
- Asian Markets: 0 (midnight UTC)

### 4.3 Anchored VWAP Settings

#### `anchoredTimestamp` (integer, default: `null`)
- Unix timestamp (milliseconds) for anchor point
- Only used when `type = 'anchored'`

**Example:**
```javascript
// Anchor from Jan 1, 2024 00:00 UTC
anchoredTimestamp: 1704067200000
```

### 4.4 Rolling VWAP Settings

#### `rollingPeriod` (integer, default: `20`)
- Number of candles in rolling window
- Only used when `type = 'rolling'`
- Range: 10-100

**Recommended Values:**
- Short-term: 10-20
- Medium-term: 20-50
- Long-term: 50-100

### 4.5 Display Settings

#### `showBands` (boolean, default: `true`)
- Show standard deviation bands around VWAP

#### `bandMultipliers` (array, default: `[1.0, 2.0, 3.0]`)
- Standard deviation multipliers for bands
- Typically 3 bands: ±1σ, ±2σ, ±3σ

**Note:** Crypto adjustment (×1.15) applied automatically internally

#### `cryptoAdjustment` (float, default: `1.15`)
- Multiplier for band widths to account for crypto volatility
- Applied to all `bandMultipliers`
- Range: 1.0 - 1.5

**Effective Multipliers:**
```javascript
[1.0, 2.0, 3.0] × 1.15 = [1.15, 2.30, 3.45]
```

### 4.6 Color Settings

#### `color` (string, default: `'rgba(255, 152, 0, 0.8)'`)
- Color of VWAP line (CSS color string)

#### `bandColors` (object)
- Colors for each band level

```javascript
{
  band1: 'rgba(255, 152, 0, 0.3)',  // ±1σ
  band2: 'rgba(255, 152, 0, 0.2)',  // ±2σ
  band3: 'rgba(255, 152, 0, 0.1)'   // ±3σ
}
```

---

## 5. FIBONACCI CONFIGURATION

### 5.1 Swing Detection

#### `autoDetect` (boolean, default: `true`)
- **true**: Automatically detect swing high/low
- **false**: Use manual `swingHigh` and `swingLow` values

#### `swingHigh` (float, default: `null`)
- Manual swing high price
- Only used when `autoDetect = false`

#### `swingLow` (float, default: `null`)
- Manual swing low price
- Only used when `autoDetect = false`

#### `lookback` (integer, default: `50`)
- Number of candles to look back for auto-detection
- Only used when `autoDetect = true`
- Range: 20-200

**Recommended Values:**
- 1m-5m: 30-50
- 15m-1h: 50-100
- 4h-Daily: 100-200

### 5.2 Display Settings

#### `showRetracements` (boolean, default: `true`)
- Show Fibonacci retracement levels (0.236, 0.382, 0.5, 0.618, 0.786)

#### `showExtensions` (boolean, default: `false`)
- Show Fibonacci extension levels (1.272, 1.414, 1.618, 2.0, 2.618)

#### `levels` (array, default: `[0.236, 0.382, 0.5, 0.618, 0.786]`)
- Retracement levels to display
- Can add/remove levels as needed

**Common Variations:**
- Standard: `[0.236, 0.382, 0.5, 0.618, 0.786]`
- Key levels only: `[0.382, 0.5, 0.618]`
- Extended: `[0.236, 0.382, 0.5, 0.618, 0.786, 0.886]`

#### `extensionLevels` (array, default: `[1.272, 1.414, 1.618, 2.0, 2.618]`)
- Extension levels to display
- Only shown if `showExtensions = true`

#### `color` (string, default: `'rgba(33, 150, 243, 0.6)'`)
- Color of Fibonacci lines

#### `lineWidth` (integer, default: `1`)
- Width of Fibonacci lines in pixels
- Range: 1-3

#### `labelPosition` (string, default: `'right'`)
- Position of level labels
- Options: `'left'`, `'right'`, `'none'`

---

## 6. TREND ANALYSIS CONFIGURATION

### 6.1 Swing Detection

#### `swingLookback` (integer, default: `5`)
- Number of candles before and after for swing identification
- Range: 3-10

**Effect:**
- Lower (3-5): More swings detected (sensitive)
- Higher (7-10): Fewer, major swings (stable)

### 6.2 Trend Calculation

#### `trendLookback` (integer, default: `20`)
- Number of recent candles to analyze for trend
- Range: 10-50

**Effect:**
- Lower (10-15): Responsive to recent changes
- Higher (30-50): Smoother, long-term trend

### 6.3 Angle Normalization

#### `angleNormalizationMax` (integer, default: `45`)
- Maximum angle (degrees) considered "100% strong"
- Range: 30-60

**Effect:**
- Lower (30°): Stricter definition of steep trend
- Higher (60°): More lenient, shallower trends score high

**Recommended by Timeframe:**
- 1m-5m: 30°
- 15m-1h: 45°
- 4h-Daily: 60°

---

## 7. FILTERS

### 7.1 Confidence Filter

#### `minConfidence` (integer, default: `50`)
- Minimum confidence score required to display pattern
- Range: 0-100

**Recommended Values:**
- Show all: 0
- Low filter: 30
- Medium filter: 50
- High filter: 70

### 7.2 Trend Requirement

#### `requireTrend` (boolean, default: `false`)
- **true**: Only show patterns when trend is detected (not RANGE or NONE)
- **false**: Show patterns in all market conditions

**Use Cases:**
- Trend trading: `true`
- Range trading: `false`

### 7.3 Validation Filter

#### `showOnlyValidated` (boolean, default: `false`)
- **true**: Only show patterns validated by at least one level source
- **false**: Show all locally detected patterns

**Use Cases:**
- High-probability only: `true`
- See all patterns: `false`

### 7.4 Size Filter

#### `minPatternSize` (float, default: `0.002`)
- Minimum pattern candle size as percentage of price
- Filters out tiny, insignificant patterns
- Range: 0.001 - 0.01 (0.1% - 1%)

---

## 8. VISUALIZATION

### 8.1 Labels

#### `showConfidenceLabels` (boolean, default: `true`)
- Display confidence scores next to patterns

#### `showClassificationLabels` (boolean, default: `true`)
- Display classification (REVERSAL, CONTINUATION, etc.)

#### `labelFontSize` (integer, default: `10`)
- Font size for pattern labels (pixels)
- Range: 8-14

### 8.2 Markers

#### `markerSize` (integer, default: `8`)
- Size of pattern markers on chart (pixels)
- Range: 4-12

#### `colorByClassification` (boolean, default: `true`)
- **true**: Color patterns by classification
- **false**: Use single color for all patterns

### 8.3 Color Scheme

#### `colors` (object)
- Colors for each pattern classification

```javascript
{
  REVERSAL: 'rgba(244, 67, 54, 0.8)',      // Red
  CONTINUATION: 'rgba(76, 175, 80, 0.8)',  // Green
  TREND_START: 'rgba(33, 150, 243, 0.8)',  // Blue
  MOMENTUM: 'rgba(255, 152, 0, 0.8)'       // Orange
}
```

**Customization:**
- Use any CSS color (hex, rgb, rgba, named colors)
- Opacity (alpha) recommended: 0.6 - 0.9

---

## 9. ALERTS

### 9.1 Basic Settings

#### `enabled` (boolean, default: `false`)
- Enable/disable alert system

#### `minConfidence` (integer, default: `70`)
- Minimum confidence for triggering alert
- Range: 50-100

**Recommended:** 70-80 (high-probability patterns only)

### 9.2 Pattern Filters

#### `patterns` (array, default: `['INSIDE_BAR', 'FALSE_BREAKOUT', 'MOMENTUM']`)
- List of pattern types to alert on
- Options: `'INSIDE_BAR'`, `'FALSE_BREAKOUT'`, `'MOMENTUM'`, `'HAMMER'`, `'SHOOTING_STAR'`, `'ENGULFING'`, `'DOJI'`

#### `classifications` (array, default: `['CONTINUATION', 'TREND_START']`)
- List of classifications to alert on
- Options: `'REVERSAL'`, `'CONTINUATION'`, `'TREND_START'`, `'MOMENTUM'`

**Example:**
- Only continuation setups: `['CONTINUATION']`
- Only reversals: `['REVERSAL']`
- All: `['REVERSAL', 'CONTINUATION', 'TREND_START', 'MOMENTUM']`

### 9.3 Alert Methods

#### `sound` (boolean, default: `true`)
- Play sound when alert triggers

#### `popup` (boolean, default: `false`)
- Show browser popup notification

#### `webhook` (string, default: `null`)
- URL to send webhook POST request
- Format: `'http://localhost:5000/alert'`

**Webhook Payload:**
```json
{
  "symbol": "BTCUSDT",
  "pattern": "INSIDE_BAR",
  "classification": "CONTINUATION",
  "confidence": 85,
  "price": 42500.00,
  "timestamp": 1702252800000,
  "timeframe": "1h"
}
```

---

## 10. EXPORT/IMPORT SCHEMA

### 10.1 Export Format

**File format:** JSON

**Filename:** `continuation-patterns-config-{timestamp}.json`

**Example:**
```json
{
  "version": "1.0.0",
  "timestamp": 1702252800000,
  "config": {
    "patterns": { /* ... */ },
    "levelSources": { /* ... */ },
    "vwap": { /* ... */ },
    "fibonacci": { /* ... */ },
    "trendAnalysis": { /* ... */ },
    "filters": { /* ... */ },
    "visualization": { /* ... */ },
    "alerts": { /* ... */ }
  }
}
```

### 10.2 Import Validation

**Required fields:**
- `patterns` (object)
- `levelSources` (object)

**Optional fields:**
- All others (use defaults if missing)

**Validation Rules:**
1. Check version compatibility
2. Validate each parameter type and range
3. Set defaults for missing optional fields
4. Show error for invalid values

**Example Validation:**
```javascript
function validateConfig(imported) {
  const errors = [];

  // Check patterns
  if (typeof imported.patterns !== 'object') {
    errors.push('Invalid patterns object');
  }

  // Check parameter ranges
  if (imported.patterns.insideBar.minMotherCandleSize < 0.001 ||
      imported.patterns.insideBar.minMotherCandleSize > 0.02) {
    errors.push('insideBar.minMotherCandleSize out of range (0.001-0.02)');
  }

  // ... more validations

  if (errors.length > 0) {
    throw new Error('Configuration validation failed:\n' + errors.join('\n'));
  }

  return true;
}
```

---

## 11. ADAPTIVE CONFIDENCE SCORING

### 11.1 Weight Distribution

**Formula:**
```
Confidence = (Base Factors × 0.6) + (Level Factors × 0.4)
```

**Base Factors (60%):**
- Pattern Quality: 25%
- Relative Size: 20%
- Volume: 15%

**Level Factors (40% - distributed among active sources):**

**Example 1: Only S/R active**
```javascript
activeSources = ['sr'];
weight = 0.40 / 1 = 0.40 (40%)

levelScore = srProximity × 0.40;
```

**Example 2: S/R + VWAP active**
```javascript
activeSources = ['sr', 'vwap'];
weight = 0.40 / 2 = 0.20 (20% each)

levelScore = (srProximity × 0.20) + (vwapProximity × 0.20);
```

**Example 3: All sources active**
```javascript
activeSources = ['sr', 'vwap', 'vp', 'fibonacci', 'manual'];
weight = 0.40 / 5 = 0.08 (8% each)

levelScore =
  (srProximity × 0.08) +
  (vwapProximity × 0.08) +
  (vpProximity × 0.08) +
  (fibProximity × 0.08) +
  (manualProximity × 0.08);
```

### 11.2 Proximity Scoring

**Distance Ranges:**

| Distance from Level | Score |
|---------------------|-------|
| < 0.2% | 100 |
| 0.2% - 0.5% | 80 |
| 0.5% - 1% | 60 |
| 1% - 2% | 40 |
| > 2% | 20 |

**Calculation:**
```javascript
function calculateProximityScore(patternPrice, levels) {
  if (!levels || levels.length === 0) return 0;

  let bestProximity = Infinity;

  for (const level of levels) {
    const distance = Math.abs(patternPrice - level.price);
    const proximityPercent = distance / patternPrice;

    if (proximityPercent < bestProximity) {
      bestProximity = proximityPercent;
    }
  }

  if (bestProximity < 0.002) return 100;
  if (bestProximity < 0.005) return 80;
  if (bestProximity < 0.01) return 60;
  if (bestProximity < 0.02) return 40;
  return 20;
}
```

---

## 12. PRESET CONFIGURATIONS

### 12.1 Scalper (1m-5m)

```javascript
{
  patterns: {
    insideBar: { enabled: true, minMotherCandleSize: 0.003 },
    falseBreakout: { enabled: true, lookforwardCandles: 2 },
    momentum: { enabled: true, minConsecutiveCandles: 2 },
    // Disable slower patterns
    hammer: { enabled: false },
    shootingStar: { enabled: false },
    engulfing: { enabled: false },
    doji: { enabled: false }
  },
  levelSources: {
    supportResistance: true,
    volumeProfile: true,
    vwap: true,  // Important for scalping
    fibonacci: false,
    manualLevels: true
  },
  vwap: { type: 'session', sessionResetHour: 0 },
  trendAnalysis: {
    swingLookback: 3,
    trendLookback: 15,
    angleNormalizationMax: 30
  },
  filters: { minConfidence: 60, requireTrend: true }
}
```

### 12.2 Day Trader (15m-1h)

```javascript
{
  patterns: {
    insideBar: { enabled: true },
    falseBreakout: { enabled: true },
    momentum: { enabled: true },
    hammer: { enabled: true, reclassifyByContext: true },
    shootingStar: { enabled: true, reclassifyByContext: true },
    engulfing: { enabled: true, reclassifyByContext: true },
    doji: { enabled: true }
  },
  levelSources: {
    supportResistance: true,
    volumeProfile: true,
    vwap: true,
    fibonacci: true,
    manualLevels: true
  },
  vwap: { type: 'session', sessionResetHour: 0 },
  fibonacci: { autoDetect: true, lookback: 50 },
  trendAnalysis: {
    swingLookback: 5,
    trendLookback: 20,
    angleNormalizationMax: 45
  },
  filters: { minConfidence: 50, requireTrend: false }
}
```

### 12.3 Swing Trader (4h-Daily)

```javascript
{
  patterns: {
    insideBar: { enabled: true, minMotherCandleSize: 0.01 },
    falseBreakout: { enabled: true, lookforwardCandles: 5 },
    momentum: { enabled: true, minConsecutiveCandles: 5 },
    hammer: { enabled: true },
    shootingStar: { enabled: true },
    engulfing: { enabled: true, requireVolumeIncrease: true },
    doji: { enabled: true }
  },
  levelSources: {
    supportResistance: true,
    volumeProfile: true,
    vwap: false,  // Less useful on higher TF
    fibonacci: true,
    manualLevels: true
  },
  fibonacci: { autoDetect: true, lookback: 100 },
  trendAnalysis: {
    swingLookback: 7,
    trendLookback: 30,
    angleNormalizationMax: 60
  },
  filters: { minConfidence: 60, requireTrend: false }
}
```

---

**END OF PATTERN CONFIGURATION REFERENCE**
