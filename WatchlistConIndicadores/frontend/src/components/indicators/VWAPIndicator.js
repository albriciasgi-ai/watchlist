// src/components/indicators/VWAPIndicator.js
// VWAP Indicator with Standard Deviation Bands

import IndicatorBase from "./IndicatorBase.js";
import { API_BASE_URL } from "../../config.js";

class VWAPIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 7, config = {}) {
    super(symbol, interval, days);
    this.name = "VWAP";
    this.height = 0; // VWAP se dibuja sobre el gráfico principal, no necesita espacio separado

    // Configuration
    this.vwapType = config.vwapType || 'session';
    this.resetHour = config.resetHour || 0;
    this.anchorTimestamp = config.anchorTimestamp || null;
    this.rollingPeriod = config.rollingPeriod || 20;
    this.showBands = config.showBands !== undefined ? config.showBands : true;
    this.bandMultipliers = config.bandMultipliers || [1.0, 2.0, 3.0];
    this.applyCryptoAdjustment = config.applyCryptoAdjustment !== undefined ? config.applyCryptoAdjustment : true;

    // Colors and Line Styles
    this.vwapColor = config.vwapColor || 'rgba(255, 152, 0, 0.8)';
    this.vwapLineWidth = config.vwapLineWidth || 2;
    this.bandLineWidth = config.bandLineWidth || 1;
    this.bandColors = config.bandColors || {
      band1: 'rgba(255, 152, 0, 0.3)',
      band2: 'rgba(255, 152, 0, 0.2)',
      band3: 'rgba(255, 152, 0, 0.1)'
    };

    // Data
    this.vwapData = [];
    this.dataMap = new Map();
  }

  async fetchData() {
    this.loading = true;

    try {
      const params = new URLSearchParams({
        interval: this.interval,
        days: this.days,
        vwap_type: this.vwapType,
        reset_hour: this.resetHour,
        rolling_period: this.rollingPeriod,
        band_multipliers: this.bandMultipliers.join(','),
        apply_crypto_adjustment: this.applyCryptoAdjustment
      });

      if (this.vwapType === 'anchored' && this.anchorTimestamp) {
        params.append('anchor_timestamp', this.anchorTimestamp);
      }

      const url = `${API_BASE_URL}/api/vwap/${this.symbol}?${params}`;
      console.log(`[${this.symbol}] Fetching VWAP:`, url);

      const response = await fetch(url);
      const json = await response.json();

      if (json.success && json.data) {
        this.vwapData = json.data;

        // Create map for fast lookup by timestamp
        this.dataMap.clear();
        json.data.forEach(point => {
          this.dataMap.set(point.timestamp, point);
        });

        console.log(`[${this.symbol}] ✅ VWAP loaded: ${this.vwapData.length} points`);
        return true;
      } else {
        console.error(`[${this.symbol}] ❌ VWAP error:`, json.error);
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ VWAP fetch error:`, error);
      return false;
    } finally {
      this.loading = false;
    }
  }

  updateConfig(config) {
    let needsRefresh = false;

    if (config.vwapType !== undefined && config.vwapType !== this.vwapType) {
      this.vwapType = config.vwapType;
      needsRefresh = true;
    }

    if (config.resetHour !== undefined && config.resetHour !== this.resetHour) {
      this.resetHour = config.resetHour;
      needsRefresh = true;
    }

    if (config.anchorTimestamp !== undefined && config.anchorTimestamp !== this.anchorTimestamp) {
      this.anchorTimestamp = config.anchorTimestamp;
      needsRefresh = true;
    }

    if (config.rollingPeriod !== undefined && config.rollingPeriod !== this.rollingPeriod) {
      this.rollingPeriod = config.rollingPeriod;
      needsRefresh = true;
    }

    if (config.showBands !== undefined) {
      this.showBands = config.showBands;
    }

    if (config.bandMultipliers !== undefined) {
      this.bandMultipliers = config.bandMultipliers;
      needsRefresh = true;
    }

    if (config.applyCryptoAdjustment !== undefined && config.applyCryptoAdjustment !== this.applyCryptoAdjustment) {
      this.applyCryptoAdjustment = config.applyCryptoAdjustment;
      needsRefresh = true;
    }

    if (config.vwapColor) this.vwapColor = config.vwapColor;
    if (config.vwapLineWidth !== undefined) this.vwapLineWidth = config.vwapLineWidth;
    if (config.bandLineWidth !== undefined) this.bandLineWidth = config.bandLineWidth;
    if (config.bandColors) this.bandColors = config.bandColors;

    // Refresh data if configuration that affects calculation changed
    if (needsRefresh) {
      this.fetchData();
    }
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;
    if (this.vwapData.length === 0) return;

    const { x, y, width, height } = bounds;
    const viewport = priceContext || {};

    // Draw bands first (behind VWAP line)
    if (this.showBands) {
      this._drawBands(ctx, visibleCandles, viewport, x, y, width, height);
    }

    // Draw VWAP line
    this._drawVWAPLine(ctx, visibleCandles, viewport, x, y, width, height);
  }

  _drawVWAPLine(ctx, visibleCandles, viewport, x, y, width, height) {
    ctx.strokeStyle = this.vwapColor;
    ctx.lineWidth = this.vwapLineWidth;
    ctx.beginPath();

    let firstPoint = true;
    const candleWidth = width / visibleCandles.length;

    visibleCandles.forEach((candle, i) => {
      const vwapPoint = this.dataMap.get(candle.timestamp);
      if (!vwapPoint) return;

      const candleX = x + (i * candleWidth) + (candleWidth / 2);
      const vwapPrice = vwapPoint.vwap;

      // Convert price to Y coordinate using priceToY function if available
      let candleY;
      if (viewport.priceToY) {
        candleY = viewport.priceToY(vwapPrice);
      } else {
        // Fallback to manual calculation
        candleY = y + ((viewport.maxPrice - vwapPrice) / (viewport.maxPrice - viewport.minPrice)) * height;
      }

      if (firstPoint) {
        ctx.moveTo(candleX, candleY);
        firstPoint = false;
      } else {
        ctx.lineTo(candleX, candleY);
      }
    });

    ctx.stroke();
  }

  _drawBands(ctx, visibleCandles, viewport, x, y, width, height) {
    const bandLevels = ['band1', 'band2', 'band3'];

    bandLevels.forEach((bandLevel, bandIndex) => {
      const bandNumber = bandIndex + 1;
      const upperKey = `upper_${bandNumber}`;
      const lowerKey = `lower_${bandNumber}`;

      const bandColor = this.bandColors[bandLevel] || 'rgba(255, 152, 0, 0.1)';

      // Draw upper band
      ctx.strokeStyle = bandColor;
      ctx.lineWidth = this.bandLineWidth;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();

      let firstPoint = true;
      const candleWidth = width / visibleCandles.length;

      visibleCandles.forEach((candle, i) => {
        const vwapPoint = this.dataMap.get(candle.timestamp);
        if (!vwapPoint || !vwapPoint.bands) return;

        const candleX = x + (i * candleWidth) + (candleWidth / 2);
        const upperPrice = vwapPoint.bands[upperKey];

        if (upperPrice) {
          let candleY;
          if (viewport.priceToY) {
            candleY = viewport.priceToY(upperPrice);
          } else {
            candleY = y + ((viewport.maxPrice - upperPrice) / (viewport.maxPrice - viewport.minPrice)) * height;
          }

          if (firstPoint) {
            ctx.moveTo(candleX, candleY);
            firstPoint = false;
          } else {
            ctx.lineTo(candleX, candleY);
          }
        }
      });

      ctx.stroke();

      // Draw lower band
      ctx.beginPath();
      firstPoint = true;

      visibleCandles.forEach((candle, i) => {
        const vwapPoint = this.dataMap.get(candle.timestamp);
        if (!vwapPoint || !vwapPoint.bands) return;

        const candleX = x + (i * candleWidth) + (candleWidth / 2);
        const lowerPrice = vwapPoint.bands[lowerKey];

        if (lowerPrice) {
          let candleY;
          if (viewport.priceToY) {
            candleY = viewport.priceToY(lowerPrice);
          } else {
            candleY = y + ((viewport.maxPrice - lowerPrice) / (viewport.maxPrice - viewport.minPrice)) * height;
          }

          if (firstPoint) {
            ctx.moveTo(candleX, candleY);
            firstPoint = false;
          } else {
            ctx.lineTo(candleX, candleY);
          }
        }
      });

      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  // Get current VWAP data for pattern detection
  getCurrentData() {
    if (this.vwapData.length === 0) return null;

    const lastPoint = this.vwapData[this.vwapData.length - 1];
    return {
      vwap: lastPoint.vwap,
      bands: lastPoint.bands || {}
    };
  }

  // Get VWAP value at specific timestamp
  getVWAPAtTimestamp(timestamp) {
    const point = this.dataMap.get(timestamp);
    return point ? point.vwap : null;
  }

  // Get all VWAP levels for pattern detection
  getVWAPLevels() {
    if (this.vwapData.length === 0) return [];

    const lastPoint = this.vwapData[this.vwapData.length - 1];
    if (!lastPoint) return [];

    const levels = [
      { price: lastPoint.vwap, type: 'vwap', strength: 90 }
    ];

    // Add band levels if available
    if (lastPoint.bands) {
      Object.keys(lastPoint.bands).forEach(key => {
        const price = lastPoint.bands[key];
        const bandNum = key.includes('1') ? 1 : key.includes('2') ? 2 : 3;
        const strength = bandNum === 1 ? 70 : bandNum === 2 ? 85 : 95;

        levels.push({
          price,
          type: `vwap_${key}`,
          strength
        });
      });
    }

    return levels;
  }
}

export default VWAPIndicator;
