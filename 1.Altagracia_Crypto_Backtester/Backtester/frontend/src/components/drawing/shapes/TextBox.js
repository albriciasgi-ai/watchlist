// src/components/drawing/shapes/TextBox.js
// Caja de texto para comentarios y anotaciones

import { pixelRatio } from '../../chartPixels.js';
import { THEME, isNewTheme } from '../../uiTheme.js';

// Para medir el texto sin depender del lienzo del gráfico: el convertidor de escala no lo trae
let measureContext = null;
const measurer = (scaleConverter) => {
  const own = scaleConverter?.canvas?.getContext?.('2d');
  if (own) return own;
  if (!measureContext && typeof document !== 'undefined') measureContext = document.createElement('canvas').getContext('2d');
  return measureContext;
};

// Colores de la nota amarilla de antes: una caja con ellos sigue el estilo; otros colores son propios
const STICKY = { bgColor: '#FBBF24', textColor: '#78350F', borderColor: '#F59E0B' };

/** Colores con que se dibuja: los del estilo (fondo del gráfico, borde gris oscuro) o los de la caja */
function boxColors(style) {
  const own = style.bgColor !== STICKY.bgColor || style.textColor !== STICKY.textColor || style.borderColor !== STICKY.borderColor;
  if (!isNewTheme() || own) return { bg: style.bgColor, text: style.textColor, border: style.borderColor, shadow: true };
  return { bg: THEME.chartBg, text: THEME.text, border: THEME.textMuted, shadow: false };
}

class TextBox {
  constructor(price, time, text = 'Texto...') {
    this.type = 'textbox';
    this.id = `textbox_${Date.now()}_${Math.random()}`;

    this.price = price; // Precio donde está anclada
    this.time = time; // Tiempo donde está anclada
    this.text = text; // Contenido del texto

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
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPrice = 0;
    this.dragStartTime = 0;
  }

  hitTest(x, y, scaleConverter, tolerance = 10) {
    const xPos = scaleConverter.timeToX(this.time);
    const yPos = scaleConverter.priceToY(this.price);

    if (!xPos) return false;

    const ctx = measurer(scaleConverter);
    if (!ctx) return false;
    const { width, height } = this.calculateDimensions(ctx);

    return x >= xPos - tolerance &&
           x <= xPos + width + tolerance &&
           y >= yPos - tolerance &&
           y <= yPos + height + tolerance;
  }

  hitTestHandle(x, y, scaleConverter) {
    // Las text boxes no tienen handles de resize por ahora
    return null;
  }

  calculateDimensions(ctx) {
    ctx.save();
    ctx.font = `${this.style.fontSize}px ${this.style.fontFamily}`;

    // Dividir texto en líneas
    const lines = this.text.split('\n');
    let maxWidth = this.style.minWidth;

    // Calcular ancho máximo
    lines.forEach(line => {
      const metrics = ctx.measureText(line);
      maxWidth = Math.max(maxWidth, metrics.width + this.style.padding * 2);
    });

    // Calcular altura
    const lineHeight = this.style.fontSize * 1.4;
    const height = Math.max(
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
    // No implementado por ahora
  }

  updateDrag(x, y, scaleConverter) {
    if (this.isDragging) {
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
    const colors = boxColors(this.style);

    // Sombra (en los estilos nuevos la caja va plana, como las etiquetas del gráfico)
    if (!isPreview && colors.shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 8 * pixelRatio(); // La sombra no sigue la escala del lienzo
      ctx.shadowOffsetX = 2 * pixelRatio();
      ctx.shadowOffsetY = 2 * pixelRatio();
    }

    // Fondo (sticky note amarillo)
    ctx.fillStyle = colors.bg;
    if (isPreview) ctx.globalAlpha = 0.5;
    ctx.fillRect(xPos, yPos, width, height);

    // Quitar sombra para el resto
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Borde
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSelected ? '#3B82F6' : colors.border;
    ctx.lineWidth = isSelected ? 2 : colors.shadow ? 2 : 1;
    ctx.strokeRect(xPos, yPos, width, height);

    // Texto
    ctx.fillStyle = colors.text;
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
      ctx.fillStyle = colors.border;
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Doble click para editar', xPos + width / 2, yPos + height + 12);
    }

    ctx.restore();
  }

  serialize() {
    return {
      type: this.type,
      id: this.id,
      price: this.price,
      time: this.time,
      text: this.text,
      style: { ...this.style }
    };
  }

  static deserialize(data) {
    const textbox = new TextBox(data.price, data.time, data.text);
    textbox.id = data.id;
    if (data.style) {
      textbox.style = { ...textbox.style, ...data.style };
    }
    return textbox;
  }
}

export default TextBox;
