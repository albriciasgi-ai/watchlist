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
    
    for (const candle of candles) {
      // ✅ YA NO ignoramos velas en progreso
      // Las procesamos igual para mostrar la última barra en tiempo real
      
      // ✅ FÓRMULA: Si cierra arriba del open = volumen positivo, si cierra abajo = volumen negativo
      let volumeDelta;
      
      if (candle.close > candle.open) {
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

  /**
   * 🔔 NUEVO: Verificar y generar alertas para Volume Delta significativo
   */
  checkVolumeDeltaAlerts(volumeDeltaData, currentPrice) {
    if (!volumeDeltaData || volumeDeltaData.length < 10 || !window.addWatchlistAlert) return;

    const now = Date.now();
    const cooldownPeriod = 3600000; // 1 hora

    // Obtener las últimas N velas para calcular promedio
    const lookbackPeriod = Math.min(20, volumeDeltaData.length - 1);
    const recentData = volumeDeltaData.slice(-lookbackPeriod - 1, -1); // Excluir la última
    const currentData = volumeDeltaData[volumeDeltaData.length - 1];

    // Calcular promedio de delta absoluto
    const avgAbsDelta = recentData.reduce((sum, d) => sum + Math.abs(d.volumeDelta), 0) / recentData.length;

    if (avgAbsDelta === 0) return;

    // Calcular multiplicador del delta actual vs promedio
    const currentAbsDelta = Math.abs(currentData.volumeDelta);
    const deltaMultiplier = currentAbsDelta / avgAbsDelta;

    // Verificar cooldown
    const alertKey = `vol_delta_alert_${this.symbol}_${Math.floor(now / cooldownPeriod)}`;
    const lastAlertTime = localStorage.getItem(alertKey);

    if (lastAlertTime && (now - parseInt(lastAlertTime)) < cooldownPeriod) {
      return; // Skip if in cooldown
    }

    // Determinar dirección y tipo
    const direction = currentData.volumeDelta >= 0 ? 'alcista' : 'bajista';
    const icon = currentData.volumeDelta >= 0 ? '🟢' : '🔴';

    // Generar alerta
    window.addWatchlistAlert({
      indicatorType: 'Volume Delta',
      severity: 'MEDIUM', // Will be recalculated by addAlert based on profile
      icon: icon,
      title: `${this.symbol} Volume Delta ${direction} significativo`,
      symbol: this.symbol,
      interval: this.interval,
      type: 'Volume Delta Spike',
      description: `Volume Delta ${direction}: ${currentData.volumeDelta.toFixed(0)}\nPromedio: ${avgAbsDelta.toFixed(0)}\nMultiplicador: ${deltaMultiplier.toFixed(2)}x`,
      data: {
        price: currentPrice,
        volumeDelta: currentData.volumeDelta,
        avgVolumeDelta: avgAbsDelta,
        multiplier: deltaMultiplier,
        direction: direction
      }
    });

    // Guardar timestamp de la alerta
    localStorage.setItem(alertKey, now.toString());
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
    ctx.fillText("Volume Delta (Real-time)", x + 5, y + 15);

    // ✅ CALCULAR en tiempo real desde las velas visibles
    const volumeDeltaData = this.calculateVolumeDelta(visibleCandles);

    if (volumeDeltaData.length === 0) return;

    // 🔔 NUEVO: Verificar alertas de Volume Delta
    if (visibleCandles && visibleCandles.length > 0) {
      const currentPrice = visibleCandles[visibleCandles.length - 1].close;
      this.checkVolumeDeltaAlerts(volumeDeltaData, currentPrice);
    }

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
