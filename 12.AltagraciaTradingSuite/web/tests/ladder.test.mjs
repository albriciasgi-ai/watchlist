// Pruebas de las cuentas del price ladder (src/ladderLogic.js). Uso: node tests/ladder.test.mjs
import assert from 'node:assert/strict';
import { fmtQty, priceDigits, followCenter, wallThreshold, ladderMarks, rowOf, stepLabel, stepFor, pickSide, startQueue, queueNow, queueText } from '../src/ladderLogic.js';
import { makePick, freshPick } from '../src/ladderPick.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('cantidades cortas y vacío para cero', () => {
  assert.equal(fmtQty(0), '');
  assert.equal(fmtQty(0.0042), '0.004');
  assert.equal(fmtQty(1.256), '1.26');
  assert.equal(fmtQty(37.54), '37.5');
  assert.equal(fmtQty(1234), '1.2k');
  assert.equal(fmtQty(-3.5e6), '−3.5M');
});

test('decimales del precio según step y tick', () => {
  assert.equal(priceDigits(5, 0.1), 1);
  assert.equal(priceDigits(0.5, 0.1), 1);
  assert.equal(priceDigits(0.0001, 0.0001), 4);
  assert.equal(priceDigits(1e-7, 1e-7), 7);
});

test('seguir al precio: no salta con cada tick, sí cerca del borde', () => {
  assert.equal(followCenter(null, 100, 1, 40), 100);
  assert.equal(followCenter(100, 105, 1, 40), 100);      // dentro de la vista
  assert.equal(followCenter(100, 113, 1, 40), 113);      // a menos de 8 filas del borde de arriba
  assert.equal(followCenter(100, 87, 1, 40), 87);
});

test('muros: percentil 95 de lo que espera, sin ceros; con poco no marca nada', () => {
  assert.equal(wallThreshold([[1, 5, 0]]), Infinity);
  const rows = Array.from({ length: 20 }, (_, i) => [i, i + 1, 0]);
  assert.equal(wallThreshold(rows), 20);
});

test('marcas de la posición y de las órdenes', () => {
  const marks = ladderMarks([
    { kind: 'position', side: 'Sell', size: 0.003, entry: 79261.4, stopLoss: 82293.4, takeProfit: 65227.5, liqPrice: null },
    { kind: 'order', side: 'Buy', qty: 0.01, price: 66000, orderType: 'Limit' },
  ]);
  assert.deepEqual(marks.map(m => [m.price, m.text, m.side]), [
    [79261.4, 'Short 0.003', 'sell'], [82293.4, 'SL', 'risk'], [65227.5, 'TP', 'target'], [66000, 'Limit 0.01', 'buy']]);
});

test('fila de un precio en la vista, y fuera de ella', () => {
  assert.equal(rowOf(100, 100, 0.5, 10), 0);
  assert.equal(rowOf(99.7, 100, 0.5, 10), 1);              // cae en el cubo de 99.5
  assert.equal(rowOf(100.6, 100, 0.5, 10), -1);
  assert.equal(rowOf(90, 100, 0.5, 10), 10);
});

test('step en precio y en ticks, según el tick de la moneda', () => {
  assert.equal(stepLabel(10, 0.01), '0.1 · 10 ticks');
  assert.equal(stepLabel(10, 0.1), '1 · 10 ticks');
  assert.equal(stepLabel(250, 0.01), '2.5 · 250 ticks');
  assert.equal(stepLabel(1, 0.0001), '0.0001 · 1 tick');
  assert.equal(stepLabel(0, 0.01, 0.2), 'Auto · 0.2');
  assert.equal(stepLabel(0, null, null), 'Step auto');
  assert.equal(stepLabel(50, null), '50 ticks');
});

test('cada moneda recuerda su step; lo que no está en la lista es automático', () => {
  const settings = { steps: { ETHUSDT: 250, BTCUSDT: 50, XRPUSDT: 7 } };
  assert.equal(stepFor(settings, 'ETHUSDT'), 250);
  assert.equal(stepFor(settings, 'BTCUSDT'), 50);
  assert.equal(stepFor(settings, 'XRPUSDT'), 0);
  assert.equal(stepFor(settings, 'SOLUSDT'), 0);
  assert.equal(stepFor({ step: 10 }, 'ETHUSDT'), 0);
});

test('clic en el ladder: el lado sale de la columna, o del precio', () => {
  assert.equal(pickSide('bid', 101, 99.9, 100), 'long');
  assert.equal(pickSide('ask', 98, 99.9, 100), 'short');
  assert.equal(pickSide('price', 99.5, 99.9, 100), 'long');
  assert.equal(pickSide('price', 100.5, 99.9, 100), 'short');
  assert.equal(pickSide('traded', 99.95, 99.9, 100), null);
});

test('el precio que viaja al panel: con forma y no vencido', () => {
  const p = makePick('BTCUSDT', 65500, 'long', 1000);
  assert.deepEqual(p, { symbol: 'BTCUSDT', price: 65500, side: 'long', at: 1000 });
  assert.ok(freshPick(p, 20000));
  assert.equal(freshPick(p, 40000), null);
  assert.equal(makePick('BTCUSDT', 0, 'long'), null);
  assert.equal(freshPick({ symbol: 'X', price: 1, side: 'arriba', at: 1 }, 1), null);
});

test('cola de tu Limit: al verla, lo de delante es lo que esperaba sin lo tuyo', () => {
  const t = startQueue({ side: 'Buy', qty: 0.5, createdAt: 1000 }, { price: 65500, since: 5000, bid: 3.5, ask: 0 }, 5000);
  assert.deepEqual(t, { price: 65500, qty: 0.5, since: 5000, ahead0: 3, late: false });
  assert.equal(startQueue({ side: 'Buy', qty: 0.5, createdAt: 1000 }, { price: 1, since: 60000, bid: 1, ask: 0 }, 60000).late, true);
});

test('cola: lo negociado acerca; lo retirado da un rango', () => {
  const t = { ahead0: 3, qty: 0.5 };
  // se negoció 1 contra la compra y espera 2.5 (con lo tuyo): delante entre 2 (nada retirado delante) y 2
  assert.deepEqual(queueNow(t, { sell: 1, buy: 0, bid: 2.5, ask: 0 }, 'Buy'), { optimistic: 2, pessimistic: 2, traded: 1, resting: 2.5 });
  // además se retiró 1.5: si estaba delante, quedan 0.5
  const q = queueNow(t, { sell: 1, buy: 0, bid: 1, ask: 0 }, 'Buy');
  assert.deepEqual([q.optimistic, q.pessimistic], [0.5, 2]);
  assert.equal(queueText(q), 'delante 0.500–2.00 · negoc. 1.00');
  assert.equal(queueText({ optimistic: 2, pessimistic: 2, traded: 0 }, true), 'delante ~2.00 · desde que se vio');
  // venta: cuenta la compra agresiva
  assert.equal(queueNow({ ahead0: 4, qty: 1 }, { sell: 9, buy: 1, bid: 0, ask: 5 }, 'Sell').pessimistic, 3);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASA  ${name}`); } catch (e) { failed++; console.log(`FALLA ${name}\n  ${e.message}`); }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasan`);
process.exit(failed ? 1 : 0);
