// Setups de Orderflows Unlocked como recetas de Elementos OF. Las evalúa backend/of_setups.py.
//
// Notación corta de la biblioteca, leída de las láminas (orden y ventana de cada setup):
//   "A+B"     las casillas en la misma vela
//   "A+B@3"   en una ventana de 3 velas; la vela que dispara aporta un voto
//   "A>B@2"   secuencia: A en una vela anterior y B en la que dispara, dentro de 2 velas
//   "SW|BR"   una casilla que acepta cualquiera de esos códigos
//   " m"      exige momentum (EMA 14 con pendiente); " s" exige swing de 5 velas

import { OF_ELEMENTS } from './ofElements.js';

const SWEEP = 'SW|BR'; // Market Sweep: el leído del footprint o el barrido real del flujo

// [número, título, notación, g = giro | c = continuación, elementos que no existen en la app]
const LIBRARY = [
  [1, 'Delta Breakout + Extreme Delta', 'DB+XD@2', 'c'],
  [2, 'Acumulación/Distribución + Stacked', 'AD>ST@2', 'g'],
  [3, 'Market Sweep + Resting Liquidity', `RL>${SWEEP}@3`, 'g'],
  [4, 'POC Slingshot + Exhaustion', 'SL+EX@2', 'g'],
  [5, 'Volume Decline + Momentum + Exhaustion', 'VD+EX@2 m', 'c'],
  [6, 'Open POC + Zero Print', 'OP+ZP@3', 'c'],
  [7, 'Open POC + Thin Prints + Exhaustion', 'OP+TP+EX@3', 'g'],
  [8, 'Volume Imbalance + Delta Tail', 'VI+DT@3', 'g'],
  [9, 'Aligned POC + Volume Imbalance', 'AP>VI@3', 'c'],
  [10, 'Orderflows Gaps + Resting Liquidity', 'RL>OG@3', 'c'],
  [11, 'Swing + Extreme Delta/Volume', 'DV s', 'g'],
  [12, 'Market Sweep + Exhaustion', `${SWEEP}>EX@2`, 'g'],
  [13, 'Acumulación/Distribución + Delta Breakout', 'AD>DB@3', 'c'],
  [14, 'Momentum + Stacked', 'ST m', 'c'],
  [15, 'Price Action Divergence + Market Weakness', 'PD', 'g', ['Market Weakness']],
  [16, 'Delta Tail + Zero Print', 'DT+ZP', 'c'],
  [17, 'Open POC + Volume Decline', 'OP>VD@3', 'c'],
  [18, 'POC Wave + Delta Breakout', 'PW+DB@2', 'g'],
  [19, 'Retail Suck + Imbalance Reversal', 'RS+IR@2', 'g'],
  [20, 'Volume Imbalance + Market Sweep', `VI+${SWEEP}`, 'c'],
  [21, 'Extreme Delta + Thin Prints', 'XD+TP', 'c'],
  [22, 'Acumulación/Distribución + Resting Liquidity', 'RL+AD@3', 'g'],
  [23, 'Momentum + Exhaustion', 'EX m', 'c'],
  [24, 'POC Slingshot + Volume Imbalance', 'SL+VI', 'c'],
  [25, 'Stacked + Zero Print', 'ST+ZP', 'c'],
  [26, 'Aligned POC + Market Sweep', `AP>${SWEEP}@3`, 'c'],
  [27, 'Imbalance Reload + Resting Liquidity', 'RD+RL@3', 'c'],
  [28, 'Open POC + Vertical Liquidity', 'OP+VL@3', 'c'],
  [29, 'Orderflows Gaps + Exhaustion', 'OG+EX@2', 'c'],
  [30, 'Retail Suck + Delta Breakout', 'RS>DB@3', 'c'],
  [31, 'Delta Divergence + Thin Prints', 'DD+TP s', 'g'],
  [32, 'Momentum + Vertical Liquidity', 'VL m', 'c'],
  [33, 'Acumulación/Distribución + Market Sweep', `AD>${SWEEP}@3`, 'c'],
  [34, 'Delta Breakout + Zero Print', 'DB+ZP', 'c'],
  [35, 'Imbalance Reversal + Resting Liquidity', 'IR+RL@2', 'g'],
  [36, 'Price Action Divergence + Volume Imbalance', 'PD+VI', 'g'],
  [37, 'Open POC + Exhaustion', 'OP+EX', 'g'],
  [38, 'Aligned POC + Retail Suck', 'AP+RS@3', 'g'],
  [39, 'Market Sweep + Thin Prints', `${SWEEP}+TP`, 'c'],
  [40, 'Momentum + Imbalance Reload', 'RD m', 'c'],
  [41, 'POC Slingshot + Delta Tail', 'SL+DT@2', 'g'],
  [42, 'Stacked + Vertical Liquidity', 'ST>VL@2', 'c'],
  [43, 'Orderflows Gaps + Market Weakness', 'OG', 'g', ['Market Weakness']],
  [44, 'Delta Divergence + Exhaustion + Swing', 'DD+EX@2 s', 'g'],
  [45, 'Momentum + Resting Liquidity', 'RL m', 'c'],
  [46, 'POC Wave + Zero Print', 'PW+ZP@3', 'c'],
  [47, 'Extreme Delta + Delta Tail', 'DT>XD@2', 'c'],
  [48, 'Imbalance Reload + Thin Prints', 'RD+TP', 'c'],
  [49, 'Price Action Divergence + Vertical Liquidity', 'PD+VL@3', 'g'],
  [50, 'Open POC + Market Sweep', `OP+${SWEEP}`, 'c'],
  [51, 'Aligned POC + Volume Imbalance', 'AP>VI@3', 'c'],
  [52, 'Delta Breakout + Exhaustion', 'DB+EX@2', 'g'],
  [53, 'Market Weakness + Thin Prints', 'TP', 'g', ['Market Weakness']],
  [54, 'Momentum + Delta Tail', 'DT m', 'c'],
  [55, 'POC Slingshot + Retail Suck', 'SL+RS', 'g'],
  [56, 'Orderflows Gaps + Zero Print', 'OG+ZP@2', 'c'],
  [57, 'Volume Imbalance + Delta Tail', 'VI+DT@2', 'c'],
  [58, 'Imbalance Reversal + Market Sweep', `IR>${SWEEP}@3`, 'g'],
  [59, 'VA abandonada + Exhaustion', 'EX>VA@3', 'g'],
  [60, 'POC Wave + Vertical Liquidity', 'VL>PW@3', 'c'],
  [61, 'Extreme Delta + Resting Liquidity', 'XD+RL@2', 'c'],
  [62, 'Momentum + Volume Decline', 'VD m', 'c'],
  [63, 'Open POC + Zero Print', 'OP+ZP@3', 'c'],
  [64, 'Acumulación/Distribución + Thin Prints', 'AD+TP@3', 'g'],
  [65, 'Market Sweep + Vertical Liquidity', `${SWEEP}+VL`, 'c'],
  [66, 'POC Slingshot + Volume Imbalance', 'SL+VI', 'g'],
  [67, 'Stacked + Delta Tail', 'ST+DT', 'c'],
  [68, 'Orderflows Gaps + Volume Decline', 'VD>OG@3', 'c'],
  [69, 'Delta Breakout + Resting Liquidity', 'RL>DB@3', 'c'],
  [70, 'Market Weakness + Volume Imbalance', 'VI', 'g', ['Market Weakness']],
  [71, 'Momentum + Zero Print', 'ZP m', 'c'],
  [72, 'POC Wave + Exhaustion', 'PW+EX@3', 'g'],
  [73, 'Aligned POC + Delta Tail', 'AP+DT@2', 'g'],
  [74, 'Imbalance Reversal + Thin Prints', 'IR+TP@2', 'g'],
  [75, 'VA abandonada + Vertical Liquidity', 'VA+VL@2', 'c'],
  [76, 'Delta Divergence + Market Sweep', `DD>${SWEEP}@2 s`, 'g'],
  [77, 'Acumulación/Distribución + Exhaustion', 'EX>AD@3', 'g'],
  [78, 'Stacked + Volume Decline', 'VD>ST@3', 'g'],
  [79, 'Delta Breakout + Thin Prints', 'DB+TP', 'c'],
  [80, 'Momentum + Market Sweep', `${SWEEP} m`, 'c'],
  [81, 'Orderflows Gaps + Vertical Liquidity', 'OG+VL', 'c'],
  [82, 'Volume Imbalance + Exhaustion', 'VI+EX', 'g'],
  [83, 'Imbalance Reversal + Zero Print', 'IR+ZP@2', 'g'],
  [84, 'Open POC + Delta Tail', 'OP+DT', 'c'],
  [85, 'Aligned POC + Thin Prints', 'AP>TP@3', 'c'],
  [86, 'Open POC + Sequencing + Thin Prints', 'OP+SQ+TP', 'c'],
  [87, 'Momentum + Stacked + Zero Print', 'ST+ZP m', 'c'],
  [88, 'Momentum + VA abandonada + Volume Imbalance', 'VA+VI@2 m', 'c'],
  [89, 'Stacked + Delta Breakout + Exhaustion', 'ST+DB+EX@3', 'g'],
  [90, 'Small Min/Max + Extreme Delta + Volume Imbalance + Exhaustion', 'SM+XD+VI+EX', 'c'],
  [91, 'Open POC + Stacked + Exhaustion', 'OP+ST+EX@3', 'g']
];

export const SETUP_MODES = [
  ['strict', 'Todas las casillas'],
  ['threshold', 'Al menos N casillas'],
  ['groups', 'Grupos con su mínimo'],
  ['sequence', 'Grupos en orden (preparación y disparo)']
];

/** Receta desde la notación corta: secuencias con ">" (un grupo por paso) o casillas con "+" */
export function parseSpec(spec) {
  const [body, ...flags] = spec.trim().split(/\s+/);
  const [codes, window] = body.split('@');
  const sequence = codes.includes('>');
  const steps = codes.split(sequence ? '>' : '+');
  const slots = steps.flatMap((step, group) => step.split('+').map(slot => ({ codes: slot.split('|'), group: sequence ? group : 0 })));
  return {
    mode: sequence ? 'sequence' : 'strict',
    window: Number(window) || 1,
    slots,
    momentum: flags.includes('m'),
    swing: { on: flags.includes('s'), bars: 5, flex: 0, onSwing: false }
  };
}

/** Los 91 setups como recetas, apagados de fábrica */
export const SETUP_LIBRARY = LIBRARY.map(([num, title, spec, kind, missing = []]) => ({
  id: `S${num}`,
  num,
  name: title,
  spec,
  kind: kind === 'g' ? 'giro' : 'continuación',
  missing,
  builtin: true,
  side: 'both',
  min: 1,
  groupMins: {},
  entry: { on: false, atr: 0.25, bars: 2 },
  ...parseSpec(spec)
}));

/** Notación corta de una receta armada a mano, para mostrarla en la lista */
export function recipeText(recipe) {
  const byGroup = new Map();
  for (const slot of recipe.slots) {
    if (!byGroup.has(slot.group)) byGroup.set(slot.group, []);
    byGroup.get(slot.group).push(slot.codes.join('|'));
  }
  const parts = [...byGroup.values()].map(group => group.join('+'));
  const join = recipe.mode === 'sequence' ? '>' : recipe.mode === 'groups' ? ' · ' : '+';
  let text = parts.join(join);
  if (recipe.mode === 'threshold') text += ` (${recipe.min} de ${recipe.slots.length})`;
  if (recipe.window > 1) text += ` @${recipe.window}`;
  if (recipe.momentum) text += ' m';
  if (recipe.swing?.on) text += ' s';
  if (recipe.entry?.on) text += ' e';
  return text;
}

/** Receta válida: casillas con códigos conocidos, números dentro de rango */
export function cleanRecipe(raw) {
  const slots = (raw.slots || [])
    .map(slot => ({ codes: (slot.codes || []).filter(code => OF_ELEMENTS[code]), group: Math.max(0, Math.min(3, Math.round(Number(slot.group) || 0))) }))
    .filter(slot => slot.codes.length)
    .slice(0, 6);
  if (!slots.length) return null;
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  return {
    ...raw,
    id: String(raw.id || `R${Date.now()}`).slice(0, 60),
    name: String(raw.name || 'Receta propia').slice(0, 80),
    side: ['both', 'long', 'short'].includes(raw.side) ? raw.side : 'both',
    mode: SETUP_MODES.some(([mode]) => mode === raw.mode) ? raw.mode : 'strict',
    slots,
    min: Math.round(clamp(raw.min, 1, slots.length, slots.length)),
    groupMins: raw.groupMins || {},
    window: Math.round(clamp(raw.window, 1, 5, 1)),
    momentum: !!raw.momentum,
    swing: { on: !!raw.swing?.on, bars: Math.round(clamp(raw.swing?.bars, 2, 20, 5)), flex: Math.round(clamp(raw.swing?.flex, 0, 5, 0)), onSwing: !!raw.swing?.onSwing },
    entry: { on: !!raw.entry?.on, atr: clamp(raw.entry?.atr, 0.05, 3, 0.25), bars: Math.round(clamp(raw.entry?.bars, 1, 5, 2)) }
  };
}

const SETUPS_KEY = 'of_setups_';

export function defaultSetupsConfig() {
  return { active: [], custom: [], overrides: {}, showLabels: true };
}

export function loadSetupsConfig(symbol) {
  try {
    return { ...defaultSetupsConfig(), ...(JSON.parse(localStorage.getItem(SETUPS_KEY + symbol)) || {}) };
  } catch {
    return defaultSetupsConfig();
  }
}

export function saveSetupsConfig(symbol, config) {
  try {
    localStorage.setItem(SETUPS_KEY + symbol, JSON.stringify(config));
  } catch {
    // Sin almacenamiento la lista sigue vigente hasta recargar
  }
}

// ==================== PERIODO RESERVADO Y VERSIONES ====================

/** Desde esta fecha (UTC) los datos quedan para la comprobación final: el ajuste no los mira */
export const DEFAULT_RESERVE = '2025-07-01';
const MAX_VERSIONS = 30;

export function reserveDate(config) {
  return /^\d{4}-\d{2}-\d{2}$/.test(config?.reserve || '') ? config.reserve : DEFAULT_RESERVE;
}

export function reserveMs(config) {
  return Date.parse(`${reserveDate(config)}T00:00:00Z`);
}

/** Lo que define una receta, sin lo que solo sirve para mostrarla */
export function recipeCore(recipe) {
  const { name, side, mode, min, groupMins, window, slots, momentum, swing, entry } = recipe;
  return JSON.parse(JSON.stringify({ name, side, mode, min, groupMins, window, slots, momentum, swing, entry }));
}

/** Versiones guardadas de una receta, de la más vieja a la más nueva. v0 es la del libro o la primera */
export function recipeVersions(config, id) {
  return config?.history?.[id] || [];
}

/** Número de la versión vigente: 0 mientras no se edita */
export function recipeVersion(config, id) {
  const list = recipeVersions(config, id);
  return list.length ? list[list.length - 1].v : 0;
}

/** Config con una versión nueva de la receta, con la fecha real en que se guardó. No repite una igual a la vigente */
export function withVersion(config, recipe, note = '') {
  const list = recipeVersions(config, recipe.id);
  const core = recipeCore(recipe);
  const last = list[list.length - 1];
  if (last && JSON.stringify(last.recipe) === JSON.stringify(core)) return config;
  const entry = { v: (last?.v ?? 0) + 1, at: Date.now(), recipe: core, ...(note ? { note } : {}) };
  return { ...config, history: { ...(config.history || {}), [recipe.id]: [...list, entry].slice(-MAX_VERSIONS) } };
}

/** Todas las recetas: la biblioteca, con lo que el usuario cambió en cada una, y las propias */
export function allRecipes(config) {
  const library = SETUP_LIBRARY.map(recipe => cleanRecipe({ ...recipe, ...(config.overrides?.[recipe.id] || {}) }));
  const custom = (config.custom || []).map(cleanRecipe).filter(Boolean);
  return [...library, ...custom];
}

/** Recetas activas, listas para el backend */
export function activeRecipes(config) {
  const active = new Set(config.active || []);
  return allRecipes(config).filter(recipe => active.has(recipe.id));
}

/** Etiqueta corta en el gráfico: el número del setup o las iniciales de una receta propia */
export function recipeLabel(recipe) {
  if (!recipe) return '?';
  if (recipe.num) return `S${recipe.num}`;
  return recipe.name.split(/\s+/).map(word => word[0]).join('').slice(0, 4).toUpperCase() || 'R';
}
