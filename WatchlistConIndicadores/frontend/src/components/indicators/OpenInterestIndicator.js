// src/components/indicators/OpenInterestIndicator.js
// Open Interest Flow & Price Sentiment Indicator
// Basado en LuxAlgo Open Interest Inflows & Outflows
// Implementación Híbrida: OI Flow Sentiment + Price Sentiment (sin Correlation)

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";

class OpenInterestIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Open Interest";
    this.height = 100;
    this.days = days;

    // Configuración
    this.smoothing = 3; // Suavizado para EMA (configurable)
    this.showPriceSentiment = true; // Toggle para mostrar/ocultar Price Sentiment

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
   * @param {Array} values - Array de valores
   * @param {number} period - Periodo de la EMA
   * @returns {Array} - Array de valores EMA
   */
  calculateEMA(values, period) {
    if (!values || values.length === 0) return [];

    const k = 2 / (period + 1); // Multiplier
    const ema = [];

    // Primer valor = primer valor de la serie
    ema[0] = values[0];

    // Calcular EMA para el resto
    for (let i = 1; i < values.length; i++) {
      ema[i] = (values[i] * k) + (ema[i - 1] * (1 - k));
    }

    return ema;
  }

  /**
   * Calcula OI Flow Sentiment basado en fórmula LuxAlgo
   * oiF = EMA(oiH + oiL - 2 * EMA(oiC, 13), smoothing)
   *
   * Como solo tenemos un valor de OI por timestamp (no OHLC de OI),
   * usamos una aproximación simplificada:
   * oiF = EMA(oiValue - EMA(oiValue, 13), smoothing)
   */
  calculateOIFlowSentiment(candles) {
    if (!candles || candles.length === 0 || !this.dataMap) return [];

    const oiValues = [];
    const timestamps = [];

    // PASO 1: Encontrar el primer valor de OI disponible
    let firstOIValue = null;
    for (const item of this.data) {
      if (item.openInterest !== undefined && item.openInterest !== null) {
        firstOIValue = item.openInterest;
        break;
      }
    }

    // Si no hay ningún valor de OI, retornar vacío
    if (firstOIValue === null) return [];

    // PASO 2: Construir array de valores OI para todas las velas
    // Rellenar con el primer valor conocido hasta encontrar datos reales
    let lastKnownOI = firstOIValue;

    for (const candle of candles) {
      const oiValue = this.dataMap.get(candle.timestamp);

      if (oiValue !== undefined && oiValue !== null) {
        // Tenemos dato real de OI
        lastKnownOI = oiValue;
        oiValues.push(oiValue);
      } else {
        // No hay dato - usar el último conocido (forward fill)
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

    // Construir resultado con timestamps
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
   * Calcula Price Sentiment basado en fórmula LuxAlgo
   * prF = EMA(h + l - 2 * EMA(c, 13), smoothing)
   */
  calculatePriceSentiment(candles) {
    if (!candles || candles.length === 0) return [];

    const closeValues = candles.map(c => c.close);

    // Calcular EMA(close, 13)
    const emaClose13 = this.calculateEMA(closeValues, 13);

    // Calcular: (high + low) - 2 * EMA(close, 13)
    const priceDiff = [];
    for (let i = 0; i < candles.length; i++) {
      priceDiff[i] = (candles[i].high + candles[i].low) - (2 * emaClose13[i]);
    }

    // Aplicar smoothing: EMA(priceDiff, smoothing)
    const priceFlow = this.calculateEMA(priceDiff, this.smoothing);

    // Construir resultado
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
   * Normaliza Price Sentiment al rango de OI Flow para superposición visual
   */
  normalizePriceSentiment(priceSentiment, oiFlowMin, oiFlowMax) {
    if (!priceSentiment || priceSentiment.length === 0) return [];

    // Encontrar rango de Price Sentiment
    const priceValues = priceSentiment.map(p => p.priceFlow);
    const priceMin = Math.min(...priceValues);
    const priceMax = Math.max(...priceValues);

    const priceRange = priceMax - priceMin;
    const oiRange = oiFlowMax - oiFlowMin;

    if (priceRange === 0 || oiRange === 0) return priceSentiment;

    // Normalizar
    return priceSentiment.map(p => ({
      timestamp: p.timestamp,
      priceFlow: p.priceFlow,
      priceFlowNormalized: ((p.priceFlow - priceMin) / priceRange) * oiRange + oiFlowMin
    }));
  }

  /**
   * Renderiza el indicador Open Interest
   */
  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;
    if (!this.dataMap || this.data.length === 0) {
      this.renderNoDataMessage(ctx, bounds);
      return;
    }

    const { x, y, width, height } = bounds;

    // Colores (siguiendo el patrón LuxAlgo)
    const bullColor = "#00897B"; // Verde teal (OI Flow positivo)
    const bearColor = "#FF5252"; // Rojo (OI Flow negativo)
    const priceSentimentColor = "rgba(149, 152, 161, 0.5)"; // Gris transparente

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Línea separadora superior
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Título
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText(`Open Interest Flow & Price Sentiment (Smoothing: ${this.smoothing})`, x + 5, y + 15);

    // Calcular OI Flow Sentiment
    const oiFlowData = this.calculateOIFlowSentiment(visibleCandles);

    if (oiFlowData.length === 0) {
      this.renderNoDataMessage(ctx, bounds);
      return;
    }

    // Calcular Price Sentiment (si está habilitado)
    let priceSentimentData = [];
    if (this.showPriceSentiment) {
      priceSentimentData = this.calculatePriceSentiment(visibleCandles);
    }

    // Encontrar rango de valores para escala
    const oiFlowValues = oiFlowData.map(d => d.oiFlow);
    const minOIFlow = Math.min(...oiFlowValues);
    const maxOIFlow = Math.max(...oiFlowValues);
    const oiFlowRange = maxOIFlow - minOIFlow;

    if (oiFlowRange === 0) return;

    // Normalizar Price Sentiment al rango de OI Flow
    if (this.showPriceSentiment && priceSentimentData.length > 0) {
      priceSentimentData = this.normalizePriceSentiment(
        priceSentimentData,
        minOIFlow,
        maxOIFlow
      );
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

    // Dibujar barras de OI Flow Sentiment (estilo columnas)
    oiFlowData.forEach((d, i) => {
      const barX = x + (i * barWidth);
      const value = d.oiFlow;

      // Calcular altura de barra
      const barHeight = Math.abs(value) * oiScale;
      const baseY = chartY + chartHeight - ((0 - minOIFlow) * oiScale);

      // Color: verde si positivo (o si sube), rojo si negativo (o si baja)
      let color = bullColor;
      let alpha = 0.8;

      if (value > 0) {
        // Positivo - verificar si está subiendo o bajando
        if (i > 0 && oiFlowData[i - 1].oiFlow > value) {
          alpha = 0.5; // Más transparente si está bajando
        }
        color = bullColor;
      } else if (value < 0) {
        // Negativo - verificar si está bajando más o recuperando
        if (i > 0 && oiFlowData[i - 1].oiFlow < value) {
          alpha = 0.5; // Más transparente si está recuperando
        }
        color = bearColor;
      } else {
        return; // No dibujar barras con valor 0
      }

      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;

      if (value >= 0) {
        // Barra positiva (hacia arriba)
        ctx.fillRect(barX, baseY - barHeight, barWidth * 0.9, barHeight);
      } else {
        // Barra negativa (hacia abajo)
        ctx.fillRect(barX, baseY, barWidth * 0.9, barHeight);
      }
    });

    ctx.globalAlpha = 1.0;

    // Dibujar Price Sentiment (línea superpuesta)
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

    // Labels de escala
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`+${maxOIFlow.toFixed(0)}`, x + width - 60, chartY + 10);
    ctx.fillText(`${minOIFlow.toFixed(0)}`, x + width - 60, chartY + chartHeight - 5);

    // Valor actual de OI Flow
    if (oiFlowData.length > 0) {
      const lastOIFlow = oiFlowData[oiFlowData.length - 1].oiFlow;
      const lastOI = oiFlowData[oiFlowData.length - 1].oiValue;

      ctx.fillStyle = lastOIFlow >= 0 ? bullColor : bearColor;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(
        `OI Flow: ${lastOIFlow >= 0 ? '+' : ''}${lastOIFlow.toFixed(2)} | OI: ${lastOI.toFixed(0)}`,
        x + 5,
        chartY + chartHeight - 5
      );
    }
  }

  /**
   * Renderiza mensaje cuando no hay datos
   */
  renderNoDataMessage(ctx, bounds) {
    const { x, y, width, height } = bounds;

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Línea separadora superior
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Mensaje
    ctx.fillStyle = "#FF9800";
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText(
      `No Open Interest data available for ${this.symbol}`,
      x + width / 2 - 120,
      y + height / 2
    );
  }

  /**
   * Actualiza configuración del indicador
   */
  updateConfig(config) {
    if (config.smoothing !== undefined) {
      this.smoothing = config.smoothing;
    }
    if (config.showPriceSentiment !== undefined) {
      this.showPriceSentiment = config.showPriceSentiment;
    }
  }
}

export default OpenInterestIndicator;
