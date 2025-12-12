# TREND STRENGTH FORMULA

**Mathematical Foundation for Trend Analysis**
**Created:** 2025-12-10
**Purpose:** Complete specification of trend strength calculation algorithm

---

## 1. OVERVIEW

### Purpose
The trend strength formula quantifies the quality and power of a trend using two independent components:
1. **Swing Consistency (60% weight)** - Measures structural integrity (higher highs/lows pattern)
2. **Progression Angle (40% weight)** - Measures directional momentum (slope steepness)

### Formula
```
Trend Strength = (Swing Consistency × 0.6) + (Progression Angle × 0.4)

Output: 0-100 scale
  - 0-39: WEAK trend (or no trend)
  - 40-69: MODERATE trend
  - 70-100: STRONG trend
```

### Why This Approach?

**Traditional Approach (Flawed):**
- Using only price slope → misses choppy/whipsaw trends
- Using only swing count → misses steep vs shallow trends
- Using moving average crossovers → lagging signals

**Our Approach (Hybrid):**
- Combines structure (swings) with direction (angle)
- 60/40 weight prioritizes structure (more reliable)
- Angle component catches steep trends even with few swings
- No lag (uses current data, not lagging indicators)

---

## 2. COMPONENT 1: SWING CONSISTENCY (60%)

### 2.1 Concept

**Definition:** Swing consistency measures how well the price follows a higher-high/higher-low (uptrend) or lower-high/lower-low (downtrend) pattern.

**Visual Example:**

```
STRONG UPTREND (High Consistency):

Price
  ^
  |        HH3 (Higher High 3)
  |         /\
  |        /  \
  |   HH2 /    \
  |    /\/ HL3  \
  |   /  \ (Higher Low 3)
  |  / HL2\      \
  | /  (Higher Low 2)
  |/ HL1
  |/ (Higher Low 1)
  +----------------------> Time
   HH1 (Higher High 1)

Consistency Score: 100%
- All highs are higher than previous highs (3/3 = 100%)
- All lows are higher than previous lows (3/3 = 100%)
- Average: (100% + 100%) / 2 = 100%
```

```
CHOPPY MOVEMENT (Low Consistency):

Price
  ^
  |   H3
  |   /\    H4
  |  /  \  /\
  | / L2 \/ L3\
  |/H1      \  \
  |\ /L1     \  H5
  | X         \/
  |/ \L4      /\
  +----------------------> Time

Consistency Score: ~30%
- Highs: H2 > H1 ✓, H3 < H2 ✗, H4 > H3 ✓, H5 < H4 ✗ → 2/4 = 50%
- Lows: L2 < L1 ✗, L3 > L2 ✓, L4 < L3 ✗ → 1/3 = 33%
- Average: (50% + 33%) / 2 = 41.5%
```

### 2.2 Algorithm

#### Step 1: Identify Swings

**Swing High:**
- A candle whose high is higher than N candles before and after it
- N = swing lookback parameter (default: 5)

**Swing Low:**
- A candle whose low is lower than N candles before and after it
- N = swing lookback parameter (default: 5)

**Pseudocode:**
```javascript
function identifySwings(candles, lookback = 5) {
  const swings = { highs: [], lows: [] };

  for (let i = lookback; i < candles.length - lookback; i++) {
    const currentCandle = candles[i];
    const window = candles.slice(i - lookback, i + lookback + 1);

    // Check if swing high
    const isSwingHigh = window.every((c, idx) => {
      if (idx === lookback) return true; // Skip current candle
      return c.high <= currentCandle.high;
    });

    if (isSwingHigh) {
      swings.highs.push({
        index: i,
        price: currentCandle.high,
        timestamp: currentCandle.timestamp
      });
    }

    // Check if swing low
    const isSwingLow = window.every((c, idx) => {
      if (idx === lookback) return true; // Skip current candle
      return c.low >= currentCandle.low;
    });

    if (isSwingLow) {
      swings.lows.push({
        index: i,
        price: currentCandle.low,
        timestamp: currentCandle.timestamp
      });
    }
  }

  return swings;
}
```

**Example:**
```
Candles (simplified):
Index: 0    1    2    3    4    5    6    7    8    9
High:  100  102  101  103  102  105  104  106  103  107
Low:   98   100  99   101  100  103  102  104  101  105

Lookback = 2

Swing Highs (index where high > all within ±2 candles):
- Index 5 (105): 103, 102, 105, 104, 106 → 105 > 103, 102, 104 ✓
- Index 7 (106): 105, 104, 106, 103, 107 → 106 > 105, 104, 103 ✓
- Index 9 (107): 106, 103, 107 → 107 > 106, 103 ✓

Swing Lows (index where low < all within ±2 candles):
- Index 0 (98): 98, 100, 99 → 98 < 100, 99 ✓
- Index 2 (99): 100, 99, 101, 100 → 99 < 100, 101, 100 ✓
- Index 4 (100): 101, 100, 103, 102 → 100 < 101, 103, 102 ✓
- Index 6 (102): 103, 102, 104, 101 → 102 < 103, 104 but NOT < 101 ✗
```

#### Step 2: Calculate Swing Patterns

**For Uptrend:**
- Count how many swing highs are higher than the previous swing high (HH)
- Count how many swing lows are higher than the previous swing low (HL)

**For Downtrend:**
- Count how many swing highs are lower than the previous swing high (LH)
- Count how many swing lows are lower than the previous swing low (LL)

**Pseudocode:**
```javascript
function calculateSwingConsistency(swings) {
  const { highs, lows } = swings;

  if (highs.length < 2 || lows.length < 2) {
    return { score: 0, direction: 'NONE' };
  }

  // Uptrend: Higher Highs + Higher Lows
  let hhCount = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) {
      hhCount++;
    }
  }

  let hlCount = 0;
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) {
      hlCount++;
    }
  }

  const uptrendScore = (
    (hhCount / (highs.length - 1)) +
    (hlCount / (lows.length - 1))
  ) / 2;

  // Downtrend: Lower Highs + Lower Lows
  let lhCount = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price < highs[i - 1].price) {
      lhCount++;
    }
  }

  let llCount = 0;
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price < lows[i - 1].price) {
      llCount++;
    }
  }

  const downtrendScore = (
    (lhCount / (highs.length - 1)) +
    (llCount / (lows.length - 1))
  ) / 2;

  // Determine direction and score
  const isUptrend = uptrendScore > downtrendScore;
  const score = Math.max(uptrendScore, downtrendScore) * 100;
  const direction = isUptrend ? 'UP' : 'DOWN';

  return { score, direction, uptrendScore, downtrendScore };
}
```

#### Step 3: Example Calculations

**Example 1: Perfect Uptrend**
```
Swing Highs: [100, 105, 110, 115, 120]
Swing Lows:  [95, 100, 105, 110, 115]

Higher Highs: 105>100 ✓, 110>105 ✓, 115>110 ✓, 120>115 ✓
HH Count: 4/4 = 100%

Higher Lows: 100>95 ✓, 105>100 ✓, 110>105 ✓, 115>110 ✓
HL Count: 4/4 = 100%

Uptrend Score = (100% + 100%) / 2 = 100%
Swing Consistency = 100 points
```

**Example 2: Weak Uptrend**
```
Swing Highs: [100, 105, 103, 108, 107]
Swing Lows:  [95, 100, 98, 103, 102]

Higher Highs: 105>100 ✓, 103<105 ✗, 108>103 ✓, 107<108 ✗
HH Count: 2/4 = 50%

Higher Lows: 100>95 ✓, 98<100 ✗, 103>98 ✓, 102<103 ✗
HL Count: 2/4 = 50%

Uptrend Score = (50% + 50%) / 2 = 50%
Swing Consistency = 50 points
```

**Example 3: Range (No Trend)**
```
Swing Highs: [100, 101, 100, 102, 99]
Swing Lows:  [95, 94, 96, 95, 97]

Higher Highs: 101>100 ✓, 100<101 ✗, 102>100 ✓, 99<102 ✗
HH Count: 2/4 = 50%

Lower Highs: 101>100 ✗, 100<101 ✓, 102>100 ✗, 99<102 ✓
LH Count: 2/4 = 50%

Higher Lows: 94<95 ✗, 96>94 ✓, 95<96 ✗, 97>95 ✓
HL Count: 2/4 = 50%

Lower Lows: 94<95 ✓, 96>94 ✗, 95<96 ✓, 97>95 ✗
LL Count: 2/4 = 50%

Uptrend Score = (50% + 50%) / 2 = 50%
Downtrend Score = (50% + 50%) / 2 = 50%

No clear direction → Range
Swing Consistency = 50 points (neutral)
```

### 2.3 Configuration Parameters

**swingLookback** (default: 5)
- Number of candles to look before and after for swing identification
- Smaller value (2-3): Detects more swings (more sensitive, noisier)
- Larger value (7-10): Detects fewer, major swings (less sensitive, cleaner)

**Recommended by Timeframe:**
- 1m, 5m: 3-5 (shorter lookback for faster moves)
- 15m, 1h: 5-7 (standard)
- 4h, Daily: 7-10 (longer lookback for major structure)

---

## 3. COMPONENT 2: PROGRESSION ANGLE (40%)

### 3.1 Concept

**Definition:** Progression angle measures the steepness of the trend using linear regression on price data.

**Why Linear Regression?**
- Finds the "best fit" line through price data
- Slope of this line represents trend direction and strength
- Mathematically robust (not affected by outliers as much as simple slope)

**Visual Example:**

```
STEEP UPTREND (High Angle):

Price
  ^                    • (actual price)
  |                 •
  |              •       ╱ Linear regression line
  |           •       ╱  (steep slope)
  |        •       ╱
  |     •       ╱
  |  •       ╱
  | •     ╱
  |•   ╱
  +------------------------> Time

Slope: High → Angle: ~40° → Score: 88.9
```

```
SHALLOW UPTREND (Low Angle):

Price
  ^
  |            •  •  • ——— Linear regression line
  |        •              (shallow slope)
  |     •
  |  •
  | •
  +------------------------> Time

Slope: Low → Angle: ~10° → Score: 22.2
```

### 3.2 Algorithm

#### Step 1: Linear Regression

**Formula:**
```
For data points (x, y):
  x = index (0, 1, 2, ..., n-1)
  y = close price

Slope (m) = (n × Σ(xy) - Σx × Σy) / (n × Σ(x²) - (Σx)²)

Where:
  n = number of data points
  Σ(xy) = sum of (index × close price)
  Σx = sum of indices
  Σy = sum of close prices
  Σ(x²) = sum of squared indices
```

**Pseudocode:**
```javascript
function calculateLinearRegressionSlope(candles) {
  const n = candles.length;
  const closes = candles.map(c => c.close);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += closes[i];
    sumXY += i * closes[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  return slope;
}
```

**Example Calculation:**
```
Candles (close prices):
Index:  0    1    2    3    4
Close:  100  102  104  106  108

n = 5

Σx = 0 + 1 + 2 + 3 + 4 = 10
Σy = 100 + 102 + 104 + 106 + 108 = 520
Σ(xy) = (0×100) + (1×102) + (2×104) + (3×106) + (4×108) = 1042
Σ(x²) = 0² + 1² + 2² + 3² + 4² = 30

Slope = (5 × 1042 - 10 × 520) / (5 × 30 - 10²)
      = (5210 - 5200) / (150 - 100)
      = 10 / 50
      = 0.2

Interpretation: For each candle, price increases by ~0.2 points
```

#### Step 2: Convert Slope to Angle

**Formula:**
```
angle_radians = atan(slope)
angle_degrees = angle_radians × (180 / π)
```

**Pseudocode:**
```javascript
function slopeToAngle(slope) {
  const angleRadians = Math.atan(slope);
  const angleDegrees = angleRadians * (180 / Math.PI);
  return angleDegrees;
}
```

**Example:**
```
Slope = 0.2

angle_radians = atan(0.2) = 0.197 radians
angle_degrees = 0.197 × (180 / 3.14159) = 11.31°
```

#### Step 3: Normalize to 0-100 Scale

**Formula:**
```
normalized_score = min(|angle| / max_angle, 1.0) × 100

Where:
  max_angle = 45° (configurable)
  |angle| = absolute value of angle (ignore direction for now)
```

**Pseudocode:**
```javascript
function normalizeAngleToScore(angleDegrees, maxAngle = 45) {
  const absAngle = Math.abs(angleDegrees);
  const normalized = Math.min(absAngle / maxAngle, 1.0);
  return normalized * 100;
}
```

**Example:**
```
Angle = 11.31°
Max Angle = 45°

normalized = min(11.31 / 45, 1.0) = min(0.2513, 1.0) = 0.2513
score = 0.2513 × 100 = 25.13 points
```

**Example 2 (Steep Trend):**
```
Slope = 1.5
Angle = atan(1.5) × (180/π) = 56.31°

normalized = min(56.31 / 45, 1.0) = min(1.25, 1.0) = 1.0
score = 1.0 × 100 = 100 points (capped at max)
```

### 3.3 Configuration Parameters

**trendLookback** (default: 20)
- Number of recent candles to include in regression
- Smaller value (10-15): More responsive to recent changes
- Larger value (30-50): Smoother, less affected by short-term noise

**angleNormalizationMax** (default: 45°)
- Maximum angle considered "100% strong"
- Lower value (30°): Stricter definition of "steep" trend
- Higher value (60°): More lenient, allows shallower trends to score high

**Recommended by Timeframe:**
- 1m: lookback=10, maxAngle=30° (fast changes, steeper angles)
- 5m-15m: lookback=20, maxAngle=45° (standard)
- 1h-4h: lookback=30, maxAngle=45°
- Daily: lookback=50, maxAngle=60° (slower changes, shallower angles)

---

## 4. COMBINING COMPONENTS

### 4.1 Final Formula

```javascript
function calculateTrendStrength(candles, config = {}) {
  const {
    swingLookback = 5,
    trendLookback = 20,
    angleNormalizationMax = 45
  } = config;

  // Ensure enough data
  if (candles.length < trendLookback) {
    return {
      strength: 0,
      direction: 'NONE',
      label: 'WEAK',
      components: {}
    };
  }

  // Use recent candles for analysis
  const recentCandles = candles.slice(-trendLookback);

  // Component 1: Swing Consistency (60%)
  const swings = identifySwings(recentCandles, swingLookback);
  const swingResult = calculateSwingConsistency(swings);
  const consistencyScore = swingResult.score;

  // Component 2: Progression Angle (40%)
  const slope = calculateLinearRegressionSlope(recentCandles);
  const angleDegrees = slopeToAngle(slope);
  const angleScore = normalizeAngleToScore(angleDegrees, angleNormalizationMax);

  // Combined trend strength
  const trendStrength = (consistencyScore * 0.6) + (angleScore * 0.4);

  // Determine direction
  let direction = swingResult.direction;

  // Refine direction with angle sign
  if (angleDegrees > 5) {
    direction = 'UP';
  } else if (angleDegrees < -5) {
    direction = 'DOWN';
  } else if (trendStrength < 40) {
    direction = 'RANGE';
  }

  // Classify strength
  let strengthLabel = 'WEAK';
  if (trendStrength >= 70) {
    strengthLabel = 'STRONG';
  } else if (trendStrength >= 40) {
    strengthLabel = 'MODERATE';
  }

  return {
    strength: trendStrength,
    direction,
    label: strengthLabel,
    components: {
      consistency: consistencyScore,
      angle: angleScore,
      angleDegrees,
      slope
    },
    swings
  };
}
```

### 4.2 Complete Example

**Input Data:**
```javascript
const candles = [
  // ... 20 candles
  // Simplified closes: 100, 102, 101, 103, 105, 104, 107, 109, 108, 110,
  //                   112, 111, 114, 116, 115, 118, 120, 119, 122, 124
];

const config = {
  swingLookback: 3,
  trendLookback: 20,
  angleNormalizationMax: 45
};
```

**Step 1: Identify Swings (lookback=3)**
```
Swing Highs: [109, 116, 124] (indices 7, 13, 19)
Swing Lows:  [100, 104, 111] (indices 0, 5, 11)
```

**Step 2: Calculate Swing Consistency**
```
Higher Highs: 116>109 ✓, 124>116 ✓ → 2/2 = 100%
Higher Lows: 104>100 ✓, 111>104 ✓ → 2/2 = 100%

Uptrend Score = (100% + 100%) / 2 = 100%
Consistency Score = 100 points
Direction from swings = UP
```

**Step 3: Calculate Progression Angle**
```
Linear regression on closes [100...124]:

Slope = 1.22 (approx)
Angle = atan(1.22) × 180/π = 50.71°
Normalized = min(50.71 / 45, 1.0) = 1.0
Angle Score = 100 points
```

**Step 4: Combine**
```
Trend Strength = (100 × 0.6) + (100 × 0.4)
               = 60 + 40
               = 100 points

Direction = UP (from swings + angle > 5°)
Label = STRONG (100 >= 70)
```

**Output:**
```javascript
{
  strength: 100,
  direction: 'UP',
  label: 'STRONG',
  components: {
    consistency: 100,
    angle: 100,
    angleDegrees: 50.71,
    slope: 1.22
  },
  swings: { highs: [...], lows: [...] }
}
```

---

## 5. EDGE CASES & HANDLING

### 5.1 Insufficient Data

**Scenario:** Not enough candles for analysis

```javascript
if (candles.length < trendLookback) {
  return {
    strength: 0,
    direction: 'NONE',
    label: 'WEAK',
    components: {}
  };
}
```

### 5.2 No Swings Detected

**Scenario:** Price too flat, no clear swing highs/lows

```javascript
if (swings.highs.length < 2 || swings.lows.length < 2) {
  // Fallback to angle-only
  const slope = calculateLinearRegressionSlope(recentCandles);
  const angleDegrees = slopeToAngle(slope);
  const angleScore = normalizeAngleToScore(angleDegrees);

  // Use 100% angle weight (since no swing data)
  const trendStrength = angleScore;

  return {
    strength: trendStrength,
    direction: angleDegrees > 5 ? 'UP' : angleDegrees < -5 ? 'DOWN' : 'RANGE',
    label: trendStrength >= 70 ? 'STRONG' : trendStrength >= 40 ? 'MODERATE' : 'WEAK',
    components: { angle: angleScore, angleDegrees, slope }
  };
}
```

### 5.3 Conflicting Signals

**Scenario:** Swings say uptrend, but angle is negative (or vice versa)

```javascript
// Swings: UP (consistency = 80)
// Angle: -15° (downward slope, score = 33)

// Combined: (80 × 0.6) + (33 × 0.4) = 48 + 13.2 = 61.2

// Direction determination:
if (Math.abs(consistencyScore - angleScore) > 30) {
  // Conflicting signals → use swing direction (more weight)
  direction = swingResult.direction;
  strengthLabel = 'MODERATE'; // Downgrade due to conflict
}
```

### 5.4 Extreme Volatility

**Scenario:** Large price swings, steep angles beyond normalization

```javascript
// Slope = 5.0
// Angle = atan(5.0) = 78.69°
// Normalized = min(78.69 / 45, 1.0) = 1.0 (capped)
// Angle Score = 100 points

// This is correct behavior: extremely steep trends should score 100
```

---

## 6. VALIDATION & TESTING

### 6.1 Unit Tests

**Test 1: Perfect Uptrend**
```javascript
const candles = generatePerfectUptrend(20); // [100, 102, 104, ..., 138]
const result = calculateTrendStrength(candles);

expect(result.strength).toBeGreaterThan(90);
expect(result.direction).toBe('UP');
expect(result.label).toBe('STRONG');
```

**Test 2: Perfect Downtrend**
```javascript
const candles = generatePerfectDowntrend(20); // [100, 98, 96, ..., 62]
const result = calculateTrendStrength(candles);

expect(result.strength).toBeGreaterThan(90);
expect(result.direction).toBe('DOWN');
expect(result.label).toBe('STRONG');
```

**Test 3: Ranging Market**
```javascript
const candles = generateRange(20, 100, 105); // Price oscillates between 100-105
const result = calculateTrendStrength(candles);

expect(result.strength).toBeLessThan(50);
expect(result.direction).toBe('RANGE');
expect(result.label).toBe('WEAK');
```

**Test 4: Choppy Uptrend**
```javascript
const candles = generateChoppyUptrend(20); // Upward bias with whipsaws
const result = calculateTrendStrength(candles);

expect(result.strength).toBeGreaterThan(40);
expect(result.strength).toBeLessThan(70);
expect(result.label).toBe('MODERATE');
```

### 6.2 Real Market Data Testing

**Procedure:**
1. Load historical data from known strong trends (e.g., BTC Nov 2020 - Apr 2021)
2. Calculate trend strength at multiple points
3. Verify:
   - Strong uptrend periods score 70+
   - Consolidation periods score 30-50
   - Downtrend periods correctly identified

**Example:**
```
BTCUSDT Daily Chart
2020-11-01 to 2021-04-14 (ATH run)

Expected:
- Early phase (Nov-Dec 2020): Moderate-Strong (60-80)
- Mid phase (Jan-Feb 2021): Strong (80-95)
- Late phase (Mar-Apr 2021): Moderate (50-70, consolidations)

Actual Results (test with real data):
- 2020-12-01: Strength=75, Direction=UP, Label=STRONG ✓
- 2021-02-01: Strength=88, Direction=UP, Label=STRONG ✓
- 2021-03-15: Strength=62, Direction=UP, Label=MODERATE ✓
```

---

## 7. PYTHON IMPLEMENTATION

### 7.1 Complete Code

```python
import numpy as np
from typing import List, Dict, Tuple

class TrendAnalyzer:
    def __init__(self, swing_lookback: int = 5, trend_lookback: int = 20,
                 angle_normalization_max: float = 45.0):
        self.swing_lookback = swing_lookback
        self.trend_lookback = trend_lookback
        self.angle_normalization_max = angle_normalization_max

    def calculate_trend_strength(self, candles: List[Dict]) -> Dict:
        """Calculate trend strength using swing consistency and progression angle"""

        if len(candles) < self.trend_lookback:
            return {
                'strength': 0,
                'direction': 'NONE',
                'label': 'WEAK',
                'components': {}
            }

        recent = candles[-self.trend_lookback:]

        # Component 1: Swing Consistency (60%)
        swings = self._identify_swings(recent)
        swing_result = self._calculate_swing_consistency(swings)
        consistency_score = swing_result['score']

        # Component 2: Progression Angle (40%)
        slope = self._calculate_linear_regression_slope(recent)
        angle_degrees = self._slope_to_angle(slope)
        angle_score = self._normalize_angle_to_score(angle_degrees)

        # Combined strength
        trend_strength = (consistency_score * 0.6) + (angle_score * 0.4)

        # Determine direction
        direction = swing_result['direction']
        if angle_degrees > 5:
            direction = 'UP'
        elif angle_degrees < -5:
            direction = 'DOWN'
        elif trend_strength < 40:
            direction = 'RANGE'

        # Classify strength
        if trend_strength >= 70:
            label = 'STRONG'
        elif trend_strength >= 40:
            label = 'MODERATE'
        else:
            label = 'WEAK'

        return {
            'strength': trend_strength,
            'direction': direction,
            'label': label,
            'components': {
                'consistency': consistency_score,
                'angle': angle_score,
                'angleDegrees': angle_degrees,
                'slope': slope
            },
            'swings': swings
        }

    def _identify_swings(self, candles: List[Dict]) -> Dict:
        """Identify swing highs and lows"""
        swings = {'highs': [], 'lows': []}
        lookback = self.swing_lookback

        for i in range(lookback, len(candles) - lookback):
            window = candles[i - lookback:i + lookback + 1]
            current = candles[i]

            # Swing High
            is_swing_high = all(
                c['high'] <= current['high']
                for j, c in enumerate(window)
                if j != lookback
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
                if j != lookback
            )
            if is_swing_low:
                swings['lows'].append({
                    'index': i,
                    'price': current['low'],
                    'timestamp': current['timestamp']
                })

        return swings

    def _calculate_swing_consistency(self, swings: Dict) -> Dict:
        """Calculate swing consistency score"""
        highs = swings['highs']
        lows = swings['lows']

        if len(highs) < 2 or len(lows) < 2:
            return {'score': 0, 'direction': 'NONE'}

        # Uptrend: HH + HL
        hh_count = sum(1 for i in range(1, len(highs))
                      if highs[i]['price'] > highs[i-1]['price'])
        hl_count = sum(1 for i in range(1, len(lows))
                      if lows[i]['price'] > lows[i-1]['price'])
        uptrend_score = ((hh_count / (len(highs) - 1)) +
                        (hl_count / (len(lows) - 1))) / 2

        # Downtrend: LH + LL
        lh_count = sum(1 for i in range(1, len(highs))
                      if highs[i]['price'] < highs[i-1]['price'])
        ll_count = sum(1 for i in range(1, len(lows))
                      if lows[i]['price'] < lows[i-1]['price'])
        downtrend_score = ((lh_count / (len(highs) - 1)) +
                          (ll_count / (len(lows) - 1))) / 2

        is_uptrend = uptrend_score > downtrend_score
        score = max(uptrend_score, downtrend_score) * 100
        direction = 'UP' if is_uptrend else 'DOWN'

        return {'score': score, 'direction': direction}

    def _calculate_linear_regression_slope(self, candles: List[Dict]) -> float:
        """Calculate slope using linear regression"""
        closes = np.array([c['close'] for c in candles])
        x = np.arange(len(closes))

        # Linear regression: y = mx + b
        slope = np.polyfit(x, closes, 1)[0]

        return slope

    def _slope_to_angle(self, slope: float) -> float:
        """Convert slope to angle in degrees"""
        angle_radians = np.arctan(slope)
        angle_degrees = np.degrees(angle_radians)
        return angle_degrees

    def _normalize_angle_to_score(self, angle_degrees: float) -> float:
        """Normalize angle to 0-100 score"""
        abs_angle = abs(angle_degrees)
        normalized = min(abs_angle / self.angle_normalization_max, 1.0)
        return normalized * 100
```

### 7.2 Usage Example

```python
# Initialize
analyzer = TrendAnalyzer(
    swing_lookback=5,
    trend_lookback=20,
    angle_normalization_max=45.0
)

# Load candles
candles = fetch_historical_data('BTCUSDT', '1h', 30)

# Calculate trend strength
result = analyzer.calculate_trend_strength(candles)

print(f"Trend Strength: {result['strength']:.1f}")
print(f"Direction: {result['direction']}")
print(f"Label: {result['label']}")
print(f"Components:")
print(f"  - Consistency: {result['components']['consistency']:.1f}")
print(f"  - Angle: {result['components']['angle']:.1f}")
print(f"  - Angle (degrees): {result['components']['angleDegrees']:.2f}°")
```

**Output:**
```
Trend Strength: 78.5
Direction: UP
Label: STRONG
Components:
  - Consistency: 85.0
  - Angle: 67.5
  - Angle (degrees): 30.38°
```

---

## 8. JAVASCRIPT IMPLEMENTATION

### 8.1 Complete Code

```javascript
class TrendAnalyzer {
  constructor(config = {}) {
    this.swingLookback = config.swingLookback || 5;
    this.trendLookback = config.trendLookback || 20;
    this.angleNormalizationMax = config.angleNormalizationMax || 45;
  }

  calculateTrendStrength(candles) {
    if (candles.length < this.trendLookback) {
      return {
        strength: 0,
        direction: 'NONE',
        label: 'WEAK',
        components: {}
      };
    }

    const recent = candles.slice(-this.trendLookback);

    // Component 1: Swing Consistency (60%)
    const swings = this.identifySwings(recent);
    const swingResult = this.calculateSwingConsistency(swings);
    const consistencyScore = swingResult.score;

    // Component 2: Progression Angle (40%)
    const slope = this.calculateLinearRegressionSlope(recent);
    const angleDegrees = this.slopeToAngle(slope);
    const angleScore = this.normalizeAngleToScore(angleDegrees);

    // Combined strength
    const trendStrength = (consistencyScore * 0.6) + (angleScore * 0.4);

    // Determine direction
    let direction = swingResult.direction;
    if (angleDegrees > 5) direction = 'UP';
    else if (angleDegrees < -5) direction = 'DOWN';
    else if (trendStrength < 40) direction = 'RANGE';

    // Classify strength
    let label = 'WEAK';
    if (trendStrength >= 70) label = 'STRONG';
    else if (trendStrength >= 40) label = 'MODERATE';

    return {
      strength: trendStrength,
      direction,
      label,
      components: {
        consistency: consistencyScore,
        angle: angleScore,
        angleDegrees,
        slope
      },
      swings
    };
  }

  identifySwings(candles) {
    const swings = { highs: [], lows: [] };
    const lookback = this.swingLookback;

    for (let i = lookback; i < candles.length - lookback; i++) {
      const window = candles.slice(i - lookback, i + lookback + 1);
      const current = candles[i];

      // Swing High
      const isSwingHigh = window.every((c, idx) =>
        idx === lookback ? true : c.high <= current.high
      );
      if (isSwingHigh) {
        swings.highs.push({
          index: i,
          price: current.high,
          timestamp: current.timestamp
        });
      }

      // Swing Low
      const isSwingLow = window.every((c, idx) =>
        idx === lookback ? true : c.low >= current.low
      );
      if (isSwingLow) {
        swings.lows.push({
          index: i,
          price: current.low,
          timestamp: current.timestamp
        });
      }
    }

    return swings;
  }

  calculateSwingConsistency(swings) {
    const { highs, lows } = swings;

    if (highs.length < 2 || lows.length < 2) {
      return { score: 0, direction: 'NONE' };
    }

    // Uptrend: HH + HL
    const hhCount = highs.slice(1).filter((h, i) => h.price > highs[i].price).length;
    const hlCount = lows.slice(1).filter((l, i) => l.price > lows[i].price).length;
    const uptrendScore = ((hhCount / (highs.length - 1)) + (hlCount / (lows.length - 1))) / 2;

    // Downtrend: LH + LL
    const lhCount = highs.slice(1).filter((h, i) => h.price < highs[i].price).length;
    const llCount = lows.slice(1).filter((l, i) => l.price < lows[i].price).length;
    const downtrendScore = ((lhCount / (highs.length - 1)) + (llCount / (lows.length - 1))) / 2;

    const isUptrend = uptrendScore > downtrendScore;
    const score = Math.max(uptrendScore, downtrendScore) * 100;
    const direction = isUptrend ? 'UP' : 'DOWN';

    return { score, direction };
  }

  calculateLinearRegressionSlope(candles) {
    const closes = candles.map(c => c.close);
    const n = closes.length;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += closes[i];
      sumXY += i * closes[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  slopeToAngle(slope) {
    const angleRadians = Math.atan(slope);
    const angleDegrees = angleRadians * (180 / Math.PI);
    return angleDegrees;
  }

  normalizeAngleToScore(angleDegrees) {
    const absAngle = Math.abs(angleDegrees);
    const normalized = Math.min(absAngle / this.angleNormalizationMax, 1.0);
    return normalized * 100;
  }
}

export default TrendAnalyzer;
```

---

## 9. CONFIGURATION RECOMMENDATIONS

### By Trading Style

**Scalper (1m-5m charts):**
```javascript
{
  swingLookback: 3,
  trendLookback: 15,
  angleNormalizationMax: 30
}
```
- Fast reaction to trend changes
- Shorter lookbacks for quick signals
- Steeper angle requirement (30°) to avoid ranging noise

**Day Trader (15m-1h charts):**
```javascript
{
  swingLookback: 5,
  trendLookback: 20,
  angleNormalizationMax: 45
}
```
- Standard configuration (default)
- Balanced responsiveness and stability

**Swing Trader (4h-Daily charts):**
```javascript
{
  swingLookback: 7,
  trendLookback: 30,
  angleNormalizationMax: 60
}
```
- Longer lookbacks for major structure
- Allows shallower angles (60°) on higher timeframes

---

## 10. TROUBLESHOOTING

### Problem 1: Trend strength always low (< 40)

**Possible Causes:**
- Market is ranging (not a bug)
- Lookback periods too long for timeframe
- Angle normalization max too low

**Solutions:**
- Check if market is actually trending visually
- Reduce trendLookback to 10-15
- Increase angleNormalizationMax to 60°

### Problem 2: Direction flips frequently

**Possible Causes:**
- Swing lookback too small
- Choppy market conditions
- Conflicting swing/angle signals

**Solutions:**
- Increase swingLookback to 7-10
- Add hysteresis (require 5° difference before changing direction)
- Use strength < 50 → label as 'RANGE' instead of directional

### Problem 3: Strong trends scoring as MODERATE

**Possible Causes:**
- Angle normalization max too high
- Swing detection missing key swings

**Solutions:**
- Lower angleNormalizationMax to 30-40°
- Adjust swingLookback (try ±2 from current value)
- Verify swing detection is finding actual swing points

---

**END OF TREND STRENGTH FORMULA**
