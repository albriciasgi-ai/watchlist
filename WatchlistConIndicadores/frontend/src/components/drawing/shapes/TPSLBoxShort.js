// src/components/drawing/shapes/TPSLBoxShort.js
// Caja combinada de Take Profit y Stop Loss con punto de entrada para posiciones SHORT

class TPSLBoxShort {
  constructor(entryPrice, time) {
    this.type = 'tpsl-short';
    this.id = `tpsl_short_${Date.now()}_${Math.random()}`;

    this.entryPrice = entryPrice; // Precio de entrada
    this.time = time; // Tiempo de creación

    // Por defecto: risk/reward 1:2 (TP es el doble que SL)
    // Para SHORT: TP abajo (ganancia), SL arriba (pérdida)
    // Si entry es 100, TP podría ser 96 (-4%), SL sería 102 (+2%)
    const defaultRiskPercent = 0.02; // 2% de riesgo
    this.slPrice = entryPrice * (1 + defaultRiskPercent); // SL arriba (pérdida si sube)
    this.tpPrice = entryPrice * (1 - defaultRiskPercent * 2); // TP abajo (ganancia si baja, doble)

    // Ancho en tiempo (milisegundos) - por defecto 100 velas de 15 min = 90,000,000 ms
    this.widthTime = 100 * 15 * 60 * 1000; // 90 minutos

    this.style = {
      entryColor: '#F59E0B', // Naranja/Amarillo para entrada SHORT
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
    const xCenter = scaleConverter.timeToX(this.time);
    if (!xCenter) return false;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    // Calcular ancho basado en tiempo
    const startTime = this.time - this.widthTime / 2;
    const endTime = this.time + this.widthTime / 2;
    const xStart = scaleConverter.timeToX(startTime);
    const xEnd = scaleConverter.timeToX(endTime);

    if (!xStart || !xEnd) return false;

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
    if (!xCenter) return null;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    // Calcular ancho basado en tiempo
    const startTime = this.time - this.widthTime / 2;
    const endTime = this.time + this.widthTime / 2;
    const xLeft = scaleConverter.timeToX(startTime);
    const xRight = scaleConverter.timeToX(endTime);

    if (!xLeft || !xRight) return null;

    // Prioridad: TP/SL primero (más importantes), luego width, luego entry

    // Handle de TP (abajo en SHORT) - MÁS PRIORITARIO
    const distTp = Math.sqrt((x - xCenter) ** 2 + (y - yTp) ** 2);
    if (distTp <= handleRadius) return 'tp';

    // Handle de SL (arriba en SHORT) - MÁS PRIORITARIO
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
    this.dragStartEntryPrice = this.entryPrice;
    this.dragStartTpPrice = this.tpPrice;
    this.dragStartSlPrice = this.slPrice;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.dragHandle = handle;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartWidthTime = this.widthTime;
    this.dragStartTime = scaleConverter.xToTime(x);
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
        // Ajustar ancho basado en tiempo
        const currentTime = scaleConverter.xToTime(x);
        if (currentTime && this.dragStartTime) {
          const deltaTime = currentTime - this.dragStartTime;

          if (this.dragHandle === 'left') {
            // Expandir hacia la izquierda
            this.widthTime = Math.max(60000, this.dragStartWidthTime - 2 * deltaTime); // Mínimo 1 minuto
          } else {
            // Expandir hacia la derecha
            this.widthTime = Math.max(60000, this.dragStartWidthTime + 2 * deltaTime);
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
    const risk = Math.abs(this.slPrice - this.entryPrice);
    const reward = Math.abs(this.entryPrice - this.tpPrice);

    if (risk === 0) return '∞';

    const ratio = reward / risk;
    return `1:${ratio.toFixed(2)}`;
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const xCenter = scaleConverter.timeToX(this.time);
    if (!xCenter) return;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    // Calcular ancho basado en tiempo
    const startTime = this.time - this.widthTime / 2;
    const endTime = this.time + this.widthTime / 2;
    const xStart = scaleConverter.timeToX(startTime);
    const xEnd = scaleConverter.timeToX(endTime);

    if (!xStart || !xEnd) return;

    const boxWidth = xEnd - xStart;

    ctx.save();

    // 1. ZONA SL (roja, arriba del entry en SHORT)
    ctx.fillStyle = isPreview ? `${this.style.slBgColor}80` : this.style.slBgColor;
    ctx.fillRect(xStart, ySl, boxWidth, yEntry - ySl);

    // Borde de zona SL
    ctx.strokeStyle = isSelected ? '#F59E0B' : this.style.slColor;
    ctx.lineWidth = isSelected ? 3 : this.style.lineWidth;
    ctx.strokeRect(xStart, ySl, boxWidth, yEntry - ySl);

    // 2. ZONA TP (verde, abajo del entry en SHORT)
    ctx.fillStyle = isPreview ? `${this.style.tpBgColor}80` : this.style.tpBgColor;
    ctx.fillRect(xStart, yEntry, boxWidth, yTp - yEntry);

    // Borde de zona TP
    ctx.strokeStyle = isSelected ? '#F59E0B' : this.style.tpColor;
    ctx.lineWidth = isSelected ? 3 : this.style.lineWidth;
    ctx.strokeRect(xStart, yEntry, boxWidth, yTp - yEntry);

    // 3. LABELS Y PRECIOS
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // SL Label (arriba en SHORT)
    ctx.fillStyle = this.style.slColor;
    ctx.font = 'bold 12px Arial';
    ctx.fillText('SL', xCenter, ySl - 15);
    ctx.font = '11px Arial';
    ctx.fillText(this.slPrice.toFixed(2), xCenter, ySl - 2);

    // Entry Label (con indicador SHORT)
    ctx.fillStyle = this.style.entryColor;
    ctx.font = 'bold 12px Arial';
    ctx.fillText('SHORT', xCenter - 30, yEntry);
    ctx.font = '11px Arial';
    ctx.fillText(this.entryPrice.toFixed(2), xCenter + 40, yEntry);

    // TP Label (abajo en SHORT)
    ctx.fillStyle = this.style.tpColor;
    ctx.font = 'bold 12px Arial';
    ctx.fillText('TP', xCenter, yTp + 15);
    ctx.font = '11px Arial';
    ctx.fillText(this.tpPrice.toFixed(2), xCenter, yTp + 2);

    // Risk/Reward Ratio
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 11px Arial';
    const rr = this.getRiskRewardRatio();
    ctx.fillText(`R/R: ${rr}`, xCenter, yEntry + 18);

    // 4. HANDLES (si está seleccionado)
    if (isSelected && !isPreview) {
      // Handle SL (arriba en SHORT) - más grande y visible
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

      // Handle TP (abajo en SHORT) - más grande y visible
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

      // Handle Entry - mantener tamaño medio con color naranja
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
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)'; // Naranja para SHORT
      ctx.lineWidth = 4;
      ctx.strokeRect(xStart - 2, ySl - 2, boxWidth + 4, yTp - ySl + 4);
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
      widthTime: this.widthTime
    };
  }

  static deserialize(data) {
    const box = new TPSLBoxShort(data.entryPrice, data.time);
    box.id = data.id;
    box.tpPrice = data.tpPrice;
    box.slPrice = data.slPrice;

    // Retrocompatibilidad: convertir width (velas) a widthTime (ms)
    if (data.widthTime) {
      box.widthTime = data.widthTime;
    } else if (data.width) {
      // Asumir 15 min por vela si tenemos el formato antiguo
      box.widthTime = data.width * 15 * 60 * 1000;
    } else {
      box.widthTime = 100 * 15 * 60 * 1000; // Default
    }

    return box;
  }
}

export default TPSLBoxShort;
