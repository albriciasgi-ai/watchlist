import IndicatorBase from './IndicatorBase.js';

const LOOKBACK_CANDLES = 300; // Velas antes de la vista donde pudo nacer un gap que sigue abierto
const MAX_VISIBLE_CANDLES = 1500; // Con más velas en pantalla los gaps no se alcanzan a leer

/**
 * Gaps de tres velas que siguen abiertos al final de la lista.
 * Cada vela los recorta y los elimina si los cruza por completo.
 * La vela en formación recorta gaps, pero no crea ninguno hasta cerrar.
 */
export function findFairValueGaps(candles, minPct = 0.03) {
  const margin = minPct / 100;
  let open = [];

  candles.forEach((candle, i) => {
    for (const gap of open) {
      if (gap.bullish) gap.top = Math.min(gap.top, candle.low);
      else gap.bottom = Math.max(gap.bottom, candle.high);
    }
    open = open.filter(gap => gap.top > gap.bottom);

    if (i < 2 || candle.in_progress) return;

    const first = candles[i - 2];
    const start = candles[i - 1].timestamp;

    if (candle.low > first.high * (1 + margin)) {
      open.push({ bullish: true, bottom: first.high, top: candle.low, start });
    } else if (candle.high < first.low * (1 - margin)) {
      open.push({ bullish: false, bottom: candle.high, top: first.low, start });
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
    this.minPct = 0.03; // Tamaño mínimo del gap, como porcentaje del precio
    this.bullishColor = 'rgba(38, 166, 154, 0.16)';
    this.bearishColor = 'rgba(239, 83, 80, 0.16)';
    this.cacheKey = null;
    this.gaps = [];
  }

  async fetchData() {
    return null;
  }

  render() {}

  updateConfig(config) {
    if (config.minPct !== undefined) this.minPct = config.minPct;
    this.cacheKey = null;
  }

  _gapsFor(visibleCandles, candles) {
    const newest = visibleCandles[visibleCandles.length - 1];
    const first = lowerBound(candles, visibleCandles[0].timestamp);
    const last = lowerBound(candles, newest.timestamp);
    const key = `${first}|${last}|${newest.close}|${newest.high}|${newest.low}|${this.minPct}`;

    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.gaps = findFairValueGaps(candles.slice(Math.max(0, first - LOOKBACK_CANDLES), last + 1), this.minPct);
    }
    return this.gaps;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !priceContext || visibleCandles.length === 0) return;
    if (visibleCandles.length > MAX_VISIBLE_CANDLES) return;

    const gaps = this._gapsFor(visibleCandles, priceContext.knownCandles || allCandles);
    const right = bounds.x + bounds.width;

    for (const gap of gaps) {
      const left = Math.max(bounds.x, priceContext.timeToX(gap.start) ?? bounds.x);
      if (left >= right) continue;

      const y = priceContext.priceToY(gap.top);
      ctx.fillStyle = gap.bullish ? this.bullishColor : this.bearishColor;
      ctx.fillRect(left, y, right - left, priceContext.priceToY(gap.bottom) - y);
    }
  }
}

export default FVGIndicator;
