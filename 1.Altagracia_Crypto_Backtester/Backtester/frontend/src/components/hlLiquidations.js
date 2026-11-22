// hlLiquidations.js - Cuentas del indicador "Liquidaciones Hyperliquid" (21/11/2026), aparte del dibujo para probarlas
// (tests/hlliquidations.test.mjs). El mapa lo arma la suite (hl_recorder.py, /api/hyperliquid/liqmap): de las ballenas
// seguidas en Hyperliquid, el USD que se liquidaría en cada franja de precio. Largos debajo del precio (se liquidan si
// baja) y cortos encima (si sube).
import { fmtUsd } from './sustainedLevels.js';

export const HL_DEFAULTS = { bucketPct: 0.5, perSide: 3, minUsd: 500000 };

/** Las franjas más cargadas de cada lado: { above: cortos, below: largos }, de la más cercana a la más lejana */
export function pickBands(buckets, price, opts = {}) {
  const { perSide, minUsd } = { ...HL_DEFAULTS, ...opts };
  const out = { above: [], below: [] };
  if (!Array.isArray(buckets) || !(price > 0)) return out;
  const longs = [];
  const shorts = [];
  for (const b of buckets) {
    const mid = (b.lo + b.hi) / 2;
    const distPct = (mid - price) / price * 100;
    if (b.short_usd >= minUsd && mid > price) shorts.push({ side: 'short', lo: b.lo, hi: b.hi, usd: b.short_usd, wallets: b.wallets, distPct });
    if (b.long_usd >= minUsd && mid < price) longs.push({ side: 'long', lo: b.lo, hi: b.hi, usd: b.long_usd, wallets: b.wallets, distPct });
  }
  const top = (list) => list.sort((a, b) => b.usd - a.usd).slice(0, perSide).sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
  out.above = top(shorts);
  out.below = top(longs);
  return out;
}

/** «HL cortos 30.9M · 3 cuentas · +2.4%» */
export function bandLabel(band) {
  const who = band.side === 'short' ? 'cortos' : 'largos';
  const sign = band.distPct >= 0 ? '+' : '−';
  const accounts = band.wallets === 1 ? '1 cuenta' : `${band.wallets} cuentas`;
  return `HL ${who} ${fmtUsd(band.usd)} · ${accounts} · ${sign}${Math.abs(band.distPct).toFixed(1)}%`;
}

/** Opacidad de la franja: más USD, más firme (de 0.12 a 0.45 contra la mayor a la vista) */
export function bandAlpha(usd, maxUsd) {
  if (!(maxUsd > 0)) return 0.12;
  return 0.12 + 0.33 * Math.min(1, Math.max(0, usd / maxUsd));
}

/** «hace 3m», «hace 1h05» desde una hora en ms */
export function ageText(t, now = Date.now()) {
  if (!t) return 'sin vuelta todavía';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 60) return `hace ${min}m`;
  return `hace ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
