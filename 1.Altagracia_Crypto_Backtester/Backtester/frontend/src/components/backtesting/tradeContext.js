// Lo que quien opera trazó antes de una orden: dibujos cercanos que pudo tomar de referencia.

export const DRAWING_WINDOW_CANDLES = 100;

const FIBONACCI_LEVELS = [[0, '0%'], [0.27, '27%'], [0.618, '61.8%'], [1, '100%']];

/** Primer y último momento que toca un dibujo */
function shapeSpan(shape) {
  if (shape.type === 'horizontal' || shape.type === 'vertical') return [shape.time, shape.time];
  return [Math.min(shape.time1, shape.time2), Math.max(shape.time1, shape.time2)];
}

function normalize(shape) {
  const { type, createdAt = null } = shape;
  if (type === 'horizontal') return { type, price: shape.price, time: shape.time, createdAt };
  if (type === 'vertical') return { type, time: shape.time, createdAt };
  if (type === 'trendline') {
    return { type, price1: shape.price1, time1: shape.time1, price2: shape.price2, time2: shape.time2, createdAt };
  }
  if (type === 'rectangle') {
    const [start, end] = shapeSpan(shape);
    return { type, high: Math.max(shape.price1, shape.price2), low: Math.min(shape.price1, shape.price2), start, end, createdAt };
  }
  if (type === 'fibonacci') {
    const range = Math.abs(shape.price2 - shape.price1);
    const direction = Math.sign(shape.price2 - shape.price1);
    return {
      type,
      time1: shape.time1,
      time2: shape.time2,
      levels: FIBONACCI_LEVELS.map(([value, label]) => ({ label, price: shape.price2 + direction * range * value })),
      createdAt
    };
  }
  return null;
}

/**
 * Dibujos de referencia para una orden: trazados en las últimas velas o que tocan esas velas.
 * Un dibujo hecho después de la orden, o anclado solo en su futuro, no cuenta.
 */
export function drawingsForOrder(shapes, time, candleMs) {
  const since = time - DRAWING_WINDOW_CANDLES * candleMs;
  return (shapes || []).flatMap(shape => {
    const drawing = normalize(shape);
    if (!drawing) return [];

    const [first, last] = shapeSpan(shape);
    const { createdAt } = drawing;
    if (createdAt !== null && createdAt > time) return [];
    if (first > time) return [];

    const drawnRecently = createdAt !== null && createdAt >= since;
    return drawnRecently || last >= since ? [drawing] : [];
  });
}
