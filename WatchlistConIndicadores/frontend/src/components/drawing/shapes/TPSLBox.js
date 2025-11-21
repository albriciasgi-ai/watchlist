// src/components/drawing/shapes/TPSLBox.js
// Caja combinada de Take Profit y Stop Loss con punto de entrada

class TPSLBox {
  constructor(entryPrice, time) {
    this.type = 'tpsl';
    this.id = `tpsl_${Date.now()}_${Math.random()}`;

    this.entryPrice = entryPrice; // Precio de entrada
    this.time = time; // Tiempo de creación

    // Por defecto: risk/reward 1:2 (TP es el doble que SL)
    // Si entry es 100, SL podría ser 98 (-2%), TP sería 104 (+4%)
    const defaultRiskPercent = 0.02; // 2% de riesgo
    this.slPrice = entryPrice * (1 - defaultRiskPercent); // SL abajo
    this.tpPrice = entryPrice * (1 + defaultRiskPercent * 2); // TP arriba (doble)

    this.width = 100; // Ancho en velas

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
    const xCenter = scaleConverter.timeToX(this.time);
    if (!xCenter) return false;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
    const boxWidth = this.width * pixelsPerCandle;

    const xStart = xCenter - boxWidth / 2;
    const xEnd = xCenter + boxWidth / 2;

    // Hit test en toda el área (desde SL hasta TP)
    const yTop = Math.min(yTp, ySl, yEntry);
    const yBottom = Math.max(yTp, ySl, yEntry);

    return x >= xStart - tolerance &&
           x <= xEnd + tolerance &&
           y >= yTop - tolerance &&
           y <= yBottom + tolerance;
  }

  hitTestHandle(x, y, scaleConverter, handleRadius = 8) {
    const xCenter = scaleConverter.timeToX(this.time);
    if (!xCenter) return null;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
    const boxWidth = this.width * pixelsPerCandle;

    const xLeft = xCenter - boxWidth / 2;
    const xRight = xCenter + boxWidth / 2;

    // Handle de TP (arriba)
    const distTp = Math.sqrt((x - xCenter) ** 2 + (y - yTp) ** 2);
    if (distTp <= handleRadius) return 'tp';

    // Handle de Entry (centro)
    const distEntry = Math.sqrt((x - xCenter) ** 2 + (y - yEntry) ** 2);
    if (distEntry <= handleRadius) return 'entry';

    // Handle de SL (abajo)
    const distSl = Math.sqrt((x - xCenter) ** 2 + (y - ySl) ** 2);
    if (distSl <= handleRadius) return 'sl';

    // Handles de ancho (izquierda y derecha en el entry)
    const distLeft = Math.sqrt((x - xLeft) ** 2 + (y - yEntry) ** 2);
    if (distLeft <= handleRadius) return 'left';

    const distRight = Math.sqrt((x - xRight) ** 2 + (y - yEntry) ** 2);
    if (distRight <= handleRadius) return 'right';

    return null;
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartY = y;
    this.dragStartEntryPrice = this.entryPrice;
    this.dragStartTpPrice = this.tpPrice;
    this.dragStartSlPrice = this.slPrice;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.dragHandle = handle;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartWidth = this.width;
    this.dragStartEntryPrice = this.entryPrice;
    this.dragStartTpPrice = this.tpPrice;
    this.dragStartSlPrice = this.slPrice;
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
      // Mover toda la caja verticalmente
      const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);

      this.entryPrice = this.dragStartEntryPrice + deltaPrice;
      this.tpPrice = this.dragStartTpPrice + deltaPrice;
      this.slPrice = this.dragStartSlPrice + deltaPrice;
    } else if (this.isResizing) {
      if (this.dragHandle === 'tp') {
        // Ajustar solo TP
        this.tpPrice = scaleConverter.yToPrice(y);
        // Asegurar que TP esté arriba del entry
        if (this.tpPrice < this.entryPrice) {
          this.tpPrice = this.entryPrice;
        }
      } else if (this.dragHandle === 'sl') {
        // Ajustar solo SL
        this.slPrice = scaleConverter.yToPrice(y);
        // Asegurar que SL esté abajo del entry
        if (this.slPrice > this.entryPrice) {
          this.slPrice = this.entryPrice;
        }
      } else if (this.dragHandle === 'entry') {
        // Mover entry manteniendo las distancias relativas
        const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);

        this.entryPrice = this.dragStartEntryPrice + deltaPrice;
        this.tpPrice = this.dragStartTpPrice + deltaPrice;
        this.slPrice = this.dragStartSlPrice + deltaPrice;
      } else if (this.dragHandle === 'left' || this.dragHandle === 'right') {
        // Ajustar ancho
        const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
        const deltaX = x - this.dragStartX;
        const candleDelta = Math.round(deltaX / pixelsPerCandle);

        if (this.dragHandle === 'left') {
          this.width = Math.max(10, this.dragStartWidth - candleDelta);
        } else {
          this.width = Math.max(10, this.dragStartWidth + candleDelta);
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
    if (!xCenter) return;

    const yEntry = scaleConverter.priceToY(this.entryPrice);
    const yTp = scaleConverter.priceToY(this.tpPrice);
    const ySl = scaleConverter.priceToY(this.slPrice);

    const pixelsPerCandle = scaleConverter.chartWidth / scaleConverter.visibleCandles.length;
    const boxWidth = this.width * pixelsPerCandle;

    const xStart = xCenter - boxWidth / 2;

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

    // 3. LÍNEAS HORIZONTALES EXTENDIDAS
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    // Línea TP
    ctx.strokeStyle = this.style.tpColor;
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, yTp);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, yTp);
    ctx.stroke();

    // Línea Entry
    ctx.strokeStyle = this.style.entryColor;
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, yEntry);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, yEntry);
    ctx.stroke();

    // Línea SL
    ctx.strokeStyle = this.style.slColor;
    ctx.beginPath();
    ctx.moveTo(scaleConverter.marginLeft, ySl);
    ctx.lineTo(scaleConverter.marginLeft + scaleConverter.chartWidth, ySl);
    ctx.stroke();

    ctx.setLineDash([]);

    // 4. LABELS Y PRECIOS
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

    // 5. HANDLES (si está seleccionado)
    if (isSelected && !isPreview) {
      // Handle TP
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = this.style.tpColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(xCenter, yTp, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Handle Entry
      ctx.strokeStyle = this.style.entryColor;
      ctx.beginPath();
      ctx.arc(xCenter, yEntry, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Handle SL
      ctx.strokeStyle = this.style.slColor;
      ctx.beginPath();
      ctx.arc(xCenter, ySl, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Handles de ancho (izquierda y derecha)
      ctx.strokeStyle = this.style.entryColor;
      ctx.beginPath();
      ctx.arc(xStart, yEntry, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(xStart + boxWidth, yEntry, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. Efecto hover
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
      width: this.width
    };
  }

  static deserialize(data) {
    const box = new TPSLBox(data.entryPrice, data.time);
    box.id = data.id;
    box.tpPrice = data.tpPrice;
    box.slPrice = data.slPrice;
    box.width = data.width || 100;

    // Retrocompatibilidad con formato antiguo
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
