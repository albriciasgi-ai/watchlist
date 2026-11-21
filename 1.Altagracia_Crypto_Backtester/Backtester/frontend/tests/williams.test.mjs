// Indicadores de Bill Williams: fórmulas, fractales, los tres sabios y que lo conocido no cambie con velas posteriores.
// Uso: node tests/williams.test.mjs
import assert from 'node:assert/strict';
import {
  alligatorState, barsOf, cleanWilliamsSettings, computeWilliams, defaultWilliamsConfig, directions, formingValues, fractals,
  shifted, sma, smma, wiseMen
} from '../src/components/indicators/williams.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

// Paseo al azar con semilla: velas de 4 horas
export function randomCandles(n, seed = 7, start = 100) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out = [];
  let price = start;
  for (let i = 0; i < n; i += 1) {
    const open = price;
    const close = open * (1 + (rand() - 0.5) * 0.04);
    const high = Math.max(open, close) * (1 + rand() * 0.015);
    const low = Math.min(open, close) * (1 - rand() * 0.015);
    out.push({ timestamp: 1600000000000 + i * 14400000, open, high, low, close, volume: 100 + rand() * 900 });
    price = close;
  }
  return out;
}

const fromHL = (pairs) => pairs.map(([h, l], i) => ({ timestamp: i * 60000, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 10 }));

test('medias: la simple con suma corrida y la suavizada de Wilder sembrada con la simple', () => {
  const values = Float64Array.from([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...sma(values, 3)].map(v => (Number.isNaN(v) ? null : v)), [null, null, 2, 3, 4, 5]);
  const s = smma(values, 3);
  assert.equal(s[2], 2);
  assert.equal(s[3], (2 * 2 + 4) / 3);
  assert.equal(s[4], (s[3] * 2 + 5) / 3);
  assert.ok(Number.isNaN(s[1]));
  // Con NaN al principio (el AO antes de 34 velas) arranca en el primer valor
  const withGap = Float64Array.from([NaN, NaN, 4, 6, 8]);
  assert.deepEqual([...sma(withGap, 2)].map(v => (Number.isNaN(v) ? null : v)), [null, null, null, 5, 7]);
});

test('el AO de una subida en línea recta es la pendiente por 14.5 velas, y el Alligator va desplazado', () => {
  const candles = Array.from({ length: 80 }, (_, i) => ({ timestamp: i * 60000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1 }));
  const r = computeWilliams(barsOf(candles));
  assert.ok(Number.isNaN(r.ao[32]));
  assert.ok(Math.abs(r.ao[33] - 14.5) < 1e-9, `AO ${r.ao[33]}`);
  assert.ok(Math.abs(r.ao[79] - 14.5) < 1e-9);
  // La mandíbula de la vela 30 es la SMMA de 13 de la vela 22
  assert.equal(r.jaw[30], r.jawRaw[22]);
  assert.equal(r.teeth[30], r.teethRaw[25]);
  assert.equal(r.lips[30], r.lipsRaw[27]);
  // Subida pareja: despierto al alza (labios sobre dientes sobre mandíbula) cuando la abertura pasa de media ATR
  assert.equal(r.state[60], 1);
  // AO constante: el color se conserva; el AC es 0 y su color también
  assert.equal(r.aoDir[79], r.aoDir[78]);
  assert.ok(Math.abs(r.ac[79]) < 1e-9);
});

test('los colores de una serie: un empate conserva el anterior', () => {
  assert.deepEqual([...directions(Float64Array.from([NaN, 1, 2, 2, 1, 1, 3]))], [0, 0, 1, 1, -1, -1, 1]);
  const flat = Float64Array.from([5, 5, 5]);
  assert.deepEqual([...shifted(Float64Array.from([1, 2, 3, 4]), 2)].map(v => (Number.isNaN(v) ? null : v)), [null, null, 1, 2]);
  const state = alligatorState(Float64Array.from([10, 10]), Float64Array.from([11, 10]), Float64Array.from([12, 10]), flat, 0.1);
  assert.deepEqual([...state], [1, 0], 'abiertas en orden: al alza; juntas: duerme');
});

test('fractales: dos máximos menores a cada lado, los iguales de la derecha se saltan y se sabe al segundo menor', () => {
  // Patrón A: 1 2 5 3 2 → fractal en la vela 2, se sabe en la 4
  const a = fractals(Float64Array.from([1, 2, 5, 3, 2]), Float64Array.from([0, 1, 4, 2, 1]));
  assert.deepEqual(a.filter(f => f.dir > 0).map(f => [f.index, f.price, f.known]), [[2, 5, 4]]);
  // Patrón D: un igual a la derecha pide una vela más (6 velas)
  const d = fractals(Float64Array.from([1, 2, 5, 3, 5, 2]), Float64Array.from([0, 1, 4, 2, 4, 1]));
  assert.deepEqual(d.filter(f => f.dir > 0).map(f => [f.index, f.known]), [[2, 5]], 'la vela 4 iguala y no es otro fractal');
  // Uno mayor a la derecha lo descarta
  const none = fractals(Float64Array.from([1, 2, 5, 6, 2, 1]), Float64Array.from([0, 1, 4, 5, 1, 0]));
  assert.deepEqual(none.filter(f => f.dir > 0).map(f => f.index), [3]);
  // Mínimos al revés
  const low = fractals(Float64Array.from([9, 8, 7, 8, 9]), Float64Array.from([5, 4, 1, 3, 4]));
  assert.deepEqual(low.filter(f => f.dir < 0).map(f => [f.index, f.price, f.known]), [[2, 1, 4]]);
});

test('MFI: verde, fade, fake y squat, y las zonas con el AO y el AC', () => {
  const candles = [
    { timestamp: 0, open: 10, high: 11, low: 9, close: 10, volume: 100 },   // MFI 0.02
    { timestamp: 1, open: 10, high: 13, low: 9, close: 12, volume: 120 },   // MFI 0.033 sube, volumen sube: verde
    { timestamp: 2, open: 12, high: 13, low: 12, close: 12.5, volume: 80 }, // MFI 0.0125 baja, volumen baja: fade
    { timestamp: 3, open: 12, high: 14, low: 11, close: 13, volume: 60 },   // MFI 0.05 sube, volumen baja: fake
    { timestamp: 4, open: 13, high: 13.5, low: 13, close: 13.2, volume: 90 } // MFI 0.0056 baja, volumen sube: squat
  ];
  const r = computeWilliams(barsOf(candles));
  assert.deepEqual([...r.mfiType], [0, 1, 2, 3, 4]);
});

test('primer sabio: barra divergente alcista lejos de la boca, con angulación y el AO rojo; se llena al pasar su máximo', () => {
  // 60 velas de bajada pareja y después una vela que hace un mínimo más bajo y cierra arriba
  const candles = [];
  for (let i = 0; i < 70; i += 1) {
    const mid = i < 50 ? 200 - i : 150 - (i - 50) * 2.5; // La caída se acelera: el precio se aleja de la mandíbula
    candles.push({ timestamp: i * 60000, open: mid + 0.4, high: mid + 1, low: mid - 1, close: mid - 0.4, volume: 10 });
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  // La barra divergente: mínimo más bajo y cierre en la mitad de arriba
  candles.push({ timestamp: 70 * 60000, open: prev.close - 1, high: prev.close - 0.5, low: last.low - 3, close: prev.close - 0.8, volume: 10 });
  candles.push({ timestamp: 71 * 60000, open: prev.close - 0.8, high: prev.close + 1, low: prev.close - 1.2, close: prev.close + 0.8, volume: 10 });
  const bars = barsOf(candles);
  const r = computeWilliams(bars);
  const w1 = r.signals.filter(s => s.wise === 1);
  assert.equal(w1.length, 1, JSON.stringify(w1));
  assert.deepEqual([w1[0].dir, w1[0].index, w1[0].entry, w1[0].stop], [1, 70, candles[70].high, candles[70].low]);
  assert.equal(w1[0].end, 'filled');
  assert.equal(w1[0].filledAt, 71);
  // Sin el AO en contra exigido sale igual; con un hueco mínimo enorme no sale
  const cfg = defaultWilliamsConfig();
  const strict = computeWilliams(bars, { ...cfg, wise: { ...cfg.wise, minGapAtr: 50 } });
  assert.equal(strict.signals.filter(s => s.wise === 1).length, 0);
});

test('segundo sabio: la tercera barra seguida del mismo color del AO tras una del otro', () => {
  const bars = barsOf(randomCandles(400, 3));
  const r = computeWilliams(bars);
  const w2 = r.signals.filter(s => s.wise === 2);
  assert.ok(w2.length > 5);
  for (const s of w2) {
    const i = s.index;
    assert.equal(r.aoDir[i], s.dir);
    assert.equal(r.aoDir[i - 1], s.dir);
    assert.equal(r.aoDir[i - 2], s.dir);
    assert.equal(r.aoDir[i - 3], -s.dir);
    assert.equal(s.entry, s.dir > 0 ? bars.h[i] : bars.l[i]);
  }
});

test('tercer sabio: pasa el último fractal de su lado del lado correcto de los dientes', () => {
  const bars = barsOf(randomCandles(600, 11));
  const r = computeWilliams(bars);
  const w3 = r.signals.filter(s => s.wise === 3);
  assert.ok(w3.length > 5);
  for (const s of w3) {
    const f = r.fractals.find(x => x.index === s.fractal && x.dir === s.dir);
    assert.ok(f && f.known < s.index, 'se toca después de saberse');
    assert.ok(s.dir > 0 ? bars.h[s.index] > s.entry && s.entry > r.teeth[s.index] : bars.l[s.index] < s.entry && s.entry < r.teeth[s.index]);
    // Entre que se supo y que se tocó, ninguna vela lo pasó y ningún fractal nuevo de su lado lo reemplazó
    for (let j = f.known + 1; j < s.index; j += 1) assert.ok(s.dir > 0 ? bars.h[j] <= s.entry : bars.l[j] >= s.entry);
    assert.ok(!r.fractals.some(x => x.dir === s.dir && x.known > f.known && x.known < s.index));
  }
});

test('lo conocido no cambia con velas posteriores', () => {
  const candles = randomCandles(900, 5);
  const full = computeWilliams(barsOf(candles));
  for (const m of [150, 437, 701]) {
    const part = computeWilliams(barsOf(candles.slice(0, m)));
    for (const key of ['jaw', 'teeth', 'lips', 'ao', 'ac', 'zone', 'gUp', 'gDown', 'mfi']) {
      for (let i = 0; i < m; i += 1) {
        const a = part[key][i];
        const b = full[key][i];
        assert.ok(Object.is(a, b) || a === b, `${key}[${i}] ${a} ≠ ${b}`);
      }
    }
    for (const key of ['aoDir', 'acDir', 'mfiType', 'state']) assert.deepEqual([...part[key]], [...full[key].slice(0, m)], key);
    assert.deepEqual(part.fractals, full.fractals.filter(f => f.known < m));
    const core = (s) => [s.wise, s.dir, s.index, s.entry, s.stop];
    assert.deepEqual(part.signals.map(core), full.signals.filter(s => s.known < m).map(core), `señales hasta ${m}`);
    // Lo que se resolvió antes de m se resolvió igual
    for (const s of part.signals) {
      const twin = full.signals.find(x => core(x).join() === core(s).join());
      if (twin.endAt !== null && twin.endAt < m) assert.deepEqual([s.end, s.endAt], [twin.end, twin.endAt]);
    }
  }
});

test('la vela en formación: AO, AC y zona provisionales, sin cambiar lo calculado', () => {
  const candles = randomCandles(200, 9);
  const closed = candles.slice(0, 199);
  const bars = barsOf(closed);
  const r = computeWilliams(bars);
  const forming = formingValues(r, bars, candles[199]);
  const all = computeWilliams(barsOf(candles));
  assert.ok(Math.abs(forming.ao - all.ao[199]) < 1e-9);
  assert.ok(Math.abs(forming.ac - all.ac[199]) < 1e-9);
  assert.equal(forming.aoDir, all.aoDir[199]);
  assert.equal(forming.zone, all.zone[199]);
  assert.equal(forming.jaw, all.jaw[199]);
  assert.ok(Math.abs(forming.gUp - all.gUp[199]) < 1e-12);
});

test('ajustes: números en su rango y la rápida del AO más corta que la lenta', () => {
  const clean = cleanWilliamsSettings({ alligator: { jawLen: '500', lipsShift: 'x' }, ao: { fast: 40, slow: 34 }, zones: { mode: 'raro' } });
  assert.equal(clean.alligator.jawLen, 200);
  assert.equal(clean.alligator.lipsShift, 3);
  assert.deepEqual([clean.ao.fast, clean.ao.slow], [5, 34]);
  assert.equal(clean.zones.mode, 'candles');
  assert.equal(clean.wise.pendingBars, 5);
});

test('rendimiento: 3,000 velas en pocos milisegundos', () => {
  const bars = barsOf(randomCandles(3000, 2));
  const t0 = performance.now();
  for (let k = 0; k < 10; k += 1) computeWilliams(bars);
  const ms = (performance.now() - t0) / 10;
  assert.ok(ms < 30, `${ms.toFixed(1)} ms`);
  assert.equal(typeof wiseMen, 'function');
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
