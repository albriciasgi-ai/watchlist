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
export const MARK_ONLY = ''; // Una marca sin papel de nivel
// Un nivel que se guarda como dato, sin papel en el trade: el VWAP o un POC que se miró sin usarlo de soporte,
// resistencia, entrada ni objetivo (12/11/2026). Sigue siendo un precio de referencia para el análisis
export const DATA_ONLY = 'data';
const ROLE_LABELS = { ...Object.fromEntries(ROLES.map(({ value, label }) => [value, label])), [DATA_ONLY]: 'Solo dato' };

/** Nombre del papel. Un nivel elegido antes de existir los papeles queda como "Nivel" */
export function roleLabel(role) {
  if (role === MARK_ONLY) return 'Solo marca';
  return ROLE_LABELS[role] ?? 'Nivel';
}

/** Papeles que se pueden elegir: un nivel puede quedar como solo dato; una marca, como solo marca */
export const roleOptions = (item) => [
  item?.mark ? { value: MARK_ONLY, label: 'Solo marca' } : { value: DATA_ONLY, label: 'Solo dato' },
  ...ROLES
];

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

/**
 * Saca de la lista solo esos elegidos (por id): lo que se eligió después, mientras la orden se enviaba, sigue.
 * La suite lo usa cuando la orden ya quedó en Bybit (12/11/2026): antes la lista se vaciaba al enviar, y si el
 * bot rechazaba la orden, la orden corregida salía sin nada elegido
 */
export function dropLevels(symbol, items) {
  const ids = new Set((items || []).map(item => item.id));
  const current = store(symbol);
  const kept = current.items.filter(item => !ids.has(item.id));
  if (kept.length === current.items.length) return;
  current.items = kept;
  changed(symbol);
}

/**
 * Lo elegido para una orden que se canceló sin llenarse vuelve a la lista, con su papel y su nota: la orden que la
 * reemplace lo lleva. Lo que ya está en la lista no se repite
 */
export function restoreLevels(symbol, items) {
  const current = store(symbol);
  const present = new Set(current.items.map(item => item.id));
  const back = (items || [])
    .filter(item => item && item.id && !present.has(item.id))
    // Una marca guardada sin papel es "solo marca": no se dibuja como nivel
    .map(item => (item.mark && (item.role === undefined || item.role === null) ? { ...item, role: MARK_ONLY } : item));
  if (!back.length) return 0;
  current.items = [...current.items, ...back];
  changed(symbol);
  return back.length;
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

// Con números (la suite en vivo, 12/11/2026): cada elegido lleva un círculo pequeño con su número en lugar de
// la etiqueta, que tapaba las velas. La etiqueta sale al pasar el mouse sobre el número y en la lista del panel
const BADGE_R = 7;
const BADGE_ALPHA = 0.6; // La línea de un nivel con número es más tenue
const BADGE_CLEAR_RIGHT_PX = 48; // El número no tapa las velas más recientes: un nivel nacido ahí lo lleva un poco antes

/** Número de cada elegido: su lugar en la lista. Es el mismo en el gráfico, el panel, la orden y sus imágenes */
export const chosenNumbers = (items) => new Map(items.map((item, i) => [item.id, i + 1]));

/** Lo que dice la etiqueta de un elegido: papel, nombre y precio */
export function chosenLabel(item) {
  const role = item.role === null || item.role === undefined ? '' : `${roleLabel(item.role)} · `;
  const price = item.mark ? '' : ` ${levelPrice(item.price)}`;
  return `${role}${item.kind}${price}`;
}

function drawBadge(ctx, x, y, n) {
  ctx.beginPath();
  ctx.arc(x, y, BADGE_R, 0, Math.PI * 2);
  ctx.fillStyle = LEVEL_COLOR;
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${n > 9 ? 8 : 9}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 0.5);
}

/**
 * Línea y etiqueta de cada nivel elegido. Uno que nace en una vela empieza en ella.
 * Con numbers (id -> número) cada nivel lleva su número donde nace la línea, o en el borde izquierdo si nace
 * antes de la vista, en vez de la etiqueta. Devuelve dónde quedó cada número, para mostrar su etiqueta
 */
export function drawChosenLevels(ctx, levels, { priceToY, timeToX, candleX, left, right, top, bottom }, { numbers = null } = {}) {
  const at = candleX ?? timeToX;
  const badges = [];
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
    const n = numbers?.get(level.id);
    // El número va donde nace la línea, sin tapar las velas más recientes; la línea llega hasta él
    const badgeX = n ? Math.max(left + BADGE_R + 2, Math.min(right - BADGE_CLEAR_RIGHT_PX, from + BADGE_R + 3)) : null;
    ctx.strokeStyle = LEVEL_COLOR;
    ctx.setLineDash([2, 3]);
    if (numbers) ctx.globalAlpha = BADGE_ALPHA;
    ctx.beginPath();
    ctx.moveTo(badgeX === null ? from : Math.min(from, badgeX), alignY(y));
    ctx.lineTo(right, alignY(y));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    if (numbers) {
      if (!n) continue;
      drawBadge(ctx, badgeX, y, n);
      badges.push({ x: badgeX, y, r: BADGE_R + 2, n, item: level });
      continue;
    }

    const label = chosenLabel(level);
    const width = ctx.measureText(label).width + 8;
    ctx.fillStyle = LEVEL_COLOR;
    ctx.fillRect(right - width, y - 7, width, 14);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, right - 4, y);
  }
  ctx.restore();
  return badges;
}

/**
 * Etiqueta del número bajo el puntero: número, papel, nombre y precio, y debajo la fuente y la nota.
 * Va a la derecha del número, o a la izquierda si no cabe, dentro del área de precio
 */
export function drawChosenTooltip(ctx, badges, mouseX, mouseY, { left, right, top, bottom }) {
  if (!badges?.length || !Number.isFinite(mouseX) || !Number.isFinite(mouseY)) return null;
  let hit = null;
  let best = Infinity;
  for (const badge of badges) {
    const d = Math.hypot(badge.x - mouseX, badge.y - mouseY);
    if (d <= badge.r && d < best) {
      hit = badge;
      best = d;
    }
  }
  if (!hit) return null;

  const lines = [`${hit.n} · ${chosenLabel(hit.item)}`];
  const detail = [hit.item.source, hit.item.note].filter(Boolean).join(' — ');
  if (detail) lines.push(detail.length > 90 ? `${detail.slice(0, 87)}…` : detail);
  ctx.save();
  ctx.font = '10px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 10;
  const height = lines.length * 13 + 4;
  let x = hit.x + hit.r + 3;
  if (x + width > right) x = Math.max(left, hit.x - hit.r - 3 - width);
  const y = Math.max(top, Math.min(bottom - height, hit.y - height / 2));
  ctx.fillStyle = LEVEL_COLOR;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#FFFFFF';
  lines.forEach((line, i) => ctx.fillText(line, x + 5, y + 8.5 + i * 13));
  ctx.restore();
  return hit;
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

/**
 * Aro sobre cada marca elegida, para saber cuáles están en el análisis. Con numbers, el número de la marca va
 * arriba a la derecha del aro. Devuelve dónde quedó cada número
 */
export function drawChosenMarks(ctx, positions, { numbers = null } = {}) {
  const badges = [];
  ctx.save();
  ctx.strokeStyle = LEVEL_COLOR;
  ctx.lineWidth = 2;
  for (const { item, x, y } of positions) {
    if (!item.mark) continue;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
    const n = numbers?.get(item.id);
    if (n) {
      drawBadge(ctx, x + 9, y - 9, n);
      badges.push({ x: x + 9, y: y - 9, r: BADGE_R + 2, n, item });
    }
  }
  ctx.restore();
  return badges;
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
