// Espera a que la vela de la entrada y la caja TP/SL estén dibujadas antes de tomar la imagen
export const ENTRY_CAPTURE_DELAY_MS = 150;

// Velas que espera la imagen de cierre, para ver qué pasó después del trade
export const EXIT_CAPTURE_CANDLES = 10;

// Velas anteriores a la entrada que la imagen de cierre deja como mínimo
const EXIT_CONTEXT_CANDLES = 20;

/** Hora simulada en que corresponde la imagen de cierre */
export const exitCaptureTime = (exitTime, candleMs) => exitTime + EXIT_CAPTURE_CANDLES * candleMs;

/** Trades cuya imagen de cierre ya se puede tomar */
export function exitCapturesDue(orders = [], time) {
  return orders.filter(order => order.exitCaptureAt && time >= order.exitCaptureAt);
}

/** Velas que debe mostrar la imagen de cierre: el trade, lo que siguió y contexto anterior */
export function candlesToFrame(tradeCandles) {
  return tradeCandles + Math.max(EXIT_CONTEXT_CANDLES, Math.ceil(tradeCandles * 0.25));
}

/** Líneas verticales de los trades. Salen de las órdenes para que la sesión las recupere sola */
export function tradeBoundaries(orders = []) {
  return orders
    .filter(order => order.status === 'open' || order.status === 'closed')
    .map(order => ({
      entryTime: order.executedAt ?? order.entryTime,
      exitTime: order.exitTime ?? null,
      tradeNumber: order.id
    }));
}

/** Resumen que la lista de sesiones muestra sin abrir cada una */
export function tradeStats(orders = []) {
  const closed = orders.filter(order => order.status === 'closed');
  const wins = closed.filter(order => order.pnl > 0).length;
  return {
    totalTrades: closed.length,
    winRate: closed.length > 0 ? ((wins / closed.length) * 100).toFixed(2) : 0
  };
}
