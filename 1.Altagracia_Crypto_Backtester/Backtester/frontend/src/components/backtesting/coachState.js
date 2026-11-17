/**
 * Estado de App 1 para el entrenador (17/11/2026): lo que hay en pantalla, de solo lectura, para que Claude
 * (skill /entrenar, con el navegador integrado o Claude in Chrome) vea lo que el usuario está mirando.
 *
 * Nada aquí cambia la app: se lee del reloj, las órdenes, los indicadores y lo elegido. Solo lo ya ocurrido
 * hasta la hora a la vista. Con "Fecha al azar y oculta" las fechas van como "Día N HH:MM" y precios y
 * volúmenes en la escala oculta, como en pantalla. `query` lleva las horas reales solo para pedir datos al
 * backend de App 1 (que corta en `known_until`): no se le muestran al usuario.
 */
import { isBlind, maskDate, maskPrice, maskVolume, pricesHidden } from './blindClock.js';
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

/**
 * Instala `window.__app1Coach` con lectura y las conversiones a lo que ve el usuario. Devuelve cómo quitarlo.
 * `read` es una función que devuelve lo que pide buildCoachState en ese momento.
 */
export function installCoach(read, target = typeof window !== 'undefined' ? window : null) {
  if (!target) return () => {};
  const api = Object.freeze({
    version: 1,
    state: () => buildCoachState(read()),
    // Lo que da el backend (precios, volúmenes y horas reales) en lo que ve el usuario
    price: (value) => priceOut(Number(value)),
    volume: (value) => volumeOut(Number(value)),
    time: (timestamp) => timeText(Number(timestamp)),
    // Atajos de solo lectura al backend, con todo en lo que ve el usuario
    footprints: (n) => coachFootprints(buildCoachState(read()), n),
    elements: (n) => coachElements(buildCoachState(read()), n),
    get: (path, params) => getJson(path, params)
  });
  target.__app1Coach = api;
  return () => {
    if (target.__app1Coach === api) delete target.__app1Coach;
  };
}
