// Swing Detector: señales que llegan de afuera (las del servidor de la suite) y el precio de una vela que es swing
// alto y bajo a la vez. La regla completa se compara con el servidor en
// 12.AltagraciaTradingSuite/server/tests/swing_checks.py.
// Uso: node tests/swing.test.mjs
import assert from 'node:assert/strict';

const { default: Swing } = await import('../src/components/indicators/SwingDetectorIndicator.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
console.log = ((log) => (...args) => { if (String(args[0]).startsWith('ok')) log(...args); })(console.log);

const M15 = 900000;
const T0 = Date.UTC(2026, 10, 12, 0, 0);
// Zigzag: máximos y mínimos alternados cada 4 velas
const candles = Array.from({ length: 60 }, (_, i) => {
  const wave = [0, 2, 4, 2, 0, -2, -4, -2][i % 8];
  const mid = 100 + wave + i * 0.01;
  return { timestamp: T0 + i * M15, open: mid, high: mid + 1, low: mid - 1, close: mid, volume: 10 + (i % 5) };
});
const make = () => {
  const ind = new Swing('BTCUSDT', '15', 30);
  ind.updateConfig({ swingBars: 2 });
  return ind;
};

t('calcula sus señales sin nada de afuera', () => {
  const own = make().detectSwings(candles);
  assert.ok(own.length > 5);
});

t('con señales de afuera las usa en lugar de calcular, en orden de tiempo', () => {
  const ind = make();
  const outside = [
    { timestamp: T0 + 30 * M15, type: 'SWING_LOW', price: 95, direction: 'LONG', volumeZScore: 1.2, zoneId: null, isInRectangle: false },
    { timestamp: T0 + 10 * M15, type: 'SWING_HIGH', price: 105, direction: 'SHORT', volumeZScore: 0, zoneId: null, isInRectangle: false },
  ];
  ind.setExternalSignals(outside);
  const got = ind.detectSwings(candles);
  assert.deepEqual(got.map(s => s.timestamp), [T0 + 10 * M15, T0 + 30 * M15]);
  // Aunque no haya velas: lo que dibuja viene de afuera
  assert.equal(ind.detectSwings([]).length, 2);
  // Una lista vacía también reemplaza al cálculo: no se dibuja nada mientras llega lo del servidor
  ind.setExternalSignals([]);
  assert.equal(ind.detectSwings(candles).length, 0);
});

t('null vuelve al cálculo propio', () => {
  const ind = make();
  const own = ind.detectSwings(candles).map(s => s.timestamp);
  ind.setExternalSignals([{ timestamp: T0, type: 'SWING_LOW', price: 1, direction: 'LONG', volumeZScore: 0 }]);
  ind.detectSwings(candles);
  ind.setExternalSignals(null);
  assert.deepEqual(ind.detectSwings(candles).map(s => s.timestamp), own);
});

t('en reproducción, las de afuera también esperan su confirmación', () => {
  const ind = make();
  ind.setExternalSignals([
    { timestamp: T0 + 10 * M15, type: 'SWING_HIGH', price: 105, direction: 'SHORT', volumeZScore: 0 },
    { timestamp: T0 + 20 * M15, type: 'SWING_LOW', price: 95, direction: 'LONG', volumeZScore: 0 },
  ]);
  // La de las 20 se conoce al cerrar la vela 22 (swingBars 2): a la apertura de la 23
  ind.updatePlaybackTime(T0 + 23 * M15 - 1);
  assert.deepEqual(ind.detectSwings(candles).map(s => s.timestamp), [T0 + 10 * M15]);
  ind.updatePlaybackTime(T0 + 23 * M15);
  assert.equal(ind.detectSwings(candles).length, 2);
});

t('dibuja las señales de afuera y las ofrece como marcas', () => {
  const ind = make();
  ind.enabled = true;
  ind.setExternalSignals([{ timestamp: T0 + 10 * M15, type: 'SWING_HIGH', price: candles[10].high, direction: 'SHORT', volumeZScore: 2 }]);
  const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => ({ width: 10 })), set: (target, key, value) => { target[key] = value; return true; } });
  const priceContext = { minPrice: 90, maxPrice: 110, priceToY: (p) => 1000 - p * 5 };
  ind.renderOverlay(ctx, { x: 0, y: 0, width: 600, height: 400 }, candles, candles, priceContext);
  assert.equal(ind.marks.length, 1);
  assert.equal(ind.marks[0].time, T0 + 10 * M15);
  assert.equal(ind.marks[0].price, candles[10].high);
});

t('una vela que es swing alto y bajo a la vez queda como alto con su máximo', () => {
  const rows = candles.map(c => ({ ...c }));
  const k = 30;
  rows[k].high = Math.max(...rows.slice(k - 2, k + 3).map(c => c.high)) + 5;
  rows[k].low = Math.min(...rows.slice(k - 2, k + 3).map(c => c.low)) - 5;
  const both = make().detectSwings(rows).filter(s => s.timestamp === rows[k].timestamp);
  assert.equal(both.length, 1);
  assert.equal(both[0].type, 'SWING_HIGH');
  assert.equal(both[0].direction, 'SHORT');
  assert.equal(both[0].price, rows[k].high);
});

process.stdout.write(`${count} pruebas pasan\n`);
