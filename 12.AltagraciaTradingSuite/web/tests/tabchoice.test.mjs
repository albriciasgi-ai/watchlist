// Pruebas de dónde se abre una moneda del scanner (src/tabChoice.js, 23/11/2026).
// Uso: node tests/tabchoice.test.mjs
import assert from 'node:assert/strict';
import { scannerTabNumber } from '../src/tabChoice.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

// Las cinco pestañas: las que no se nombran están cerradas
const tabs = (open = {}) => [1, 2, 3, 4, 5].map(n => (open[n]
  ? { n, alive: true, module: open[n].module, role: open[n].role || null }
  : { n, alive: false, module: null, role: null }));

test('sin otras pestañas abiertas: la 2', () => {
  assert.equal(scannerTabNumber(tabs({ 1: { module: 'watchlist' } }), 1), 2);
});

test('un gráfico abierto a mano no se toca: la primera libre', () => {
  assert.equal(scannerTabNumber(tabs({ 1: { module: 'watchlist' }, 2: { module: 'chart' } }), 1), 3);
  assert.equal(scannerTabNumber(tabs({ 2: { module: 'chart' }, 3: { module: 'mapa' } }), 1), 4);
});

test('la pestaña del scanner con el gráfico se vuelve a usar', () => {
  const t = tabs({ 1: { module: 'watchlist' }, 2: { module: 'chart' }, 4: { module: 'chart', role: 'scanner' } });
  assert.equal(scannerTabNumber(t, 1), 4);
});

test('la pestaña del scanner que pasó a otro módulo ya no se usa', () => {
  const t = tabs({ 2: { module: 'watchlist', role: 'scanner' } });
  assert.equal(scannerTabNumber(t, 1), 3);
});

test('nunca esta misma pestaña, aunque sea la del scanner', () => {
  const t = tabs({ 1: { module: 'chart' }, 2: { module: 'watchlist' } });
  assert.equal(scannerTabNumber(t, 2), 3);
  const s = tabs({ 3: { module: 'chart', role: 'scanner' } });
  assert.equal(scannerTabNumber(s, 3), 2);
});

test('todas ocupadas: null', () => {
  const t = tabs({ 1: { module: 'chart' }, 2: { module: 'chart' }, 3: { module: 'bot' }, 4: { module: 'mapa' }, 5: { module: 'watchlist' } });
  assert.equal(scannerTabNumber(t, 1), null);
  assert.equal(scannerTabNumber([], 1), null);
  assert.equal(scannerTabNumber(null, 1), null);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASA  ${name}`); } catch (e) { failed++; console.log(`FALLA ${name}\n  ${e.message}`); }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasan`);
process.exit(failed ? 1 : 0);
