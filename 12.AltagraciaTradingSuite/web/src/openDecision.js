/**
 * Lo elegido para un trade que se acaba de abrir, para su imagen de apertura (13/11/2026), como en App 1: los niveles
 * de su decisión en el panel, que el journal le une por su orden de Bybit o por hora. Antes la imagen dibujaba la lista
 * del panel, que tras enviar la orden ya es la del trade siguiente.
 *
 * La decisión se guarda cuando el bot responde a la orden, y la posición puede verse antes: se pregunta varias veces.
 * Un trade sin decisión (de una alerta) no lleva nada elegido.
 */
export const OPEN_DECISION_TRIES = 4;
export const OPEN_DECISION_WAIT_MS = 2000;
const OPEN_WINDOW_MS = 10 * 60000; // la apertura que anotó el bot y la que vio la página, a lo sumo así de lejos
const SAME_ENTRY = 0.005;          // la misma entrada, con 0.5% de margen

/** El trade del journal del bot de esa posición: abierto, misma moneda y lado, abierto a esa hora y con esa entrada */
export function openTradeOf(trades, position, openedAt) {
  const entry = Number(position.entryPrice);
  return (trades || [])
    .filter(t => t.symbol === position.symbol && t.side === position.side && t.status === 'open' && t.opened_at && !t.pre_existing
      && Math.abs(t.opened_at - openedAt) < OPEN_WINDOW_MS
      && (!(entry > 0) || !(t.entry > 0) || Math.abs(t.entry - entry) / entry < SAME_ENTRY))
    .sort((a, b) => b.opened_at - a.opened_at)[0] || null;
}

/**
 * Los niveles elegidos para la posición que se acaba de abrir, o [] si no tiene decisión.
 * fetchTrades(symbol) devuelve los trades del journal (con su decisión unida); sleep(ms) espera entre intentos.
 */
export async function openDecisionLevels(position, openedAt, {
  fetchTrades, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  tries = OPEN_DECISION_TRIES, waitMs = OPEN_DECISION_WAIT_MS,
} = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (attempt) await sleep(waitMs);
    try {
      const trade = openTradeOf(await fetchTrades(position.symbol), position, openedAt);
      if (trade?.decision) return trade.decision.levels || [];
    } catch {
      // Sin el journal del bot no se sabe qué se eligió: se vuelve a preguntar
    }
  }
  return [];
}
