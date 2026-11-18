// Revisión de candidatos: lo que la ventana arma con la sesión que entrega el backend.
// Uso: node tests/candidatereview.test.mjs
import assert from 'node:assert/strict';
import { boxDecision, gapText, reviewBoxes, statText } from '../src/components/backtesting/candidateReview.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const fmtR = (value, digits = 2) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const TF = 15 * 60000;

test('las cajas salen solo de lo que se entró, y una abierta llega hasta la hora a la vista', () => {
  const decisions = [
    { i: 0, action: 'skip', time: 1000 },
    { i: 1, action: 'rule', dir: 1, entry: 100, stop: 98, target: 104, entry_t: 10 * TF, exit_t: 14 * TF, exit: 104, r: 1.9 },
    { i: 2, action: 'short', dir: -1, entry: 105, stop: 107, target: 101, entry_t: 20 * TF }
  ];
  const boxes = reviewBoxes(decisions, 26 * TF, 15);
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes[0], { side: 'long', entry: 100, stop: 98, target: 104, start: 10 * TF, end: 14 * TF });
  assert.deepEqual(boxes[1], { side: 'short', entry: 105, stop: 107, target: 101, start: 20 * TF, end: 26 * TF });
  // Sin objetivo la caja usa la salida, o la entrada si sigue abierta; nunca mide menos de una vela
  const open = reviewBoxes([{ action: 'long', dir: 1, entry: 50, stop: 49, target: null, entry_t: 5 * TF }], 5 * TF, 15)[0];
  assert.equal(open.target, 50);
  assert.equal(open.end, 6 * TF);
});

test('la caja TP/SL da el lado, el stop y el objetivo, y avisa si no cuadra con la entrada real', () => {
  assert.equal(boxDecision(null, 100), null);
  const long = boxDecision({ id: 'a', entryPrice: 100, slPrice: 98, tpPrice: 106 }, 100.5);
  assert.equal(long.action, 'long');
  assert.equal(long.stop, 98);
  assert.equal(long.target, 106);
  assert.equal(long.boxId, 'a');
  assert.equal(long.problem, null);
  assert.ok(Math.abs(long.rr - 5.5 / 2.5) < 1e-9);
  const short = boxDecision({ id: 'b', entryPrice: 100, slPrice: 103, tpPrice: 94 }, 99);
  assert.equal(short.action, 'short');
  assert.ok(Math.abs(short.rr - 5 / 4) < 1e-9);
  // La entrada real (apertura siguiente) ya pasó el stop o el objetivo de la caja
  assert.match(boxDecision({ id: 'c', slPrice: 98, tpPrice: 106 }, 97.5).problem, /stop/);
  assert.match(boxDecision({ id: 'd', slPrice: 98, tpPrice: 106 }, 107).problem, /objetivo/);
});

test('los textos del informe dicen cuántos, cuánto y con qué margen', () => {
  assert.equal(statText({ n: 0 }, fmtR), '—');
  assert.equal(statText({ n: 12, winRate: 58.3, avgR: 0.314, margin: 0.4 }, fmtR), '12 · 58.3% · +0.31 R (±0.40)');
  assert.match(gapText(null, fmtR), /Todavía no hay/);
  assert.match(gapText({ r: 0.3, low: 0.05, high: 0.55, clear: true }, fmtR), /\+0\.30 R por trade \(entre \+0\.05 y \+0\.55\)\. El margen no incluye el cero/);
  assert.match(gapText({ r: 0.1, low: -0.2, high: 0.4, clear: false }, fmtR), /no se distingue de cero/);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA  ${name}\n${error.stack}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasaron`);
process.exit(failed ? 1 : 0);
