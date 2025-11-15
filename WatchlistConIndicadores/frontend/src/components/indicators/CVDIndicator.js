// src/components/indicators/CVDIndicator.js
// ✅ SOLUCIÓN DEFINITIVA: Cálculo de CVD en tiempo real desde las velas
// ✅ CORREGIDO: INCLUYE vela en progreso para mostrar última barra en tiempo real

import IndicatorBase from "./IndicatorBase";

class CVDIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval);
    this.name = "CVD";
    this.height = 100;
    this.resetPeriod = 100; // Resetear CVD cada X velas (configurable)
    this.days = days;
    
    // ✅ Ya NO necesitamos dataMap del backend
    this.dataMap = null;
  }

  async fetchData() {
    // ✅ Ya NO necesitamos cargar datos del backend
    // El cálculo se hace en tiempo real desde las velas
    console.log(`[${this.symbol}] 📊 CVD: Calculado en tiempo real desde velas`);
    this.data = [];
    return true;
  }

  // ✅ NUEVO: Calcular CVD directamente desde las velas
  // ✅ CORREGIDO: Ahora INCLUYE velas en progreso
  calculateCVD(candles) {
    if (!candles || candles.length === 0) return [];
    
    const cvdData = [];
    let cumulativeCVD = 0;
    let barCount = 0;
    
    for (const candle of candles) {
      // ✅ YA NO ignoramos velas en progreso
      // Las procesamos igual para mostrar la última barra en tiempo real
      
      // Reset cada X velas
      if (barCount >= this.resetPeriod) {
        cumulativeCVD = 0;
        barCount = 0;
      }
      
      // ✅ CALCULAR Volume Delta
      let volumeDelta;
      
      if (candle.close > candle.open) {
        // Vela alcista - Volumen de compra
        volumeDelta = candle.volume;
      } else if (candle.close < candle.open) {
        // Vela bajista - Volumen de venta
        volumeDelta = -candle.volume;
      } else {
        // Vela doji - Neutral
        volumeDelta = 0;
      }
      
      // Guardar CVD anterior (para dibujar barras)
      const previousCVD = cumulativeCVD;
      
      // ✅ ACUMULAR CVD
      cumulativeCVD += volumeDelta;
      
      cvdData.push({
        timestamp: candle.timestamp,
        openCVD: previousCVD,
        closeCVD: cumulativeCVD,
        volumeDelta: volumeDelta,
        datetime: candle.datetime_colombia,
        isReset: barCount === 0,
        in_progress: candle.in_progress || false
      });
      
      barCount++;
    }
    
    return cvdData;
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
    ctx.fillText(`CVD (Real-time, Reset cada ${this.resetPeriod})`, x + 5, y + 15);

    // ✅ CALCULAR en tiempo real desde las velas visibles
    const cvdData = this.calculateCVD(visibleCandles);
    
    if (cvdData.length === 0) return;

    // Calcular escala basada en CVD
    const cvdValues = [];
    cvdData.forEach(d => {
      cvdValues.push(d.openCVD);
      cvdValues.push(d.closeCVD);
    });
    
    const minCVD = Math.min(...cvdValues);
    const maxCVD = Math.max(...cvdValues);
    const cvdRange = maxCVD - minCVD;
    
    if (cvdRange === 0) return;

    const chartHeight = height - 25;
    const chartY = y + 20;
    const barWidth = width / visibleCandles.length;
    const cvdScale = chartHeight / cvdRange;

    // Dibujar barras de CVD continuas
    cvdData.forEach((d, i) => {
      const barX = x + (i * barWidth);
      
      // Si es reset, dibujar linea vertical indicadora
      if (d.isReset && i > 0) {
        ctx.strokeStyle = "#FF9500";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(barX, chartY);
        ctx.lineTo(barX, chartY + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }
      
      // Calcular posiciones Y para apertura y cierre
      const openY = chartY + chartHeight - ((d.openCVD - minCVD) * cvdScale);
      const closeY = chartY + chartHeight - ((d.closeCVD - minCVD) * cvdScale);
      
      // Color: verde si sube, rojo si baja
      const color = d.closeCVD >= d.openCVD ? bullColor : bearColor;
      
      // Dibujar barra continua
      const barHeight = Math.abs(closeY - openY);
      const minBarHeight = 2;
      
      ctx.fillStyle = color;
      
      // ✅ Si es vela en progreso, usar transparencia reducida para indicar que es temporal
      if (d.in_progress) {
        ctx.globalAlpha = 0.4;
      } else {
        ctx.globalAlpha = 0.6;
      }
      
      if (barHeight < minBarHeight) {
        // Barra muy pequeña - dibujar línea horizontal
        const avgY = (openY + closeY) / 2;
        ctx.fillRect(barX, avgY - minBarHeight/2, barWidth * 0.9, minBarHeight);
      } else {
        // Barra normal
        const topY = Math.min(openY, closeY);
        ctx.fillRect(barX, topY, barWidth * 0.9, Math.max(barHeight, minBarHeight));
      }
    });

    ctx.globalAlpha = 1.0;

    // Linea de cero
    if (minCVD < 0 && maxCVD > 0) {
      const zeroY = chartY + chartHeight - ((0 - minCVD) * cvdScale);
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, zeroY);
      ctx.lineTo(x + width, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Labels de escala
    ctx.fillStyle = "#999";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(`${maxCVD.toFixed(0)}`, x + width - 50, chartY + 10);
    ctx.fillText(`${minCVD.toFixed(0)}`, x + width - 50, chartY + chartHeight - 5);
    
    // Valor actual de CVD
    if (cvdData.length > 0) {
      const lastCVD = cvdData[cvdData.length - 1].closeCVD;
      ctx.fillStyle = lastCVD >= 0 ? bullColor : bearColor;
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(`CVD: ${lastCVD >= 0 ? '+' : ''}${lastCVD.toFixed(0)}`, x + 5, chartY + chartHeight - 5);
    }
  }
}

export default CVDIndicator;
