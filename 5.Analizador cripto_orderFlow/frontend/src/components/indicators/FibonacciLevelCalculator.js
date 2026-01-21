// src/components/indicators/FibonacciLevelCalculator.js
// Fibonacci Retracement and Extension Level Calculator

import IndicatorBase from "./IndicatorBase.js";
import { API_BASE_URL } from "../../config.js";

class FibonacciLevelCalculator extends IndicatorBase {
  constructor(symbol, interval, days = 30, config = {}) {
    super(symbol, interval, days);
    this.name = "Fibonacci";
    this.height = 0; // Draws over main chart

    // Configuration
    this.swingHigh = config.swingHigh || null;
    this.swingLow = config.swingLow || null;
    this.autoDetect = config.autoDetect !== undefined ? config.autoDetect : true;
    this.lookback = config.lookback || 50;
    this.showRetracements = config.showRetracements !== undefined ? config.showRetracements : true;
    this.showExtensions = config.showExtensions !== undefined ? config.showExtensions : false;
    this.levels = config.levels || [0.236, 0.382, 0.5, 0.618, 0.786];
    this.extensionLevels = config.extensionLevels || [1.272, 1.414, 1.618, 2.0, 2.618];

    // Visual
    this.color = config.color || 'rgba(33, 150, 243, 0.6)';
    this.lineWidth = config.lineWidth || 1;
    this.labelPosition = config.labelPosition || 'right';

    // Data
    this.fibData = null;
  }

  async fetchData() {
    this.loading = true;

    try {
      const body = {
        symbol: this.symbol,
        interval: this.interval,
        days: this.days,
        swing_high: this.swingHigh,
        swing_low: this.swingLow,
        auto_detect: this.autoDetect,
        lookback: this.lookback,
        include_extensions: this.showExtensions
      };

      const url = `${API_BASE_URL}/api/fibonacci/calculate`;
      console.log(`[${this.symbol}] Fetching Fibonacci levels...`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const json = await response.json();

      if (json.success && json.data) {
        this.fibData = json.data;
        console.log(`[${this.symbol}] ✅ Fibonacci loaded: ${json.data.swing_info?.direction}`);
        return true;
      } else {
        console.error(`[${this.symbol}] ❌ Fibonacci error:`, json.error);
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Fibonacci fetch error:`, error);
      return false;
    } finally {
      this.loading = false;
    }
  }

  updateConfig(config) {
    let needsRefresh = false;

    if (config.swingHigh !== undefined && config.swingHigh !== this.swingHigh) {
      this.swingHigh = config.swingHigh;
      needsRefresh = true;
    }

    if (config.swingLow !== undefined && config.swingLow !== this.swingLow) {
      this.swingLow = config.swingLow;
      needsRefresh = true;
    }

    if (config.autoDetect !== undefined && config.autoDetect !== this.autoDetect) {
      this.autoDetect = config.autoDetect;
      needsRefresh = true;
    }

    if (config.lookback !== undefined && config.lookback !== this.lookback) {
      this.lookback = config.lookback;
      needsRefresh = true;
    }

    if (config.showRetracements !== undefined) {
      this.showRetracements = config.showRetracements;
    }

    if (config.showExtensions !== undefined) {
      this.showExtensions = config.showExtensions;
      needsRefresh = true;
    }

    if (config.levels) this.levels = config.levels;
    if (config.extensionLevels) this.extensionLevels = config.extensionLevels;
    if (config.color) this.color = config.color;
    if (config.lineWidth) this.lineWidth = config.lineWidth;
    if (config.labelPosition) this.labelPosition = config.labelPosition;

    if (needsRefresh) {
      this.fetchData();
    }
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !this.fibData) return;

    const { x, y, width, height } = bounds;
    const viewport = priceContext || {};

    // Draw retracement levels
    if (this.showRetracements && this.fibData.retracements) {
      this._drawFibLevels(ctx, this.fibData.retracements, viewport, x, y, width, height, 'retracement');
    }

    // Draw extension levels
    if (this.showExtensions && this.fibData.extensions) {
      this._drawFibLevels(ctx, this.fibData.extensions, viewport, x, y, width, height, 'extension');
    }
  }

  _drawFibLevels(ctx, levels, viewport, x, y, width, height, type) {
    levels.forEach(level => {
      const price = level.price;

      // Check if level is in viewport
      if (viewport.minPrice && viewport.maxPrice) {
        if (price < viewport.minPrice || price > viewport.maxPrice) return;
      }

      // Calculate Y position using priceToY if available
      let levelY;
      if (viewport.priceToY) {
        levelY = viewport.priceToY(price);
      } else {
        levelY = y + ((viewport.maxPrice - price) / (viewport.maxPrice - viewport.minPrice)) * height;
      }

      // Draw horizontal line
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.lineWidth;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, levelY);
      ctx.lineTo(x + width, levelY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label
      this._drawLabel(ctx, level, levelY, x, width, type);
    });
  }

  _drawLabel(ctx, level, levelY, x, width, type) {
    const labelText = type === 'retracement'
      ? `Fib ${(level.level * 100).toFixed(1)}% (${level.price.toFixed(2)})`
      : `Fib ${level.level.toFixed(3)} (${level.price.toFixed(2)})`;

    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = this.color;

    const textWidth = ctx.measureText(labelText).width;

    if (this.labelPosition === 'right') {
      ctx.fillText(labelText, x + width - textWidth - 5, levelY - 3);
    } else if (this.labelPosition === 'left') {
      ctx.fillText(labelText, x + 5, levelY - 3);
    }
    // 'none' = don't draw labels
  }

  // Get Fibonacci levels for pattern detection
  getFibonacciLevels() {
    if (!this.fibData) return [];

    const levels = [];

    if (this.showRetracements && this.fibData.retracements) {
      this.fibData.retracements.forEach(level => {
        levels.push({
          price: level.price,
          type: 'fibonacci_retracement',
          level: level.level,
          strength: this._getLevelStrength(level.level)
        });
      });
    }

    if (this.showExtensions && this.fibData.extensions) {
      this.fibData.extensions.forEach(level => {
        levels.push({
          price: level.price,
          type: 'fibonacci_extension',
          level: level.level,
          strength: 70
        });
      });
    }

    return levels;
  }

  _getLevelStrength(levelRatio) {
    // Key Fibonacci levels have higher strength
    const keyLevels = [0.382, 0.5, 0.618];

    if (keyLevels.includes(levelRatio)) {
      return 90;
    } else if (levelRatio === 0.786) {
      return 85;
    } else {
      return 70;
    }
  }

  // Get swing information
  getSwingInfo() {
    return this.fibData ? this.fibData.swing_info : null;
  }
}

export default FibonacciLevelCalculator;
