// HyperliquidLiqIndicator.js - Liquidaciones Hyperliquid (21/11/2026), para el gráfico principal de la suite.
// Pedido del usuario: ver en el gráfico dónde se liquidarían las posiciones de las ballenas que la suite sigue en
// Hyperliquid (hl_recorder.py). Son liquidaciones que todavía no pasaron, no las ya ocurridas del indicador
// Liquidaciones: rosa los largos (debajo del precio), celeste los cortos (encima), como allá.
// - Las perSide franjas más cargadas de cada lado (de 0.5% del precio), con su USD, cuántas cuentas y a qué %.
// - Lo pide a /api/hyperliquid/liqmap cada minuto: la suite consulta cada minuto las cuentas con liquidaciones cerca y
//   todas cada 15 minutos.
// - Cada franja se puede elegir para el análisis del trade.
// App 1 no lo ofrece: no tiene datos de Hyperliquid de sus fechas.
import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import { THEME } from '../uiTheme.js';
import { HL_DEFAULTS, pickBands, bandLabel, bandAlpha, ageText } from '../hlLiquidations.js';

const REFRESH_MS = 60000;
const RETRY_MS = 20000;
const COLORS = { long: '#E91E63', short: '#00ACC1' };

function rgba(hex, a) {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

export default class HyperliquidLiqIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = 'Liquidaciones Hyperliquid';
    this.height = 0;
    this.enabled = false;
    this.config = { ...HL_DEFAULTS };
    this.data = null;
    this.loadedAt = 0;
    this.loading = false;
    this.error = null;
    this.lastError = 0;
    this.generation = 0;
    this.requestRedraw = null;
    this.shown = [];
  }

  async fetchData() { return true; }

  hasData() { return !!this.data?.buckets?.length; }

  dispose() {
    this.generation++;
    this.data = null;
  }

  async _request() {
    const generation = this.generation;
    this.loading = true;
    const p = new URLSearchParams({ bucket_pct: String(this.config.bucketPct), top: '0' });
    try {
      const r = await fetch(`${API_BASE_URL}/api/hyperliquid/liqmap/${encodeURIComponent(this.symbol)}?${p}`);
      const d = await r.json().catch(() => ({}));
      if (generation !== this.generation) return;
      if (!r.ok || !d.success) {
        this.error = r.status === 404 ? 'moneda que Hyperliquid no lista' : (d?.detail || `error ${r.status}`);
        this.lastError = Date.now();
        return;
      }
      this.error = null;
      this.data = d;
      this.loadedAt = Date.now();
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

  _sync() {
    if (this.loading) return;
    const now = Date.now();
    if (this.error && now - this.lastError < RETRY_MS) return;
    if (!this.error && this.loadedAt && now - this.loadedAt < REFRESH_MS) return;
    this._request();
  }

  selectableLevels() {
    return this.shown.map(({ band, top, bottom, left, right }) => {
      const kind = band.side === 'short' ? 'Liquidaciones de cortos (Hyperliquid)' : 'Liquidaciones de largos (Hyperliquid)';
      return {
        id: `Liquidaciones Hyperliquid|${band.side}|${band.lo.toPrecision(8)}`,
        source: 'Liquidaciones Hyperliquid',
        kind,
        price: (band.lo + band.hi) / 2,
        low: band.lo,
        high: band.hi,
        time: this.data?.t || Date.now(),
        left, right, top, bottom
      };
    });
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.shown = [];
    if (!this.enabled || !visibleCandles?.length || !priceContext) return;
    if (priceContext.requestRedraw) this.requestRedraw = priceContext.requestRedraw;
    this._sync();
    const font = THEME.font || 'Segoe UI, sans-serif';
    const { priceToY, timeToX } = priceContext;
    const d = this.data;
    const bands = d ? pickBands(d.buckets, d.price, this.config) : { above: [], below: [] };
    const all = [...bands.above, ...bands.below];

    ctx.save();
    // estado, bajo los de los otros indicadores de la suite
    let text = 'Liquidaciones Hyperliquid';
    if (this.error) text += ` · ${this.error}`;
    else if (!d) text += ' · cargando…';
    else if (!d.t) text += ' · la primera vuelta todavía no termina';
    else {
      text += ` · ${d.near} posiciones a menos de ${d.band_pct}% · ${ageText(d.t)}`;
      if (!all.length) text += ` · ninguna franja de ${Math.round(this.config.minUsd / 1000)}k o más`;
    }
    ctx.font = `12px ${font}`;
    const tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = THEME.labelBg || 'rgba(255,255,255,0.85)';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bounds.x + 6, bounds.y + 70, Math.min(tw, bounds.width - 12), 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.textMuted || '#555';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, bounds.x + 12, bounds.y + 79);
    if (!all.length || !priceToY) { ctx.restore(); return; }

    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();
    const n = visibleCandles.length;
    const x1 = timeToX ? timeToX(visibleCandles[n - 1].timestamp) : null;
    const right = Math.min(Number.isFinite(x1) ? x1 + 8 : bounds.x + bounds.width, bounds.x + bounds.width);
    const left = bounds.x;
    const maxUsd = Math.max(...all.map(b => b.usd));
    const halo = THEME.chartBg || '#FFFFFF';
    const offscreen = { above: 0, below: 0 };
    ctx.font = `600 10px ${font}`;
    for (const band of all) {
      const yTop = priceToY(band.hi);
      const yBot = priceToY(band.lo);
      if (yBot < bounds.y || yTop > bounds.y + bounds.height) {
        offscreen[band.side === 'short' ? 'above' : 'below'] += 1;
        continue;
      }
      const top = Math.max(bounds.y, yTop);
      const bottom = Math.min(bounds.y + bounds.height, Math.max(yBot, yTop + 2));
      const color = COLORS[band.side];
      ctx.fillStyle = rgba(color, bandAlpha(band.usd, maxUsd));
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = rgba(color, 0.7);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(left, Math.round(top) + 0.5);
      ctx.lineTo(right, Math.round(top) + 0.5);
      ctx.moveTo(left, Math.round(bottom) - 0.5);
      ctx.lineTo(right, Math.round(bottom) - 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = bandLabel(band);
      const w = ctx.measureText(label).width + 10;
      const lx = Math.max(left + 4, right - w - 6);
      const ly = (top + bottom) / 2;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = halo;
      ctx.fillRect(lx, ly - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.strokeRect(lx + 0.5, ly - 6.5, w - 1, 13);
      ctx.fillStyle = color;
      ctx.fillText(label, lx + 5, ly);
      this.shown.push({ band, top, bottom, left, right });
    }
    // Las que no caben en la vista: una nota en el borde de arriba o de abajo
    ctx.font = `11px ${font}`;
    for (const [where, count] of Object.entries(offscreen)) {
      if (!count) continue;
      const txt = where === 'above' ? `▲ ${count} franja${count > 1 ? 's' : ''} de cortos HL más arriba` : `▼ ${count} franja${count > 1 ? 's' : ''} de largos HL más abajo`;
      const w = ctx.measureText(txt).width + 10;
      const y = where === 'above' ? bounds.y + 96 : bounds.y + bounds.height - 12;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = halo;
      ctx.fillRect(right - w - 6, y - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS[where === 'above' ? 'short' : 'long'];
      ctx.fillText(txt, right - w - 1, y);
    }
    ctx.restore();
  }
}
