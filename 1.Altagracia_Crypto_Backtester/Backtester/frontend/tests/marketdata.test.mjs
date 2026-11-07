// Velas de la carga inicial: cada vela una sola vez. Uso: node tests/marketdata.test.mjs
import assert from 'node:assert/strict';
import { withoutSubdivisions } from '../src/components/backtesting/marketData.js';
import { candlesToSettle, formingCandle, priceAt } from '../src/components/backtesting/replayClock.js';

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
const MIN = 60000;
const bar = (minute, o, h, l, c, v = 1) => ({ timestamp: minute * MIN, open: o, high: h, low: l, close: c, volume: v });
const series = (step, n, start = 0) => Array.from({ length: n }, (_, i) => {
  const p = 100 + Math.sin(i / 3) * 5 + i * 0.1;
  return bar(start + i * step, p, p + 2, p - 2, p + 1, 1 + (i % 7));
});

// Como llegaba antes: subdivisions era otra copia de main, igual vela por vela
const copy = rows => rows.map(c => ({ ...c }));
const tfData = (rows, count) => ({ main: rows, subdivisions: copy(rows), subdivision_count: count, open_interest: [{ timestamp: 0, value: 1 }] });
const oldFormat = () => ({
  success: true,
  from_cache: true,
  symbol: 'BTCUSDT',
  metadata: { cached_at: 1, date_range: { start: 'a', end: 'b' } },
  timeframes: {
    '1m': tfData(series(1, 720), 1),
    '5m': tfData(series(5, 144), 5),
    '15m': tfData(series(15, 48), 3),
    '1h': tfData(series(60, 12), 4),
    '4h': tfData(series(240, 3), 4)
  }
});

t('un caché con el formato anterior queda sin la copia', () => {
  const old = oldFormat();
  const clean = withoutSubdivisions(old);
  for (const tf of Object.keys(old.timeframes)) {
    assert.equal('subdivisions' in clean.timeframes[tf], false);
    assert.equal(clean.timeframes[tf].main, old.timeframes[tf].main);
    assert.equal(clean.timeframes[tf].subdivision_count, old.timeframes[tf].subdivision_count);
    assert.equal(clean.timeframes[tf].open_interest, old.timeframes[tf].open_interest);
  }
  assert.deepEqual([clean.success, clean.from_cache, clean.symbol, clean.metadata], [true, true, 'BTCUSDT', old.metadata]);
});

t('no cambia el objeto recibido', () => {
  const old = oldFormat();
  withoutSubdivisions(old);
  assert.equal(Object.values(old.timeframes).every(d => Array.isArray(d.subdivisions)), true);
});

t('los datos nuevos pasan tal cual, sin copiarse', () => {
  const clean = withoutSubdivisions(oldFormat());
  assert.equal(withoutSubdivisions(clean), clean);
  const partial = { timeframes: { '15m': { main: [] }, '1h': undefined } };
  assert.equal(withoutSubdivisions(partial), partial);
});

t('sin datos no falla', () => {
  assert.equal(withoutSubdivisions(null), null);
  assert.equal(withoutSubdivisions(undefined), undefined);
  const failure = { success: false, error: 'x' };
  assert.equal(withoutSubdivisions(failure), failure);
});

t('un marco con y otro sin la copia', () => {
  const old = oldFormat();
  delete old.timeframes['4h'].subdivisions;
  const clean = withoutSubdivisions(old);
  assert.equal(clean.timeframes['4h'], old.timeframes['4h']);
  assert.equal('subdivisions' in clean.timeframes['1m'], false);
});

t('la vela en formación, el precio y las órdenes no cambian sin la copia', () => {
  const old = oldFormat().timeframes;
  const clean = withoutSubdivisions({ timeframes: old }).timeframes;
  for (let now = 0; now <= 720 * MIN; now += 7 * MIN + 13000) {
    for (const tf of ['5m', '15m', '1h', '4h']) assert.deepEqual(formingCandle(clean, tf, now), formingCandle(old, tf, now));
    assert.equal(priceAt(clean, now), priceAt(old, now));
    assert.deepEqual(candlesToSettle(clean, Math.max(0, now - 45 * MIN), now), candlesToSettle(old, Math.max(0, now - 45 * MIN), now));
  }
});

console.log(`${count} de ${count} pruebas correctas`);
