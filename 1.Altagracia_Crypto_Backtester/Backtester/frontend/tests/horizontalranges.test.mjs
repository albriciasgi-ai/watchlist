// Pruebas del indicador "Rangos horizontales": que sus cajas sean las de los detectores, que lo conocido no cambie con
// velas posteriores, que la vela en formación no cuente, que en vivo (arreglo corrido) dé lo mismo y que el modal acote.
// Uso: node tests/horizontalranges.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);
const say = (...args) => process.stdout.write(`${args.join(' ')}\n`);
console.log = () => {};
console.warn = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const {
  default: HorizontalRangesIndicator, METHODS, computeRanges, cleanHorizontalRangesSettings, defaultHorizontalRangesConfig, intervalMinutes
} = await import('../src/components/indicators/HorizontalRangesIndicator.js');
const { runDetector, toArrays } = await import('../src/components/indicators/regimeDetectors.js');

const tests = [];
const test = (name, run) => tests.push([name, run]);

// Velas reales de BTC 4h del caché de App 1; sin él, un camino al azar reproducible
function loadCandles() {
  const file = new URL('../../backend/backtesting_cache/BTCUSDT_backtesting_data.json.gz', import.meta.url);
  if (existsSync(file)) {
    const raw = JSON.parse(gunzipSync(readFileSync(file)));
    const main = (raw.timeframes || raw)['4h']?.main;
    if (main?.length > 1500) return main.slice(-1500).map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  }
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  let price = 100;
  for (let i = 0; i < 1500; i += 1) {
    const open = price;
    price *= 1 + (rnd() - 0.5) * 0.02 * (i % 300 < 150 ? 0.3 : 1.5);
    out.push({ timestamp: 1700000000000 + i * 14400000, open, high: Math.max(open, price) * (1 + rnd() * 0.004), low: Math.min(open, price) * (1 - rnd() * 0.004), close: price, volume: 100 + rnd() * 900 });
  }
  return out;
}
const CANDLES = loadCandles();
const STEP = 240 * 60000;
const cfg = (method, extra = {}) => ({ ...defaultHorizontalRangesConfig(), method, ...extra });
const same = (a, b) => a.start === b.start && a.known === b.known && a.end === b.end && a.low === b.low && a.high === b.high;

test('las cajas son las del detector, en horas: empieza al abrir su primera vela y se supo al cerrar la de detección', () => {
  for (const method of METHODS) {
    const { zones } = computeRanges(CANDLES, cfg(method), 240);
    const bars = toArrays(CANDLES);
    const direct = runDetector(method, bars, 240, defaultHorizontalRangesConfig().params[method]).zones;
    assert.equal(zones.length, direct.length, method);
    zones.forEach((z, k) => {
      const d = direct[k];
      assert.equal(z.start, CANDLES[d.start].timestamp, `${method} start`);
      assert.equal(z.known, CANDLES[d.detected].timestamp + STEP, `${method} known`);
      assert.equal(z.end, CANDLES[d.end].timestamp + STEP, `${method} end`);
      assert.equal(z.low, d.low);
      assert.equal(z.high, d.high);
      assert.ok(z.known > z.start && z.end >= z.known, `${method}: se supo después de empezar y antes de terminar`);
    });
  }
});

// atr_range queda fuera a propósito: repinta (un cierre fuera que no alcanza a terminar el rango pasa a contar como rango
// si el precio vuelve), como su original en Python. El indicador lo calcula siempre con lo conocido, así que no ve el futuro
test('lo conocido en una hora no cambia al sumar velas posteriores (todos menos atr_range), también el rango mayor', () => {
  for (const method of METHODS.filter(m => m !== 'atr_range')) {
    for (const cut of [900, 1100, 1300]) {
      const early = computeRanges(CANDLES.slice(0, cut), cfg(method, { major: true }), 240);
      const late = computeRanges(CANDLES, cfg(method, { major: true }), 240);
      for (const [kind, a, b] of [['caja', early.zones, late.zones], ['mayor', early.majors, late.majors]]) {
        for (const z of a.filter(z => !z.live)) {
          assert.ok(b.some(w => same(w, z)), `${method} ${kind} terminada antes de la vela ${cut} cambió con velas posteriores`);
        }
        for (const z of a.filter(z => z.live)) {
          assert.ok(b.some(w => w.start === z.start && w.known === z.known), `${method} ${kind} viva en ${cut} desapareció`);
        }
      }
    }
  }
});

test('la vela en formación no crea, cierra ni mueve rangos', () => {
  const indicator = new HorizontalRangesIndicator('BTCUSDT', '4h');
  indicator.updateConfig({ method: 'er_box', major: true });
  const visible = CANDLES.slice(-300);
  const closed = indicator._rangesFor(visible, CANDLES);
  indicator.cacheKey = null;
  const last = CANDLES[CANDLES.length - 1];
  const forming = { timestamp: last.timestamp + STEP, open: last.close, high: last.close * 1.3, low: last.close * 0.7, close: last.close * 1.25, volume: 1e9, in_progress: true };
  const withForming = indicator._rangesFor([...visible, forming], [...CANDLES, forming]);
  assert.deepEqual(withForming, closed);
});

test('en vivo, con el arreglo corrido por delante, las cajas de lo que quedó son las mismas (er y ttm, que miran solo su ventana)', () => {
  for (const method of ['er', 'ttm']) {
    const full = computeRanges(CANDLES.slice(200), cfg(method), 240).zones;
    const shifted = computeRanges(CANDLES.slice(300), cfg(method), 240).zones;
    const after = CANDLES[300 + 60].timestamp; // Lejos del arranque del arreglo corto
    for (const z of shifted.filter(z => z.start >= after)) assert.ok(full.some(w => same(w, z)), `${method} cambió al correr el arreglo`);
  }
});

test('el indicador no dibuja con la vela que aún no cerró, ni ocupa panel, ni recalcula sin cambios', () => {
  const indicator = new HorizontalRangesIndicator('BTCUSDT', '4h');
  assert.equal(indicator.getHeight(), 0);
  assert.equal(indicator.enabled, false);
  const visible = CANDLES.slice(-300);
  const first = indicator._rangesFor(visible, CANDLES);
  const again = indicator._rangesFor(visible, CANDLES);
  assert.equal(first, again, 'misma ventana: el mismo resultado guardado');
  indicator.updateConfig({ method: 'ttm' });
  assert.notEqual(indicator._rangesFor(visible, CANDLES), first, 'otros ajustes: se recalcula');
});

test('el modal acota los valores, deja vacío lo que puede ir vacío y vuelve al método de fábrica si no lo conoce', () => {
  const clean = cleanHorizontalRangesSettings({
    method: 'nada', majorAtr: 900, majorOut: 2.6, opacity: 5,
    params: { er_box: { n: 1, below: 3, exit_er: '', buffer: 'x' }, adx: { below: 0 }, vp_prog: { range_atr: null, min_c: 1000 } }
  });
  assert.equal(clean.method, 'er_box');
  assert.equal(clean.majorAtr, 50);
  assert.equal(clean.majorOut, 3);
  assert.equal(clean.opacity, 0.6);
  assert.equal(clean.params.er_box.n, 2);
  assert.equal(clean.params.er_box.below, 1);
  assert.equal(clean.params.er_box.exit_er, null);
  assert.equal(clean.params.er_box.buffer, 0.5, 'texto que no es número: vuelve al afinado');
  assert.equal(clean.params.adx.below, 1);
  assert.equal(clean.params.vp_prog.range_atr, null);
  assert.equal(clean.params.vp_prog.min_c, 500);
  assert.deepEqual(Object.keys(clean.params).sort(), [...METHODS].sort());
});

test('el marco del gráfico se lee en minutos, con la M mayúscula como mes', () => {
  assert.equal(intervalMinutes('1m'), 1);
  assert.equal(intervalMinutes('15m'), 15);
  assert.equal(intervalMinutes('4h'), 240);
  assert.equal(intervalMinutes('240'), 240);
  assert.equal(intervalMinutes('1D'), 1440);
  assert.equal(intervalMinutes('D'), 1440);
  assert.equal(intervalMinutes('1W'), 10080);
  assert.equal(intervalMinutes('1M'), 43200);
});

test('está en el administrador de indicadores, apagado, sobre las velas y no en el primer lugar', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, data: [], patterns: [] }) });
  const { default: IndicatorManager } = await import('../src/components/indicators/IndicatorManager.js');
  const manager = new IndicatorManager('BTCUSDT', '4h', 30);
  await manager.initialize(true, CANDLES[0].timestamp);
  const indicator = manager.getHorizontalRangesIndicator();
  assert.ok(indicator instanceof HorizontalRangesIndicator);
  assert.equal(indicator.name, 'Rangos horizontales');
  assert.ok(manager.indicators.indexOf(indicator) > 0);
  assert.equal(indicator.getHeight(), 0);
  manager.destroy?.();
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    say(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    say(`MAL ${name}\n    ${error.message}`);
  }
}
say(`\n${tests.length - failed} de ${tests.length} pasaron (${CANDLES.length} velas)`);
process.exit(failed ? 1 : 0);
