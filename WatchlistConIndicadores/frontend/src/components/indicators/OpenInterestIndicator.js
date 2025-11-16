// src/components/indicators/OpenInterestIndicator.js
// Indicador de Open Interest con datos de Bybit

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";

class OpenInterestIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval);
    this.name = "Open Interest";
    this.height = 80;
    this.days = days;

    // Almacenar datos de Open Interest
    this.oiData = [];
    this.dataMap = new Map(); // timestamp -> data
    this.isLoading = false;
  }

  async fetchData() {
    try {
      this.isLoading = true;
      const url = `${API_BASE_URL}/api/open-interest/${this.symbol}?interval=${this.interval}&days=${this.days}`;

      console.log(`[${this.symbol}] 📊 Open Interest: Fetching from ${url}`);

      const response = await fetch(url);
      const result = await response.json();

      if (result.success && result.data) {
        this.oiData = result.data;

        // Crear mapa de timestamp -> data para búsqueda rápida
        this.dataMap.clear();
        this.oiData.forEach(point => {
          this.dataMap.set(point.timestamp, point);
        });

        console.log(`[${this.symbol}] ✅ Open Interest: Cargados ${this.oiData.length} puntos`);
        console.log(`[${this.symbol}] 📊 OI Range: ${this.oiData[0]?.openInterest.toFixed(0)} → ${this.oiData[this.oiData.length - 1]?.openInterest.toFixed(0)}`);

        this.isLoading = false;
        return true;
      } else {
        console.error(`[${this.symbol}] ❌ Error fetching Open Interest:`, result.error);
        this.isLoading = false;
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error fetching Open Interest:`, error);
      this.isLoading = false;
      return false;
    }
  }

  // Mapear datos de OI a las velas visibles
  mapDataToCandles(candles) {
    if (!candles || candles.length === 0 || this.oiData.length === 0) {
      return [];
    }

    const mappedData = [];
    const oiDataByTimestamp = new Map();

    // Crear mapa de timestamps de OI
    this.oiData.forEach(point => {
      oiDataByTimestamp.set(point.timestamp, point);
    });

    // Para cada vela, buscar el dato de OI correspondiente
    for (const candle of candles) {
      const oiPoint = oiDataByTimestamp.get(candle.timestamp);

      if (oiPoint) {
        mappedData.push({
          timestamp: candle.timestamp,
          openInterest: oiPoint.openInterest,
          openInterestDelta: oiPoint.openInterestDelta,
          datetime: candle.datetime_colombia || oiPoint.datetime_colombia,
          in_progress: candle.in_progress || false
        });
      } else {
        // Si no hay dato de OI para esta vela, usar delta 0
        mappedData.push({
          timestamp: candle.timestamp,
          openInterest: null,
          openInterestDelta: 0,
          datetime: candle.datetime_colombia,
          in_progress: candle.in_progress || false
        });
      }
    }

    return mappedData;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;

    const { x, y, width, height } = bounds;
    const bullColor = "#00BFFF"; // Azul para incrementos
    const bearColor = "#FF6B6B"; // Rojo para decrementos

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Linea separadora superior
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Titulo
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText(`Open Interest Delta`, x + 5, y + 15);

    // Si está cargando, mostrar mensaje
    if (this.isLoading) {
      ctx.fillStyle = "#999";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("Cargando datos de OI...", x + 150, y + 15);
      return;
    }

    // Mapear datos de OI a las velas visibles
    const mappedData = this.mapDataToCandles(visibleCandles);

    if (mappedData.length === 0) {
      ctx.fillStyle = "#999";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("Sin datos de OI", x + 150, y + 15);
      return;
    }

    // Contar cuántas barras tienen datos válidos
    const validDeltas = mappedData.filter(d => d.openInterestDelta !== 0);
    const nonZeroDeltas = validDeltas.filter(d => d.openInterestDelta !== 0);

    console.log(`[${this.symbol}] 📊 Histogram Mode: ${mappedData.length} candles, ${validDeltas.length} OI matches, ${nonZeroDeltas.length} non-zero deltas`);

    // Encontrar valor máximo para escala (ignorar el primer punto que siempre es 0)
    const deltas = mappedData.slice(1).map(d => Math.abs(d.openInterestDelta)).filter(d => d > 0);
    const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;

    if (maxDelta === 0) {
      ctx.fillStyle = "#999";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("Sin cambios en OI", x + 150, y + 15);
      return;
    }

    console.log(`[${this.symbol}] 🎨 RENDER: maxDelta=${maxDelta}`);

    const histogramHeight = height - 25;
    const histogramY = y + 20;
    const barWidth = width / visibleCandles.length;
    const deltaScale = (histogramHeight / 2) / maxDelta;

    // Linea cero del histograma
    const zeroY = histogramY + histogramHeight / 2;
    ctx.strokeStyle = "#DDE2E7";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    console.log(`[${this.symbol}] 🎨 RENDER Histogram: data.length=${mappedData.length}`);

    // Dibujar histograma de Open Interest Delta
    mappedData.forEach((d, i) => {
      const barX = x + (i * barWidth);
      const delta = d.openInterestDelta;

      // Ignorar el primer punto (siempre delta 0) y deltas muy pequeños
      if (i === 0 || Math.abs(delta) < maxDelta * 0.01) return;

      const barHeight = Math.abs(delta) * deltaScale;
      const color = delta >= 0 ? bullColor : bearColor;

      ctx.fillStyle = color;

      // Si es vela en progreso, usar transparencia reducida
      if (d.in_progress) {
        ctx.globalAlpha = 0.5;
      } else {
        ctx.globalAlpha = 0.7;
      }

      if (delta >= 0) {
        // Barra positiva (hacia arriba) - Incremento de OI
        ctx.fillRect(barX, zeroY - barHeight, barWidth * 0.8, barHeight);
      } else {
        // Barra negativa (hacia abajo) - Decremento de OI
        ctx.fillRect(barX, zeroY, barWidth * 0.8, barHeight);
      }
    });

    ctx.globalAlpha = 1.0;

    // Labels de escala
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`+${this.formatOI(maxDelta)}`, x + width - 60, histogramY + 10);
    ctx.fillText(`-${this.formatOI(maxDelta)}`, x + width - 60, histogramY + histogramHeight - 5);

    // Valor de la última barra
    if (mappedData.length > 0) {
      const lastData = mappedData[mappedData.length - 1];
      const lastDelta = lastData.openInterestDelta;
      const lastOI = lastData.openInterest;

      if (lastOI !== null) {
        // Mostrar OI actual y delta
        ctx.fillStyle = "#666";
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.fillText(`OI: ${this.formatOI(lastOI)}`, x + 5, histogramY + histogramHeight - 15);

        if (lastDelta !== 0) {
          const deltaColor = lastDelta >= 0 ? bullColor : bearColor;
          ctx.fillStyle = deltaColor;
          ctx.fillText(`Δ: ${lastDelta >= 0 ? '+' : ''}${this.formatOI(lastDelta)}`, x + 5, histogramY + histogramHeight - 5);
        }
      }
    }
  }

  // Formatear números de OI (puede ser muy grande)
  formatOI(value) {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(2)}M`;
    } else if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    } else {
      return value.toFixed(0);
    }
  }
}

export default OpenInterestIndicator;
