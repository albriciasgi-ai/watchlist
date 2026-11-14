// sustainedLevels.js - Cuentas del indicador "Niveles sostenidos" (14/11/2026), aparte del dibujo para probarlas
// (tests/sustainedlevels.test.mjs). Los niveles los calcula la suite (book_levels.py) con el libro grabado.

/** USD corto: 950, 12k, 3.4M */
export function fmtUsd(v) {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(a)}`;
}

/** Duración corta: 45m, 2h, 3h10 */
export function fmtMinutes(m) {
  if (!(m > 0)) return '0m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`;
}

/** Texto de cómo terminó un nivel */
export const REASONS = {
  activo: 'sigue',
  consumido: 'consumido',
  retirado: 'retirado',
  sin_dato: 'sin dato',
  sin_precio: 'terminó',
};

/** Etiqueta de un nivel: USD promedio, cuánto duró (o lleva), toques en que siguió y cómo terminó */
export function levelLabel(lv, now = Date.now()) {
  const minutes = lv.end == null ? Math.max(lv.minutes || 0, (now - lv.start) / 60000) : lv.minutes;
  const parts = [fmtUsd(lv.usd), fmtMinutes(minutes)];
  if (lv.touches > 0) parts.push(`${lv.touches} toque${lv.touches > 1 ? 's' : ''}`);
  if (lv.end != null) parts.push(REASONS[lv.reason] || lv.reason);
  return parts.join(' · ');
}

/**
 * Qué falta pedir para lo que está a la vista: null si lo cargado lo cubre y no venció.
 * loaded: { from, to, at } de lo último pedido; view: { from, to }.
 */
export function needsFetch(loaded, view, now, maxAgeMs = 60000) {
  if (!view || !(view.to > view.from)) return null;
  if (!loaded) return view;
  const covers = loaded.from <= view.from && loaded.to >= view.to;
  if (covers && now - loaded.at < maxAgeMs) return null;
  return view;
}

/** Niveles a dibujar con lo que está a la vista: los que tocan [from, to] y caen en el rango de precios. */
export function visibleLevels(levels, from, to, minPrice, maxPrice, showEnded = true) {
  return (levels || []).filter(lv => lv.start <= to && (lv.end == null || lv.end >= from)
    && lv.hi >= minPrice && lv.lo <= maxPrice && (showEnded || lv.end == null));
}

/** Etiqueta de un retiro cerca: a cuánto del precio se fue (en ATR de 15m, o en % sin ATR) */
export function nearLabel(lv) {
  const d = lv.dist_atr != null ? `${lv.dist_atr} ATR` : lv.dist_pct != null ? `${lv.dist_pct}%` : '';
  return `retiro cerca${d ? ` · ${d}` : ''} · ${fmtUsd(lv.usd)}`;
}

/** El último retiro cerca de la última hora (o maxAgeMs): "compra 65,500 hace 3 min", o null */
export function lastNear(levels, now, maxAgeMs = 3600000) {
  let best = null;
  for (const lv of levels || []) {
    if (lv.reason !== 'retirado' || !lv.near || lv.end == null || now - lv.end > maxAgeMs || lv.end > now) continue;
    if (!best || lv.end > best.end) best = lv;
  }
  if (!best) return null;
  const price = Number(((best.lo + best.hi) / 2).toPrecision(8)).toLocaleString('en-US');
  return `${best.side === 'b' ? 'compra' : 'venta'} ${price} hace ${fmtMinutes((now - best.end) / 60000)}`;
}

/** Filtro "solo lo grande" (14/11): con cut de 1 a 100, deja los niveles con USD en ese percentil o más (de los dados) */
export function bigOnly(levels, cut) {
  const c = Math.max(0, Math.min(100, Number(cut) || 0));
  if (!c || !levels?.length) return levels || [];
  const usd = levels.map(lv => lv.usd || 0).sort((a, b) => a - b);
  const th = usd[Math.min(usd.length - 1, Math.floor((usd.length - 1) * c / 100))];
  return levels.filter(lv => (lv.usd || 0) >= th);
}
