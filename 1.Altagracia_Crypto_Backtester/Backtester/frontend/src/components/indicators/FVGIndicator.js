import IndicatorBase from './IndicatorBase.js';

const MAX_VISIBLE_CANDLES = 1500; // Con más velas en pantalla los gaps no se alcanzan a leer
const SETTINGS_KEY = 'fvg_settings_';

/** Parámetros guardados de un símbolo; sin almacenamiento disponible quedan los de fábrica */
export function loadFVGSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveFVGSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los parámetros siguen vigentes hasta recargar
  }
}

export function defaultFVGConfig() {
  return {
    minPct: 0.03, // Tamaño mínimo del gap, como porcentaje del precio
    fillMode: 'trim', // 'trim': se recorta. 'touch': termina al primer toque. 'whole': sigue hasta cruzarlo
    maxAge: 0, // Velas que puede vivir un gap. 0 es sin límite
    lookback: 300, // Velas antes de la vista donde pudo nacer un gap que sigue abierto
    showBullish: true,
    showBearish: true,
    showBorder: false,
    bullishColor: '#26a69a',
    bearishColor: '#ef5350',
    opacity: 0.16
  };
}

// Aplica una vela al gap. Devuelve false si el gap ya no sigue abierto.
function stillOpen(gap, candle, fillMode) {
  if (fillMode === 'touch') {
    return gap.bullish ? candle.low > gap.top : candle.high < gap.bottom;
  }
  if (fillMode === 'whole') {
    return gap.bullish ? candle.low > gap.bottom : candle.high < gap.top;
  }
  if (gap.bullish) gap.top = Math.min(gap.top, candle.low);
  else gap.bottom = Math.max(gap.bottom, candle.high);
  return gap.top > gap.bottom;
}

/**
 * Gaps de tres velas que siguen abiertos al final de la lista.
 * La vela en formación afecta a los gaps, pero no crea ninguno hasta cerrar.
 */
export function findFairValueGaps(candles, minPct = 0.03, { fillMode = 'trim', maxAge = 0 } = {}) {
  const margin = minPct / 100;
  let open = [];

  candles.forEach((candle, i) => {
    open = open.filter(gap => stillOpen(gap, candle, fillMode) && (!maxAge || i - gap.bornAt <= maxAge));

    if (i < 2 || candle.in_progress) return;

    const first = candles[i - 2];
    const start = candles[i - 1].timestamp;

    if (candle.low > first.high * (1 + margin)) {
      open.push({ bullish: true, bottom: first.high, top: candle.low, start, bornAt: i });
    } else if (candle.high < first.low * (1 - margin)) {
      open.push({ bullish: false, bottom: candle.high, top: first.low, start, bornAt: i });
    }
  });

  return open;
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

function withOpacity(hex, opacity) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

/**
 * FVGIndicator - Fair value gaps abiertos, con la regla del laboratorio de order flow.
 * Solo usa las velas que ya ocurrieron en la hora simulada.
 */
class FVGIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "FVG";
    this.height = 0; // Se dibuja sobre las velas, no ocupa panel propio
    this.enabled = false;
    this.config = { ...defaultFVGConfig(), ...loadFVGSettings(symbol) };
    this.cacheKey = null;
    this.gaps = [];
  }

  async fetchData() {
    return null;
  }

  render() {}

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    this.cacheKey = null;
  }

  _gapsFor(visibleCandles, candles) {
    const { minPct, fillMode, maxAge, lookback } = this.config;
    const newest = visibleCandles[visibleCandles.length - 1];
    const first = lowerBound(candles, visibleCandles[0].timestamp);
    const last = lowerBound(candles, newest.timestamp);
    const key = `${first}|${last}|${newest.close}|${newest.high}|${newest.low}`;

    if (key !== this.cacheKey) {
      this.cacheKey = key;
      const known = candles.slice(Math.max(0, first - lookback), last + 1);
      this.gaps = findFairValueGaps(known, minPct, { fillMode, maxAge });
    }
    return this.gaps;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !priceContext || visibleCandles.length === 0) return;
    if (visibleCandles.length > MAX_VISIBLE_CANDLES) return;

    const { showBullish, showBearish, showBorder, bullishColor, bearishColor, opacity } = this.config;
    const gaps = this._gapsFor(visibleCandles, priceContext.knownCandles || allCandles);
    const right = bounds.x + bounds.width;

    for (const gap of gaps) {
      if (gap.bullish ? !showBullish : !showBearish) continue;

      const left = Math.max(bounds.x, priceContext.timeToX(gap.start) ?? bounds.x);
      if (left >= right) continue;

      const color = gap.bullish ? bullishColor : bearishColor;
      const y = priceContext.priceToY(gap.top);
      const height = priceContext.priceToY(gap.bottom) - y;

      ctx.fillStyle = withOpacity(color, opacity);
      ctx.fillRect(left, y, right - left, height);

      if (showBorder) {
        ctx.strokeStyle = withOpacity(color, 0.7);
        ctx.lineWidth = 1;
        ctx.strokeRect(left, y, right - left, height);
      }
    }
  }
}

export default FVGIndicator;
