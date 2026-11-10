// Elementos de Orderflows Unlocked: catálogo, parámetros y reglas puras del dibujo.
// La detección está en backend/of_elements.py; aquí solo se decide qué y hasta dónde se dibuja.

/**
 * Código: nombre, forma y grupo. Forma: band = franja que sigue hasta que el precio vuelve,
 * mark = celdas de la vela con glifo, box = contorno sobre varias velas, table = solo la tabla de la vela.
 */
export const OF_ELEMENTS = {
  VA: { name: 'VA abandonada', shape: 'band', group: 'zones' },
  OG: { name: 'Orderflows Gap', shape: 'band', group: 'zones' },
  AP: { name: 'POC alineado', shape: 'band', group: 'zones' },
  SL: { name: 'POC Slingshot', shape: 'band', group: 'zones' },
  RL: { name: 'Absorción (propuesta)', shape: 'band', group: 'zones' },
  EX: { name: 'Exhaustion Print', shape: 'band', group: 'turn' },
  ZP: { name: 'Zero Print', shape: 'mark', group: 'turn' },
  DT: { name: 'Delta Tail', shape: 'band', group: 'turn' },
  RS: { name: 'Retail Suck', shape: 'band', group: 'turn' },
  DD: { name: 'Delta Divergence', shape: 'band', group: 'turn' },
  PD: { name: 'Price Action Divergence', shape: 'mark', group: 'turn' },
  IV: { name: 'Inverse Imbalance', shape: 'mark', group: 'turn' },
  AD: { name: 'Acumulación/Distribución', shape: 'band', group: 'turn' },
  SW: { name: 'Market Sweep', shape: 'band', group: 'trend' },
  VL: { name: 'Vertical Liquidity', shape: 'mark', group: 'trend' },
  SQ: { name: 'Orderflows Sequencing', shape: 'mark', group: 'trend' },
  DB: { name: 'Delta Breakout', shape: 'box', group: 'trend' },
  PW: { name: 'POC Wave', shape: 'box', group: 'trend' },
  DV: { name: 'Delta/Volume extremo', shape: 'table', group: 'table' },
  // Solo en velas con volumen alto (volFilter): sin ese filtro marcan del 12% al 74% de las velas
  OP: { name: 'Open POC', shape: 'band', group: 'zones', volume: true },
  IR: { name: 'Imbalance Reversal', shape: 'band', group: 'turn', volume: true },
  VD: { name: 'Volume Decline', shape: 'mark', group: 'turn', volume: true },
  RX: { name: 'Ratio de extremos', shape: 'mark', group: 'turn', volume: true },
  ST: { name: 'Stacked Imbalance', shape: 'band', group: 'trend', volume: true },
  VI: { name: 'Volume Imbalance (3 o más)', shape: 'box', group: 'trend', volume: true },
  RD: { name: 'Imbalance Reload', shape: 'band', group: 'trend', volume: true },
  TP: { name: 'Thin Print', shape: 'mark', group: 'trend', volume: true },
  // Con el almacén de flujo: delta exacto dentro de la vela y órdenes agresivas reales
  GR: { name: 'Orden grande', shape: 'band', group: 'zones', flow: true },
  BR: { name: 'Barrido real (3 precios o más)', shape: 'band', group: 'trend', flow: true },
  XD: { name: 'Extreme Delta (cierra en su extremo)', shape: 'table', group: 'table', flow: true },
  SM: { name: 'Small Min/Max Delta', shape: 'table', group: 'table', flow: true }
};

export const OF_GROUPS = [
  ['zones', 'Zonas', 'Franjas que siguen vivas hasta que el precio vuelve'],
  ['turn', 'Giro en la zona', 'Agotamiento, absorción y divergencias en el extremo de la vela'],
  ['trend', 'Continuación', 'Agresión que empuja: barridos, liquidez vertical, saltos de delta'],
  ['table', 'Tabla de la vela', 'Se marca en el panel, no sobre las velas: Δ/Vol, Delta en su extremo y Máx o Mín Δ casi en cero']
];

// Los de fábrica: unos pocos por grupo, para no saturar el gráfico. El resto se activa en el modal
const DEFAULT_CODES = ['VA', 'OG', 'EX', 'DT', 'DD', 'AD', 'SW', 'VL', 'DB', 'DV', 'GR', 'BR', 'XD', 'SM'];

export function defaultOFElementsConfig() {
  return {
    codes: Object.fromEntries(Object.keys(OF_ELEMENTS).map(code => [code, DEFAULT_CODES.includes(code)])),
    target: 5, // % de las velas que marca cada elemento con umbral relativo
    volFilter: 2, // Volumen mínimo de la vela para los elementos con filtro, en veces la mediana de las 20 anteriores
    showBands: true,
    showGlyphs: true,
    showTable: true,
    showEMA: false, // EMA 14: el "Momentum Strength" de las láminas
    maxBands: 25, // Franjas vivas que se dibujan, las más recientes
    bandOpacity: 0.16
  };
}

const LIMITS = { target: [1, 20], volFilter: [0, 10], maxBands: [0, 200], bandOpacity: [0.04, 0.5] };

/** Parámetros listos para aplicar: números dentro de su rango y solo códigos conocidos */
export function cleanOFElementsConfig(values = {}) {
  const defaults = defaultOFElementsConfig();
  const clean = { ...defaults, ...values };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const number = parseFloat(values[key]);
    clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : defaults[key];
  }
  clean.maxBands = Math.round(clean.maxBands);
  clean.codes = Object.fromEntries(Object.keys(OF_ELEMENTS).map(code => [code, !!(values.codes?.[code] ?? defaults.codes[code])]));
  for (const key of ['showBands', 'showGlyphs', 'showTable', 'showEMA']) clean[key] = !!clean[key];
  return clean;
}

const SETTINGS_KEY = 'of_elements_settings_';

export function loadOFElementsSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveOFElementsSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

export const eventKey = (event) => `${event.code}|${event.dir}|${event.t}|${event.lo}|${event.hi}`;

/** Primer índice con timestamp >= time en velas ordenadas */
export function firstFrom(candles, time) {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].timestamp < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Hora en que el precio volvió a la franja, o null si sigue viva. Solo mira velas conocidas que
 * empiezan después de que la franja se conoce. `memo` guarda hasta dónde se revisó, para que cada
 * cuadro solo mire las velas nuevas; se rehace si las velas conocidas cambian hacia atrás.
 */
export function bandEnd(event, candles, memo = {}) {
  const last = candles.length ? candles[candles.length - 1] : null;
  if (memo.end != null) {
    if (last && memo.end <= last.timestamp) return memo.end;
    memo.end = null; // Se retrocedió el reloj: la vela que la tocó todavía no ocurre
    memo.next = undefined;
  }
  let index = memo.next;
  if (index === undefined || index > candles.length || memo.base !== event.known) {
    index = firstFrom(candles, event.known);
    memo.base = event.known;
  }
  for (; index < candles.length; index++) {
    const candle = candles[index];
    if (candle.high >= event.lo && candle.low <= event.hi) {
      memo.end = candle.timestamp;
      return memo.end;
    }
  }
  // La última vela puede seguir formándose: la próxima vez se vuelve a revisar
  memo.next = Math.max(firstFrom(candles, event.known), candles.length - 1);
  return null;
}

/** Eventos que se conocen a la hora dada y están activos en el modal */
export function knownEvents(events, knownUntil, codes) {
  return events.filter(event => event.known <= knownUntil && codes[event.code]);
}

/** EMA de 14 y su pendiente en 3 velas, en ATR: el "Momentum Strength" de las láminas */
export function emaSeries(candles, period = 14) {
  const k = 2 / (period + 1);
  const ema = [];
  const atr = [];
  let trSum = 0;
  const trs = [];
  candles.forEach((candle, i) => {
    ema.push(i === 0 ? candle.close : candle.close * k + ema[i - 1] * (1 - k));
    const prevClose = i ? candles[i - 1].close : candle.close;
    const tr = Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
    trs.push(tr);
    trSum += tr;
    if (trs.length > period) trSum -= trs[trs.length - period - 1];
    atr.push(trSum / Math.min(trs.length, period));
  });
  const slope = ema.map((value, i) => (i >= 3 && atr[i] > 0 ? (value - ema[i - 3]) / atr[i] : 0));
  return { ema, slope };
}
