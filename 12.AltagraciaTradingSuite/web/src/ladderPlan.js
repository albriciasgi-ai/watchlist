// ladderPlan.js - Entrada, stop y objetivo elegidos en el ladder (14/11/2026), y la caja TP/SL que los dibuja.
// Pedido del usuario: escoger en el ladder el stop y el objetivo, y que la app redibuje la caja TP/SL con esos valores.
// El panel de trading usa la caja tocada más recientemente: así la orden sale con entrada, stop y objetivo del ladder,
// y se confirma como siempre. Lógica pura, probada en tests/ladderplan.test.mjs.

export const PLAN_MODES = ['entry', 'sl', 'tp'];
export const PLAN_NAMES = { entry: 'Entrada', sl: 'Stop', tp: 'Objetivo' };
export const BOX_SPAN_MS = 2 * 3600000;    // ancho de la caja en el gráfico: 2 horas desde la hora de la entrada

export const emptyPlan = () => ({ side: null, entry: null, sl: null, tp: null });

/** El plan tiene todo para dibujar la caja: entrada, stop y objetivo del lado correcto */
export function planReady(plan) {
  const { side, entry, sl, tp } = plan || {};
  if (!(entry > 0 && sl > 0 && tp > 0)) return false;
  return side === 'long' ? sl < entry && entry < tp : side === 'short' ? tp < entry && entry < sl : false;
}

/**
 * Un clic en el ladder con el modo elegido. side: el que daría ese clic como entrada (pickSide). Devuelve el plan nuevo,
 * el modo siguiente (entrada → stop → objetivo → entrada) y un error si el precio no sirve para ese papel.
 */
export function planClick(plan, mode, price, side) {
  const p = { ...(plan || emptyPlan()) };
  if (mode === 'entry') {
    if (!side) return { plan: p, mode, error: 'Ese precio está entre la mejor compra y la mejor venta: elige Compra o Venta' };
    const changedSide = p.side && p.side !== side;
    p.side = side;
    p.entry = price;
    if (changedSide) { p.sl = null; p.tp = null; }   // otro lado: el stop y el objetivo de antes ya no sirven
    if (p.sl && !(side === 'long' ? p.sl < price : p.sl > price)) p.sl = null;
    if (p.tp && !(side === 'long' ? p.tp > price : p.tp < price)) p.tp = null;
    return { plan: p, mode: p.sl ? (p.tp ? 'entry' : 'tp') : 'sl', error: null };
  }
  if (!p.entry) return { plan: p, mode: 'entry', error: 'Primero la entrada' };
  const below = price < p.entry;
  if (mode === 'sl') {
    if (p.side === 'long' ? !below : below || price === p.entry) {
      return { plan: p, mode, error: p.side === 'long' ? 'El stop de una compra va debajo de la entrada' : 'El stop de una venta va encima de la entrada' };
    }
    p.sl = price;
    return { plan: p, mode: p.tp ? 'entry' : 'tp', error: null };
  }
  if (p.side === 'long' ? below || price === p.entry : !below) {
    return { plan: p, mode, error: p.side === 'long' ? 'El objetivo de una compra va encima de la entrada' : 'El objetivo de una venta va debajo de la entrada' };
  }
  p.tp = price;
  return { plan: p, mode: 'entry', error: null };
}

/** La caja TP/SL del plan, con el formato de App 1 (TPSLBox.serialize). Una por moneda: id fijo, se reemplaza. */
export function planBox(plan, symbol, now = Date.now()) {
  if (!planReady(plan)) return null;
  const start = now - (now % 60000);
  return { type: 'tpsl', id: `tpsl_ladder_${symbol}`, entryPrice: plan.entry, tpPrice: plan.tp, slPrice: plan.sl,
    time: start, timeStart: start, timeEnd: start + BOX_SPAN_MS, direction: plan.side, createdAt: null };
}

/** Los dibujos con la caja del ladder puesta (reemplaza la anterior del ladder; no toca las demás) */
export function withBox(shapes, box) {
  const list = (shapes || []).filter(s => s && s.id !== box.id);
  return [...list, box];
}

/** Riesgo / beneficio del plan: "R/R 1:2.3 · stop 0.45% · objetivo 1.04%" */
export function planSummary(plan) {
  if (!planReady(plan)) return null;
  const risk = Math.abs(plan.entry - plan.sl);
  const reward = Math.abs(plan.tp - plan.entry);
  const pct = (v) => `${((100 * v) / plan.entry).toFixed(2)}%`;
  return `R/R 1:${(reward / risk).toFixed(2)} · stop ${pct(risk)} · objetivo ${pct(reward)}`;
}
