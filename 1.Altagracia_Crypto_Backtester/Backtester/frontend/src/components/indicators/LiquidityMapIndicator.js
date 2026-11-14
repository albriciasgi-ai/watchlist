// LiquidityMapIndicator.js - Mapa de liquidez (13/11/2026): la liquidez que esperaba en el libro grabado por la suite,
// detras de las velas, por vela y por precio. Pedido del usuario: verlo en una pestana aparte de la suite ("Mapa"),
// sin mezclarlo con el grafico principal. App 1 no lo ofrece: no tiene libro grabado de sus fechas.
//
// - Datos: GET /api/book/heatmap/{simbolo} de la suite (book_heatmap.py), para lo que esta a la vista. Las filas se
//   piden con margen (el doble del rango a la vista) y una sola grilla de precios: solo se vuelve a pedir todo si la
//   vista sale de ella. Lo que falta se pide al desplazarse, y la ultima vela cada 30 s (TAIL_MS).
// - Modos: "toda" (el promedio de la vela) o "sostenida" (lo que estuvo los ultimos N minutos hasta su cierre).
// - Dibujo: una imagen con una columna por vela y una fila por precio (liquidityMap.js), estirada sin suavizar sobre el
//   area del precio, antes de las velas (renderBackground). Lo de poco valor queda transparente.
import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { THEME } from '../uiTheme.js';
import { LiquidityMapStore, visibleScale, buildImage } from '../liquidityMap.js';

const FRAME_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
const TAIL_MS = 30000;        // la ultima vela se vuelve a pedir cada 30 s
const REQUEST_GAP_MS = 400;   // tiempo minimo entre dos pedidos
const RETRY_MS = 15000;       // tras un error
const MAX_COLS = 1500;        // lo mismo que acepta el servidor

export const LIQUIDITY_MAP_DEFAULTS = { mode: 'sostenida', minutes: 30, opacity: 0.9 };
export const LIQUIDITY_MAP_MINUTES = [5, 15, 30, 60, 120, 240];

export default class LiquidityMapIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30, config = {}) {
    super(symbol, interval, days);
    this.name = 'Mapa de liquidez';
    this.height = 0;            // se dibuja sobre el precio: no tiene panel
    this.enabled = false;
    this.config = { ...LIQUIDITY_MAP_DEFAULTS, ...config };
    this.store = new LiquidityMapStore();
    this.loading = false;
    this.lastRequest = 0;
    this.lastTail = 0;
    this.lastError = 0;
    this.error = null;
    this.generation = 0;
    this.requestRedraw = null;
    this._canvas = null;
    this._imageKey = '';
  }

  async fetchData() { return true; }    // pide lo que esta a la vista, al dibujar

  hasData() { return this.store.columns.size > 0; }

  updateConfig(config = {}) {
    const before = `${this.config.mode}|${this.config.minutes}`;
    this.config = { ...this.config, ...config };
    if (`${this.config.mode}|${this.config.minutes}` !== before) {
      this.store.reset();
      this.generation++;
      this.loading = false;
      this.lastTail = 0;
    }
    this._imageKey = '';
    this.requestRedraw?.();
  }

  dispose() {
    this.generation++;
    this.store.reset();
    this._canvas = null;
  }

  frameMs() { return FRAME_MS[this.interval] || FRAME_MS['15m']; }

  _url(from, to, grid) {
    const p = new URLSearchParams({
      interval: this.interval, from_ms: String(Math.floor(from)), to_ms: String(Math.ceil(to)),
      mode: this.config.mode, minutes: String(this.config.minutes),
    });
    if (grid) {
      p.set('low', String(grid.low));
      p.set('high', String(grid.high));
      if (grid.step) p.set('step', String(grid.step));
    }
    return `${API_BASE_URL}/api/book/heatmap/${encodeURIComponent(this.symbol)}?${p}`;
  }

  async _request(from, to, grid, tail = false) {
    const generation = this.generation;
    this.loading = true;
    this.lastRequest = Date.now();
    try {
      const response = await fetch(this._url(from, to, grid));
      const data = await response.json();
      if (generation !== this.generation) return;     // cambio el modo mientras viajaba
      if (!response.ok || !data.success) {
        this.error = data?.detail || `error ${response.status}`;
        this.lastError = Date.now();
        return;
      }
      this.error = null;
      if (this.store.merge(data)) this._imageKey = '';
      if (tail) this.lastTail = Date.now();
    } catch {
      if (generation === this.generation) {
        this.error = 'sin respuesta del servidor';
        this.lastError = Date.now();
      }
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.requestRedraw?.();
      }
    }
  }

  // Decide que pedir con lo que esta a la vista: grilla nueva, velas que faltan o la ultima vela
  _sync(visibleCandles, priceContext) {
    const now = Date.now();
    if (this.loading || now - this.lastRequest < REQUEST_GAP_MS) return;
    if (this.error && now - this.lastError < RETRY_MS) return;
    const frame = this.frameMs();
    const times = visibleCandles.map(c => c.timestamp).filter(Number.isFinite);
    if (!times.length) return;
    const first = times[0];
    const last = times[times.length - 1];
    const { minPrice, maxPrice } = priceContext;
    if (!(maxPrice > minPrice)) return;
    if (!this.store.covers(minPrice, maxPrice)) {
      const span = maxPrice - minPrice;
      const from = Math.max(first, last - (MAX_COLS - 1) * frame);
      this._request(from, last + frame, { low: Math.max(minPrice - span / 2, minPrice * 0.5), high: maxPrice + span / 2 });
      return;
    }
    const [low, high] = this.store.priceRange();
    const grid = { low, high, step: this.store.step };
    const missing = this.store.missing(times);
    if (missing.length) {
      const a = missing[0];
      const b = Math.min(missing[missing.length - 1], a + (MAX_COLS - 1) * frame);
      this._request(a, b + frame, grid);
      return;
    }
    if (now - this.lastTail > TAIL_MS) this._request(last - frame, last + frame, grid, true);
  }

  // Antes de las velas: la imagen del mapa sobre el area del precio
  renderBackground(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !priceContext || !visibleCandles?.length) return;
    if (priceContext.requestRedraw) this.requestRedraw = priceContext.requestRedraw;
    this._sync(visibleCandles, priceContext);
    if (this.store.step == null || typeof document === 'undefined') return;
    const cols = visibleCandles.map(c => this.store.column(c.timestamp));
    if (!cols.some(Boolean)) return;
    const dark = !!THEME.dark;
    const scale = visibleScale(cols);
    const key = [visibleCandles[0].timestamp, visibleCandles.length, this.store.columns.size, this.store.lastMs, dark,
      this.config.opacity, scale?.lo, scale?.hi, this.store.row0, this.store.rows].join('|');
    if (key !== this._imageKey) {
      const img = buildImage(cols, this.store.rows, scale, dark, this.config.opacity);
      if (!this._canvas) this._canvas = document.createElement('canvas');
      this._canvas.width = img.width;
      this._canvas.height = img.height;
      this._canvas.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
      this._imageKey = key;
    }
    const { priceToY, timeToX } = priceContext;
    const n = visibleCandles.length;
    const x0 = timeToX ? timeToX(visibleCandles[0].timestamp) : null;
    const x1 = timeToX ? timeToX(visibleCandles[n - 1].timestamp) : null;
    const bar = n > 1 && x0 !== null && x1 !== null ? (x1 - x0) / (n - 1) : bounds.width / n;
    const left = x0 !== null ? x0 - bar / 2 : bounds.x;
    const top = priceToY((this.store.row0 + this.store.rows) * this.store.step);
    const bottom = priceToY(this.store.row0 * this.store.step);
    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._canvas, left, top, bar * n, bottom - top);
    ctx.restore();
  }

  // Encima de todo: solo el estado (modo, cargando, sin libro o error)
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !visibleCandles?.length) return;
    let text = this.config.mode === 'sostenida' ? `Mapa de liquidez · sostenida ${this.config.minutes} min` : 'Mapa de liquidez · toda';
    const any = visibleCandles.some(c => this.store.column(c.timestamp));
    if (this.error) text += ` · ${this.error}`;
    else if (!any && this.loading) text += ' · cargando…';
    else if (!any && this.store.coverage.size) text += ' · sin libro grabado en estas horas';
    ctx.save();
    ctx.font = `12px ${THEME.font || 'Segoe UI, sans-serif'}`;
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = THEME.labelBg || 'rgba(255,255,255,0.85)';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bounds.x + 6, bounds.y + 6, w, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.textMuted || '#555';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bounds.x + 12, bounds.y + 15);
    ctx.restore();
  }
}
