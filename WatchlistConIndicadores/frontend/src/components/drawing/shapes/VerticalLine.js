// src/components/drawing/shapes/VerticalLine.js
// Línea vertical para marcar eventos/tiempos importantes

class VerticalLine {
  constructor(price, time) {
    this.type = 'vertical';
    this.id = `vertical_${Date.now()}_${Math.random()}`;

    this.price = price; // Solo para referencia
    this.time = time; // Tiempo que marca la línea

    this.style = {
      color: '#F59E0B', // Naranja/Amarillo
      lineWidth: 2,
      dash: [5, 5]
    };

    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartTime = 0;
  }

  hitTest(x, y, scaleConverter, tolerance = 15) {
    const xPos = scaleConverter.timeToX(this.time);
    if (!xPos) return false;
    return Math.abs(x - xPos) <= tolerance;
  }

  hitTestHandle(x, y, scaleConverter) {
    // Las líneas verticales no tienen handles específicos
    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartTime = this.time;
  }

  startResize(handle, x, y, scaleConverter) {
    // No aplica para líneas verticales
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      const newTime = scaleConverter.xToTime(x);
      if (newTime) {
        this.time = newTime;
      }
    }
  }

  endDrag() {
    this.isDragging = false;
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const x = scaleConverter.timeToX(this.time);
    if (!x) return;

    const startY = scaleConverter.marginTop;
    const endY = scaleConverter.marginTop + scaleConverter.chartHeight;

    ctx.save();

    ctx.strokeStyle = isPreview ? 'rgba(245, 158, 11, 0.5)' : this.style.color;
    ctx.lineWidth = isSelected ? this.style.lineWidth + 1 : this.style.lineWidth;
    ctx.setLineDash(this.style.dash);

    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Label con la fecha/hora (en la parte superior)
    ctx.fillStyle = this.style.color;
    ctx.font = 'bold 11px Arial';
    const date = new Date(this.time);
    const label = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;

    // Rotar texto 90 grados para que sea vertical
    ctx.save();
    ctx.translate(x + 8, startY + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
      ctx.lineWidth = this.style.lineWidth + 4;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
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
    const line = new VerticalLine(data.price, data.time);
    line.id = data.id;
    if (data.style) {
      line.style = { ...data.style };
    }
    return line;
  }
}

export default VerticalLine;
