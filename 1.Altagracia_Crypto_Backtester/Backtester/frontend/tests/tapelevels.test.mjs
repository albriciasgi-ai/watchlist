// Líneas de la cinta de la suite en firme como niveles del análisis (14/11/2026). Uso: node tests/tapelevels.test.mjs
import assert from 'node:assert/strict';

const { tapeDrawingLevels } = await import('../src/components/indicators/analysisLevels.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

t('solo las líneas de la cinta en firme, con su lado, USD y la hora de la orden', () => {
  const shapes = [
    { type: 'horizontal', id: 'h1', price: 100 },                                                     // una línea cualquiera
    { type: 'horizontal', id: 'tape_A', price: 65500.5, tape: { pending: false, side: 'sell', usd: 76000, t: 1000 } },
    { type: 'horizontal', id: 'tape_B', price: 65600, tape: { pending: true, side: 'buy', usd: 1e6, t: 2000 } },  // provisional
    { type: 'tpsl', id: 'box', tape: { pending: false } },
  ];
  const got = tapeDrawingLevels(shapes);
  assert.equal(got.length, 1);
  assert.deepEqual({ ...got[0], kind: got[0].kind.replace(/ \(\d\d:\d\d\)$/, '') },
    { id: 'Cinta|tape_A', source: 'Cinta', price: 65500.5, kind: 'Orden de venta 76k' });
  assert.match(got[0].kind, /\(\d\d:\d\d\)$/);   // la hora de la orden en el nombre; se elige en todo el ancho
  assert.deepEqual(tapeDrawingLevels(null), []);
});

console.log(`\n${count} pruebas pasan`);
