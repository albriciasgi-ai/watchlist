/**
 * Posiciones y órdenes abiertas de la cuenta activa del bot, para el gráfico y el panel (paso 4 de la integración,
 * 12/11/2026, pedido del usuario: ver el estado de cada posición y su P&L sobre el gráfico, como en TradingView).
 *
 * - Una sola lectura cada 2 s para toda la página, mientras alguien escucha. El bot las tiene al día por su
 *   WebSocket privado, así que leer seguido no consulta Bybit.
 * - Las acciones (cerrar, mover SL/TP, cancelar) piden confirmación aquí y van al servidor de la suite con su
 *   palabra (CERRAR_POSICION, MOVER_STOP, CANCELAR_ORDEN). El bot vuelve a validar todo.
 */
import { getJson, postJson } from './api.js';
import { pnlAt, validLevel } from '@app1/components/positionLines.js';

const POLL_MS = 2000;
const TICKS_MS = 60000;
const PENDING_MS = 8000;

const book = { positions: [], orders: [], at: 0, error: null, account: null };
const pending = new Map();   // id de la línea -> { field, price, before, until } mientras viaja el cambio
const ticks = new Map();     // moneda -> tick de Bybit (configuración del bot)
const listeners = new Set();
let timer = null;
let ticksAt = 0;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const notify = () => {
  for (const fn of [...listeners]) fn(book);
};

async function readTicks() {
  if (Date.now() - ticksAt < TICKS_MS) return;
  ticksAt = Date.now();
  try {
    const d = await getJson('/api/bot/config');
    for (const coin of d.coins || []) if (num(coin.tick_size)) ticks.set(coin.symbol, Number(coin.tick_size));
  } catch {
    // Sin la configuración del bot, la confirmación muestra el precio sin llevarlo al tick
  }
}

async function read() {
  try {
    const [p, o] = await Promise.all([
      getJson('/api/bot/positions'),
      getJson('/api/bot/orders/open').catch(() => ({ orders: [] })), // un bot de antes no tiene esta ruta
    ]);
    book.positions = p.success === false ? [] : (p.positions || []);
    book.orders = o.success === false ? [] : (o.orders || []);
    book.error = p.success === false ? (p.error || 'el bot no dio las posiciones') : null;
    book.account = p.account || null;
    book.at = Date.now();
  } catch (e) {
    book.error = e.message;
  }
  readTicks();
  notify();
}

/** Escucha los cambios; la lectura corre mientras haya alguien escuchando. Devuelve cómo dejar de escuchar. */
export function subscribeBook(fn) {
  listeners.add(fn);
  if (!timer) {
    read();
    timer = setInterval(read, POLL_MS);
  } else {
    fn(book);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const refreshBook = () => read();

/** Líneas para el gráfico de una moneda (forma de positionLines.js de App 1). */
export function linesFor(symbol) {
  const now = Date.now();
  const withPending = (line) => {
    const p = pending.get(line.id);
    if (p) {
      // Se suelta al vencer o cuando el dato del bot ya cambió
      if (now > p.until || (p.field && line[p.field] !== p.before)) pending.delete(line.id);
      else line.pending = p;
    }
    return line;
  };
  const lines = [];
  for (const p of book.positions) {
    if (p.symbol !== symbol || !(Number(p.size) > 0) || !p.side) continue;
    lines.push(withPending({
      kind: 'position', id: `pos:${p.symbol}:${p.positionIdx ?? 0}:${p.side}`, symbol: p.symbol, side: p.side,
      size: Number(p.size), entry: Number(p.entryPrice), stopLoss: num(p.stopLoss), takeProfit: num(p.takeProfit), liqPrice: num(p.liqPrice),
      leverage: num(p.leverage), // para el % como en Bybit: ROI sobre el margen
    }));
  }
  for (const o of book.orders) {
    if (o.symbol !== symbol || !o.entry) continue;
    const price = num(o.price) ?? num(o.triggerPrice);
    if (!price) continue;
    lines.push(withPending({
      kind: 'order', id: `ord:${o.orderId}`, orderId: o.orderId, symbol: o.symbol, side: o.side, qty: Number(o.leavesQty || o.qty),
      price, orderType: o.orderType, stopLoss: num(o.stopLoss), takeProfit: num(o.takeProfit),
    }));
  }
  return lines;
}

export const bookError = () => book.error;
export const bookAccount = () => book.account;

const decimalsOf = (step) => {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
};

/** El precio como lo dejará el bot: el SL al tick hacia el precio (menos riesgo), el TP al tick más cercano. */
export function roundForBot(symbol, field, side, price) {
  const tick = ticks.get(symbol);
  if (!tick) return { price, text: `≈ ${Number(price.toPrecision(8))}` };
  const steps = price / tick;
  const long = side === 'Buy';
  const n = field === 'stopLoss' ? (long ? Math.ceil(steps - 1e-9) : Math.floor(steps + 1e-9)) : Math.round(steps);
  const decimals = decimalsOf(tick);
  const value = Number((n * tick).toFixed(decimals));
  return { price: value, text: value.toFixed(decimals) };
}

const money = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} USD`;
const sideText = (line) => (line.side === 'Buy' ? 'LONG' : 'SHORT');

async function send(line, pend, path, body, okText) {
  if (pend) pending.set(line.id, { until: Date.now() + PENDING_MS, ...pend });
  notify(); // se dibuja enseguida como "moviendo…" o "cancelando…"
  try {
    await postJson(path, body);
    read();
    return { ok: true, message: okText };
  } catch (e) {
    pending.delete(line.id);
    notify();
    return { ok: false, message: e.message };
  }
}

/**
 * Acción pedida desde el gráfico (onPositionAction de MiniChart) o desde el panel: { type, line, field, price, lastPrice }.
 * Pide confirmación y la envía. Devuelve { ok, message } para mostrar, o null si se canceló.
 */
export async function runPositionAction(action) {
  const { type, line, lastPrice } = action;
  if (!line) return null;
  const account = book.account?.name ? ` en ${book.account.name}` : '';
  const real = book.account?.mode === 'live' ? ' (cuenta REAL)' : '';

  if (type === 'close') {
    const pnl = Number.isFinite(lastPrice) ? `\n\nP&L ahora ≈ ${money(pnlAt(line, lastPrice))} (sin comisiones).` : '';
    if (!window.confirm(`¿Cerrar a mercado el ${sideText(line)} de ${line.size} ${line.symbol}${account}${real}?${pnl}`)) return null;
    return send(line, { until: Date.now() + PENDING_MS }, '/api/bot/position/close',
      { symbol: line.symbol, side: line.side, confirm: 'CERRAR_POSICION' }, `${sideText(line)} ${line.symbol} cerrado a mercado`);
  }

  if (type === 'cancel') {
    const what = `${line.orderType || 'orden'} de ${line.side === 'Buy' ? 'compra' : 'venta'} de ${line.qty} ${line.symbol} a ${line.price}`;
    if (!window.confirm(`¿Cancelar la orden ${what}${account}?`)) return null;
    return send(line, { until: Date.now() + PENDING_MS }, '/api/bot/orders/cancel',
      { symbol: line.symbol, order_id: line.orderId, confirm: 'CANCELAR_ORDEN' }, `Orden de ${line.symbol} cancelada`);
  }

  if (type === 'remove' && action.field === 'takeProfit') {
    if (!window.confirm(`¿Quitar el objetivo (TP) del ${sideText(line)} ${line.symbol}${account}? El stop loss se mantiene.`)) return null;
    return send(line, { field: 'takeProfit', price: 0, before: line.takeProfit }, '/api/bot/position/trading-stop',
      { symbol: line.symbol, side: line.side, take_profit: 0, confirm: 'MOVER_STOP' }, `TP de ${line.symbol} quitado`);
  }

  if (type === 'move' && (action.field === 'stopLoss' || action.field === 'takeProfit') && Number.isFinite(action.price)) {
    const isSL = action.field === 'stopLoss';
    const long = line.side === 'Buy';
    const target = roundForBot(line.symbol, action.field, line.side, action.price);
    if (!validLevel(line, action.field, target.price, lastPrice)) {
      return {
        ok: false,
        message: isSL
          ? `El stop de un ${long ? 'long' : 'short'} va ${long ? 'por debajo' : 'por encima'} del precio actual`
          : `El objetivo de un ${long ? 'long' : 'short'} va ${long ? 'por encima' : 'por debajo'} del precio actual`,
      };
    }
    const verb = isSL ? 'Mover el stop loss' : (line.takeProfit ? 'Mover el objetivo (TP)' : 'Poner el objetivo (TP)');
    const result = money(pnlAt(line, target.price));
    if (!window.confirm(`¿${verb} del ${sideText(line)} ${line.symbol}${account}${real} a ${target.text}?\n\n`
      + `Si el precio llega ahí, la posición se cierra con ≈ ${result} (sin comisiones).`)) return null;
    return send(line, { field: action.field, price: target.price, before: line[action.field] }, '/api/bot/position/trading-stop',
      { symbol: line.symbol, side: line.side, [isSL ? 'stop_loss' : 'take_profit']: target.price, confirm: 'MOVER_STOP' },
      `${isSL ? 'SL' : 'TP'} de ${line.symbol} en ${target.text}`);
  }
  return null;
}
