// src/components/drawing/shapes/TPSLBox.js
// Caja combinada de Take Profit y Stop Loss con punto de entrada

class TPSLBox {
  constructor(entryPrice, time, direction = 'long') {
    this.type = 'tpsl';
    this.id = `tpsl_${Date.now()}_${Math.random()}`;

    this.entryPrice = entryPrice; // Precio de entrada
    this.time = time; // Tiempo de creación (centro)
    this.direction = direction; // 'long' o 'short'

    // Por defecto: risk/reward 1:2 (TP es el doble que SL)
    const defaultRiskPercent = 0.02; // 2% de riesgo

    if (direction === 'long') {
      // LONG: SL abajo, TP arriba
      this.slPrice = entryPrice * (1 - defaultRiskPercent);
      this.tpPrice = entryPrice * (1 + defaultRiskPercent * 2);
    } else {
      // SHORT: SL arriba, TP abajo
      this.slPrice = entryPrice * (1 + defaultRiskPercent);
      this.tpPrice = entryPrice * (1 - defaultRiskPercent * 2);
    }

    // 🔧 FIX: Usar timestamps en vez de número de velas para coherencia entre timeframes
    // Ancho por defecto: 3 horas (10800000 ms)
    const defaultWidthMs = 3 * 60 * 60 * 1000;
    this.timeStart = time - defaultWidthMs / 2;
    this.timeEnd = time + defaultWidthMs / 2;

    this.style = {
      entryColor: '#3B82F6', // Azul para entrada
      tpColor: '#10B981', // Verde para TP
      slColor: '#EF4444', // Rojo para SL
      tpBgColor: 'rgba(16, 185, 129, 0.1)',
      slBgColor: 'rgba(239, 68, 68, 0.1)',
      lineWidth: 2
    };

    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null; // 'entry', 'tp', 'sl', 'left', 'right'
    this.dragStartY = 0;
    this.dragStartPrice = 0;
    this.dragStartEntryPrice = 0;
    this.dragStartTpPrice = 0;
    this.dragStartSlPrice = 0;
  }

  hitTest(x, y, scaleConverter, tolerance = 15) {
    const xStart = scaleConverter.timeToX(this.timeStart);
    const xEnd = scaleConverter.timeToX(this.timeEnd);

    if (!xStart || !xEnd) return false;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    // Hit test en toda el área (desde SL hasta TP)
    const yTop = Math.min(yTp, ySl, yEntry);
    const yBottom = Math.max(yTp, ySl, yEntry);

    return x >= xStart - tolerance &&
           x <= xEnd + tolerance &&
           y >= yTop - tolerance &&
           y <= yBottom + tolerance;
  }

  hitTestHandle(x, y, scaleConverter, handleRadius = 18) {
    const xCenter = scaleConverter.timeToX(this.time);
    const xLeft = scaleConverter.timeToX(this.timeStart);
    const xRight = scaleConverter.timeToX(this.timeEnd);

    if (!xCenter || !xLeft || !xRight) return null;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    // Prioridad: TP/SL primero (más importantes), luego width, luego entry

    // Handle de TP (arriba) - MÁS PRIORITARIO
    const distTp = Math.sqrt((x - xCenter) ** 2 + (y - yTp) ** 2);
    if (distTp <= handleRadius) return 'tp';

    // Handle de SL (abajo) - MÁS PRIORITARIO
    const distSl = Math.sqrt((x - xCenter) ** 2 + (y - ySl) ** 2);
    if (distSl <= handleRadius) return 'sl';

    // Handles de ancho (izquierda y derecha en el entry)
    const distLeft = Math.sqrt((x - xLeft) ** 2 + (y - yEntry) ** 2);
    if (distLeft <= handleRadius) return 'left';

    const distRight = Math.sqrt((x - xRight) ** 2 + (y - yEntry) ** 2);
    if (distRight <= handleRadius) return 'right';

    // Handle de Entry (centro) - MENOS PRIORITARIO
    const distEntry = Math.sqrt((x - xCenter) ** 2 + (y - yEntry) ** 2);
    if (distEntry <= handleRadius) return 'entry';

    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartTime = this.time;
    this.dragStartTimeStart = this.timeStart;
    this.dragStartTimeEnd = this.timeEnd;
    this.dragStartEntryPrice = this.entryPrice;
    this.dragStartTpPrice = this.tpPrice;
    this.dragStartSlPrice = this.slPrice;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.dragHandle = handle;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartTimeStart = this.timeStart;
    this.dragStartTimeEnd = this.timeEnd;
    this.dragStartEntryPrice = this.entryPrice;
    this.dragStartTpPrice = this.tpPrice;
    this.dragStartSlPrice = this.slPrice;
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      // Mover toda la caja verticalmente Y horizontalmente
      const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);
      const currentTime = scaleConverter.xToTime(x);
      const startTime = scaleConverter.xToTime(this.dragStartX);

      this.entryPrice = this.dragStartEntryPrice + deltaPrice;
      this.tpPrice = this.dragStartTpPrice + deltaPrice;
      this.slPrice = this.dragStartSlPrice + deltaPrice;

      if (currentTime && startTime) {
        const deltaTime = currentTime - startTime;
        this.time = this.dragStartTime + deltaTime;
        this.timeStart = this.dragStartTimeStart + deltaTime;
        this.timeEnd = this.dragStartTimeEnd + deltaTime;
      }
    } else if (this.isResizing) {
      if (this.dragHandle === 'tp') {
        // Ajustar solo TP - sin restricciones por ahora
        this.tpPrice = scaleConverter.yToPrice(y);
      } else if (this.dragHandle === 'sl') {
        // Ajustar solo SL - sin restricciones por ahora
        this.slPrice = scaleConverter.yToPrice(y);
      } else if (this.dragHandle === 'entry') {
        // Mover entry manteniendo las distancias relativas
        const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);

        this.entryPrice = this.dragStartEntryPrice + deltaPrice;
        this.tpPrice = this.dragStartTpPrice + deltaPrice;
        this.slPrice = this.dragStartSlPrice + deltaPrice;
      } else if (this.dragHandle === 'left' || this.dragHandle === 'right') {
        // 🔧 FIX: Ajustar ancho usando timestamps
        const currentTime = scaleConverter.xToTime(x);

        if (currentTime) {
          const minWidthMs = 15 * 60 * 1000; // Mínimo 15 minutos

          if (this.dragHandle === 'left') {
            // Mover el borde izquierdo
            const newTimeStart = Math.min(currentTime, this.dragStartTimeEnd - minWidthMs);
            this.timeStart = newTimeStart;
            this.time = (this.timeStart + this.timeEnd) / 2; // Recalcular centro
          } else {
            // Mover el borde derecho
            const newTimeEnd = Math.max(currentTime, this.dragStartTimeStart + minWidthMs);
            this.timeEnd = newTimeEnd;
            this.time = (this.timeStart + this.timeEnd) / 2; // Recalcular centro
          }
        }
      }
    }
  }

  endDrag() {
    this.isDragging = false;
    this.isResizing = false;
    this.dragHandle = null;
  }

  getRiskRewardRatio() {
    const risk = Math.abs(this.entryPrice - this.slPrice);
    const reward = Math.abs(this.tpPrice - this.entryPrice);

    if (risk === 0) return '∞';

    const ratio = reward / risk;
    return `1:${ratio.toFixed(2)}`;
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const xCenter = scaleConverter.timeToX(this.time);
    const xStart = scaleConverter.timeToX(this.timeStart);
    const xEnd = scaleConverter.timeToX(this.timeEnd);

    if (!xCenter || !xStart || !xEnd) return;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    const boxWidth = xEnd - xStart;

    ctx.save();

    // 1. ZONA TP (verde, arriba del entry)
    ctx.fillStyle = isPreview ? `${this.style.tpBgColor}80` : this.style.tpBgColor;
    ctx.fillRect(xStart, yTp, boxWidth, yEntry - yTp);

    // Borde de zona TP
    ctx.strokeStyle = isSelected ? '#3B82F6' : this.style.tpColor;
    ctx.lineWidth = isSelected ? 3 : this.style.lineWidth;
    ctx.strokeRect(xStart, yTp, boxWidth, yEntry - yTp);

    // 2. ZONA SL (roja, abajo del entry)
    ctx.fillStyle = isPreview ? `${this.style.slBgColor}80` : this.style.slBgColor;
    ctx.fillRect(xStart, yEntry, boxWidth, ySl - yEntry);

    // Borde de zona SL
    ctx.strokeStyle = isSelected ? '#3B82F6' : this.style.slColor;
    ctx.lineWidth = isSelected ? 3 : this.style.lineWidth;
    ctx.strokeRect(xStart, yEntry, boxWidth, ySl - yEntry);

    // 3. LABELS Y PRECIOS
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // TP Label
    ctx.fillStyle = this.style.tpColor;
    ctx.font = 'bold 12px Arial';
    ctx.fillText('TP', xCenter, yTp - 15);
    ctx.font = '11px Arial';
    ctx.fillText(this.tpPrice.toFixed(2), xCenter, yTp - 2);

    // Entry Label
    ctx.fillStyle = this.style.entryColor;
    ctx.font = 'bold 12px Arial';
    ctx.fillText('ENTRY', xCenter, yEntry);
    ctx.font = '11px Arial';
    ctx.fillText(this.entryPrice.toFixed(2), xCenter + 45, yEntry);

    // SL Label
    ctx.fillStyle = this.style.slColor;
    ctx.font = 'bold 12px Arial';
    ctx.fillText('SL', xCenter, ySl + 15);
    ctx.font = '11px Arial';
    ctx.fillText(this.slPrice.toFixed(2), xCenter, ySl + 2);

    // Risk/Reward Ratio
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 11px Arial';
    const rr = this.getRiskRewardRatio();
    ctx.fillText(`R/R: ${rr}`, xCenter, yEntry - 18);

    // 4. HANDLES (si está seleccionado)
    if (isSelected && !isPreview) {
      // Handle TP - más grande y visible
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.tpColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(xCenter, yTp, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Punto interior del handle TP
      ctx.fillStyle = this.style.tpColor;
      ctx.beginPath();
      ctx.arc(xCenter, yTp, 4, 0, Math.PI * 2);
      ctx.fill();

      // Handle SL - más grande y visible
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.slColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(xCenter, ySl, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Punto interior del handle SL
      ctx.fillStyle = this.style.slColor;
      ctx.beginPath();
      ctx.arc(xCenter, ySl, 4, 0, Math.PI * 2);
      ctx.fill();

      // Handle Entry - mantener tamaño medio
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.entryColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(xCenter, yEntry, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Punto interior del handle Entry
      ctx.fillStyle = this.style.entryColor;
      ctx.beginPath();
      ctx.arc(xCenter, yEntry, 3, 0, Math.PI * 2);
      ctx.fill();

      // Handles de ancho (izquierda y derecha) - más grandes
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.entryColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(xStart, yEntry, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(xStart + boxWidth, yEntry, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 5. Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(xStart - 2, yTp - 2, boxWidth + 4, ySl - yTp + 4);
    }

    ctx.restore();
  }

  serialize() {
    return {
      type: this.type,
      id: this.id,
      entryPrice: this.entryPrice,
      tpPrice: this.tpPrice,
      slPrice: this.slPrice,
      time: this.time,
      timeStart: this.timeStart,
      timeEnd: this.timeEnd,
      direction: this.direction
    };
  }

  static deserialize(data) {
    const direction = data.direction || 'long'; // Default a 'long' para retrocompatibilidad
    const box = new TPSLBox(data.entryPrice, data.time, direction);
    box.id = data.id;
    box.tpPrice = data.tpPrice;
    box.slPrice = data.slPrice;
    box.direction = direction;

    // 🔧 FIX: Retrocompatibilidad con formato antiguo que usaba 'width'
    if (data.timeStart && data.timeEnd) {
      // Nuevo formato con timestamps
      box.timeStart = data.timeStart;
      box.timeEnd = data.timeEnd;
    } else if (data.width) {
      // Formato antiguo: convertir width (número de velas) a timestamps
      // Asumimos 15 minutos por vela como default
      const candleDurationMs = 15 * 60 * 1000;
      const totalWidthMs = data.width * candleDurationMs;
      box.timeStart = data.time - totalWidthMs / 2;
      box.timeEnd = data.time + totalWidthMs / 2;
    } else {
      // Fallback si no hay ni width ni timestamps
      const defaultWidthMs = 3 * 60 * 60 * 1000;
      box.timeStart = data.time - defaultWidthMs / 2;
      box.timeEnd = data.time + defaultWidthMs / 2;
    }

    // Retrocompatibilidad con formato muy antiguo (tpslType)
    if (data.tpslType) {
      // Convertir del formato antiguo
      if (data.tpslType === 'tp') {
        box.tpPrice = data.price;
        box.slPrice = data.price * 0.98; // Estimación
      } else {
        box.slPrice = data.price;
        box.tpPrice = data.price * 1.04; // Estimación
      }
    }

    return box;
  }
}

export default TPSLBox;
