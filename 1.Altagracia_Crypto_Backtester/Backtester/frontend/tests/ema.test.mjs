// El indicador EMA: la serie, los ajustes y lo que da a la cocina. Uso: node tests/ema.test.mjs
import assert from 'node:assert/strict';
import EMAIndicator, { EMA_MAX_LINES, cleanEMAConfig, defaultEMAConfig, emaSeries } from '../src/components/indicators/EMAIndicator.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const candles = (n) => Array.from({ length: n }, (_, i) => ({ timestamp: i * 60000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + Math.sin(i / 5) * 10 + i * 0.1, volume: 1 }));

test('la EMA es la del backtesting global: arranca en el primer cierre y no da valor hasta tener su periodo', () => {
  const closes = [10, 11, 12, 13, 14, 15];
  const out = emaSeries(closes, 3);
  assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]));
  let value = 10;
  const expected = closes.map(close => (value = close * 0.5 + value * 0.5));
  for (let i = 2; i < closes.length; i += 1) assert.ok(Math.abs(out[i] - expected[i]) < 1e-12);
});

test('los ajustes: periodos enteros dentro de rango, sin repetir y hasta el tope de líneas', () => {
  const clean = cleanEMAConfig({ lines: [{ period: 20 }, { period: '20' }, { period: 1 }, { period: 500 }, { period: 9.4, color: '#123456', width: 9 }, { period: 'x' }] });
  assert.deepEqual(clean.lines.map(line => line.period), [20, 9]);
  assert.equal(clean.lines[1].color, '#123456');
  assert.equal(clean.lines[1].width, 4);
  assert.equal(cleanEMAConfig({ lines: Array.from({ length: 12 }, (_, i) => ({ period: 10 + i })) }).lines.length, EMA_MAX_LINES);
  assert.deepEqual(defaultEMAConfig().lines.map(line => line.period), [20, 50, 200]);
});

test('varias a la vez, y solo con velas cerradas: la vela en formación no entra en la serie', () => {
  const indicator = new EMAIndicator('TEST', '15m');
  indicator.updateConfig({ lines: [{ period: 5 }, { period: 20 }] });
  const all = candles(200);
  const full = indicator.seriesFor(all);
  assert.deepEqual(Object.keys(full), ['e5', 'e20']);
  assert.equal(full.e5.length, 200);
  const reference = emaSeries(all.map(c => c.close), 20);
  for (let i = 19; i < 200; i += 1) assert.ok(Math.abs(full.e20[i] - reference[i]) < 1e-9);
  const forming = [...all.slice(0, 150), { ...all[150], in_progress: true }];
  const partial = indicator.seriesFor(forming);
  assert.equal(partial.e5.length, 150);
  for (let i = 4; i < 150; i += 1) assert.ok(Math.abs(partial.e5[i] - full.e5[i]) < 1e-9);
});

test('avanza vela a vela sin recalcular, y retroceder vuelve a dar lo mismo', () => {
  const indicator = new EMAIndicator('TEST', '15m');
  indicator.updateConfig({ lines: [{ period: 10 }] });
  const all = candles(300);
  const reference = emaSeries(all.map(c => c.close), 10);
  for (const count of [50, 51, 52, 120, 300, 80]) {
    const got = indicator.seriesFor(all.slice(0, count)).e10;
    assert.equal(got.length, count);
    assert.ok(Math.abs(got[count - 1] - reference[count - 1]) < 1e-9, `con ${count} velas`);
  }
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}\n      ${error.message}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} correctas`);
process.exit(failed ? 1 : 0);
