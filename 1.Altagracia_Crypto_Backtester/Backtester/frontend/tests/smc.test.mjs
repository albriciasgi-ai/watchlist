// Estructura SMC: pivotes de tramo, BOS y CHoCH, order blocks con su vida, iguales y barridos, rango y niveles
// anteriores, y que lo conocido no cambie con velas posteriores. Uso: node tests/smc.test.mjs
import assert from 'node:assert/strict';
import { barsOf } from '../src/components/indicators/williams.js';
import {
  cleanSmcSettings, computeSmc, defaultSmcConfig, legPivots, nextPeriod, periodStart, previousLevels
} from '../src/components/indicators/smcStructure.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

function randomCandles(n, seed = 7, start = 100) {
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
    out.push({ timestamp: 1600000000000 + i * 3600000, open, high: Math.max(open, close) * (1 + rand() * 0.01), low: Math.min(open, close) * (1 - rand() * 0.01), close, volume: 100 });
    price = close;
  }
  return out;
}

// Velas desde una lista de cierres: cada vela abre en el cierre anterior y su mecha sale 0.2 de su cuerpo
const fromCloses = (closes) => closes.map((close, i) => {
  const open = i ? closes[i - 1] : close;
  return { timestamp: i * 60000, open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close, volume: 10 };
});
const config = (change = {}) => {
  const base = defaultSmcConfig();
  return { ...base, ...change, internal: { ...base.internal, ...(change.internal || {}) }, swing: { ...base.swing, ...(change.swing || {}) }, ob: { ...base.ob, ...(change.ob || {}) }, equal: { ...base.equal, ...(change.equal || {}) } };
};

test('pivotes de tramo: alternan, son el extremo del tramo y se saben length velas después', () => {
  const highs = [10, 11, 12, 13, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15, 16, 15, 14, 13, 12];
  const bars = barsOf(highs.map((h, i) => ({ timestamp: i * 60000, open: h - 0.5, high: h, low: h - 1, close: h - 0.5, volume: 1 })));
  const pivots = legPivots(bars.h, bars.l, 3);
  assert.deepEqual(pivots.map(p => [p.type, p.index, p.known]), [[-1, 0, 3], [1, 4, 7], [-1, 9, 12], [1, 16, 19]]);
  assert.equal(pivots[1].price, 14);
  // Con dos máximos iguales seguidos, el pivote es el segundo: el primero no supera a todas las velas siguientes
  const twin = legPivots(Float64Array.from([1, 2, 5, 5, 3, 2, 1]), Float64Array.from([0, 1, 4, 4, 2, 1, 0]), 2);
  assert.deepEqual(twin.filter(p => p.type > 0).map(p => p.index), [3]);
  for (let i = 1; i < pivots.length; i += 1) assert.equal(pivots[i].type, -pivots[i - 1].type);
});

test('BOS a favor de la tendencia y CHoCH al darla vuelta, al cierre de la vela que rompe', () => {
  // Sube con dos máximos que se rompen y después cae bajo el último mínimo
  const closes = [10, 12, 14, 16, 18, 16, 14, 13, 15, 17, 19, 21, 23, 21, 19, 18, 20, 22, 24, 26, 28, 26, 24, 22, 20, 18, 16, 14, 12];
  const bars = barsOf(fromCloses(closes));
  const r = computeSmc(bars, config({ internal: { length: 2 }, swing: { length: 3 } }));
  const swing = r.breaks.filter(b => b.scope === 'swing');
  assert.ok(swing.length >= 2, JSON.stringify(swing));
  assert.equal(swing[0].tag, 'BOS');
  const down = swing.find(b => b.dir < 0);
  assert.equal(down.tag, 'CHoCH', 'romper el mínimo en una tendencia alcista la da vuelta');
  // Cada ruptura es el primer cierre más allá del pivote, después de saberse el pivote
  for (const b of r.breaks) {
    const pivots = b.scope === 'swing' ? r.swingPivots : r.internalPivots;
    const p = pivots.find(x => x.index === b.pivot && x.type === b.dir);
    assert.ok(p.known < b.index);
    assert.ok(b.dir > 0 ? bars.c[b.index] > p.price : bars.c[b.index] < p.price);
    for (let j = p.known + 1; j < b.index; j += 1) assert.ok(b.dir > 0 ? bars.c[j] <= p.price : bars.c[j] >= p.price);
  }
  // La interna no repite el pivote de la mayor
  for (const b of r.breaks.filter(x => x.scope === 'internal')) {
    assert.ok(!swing.some(s => s.pivot === b.pivot && s.dir === b.dir));
  }
});

test('order block: la vela del mínimo entre el pivote roto y la ruptura, o la última vela contraria; su vida', () => {
  // Pivote máximo en 14 (vela 2), retroceso hasta 11 (vela 5, roja) y ruptura en la vela 8
  const closes = [10, 12, 14, 13, 12, 11, 12, 13, 15, 16, 15, 13.9, 12.5, 11.6, 10.4, 10.2];
  const candles = fromCloses(closes);
  const bars = barsOf(candles);
  const r = computeSmc(bars, config({ internal: { length: 2 }, swing: { length: 2 }, ob: { swing: true } }));
  const ob = r.obs.find(x => x.scope === 'swing' && x.dir > 0);
  assert.ok(ob, JSON.stringify(r.obs));
  assert.equal(ob.index, 5, 'la vela con el mínimo más bajo entre el pivote y la ruptura');
  assert.deepEqual([ob.top, ob.bottom], [bars.h[5], bars.l[5]]);
  assert.ok(ob.touched !== null && ob.touched > ob.known, 'el precio volvió a su borde');
  assert.ok(ob.broken !== null && bars.c[ob.broken] < ob.bottom, 'un cierre bajo su borde lejano lo rompe');
  // Con la última vela contraria y el cuerpo
  const body = computeSmc(bars, config({ internal: { length: 2 }, swing: { length: 2 }, ob: { pick: 'opposite', area: 'body' } }));
  const ob2 = body.obs.find(x => x.scope === 'swing' && x.dir > 0);
  assert.ok(bars.c[ob2.index] < bars.o[ob2.index], 'vela roja');
  assert.deepEqual([ob2.top, ob2.bottom], [Math.max(bars.o[ob2.index], bars.c[ob2.index]), Math.min(bars.o[ob2.index], bars.c[ob2.index])]);
});

test('breaker: el OB roto pasa al lado contrario hasta que un cierre lo atraviesa de vuelta', () => {
  const closes = [10, 12, 14, 13, 12, 11, 12, 13, 15, 16, 15, 13, 11.5, 10.3, 10.6, 11.2, 13, 14.5, 15];
  const bars = barsOf(fromCloses(closes));
  const r = computeSmc(bars, config({ internal: { length: 2 }, swing: { length: 2 } }));
  const ob = r.obs.find(x => x.scope === 'swing' && x.dir > 0 && x.broken !== null);
  assert.ok(ob, JSON.stringify(r.obs));
  assert.ok(ob.breakerTouched !== null && ob.breakerTouched > ob.broken);
  assert.ok(ob.breakerEnd !== null && bars.c[ob.breakerEnd] > ob.top);
  const without = computeSmc(bars, config({ internal: { length: 2 }, swing: { length: 2 }, ob: { breakers: false } }));
  assert.ok(without.obs.every(x => x.breakerEnd === null && x.breakerTouched === null));
});

test('iguales: dos máximos cortos casi al mismo precio, y su barrido con regreso', () => {
  const closes = [];
  for (let i = 0; i < 260; i += 1) closes.push(100 + Math.sin(i / 3) * 2); // Oscila: ATR estable
  closes.push(101, 103, 105, 103, 101, 99, 101, 103, 105.02, 103, 101, 99, 101, 104, 106.5, 104.5);
  const candles = fromCloses(closes);
  candles[candles.length - 2] = { ...candles[candles.length - 2], close: 104.2 }; // La vela que pasa el nivel cierra de vuelta abajo
  const bars = barsOf(candles);
  const r = computeSmc(bars, config({ equal: { length: 2, threshold: 0.5 } }));
  const eq = r.equals.filter(e => e.dir > 0 && e.index > 255);
  assert.ok(eq.length >= 1, JSON.stringify(r.equals.slice(-3)));
  const last = eq[eq.length - 1];
  assert.equal(last.level, Math.max(last.price, last.firstPrice));
  assert.ok(last.swept !== null && bars.h[last.swept] > last.level);
});

test('rango: del más viejo de los dos últimos pivotes mayores, estirado por lo que pasa sus bordes; tendencia', () => {
  const bars = barsOf(randomCandles(1200, 21));
  const r = computeSmc(bars);
  let checked = 0;
  for (let t = 300; t < r.n; t += 97) {
    if (!Number.isFinite(r.top[t]) || !Number.isFinite(r.bottom[t])) continue;
    assert.ok(r.top[t] >= r.bottom[t]);
    assert.ok(r.rangeStart[t] >= 0 && r.rangeStart[t] <= t);
    checked += 1;
  }
  assert.ok(checked > 5);
  // La tendencia de cada vela es la de la última ruptura mayor conocida
  const swing = r.breaks.filter(b => b.scope === 'swing');
  for (const b of swing) assert.equal(r.bias[b.index], b.dir);
});

test('lo conocido no cambia con velas posteriores', () => {
  const candles = randomCandles(1500, 33);
  const full = computeSmc(barsOf(candles));
  for (const m of [300, 777, 1234]) {
    const part = computeSmc(barsOf(candles.slice(0, m)));
    const known = (list) => list.filter(x => x.known < m);
    assert.deepEqual(part.swingPivots.map(p => [p.type, p.index, p.price, p.known]), known(full.swingPivots).map(p => [p.type, p.index, p.price, p.known]));
    assert.deepEqual(part.breaks, known(full.breaks));
    const ob = (x) => [x.scope, x.dir, x.index, x.top, x.bottom, x.known];
    assert.deepEqual(part.obs.map(ob), known(full.obs).map(ob));
    // Lo que pasó con cada OB antes de m pasó igual
    for (const x of part.obs) {
      const twin = full.obs.find(y => ob(y).join() === ob(x).join());
      for (const key of ['touched', 'half', 'broken', 'breakerTouched', 'breakerEnd']) {
        if (twin[key] !== null && twin[key] < m) assert.equal(x[key], twin[key], key);
        if (twin[key] === null || twin[key] >= m) assert.equal(x[key], null, `${key} no se sabe todavía`);
      }
    }
    const eq = (x) => [x.dir, x.first, x.index, x.level, x.known];
    assert.deepEqual(part.equals.map(eq), known(full.equals).map(eq));
    for (const key of ['top', 'bottom']) for (let t = 0; t < m; t += 1) assert.ok(Object.is(part[key][t], full[key][t]), `${key}[${t}]`);
    assert.deepEqual([...part.bias], [...full.bias.slice(0, m)]);
  }
});

test('niveles anteriores: el máximo y el mínimo del día, la semana desde el lunes y el mes, en UTC', () => {
  assert.equal(new Date(periodStart(Date.UTC(2026, 10, 19, 15), 'week')).toISOString(), '2026-11-16T00:00:00.000Z', 'el 19/11/2026 es jueves: la semana empezó el lunes 16');
  assert.equal(new Date(periodStart(Date.UTC(2026, 10, 19, 15), 'month')).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nextPeriod(Date.UTC(2026, 11, 1), 'month'), Date.UTC(2027, 0, 1));
  const candles = [];
  for (let i = 0; i < 24 * 4; i += 1) {
    const day = Math.floor(i / 24);
    candles.push({ timestamp: Date.UTC(2026, 10, 16, 0) + i * 3600000, open: 100, high: 100 + day + (i % 24 === 12 ? 5 : 0), low: 90 - day, close: 100 });
  }
  const levels = previousLevels(candles, 'day');
  // El primer día no cuenta como anterior: el 18 muestra los del 17, y el 19 los del 18
  assert.deepEqual(levels.map(x => [new Date(x.start).toISOString().slice(0, 10), x.high, x.low]), [['2026-11-18', 106, 89], ['2026-11-19', 107, 88]]);
});

test('lo que suma App 1: el step del footprint del OB y lo liquidado cerca de unos iguales, sin futuro', async () => {
  const { footprintStep, liquidatedNear, obVolumeFrom } = await import('../src/components/indicators/smcExtras.js');
  assert.equal(footprintStep(35678.8, 35384.9), 10, 'unas 30 franjas: 294 ÷ 30 ≈ 9.8 → 10');
  assert.equal(footprintStep(0.5123, 0.5011), 0.0005);
  assert.deepEqual(obVolumeFrom({ poc_price: 35500, total_delta: -659.3, total_volume: 10181 }), { poc: 35500, delta: -659.3, volume: 10181 });
  assert.equal(obVolumeFrom({ total_volume: 0 }), null);
  const day = 86400000;
  const known = 40 * day;
  // [desde, hasta, se sabe, bajo, alto, largos, cortos, fuente]
  const cells = [
    [known - day, known - day, known - day, 100.05, 100.05, 1000, 0, 0],      // Cerca y sabida antes: cuenta
    [known - day, known - day, known - day, 100.5, 100.5, 5000, 0, 0],        // Lejos (0.5%): no cuenta
    [known + 1, known + 1, known + 1, 100, 100, 7000, 0, 0],                  // Se sabe después: no cuenta
    [known - 31 * day, known - 31 * day, known - 31 * day, 100, 100, 9000, 0, 0], // Más de 30 días antes: no cuenta
    [known - 2 * day, known - 2 * day, known - 2 * day, 99.9, 100.1, 0, 300, 1] // Cortos que cruzan el nivel: cuenta
  ];
  assert.equal(liquidatedNear(cells, 100, known), 1300);
});

test('ajustes: números en su rango y la interna más corta que la mayor', () => {
  const clean = cleanSmcSettings({ internal: { length: 60 }, swing: { length: 40 }, ob: { pick: 'raro', internalCount: 999 }, equal: { threshold: 'x' } });
  assert.equal(clean.swing.length, 40);
  assert.ok(clean.internal.length < clean.swing.length);
  assert.equal(clean.ob.pick, 'extreme');
  assert.equal(clean.ob.internalCount, 50);
  assert.equal(clean.equal.threshold, 0.1);
});

test('rendimiento: 3,000 velas en pocos milisegundos', () => {
  const bars = barsOf(randomCandles(3000, 4));
  const t0 = performance.now();
  for (let k = 0; k < 10; k += 1) computeSmc(bars);
  const ms = (performance.now() - t0) / 10;
  assert.ok(ms < 40, `${ms.toFixed(1)} ms`);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FALLA  ${name}\n${error.stack}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasaron`);
process.exit(failed ? 1 : 0);
