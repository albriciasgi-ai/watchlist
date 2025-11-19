// src/components/drawing/shapes/TrendLine.js
// Herramienta de línea de tendencia

class TrendLine {
  constructor(price1, time1, price2, time2) {
    this.type = 'trendline';
    this.id = `trendline_${Date.now()}_${Math.random()}`;

    // Coordenadas en términos de datos (precio/tiempo)
    this.price1 = price1;
    this.time1 = time1;
    this.price2 = price2;
    this.time2 = time2;

    // Estilo
    this.style = {
      color: '#3B82F6', // Azul
      lineWidth: 2,
      dash: []
    };

    // Estado de interacción
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

  // Hit testing - detectar click cerca de la línea
  hitTest(x, y, scaleConverter, tolerance = 15) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return false;

    // Algoritmo de distancia punto-línea
    const A = y2 - y1;
    const B = x1 - x2;
    const C = x2 * y1 - x1 * y2;

    const distance = Math.abs(A * x + B * y + C) / Math.sqrt(A * A + B * B);

    // También verificar que el punto esté dentro del rango de la línea (con margen)
    const minX = Math.min(x1, x2) - tolerance;
    const maxX = Math.max(x1, x2) + tolerance;
    const minY = Math.min(y1, y2) - tolerance;
    const maxY = Math.max(y1, y2) + tolerance;

    const isInRange = x >= minX && x <= maxX && y >= minY && y <= maxY;
    const hit = distance <= tolerance && isInRange;

    if (hit) {
      console.log('[TrendLine] hitTest SUCCESS:', { distance: distance.toFixed(2), tolerance, id: this.id });
    }

    return hit;
  }

  // Hit testing para handles (puntos de edición)
  hitTestHandle(x, y, scaleConverter, handleRadius = 8) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return null;

    // Handle de inicio
    const dist1 = Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
    if (dist1 <= handleRadius) return 'start';

    // Handle de fin
    const dist2 = Math.sqrt((x - x2) ** 2 + (y - y2) ** 2);
    if (dist2 <= handleRadius) return 'end';

    return null;
  }

  // Drag & Drop
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
      // Mover toda la línea
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
      // Redimensionar desde un extremo
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

  // Renderizado
  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return;

    ctx.save();

    // Línea
    ctx.strokeStyle = isPreview ? 'rgba(59, 130, 246, 0.5)' : this.style.color;
    ctx.lineWidth = isSelected ? this.style.lineWidth + 1 : this.style.lineWidth;
    ctx.setLineDash(this.style.dash);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Handles (solo si está seleccionado)
    if (isSelected && !isPreview) {
      this.renderHandles(ctx, x1, y1, x2, y2);
    }

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.lineWidth = this.style.lineWidth + 4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderHandles(ctx, x1, y1, x2, y2) {
    const handles = [
      { x: x1, y: y1 },
      { x: x2, y: y2 }
    ];

    handles.forEach(handle => {
      // Círculo exterior (blanco)
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Círculo interior (azul)
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Serialización para guardar
  serialize() {
    return {
      type: this.type,
      id: this.id,
      price1: this.price1,
      time1: this.time1,
      price2: this.price2,
      time2: this.time2,
      style: { ...this.style }
    };
  }

  static deserialize(data) {
    const line = new TrendLine(data.price1, data.time1, data.price2, data.time2);
    line.id = data.id;
    if (data.style) {
      line.style = { ...data.style };
    }
    return line;
  }
}

export default TrendLine;
