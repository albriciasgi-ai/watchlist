// Pruebas del Excel del journal (src/journalExcel.js): se arma el libro con exceljs, se escribe y se vuelve a leer,
// como lo abriría Excel. Uso: node tests/journalExcel.test.mjs
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { addJournalSheets, colombiaDate, durationText, groupStats, journalFileName } from '../src/journalExcel.js';
import { riskReward, toDashboardTrades } from '../src/journalStats.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const HOUR = 3600000;
const T0 = Date.UTC(2026, 10, 13, 15, 0); // 10:00 en Colombia

// Trades como los da el journal del bot (trade_journal.py), con lo que el Excel necesita
const raw = (over = {}) => ({
  trade_id: 't1', symbol: 'BTCUSDT', side: 'Buy', size: 0.01, closed_qty: 0.01, entry: 100, exit: 110, pnl: 9.5, r: 1.9,
  risk: 5, leverage: 10, mode: 'demo', account: 'Demo', status: 'closed', opened_at: T0, closed_at: T0 + 2 * HOUR,
  duration_min: 120, origin: 'MANUAL', source: 'MANUAL_TRADE', initial_stop_loss: 95, initial_take_profit: 110,
  stop_loss: 95, take_profit: 110, closes: [], notes: [], ...over,
});

const SAMPLE = [
  raw({ trade_id: 'a', notes: [{ text: 'entré en el VAL' }, { text: 'salí en el TP' }] }),
  raw({ trade_id: 'b', symbol: 'ETHUSDT', side: 'Sell', entry: 200, exit: 204, pnl: -4.1, r: -1.03, risk: 4, closed_at: T0 + 5 * HOUR,
        duration_min: 300, initial_stop_loss: 204, initial_take_profit: 190, stop_loss: 204, take_profit: 190,
        origin: 'WATCHLIST', source: 'SWING_DETECTOR' }),
  // Sin SL inicial (sin R) y sin apertura anotada: cerrada antes de que el bot la viera
  raw({ trade_id: 'c', symbol: 'SOLUSDT', entry: 80, exit: 81, pnl: 0.8, r: null, risk: null, opened_at: null, pre_existing: true,
        duration_min: null, initial_stop_loss: null, initial_take_profit: null, stop_loss: null, take_profit: null,
        closed_at: T0 + 7 * HOUR, origin: 'sin apertura', source: null, mode: null }),
  raw({ trade_id: 'd', symbol: 'BTCUSDT', entry: 100, exit: 80, pnl: -20, r: -4, closed_at: T0 + 9 * HOUR, duration_min: 4000,
        closes: [{ exec_type: 'BustTrade' }] }),
];

async function roundTrip(trades, opts = {}) {
  const workbook = new ExcelJS.Workbook();
  addJournalSheets(workbook, { trades, filters: { symbol: 'all', origin: 'all', account: 'all' }, days: 30, total: trades.length,
    exportedAt: T0 + 10 * HOUR, ...opts });
  const buffer = await workbook.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  return back;
}

const rowValues = (sheet, n) => sheet.getRow(n).values.slice(1); // exceljs deja vacío el índice 0
const byHeader = (sheet) => {
  const head = rowValues(sheet, 1);
  return (n, name) => {
    const col = head.indexOf(name);
    assert.ok(col >= 0, `falta la columna ${name}`);
    return sheet.getRow(n).getCell(col + 1);
  };
};
const summaryValue = (sheet, label) => {
  for (let n = 2; n <= sheet.rowCount; n += 1) {
    if (sheet.getRow(n).getCell(1).value === label) return sheet.getRow(n).getCell(2);
  }
  throw new Error(`falta "${label}" en el resumen`);
};

test('las hojas de datos, en orden y con su encabezado', async () => {
  const book = await roundTrip(toDashboardTrades(SAMPLE));
  assert.deepEqual(book.worksheets.map(s => s.name), ['Trades', 'Resumen', 'Por origen', 'Por moneda']);
  const head = rowValues(book.getWorksheet('Trades'), 1);
  assert.equal(head[0], '#');
  assert.ok(head.includes('P&L neto ($)') && head.includes('R') && head.includes('SL inicial') && head.includes('Cómo cerró'));
  assert.equal(book.getWorksheet('Trades').getRow(1).font.bold, true);
});

test('una fila por trade, del más viejo al más nuevo, con números de verdad', async () => {
  const trades = toDashboardTrades(SAMPLE);
  const sheet = (await roundTrip(trades)).getWorksheet('Trades');
  assert.equal(sheet.rowCount, 1 + trades.length);
  const cell = byHeader(sheet);
  assert.deepEqual([2, 3, 4, 5].map(n => cell(n, 'Moneda').value), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BTCUSDT']);
  assert.equal(cell(2, 'P&L neto ($)').value, 9.5);
  assert.equal(cell(2, 'R').value, 1.9);
  assert.equal(cell(2, 'Entrada').value, 100);
  assert.equal(cell(2, 'SL inicial').value, 95);
  assert.equal(cell(2, 'Riesgo del SL inicial ($)').value, 5);
  assert.equal(cell(2, 'Cantidad cerrada').value, 0.01);
  assert.equal(cell(2, 'Apalancamiento').value, 10);
  assert.equal(cell(2, 'Modo').value, 'DEMO');
  assert.equal(cell(2, 'Lado').value, 'Long');
  assert.equal(cell(3, 'Lado').value, 'Short');
  assert.equal(cell(2, 'Origen').value, 'MANUAL · MANUAL_TRADE');
  assert.equal(cell(2, 'Notas').value, 'entré en el VAL · salí en el TP');
  assert.equal(cell(2, 'P&L neto ($)').numFmt, '#,##0.00;-#,##0.00');
});

test('% a favor como porcentaje de Excel: lo que se movió el precio a favor', async () => {
  const sheet = (await roundTrip(toDashboardTrades(SAMPLE))).getWorksheet('Trades');
  const cell = byHeader(sheet);
  assert.equal(cell(2, '% a favor').value.toFixed(6), '0.100000', 'long de 100 a 110: 10%');
  assert.equal(cell(3, '% a favor').value.toFixed(6), '-0.020000', 'short de 200 a 204: −2%');
  assert.equal(cell(2, '% a favor').numFmt, '0.00%');
});

test('horas de Colombia, duración y lo que no hay queda vacío', async () => {
  const sheet = (await roundTrip(toDashboardTrades(SAMPLE))).getWorksheet('Trades');
  const cell = byHeader(sheet);
  const opened = cell(2, 'Apertura (hora Colombia)');
  assert.ok(opened.value instanceof Date);
  assert.equal(opened.value.toISOString(), '2026-11-13T10:00:00.000Z', 'Excel muestra la hora tal cual: 10:00 de Colombia');
  assert.equal(cell(2, 'Cierre (hora Colombia)').value.toISOString(), '2026-11-13T12:00:00.000Z');
  assert.equal(opened.numFmt, 'yyyy-mm-dd hh:mm');
  assert.equal(cell(2, 'Duración').value, '2h 0m');
  assert.equal(cell(5, 'Duración').value, '2d 18h');
  // El SOL sin apertura ni SL: sin hora de apertura (no la del cierre), sin R, sin riesgo, sin duración y sin modo
  assert.equal(cell(4, 'Apertura (hora Colombia)').value, null);
  assert.equal(cell(4, 'R').value, null);
  assert.equal(cell(4, 'Riesgo del SL inicial ($)').value, null);
  assert.equal(cell(4, 'SL inicial').value, null);
  assert.equal(cell(4, 'Duración').value, null);
  assert.equal(cell(4, 'Modo').value, null);
});

test('cómo cerró: TP, SL, manual o liquidación, como la tabla del dashboard', async () => {
  const sheet = (await roundTrip(toDashboardTrades(SAMPLE))).getWorksheet('Trades');
  const cell = byHeader(sheet);
  assert.deepEqual([2, 3, 4, 5].map(n => cell(n, 'Cómo cerró').value), ['TP', 'SL', 'Manual', 'Liquidación']);
});

test('ganadoras en verde y perdedoras en rojo, como el Excel de App 1', async () => {
  const sheet = (await roundTrip(toDashboardTrades(SAMPLE))).getWorksheet('Trades');
  const cell = byHeader(sheet);
  assert.equal(cell(2, 'P&L neto ($)').font.color.argb, 'FF4CAF50');
  assert.equal(cell(3, 'P&L neto ($)').font.color.argb, 'FFEF5350');
  assert.equal(cell(3, 'R').font.color.argb, 'FFEF5350');
  // Sin tono queda la letra de siempre de Excel (color del tema), sin verde ni rojo
  const toned = (c) => ['FF4CAF50', 'FFEF5350'].includes(c.font?.color?.argb);
  assert.equal(toned(cell(4, 'R')), false, 'sin R: sin color');
  assert.equal(toned(cell(2, 'Entrada')), false, 'el color no pasa a otras columnas');
  assert.equal(toned(cell(2, 'Moneda')), false);
});

test('el resumen da lo mismo que los widgets del dashboard', async () => {
  const trades = toDashboardTrades(SAMPLE);
  const sheet = (await roundTrip(trades)).getWorksheet('Resumen');
  const value = (label) => summaryValue(sheet, label).value;
  assert.equal(value('Trades exportados (los seleccionados en el dashboard)'), 4);
  assert.equal(value('Ganadoras (P&L mayor que 0)'), 2);
  assert.equal(value('Perdedoras (P&L 0 o menos)'), 2);
  assert.equal(value('Win Rate'), 0.5);
  assert.equal(summaryValue(sheet, 'Win Rate').numFmt, '0.00%');
  assert.equal(value('P&L neto ($)').toFixed(2), '-13.80');
  assert.equal(value('R acumulado').toFixed(2), '-3.13');
  assert.equal(value('Trades con R (con SL inicial)'), 3);
  assert.equal(value('R promedio').toFixed(4), (-3.13 / 3).toFixed(4));
  // El medidor de App 1: ganancia promedio (9.5 + 0.8) / 2 sobre pérdida promedio (4.1 + 20) / 2
  assert.equal(value('Ganancia promedio ($)').toFixed(2), '5.15');
  assert.equal(value('Pérdida promedio ($)').toFixed(2), '12.05');
  assert.equal(value('Profit Factor del dashboard (ganancia promedio ÷ pérdida promedio)').toFixed(4), (5.15 / 12.05).toFixed(4));
  assert.equal(value('Ganancia total ÷ pérdida total').toFixed(4), (10.3 / 24.1).toFixed(4));
  const risk = riskReward(trades);
  assert.equal(value('Mayor caída del P&L acumulado ($)'), risk.maxDrawdown);
  assert.equal(value('Mayor caída (R de esa caída)'), risk.maxDrawdownR);
  assert.equal(value('Mejor racha ganadora ($)'), risk.maxGrowth);
  assert.equal(value('Mayor ganancia ($)'), 9.5);
  assert.equal(value('Mayor pérdida ($)'), -20);
  assert.equal(summaryValue(sheet, 'Mayor pérdida ($)').font.color.argb, 'FFEF5350');
  assert.equal(value('Exportado (hora Colombia)').toISOString(), '2026-11-13T20:00:00.000Z');
  assert.equal(summaryValue(sheet, 'Exportado (hora Colombia)').numFmt, 'yyyy-mm-dd hh:mm');
});

test('los filtros y la selección quedan dichos en el resumen', async () => {
  const trades = toDashboardTrades(SAMPLE).filter(t => t.symbol === 'BTCUSDT');
  const sheet = (await roundTrip(trades, { filters: { symbol: 'BTCUSDT', origin: 'all', account: 'Demo' }, total: 3, days: 90 }))
    .getWorksheet('Resumen');
  assert.equal(summaryValue(sheet, 'Moneda').value, 'BTCUSDT');
  assert.equal(summaryValue(sheet, 'Origen').value, 'Todos');
  assert.equal(summaryValue(sheet, 'Cuenta').value, 'Demo');
  assert.equal(summaryValue(sheet, 'Días del journal').value, 90);
  assert.equal(summaryValue(sheet, 'Trades exportados (los seleccionados en el dashboard)').value, 2);
  assert.equal(summaryValue(sheet, 'Trades con estos filtros').value, 3);
});

test('sin pérdidas, el Profit Factor lo dice en vez de un número', async () => {
  const trades = toDashboardTrades([raw({ trade_id: 'x' }), raw({ trade_id: 'y', closed_at: T0 + 3 * HOUR })]);
  const sheet = (await roundTrip(trades)).getWorksheet('Resumen');
  assert.equal(summaryValue(sheet, 'Profit Factor del dashboard (ganancia promedio ÷ pérdida promedio)').value, 'sin pérdidas');
  assert.equal(summaryValue(sheet, 'Ganancia total ÷ pérdida total').value, 'sin pérdidas');
  assert.equal(groupStats(trades).ratio, null);
});

test('por origen y por moneda: de más trades a menos, con sus cifras', async () => {
  const book = await roundTrip(toDashboardTrades(SAMPLE));
  const origin = book.getWorksheet('Por origen');
  assert.deepEqual(rowValues(origin, 1).slice(0, 4), ['Origen', 'Trades', 'Ganadoras', 'Win Rate']);
  assert.equal(origin.getRow(2).getCell(1).value, 'MANUAL · MANUAL_TRADE');
  assert.equal(origin.getRow(2).getCell(2).value, 2);
  const coin = book.getWorksheet('Por moneda');
  const rows = [2, 3, 4].map(n => rowValues(coin, n));
  assert.deepEqual(rows.map(r => r[0]), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const btc = rows[0];
  assert.equal(btc[1], 2);
  assert.equal(btc[2], 1);
  assert.equal(btc[3], 0.5);
  assert.equal(btc[4].toFixed(2), '-10.50');
  assert.equal(btc[5].toFixed(2), '-2.10');
  assert.equal(coin.getRow(2).getCell(5).font.color.argb, 'FFEF5350');
  assert.equal(rows[2][7], undefined, 'SOL sin R: R promedio vacío');
  assert.equal(rows[2][9], 0, 'SOL solo ganó: pérdida promedio 0');
  assert.equal(rows[2][10], 'sin pérdidas', 'y Profit Factor sin pérdidas');
});

test('nombre del archivo con el día de Colombia y la moneda filtrada', () => {
  const late = Date.UTC(2026, 10, 14, 3, 30); // 22:30 del 13/11 en Colombia
  assert.equal(journalFileName({ symbol: 'all' }, late), 'journal_todas_2026-11-13.xlsx');
  assert.equal(journalFileName({ symbol: 'BTCUSDT' }, late), 'journal_BTCUSDT_2026-11-13.xlsx');
  assert.equal(journalFileName({ symbol: 'A/B C' }, late), 'journal_A_B_C_2026-11-13.xlsx');
});

test('duración en texto y fechas de Colombia', () => {
  assert.equal(durationText(0.4), '0m');
  assert.equal(durationText(45), '45m');
  assert.equal(durationText(135), '2h 15m');
  assert.equal(durationText(1440), '1d 0h');
  assert.equal(durationText(null), '');
  assert.equal(colombiaDate(null), null);
  assert.equal(colombiaDate(Date.UTC(2026, 0, 1, 4, 0)).toISOString(), '2025-12-31T23:00:00.000Z');
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}: ${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
