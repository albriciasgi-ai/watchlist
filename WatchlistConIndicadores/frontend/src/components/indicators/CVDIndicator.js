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

  /**
   * 🔔 NUEVO: Verificar y generar alertas para cambios significativos en CVD
   */
  checkCVDAlerts(cvdData, currentPrice) {
    if (!cvdData || cvdData.length < 20 || !window.addWatchlistAlert) return;

    const now = Date.now();
    const cooldownPeriod = 3600000; // 1 hora

    // Obtener datos recientes para análisis
    const lookbackPeriod = Math.min(50, cvdData.length);
    const recentData = cvdData.slice(-lookbackPeriod);
    const currentData = cvdData[cvdData.length - 1];

    // Calcular extremos de CVD en el período reciente
    const cvdValues = recentData.map(d => d.closeCVD);
    const maxCVD = Math.max(...cvdValues);
    const minCVD = Math.min(...cvdValues);
    const cvdRange = maxCVD - minCVD;

    if (cvdRange === 0) return;

    // Verificar si estamos en extremos
    const currentCVD = currentData.closeCVD;
    const distanceToMax = Math.abs((currentCVD - maxCVD) / cvdRange);
    const distanceToMin = Math.abs((currentCVD - minCVD) / cvdRange);

    let alertType = null;
    let severity = 'LOW';

    if (distanceToMax < 0.05) {
      // Cerca del máximo
      alertType = 'maximum';
      severity = 'MEDIUM';
    } else if (distanceToMin < 0.05) {
      // Cerca del mínimo
      alertType = 'minimum';
      severity = 'MEDIUM';
    }

    // También detectar cambios fuertes de tendencia
    if (cvdData.length >= 10) {
      const prev5 = cvdData.slice(-10, -5).map(d => d.closeCVD);
      const last5 = cvdData.slice(-5).map(d => d.closeCVD);
      const avgPrev = prev5.reduce((sum, v) => sum + v, 0) / prev5.length;
      const avgLast = last5.reduce((sum, v) => sum + v, 0) / last5.length;
      const trendChange = ((avgLast - avgPrev) / cvdRange) * 100;

      if (Math.abs(trendChange) > 30) {
        alertType = trendChange > 0 ? 'strong_bullish_trend' : 'strong_bearish_trend';
        severity = 'HIGH';
      }
    }

    if (!alertType) return; // No hay condiciones de alerta

    // Verificar cooldown
    const alertKey = `cvd_alert_${this.symbol}_${alertType}_${Math.floor(now / cooldownPeriod)}`;
    const lastAlertTime = localStorage.getItem(alertKey);

    if (lastAlertTime && (now - parseInt(lastAlertTime)) < cooldownPeriod) {
      return; // Skip if in cooldown
    }

    // Determinar mensaje según el tipo
    let title, description, icon;
    if (alertType === 'maximum') {
      icon = '🔼';
      title = `${this.symbol} CVD en máximo reciente`;
      description = `CVD alcanzó nivel máximo reciente: ${currentCVD.toFixed(0)}\nRango: ${minCVD.toFixed(0)} - ${maxCVD.toFixed(0)}`;
    } else if (alertType === 'minimum') {
      icon = '🔽';
      title = `${this.symbol} CVD en mínimo reciente`;
      description = `CVD alcanzó nivel mínimo reciente: ${currentCVD.toFixed(0)}\nRango: ${minCVD.toFixed(0)} - ${maxCVD.toFixed(0)}`;
    } else if (alertType === 'strong_bullish_trend') {
      icon = '📈';
      title = `${this.symbol} CVD tendencia alcista fuerte`;
      description = `CVD muestra tendencia alcista fuerte\nCVD actual: ${currentCVD.toFixed(0)}`;
    } else if (alertType === 'strong_bearish_trend') {
      icon = '📉';
      title = `${this.symbol} CVD tendencia bajista fuerte`;
      description = `CVD muestra tendencia bajista fuerte\nCVD actual: ${currentCVD.toFixed(0)}`;
    }

    // Generar alerta
    window.addWatchlistAlert({
      indicatorType: 'CVD',
      severity: severity,
      icon: icon,
      title: title,
      symbol: this.symbol,
      interval: this.interval,
      type: 'CVD ' + alertType.replace(/_/g, ' '),
      description: description,
      data: {
        price: currentPrice,
        cvdValue: currentCVD,
        cvdMax: maxCVD,
        cvdMin: minCVD,
        alertType: alertType
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
    ctx.fillText(`CVD (Real-time, Reset cada ${this.resetPeriod})`, x + 5, y + 15);

    // ✅ CALCULAR en tiempo real desde las velas visibles
    const cvdData = this.calculateCVD(visibleCandles);

    if (cvdData.length === 0) return;

    // 🔔 NUEVO: Verificar alertas de CVD
    if (visibleCandles && visibleCandles.length > 0) {
      const currentPrice = visibleCandles[visibleCandles.length - 1].close;
      this.checkCVDAlerts(cvdData, currentPrice);
    }

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
