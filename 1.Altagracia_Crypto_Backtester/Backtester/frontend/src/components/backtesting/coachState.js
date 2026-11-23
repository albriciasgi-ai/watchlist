/**
 * Estado de App 1 para el entrenador (17/11/2026): lo que hay en pantalla, de solo lectura, para que Claude
 * (skill /entrenar, con el navegador integrado o Claude in Chrome) vea lo que el usuario está mirando.
 *
 * Nada aquí cambia la app: se lee del reloj, las órdenes, los indicadores y lo elegido. Solo lo ya ocurrido
 * hasta la hora a la vista. Con "Fecha al azar y oculta" las fechas van como "Día N HH:MM" y precios y
 * volúmenes en la escala oculta, como en pantalla. `query` lleva las horas reales solo para pedir datos al
 * backend de App 1 (que corta en `known_until`): no se le muestran al usuario.
 */
import { isBlind, maskDate, maskPrice, maskVolume, pricesHidden, unmaskPrice } from './blindClock.js';
import { knownLevels, chosenLabel } from '../indicators/analysisLevels.js';
import { latestFreeBox } from './orderPlan.js';
import { API_BASE_URL } from '../../config.js';

const COLOMBIA_OFFSET_MS = 5 * 3600000;
const LAST_CANDLES = 30;
const MAX_CONFIG_CHARS = 2000;

const MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };

const round = (value, digits) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : value ?? null);

/** Hora para leer: "Día N HH:MM" con fecha oculta, si no la hora de Colombia */
export function timeText(timestamp) {
  if (!Number.isFinite(timestamp)) return null;
  if (isBlind()) return maskDate(timestamp);
  return new Date(timestamp - COLOMBIA_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' COL';
}

const priceOut = (price) => round(maskPrice(price), pricesHidden() ? 3 : 6);
const volumeOut = (volume) => round(maskVolume(volume), 3);

/** Configuración de un indicador, sin funciones ni referencias circulares y corta */
function plainConfig(config) {
  if (!config || typeof config !== 'object') return null;
  try {
    const seen = new WeakSet();
    const text = JSON.stringify(config, (key, value) => {
      if (typeof value === 'function') return undefined;
      // Con fecha oculta una hora guardada en los ajustes (un rango fijo, una vela fijada) revelaría la época
      if (isBlind() && typeof value === 'number' && value > 1e12) return '(oculto)';
      if (value && typeof value === 'object') {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
    if (!text) return null;
    return text.length > MAX_CONFIG_CHARS ? { resumen: text.slice(0, MAX_CONFIG_CHARS) + '…' } : JSON.parse(text);
  } catch {
    return null;
  }
}

function orderOut(order) {
  const side = order.side === 'short' ? 'venta' : 'compra';
  const out = {
    trade: order.tradeNumber ?? null,
    estado: order.status,
    tipo: order.type,
    lado: side,
    entrada: priceOut(order.executedPrice ?? order.entryPrice),
    stop: priceOut(order.stopLoss),
    objetivo: priceOut(order.takeProfit),
    cantidad: volumeOut(order.quantity),
    creada: timeText(order.entryTime),
    abierta: timeText(order.executedAt)
  };
  if (order.status === 'closed') {
    out.salida = priceOut(order.exitPrice);
    out.cerrada = timeText(order.exitTime);
    out.resultado = order.pnl > 0 ? 'ganó' : order.pnl < 0 ? 'perdió' : 'empate';
    if (!pricesHidden()) out.pnl = round(order.pnl, 2);
    out.pnlPct = round(order.pnlPercent, 2);
  }
  return out;
}

/**
 * Arma el estado. `app` trae lo que BacktestingApp tiene a mano: { symbol, timeframe, currentTime,
 * playing, speed, currentPrice, indicatorStates, chart (MiniChart activo), orders, shapes }.
 */
export function buildCoachState(app) {
  const { symbol, timeframe, currentTime, playing, speed, currentPrice, indicatorStates = {}, chart, orders = [], shapes = [] } = app || {};
  if (!symbol || !Number.isFinite(currentTime)) {
    return { listo: false, aviso: 'App 1 todavía no tiene una simulación iniciada.' };
  }

  // Velas a la vista, solo las ya ocurridas (el gráfico nunca dibuja después de la hora simulada)
  const visible = (chart?.getVisibleCandles?.() || []).filter(c => c.timestamp <= currentTime);
  const last = visible.slice(-LAST_CANDLES).map(c => ({
    hora: timeText(c.timestamp),
    o: priceOut(c.open), h: priceOut(c.high), l: priceOut(c.low), c: priceOut(c.close),
    v: volumeOut(c.volume)
  }));

  const manager = chart?.getIndicatorManager?.();
  const enabled = Object.keys(indicatorStates).filter(name => indicatorStates[name]);
  const indicators = enabled.map(name => {
    const indicator = manager?.indicators?.find(ind => ind.name === name);
    return { nombre: name, ajustes: plainConfig(indicator?.config) };
  });

  const chosen = knownLevels(symbol, currentTime).map((item, i) => ({
    n: i + 1,
    que: chosenLabel(item),
    papel: item.role || 'marca',
    nota: item.note || '',
    precio: priceOut(item.price),
    vela: timeText(item.time),
    marco: item.timeframe || null
  }));

  const live = orders.filter(o => o.status === 'pending' || o.status === 'open').map(orderOut);
  const closed = orders.filter(o => o.status === 'closed').slice(-5).map(orderOut);
  const box = latestFreeBox(shapes, orders);

  return {
    listo: true,
    fechaOculta: isBlind(),
    precioComoIndice: pricesHidden(),
    moneda: symbol,
    marco: timeframe,
    hora: timeText(currentTime),
    reproduciendo: !!playing,
    velocidad: speed ?? null,
    precio: priceOut(currentPrice),
    velasALaVista: visible.length,
    desde: timeText(visible[0]?.timestamp),
    hasta: timeText(visible[visible.length - 1]?.timestamp),
    ultimasVelas: last,
    indicadores: indicators,
    elegidoParaElAnalisis: chosen,
    ordenesVivas: live,
    ultimasCerradas: closed,
    cajaTPSL: box ? { lado: box.side === 'short' ? 'venta' : 'compra', entrada: priceOut(box.entryPrice), stop: priceOut(box.slPrice), objetivo: priceOut(box.tpPrice) } : null,
    // Solo para pedir datos al backend de App 1 (9000), nunca para decirlas: con fecha oculta revelan la época
    query: {
      symbol,
      interval: timeframe,
      interval_minutes: MINUTES[timeframe] ?? null,
      known_until: currentTime,
      start_timestamp: visible[0]?.timestamp ?? null,
      end_timestamp: visible.length ? visible[visible.length - 1].timestamp : null
    }
  };
}

/** Pide al backend de App 1 por GET (solo lectura) */
async function getJson(path, params) {
  if (!path.startsWith('/api/')) throw new Error('Solo rutas /api/ del backend de App 1');
  const query = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined)).toString();
  const response = await fetch(`${API_BASE_URL}${path}${query ? '?' + query : ''}`);
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  return response.json();
}

/** Footprints de las últimas `n` velas a la vista, cortados en la hora simulada, como los ve el usuario */
export async function coachFootprints(state, n = 6) {
  if (!state?.listo || !state.query.end_timestamp) return { listo: false };
  const { symbol, interval_minutes: interval, known_until: knownUntil, end_timestamp: end } = state.query;
  const start = end - (Math.max(1, Math.min(n, 30)) - 1) * interval * 60000;
  const data = await getJson(`/api/orderflow/historical/${symbol}`, { interval, start_timestamp: start, end_timestamp: end + interval * 60000 - 1, known_until: knownUntil, max_levels: 10 });
  const rows = (data.footprints || []).filter(fp => fp.candle_timestamp <= knownUntil).map(fp => {
    const levels = fp.levels || [];
    return {
      vela: timeText(fp.candle_timestamp),
      cerrada: !!fp.complete,
      delta: volumeOut(fp.delta),
      volumen: volumeOut(fp.total_volume),
      poc: priceOut(fp.poc),
      step: pricesHidden() ? null : fp.step_size,
      // De abajo hacia arriba: compra agresiva (ask) y venta agresiva (bid) por nivel
      niveles: levels.map(lv => ({ precio: priceOut(lv.price_mid), compra: volumeOut(lv.ask_volume), venta: volumeOut(lv.bid_volume) })),
      imbalances: (fp.imbalances || []).map(x => ({ lado: x.type === 'BUY' ? 'compra' : 'venta', precio: priceOut(levels[x.level_index]?.price_mid), ratio: x.ratio })),
      stacked: (fp.stacked_imbalances || []).map(x => ({ lado: x.direction === 'BUY' ? 'compra' : 'venta', desde: priceOut(x.start_price), hasta: priceOut(x.end_price), niveles: x.levels_count }))
    };
  });
  return { listo: true, moneda: symbol, marco: state.marco, velas: rows };
}

/** Elementos OF de las velas a la vista (las últimas `n` marcas), cortados en la hora simulada */
export async function coachElements(state, n = 25) {
  if (!state?.listo || !state.query.start_timestamp) return { listo: false };
  const { symbol, interval_minutes: interval, known_until: knownUntil, start_timestamp: start, end_timestamp: end } = state.query;
  const data = await getJson(`/api/orderflow/elements/${symbol}`, { interval, start_timestamp: start, end_timestamp: end + interval * 60000 - 1, known_until: knownUntil });
  const catalog = data.catalog || {};
  const events = (data.events || []).filter(e => (e.known ?? e.t) <= knownUntil).slice(-Math.max(1, Math.min(n, 200))).map(e => ({
    codigo: e.code,
    nombre: catalog[e.code]?.[0] ?? null,
    lado: e.dir > 0 ? 'alcista' : e.dir < 0 ? 'bajista' : null,
    vela: timeText(e.t),
    desdeVela: e.t0 !== e.t ? timeText(e.t0) : undefined,
    precioBajo: priceOut(e.lo),
    precioAlto: priceOut(e.hi)
  }));
  return { listo: true, aviso: data.warming ? 'Sin 30 días de historia: solo los elementos literales' : undefined, marcas: events };
}

// ==================== LO QUE DIBUJA EL ENTRENADOR (23/11/2026) ====================
// Pedido del usuario tras el análisis de LuxAlgo Quant: que Claude pueda señalar en el gráfico lo que explica, solo en
// /entrenar y después de la predicción del usuario. Es una capa aparte: no son dibujos del usuario, no se guardan en
// la sesión, no salen en las imágenes de los trades y no entran al análisis de ninguna orden. Se van al recargar.
// Claude habla en lo que ve el usuario: precios en la escala a la vista (el índice, con fecha oculta) y velas contadas
// hacia atrás desde la última cerrada (0 = la última), nunca fechas. Así no puede señalar nada después de la hora
// simulada ni revelar la época.
const MAX_NOTES = 20;
const MAX_NOTE_TEXT = 80;
const NOTE_KINDS = { linea: 'line', zona: 'zone', marca: 'mark' };
let notes = { symbol: null, items: [] };
const noteListeners = new Set();

/** Lo dibujado por el entrenador para esa moneda: [{ kind, price | low+high, time, text }] en precios y horas reales */
export const coachNotes = (symbol) => (notes.symbol === symbol ? notes.items : []);

/** Avisa cada vez que cambia lo dibujado. Devuelve cómo dejar de escuchar */
export function onCoachNotes(listener) {
  noteListeners.add(listener);
  return () => noteListeners.delete(listener);
}

function setNotes(symbol, items) {
  notes = { symbol, items };
  noteListeners.forEach(listener => listener());
}

/**
 * Pasa lo que pide el entrenador a precios y horas reales. `candles`: las velas cerradas a la vista, en orden.
 * Cada figura: { tipo: 'linea', precio, texto } · { tipo: 'zona', desde, hasta, texto } · { tipo: 'marca', precio?, texto },
 * todas con `velasAtras` opcional (0 = la última vela cerrada a la vista; la línea y la zona nacen ahí y siguen a la
 * derecha; sin él nacen en la primera vela a la vista). Devuelve { items, rechazadas: [motivo] }.
 */
export function normalizeNotes(list, candles) {
  const items = [];
  const rejected = [];
  if (!candles?.length) return { items, rechazadas: ['No hay velas cerradas a la vista'] };
  const real = (value) => {
    const n = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(n) && n > 0 ? unmaskPrice(n) : null;
  };
  const floor = Math.min(...candles.map(c => c.low));
  const top = Math.max(...candles.map(c => c.high));
  const span = top - floor || top * 0.01;
  const near = (price) => price > floor - 3 * span && price < top + 3 * span;
  (Array.isArray(list) ? list : [list]).forEach((raw, i) => {
    const label = 'figura ' + (i + 1);
    if (items.length >= MAX_NOTES) return rejected.push(label + ': hay un máximo de ' + MAX_NOTES);
    const kind = NOTE_KINDS[raw?.tipo];
    if (!kind) return rejected.push(label + ': tipo desconocido (linea, zona o marca)');
    const back = raw.velasAtras === undefined || raw.velasAtras === null ? null : Math.floor(Number(raw.velasAtras));
    if (back !== null && !(back >= 0 && back < candles.length)) return rejected.push(label + ': velasAtras fuera de las ' + candles.length + ' velas a la vista');
    const candle = back === null ? null : candles[candles.length - 1 - back];
    const text = String(raw.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_TEXT);
    if (kind === 'zone') {
      const a = real(raw.desde);
      const b = real(raw.hasta);
      if (a === null || b === null || !near(a) || !near(b)) return rejected.push(label + ': desde y hasta deben ser precios cercanos a lo que se ve');
      return items.push({ kind, low: Math.min(a, b), high: Math.max(a, b), time: (candle || candles[0]).timestamp, text });
    }
    if (kind === 'line') {
      const price = real(raw.precio);
      if (price === null || !near(price)) return rejected.push(label + ': precio lejos de lo que se ve');
      return items.push({ kind, price, time: (candle || candles[0]).timestamp, text });
    }
    if (!candle) return rejected.push(label + ': una marca pide velasAtras');
    const given = raw.precio !== undefined && raw.precio !== null;
    const price = given ? real(raw.precio) : null;
    if (given && (price === null || !near(price))) return rejected.push(label + ': precio lejos de lo que se ve');
    // Sin precio, la marca va sobre el máximo de su vela, para no taparla
    return items.push({ kind, price: price ?? candle.high, above: !given, time: candle.timestamp, text });
  });
  return { items, rechazadas: rejected };
}

/** Dibuja (reemplaza lo anterior, o suma con `sumar`) y dice cuántas quedaron y cuáles no entraron */
export function coachDraw(app, list, { sumar = false } = {}) {
  const { symbol, currentTime, chart } = app || {};
  if (!symbol || !Number.isFinite(currentTime)) return { listo: false, aviso: 'App 1 todavía no tiene una simulación iniciada.' };
  const candles = (chart?.getVisibleCandles?.() || []).filter(c => c.timestamp <= currentTime);
  const { items, rechazadas } = normalizeNotes(list, candles);
  const kept = (sumar ? [...coachNotes(symbol), ...items] : items).slice(-MAX_NOTES);
  setNotes(symbol, kept);
  chart?.redraw?.();
  return { listo: true, dibujadas: kept.length, rechazadas };
}

/** Borra todo lo dibujado por el entrenador */
export function coachClear(app) {
  setNotes(app?.symbol ?? null, []);
  app?.chart?.redraw?.();
  return { listo: true, dibujadas: 0 };
}

/**
 * Instala `window.__app1Coach` con lectura y las conversiones a lo que ve el usuario. Devuelve cómo quitarlo.
 * `read` es una función que devuelve lo que pide buildCoachState en ese momento.
 */
export function installCoach(read, target = typeof window !== 'undefined' ? window : null) {
  if (!target) return () => {};
  const api = Object.freeze({
    version: 2,
    state: () => buildCoachState(read()),
    // Lo que da el backend (precios, volúmenes y horas reales) en lo que ve el usuario
    price: (value) => priceOut(Number(value)),
    volume: (value) => volumeOut(Number(value)),
    time: (timestamp) => timeText(Number(timestamp)),
    // Atajos de solo lectura al backend, con todo en lo que ve el usuario
    footprints: (n) => coachFootprints(buildCoachState(read()), n),
    elements: (n) => coachElements(buildCoachState(read()), n),
    get: (path, params) => getJson(path, params),
    // Lo único que no es lectura: figuras del entrenador en una capa aparte, que no toca nada del usuario. Solo después
    // de que el usuario dio su predicción (lo exige el skill /entrenar)
    draw: (list, options) => coachDraw(read(), list, options),
    clearDrawings: () => coachClear(read())
  });
  target.__app1Coach = api;
  return () => {
    if (target.__app1Coach === api) delete target.__app1Coach;
  };
}
