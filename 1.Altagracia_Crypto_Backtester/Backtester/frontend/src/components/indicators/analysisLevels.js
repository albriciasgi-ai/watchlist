// Niveles y marcas que quien opera elige en el gráfico para tomarlos en cuenta en el análisis.
// Un nivel guarda el precio que tenía al elegirlo y el papel que cumple: soporte, resistencia,
// entrada u objetivo. Una marca de un indicador, como un rombo, guarda la vela donde estaba.
// Los dos pueden llevar una nota. Los marcos de un símbolo comparten la misma lista.
// Lo elegido vale para un solo trade: al crear la orden pasa a ella y la lista queda vacía para el siguiente.

import { countBefore } from '../backtesting/replayClock.js';
import { alignY, crispWidth } from '../chartPixels.js';

import { priceText } from '../backtesting/blindClock.js';
// v2: una lista por trade. La de antes juntaba lo elegido para todos los trades y no se carga
const STORAGE_KEY = 'analysis_levels_v2_';
const CLICK_TOLERANCE_PX = 6;
const LEVEL_COLOR = '#7C3AED';
const EDGE_MARK_PX = 12; // Lo elegido sin su vela a la vista se marca a esta distancia del borde

export const ROLES = [
  { value: 'support', label: 'Soporte' },
  { value: 'resistance', label: 'Resistencia' },
  { value: 'entry', label: 'Entrada' },
  { value: 'target', label: 'Objetivo' }
];
const ROLE_LABELS = Object.fromEntries(ROLES.map(({ value, label }) => [value, label]));
export const MARK_ONLY = ''; // Una marca sin papel de nivel

/** Nombre del papel. Un nivel elegido antes de existir los papeles queda como "Nivel" */
export function roleLabel(role) {
  if (role === MARK_ONLY) return 'Solo marca';
  return ROLE_LABELS[role] ?? 'Nivel';
}

/** Papel inicial: una marca no es nivel hasta que se le da uno; un nivel se lee por su lado del precio */
export function defaultRole(level, price) {
  if (level.mark) return MARK_ONLY;
  if (!Number.isFinite(price)) return null;
  return level.price >= price ? 'resistance' : 'support';
}

/** Es un precio de referencia: lo que no es solo una marca */
export const isPriceLevel = (item) => item.role !== MARK_ONLY && Number.isFinite(item.price);

const stores = new Map();

function store(symbol) {
  if (!stores.has(symbol)) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEY + symbol)) || [];
    } catch {
      // Sin almacenamiento la lista vive hasta recargar
    }
    stores.set(symbol, { items, listeners: new Set() });
  }
  return stores.get(symbol);
}

// Lo elegido en otra pestaña (el segundo gráfico) llega aquí: localStorage avisa a las demás pestañas
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (!event.key?.startsWith(STORAGE_KEY)) return;
    const current = stores.get(event.key.slice(STORAGE_KEY.length));
    if (!current) return;
    try {
      current.items = JSON.parse(event.newValue) || [];
    } catch {
      current.items = [];
    }
    current.listeners.forEach(listener => listener());
  });
}

function changed(symbol) {
  const current = store(symbol);
  try {
    localStorage.setItem(STORAGE_KEY + symbol, JSON.stringify(current.items));
  } catch {
    // Sin almacenamiento la lista vive hasta recargar
  }
  current.listeners.forEach(listener => listener());
}

/** Niveles ya elegidos en esa hora simulada: al retroceder no aparecen los elegidos después */
export const knownLevels = (symbol, time) => store(symbol).items.filter(level => level.selectedAt <= time);

export const isChosen = (symbol, id) => store(symbol).items.some(level => level.id === id);

/** El elegido con ese id, si ya estaba elegido en esa hora simulada: al retroceder no aparece lo elegido después */
export const chosenLevel = (symbol, id, time = Infinity) =>
  store(symbol).items.find(level => level.id === id && level.selectedAt <= time) || null;

// Lo que se guarda de cada nivel: su lugar en pantalla cambia con cada dibujo y no se guarda
const KEPT = ['time', 'low', 'high', 'mark'];

export function toggleLevel(symbol, level, time, timeframe, price = null) {
  const current = store(symbol);
  if (chosenLevel(symbol, level.id, time)) {
    current.items = current.items.filter(item => item.id !== level.id);
  } else {
    // Uno elegido después de esta hora todavía no cuenta: elegirlo ahora lo reemplaza, sin su papel ni su nota
    const { id, source, kind } = level;
    const kept = Object.fromEntries(KEPT.filter(key => level[key] !== undefined).map(key => [key, level[key]]));
    const item = { id, source, kind, price: level.price, ...kept, role: defaultRole(level, price), note: '', selectedAt: time, timeframe };
    current.items = [...current.items.filter(other => other.id !== id), item];
  }
  changed(symbol);
}

/** Cambia el papel o la nota de un elegido */
export function updateLevel(symbol, id, changes) {
  const current = store(symbol);
  const allowed = {};
  if ('role' in changes && (changes.role === MARK_ONLY || changes.role in ROLE_LABELS)) allowed.role = changes.role;
  if (typeof changes.note === 'string') allowed.note = changes.note;
  if (!Object.keys(allowed).length) return;
  current.items = current.items.map(item => (item.id === id ? { ...item, ...allowed } : item));
  changed(symbol);
}

export function removeLevel(symbol, id) {
  const current = store(symbol);
  current.items = current.items.filter(item => item.id !== id);
  changed(symbol);
}

/** Quita lo que se ve en esa hora simulada: lo elegido después sigue guardado */
export function clearLevels(symbol, time = Infinity) {
  const current = store(symbol);
  current.items = current.items.filter(item => item.selectedAt > time);
  changed(symbol);
}

/**
 * Lo elegido hasta esa hora pasa a la orden que se crea y sale de la lista: el trade siguiente empieza sin
 * nada elegido. Lo elegido después de esa hora, que solo existe tras retroceder el reloj, sigue guardado
 */
export function takeLevels(symbol, time) {
  const taken = knownLevels(symbol, time);
  if (taken.length > 0) clearLevels(symbol, time);
  return taken;
}

export function subscribeLevels(symbol, listener) {
  const { listeners } = store(symbol);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const levelId = (source, kind, price) => `${source}|${kind}|${price.toFixed(2)}`;

/**
 * Identificador de algo que está en una vela: el mismo precio en otra vela es otra cosa.
 * La vela de la misma hora en otro marco también es otra: el rombo de 1h no es el de 15m.
 */
export const candleItemId = (source, kind, time, price = null, interval = null) =>
  `${source}|${kind}|${time}${Number.isFinite(price) ? `|${price.toFixed(2)}` : ''}${interval ? `|${interval}` : ''}`;

/** POC, VAH y VAL de un perfil, como niveles que se pueden elegir */
export function profileLevels(profile, source, range = {}) {
  if (!profile?.poc || !profile.valueArea) return [];
  return [['POC', profile.poc.price], ['VAH', profile.valueArea.vahPrice], ['VAL', profile.valueArea.valPrice]]
    .map(([kind, price]) => ({ id: levelId(source, kind, price), source, kind, price, ...range }));
}

export function priceLevels(levels, source, kind) {
  return (levels || []).map(({ price }) => ({ id: levelId(source, kind, price), source, kind, price }));
}

/**
 * Centro de la vela del marco que contiene esa hora: una marca de un marco menor queda en su vela y no en la
 * siguiente. Antes de la primera vela visible queda a la izquierda del área y después de la última, a la derecha.
 * null si la hora cae en un hueco de los datos o el marco no se conoce
 */
export function candleCenterX(candles, frameMs, left, barWidth, time) {
  if (!candles?.length || !(frameMs > 0) || !Number.isFinite(time)) return null;
  const index = countBefore(candles, time + 1) - 1;
  if (index < 0) return left - barWidth / 2;
  if (time < candles[index].timestamp + frameMs) return left + (index + 0.5) * barWidth;
  return index === candles.length - 1 ? left + (candles.length + 0.5) * barWidth : null;
}

/**
 * Lugar en pantalla de cada nivel. Un nivel con horas solo se alcanza dentro de ellas.
 * Lo que un indicador ya ubicó al dibujarse (una marca o una celda) queda como viene.
 */
export function levelTargets(levels, { priceToY, timeToX, candleX, left, right, top, bottom }) {
  return levels.flatMap(level => {
    if (level.x !== undefined || level.left !== undefined) return [level];
    const y = priceToY(level.price);
    if (y < top || y > bottom) return [];
    const start = level.start ?? level.time; // Uno que nace en una vela empieza en ella
    const at = level.start === undefined ? candleX ?? timeToX : timeToX;
    const from = start === undefined ? left : at(start) ?? left;
    const to = level.end === undefined ? right : timeToX(level.end) ?? right;
    return [{ ...level, y, left: Math.max(left, from), right: Math.min(right, to) }];
  });
}

// Distancia del puntero a lo que se puede elegir, o null si no lo alcanza
function reach(target, x, y, tolerance) {
  if (target.x !== undefined) {
    const distance = Math.hypot(target.x - x, target.y - y);
    return distance <= (target.r ?? tolerance) ? distance : null;
  }
  if (x < target.left || x > target.right) return null;
  if (target.top !== undefined) {
    if (y < target.top - tolerance / 2 || y > target.bottom + tolerance / 2) return null;
    return Math.abs((target.top + target.bottom) / 2 - y) / 4;
  }
  const distance = Math.abs(target.y - y);
  return distance <= tolerance ? distance : null;
}

/** Lo que un indicador ubicó y queda dentro del área de precio: lo cortado por el borde no se ve ni responde */
export function withinArea(target, { left, right, top, bottom }) {
  if (target.x !== undefined) return target.x >= left && target.x <= right && target.y >= top && target.y <= bottom;
  if (target.left === undefined) return true;
  const ahead = target.left <= right && target.right >= left;
  if (target.top !== undefined) return ahead && target.top <= bottom && target.bottom >= top;
  return ahead && target.y >= top && target.y <= bottom;
}

/** Niveles y marcas bajo el puntero, del más cercano al más lejano */
export function levelsNear(targets, x, y, tolerance = CLICK_TOLERANCE_PX) {
  return targets
    .map(target => ({ target, distance: reach(target, x, y, tolerance) }))
    .filter(({ distance }) => distance !== null)
    .sort((a, b) => a.distance - b.distance)
    .map(({ target }) => target);
}

const levelPrice = (price) => (Number.isFinite(price) ? priceText(price, 1) : '');

/** Línea y etiqueta de cada nivel elegido. Uno que nace en una vela empieza en ella */
export function drawChosenLevels(ctx, levels, { priceToY, timeToX, candleX, left, right, top, bottom }) {
  const at = candleX ?? timeToX;
  ctx.save();
  ctx.font = '10px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  ctx.lineWidth = crispWidth(1);
  for (const level of levels) {
    if (!isPriceLevel(level)) continue;
    const y = priceToY(level.price);
    if (y < top || y > bottom) continue;

    const from = level.time === undefined ? left : Math.max(left, at?.(level.time) ?? left);
    ctx.strokeStyle = LEVEL_COLOR;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(from, alignY(y));
    ctx.lineTo(right, alignY(y));
    ctx.stroke();
    ctx.setLineDash([]);

    const role = level.role === null || level.role === undefined ? '' : `${roleLabel(level.role)} · `;
    const label = `${role}${level.kind} ${levelPrice(level.price)}`;
    const width = ctx.measureText(label).width + 8;
    ctx.fillStyle = LEVEL_COLOR;
    ctx.fillRect(right - width, y - 7, width, 14);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, right - 4, y);
  }
  ctx.restore();
}

/**
 * Dónde está hoy en pantalla cada elegido: en su marca si el indicador la dibujó, o en su vela y precio.
 * Con edges, para la imagen de una orden, lo que nace antes o después de la vista queda en el borde de
 * ese lado y a su precio: un nivel se ve desde ahí, como su línea, y el número de una marca dice que está más allá
 */
export function itemPositions(items, targets, { priceToY, timeToX, candleX, left, right, top, bottom }, { edges = false } = {}) {
  const at = candleX ?? timeToX; // En la vela que contiene su hora, aunque se haya elegido en otro marco
  const drawn = new Map(targets.map(target => [target.id, target]));
  return items.flatMap(item => {
    const target = drawn.get(item.id);
    let x;
    let y;
    if (target?.x !== undefined) {
      ({ x, y } = target);
    } else if (target?.top !== undefined && !target.panel) { // Una vela elegida en un panel lleva su aro en el precio
      x = (target.left + target.right) / 2;
      y = (target.top + target.bottom) / 2;
    } else if (item.time !== undefined && Number.isFinite(item.price)) {
      x = at(item.time);
      y = priceToY(item.price);
      if (edges) {
        // Sin lugar para su hora, la línea de un nivel también empieza en el borde izquierdo
        if (x === null || x === undefined || x < left) x = left + EDGE_MARK_PX;
        else if (x > right) x = right - EDGE_MARK_PX;
      }
    } else if (Number.isFinite(item.price)) {
      x = right - EDGE_MARK_PX;
      y = priceToY(item.price);
    }
    if (x === null || x === undefined || x < left || x > right || y < top || y > bottom) return [];
    return [{ item, x, y }];
  });
}

/** Aro sobre cada marca elegida, para saber cuáles están en el análisis */
export function drawChosenMarks(ctx, positions) {
  ctx.save();
  ctx.strokeStyle = LEVEL_COLOR;
  ctx.lineWidth = 2;
  for (const { item, x, y } of positions) {
    if (!item.mark) continue;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Rango de precio que también contiene el precio de cada elegido: la imagen de una orden muestra todos sus
 * niveles. room es el aire más allá del nivel que agranda el rango, como parte del rango nuevo
 */
export function priceRangeWith(items, low, high, room = 0) {
  let from = low;
  let to = high;
  for (const { price } of items) {
    if (!Number.isFinite(price)) continue;
    from = Math.min(from, price);
    to = Math.max(to, price);
  }
  const extra = (to - from) * room;
  return { low: from < low ? from - extra : low, high: to > high ? to + extra : high };
}

/**
 * Horas que la imagen de una orden debe alcanzar. first: la marca más vieja, que solo se ve en su vela.
 * last: lo más nuevo, marca o inicio de un nivel. Un nivel que nace antes no aleja la imagen: su línea
 * se ve desde el borde izquierdo. null si no hay nada que alcanzar de ese lado
 */
export function framedTimes(items) {
  const marks = items.filter(item => item.mark && Number.isFinite(item.time)).map(item => item.time);
  const starts = items.filter(item => Number.isFinite(item.time)).map(item => item.time);
  return {
    first: marks.length ? Math.min(...marks) : null,
    last: starts.length ? Math.max(...starts) : null
  };
}

/** Marcas para una imagen: posición de cada elegido como fracción del ancho y del alto */
export function imageMarkers(positions, width, height) {
  if (!(width > 0) || !(height > 0)) return [];
  return positions.map(({ item, x, y }) => ({ id: item.id, x: +(x / width).toFixed(4), y: +(y / height).toFixed(4) }));
}
