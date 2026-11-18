// Revisión de candidatos por sesiones (lógica pura de la ventana): la regla propone, quien opera decide a ciegas.
// El servidor guarda la sesión y nunca entrega nada posterior al candidato a la vista.

export const REVIEW_DAYS = 28;
export const ACTION_LABEL = { skip: 'No entro', rule: 'Como la regla', long: 'Largo propio', short: 'Corto propio' };

/** Cajas de las decisiones tomadas, para el gráfico. Una que sigue abierta llega hasta la hora a la vista. */
export function reviewBoxes(decisions = [], now = null, tfMinutes = 15) {
  const step = tfMinutes * 60000;
  return decisions.filter(d => d.action !== 'skip' && Number.isFinite(d.entry) && Number.isFinite(d.stop)).map(d => ({
    side: d.dir > 0 ? 'long' : 'short', entry: d.entry, stop: d.stop, target: d.target ?? d.exit ?? d.entry, start: d.entry_t,
    end: Math.max(d.exit_t ?? now ?? d.entry_t, d.entry_t + step)
  }));
}

/**
 * La decisión que sale de una caja TP/SL dibujada: lado, stop y objetivo. La entrada es la apertura de la vela
 * siguiente, no la de la caja: por eso se revisa contra `entry` que el stop quede detrás y el objetivo delante.
 */
export function boxDecision(box, entry) {
  if (!box || !Number.isFinite(box.slPrice) || !Number.isFinite(box.tpPrice)) return null;
  const side = box.tpPrice >= box.slPrice ? 1 : -1;
  const plan = { action: side > 0 ? 'long' : 'short', side, stop: box.slPrice, target: box.tpPrice, boxId: box.id, problem: null };
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
