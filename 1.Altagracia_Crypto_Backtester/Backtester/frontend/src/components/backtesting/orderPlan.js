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

/**
 * Entrada de la orden: la de la caja o, sin caja, el precio del momento si se usa el precio actual.
 * El campo del panel copia el precio después de cada dibujo: leerlo podía dar el precio anterior, y una
 * orden que debía entrar a mercado quedaba esperando ese precio como stop o limit.
 */
export function orderEntry({ box, useCurrentPrice, currentPrice, typedEntry, orderType }) {
  if (box) return box.entryPrice;
  // Con limit el campo no sigue el precio aunque la casilla esté marcada: vale lo que muestra el campo
  if (useCurrentPrice && orderType !== 'limit' && currentPrice > 0) return currentPrice;
  return parseFloat(typedEntry);
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

/**
 * La caja de una orden pendiente o abierta muestra los precios de esa orden. Moverla no cambia la orden:
 * si se movió, vuelve a la entrada (la ejecutada si ya abrió), al stop y al objetivo de la orden.
 * Un precio que la orden no tiene queda como está. Devuelve las formas corregidas, o null si ninguna cambió.
 */
export function boxesFollowOrders(shapes = [], orders = []) {
  const live = new Map(orders
    .filter(order => (order.status === 'pending' || order.status === 'open') && order.tpslBoxId)
    .map(order => [order.tpslBoxId, order]));
  let changed = false;
  const kept = shapes.map(shape => {
    const order = shape.type === 'tpsl' ? live.get(shape.id) : null;
    if (!order) return shape;
    const prices = { entryPrice: order.status === 'open' ? (order.executedPrice ?? order.entryPrice) : order.entryPrice };
    if (order.stopLoss !== null && order.stopLoss !== undefined) prices.slPrice = order.stopLoss;
    if (order.takeProfit !== null && order.takeProfit !== undefined) prices.tpPrice = order.takeProfit;
    if (Object.keys(prices).every(key => shape[key] === prices[key])) return shape;
    changed = true;
    return { ...shape, ...prices };
  });
  return changed ? kept : null;
}
