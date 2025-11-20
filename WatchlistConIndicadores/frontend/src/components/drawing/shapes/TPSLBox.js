// src/components/drawing/shapes/TPSLBox.js
// Caja de Take Profit o Stop Loss

class TPSLBox {
  constructor(price, time, type = 'tp') {
    this.type = 'tpsl';
    this.tpslType = type; // 'tp' o 'sl'
    this.id = `tpsl_${type}_${Date.now()}_${Math.random()}`;

    this.price = price; // Precio del nivel
    this.time = time; // Tiempo inicial de creación
    this.width = 100; // Ancho en velas (ajustable)

    this.style = {
      color: type === 'tp' ? '#10B981' : '#EF4444', // Verde para TP, rojo para SL
      bgColor: type === 'tp' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
      lineWidth: 2,
      dash: []
    };

    this.label = type === 'tp' ? 'TP' : 'SL';

    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
    this.dragStartY = 0;
    this.dragStartPrice = 0;
  }

  hitTest(x, y, scaleConverter, tolerance = 15) {
    const xCenter = scaleConverter.timeToX(this.time);
    const yPrice = scaleConverter.priceToY(this.price);

    if (!xCenter) return false;

    // Calcular ancho en píxeles
    const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
    const boxWidth = this.width * pixelsPerCandle;
    const boxHeight = 30;

    const xStart = xCenter - boxWidth / 2;
    const xEnd = xCenter + boxWidth / 2;
    const yStart = yPrice - boxHeight / 2;
    const yEnd = yPrice + boxHeight / 2;

    return x >= xStart - tolerance &&
           x <= xEnd + tolerance &&
           y >= yStart - tolerance &&
           y <= yEnd + tolerance;
  }

  hitTestHandle(x, y, scaleConverter, handleRadius = 8) {
    const xCenter = scaleConverter.timeToX(this.time);
    const yPrice = scaleConverter.priceToY(this.price);

    if (!xCenter) return null;

    // Calcular ancho en píxeles
    const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
    const boxWidth = this.width * pixelsPerCandle;

    const xLeft = xCenter - boxWidth / 2;
    const xRight = xCenter + boxWidth / 2;

    // Handle izquierdo
    const distLeft = Math.sqrt((x - xLeft) ** 2 + (y - yPrice) ** 2);
    if (distLeft <= handleRadius) return 'left';

    // Handle derecho
    const distRight = Math.sqrt((x - xRight) ** 2 + (y - yPrice) ** 2);
    if (distRight <= handleRadius) return 'right';

    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartY = y;
    this.dragStartPrice = this.price;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.dragHandle = handle;
    this.dragStartX = x;
    this.dragStartWidth = this.width;
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      this.price = scaleConverter.yToPrice(y);
    } else if (this.isResizing) {
      const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
      const deltaX = x - this.dragStartX;
      const candleDelta = Math.round(deltaX / pixelsPerCandle);

      if (this.dragHandle === 'left') {
        this.width = Math.max(10, this.dragStartWidth - candleDelta);
      } else if (this.dragHandle === 'right') {
        this.width = Math.max(10, this.dragStartWidth + candleDelta);
      }
    }
  }

  endDrag() {
    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const xCenter = scaleConverter.timeToX(this.time);
    const yPrice = scaleConverter.priceToY(this.price);

    if (!xCenter) return;

    // Calcular ancho en píxeles
    const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
    const boxWidth = this.width * pixelsPerCandle;
    const boxHeight = 30;

    const xStart = xCenter - boxWidth / 2;
    const yStart = yPrice - boxHeight / 2;

    ctx.save();

    // Fondo semi-transparente
    ctx.fillStyle = isPreview ? `${this.style.bgColor}80` : this.style.bgColor;
    ctx.fillRect(xStart, yStart, boxWidth, boxHeight);

    // Borde
    ctx.strokeStyle = isSelected ? '#3B82F6' : this.style.color;
    ctx.lineWidth = isSelected ? 3 : this.style.lineWidth;
    ctx.setLineDash(this.style.dash);
    ctx.strokeRect(xStart, yStart, boxWidth, boxHeight);
    ctx.setLineDash([]);

    // Línea horizontal extendida
    ctx.strokeStyle = this.style.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, yPrice);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, yPrice);
    ctx.stroke();
    ctx.setLineDash([]);

    // Texto del label (TP o SL)
    ctx.fillStyle = this.style.color;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, xCenter, yPrice - 8);

    // Precio
    ctx.font = '12px Arial';
    ctx.fillText(this.price.toFixed(2), xCenter, yPrice + 6);

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(xStart - 2, yStart - 2, boxWidth + 4, boxHeight + 4);
    }

    // Handles si está seleccionado
    if (isSelected && !isPreview) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.color;
      ctx.lineWidth = 2;

      // Handle izquierdo
      ctx.beginPath();
      ctx.arc(xStart, yPrice, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Handle derecho
      ctx.beginPath();
      ctx.arc(xStart + boxWidth, yPrice, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  serialize() {
    return {
      type: this.type,
      tpslType: this.tpslType,
      id: this.id,
      price: this.price,
      time: this.time,
      width: this.width,
      label: this.label
    };
  }

  static deserialize(data) {
    const box = new TPSLBox(data.price, data.time, data.tpslType);
    box.id = data.id;
    box.width = data.width || 100;
    box.label = data.label || (data.tpslType === 'tp' ? 'TP' : 'SL');
    return box;
  }
}

export default TPSLBox;
