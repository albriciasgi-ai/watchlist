// src/components/drawing/shapes/TextBox.js
// Caja de texto para comentarios y anotaciones

class TextBox {
  constructor(price, time, text = 'Texto...') {
    this.type = 'textbox';
    this.id = `textbox_${Date.now()}_${Math.random()}`;

    this.price = price; // Precio donde está anclada
    this.time = time; // Tiempo donde está anclada
    this.text = text; // Contenido del texto

    // Dimensiones personalizadas (null = auto-calculado)
    this.customWidth = null;
    this.customHeight = null;

    this.style = {
      bgColor: '#FBBF24', // Amarillo (sticky note)
      textColor: '#78350F', // Marrón oscuro
      borderColor: '#F59E0B',
      fontSize: 13,
      fontFamily: 'Arial',
      padding: 8,
      minWidth: 120,
      minHeight: 60
    };

    this.isDragging = false;
    this.isResizing = false;
    this.resizeHandle = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPrice = 0;
    this.dragStartTime = 0;
    this.dragStartWidth = 0;
    this.dragStartHeight = 0;
  }

  hitTest(x, y, scaleConverter, tolerance = 10) {
    const xPos = scaleConverter.timeToX(this.time);
    const yPos = scaleConverter.priceToY(this.price);

    if (!xPos) return false;

    // CORREGIDO: Usar un canvas temporal para calcular dimensiones si no hay canvas en scaleConverter
    let ctx;
    if (scaleConverter.canvas) {
      ctx = scaleConverter.canvas.getContext('2d');
    } else {
      // Crear canvas temporal para measureText
      const tempCanvas = document.createElement('canvas');
      ctx = tempCanvas.getContext('2d');
    }

    const { width, height } = this.calculateDimensions(ctx);

    return x >= xPos - tolerance &&
           x <= xPos + width + tolerance &&
           y >= yPos - tolerance &&
           y <= yPos + height + tolerance;
  }

  hitTestHandle(x, y, scaleConverter, handleRadius = 8) {
    const xPos = scaleConverter.timeToX(this.time);
    const yPos = scaleConverter.priceToY(this.price);

    if (!xPos) return null;

    let ctx;
    if (scaleConverter.canvas) {
      ctx = scaleConverter.canvas.getContext('2d');
    } else {
      const tempCanvas = document.createElement('canvas');
      ctx = tempCanvas.getContext('2d');
    }

    const { width, height } = this.calculateDimensions(ctx);

    // 4 handles en las esquinas
    const handles = {
      'top-left': { x: xPos, y: yPos },
      'top-right': { x: xPos + width, y: yPos },
      'bottom-left': { x: xPos, y: yPos + height },
      'bottom-right': { x: xPos + width, y: yPos + height }
    };

    for (const [handle, pos] of Object.entries(handles)) {
      const dist = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (dist <= handleRadius) {
        return handle;
      }
    }

    return null;
  }

  calculateDimensions(ctx) {
    // Si hay dimensiones personalizadas, usarlas
    if (this.customWidth && this.customHeight) {
      return { width: this.customWidth, height: this.customHeight };
    }

    ctx.save();
    ctx.font = `${this.style.fontSize}px ${this.style.fontFamily}`;

    // Dividir texto en líneas
    const lines = this.text.split('\n');
    let maxWidth = this.customWidth || this.style.minWidth;

    // Calcular ancho máximo solo si no hay customWidth
    if (!this.customWidth) {
      lines.forEach(line => {
        const metrics = ctx.measureText(line);
        maxWidth = Math.max(maxWidth, metrics.width + this.style.padding * 2);
      });
    }

    // Calcular altura
    const lineHeight = this.style.fontSize * 1.4;
    const height = this.customHeight || Math.max(
      this.style.minHeight,
      lines.length * lineHeight + this.style.padding * 2
    );

    ctx.restore();

    return { width: maxWidth, height };
  }

  startDrag(x, y, scaleConverter) {
    this.isDragging = true;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartPrice = this.price;
    this.dragStartTime = this.time;
  }

  startResize(handle, x, y, scaleConverter) {
    this.isResizing = true;
    this.resizeHandle = handle;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartPrice = this.price;
    this.dragStartTime = this.time;

    let ctx;
    if (scaleConverter.canvas) {
      ctx = scaleConverter.canvas.getContext('2d');
    } else {
      const tempCanvas = document.createElement('canvas');
      ctx = tempCanvas.getContext('2d');
    }

    const { width, height } = this.calculateDimensions(ctx);
    this.dragStartWidth = width;
    this.dragStartHeight = height;
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isResizing) {
      const deltaX = x - this.dragStartX;
      const deltaY = y - this.dragStartY;

      switch (this.resizeHandle) {
        case 'bottom-right':
          // Resize desde esquina inferior derecha
          this.customWidth = Math.max(this.style.minWidth, this.dragStartWidth + deltaX);
          this.customHeight = Math.max(this.style.minHeight, this.dragStartHeight + deltaY);
          break;

        case 'bottom-left':
          // Resize desde esquina inferior izquierda (mueve y cambia tamaño)
          this.customWidth = Math.max(this.style.minWidth, this.dragStartWidth - deltaX);
          this.customHeight = Math.max(this.style.minHeight, this.dragStartHeight + deltaY);

          if (this.customWidth > this.style.minWidth) {
            const currentTime = scaleConverter.xToTime(x);
            const startTime = scaleConverter.xToTime(this.dragStartX);
            if (currentTime && startTime) {
              const deltaTime = currentTime - startTime;
              this.time = this.dragStartTime + deltaTime;
            }
          }
          break;

        case 'top-right':
          // Resize desde esquina superior derecha (mueve y cambia tamaño)
          this.customWidth = Math.max(this.style.minWidth, this.dragStartWidth + deltaX);
          this.customHeight = Math.max(this.style.minHeight, this.dragStartHeight - deltaY);

          if (this.customHeight > this.style.minHeight) {
            const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);
            this.price = this.dragStartPrice + deltaPrice;
          }
          break;

        case 'top-left':
          // Resize desde esquina superior izquierda (mueve y cambia tamaño)
          this.customWidth = Math.max(this.style.minWidth, this.dragStartWidth - deltaX);
          this.customHeight = Math.max(this.style.minHeight, this.dragStartHeight - deltaY);

          if (this.customWidth > this.style.minWidth) {
            const currentTime = scaleConverter.xToTime(x);
            const startTime = scaleConverter.xToTime(this.dragStartX);
            if (currentTime && startTime) {
              const deltaTime = currentTime - startTime;
              this.time = this.dragStartTime + deltaTime;
            }
          }

          if (this.customHeight > this.style.minHeight) {
            const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);
            this.price = this.dragStartPrice + deltaPrice;
          }
          break;
      }
    } else if (this.isDragging) {
      const deltaPrice = scaleConverter.yToPrice(y) - scaleConverter.yToPrice(this.dragStartY);
      const currentTime = scaleConverter.xToTime(x);
      const startTime = scaleConverter.xToTime(this.dragStartX);

      if (!currentTime || !startTime) return;

      const deltaTime = currentTime - startTime;

      this.price = this.dragStartPrice + deltaPrice;
      this.time = this.dragStartTime + deltaTime;
    }
  }

  endDrag() {
    this.isDragging = false;
    this.isResizing = false;
    this.resizeHandle = null;
  }

  // Método para editar el texto (será llamado por ChartModal con prompt)
  setText(newText) {
    this.text = newText || 'Texto...';
  }

  render(ctx, scaleConverter, isSelected = false, isHovered = false, isPreview = false) {
    const xPos = scaleConverter.timeToX(this.time);
    const yPos = scaleConverter.priceToY(this.price);

    if (!xPos) return;

    ctx.save();

    const { width, height } = this.calculateDimensions(ctx);

    // Sombra
    if (!isPreview) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    // Fondo (sticky note amarillo)
    ctx.fillStyle = isPreview ? `${this.style.bgColor}80` : this.style.bgColor;
    ctx.fillRect(xPos, yPos, width, height);

    // Quitar sombra para el resto
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Borde
    ctx.strokeStyle = isSelected ? '#3B82F6' : this.style.borderColor;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(xPos, yPos, width, height);

    // Texto
    ctx.fillStyle = this.style.textColor;
    ctx.font = `${this.style.fontSize}px ${this.style.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const lines = this.text.split('\n');
    const lineHeight = this.style.fontSize * 1.4;

    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        xPos + this.style.padding,
        yPos + this.style.padding + index * lineHeight
      );
    });

    // Efecto hover
    if (isHovered && !isSelected && !isPreview) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(xPos - 2, yPos - 2, width + 4, height + 4);
    }

    // Indicador de que se puede editar (cuando está seleccionado)
    if (isSelected && !isPreview) {
      ctx.fillStyle = this.style.borderColor;
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Doble click para editar', xPos + width / 2, yPos + height + 12);

      // Renderizar handles de resize
      this.renderHandles(ctx, xPos, yPos, width, height);
    }

    ctx.restore();
  }

  renderHandles(ctx, x, y, width, height) {
    const handleSize = 8;
    const handleColor = '#3B82F6';
    const handleBorder = '#FFFFFF';

    const handles = [
      { x: x, y: y }, // top-left
      { x: x + width, y: y }, // top-right
      { x: x, y: y + height }, // bottom-left
      { x: x + width, y: y + height } // bottom-right
    ];

    handles.forEach(handle => {
      // Borde blanco
      ctx.fillStyle = handleBorder;
      ctx.fillRect(
        handle.x - handleSize / 2 - 1,
        handle.y - handleSize / 2 - 1,
        handleSize + 2,
        handleSize + 2
      );

      // Handle azul
      ctx.fillStyle = handleColor;
      ctx.fillRect(
        handle.x - handleSize / 2,
        handle.y - handleSize / 2,
        handleSize,
        handleSize
      );
    });
  }

  serialize() {
    return {
      type: this.type,
      id: this.id,
      price: this.price,
      time: this.time,
      text: this.text,
      customWidth: this.customWidth,
      customHeight: this.customHeight,
      style: { ...this.style }
    };
  }

  static deserialize(data) {
    const textbox = new TextBox(data.price, data.time, data.text);
    textbox.id = data.id;
    textbox.customWidth = data.customWidth || null;
    textbox.customHeight = data.customHeight || null;
    if (data.style) {
      textbox.style = { ...textbox.style, ...data.style };
    }
    return textbox;
  }
}

export default TextBox;
