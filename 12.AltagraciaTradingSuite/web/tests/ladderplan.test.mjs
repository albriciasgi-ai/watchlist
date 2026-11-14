// Pruebas de la entrada, el stop y el objetivo elegidos en el ladder, y la caja TP/SL (src/ladderPlan.js).
// Uso: node tests/ladderplan.test.mjs
import assert from 'node:assert/strict';
import { emptyPlan, planClick, planReady, planBox, withBox, planSummary } from '../src/ladderPlan.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('compra: entrada, luego stop debajo y objetivo encima, y vuelve a entrada', () => {
  let r = planClick(emptyPlan(), 'entry', 100, 'long');
  assert.deepEqual([r.plan.entry, r.plan.side, r.mode], [100, 'long', 'sl']);
  r = planClick(r.plan, 'sl', 99, 'long');
  assert.deepEqual([r.plan.sl, r.mode], [99, 'tp']);
  r = planClick(r.plan, 'tp', 102, 'short');
  assert.deepEqual([r.plan.tp, r.mode, r.error], [102, 'entry', null]);
  assert.ok(planReady(r.plan));
});

test('stop u objetivo del lado equivocado: error y el plan no cambia', () => {
  const p = { side: 'long', entry: 100, sl: null, tp: null };
  const r = planClick(p, 'sl', 101, 'short');
  assert.equal(r.plan.sl, null);
  assert.match(r.error, /debajo/);
  assert.match(planClick(p, 'tp', 98, 'long').error, /encima/);
  const s = { side: 'short', entry: 100, sl: null, tp: null };
  assert.equal(planClick(s, 'sl', 101, 'short').plan.sl, 101);
  assert.match(planClick(s, 'tp', 101, 'short').error, /debajo/);
  assert.match(planClick(emptyPlan(), 'sl', 99, 'long').error, /Primero/);
});

test('mover la entrada: se quedan el stop y el objetivo que siguen sirviendo; otro lado los borra', () => {
  const p = { side: 'long', entry: 100, sl: 99, tp: 102 };
  let r = planClick(p, 'entry', 99.5, 'long');
  assert.deepEqual([r.plan.sl, r.plan.tp, r.mode], [99, 102, 'entry']);
  r = planClick(p, 'entry', 101, 'long');            // ahora el objetivo 102 sigue, el stop 99 también
  assert.deepEqual([r.plan.sl, r.plan.tp], [99, 102]);
  r = planClick(p, 'entry', 103, 'long');            // el objetivo quedó debajo: se borra
  assert.deepEqual([r.plan.sl, r.plan.tp, r.mode], [99, null, 'tp']);
  r = planClick(p, 'entry', 101, 'short');
  assert.deepEqual([r.plan.side, r.plan.sl, r.plan.tp, r.mode], ['short', null, null, 'sl']);
  assert.match(planClick(p, 'entry', 100, null).error, /entre la mejor/);
});

test('la caja TP/SL del plan, una por moneda, sin tocar los otros dibujos', () => {
  const now = 1_794_000_030_000;
  const box = planBox({ side: 'short', entry: 100, sl: 101, tp: 97 }, 'BTCUSDT', now);
  assert.deepEqual(box, { type: 'tpsl', id: 'tpsl_ladder_BTCUSDT', entryPrice: 100, tpPrice: 97, slPrice: 101,
    time: 1_794_000_000_000, timeStart: 1_794_000_000_000, timeEnd: 1_794_000_000_000 + 7_200_000, direction: 'short', createdAt: null });
  assert.equal(planBox({ side: 'long', entry: 100, sl: 101, tp: 102 }, 'X'), null);
  const shapes = [{ id: 'h1', type: 'horizontal' }, { id: 'tpsl_ladder_BTCUSDT', type: 'tpsl', entryPrice: 1 }];
  const out = withBox(shapes, box);
  assert.deepEqual(out.map(s => s.id), ['h1', 'tpsl_ladder_BTCUSDT']);
  assert.equal(out[1].entryPrice, 100);
});

test('resumen de riesgo y beneficio', () => {
  assert.equal(planSummary({ side: 'long', entry: 100, sl: 99.5, tp: 101.5 }), 'R/R 1:3.00 · stop 0.50% · objetivo 1.50%');
  assert.equal(planSummary(emptyPlan()), null);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASA  ${name}`); } catch (e) { failed++; console.log(`FALLA ${name}\n  ${e.message}`); }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasan`);
process.exit(failed ? 1 : 0);
