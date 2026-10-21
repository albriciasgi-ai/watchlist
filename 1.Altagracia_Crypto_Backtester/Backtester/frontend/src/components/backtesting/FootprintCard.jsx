import React, { useRef, useEffect } from 'react';
import './FootprintCard.css';

/**
 * FootprintCard - Visualiza una vela japonesa + footprint + volume profile
 *
 * Canvas total: 280x320px
 * Layout horizontal: [Vela 60px | Footprint 140px | Profile 80px]
 *
 * @param {Object} props
 * @param {Object} props.footprint - Footprint data del backend
 * @param {number} props.index - Índice del card (1, 2, 3...)
 * @param {Function} props.onUnpin - Callback cuando se desancla el footprint
 */
const FootprintCard = ({ footprint, index, onUnpin }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!footprint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Ajustar canvas para alta DPI
    const width = 280;
    const height = 320;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Limpiar canvas
    ctx.clearRect(0, 0, width, height);

    // Layout horizontal
    const candleX = 0;
    const candleWidth = 60;
    const footprintX = candleWidth;
    const footprintWidth = 140;
    const profileX = candleWidth + footprintWidth;
    const profileWidth = 80;

    // Header height
    const headerHeight = 40;
    const contentY = headerHeight;
    const contentHeight = height - headerHeight;

    // ==================== HEADER ====================
    drawHeader(ctx, width, headerHeight, footprint, index);

    // ==================== VELA JAPONESA ====================
    drawCandle(ctx, candleX, contentY, candleWidth, contentHeight, footprint);

    // ==================== FOOTPRINT ====================
    drawFootprint(ctx, footprintX, contentY, footprintWidth, contentHeight, footprint);

    // ==================== VOLUME PROFILE ====================
    drawVolumeProfile(ctx, profileX, contentY, profileWidth, contentHeight, footprint);

  }, [footprint, index]);

  return (
    <div className="footprint-card">
      <canvas ref={canvasRef} />
      <button
        className="unpin-button"
        onClick={() => onUnpin && onUnpin(footprint.timestamp)}
        title="Desanclar footprint"
      >
        📌
      </button>
    </div>
  );
};

// ==================== FUNCIONES DE DIBUJO ====================

/**
 * Dibuja el header con timestamp y precio
 */
function drawHeader(ctx, width, height, footprint, index) {
  // Fondo
  ctx.fillStyle = '#2C2C2E';
  ctx.fillRect(0, 0, width, height);

  // Timestamp
  const date = new Date(footprint.timestamp);
  const timeStr = date.toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 12px -apple-system, system-ui';
  ctx.fillText(`#${index} • ${timeStr}`, 10, 15);

  // OHLC
  const ohlcStr = `O:${footprint.open} H:${footprint.high} L:${footprint.low} C:${footprint.close}`;
  ctx.fillStyle = '#999999';
  ctx.font = '10px -apple-system, system-ui';
  ctx.fillText(ohlcStr, 10, 30);
}

/**
 * Dibuja la vela japonesa
 */
function drawCandle(ctx, x, y, width, height, footprint) {
  const { open, high, low, close } = footprint;

  // Calcular escala de precios
  const priceRange = high - low;
  if (priceRange === 0) return;

  const priceToY = (price) => {
    return y + height - ((price - low) / priceRange) * height;
  };

  // Colores
  const isBullish = close >= open;
  const bodyColor = isBullish ? '#34C759' : '#FF3B30';
  const wickColor = isBullish ? '#34C759' : '#FF3B30';

  // Dibujar mecha (wick)
  const centerX = x + width / 2;
  const yHigh = priceToY(high);
  const yLow = priceToY(low);

  ctx.strokeStyle = wickColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, yHigh);
  ctx.lineTo(centerX, yLow);
  ctx.stroke();

  // Dibujar cuerpo (body)
  const yOpen = priceToY(open);
  const yClose = priceToY(close);
  const bodyTop = Math.min(yOpen, yClose);
  const bodyBottom = Math.max(yOpen, yClose);
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1); // Mínimo 1px

  const bodyWidth = width * 0.6; // 60% del ancho disponible
  const bodyX = x + (width - bodyWidth) / 2;

  ctx.fillStyle = bodyColor;
  ctx.fillRect(bodyX, bodyTop, bodyWidth, bodyHeight);

  // Borde del cuerpo
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(bodyX, bodyTop, bodyWidth, bodyHeight);

  // Línea separadora vertical
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();
}

/**
 * Dibuja el footprint (bid/ask volume por nivel de precio)
 */
function drawFootprint(ctx, x, y, width, height, footprint) {
  const { levels, poc_price, high, low } = footprint;

  if (!levels || levels.length === 0) {
    // Sin datos
    ctx.fillStyle = '#666666';
    ctx.font = '11px -apple-system, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No footprint data', x + width / 2, y + height / 2);
    ctx.textAlign = 'left';
    return;
  }

  // Calcular escala de precios
  const priceRange = high - low;
  if (priceRange === 0) return;

  const priceToY = (price) => {
    return y + height - ((price - low) / priceRange) * height;
  };

  // Altura de cada celda
  const cellHeight = height / levels.length;

  // Encontrar max volumen para escala
  let maxVolume = 0;
  levels.forEach(level => {
    const total = (level.bid_volume || 0) + (level.ask_volume || 0);
    if (total > maxVolume) maxVolume = total;
  });

  // Dibujar cada nivel
  levels.forEach((level, idx) => {
    const bid = level.bid_volume || 0;
    const ask = level.ask_volume || 0;
    const total = bid + ask;

    if (total === 0) return; // Skip niveles vacíos

    const cellY = y + idx * cellHeight;

    // Calcular imbalance
    const ratio = bid > ask ? bid / (ask || 1) : ask / (bid || 1);
    const isBullish = bid > ask;
    const hasImbalance = ratio >= 1.5;

    // Color de fondo según imbalance
    if (hasImbalance) {
      ctx.fillStyle = isBullish ? 'rgba(52, 199, 89, 0.2)' : 'rgba(255, 59, 48, 0.2)';
      ctx.fillRect(x, cellY, width, cellHeight);
    }

    // Resaltar POC
    if (level.price === poc_price) {
      ctx.fillStyle = 'rgba(139, 92, 246, 0.3)'; // Morado
      ctx.fillRect(x, cellY, width, cellHeight);
    }

    // Dibujar volúmenes
    ctx.font = '9px "SF Mono", Monaco, monospace';
    ctx.textAlign = 'right';

    // Bid (izquierda)
    ctx.fillStyle = bid > 0 ? '#34C759' : '#666666';
    ctx.fillText(bid > 0 ? bid.toLocaleString() : '', x + width * 0.45, cellY + cellHeight / 2 + 3);

    // Ask (derecha)
    ctx.fillStyle = ask > 0 ? '#FF3B30' : '#666666';
    ctx.textAlign = 'left';
    ctx.fillText(ask > 0 ? ask.toLocaleString() : '', x + width * 0.55, cellY + cellHeight / 2 + 3);

    // Precio (centro)
    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.font = '8px "SF Mono", Monaco, monospace';
    ctx.fillText(level.price.toFixed(2), x + width / 2, cellY + cellHeight / 2 + 3);

    ctx.textAlign = 'left';
  });

  // Línea separadora vertical
  ctx.strokeStyle = '#444444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();
}

/**
 * Dibuja el volume profile vertical (histograma horizontal de volumen por precio)
 */
function drawVolumeProfile(ctx, x, y, width, height, footprint) {
  const { levels, poc_price, high, low } = footprint;

  if (!levels || levels.length === 0) return;

  // Calcular escala de precios
  const priceRange = high - low;
  if (priceRange === 0) return;

  const priceToY = (price) => {
    return y + height - ((price - low) / priceRange) * height;
  };

  // Altura de cada celda
  const cellHeight = height / levels.length;

  // Encontrar max volumen total para escala horizontal
  let maxTotalVolume = 0;
  levels.forEach(level => {
    const total = (level.bid_volume || 0) + (level.ask_volume || 0);
    if (total > maxTotalVolume) maxTotalVolume = total;
  });

  if (maxTotalVolume === 0) return;

  // Dibujar barras horizontales
  levels.forEach((level, idx) => {
    const bid = level.bid_volume || 0;
    const ask = level.ask_volume || 0;
    const total = bid + ask;

    if (total === 0) return;

    const cellY = y + idx * cellHeight;
    const barWidth = (total / maxTotalVolume) * width * 0.9; // 90% del ancho

    // Color según bid/ask dominante
    const isBullish = bid > ask;
    ctx.fillStyle = isBullish ? 'rgba(52, 199, 89, 0.6)' : 'rgba(255, 59, 48, 0.6)';

    // Resaltar POC con color más intenso
    if (level.price === poc_price) {
      ctx.fillStyle = '#8B5CF6'; // Morado sólido
    }

    ctx.fillRect(x, cellY, barWidth, cellHeight - 1);
  });
}

export default FootprintCard;
