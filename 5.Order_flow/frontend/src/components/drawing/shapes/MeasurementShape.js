// src/components/drawing/shapes/MeasurementShape.js
// Medición persistente (guardada con doble click)

class MeasurementShape {
  constructor(price1, time1, price2, time2) {
    this.type = 'measurement';
    this.id = `measurement_${Date.now()}_${Math.random()}`;

    this.price1 = price1;
    this.time1 = time1;
    this.price2 = price2;
    this.time2 = time2;

    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPrice1 = 0;
    this.dragStartTime1 = 0;
    this.dragStartPrice2 = 0;
    this.dragStartTime2 = 0;
  }

  setEnd(price, time) {
    this.price2 = price;
    this.time2 = time;
  }

  hitTest(x, y, scaleConverter, tolerance = 15) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return false;

    // Distancia punto a línea
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    return dist <= tolerance;
  }

  hitTestHandle(x, y, scaleConverter, handleRadius = 8) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return null;

    const dist1 = Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
    if (dist1 <= handleRadius) return 'start';

    const dist2 = Math.sqrt((x - x2) ** 2 + (y - y2) ** 2);
    if (dist2 <= handleRadius) return 'end';

    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartPrice1 = this.price1;
    this.dragStartTime1 = this.time1;
    this.dragStartPrice2 = this.price2;
    this.dragStartTime2 = this.time2;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.dragHandle = handle;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartPrice1 = this.price1;
    this.dragStartTime1 = this.time1;
    this.dragStartPrice2 = this.price2;
    this.dragStartTime2 = this.time2;
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);
      const currentTime = scaleConverter.xToTime(x);
      const startTime = scaleConverter.xToTime(this.dragStartX);

      if (!currentTime || !startTime) return;

      const deltaTime = currentTime - startTime;

      this.price1 = this.dragStartPrice1 + deltaPrice;
      this.price2 = this.dragStartPrice2 + deltaPrice;
      this.time1 = this.dragStartTime1 + deltaTime;
      this.time2 = this.dragStartTime2 + deltaTime;
    } else if (this.isResizing) {
      const newPrice = scaleConverter.yToPrice(y);
      const newTime = scaleConverter.xToTime(x);

      if (!newTime) return;

      if (this.dragHandle === 'start') {
        this.price1 = newPrice;
        this.time1 = newTime;
      } else if (this.dragHandle === 'end') {
        this.price2 = newPrice;
        this.time2 = newTime;
      }
    }
  }

  endDrag() {
    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
  }

  calculateMeasurements(scaleConverter) {
    const priceDiff = this.price2 - this.price1;
    const pricePercent = (priceDiff / this.price1) * 100;
    const timeDiff = this.time2 - this.time1;

    // Número de velas (aproximado)
    const intervalMs = this.getIntervalMilliseconds(scaleConverter.interval);
    const candleCount = Math.abs(Math.round(timeDiff / intervalMs));

    return {
      price1: this.price1.toFixed(2),
      price2: this.price2.toFixed(2),
      priceDiff: Math.abs(priceDiff).toFixed(2),
      pricePercent: pricePercent.toFixed(2),
      pricePercentAbs: Math.abs(pricePercent).toFixed(2),
      timeDiff: this.formatTimeDiff(Math.abs(timeDiff)),
      candleCount: candleCount,
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

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return;

    const measurements = this.calculateMeasurements(scaleConverter);

    ctx.save();

    // 1. LÍNEA PRINCIPAL (diagonal)
    ctx.strokeStyle = isPreview ? 'rgba(33, 150, 243, 0.5)' : '#2196F3';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. LÍNEAS HORIZONTALES (niveles de precio)
    ctx.strokeStyle = 'rgba(33, 150, 243, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    // Línea en precio inicial
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, y1);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, y1);
    ctx.stroke();

    // Línea en precio final
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, y2);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, y2);
    ctx.stroke();

    ctx.setLineDash([]);

    // 3. CÍRCULOS EN LOS EXTREMOS
    ctx.fillStyle = '#2196F3';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x1, y1, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x2, y2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. CAJA DE INFORMACIÓN
    this.renderInfoBox(ctx, x2, y2, measurements, scaleConverter.canvas);

    // 5. Handles si está seleccionado
    if (isSelected && !isPreview) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 2;

      // Handle inicio
      ctx.beginPath();
      ctx.arc(x1, y1, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Handle fin
      ctx.beginPath();
      ctx.arc(x2, y2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(33, 150, 243, 0.3)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderInfoBox(ctx, endX, endY, m, canvas) {
    // Posición del info box
    let boxX = endX + 15;
    let boxY = endY - 90;

    const boxWidth = 220;
    const boxHeight = 85;

    // Ajustar si se sale de la pantalla
    if (boxX + boxWidth > canvas.width) {
      boxX = endX - boxWidth - 15;
    }
    if (boxY < 0) {
      boxY = endY + 15;
    }

    // Fondo del box
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

    // Texto inferior
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('Guardado permanentemente', boxX + padding, boxY + boxHeight - 6);
  }

  serialize() {
    return {
      type: this.type,
      id: this.id,
      price1: this.price1,
      time1: this.time1,
      price2: this.price2,
      time2: this.time2
    };
  }

  static deserialize(data) {
    const shape = new MeasurementShape(data.price1, data.time1, data.price2, data.time2);
    shape.id = data.id;
    return shape;
  }
}

export default MeasurementShape;
