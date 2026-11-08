// Zonas de liquidaciones pasadas: precios donde se liquidó mucho dinero en una ventana hacia atrás.
// Cada celda dice cuándo se conoce (`known`): un evento con hora en su hora, un día de MarginPad al
// cerrar ese día. Una zona solo usa celdas conocidas en la hora simulada.
//
// Celda: { known, start, end, low, high, long, short, source }
//   long: USD de largos liquidados (ventas forzadas). short: USD de cortos liquidados (compras forzadas)

import { countBefore } from '../backtesting/replayClock.js';

export const DAY_MS = 86400000;

export function defaultZoneRules() {
  return {
    lookbackDays: 30, // Ventana hacia atrás
    binPct: 0.1, // Ancho de cada franja de precio, como % del precio
    maxHalfBins: 1, // Franjas a cada lado del pico que puede abarcar una zona: el núcleo del pico
    halfFraction: 0.5 // Una franja vecina entra si tiene al menos esta parte del pico
  };
}

export function defaultPickRules() {
  return {
    perSide: 3, // Zonas arriba y abajo del precio
    maxDistancePct: 6, // Distancia máxima al precio, en %
    minShare: 0.05, // Una zona más chica que esta parte de la mayor de la ventana no se muestra
    minGapPct: 0.25, // Espacio libre mínimo entre dos zonas mostradas: un barrido ancho no llena el gráfico
    showLongs: true,
    showShorts: true
  };
}

/** Paso redondo más cercano en escala logarítmica: 1, 2, 2.5 o 5 por una potencia de 10 */
export function niceStep(value) {
  if (!(value > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  let best = power;
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (Math.abs(Math.log(factor * power / value)) < Math.abs(Math.log(best / value))) best = factor * power;
  }
  return +best.toPrecision(12);
}

/** Primera posición con known mayor que t. Las celdas van ordenadas por known */
export function knownAfter(cells, t) {
  let low = 0;
  let high = cells.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cells[middle].known <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Celdas conocidas en (time - lookback, time]: posiciones [from, to) */
export function windowRange(cells, time, lookbackMs) {
  return [knownAfter(cells, time - lookbackMs), knownAfter(cells, time)];
}

/** Ancho de franja para un precio: nunca más fino que las celdas de la fuente */
export function binWidthFor(price, binPct, cellWidth = 0) {
  return Math.max(niceStep(price * binPct / 100), cellWidth);
}

/**
 * Zonas de todos los precios con las celdas [from, to). Cada pico del histograma suavizado es una zona;
 * abarca las franjas vecinas que bajan desde el pico sin caer de halfFraction.
 * birth: cuando la zona juntó la mitad de su dinero. last: su liquidación más reciente.
 */
export function buildZones(cells, from, to, width, rules = defaultZoneRules()) {
  if (!(width > 0) || to <= from) return [];
  const { maxHalfBins, halfFraction } = { ...defaultZoneRules(), ...rules };

  const bins = new Map();
  const binOf = (cell) => Math.floor((cell.low + cell.high) / 2 / width);
  for (let i = from; i < to; i++) {
    const cell = cells[i];
    const key = binOf(cell);
    const bin = bins.get(key);
    if (bin) {
      bin.long += cell.long;
      bin.short += cell.short;
    } else {
      bins.set(key, { long: cell.long, short: cell.short });
    }
  }

  const raw = (key) => {
    const bin = bins.get(key);
    return bin ? bin.long + bin.short : 0;
  };
  const smooth = (key) => 0.25 * raw(key - 1) + 0.5 * raw(key) + 0.25 * raw(key + 1);

  // Un pico sube desde la izquierda y no baja hacia la derecha: en una meseta gana la franja de la izquierda
  const peaks = [];
  for (const key of bins.keys()) {
    const value = smooth(key);
    if (value > 0 && value > smooth(key - 1) && value >= smooth(key + 1)) peaks.push({ key, value });
  }
  peaks.sort((a, b) => b.value - a.value || a.key - b.key);

  const owner = new Map(); // franja → zona
  const zones = [];
  for (const { key, value } of peaks) {
    if (owner.has(key)) continue;
    const zone = { index: zones.length, from: key, to: key, peakKey: key };
    owner.set(key, zone);
    for (const step of [-1, 1]) {
      let previous = key;
      for (let k = 1; k <= maxHalfBins; k++) {
        const next = key + step * k;
        const level = smooth(next);
        if (owner.has(next) || raw(next) <= 0 || level > smooth(previous) || level < halfFraction * value) break;
        owner.set(next, zone);
        if (step < 0) zone.from = next;
        else zone.to = next;
        previous = next;
      }
    }
    zones.push(zone);
  }

  for (const zone of zones) {
    let long = 0;
    let short = 0;
    let best = -1;
    for (let k = zone.from; k <= zone.to; k++) {
      const bin = bins.get(k);
      if (!bin) continue;
      long += bin.long;
      short += bin.short;
      if (bin.long + bin.short > best) {
        best = bin.long + bin.short;
        zone.peakKey = k;
      }
    }
    Object.assign(zone, {
      low: zone.from * width,
      high: (zone.to + 1) * width,
      peak: (zone.peakKey + 0.5) * width,
      long,
      short,
      total: long + short,
      side: long >= short ? 'long' : 'short',
      gathered: 0,
      birth: null,
      last: null,
      first: null
    });
  }

  // Las celdas van en orden de known: la zona nace cuando junta la mitad de su dinero
  for (let i = from; i < to; i++) {
    const cell = cells[i];
    const zone = owner.get(binOf(cell));
    if (!zone) continue;
    if (zone.first === null) zone.first = cell.known;
    zone.last = cell.known;
    zone.gathered += cell.long + cell.short;
    if (zone.birth === null && zone.gathered >= zone.total / 2) zone.birth = cell.known;
  }

  return zones
    .filter(zone => zone.total > 0)
    .map(({ from: _from, to: _to, peakKey, gathered, index, ...zone }) => ({ ...zone, key: peakKey }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Zonas cerca del precio: de la mayor a la menor, las perSide de cada lado dentro de maxDistancePct y las que
 * tienen el precio adentro. Una zona que deja menos de minGapPct de espacio con otra mayor ya elegida no se muestra.
 * La intensidad se mide contra la mayor zona de la ventana, de cualquier precio.
 */
export function pickZones(zones, price, rules = defaultPickRules()) {
  const { perSide, maxDistancePct, minShare, minGapPct, showLongs, showShorts } = { ...defaultPickRules(), ...rules };
  const max = zones.reduce((best, zone) => Math.max(best, zone.total), 0);
  if (!(max > 0) || !Number.isFinite(price)) return { zones: [], max, above: [], below: [] };

  const gap = price * (minGapPct || 0) / 100;
  const chosen = [];
  const above = [];
  const below = [];
  for (const zone of [...zones].sort((a, b) => b.total - a.total)) {
    if (zone.total < minShare * max || !(zone.side === 'long' ? showLongs : showShorts)) continue;
    const side = zone.low > price ? above : zone.high < price ? below : null;
    if (side && (side.length >= perSide || Math.abs(zoneDistancePct(zone, price)) > maxDistancePct)) continue;
    // Espacio entre bordes: negativo si se tocan o se montan
    if (chosen.some(other => Math.max(other.low, zone.low) - Math.min(other.high, zone.high) < gap)) continue;
    chosen.push(zone);
    if (side) side.push(zone);
  }
  const withShare = (zone) => ({ ...zone, share: zone.total / max, distancePct: zoneDistancePct(zone, price) });
  return {
    zones: chosen.map(withShare),
    max,
    above: above.map(withShare),
    below: below.map(withShare)
  };
}

/** Distancia del precio al borde más cercano de la zona, en % (con signo: positivo arriba) */
export function zoneDistancePct(zone, price) {
  if (zone.low > price) return (zone.low - price) / price * 100;
  if (zone.high < price) return (zone.high - price) / price * 100;
  return 0;
}

/**
 * Fuente que se usa en esa hora: la de mayor prioridad que cubre esa hora y, si ninguna la cubre, la de
 * mayor prioridad con datos dentro de la ventana. La lista viene ordenada por prioridad (todo el mercado,
 * después Binance, después Bitfinex) y nunca se mezclan, porque sus montos no se pueden comparar.
 */
export function activeSource(sources, time, lookbackMs, preferred = 'auto') {
  // Con una fuente elegida a mano solo cuenta esa, para comparar fuentes en la misma fecha
  const list = (sources || []).filter(source => !preferred || preferred === 'auto' || source.id === preferred);
  // Los tramos con datos: una descarga con huecos no cubre las fechas que le faltan
  const ranges = (source) => source.ranges?.length ? source.ranges : [[source.first, source.last]];
  return list.find(source => ranges(source).some(([from, to]) => from <= time && time <= to + DAY_MS))
    || list.find(source => ranges(source).some(([from, to]) => from <= time && time - lookbackMs < to))
    || null;
}

/** Tramos de una fuente en texto, con fechas UTC: 25/06/2023–14/10/2024 */
export function coverageText(source, limit = 3) {
  const day = (timestamp) => new Date(timestamp).toISOString().slice(0, 10).split('-').reverse().join('/');
  const ranges = source.ranges?.length ? source.ranges : [[source.first, source.last]];
  const shown = ranges.slice(-limit).map(([from, to]) => `${day(from)}–${day(to - 1)}`);
  return ranges.length > limit ? `${shown.join(', ')} y ${ranges.length - limit} tramos antes` : shown.join(', ');
}

// Un paso de la regla de cruce con una vela: primero el precio sale de la zona con un cierre, después la cruzada
// es llegar más allá del borde contrario. La vela que define el lado de salida no cuenta como cruce.
function crossStep(state, candle, zone) {
  if (state.side === null) {
    if (candle.close > zone.high) state.side = 'above';
    else if (candle.close < zone.low) state.side = 'below';
    return false;
  }
  return state.side === 'above' ? candle.low < zone.low : candle.high > zone.high;
}

/**
 * Si el precio ya atravesó cada zona después de nacer: salió de ella con un cierre y después llegó más allá del
 * borde contrario. Así una zona que nace en medio de un movimiento no queda cruzada por ese mismo movimiento.
 * Solo revisa las velas nuevas. La vela en formación se mira en cada consulta sin guardarse, porque todavía cambia.
 */
export class CrossTracker {
  constructor() {
    this.states = new Map();
    this.candles = null;
  }

  reset() {
    this.states.clear();
    this.candles = null;
  }

  crossed(zone, candles) {
    if (!candles?.length || !Number.isFinite(zone.birth)) return false;
    if (candles !== this.candles || this.states.size > 500) {
      this.states.clear();
      this.candles = candles;
    }
    const last = candles[candles.length - 1];
    const closed = last.in_progress ? candles.length - 1 : candles.length;

    const key = `${zone.birth}|${zone.low}|${zone.high}`;
    let state = this.states.get(key);
    if (!state || state.index > closed) {
      // Desde la primera vela que abre después del nacimiento: la vela del barrido no cuenta
      state = { index: countBefore(candles, zone.birth), side: null, crossed: false };
      this.states.set(key, state);
    }
    for (; !state.crossed && state.index < closed; state.index++) {
      const candle = candles[state.index];
      if (candle.timestamp < zone.birth) continue; // Una vela que llegó después pero abrió antes del nacimiento
      state.crossed = crossStep(state, candle, zone);
    }
    if (state.crossed) return true;
    if (!last.in_progress || last.timestamp < zone.birth || state.side === null) return false;
    return crossStep({ side: state.side }, last, zone);
  }
}

// El máximo y el mínimo de cada vela, en el menú de niveles: al marcarlos la vela queda fijada (liquidationPins.js),
// con las liquidaciones de esa vela, y no pasa a la orden como lo elegido en el Observador
export const PIN_KINDS = { high: 'Fijar liq. del máximo', low: 'Fijar liq. del mínimo' };
// La franja de una vela fijada: esa sí se puede incluir en el análisis de un trade
export const PINNED_KIND = 'Liq. de vela fijada';

/** 'high' o 'low' si es el máximo o el mínimo de una vela que se puede fijar, o una vela fijada; si no, null */
export function pinEdge(item) {
  if (item?.edge === 'high' || item?.edge === 'low') return item.edge;
  if (item?.source !== 'Liquidaciones') return null;
  if (item.kind === PIN_KINDS.high) return 'high';
  if (item.kind === PIN_KINDS.low) return 'low';
  return null;
}

/**
 * Liquidaciones de una vela fijada, en la mitad de la vela del lado elegido: el máximo junta su mitad de arriba
 * y el mínimo su mitad de abajo. Cuentan las celdas que se cruzan con la vela en el tiempo y caen en esos precios.
 * Una celda más larga que la vela (un día de MarginPad, un intervalo de Coinalyze) entra completa: spanMs lo dice.
 * pin: { time, high, low, edge }. pad agranda un poco el borde exterior, por redondeo de precios.
 */
export function pinSummary(cells, pin, frameMs, pad = 0) {
  const start = pin.time;
  const end = pin.time + frameMs;
  const middle = (pin.high + pin.low) / 2;
  const [low, high] = pin.edge === 'high' ? [middle, pin.high + pad] : [pin.low - pad, middle];
  let long = 0;
  let short = 0;
  let spanMs = 0;
  let count = 0;
  for (const cell of cells) {
    if (cell.start >= end || Math.max(cell.end, cell.start + 1) <= start) continue; // No se cruza con la vela
    const price = (cell.low + cell.high) / 2;
    if (price < low || price > high) continue;
    long += cell.long;
    short += cell.short;
    count += 1;
    spanMs = Math.max(spanMs, cell.end - cell.start);
  }
  return { long, short, total: long + short, count, spanMs, side: long >= short ? 'long' : 'short' };
}

/** Monto corto: 950, 12.3K, 4.5M, 1.2B */
export function money(usd) {
  const value = Math.abs(usd);
  if (value >= 1e9) return `${(usd / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(usd / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(usd / 1e3).toFixed(value >= 1e4 ? 0 : 1)}K`;
  return `${Math.round(usd)}`;
}
