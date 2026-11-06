// src/components/indicators/VolumeIndicator.js
// ✅ SOLUCIÓN DEFINITIVA: Cálculo de Volume Delta en tiempo real desde las velas
// ✅ CORREGIDO: INCLUYE vela en progreso para mostrar última barra en tiempo real

import IndicatorBase from "./IndicatorBase";

class VolumeIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval);
    this.name = "Volume Delta";
    this.height = 80;
    this.days = days;
    
    // ✅ Ya NO necesitamos dataMap del backend
    this.dataMap = null;

    // Order Flow: entrega el delta real cuando tiene todas las velas pedidas
    this.deltaSource = null;
    this.usesRealDelta = false;
  }

  setDeltaSource(source) {
    this.deltaSource = source;
  }

  async fetchData() {
    // ✅ Ya NO necesitamos cargar datos del backend
    // El cálculo se hace en tiempo real desde las velas
    console.log(`[${this.symbol}] 📊 Volume Delta: Calculado en tiempo real desde velas`);
    this.data = [];
    return true;
  }

  // ✅ NUEVO: Calcular Volume Delta directamente desde las velas
  // ✅ CORREGIDO: Ahora INCLUYE velas en progreso
  calculateVolumeDelta(candles) {
    if (!candles || candles.length === 0) return [];
    
    const volumeDeltaData = [];
    
    const realDeltas = this.deltaSource?.realDeltas(candles) ?? null;
    this.usesRealDelta = !!realDeltas;

    for (const [index, candle] of candles.entries()) {
      // ✅ YA NO ignoramos velas en progreso
      // Las procesamos igual para mostrar la última barra en tiempo real
      
      // ✅ FÓRMULA: Si cierra arriba del open = volumen positivo, si cierra abajo = volumen negativo
      let volumeDelta;
      
      if (realDeltas) {
        volumeDelta = realDeltas[index];
      } else if (candle.close > candle.open) {
        // Vela alcista (verde) - Volumen de compra
        volumeDelta = candle.volume;
      } else if (candle.close < candle.open) {
        // Vela bajista (roja) - Volumen de venta
        volumeDelta = -candle.volume;
      } else {
        // Vela doji (cierre = open) - Neutral
        volumeDelta = 0;
      }
      
      volumeDeltaData.push({
        timestamp: candle.timestamp,
        volumeDelta: volumeDelta,
        datetime: candle.datetime_colombia,
        in_progress: candle.in_progress || false
      });
    }
    
    return volumeDeltaData;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;

    const { x, y, width, height } = bounds;
    const bullColor = "#34C759";
    const bearColor = "#FF3B30";

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

    // ✅ CALCULAR en tiempo real desde las velas visibles
    const volumeDeltaData = this.calculateVolumeDelta(visibleCandles);
    ctx.fillText(this.usesRealDelta ? "Volume Delta (trades reales)" : "Volume Delta (Real-time)", x + 5, y + 15);
    
    if (volumeDeltaData.length === 0) return;

    // Encontrar valor máximo para escala
    const maxVolumeDelta = Math.max(...volumeDeltaData.map(d => Math.abs(d.volumeDelta)));
    
    if (maxVolumeDelta === 0) return;

    const histogramHeight = height - 25;
    const histogramY = y + 20;
    const barWidth = width / visibleCandles.length;
    const volumeScale = (histogramHeight / 2) / maxVolumeDelta;

    // Linea cero del histograma
    const zeroY = histogramY + histogramHeight / 2;
    ctx.strokeStyle = "#DDE2E7";
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar histograma de Volume Delta
    volumeDeltaData.forEach((d, i) => {
      const barX = x + (i * barWidth);
      const delta = d.volumeDelta;
      
      if (delta === 0) return; // No dibujar barras con delta 0
      
      const barHeight = Math.abs(delta) * volumeScale;
      const color = delta >= 0 ? bullColor : bearColor;
      
      ctx.fillStyle = color;
      
      // ✅ Si es vela en progreso, usar transparencia reducida para indicar que es temporal
      if (d.in_progress) {
        ctx.globalAlpha = 0.5;
      } else {
        ctx.globalAlpha = 0.7;
      }
      
      if (delta >= 0) {
        // Barra positiva (hacia arriba)
        ctx.fillRect(barX, zeroY - barHeight, barWidth * 0.8, barHeight);
      } else {
        // Barra negativa (hacia abajo)
        ctx.fillRect(barX, zeroY, barWidth * 0.8, barHeight);
      }
    });

    ctx.globalAlpha = 1.0;

    // Labels de escala
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`+${maxVolumeDelta.toFixed(0)}`, x + width - 50, histogramY + 10);
    ctx.fillText(`-${maxVolumeDelta.toFixed(0)}`, x + width - 50, histogramY + histogramHeight - 5);
    
    // Valor de la última barra
    if (volumeDeltaData.length > 0) {
      const lastDelta = volumeDeltaData[volumeDeltaData.length - 1].volumeDelta;
      const color = lastDelta >= 0 ? bullColor : bearColor;
      ctx.fillStyle = color;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(`Δ: ${lastDelta >= 0 ? '+' : ''}${lastDelta.toFixed(0)}`, x + 5, histogramY + histogramHeight - 5);
    }
  }
}

export default VolumeIndicator;
