// Tamaño y tipo de orden, igual que el panel de trading de App 8.

// Más lejos que esto del precio actual, la orden espera su precio
export const AUTO_ENTRY_DISTANCE = 0.001;

/** Precio a un porcentaje de la entrada, a favor para el objetivo y en contra para el stop */
export function priceAtPercent(entry, side, percent, inFavor) {
  const value = parseFloat(percent);
  if (!(value > 0) || !(entry > 0)) return null;
  const up = (side === 'long') === inFavor;
  return entry * (1 + (up ? value : -value) / 100);
}

/** Cerca del precio entra a mercado. Lejos espera: limit si el precio debe volver, stop si debe avanzar */
export function autoOrderType(entry, currentPrice, side) {
  if (Math.abs(entry - currentPrice) <= currentPrice * AUTO_ENTRY_DISTANCE) return 'market';
  const pullback = side === 'long' ? entry < currentPrice : entry > currentPrice;
  return pullback ? 'limit' : 'stop';
}

/** Cantidad en monedas. Por riesgo, llegar al stop cuesta el capital arriesgado */
export function orderQuantity({ mode, amount, entry, stopLoss }) {
  if (!(amount > 0) || !(entry > 0)) return 0;
  if (mode !== 'risk') return amount / entry;
  const distance = stopLoss ? Math.abs(entry - stopLoss) : 0;
  return distance > 0 ? amount / distance : 0;
}

/** Lo que se ve antes de enviar la orden */
export function orderPreview({ quantity, entry, stopLoss, takeProfit }) {
  const loss = stopLoss ? Math.abs(entry - stopLoss) * quantity : null;
  const profit = takeProfit ? Math.abs(takeProfit - entry) * quantity : null;
  return { investment: quantity * entry, loss, profit, ratio: loss > 0 && profit !== null ? profit / loss : null };
}

/** Última caja dibujada que no pertenece a una orden. Una orden cancelada deja libre su caja */
export function latestFreeBox(shapes = [], orders = []) {
  const taken = new Set(orders.filter(order => order.status !== 'cancelled' && order.tpslBoxId).map(order => order.tpslBoxId));
  const box = [...shapes].reverse().find(shape => shape.type === 'tpsl' && !taken.has(shape.id));
  if (!box) return null;
  return {
    id: box.id,
    entryPrice: box.entryPrice,
    slPrice: box.slPrice,
    tpPrice: box.tpPrice,
    side: box.tpPrice < box.entryPrice ? 'short' : 'long'
  };
}
