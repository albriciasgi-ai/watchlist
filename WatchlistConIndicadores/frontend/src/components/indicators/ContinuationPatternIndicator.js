// src/components/indicators/ContinuationPatternIndicator.js
// Continuation Pattern Indicator - Detects and displays all pattern types with adaptive scoring

import IndicatorBase from "./IndicatorBase.js";
import { API_BASE_URL } from "../../config.js";

class ContinuationPatternIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30, config = {}) {
    super(symbol, interval, days);
    this.name = "Continuation Patterns";
    this.height = 0; // Draws over main chart

    // Pattern type filters
    this.showContinuation = config.showContinuation !== undefined ? config.showContinuation : true;
    this.showTrendStart = config.showTrendStart !== undefined ? config.showTrendStart : true;
    this.showMomentum = config.showMomentum !== undefined ? config.showMomentum : true;
    this.showReversal = config.showReversal !== undefined ? config.showReversal : false;

    // Confidence filtering
    this.minConfidence = config.minConfidence || 60;

    // Level sources configuration
    this.includeVWAP = config.includeVWAP !== undefined ? config.includeVWAP : true;
    this.includeFibonacci = config.includeFibonacci !== undefined ? config.includeFibonacci : false;
    this.vwapConfig = config.vwapConfig || {
      vwap_type: 'session',
      reset_hour: 0,
      apply_crypto_adjustment: true
    };
    this.fibonacciConfig = config.fibonacciConfig || {
      auto_detect: true,  // MUST be true by default to avoid backend error
      lookback: 50,
      include_extensions: false
    };

    // Visual settings
    this.showLabels = config.showLabels !== undefined ? config.showLabels : true;
    this.showConfidence = config.showConfidence !== undefined ? config.showConfidence : true;
    this.iconSize = config.iconSize || 9;  // Changed from 16 to 9px

    // Pattern-specific parameters (for backend detection)
    this.patternParams = config.patternParams || {
      // Reversal pattern parameters
      reversal: {
        minWickRatio: 1.5,        // Min wick/body ratio (1.5 = wick 1.5x body)
        maxOppositeWick: 0.25,    // Max opposite wick (0.25 = 25% of body)
        minBodyPosition: 0.5,     // Min body position in range (0.5 = 50%)
        engulfingTolerance: 0.02, // Engulfing tolerance (0.02 = 2% margin, more strict)
        invertProximity: false    // Invert proximity logic (false = near levels = high confidence)
      },
      // Continuation pattern parameters
      continuation: {
        maxConsolidationRange: 0.03,  // Max consolidation range (3%)
        minBreakoutSize: 0.01         // Min breakout size (1%)
      },
      // Momentum pattern parameters
      momentum: {
        minBodyPercent: 0.3,      // Min body as % of range
        minConsecutive: 3         // Min consecutive candles
      }
    };

    // Data
    this.patterns = [];
    this.patternsByType = {
      continuation: [],
      trend_start: [],
      momentum: [],
      reversal: []
    };
    this.trendAnalysis = null;

    // Colors by pattern type
    this.colors = {
      continuation: {
        bullish: '#4CAF50',  // Green
        bearish: '#F44336'   // Red
      },
      trend_start: {
        bullish: '#2196F3',  // Blue
        bearish: '#FF9800'   // Orange
      },
      momentum: {
        bullish: '#9C27B0',  // Purple
        bearish: '#E91E63'   // Pink
      },
      reversal: {
        bullish: '#00BCD4',  // Cyan
        bearish: '#FF5722'   // Deep Orange
      }
    };

    // Pattern icons (emoji)
    this.icons = {
      // Continuation
      bull_flag: '🚩',
      bear_flag: '🏴',
      bull_pennant: '⛳',
      bear_pennant: '🏴‍☠️',

      // Trend Start
      bull_breakout: '🚀',
      bear_breakout: '📉',

      // Momentum
      three_white_soldiers: '⬆️⬆️⬆️',
      three_black_crows: '⬇️⬇️⬇️',
      bull_marubozu: '💪',
      bear_marubozu: '💔',

      // Reversal (from rejection patterns)
      hammer: '🔨',
      shooting_star: '⭐',
      bull_engulfing: '📈',
      bear_engulfing: '📉',
      dragonfly_doji: '🐉',
      gravestone_doji: '🪦'
    };
  }

  async fetchData() {
    this.loading = true;

    try {
      const body = {
        symbol: this.symbol,
        interval: this.interval,
        days: this.days,
        include_vwap: this.includeVWAP,
        include_fibonacci: this.includeFibonacci,
        vwap_config: this.vwapConfig,
        fibonacci_config: this.fibonacciConfig,
        pattern_params: this.patternParams  // Send pattern-specific parameters
      };

      const url = `${API_BASE_URL}/api/patterns/analyze`;
      console.log(`[${this.symbol}] Fetching continuation patterns...`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const json = await response.json();

      if (json.success && json.data) {
        this.patterns = json.data.patterns || [];
        this.patternsByType = json.data.patterns_by_type || {
          continuation: [],
          trend_start: [],
          momentum: [],
          reversal: []
        };
        this.trendAnalysis = json.data.trend || null;

        console.log(`[${this.symbol}] ✅ Patterns loaded:`, json.data.summary);

        // DEBUG: Log reversal pattern analysis (only once after fetch)
        const reversalPatterns = this.patterns.filter(p => p.pattern_type === 'reversal');
        if (reversalPatterns.length > 0) {
          const countByName = {};
          const belowThreshold = [];
          const aboveThreshold = [];

          reversalPatterns.forEach(p => {
            countByName[p.pattern_name] = (countByName[p.pattern_name] || 0) + 1;
            if (p.confidence < this.minConfidence) {
              belowThreshold.push(p);
            } else {
              aboveThreshold.push(p);
            }
          });

          console.log(`[${this.symbol}] 📊 Reversal Patterns by type:`, countByName);
          console.log(`[${this.symbol}] 🎯 Min confidence threshold: ${this.minConfidence}%`);
          console.log(`[${this.symbol}] ✅ Above threshold: ${aboveThreshold.length}/${reversalPatterns.length}`);
          console.log(`[${this.symbol}] ❌ Below threshold: ${belowThreshold.length}/${reversalPatterns.length}`);

          if (belowThreshold.length > 0) {
            const avgConfidence = (belowThreshold.reduce((sum, p) => sum + p.confidence, 0) / belowThreshold.length).toFixed(1);
            console.log(`[${this.symbol}] 📉 Avg confidence of rejected: ${avgConfidence}%`);
          }
          if (aboveThreshold.length > 0) {
            const avgConfidence = (aboveThreshold.reduce((sum, p) => sum + p.confidence, 0) / aboveThreshold.length).toFixed(1);
            console.log(`[${this.symbol}] 📈 Avg confidence of accepted: ${avgConfidence}%`);
          }
        }

        return true;
      } else {
        console.error(`[${this.symbol}] ❌ Pattern error:`, json.error);
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Pattern fetch error:`, error);
      return false;
    } finally {
      this.loading = false;
    }
  }

  updateConfig(config) {
    let needsRefresh = false;

    // Pattern type filters
    if (config.showContinuation !== undefined) {
      this.showContinuation = config.showContinuation;
    }
    if (config.showTrendStart !== undefined) {
      this.showTrendStart = config.showTrendStart;
    }
    if (config.showMomentum !== undefined) {
      this.showMomentum = config.showMomentum;
    }
    if (config.showReversal !== undefined) {
      this.showReversal = config.showReversal;
    }

    // Confidence filter
    if (config.minConfidence !== undefined) {
      this.minConfidence = config.minConfidence;
    }

    // Level sources (these require data refresh)
    if (config.includeVWAP !== undefined && config.includeVWAP !== this.includeVWAP) {
      this.includeVWAP = config.includeVWAP;
      needsRefresh = true;
    }

    if (config.includeFibonacci !== undefined && config.includeFibonacci !== this.includeFibonacci) {
      this.includeFibonacci = config.includeFibonacci;
      needsRefresh = true;
    }

    if (config.vwapConfig) {
      this.vwapConfig = { ...this.vwapConfig, ...config.vwapConfig };
      if (this.includeVWAP) needsRefresh = true;
    }

    if (config.fibonacciConfig) {
      this.fibonacciConfig = { ...this.fibonacciConfig, ...config.fibonacciConfig };
      if (this.includeFibonacci) needsRefresh = true;
    }

    // Visual settings
    if (config.showLabels !== undefined) {
      this.showLabels = config.showLabels;
    }
    if (config.showConfidence !== undefined) {
      this.showConfidence = config.showConfidence;
    }
    if (config.iconSize !== undefined) {
      this.iconSize = config.iconSize;
    }

    // Pattern parameters (require refresh)
    if (config.patternParams) {
      this.patternParams = { ...this.patternParams, ...config.patternParams };
      needsRefresh = true;
    }

    if (needsRefresh) {
      this.fetchData();
    }
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !this.patterns || this.patterns.length === 0) return;

    const { x, y, width, height } = bounds;
    const viewport = priceContext || {};

    // Filter patterns by enabled types and confidence
    const filteredPatterns = this.patterns.filter(pattern => {
      // Confidence filter
      if (pattern.confidence < this.minConfidence) return false;

      // Type filter
      if (pattern.pattern_type === 'continuation' && !this.showContinuation) return false;
      if (pattern.pattern_type === 'trend_start' && !this.showTrendStart) return false;
      if (pattern.pattern_type === 'momentum' && !this.showMomentum) return false;
      if (pattern.pattern_type === 'reversal' && !this.showReversal) return false;

      return true;
    });

    // Create timestamp map for fast lookup
    const timestampMap = new Map();
    visibleCandles.forEach((candle, i) => {
      timestampMap.set(candle.timestamp, i);
    });

    // Draw each pattern
    filteredPatterns.forEach(pattern => {
      const candleIndex = timestampMap.get(pattern.timestamp);
      if (candleIndex === undefined) return;

      this._drawPattern(ctx, pattern, candleIndex, visibleCandles, x, y, width, height, viewport);
    });

    // Draw trend info if available
    if (this.trendAnalysis && this.showLabels) {
      this._drawTrendInfo(ctx, x, y);
    }
  }

  _drawPattern(ctx, pattern, candleIndex, visibleCandles, x, y, width, height, viewport) {
    const candleWidth = width / visibleCandles.length;
    const candleX = x + (candleIndex * candleWidth) + (candleWidth / 2);

    // Get pattern color
    const colorGroup = this.colors[pattern.pattern_type];
    const color = colorGroup ? colorGroup[pattern.direction] : '#FFFFFF';

    // Calculate Y position (above/below price based on direction)
    const candle = visibleCandles[candleIndex];
    const minPrice = viewport.minPrice || Math.min(...visibleCandles.map(c => c.low));
    const maxPrice = viewport.maxPrice || Math.max(...visibleCandles.map(c => c.high));
    const priceRange = maxPrice - minPrice;

    let markerPrice;
    if (pattern.direction === 'bullish') {
      markerPrice = candle.high + (priceRange * 0.02);  // Above candle
    } else {
      markerPrice = candle.low - (priceRange * 0.02);  // Below candle
    }

    // Use priceToY if available
    let candleY;
    if (viewport.priceToY) {
      candleY = viewport.priceToY(markerPrice);
    } else {
      candleY = y + ((maxPrice - markerPrice) / priceRange) * height;
    }

    // Draw pattern icon
    const icon = this.icons[pattern.pattern_name] || '📍';
    ctx.font = `${this.iconSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, candleX, candleY);

    // Draw label if enabled
    if (this.showLabels) {
      const labelY = pattern.direction === 'bullish' ? candleY - 20 : candleY + 20;
      this._drawLabel(ctx, pattern, candleX, labelY, color);
    }

    // Draw confidence badge if enabled
    if (this.showConfidence) {
      const badgeY = pattern.direction === 'bullish' ? candleY - 35 : candleY + 35;
      this._drawConfidenceBadge(ctx, pattern.confidence, candleX, badgeY, color);
    }
  }

  _drawLabel(ctx, pattern, x, y, color) {
    // Format pattern name for display
    const displayName = pattern.pattern_name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(displayName, x, y);
  }

  _drawConfidenceBadge(ctx, confidence, x, y, color) {
    const badgeText = `${Math.round(confidence)}%`;

    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const textWidth = ctx.measureText(badgeText).width;
    ctx.fillRect(x - textWidth / 2 - 4, y - 8, textWidth + 8, 16);

    // Draw text
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, x, y);
  }

  _drawTrendInfo(ctx, x, y) {
    if (!this.trendAnalysis) return;

    const trend = this.trendAnalysis;
    const text = `Trend: ${trend.direction} (${trend.strength}% strength)`;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(x + 10, y + 10, 200, 25);

    // Text
    ctx.font = 'bold 11px Inter, sans-serif';
    const trendColor = trend.direction === 'uptrend' ? '#4CAF50' :
                      trend.direction === 'downtrend' ? '#F44336' : '#FFC107';
    ctx.fillStyle = trendColor;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 15, y + 22);
  }

  // Get pattern statistics
  getPatternStats() {
    return {
      total: this.patterns.length,
      byType: {
        continuation: this.patternsByType.continuation?.length || 0,
        trend_start: this.patternsByType.trend_start?.length || 0,
        momentum: this.patternsByType.momentum?.length || 0,
        reversal: this.patternsByType.reversal?.length || 0
      },
      filtered: this.patterns.filter(p => {
        if (p.confidence < this.minConfidence) return false;
        if (p.pattern_type === 'continuation' && !this.showContinuation) return false;
        if (p.pattern_type === 'trend_start' && !this.showTrendStart) return false;
        if (p.pattern_type === 'momentum' && !this.showMomentum) return false;
        if (p.pattern_type === 'reversal' && !this.showReversal) return false;
        return true;
      }).length,
      trend: this.trendAnalysis
    };
  }

  // Get patterns for a specific type
  getPatternsByType(type) {
    return this.patternsByType[type] || [];
  }

  // Get patterns with minimum confidence
  getPatternsAboveConfidence(minConfidence) {
    return this.patterns.filter(p => p.confidence >= minConfidence);
  }
}

export default ContinuationPatternIndicator;
