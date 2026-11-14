// zoneDefense.js - Cuentas del indicador "Defensa de zona" (14/11/2026), aparte del dibujo para probarlas
// (tests/zonedefense.test.mjs). Las visitas y el estado los calcula la suite (book_defense.py) con la regla de
// book_study: que hizo la liquidez de tus zonas dibujadas cuando el precio llego.
import { fmtUsd, fmtMinutes } from './sustainedLevels.js';

// Patrón de cada visita: letra del marcador, nombre y tono (bien = aguantó con la liquidez, medio = aguantó pero
// barrida o con retiro, mal = la cruzó)
export const PATTERNS = {
  defensa: { letter: 'D', name: 'defensa', tone: 'good' },
  absorcion: { letter: 'A', name: 'absorción', tone: 'good' },
  barrido: { letter: 'B', name: 'barrido', tone: 'mid' },
  retiro_y_rebote: { letter: 'R', name: 'retiro y rebote', tone: 'mid' },
  retiro_y_cruce: { letter: 'X', name: 'retiro y cruce', tone: 'bad' },
  consumida: { letter: 'C', name: 'consumida', tone: 'bad' },
};

/** Cómo se dibuja una visita: letra, nombre y tono. Sin patrón (sin libro o sin resolver), según el resultado. */
export function visitStyle(v) {
  const p = PATTERNS[v.pattern];
  if (p) return p;
  if (v.outcome === 'sin_resolver') return { letter: '…', name: 'en curso', tone: 'none' };
  if (v.outcome === 'aguanto') return { letter: '·', name: 'aguantó', tone: 'good' };
  return { letter: '·', name: 'la cruzó', tone: 'bad' };
}

/** Etiqueta de una visita: patrón, cuánto quedó al llegar, lo negociado y la antigüedad */
export function visitLabel(v) {
  const s = visitStyle(v);
  const parts = [s.name];
  if (v.kept_pct != null) parts.push(`quedó ${v.kept_pct}%`);
  if (v.traded_usd) parts.push(`negoc. ${fmtUsd(v.traded_usd)}`);
  if (v.aged_min != null) parts.push(`${fmtMinutes(v.aged_min)} de antigüedad`);
  return parts.join(' · ');
}

/** Etiqueta del estado de una zona cerca del precio, antes de que llegue */
export function statusLabel(st) {
  const side = st.side === 'b' ? 'compra' : 'venta';
  const parts = [`${side} ${st.usd != null ? fmtUsd(st.usd) : '—'}`];
  if (st.kept_pct != null && st.kept_pct >= 200) parts.push(`${(st.kept_pct / 100).toFixed(st.kept_pct >= 1000 ? 0 : 1)}× lo de hace 30 min`);
  else if (st.kept_pct != null) parts.push(`${st.kept_pct}% de hace 30 min`);
  else if (st.usd != null) parts.push('nueva de este lado');
  if (st.age_min != null) parts.push(`${fmtMinutes(st.age_min)} de antigüedad`);
  parts.push(`a ${st.dist_atr} ATR`);
  return parts.join(' · ');
}

/** La última visita de cada zona (por id), para ponerle etiqueta; las demás llevan solo su marcador */
export function lastVisits(visits) {
  const out = new Map();
  for (const v of visits || []) {
    const prev = out.get(v.id);
    if (!prev || v.at > prev.at) out.set(v.id, v);
  }
  return new Set(out.values());
}

/** Resumen de las visitas a la vista: cuántas aguantaron y cuántas por patrón */
export function summary(visits) {
  const done = (visits || []).filter(v => v.outcome === 'aguanto' || v.outcome === 'cruzo');
  const held = done.filter(v => v.outcome === 'aguanto').length;
  return { visits: done.length, held, pct: done.length ? Math.round((100 * held) / done.length) : null };
}
