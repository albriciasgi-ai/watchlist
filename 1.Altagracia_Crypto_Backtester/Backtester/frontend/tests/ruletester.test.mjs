// Probador de reglas del Observador: la regla de la ventana, su forma para el backend y las reglas guardadas.
// Uso: node tests/ruletester.test.mjs
import assert from 'node:assert/strict';
import {
  defaultRule, deleteRule, describeRule, fromBackendRule, isRuleTester, loadSavedRules, ruleTesterUrl, saveRule,
  sortTrades, testerSymbol, toBackendRule, tradeBoxes
} from '../src/components/backtesting/ruleTester.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('la regla de fábrica es el ejemplo del pedido: VA, stop en el swing y 2R', () => {
  const rule = toBackendRule(defaultRule());
  assert.deepEqual(rule.recipe.slots, [{ codes: ['VA'], group: 0 }]);
  assert.equal(rule.stop.type, 'swing');
  assert.equal(rule.exit.targetR, 2);
  assert.equal(rule.entry.type, 'market');
  assert.equal(rule.tf, 15);
});

test('sin objetivo viaja como null, y cada elemento elegido es una casilla', () => {
  const rule = toBackendRule({ ...defaultRule(), codes: ['VA', 'EX', 'EX', 'ST'], useTarget: false, mode: 'atLeast', min: 2, window: 3 });
  assert.equal(rule.exit.targetR, null);
  assert.equal(rule.recipe.slots.length, 3, 'un código repetido no hace otra casilla');
  assert.equal(rule.recipe.mode, 'threshold');
  assert.equal(rule.recipe.min, 2);
  assert.equal(rule.recipe.window, 3);
  const all = toBackendRule({ ...defaultRule(), codes: ['VA', 'EX'], mode: 'all', min: 1 });
  assert.equal(all.recipe.mode, 'strict');
});

test('un campo vacío o un marco raro no llegan al backend', () => {
  const rule = toBackendRule({ ...defaultRule(), tf: 7, targetR: '', stopBars: '', filters: [{ key: 'x', op: '>=', value: '' }, { key: 'y', op: '<=', value: 1 }] });
  assert.equal(rule.tf, 15);
  assert.equal(rule.exit.targetR, 2);
  assert.equal(rule.stop.bars, 5);
  assert.deepEqual(rule.filters, [{ key: 'y', op: '<=', value: 1 }]);
});

test('una regla del historial vuelve al editor igual', () => {
  const original = { ...defaultRule(), name: 'Mia', tf: 30, codes: ['EX', 'ST'], window: 2, invert: true, entryType: 'limit', entryAt: 'mid',
    stopType: 'zone', useTarget: false, trail: true, useHorizon: false, opposite: true, oneAtATime: false, filters: [{ key: 'k', op: '<=', value: 2 }] };
  const back = fromBackendRule(toBackendRule(original));
  assert.deepEqual(toBackendRule(back), toBackendRule(original));
  assert.match(describeRule(toBackendRule(original)), /30m · EX \+ ST @2 · invertida · limit · stop borde de la zona · stop arrastrado, señal contraria/);
});

test('guardar reemplaza la del mismo nombre y borrar la quita', () => {
  const storage = fakeStorage();
  saveRule({ ...defaultRule(), name: 'A', targetR: 2 }, storage);
  saveRule({ ...defaultRule(), name: 'B' }, storage);
  const list = saveRule({ ...defaultRule(), name: 'A', targetR: 3 }, storage);
  assert.deepEqual(list.map(r => r.name), ['A', 'B']);
  assert.equal(loadSavedRules(storage)[0].targetR, 3);
  assert.deepEqual(deleteRule('A', storage).map(r => r.name), ['B']);
  storage.setItem('tester_rules_v1', 'no es json');
  assert.deepEqual(loadSavedRules(storage), []);
});

test('la dirección de la ventana y su símbolo', () => {
  const location = { origin: 'http://localhost:5173', pathname: '/', search: '?probador=1&symbol=ethusdt' };
  assert.equal(ruleTesterUrl('ETHUSDT', location), 'http://localhost:5173/?probador=1&symbol=ETHUSDT');
  assert.equal(isRuleTester(location), true);
  assert.equal(isRuleTester({ search: '?grafico=2' }), false);
  assert.equal(testerSymbol(location), 'ETHUSDT');
  assert.equal(testerSymbol({ search: '?probador=1&symbol=../x' }), 'BTCUSDT');
});

test('cajas para el gráfico: sin objetivo llegan hasta la salida, y nunca miden menos de una vela', () => {
  const boxes = tradeBoxes([
    { dir: 1, entry: 100, stop: 99, target: 102, exit: 102, entry_t: 0, exit_t: 3600000 },
    { dir: -1, entry: 100, stop: 101, target: null, exit: 98.5, entry_t: 0, exit_t: 0 }
  ], 15);
  assert.deepEqual(boxes[0], { side: 'long', entry: 100, stop: 99, target: 102, start: 0, end: 3600000 });
  assert.deepEqual(boxes[1], { side: 'short', entry: 100, stop: 101, target: 98.5, start: 0, end: 900000 });
});

test('orden de la tabla: por R, con los vacíos al final', () => {
  const trades = [{ n: 1, r: 0.5, reach: null, votes: ['B'] }, { n: 2, r: -1, reach: 2, votes: ['A'] }, { n: 3, r: 2, reach: 1, votes: ['A'] }];
  assert.deepEqual(sortTrades(trades, 'r', true).map(t => t.n), [3, 1, 2]);
  assert.deepEqual(sortTrades(trades, 'reach', false).map(t => t.n), [3, 2, 1]);
  assert.deepEqual(sortTrades(trades, 'votes', false).map(t => t.n), [2, 3, 1]);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FALLA  ${name}\n${error.stack}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasaron`);
process.exit(failed ? 1 : 0);
