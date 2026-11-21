import IndicatorBase from './IndicatorBase.js';
import { candleItemId } from './analysisLevels.js';
import { THEME, isNewTheme, priceDecimals } from '../uiTheme.js';
import { alignY, crispWidth } from '../chartPixels.js';
import { pricesHidden, priceText, volumeText } from '../backtesting/blindClock.js';
import { barsOf } from './williams.js';
import { computeSmc, loadSmcSettings, mergeSmcConfig, nextPeriod, periodStart, previousLevels } from './smcStructure.js';
import { rgba } from './WilliamsIndicators.js';
import { intervalMinutes } from './HorizontalRangesIndicator.js';
import { EqLiquidations, ObVolume } from './smcExtras.js';

/**
 * Estructura SMC en el gráfico (20/11/2026): estructura interna y mayor con BOS y CHoCH, order blocks con su vida y
 * breakers, iguales con su barrido, rango premium/discount con el máximo y el mínimo fuertes o débiles, y los niveles
 * del día, la semana y el mes anteriores. Reglas en smcStructure.js.
 *
 * Sin futuro: solo velas cerradas (`priceContext.knownCandles` en la reproducción). Cada pieza va punteada desde su
 * vela hasta la vela en que se supo, y marcada desde ahí: un pivote de 50 velas o un order block se dibujan en su
 * vela, pero se supieron después. Los order blocks rotos no se borran: quedan tenues hasta la vela que los rompió.
 *
 * Calcula una ventana (la vista y WARM velas antes), con bordes de a BLOCK velas, y la rehace solo si cambia la
 * ventana, cierra una vela nueva o cambian los ajustes.
 */

const MAX_VISIBLE = 3000;
const WARM = 1500;
const BLOCK = 200;
const LEVELS = [['daily', 'day', 'PD'], ['weekly', 'week', 'PW'], ['monthly', 'month', 'PM']];

function candleLowerBound(candles, timestamp) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

class SMCIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = 'Estructura SMC';
    this.height = 0;
    this.enabled = false;
    this.config = mergeSmcConfig(loadSmcSettings(symbol));
    this.version = 0;
    this.key = null;
    this.view = null;
    this.levelCache = new Map();
    this.items = [];
    this.obVolume = new ObVolume(symbol);
    this.eqLiquidations = new EqLiquidations(symbol);
  }

  /** Detiene los pedidos del volumen real y de las liquidaciones (al cambiar de moneda o cerrar) */
  dispose() {
    this.obVolume.dispose();
    this.eqLiquidations.dispose();
  }

  async fetchData() {
    return null;
  }

  render() {}

  updateConfig(config) {
    this.config = mergeSmcConfig({ ...this.config, ...config });
    this.version += 1;
    this.key = null;
    this.levelCache.clear();
  }

  selectableLevels() {
    return this.items;
  }

  _window(visibleCandles, candles) {
    let lastClosed = candles.length - 1;
    if (candles[lastClosed].in_progress) lastClosed -= 1;
    if (lastClosed < 3) return null;
    const firstVisible = Math.min(lastClosed, candleLowerBound(candles, visibleCandles[0].timestamp));
    const lastVisible = Math.min(lastClosed, candleLowerBound(candles, visibleCandles[visibleCandles.length - 1].timestamp));
    const start = Math.max(0, Math.floor((firstVisible - WARM) / BLOCK) * BLOCK);
    const end = Math.min(lastClosed, (Math.floor(lastVisible / BLOCK) + 2) * BLOCK - 1);
    const key = `${this.version}|${candles[start].timestamp}|${candles[end].timestamp}|${end - start}|${candles[end].close}`;
    if (key !== this.key) {
      const bars = barsOf(candles.slice(start, end + 1));
      this.view = { bars, result: computeSmc(bars, this.config) };
      this.key = key;
    }
    return { ...this.view, lastClosed };
  }

  /** Máximos y mínimos del periodo anterior para los periodos a la vista; se rehace solo al empezar un periodo */
  _levels(kind, candles, visibleCandles, lastClosed) {
    const firstTime = visibleCandles[0].timestamp;
    let from = periodStart(firstTime, kind);
    for (let k = 0; k < 3; k += 1) from = periodStart(from - 1, kind);
    const lastPeriod = periodStart(candles[lastClosed].timestamp, kind);
    const key = `${this.version}|${kind}|${from}|${lastPeriod}|${periodStart(visibleCandles[visibleCandles.length - 1].timestamp, kind)}`;
    if (!this.levelCache.has(key)) {
      if (this.levelCache.size > 12) this.levelCache.clear();
      const startIndex = candleLowerBound(candles, from);
      const endTime = nextPeriod(periodStart(visibleCandles[visibleCandles.length - 1].timestamp, kind), kind);
      const endIndex = Math.min(lastClosed, candleLowerBound(candles, endTime) - 1);
      this.levelCache.set(key, endIndex >= startIndex ? previousLevels(candles.slice(startIndex, endIndex + 1), kind) : []);
    }
    return this.levelCache.get(key);
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.items = [];
    if (!this.enabled || !priceContext?.priceToY || !visibleCandles?.length || visibleCandles.length > MAX_VISIBLE) return;
    const candles = priceContext.knownCandles || allCandles;
    if (!candles?.length) return;
    const view = this._window(visibleCandles, candles);
    if (!view) return;
    const { bars, result } = view;
    const cfg = this.config;
    const times = bars.t;
    const indexOf = (timestamp) => {
      let low = 0;
      let high = times.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (times[middle] < timestamp) low = middle + 1;
        else high = middle;
      }
      return low < times.length && times[low] === timestamp ? low : -1;
    };
    const first = indexOf(visibleCandles[0].timestamp);
    if (first < 0) return;
    let lastVisible = first + visibleCandles.length - 1;
    if (lastVisible > result.n - 1) lastVisible = result.n - 1;
    const barWidth = bounds.width / visibleCandles.length;
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const xLeft = (index) => left + (index - first) * barWidth;
    const xCenter = (index) => xLeft(index) + barWidth / 2;
    const xRight = (index) => xLeft(index) + barWidth;
    const y = (price) => priceContext.priceToY(price);
    const inView = (a, b) => b >= first && a <= first + visibleCandles.length;
    const nitido = isNewTheme();
    const font = (px, bold = false) => `${bold ? 'bold ' : ''}${px}px ${nitido ? THEME.font : 'Inter, sans-serif'}`;
    const bull = cfg.bullColor;
    const bear = cfg.bearColor;
    const digits = priceDecimals(visibleCandles);
    const source = 'Estructura SMC';
    const tfMinutes = intervalMinutes(this.interval);
    const offer = (kind, price, startIndex, knownIndex, extra = {}) => {
      if (!Number.isFinite(price)) return;
      this.items.push({
        id: candleItemId(source, kind, times[startIndex], price), source, kind, price,
        start: times[startIndex], time: times[knownIndex] ?? times[startIndex], ...extra
      });
    };

    const line = (x0, x1, price, color, width = 1, dash = []) => {
      const a = Math.max(left, x0);
      const b = Math.min(right, x1);
      if (b <= a) return;
      const yy = alignY(y(price), width);
      ctx.strokeStyle = color;
      ctx.lineWidth = crispWidth(width);
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(a, yy);
      ctx.lineTo(b, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const text = (value, x, yy, color, px = 10, bold = false, align = 'center', baseline = 'middle') => {
      if (x < left - 40 || x > right + 40) return;
      ctx.font = font(px, bold);
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      if (nitido) {
        const w = ctx.measureText(value).width;
        const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
        const y0 = baseline === 'bottom' ? yy - px - 1 : baseline === 'top' ? yy : yy - px / 2 - 1;
        ctx.fillStyle = THEME.labelBg;
        ctx.fillRect(x0 - 2, y0, w + 4, px + 3);
      }
      ctx.fillStyle = color;
      ctx.fillText(value, x, yy);
    };

    ctx.save();

    // Rango premium/discount en la última vela a la vista (debajo de todo)
    const top = result.top[lastVisible];
    const bottom = result.bottom[lastVisible];
    const rangeStart = result.rangeStart[lastVisible];
    if ((cfg.zones.show || cfg.strongWeak.show) && Number.isFinite(top) && Number.isFinite(bottom) && top > bottom && rangeStart >= 0) {
      const x0 = Math.max(left, xLeft(rangeStart));
      const x1 = lastVisible >= result.n - 1 ? right : xRight(lastVisible);
      const eq = (top + bottom) / 2;
      if (cfg.zones.show && x1 > x0) {
        const bands = cfg.zones.style === 'bands'
          ? [[top, 0.95 * top + 0.05 * bottom, bear, 'Premium'], [0.525 * top + 0.475 * bottom, 0.475 * top + 0.525 * bottom, '#9E9E9E', 'Equilibrio'], [0.05 * top + 0.95 * bottom, bottom, bull, 'Discount']]
          : [[top, eq, bear, 'Premium'], [eq, bottom, bull, 'Discount']];
        for (const [hi, lo, color, label] of bands) {
          ctx.fillStyle = rgba(color, cfg.zones.style === 'bands' ? 0.16 : 0.06);
          ctx.fillRect(x0, y(hi), x1 - x0, y(lo) - y(hi));
          text(label, x1 - 4, label === 'Discount' ? y(lo) - 2 : y(hi) + 2, rgba(color, 0.9), 10, false, 'right', label === 'Discount' ? 'bottom' : 'top');
        }
        line(x0, x1, eq, 'rgba(140, 140, 140, 0.8)', 1, [4, 3]);
        offer('Rango SMC, equilibrio (50%)', eq, rangeStart, lastVisible);
        offer('Rango SMC, techo (premium)', top, rangeStart, lastVisible);
        offer('Rango SMC, suelo (discount)', bottom, rangeStart, lastVisible);
      }
      if (cfg.strongWeak.show) {
        const bias = result.bias[lastVisible];
        const highText = bias < 0 ? 'Máx. fuerte' : 'Máx. débil';
        const lowText = bias > 0 ? 'Mín. fuerte' : 'Mín. débil';
        line(x0, x1, top, rgba(bear, 0.8), 1);
        line(x0, x1, bottom, rgba(bull, 0.8), 1);
        text(highText, x1 - 4, y(top) - 2, bear, 10, false, 'right', 'bottom');
        text(lowText, x1 - 4, y(bottom) + 2, bull, 10, false, 'right', 'top');
        offer(`SMC, ${highText.toLowerCase()}`, top, rangeStart, lastVisible);
        offer(`SMC, ${lowText.toLowerCase()}`, bottom, rangeStart, lastVisible);
      }
    }

    // Order blocks: los activos más recientes de cada estructura y, tenues, los rotos a la vista
    const shownObs = [];
    for (const [scope, on, count] of [['internal', cfg.ob.internal, cfg.ob.internalCount], ['swing', cfg.ob.swing, cfg.ob.swingCount]]) {
      if (!on) continue;
      const list = result.obs.filter(ob => ob.scope === scope && ob.known <= lastVisible);
      const alive = list.filter(ob => ob.broken === null || ob.broken > lastVisible).slice(-count);
      const dead = cfg.ob.showBroken ? list.filter(ob => ob.broken !== null && ob.broken <= lastVisible && inView(ob.index, ob.broken)).slice(-count * 2) : [];
      const breakers = cfg.ob.breakers ? list.filter(ob => ob.broken !== null && ob.broken <= lastVisible && (ob.breakerEnd === null || ob.breakerEnd > lastVisible || inView(ob.broken, ob.breakerEnd))) .slice(-count) : [];
      for (const ob of new Set([...dead, ...breakers, ...alive])) shownObs.push(ob);
    }
    for (const ob of shownObs) {
      const color = ob.dir > 0 ? bull : bear;
      const opposite = ob.dir > 0 ? bear : bull;
      const yTop = y(ob.top);
      const yBottom = y(ob.bottom);
      const h = Math.max(1, yBottom - yTop);
      const xa = xLeft(ob.index);
      const xKnown = xRight(ob.known);
      const broken = ob.broken !== null && ob.broken <= lastVisible;
      const xEnd = broken ? xRight(ob.broken) : (lastVisible >= result.n - 1 ? right : xRight(lastVisible));
      const scopeText = ob.scope === 'swing' ? 'mayor' : 'interno';
      if (cfg.showBefore && xKnown > xa) {
        const a = Math.max(left, xa);
        const b = Math.min(right, xKnown);
        if (b > a) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = rgba(color, 0.5);
          ctx.lineWidth = 1;
          ctx.strokeRect(a, yTop, b - a, h);
          ctx.setLineDash([]);
        }
      }
      const a = Math.max(left, Math.max(xa, xKnown));
      const b = Math.min(right, xEnd);
      if (b > a) {
        ctx.fillStyle = rgba(color, broken ? cfg.obOpacity * 0.4 : cfg.obOpacity);
        ctx.fillRect(a, yTop, b - a, h);
        ctx.strokeStyle = rgba(color, broken ? 0.4 : 0.8);
        ctx.lineWidth = ob.scope === 'swing' ? 1.5 : 1;
        ctx.setLineDash(broken ? [4, 3] : []);
        ctx.strokeRect(a, yTop, b - a, h);
        ctx.setLineDash([]);
        if (cfg.ob.showMid && !broken) line(a, b, ob.mid, rgba(color, 0.6), 1, [2, 3]);
        const real = cfg.ob.realVolume && tfMinutes ? this.obVolume.get(tfMinutes, { t: times[ob.index], h: bars.h[ob.index], l: bars.l[ob.index] }, priceContext.requestRedraw) : null;
        if (real && Number.isFinite(real.poc) && real.poc <= ob.top && real.poc >= ob.bottom) {
          line(a, b, real.poc, broken ? 'rgba(120, 120, 120, 0.6)' : (nitido ? THEME.vpPoc : '#F44336'), 1);
          if (b - a >= 60 && !broken) text(`POC · Δ ${volumeText(real.delta, true)}`, b - 3, y(real.poc) - 1, nitido ? THEME.textMuted : '#555', 9, false, 'right', 'bottom');
          if (!broken) offer(`OB ${ob.dir > 0 ? 'alcista' : 'bajista'} ${scopeText}, POC real (Δ ${volumeText(real.delta, true)})`, real.poc, ob.index, ob.known);
        }
        if (h >= 11 && b - a >= 30) text(ob.scope === 'swing' ? 'OB mayor' : 'OB', a + 3, yTop + 2, rgba(color, 0.95), 9, false, 'left', 'top');
      }
      // Breaker: el OB roto, del lado contrario, hasta que un cierre lo atraviesa de vuelta
      if (broken && cfg.ob.breakers) {
        const endB = ob.breakerEnd !== null && ob.breakerEnd <= lastVisible ? xRight(ob.breakerEnd) : (lastVisible >= result.n - 1 ? right : xRight(lastVisible));
        const ba = Math.max(left, xRight(ob.broken));
        const bb = Math.min(right, endB);
        if (bb > ba) {
          ctx.fillStyle = rgba(opposite, cfg.obOpacity * 0.5);
          ctx.fillRect(ba, yTop, bb - ba, h);
          ctx.strokeStyle = rgba(opposite, 0.75);
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(ba, yTop, bb - ba, h);
          ctx.setLineDash([]);
          if (h >= 11 && bb - ba >= 40) text('Breaker', ba + 3, yTop + 2, rgba(opposite, 0.95), 9, false, 'left', 'top');
        }
      }
      if (!broken || (cfg.ob.breakers && (ob.breakerEnd === null || ob.breakerEnd > lastVisible))) {
        const what = broken ? `Breaker ${ob.dir > 0 ? 'bajista' : 'alcista'} (OB ${scopeText} roto)` : `OB ${ob.dir > 0 ? 'alcista' : 'bajista'} ${scopeText}`;
        offer(`${what}, borde alto`, ob.top, ob.index, ob.known);
        offer(`${what}, mitad`, ob.mid, ob.index, ob.known);
        offer(`${what}, borde bajo`, ob.bottom, ob.index, ob.known);
      }
    }

    // Rupturas: línea del pivote a la vela que lo rompe, con BOS o CHoCH
    for (const br of result.breaks) {
      const scopeCfg = br.scope === 'swing' ? cfg.swing : cfg.internal;
      if (!scopeCfg.show || (br.tag === 'BOS' ? !scopeCfg.bos : !scopeCfg.choch)) continue;
      if (br.known > lastVisible || !inView(br.pivot, br.index)) continue;
      const color = br.dir > 0 ? bull : bear;
      const swing = br.scope === 'swing';
      line(xCenter(br.pivot), xCenter(br.index), br.price, color, swing ? 1.5 : 1, swing ? [] : [4, 3]);
      const mid = (xCenter(br.pivot) + xCenter(br.index)) / 2;
      text(br.tag, Math.min(right - 14, Math.max(left + 14, mid)), y(br.price) + (br.dir > 0 ? -2 : 2), color, swing ? 10 : 9, swing, 'center', br.dir > 0 ? 'bottom' : 'top');
      offer(`${br.tag} ${br.dir > 0 ? 'alcista' : 'bajista'} (${swing ? 'mayor' : 'interna'})`, br.price, br.pivot, br.index);
    }

    // Etiquetas de los pivotes mayores, con el tramo punteado hasta que se supieron
    if (cfg.swing.show && cfg.swing.labels) {
      for (const p of result.swingPivots) {
        if (p.known > lastVisible || !p.label || !inView(p.index, p.known)) continue;
        const color = p.type > 0 ? bear : bull;
        if (cfg.showBefore) line(xCenter(p.index), xCenter(p.known), p.price, rgba(color, 0.45), 1, [2, 3]);
        const i = p.index - first;
        if (i >= 0 && i < visibleCandles.length) {
          text(p.label, xCenter(p.index), y(p.price) + (p.type > 0 ? -4 : 4), color, 9, true, 'center', p.type > 0 ? 'bottom' : 'top');
        }
      }
    }

    // Iguales: línea entre los dos pivotes, nivel hasta su barrido y el barrido
    const stepMs = (tfMinutes || 0) * 60000;
    let liqReady = false;
    if (cfg.equal.show && cfg.equal.liquidations) {
      const shownEq = result.equals.filter(eq => eq.known <= lastVisible);
      if (shownEq.length) liqReady = this.eqLiquidations.ensure(times[shownEq[0].known], times[lastVisible] + stepMs, priceContext.requestRedraw);
    }
    if (cfg.equal.show) {
      for (const eq of result.equals) {
        if (eq.known > lastVisible) continue;
        const sweptKnown = eq.swept !== null && eq.swept <= lastVisible;
        const endIndex = sweptKnown ? eq.swept : lastVisible;
        if (!inView(eq.first, endIndex)) continue;
        const color = eq.dir > 0 ? bear : bull;
        ctx.strokeStyle = rgba(color, 0.85);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(xCenter(eq.first), y(eq.firstPrice));
        ctx.lineTo(xCenter(eq.index), y(eq.price));
        ctx.stroke();
        ctx.setLineDash([]);
        line(xCenter(eq.known), sweptKnown ? xCenter(eq.swept) : (lastVisible >= result.n - 1 ? right : xRight(lastVisible)), eq.level, rgba(color, 0.35), 1, [1, 3]);
        let tag = eq.dir > 0 ? 'EQH' : 'EQL';
        if (cfg.equal.liquidations && liqReady) {
          const usd = this.eqLiquidations.near(eq.level, times[eq.known] + stepMs);
          if (usd > 0) tag += pricesHidden() ? ' · liq.' : ` · ${usd >= 1e6 ? `${(usd / 1e6).toFixed(1)}M` : `${Math.round(usd / 1e3)}K`} liq.`;
        }
        text(tag, (xCenter(eq.first) + xCenter(eq.index)) / 2, y(eq.level) + (eq.dir > 0 ? -3 : 3), color, 9, false, 'center', eq.dir > 0 ? 'bottom' : 'top');
        if (sweptKnown && cfg.equal.sweeps) {
          const xs = xCenter(eq.swept);
          const ys = y(eq.level);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(xs - 4, ys - 4);
          ctx.lineTo(xs + 4, ys + 4);
          ctx.moveTo(xs + 4, ys - 4);
          ctx.lineTo(xs - 4, ys + 4);
          ctx.stroke();
          text(eq.reclaimed ? 'barrido ↩' : 'barrido', xs, ys + (eq.dir > 0 ? -7 : 7), color, 9, false, 'center', eq.dir > 0 ? 'bottom' : 'top');
        }
        if (!sweptKnown) offer(`${tag} (iguales${eq.dir > 0 ? ' arriba' : ' abajo'}) sin barrer`, eq.level, eq.first, eq.known);
      }
    }

    // Niveles del día, la semana y el mes anteriores
    const step = visibleCandles.length > 1 ? visibleCandles[1].timestamp - visibleCandles[0].timestamp : 60000;
    for (const [key, kind, prefix] of LEVELS) {
      if (!cfg.levels[key]) continue;
      for (const level of this._levels(kind, candles, visibleCandles, view.lastClosed)) {
        const startIndex = indexOf(level.start) >= 0 ? indexOf(level.start) : null;
        const x0 = priceContext.timeToX(level.start) - barWidth / 2;
        const x1 = priceContext.timeToX(level.end - step) + barWidth / 2;
        if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 < left || x0 > right) continue;
        const end = Math.min(right, x1);
        line(x0, end, level.high, 'rgba(33, 87, 243, 0.85)', 1, [6, 3]);
        line(x0, end, level.low, 'rgba(33, 87, 243, 0.85)', 1, [6, 3]);
        const labelX = Math.max(left + 2, x0 + 2);
        text(`${prefix}H ${priceText(level.high, digits)}`, labelX, y(level.high) - 2, '#2157F3', 9, false, 'left', 'bottom');
        text(`${prefix}L ${priceText(level.low, digits)}`, labelX, y(level.low) + 2, '#2157F3', 9, false, 'left', 'top');
        const names = { PD: 'del día anterior', PW: 'de la semana anterior', PM: 'del mes anterior' };
        if (startIndex !== null) {
          offer(`Máximo ${names[prefix]} (${prefix}H)`, level.high, startIndex, startIndex);
          offer(`Mínimo ${names[prefix]} (${prefix}L)`, level.low, startIndex, startIndex);
        }
      }
    }

    ctx.restore();
  }
}

export default SMCIndicator;
