import { API_BASE_URL } from '../../config.js';
import { isBlind, maskDate } from './blindClock.js';

/**
 * Observador: registra en disco cada orden manual con lo que la regla del laboratorio leía en ese
 * minuto. El backend no entrega esa lectura hasta que la orden termina.
 */

const MAX_RANGE_AGE_MS = 90 * 86400000; // Rangos más viejos no son el perfil usado para esta orden

export const CONTEXT_OPTIONS = [['up', 'Alcista'], ['down', 'Bajista'], ['range', 'Rango']];

export const REASONS = [
  ['volume', 'Movimiento con volumen'],
  ['profile', 'Nivel de perfil'],
  ['fvg', 'FVG'],
  ['sr', 'Soporte o resistencia'],
  ['oi_up', 'OI creciendo'],
  ['footprint', 'Footprint'],
  ['delta', 'Delta']
];

export const emptyMarks = () => ({ context4h: null, context1h: null, reasons: [] });

const reasonLabel = (id) => REASONS.find(([key]) => key === id)?.[1] || id;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// En orden: el cierre de una orden nunca llega antes que la orden
let queue = Promise.resolve();
let lastError = null;

function send(path, body) {
  queue = queue.then(async () => {
    const response = await fetch(`${API_BASE_URL}/api/observer/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Error ${response.status}`);
    lastError = null;
  }).catch(error => {
    lastError = error.message;
    console.warn('[Observador] No se pudo guardar:', error.message);
  });
  return queue;
}

/** Último error al guardar, o null si lo último quedó guardado */
export function observerError() {
  return lastError;
}

/** Perfiles fijos que ya existían al crear la orden */
export function rangesInUse(profiles, time) {
  return profiles
    .filter(profile => profile.enabled !== false && profile.startTimestamp < time && profile.endTimestamp > time - MAX_RANGE_AGE_MS)
    .map(profile => ({ start: profile.startTimestamp, end: Math.min(profile.endTimestamp, time) }));
}

export function recordOrder(order, context) {
  order.observerId = newId();
  return send('orders', {
    id: order.observerId,
    order_number: order.id,
    symbol: context.symbol,
    timeframe: context.timeframe,
    session: context.session,
    time: order.entryTime,
    market: context.price,
    type: order.type,
    side: order.side,
    entry: order.entryPrice,
    stop: order.stopLoss,
    target: order.takeProfit,
    quantity: order.quantity,
    notes: order.notes,
    marks: order.marks || emptyMarks(),
    fill_time: order.executedAt,
    fill_price: order.executedPrice,
    blind: isBlind(),
    rewound: context.rewound,
    indicators: context.indicators,
    ranges: context.ranges
  });
}

export function recordFill(order) {
  if (!order.observerId) return queue;
  return send(`orders/${order.observerId}/events`, { event: 'fill', time: order.executedAt, price: order.executedPrice });
}

export function recordClose(order) {
  if (!order.observerId) return queue;
  return send(`orders/${order.observerId}/events`, {
    event: 'close',
    time: order.exitTime,
    price: order.exitPrice,
    reason: order.closeReason,
    pnl: order.pnl,
    pnl_percent: order.pnlPercent
  });
}

export function recordCancel(order, time) {
  if (!order.observerId) return queue;
  return send(`orders/${order.observerId}/events`, { event: 'cancel', time });
}

async function read(path) {
  const response = await fetch(`${API_BASE_URL}/api/observer/${path}`);
  if (!response.ok) throw new Error(`Error ${response.status}`);
  return response.json();
}

export const fetchOrders = () => read('orders').then(data => data.orders);

export function fetchReport({ symbol, blind, includeRewound }) {
  const params = new URLSearchParams({ blind, include_rewound: String(includeRewound) });
  if (symbol) params.append('symbol', symbol);
  return read(`report?${params}`);
}

export const fetchBlindStart = (symbol, first, last) => read(`blind-start/${symbol}?first=${first}&last=${last}`);

// ==================== TEXTOS ====================

const STATES = { up: 'Alcista', down: 'Bajista', range: 'Consolidación' };
const OI_STATES = { up: 'Creciendo', down: 'Cayendo', mixed: 'Mixto' };
const FRAME_NAMES = { 240: '4h', 60: '1h', 15: '15m' };
const STATUS_NAMES = { pending: 'Pendiente', open: 'Abierta', closed: 'Cerrada', cancelled: 'Cancelada' };

const price = (value) => Math.round(value).toLocaleString('en-US');
const percent = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const signedPercent = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

export const statusName = (status) => STATUS_NAMES[status] || status;

export function formatR(value) {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`;
}

/** Fecha simulada de una orden: relativa si la orden se hizo con fecha oculta o sigue oculta */
export function simulatedDate(trade, timestamp) {
  if (trade.blind && isBlind()) return maskDate(timestamp);
  if (trade.blind) return 'Fecha oculta';
  return new Date(timestamp).toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

const verdict = (agree) => (agree === null || agree === undefined ? null : agree ? 'Coincide' : 'No coincide');

function contextRow(row, label) {
  const detail = row.rule ? `${STATES[row.rule]} (eficiencia ${row.efficiency.toFixed(2)})` : 'Sin velas suficientes';
  return { label, you: STATES[row.you] || '—', rule: detail, verdict: verdict(row.agree) };
}

function moveText(tf, move) {
  return `${FRAME_NAMES[tf]}: ${price(move.lo)} a ${price(move.hi)}, volumen ${move.ratio.toFixed(1)}x, ${move.atrs.toFixed(1)} ATR`;
}

function moveRow(row) {
  const frames = row.rule ? Object.keys(row.rule).sort((a, b) => b - a) : [];
  const text = frames.length ? frames.map(tf => moveText(tf, row.rule[tf])).join('; ') : 'Sin movimiento vigente a favor';
  const note = row.same_move
    ? `Tu perfil y el movimiento de ${FRAME_NAMES[row.same_move.tf]} comparten ${percent(row.same_move.overlap)}`
    : null;
  return { label: 'Movimiento', you: row.you ? 'Con volumen' : '—', rule: text, verdict: verdict(row.agree), note };
}

function zoneRow(row) {
  const zone = row.rule;
  const kind = zone && (zone.typ === 'FVG' ? 'FVG' : 'Cluster');
  const text = zone
    ? `${kind} de ${FRAME_NAMES[zone.tf]} ${price(zone.x0)} a ${price(zone.x1)}, a ${percent(row.gap, 2)}`
    : 'Sin zonas del lado de la orden';
  const you = row.you ? row.you.map(reasonLabel).join(', ') : '—';
  const note = row.chance === null || row.chance === undefined ? null : `Por azar: ${percent(row.chance)} de los precios cercanos`;
  return { label: 'Zona', you, rule: text, verdict: verdict(row.agree), note };
}

function oiRow(row) {
  const text = row.rule ? `${OI_STATES[row.rule]} (${signedPercent(row.change)} en 4 horas)` : 'Sin dato de OI';
  return { label: 'Open Interest', you: row.you ? 'Creciendo' : '—', rule: text, verdict: verdict(row.agree) };
}

function volumeRow(row) {
  const text = row.rule === null || row.rule === undefined ? 'Sin dato' : `Última vela de 15m: ${row.rule.toFixed(1)}x su promedio`;
  return { label: 'Volumen', you: '—', rule: text, verdict: null };
}

/** Filas de texto de la comparación entre lo marcado y lo que leyó la regla */
export function describeComparison(comparison) {
  if (!comparison?.available) {
    return comparison?.missing === 'trades'
      ? { missing: 'Sin lectura: esa fecha todavía no tiene trades descargados.' }
      : { missing: 'Sin lectura para esta orden.' };
  }
  const rows = comparison.rows.map(row => {
    if (row.block === 'context_240') return contextRow(row, 'Contexto 4 horas');
    if (row.block === 'context_60') return contextRow(row, 'Contexto 1 hora');
    if (row.block === 'move') return moveRow(row);
    if (row.block === 'zone') return zoneRow(row);
    if (row.block === 'oi') return oiRow(row);
    return volumeRow(row);
  });
  return { rows };
}

export { reasonLabel };
