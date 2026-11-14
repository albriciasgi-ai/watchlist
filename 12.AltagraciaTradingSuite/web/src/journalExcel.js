// Excel del dashboard del journal (13/11/2026, pedido del usuario: "Exportar a Excel" en el dashboard, como App 1).
// Aquí van las hojas de datos, con los trades seleccionados en el dashboard:
// - "Trades": uno por fila, con números de verdad (se pueden sumar y filtrar en Excel);
// - "Resumen": lo mismo que muestran los widgets (Win Rate, Profit Factor, mayor caída y mejor racha) y los filtros;
// - "Por origen" y "Por moneda".
// Las imágenes de los gráficos las agrega el botón de App 1 (ExportExcelButton), como en App 1.
// Sin React ni navegador: se prueba en Node con exceljs (tests/journalExcel.test.mjs).
import { riskReward } from './journalStats.js';

const COLOMBIA_MS = 5 * 3600000; // Colombia: UTC−5, sin horario de verano
// Los colores del Excel de App 1: el archivo se lee sobre blanco, con cualquier estilo de la suite
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2196F3' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const GREEN = 'FF4CAF50';
const RED = 'FFEF5350';
const MONEY = '#,##0.00;-#,##0.00';
const RATIO = '0.00';
const PERCENT = '0.00%';
const WHEN = 'yyyy-mm-dd hh:mm';
const REASONS = { take_profit: 'TP', stop_loss: 'SL', manual: 'Manual' };

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Fecha de Excel con la hora de Colombia (Excel no guarda zona horaria: se ve la hora tal cual) */
export const colombiaDate = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms - COLOMBIA_MS) : null);

/** "45m", "2h 15m", "3d 4h" */
export function durationText(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  const total = Math.round(minutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Las cifras de un grupo de trades, con las reglas de los widgets de App 1: ganadora si su P&L es mayor que 0 (Win
 * Rate), y el Profit Factor del medidor es la ganancia promedio sobre la pérdida promedio (las de P&L ≤ 0). Además la
 * ganancia total sobre la pérdida total, que es el Profit Factor de costumbre. Sin pérdidas, los dos quedan en null
 * (el medidor muestra 5, su tope)
 */
export function groupStats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => !(t.pnl > 0));
  const sum = (list) => list.reduce((s, t) => s + t.pnl, 0);
  const withR = trades.filter(t => Number.isFinite(t.r));
  const totalR = withR.reduce((s, t) => s + t.r, 0);
  const won = sum(wins);
  const lost = Math.abs(sum(losses));
  const avgWin = wins.length ? won / wins.length : 0;
  const avgLoss = losses.length ? lost / losses.length : 0;
  const pnls = trades.map(t => t.pnl);
  return {
    n: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    pnl: sum(trades),
    r: totalR,
    withR: withR.length,
    avgR: withR.length ? totalR / withR.length : null,
    avgWin,
    avgLoss,
    ratio: avgLoss > 0 ? avgWin / avgLoss : null,
    grossRatio: lost > 0 ? won / lost : null,
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
  };
}

const TRADE_COLUMNS = [
  { header: '#', width: 6, value: t => t.tradeNumber },
  { header: 'Moneda', width: 12, value: t => t.symbol },
  { header: 'Lado', width: 8, value: t => (t.side === 'long' ? 'Long' : 'Short') },
  { header: 'Origen', width: 28, value: t => t.origin },
  { header: 'Cuenta', width: 18, value: t => t.account },
  { header: 'Modo', width: 8, value: t => (t.mode ? String(t.mode).toUpperCase() : '') },
  { header: 'Cantidad cerrada', width: 15, value: t => t.closedQty ?? num(t.quantity) },
  { header: 'Apalancamiento', width: 14, value: t => t.leverage },
  { header: 'Entrada', width: 12, value: t => t.entryPrice },
  { header: 'Salida promedio', width: 15, value: t => t.exitPrice },
  { header: 'SL inicial', width: 12, value: t => t.initialStopLoss },
  { header: 'TP inicial', width: 12, value: t => t.initialTakeProfit },
  { header: 'SL al cerrar', width: 12, value: t => t.stopLoss },
  { header: 'TP al cerrar', width: 12, value: t => t.takeProfit },
  { header: 'Riesgo del SL inicial ($)', width: 22, numFmt: MONEY, value: t => t.risk },
  { header: 'P&L neto ($)', width: 13, numFmt: MONEY, tone: t => t.pnl, value: t => t.pnl },
  { header: '% a favor', width: 11, numFmt: PERCENT, tone: t => t.pnl, value: t => (Number.isFinite(t.pnlPercent) ? t.pnlPercent / 100 : null) },
  { header: 'R', width: 8, numFmt: RATIO, tone: t => t.r, value: t => t.r },
  { header: 'Apertura (hora Colombia)', width: 22, numFmt: WHEN, value: t => colombiaDate(t.openedAt) },
  { header: 'Cierre (hora Colombia)', width: 22, numFmt: WHEN, value: t => colombiaDate(t.exitTime) },
  { header: 'Duración', width: 10, value: t => durationText(t.durationMin) },
  { header: 'Cómo cerró', width: 12, value: t => REASONS[t.closeReason] || t.closeReason || '' },
  { header: 'Notas', width: 60, value: t => t.notes || '' },
];

function header(sheet) {
  const row = sheet.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
}

const tone = (cell, value) => {
  if (Number.isFinite(value) && value !== 0) cell.font = { color: { argb: value > 0 ? GREEN : RED }, bold: true };
};
// Lo que no existe queda en una celda vacía: ni 0, ni "NaN", ni un texto vacío (Excel la cuenta como vacía al filtrar)
const clean = (v) => ((typeof v === 'number' && !Number.isFinite(v)) || v === '' ? null : v ?? null);

function tradesSheet(workbook, trades) {
  const sheet = workbook.addWorksheet('Trades', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  sheet.columns = TRADE_COLUMNS.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  header(sheet);
  for (const t of trades) {
    const row = sheet.addRow(TRADE_COLUMNS.map(c => clean(c.value(t))));
    TRADE_COLUMNS.forEach((c, i) => {
      if (c.tone) tone(row.getCell(i + 1), c.tone(t));
    });
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: TRADE_COLUMNS.length } };
  return sheet;
}

function summarySheet(workbook, trades, { filters = {}, days, total, exportedAt }) {
  const sheet = workbook.addWorksheet('Resumen');
  sheet.columns = [{ header: 'Concepto', key: 'label', width: 58 }, { header: 'Valor', key: 'value', width: 22 }];
  header(sheet);
  const s = groupStats(trades);
  const risk = riskReward(trades);
  const rows = [
    ['Exportado (hora Colombia)', colombiaDate(exportedAt), WHEN],
    ['Días del journal', days ?? null],
    ['Moneda', filters.symbol && filters.symbol !== 'all' ? filters.symbol : 'Todas'],
    ['Origen', filters.origin && filters.origin !== 'all' ? filters.origin : 'Todos'],
    ['Cuenta', filters.account && filters.account !== 'all' ? filters.account : 'Todas'],
    ['Trades exportados (los seleccionados en el dashboard)', s.n],
    ['Trades con estos filtros', total ?? s.n],
    [],
    ['Ganadoras (P&L mayor que 0)', s.wins],
    ['Perdedoras (P&L 0 o menos)', s.losses],
    ['Win Rate', s.winRate, PERCENT],
    ['P&L neto ($)', s.pnl, MONEY, true],
    ['R acumulado', s.r, RATIO, true],
    ['Trades con R (con SL inicial)', s.withR],
    ['R promedio', s.avgR, RATIO, true],
    ['Ganancia promedio ($)', s.avgWin, MONEY],
    ['Pérdida promedio ($)', s.avgLoss, MONEY],
    ['Profit Factor del dashboard (ganancia promedio ÷ pérdida promedio)', s.ratio ?? 'sin pérdidas', RATIO],
    ['Ganancia total ÷ pérdida total', s.grossRatio ?? 'sin pérdidas', RATIO],
    ['Mayor caída del P&L acumulado ($)', risk.maxDrawdown, MONEY],
    ['Mayor caída (R de esa caída)', risk.maxDrawdownR, RATIO],
    ['Mejor racha ganadora ($)', risk.maxGrowth, MONEY],
    ['Mejor racha ganadora (R de esa racha)', risk.maxGrowthR, RATIO],
    ['Mayor ganancia ($)', s.best, MONEY, true],
    ['Mayor pérdida ($)', s.worst, MONEY, true],
    [],
    ['P&L neto de comisiones, de Bybit. R: el resultado sobre lo que arriesgaba el SL inicial.'],
    ['"Cómo cerró" se deduce de los precios: Bybit no dice qué orden cerró la posición.'],
  ];
  for (const [label, value, numFmt, toned] of rows) {
    const row = sheet.addRow(label === undefined ? [] : [label, clean(value)]);
    if (numFmt && (typeof value === 'number' || value instanceof Date)) row.getCell(2).numFmt = numFmt;
    if (toned) tone(row.getCell(2), value);
  }
  return sheet;
}

const GROUP_COLUMNS = [
  { header: 'Trades', width: 9, value: s => s.n },
  { header: 'Ganadoras', width: 11, value: s => s.wins },
  { header: 'Win Rate', width: 10, numFmt: PERCENT, value: s => s.winRate },
  { header: 'P&L neto ($)', width: 13, numFmt: MONEY, tone: s => s.pnl, value: s => s.pnl },
  { header: 'R acumulado', width: 12, numFmt: RATIO, tone: s => s.r, value: s => s.r },
  { header: 'Con R', width: 8, value: s => s.withR },
  { header: 'R promedio', width: 11, numFmt: RATIO, tone: s => s.avgR, value: s => s.avgR },
  { header: 'Ganancia promedio ($)', width: 20, numFmt: MONEY, value: s => s.avgWin },
  { header: 'Pérdida promedio ($)', width: 19, numFmt: MONEY, value: s => s.avgLoss },
  { header: 'Profit Factor del dashboard', width: 24, numFmt: RATIO, value: s => s.ratio ?? 'sin pérdidas' },
];

/** Una fila por origen o por moneda, de más trades a menos */
function groupSheet(workbook, trades, name, key, title) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  sheet.columns = [{ header: title, key: 'g', width: 30 }, ...GROUP_COLUMNS.map((c, i) => ({ header: c.header, key: `c${i}`, width: c.width }))];
  header(sheet);
  const groups = new Map();
  for (const t of trades) {
    const k = t[key] || '—';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])));
  for (const [k, list] of ordered) {
    const s = groupStats(list);
    const row = sheet.addRow([k, ...GROUP_COLUMNS.map(c => clean(c.value(s)))]);
    GROUP_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 2);
      if (c.numFmt && typeof cell.value === 'number') cell.numFmt = c.numFmt;
      if (c.tone) tone(cell, c.tone(s));
    });
  }
  return sheet;
}

/**
 * Agrega al libro las hojas de datos del journal. `trades` son los del dashboard (toDashboardTrades), ya filtrados
 * y seleccionados; `total`, cuántos había con los filtros antes de quitar alguno de la selección
 */
export function addJournalSheets(workbook, { trades, filters, days, total, exportedAt = Date.now() }) {
  tradesSheet(workbook, trades);
  summarySheet(workbook, trades, { filters, days, total, exportedAt });
  groupSheet(workbook, trades, 'Por origen', 'origin', 'Origen');
  groupSheet(workbook, trades, 'Por moneda', 'symbol', 'Moneda');
  return workbook;
}

/** Nombre del archivo: journal_<moneda o "todas">_<fecha de Colombia>.xlsx */
export function journalFileName(filters = {}, exportedAt = Date.now()) {
  const day = new Date(exportedAt - COLOMBIA_MS).toISOString().slice(0, 10);
  const symbol = filters.symbol && filters.symbol !== 'all' ? filters.symbol : 'todas';
  return `journal_${symbol}_${day}.xlsx`.replace(/[^\w.-]+/g, '_');
}
