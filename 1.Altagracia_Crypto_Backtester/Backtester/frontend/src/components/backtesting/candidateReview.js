// Revisión de candidatos por sesiones (lógica pura de la ventana): la regla propone, quien opera decide a ciegas.
// El servidor guarda la sesión y nunca entrega nada posterior al candidato a la vista.

export const REVIEW_DAYS = 28;
export const ACTION_LABEL = { skip: 'No entro', rule: 'Como la regla', long: 'Largo propio', short: 'Corto propio', passed: 'Pasó con el trade abierto' };

/** Si la decisión tiene algo que dibujar: un trade, o la orden que se pidió y no se llenó (o aún no se sabe). */
export const hasBox = (d) => (Number.isFinite(d?.entry) && Number.isFinite(d?.stop)) || (Number.isFinite(d?.plan?.entry) && Number.isFinite(d?.plan?.stop));

/**
 * Cajas de las decisiones, para el gráfico. Un trade que sigue abierto llega hasta la hora a la vista. Una orden
 * sin llenar se dibuja como se pidió, desde su candidato hasta que venció: así se ve que el precio no llegó.
 */
export function reviewBoxes(decisions = [], now = null, tfMinutes = 15) {
  const step = tfMinutes * 60000;
  const orders = decisions.filter(d => !Number.isFinite(d.entry) && Number.isFinite(d.plan?.entry) && Number.isFinite(d.plan?.stop)).map(d => ({
    side: d.plan.dir > 0 ? 'long' : 'short', entry: d.plan.entry, stop: d.plan.stop, target: d.plan.target ?? d.plan.entry, start: d.time,
    end: Math.max(d.expired ?? now ?? d.time, d.time + step)
  }));
  return orders.concat(decisions.filter(d => Number.isFinite(d.entry) && Number.isFinite(d.stop)).map(d => ({
    side: d.dir > 0 ? 'long' : 'short', entry: d.entry, stop: d.stop, target: d.target ?? d.exit ?? d.entry, start: d.entry_t,
    end: Math.max(d.exit_t ?? now ?? d.entry_t, d.entry_t + step)
  })));
}

/**
 * La decisión que sale de una caja TP/SL dibujada: lado, entrada, stop y objetivo.
 * `mode` 'limit' (de fábrica): la entrada es la de la caja, como una orden limit que espera a que el precio vuelva;
 * si el mercado ya está mejor que ese precio, entra a mercado. 'market': entra en la apertura de la vela siguiente
 * (`open`), sea cual sea la entrada de la caja. El riesgo beneficio se mide desde la entrada que de verdad se usa.
 */
export function boxDecision(box, open, mode = 'limit') {
  if (!box || !Number.isFinite(box.slPrice) || !Number.isFinite(box.tpPrice)) return null;
  const side = box.tpPrice >= box.slPrice ? 1 : -1;
  const plan = { action: side > 0 ? 'long' : 'short', side, stop: box.slPrice, target: box.tpPrice, boxId: box.id, problem: null, limit: null };
  if (mode === 'limit' && Number.isFinite(box.entryPrice) && Number.isFinite(open) && (open - box.entryPrice) * side > 0) plan.limit = box.entryPrice;
  const entry = plan.limit ?? open;
  if (Number.isFinite(entry)) {
    if ((entry - box.slPrice) * side <= 0) plan.problem = 'El stop de la caja no queda detrás de la entrada';
    else if ((box.tpPrice - entry) * side <= 0) plan.problem = 'El objetivo de la caja no queda delante de la entrada';
    else plan.rr = Math.abs(box.tpPrice - entry) / Math.abs(entry - box.slPrice);
  }
  return plan;
}

/** Texto corto de un grupo del informe: "12 · 58.3% · +0.31 R (±0.40)". */
export function statText(stat, fmtR) {
  if (!stat || !stat.n) return '—';
  return `${stat.n} · ${stat.winRate}% · ${fmtR(stat.avgR, 2)} R${stat.margin != null ? ` (±${stat.margin.toFixed(2)})` : ''}`;
}

/** Lo que dice una diferencia con su margen. */
export function gapText(gap, fmtR) {
  if (!gap) return 'Todavía no hay decisiones suficientes de los dos lados para compararlos.';
  return `${fmtR(gap.r, 2)} R por trade (entre ${fmtR(gap.low, 2)} y ${fmtR(gap.high, 2)}). ${gap.clear ? 'El margen no incluye el cero.' : 'Todavía no se distingue de cero.'}`;
}
