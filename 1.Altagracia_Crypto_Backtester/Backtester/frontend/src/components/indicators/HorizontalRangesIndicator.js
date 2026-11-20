import IndicatorBase from './IndicatorBase.js';
import { candleItemId } from './analysisLevels.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import { PARAMS, runDetector, major, partsFromZones } from './regimeDetectors.js';

/**
 * Rangos horizontales: los detectores de horizontalidad de la pestaña Régimen del backtesting global (19/11/2026),
 * calculados en el navegador con regimeDetectors.js, que repite regime_detectors.py del backend (prueba de paridad en
 * tests/regimedetectors.test.mjs). Sirve en la simulación manual, en el 2.º gráfico, en el backtesting global y en la
 * suite, en vivo.
 *
 * Sin futuro: calcula solo con velas cerradas (`priceContext.knownCandles`, o las del gráfico en vivo, sin la vela en
 * formación). Cada caja va tenue y punteada desde su primera vela hasta la vela en que se supo, y marcada desde ahí.
 * Una caja que sigue viva llega hasta la última vela cerrada.
 *
 * Rendimiento: no recorre todo el historial. Calcula una ventana (la vista más WARM velas antes, para que los
 * detectores arranquen), con bordes en múltiplos de BLOCK velas, y la rehace solo si cambia la ventana, cierra una
 * vela nueva o cambian los ajustes. Un método lento (el VP progresivo) se repite a lo sumo cada THROTTLE_MS: mientras,
 * se dibuja el último cálculo, que solo usa velas ya cerradas.
 */

const SETTINGS_KEY = 'horizontal_ranges_settings_';
export const METHODS = ['er_box', 'atr_range', 'ttm', 'bbwp', 'vp_prog', 'adx', 'er', 'vwap_bw'];
const MAX_VISIBLE_CANDLES = 3000; // Con más velas a la vista las cajas no se alcanzan a leer
const WARM = 600;                 // Velas antes de la vista: cubre el arranque más largo (BBWP de fábrica, 272)
const BLOCK = 200;                // Los bordes de la ventana van de a 200 velas: al desplazarse no se recalcula a cada paso
const SLOW_MS = 40;
const THROTTLE_MS = 400;
const PURPLE = '123, 31, 162';    // Los colores de la pestaña Régimen
const ORANGE = '239, 108, 0';
const BAR = 6;

export function loadHorizontalRangesSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveHorizontalRangesSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los ajustes siguen vigentes hasta recargar
  }
}

/** Parámetros afinados de cada método (los de 4h de la pestaña Régimen) */
export function tunedParams() {
  return Object.fromEntries(METHODS.map(key => [key, { ...PARAMS[key].params }]));
}

export function defaultHorizontalRangesConfig() {
  return {
    method: 'er_box',
    params: tunedParams(),  // Por método: al cambiar de método vuelven los suyos
    major: false,           // Rango mayor: une las cajas del método
    majorAtr: 8,
    majorBuffer: 0.5,
    majorOut: 6,
    showBoxes: true,        // Cajas del método (si se arma el rango mayor, se pueden ocultar y dejar solo ese)
    showBefore: true,       // Tramo tenue y punteado antes de saberse
    showBar: true,          // Barra bajo las velas mientras dura el rango
    opacity: 0.08
  };
}

// Límites de los parámetros del modal: [mínimo, máximo, entero]. Fuera del rango se ajustan al aplicar
const LIMITS = {
  n: [2, 500, true], buffer: [0, 10], exit_er: [0.01, 1], min_bars: [1, 100, true], bb_k: [0.5, 5], kc_k: [0.5, 5],
  lookback: [20, 2000, true], length: [2, 500, true], atr_len: [2, 1000, true], mult: [0.1, 10], max_out: [0, 100, true],
  threshold: [0.1, 20], min_c: [5, 500, true], range_pct: [0.1, 100], range_atr: [0.5, 50], min_d: [0, 100, true], close_out: [1, 50, true]
};
const BELOW = { er_box: [0.01, 1], er: [0.01, 1], adx: [1, 100], bbwp: [1, 100] }; // "Bajo" es eficiencia, ADX o percentil
export const NULLABLE = new Set(['exit_er', 'threshold', 'range_atr']);   // Vacío: sin salida por eficiencia, umbral de App 1, usar %

const clamp = (value, [min, max, integer]) => {
  const number = Math.min(max, Math.max(min, value));
  return integer ? Math.round(number) : number;
};

/** Valores listos para aplicar: método conocido y números dentro de su rango (los del modal) */
export function cleanHorizontalRangesSettings(values) {
  const defaults = defaultHorizontalRangesConfig();
  const method = METHODS.includes(values.method) ? values.method : defaults.method;
  const params = {};
  for (const key of METHODS) {
    const own = { ...PARAMS[key].params, ...(values.params?.[key] || {}) };
    params[key] = {};
    for (const [name, base] of Object.entries(PARAMS[key].params)) {
      const raw = own[name];
      if ((raw === null || raw === '') && NULLABLE.has(name)) {
        params[key][name] = null;
        continue;
      }
      const number = parseFloat(raw);
      const limits = name === 'below' ? BELOW[key] : LIMITS[name];
      params[key][name] = Number.isFinite(number) ? (limits ? clamp(number, limits) : number) : base;
    }
  }
  const num = (value, fallback, limits) => {
    const number = parseFloat(value);
    return Number.isFinite(number) ? clamp(number, limits) : fallback;
  };
  return {
    method,
    params,
    major: !!values.major,
    majorAtr: num(values.majorAtr, defaults.majorAtr, [1, 50]),
    majorBuffer: num(values.majorBuffer, defaults.majorBuffer, [0, 10]),
    majorOut: num(values.majorOut, defaults.majorOut, [1, 50, true]),
    showBoxes: !!values.showBoxes,
    showBefore: !!values.showBefore,
    showBar: !!values.showBar,
    opacity: num(values.opacity, defaults.opacity, [0.02, 0.6])
  };
}

/** Minutos de una vela a partir del marco del gráfico ("15m", "1h", "4h", "1D", "15", "240", "D"…) */
export function intervalMinutes(interval) {
  const text = String(interval ?? '').trim();
  const match = /^(\d+)\s*([mhdwM]?)$/.exec(text);
  if (match) {
    const n = Number(match[1]);
    const unit = match[2];
    if (!unit || unit === 'm') return n;
    if (unit === 'h') return n * 60;
    if (unit === 'd') return n * 1440;
    if (unit === 'w') return n * 10080;
    return n * 43200;
  }
  if (/^1?D$/i.test(text)) return 1440;
  if (/^1?W$/i.test(text)) return 10080;
  if (/^1?M$/.test(text)) return 43200;
  return null;
}

function lowerBound(candles, timestamp) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Zonas de un método y del rango mayor sobre velas cerradas, en horas (ms):
 * start (apertura de su primera vela), known (cierre de la vela en que se supo), end (cierre de su última vela),
 * low, high y live (sigue viva en la última vela).
 */
export function computeRanges(candles, config, tfMinutes) {
  const n = candles.length;
  if (n < 3) return { zones: [], majors: [] };
  const bars = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  for (let i = 0; i < n; i += 1) {
    const k = candles[i];
    bars.t[i] = k.timestamp;
    bars.o[i] = k.open;
    bars.h[i] = k.high;
    bars.l[i] = k.low;
    bars.c[i] = k.close;
    bars.v[i] = k.volume ?? 0;
  }
  const step = tfMinutes ? tfMinutes * 60000 : (n > 1 ? bars.t[n - 1] - bars.t[n - 2] : 60000);
  const method = PARAMS[config.method] ? config.method : 'er_box';
  const params = { ...PARAMS[method].params, ...(config.params?.[method] || {}) };
  const out = runDetector(method, bars, tfMinutes || Math.round(step / 60000), params);
  const toTimes = (z) => ({
    start: bars.t[z.start], known: bars.t[z.detected] + step, end: bars.t[z.end] + step,
    low: z.low, high: z.high, live: z.end === n - 1, ...(z.shape ? { shape: z.shape, d: z.d } : {})
  });
  const zones = out.zones.map(toTimes);
  let majors = [];
  if (config.major) {
    // Las cajas del método, en la vela en que se supo cada una, como la vista del backend (regime_detectors.view)
    const big = major(bars, partsFromZones(out.zones, bars.t), {
      max_atr: Number(config.majorAtr) || 8,
      buffer: Number.isFinite(Number(config.majorBuffer)) ? Number(config.majorBuffer) : 0.5,
      closes_out: Math.max(1, Math.round(Number(config.majorOut) || 1))
    });
    majors = big.zones.map(z => ({ ...toTimes(z), start: z.startT ?? bars.t[z.start], parts: z.parts }));
  }
  return { zones, majors };
}

class HorizontalRangesIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = 'Rangos horizontales';
    this.height = 0; // Se dibuja sobre las velas, no ocupa panel propio
    this.enabled = false;
    const saved = loadHorizontalRangesSettings(symbol);
    const base = defaultHorizontalRangesConfig();
    this.config = { ...base, ...saved, params: { ...base.params, ...(saved.params || {}) } };
    this.version = 0;
    this.cacheKey = null;
    this.result = { zones: [], majors: [] };
    this.lastRun = 0;
    this.lastCost = 0;
    this.shown = [];
  }

  async fetchData() {
    return null;
  }

  render() {}

  updateConfig(config) {
    const params = { ...this.config.params, ...(config.params || {}) };
    this.config = { ...this.config, ...config, params };
    this.version += 1;
    this.cacheKey = null;
  }

  /** Zonas de la ventana que cubre la vista, calculadas solo con velas cerradas */
  _rangesFor(visibleCandles, candles) {
    let lastClosed = candles.length - 1;
    if (lastClosed >= 0 && candles[lastClosed].in_progress) lastClosed -= 1; // La vela en formación no crea ni cierra rangos
    if (lastClosed < 2) return { zones: [], majors: [] };
    const firstVisible = Math.min(lastClosed, lowerBound(candles, visibleCandles[0].timestamp));
    const lastVisible = Math.min(lastClosed, lowerBound(candles, visibleCandles[visibleCandles.length - 1].timestamp));
    const start = Math.max(0, Math.floor((firstVisible - WARM) / BLOCK) * BLOCK);
    const end = Math.min(lastClosed, (Math.floor(lastVisible / BLOCK) + 2) * BLOCK - 1);
    const key = `${this.version}|${candles[start].timestamp}|${candles[end].timestamp}|${end - start}|${candles[end].close}`;
    if (key === this.cacheKey) return this.result;
    // Un método lento no se repite en cada vela de una reproducción rápida: lo dibujado sigue siendo pasado
    const sameStart = this.cacheKey && this.cacheKey.split('|')[1] === String(candles[start].timestamp) && this.cacheKey.startsWith(`${this.version}|`);
    if (sameStart && this.lastCost > SLOW_MS && now() - this.lastRun < THROTTLE_MS) return this.result;
    const t0 = now();
    this.result = computeRanges(candles.slice(start, end + 1), this.config, intervalMinutes(this.interval));
    this.lastRun = now();
    this.lastCost = this.lastRun - t0;
    this.cacheKey = key;
    return this.result;
  }

  /** Techo, mitad y suelo de cada caja a la vista, para elegirlos como niveles */
  selectableLevels() {
    return this.shown.flatMap(zone => {
      const what = zone.isMajor ? 'Rango mayor' : `Rango (${PARAMS[this.config.method]?.label || this.config.method})`;
      return [['techo', zone.high], ['mitad', (zone.high + zone.low) / 2], ['suelo', zone.low]].map(([edge, price]) => {
        const kind = `${what}, ${edge}`;
        return { id: candleItemId('Rangos horizontales', kind, zone.start), source: 'Rangos horizontales', kind, price, start: zone.start, time: zone.known };
      });
    });
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.shown = [];
    if (!this.enabled || !priceContext || !visibleCandles?.length) return;
    if (visibleCandles.length > MAX_VISIBLE_CANDLES) return;
    const candles = priceContext.knownCandles || allCandles;
    if (!candles?.length) return;
    const { zones, majors } = this._rangesFor(visibleCandles, candles);
    const { showBoxes, showBefore, showBar, opacity } = this.config;
    const half = bounds.width / visibleCandles.length / 2;
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const step = (intervalMinutes(this.interval) || 0) * 60000;
    const xOpen = (t) => (priceContext.timeToX(t) ?? NaN) - half;              // Borde izquierdo de la vela que abre en t
    const xClose = (t) => (priceContext.timeToX(step ? t - step : t) ?? NaN) + half; // Borde derecho de la vela que cierra en t

    const draw = (zone, rgb, barY, isMajor) => {
      const x0 = xOpen(zone.start);
      const xKnown = xClose(zone.known);
      const x1 = xClose(zone.end);
      if (![x0, xKnown, x1].every(Number.isFinite)) return;
      if (x1 < left || x0 > right) return;
      const yTop = priceContext.priceToY(zone.high);
      const yBottom = priceContext.priceToY(zone.low);
      const h = yBottom - yTop;
      const clip = (a, b) => [Math.max(left, a), Math.min(right, b)];
      this.shown.push({ ...zone, isMajor });
      ctx.save();
      if (showBefore && xKnown > x0) {
        const [a, b] = clip(x0, xKnown);
        if (b > a) {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = `rgba(${rgb}, 0.45)`;
          ctx.lineWidth = 1;
          ctx.strokeRect(a, yTop, b - a, h);
          ctx.setLineDash([]);
        }
      }
      const [a, b] = clip(Math.max(x0, xKnown), x1);
      if (b > a) {
        ctx.fillStyle = `rgba(${rgb}, ${opacity})`;
        ctx.fillRect(a, yTop, b - a, h);
        ctx.strokeStyle = `rgba(${rgb}, 0.85)`;
        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.strokeRect(a, yTop, b - a, h);
        if (showBar) {
          ctx.fillStyle = `rgba(${rgb}, 0.6)`;
          ctx.fillRect(a, barY, b - a, BAR);
        }
      }
      ctx.restore();
    };

    const purple = isNewTheme() && THEME.vpClusterRgb ? THEME.vpClusterRgb : PURPLE;
    if (showBoxes) for (const zone of zones) draw(zone, purple, bottom - BAR, false);
    for (const zone of majors) draw(zone, ORANGE, bottom - BAR * (showBoxes && showBar ? 2 : 1) - (showBoxes && showBar ? 1 : 0), true);
  }
}

export default HorizontalRangesIndicator;
