// src/components/indicators/OpenInterestIndicator.js
// Open Interest Indicator con 3 modos de visualización
// Modo 1: Histogram (delta simple como Volume Delta)
// Modo 2: Cumulative (acumulativo como CVD)
// Modo 3: Flow (OI Flow Sentiment con EMA - LuxAlgo)
// VERSION: 2.0 - Azul/Naranja + Fullscreen selector

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";

class OpenInterestIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Open Interest";
    this.height = 150; // 🎯 INCREMENTADO: De 100 a 150 para mejor visibilidad
    this.days = days;

    // VERSION CHECK
    console.log(`%c[OpenInterestIndicator] VERSION 2.0 LOADED - Azul/Naranja colors + Fullscreen selector`, 'background: #1E88E5; color: white; font-weight: bold; padding: 4px;');

    // Configuración
    this.mode = "histogram"; // "histogram", "cumulative", "flow"
    this.smoothing = 3; // Suavizado para modo Flow
    this.showPriceSentiment = false; // Price Sentiment solo en modo Flow

    // Datos desde el backend
    this.dataMap = null; // Map de timestamp -> openInterest
    this.data = []; // Array de datos OI procesados

    // Metadata de cobertura OI (fechas disponibles)
    this.oiFirstTimestamp = null;
    this.oiLastTimestamp = null;
    this.oiFirstDate = "";
    this.oiLastDate = "";
    this.oiInterval = "";
  }

  /**
   * Fetch Open Interest data from backend
   */
  async fetchData() {
    // 🎯 NUEVO: Si los datos ya fueron pre-cargados (modo backtesting), no hacer fetch
    if (this._dataPreloaded) {
      console.log(`[${this.symbol}] ✅ Open Interest: Skipping fetch (data preloaded in backtesting mode)`);
      return true;
    }

    try {
      const url = `${API_BASE_URL}/api/open-interest/${this.symbol}?interval=${this.interval}&days=${this.days}`;
      console.log(`%c[OI DEBUG] ${this.symbol} - FETCHING`, 'background: #FF9800; color: white; font-weight: bold; padding: 4px 8px;', {
        interval: this.interval,
        days: this.days,
        url
      });

      const response = await fetch(url);

      // 🎯 DEBUG: Verificar status de respuesta
      if (!response.ok) {
        console.error(`%c[OI DEBUG] ${this.symbol} - HTTP ERROR`, 'background: #F44336; color: white; font-weight: bold; padding: 4px 8px;', {
          status: response.status,
          statusText: response.statusText
        });
        return false;
      }

      const result = await response.json();

      console.log(`%c[OI DEBUG] ${this.symbol} - API RESPONSE`, 'background: #2196F3; color: white; font-weight: bold; padding: 4px 8px;', {
        success: result.success,
        dataLength: result.data?.length || 0,
        error: result.error || 'none',
        firstItem: result.data?.[0],
        lastItem: result.data?.[result.data?.length - 1]
      });

      if (result.success && result.data && result.data.length > 0) {
        // Crear map de timestamp -> openInterest para búsqueda rápida
        this.dataMap = new Map();
        result.data.forEach(item => {
          this.dataMap.set(item.timestamp, item.openInterest);
        });

        this.data = result.data;
        this._sortedTimestamps = null; // Invalidar cache de timestamps ordenados

        // Guardar metadata de cobertura OI
        this.oiFirstTimestamp = result.oi_first_timestamp || null;
        this.oiLastTimestamp = result.oi_last_timestamp || null;
        this.oiFirstDate = result.oi_first_date || "";
        this.oiLastDate = result.oi_last_date || "";
        this.oiInterval = result.oi_interval || "";

        console.log(`%c[OI DEBUG] ${this.symbol} - DATA LOADED`, 'background: #4CAF50; color: white; font-weight: bold; padding: 4px 8px;', {
          dataMapSize: this.dataMap.size,
          dataLength: this.data.length,
          oiFirstDate: this.oiFirstDate,
          oiLastDate: this.oiLastDate,
          oiInterval: this.oiInterval,
          sampleTimestamps: Array.from(this.dataMap.keys()).slice(0, 5).map(t => new Date(t).toISOString()),
          sampleValues: Array.from(this.dataMap.values()).slice(0, 5)
        });
        return true;
      } else {
        console.warn(`%c[OI DEBUG] ${this.symbol} - NO DATA`, 'background: #F44336; color: white; font-weight: bold; padding: 4px 8px;', {
          success: result.success,
          dataExists: !!result.data,
          dataLength: result.data?.length || 0,
          error: result.error || 'none'
        });
        this.dataMap = null;
        this.data = [];
        return false;
      }
    } catch (error) {
      console.error(`%c[OI DEBUG] ${this.symbol} - EXCEPTION`, 'background: #000; color: white; font-weight: bold; padding: 4px 8px;', {
        message: error.message,
        stack: error.stack
      });
      this.dataMap = null;
      this.data = [];
      return false;
    }
  }

  /**
   * 🎯 NUEVO: Cargar datos directamente desde memoria (para modo backtesting)
   */
  loadFromData(oiData) {
    try {
      if (!oiData || oiData.length === 0) {
        console.warn(`[${this.symbol}] ⚠️ No Open Interest data provided`);
        this.dataMap = null;
        this.data = [];
        this._sortedTimestamps = null;
        return false;
      }

      // Crear map de timestamp -> openInterest para búsqueda rápida
      this.dataMap = new Map();
      oiData.forEach(item => {
        this.dataMap.set(item.timestamp, item.openInterest);
      });

      this.data = oiData;
      this._sortedTimestamps = null; // Invalidar cache de timestamps ordenados
      this._loggedMatch = false;
      this._loggedNoMatch = false;

      // Calcular metadata de cobertura desde los datos
      this.oiFirstTimestamp = this.data[0].timestamp;
      this.oiLastTimestamp = this.data[this.data.length - 1].timestamp;
      this.oiFirstDate = this.data[0].datetime_colombia || new Date(this.oiFirstTimestamp).toLocaleDateString('es-CO');
      this.oiLastDate = this.data[this.data.length - 1].datetime_colombia || new Date(this.oiLastTimestamp).toLocaleDateString('es-CO');

      console.log(`[${this.symbol}] ✅ Open Interest loaded from memory: ${this.data.length} points`);
      console.log(`[${this.symbol}] 📊 OI Data Range: ${new Date(this.data[0].timestamp).toISOString()} → ${new Date(this.data[this.data.length-1].timestamp).toISOString()}`);
      return true;
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error loading Open Interest from data:`, error);
      this.dataMap = null;
      this.data = [];
      this._sortedTimestamps = null;
      return false;
    }
  }

  /**
   * Genera el mensaje de cobertura OI para mostrar cuando no hay datos en el periodo visible.
   * Muestra la fecha exacta desde la cual hay datos disponibles.
   */
  _getOICoverageMessage() {
    if (this.oiFirstDate) {
      // Formatear fecha legible: extraer solo la parte de fecha si viene con hora
      const dateStr = this.oiFirstDate.split(' ')[0] || this.oiFirstDate;
      return `Datos de OI disponibles desde: ${dateStr} (navega hacia adelante para ver OI)`;
    }
    if (this.oiFirstTimestamp) {
      const d = new Date(this.oiFirstTimestamp);
      const formatted = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return `Datos de OI disponibles desde: ${formatted} (navega hacia adelante para ver OI)`;
    }
    return "Sin datos de OI para este periodo (Bybit no tiene datos tan antiguos)";
  }

  /**
   * Calcula EMA (Exponential Moving Average)
   */
  calculateEMA(values, period) {
    if (!values || values.length === 0) return [];

    const k = 2 / (period + 1);
    const ema = [];
    ema[0] = values[0];

    for (let i = 1; i < values.length; i++) {
      ema[i] = (values[i] * k) + (ema[i - 1] * (1 - k));
    }

    return ema;
  }

  /**
   * Busca el valor de OI para una vela usando forward-fill.
   * Estrategia: Usa el último valor de OI conocido antes o en el timestamp de la vela.
   * Esto funciona correctamente cuando OI tiene resolución diferente a las velas
   * (ej: OI diario con velas de 15m en backtesting de periodos largos).
   */
  findClosestOI(candleTimestamp) {
    // Match exacto
    if (this.dataMap.has(candleTimestamp)) {
      return this.dataMap.get(candleTimestamp);
    }

    // Forward-fill: buscar el OI más reciente que sea <= candleTimestamp
    // Usa el array _sortedTimestamps para búsqueda eficiente
    if (!this._sortedTimestamps) {
      this._sortedTimestamps = Array.from(this.dataMap.keys()).sort((a, b) => a - b);
    }

    // Búsqueda binaria del timestamp más cercano <= candleTimestamp
    const arr = this._sortedTimestamps;
    let lo = 0, hi = arr.length - 1;
    let bestIdx = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= candleTimestamp) {
        bestIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (bestIdx >= 0) {
      const bestTs = arr[bestIdx];
      const value = this.dataMap.get(bestTs);

      // Log una sola vez para debug
      if (!this._loggedMatch && bestTs !== candleTimestamp) {
        console.log(`%c[OI MATCH] ${this.symbol}`, 'background: #4CAF50; color: white; padding: 2px 6px;',
          `forward-fill: vela ${new Date(candleTimestamp).toISOString()} → OI de ${new Date(bestTs).toISOString()} (${((candleTimestamp - bestTs) / 3600000).toFixed(1)}h atrás)`
        );
        this._loggedMatch = true;
      }

      return value;
    }

    // No hay datos de OI antes de esta vela
    if (!this._loggedNoMatch) {
      console.warn(`%c[OI NO DATA] ${this.symbol}`, 'background: #F44336; color: white; padding: 2px 6px;',
        `No hay OI antes de ${new Date(candleTimestamp).toISOString()}. Primer OI: ${arr.length > 0 ? new Date(arr[0]).toISOString() : 'N/A'}`
      );
      this._loggedNoMatch = true;
    }

    return null;
  }

  /**
   * MODO 1: HISTOGRAM - Delta simple de OI (como Volume Delta)
   * Calcula: OI[i] - OI[i-1]
   */
  calculateHistogramMode(candles) {
    if (!candles || candles.length === 0) {
      return [];
    }

    if (!this.dataMap || this.dataMap.size === 0) {
      return [];
    }

    const result = [];
    let lastOIValue = null;
    let matchedCandles = 0;

    // Encontrar primer valor de OI
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        lastOIValue = item.openInterest;
        break;
      }
    }

    if (lastOIValue === null) {
      return [];
    }

    // Determinar rango de OI disponible
    if (!this._sortedTimestamps) {
      this._sortedTimestamps = Array.from(this.dataMap.keys()).sort((a, b) => a - b);
    }
    const oiFirstTs = this._sortedTimestamps.length > 0 ? this._sortedTimestamps[0] : Infinity;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const oiValue = this.findClosestOI(candle.timestamp);

      // Contar velas que tienen datos reales de OI (no antes del primer punto OI)
      if (oiValue !== null && oiValue !== undefined && candle.timestamp >= oiFirstTs) {
        matchedCandles++;
      }

      let currentOI = oiValue !== null && oiValue !== undefined ? oiValue : lastOIValue;
      const delta = i === 0 ? 0 : currentOI - lastOIValue;

      result.push({
        timestamp: candle.timestamp,
        delta: delta,
        oiValue: currentOI,
        hasRealOI: candle.timestamp >= oiFirstTs && oiValue !== null && oiValue !== undefined
      });

      lastOIValue = currentOI;
    }

    // Marcar si hay cobertura real de OI en el rango visible
    result._hasOICoverage = matchedCandles > 0;

    return result;
  }

  /**
   * MODO 2: CUMULATIVE - Suma acumulativa de deltas (como CVD)
   */
  calculateCumulativeMode(candles) {
    if (!candles || candles.length === 0 || !this.dataMap) return [];

    const result = [];
    let lastOIValue = null;
    let cumulativeDelta = 0;
    let matchedCandles = 0;

    // Encontrar primer valor de OI
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        lastOIValue = item.openInterest;
        break;
      }
    }

    if (lastOIValue === null) return [];

    // Determinar rango de OI disponible
    if (!this._sortedTimestamps) {
      this._sortedTimestamps = Array.from(this.dataMap.keys()).sort((a, b) => a - b);
    }
    const oiFirstTs = this._sortedTimestamps.length > 0 ? this._sortedTimestamps[0] : Infinity;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const oiValue = this.findClosestOI(candle.timestamp);

      if (oiValue !== null && oiValue !== undefined && candle.timestamp >= oiFirstTs) {
        matchedCandles++;
      }

      let currentOI = oiValue !== null && oiValue !== undefined ? oiValue : lastOIValue;
      const delta = i === 0 ? 0 : currentOI - lastOIValue;

      const previousCumulative = cumulativeDelta;
      cumulativeDelta += delta;

      result.push({
        timestamp: candle.timestamp,
        openCumulative: previousCumulative,
        closeCumulative: cumulativeDelta,
        delta: delta,
        oiValue: currentOI,
        hasRealOI: candle.timestamp >= oiFirstTs && oiValue !== null && oiValue !== undefined
      });

      lastOIValue = currentOI;
    }

    result._hasOICoverage = matchedCandles > 0;

    return result;
  }

  /**
   * MODO 3: FLOW - OI Flow Sentiment con EMA (LuxAlgo)
   */
  calculateFlowMode(candles) {
    if (!candles || candles.length === 0 || !this.dataMap) return [];

    const oiValues = [];
    const timestamps = [];
    let matchedCandles = 0;

    // Encontrar primer valor de OI
    let firstOIValue = null;
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        firstOIValue = item.openInterest;
        break;
      }
    }

    if (firstOIValue === null) return [];

    // Determinar rango de OI disponible
    if (!this._sortedTimestamps) {
      this._sortedTimestamps = Array.from(this.dataMap.keys()).sort((a, b) => a - b);
    }
    const oiFirstTs = this._sortedTimestamps.length > 0 ? this._sortedTimestamps[0] : Infinity;

    // Rellenar array de OI values
    let lastKnownOI = firstOIValue;

    for (const candle of candles) {
      const oiValue = this.findClosestOI(candle.timestamp);

      if (oiValue !== undefined && oiValue !== null) {
        lastKnownOI = oiValue;
        oiValues.push(oiValue);
        if (candle.timestamp >= oiFirstTs) {
          matchedCandles++;
        }
      } else {
        oiValues.push(lastKnownOI);
      }

      timestamps.push(candle.timestamp);
    }

    if (oiValues.length === 0) return [];

    // Calcular EMA(oiValue, 13)
    const ema13 = this.calculateEMA(oiValues, 13);

    // Calcular diferencia: oiValue - EMA(oiValue, 13)
    const oiDiff = [];
    for (let i = 0; i < oiValues.length; i++) {
      oiDiff[i] = oiValues[i] - ema13[i];
    }

    // Aplicar smoothing: EMA(oiDiff, smoothing)
    const oiFlow = this.calculateEMA(oiDiff, this.smoothing);

    // Construir resultado
    const result = [];
    for (let i = 0; i < timestamps.length; i++) {
      result.push({
        timestamp: timestamps[i],
        oiFlow: oiFlow[i],
        oiValue: oiValues[i]
      });
    }

    result._hasOICoverage = matchedCandles > 0;

    return result;
  }

  /**
   * Calcula Price Sentiment (solo para modo Flow)
   */
  calculatePriceSentiment(candles) {
    if (!candles || candles.length === 0) return [];

    const closeValues = candles.map(c => c.close);
    const emaClose13 = this.calculateEMA(closeValues, 13);

    const priceDiff = [];
    for (let i = 0; i < candles.length; i++) {
      priceDiff[i] = (candles[i].high + candles[i].low) - (2 * emaClose13[i]);
    }

    const priceFlow = this.calculateEMA(priceDiff, this.smoothing);

    const result = [];
    for (let i = 0; i < candles.length; i++) {
      result.push({
        timestamp: candles[i].timestamp,
        priceFlow: priceFlow[i]
      });
    }

    return result;
  }

  /**
   * Normaliza Price Sentiment
   */
  normalizePriceSentiment(priceSentiment, minValue, maxValue) {
    if (!priceSentiment || priceSentiment.length === 0) return [];

    const priceValues = priceSentiment.map(p => p.priceFlow);
    const priceMin = Math.min(...priceValues);
    const priceMax = Math.max(...priceValues);

    const priceRange = priceMax - priceMin;
    const valueRange = maxValue - minValue;

    if (priceRange === 0 || valueRange === 0) return priceSentiment;

    return priceSentiment.map(p => ({
      timestamp: p.timestamp,
      priceFlow: p.priceFlow,
      priceFlowNormalized: ((p.priceFlow - priceMin) / priceRange) * valueRange + minValue
    }));
  }

  /**
   * Renderiza el indicador según el modo actual
   */
  render(ctx, bounds, visibleCandles) {
    if (!this.enabled) return;
    if (!visibleCandles || visibleCandles.length === 0) return;

    if (!this.dataMap || this.data.length === 0) {
      this.renderNoDataMessage(ctx, bounds);
      return;
    }

    switch (this.mode) {
      case "histogram":
        this.renderHistogramMode(ctx, bounds, visibleCandles);
        break;
      case "cumulative":
        this.renderCumulativeMode(ctx, bounds, visibleCandles);
        break;
      case "flow":
        this.renderFlowMode(ctx, bounds, visibleCandles);
        break;
      default:
        this.renderHistogramMode(ctx, bounds, visibleCandles);
    }
  }

  /**
   * RENDER MODO 1: HISTOGRAM
   */
  renderHistogramMode(ctx, bounds, visibleCandles) {
    const { x, y, width, height } = bounds;
    const bullColor = "#1E88E5"; // Azul oscuro
    const bearColor = "#F57C00"; // Naranja oscuro

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Línea separadora
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Título
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText("Open Interest Delta (Histogram)", x + 5, y + 15);

    // Calcular datos
    const data = this.calculateHistogramMode(visibleCandles);
    if (data.length === 0) return;

    // Verificar cobertura de OI
    if (!data._hasOICoverage) {
      ctx.fillStyle = "#999";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(this._getOICoverageMessage(), x + 5, y + 30);
      return;
    }

    // Encontrar valor máximo para escala
    const maxDelta = Math.max(...data.map(d => Math.abs(d.delta)));

    if (maxDelta === 0) {
      const lastOI = data[data.length - 1]?.oiValue;
      if (lastOI) {
        ctx.fillStyle = "#999";
        ctx.font = "11px Inter, sans-serif";
        const formattedOI = lastOI >= 1e9 ? `${(lastOI / 1e9).toFixed(2)}B` :
                           lastOI >= 1e6 ? `${(lastOI / 1e6).toFixed(2)}M` :
                           lastOI >= 1e3 ? `${(lastOI / 1e3).toFixed(1)}K` : lastOI.toFixed(0);
        ctx.fillText(`OI: ${formattedOI} (sin cambios en rango visible)`, x + 5, y + 30);
      }
      return;
    }

    const histogramHeight = height - 25;
    const histogramY = y + 20;
    const barWidth = width / visibleCandles.length;
    const deltaScale = (histogramHeight / 2) / maxDelta;

    // Línea cero
    const zeroY = histogramY + histogramHeight / 2;
    ctx.strokeStyle = "#DDE2E7";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar barras
    data.forEach((d, i) => {
      const barX = x + (i * barWidth);
      const delta = d.delta;

      if (delta === 0) return;

      const barHeight = Math.abs(delta) * deltaScale;
      const color = delta >= 0 ? bullColor : bearColor;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;

      if (delta >= 0) {
        ctx.fillRect(barX, zeroY - barHeight, barWidth * 0.8, barHeight);
      } else {
        ctx.fillRect(barX, zeroY, barWidth * 0.8, barHeight);
      }
    });

    ctx.globalAlpha = 1.0;

    // Labels
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`+${maxDelta.toFixed(0)}`, x + width - 50, histogramY + 10);
    ctx.fillText(`-${maxDelta.toFixed(0)}`, x + width - 50, histogramY + histogramHeight - 5);

    // Valor actual
    if (data.length > 0) {
      const lastDelta = data[data.length - 1].delta;
      const lastOI = data[data.length - 1].oiValue;
      ctx.fillStyle = lastDelta >= 0 ? bullColor : bearColor;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(`Δ: ${lastDelta >= 0 ? '+' : ''}${lastDelta.toFixed(0)} | OI: ${lastOI.toFixed(0)}`, x + 5, histogramY + histogramHeight - 5);
    }
  }

  /**
   * RENDER MODO 2: CUMULATIVE
   */
  renderCumulativeMode(ctx, bounds, visibleCandles) {
    const { x, y, width, height } = bounds;
    const bullColor = "#1E88E5"; // Azul oscuro
    const bearColor = "#F57C00"; // Naranja oscuro

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Línea separadora
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Título
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText("Open Interest Cumulative Delta", x + 5, y + 15);

    // Calcular datos
    const data = this.calculateCumulativeMode(visibleCandles);
    if (data.length === 0) return;

    // Verificar cobertura de OI
    if (!data._hasOICoverage) {
      ctx.fillStyle = "#999";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(this._getOICoverageMessage(), x + 5, y + 30);
      return;
    }

    // Encontrar rango
    const cumulativeValues = [];
    data.forEach(d => {
      cumulativeValues.push(d.openCumulative);
      cumulativeValues.push(d.closeCumulative);
    });

    const minCumulative = Math.min(...cumulativeValues);
    const maxCumulative = Math.max(...cumulativeValues);
    const cumulativeRange = maxCumulative - minCumulative;

    if (cumulativeRange === 0) return;

    const chartHeight = height - 25;
    const chartY = y + 20;
    const barWidth = width / visibleCandles.length;
    const cumulativeScale = chartHeight / cumulativeRange;

    // Dibujar barras acumulativas
    data.forEach((d, i) => {
      const barX = x + (i * barWidth);

      const openY = chartY + chartHeight - ((d.openCumulative - minCumulative) * cumulativeScale);
      const closeY = chartY + chartHeight - ((d.closeCumulative - minCumulative) * cumulativeScale);

      const color = d.closeCumulative >= d.openCumulative ? bullColor : bearColor;

      const barHeight = Math.abs(closeY - openY);
      const minBarHeight = 2;

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6;

      if (barHeight < minBarHeight) {
        const avgY = (openY + closeY) / 2;
        ctx.fillRect(barX, avgY - minBarHeight/2, barWidth * 0.9, minBarHeight);
      } else {
        const topY = Math.min(openY, closeY);
        ctx.fillRect(barX, topY, barWidth * 0.9, Math.max(barHeight, minBarHeight));
      }
    });

    ctx.globalAlpha = 1.0;

    // Línea de cero
    if (minCumulative < 0 && maxCumulative > 0) {
      const zeroY = chartY + chartHeight - ((0 - minCumulative) * cumulativeScale);
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, zeroY);
      ctx.lineTo(x + width, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Labels
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`${maxCumulative.toFixed(0)}`, x + width - 50, chartY + 10);
    ctx.fillText(`${minCumulative.toFixed(0)}`, x + width - 50, chartY + chartHeight - 5);

    // Valor actual
    if (data.length > 0) {
      const lastCumulative = data[data.length - 1].closeCumulative;
      const lastOI = data[data.length - 1].oiValue;
      ctx.fillStyle = lastCumulative >= 0 ? bullColor : bearColor;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(`Cumulative: ${lastCumulative >= 0 ? '+' : ''}${lastCumulative.toFixed(0)} | OI: ${lastOI.toFixed(0)}`, x + 5, chartY + chartHeight - 5);
    }
  }

  /**
   * RENDER MODO 3: FLOW
   */
  renderFlowMode(ctx, bounds, visibleCandles) {
    const { x, y, width, height } = bounds;
    const bullColor = "#00897B";
    const bearColor = "#FF5252";
    const priceSentimentColor = "rgba(149, 152, 161, 0.5)";

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Línea separadora
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Título
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText(`Open Interest Flow Sentiment (Smoothing: ${this.smoothing})`, x + 5, y + 15);

    // Calcular datos
    const oiFlowData = this.calculateFlowMode(visibleCandles);
    if (oiFlowData.length === 0) return;

    // Verificar cobertura de OI
    if (!oiFlowData._hasOICoverage) {
      ctx.fillStyle = "#999";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(this._getOICoverageMessage(), x + 5, y + 30);
      return;
    }

    // Calcular Price Sentiment si está habilitado
    let priceSentimentData = [];
    if (this.showPriceSentiment) {
      priceSentimentData = this.calculatePriceSentiment(visibleCandles);
    }

    // Encontrar rango
    const oiFlowValues = oiFlowData.map(d => d.oiFlow);
    const minOIFlow = Math.min(...oiFlowValues);
    const maxOIFlow = Math.max(...oiFlowValues);
    const oiFlowRange = maxOIFlow - minOIFlow;

    if (oiFlowRange === 0) return;

    // Normalizar Price Sentiment
    if (this.showPriceSentiment && priceSentimentData.length > 0) {
      priceSentimentData = this.normalizePriceSentiment(priceSentimentData, minOIFlow, maxOIFlow);
    }

    const chartHeight = height - 25;
    const chartY = y + 20;
    const barWidth = width / visibleCandles.length;
    const oiScale = chartHeight / oiFlowRange;

    // Línea de cero
    if (minOIFlow < 0 && maxOIFlow > 0) {
      const zeroY = chartY + chartHeight - ((0 - minOIFlow) * oiScale);
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, zeroY);
      ctx.lineTo(x + width, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Dibujar barras
    oiFlowData.forEach((d, i) => {
      const barX = x + (i * barWidth);
      const value = d.oiFlow;

      const barHeight = Math.abs(value) * oiScale;
      const baseY = chartY + chartHeight - ((0 - minOIFlow) * oiScale);

      let color = bullColor;
      let alpha = 0.8;

      if (value > 0) {
        if (i > 0 && oiFlowData[i - 1].oiFlow > value) {
          alpha = 0.5;
        }
        color = bullColor;
      } else if (value < 0) {
        if (i > 0 && oiFlowData[i - 1].oiFlow < value) {
          alpha = 0.5;
        }
        color = bearColor;
      } else {
        return;
      }

      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;

      if (value >= 0) {
        ctx.fillRect(barX, baseY - barHeight, barWidth * 0.9, barHeight);
      } else {
        ctx.fillRect(barX, baseY, barWidth * 0.9, barHeight);
      }
    });

    ctx.globalAlpha = 1.0;

    // Dibujar Price Sentiment
    if (this.showPriceSentiment && priceSentimentData.length > 0) {
      ctx.strokeStyle = priceSentimentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();

      priceSentimentData.forEach((d, i) => {
        const pX = x + (i * barWidth) + (barWidth / 2);
        const pY = chartY + chartHeight - ((d.priceFlowNormalized - minOIFlow) * oiScale);

        if (i === 0) {
          ctx.moveTo(pX, pY);
        } else {
          ctx.lineTo(pX, pY);
        }
      });

      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`+${maxOIFlow.toFixed(0)}`, x + width - 60, chartY + 10);
    ctx.fillText(`${minOIFlow.toFixed(0)}`, x + width - 60, chartY + chartHeight - 5);

    // Valor actual
    if (oiFlowData.length > 0) {
      const lastOIFlow = oiFlowData[oiFlowData.length - 1].oiFlow;
      const lastOI = oiFlowData[oiFlowData.length - 1].oiValue;

      ctx.fillStyle = lastOIFlow >= 0 ? bullColor : bearColor;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(`OI Flow: ${lastOIFlow >= 0 ? '+' : ''}${lastOIFlow.toFixed(2)} | OI: ${lastOI.toFixed(0)}`, x + 5, chartY + chartHeight - 5);
    }
  }

  /**
   * Renderiza mensaje de no datos
   */
  renderNoDataMessage(ctx, bounds) {
    const { x, y, width, height } = bounds;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    ctx.fillStyle = "#FF9800";
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText(`No Open Interest data available for ${this.symbol}`, x + width / 2 - 120, y + height / 2);
  }

  /**
   * Actualiza configuración
   */
  updateConfig(config) {
    if (config.mode !== undefined) {
      this.mode = config.mode;
    }
    if (config.smoothing !== undefined) {
      this.smoothing = config.smoothing;
    }
    if (config.showPriceSentiment !== undefined) {
      this.showPriceSentiment = config.showPriceSentiment;
    }
  }
}

export default OpenInterestIndicator;
