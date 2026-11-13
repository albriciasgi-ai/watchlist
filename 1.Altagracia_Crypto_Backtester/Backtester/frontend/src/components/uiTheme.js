// Estilo visual de App 1.
//
// Cuatro estilos con el mismo dibujo: una sola letra (Segoe UI de 12 px), color solo en los datos, precios y
// horas redondos en los ejes, leyenda con la vela bajo la cruz, último precio en el eje y footprint graduado
// por volumen. Cambian sus colores:
//   "nitido" (el que abre por defecto): colores fijos, nunca cambian.
//   "oscuro" (fondo, lienzo y barras oscuros), "personalizado" (parte de Nítido) y "muhammad" (paleta del arte
//   islámico: azulejos de Iznik, Isfahán y la Alhambra, manuscritos iluminados): el usuario cambia sus colores en
//   el modal "Estilo y colores" y cada uno guarda lo suyo.
// "clasico": el aspecto anterior, sin ningún cambio.
//
// Se guarda en localStorage: "ui_theme" (el estilo) y los colores cambiados de cada estilo, solo lo distinto a su
// paleta: "ui_theme_colors" (Personalizado), "ui_theme_colors_oscuro" y "ui_theme_colors_muhammad".
// Un indicador nuevo pregunta isNewTheme() al dibujar y toma sus colores de THEME.

const STYLE_KEY = 'ui_theme';
const DEFAULT_STYLE = 'nitido';
const listeners = new Set();

/** Colores de Nítido. Personalizado parte de ellos */
export const DEFAULT_COLORS = {
  up: '#089981',
  down: '#F23645',
  fpBuy: '#089981',
  fpSell: '#F23645',
  fpPoc: '#2962FF',
  fpProfile: '#C5CEE6',
  vpValueArea: '#C9A05C',
  vpOutside: '#8091C4',
  vpPoc: '#5A6170',
  vpCluster: '#6B4FBB',
  chartBg: '#FFFFFF',
  grid: '#E4E7EC',
  crosshair: '#8A919C',
  tagBg: '#3D434C',
  surface: '#FFFFFF',
  accent: '#2962FF',
  text: '#1F2328',
  textMuted: '#5F6670',
  oiUp: '#2962FF',
  oiDown: '#F57C00',
  divergence: '#F59E0B'
};

/** Oscuro: fondo y barras como los gráficos oscuros de siempre. Texto 12:1 y datos 4.5:1 o más sobre el fondo */
export const DARK_COLORS = {
  up: '#089981',
  down: '#F23645',
  fpBuy: '#089981',
  fpSell: '#F23645',
  fpPoc: '#5B8CFF',
  fpProfile: '#4A5573',
  vpValueArea: '#C9A05C',
  vpOutside: '#8091C4',
  vpPoc: '#9AA3B5',
  vpCluster: '#9B7FE8',
  chartBg: '#131722',
  grid: '#242936',
  crosshair: '#758696',
  tagBg: '#3F4659',
  surface: '#1E222D',
  accent: '#5B8CFF',
  text: '#D1D4DC',
  textMuted: '#8B93A5',
  oiUp: '#5B8CFF',
  oiDown: '#FF9800',
  divergence: '#F5B70B'
};

/**
 * Muhammad: paleta del arte islámico sobre papel marfil de manuscrito, con el dibujo de Nítido.
 * Turquesa de cobre y rojo bol de Iznik en las velas, cobalto de Iznik, oro de iluminación (shamsa iraní), azul y
 * verde nazaríes medidos en la Alhambra, morado de manganeso, minio, negro de tinta y verde esmeralda de acento.
 * Texto 16:1 y datos 3.3:1 o más sobre el fondo. Fuentes en Backtester/CLAUDE.md, "Paleta Muhammad".
 */
export const MUHAMMAD_COLORS = {
  up: '#0E8794',
  down: '#B8352B',
  fpBuy: '#0E8794',
  fpSell: '#B8352B',
  fpPoc: '#1251CE',
  fpProfile: '#B6CFE7',
  vpValueArea: '#C4A23B',
  vpOutside: '#859EB4',
  vpPoc: '#475D53',
  vpCluster: '#6F4A7E',
  chartBg: '#FBF9F4',
  grid: '#E6E1D6',
  crosshair: '#8A847A',
  tagBg: '#2C2925',
  surface: '#FBF9F4',
  accent: '#1D6B4C',
  text: '#1F1C18',
  textMuted: '#5E574E',
  oiUp: '#1251CE',
  oiDown: '#B85A1C',
  divergence: '#A6850C'
};

/** Paleta de partida de cada estilo. Nítido no cambia; los demás suman lo que el usuario cambió */
const PALETTES = { nitido: DEFAULT_COLORS, oscuro: DARK_COLORS, personalizado: DEFAULT_COLORS, muhammad: MUHAMMAD_COLORS };
/** Estilos que el usuario puede cambiar y dónde guarda cada uno sus colores. Personalizado conserva la clave de siempre */
const EDITABLE_KEYS = { oscuro: 'ui_theme_colors_oscuro', personalizado: 'ui_theme_colors', muhammad: 'ui_theme_colors_muhammad' };

/** Estilos del modal, en su orden */
export const STYLES = [
  { id: 'nitido', name: 'Nítido', text: 'Una sola letra, color solo en los datos, ejes con números redondos y footprint graduado por volumen. Sus colores no cambian.' },
  { id: 'oscuro', name: 'Oscuro', text: 'El mismo dibujo con fondo, lienzo y barras oscuros. Sus colores se cambian abajo.' },
  { id: 'personalizado', name: 'Personalizado', text: 'Parte de Nítido y guarda los colores que cambies abajo. Nítido queda como está.' },
  { id: 'muhammad', name: 'Muhammad', text: 'El dibujo de Nítido con colores del arte islámico. Sus colores se cambian abajo.' },
  { id: 'clasico', name: 'Clásico', text: 'El aspecto anterior de App 1, sin ningún cambio.' }
];
const STYLE_IDS = new Set(STYLES.map(style => style.id));

/** Cómo se agrupan en el modal */
export const COLOR_GROUPS = [
  { title: 'Velas y volumen', fields: [['up', 'Sube'], ['down', 'Baja']] },
  { title: 'Footprint', fields: [['fpBuy', 'Compra'], ['fpSell', 'Venta'], ['fpPoc', 'POC'], ['fpProfile', 'Perfil de la vela']] },
  { title: 'Perfil de volumen', fields: [['vpValueArea', 'Área de valor'], ['vpOutside', 'Fuera del área'], ['vpPoc', 'Línea del POC'], ['vpCluster', 'Clusters']] },
  { title: 'Gráfico', fields: [['chartBg', 'Fondo'], ['grid', 'Rejilla'], ['crosshair', 'Cruz'], ['tagBg', 'Etiquetas de la cruz']] },
  { title: 'Interfaz', fields: [['surface', 'Barras'], ['accent', 'Acento'], ['text', 'Texto'], ['textMuted', 'Texto secundario']] },
  { title: 'Paneles', fields: [['oiUp', 'Interés abierto sube'], ['oiDown', 'Interés abierto baja'], ['divergence', 'Divergencia']] }
];

// ==================== COLOR ====================

const HEX_RE = /^#[0-9a-f]{6}$/i;
const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => `#${rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const rgbText = hex => toRgb(hex).join(', ');
/** Mezcla dos colores: amount 0 = a, 1 = b */
const mix = (a, b, amount) => {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return toHex(ca.map((v, i) => v + (cb[i] - v) * amount));
};
const channel = v => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = hex => {
  const [r, g, b] = toRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Hacia dónde se lleva un texto para leerse sobre ese fondo: negro sobre uno claro, blanco sobre uno oscuro */
const inkFor = background => (contrast('#FFFFFF', background) > contrast('#000000', background) ? '#FFFFFF' : '#000000');
/** El mismo color, oscurecido (o aclarado sobre un fondo oscuro) lo justo para leerse como texto sobre el fondo */
const readable = (hex, background, ratio) => {
  const ink = inkFor(background);
  let color = hex;
  for (let i = 0; i < 20 && contrast(color, background) < ratio; i++) color = mix(color, ink, 0.08);
  return color;
};

// ==================== ESTADO ====================

function readStyle() {
  try {
    const value = window.localStorage?.getItem(STYLE_KEY);
    return STYLE_IDS.has(value) ? value : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

/** Colores cambiados de un estilo, guardados en su clave */
function readColors(key) {
  try {
    const saved = JSON.parse(window.localStorage?.getItem(key) || '{}');
    return Object.fromEntries(Object.entries(saved).filter(([name, value]) => name in DEFAULT_COLORS && HEX_RE.test(value)));
  } catch {
    return {};
  }
}

// Sin navegador (pruebas de Node) se dibuja como siempre
const inBrowser = typeof window !== 'undefined';
let current = inBrowser ? readStyle() : 'clasico';
/** Lo que el usuario cambió en cada estilo editable */
const changes = Object.fromEntries(Object.entries(EDITABLE_KEYS).map(([name, key]) => [name, inBrowser ? readColors(key) : {}]));
let revision = 0;

/** Colores de un estilo: su paleta, más lo que el usuario cambió si es editable. Nítido y el clásico, los de Nítido */
function paletteOf(name) {
  return { ...(PALETTES[name] || DEFAULT_COLORS), ...(changes[name] || {}) };
}

function saveChanges(name) {
  try {
    if (Object.keys(changes[name]).length) window.localStorage?.setItem(EDITABLE_KEYS[name], JSON.stringify(changes[name]));
    else window.localStorage?.removeItem(EDITABLE_KEYS[name]);
  } catch { /* sin almacenamiento */ }
}

/** Colores y medidas del estilo activo. Se lee al dibujar */
export const THEME = {};

function build() {
  const c = paletteOf(current);
  const ink = inkFor(c.chartBg);
  const dark = ink === '#FFFFFF';
  for (const key of Object.keys(THEME)) delete THEME[key];
  Object.assign(THEME, c, {
    font: '"Segoe UI", system-ui, sans-serif',
    fontSize: 12,
    dark, // Fondo oscuro: lo que no sale de la paleta (etiquetas, celdas vacías) se dibuja claro sobre oscuro
    upRgb: rgbText(c.up),
    downRgb: rgbText(c.down),
    upText: readable(c.up, c.chartBg, 4.5),
    downText: readable(c.down, c.chartBg, 4.5),
    fpBuyRgb: rgbText(c.fpBuy),
    fpSellRgb: rgbText(c.fpSell),
    fpImbUpText: readable(mix(c.fpBuy, ink, 0.35), c.chartBg, 7),
    fpImbDownText: readable(mix(c.fpSell, ink, 0.35), c.chartBg, 7),
    fpText: c.text,
    fpTextFaint: mix(c.textMuted, c.chartBg, 0.4),
    fpEmpty: dark ? 'rgba(255, 255, 255, 0.045)' : 'rgba(0, 0, 0, 0.035)',
    labelBg: `rgba(${rgbText(c.chartBg)}, 0.85)`, // Fondo de una etiqueta sobre el gráfico
    fpFrame: mix(c.textMuted, c.chartBg, 0.55),
    vpValueAreaRgb: rgbText(c.vpValueArea),
    vpOutsideRgb: rgbText(c.vpOutside),
    vpClusterRgb: rgbText(c.vpCluster),
    vpVahVal: mix(c.vpPoc, c.chartBg, 0.45),
    textFaint: mix(c.textMuted, c.chartBg, 0.4),
    line: mix(c.text, c.surface, 0.88),
    control: mix(c.text, c.surface, 0.8),
    hover: mix(c.text, c.surface, 0.94),
    accentSoft: mix(c.accent, c.chartBg, 0.9),
    page: c.surface
  });
}

function applyToDocument() {
  if (typeof document === 'undefined' || !document.body) return;
  const body = document.body;
  const on = current !== 'clasico';
  body.classList.toggle('theme-nitido', on);
  body.classList.toggle('theme-dark', on && THEME.dark);
  body.style.colorScheme = on && THEME.dark ? 'dark' : ''; // Barras de desplazamiento y controles del sistema
  const vars = {
    '--t-text': THEME.text, '--t-muted': THEME.textMuted, '--t-faint': THEME.textFaint,
    '--t-line': THEME.line, '--t-control': THEME.control, '--t-hover': THEME.hover,
    '--t-surface': THEME.surface, '--t-page': THEME.page, '--t-chart': THEME.chartBg,
    '--t-accent': THEME.accent, '--t-accent-soft': THEME.accentSoft
  };
  for (const [name, value] of Object.entries(vars)) {
    if (on) body.style.setProperty(name, value); else body.style.removeProperty(name);
  }
}

function changed() {
  build();
  applyToDocument();
  revision++;
  listeners.forEach(fn => fn());
}

export const isNewTheme = () => current !== 'clasico';
export const themeName = () => current;
/** Solo Personalizado deja cambiar sus colores: los demás estilos quedan como son */
export const themeEditable = () => current in EDITABLE_KEYS;
/** Cambia en cada ajuste de estilo o de color: sirve para redibujar */
export const themeRevision = () => revision;
/** Los colores del estilo activo, para el modal */
export const themeColors = () => ({ ...paletteOf(current) });
/** La paleta de partida del estilo activo: a ella vuelve un color cambiado */
export const themeBaseColors = () => ({ ...(PALETTES[current] || DEFAULT_COLORS) });

export function setTheme(name) {
  current = STYLE_IDS.has(name) ? name : DEFAULT_STYLE;
  try { window.localStorage?.setItem(STYLE_KEY, current); } catch { /* sin almacenamiento */ }
  changed();
}

/** Cambia uno o varios colores del estilo activo y los guarda: solo lo distinto a su paleta. Nítido no cambia */
export function setThemeColors(colors) {
  const own = changes[current];
  if (!own) return;
  const base = PALETTES[current];
  for (const [key, value] of Object.entries(colors)) {
    if (!(key in DEFAULT_COLORS) || !HEX_RE.test(value)) continue;
    if (value.toUpperCase() === base[key].toUpperCase()) delete own[key];
    else own[key] = value.toUpperCase();
  }
  saveChanges(current);
  changed();
}

/** El estilo activo vuelve a su paleta */
export function resetThemeColors() {
  if (!changes[current]) return;
  changes[current] = {};
  saveChanges(current);
  changed();
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ==================== AJUSTES PROPIOS DE CADA INDICADOR ====================
//
// El estilo da los colores de todo, pero lo que el usuario elige en el modal de un indicador gana.
// Cada indicador guarda en su configuración la lista customVisual con lo que el usuario eligió ahí.
// Los ajustes guardados antes de existir la lista cuentan como elegidos si difieren del valor de fábrica.

const sameValue = (a, b) => String(a).replace(/\s+/g, '').toLowerCase() === String(b).replace(/\s+/g, '').toLowerCase();
const valueAt = (config, key) => key.split('.').reduce((obj, part) => (obj == null ? undefined : obj[part]), config);

/** ¿El usuario eligió este ajuste en el modal del indicador? `factory` puede ser uno o varios valores de fábrica */
export function isCustom(config, key, factory) {
  if (Array.isArray(config?.customVisual)) return config.customVisual.includes(key);
  const value = valueAt(config, key);
  if (value === undefined || value === null) return false;
  return !(Array.isArray(factory) ? factory : [factory]).some(option => sameValue(value, option));
}

/** Lo que el usuario eligió: la lista guardada o, en ajustes de antes, lo que difiere de fábrica */
export function customList(config, factoryValues) {
  if (Array.isArray(config?.customVisual)) return config.customVisual;
  const legacy = { ...config, customVisual: undefined };
  return Object.keys(factoryValues).filter(name => isCustom(legacy, name, factoryValues[name]));
}

/** La lista customVisual con `key` agregada */
export function markCustom(config, key, factoryValues) {
  const list = customList(config, factoryValues);
  return list.includes(key) ? list : [...list, key];
}

/**
 * Color de un texto o una línea de indicador sobre el gráfico. Con un estilo oscuro se aclara lo justo para leerse
 * (ratio de contraste); con los claros y el clásico queda igual
 */
export const chartInk = (hex, ratio = 4.5) => (current !== 'clasico' && THEME.dark && HEX_RE.test(hex) ? readable(hex, THEME.chartBg, ratio) : hex);

/**
 * Un color legible como texto sobre un fondo (por omisión el del gráfico), en cualquier estilo: se oscurece sobre un
 * fondo claro y se aclara sobre uno oscuro, lo justo para el contraste pedido. Lo usan los widgets del dashboard
 */
export const readableOn = (hex, background = THEME.chartBg, ratio = 4.5) => (
  HEX_RE.test(hex) && HEX_RE.test(background || '') ? readable(hex, background, ratio) : hex
);

/** "#RRGGBB" → "r, g, b" para usar con transparencia; null si no es un color así */
export const rgbOf = hex => (typeof hex === 'string' && HEX_RE.test(hex) ? rgbText(hex) : null);

/** Un color "r,g,b" (como los guarda el footprint) → "#RRGGBB" */
export const hexOfRgb = rgb => toHex(String(rgb).split(',').map(Number));

// ==================== LETRA DEL LIENZO ====================

const fontCache = new Map();
const FONT_RE = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|small-caps|\d{3})\s+)*)(\d+(?:\.\d+)?)px(\/\S+)?\s+(.+)$/;
// La letra general de los indicadores ("Inter") sube uno o dos puntos; las cifras que se ajustan a una celda no
const BIGGER = { 8: 10, 9: 11, 10: 11, 11: 12 };

/** "bold 11px Inter, sans-serif" → "600 12px "Segoe UI", ..." */
function mapFont(value) {
  let mapped = fontCache.get(value);
  if (mapped) return mapped;
  const match = FONT_RE.exec(value);
  if (!match) {
    mapped = value;
  } else {
    const prefix = match[1].replace(/\bbold\b/, '600');
    const size = Number(match[2]);
    const finalSize = /Inter/i.test(match[4]) ? (BIGGER[size] ?? size) : size;
    mapped = `${prefix}${finalSize}px${match[3] || ''} ${THEME.font}`;
  }
  fontCache.set(value, mapped);
  return mapped;
}

/** Con Nítido, todo texto del lienzo usa la misma letra que la interfaz */
export function installThemeFonts(ctx) {
  if (!ctx || ctx.__themeFonts || typeof CanvasRenderingContext2D === 'undefined') return;
  const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
  if (!descriptor?.set) return;
  ctx.__themeFonts = true;
  Object.defineProperty(ctx, 'font', {
    configurable: true,
    get() { return descriptor.get.call(this); },
    set(value) { descriptor.set.call(this, current !== 'clasico' && typeof value === 'string' ? mapFont(value) : value); }
  });
}

// ==================== NÚMEROS Y TIEMPOS ====================

/** Decimales del precio de una moneda, sacados de sus propias velas */
export function priceDecimals(candles) {
  let decimals = 0;
  const step = Math.max(1, Math.floor(candles.length / 200));
  for (let i = 0; i < candles.length; i += step) {
    for (const value of [candles[i].open, candles[i].close]) {
      const text = String(value);
      const dot = text.indexOf('.');
      if (dot >= 0) decimals = Math.max(decimals, Math.min(8, text.length - dot - 1));
    }
  }
  return decimals;
}

/** Paso redondo (1, 2, 2.5 o 5 por potencia de 10) que deja las marcas a unos `targetPx` */
export function niceStep(range, heightPx, targetPx, minStep) {
  if (!(range > 0) || !(heightPx > 0)) return minStep || 1;
  const raw = (range * targetPx) / heightPx;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    const step = mult * power;
    if (step >= raw) return Math.max(step, minStep || 0);
  }
  return Math.max(10 * power, minStep || 0);
}

const MINUTE = 60000;
const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 10080].map(m => m * MINUTE);
const COLOMBIA_OFFSET = 5 * 3600000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Paso de tiempo redondo que deja las marcas a `targetPx` o más, nunca menor que la vela */
export function niceTimeStep(barWidthPx, candleMs, targetPx) {
  const pxPerMs = barWidthPx / candleMs;
  for (const step of TIME_STEPS) {
    if (step >= candleMs && step * pxPerMs >= targetPx) return step;
  }
  return TIME_STEPS[TIME_STEPS.length - 1];
}

/** Marca del eje de tiempo en hora de Colombia: día al cambiar de día, si no la hora */
export function timeTick(timestamp, step) {
  const local = new Date(timestamp - COLOMBIA_OFFSET);
  const isDay = local.getUTCHours() === 0 && local.getUTCMinutes() === 0;
  if (isDay || step >= 1440 * MINUTE) {
    return { text: `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`, strong: true };
  }
  const h = String(local.getUTCHours()).padStart(2, '0');
  const m = String(local.getUTCMinutes()).padStart(2, '0');
  return { text: `${h}:${m}`, strong: false };
}

/** ¿Cae esta hora en una marca redonda del paso, contando en hora de Colombia? */
export const isTimeTick = (timestamp, step) => ((timestamp - COLOMBIA_OFFSET) % step + step) % step === 0;

/** Fecha corta para la cruz: "24 oct 14:30" */
export function crossTime(timestamp) {
  const local = new Date(timestamp - COLOMBIA_OFFSET);
  const h = String(local.getUTCHours()).padStart(2, '0');
  const m = String(local.getUTCMinutes()).padStart(2, '0');
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${h}:${m}`;
}

build();
applyToDocument();
if (inBrowser) window.__setTheme = setTheme;
