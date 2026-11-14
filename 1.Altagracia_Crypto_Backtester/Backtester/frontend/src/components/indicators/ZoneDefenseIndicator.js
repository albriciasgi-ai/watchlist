// ZoneDefenseIndicator.js - Defensa de zona (14/11/2026), para la pestaña "Mapa" de la suite.
// Pedido del usuario: saber si sus zonas se sostienen hasta que el precio vuelve. Usa sus líneas horizontales y
// rectángulos de la moneda, y la regla de book_study de la suite (book_defense.py, /api/book/defense).
// - En cada llegada del precio a una zona, un círculo con la letra del patrón en el borde por donde llegó:
//   D defensa, A absorción (verde: aguantó con la liquidez); B barrido, R retiro y rebote (ámbar: aguantó, pero
//   la perforó o se retiró la liquidez); X retiro y cruce, C consumida (rojo: la cruzó); … en curso.
// - La última visita de cada zona lleva su etiqueta: cuánto quedó al llegar, lo negociado y la antigüedad.
// - Las zonas a 2 ATR o menos del precio, antes de que llegue, dicen en el borde derecho lo que hay de su lado, contra
//   hace 30 minutos, y su antigüedad.
// App 1 no lo ofrece: no tiene libro grabado de sus fechas.
import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { THEME } from '../uiTheme.js';
import { visitStyle, visitLabel, statusLabel, lastVisits, summary } from '../zoneDefense.js';
import { needsFetch } from '../sustainedLevels.js';

const FRAME_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
const REFRESH_MS = 60000;
const RETRY_MS = 15000;
const MAX_SPAN_MS = 24 * 3600000;   // lo que acepta el servidor
const TONES = { good: '#16A34A', mid: '#D97706', bad: '#DC2626', none: '#6B7280' };

export default class ZoneDefenseIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = 'Defensa de zona';
    this.height = 0;
    this.enabled = false;
    this.data = null;
    this.loaded = null;
    this.loading = false;
    this.error = null;
    this.lastError = 0;
    this.generation = 0;
    this.requestRedraw = null;
    this.drawingsVersion = 0;
  }

  async fetchData() { return true; }

  hasData() { return !!this.data?.visits?.length; }

  // Los dibujos cambiaron: volver a pedir
  refresh() {
    this.loaded = null;
    this.requestRedraw?.();
  }

  dispose() {
    this.generation++;
    this.data = null;
  }

  frameMs() { return FRAME_MS[this.interval] || FRAME_MS['15m']; }

  async _request(view) {
    const generation = this.generation;
    this.loading = true;
    const p = new URLSearchParams({ from_ms: String(Math.floor(view.from)), to_ms: String(Math.ceil(view.to)) });
    try {
      const r = await fetch(`${API_BASE_URL}/api/book/defense/${encodeURIComponent(this.symbol)}?${p}`);
      const d = await r.json();
      if (generation !== this.generation) return;
      if (!r.ok || !d.success) {
        this.error = d?.detail || `error ${r.status}`;
        this.lastError = Date.now();
        return;
      }
      this.error = null;
      this.data = d;
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

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !visibleCandles?.length || !priceContext) return;
    if (priceContext.requestRedraw) this.requestRedraw = priceContext.requestRedraw;
    this._sync(visibleCandles);
    const font = THEME.font || 'Segoe UI, sans-serif';
    const { priceToY, timeToX } = priceContext;
    const d = this.data;
    ctx.save();
    // estado y leyenda, bajo los del mapa y los niveles
    const sum = summary(d?.visits);
    let text = 'Defensa de zona · D defensa  A absorción  B barrido  R retiro y rebote  X retiro y cruce  C consumida';
    if (sum.visits) text += ` · aguantaron ${sum.held} de ${sum.visits}`;
    if (this.error) text += ` · ${this.error}`;
    else if (this.loading && !this.loaded) text += ' · cargando…';
    else if (d?.note) text += ` · ${d.note}`;
    ctx.font = `12px ${font}`;
    const tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = THEME.labelBg || 'rgba(255,255,255,0.85)';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bounds.x + 6, bounds.y + 48, Math.min(tw, bounds.width - 12), 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.textMuted || '#555';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, bounds.x + 12, bounds.y + 57);
    if (!d || !timeToX || !priceToY) { ctx.restore(); return; }

    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
    const halo = THEME.chartBg || '#FFFFFF';
    const first = visibleCandles[0].timestamp;
    const lastTs = visibleCandles[visibleCandles.length - 1].timestamp + this.frameMs();
    const n = visibleCandles.length;
    const x0 = timeToX(visibleCandles[0].timestamp);
    const x1 = timeToX(visibleCandles[n - 1].timestamp);
    const bar = n > 1 ? (x1 - x0) / (n - 1) : bounds.width / Math.max(1, n);
    const right = Math.min(x1 + bar / 2, bounds.x + bounds.width);
    const labelled = lastVisits(d.visits);
    const tags = [];
    for (const v of d.visits || []) {
      if (v.at < first || v.at > lastTs) continue;
      const x = timeToX(v.at);   // ya ubica la hora dentro de su vela
      if (x == null) continue;
      const xx = x - bar / 2;
      const y = priceToY(v.side === 'b' ? v.hi : v.lo);
      if (y < bounds.y - 8 || y > bounds.y + bounds.height + 8) continue;
      const s = visitStyle(v);
      const color = TONES[s.tone];
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(xx, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(xx, y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 9px ${font}`;
      ctx.textAlign = 'center';
      ctx.fillText(s.letter, xx, y + 0.5);
      if (labelled.has(v)) tags.push({ x: xx, y: v.side === 'b' ? y + 14 : y - 14, away: v.side === 'b' ? 1 : -1, color, text: visitLabel(v) });
    }
    ctx.font = `600 10px ${font}`;
    ctx.textAlign = 'left';
    // estado de las zonas cerca del precio, en el borde derecho, a su precio (primero: las etiquetas de las visitas
    // se corren para no taparlo)
    const taken = [];
    let lastY = -Infinity;
    const sts = [...(d.status || [])].map(st => ({ st, y: priceToY((st.lo + st.hi) / 2) })).sort((a, b) => a.y - b.y);
    for (const { st, y: y0 } of sts) {
      if (y0 < bounds.y || y0 > bounds.y + bounds.height) continue;
      const y = Math.max(y0, lastY + 15);
      lastY = y;
      const txt = `zona ${st.label}: ${statusLabel(st)}`;
      const w = ctx.measureText(txt).width + 10;
      const x = right - w - 4;
      taken.push({ x, y: y - 7, w, h: 14 });
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = halo;
      ctx.fillRect(x, y - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = THEME.accent || '#2962FF';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - 6.5, w - 1, 13);
      ctx.fillStyle = THEME.text || '#1F2328';
      ctx.fillText(txt, x + 5, y);
    }
    const hits = (r) => taken.some(o => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
    for (const tg of tags) {
      const w = ctx.measureText(tg.text).width + 8;
      const x = Math.max(bounds.x + 2, Math.min(tg.x - w / 2, right - w - 2));
      let y = tg.y;
      for (let k = 0; k < 4 && hits({ x, y: y - 7, w, h: 14 }); k++) y += tg.away * 15;
      taken.push({ x, y: y - 7, w, h: 14 });
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = halo;
      ctx.fillRect(x, y - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = tg.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - 6.5, w - 1, 13);
      ctx.fillStyle = tg.color;
      ctx.fillText(tg.text, x + 4, y);
    }
    ctx.restore();
  }
}
