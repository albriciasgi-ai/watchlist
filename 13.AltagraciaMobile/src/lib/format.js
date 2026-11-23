// Numeros y cuentas de las pantallas (sin React: lo prueban las pruebas con node).
export const isLong = (side) => ['buy', 'long'].includes(String(side || '').toLowerCase());
export const sideName = (side) => (isLong(side) ? 'Long' : 'Short');

const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export function money(value, digits = 2) {
  const x = n(value);
  if (x === null) return '—';
  return `${x < 0 ? '−' : ''}${Math.abs(x).toLocaleString('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const signed = (value, digits = 2) => {
  const x = n(value);
  return x === null ? '—' : `${x > 0 ? '+' : ''}${money(x, digits)}`;
};

/** Precio con los decimales que hacen falta: 2 desde 100; en monedas baratas, hasta 6 cifras. */
export function price(value) {
  const x = n(value);
  if (x === null || x === 0) return '—';
  if (Math.abs(x) >= 100) return x.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(Number(x.toPrecision(6)));
}

export function when(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ago(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function duration(minutes) {
  const m = n(minutes);
  if (m === null) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}

/**
 * Lo que muestra la tarjeta de una posicion. El P&L es el de Bybit (precio marca). "Al TP" y "Al SL": cuanto debe
 * moverse el precio marca, en % del precio, para tocarlos (negativo: ya lo paso), como en el journal de la suite.
 */
export function positionView(p) {
  const long = isLong(p.side);
  const entry = n(p.entryPrice);
  const mark = n(p.markPrice);
  const size = n(p.size) || 0;
  const leverage = n(p.leverage);
  const pnl = n(p.unrealizedPnl);
  const sl = n(p.stopLoss) || null;
  const tp = n(p.takeProfit) || null;
  const dir = long ? 1 : -1;
  const move = entry && mark ? ((mark - entry) / entry) * dir * 100 : null;
  return {
    long, entry, mark, size, leverage, pnl, sl, tp,
    liq: n(p.liqPrice) || null,
    movePct: move,
    roiPct: move !== null && leverage ? move * leverage : null,
    toTpPct: tp && mark ? ((tp - mark) / mark) * dir * 100 : null,
    toSlPct: sl && mark ? ((mark - sl) / mark) * dir * 100 : null,
    // Lo que se perderia en el SL y se ganaria en el TP, sin comisiones
    riskAtSl: sl && entry ? (sl - entry) * dir * size : null,
    gainAtTp: tp && entry ? (tp - entry) * dir * size : null,
  };
}

/** Resumen de los trades cerrados: acierto, P&L neto y R promedio. */
export function tradeSummary(trades) {
  const closed = trades.filter(t => t.status === 'closed' && n(t.pnl) !== null);
  const wins = closed.filter(t => t.pnl > 0).length;
  const withR = closed.filter(t => n(t.r) !== null);
  return {
    closed: closed.length,
    open: trades.filter(t => t.status === 'open').length,
    winRate: closed.length ? (wins / closed.length) * 100 : null,
    pnl: closed.reduce((s, t) => s + t.pnl, 0),
    avgR: withR.length ? withR.reduce((s, t) => s + t.r, 0) / withR.length : null,
  };
}

export const IMAGE_NAMES = { decision: 'Decisión', open: 'Apertura', close: 'Cierre', after: '10 velas después', analysis: 'Análisis post-trade' };
