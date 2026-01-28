/**
 * Web Worker para detección de patrones
 * Mueve cálculos de detección fuera del main thread
 */

/**
 * Detecta patrones de rechazo (Hammer, Shooting Star, etc.)
 * @param {Object} candle - Vela actual {open, high, low, close, volume}
 * @param {Array} prevCandles - Velas anteriores para contexto
 * @param {Object} config - Configuración de detección
 */
function detectRejectionPattern(candle, prevCandles = [], config = {}) {
  const { open: o, high: h, low: l, close: c } = candle;

  const body = Math.abs(c - o);
  const lowerShadow = Math.min(o, c) - l;
  const upperShadow = h - Math.max(o, c);
  const totalRange = h - l;

  if (totalRange === 0) {
    return null;
  }

  const minWickRatio = config.minWickRatio || 2.0;

  // Hammer (bullish)
  if (lowerShadow >= minWickRatio * body &&
      upperShadow <= 0.1 * body &&
      (c - l) / totalRange >= 0.6) {
    const quality = body > 0 ? Math.min(1.0, (lowerShadow / body) / 3.0) : 0.8;
    return {
      type: 'HAMMER',
      direction: 'bullish',
      quality,
      price: c
    };
  }

  // Shooting Star (bearish)
  if (upperShadow >= minWickRatio * body &&
      lowerShadow <= 0.1 * body &&
      (h - c) / totalRange >= 0.6) {
    const quality = body > 0 ? Math.min(1.0, (upperShadow / body) / 3.0) : 0.8;
    return {
      type: 'SHOOTING_STAR',
      direction: 'bearish',
      quality,
      price: c
    };
  }

  // Engulfing patterns (necesita vela anterior)
  if (prevCandles.length > 0) {
    const prev = prevCandles[prevCandles.length - 1];
    const prevBodyTop = Math.max(prev.open, prev.close);
    const prevBodyBottom = Math.min(prev.open, prev.close);
    const currBodyTop = Math.max(o, c);
    const currBodyBottom = Math.min(o, c);

    // Bullish Engulfing
    if (prev.close < prev.open &&  // Prev bearish
        c > o &&                    // Curr bullish
        currBodyBottom < prevBodyBottom &&
        currBodyTop > prevBodyTop) {
      return {
        type: 'ENGULFING_BULLISH',
        direction: 'bullish',
        quality: Math.min(1.0, body / totalRange * 1.2),
        price: c
      };
    }

    // Bearish Engulfing
    if (prev.close > prev.open &&  // Prev bullish
        c < o &&                    // Curr bearish
        currBodyTop > prevBodyTop &&
        currBodyBottom < prevBodyBottom) {
      return {
        type: 'ENGULFING_BEARISH',
        direction: 'bearish',
        quality: Math.min(1.0, body / totalRange * 1.2),
        price: c
      };
    }
  }

  // Doji patterns
  const bodyRatio = body / totalRange;
  if (bodyRatio <= 0.05) {
    // Dragonfly Doji
    if (lowerShadow > totalRange * 0.6 && upperShadow < totalRange * 0.1) {
      return {
        type: 'DOJI_DRAGONFLY',
        direction: 'bullish',
        quality: 1.0 - bodyRatio * 10,
        price: c
      };
    }

    // Gravestone Doji
    if (upperShadow > totalRange * 0.6 && lowerShadow < totalRange * 0.1) {
      return {
        type: 'DOJI_GRAVESTONE',
        direction: 'bearish',
        quality: 1.0 - bodyRatio * 10,
        price: c
      };
    }
  }

  return null;
}

/**
 * Detecta todos los patrones de rechazo en un array de velas
 * @param {Array} candles - Array de velas
 * @param {Object} config - Configuración
 */
function detectAllRejectionPatterns(candles, config = {}) {
  const patterns = [];

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandles = candles.slice(Math.max(0, i - 5), i);

    const pattern = detectRejectionPattern(candle, prevCandles, config);

    if (pattern) {
      patterns.push({
        ...pattern,
        timestamp: candle.timestamp,
        candleIndex: i
      });
    }
  }

  return patterns;
}

/**
 * Detecta swing points (máximos y mínimos locales)
 * @param {Array} candles - Velas con {high, low, timestamp}
 * @param {number} leftBars - Barras a la izquierda para confirmar
 * @param {number} rightBars - Barras a la derecha para confirmar
 */
function detectSwingPoints(candles, leftBars = 5, rightBars = 5) {
  const swings = {
    highs: [],
    lows: []
  };

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const candle = candles[i];

    // Check for swing high
    let isSwingHigh = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j !== i && candles[j].high >= candle.high) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swings.highs.push({
        price: candle.high,
        timestamp: candle.timestamp,
        candleIndex: i
      });
    }

    // Check for swing low
    let isSwingLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j !== i && candles[j].low <= candle.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swings.lows.push({
        price: candle.low,
        timestamp: candle.timestamp,
        candleIndex: i
      });
    }
  }

  return swings;
}

/**
 * Calcula Z-scores para un array de valores
 * @param {Array} values - Array de números
 * @param {number} period - Período para media/std
 */
function calculateZScores(values, period = 20) {
  const zScores = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      zScores.push(0);
      continue;
    }

    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const stdev = Math.sqrt(variance);

    if (stdev === 0) {
      zScores.push(0);
    } else {
      zScores.push((values[i] - mean) / stdev);
    }
  }

  return zScores;
}

// Handler de mensajes del main thread
self.onmessage = function(e) {
  const { type, data, id } = e.data;

  try {
    let result;

    switch (type) {
      case 'DETECT_REJECTION_PATTERNS':
        result = detectAllRejectionPatterns(data.candles, data.config);
        break;

      case 'DETECT_SWING_POINTS':
        result = detectSwingPoints(
          data.candles,
          data.leftBars || 5,
          data.rightBars || 5
        );
        break;

      case 'CALCULATE_ZSCORES':
        result = calculateZScores(data.values, data.period || 20);
        break;

      case 'DETECT_SINGLE_PATTERN':
        result = detectRejectionPattern(
          data.candle,
          data.prevCandles || [],
          data.config || {}
        );
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, success: true, result });
  } catch (error) {
    self.postMessage({ id, success: false, error: error.message });
  }
};
