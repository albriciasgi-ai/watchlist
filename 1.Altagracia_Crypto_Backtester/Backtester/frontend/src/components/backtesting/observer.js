import { API_BASE_URL } from '../../config.js';
import { isBlind, maskDate, priceText, pricesHidden } from './blindClock.js';
import { TF_MS } from './replayClock.js';
import { EXIT_CAPTURE_CANDLES, exitCaptureTime } from './tradeJournal.js';
import { VPA_CODES } from '../indicators/vpa.js';

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
    trade_number: order.tradeNumber ?? null, // Solo las órdenes ejecutadas tienen número de trade
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
    marks: emptyMarks(),
    fill_time: order.executedAt,
    fill_price: order.executedPrice,
    blind: isBlind(),
    rewound: context.rewound,
    indicators: context.indicators,
    ranges: context.ranges,
    drawings: context.drawings,
    levels: context.levels
  });
}

/** Motivos que quien opera agrega después de cerrar, si quiere */
export function recordMarks(id, marks) {
  return send(`orders/${id}/events`, { event: 'marks', marks });
}

export function recordFill(order) {
  if (!order.observerId) return queue;
  const body = { event: 'fill', time: order.executedAt, price: order.executedPrice, trade_number: order.tradeNumber ?? null };
  if (order.fillRule) body.fill_rule = order.fillRule; // solo las limit: con qué regla se llenaron
  return send(`orders/${order.observerId}/events`, body);
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

/** Deja en el registro qué imagen es de esta orden. kind: 'decision', 'entry' o 'exit' */
export function recordImage(order, kind, image) {
  if (!order.observerId || !image?.path) return queue;
  return send(`orders/${order.observerId}/events`, { event: 'image', kind, ...image });
}

export function screenshotUrl(path) {
  const [session, file] = path.split('/');
  return `${API_BASE_URL}/api/screenshots/session/${session}/${file}`;
}

/**
 * Las órdenes anteriores a este enlace solo tienen sus imágenes en su sesión.
 * Las busca allí y las deja en el registro para no volver a buscarlas.
 */
const linkedImages = new Set();

export async function withSessionImages(trades, loadSession) {
  const sessions = new Map();

  for (const trade of trades) {
    const ended = trade.status === 'closed' || trade.status === 'cancelled';
    if (!ended || !trade.session || (trade.images?.entry && trade.images?.exit)) continue;

    if (!sessions.has(trade.session)) sessions.set(trade.session, await loadSession(trade.session).catch(() => null));
    const orders = sessions.get(trade.session)?.orderManagerState?.orders || [];
    const order = orders.find(item => item.id === trade.order_number);
    if (!order) continue;

    const found = {
      decision: { path: order.decisionScreenshotPath, sim_time: order.decisionScreenshotSimTime ?? null, frame: order.decisionScreenshotFrame ?? null },
      entry: { path: order.screenshotPath, sim_time: order.screenshotSimTime ?? null, frame: order.screenshotFrame ?? null },
      exit: { path: order.exitScreenshotPath, sim_time: order.exitScreenshotSimTime ?? null, frame: order.exitScreenshotFrame ?? null }
    };
    trade.images = { ...trade.images };
    for (const kind of Object.keys(found)) {
      if (found[kind].path && !trade.images[kind]) {
        trade.images[kind] = found[kind];
        const key = `${trade.id}:${kind}`;
        if (!linkedImages.has(key)) recordImage({ observerId: trade.id }, kind, found[kind]);
        linkedImages.add(key);
      }
    }
  }
  return trades;
}

const IMAGE_LABELS = { decision: 'Decisión', entry: 'Apertura', exit: 'Cierre' };

/** Imágenes que corresponden a una orden terminada, con el motivo de las que faltan */
export function imageSlots(trade) {
  const images = trade.images || {};
  const opened = trade.status === 'closed';
  if (!images.decision && !images.entry && !images.exit) return [];

  const slots = [];
  if (images.decision) slots.push({ kind: 'decision', label: IMAGE_LABELS.decision, image: images.decision });
  if (images.entry || opened) slots.push({ kind: 'entry', label: IMAGE_LABELS.entry, image: images.entry, missing: 'no se guardó' });
  if (images.exit || opened) {
    slots.push({ kind: 'exit', label: IMAGE_LABELS.exit, image: images.exit, missing: `se toma ${EXIT_CAPTURE_CANDLES} velas después de cerrar; si dejaste la sesión, no llega` });
  }
  return slots;
}

/**
 * Por qué no conviene mostrar una imagen, o null. Con fecha oculta una imagen con fechas reales
 * ubica la época, y al repetir fechas puede mostrar velas que esta corrida todavía no alcanzó.
 * "reached" es la hora más lejana de la corrida: ir a un trade del historial retrocede el reloj,
 * pero lo que ya se vivió se puede mirar.
 */
export function imageBlock(trade, kind, { reached, blindActive, sessionId }) {
  const image = trade.images?.[kind];
  if (!image) return null;
  if (blindActive && (!trade.blind || trade.session !== sessionId)) return 'date';
  // Sin hora guardada, lo único seguro es que se tomó después de su momento en la orden
  const momentOf = { decision: trade.time, entry: trade.fill_time, exit: exitCaptureTime(trade.exit_time, TF_MS[trade.timeframe] ?? 0) };
  const shownUntil = image.sim_time ?? momentOf[kind];
  return reached && shownUntil > reached ? 'future' : null;
}

/** La orden terminó después de lo vivido en esta corrida: su resultado anticipa lo que viene */
export function orderAhead(trade, { reached }) {
  const end = trade.exit_time ?? trade.cancel_time;
  return !!reached && !!end && end > reached;
}

const REAL_DATE = { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' };

/**
 * Una orden del registro en el gráfico: a dónde ir y qué dibujar, o por qué no se puede.
 * El registro guarda órdenes de todas las sesiones, y el gráfico solo muestra hasta la hora simulada:
 * una orden de una fecha posterior no se puede dibujar sin mostrar velas que esta corrida no ha vivido.
 * `now` es la hora simulada a la vista. Devuelve { problem } o { time, price, timeframe, line, box }.
 */
export function registryChartView(trade, { now, symbol, blindActive, sessionId }) {
  if (trade.symbol && symbol && trade.symbol !== symbol) return { problem: `Esta orden es de ${trade.symbol}: abre ese símbolo para verla.` };
  if (blindActive && trade.session !== sessionId) {
    return { problem: 'Con fecha oculta no se muestran órdenes de otras sesiones: ubicarlas en el gráfico revelaría la época.' };
  }
  const start = trade.fill_time ?? trade.time;
  const end = trade.exit_time ?? trade.cancel_time ?? null;
  if (!Number.isFinite(start)) return { problem: 'La orden no guardó su hora.' };
  const date = (ms) => (blindActive ? maskDate(ms) : new Date(ms).toLocaleString('es-CO', REAL_DATE));
  if (!Number.isFinite(now)) return { problem: 'Inicia la simulación para ver la orden en el gráfico.' };
  if (start > now) {
    return {
      problem: `Esta orden es del ${date(start)} y la simulación va en ${date(now)}. El gráfico solo muestra hasta la hora simulada: `
        + `para verla dibujada, inicia la simulación en una fecha posterior${end ? ` al ${date(end)}` : ''}, o avanza hasta ahí.`
    };
  }
  const filled = trade.fill_time != null;
  const entry = Number(trade.fill_price ?? trade.entry);
  const view = {
    time: start, price: Number.isFinite(entry) ? entry : null, timeframe: trade.timeframe,
    line: filled ? { entryTime: start, exitTime: end !== null && end <= now ? end : null, tradeNumber: trade.trade_number ?? trade.order_number ?? '' } : null,
    box: null,
    partial: end !== null && end > now // Termina después de la hora simulada: se dibuja solo hasta ahí
  };
  const stop = Number(trade.stop), target = Number(trade.target);
  // La caja de una orden de esta sesión ya está entre los dibujos del gráfico
  if (filled && Number.isFinite(entry) && trade.session !== sessionId && (trade.stop != null || trade.target != null)) {
    view.box = {
      side: trade.side === 'short' ? 'short' : 'long', entry,
      stop: trade.stop != null && Number.isFinite(stop) ? stop : null,
      target: trade.target != null && Number.isFinite(target) ? target : null,
      start, end: end !== null && end <= now ? end : null
    };
  }
  return view;
}

/** Qué muestra la imagen: su marco, su hora y si salió después de lo que debía mostrar */
export function imageCaption(trade, kind) {
  const image = trade.images?.[kind];
  if (!image?.sim_time) return null;

  const parts = [image.frame, simulatedDate(trade, image.sim_time)].filter(Boolean);
  if (kind === 'entry' && trade.exit_time && image.sim_time >= trade.exit_time) parts.push('tomada después del cierre');
  return parts.join(' · ');
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

export const fetchMeasures = (symbol) => read(`measures/${symbol}`);

export function fetchPatterns({ symbol, blind, includeRewound, until }) {
  const params = new URLSearchParams({ blind, include_rewound: String(includeRewound) });
  if (until) params.append('until', until);
  return read(`patterns/${symbol}?${params}`);
}

/** La tabla por año termina en el año de la hora simulada: con fecha oculta lo delataría */
export const yearsToShow = (years) => (isBlind() ? [] : years);

export const exportUrl = (symbol) => `${API_BASE_URL}/api/observer/export/${symbol}?hide_dates=${isBlind()}`;

/** Campos de la regla listos para enviar, o el motivo por el que no se puede probar */
export function ruleRequest({ conditions, side, stopAtr, targetR, horizon, cooldown }) {
  const parsed = conditions.map(condition => ({ ...condition, value: parseFloat(condition.value) }));
  if (parsed.some(condition => !Number.isFinite(condition.value))) return { error: 'Cada condición necesita un valor.' };
  const numbers = { stop_atr: parseFloat(stopAtr), target_r: parseFloat(targetR), horizon: parseInt(horizon, 10), cooldown: parseInt(cooldown, 10) };
  if (Object.values(numbers).some(value => !Number.isFinite(value) || value <= 0)) return { error: 'Revisa el stop, el objetivo y las velas.' };
  return { rule: { conditions: parsed, side, ...numbers } };
}

export async function runRule(symbol, rule) {
  const response = await fetch(`${API_BASE_URL}/api/observer/rule-test/${symbol}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule)
  });
  if (!response.ok) {
    const { detail } = await response.json().catch(() => ({}));
    throw new Error(detail || `Error ${response.status}`);
  }
  return response.json();
}

// ==================== TEXTOS ====================

const STATES = { up: 'Alcista', down: 'Bajista', range: 'Consolidación' };
const OI_STATES = { up: 'Creciendo', down: 'Cayendo', mixed: 'Mixto' };
const FRAME_NAMES = { 240: '4h', 60: '1h', 30: '30m', 15: '15m', 5: '5m', 1: '1m' };
const STATUS_NAMES = { pending: 'Pendiente', open: 'Abierta', closed: 'Cerrada', cancelled: 'Cancelada' };

const price = (value) => (pricesHidden() ? priceText(value) : Math.round(value).toLocaleString('en-US'));
const percent = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
const signedPercent = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

export const statusName = (status) => STATUS_NAMES[status] || status;

/** Valor de una medida para leerlo: el tramo dice de qué lado va y la hora se lee como 14:00 */
export function formatMeasure(key, value) {
  if (value === null || value === undefined) return '—';
  if (/^leg_(15m|1h|4h)$/.test(key)) return value > 0 ? 'A favor' : 'En contra';
  if (key === 'hour') return `${value}:00`;
  return Number(value.toFixed(2));
}

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

const VPA_STATES = { favor: 'a favor', neutral: 'neutro', against: 'en contra' };
const VPA_LAST = {
  absorb: 'esfuerzo sin resultado', trap: 'resultado sin esfuerzo', valid: 'validado', star: 'estrella',
  hammer: 'martillo', hang: 'hanging man', doji: 'doji', fade: 'el esfuerzo se agota'
};

/** El lector VPA en el minuto de la orden: el medidor de su marco, los elementos Q de las 3 últimas velas y los marcos mayores */
export function vpaRow(row) {
  if (!row.rule) return { label: 'Lector VPA', you: row.you ? row.you.join(', ') : '—', rule: 'Sin lectura (pocos días de velas)', verdict: null };
  const sign = row.meter >= 0 ? '+' : '';
  const strong = Math.abs(row.meter) >= row.thr ? ', fuerte' : '';
  const els = (row.elements || []).map(e => {
    const side = e.dir > 0 ? 'alcista' : 'bajista';
    const when = e.ago === 0 ? 'última vela' : `hace ${e.ago} ${e.ago === 1 ? 'vela' : 'velas'}`;
    return `${VPA_CODES[e.code] || e.code} ${side} (${e.code}, ${when})`;
  });
  const last = Object.keys(row.last || {}).map(key => VPA_LAST[key] || key);
  const higher = ['60', '240'].filter(tf => String(row.tf) !== tf && row.higher?.[tf])
    .map(tf => `${FRAME_NAMES[tf]} ${VPA_STATES[row.higher[tf]]}`);
  const mood = row.meter >= 0 ? 'fuerza' : 'debilidad';
  const parts = [`${FRAME_NAMES[row.tf] || row.tf}: medidor ${sign}${row.meter.toFixed(2)} (${mood}), ${VPA_STATES[row.rule]} de la orden${strong}`];
  if (els.length) parts.push(els.join('; '));
  if (last.length) parts.push(`última vela: ${last.join(', ')}`);
  if (higher.length) parts.push(higher.join(' · '));
  return {
    label: 'Lector VPA', you: row.you ? row.you.join(', ') : 'Tu orden', rule: parts.join(' — '), verdict: verdict(row.agree),
    note: row.agree === null ? 'Medidor entre −0.3 y +0.3: el lector no se inclina' : null
  };
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
    if (row.block === 'vpa') return vpaRow(row);
    return volumeRow(row);
  });
  return { rows };
}

export { reasonLabel };
