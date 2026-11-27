import IndicatorBase from './IndicatorBase.js';
import { candleItemId } from './analysisLevels.js';

const SETTINGS_KEY = 'ema_settings_';
export const EMA_MAX_LINES = 6;
export const EMA_PERIOD = { min: 2, max: 400 }; // Los mismos límites de las EMA del backtesting global y de la cocina
const COLORS = ['#2962ff', '#f57c00', '#7b1fa2', '#00796b', '#c2185b', '#455a64'];
const MIN_BAR_PX = 3; // Con velas más angostas la línea se dibuja, pero no se ofrece vela por vela

export function loadEMASettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveEMASettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

export const emaColor = (index) => COLORS[index % COLORS.length];

export function defaultEMAConfig() {
  return {
    lines: [
      { period: 20, color: COLORS[0], width: 1.5 },
      { period: 50, color: COLORS[1], width: 1.5 },
      { period: 200, color: COLORS[2], width: 1.5 }
    ],
    showLabels: true
  };
}

/** Líneas válidas: periodos enteros dentro de rango, sin repetir, hasta EMA_MAX_LINES */
export function cleanEMAConfig(raw) {
  const base = defaultEMAConfig();
  const seen = new Set();
  const lines = [];
  for (const [i, item] of (Array.isArray(raw?.lines) ? raw.lines : base.lines).entries()) {
    const period = Math.round(Number(item?.period));
    if (!Number.isFinite(period) || period < EMA_PERIOD.min || period > EMA_PERIOD.max || seen.has(period)) continue;
    seen.add(period);
    const width = Number(item?.width);
    lines.push({
      period,
      color: /^#[0-9a-f]{6}$/i.test(item?.color || '') ? item.color : emaColor(i),
      width: Number.isFinite(width) ? Math.min(4, Math.max(0.5, width)) : 1.5
    });
    if (lines.length >= EMA_MAX_LINES) break;
  }
  return { lines, showLabels: raw?.showLabels !== false };
}

/**
 * EMA del cierre, como la del backtesting global (rule_tester._line): arranca en el primer cierre y no da valor hasta
 * tener `period` velas. Devuelve un valor por vela (NaN al principio).
 */
export function emaSeries(closes, period) {
  const out = new Float64Array(closes.length).fill(NaN);
  const k = 2 / (period + 1);
  let value = closes.length ? closes[0] : 0;
  for (let i = 0; i < closes.length; i++) {
    value = closes[i] * k + value * (1 - k);
    if (i >= period - 1) out[i] = value;
  }
  return out;
}

// Posición de la primera vela con timestamp igual o mayor
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

/**
 * EMAIndicator - Medias móviles exponenciales del cierre, varias a la vez, cada una con su periodo.
 * Solo usa las velas que ya ocurrieron en la hora simulada: la vela en formación mueve el último punto con su precio
 * de ese momento, y al cerrar queda fijo.
 */
class EMAIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = 'EMA';
    this.height = 0; // Se dibuja sobre las velas
    this.enabled = false;
    this.config = cleanEMAConfig({ ...defaultEMAConfig(), ...loadEMASettings(symbol) });
    this.cache = new Map(); // periodo -> { first, count, lastTime, value, values }
    this.shown = [];        // Lo dibujado en el último cuadro, para elegirlo con un clic
  }

  async fetchData() {
    return null;
  }

  render() {}

  updateConfig(settings) {
    this.config = cleanEMAConfig({ ...this.config, ...settings });
    this.cache.clear();
  }

  // La EMA de las velas cerradas, extendida solo con las nuevas. Si las velas cambian o retroceden, empieza de cero
  _closed(period, candles, count) {
    let entry = this.cache.get(period);
    const first = candles[0]?.timestamp;
    const stale = !entry || entry.first !== first || entry.count > count
      || (entry.count > 0 && candles[entry.count - 1]?.timestamp !== entry.lastTime);
    if (stale) {
      entry = { first, count: 0, lastTime: null, value: count ? candles[0].close : 0, values: new Float64Array(Math.max(1024, count + 256)).fill(NaN) };
      this.cache.set(period, entry);
    }
    if (entry.values.length < count) {
      const grown = new Float64Array(count + Math.max(1024, count >> 3)).fill(NaN);
      grown.set(entry.values.subarray(0, entry.count));
      entry.values = grown;
    }
    const k = 2 / (period + 1);
    for (let i = entry.count; i < count; i++) {
      entry.value = candles[i].close * k + entry.value * (1 - k);
      entry.values[i] = i >= period - 1 ? entry.value : NaN;
    }
    if (count > 0) entry.lastTime = candles[count - 1].timestamp;
    entry.count = count;
    return entry;
  }

  /**
   * El valor de cada línea en cada vela cerrada de `candles` (las que ya ocurrieron), para la cocina de estrategias:
   * { e20: Float64Array, ... } alineado con `candles`. NaN donde todavía no hay línea.
   */
  seriesFor(candles) {
    const count = candles.length && candles[candles.length - 1].in_progress ? candles.length - 1 : candles.length;
    const out = {};
    for (const line of this.config.lines) out[`e${line.period}`] = this._closed(line.period, candles, count).values.subarray(0, count);
    return out;
  }

  /** Cada línea en cada vela a la vista, para elegirla con un clic */
  selectableLevels() {
    return this.shown;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.shown = [];
    if (!this.enabled || !priceContext || !visibleCandles.length || !this.config.lines.length) return;
    const candles = priceContext.knownCandles || allCandles;
    if (!candles?.length) return;
    const forming = candles[candles.length - 1].in_progress ? candles[candles.length - 1] : null;
    const count = forming ? candles.length - 1 : candles.length;
    const start = lowerBound(candles, visibleCandles[0].timestamp);
    const barWidth = bounds.width / visibleCandles.length;
    const xOf = (candle, i) => priceContext.candleX?.(candle.timestamp) ?? bounds.x + (i + 0.5) * barWidth;

    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
    for (const line of this.config.lines) {
      const entry = this._closed(line.period, candles, count);
      const k = 2 / (line.period + 1);
      const label = `EMA ${line.period}`;
      let last = null;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      let drawing = false;
      visibleCandles.forEach((candle, i) => {
        const index = start + i;
        let value = NaN;
        if (index < count && candles[index]?.timestamp === candle.timestamp) value = entry.values[index];
        else if (forming && candle.timestamp === forming.timestamp && count >= line.period - 1) value = forming.close * k + entry.value * (1 - k);
        if (!Number.isFinite(value)) { drawing = false; return; }
        const x = xOf(candle, i);
        const y = priceContext.priceToY(value);
        if (drawing) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        drawing = true;
        last = { x, y, value };
        if (barWidth >= MIN_BAR_PX) {
          this.shown.push({
            id: candleItemId('EMA', label, candle.timestamp, null, this.interval),
            source: 'EMA', kind: label, price: value, time: candle.timestamp,
            line: `e${line.period}`, x, y, r: Math.max(5, Math.min(9, barWidth / 2))
          });
        }
      });
      ctx.stroke();
      if (last && this.config.showLabels) {
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.fillStyle = line.color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, Math.min(last.x - 4, bounds.x + bounds.width - 4), last.y - 3);
      }
    }
    ctx.restore();
  }
}

export default EMAIndicator;
