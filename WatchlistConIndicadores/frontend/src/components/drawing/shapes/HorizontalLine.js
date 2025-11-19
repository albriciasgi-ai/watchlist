// src/components/drawing/shapes/HorizontalLine.js
// Línea horizontal para niveles de soporte/resistencia

class HorizontalLine {
  constructor(price, time) {
    this.type = 'horizontal';
    this.id = `horizontal_${Date.now()}_${Math.random()}`;

    this.price = price;
    this.time = time; // Tiempo inicial (solo para referencia)

    this.style = {
      color: '#8B5CF6', // Púrpura
      lineWidth: 2,
      dash: [5, 5]
    };

    this.isDragging = false;
    this.dragStartY = 0;
    this.dragStartPrice = 0;
  }

  hitTest(x, y, scaleConverter, tolerance = 8) {
    const yPos = scaleConverter.priceToY(this.price);
    return Math.abs(y - yPos) <= tolerance;
  }

  hitTestHandle(x, y, scaleConverter) {
    // Las líneas horizontales no tienen handles específicos
    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartY = y;
    this.dragStartPrice = this.price;
  }

  startResize(handle, x, y, scaleConverter) {
    // No aplica para líneas horizontales
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      this.price = scaleConverter.yToPrice(y);
    }
  }

  endDrag() {
    this.isDragging = false;
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const y = scaleConverter.priceToY(this.price);
    const startX = scaleConverter.marginLeft;
    const endX = scaleConverter.marginLeft + scaleConverter.chartWidth;

    ctx.save();

    ctx.strokeStyle = isPreview ? 'rgba(139, 92, 246, 0.5)' : this.style.color;
    ctx.lineWidth = isSelected ? this.style.lineWidth + 1 : this.style.lineWidth;
    ctx.setLineDash(this.style.dash);

    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();

    ctx.setLineDash([]);

    // Label con el precio
    ctx.fillStyle = this.style.color;
    ctx.font = 'bold 11px Arial';
    ctx.fillText(this.price.toFixed(2), endX + 5, y + 4);

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
      ctx.lineWidth = this.style.lineWidth + 4;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  serialize() {
    return {
      type: this.type,
      id: this.id,
      price: this.price,
      time: this.time,
      style: { ...this.style }
    };
  }

  static deserialize(data) {
    const line = new HorizontalLine(data.price, data.time);
    line.id = data.id;
    if (data.style) {
      line.style = { ...data.style };
    }
    return line;
  }
}

export default HorizontalLine;
