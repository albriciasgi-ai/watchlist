// src/components/drawing/shapes/FibonacciRetracement.js
// Fibonacci Retracement con todos los niveles (básicos + extendidos)

class FibonacciRetracement {
  constructor(price1, time1, price2, time2) {
    this.type = 'fibonacci';
    this.id = `fibonacci_${Date.now()}_${Math.random()}`;

    this.price1 = price1;
    this.time1 = time1;
    this.price2 = price2;
    this.time2 = time2;

    // ✅ Niveles según TradingView (CORRECTO)
    // price1 (primer click) = punto de inicio (sin nivel)
    // price2 (segundo click) = 0% (nivel base)
    // Niveles negativos = desde 0% hacia el primer click
    // Niveles positivos = desde 0% hacia extensiones
    this.levels = [
      // Retrocesos negativos (desde 0% hacia el primer click)
      { value: -0.789, color: '#EC4899', label: '-78.9%' },   // Rosa/magenta
      { value: -0.618, color: '#8B5CF6', label: '-61.8%' },   // Morado
      { value: -0.5, color: '#06B6D4', label: '-50%' },       // Cyan
      { value: -0.382, color: '#10B981', label: '-38.2%' },   // Verde
      { value: -0.236, color: '#F59E0B', label: '-23.6%' },   // Naranja
      { value: 0, color: '#3B82F6', label: '0%' },            // Azul (nivel base - segundo click)
      // Extensiones (desde 0% hacia arriba/abajo según dirección)
      { value: 0.27, color: '#10B981', label: '27%' },        // Verde
      { value: 0.618, color: '#8B5CF6', label: '61.8%' },     // Morado
      { value: 1, color: '#EF4444', label: '100%' },          // Rojo
      { value: 1.618, color: '#14B8A6', label: '161.8%' },    // Teal
      { value: 2.414, color: '#A855F7', label: '241.4%' },    // Morado claro
      { value: 4.618, color: '#F59E0B', label: '461.8%' }     // Naranja
    ];

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
    const x2 = scaleConverter.timeToX(this.time2);

    if (!x1 || !x2) return false;

    // ✅ CORREGIDO: price2 (segundo click) = 0%, niveles desde price2
    const priceRange = this.price2 - this.price1;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);

    // Verificar si está dentro del rango horizontal
    if (x < minX - tolerance || x > maxX + tolerance) return false;

    // Verificar si está cerca de algún nivel
    for (const level of this.levels) {
      const price = this.price2 + (priceRange * level.value);
      const yLevel = scaleConverter.priceToY(price);

      if (Math.abs(y - yLevel) <= tolerance) {
        return true;
      }
    }

    return false;
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

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const x1 = scaleConverter.timeToX(this.time1);
    const y1 = scaleConverter.priceToY(this.price1);
    const x2 = scaleConverter.timeToX(this.time2);
    const y2 = scaleConverter.priceToY(this.price2);

    if (!x1 || !x2) return;

    ctx.save();

    // ✅ CORREGIDO: price2 (segundo click) = 0%, niveles desde price2
    const priceRange = this.price2 - this.price1;
    const xStart = Math.min(x1, x2);
    const xEnd = Math.max(x1, x2);

    // Renderizar niveles
    this.levels.forEach((level, idx) => {
      const price = this.price2 + (priceRange * level.value);
      const y = scaleConverter.priceToY(price);

      // Línea horizontal
      ctx.strokeStyle = isPreview ? `${level.color}80` : level.color;
      // 61.8% más grueso si está seleccionado (índice 7: 0.618)
      ctx.lineWidth = isSelected && idx === 7 ? 2 : 1;
      ctx.setLineDash([5, 3]);

      ctx.beginPath();
      ctx.moveTo(xStart, y);
      ctx.lineTo(xEnd, y);
      ctx.stroke();

      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = level.color;
      ctx.font = 'bold 11px Arial';
      const labelText = `${level.label} (${price.toFixed(2)})`;
      ctx.fillText(labelText, xEnd + 5, y + 4);

      // Zona sombreada entre niveles
      if (idx > 0 && !isPreview) {
        const prevLevel = this.levels[idx - 1];
        const prevPrice = this.price2 + (priceRange * prevLevel.value);
        const prevY = scaleConverter.priceToY(prevPrice);

        ctx.fillStyle = `${level.color}15`; // 15 = muy transparente
        ctx.fillRect(xStart, prevY, xEnd - xStart, y - prevY);
      }
    });

    // Línea de referencia en el primer click (solo precio, sin nivel fibonacci)
    if (!isPreview) {
      const y1Price = scaleConverter.priceToY(this.price1);
      ctx.strokeStyle = '#94A3B8'; // Gris
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]); // Punteado

      ctx.beginPath();
      ctx.moveTo(xStart, y1Price);
      ctx.lineTo(xEnd, y1Price);
      ctx.stroke();

      ctx.setLineDash([]);

      // Label mostrando solo el precio (sin porcentaje)
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px Arial';
      ctx.fillText(this.price1.toFixed(2), xEnd + 5, y1Price + 4);
    }

    // Flecha indicando dirección
    this.renderArrow(ctx, x1, y1, x2, y2, isPreview);

    // Handles
    if (isSelected && !isPreview) {
      this.renderHandles(ctx, x1, y1, x2, y2);
    }

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.lineWidth = 3;
      ctx.strokeRect(xStart, Math.min(y1, y2), xEnd - xStart, Math.abs(y2 - y1));
    }

    ctx.restore();
  }

  renderArrow(ctx, x1, y1, x2, y2, isPreview) {
    const arrowColor = isPreview ? 'rgba(100, 100, 100, 0.5)' : '#666666';

    ctx.strokeStyle = arrowColor;
    ctx.fillStyle = arrowColor;
    ctx.lineWidth = 2;

    // ✅ Flecha desde price1 (primer click, sin nivel) hacia price2 (segundo click, 0%)
    // Línea vertical conectando ambos puntos
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y2);
    ctx.stroke();

    // Punta de flecha apuntando hacia y2 (0%, el nivel base)
    const arrowSize = 8;
    const direction = y2 > y1 ? 1 : -1; // Hacia abajo o arriba

    ctx.beginPath();
    ctx.moveTo(x1, y2);
    ctx.lineTo(x1 - arrowSize / 2, y2 - arrowSize * direction);
    ctx.lineTo(x1 + arrowSize / 2, y2 - arrowSize * direction);
    ctx.closePath();
    ctx.fill();

    // Etiqueta "0%" en y2 (segundo click)
    ctx.fillStyle = arrowColor;
    ctx.font = 'bold 10px Arial';
    ctx.fillText('0%', x1 - 25, y2 + 4);
  }

  renderHandles(ctx, x1, y1, x2, y2) {
    const handles = [
      { x: x1, y: y1 },
      { x: x2, y: y2 }
    ];

    handles.forEach(handle => {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#3B82F6';
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
      time2: this.time2
    };
  }

  static deserialize(data) {
    const fib = new FibonacciRetracement(data.price1, data.time1, data.price2, data.time2);
    fib.id = data.id;
    return fib;
  }
}

export default FibonacciRetracement;
