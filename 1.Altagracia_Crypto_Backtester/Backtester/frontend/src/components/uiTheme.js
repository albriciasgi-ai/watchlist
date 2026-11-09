// Estilo visual de App 1.
//
// "nitido" (el que abre por defecto): una sola letra (Segoe UI de 12 px), color solo en los datos,
// precios y horas redondos en los ejes, leyenda con la vela bajo la cruz, último precio en el eje y
// footprint graduado por volumen. Sus colores se cambian en el modal "Estilo y colores".
// "clasico": el aspecto anterior, sin ningún cambio.
//
// Se guarda en localStorage: "ui_theme" ("nitido" | "clasico") y "ui_theme_colors" (los colores que
// el usuario cambió). Un indicador nuevo pregunta isNewTheme() al dibujar y toma sus colores de THEME.

const STYLE_KEY = 'ui_theme';
const COLORS_KEY = 'ui_theme_colors';
const DEFAULT_STYLE = 'nitido';
const listeners = new Set();

/** Colores de Nítido. Son los que el modal deja cambiar */
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
/** El mismo color, oscurecido lo justo para leerse como texto sobre el fondo */
const readable = (hex, background, ratio) => {
  let color = hex;
  for (let i = 0; i < 20 && contrast(color, background) < ratio; i++) color = mix(color, '#000000', 0.08);
  return color;
};

// ==================== ESTADO ====================

function readStyle() {
  try {
    const value = window.localStorage?.getItem(STYLE_KEY);
    return value === 'clasico' ? 'clasico' : (value ? 'nitido' : DEFAULT_STYLE);
  } catch {
    return DEFAULT_STYLE;
  }
}

function readColors() {
  try {
    const saved = JSON.parse(window.localStorage?.getItem(COLORS_KEY) || '{}');
    return Object.fromEntries(Object.entries(saved).filter(([key, value]) => key in DEFAULT_COLORS && HEX_RE.test(value)));
  } catch {
    return {};
  }
}

// Sin navegador (pruebas de Node) se dibuja como siempre
const inBrowser = typeof window !== 'undefined';
let current = inBrowser ? readStyle() : 'clasico';
let custom = inBrowser ? readColors() : {};
let revision = 0;

/** Colores y medidas del estilo Nítido con los cambios del usuario. Se lee al dibujar */
export const THEME = {};

function build() {
  const c = { ...DEFAULT_COLORS, ...custom };
  for (const key of Object.keys(THEME)) delete THEME[key];
  Object.assign(THEME, c, {
    font: '"Segoe UI", system-ui, sans-serif',
    fontSize: 12,
    upRgb: rgbText(c.up),
    downRgb: rgbText(c.down),
    upText: readable(c.up, c.chartBg, 4.5),
    downText: readable(c.down, c.chartBg, 4.5),
    fpBuyRgb: rgbText(c.fpBuy),
    fpSellRgb: rgbText(c.fpSell),
    fpImbUpText: readable(mix(c.fpBuy, '#000000', 0.35), c.chartBg, 7),
    fpImbDownText: readable(mix(c.fpSell, '#000000', 0.35), c.chartBg, 7),
    fpText: c.text,
    fpTextFaint: mix(c.textMuted, c.chartBg, 0.4),
    fpEmpty: 'rgba(0, 0, 0, 0.035)',
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
/** Cambia en cada ajuste de estilo o de color: sirve para redibujar */
export const themeRevision = () => revision;
/** Los colores actuales, para el modal */
export const themeColors = () => ({ ...DEFAULT_COLORS, ...custom });

export function setTheme(name) {
  current = name === 'clasico' ? 'clasico' : 'nitido';
  try { window.localStorage?.setItem(STYLE_KEY, current); } catch { /* sin almacenamiento */ }
  changed();
}

/** Cambia uno o varios colores de Nítido y los guarda */
export function setThemeColors(colors) {
  for (const [key, value] of Object.entries(colors)) {
    if (!(key in DEFAULT_COLORS) || !HEX_RE.test(value)) continue;
    if (value.toUpperCase() === DEFAULT_COLORS[key].toUpperCase()) delete custom[key];
    else custom[key] = value.toUpperCase();
  }
  try { window.localStorage?.setItem(COLORS_KEY, JSON.stringify(custom)); } catch { /* sin almacenamiento */ }
  changed();
}

export function resetThemeColors() {
  custom = {};
  try { window.localStorage?.removeItem(COLORS_KEY); } catch { /* sin almacenamiento */ }
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
