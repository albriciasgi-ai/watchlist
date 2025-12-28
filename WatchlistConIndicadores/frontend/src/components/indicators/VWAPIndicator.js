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

    // Auto-refresh timer para actualizar VWAP periódicamente
    this.refreshInterval = null;
    this.refreshIntervalMs = 30000; // 30 segundos
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

        // Iniciar auto-refresh si no está activo
        this.startAutoRefresh();

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

  startAutoRefresh() {
    // Detener timer anterior si existe
    this.stopAutoRefresh();

    // Iniciar nuevo timer
    this.refreshInterval = setInterval(() => {
      if (this.enabled && !this.loading) {
        console.log(`[${this.symbol}] 🔄 Auto-refreshing VWAP...`);
        this.fetchData();
      }
    }, this.refreshIntervalMs);

    console.log(`[${this.symbol}] ⏰ VWAP auto-refresh started (every ${this.refreshIntervalMs/1000}s)`);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log(`[${this.symbol}] ⏹️ VWAP auto-refresh stopped`);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;

    if (!enabled) {
      // Detener auto-refresh cuando se deshabilita
      this.stopAutoRefresh();
    } else {
      // Recargar y reiniciar auto-refresh cuando se habilita
      this.fetchData();
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

  // ✅ NUEVO: Calcular VWAP en tiempo real desde las velas
  calculateVWAP(candles) {
    if (!candles || candles.length === 0) return [];

    const vwapData = [];

    if (this.vwapType === 'session') {
      return this._calculateSessionVWAP(candles);
    } else if (this.vwapType === 'rolling') {
      return this._calculateRollingVWAP(candles);
    } else if (this.vwapType === 'anchored') {
      return this._calculateAnchoredVWAP(candles);
    }

    return vwapData;
  }

  _calculateSessionVWAP(candles) {
    const vwapData = [];
    let cumulativePV = 0;
    let cumulativeVolume = 0;
    let sessionStartTimestamp = null;

    for (const candle of candles) {
      const candleDate = new Date(candle.timestamp);
      const hourUTC = candleDate.getUTCHours();

      // Reset on new session
      if (sessionStartTimestamp === null || hourUTC === this.resetHour) {
        if (sessionStartTimestamp === null) {
          cumulativePV = 0;
          cumulativeVolume = 0;
          sessionStartTimestamp = candle.timestamp;
        } else {
          const timeSinceSession = candle.timestamp - sessionStartTimestamp;
          if (timeSinceSession >= (23 * 60 * 60 * 1000)) {
            cumulativePV = 0;
            cumulativeVolume = 0;
            sessionStartTimestamp = candle.timestamp;
          }
        }
      }

      // Calculate typical price
      const typicalPrice = (candle.high + candle.low + candle.close) / 3.0;
      const volume = candle.volume;

      cumulativePV += typicalPrice * volume;
      cumulativeVolume += volume;

      const vwap = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : typicalPrice;

      vwapData.push({
        timestamp: candle.timestamp,
        vwap: vwap,
        typical_price: typicalPrice,
        volume: volume
      });
    }

    return vwapData;
  }

  _calculateRollingVWAP(candles) {
    const vwapData = [];
    const period = this.rollingPeriod;

    for (let i = 0; i < candles.length; i++) {
      const startIdx = Math.max(0, i - period + 1);
      const window = candles.slice(startIdx, i + 1);

      let cumulativePV = 0;
      let cumulativeVolume = 0;

      for (const candle of window) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3.0;
        const volume = candle.volume;
        cumulativePV += typicalPrice * volume;
        cumulativeVolume += volume;
      }

      const currentCandle = candles[i];
      const currentTypicalPrice = (currentCandle.high + currentCandle.low + currentCandle.close) / 3.0;
      const vwap = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : currentTypicalPrice;

      vwapData.push({
        timestamp: currentCandle.timestamp,
        vwap: vwap,
        typical_price: currentTypicalPrice,
        volume: currentCandle.volume
      });
    }

    return vwapData;
  }

  _calculateAnchoredVWAP(candles) {
    const vwapData = [];

    // Find anchor index
    let anchorIndex = 0;
    if (this.anchorTimestamp) {
      for (let i = 0; i < candles.length; i++) {
        if (candles[i].timestamp >= this.anchorTimestamp) {
          anchorIndex = i;
          break;
        }
      }
    }

    let cumulativePV = 0;
    let cumulativeVolume = 0;

    for (let i = anchorIndex; i < candles.length; i++) {
      const candle = candles[i];
      const typicalPrice = (candle.high + candle.low + candle.close) / 3.0;
      const volume = candle.volume;

      cumulativePV += typicalPrice * volume;
      cumulativeVolume += volume;

      const vwap = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : typicalPrice;

      vwapData.push({
        timestamp: candle.timestamp,
        vwap: vwap,
        typical_price: typicalPrice,
        volume: volume
      });
    }

    return vwapData;
  }

  // ✅ Calcular bandas de desviación estándar
  _calculateStdBands(candles, vwapData) {
    if (candles.length !== vwapData.length) return vwapData;

    // Aplicar ajuste de crypto a los multiplicadores si está habilitado
    const cryptoAdjustment = this.applyCryptoAdjustment ? 1.15 : 1.0;
    const adjustedMultipliers = this.bandMultipliers.map(m => m * cryptoAdjustment);

    for (let i = 0; i < vwapData.length; i++) {
      const vwapPoint = vwapData[i];
      const vwapValue = vwapPoint.vwap;

      // Determinar ventana según tipo de VWAP
      let windowCandles;
      if (this.vwapType === 'rolling') {
        const startIdx = Math.max(0, i - this.rollingPeriod + 1);
        windowCandles = candles.slice(startIdx, i + 1);
      } else if (this.vwapType === 'session') {
        // Para session, buscar desde el inicio de la sesión
        let sessionStartIdx = 0;
        for (let j = i; j >= 0; j--) {
          const candleDate = new Date(candles[j].timestamp);
          const hourUTC = candleDate.getUTCHours();
          if (hourUTC === this.resetHour && j < i) {
            const timeDiff = candles[i].timestamp - candles[j].timestamp;
            if (timeDiff >= (23 * 60 * 60 * 1000)) {
              sessionStartIdx = j;
              break;
            }
          }
        }
        windowCandles = candles.slice(sessionStartIdx, i + 1);
      } else {
        // Anchored: desde inicio hasta actual
        windowCandles = candles.slice(0, i + 1);
      }

      if (windowCandles.length < 2) {
        // No hay suficientes datos para calcular varianza
        vwapPoint.bands = {};
        adjustedMultipliers.forEach((_, idx) => {
          vwapPoint.bands[`upper_${idx + 1}`] = vwapValue;
          vwapPoint.bands[`lower_${idx + 1}`] = vwapValue;
        });
        continue;
      }

      // Calcular varianza ponderada
      let totalWeightedSqDiff = 0;
      let totalVolume = 0;

      for (const candle of windowCandles) {
        const typicalPrice = (candle.high + candle.low + candle.close) / 3.0;
        const volume = candle.volume;
        const sqDiff = Math.pow(typicalPrice - vwapValue, 2);
        totalWeightedSqDiff += sqDiff * volume;
        totalVolume += volume;
      }

      // Desviación estándar
      const variance = totalVolume > 0 ? totalWeightedSqDiff / totalVolume : 0;
      const stdDev = Math.sqrt(variance);

      // Crear bandas
      vwapPoint.bands = {};
      adjustedMultipliers.forEach((mult, idx) => {
        vwapPoint.bands[`upper_${idx + 1}`] = vwapValue + (stdDev * mult);
        vwapPoint.bands[`lower_${idx + 1}`] = vwapValue - (stdDev * mult);
      });
    }

    return vwapData;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;

    // ✅ Calcular VWAP en tiempo real desde TODAS las velas
    let calculatedVWAP = this.calculateVWAP(allCandles);

    if (calculatedVWAP.length === 0) return;

    // ✅ Calcular bandas de desviación estándar
    if (this.showBands) {
      calculatedVWAP = this._calculateStdBands(allCandles, calculatedVWAP);
    }

    // Actualizar dataMap con los datos calculados
    this.dataMap.clear();
    calculatedVWAP.forEach(point => {
      this.dataMap.set(point.timestamp, point);
    });

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
