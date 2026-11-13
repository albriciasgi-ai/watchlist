// Pruebas de lo elegido en la imagen de apertura (src/openDecision.js): el trade del journal de la posición que se abrió
// y los niveles de su decisión, aunque la decisión se guarde después de verse la posición. Uso: node tests/openDecision.test.mjs
import assert from 'node:assert/strict';
import { OPEN_DECISION_TRIES, openDecisionLevels, openTradeOf } from '../src/openDecision.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const MIN = 60000;
const T0 = Date.UTC(2026, 10, 13, 15);
const LEVELS = [{ id: 'POC|Volume Profile|80', kind: 'POC', price: 80, role: 'support' }];
const position = { symbol: 'SOLUSDT', side: 'Buy', entryPrice: '80.36', size: '1' };
const trade = (over = {}) => ({ trade_id: 'SOL-1', symbol: 'SOLUSDT', side: 'Buy', status: 'open', opened_at: T0, entry: 80.36,
  pre_existing: false, decision: { levels: LEVELS }, ...over });
const noWait = async () => {};

test('elige el trade abierto de esa posición: misma moneda y lado, a esa hora y con esa entrada', () => {
  const list = [
    trade({ trade_id: 'otro-lado', side: 'Sell' }),
    trade({ trade_id: 'cerrado', status: 'closed' }),
    trade({ trade_id: 'viejo', opened_at: T0 - 30 * MIN }),
    trade({ trade_id: 'otra-entrada', entry: 85 }),
    trade({ trade_id: 'anterior', pre_existing: true }),
    trade({ trade_id: 'bueno', opened_at: T0 + 2000 }),
    trade({ trade_id: 'otra-moneda', symbol: 'ETHUSDT' }),
  ];
  assert.equal(openTradeOf(list, position, T0 + 3000).trade_id, 'bueno');
  assert.equal(openTradeOf([], position, T0), null);
});

test('con la decisión ya unida: sus niveles a la primera, sin esperar', async () => {
  let calls = 0;
  const levels = await openDecisionLevels(position, T0, { fetchTrades: async () => { calls += 1; return [trade()]; }, sleep: noWait });
  assert.deepEqual(levels, LEVELS);
  assert.equal(calls, 1);
});

test('la decisión llega después de verse la posición: la toma al volver a preguntar', async () => {
  let calls = 0;
  const waits = [];
  const levels = await openDecisionLevels(position, T0, {
    fetchTrades: async () => { calls += 1; return [trade({ decision: calls >= 3 ? { levels: LEVELS } : null })]; },
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(levels, LEVELS);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 2000]);
});

test('un trade de una alerta, sin decisión: nada elegido tras los intentos', async () => {
  let calls = 0;
  const levels = await openDecisionLevels(position, T0, {
    fetchTrades: async () => { calls += 1; return [trade({ decision: null })]; }, sleep: noWait,
  });
  assert.deepEqual(levels, []);
  assert.equal(calls, OPEN_DECISION_TRIES);
});

test('el journal falla una vez: vuelve a preguntar; una decisión sin niveles no dibuja nada', async () => {
  let calls = 0;
  const levels = await openDecisionLevels(position, T0, {
    fetchTrades: async () => { calls += 1; if (calls === 1) throw new Error('bot sin journal'); return [trade()]; }, sleep: noWait,
  });
  assert.deepEqual(levels, LEVELS);
  assert.deepEqual(await openDecisionLevels(position, T0, { fetchTrades: async () => [trade({ decision: { note: 'sin niveles' } })], sleep: noWait }), []);
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
