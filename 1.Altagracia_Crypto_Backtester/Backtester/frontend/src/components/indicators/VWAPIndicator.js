// src/components/indicators/VWAPIndicator.js
// VWAP Indicator with Standard Deviation Bands

import IndicatorBase from "./IndicatorBase.js";
import { API_BASE_URL } from "../../config.js";

const HOUR_MS = 60 * 60 * 1000;
const MIN_SESSION_MS = 23 * HOUR_MS;

// Lecturas de volatilidad de fábrica por marco, para el VWAP de sesión con la ventana de su sesión.
// Medidas en BTC de octubre 2021 a noviembre 2026 (1m desde octubre 2024):
// - minSessionCandles: primera vela de la sesión en que menos del 90% de las sesiones marca squeeze
//   en BandWidth y en TTM. Antes la banda casi no existe: la primera vela siempre tiene ancho cero
// - bandWidthThresholds: cada estado conserva la frecuencia que tenía con la ventana anterior, que
//   empezaba el día antes y daba bandas más anchas: cerca de 40% squeeze, 45% consolidación,
//   13% normal y 2% tendencia
// - ttmATRMultiplier: Keltner que enciende el squeeze tan seguido como el TTM clásico (Bollinger de
//   20 velas a 2σ dentro de Keltner de 20 velas a 1.5 ATR) en las mismas velas: 10% en 1m, 20% en 5m
//   y entre 31% y 37% en 15m, 1h y 4h
const VOLATILITY_DEFAULTS = {
  '1m': { bandWidthThresholds: { squeeze: 0.8, consolidation: 2.3, normal: 4.75 }, ttmATRMultiplier: 4.2, minSessionCandles: 85 },
  '5m': { bandWidthThresholds: { squeeze: 0.8, consolidation: 2.2, normal: 4.5 }, ttmATRMultiplier: 2.2, minSessionCandles: 24 },
  '15m': { bandWidthThresholds: { squeeze: 0.8, consolidation: 2.15, normal: 4.45 }, ttmATRMultiplier: 1.35, minSessionCandles: 10 },
  '1h': { bandWidthThresholds: { squeeze: 0.7, consolidation: 2.05, normal: 4.35 }, ttmATRMultiplier: 0.6, minSessionCandles: 3 },
  '4h': { bandWidthThresholds: { squeeze: 0.65, consolidation: 2.05, normal: 4.3 }, ttmATRMultiplier: 0.2, minSessionCandles: 2 }
};
// Los mismos marcos con el código de Bybit
const INTERVAL_NAMES = { '1': '1m', '5': '5m', '15': '15m', '60': '1h', '240': '4h' };

// Otro marco usa los umbrales de 15m, el Keltner clásico y solo deja sin leer la primera vela
export function volatilityDefaults(interval) {
  const values = VOLATILITY_DEFAULTS[INTERVAL_NAMES[interval] || interval]
    || { ...VOLATILITY_DEFAULTS['15m'], ttmATRMultiplier: 1.5, minSessionCandles: 2 };
  return { ...values, bandWidthThresholds: { ...values.bandWidthThresholds } };
}

class VWAPIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 7, config = {}) {
    super(symbol, interval, days);
    this.name = "VWAP";
    this.height = 0; // VWAP se dibuja sobre el gráfico principal, no necesita espacio separado

    // 🎯 CRÍTICO: Modo backtesting - deshabilita auto-refresh
    this.backtestingMode = config.backtestingMode || false;

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

    // Valores de fábrica del marco, calibrados para el VWAP de sesión
    const volatility = volatilityDefaults(interval);

    // BandWidth thresholds (%) - Adaptive by timeframe
    this.bandWidthThresholds = config.bandWidthThresholds || volatility.bandWidthThresholds;

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
    this.ttmATRMultiplier = config.ttmATRMultiplier || volatility.ttmATRMultiplier;

    // Velas que debe tener la sesión antes de leer BandWidth, BBWP y TTM
    this.minSessionCandles = config.minSessionCandles ?? volatility.minSessionCandles;

    // Volatility bar visualization
    this.volatilityBarHeight = config.volatilityBarHeight || 8;

    // Data
    this.vwapData = [];
    this.dataMap = new Map();
    this._lastCalculatedLength = 0; // 🎯 Para detectar cuando necesitamos recalcular
    this._calculationValid = false; // 🎯 Flag para indicar si el cálculo es válido
    this.calculations = 0; // Veces que cambió dataMap: el filtro VWAP del Swing se recalcula con cada una
    this._knownCandles = null; // En backtesting: lo que ya ocurrió en la hora simulada
    this._formingKey = null;
    this._formingValue = null;

    // Volatility state tracking
    this.volatilityStateChanges = [];
    this.lastBandWidthState = null;
    this.lastBBWPState = null;
    this.lastSqueezeState = null;

    // Auto-refresh timer para actualizar VWAP periódicamente
    this.refreshInterval = null;
    this.refreshIntervalMs = 30000; // 30 segundos
  }

  async fetchData() {
    // 🎯 CRÍTICO: En modo backtesting, NO hacer fetch al backend
    // Los datos del VWAP se calculan en tiempo real desde las velas
    if (this.backtestingMode) {
      console.log(`[${this.symbol}] ⏸️ Skipping fetchData for VWAP (backtesting mode)`);
      this.loading = false;
      // En backtesting, el VWAP se calcula dinámicamente en calculate()
      // No necesitamos cargar datos del backend
      return true;
    }

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
        this._calculationValid = false; // Invalidar al limpiar
        json.data.forEach(point => {
          this.dataMap.set(point.timestamp, point);
        });
        this._calculationValid = true; // Validar después de cargar
        this.calculations += 1;

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
    // 🎯 CRÍTICO: NO iniciar auto-refresh en modo backtesting
    if (this.backtestingMode) {
      console.log(`[${this.symbol}] ⏸️ VWAP auto-refresh DESHABILITADO en modo backtesting`);
      return;
    }

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
    if (config.minSessionCandles !== undefined) this.minSessionCandles = config.minSessionCandles;
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
        volume: volume,
        cum_pv: cumulativePV,
        cum_volume: cumulativeVolume,
        session_start: sessionStartTimestamp
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
        volume: volume,
        cum_pv: cumulativePV,
        cum_volume: cumulativeVolume
      });
    }

    return vwapData;
  }

  // Inicio de la ventana de cada vela. Da lo mismo que recorrer hacia atrás en _bandsAt
  _windowStarts(candles, vwapData) {
    const starts = new Int32Array(candles.length);
    if (this.vwapType === 'rolling') {
      for (let i = 0; i < candles.length; i++) starts[i] = Math.max(0, i - this.rollingPeriod + 1);
    } else if (this.vwapType === 'session') {
      // Primera vela con timestamp >= session_start: la misma sesión del VWAP, como en
      // backend/vwap_calculator.py. Antes empezaba casi siempre el día anterior
      let start = 0;
      for (let i = 0; i < candles.length; i++) {
        while (start < i && candles[start].timestamp < vwapData[i].session_start) start++;
        starts[i] = start;
      }
    }
    return starts;
  }

  // ✅ Calcular bandas de desviación estándar con sumas acumuladas: una pasada por todas las velas.
  // Las sumas de sesión y ancladas se reinician donde empieza cada ventana y se centran en su
  // primer precio: una ventana corta, como el inicio de una sesión, no pierde precisión.
  // La ventana móvil se suma directo: es corta y en un tramo tranquilo las sumas de todo el
  // historial no alcanzan a medir su variación
  _calculateStdBands(candles, vwapData) {
    if (candles.length !== vwapData.length || candles.length === 0) return vwapData;

    const typical = (candle) => (candle.high + candle.low + candle.close) / 3.0;
    const multipliers = this._bandMultipliers();
    const starts = this._windowStarts(candles, vwapData);

    let windowStart = -1;
    let center = 0;
    let volumes = 0;
    let prices = 0;
    let squares = 0;
    const add = (candle) => {
      const price = typical(candle) - center;
      volumes += candle.volume;
      prices += candle.volume * price;
      squares += candle.volume * price * price;
    };

    for (let i = 0; i < candles.length; i++) {
      const start = starts[i];
      const vwap = vwapData[i].vwap;
      vwapData[i].band_candles = i - start + 1;

      if (this.vwapType !== 'rolling') {
        if (start !== windowStart) {
          windowStart = start;
          center = typical(candles[start]);
          volumes = 0;
          prices = 0;
          squares = 0;
          for (let j = start; j < i; j++) add(candles[j]);
        }
        add(candles[i]);
      }

      if (i - start + 1 < 2) {
        vwapData[i].bands = this._bandsFrom(vwap, 0, multipliers);
        continue;
      }

      let volume = 0;
      let weighted = 0;
      if (this.vwapType === 'rolling') {
        for (let j = start; j <= i; j++) {
          const gap = typical(candles[j]) - vwap;
          weighted += gap * gap * candles[j].volume;
          volume += candles[j].volume;
        }
      } else {
        volume = volumes;
        const offset = vwap - center;
        weighted = squares - 2 * offset * prices + offset * offset * volume;
      }
      const stdDev = volume > 0 ? Math.sqrt(Math.max(0, weighted / volume)) : 0;
      vwapData[i].bands = this._bandsFrom(vwap, stdDev, multipliers);
    }

    return vwapData;
  }

  _bandMultipliers() {
    const cryptoAdjustment = this.applyCryptoAdjustment ? 1.15 : 1.0;
    return this.bandMultipliers.map(m => m * cryptoAdjustment);
  }

  // Una banda de sesión se lee desde minSessionCandles velas: antes casi no existe y marcaría squeeze
  _readable(point) {
    return this.vwapType !== 'session' || point.band_candles === undefined || point.band_candles >= this.minSessionCandles;
  }

  _bandsFrom(vwapValue, stdDev, multipliers) {
    const bands = {};
    multipliers.forEach((mult, idx) => {
      bands[`upper_${idx + 1}`] = vwapValue + (stdDev * mult);
      bands[`lower_${idx + 1}`] = vwapValue - (stdDev * mult);
    });
    return bands;
  }

  // Bandas de la vela i, con las velas de su ventana. sessionStart es el session_start de su VWAP
  _bandsAt(candles, i, vwapValue, sessionStart) {
    // Aplicar ajuste de crypto a los multiplicadores si está habilitado
    const adjustedMultipliers = this._bandMultipliers();

    // Determinar ventana según tipo de VWAP
    let windowCandles;
    if (this.vwapType === 'rolling') {
      const startIdx = Math.max(0, i - this.rollingPeriod + 1);
      windowCandles = candles.slice(startIdx, i + 1);
    } else if (this.vwapType === 'session') {
      // Desde la primera vela de la sesión, igual que _windowStarts
      let sessionStartIdx = i;
      while (sessionStartIdx > 0 && candles[sessionStartIdx - 1].timestamp >= sessionStart) sessionStartIdx--;
      windowCandles = candles.slice(sessionStartIdx, i + 1);
    } else {
      // Anchored: desde inicio hasta actual
      windowCandles = candles.slice(0, i + 1);
    }

    // Sin suficientes datos no hay varianza
    if (windowCandles.length < 2) return this._bandsFrom(vwapValue, 0, adjustedMultipliers);

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

    return this._bandsFrom(vwapValue, stdDev, adjustedMultipliers);
  }

  /**
   * Punto de una vela visible. El punto guardado de la vela en formación viene de la vela
   * final, con precios que todavía no ocurrieron: ese se calcula con lo ya conocido.
   */
  _pointFor(candle) {
    if (!candle.in_progress || !this._knownCandles) return this.dataMap.get(candle.timestamp);

    const key = `${candle.timestamp}|${candle.knownUntil}`;
    if (key !== this._formingKey) {
      this._formingKey = key;
      this._formingValue = this._formingPoint(this._knownCandles);
    }
    return this._formingValue;
  }

  // VWAP y bandas de la última vela conocida, a partir de la vela cerrada anterior
  _formingPoint(known) {
    const index = known.length - 1;
    const candle = known[index];
    if (this.vwapType === 'anchored' && candle.timestamp < (this.anchorTimestamp || 0)) return undefined;

    const previous = index > 0 ? this.dataMap.get(known[index - 1].timestamp) : undefined;
    const typicalPrice = (candle.high + candle.low + candle.close) / 3.0;
    let vwap;
    let sessionStart;

    if (this.vwapType === 'rolling') {
      vwap = this._calculateRollingVWAP(known.slice(Math.max(0, index - this.rollingPeriod + 1))).pop().vwap;
    } else {
      const startsSession = this.vwapType === 'session' && previous
        && new Date(candle.timestamp).getUTCHours() === this.resetHour
        && candle.timestamp - previous.session_start >= MIN_SESSION_MS;
      const base = previous && !startsSession ? previous : { cum_pv: 0, cum_volume: 0 };
      const volume = base.cum_volume + candle.volume;
      vwap = volume > 0 ? (base.cum_pv + typicalPrice * candle.volume) / volume : typicalPrice;
      // Su sesión: la de la vela anterior, o ella misma si abre una
      sessionStart = previous && !startsSession ? previous.session_start : candle.timestamp;
    }

    const point = { timestamp: candle.timestamp, vwap, typical_price: typicalPrice, volume: candle.volume };
    if (this.showBands && previous?.bands) point.bands = this._bandsAt(known, index, vwap, sessionStart);
    return point;
  }

  // Último punto con velas cerradas en la hora simulada
  _latestPoint() {
    const known = this._knownCandles;
    if (!known) return this.dataMap.get(Array.from(this.dataMap.keys()).pop());
    const newest = known[known.length - 1];
    return newest?.in_progress ? this.dataMap.get(known[known.length - 2]?.timestamp) : this.dataMap.get(newest?.timestamp);
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

      if (!point.bands || !point.bands.upper_1 || !point.bands.lower_1 || !this._readable(point)) {
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
    // Solo anchos con lectura: una vela sin lectura no recibe percentil ni entra al historial
    const widths = [];

    for (let i = 0; i < bandWidthData.length; i++) {
      const currentBW = bandWidthData[i].bandwidth;
      if (bandWidthData[i].state === 'unknown') {
        bbwpData.push({ timestamp: bandWidthData[i].timestamp, percentile: 0, state: 'unknown' });
        continue;
      }
      widths.push(currentBW);

      // Get historical window
      const lookback = Math.min(this.bbwpLookback, widths.length);
      const historicalBWs = widths.slice(Math.max(0, widths.length - lookback));

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

      if (!this._readable(point)) {
        squeezeData.push({ timestamp: point.timestamp, squeeze: false, state: 'unknown' });
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

  // 🎯 NUEVO: Método para recalcular VWAP (separado de renderOverlay para optimización)
  _recalculateVWAP(allCandles) {
    if (!allCandles || allCandles.length === 0) {
      console.warn(`[${this.symbol}] VWAP _recalculateVWAP: allCandles está vacío`);
      return;
    }

    console.log(`[${this.symbol}] VWAP: Calculando con ${allCandles.length} velas...`);

    // Calcular VWAP desde TODAS las velas
    let calculatedVWAP = this.calculateVWAP(allCandles);
    if (calculatedVWAP.length === 0) {
      console.warn(`[${this.symbol}] VWAP: calculateVWAP retornó 0 puntos`);
      return;
    }

    // Calcular bandas de desviación estándar
    if (this.showBands) {
      calculatedVWAP = this._calculateStdBands(allCandles, calculatedVWAP);
    }

    // Calcular indicadores de volatilidad si están habilitados
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
    this._calculationValid = false; // Invalidar mientras se recalcula
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

    // Guardar la longitud para detectar cambios futuros
    this._lastCalculatedLength = allCandles.length;
    this._calculationValid = true; // Marcar cálculo como válido
    this.calculations += 1;
    console.log(`[${this.symbol}] VWAP: ✅ Cálculo completado - ${this.dataMap.size} puntos en dataMap`);
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) return;
    if (!visibleCandles || visibleCandles.length === 0) return;

    this._knownCandles = priceContext?.knownCandles || null;

    // 🎯 VALIDACIÓN CRÍTICA: allCandles puede llegar como displayCandles en lugar de allCandlesRef
    if (!allCandles || allCandles.length === 0) {
      console.error(`[${this.symbol}] VWAP CRÍTICO: allCandles está vacío - length=${allCandles?.length}`);
      console.error(`[${this.symbol}] VWAP: dataMap.size=${this.dataMap.size}, _calculationValid=${this._calculationValid}`);
      // Si ya tenemos un cálculo válido, intentar renderizar con lo que tenemos
      if (this._calculationValid && this.dataMap.size > 0) {
        console.warn(`[${this.symbol}] VWAP: Usando caché existente para renderizar`);
        // Continuar con el renderizado usando el caché
      } else {
        return; // No podemos hacer nada sin datos
      }
    }

    // 🎯 OPTIMIZACIÓN CRÍTICA: Solo recalcular si tenemos allCandles válido Y necesitamos recalcular
    // En backtesting, esto significa calcular UNA VEZ al inicio, no en cada frame
    if (allCandles && allCandles.length > 0) {
      const needsRecalculation = !this._calculationValid ||
                                 this.dataMap.size === 0 ||
                                 allCandles.length !== this._lastCalculatedLength;

      if (needsRecalculation) {
        console.log(`[${this.symbol}] VWAP: Recalculando con ${allCandles.length} velas (valid=${this._calculationValid}, dataMap.size=${this.dataMap.size}, lastLength=${this._lastCalculatedLength})`);
        this._recalculateVWAP(allCandles);
      }
    }

    // Si no tenemos datos calculados, no podemos renderizar
    if (this.dataMap.size === 0) {
      console.warn(`[${this.symbol}] VWAP: No hay datos para renderizar (dataMap vacío)`);
      return;
    }

    const { x, y, width, height } = bounds;
    const viewport = priceContext || {};

    // Save canvas state to avoid pollution from/to other indicators
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Draw bands first (behind VWAP line)
    if (this.showBands) {
      this._drawBands(ctx, visibleCandles, viewport, x, y, width, height);
    }

    // Draw VWAP line
    this._drawVWAPLine(ctx, visibleCandles, viewport, x, y, width, height);

    // Restore canvas state
    ctx.restore();

    // NOTE: Volatility indicators are now drawn separately from MiniChart
    // after the volume panel to avoid confusion
  }

  _drawVWAPLine(ctx, visibleCandles, viewport, x, y, width, height) {
    const candleWidth = width / visibleCandles.length;
    const points = [];

    // Collect valid points first
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const vwapPoint = this._pointFor(candle);
      if (!vwapPoint) continue;

      const candleX = x + (i * candleWidth) + (candleWidth / 2);
      const vwapPrice = vwapPoint.vwap;

      let candleY;
      if (viewport.priceToY) {
        candleY = viewport.priceToY(vwapPrice);
      } else {
        candleY = y + ((viewport.maxPrice - vwapPrice) / (viewport.maxPrice - viewport.minPrice)) * height;
      }

      if (isFinite(candleX) && isFinite(candleY)) {
        points.push({ x: candleX, y: candleY });
      }
    }

    // Draw as individual segments (more reliable than single path)
    if (points.length >= 2) {
      ctx.strokeStyle = this.vwapColor;
      ctx.lineWidth = this.vwapLineWidth;
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < points.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
        ctx.stroke();
      }
    }
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
        const vwapPoint = this._pointFor(candle);
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
        const vwapPoint = this._pointFor(candle);
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
      const point = this._pointFor(candle);
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
        } else if (state === 'off') {
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
    const latestPoint = this._latestPoint();

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

  getConfig() {
    return {
      vwapType: this.vwapType,
      resetHour: this.resetHour,
      anchorTimestamp: this.anchorTimestamp,
      rollingPeriod: this.rollingPeriod,
      showBands: this.showBands,
      bandMultipliers: this.bandMultipliers,
      applyCryptoAdjustment: this.applyCryptoAdjustment,
      vwapColor: this.vwapColor,
      vwapLineWidth: this.vwapLineWidth,
      bandLineWidth: this.bandLineWidth,
      bandColors: this.bandColors,
      showBandWidth: this.showBandWidth,
      showBBWP: this.showBBWP,
      showTTMSqueeze: this.showTTMSqueeze,
      bandWidthThresholds: this.bandWidthThresholds,
      bbwpLookback: this.bbwpLookback,
      bbwpThresholds: this.bbwpThresholds,
      ttmATRLength: this.ttmATRLength,
      ttmATRMultiplier: this.ttmATRMultiplier,
      minSessionCandles: this.minSessionCandles,
      volatilityBarHeight: this.volatilityBarHeight
    };
  }

  applyConfig(config) {
    if (config.vwapType !== undefined) this.vwapType = config.vwapType;
    if (config.resetHour !== undefined) this.resetHour = config.resetHour;
    if (config.anchorTimestamp !== undefined) this.anchorTimestamp = config.anchorTimestamp;
    if (config.rollingPeriod !== undefined) this.rollingPeriod = config.rollingPeriod;
    if (config.showBands !== undefined) this.showBands = config.showBands;
    if (config.bandMultipliers !== undefined) this.bandMultipliers = config.bandMultipliers;
    if (config.applyCryptoAdjustment !== undefined) this.applyCryptoAdjustment = config.applyCryptoAdjustment;
    if (config.vwapColor !== undefined) this.vwapColor = config.vwapColor;
    if (config.vwapLineWidth !== undefined) this.vwapLineWidth = config.vwapLineWidth;
    if (config.bandLineWidth !== undefined) this.bandLineWidth = config.bandLineWidth;
    if (config.bandColors !== undefined) this.bandColors = config.bandColors;
    if (config.showBandWidth !== undefined) this.showBandWidth = config.showBandWidth;
    if (config.showBBWP !== undefined) this.showBBWP = config.showBBWP;
    if (config.showTTMSqueeze !== undefined) this.showTTMSqueeze = config.showTTMSqueeze;
    if (config.bandWidthThresholds !== undefined) this.bandWidthThresholds = config.bandWidthThresholds;
    if (config.bbwpLookback !== undefined) this.bbwpLookback = config.bbwpLookback;
    if (config.bbwpThresholds !== undefined) this.bbwpThresholds = config.bbwpThresholds;
    if (config.ttmATRLength !== undefined) this.ttmATRLength = config.ttmATRLength;
    if (config.ttmATRMultiplier !== undefined) this.ttmATRMultiplier = config.ttmATRMultiplier;
    if (config.minSessionCandles !== undefined) this.minSessionCandles = config.minSessionCandles;
    if (config.volatilityBarHeight !== undefined) this.volatilityBarHeight = config.volatilityBarHeight;
  }

  // 🎯 FIX: Sobrescribir getHeight para retornar espacio cuando las barras de volatilidad están habilitadas
  getHeight() {
    if (!this.enabled) return 0;

    // Contar cuántas barras de volatilidad están activas
    let activeBarCount = 0;
    if (this.showBandWidth) activeBarCount++;
    if (this.showBBWP) activeBarCount++;
    if (this.showTTMSqueeze) activeBarCount++;

    if (activeBarCount === 0) return 0; // Sin barras, no necesita espacio

    // Calcular altura necesaria: altura por barra + gaps + márgenes
    const barGap = 2;
    const margin = 5;
    return (this.volatilityBarHeight * activeBarCount) + (barGap * (activeBarCount - 1)) + margin * 2;
  }

  // 🎯 FIX: Método render para dibujar las barras de volatilidad en el panel de indicadores
  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;

    // Solo renderizar si hay barras de volatilidad activas
    let activeBarCount = 0;
    if (this.showBandWidth) activeBarCount++;
    if (this.showBBWP) activeBarCount++;
    if (this.showTTMSqueeze) activeBarCount++;

    if (activeBarCount === 0) return;

    const { x, y, width, height } = bounds;
    const candleWidth = width / visibleCandles.length;

    // Usar renderVolatilityBars para dibujar
    this.renderVolatilityBars(ctx, x, y + 3, width, candleWidth, visibleCandles);
  }
}

export default VWAPIndicator;
