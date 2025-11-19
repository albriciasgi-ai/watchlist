// src/components/drawing/MeasurementTool.js
// Herramienta de medición activada con middle click (rueda del mouse)

class MeasurementTool {
  constructor() {
    this.startPoint = null;
    this.endPoint = null;
    this.isMeasuring = false;
  }

  handleMouseDown(e, canvas) {
    if (e.button !== 1) return false; // Solo middle click

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Limpiar medición anterior si existe
    if (this.startPoint && !this.isMeasuring) {
      this.clear();
    }

    this.isMeasuring = true;
    this.startPoint = { x, y };
    this.endPoint = { x, y };

    return true;
  }

  handleMouseMove(e, canvas) {
    if (!this.isMeasuring) return false;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.endPoint = { x, y };
    return true;
  }

  handleMouseUp(e) {
    if (this.isMeasuring) {
      // Mantener la medición visible (no limpiar)
      // Para limpiar, el usuario puede hacer Esc o nuevo measurement
      this.isMeasuring = false;
    }
  }

  clear() {
    this.startPoint = null;
    this.endPoint = null;
    this.isMeasuring = false;
  }

  calculateMeasurements(scaleConverter) {
    if (!this.startPoint || !this.endPoint || !scaleConverter) return null;

    const price1 = scaleConverter.yToPrice(this.startPoint.y);
    const price2 = scaleConverter.yToPrice(this.endPoint.y);
    const time1 = scaleConverter.xToTime(this.startPoint.x);
    const time2 = scaleConverter.xToTime(this.endPoint.x);

    // Validar que tengamos datos válidos
    if (!time1 || !time2 || !price1 || !price2 || price1 === 0) {
      console.warn('MeasurementTool: Invalid data', { price1, price2, time1, time2 });
      return null;
    }

    // Cálculos
    const priceDiff = price2 - price1;
    const pricePercent = (priceDiff / price1) * 100;
    const timeDiff = time2 - time1;

    // Distancia en píxeles
    const pixelDistance = Math.sqrt(
      Math.pow(this.endPoint.x - this.startPoint.x, 2) +
      Math.pow(this.endPoint.y - this.startPoint.y, 2)
    );

    // Número de velas (aproximado)
    const intervalMs = this.getIntervalMilliseconds(scaleConverter.interval);
    const candleCount = Math.abs(Math.round(timeDiff / intervalMs));

    return {
      price1: price1.toFixed(2),
      price2: price2.toFixed(2),
      priceDiff: Math.abs(priceDiff).toFixed(2),
      pricePercent: pricePercent.toFixed(2),
      pricePercentAbs: Math.abs(pricePercent).toFixed(2),
      timeDiff: this.formatTimeDiff(Math.abs(timeDiff)),
      candleCount: candleCount,
      pixelDistance: pixelDistance.toFixed(0),
      isPositive: priceDiff >= 0
    };
  }

  getIntervalMilliseconds(interval) {
    const map = {
      "1": 60000,
      "3": 180000,
      "5": 300000,
      "15": 900000,
      "30": 1800000,
      "60": 3600000,
      "120": 7200000,
      "240": 14400000,
      "D": 86400000,
      "W": 604800000
    };
    return map[interval] || 900000;
  }

  formatTimeDiff(milliseconds) {
    const seconds = milliseconds / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;

    if (days >= 1) return `${days.toFixed(1)} días`;
    if (hours >= 1) return `${hours.toFixed(1)} horas`;
    if (minutes >= 1) return `${Math.floor(minutes)} min`;
    return `${Math.floor(seconds)} seg`;
  }

  render(ctx, scaleConverter) {
    if (!this.startPoint || !this.endPoint) return;

    const measurements = this.calculateMeasurements(scaleConverter);
    if (!measurements) return;

    ctx.save();

    // 1. LÍNEA PRINCIPAL (diagonal)
    ctx.strokeStyle = '#2196F3'; // Azul brillante
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(this.startPoint.x, this.startPoint.y);
    ctx.lineTo(this.endPoint.x, this.endPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. LÍNEAS HORIZONTALES (niveles de precio)
    ctx.strokeStyle = 'rgba(33, 150, 243, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    // Línea en precio inicial
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, this.startPoint.y);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, this.startPoint.y);
    ctx.stroke();

    // Línea en precio final
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, this.endPoint.y);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, this.endPoint.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // 3. CÍRCULOS EN LOS EXTREMOS
    ctx.fillStyle = '#2196F3';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(this.startPoint.x, this.startPoint.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(this.endPoint.x, this.endPoint.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. CAJA DE INFORMACIÓN
    this.renderInfoBox(ctx, measurements);

    ctx.restore();
  }

  renderInfoBox(ctx, m) {
    // Posición del info box (cerca del cursor final)
    let boxX = this.endPoint.x + 15;
    let boxY = this.endPoint.y - 90;

    const boxWidth = 220;
    const boxHeight = 85;

    // Ajustar si se sale de la pantalla
    if (boxX + boxWidth > ctx.canvas.width) {
      boxX = this.endPoint.x - boxWidth - 15;
    }
    if (boxY < 0) {
      boxY = this.endPoint.y + 15;
    }

    // Fondo del box (semi-transparente con sombra)
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = 'rgba(33, 150, 243, 0.95)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Borde
    ctx.strokeStyle = '#1976D2';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

    // Contenido del texto
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';

    const padding = 10;
    let lineY = boxY + padding + 14;

    // Línea 1: Diferencia de precio y porcentaje
    ctx.font = 'bold 13px Arial';
    const sign = m.isPositive ? '+' : '-';
    const percentColor = m.isPositive ? '#4ADE80' : '#F87171';
    ctx.fillText(`${sign}$${m.priceDiff} (${sign}${m.pricePercentAbs}%)`, boxX + padding, lineY);

    // Línea 2: Rango de precios
    lineY += 18;
    ctx.font = '12px Arial';
    ctx.fillText(`${m.price1} → ${m.price2}`, boxX + padding, lineY);

    // Línea 3: Tiempo
    lineY += 18;
    ctx.fillText(`Tiempo: ${m.timeDiff}`, boxX + padding, lineY);

    // Línea 4: Velas
    lineY += 18;
    ctx.fillText(`Velas: ${m.candleCount}`, boxX + padding, lineY);

    // Texto inferior: instrucción
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('Rueda del mouse para nueva medición', boxX + padding, boxY + boxHeight - 6);
  }
}

export default MeasurementTool;
