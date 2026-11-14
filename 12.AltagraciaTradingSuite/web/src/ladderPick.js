// ladderPick.js - El precio elegido en el ladder viaja al panel de trading (14/11/2026).
// Pedido del usuario: el ladder para ejecutar. El ladder vive en la pestaña "Mapa" (otra pestaña u otra ventana de
// Electron) y el panel de trading en el gráfico: el precio va por localStorage (el evento "storage" llega a las otras
// pestañas) y por un evento de la misma ventana. El panel solo prepara la Limit: enviarla sigue pidiendo la
// confirmación de siempre. Un precio de hace más de PICK_TTL_MS ya no se aplica (por ejemplo al abrir el panel después).

export const PICK_KEY = 'suite_ladder_pick';
export const PICK_EVENT = 'suite-ladder-pick';
export const PICK_TTL_MS = 30000;

/** Lo que se manda: { symbol, price, side: 'long' | 'short', at }, y kind: 'box' cuando el ladder dibujó la caja TP/SL */
export function makePick(symbol, price, side, at = Date.now()) {
  if (!symbol || !(price > 0) || (side !== 'long' && side !== 'short')) return null;
  return { symbol, price, side, at };
}

/** Un precio recibido sirve si tiene la forma y no venció */
export function freshPick(pick, now = Date.now()) {
  if (!pick || typeof pick !== 'object') return null;
  const ok = typeof pick.symbol === 'string' && pick.price > 0 && (pick.side === 'long' || pick.side === 'short')
    && Number.isFinite(pick.at) && now - pick.at <= PICK_TTL_MS && pick.at <= now + 5000;
  return ok ? pick : null;
}

export function sendPick(pick) {
  if (!pick) return;
  try { localStorage.setItem(PICK_KEY, JSON.stringify(pick)); } catch { /* sin almacenamiento: solo esta ventana */ }
  try { window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: pick })); } catch { /* sin ventana (pruebas) */ }
}

export function readPick() {
  try { return freshPick(JSON.parse(localStorage.getItem(PICK_KEY))); } catch { return null; }
}

/** Escucha los precios del ladder (de esta ventana y de las otras). Devuelve cómo dejar de escuchar. */
export function onPick(fn) {
  const onStorage = (e) => {
    if (e.key !== PICK_KEY || !e.newValue) return;
    try { const p = freshPick(JSON.parse(e.newValue)); if (p) fn(p); } catch { /* ilegible */ }
  };
  const onLocal = (e) => { const p = freshPick(e.detail); if (p) fn(p); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(PICK_EVENT, onLocal);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PICK_EVENT, onLocal);
  };
}
