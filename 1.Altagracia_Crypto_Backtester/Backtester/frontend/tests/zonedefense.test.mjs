// Defensa de zona (14/11/2026): patrón de cada visita, etiquetas y resumen. Uso: node tests/zonedefense.test.mjs
import assert from 'node:assert/strict';

const { visitStyle, visitLabel, statusLabel, lastVisits, summary } = await import('../src/components/zoneDefense.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

t('cada patrón con su letra y su tono; sin patrón, según el resultado', () => {
  assert.deepEqual(visitStyle({ pattern: 'defensa' }), { letter: 'D', name: 'defensa', tone: 'good' });
  assert.equal(visitStyle({ pattern: 'retiro_y_cruce' }).tone, 'bad');
  assert.equal(visitStyle({ pattern: 'barrido' }).tone, 'mid');
  assert.equal(visitStyle({ pattern: null, outcome: 'sin_resolver' }).name, 'en curso');
  assert.equal(visitStyle({ pattern: null, outcome: 'cruzo' }).tone, 'bad');
});

t('etiqueta de la visita: lo que quedó, lo negociado y la antigüedad', () => {
  assert.equal(visitLabel({ pattern: 'absorcion', kept_pct: 85, traded_usd: 2_400_000, aged_min: 95 }),
    'absorción · quedó 85% · negoc. 2.4M · 1h35 de antigüedad');
  assert.equal(visitLabel({ pattern: null, outcome: 'sin_resolver', kept_pct: null, traded_usd: 0, aged_min: null }), 'en curso');
});

t('estado de una zona antes de que llegue el precio', () => {
  assert.equal(statusLabel({ side: 'b', usd: 3_100_000, kept_pct: 78, age_min: 45, dist_atr: 0.8 }),
    'compra 3.1M · 78% de hace 30 min · 45m de antigüedad · a 0.8 ATR');
  assert.equal(statusLabel({ side: 'a', usd: 900_000, kept_pct: null, age_min: null, dist_atr: 1.2 }),
    'venta 900k · nueva de este lado · a 1.2 ATR');
  assert.equal(statusLabel({ side: 'a', usd: 18_800_000, kept_pct: 1511, age_min: 3, dist_atr: 0.43 }),
    'venta 19M · 15× lo de hace 30 min · 3m de antigüedad · a 0.43 ATR');
});

t('solo la última visita de cada zona lleva etiqueta; el resumen cuenta las resueltas', () => {
  const vs = [{ id: 'a', at: 1, outcome: 'aguanto' }, { id: 'a', at: 5, outcome: 'cruzo' }, { id: 'b', at: 3, outcome: 'sin_resolver' }];
  const last = lastVisits(vs);
  assert.ok(last.has(vs[1]) && last.has(vs[2]) && !last.has(vs[0]));
  assert.deepEqual(summary(vs), { visits: 2, held: 1, pct: 50 });
});

console.log(`\n${count} pruebas pasan`);
