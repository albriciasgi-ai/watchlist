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

    // Volatility Indicators Configuration
    this.showBandWidth = config.showBandWidth !== undefined ? config.showBandWidth : false;
    this.showBBWP = config.showBBWP !== undefined ? config.showBBWP : false;
    this.showTTMSqueeze = config.showTTMSqueeze !== undefined ? config.showTTMSqueeze : false;

    // BandWidth thresholds (%) - Adaptive by timeframe
    this.bandWidthThresholds = config.bandWidthThresholds || this._getDefaultBandWidthThresholds(interval);

    // Log thresholds for debugging
    console.log(`[${symbol}] BandWidth thresholds for ${interval}:`, this.bandWidthThresholds);

    // BBWP configuration
    this.bbwpLookback = config.bbwpLookback || 252; // 1 year of daily candles
    this.bbwpThresholds = config.bbwpThresholds || {
      squeeze: 20,  // < 20%: Squeeze
      normal: 80    // 20-80%: Normal, >80%: Trending
    };

    // TTM Squeeze configuration
    this.ttmATRLength = config.ttmATRLength || 20;
    this.ttmATRMultiplier = config.ttmATRMultiplier || 1.5;

    // Volatility bar visualization
    this.volatilityBarHeight = config.volatilityBarHeight || 8;

    // Data
    this.vwapData = [];
    this.dataMap = new Map();

    // Volatility state tracking
    this.volatilityStateChanges = [];
    this.lastBandWidthState = null;
    this.lastBBWPState = null;
    this.lastSqueezeState = null;

    // Auto-refresh timer para actualizar VWAP periódicamente
    this.refreshInterval = null;
    this.refreshIntervalMs = 30000; // 30 segundos
  }

  // Get default BandWidth thresholds based on timeframe
  _getDefaultBandWidthThresholds(interval) {
    // Timeframes cortos tienen BandWidth mucho más alto debido a mayor volatilidad intradiaria
    const thresholdsByTimeframe = {
      // Ultra-short (scalping): bandas muy amplias
      '1': { squeeze: 8, consolidation: 12, normal: 18 },    // 1 min
      '3': { squeeze: 6, consolidation: 10, normal: 15 },    // 3 min
      '5': { squeeze: 5, consolidation: 8, normal: 12 },     // 5 min

      // Short-term (intraday): bandas moderadas
      '15': { squeeze: 3.5, consolidation: 6, normal: 10 },  // 15 min
      '30': { squeeze: 3, consolidation: 5, normal: 8 },     // 30 min
      '60': { squeeze: 2.5, consolidation: 4.5, normal: 7 }, // 1 hora

      // Medium-term (swing): bandas estándar
      '240': { squeeze: 2, consolidation: 4, normal: 6 },    // 4 horas
      'D': { squeeze: 1.5, consolidation: 3, normal: 5 },    // Diario

      // Long-term (position): bandas estrechas
      'W': { squeeze: 1, consolidation: 2, normal: 4 }       // Semanal
    };

    return thresholdsByTimeframe[interval] || { squeeze: 2, consolidation: 5, normal: 10 };
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

    // Volatility indicators configuration
    if (config.showBandWidth !== undefined) this.showBandWidth = config.showBandWidth;
    if (config.showBBWP !== undefined) this.showBBWP = config.showBBWP;
    if (config.showTTMSqueeze !== undefined) this.showTTMSqueeze = config.showTTMSqueeze;

    if (config.bandWidthThresholds) this.bandWidthThresholds = config.bandWidthThresholds;
    if (config.bbwpLookback !== undefined) this.bbwpLookback = config.bbwpLookback;
    if (config.bbwpThresholds) this.bbwpThresholds = config.bbwpThresholds;
    if (config.ttmATRLength !== undefined) this.ttmATRLength = config.ttmATRLength;
    if (config.ttmATRMultiplier !== undefined) this.ttmATRMultiplier = config.ttmATRMultiplier;
    if (config.volatilityBarHeight !== undefined) this.volatilityBarHeight = config.volatilityBarHeight;

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

  // ✅ Calculate ATR (Average True Range) for TTM Squeeze
  _calculateATR(candles, length = 20) {
    if (!candles || candles.length < length) return [];

    const atrData = [];
    const trueRanges = [];

    // Calculate True Range for each candle
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      let tr;

      if (i === 0) {
        // First candle: TR = High - Low
        tr = candle.high - candle.low;
      } else {
        // TR = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
        const prevClose = candles[i - 1].close;
        tr = Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - prevClose),
          Math.abs(candle.low - prevClose)
        );
      }

      trueRanges.push(tr);

      // Calculate ATR using simple moving average of TR
      if (i >= length - 1) {
        const sum = trueRanges.slice(i - length + 1, i + 1).reduce((a, b) => a + b, 0);
        const atr = sum / length;
        atrData.push({
          timestamp: candle.timestamp,
          atr: atr
        });
      } else {
        // Not enough data yet, use current TR
        atrData.push({
          timestamp: candle.timestamp,
          atr: tr
        });
      }
    }

    return atrData;
  }

  // ✅ Calculate BandWidth (volatility measure)
  _calculateBandWidth(vwapData) {
    if (!vwapData || vwapData.length === 0) return [];

    const bandWidthData = [];

    for (let i = 0; i < vwapData.length; i++) {
      const point = vwapData[i];

      if (!point.bands || !point.bands.upper_1 || !point.bands.lower_1) {
        bandWidthData.push({
          timestamp: point.timestamp,
          bandwidth: 0,
          state: 'unknown'
        });
        continue;
      }

      // BandWidth = (Upper Band - Lower Band) / VWAP * 100
      const upperBand = point.bands.upper_1; // Use first band (1 std dev)
      const lowerBand = point.bands.lower_1;
      const vwap = point.vwap;

      const bandwidth = vwap > 0 ? ((upperBand - lowerBand) / vwap) * 100 : 0;

      // Determine state based on thresholds
      let state;
      if (bandwidth < this.bandWidthThresholds.squeeze) {
        state = 'squeeze';
      } else if (bandwidth < this.bandWidthThresholds.consolidation) {
        state = 'consolidation';
      } else if (bandwidth < this.bandWidthThresholds.normal) {
        state = 'normal';
      } else {
        state = 'trending';
      }

      bandWidthData.push({
        timestamp: point.timestamp,
        bandwidth: bandwidth,
        state: state
      });

      // Track state changes
      if (this.lastBandWidthState && this.lastBandWidthState !== state) {
        this.volatilityStateChanges.push({
          type: 'bandwidth',
          timestamp: point.timestamp,
          from: this.lastBandWidthState,
          to: state,
          value: bandwidth
        });
      }
      this.lastBandWidthState = state;
    }

    return bandWidthData;
  }

  // ✅ Calculate BBWP (BandWidth Percentile)
  _calculateBBWP(bandWidthData) {
    if (!bandWidthData || bandWidthData.length === 0) return [];

    const bbwpData = [];
    const lookback = Math.min(this.bbwpLookback, bandWidthData.length);

    for (let i = 0; i < bandWidthData.length; i++) {
      const currentBW = bandWidthData[i].bandwidth;

      // Get historical window
      const startIdx = Math.max(0, i - lookback + 1);
      const historicalBWs = bandWidthData.slice(startIdx, i + 1).map(d => d.bandwidth);

      // Count how many historical BWs are less than current BW
      const countBelow = historicalBWs.filter(bw => bw < currentBW).length;
      const total = historicalBWs.length;

      // Calculate percentile (0-100)
      const percentile = total > 0 ? (countBelow / total) * 100 : 0;

      // Determine state based on thresholds
      let state;
      if (percentile < this.bbwpThresholds.squeeze) {
        state = 'squeeze';
      } else if (percentile < this.bbwpThresholds.normal) {
        state = 'normal';
      } else {
        state = 'trending';
      }

      bbwpData.push({
        timestamp: bandWidthData[i].timestamp,
        percentile: percentile,
        state: state
      });

      // Track state changes
      if (this.lastBBWPState && this.lastBBWPState !== state) {
        this.volatilityStateChanges.push({
          type: 'bbwp',
          timestamp: bandWidthData[i].timestamp,
          from: this.lastBBWPState,
          to: state,
          value: percentile
        });
      }
      this.lastBBWPState = state;
    }

    return bbwpData;
  }

  // ✅ Calculate TTM Squeeze (Bollinger Bands inside Keltner Channels)
  _calculateTTMSqueeze(candles, vwapData) {
    if (!candles || !vwapData || candles.length === 0 || vwapData.length === 0) return [];

    const squeezeData = [];

    // Calculate ATR for Keltner Channels
    const atrData = this._calculateATR(candles, this.ttmATRLength);

    for (let i = 0; i < vwapData.length; i++) {
      const point = vwapData[i];
      const atrPoint = atrData[i];

      if (!point.bands || !atrPoint) {
        squeezeData.push({
          timestamp: point.timestamp,
          squeeze: false,
          state: 'off'
        });
        continue;
      }

      // Bollinger Bands (VWAP Std Dev Bands) - using first multiplier
      const bbUpper = point.bands.upper_1;
      const bbLower = point.bands.lower_1;

      // Keltner Channels: VWAP +/- (ATR * multiplier)
      const kcUpper = point.vwap + (atrPoint.atr * this.ttmATRMultiplier);
      const kcLower = point.vwap - (atrPoint.atr * this.ttmATRMultiplier);

      // Squeeze ON when Bollinger Bands are inside Keltner Channels
      const squeeze = (bbUpper < kcUpper) && (bbLower > kcLower);
      const state = squeeze ? 'on' : 'off';

      squeezeData.push({
        timestamp: point.timestamp,
        squeeze: squeeze,
        state: state,
        bbUpper: bbUpper,
        bbLower: bbLower,
        kcUpper: kcUpper,
        kcLower: kcLower
      });

      // Track state changes
      if (this.lastSqueezeState !== null && this.lastSqueezeState !== state) {
        this.volatilityStateChanges.push({
          type: 'ttm_squeeze',
          timestamp: point.timestamp,
          from: this.lastSqueezeState,
          to: state,
          value: squeeze
        });
      }
      this.lastSqueezeState = state;
    }

    return squeezeData;
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

    // ✅ Calcular indicadores de volatilidad si están habilitados
    let bandWidthData = [];
    let bbwpData = [];
    let squeezeData = [];

    // Reset state change tracking for new calculation
    this.volatilityStateChanges = [];
    this.lastBandWidthState = null;
    this.lastBBWPState = null;
    this.lastSqueezeState = null;

    if (this.showBandWidth && this.showBands) {
      bandWidthData = this._calculateBandWidth(calculatedVWAP);
    }

    if (this.showBBWP && this.showBandWidth && this.showBands) {
      bbwpData = this._calculateBBWP(bandWidthData);
    }

    if (this.showTTMSqueeze && this.showBands) {
      squeezeData = this._calculateTTMSqueeze(allCandles, calculatedVWAP);
    }

    // Actualizar dataMap con los datos calculados
    this.dataMap.clear();
    calculatedVWAP.forEach((point, i) => {
      // Add volatility data to each point
      if (bandWidthData[i]) {
        point.bandwidth = bandWidthData[i].bandwidth;
        point.bandwidthState = bandWidthData[i].state;
      }
      if (bbwpData[i]) {
        point.bbwp = bbwpData[i].percentile;
        point.bbwpState = bbwpData[i].state;
      }
      if (squeezeData[i]) {
        point.squeeze = squeezeData[i].squeeze;
        point.squeezeState = squeezeData[i].state;
      }

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

    // NOTE: Volatility indicators are now drawn separately from MiniChart
    // after the volume panel to avoid confusion
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

  // ✅ Public method to render volatility bars below volume panel
  renderVolatilityBars(ctx, x, startY, width, candleWidth, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return;

    const barHeight = this.volatilityBarHeight;
    const barGap = 2; // Gap between bars

    // Calculate total height needed for all active bars
    let activeBarCount = 0;
    if (this.showBandWidth) activeBarCount++;
    if (this.showBBWP) activeBarCount++;
    if (this.showTTMSqueeze) activeBarCount++;

    if (activeBarCount === 0) return; // No bars to draw

    let currentY = startY;

    // Draw BandWidth bar (if enabled)
    if (this.showBandWidth) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'bandwidth');
      currentY += barHeight + barGap;
    }

    // Draw BBWP bar (if enabled)
    if (this.showBBWP) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'bbwp');
      currentY += barHeight + barGap;
    }

    // Draw TTM Squeeze bar (if enabled)
    if (this.showTTMSqueeze) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'ttm');
    }

    // Return the total height used
    return (barHeight * activeBarCount) + (barGap * (activeBarCount - 1));
  }

  // ✅ Draw volatility indicators as 3 separate horizontal bars (BandWidth, BBWP, TTM Squeeze)
  // DEPRECATED: This method is now only called from renderVolatilityBars
  _drawVolatilityIndicators(ctx, bounds, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return;

    const { x, y, width, height } = bounds;
    const candleWidth = width / visibleCandles.length;
    const barHeight = this.volatilityBarHeight;
    const barGap = 2; // Gap between bars

    // Calculate total height needed for all active bars
    let activeBarCount = 0;
    if (this.showBandWidth) activeBarCount++;
    if (this.showBBWP) activeBarCount++;
    if (this.showTTMSqueeze) activeBarCount++;

    const totalBarsHeight = (barHeight * activeBarCount) + (barGap * (activeBarCount - 1));

    // Start position: at the bottom of the chart area, going upwards
    let currentY = y + height - totalBarsHeight - 5; // 5px margin from bottom

    // Scale font size based on bar height (min 8px, max 12px)
    const fontSize = Math.min(12, Math.max(8, Math.floor(barHeight * 0.6)));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';

    // Draw BandWidth bar (if enabled)
    if (this.showBandWidth) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'bandwidth');
      currentY += barHeight + barGap;
    }

    // Draw BBWP bar (if enabled)
    if (this.showBBWP) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'bbwp');
      currentY += barHeight + barGap;
    }

    // Draw TTM Squeeze bar (if enabled)
    if (this.showTTMSqueeze) {
      this._drawSingleVolatilityBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, 'ttm');
    }

    // Draw current state indicators at the top left (unchanged)
    this._drawCurrentStateIndicators(ctx, bounds);
  }

  // Helper: Draw a single volatility indicator bar
  _drawSingleVolatilityBar(ctx, visibleCandles, x, barY, width, candleWidth, barHeight, indicatorType) {
    const fontSize = Math.min(12, Math.max(8, Math.floor(barHeight * 0.6)));

    // Draw bar segments for each candle
    visibleCandles.forEach((candle, i) => {
      const point = this.dataMap.get(candle.timestamp);
      if (!point) return;

      const candleX = x + (i * candleWidth);
      let barColor = 'rgba(128, 128, 128, 0.3)'; // Default gray
      let state = null;

      // Get state and color based on indicator type
      // Sistema semáforo consistente: Verde = oportunidad, Amarillo = neutro, Naranja = precaución, Rojo = peligro
      if (indicatorType === 'bandwidth' && point.bandwidthState) {
        state = point.bandwidthState;
        if (state === 'squeeze') {
          barColor = 'rgba(0, 150, 0, 0.9)'; // Verde oscuro - Oportunidad
        } else if (state === 'consolidation') {
          barColor = 'rgba(255, 193, 7, 0.85)'; // Amarillo - Esperar
        } else if (state === 'normal') {
          barColor = 'rgba(255, 152, 0, 0.85)'; // Naranja - Precaución
        } else if (state === 'trending') {
          barColor = 'rgba(220, 0, 0, 0.9)'; // Rojo oscuro - Peligro/Ya pasó
        }
      } else if (indicatorType === 'bbwp' && point.bbwpState) {
        state = point.bbwpState;
        if (state === 'squeeze') {
          barColor = 'rgba(0, 150, 0, 0.9)'; // Verde oscuro - Compresión histórica
        } else if (state === 'normal') {
          barColor = 'rgba(255, 193, 7, 0.85)'; // Amarillo - Volatilidad promedio
        } else if (state === 'trending') {
          barColor = 'rgba(220, 0, 0, 0.9)'; // Rojo oscuro - Extremo histórico
        }
      } else if (indicatorType === 'ttm' && point.squeezeState) {
        state = point.squeezeState;
        if (state === 'on') {
          barColor = 'rgba(0, 150, 0, 0.9)'; // Verde oscuro - Squeeze ON (oportunidad)
        } else {
          barColor = 'rgba(255, 193, 7, 0.85)'; // Amarillo - Squeeze OFF (normal)
        }
      }

      // Draw bar segment
      ctx.fillStyle = barColor;
      ctx.fillRect(candleX, barY, candleWidth, barHeight);

      // Draw border between segments for clarity
      if (i > 0) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(candleX, barY);
        ctx.lineTo(candleX, barY + barHeight);
        ctx.stroke();
      }
    });

    // Draw label at the left side of the bar
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

  // ✅ Draw current state of volatility indicators (top left corner)
  _drawCurrentStateIndicators(ctx, bounds) {
    const { x, y } = bounds;

    const labels = [];
    const labelHeight = 16;
    const labelPadding = 4;

    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';

    // Get latest data point
    const latestTimestamp = Array.from(this.dataMap.keys()).pop();
    const latestPoint = this.dataMap.get(latestTimestamp);

    if (!latestPoint) return;

    // BandWidth current value
    if (this.showBandWidth && latestPoint.bandwidth !== undefined) {
      const bwValue = latestPoint.bandwidth.toFixed(2);
      const state = latestPoint.bandwidthState || 'unknown';
      labels.push({
        text: `BW: ${bwValue}% [${state.toUpperCase()}]`,
        state: state,
        type: 'bandwidth'
      });
    }

    // BBWP current value
    if (this.showBBWP && latestPoint.bbwp !== undefined) {
      const percentile = latestPoint.bbwp.toFixed(1);
      const state = latestPoint.bbwpState || 'unknown';
      labels.push({
        text: `BBWP: ${percentile}% [${state.toUpperCase()}]`,
        state: state,
        type: 'bbwp'
      });
    }

    // TTM Squeeze current state
    if (this.showTTMSqueeze && latestPoint.squeezeState !== undefined) {
      const state = latestPoint.squeezeState;
      labels.push({
        text: `TTM: ${state === 'on' ? 'SQUEEZE' : 'NORMAL'}`,
        state: state,
        type: 'ttm'
      });
    }

    // Draw labels from top left
    let currentY = y + 5;

    labels.forEach(label => {
      // Determine colors
      let bgColor = '';
      let textColor = '#FFFFFF';

      // Sistema semáforo consistente para los labels
      if (label.type === 'bandwidth') {
        if (label.state === 'squeeze') {
          bgColor = 'rgba(0, 150, 0, 0.85)'; // Verde oscuro
        } else if (label.state === 'consolidation') {
          bgColor = 'rgba(255, 193, 7, 0.85)'; // Amarillo
          textColor = '#000000';
        } else if (label.state === 'normal') {
          bgColor = 'rgba(255, 152, 0, 0.85)'; // Naranja
          textColor = '#000000';
        } else if (label.state === 'trending') {
          bgColor = 'rgba(220, 0, 0, 0.85)'; // Rojo oscuro
        }
      } else if (label.type === 'bbwp') {
        if (label.state === 'squeeze') {
          bgColor = 'rgba(0, 150, 0, 0.85)'; // Verde oscuro
        } else if (label.state === 'normal') {
          bgColor = 'rgba(255, 193, 7, 0.85)'; // Amarillo
          textColor = '#000000';
        } else if (label.state === 'trending') {
          bgColor = 'rgba(220, 0, 0, 0.85)'; // Rojo oscuro
        }
      } else if (label.type === 'ttm') {
        if (label.state === 'on') {
          bgColor = 'rgba(0, 150, 0, 0.85)'; // Verde oscuro - Squeeze ON
        } else {
          bgColor = 'rgba(255, 193, 7, 0.85)'; // Amarillo - Squeeze OFF
          textColor = '#000000';
        }
      }

      // Measure and draw
      const textMetrics = ctx.measureText(label.text);
      const labelWidth = textMetrics.width + (labelPadding * 2);
      const labelX = x + 5; // Top left corner

      // Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(labelX, currentY, labelWidth, labelHeight);

      // Text
      ctx.fillStyle = textColor;
      ctx.fillText(label.text, labelX + labelPadding, currentY + 2);

      currentY += labelHeight + 2;
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

  // Get current VWAP deviations for alert filtering
  getDeviations() {
    if (!this.vwapData || this.vwapData.length === 0) {
      return null;
    }

    const latest = this.vwapData[this.vwapData.length - 1];

    if (!latest || !latest.bands) {
      return null;
    }

    return {
      vwap: latest.value,
      upper1: latest.bands.upper_1,
      upper2: latest.bands.upper_2,
      upper3: latest.bands.upper_3,
      lower1: latest.bands.lower_1,
      lower2: latest.bands.lower_2,
      lower3: latest.bands.lower_3
    };
  }
}

export default VWAPIndicator;
