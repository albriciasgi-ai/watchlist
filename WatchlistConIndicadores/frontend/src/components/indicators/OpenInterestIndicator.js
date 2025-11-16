// src/components/indicators/OpenInterestIndicator.js
// ✅ INDICADOR DE OPEN INTEREST COMPLETO
// Muestra todas las barras de Open Interest correctamente en todos los timeframes

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";

class OpenInterestIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval);
    this.name = "Open Interest";
    this.height = 100;
    this.days = days;
    this.dataMap = new Map(); // Map de timestamp -> openInterest value
    this.showAsOverlay = false; // Opción para mostrar como overlay en el chart principal
    this.color = "#9C27B0"; // Color morado para Open Interest
  }

  async fetchData() {
    const startTime = Date.now();
    console.log(`[${this.symbol}] 📊 Open Interest: Fetching from ${API_BASE_URL}/api/open-interest/${this.symbol}?interval=${this.interval}&days=${this.days}`);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/open-interest/${this.symbol}?interval=${this.interval}&days=${this.days}`
      );

      if (!response.ok) {
        console.error(`[${this.symbol}] ❌ Error fetching Open Interest: ${response.status}`);
        return false;
      }

      const result = await response.json();

      if (!result.success || !result.data) {
        console.error(`[${this.symbol}] ❌ Open Interest: Invalid response`);
        return false;
      }

      // Construir dataMap con timestamp como clave
      this.dataMap = new Map();
      result.data.forEach(point => {
        this.dataMap.set(point.timestamp, point.openInterest);
      });

      const duration = Date.now() - startTime;
      const cacheInfo = result.from_cache ? `cache (${result.cache_age_seconds}s)` : "API";

      console.log(
        `[${this.symbol}] ✅ Open Interest: ${result.total_points} puntos desde ${cacheInfo} ` +
        `(${result.days_fetched} días @ ${result.interval}) - ${duration}ms`
      );

      this.data = result.data;
      return true;

    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error fetching Open Interest:`, error);
      return false;
    }
  }

  processRealtimeData(wsData) {
    // Open Interest no se actualiza en tiempo real vía WebSocket en Bybit
    // Se actualiza cada cierto intervalo
    // Podríamos implementar un refresh periódico si es necesario
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;
    if (this.dataMap.size === 0) return;

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

    // Título
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText("Open Interest", x + 5, y + 15);

    // Obtener datos de Open Interest para las velas visibles
    const oiValues = [];
    const timestamps = [];

    visibleCandles.forEach(candle => {
      const oiValue = this.dataMap.get(candle.timestamp);
      if (oiValue !== undefined) {
        oiValues.push(oiValue);
        timestamps.push(candle.timestamp);
      } else {
        oiValues.push(null);
        timestamps.push(candle.timestamp);
      }
    });

    // Filtrar valores válidos para calcular escala
    const validValues = oiValues.filter(v => v !== null && v !== undefined);

    if (validValues.length === 0) {
      ctx.fillStyle = "#999";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("No hay datos de Open Interest disponibles", x + 5, y + 50);
      return;
    }

    const maxOI = Math.max(...validValues);
    const minOI = Math.min(...validValues);
    const oiRange = maxOI - minOI;

    if (oiRange === 0) return;

    const chartHeight = height - 30;
    const chartY = y + 20;
    const barWidth = width / visibleCandles.length;

    // Escala para mapear valores de OI al espacio vertical
    const oiScale = chartHeight / oiRange;

    // Dibujar línea base (valor mínimo)
    const baseY = chartY + chartHeight;
    ctx.strokeStyle = "#E0E0E0";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(x + width, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar barras de Open Interest
    ctx.fillStyle = this.color;
    ctx.globalAlpha = 0.6;

    oiValues.forEach((oiValue, i) => {
      if (oiValue === null || oiValue === undefined) return;

      const barX = x + (i * barWidth);
      const barHeight = (oiValue - minOI) * oiScale;
      const barY = baseY - barHeight;

      ctx.fillRect(barX, barY, barWidth * 0.9, barHeight);
    });

    ctx.globalAlpha = 1.0;

    // Dibujar línea de tendencia (opcional)
    if (validValues.length > 1) {
      ctx.strokeStyle = "#7B1FA2";
      ctx.lineWidth = 2;
      ctx.beginPath();

      let firstPoint = true;
      oiValues.forEach((oiValue, i) => {
        if (oiValue === null || oiValue === undefined) return;

        const barX = x + (i * barWidth) + (barWidth / 2);
        const barHeight = (oiValue - minOI) * oiScale;
        const barY = baseY - barHeight;

        if (firstPoint) {
          ctx.moveTo(barX, barY);
          firstPoint = false;
        } else {
          ctx.lineTo(barX, barY);
        }
      });

      ctx.stroke();
    }

    // Labels de escala
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(this.formatOI(maxOI), x + width - 5, chartY + 12);
    ctx.fillText(this.formatOI(minOI), x + width - 5, baseY - 5);
    ctx.textAlign = "left";

    // Valor actual (última barra)
    const lastValidIndex = oiValues.length - 1;
    let lastOI = oiValues[lastValidIndex];

    // Si la última barra no tiene valor, buscar el último valor válido
    if (lastOI === null || lastOI === undefined) {
      for (let i = lastValidIndex; i >= 0; i--) {
        if (oiValues[i] !== null && oiValues[i] !== undefined) {
          lastOI = oiValues[i];
          break;
        }
      }
    }

    if (lastOI !== null && lastOI !== undefined) {
      // Calcular cambio porcentual si hay datos suficientes
      let changePercent = 0;
      let changeColor = "#666";

      if (validValues.length >= 2) {
        const prevOI = validValues[validValues.length - 2];
        if (prevOI > 0) {
          changePercent = ((lastOI - prevOI) / prevOI) * 100;
          changeColor = changePercent >= 0 ? "#34C759" : "#FF3B30";
        }
      }

      ctx.fillStyle = this.color;
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText(`OI: ${this.formatOI(lastOI)}`, x + 5, baseY - 5);

      if (Math.abs(changePercent) >= 0.01) {
        ctx.fillStyle = changeColor;
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.fillText(
          `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
          x + 5,
          baseY - 18
        );
      }
    }

    // Info adicional: total de barras mostradas
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${validValues.length} barras`, x + width - 5, y + 15);
    ctx.textAlign = "left";
  }

  // Método auxiliar para formatear valores de Open Interest
  formatOI(value) {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(2)}K`;
    } else {
      return value.toFixed(2);
    }
  }

  // Método para configurar opciones del indicador
  applyConfig(config) {
    if (config.showAsOverlay !== undefined) {
      this.showAsOverlay = config.showAsOverlay;
    }
    if (config.color) {
      this.color = config.color;
    }
    if (config.height) {
      this.height = config.height;
    }
  }
}

export default OpenInterestIndicator;
