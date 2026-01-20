// src/components/indicators/VWAPIndicator.js
// VWAP Indicator - 100% Backend Native
// All calculations done by backend VWAPService, frontend only renders

import IndicatorBase from "./IndicatorBase.js";
import { API_BASE_URL } from "../../config.js";
import Logger from '../../utils/Logger.js';
import IndicatorCache from '../../utils/IndicatorCache.js';

const log = new Logger('VWAP', { level: 'info' });

class VWAPIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 1, config = {}) {
    super(symbol, interval, days);
    this.name = "VWAP";
    this.height = 0; // Overlay on main chart

    // Backend polling
    this.lastFetchTime = 0;
    this.fetchIntervalMs = this._getFetchIntervalForTimeframe(interval);

    // VWAP calculation config (sent to backend)
    this.vwapType = config.vwapType || 'session';
    this.rollingPeriod = config.rollingPeriod || 200;

    // Visual configuration (frontend only)
    this.vwapColor = config.vwapColor || 'rgba(255, 152, 0, 0.8)';
    this.vwapLineWidth = config.vwapLineWidth || 2;
    this.bandLineWidth = config.bandLineWidth || 1;
    this.bandColors = config.bandColors || {
      band1: 'rgba(255, 152, 0, 0.3)',
      band2: 'rgba(255, 152, 0, 0.2)',
      band3: 'rgba(255, 152, 0, 0.1)'
    };

    // Volatility bar visualization
    this.volatilityBarHeight = config.volatilityBarHeight || 8;
    this.showBandWidth = config.showBandWidth !== undefined ? config.showBandWidth : false;
    this.showBBWP = config.showBBWP !== undefined ? config.showBBWP : false;
    this.showTTMSqueeze = config.showTTMSqueeze !== undefined ? config.showTTMSqueeze : false;
    this.showBands = config.showBands !== undefined ? config.showBands : true;

    // Data from backend
    this.vwapData = [];
    this.dataMap = new Map();

    // Lifecycle flag to prevent fetch after destroy
    this._destroyed = false;
    this._pollingInterval = null;

    log.info(`[${symbol}] VWAPIndicator initialized (backend native, type=${this.vwapType})`);
  }

  // Cleanup method called when indicator is destroyed
  destroy() {
    this._destroyed = true;
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
    log.debug(`[${this.symbol}] VWAPIndicator destroyed`);
  }

  _startPolling() {
    // Clear any existing interval
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
    }

    // Poll at configured interval
    this._pollingInterval = setInterval(() => {
      if (this.enabled && !this._destroyed) {
        this.fetchData();
      }
    }, this.fetchIntervalMs);
  }

  _getFetchIntervalForTimeframe(interval) {
    const intervalMs = {
      '1': 60 * 1000,
      '3': 3 * 60 * 1000,
      '5': 5 * 60 * 1000,
      '15': 60 * 1000,
      '30': 60 * 1000,
      '60': 60 * 1000,
      '240': 60 * 1000,
      'D': 60 * 1000,
    };
    return intervalMs[interval] || 60 * 1000;
  }

  async fetchData() {
    // Don't fetch if indicator was destroyed (component unmounted)
    if (this._destroyed) {
      log.debug(`[${this.symbol}] Skipping VWAP fetch - indicator destroyed`);
      return false;
    }

    this.loading = true;
    try {
      // 🔄 FASE 4: Verificar cache primero
      const cacheParams = { vwapType: this.vwapType, days: this.days };
      const cached = await IndicatorCache.get('vwap', this.symbol, this.interval, cacheParams);
      if (cached && !this._destroyed) {
        this.vwapData = [];
        this.dataMap.clear();
        cached.forEach(point => {
          this.dataMap.set(point.timestamp, point);
        });
        this.lastFetchTime = Date.now();
        if (!this._pollingInterval) {
          this._startPolling();
        }
        log.debug(`[${this.symbol}] ✅ VWAP from cache: ${cached.length} points`);
        return true;
      }

      // Pass all config to backend
      const params = new URLSearchParams({
        days: this.days,
        interval: this.interval,
        vwapType: this.vwapType,
        rollingPeriod: this.rollingPeriod
      });
      const url = `${API_BASE_URL}/api/vwap-service/data/${this.symbol}?${params}`;
      log.debug(`[${this.symbol}] Fetching VWAP: interval=${this.interval}, days=${this.days}`);
      const response = await fetch(url);

      // Check again after await - component might have been destroyed
      if (this._destroyed) {
        log.debug(`[${this.symbol}] Discarding VWAP response - indicator destroyed during fetch`);
        return false;
      }

      const json = await response.json();

      if (json.success && json.data) {
        // 🚀 OPTIMIZACIÓN: Solo usar dataMap, no duplicar en vwapData
        // Antes guardaba en ambos (2x memoria)
        this.vwapData = []; // Mantener vacío para compatibilidad
        this.dataMap.clear();
        json.data.forEach(point => {
          this.dataMap.set(point.timestamp, point);
        });
        this.lastFetchTime = Date.now();

        // Guardar en cache
        IndicatorCache.set('vwap', this.symbol, this.interval, json.data, cacheParams);

        // 🚀 Start polling only on first successful fetch
        if (!this._pollingInterval) {
          this._startPolling();
        }

        log.debug(`[${this.symbol}] ✅ VWAP loaded: ${json.data.length} points (${this.vwapType}, ${this.days} days, interval=${this.interval})`);
        return true;
      } else {
        log.warn(`[${this.symbol}] VWAP service returned no data`);
        return false;
      }
    } catch (error) {
      if (!this._destroyed) {
        log.error(`[${this.symbol}] ❌ VWAP fetch error:`, error);
      }
      return false;
    } finally {
      this.loading = false;
    }
  }

  // Update days and refetch data if needed
  setDays(days) {
    if (this.days !== days) {
      this.days = days;
      this.lastFetchTime = 0; // Force refetch on next render
      log.info(`[${this.symbol}] Days updated to ${days}, will refetch VWAP data`);
    }
  }

  // Update interval and refetch data if needed
  setInterval(newInterval) {
    if (this.interval !== newInterval) {
      log.info(`[${this.symbol}] Interval updated: ${this.interval} → ${newInterval}`);
      this.interval = newInterval;
      this.fetchIntervalMs = this._getFetchIntervalForTimeframe(newInterval);
      this.lastFetchTime = 0; // Force refetch on next render
      this.vwapData = []; // Clear old data to avoid mixing timeframes
      this.dataMap.clear();
    }
  }

  async fetchBackendStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/vwap-service/status`);
      const json = await response.json();
      return json.success ? json : null;
    } catch (error) {
      log.error(`[${this.symbol}] ❌ VWAP status error:`, error);
      return null;
    }
  }

  async updateBackendConfig(config) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/vwap-service/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const json = await response.json();
      if (json.success) {
        log.info(`[${this.symbol}] Backend config updated`);
        return true;
      }
    } catch (error) {
      log.error(`[${this.symbol}] ❌ Backend config error:`, error);
    }
    return false;
  }

  updateConfig(config) {
    let needsRefetch = false;

    // VWAP calculation config (triggers refetch if changed)
    if (config.vwapType !== undefined && config.vwapType !== this.vwapType) {
      this.vwapType = config.vwapType;
      needsRefetch = true;
    }
    if (config.rollingPeriod !== undefined && config.rollingPeriod !== this.rollingPeriod) {
      this.rollingPeriod = config.rollingPeriod;
      needsRefetch = true;
    }

    // Visual config only
    if (config.vwapColor) this.vwapColor = config.vwapColor;
    if (config.vwapLineWidth !== undefined) this.vwapLineWidth = config.vwapLineWidth;
    if (config.bandLineWidth !== undefined) this.bandLineWidth = config.bandLineWidth;
    if (config.bandColors) this.bandColors = config.bandColors;
    if (config.volatilityBarHeight !== undefined) this.volatilityBarHeight = config.volatilityBarHeight;
    if (config.showBandWidth !== undefined) this.showBandWidth = config.showBandWidth;
    if (config.showBBWP !== undefined) this.showBBWP = config.showBBWP;
    if (config.showTTMSqueeze !== undefined) this.showTTMSqueeze = config.showTTMSqueeze;
    if (config.showBands !== undefined) this.showBands = config.showBands;

    // Refetch if calculation config changed
    if (needsRefetch && this.enabled) {
      log.info(`[${this.symbol}] Config changed (vwapType=${this.vwapType}), refetching...`);
      this.lastFetchTime = 0;
      this.fetchData();
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.fetchData();
    }
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || this._destroyed || !visibleCandles || visibleCandles.length === 0) return;

    // 🚀 OPTIMIZADO: Polling se hace via setInterval en _startPolling()
    // Esto elimina Date.now() y comparaciones en cada frame (~60 veces/segundo)

    // Need data from backend
    if (this.dataMap.size === 0) return;

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

      let candleY;
      if (viewport.priceToY) {
        candleY = viewport.priceToY(vwapPrice);
      } else {
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
    const candleWidth = width / visibleCandles.length;

    bandLevels.forEach((bandLevel, bandIndex) => {
      const bandNumber = bandIndex + 1;
      const upperKey = `upper_${bandNumber}`;
      const lowerKey = `lower_${bandNumber}`;
      const bandColor = this.bandColors[bandLevel] || 'rgba(255, 152, 0, 0.1)';

      ctx.strokeStyle = bandColor;
      ctx.lineWidth = this.bandLineWidth;
      ctx.setLineDash([3, 3]);

      // Draw upper band
      ctx.beginPath();
      let firstPoint = true;

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

  // Render volatility bars below volume panel
  renderVolatilityBars(ctx, x, startY, width, candleWidth, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return 0;

    const barHeight = this.volatilityBarHeight;
    const barGap = 2;

    let activeBarCount = 0;
    if (this.showBandWidth) activeBarCount++;
    if (this.showBBWP) activeBarCount++;
    if (this.showTTMSqueeze) activeBarCount++;

    if (activeBarCount === 0) return 0;

    let currentY = startY;

    if (this.showBandWidth) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'bandwidth');
      currentY += barHeight + barGap;
    }

    if (this.showBBWP) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'bbwp');
      currentY += barHeight + barGap;
    }

    if (this.showTTMSqueeze) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'ttm');
    }

    return (barHeight * activeBarCount) + (barGap * (activeBarCount - 1));
  }

  _drawSingleVolatilityBar(ctx, visibleCandles, x, barY, width, candleWidth, barHeight, indicatorType) {
    const fontSize = Math.min(12, Math.max(8, Math.floor(barHeight * 0.6)));

    visibleCandles.forEach((candle, i) => {
      const point = this.dataMap.get(candle.timestamp);
      if (!point) return;

      const candleX = x + (i * candleWidth);
      let barColor = 'rgba(128, 128, 128, 0.3)';

      if (indicatorType === 'bandwidth' && point.bandwidth_state) {
        const state = point.bandwidth_state;
        if (state === 'squeeze') barColor = 'rgba(0, 150, 0, 0.9)';
        else if (state === 'consolidation') barColor = 'rgba(255, 193, 7, 0.85)';
        else if (state === 'normal') barColor = 'rgba(255, 152, 0, 0.85)';
        else if (state === 'trending') barColor = 'rgba(220, 0, 0, 0.9)';
      } else if (indicatorType === 'bbwp' && point.bbwp_state) {
        const state = point.bbwp_state;
        if (state === 'squeeze') barColor = 'rgba(0, 150, 0, 0.9)';
        else if (state === 'normal') barColor = 'rgba(255, 193, 7, 0.85)';
        else if (state === 'trending') barColor = 'rgba(220, 0, 0, 0.9)';
      } else if (indicatorType === 'ttm' && point.squeeze_state) {
        const state = point.squeeze_state;
        if (state === 'on') barColor = 'rgba(0, 150, 0, 0.9)';
        else barColor = 'rgba(255, 193, 7, 0.85)';
      }

      ctx.fillStyle = barColor;
      ctx.fillRect(candleX, barY, candleWidth, barHeight);

      if (i > 0) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(candleX, barY);
        ctx.lineTo(candleX, barY + barHeight);
        ctx.stroke();
      }
    });

    // Draw label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 2;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textBaseline = 'middle';

    let label = '';
    if (indicatorType === 'bandwidth') label = 'BW';
    else if (indicatorType === 'bbwp') label = 'BBWP';
    else if (indicatorType === 'ttm') label = 'TTM';

    const labelX = x - 35;
    const labelY = barY + (barHeight / 2);

    ctx.strokeText(label, labelX, labelY);
    ctx.fillText(label, labelX, labelY);
  }

  // Public API for other components
  getCurrentData() {
    if (this.vwapData.length === 0) return null;
    const lastPoint = this.vwapData[this.vwapData.length - 1];
    return {
      vwap: lastPoint.vwap,
      bands: lastPoint.bands || {}
    };
  }

  getVWAPAtTimestamp(timestamp) {
    const point = this.dataMap.get(timestamp);
    return point ? point.vwap : null;
  }

  getVWAPLevels() {
    if (this.vwapData.length === 0) return [];

    const lastPoint = this.vwapData[this.vwapData.length - 1];
    if (!lastPoint) return [];

    const levels = [{ price: lastPoint.vwap, type: 'vwap', strength: 90 }];

    if (lastPoint.bands) {
      Object.keys(lastPoint.bands).forEach(key => {
        const price = lastPoint.bands[key];
        const bandNum = key.includes('1') ? 1 : key.includes('2') ? 2 : 3;
        const strength = bandNum === 1 ? 70 : bandNum === 2 ? 85 : 95;
        levels.push({ price, type: `vwap_${key}`, strength });
      });
    }

    return levels;
  }

  getDeviations() {
    if (!this.vwapData || this.vwapData.length === 0) return null;

    const latest = this.vwapData[this.vwapData.length - 1];
    if (!latest || !latest.bands) return null;

    return {
      vwap: latest.vwap,
      upper1: latest.bands.upper_1,
      upper2: latest.bands.upper_2,
      upper3: latest.bands.upper_3,
      lower1: latest.bands.lower_1,
      lower2: latest.bands.lower_2,
      lower3: latest.bands.lower_3
    };
  }

  getDeviationsAtTimestamp(timestamp) {
    if (!this.dataMap || this.dataMap.size === 0) return null;

    let point = this.dataMap.get(timestamp);

    if (!point && this.vwapData && this.vwapData.length > 0) {
      for (let i = this.vwapData.length - 1; i >= 0; i--) {
        if (this.vwapData[i].timestamp <= timestamp) {
          point = this.vwapData[i];
          break;
        }
      }
    }

    if (!point || !point.bands) return null;

    return {
      vwap: point.vwap,
      upper1: point.bands.upper_1,
      upper2: point.bands.upper_2,
      upper3: point.bands.upper_3,
      lower1: point.bands.lower_1,
      lower2: point.bands.lower_2,
      lower3: point.bands.lower_3
    };
  }
}

export default VWAPIndicator;
