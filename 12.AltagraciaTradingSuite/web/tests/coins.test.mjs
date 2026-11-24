// Pruebas de los textos del módulo "Monedas" (src/coinsView.js, 23/11/2026).
// Uso: node tests/coins.test.mjs
import assert from 'node:assert/strict';
import { etaText, mbText, perDayTotal, progressText, recordNote, short, storeText, swingNext } from '../src/coinsView.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('tamaños: MB con un decimal bajo 10, enteros hasta 1 GB y GB después', () => {
  assert.equal(mbText(0.44), '0.4 MB');
  assert.equal(mbText(21.6), '22 MB');
  assert.equal(mbText(1536), '1.5 GB');
  assert.equal(mbText(20480), '20 GB');
  assert.equal(mbText(null), '—');
  assert.equal(mbText(undefined), '—');
});

test('lo que falta: minutos bajo una hora, horas después', () => {
  assert.equal(etaText(0.25), 'unos 15 min');
  assert.equal(etaText(1.84), 'unas 1.8 h');
  assert.equal(etaText(12.4), 'unas 12 h');
  assert.equal(etaText(null), '');
});

test('el avance de una descarga en una línea', () => {
  assert.equal(progressText({ done: 950, left: 870, pct: 52.2, per_hour: 475, eta_h: 1.83 }),
    '950 de 1,820 días (52 %) · 475 días por hora · faltan unas 1.8 h');
  assert.equal(progressText({ done: 3, left: 10, pct: 23.1, per_hour: null, eta_h: null }), '3 de 13 días (23 %)');
  assert.equal(progressText(null), 'empezando…');
});

test('el almacén: cada estado con su acción', () => {
  assert.equal(storeText({ state: 'sin_historia' }).action, 'download');
  assert.equal(storeText({ state: 'sin_historia' }, false).action, null, 'sin la historia disponible no se ofrece');
  assert.equal(storeText({ state: 'en_espera', queue_position: 2 }).text, 'En espera (n.º 2)');
  assert.equal(storeText({ state: 'en_espera' }).action, 'cancel');
  const half = storeText({ state: 'a_medias', missing_remote: 870, store_days: 950, first_day: '2024-04-18' });
  assert.equal(half.text, 'A medias · faltan 870 días');
  assert.equal(half.action, 'continue');
  assert.equal(storeText({ state: 'al_dia', store_last: '2026-11-22', store_days: 2434, first_day: '2020-03-25' }).text, 'Al día hasta el 22/11');
  assert.equal(storeText({ state: 'al_dia', store_on: false, store_last: '2026-11-22' }).text, 'Hasta el 22/11', 'apagado: sin "al día"');
  assert.equal(storeText({ state: 'bajando', progress: { done: 1, left: 3, pct: 25 } }).text, 'Bajando · 25 %');
  assert.equal(storeText({ state: 'por_armar', missing_store: 12, missing_flow: 12 }).text, 'Por armar · 12 días');
  const failed = storeText({ state: 'por_armar', missing_store: 3, build: { ok: false, code: 1, detail: 'Traceback' } });
  assert.equal(failed.text, 'No se pudo armar');
  assert.equal(failed.tone, 'bad');
});

test('una descarga que terminó con error se dice', () => {
  const s = storeText({ state: 'sin_historia', launch: { code: 1, detail: 'no se pudo leer el listado' } });
  assert.match(s.title, /terminó con error: no se pudo leer el listado/);
  assert.equal(s.tone, 'bad');
});

test('la nota de cada grabación', () => {
  const row = (opt, now, suite = true) => ({ suite, options: { book: opt }, recording: { book: now } });
  assert.equal(recordNote(row(false, 'on'), 'book').text, 'hasta reiniciar');
  assert.equal(recordNote(row(true, 'closed'), 'book').text, 'cerrada');
  assert.equal(recordNote(row(true, 'on'), 'book').text, '');
  assert.equal(recordNote(row(true, 'off'), 'book').text, 'empieza…');
  assert.equal(recordNote(row(true, 'on', false), 'book').text, '');
  assert.match(recordNote(row(true, 'on', false), 'book').title, /Agrégala a la suite/);
  assert.match(recordNote(row(true, null), 'book', { book: { why: 'apagado en este servidor (SUITE_BOOK=0)' } }).title, /SUITE_BOOK=0/);
});

test('el Swing: poner y quitar una moneda, nunca dejarlo sin ninguna', () => {
  assert.deepEqual(swingNext(['BTCUSDT'], 'RUNEUSDT', true), ['BTCUSDT', 'RUNEUSDT']);
  assert.deepEqual(swingNext(['BTCUSDT', 'RUNEUSDT'], 'RUNEUSDT', true), ['BTCUSDT', 'RUNEUSDT']);
  assert.deepEqual(swingNext(['BTCUSDT', 'RUNEUSDT'], 'RUNEUSDT', false), ['BTCUSDT']);
  assert.equal(swingNext(['BTCUSDT'], 'BTCUSDT', false), null);
  assert.deepEqual(swingNext(undefined, 'BTCUSDT', true), ['BTCUSDT']);
});

test('lo que escriben por día: solo las de la suite, y cuántas lo estiman', () => {
  const rows = [
    { suite: true, per_day: { total_mb: 21.5 } },
    { suite: true, per_day: { total_mb: 2.1, estimate: true } },
    { suite: false, per_day: { total_mb: 100 } },
    { suite: true, per_day: null },
  ];
  assert.deepEqual(perDayTotal(rows), { mb: 23.6, estimates: 1 });
  assert.deepEqual(perDayTotal(null), { mb: 0, estimates: 0 });
});

test('el nombre corto', () => {
  assert.equal(short('SHIB1000USDT'), 'SHIB1000');
  assert.equal(short(null), '');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASA  ${name}`); } catch (e) { failed++; console.log(`FALLA ${name}\n  ${e.message}`); }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasan`);
process.exit(failed ? 1 : 0);
