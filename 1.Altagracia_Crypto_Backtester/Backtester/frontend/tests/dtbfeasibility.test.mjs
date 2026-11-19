// Pruebas del aviso de Double Top/Bottom: configuraciones que no pueden dar patrones.
// Uso: node tests/dtbfeasibility.test.mjs
import assert from 'node:assert/strict';
import { impossibleSides, maxConfidenceWithoutRejection } from '../src/components/indicators/dtbFeasibility.js';

const cfg = ({ rej = {}, both = false, min = 60, volume = false, bonus = 20 } = {}) => ({
  doubleTopBottom: {
    rejectionPatterns: { hammer: true, shootingStar: true, bullishEngulfing: true, bearishEngulfing: true, ...rej },
    volumeFilter: { enabled: volume }
  },
  filters: { requireBothRejections: both, minConfidence: min, postPatternConfidenceBonus: bonus }
});
const off = { hammer: false, shootingStar: false, bullishEngulfing: false, bearishEngulfing: false };
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('con los rechazos encendidos no avisa', () => {
  assert.deepEqual(impossibleSides(cfg({ min: 100, both: true })), []);
});
test('la configuración del usuario: sin rechazos y confianza 60 no da nada', () => {
  const sides = impossibleSides(cfg({ rej: off, min: 60 }));
  assert.equal(sides.length, 2);
  assert.equal(sides[0].reason, 'confidence');
  assert.equal(sides[0].max, 40);
});
test('sin rechazos y confianza 40 sí puede dar patrones', () => {
  assert.deepEqual(impossibleSides(cfg({ rej: off, min: 40 })), []);
});
test('el filtro de volumen suma 15 al tope', () => {
  assert.equal(maxConfidenceWithoutRejection(cfg({ volume: true })), 55);
  assert.deepEqual(impossibleSides(cfg({ rej: off, min: 55, volume: true })), []);
});
test('sin rechazos y exigir los dos extremos descarta todo', () => {
  const sides = impossibleSides(cfg({ rej: off, both: true, min: 0 }));
  assert.deepEqual(sides.map(s => s.reason), ['both', 'both']);
});
test('solo un lado sin rechazos avisa solo ese lado', () => {
  const sides = impossibleSides(cfg({ rej: { shootingStar: false, bearishEngulfing: false }, both: true }));
  assert.deepEqual(sides.map(s => s.side), ['top']);
});
test('una configuración vacía usa los valores de fábrica del detector', () => {
  assert.deepEqual(impossibleSides({}), []);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`ok  ${name}`); } catch (e) { failed++; console.log(`MAL ${name}\n    ${e.message}`); }
}
console.log(`${tests.length - failed}/${tests.length}`);
process.exit(failed ? 1 : 0);
