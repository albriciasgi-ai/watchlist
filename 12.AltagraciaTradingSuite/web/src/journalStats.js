// Dashboard del journal (13/11/2026): los trades del bot en la forma que usan los widgets del dashboard de App 1, y
// riesgo y recompensa en dólares y en R. Sin React ni navegador: se prueba en Node (tests/journalStats.test.mjs).

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Precio para leer, con las cifras que hacen falta: de 0.0001 a 100,000 */
export const priceText = (p) => (Number.isFinite(p) ? `$${Number(p.toPrecision(8))}` : '–');

/** De dónde salió el trade: la alerta o el panel que lo abrió */
export const originOf = (t) => [t.origin, t.source].filter(Boolean).join(' · ') || 'sin origen';

/**
 * Cómo cerró, para la columna "Reason" de App 1: en el TP o en el SL si la salida quedó cerca (a una décima de la
 * distancia del SL inicial, o al menos 0.05% del precio), liquidación si Bybit la marca, y si no, "manual" (a mano,
 * por otra orden o desde otra app). Bybit no dice qué orden cerró la posición: es una lectura de los precios
 */
export function closeReason(t) {
  const last = t.closes?.[t.closes.length - 1];
  if (last?.exec_type === 'BustTrade') return 'Liquidación';
  const exit = num(t.exit);
  const entry = num(t.entry);
  const sl = num(t.initial_stop_loss);
  if (!(exit > 0)) return 'manual';
  const tolerance = Math.max(exit * 0.0005, entry > 0 && sl > 0 ? Math.abs(entry - sl) * 0.1 : 0);
  const near = (level) => num(level) > 0 && Math.abs(exit - num(level)) <= tolerance;
  if (near(t.take_profit) || near(t.initial_take_profit)) return 'take_profit';
  if (near(t.stop_loss) || near(t.initial_stop_loss)) return 'stop_loss';
  return 'manual';
}

/**
 * Los trades cerrados del journal, del más viejo al más nuevo, como los usan los widgets de App 1:
 * lado 'long' o 'short', P&L neto de Bybit, % = lo que se movió el precio a favor y R sobre el SL inicial (null sin SL)
 */
export function toDashboardTrades(trades) {
  return (trades || [])
    .filter(t => t.status === 'closed' && num(t.pnl) !== null)
    .sort((a, b) => (a.closed_at || 0) - (b.closed_at || 0))
    .map((t, i) => {
      const entry = num(t.entry);
      const exit = num(t.exit);
      const dir = t.side === 'Buy' ? 1 : -1;
      return {
        id: t.trade_id,
        tradeNumber: i + 1,
        symbol: t.symbol,
        origin: originOf(t),
        account: t.account || 'sin cuenta',
        side: t.side === 'Buy' ? 'long' : 'short',
        entryPrice: entry ?? NaN,
        exitPrice: exit ?? NaN,
        quantity: t.size,
        pnl: num(t.pnl),
        pnlPercent: entry > 0 && exit > 0 ? ((dir * (exit - entry)) / entry) * 100 : 0,
        r: num(t.r),
        entryTime: t.opened_at || t.closed_at,
        exitTime: t.closed_at,
        closeReason: closeReason(t),
        notes: (t.notes || []).map(n => n.text).filter(Boolean).join(' · '),
        // Para el Excel (journalExcel.js); los widgets no los usan
        openedAt: num(t.opened_at),
        closedQty: num(t.closed_qty),
        initialStopLoss: num(t.initial_stop_loss),
        initialTakeProfit: num(t.initial_take_profit),
        stopLoss: num(t.stop_loss),
        takeProfit: num(t.take_profit),
        leverage: num(t.leverage),
        risk: num(t.risk),
        durationMin: num(t.duration_min),
        mode: t.mode || null,
      };
    });
}

/**
 * Riesgo y recompensa, como las tarjetas de App 1 pero sin saldo inicial (es dinero real, con depósitos y retiros):
 * - la mayor caída del P&L acumulado desde su pico, y el R que se perdió en esa misma caída;
 * - la mayor racha de trades ganadores seguidos, y su R.
 * Un trade sin R (sin SL) cuenta 0 R.
 */
export function riskReward(trades) {
  let cum = 0;
  let cumR = 0;
  let peak = 0;
  let peakR = 0; // R acumulado en el pico del P&L
  let maxDrawdown = 0;
  let maxDrawdownR = 0;
  let run = 0;
  let runR = 0;
  let maxGrowth = 0;
  let maxGrowthR = 0;
  for (const t of trades) {
    const r = Number.isFinite(t.r) ? t.r : 0;
    cum += t.pnl;
    cumR += r;
    if (cum > peak) {
      peak = cum;
      peakR = cumR;
    }
    if (peak - cum > maxDrawdown) {
      maxDrawdown = peak - cum;
      maxDrawdownR = peakR - cumR;
    }
    if (t.pnl > 0) {
      run += t.pnl;
      runR += r;
      if (run > maxGrowth) {
        maxGrowth = run;
        maxGrowthR = runR;
      }
    } else {
      run = 0;
      runR = 0;
    }
  }
  return { maxDrawdown, maxDrawdownR, maxGrowth, maxGrowthR };
}

/** Lo que pueden elegir los filtros del dashboard: monedas, orígenes y cuentas de los trades cerrados */
export function filterOptions(trades) {
  const unique = (key) => [...new Set(trades.map(t => t[key]).filter(Boolean))].sort();
  return { symbols: unique('symbol'), origins: unique('origin'), accounts: unique('account') };
}

/** Pie de la curva de capital: P&L neto, R acumulado y cuántos trades no tienen R */
export function totals(trades) {
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const withR = trades.filter(t => Number.isFinite(t.r));
  return { pnl, r: withR.reduce((s, t) => s + t.r, 0), n: trades.length, withoutR: trades.length - withR.length };
}

/** Una firma de lo que dibujan los widgets: el journal se vuelve a leer cada 15 s y casi siempre trae lo mismo */
export const signature = (trades) => (trades || [])
  .filter(t => t.status === 'closed')
  .map(t => `${t.trade_id}:${t.pnl}:${t.closed_at}:${t.r}:${t.exit}:${(t.notes || []).length}:${t.stop_loss}:${t.take_profit}`)
  .join('|');
