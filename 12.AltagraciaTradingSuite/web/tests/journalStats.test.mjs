// Pruebas del dashboard del journal (src/journalStats.js): los trades del bot en la forma de los widgets de App 1,
// cómo cerró cada uno y riesgo y recompensa en dólares y en R. Uso: node tests/journalStats.test.mjs
import assert from 'node:assert/strict';
import { closeReason, filterOptions, priceText, riskReward, signature, toDashboardTrades, totals } from '../src/journalStats.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const HOUR = 3600000;
const T0 = Date.UTC(2026, 10, 1);

const trade = (over = {}) => ({
  trade_id: 't1', symbol: 'BTCUSDT', side: 'Buy', size: '0.01', entry: 100, exit: 110, pnl: 9.5, r: 1.9,
  status: 'closed', opened_at: T0, closed_at: T0 + HOUR, origin: 'WATCHLIST', source: 'SWING_DETECTOR',
  initial_stop_loss: 95, initial_take_profit: 110, stop_loss: 95, take_profit: 110, closes: [], notes: [], ...over,
});

test('solo los cerrados, del más viejo al más nuevo y numerados así', () => {
  const list = toDashboardTrades([
    trade({ trade_id: 'b', closed_at: T0 + 3 * HOUR }),
    trade({ trade_id: 'abierto', status: 'open', pnl: null, closed_at: null }),
    trade({ trade_id: 'a', closed_at: T0 + HOUR }),
    trade({ trade_id: 'sin-pnl', pnl: null }),
  ]);
  assert.deepEqual(list.map(t => t.id), ['a', 'b']);
  assert.deepEqual(list.map(t => t.tradeNumber), [1, 2]);
});

test('lado, % a favor, R, origen, cuenta y notas como los usan los widgets', () => {
  const [long] = toDashboardTrades([trade({ notes: [{ text: 'entré en el VAL' }, { text: 'salí bien' }] })]);
  assert.equal(long.side, 'long');
  assert.equal(long.pnlPercent.toFixed(4), '10.0000');
  assert.equal(long.r, 1.9);
  assert.equal(long.origin, 'WATCHLIST · SWING_DETECTOR');
  assert.equal(long.account, 'sin cuenta');
  assert.equal(long.notes, 'entré en el VAL · salí bien');
  const [short] = toDashboardTrades([trade({ side: 'Sell', entry: 100, exit: 90, pnl: 9.5, initial_stop_loss: 105, take_profit: 90 })]);
  assert.equal(short.side, 'short');
  assert.equal(short.pnlPercent.toFixed(4), '10.0000', 'un short gana cuando el precio baja');
  const [noSl] = toDashboardTrades([trade({ r: null, origin: null, source: null })]);
  assert.equal(noSl.r, null);
  assert.equal(noSl.origin, 'sin origen');
});

test('cómo cerró: TP, SL con algo de deslizamiento, SL movido, liquidación o manual', () => {
  assert.equal(closeReason(trade({ exit: 110 })), 'take_profit');
  // SL a 5 de la entrada: una décima (0.5) de deslizamiento todavía es el SL
  assert.equal(closeReason(trade({ exit: 94.6, pnl: -5.6 })), 'stop_loss');
  assert.equal(closeReason(trade({ exit: 93, pnl: -7 })), 'manual', 'muy lejos del SL: no fue el SL');
  // El SL se movió a 104 (a favor): cerrar ahí es el SL vigente
  assert.equal(closeReason(trade({ exit: 104, stop_loss: 104 })), 'stop_loss');
  assert.equal(closeReason(trade({ exit: 105 })), 'manual');
  assert.equal(closeReason(trade({ exit: 80, closes: [{ exec_type: 'BustTrade' }] })), 'Liquidación');
  assert.equal(closeReason(trade({ exit: null })), 'manual');
});

test('riesgo y recompensa: mayor caída desde el pico y mayor racha ganadora, en dólares y en R de esas mismas', () => {
  const list = [10, -5, -8, 20, 4, -3].map((pnl, i) => ({ pnl, r: [1, -0.5, -0.8, 2, 0.4, -0.3][i] }));
  const out = riskReward(list);
  assert.equal(out.maxDrawdown, 13); // de +10 a −3
  assert.equal(out.maxDrawdownR.toFixed(2), '1.30'); // de 1 R a −0.3 R
  assert.equal(out.maxGrowth, 24); // +20 y +4 seguidos
  assert.equal(out.maxGrowthR.toFixed(2), '2.40');
});

test('riesgo y recompensa: un trade sin R cuenta 0 R; sin trades, todo en cero', () => {
  const out = riskReward([{ pnl: -4, r: null }, { pnl: 6, r: 1.5 }]);
  assert.equal(out.maxDrawdown, 4);
  assert.equal(out.maxDrawdownR, 0);
  assert.equal(out.maxGrowth, 6);
  assert.equal(out.maxGrowthR, 1.5);
  assert.deepEqual(riskReward([]), { maxDrawdown: 0, maxDrawdownR: 0, maxGrowth: 0, maxGrowthR: 0 });
});

test('totales del pie de la curva: P&L neto, R acumulado y cuántos no tienen R', () => {
  const out = totals([{ pnl: 10, r: 1 }, { pnl: -4, r: null }, { pnl: 2.5, r: 0.5 }]);
  assert.equal(out.pnl, 8.5);
  assert.equal(out.r, 1.5);
  assert.equal(out.n, 3);
  assert.equal(out.withoutR, 1);
});

test('filtros: monedas, orígenes y cuentas sin repetir y ordenados', () => {
  const list = toDashboardTrades([
    trade({ trade_id: 'a', symbol: 'SOLUSDT', account: 'Real' }),
    trade({ trade_id: 'b', symbol: 'BTCUSDT', origin: 'MANUAL', source: 'MANUAL_TRADE', account: 'Demo' }),
    trade({ trade_id: 'c', symbol: 'SOLUSDT', account: 'Real' }),
  ]);
  assert.deepEqual(filterOptions(list), {
    symbols: ['BTCUSDT', 'SOLUSDT'],
    origins: ['MANUAL · MANUAL_TRADE', 'WATCHLIST · SWING_DETECTOR'],
    accounts: ['Demo', 'Real'],
  });
});

test('precios con las cifras que hacen falta', () => {
  assert.equal(priceText(0.067), '$0.067');
  assert.equal(priceText(0.14702), '$0.14702');
  assert.equal(priceText(79261.4), '$79261.4');
  assert.equal(priceText(NaN), '–');
});

test('la firma cambia solo si cambia lo que se dibuja', () => {
  const a = [trade(), trade({ trade_id: 'x', status: 'open', pnl: null })];
  const b = a.map(t => ({ ...t }));
  assert.equal(signature(a), signature(b), 'una relectura igual no cambia la firma');
  assert.notEqual(signature(a), signature([trade({ pnl: 9.4 })]));
  assert.notEqual(signature(a), signature([trade({ notes: [{ text: 'nota' }] })]));
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
