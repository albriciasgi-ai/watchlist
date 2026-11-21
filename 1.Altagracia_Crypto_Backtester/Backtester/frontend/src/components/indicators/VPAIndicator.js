import IndicatorBase from './IndicatorBase.js';
import { candleItemId } from './analysisLevels.js';
import { VpaReader, VPA_CODES, VPA_NAME, describeVpa, loadVpaSettings, volumeWidthFactor, vpaBar } from './vpa.js';
import { alignY, crispWidth } from '../chartPixels.js';
import { THEME, isNewTheme } from '../uiTheme.js';

const STRONG = '#26A69A'; // Fuerza (alcista)
const WEAK = '#EF5350'; // Debilidad (bajista)
const METER_LIMIT = 3; // El panel llega a ±3
const GLYPH = { QA: '◆', QB: '▲', QF: '✕', QR: '↺', QT: 'T', QS: 'S', QC: 'C', QE: 'E' };

/**
 * Lector VPA (21/11/2026): panel con el medidor de fuerza y debilidad (la evidencia que suman las velas y se desvanece)
 * y, sobre el precio, los elementos del lector con su grado. Todo con velas cerradas (vpa.js): la vela en formación
 * no tiene barra ni marca. Al pasar el mouse por la columna de una vela del panel, "Incluir en el análisis" ofrece lo
 * que leyó en ella.
 */
class VPAIndicator extends IndicatorBase {
  constructor(symbol, interval, days) {
    super(symbol, interval, days);
    this.name = VPA_NAME;
    this.height = 90;
    this.enabled = false;
    this.config = loadVpaSettings(symbol);
    this.reader = null;
    this.known = 0;
    this.marks = [];
  }

  async fetchData() {
    return true;
  }

  updateConfig(config) {
    const paramsChanged = JSON.stringify(config.params || this.config.params) !== JSON.stringify(this.config.params);
    this.config = { ...this.config, ...config, show: { ...this.config.show, ...(config.show || {}) } };
    if (paramsChanged) this.reader = null;
  }

  /** Lleva el lector a las velas cerradas de candles (la última puede estar en formación) */
  update(candles) {
    if (!candles?.length) {
      this.known = 0;
      return;
    }
    const closed = candles[candles.length - 1].in_progress ? candles.length - 1 : candles.length;
    if (closed < 2) {
      this.known = 0;
      return;
    }
    const step = candles[1].timestamp - candles[0].timestamp;
    const last = Math.min(closed, this.reader?.length || 0) - 1;
    if (this.reader && (this.reader.tfMs !== step || (last >= 0 && this.reader.t[last] !== candles[last].timestamp))) this.reader = null;
    if (!this.reader) {
      this.reader = new VpaReader(step / 60000, this.config.params);
      this._index = new Map();
    }
    for (let i = this.reader.length; i < closed; i += 1) {
      this._index.set(candles[i].timestamp, i);
      this.reader.push(vpaBar(candles[i]));
    }
    this.known = closed;
  }

  /**
   * Ancho de cada vela a la vista según su volumen (opción «Velas con ancho por volumen»): una parte de su lugar, o null
   * para el ancho de siempre (la vela en formación, o sin volumen normal de su hora todavía). Solo velas cerradas
   */
  candleWidths(visibleCandles, knownCandles) {
    if (!this.enabled || !this.config.show.widthByVolume || !visibleCandles?.length) return null;
    this.update(knownCandles);
    if (!this.reader) return null;
    return visibleCandles.map(candle => {
      const i = this.indexOf(candle.timestamp);
      return i >= 0 ? volumeWidthFactor(this.reader.s.rv[i]) : null;
    });
  }

  indexOf(timestamp) {
    const i = this._index?.get(timestamp);
    return i !== undefined && i < this.known ? i : -1;
  }

  selectableLevels() {
    return this.marks;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    this.update(priceContext?.knownCandles || allCandles);
    this.marks = [];
    const { show } = this.config;
    if (!show.marks || !this.reader || !visibleCandles?.length || !priceContext?.priceToY || !priceContext.timeToX) return;
    const barWidth = bounds.width / visibleCandles.length;
    if (barWidth < this.config.minPx) return;
    const first = this.indexOf(visibleCandles[0].timestamp);
    const lastVisible = visibleCandles[visibleCandles.length - 1].timestamp;
    const size = Math.max(8, Math.min(13, barWidth * 0.9));
    ctx.save();
    ctx.font = `bold ${size}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    const stacked = new Map();
    const events = this.reader.events;
    // Los elementos van en orden de vela: se empieza por el primero a la vista
    let lo = 0, hi = events.length;
    const from = Math.max(0, first);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].index < from) lo = mid + 1; else hi = mid;
    }
    for (let k = lo; k < events.length; k += 1) {
      const e = events[k];
      if (e.index >= this.known) break;
      if (!show[e.code]) continue;
      if (e.t > lastVisible) break;
      const x = priceContext.timeToX(e.t);
      if (x === null || x === undefined) continue;
      const candle = { timestamp: e.t, high: this.reader.h[e.index], low: this.reader.l[e.index] };
      const below = e.dir > 0;
      const n = (stacked.get(`${e.index}:${below}`) || 0) + 1;
      stacked.set(`${e.index}:${below}`, n);
      const base = priceContext.priceToY(below ? candle.low : candle.high);
      const y = below ? base + 4 + n * (size + 1) : base - 4 - (n - 1) * (size + 1);
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, e.grade);
      ctx.fillStyle = e.dir > 0 ? STRONG : WEAK;
      ctx.textBaseline = below ? 'bottom' : 'alphabetic';
      ctx.fillText(GLYPH[e.code] || e.code, x, y);
      const kind = `${VPA_CODES[e.code]} ${e.dir > 0 ? 'alcista' : 'bajista'} (${Math.round(e.grade * 100)}%)`;
      this.marks.push({
        id: candleItemId(this.name, e.code, e.t, null, this.interval), source: this.name, kind,
        price: below ? candle.low : candle.high, time: e.t, mark: true, x, y: below ? y - size / 2 : y - size / 2, r: Math.max(7, size * 0.7)
      });
    }
    ctx.restore();
  }

  /** Lo que leyó en cada vela a la vista del panel, para "Incluir en el análisis" */
  panelReadings(candles) {
    const readings = new Map();
    if (!this.reader) return readings;
    for (const candle of candles) {
      const i = this.indexOf(candle.timestamp);
      if (i >= 0) readings.set(candle.timestamp, `Lector VPA: ${describeVpa(this.reader, i).join(' · ')}`);
    }
    return readings;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;
    const { x, y, width, height } = bounds;
    ctx.fillStyle = isNewTheme() ? THEME.chartBg : '#FFFFFF';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = THEME.dark ? THEME.grid : '#DDE2E7';
    ctx.lineWidth = crispWidth(1);
    ctx.beginPath();
    ctx.moveTo(x, alignY(y));
    ctx.lineTo(x + width, alignY(y));
    ctx.stroke();

    const top = y + 20;
    const half = (height - 24) / 2;
    const zero = top + half;
    const scale = half / METER_LIMIT;
    const barWidth = width / visibleCandles.length;
    const thr = this.config.params.meter;

    ctx.strokeStyle = THEME.dark ? THEME.grid : '#E5E9ED';
    ctx.setLineDash([3, 3]);
    for (const level of [thr, -thr]) {
      const lineY = alignY(zero - Math.max(-METER_LIMIT, Math.min(METER_LIMIT, level)) * scale);
      ctx.beginPath();
      ctx.moveTo(x, lineY);
      ctx.lineTo(x + width, lineY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = THEME.dark ? THEME.crosshair : '#B0BEC5';
    ctx.beginPath();
    ctx.moveTo(x, alignY(zero));
    ctx.lineTo(x + width, alignY(zero));
    ctx.stroke();

    let lastIndex = -1;
    if (this.reader && this.config.show.meter) {
      visibleCandles.forEach((candle, i) => {
        const index = this.indexOf(candle.timestamp);
        if (index < 0) return;
        lastIndex = index;
        const value = this.reader.s.meter[index];
        const shown = Math.max(-METER_LIMIT, Math.min(METER_LIMIT, value)) * scale;
        ctx.globalAlpha = Math.abs(value) >= thr ? 1 : 0.45;
        ctx.fillStyle = value >= 0 ? STRONG : WEAK;
        ctx.fillRect(x + i * barWidth + barWidth * 0.1, shown >= 0 ? zero - shown : zero, Math.max(barWidth * 0.8, 0.5), Math.abs(shown));
      });
      ctx.globalAlpha = 1;
    } else if (this.reader) {
      visibleCandles.forEach((candle) => {
        const index = this.indexOf(candle.timestamp);
        if (index >= 0) lastIndex = index;
      });
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = THEME.dark ? THEME.textMuted : '#666';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText('Lector VPA · fuerza y debilidad', x + 5, y + 15);
    if (lastIndex >= 0) {
      // Corto, para que quepa antes de los botones del panel: el detalle va en el cuadro de cada vela
      const value = this.reader.s.meter[lastIndex];
      const leg = this.reader.s.leg[lastIndex] > 0 ? 'alcista' : 'bajista';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = THEME.dark ? THEME.textFaint : '#888';
      ctx.fillText(`medidor ${value >= 0 ? '+' : ''}${value.toFixed(2)} (${value >= 0 ? 'fuerza' : 'debilidad'}) · tramo ${leg}`, x + 190, y + 15);
    }
  }
}

export default VPAIndicator;
