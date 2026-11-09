import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { candleItemId } from './analysisLevels.js';
import { alignY, crispWidth } from '../chartPixels.js';
import { THEME, isNewTheme } from '../uiTheme.js';
import {
  OF_ELEMENTS, bandEnd, cleanOFElementsConfig, defaultOFElementsConfig, emaSeries, eventKey, firstFrom,
  knownEvents, loadOFElementsSettings
} from './ofElements.js';

const MINUTES_BY_INTERVAL = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
const DAY_MS = 86400000;
const MAX_VIEW_DAYS = 60; // Con más días a la vista no se piden elementos
const MAX_PAD_MS = 3 * DAY_MS;
const BAND_DAYS = 3; // Franjas nacidas antes de la vista que pueden seguir vivas
const REQUEST_GAP_MS = 500;
const ERROR_WAIT_MS = 5000;
const MAX_EVENTS = 30000;
const TABLE_HEIGHT = 66;
const TABLE_ROWS = [['delta', 'Delta'], ['dv', 'Δ/Vol'], ['cum', 'Δ acum.']];
const MIN_GLYPH_PX = 4; // Con velas más angostas no caben los triángulos
const MIN_CODE_PX = 16; // Desde este ancho van los códigos bajo el triángulo
const MIN_TABLE_TEXT_PX = 30;
const SLOPE_ATR = 0.25; // Pendiente de la EMA, en ATR por 3 velas, para contar como impulso

function shortNumber(value, decimals = 1) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (abs >= 100) return Math.round(value).toString();
  return value.toFixed(decimals);
}

/**
 * Elementos de Orderflows Unlocked sobre las velas: franjas de zonas, celdas marcadas, contornos de
 * patrones de varias velas, un glifo por vela y la tabla de la vela en un panel. Los detecta el backend
 * con los trades reales y umbrales de los 30 días anteriores; aquí se cortan las franjas con las velas conocidas.
 */
class OrderFlowElementsIndicator extends IndicatorBase {
  constructor(symbol, interval, days) {
    super(symbol, interval, days);
    this.name = 'Elementos OF';
    this.enabled = false;
    this.height = TABLE_HEIGHT; // Solo con la tabla activa
    this.tfMinutes = MINUTES_BY_INTERVAL[interval] || parseInt(interval, 10) || 15;
    this.tfMs = this.tfMinutes * 60000;
    this.config = cleanOFElementsConfig({ ...defaultOFElementsConfig(), ...loadOFElementsSettings(symbol) });

    this.events = new Map(); // clave → evento
    this.bars = new Map(); // inicio de vela → delta, volumen, Δ/Vol y delta acumulado del día
    this.dvMarks = new Map(); // inicio de vela → lado del Delta/Volume extremo
    this.loaded = null; // { start, end }: lo pedido y conocido
    this.memos = new Map(); // clave de franja → hasta dónde se revisó
    this.clock = null;
    this.generation = 0;
    this.isLoading = false;
    this.nextRequestAt = 0;
    this.retryTimer = null;
    this.error = null;
    this.warming = false;
    this.tooWide = false;
    this.targets = [];
  }

  async fetchData() {
    return null; // Pide sola la ventana visible al dibujarse
  }

  getHeight() {
    return this.enabled && this.config.showTable ? this.height : 0;
  }

  updateConfig(config) {
    const before = [this.config.target, this.config.volFilter].join();
    this.config = cleanOFElementsConfig({ ...this.config, ...config, codes: { ...this.config.codes, ...(config.codes || {}) } });
    if ([this.config.target, this.config.volFilter].join() !== before) this._reset();
  }

  selectableLevels() {
    return this.targets;
  }

  destroy() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.generation += 1;
  }

  _reset() {
    this.events.clear();
    this.bars.clear();
    this.dvMarks.clear();
    this.memos.clear();
    this.loaded = null;
    this.generation += 1;
  }

  // ==================== DATOS ====================

  _load(visibleCandles, priceContext) {
    const { knownUntil, requestRedraw } = priceContext;
    if (!knownUntil) return;
    if (this.clock !== null && knownUntil < this.clock) this.memos.clear(); // Al retroceder se revisan de nuevo
    this.clock = knownUntil;

    const first = visibleCandles[0].timestamp;
    const last = visibleCandles[visibleCandles.length - 1].timestamp + this.tfMs;
    this.tooWide = last - first > MAX_VIEW_DAYS * DAY_MS;
    if (this.tooWide) return;

    const closedEnd = Math.floor(knownUntil / this.tfMs) * this.tfMs; // Fin de la última vela cerrada
    const wantedEnd = Math.min(last, closedEnd);
    const pad = Math.min(MAX_PAD_MS, Math.ceil(visibleCandles.length / 2) * this.tfMs);
    const loaded = this.loaded;

    if (!loaded || first < loaded.start || first > loaded.end) {
      this._request(first - pad, last + pad, knownUntil, BAND_DAYS, true, requestRedraw);
    } else if (loaded.end < wantedEnd) {
      // Avanzó la hora o la vista: solo lo nuevo. Cuatro velas atrás para la VA abandonada de la anterior
      this._request(loaded.end - 4 * this.tfMs, last + pad, knownUntil, 0, false, requestRedraw);
    }
  }

  _request(start, end, knownUntil, bandDays, replace, redraw) {
    if (this.isLoading) return; // Al terminar se redibuja y se vuelve a evaluar
    const wait = this.nextRequestAt - performance.now();
    if (wait > 0) {
      if (!this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          redraw?.();
        }, wait);
      }
      return;
    }
    this.isLoading = true;
    this.nextRequestAt = performance.now() + REQUEST_GAP_MS;
    const generation = this.generation;
    const params = new URLSearchParams({
      interval: String(this.tfMinutes),
      start_timestamp: String(Math.round(start)),
      end_timestamp: String(Math.round(end)),
      known_until: String(Math.round(knownUntil)),
      target: String(this.config.target / 100),
      vol_filter: String(this.config.volFilter),
      band_days: String(bandDays)
    });

    fetch(`${API_BASE_URL}/api/orderflow/elements/${this.symbol}?${params}`)
      .then(response => {
        if (!response.ok) throw new Error(`Error ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!data.success) throw new Error(data.message || 'Sin respuesta del almacén');
        if (generation === this.generation) this._store(data, start, Math.min(end, data.known_until), replace);
        this.error = null;
        this.isLoading = false;
        redraw?.();
      })
      .catch(error => {
        if (this.error !== error.message) console.error(`[${this.symbol}] Error cargando Elementos OF:`, error);
        this.error = error.message;
        this.isLoading = false;
        this.nextRequestAt = performance.now() + ERROR_WAIT_MS;
      });
  }

  _store(data, start, end, replace) {
    if (replace) {
      this.events.clear();
      this.bars.clear();
      this.dvMarks.clear();
      this.memos.clear();
      this.loaded = { start, end };
    } else {
      this.loaded = { start: this.loaded?.start ?? start, end: Math.max(this.loaded?.end ?? end, end) };
    }
    this.warming = !!data.warming;
    for (const event of data.events) {
      if (event.code === 'DV') this.dvMarks.set(event.t, event.dir);
      else this.events.set(eventKey(event), event);
    }
    for (const bar of data.bars) this.bars.set(bar.t, bar);
    if (this.events.size > MAX_EVENTS) this._reset();
  }

  // ==================== DIBUJO ====================

  _rgb(dir) {
    if (isNewTheme()) return dir > 0 ? THEME.upRgb : THEME.downRgb;
    return dir > 0 ? '38, 166, 154' : '239, 83, 80';
  }

  _font(size, weight = '') {
    return `${weight ? weight + ' ' : ''}${size}px ${isNewTheme() ? THEME.font : 'Inter, sans-serif'}`;
  }

  _target(event, geometry, extra = {}) {
    const info = OF_ELEMENTS[event.code];
    const side = event.dir > 0 ? 'alcista' : 'bajista';
    const kind = `${info.name} ${side}`;
    const id = candleItemId('Elementos OF', kind, event.t, event.lo, this.interval);
    const price = (event.lo + event.hi) / 2;
    this.targets.push({ id, source: 'Elementos OF', kind, price, time: event.t, low: event.lo, high: event.hi, ...geometry, ...extra });
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    this.targets = [];
    if (!this.enabled || !visibleCandles?.length || !priceContext?.priceToY || !priceContext.timeToX) return;
    this._load(visibleCandles, priceContext);

    const { priceToY, timeToX } = priceContext;
    const knownUntil = priceContext.knownUntil ?? Infinity;
    const known = priceContext.knownCandles || allCandles || visibleCandles;
    const width = bounds.width / visibleCandles.length;
    const firstT = visibleCandles[0].timestamp;
    const lastT = visibleCandles[visibleCandles.length - 1].timestamp;
    const left = (t) => {
      const x = timeToX(t);
      return x === null ? null : x - width / 2;
    };
    const right = bounds.x + bounds.width;

    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();

    if (this.config.showEMA) this._renderEMA(ctx, known, firstT, lastT, priceToY, timeToX);

    const events = knownEvents(Array.from(this.events.values()), knownUntil, this.config.codes);

    // Franjas: las más recientes que siguen vivas o terminan a la vista
    if (this.config.showBands) {
      const bands = [];
      for (const event of events) {
        if (OF_ELEMENTS[event.code].shape !== 'band' || event.t > lastT) continue;
        const key = eventKey(event);
        if (!this.memos.has(key)) this.memos.set(key, {});
        const end = bandEnd(event, known, this.memos.get(key));
        if (end !== null && end < firstT) continue;
        bands.push({ event, end });
      }
      bands.sort((a, b) => b.event.t - a.event.t);
      for (const { event, end } of bands.slice(0, this.config.maxBands)) {
        const x0 = left(event.t0) ?? bounds.x;
        const x1 = end === null ? right : (left(end) ?? right);
        if (x1 < bounds.x || x0 > right) continue;
        const top = priceToY(event.hi);
        const height = Math.max(2, priceToY(event.lo) - top);
        const rgb = this._rgb(event.dir);
        ctx.fillStyle = `rgba(${rgb}, ${this.config.bandOpacity})`;
        ctx.fillRect(x0, top, Math.max(1, x1 - x0), height);
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(0.9, this.config.bandOpacity * 3)})`;
        ctx.fillRect(x0, top, Math.max(1, Math.min(width, x1 - x0)), height); // La vela que la crea
        this._target(event, { left: x0, right: x1, top, bottom: top + height }, { live: end === null });
      }
    }

    const inView = events.filter(event => event.t >= firstT && event.t <= lastT);

    // Celdas marcadas y contornos
    for (const event of inView) {
      const shape = OF_ELEMENTS[event.code].shape;
      const rgb = this._rgb(event.dir);
      const top = priceToY(event.hi);
      const height = Math.max(2, priceToY(event.lo) - top);
      if (shape === 'mark') {
        const x0 = left(event.t);
        if (x0 === null) continue;
        ctx.fillStyle = `rgba(${rgb}, 0.35)`;
        ctx.fillRect(x0 + width * 0.08, top, width * 0.84, height);
        this._target(event, { left: x0, right: x0 + width, top, bottom: top + height });
      } else if (shape === 'box') {
        const x0 = left(event.t0);
        const x1 = left(event.t);
        if (x0 === null || x1 === null) continue;
        ctx.strokeStyle = `rgba(${rgb}, 0.85)`;
        ctx.lineWidth = crispWidth(1);
        ctx.strokeRect(x0 + 1, top - 2, x1 + width - x0 - 2, height + 4);
        this._target(event, { left: x0, right: x1 + width, top: top - 2, bottom: top + height + 2 });
      }
    }

    if (this.config.showGlyphs && width >= MIN_GLYPH_PX) this._renderGlyphs(ctx, inView, visibleCandles, priceToY, timeToX, width);
    this._renderNotice(ctx, bounds);
    ctx.restore();
  }

  _renderGlyphs(ctx, events, visibleCandles, priceToY, timeToX, width) {
    const byCandle = new Map();
    for (const event of events) {
      if (OF_ELEMENTS[event.code].shape === 'table') continue;
      const key = `${event.t}|${event.dir}`;
      if (!byCandle.has(key)) byCandle.set(key, { t: event.t, dir: event.dir, codes: [] });
      const item = byCandle.get(key);
      if (!item.codes.includes(event.code)) item.codes.push(event.code);
    }
    const size = Math.max(3, Math.min(6, width * 0.35));
    const showCodes = width >= MIN_CODE_PX;
    ctx.font = this._font(10, isNewTheme() ? '600' : 'bold');
    ctx.textAlign = 'center';
    for (const { t, dir, codes } of byCandle.values()) {
      const index = firstFrom(visibleCandles, t);
      const candle = visibleCandles[index];
      if (!candle || candle.timestamp !== t) continue;
      const x = timeToX(t);
      if (x === null) continue;
      const rgb = this._rgb(dir);
      const baseY = dir > 0 ? priceToY(candle.low) + 4 : priceToY(candle.high) - 4;
      const tip = dir > 0 ? baseY : baseY;
      const far = dir > 0 ? baseY + size * 1.6 : baseY - size * 1.6;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.beginPath();
      ctx.moveTo(x, tip);
      ctx.lineTo(x - size, far);
      ctx.lineTo(x + size, far);
      ctx.closePath();
      ctx.fill();
      if (showCodes) {
        ctx.textBaseline = dir > 0 ? 'top' : 'bottom';
        codes.forEach((code, k) => {
          const y = dir > 0 ? far + 2 + k * 11 : far - 2 - k * 11;
          ctx.fillText(code, x, y);
        });
      }
      const names = codes.map(code => OF_ELEMENTS[code].name).join(', ');
      const id = candleItemId('Elementos OF', `${names} ${dir > 0 ? 'alcista' : 'bajista'}`, t, null, this.interval);
      this.targets.push({
        id, source: 'Elementos OF', kind: `${names} ${dir > 0 ? '(alcista)' : '(bajista)'}`, mark: true,
        price: dir > 0 ? candle.low : candle.high, time: t, x, y: (tip + far) / 2, r: Math.max(6, size + 2)
      });
    }
  }

  _renderEMA(ctx, known, firstT, lastT, priceToY, timeToX) {
    if (!known?.length) return;
    const from = Math.max(0, firstFrom(known, firstT) - 80);
    const to = Math.min(known.length, firstFrom(known, lastT + 1));
    const slice = known.slice(from, to);
    if (slice.length < 2) return;
    const { ema, slope } = emaSeries(slice);
    ctx.lineWidth = crispWidth(1.5);
    for (let i = 1; i < slice.length; i++) {
      if (slice[i].timestamp < firstT) continue;
      const x0 = timeToX(slice[i - 1].timestamp);
      const x1 = timeToX(slice[i].timestamp);
      if (x0 === null || x1 === null) continue;
      const s = slope[i];
      ctx.strokeStyle = s >= SLOPE_ATR ? `rgb(${this._rgb(1)})` : s <= -SLOPE_ATR ? `rgb(${this._rgb(-1)})`
        : (isNewTheme() ? THEME.textMuted : '#9E9E9E');
      ctx.beginPath();
      ctx.moveTo(x0, priceToY(ema[i - 1]));
      ctx.lineTo(x1, priceToY(ema[i]));
      ctx.stroke();
    }
  }

  _renderNotice(ctx, bounds) {
    let text = null;
    if (this.error) text = 'Elementos OF: no se pudo leer el almacén de trades';
    else if (this.tooWide) text = `Elementos OF: acerca el zoom (hasta ${MAX_VIEW_DAYS} días a la vista)`;
    else if (this.warming) text = 'Elementos OF: menos de 30 días de historia, sin los elementos calibrados';
    if (!text) return;
    ctx.font = this._font(11);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isNewTheme() ? THEME.textMuted : '#9E9E9E';
    ctx.fillText(text, bounds.x + 8, bounds.y + 22);
  }

  /** Panel: la tabla de la vela, como la de las láminas */
  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !this.config.showTable || !visibleCandles?.length) return;
    const knownUntil = this.clock ?? Infinity;
    const width = bounds.width / visibleCandles.length;
    const titleH = 14;
    const rowH = (bounds.height - titleH) / TABLE_ROWS.length;
    const muted = isNewTheme() ? THEME.textMuted : '#9E9E9E';
    const text = isNewTheme() ? THEME.text : '#333333';

    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
    ctx.fillStyle = isNewTheme() ? THEME.chartBg : '#FFFFFF'; // Fondo propio del panel, también con Oscuro
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.strokeStyle = isNewTheme() ? THEME.grid : 'rgba(0,0,0,0.08)';
    ctx.lineWidth = crispWidth(1);
    TABLE_ROWS.forEach((_, row) => {
      const y = alignY(bounds.y + titleH + row * rowH, 1);
      ctx.beginPath();
      ctx.moveTo(bounds.x, y);
      ctx.lineTo(bounds.x + bounds.width, y);
      ctx.stroke();
    });

    const showText = width >= MIN_TABLE_TEXT_PX;
    ctx.font = this._font(10);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    visibleCandles.forEach((candle, i) => {
      if (candle.timestamp + this.tfMs > knownUntil) return;
      const bar = this.bars.get(candle.timestamp);
      if (!bar) return;
      const x = bounds.x + i * width;
      const dir = bar.delta >= 0 ? 1 : -1;
      const strength = Math.min(1, Math.abs(bar.dv) / 0.5);
      // Delta: tinte por la parte del volumen; Δ/Vol: color pleno si es extremo
      ctx.fillStyle = `rgba(${this._rgb(dir)}, ${0.08 + 0.3 * strength})`;
      ctx.fillRect(x + 0.5, bounds.y + titleH + 1, width - 1, rowH - 2);
      const mark = this.dvMarks.get(candle.timestamp);
      if (mark !== undefined) {
        ctx.fillStyle = `rgba(${this._rgb(mark)}, 0.75)`;
        ctx.fillRect(x + 0.5, bounds.y + titleH + rowH + 1, width - 1, rowH - 2);
      }
      ctx.fillStyle = `rgba(${this._rgb(bar.cum >= 0 ? 1 : -1)}, 0.12)`;
      ctx.fillRect(x + 0.5, bounds.y + titleH + 2 * rowH + 1, width - 1, rowH - 2);
      if (!showText) return;
      const values = {
        delta: (bar.delta >= 0 ? '+' : '') + shortNumber(bar.delta),
        dv: `${Math.round(bar.dv * 100)}%`,
        cum: (bar.cum >= 0 ? '+' : '') + shortNumber(bar.cum)
      };
      TABLE_ROWS.forEach(([key], row) => {
        ctx.fillStyle = key === 'dv' && mark !== undefined ? '#FFFFFF' : text;
        ctx.fillText(values[key], x + width / 2, bounds.y + titleH + row * rowH + rowH / 2);
      });
    });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = muted;
    ctx.font = this._font(10);
    ctx.fillText('Tabla de la vela', bounds.x + 6, bounds.y + 2);
    ctx.textBaseline = 'middle';
    TABLE_ROWS.forEach(([, label], row) => {
      ctx.fillText(label, bounds.x + 4, bounds.y + titleH + row * rowH + rowH / 2);
    });
    ctx.restore();
  }
}

export default OrderFlowElementsIndicator;
