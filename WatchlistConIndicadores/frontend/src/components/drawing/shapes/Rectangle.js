// src/components/drawing/shapes/Rectangle.js
// Rectángulo para zonas de Take Profit / Stop Loss

class Rectangle {
  constructor(price1, time1, price2, time2, label = null) {
    this.type = 'rectangle';
    this.id = `rectangle_${Date.now()}_${Math.random()}`;

    // Guardar precios y tiempos iniciales
    this.price1 = price1;
    this.time1 = time1;
    this.price2 = price2;
    this.time2 = time2;

    this.priceHigh = Math.max(price1, price2);
    this.priceLow = Math.min(price1, price2);
    this.timeStart = Math.min(time1, time2);
    this.timeEnd = Math.max(time1, time2);

    this.label = label; // 'TP', 'SL', o null

    // Auto-detectar tipo según contexto (se puede mejorar)
    if (!this.label) {
      this.label = 'Zone';
    }

    // Estilos según el tipo
    this.updateStyle();

    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPriceHigh = 0;
    this.dragStartPriceLow = 0;
    this.dragStartTimeStart = 0;
    this.dragStartTimeEnd = 0;
  }

  setEnd(price, time) {
    this.price2 = price;
    this.time2 = time;
    this.priceHigh = Math.max(this.price1, price);
    this.priceLow = Math.min(this.price1, price);
    this.timeStart = Math.min(this.time1, time);
    this.timeEnd = Math.max(this.time1, time);
  }

  updateStyle() {
    const styles = {
      'TP': {
        fill: 'rgba(16, 185, 129, 0.15)', // Verde claro
        stroke: '#10B981',
        labelBg: '#10B981'
      },
      'SL': {
        fill: 'rgba(239, 68, 68, 0.15)', // Rojo claro
        stroke: '#EF4444',
        labelBg: '#EF4444'
      },
      'Zone': {
        fill: 'rgba(59, 130, 246, 0.15)', // Azul claro
        stroke: '#3B82F6',
        labelBg: '#3B82F6'
      }
    };

    this.style = styles[this.label] || styles['Zone'];
  }

  hitTest(x, y, scaleConverter, tolerance = 10) {
    const x1 = scaleConverter.timeToX(this.timeStart);
    const x2 = scaleConverter.timeToX(this.timeEnd);
    const y1 = scaleConverter.priceToY(this.priceHigh);
    const y2 = scaleConverter.priceToY(this.priceLow);

    if (!x1 || !x2) return false;

    const minX = Math.min(x1, x2) - tolerance;
    const maxX = Math.max(x1, x2) + tolerance;
    const minY = Math.min(y1, y2) - tolerance;
    const maxY = Math.max(y1, y2) + tolerance;

    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  hitTestHandle(x, y, scaleConverter, handleRadius = 8) {
    const x1 = scaleConverter.timeToX(this.timeStart);
    const x2 = scaleConverter.timeToX(this.timeEnd);
    const y1 = scaleConverter.priceToY(this.priceHigh);
    const y2 = scaleConverter.priceToY(this.priceLow);

    if (!x1 || !x2) return null;

    // Esquinas
    const corners = [
      { x: x1, y: y1, handle: 'top-left' },
      { x: x2, y: y1, handle: 'top-right' },
      { x: x1, y: y2, handle: 'bottom-left' },
      { x: x2, y: y2, handle: 'bottom-right' }
    ];

    for (const corner of corners) {
      const dist = Math.sqrt((x - corner.x) ** 2 + (y - corner.y) ** 2);
      if (dist <= handleRadius) {
        return corner.handle;
      }
    }

    // Bordes
    if (Math.abs(y - y1) <= handleRadius && x >= x1 && x <= x2) return 'top';
    if (Math.abs(y - y2) <= handleRadius && x >= x1 && x <= x2) return 'bottom';
    if (Math.abs(x - x1) <= handleRadius && y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) return 'left';
    if (Math.abs(x - x2) <= handleRadius && y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) return 'right';

    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartPriceHigh = this.priceHigh;
    this.dragStartPriceLow = this.priceLow;
    this.dragStartTimeStart = this.timeStart;
    this.dragStartTimeEnd = this.timeEnd;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.dragHandle = handle;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartPriceHigh = this.priceHigh;
    this.dragStartPriceLow = this.priceLow;
    this.dragStartTimeStart = this.timeStart;
    this.dragStartTimeEnd = this.timeEnd;
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);
      const currentTime = scaleConverter.xToTime(x);
      const startTime = scaleConverter.xToTime(this.dragStartX);

      if (!currentTime || !startTime) return;

      const deltaTime = currentTime - startTime;

      this.priceHigh = this.dragStartPriceHigh + deltaPrice;
      this.priceLow = this.dragStartPriceLow + deltaPrice;
      this.timeStart = this.dragStartTimeStart + deltaTime;
      this.timeEnd = this.dragStartTimeEnd + deltaTime;

      // Actualizar también price1/time1 y price2/time2
      const priceDiff = this.dragStartPriceHigh - this.dragStartPriceLow;
      const timeDiff = this.dragStartTimeEnd - this.dragStartTimeStart;
      this.price1 = this.priceHigh;
      this.time1 = this.timeStart;
      this.price2 = this.priceLow;
      this.time2 = this.timeEnd;
    } else if (this.isResizing) {
      const newPrice = scaleConverter.yToPrice(y);
      const newTime = scaleConverter.xToTime(x);

      if (!newTime) return;

      // Redimensionar según el handle
      if (this.dragHandle.includes('top')) {
        this.priceHigh = newPrice;
      }
      if (this.dragHandle.includes('bottom')) {
        this.priceLow = newPrice;
      }
      if (this.dragHandle.includes('left')) {
        this.timeStart = newTime;
      }
      if (this.dragHandle.includes('right')) {
        this.timeEnd = newTime;
      }

      // Mantener orden correcto
      if (this.priceHigh < this.priceLow) {
        [this.priceHigh, this.priceLow] = [this.priceLow, this.priceHigh];
      }
      if (this.timeStart > this.timeEnd) {
        [this.timeStart, this.timeEnd] = [this.timeEnd, this.timeStart];
      }
    }
  }

  endDrag() {
    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const x1 = scaleConverter.timeToX(this.timeStart);
    const x2 = scaleConverter.timeToX(this.timeEnd);
    const y1 = scaleConverter.priceToY(this.priceHigh);
    const y2 = scaleConverter.priceToY(this.priceLow);

    if (!x1 || !x2) return;

    const width = x2 - x1;
    const height = y2 - y1;

    ctx.save();

    // Rectángulo relleno
    ctx.fillStyle = isPreview ? this.style.fill.replace('0.15', '0.08') : this.style.fill;
    ctx.fillRect(x1, y1, width, height);

    // Borde
    ctx.strokeStyle = isPreview ? 'rgba(59, 130, 246, 0.5)' : this.style.stroke;
    ctx.lineWidth = isSelected ? 2 : 1.5;
    ctx.strokeRect(x1, y1, width, height);

    // Label
    this.renderLabel(ctx, x1, y1, x2, y2, width, scaleConverter);

    // Línea del precio inferior (punteada)
    ctx.strokeStyle = this.style.stroke;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x1, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Handles (si está seleccionado)
    if (isSelected && !isPreview) {
      this.renderHandles(ctx, x1, y1, x2, y2);
    }

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = this.style.stroke;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(x1, y1, width, height);
      ctx.globalAlpha = 1.0;
    }

    ctx.restore();
  }

  renderLabel(ctx, x1, y1, x2, y2, width, scaleConverter) {
    const labelText = `${this.label}: ${this.priceHigh.toFixed(2)}`;
    ctx.font = 'bold 12px Arial';
    const textWidth = ctx.measureText(labelText).width;

    const labelX = x1 + 5;
    const labelY = y1 + 15;

    // Fondo del label
    ctx.fillStyle = this.style.labelBg;
    ctx.fillRect(labelX - 3, labelY - 12, textWidth + 6, 16);

    // Texto del label
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(labelText, labelX, labelY);

    // Precio inferior (label en el borde derecho)
    ctx.fillStyle = this.style.stroke;
    ctx.font = '11px Arial';
    ctx.fillText(this.priceLow.toFixed(2), x2 + 5, y2 + 4);
  }

  renderHandles(ctx, x1, y1, x2, y2) {
    const handles = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x1, y: y2 },
      { x: x2, y: y2 }
    ];

    handles.forEach(handle => {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = this.style.stroke;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  serialize() {
    return {
      type: this.type,
      id: this.id,
      price1: this.price1,
      time1: this.time1,
      price2: this.price2,
      time2: this.time2,
      label: this.label,
      style: { ...this.style }
    };
  }

  static deserialize(data) {
    const rect = new Rectangle(data.price1, data.time1, data.price2, data.time2, data.label);
    rect.id = data.id;
    if (data.style) {
      rect.style = { ...data.style };
    }
    return rect;
  }
}

export default Rectangle;
