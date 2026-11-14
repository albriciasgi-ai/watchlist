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
