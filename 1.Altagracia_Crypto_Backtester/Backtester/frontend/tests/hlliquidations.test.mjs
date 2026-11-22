// Liquidaciones Hyperliquid (21/11/2026): franjas elegidas, etiquetas y opacidad. Uso: node tests/hlliquidations.test.mjs
import assert from 'node:assert/strict';

const { pickBands, bandLabel, bandAlpha, ageText } = await import('../src/components/hlLiquidations.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

const B = (lo, hi, long_usd, short_usd, wallets = 1) => ({ lo, hi, long_usd, short_usd, wallets });
const buckets = [
  B(46000, 46300, 31_000_000, 0, 2),   // largos lejos, abajo
  B(57000, 57300, 800_000, 0),         // largos cerca
  B(58000, 58300, 200_000, 0),         // bajo el mínimo
  B(59000, 59300, 2_000_000, 0, 3),
  B(59500, 59800, 1_500_000, 0),
  B(61500, 61800, 0, 30_900_000, 3),   // cortos cerca, arriba
  B(73000, 73300, 0, 55_700_000, 2),
  B(61000, 61300, 0, 600_000),
  B(62000, 62300, 0, 700_000),
];

t('las más cargadas de cada lado, de la más cercana a la más lejana, sobre el mínimo', () => {
  const { above, below } = pickBands(buckets, 60000, { perSide: 3, minUsd: 500_000 });
  assert.deepEqual(above.map(b => b.lo), [61500, 62000, 73000]);
  assert.deepEqual(below.map(b => b.lo), [59500, 59000, 46000]);
  assert.ok(above.every(b => b.side === 'short') && below.every(b => b.side === 'long'));
  assert.ok(!below.some(b => b.lo === 58000), 'la de 200k queda fuera');
});

t('un largo encima del precio o un corto debajo no se dibujan del lado equivocado', () => {
  const { above, below } = pickBands([B(61000, 61300, 5_000_000, 0), B(59000, 59300, 0, 5_000_000)], 60000);
  assert.equal(above.length + below.length, 0);
});

t('sin precio o sin franjas, nada', () => {
  assert.deepEqual(pickBands(buckets, null), { above: [], below: [] });
  assert.deepEqual(pickBands(null, 60000), { above: [], below: [] });
});

t('etiqueta con el lado, el USD, las cuentas y la distancia', () => {
  const [near] = pickBands(buckets, 60000).above;
  assert.equal(bandLabel(near), 'HL cortos 31M · 3 cuentas · +2.8%');
  const [first] = pickBands(buckets, 60000).below;
  assert.equal(bandLabel({ ...first, wallets: 1 }), 'HL largos 1.5M · 1 cuenta · −0.6%');
});

t('opacidad según el USD contra la mayor', () => {
  assert.equal(bandAlpha(10, 10), 0.45);
  assert.equal(bandAlpha(0, 10), 0.12);
  assert.ok(bandAlpha(5, 10) > 0.25 && bandAlpha(5, 10) < 0.3);
});

t('antigüedad de la vuelta', () => {
  assert.equal(ageText(null), 'sin vuelta todavía');
  assert.equal(ageText(0 + 1, 3 * 60000), 'hace 3m');
  assert.equal(ageText(1, 65 * 60000 + 1), 'hace 1h05');
});

console.log(`\n${count} de ${count} pruebas pasaron`);
