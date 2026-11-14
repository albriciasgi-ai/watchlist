// Pruebas de las órdenes de la cinta como líneas en el gráfico (src/tapeLines.js). Uso: node tests/tapelines.test.mjs
import assert from 'node:assert/strict';
import { tapeLineId, orderPrice, tapeLabel, tapeLine, withPendingLine, firmLine, removeLine, lineState } from '../src/tapeLines.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const order = { t: Date.UTC(2026, 10, 14, 19, 33, 10), side: 'buy', qty: 15.243, usd: 1000198, p0: 65612.1, p1: 65619.7, lo: 65612.1, hi: 65619.7, levels: 77 };

test('precio de la línea: el promedio de la orden', () => {
  assert.ok(Math.abs(orderPrice(order) - 1000198 / 15.243) < 1e-6);
  assert.equal(orderPrice({ qty: 0, usd: 0, p0: 5 }), 5);
});

test('texto con lado, cantidad, USD, hora y el rango si barrió', () => {
  const label = tapeLabel(order, (q) => q.toFixed(1));
  assert.match(label, /^Cinta ▲ compra 15\.2 · 1\.0M · \d\d:\d\d:10 · 65,612\.1→65,619\.7$/);
  assert.match(tapeLabel({ ...order, side: 'sell', levels: 1, usd: 45589 }), /^Cinta ▼ venta 15\.243 · 46k · /);
});

test('provisional: punteada y con "(provisional)"; una sola por moneda', () => {
  const a = tapeLine('BTCUSDT', order, '#089981', true);
  assert.equal(a.id, tapeLineId('BTCUSDT', order));
  assert.deepEqual(a.style, { color: '#089981', lineWidth: 1, dash: [4, 3] });
  assert.match(a.label, /\(provisional\)$/);
  const firm = { ...tapeLine('BTCUSDT', { ...order, t: 1 }, '#089981', false) };
  const shapes = [{ id: 'h1', type: 'horizontal' }, firm, tapeLine('BTCUSDT', { ...order, t: 2 }, '#f00', true)];
  const out = withPendingLine(shapes, a);
  assert.deepEqual(out.map(s => s.id), ['h1', firm.id, a.id]);   // la provisional anterior sale; la firme y lo demás quedan
});

test('dejar en firme y borrar', () => {
  const a = tapeLine('BTCUSDT', order, '#089981', true);
  const shapes = [{ id: 'h1' }, a];
  assert.equal(lineState(shapes, a.id), 'pending');
  const f = firmLine(shapes, a.id);
  assert.equal(lineState(f, a.id), 'firm');
  const line = f.find(s => s.id === a.id);
  assert.deepEqual(line.style, { color: '#089981', lineWidth: 2, dash: [] });
  assert.doesNotMatch(line.label, /provisional/);
  assert.equal(f[0], shapes[0]);
  const r = removeLine(f, a.id);
  assert.deepEqual(r.map(s => s.id), ['h1']);
  assert.equal(lineState(r, a.id), null);
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASA  ${name}`); } catch (e) { failed++; console.log(`FALLA ${name}\n  ${e.message}`); }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasan`);
process.exit(failed ? 1 : 0);
