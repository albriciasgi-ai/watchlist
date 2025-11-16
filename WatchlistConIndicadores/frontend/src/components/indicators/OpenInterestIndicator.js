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
    this.height = 100;
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
  }

  /**
   * Fetch Open Interest data from backend
   */
  async fetchData() {
    try {
      const url = `${API_BASE_URL}/api/open-interest/${this.symbol}?interval=${this.interval}&days=${this.days}`;
      console.log(`[${this.symbol}] 📊 Open Interest: Fetching from ${url}`);

      const response = await fetch(url);
      const result = await response.json();

      if (result.success && result.data && result.data.length > 0) {
        // Crear map de timestamp -> openInterest para búsqueda rápida
        this.dataMap = new Map();
        result.data.forEach(item => {
          this.dataMap.set(item.timestamp, item.openInterest);
        });

        this.data = result.data;

        console.log(`[${this.symbol}] ✅ Open Interest loaded: ${this.data.length} points`);
        console.log(`[${this.symbol}] 📊 OI Data Range: ${new Date(this.data[0].timestamp).toISOString()} → ${new Date(this.data[this.data.length-1].timestamp).toISOString()}`);
        console.log(`[${this.symbol}] 📊 First OI: ${this.data[0].openInterest}, Last OI: ${this.data[this.data.length-1].openInterest}`);
        return true;
      } else {
        console.warn(`[${this.symbol}] ⚠️ No Open Interest data available`);
        this.dataMap = null;
        this.data = [];
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error fetching Open Interest:`, error);
      this.dataMap = null;
      this.data = [];
      return false;
    }
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
   * Busca el valor de OI más cercano al timestamp de la vela
   * Tolerancia: +/- 5 minutos
   */
  findClosestOI(candleTimestamp) {
    const tolerance = 5 * 60 * 1000; // 5 minutos en ms

    // Primero intentar match exacto
    if (this.dataMap.has(candleTimestamp)) {
      return this.dataMap.get(candleTimestamp);
    }

    // Buscar el más cercano dentro de la tolerancia
    let closestValue = null;
    let minDiff = Infinity;

    for (const [ts, value] of this.dataMap) {
      const diff = Math.abs(ts - candleTimestamp);
      if (diff <= tolerance && diff < minDiff) {
        minDiff = diff;
        closestValue = value;
      }
    }

    // Debug: log si no encuentra nada (solo una vez para no saturar)
    if (closestValue === null && !this._loggedNoMatch) {
      const candleDate = new Date(candleTimestamp).toISOString();
      const oiTimestamps = Array.from(this.dataMap.keys()).slice(0, 3).map(t => new Date(t).toISOString());
      console.log(`[${this.symbol}] ⚠️ No OI match found for candle ${candleDate}. Sample OI timestamps:`, oiTimestamps);
      this._loggedNoMatch = true;
    }

    return closestValue;
  }

  /**
   * MODO 1: HISTOGRAM - Delta simple de OI (como Volume Delta)
   * Calcula: OI[i] - OI[i-1]
   */
  calculateHistogramMode(candles) {
    if (!candles || candles.length === 0 || !this.dataMap) return [];

    const result = [];
    let lastOIValue = null;
    let exactMatches = 0;
    let nonZeroDeltas = 0;

    // Encontrar primer valor de OI
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        lastOIValue = item.openInterest;
        break;
      }
    }

    if (lastOIValue === null) return [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const oiValue = this.findClosestOI(candle.timestamp);

      if (oiValue !== null && oiValue !== undefined) exactMatches++;

      let currentOI = oiValue !== null && oiValue !== undefined ? oiValue : lastOIValue;
      const delta = i === 0 ? 0 : currentOI - lastOIValue;

      if (delta !== 0) nonZeroDeltas++;

      result.push({
        timestamp: candle.timestamp,
        delta: delta,
        oiValue: currentOI
      });

      lastOIValue = currentOI;
    }

    console.log(`[${this.symbol}] 📊 Histogram Mode: ${candles.length} candles, ${exactMatches} OI matches, ${nonZeroDeltas} non-zero deltas`);

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

    // Encontrar primer valor de OI
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        lastOIValue = item.openInterest;
        break;
      }
    }

    if (lastOIValue === null) return [];

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const oiValue = this.findClosestOI(candle.timestamp);

      let currentOI = oiValue !== null && oiValue !== undefined ? oiValue : lastOIValue;
      const delta = i === 0 ? 0 : currentOI - lastOIValue;

      const previousCumulative = cumulativeDelta;
      cumulativeDelta += delta;

      result.push({
        timestamp: candle.timestamp,
        openCumulative: previousCumulative,
        closeCumulative: cumulativeDelta,
        delta: delta,
        oiValue: currentOI
      });

      lastOIValue = currentOI;
    }

    return result;
  }

  /**
   * MODO 3: FLOW - OI Flow Sentiment con EMA (LuxAlgo)
   */
  calculateFlowMode(candles) {
    if (!candles || candles.length === 0 || !this.dataMap) return [];

    const oiValues = [];
    const timestamps = [];

    // Encontrar primer valor de OI
    let firstOIValue = null;
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        firstOIValue = item.openInterest;
        break;
      }
    }

    if (firstOIValue === null) return [];

    // Rellenar array de OI values
    let lastKnownOI = firstOIValue;

    for (const candle of candles) {
      const oiValue = this.findClosestOI(candle.timestamp);

      if (oiValue !== undefined && oiValue !== null) {
        lastKnownOI = oiValue;
        oiValues.push(oiValue);
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
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;
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
    console.log(`[${this.symbol}] 🎨 RENDER Histogram: data.length=${data.length}`);
    if (data.length === 0) {
      console.log(`[${this.symbol}] ❌ RENDER: No data, exiting`);
      return;
    }

    // Encontrar valor máximo para escala
    const deltas = data.map(d => d.delta);
    const maxDelta = Math.max(...data.map(d => Math.abs(d.delta)));
    console.log(`[${this.symbol}] 🎨 RENDER: maxDelta=${maxDelta}, sample deltas:`, deltas.slice(0, 10));

    if (maxDelta === 0) {
      console.log(`[${this.symbol}] ❌ RENDER: maxDelta is 0, no bars to draw`);
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
