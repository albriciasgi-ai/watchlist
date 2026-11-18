// Probador de reglas del Observador: la regla de la ventana, su forma para el backend y las reglas guardadas.
// Uso: node tests/ruletester.test.mjs
import assert from 'node:assert/strict';
import {
  defaultRule, deleteRule, describeRule, fromBackendRule, isRuleTester, loadSavedRules, ruleTesterUrl, saveRule,
  accountStats, sortTrades, testerSymbol, toBackendRule, tradeBoxes
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

test('como cuenta: cada trade arriesga un % del capital al entrar, con posiciones a la vez y retornos diarios', () => {
  const DAY = 86400000;
  // Dos trades abiertos a la vez el día 0 (los dos miden su tamaño con el capital inicial), y uno el día 2
  const trades = [
    { entry_t: 0, exit_t: DAY / 2, r: 2 },
    { entry_t: 1000, exit_t: DAY / 2 + 1000, r: -1 },
    [2 * DAY, 2 * DAY + 3600000, -1]
  ];
  const stats = accountStats(trades, 1);
  assert.equal(stats.trades, 3);
  assert.equal(stats.maxOpen, 2);
  assert.equal(stats.maxOpenRisk, 2);
  assert.equal(stats.days, 3, 'del día 0 al 2, con un día sin cierres');
  // 1 + 0.02 - 0.01 = 1.01, y el tercero pierde 1% de 1.01
  assert.equal(stats.totalReturn, -0.0);
  assert.ok(Math.abs(stats.equity[2][1] - (1.01 * 0.99 - 1) * 100) < 0.01);
  assert.equal(stats.maxDrawdown, 2, 'del máximo de 1.02 a 0.9999: las dos pérdidas seguidas');
  assert.equal(stats.bestDay, 1);
  assert.equal(stats.worstDay, -1);
  assert.equal(stats.annualReturn, null, 'con menos de 3 meses no se anualiza');
  assert.ok(stats.sharpe === null || Number.isFinite(stats.sharpe));
  // El doble de riesgo, el doble de resultado en cada trade
  assert.equal(accountStats(trades, 2).bestDay, 2);
  // Sortino mayor que Sharpe cuando se pierde poco muchas veces y se gana mucho pocas
  const many = Array.from({ length: 300 }, (_, i) => ({ entry_t: i * DAY, exit_t: i * DAY + 3600000, r: i % 5 < 2 ? 2 : -1 }));
  const long = accountStats(many, 1);
  assert.ok(long.sharpe > 0 && long.sortino > long.sharpe);
  assert.ok(long.annualReturn > 0 && long.positiveMonths <= long.months && long.months >= 9);
  assert.equal(accountStats([], 1), null);
  assert.equal(accountStats(trades, 0), null);
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
