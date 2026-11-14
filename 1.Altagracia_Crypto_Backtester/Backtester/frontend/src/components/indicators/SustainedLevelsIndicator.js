// SustainedLevelsIndicator.js - Niveles de liquidez sostenida (14/11/2026), para la pestaña "Mapa" de la suite.
// Pedido del usuario entre las ideas con el mapa y el ladder: como DOM Levels de ATAS, pero solo lo que esperó en el
// libro al menos N minutos, y diciendo cómo terminó cada nivel. App 1 no lo ofrece: no tiene libro grabado de sus fechas.
//
// - Datos: GET /api/book/levels/{simbolo} de la suite (book_levels.py), para lo que está a la vista; cada minuto otra vez.
// - Dibujo (detrás de las velas, encima del mapa): una línea por nivel en su precio, verde si es compra y roja si es
//   venta. Tenue desde que empezó hasta que se supo que era sostenido (N minutos después), y firme desde ahí. Al final:
//   ● consumido (el precio llegó y se negoció contra él), × retirado (se fue sin que el precio llegara), | sin dato.
//   Retiro cerca (14/11): retirado con el precio a media ATR o menos. Lleva una ✕ más grande y su etiqueta, y el
//   estado avisa el último de la última hora: lejos, retirarse es lo normal del libro; cerca, se parece a una carnada.
//   Los que siguen llevan su etiqueta en el borde derecho: USD promedio, cuánto lleva y los toques en que siguió.
import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { THEME } from '../uiTheme.js';
import { levelLabel, needsFetch, visibleLevels, nearLabel, lastNear, bigOnly } from '../sustainedLevels.js';

const FRAME_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
const REFRESH_MS = 60000;
const RETRY_MS = 15000;
const MAX_SPAN_MS = 3 * 86400000;   // lo que acepta el servidor (velas de 1 minuto del gráfico en vivo)

export const SUSTAINED_LEVELS_DEFAULTS = { minutes: 30, showEnded: true, cut: 0 };
export const SUSTAINED_LEVELS_MINUTES = [15, 30, 60, 120, 240];

export default class SustainedLevelsIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30, config = {}) {
    super(symbol, interval, days);
    this.name = 'Niveles sostenidos';
    this.height = 0;
    this.enabled = false;
    this.config = { ...SUSTAINED_LEVELS_DEFAULTS, ...config };
    this.levels = [];
    this.loaded = null;
    this.loading = false;
    this.error = null;
    this.lastError = 0;
    this.truncated = false;
    this.generation = 0;
    this.requestRedraw = null;
  }

  async fetchData() { return true; }   // pide lo que está a la vista, al dibujar

  hasData() { return this.levels.length > 0; }

  updateConfig(config = {}) {
    const before = this.config.minutes;
    this.config = { ...this.config, ...config };
    if (this.config.minutes !== before) {
      this.generation++;
      this.levels = [];
      this.loaded = null;
      this.loading = false;
    }
    this.requestRedraw?.();
  }

  dispose() {
    this.generation++;
    this.levels = [];
  }

  frameMs() { return FRAME_MS[this.interval] || FRAME_MS['15m']; }

  async _request(view) {
    const generation = this.generation;
    this.loading = true;
    const p = new URLSearchParams({ from_ms: String(Math.floor(view.from)), to_ms: String(Math.ceil(view.to)), minutes: String(this.config.minutes) });
    try {
      const r = await fetch(`${API_BASE_URL}/api/book/levels/${encodeURIComponent(this.symbol)}?${p}`);
      const d = await r.json();
      if (generation !== this.generation) return;
      if (!r.ok || !d.success) {
        this.error = d?.detail || `error ${r.status}`;
        this.lastError = Date.now();
        return;
      }
      this.error = null;
      this.levels = d.levels || [];
      this.truncated = !!d.truncated;
      this.loaded = { from: view.from, to: view.to, at: Date.now() };
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

  _sync(visibleCandles) {
    if (this.loading) return;
    const now = Date.now();
    if (this.error && now - this.lastError < RETRY_MS) return;
    const first = visibleCandles[0]?.timestamp;
    const last = visibleCandles[visibleCandles.length - 1]?.timestamp;
    if (!Number.isFinite(first) || !Number.isFinite(last)) return;
    const to = last + this.frameMs();
    const view = { from: Math.max(first, to - MAX_SPAN_MS), to };
    const want = needsFetch(this.loaded, view, now, REFRESH_MS);
    if (want) this._request(want);
  }

  renderBackground(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !priceContext || !visibleCandles?.length) return;
    if (priceContext.requestRedraw) this.requestRedraw = priceContext.requestRedraw;
    this._sync(visibleCandles);
    const { priceToY, timeToX, minPrice, maxPrice } = priceContext;
    if (!timeToX || !priceToY) return;
    const n = visibleCandles.length;
    const frame = this.frameMs();
    const from = visibleCandles[0].timestamp;
    const lastTs = visibleCandles[n - 1].timestamp;
    const x0 = timeToX(from);
    const x1 = timeToX(lastTs);
    const bar = n > 1 ? (x1 - x0) / (n - 1) : bounds.width / Math.max(1, n);
    const edge = (t) => {
      const x = timeToX(t);
      return x == null ? null : x - bar / 2;
    };
    const right = x1 + bar / 2;
    const list = bigOnly(visibleLevels(this.levels, from, lastTs + frame, minPrice, maxPrice, this.config.showEnded), this.config.cut);
    const now = Date.now();
    const font = THEME.font || 'Segoe UI, sans-serif';
    const halo = THEME.chartBg || '#FFFFFF';
    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
    const labels = [];
    const nearTags = [];
    for (const lv of list) {
      const y = Math.round(priceToY((lv.lo + lv.hi) / 2)) + 0.5;
      if (y < bounds.y || y > bounds.y + bounds.height) continue;
      const color = lv.side === 'b' ? (THEME.up || '#089981') : (THEME.down || '#F23645');
      const xs = Math.max(bounds.x, edge(lv.start) ?? bounds.x);
      const xk = Math.max(xs, edge(lv.known) ?? xs);
      const xe = lv.end == null ? right : Math.min(right, edge(lv.end) ?? right);
      if (xe < bounds.x || xs > bounds.x + bounds.width) continue;
      const active = lv.end == null;
      // antes de saberse sostenido: tenue y punteado
      if (xk > xs) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xs, y);
        ctx.lineTo(Math.min(xk, xe), y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (xe > xk) {
        // contorno del color del fondo: la línea se ve sobre el mapa en cualquier estilo
        ctx.strokeStyle = halo;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(xk, y);
        ctx.lineTo(xe, y);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.globalAlpha = active ? 1 : 0.75;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xk, y);
        ctx.lineTo(xe, y);
        ctx.stroke();
      }
      // cómo terminó
      ctx.globalAlpha = 1;
      if (!active && xe <= right) {
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(xe, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        if (lv.reason === 'consumido') {
          ctx.beginPath();
          ctx.arc(xe, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (lv.reason === 'retirado' && lv.near) {
          // retiro cerca: ✕ grande y su etiqueta
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(xe, y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(xe - 6, y - 6); ctx.lineTo(xe + 6, y + 6);
          ctx.moveTo(xe + 6, y - 6); ctx.lineTo(xe - 6, y + 6);
          ctx.stroke();
          nearTags.push({ x: xe, y, color, text: nearLabel(lv) });
        } else if (lv.reason === 'retirado') {
          ctx.beginPath();
          ctx.moveTo(xe - 3.5, y - 3.5); ctx.lineTo(xe + 3.5, y + 3.5);
          ctx.moveTo(xe + 3.5, y - 3.5); ctx.lineTo(xe - 3.5, y + 3.5);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(xe, y - 4); ctx.lineTo(xe, y + 4);
          ctx.stroke();
        }
      }
      if (active) labels.push({ y, color, text: levelLabel(lv, now) });
    }
    // etiquetas de los que siguen, en el borde derecho, sin taparse entre sí
    ctx.font = `600 10px ${font}`;
    ctx.textBaseline = 'middle';
    // retiros cerca: su etiqueta junto a la ✕
    for (const tg of nearTags) {
      const w = ctx.measureText(tg.text).width + 8;
      const x = Math.min(tg.x + 11, bounds.x + bounds.width - w - 2);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = halo;
      ctx.fillRect(x, tg.y - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tg.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, tg.y - 6.5, w - 1, 13);
      ctx.fillStyle = tg.color;
      ctx.textAlign = 'left';
      ctx.fillText(tg.text, x + 4, tg.y);
    }
    labels.sort((a, b) => a.y - b.y);
    let lastY = -Infinity;
    for (const l of labels) {
      const y = Math.max(l.y, lastY + 13);
      lastY = y;
      const w = ctx.measureText(l.text).width + 8;
      const x = Math.min(right, bounds.x + bounds.width) - w - 2;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = l.color;
      ctx.fillRect(x, y - 6, w, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.fillText(l.text, x + 4, y);
    }
    ctx.restore();
  }

  // Encima de todo: el estado, bajo el del mapa
  renderOverlay(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles?.length) return;
    let text = `Niveles sostenidos ≥ ${this.config.minutes} min · ● consumido  × retirado  ✕ retiro cerca`;
    const recent = lastNear(this.levels, Date.now());
    if (recent) text += ` · último retiro cerca: ${recent}`;
    if (this.error) text += ` · ${this.error}`;
    else if (this.loading && !this.loaded) text += ' · cargando…';
    else if (this.loaded && !this.levels.length) text += ' · ninguno a la vista';
    if (this.truncated) text += ' · solo los mayores';
    ctx.save();
    ctx.font = `12px ${THEME.font || 'Segoe UI, sans-serif'}`;
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = THEME.labelBg || 'rgba(255,255,255,0.85)';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bounds.x + 6, bounds.y + 27, w, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.textMuted || '#555';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bounds.x + 12, bounds.y + 36);
    ctx.restore();
  }
}
