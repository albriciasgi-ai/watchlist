// Monte Carlo de trades (dashboard de App 1, journal de la suite y probador): cuánto pudo cambiar la curva por el
// orden y la suerte, con los resultados de los trades ya hechos.
// Uso: node tests/montecarlo.test.mjs
import assert from 'node:assert/strict';

const { monteCarlo, pathStats, quantile, checkpoints, seeded, seedOf, blocksOf, resultsByExit, SMALL_SAMPLE } = await import(
  '../src/components/backtesting/dashboard/monteCarlo.js'
);

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
const near = (a, b, tolerance, text) => assert.ok(Math.abs(a - b) <= tolerance, `${text}: ${a} contra ${b}`);

// 200 trades: 40% ganan 2 y 60% pierden 1 (esperanza +0.2 por trade)
const random = seeded(7);
const sample = Array.from({ length: 200 }, () => (random() < 0.4 ? 2 : -1));

t('percentil con interpolación y casos borde', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([1, 2, 3], 0), 1);
  assert.equal(quantile([1, 2, 3], 1), 3);
  assert.equal(quantile([9], 0.3), 9);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

t('caída y racha de una serie, empezando en cero', () => {
  // Acumulado: 2, 1, 0, 3, 2, 1, 0, -1 → pico 3, fondo -1: caída 4; racha de 4 pérdidas
  const stats = pathStats([2, -1, -1, 3, -1, -1, -1, -1]);
  assert.equal(stats.final, -1);
  assert.equal(stats.drawdown, 4);
  assert.equal(stats.streak, 4);
  // Una serie que solo pierde cae desde cero, no desde su primer valor
  assert.equal(pathStats([-1, -1]).drawdown, 2);
  // El cero no es pérdida: corta la racha
  assert.equal(pathStats([-1, 0, -1]).streak, 1);
});

t('puntos de la curva: todos si caben, repartidos y con el último si no', () => {
  assert.deepEqual(checkpoints(4), [1, 2, 3, 4]);
  const many = checkpoints(5000, 120);
  assert.equal(many.length, 120);
  assert.equal(many[many.length - 1], 5000);
  assert.ok(many.every((v, i) => i === 0 || v > many[i - 1]));
});

t('la misma semilla da las mismas corridas, y la semilla sale de los trades', () => {
  const a = monteCarlo(sample, { runs: 500 });
  const b = monteCarlo(sample, { runs: 500 });
  assert.deepEqual(a.final, b.final);
  assert.deepEqual(a.bands, b.bands);
  assert.notEqual(seedOf(sample), seedOf([...sample, 2]));
  const c = monteCarlo(sample, { runs: 500, seed: 99 });
  assert.notDeepEqual(a.final, c.final);
});

t('con menos de 2 trades no hay nada que simular; lo que no es número se salta', () => {
  assert.equal(monteCarlo([]), null);
  assert.equal(monteCarlo([1]), null);
  assert.equal(monteCarlo(null), null);
  const result = monteCarlo([1, NaN, -1, undefined, 2, null, Infinity], { runs: 200 });
  assert.equal(result.n, 3);
});

t('barajando, el resultado final es siempre el real; cambian la caída y la racha', () => {
  const result = monteCarlo(sample, { runs: 800, method: 'shuffle' });
  const real = sample.reduce((a, b) => a + b, 0);
  near(result.final.p5, real, 1e-9, 'final p5');
  near(result.final.p95, real, 1e-9, 'final p95');
  assert.equal(result.real.final, real);
  assert.ok(result.drawdown.p95 > result.drawdown.p5, 'la caída sí cambia con el orden');
  // La última banda es el resultado final, igual en todas las corridas
  near(result.bands[result.bands.length - 1].p50, real, 1e-9, 'última banda');
  // Parte de las corridas que termina en negativo: ninguna o todas
  assert.equal(result.lossShare, real < 0 ? 1 : 0);
});

t('remuestreando, el final se reparte alrededor del real con el ancho que da la teoría', () => {
  const result = monteCarlo(sample, { runs: 4000 });
  const n = sample.length;
  const mean = sample.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(sample.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  const expectedHalf = 1.645 * sd * Math.sqrt(n); // del 5% al 95%: ±1.645 errores
  near(result.final.p50, mean * n, sd * Math.sqrt(n) * 0.15, 'mediana del final');
  near((result.final.p95 - result.final.p5) / 2, expectedHalf, expectedHalf * 0.12, 'ancho del final');
  assert.ok(result.lossShare >= 0 && result.lossShare <= 1);
  assert.ok(result.final.p5 < result.final.p25 && result.final.p25 < result.final.p50);
  assert.ok(result.final.p50 < result.final.p75 && result.final.p75 < result.final.p95);
});

t('las bandas tienen un punto por trade guardado y se abren al avanzar', () => {
  const result = monteCarlo(sample, { runs: 1000 });
  assert.equal(result.at.length, result.bands.length);
  assert.equal(result.at.length, result.actual.length);
  assert.equal(result.at[result.at.length - 1], sample.length);
  const first = result.bands[0];
  const last = result.bands[result.bands.length - 1];
  assert.ok(last.p95 - last.p5 > first.p95 - first.p5);
  // La curva real, en los mismos puntos
  near(result.actual[result.actual.length - 1], sample.reduce((a, b) => a + b, 0), 1e-9, 'curva real');
  assert.equal(result.actual[0], sample.slice(0, result.at[0]).reduce((a, b) => a + b, 0));
});

t('con miles de trades las bandas se muestrean y el final sigue siendo el de todos', () => {
  const big = Array.from({ length: 5000 }, (_, i) => sample[i % sample.length]);
  const result = monteCarlo(big, { runs: 300, method: 'shuffle' });
  assert.ok(result.at.length <= 120);
  assert.equal(result.n, 5000);
  near(result.final.p50, big.reduce((a, b) => a + b, 0), 1e-6, 'final con muestreo');
});

t('avisa con muestra pequeña y dice dónde cae la caída real', () => {
  assert.equal(monteCarlo(sample.slice(0, SMALL_SAMPLE - 1), { runs: 200 }).small, true);
  assert.equal(monteCarlo(sample.slice(0, SMALL_SAMPLE), { runs: 200 }).small, false);
  const result = monteCarlo(sample, { runs: 1000, method: 'shuffle' });
  assert.ok(result.drawdownRank >= 0 && result.drawdownRank <= 1);
  // El peor orden posible (todas las pérdidas seguidas, primero las ganancias) queda arriba de casi todas las corridas
  const worst = [...sample].sort((a, b) => b - a);
  assert.ok(monteCarlo(worst, { runs: 1000, method: 'shuffle' }).drawdownRank > 0.99);
});

t('las corridas se acotan: ni menos de 100 ni más de 20,000', () => {
  assert.equal(monteCarlo(sample, { runs: 3 }).runs, 100);
  assert.equal(monteCarlo(sample.slice(0, 20), { runs: 1e9 }).runs, 20000);
});

t('por bloques: los trades de una semana van juntos, y con trades que se mueven juntos las bandas son más anchas', () => {
  assert.deepEqual(blocksOf([1, 2, 3, 4], ['a', 'a', 'b', 'a']), [[1, 2, 4], [3]]);
  assert.equal(blocksOf([1, 2], ['a', 'a']), null);
  assert.equal(blocksOf([1, 2], null), null);
  // 60 semanas de 5 trades iguales entre sí: toda la semana gana o toda pierde
  const dice = seeded(11);
  const weekly = [];
  const weeks = [];
  for (let w = 0; w < 60; w++) {
    const v = dice() < 0.4 ? 2 : -1;
    for (let k = 0; k < 5; k++) { weekly.push(v); weeks.push(w); }
  }
  const loose = monteCarlo(weekly, { runs: 3000 });
  const blocked = monteCarlo(weekly, { runs: 3000, groups: weeks });
  assert.equal(loose.blocks, null);
  assert.equal(blocked.blocks, 60);
  const width = (r) => r.final.p95 - r.final.p5;
  // Con 5 trades idénticos por semana, el ancho real es raíz de 5 veces el de trades independientes (2.24)
  const ratio = width(blocked) / width(loose);
  assert.ok(ratio > 1.9 && ratio < 2.6, `razón de anchos ${ratio}`);
  // Barajar bloques conserva el resultado final
  const shuffled = monteCarlo(weekly, { runs: 300, groups: weeks, method: 'shuffle' });
  near(shuffled.final.p5, weekly.reduce((a, b) => a + b, 0), 1e-9, 'final por bloques');
  // Grupos de otro largo que los resultados no se usan
  assert.equal(monteCarlo(weekly, { runs: 200, groups: [1, 2] }).blocks, null);
});

t('trades del probador: en orden de salida y con la semana de cada salida', () => {
  const WEEK = 7 * 24 * 3600 * 1000;
  const { results, weeks } = resultsByExit([
    { exit_t: 3 * WEEK + 5, r: 2 }, [0, WEEK + 1, -1], { exit_t: 3 * WEEK + 9, r: 0.5 }, { exit_t: NaN, r: 1 }, { exit_t: 5, r: null },
  ]);
  assert.deepEqual(results, [-1, 2, 0.5]);
  assert.deepEqual(weeks, [1, 3, 3]);
});

console.log(`\n${count} pruebas de Monte Carlo pasaron`);
