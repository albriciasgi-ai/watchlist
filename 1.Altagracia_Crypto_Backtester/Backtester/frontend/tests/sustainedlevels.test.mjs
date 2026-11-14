// Niveles sostenidos (14/11/2026): etiquetas, cuándo volver a pedir a la suite y qué niveles se dibujan.
// Uso: node tests/sustainedlevels.test.mjs
import assert from 'node:assert/strict';

const { fmtUsd, fmtMinutes, levelLabel, needsFetch, visibleLevels, nearLabel, lastNear, bigOnly } = await import('../src/components/sustainedLevels.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
const MIN = 60000;

t('USD y duración cortos', () => {
  assert.equal(fmtUsd(950), '950');
  assert.equal(fmtUsd(12345), '12k');
  assert.equal(fmtUsd(3_400_000), '3.4M');
  assert.equal(fmtMinutes(45), '45m');
  assert.equal(fmtMinutes(120), '2h');
  assert.equal(fmtMinutes(190), '3h10');
});

t('etiqueta: un nivel que sigue cuenta hasta ahora; uno terminado dice cómo', () => {
  const now = 1_000_000 * MIN;
  const active = { usd: 2_500_000, minutes: 40, start: now - 95 * MIN, end: null, touches: 2, reason: 'activo' };
  assert.equal(levelLabel(active, now), '2.5M · 1h35 · 2 toques');
  const gone = { usd: 800_000, minutes: 60, start: 0, end: 60 * MIN, touches: 0, reason: 'retirado' };
  assert.equal(levelLabel(gone, now), '800k · 1h · retirado');
});

t('se pide lo que no está cargado o cuando lo cargado venció', () => {
  const view = { from: 100, to: 200 };
  assert.deepEqual(needsFetch(null, view, 0), view);
  assert.equal(needsFetch({ from: 50, to: 250, at: 0 }, view, 30000), null);
  assert.deepEqual(needsFetch({ from: 50, to: 250, at: 0 }, view, 61000), view);
  assert.deepEqual(needsFetch({ from: 150, to: 250, at: 0 }, view, 1000), view);
  assert.equal(needsFetch(null, { from: 5, to: 5 }, 0), null);
});

t('solo los niveles que tocan la vista, en su rango de precios, y los terminados si se piden', () => {
  const lv = [
    { start: 0, end: 50, lo: 100, hi: 101 },        // terminó antes de la vista
    { start: 60, end: 150, lo: 100, hi: 101 },      // terminado, a la vista
    { start: 120, end: null, lo: 100, hi: 101 },    // sigue
    { start: 250, end: null, lo: 100, hi: 101 },    // empieza después de la vista
    { start: 120, end: null, lo: 300, hi: 301 },    // fuera del precio
  ];
  assert.equal(visibleLevels(lv, 100, 200, 90, 110).length, 2);
  assert.equal(visibleLevels(lv, 100, 200, 90, 110, false).length, 1);
});

t('retiro cerca: etiqueta y aviso del último de la última hora', () => {
  const now = 1_000_000 * MIN;
  assert.equal(nearLabel({ dist_atr: 0.4, dist_pct: 0.12, usd: 2_100_000 }), 'retiro cerca · 0.4 ATR · 2.1M');
  assert.equal(nearLabel({ dist_atr: null, dist_pct: 0.2, usd: 900 }), 'retiro cerca · 0.2% · 900');
  const lv = [
    { reason: 'retirado', near: true, end: now - 90 * MIN, side: 'b', lo: 65000, hi: 65020 },   // hace más de una hora
    { reason: 'retirado', near: false, end: now - 2 * MIN, side: 'a', lo: 66000, hi: 66020 },   // lejos
    { reason: 'retirado', near: true, end: now - 3 * MIN, side: 'b', lo: 65500, hi: 65520 },
    { reason: 'consumido', near: false, end: now - 1 * MIN, side: 'b', lo: 65400, hi: 65420 },
  ];
  assert.equal(lastNear(lv, now), 'compra 65,510 hace 3m');
  assert.equal(lastNear(lv.slice(0, 2), now), null);
});

t('filtro solo lo grande: deja los de más USD', () => {
  const lv = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(u => ({ usd: u * 1e6 }));
  assert.equal(bigOnly(lv, 0).length, 10);
  assert.deepEqual(bigOnly(lv, 50).map(x => x.usd / 1e6), [5, 6, 7, 8, 9, 10]);
  assert.deepEqual(bigOnly(lv, 100).map(x => x.usd / 1e6), [10]);
  assert.deepEqual(bigOnly([], 80), []);
});

console.log(`\n${count} pruebas pasan`);
