// Pruebas de los fair value gaps: casos a mano y que el futuro no cambie lo conocido.
// Uso: node tests/fvg.test.mjs [velas.json]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findFairValueGaps } from '../src/components/indicators/FVGIndicator.js';

const bar = (timestamp, low, high, extra = {}) => ({ timestamp, low, high, open: low, close: high, ...extra });
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('gap alcista entre la primera y la tercera vela', () => {
  const gaps = findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135)]);
  assert.deepEqual(gaps, [{ bullish: true, bottom: 110, top: 120, start: 2, bornAt: 2 }]);
});

test('gap bajista entre la primera y la tercera vela', () => {
  const gaps = findFairValueGaps([bar(1, 120, 130), bar(2, 90, 125), bar(3, 95, 110)]);
  assert.deepEqual(gaps, [{ bullish: false, bottom: 110, top: 120, start: 2, bornAt: 2 }]);
});

test('sin hueco no hay gap', () => {
  assert.deepEqual(findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130), bar(3, 110, 135)]), []);
  assert.deepEqual(findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130)]), []);
});

test('el tamaño minimo se mide contra el precio', () => {
  const candles = [bar(1, 99900, 100000), bar(2, 99950, 100100), bar(3, 100025, 100200)];
  assert.equal(findFairValueGaps(candles, 0.03).length, 0, '0.025% no alcanza');
  assert.equal(findFairValueGaps(candles, 0.02).length, 1);
});

test('una vela que entra recorta el gap', () => {
  const gaps = findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 115, 136)]);
  assert.equal(gaps[0].top, 115);
  assert.equal(gaps[0].bottom, 110);
});

test('una vela que lo cruza lo elimina', () => {
  const gaps = findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 109, 136)]);
  assert.deepEqual(gaps, []);
  const exact = findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 110, 136)]);
  assert.deepEqual(exact, [], 'tocar el borde lo cierra');
});

test('un gap bajista se recorta desde abajo', () => {
  const gaps = findFairValueGaps([bar(1, 120, 130), bar(2, 90, 125), bar(3, 95, 110), bar(4, 90, 114)]);
  assert.equal(gaps[0].bottom, 114);
  assert.equal(gaps[0].top, 120);
});

test('la vela en formacion no crea gaps pero si los recorta', () => {
  const forming = bar(3, 120, 135, { in_progress: true });
  assert.deepEqual(findFairValueGaps([bar(1, 100, 110), bar(2, 105, 130), forming]), []);

  const candles = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 118, 136, { in_progress: true })];
  assert.equal(findFairValueGaps(candles)[0].top, 118);
});

test('varios gaps conviven y cada uno se cierra por su cuenta', () => {
  const candles = [
    bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135),
    bar(4, 125, 150), bar(5, 140, 155),
    bar(6, 128, 150)
  ];
  const gaps = findFairValueGaps(candles);
  assert.deepEqual(gaps.map(gap => [gap.bottom, gap.top]), [[110, 120]], 'la ultima vela cierra solo el gap de arriba');
});

test('al primer toque el gap termina si se pide', () => {
  const entered = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 118, 136)];
  assert.deepEqual(findFairValueGaps(entered, 0.03, { fillMode: 'touch' }), []);
  const touched = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 120, 136)];
  assert.deepEqual(findFairValueGaps(touched, 0.03, { fillMode: 'touch' }), [], 'llegar al borde cuenta como toque');
  const away = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 121, 136)];
  assert.equal(findFairValueGaps(away, 0.03, { fillMode: 'touch' }).length, 1);
});

test('un gap bajista tambien termina al primer toque', () => {
  const candles = [bar(1, 120, 130), bar(2, 90, 125), bar(3, 95, 110), bar(4, 90, 111)];
  assert.deepEqual(findFairValueGaps(candles, 0.03, { fillMode: 'touch' }), []);
});

test('sin recorte el gap conserva su tamano hasta cruzarlo', () => {
  const inside = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 112, 136)];
  const [gap] = findFairValueGaps(inside, 0.03, { fillMode: 'whole' });
  assert.deepEqual([gap.bottom, gap.top], [110, 120]);
  const crossed = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), bar(4, 110, 136)];
  assert.deepEqual(findFairValueGaps(crossed, 0.03, { fillMode: 'whole' }), []);
});

test('un gap bajista sin recorte termina al llegar a su techo', () => {
  const inside = [bar(1, 120, 130), bar(2, 90, 125), bar(3, 95, 110), bar(4, 90, 119)];
  assert.equal(findFairValueGaps(inside, 0.03, { fillMode: 'whole' }).length, 1);
  const crossed = [bar(1, 120, 130), bar(2, 90, 125), bar(3, 95, 110), bar(4, 90, 120)];
  assert.deepEqual(findFairValueGaps(crossed, 0.03, { fillMode: 'whole' }), []);
});

test('la edad maxima retira los gaps viejos', () => {
  const later = [bar(4, 125, 136), bar(5, 125, 136), bar(6, 125, 136)];
  const candles = [bar(1, 100, 110), bar(2, 105, 130), bar(3, 120, 135), ...later];
  assert.equal(findFairValueGaps(candles, 0.03, { maxAge: 3 }).length, 1, 'nace en la vela 3 y a la vela 6 tiene 3 velas');
  assert.deepEqual(findFairValueGaps(candles, 0.03, { maxAge: 2 }), []);
  assert.equal(findFairValueGaps(candles, 0.03, { maxAge: 0 }).length, 1, 'cero es sin limite');
});

// Con velas reales: agregar velas nunca crea un gap en el pasado ni lo agranda
const file = process.argv[2];
if (file) {
  test('el futuro no agrega gaps antiguos ni los agranda', () => {
    const candles = JSON.parse(readFileSync(file, 'utf8')).slice(0, 3000);
    const STEP = 37;
    let previous = [];
    let found = 0;
    for (let end = 3; end <= candles.length; end += STEP) {
      const gaps = findFairValueGaps(candles.slice(0, end));
      const known = new Map(previous.map(gap => [`${gap.start}|${gap.bullish}`, gap]));
      const firstNew = end > STEP ? candles[end - STEP - 2].timestamp : 0;
      for (const gap of gaps) {
        const before = known.get(`${gap.start}|${gap.bullish}`);
        if (before) assert.ok(gap.top <= before.top && gap.bottom >= before.bottom, 'un gap solo puede encogerse');
        else assert.ok(gap.start >= firstNew, 'un gap nuevo nace en velas nuevas');
      }
      found = Math.max(found, gaps.length);
      previous = gaps;
    }
    assert.ok(found > 0, 'los datos reales deben tener gaps');
  });
}

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}: ${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
