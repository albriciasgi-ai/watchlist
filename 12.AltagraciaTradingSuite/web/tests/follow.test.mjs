// Pruebas de los textos y las cuentas del módulo "Seguimiento" (src/followView.js, 24/11/2026).
// Uso: node tests/follow.test.mjs
import assert from 'node:assert/strict';
import {
  favAdv, fracPct, groupBars, listText, minutesText, nearSignals, offsetText, priceRange, rateText, sideText, signalRows,
  signalText, signalsShort, signed, stateText, timelineText, touchText, whenText
} from '../src/followView.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const T0 = Date.UTC(2026, 10, 24, 13, 30);   // 24/11 08:30 en Colombia

test('la hora en Colombia', () => {
  assert.equal(whenText(T0), '24/11 08:30');
  assert.equal(whenText(Date.UTC(2026, 10, 25, 2, 5)), '24/11 21:05');
  assert.equal(whenText(null), '—');
});

test('minutos y horas, con signo desde el hallazgo', () => {
  assert.equal(minutesText(45), '45 min');
  assert.equal(minutesText(250), '4 h 10 min');
  assert.equal(minutesText(120), '2 h');
  assert.equal(offsetText(-30), '−30 min');
  assert.equal(offsetText(135), '+2 h 15 min');
  assert.equal(offsetText(0), 'hallazgo');
});

test('números con signo y porcentajes de una fracción', () => {
  assert.equal(signed(1.234), '+1.2');
  assert.equal(signed(-0.05, 2), '−0.05');
  assert.equal(signed(null), '—');
  assert.equal(fracPct(0.021), '+2.1 %');
  assert.equal(fracPct(-0.00012, 3), '−0.012 %');
  assert.equal(sideText(1), '↑');
  assert.equal(sideText(-1), '↓');
});

test('qué pasó: abierto, movido, quieto o sin datos', () => {
  assert.equal(stateText({ state: 'abierto', elapsed_min: 190, now_atr: -1.26 }), 'abierto hace 3 h 10 min · −1.3 ATR a favor');
  assert.equal(stateText({ state: 'abierto', elapsed_min: 34, now_atr: null }), 'abierto hace 34 min');
  assert.equal(stateText({ state: 'medido', o: { big: { min: 250, way: 'gira' } } }), 'gira a los 4 h 10 min');
  assert.equal(stateText({ state: 'medido', o: { big: null } }), 'sin moverse 3 ATR');
  assert.equal(stateText({ state: 'sin datos' }), 'sin datos de Bybit');
  assert.equal(touchText({ state: 'abierto' }), '…');
  assert.equal(touchText({ state: 'medido', o: { touch: 'las dos' } }), 'las dos a la vez');
  assert.equal(favAdv({ fav: 0.8, adv: 1.24 }), '0.8 / 1.2');
});

test('la lista, con el arranque y el control', () => {
  assert.equal(listText({ list: 'enjuego', startup: false }), 'En juego');
  assert.equal(listText({ list: 'tendencia', startup: true }), 'Tendencia · arranque');
  assert.equal(listText({ list: null, kind: 'control' }), 'Control');
  assert.equal(timelineText([['enjuego', T0, T0 + 165 * 60000, false], ['rapidos', T0 + 30 * 60000, null, false]]),
    'En juego 08:30–11:15 · Rápidos 09:00–…');
  assert.equal(timelineText([['enjuego', T0, T0 + 60000, true]]), 'En juego 08:30–08:31 (corte)');
  const many = [['enjuego', T0, T0 + 20 * 60000, false], ['tendencia', T0 + 5 * 60000, null, false],
    ['enjuego', T0 + 60 * 60000, T0 + 90 * 60000, false], ['enjuego', T0 + 120 * 60000, null, false]];
  assert.equal(timelineText(many, T0 + 150 * 60000), 'En juego 3 veces, 1 h 20 min en total · Tendencia 08:35–…');
});

test('los elementos, en palabras y en corto', () => {
  const label = (c) => ({ QB: 'Ruptura con volumen' }[c] || c);
  assert.equal(signalText('QB|15|+', label), 'Ruptura con volumen · 15m · a favor');
  assert.equal(signalText('FV|60|-', label), 'FV · 1h · en contra');
  assert.equal(signalsShort(['QB|15|+', 'FV|60|-']), 'QB 15m+, FV 1h−');
  assert.equal(signalsShort(['A|15|+', 'B|15|+', 'C|15|+', 'D|15|+'], 3), 'A 15m+, B 15m+, C 15m+ y 1 más');
  assert.equal(signalsShort([]), '—');
});

test('velas de 15 min con las de 5, sin las que faltan', () => {
  const s = { start: 0, step: 300000, o: [0, 1, 2, null, 4, 5], h: [1, 2, 3, null, 5, 6], l: [-1, 0, 1, null, 3, 4],
    c: [1, 2, 3, null, 5, 6], v: [1, 1, 1, 0, 2, 2] };
  const bars = groupBars(s, 3);
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[0], { i: 0, t: 0, o: 0, h: 3, l: -1, c: 3, v: 3 });
  assert.deepEqual(bars[1], { i: 3, t: 900000, o: 4, h: 6, l: 3, c: 6, v: 4 });
  assert.deepEqual(groupBars(null), []);
});

test('el rango del precio deja ver las líneas de ±3 ATR', () => {
  const [lo, hi] = priceRange([{ h: 1, l: -1 }]);
  assert.ok(lo < -3 && hi > 3);
  const [lo2, hi2] = priceRange([{ h: 7.5, l: -2 }]);
  assert.ok(hi2 > 7.5 && lo2 < -3);
});

test('una fila por elemento y marco: primero las de cerca del hallazgo, y de ellas las que menos se encienden', () => {
  const signals = [['QB', 15, -30, 1], ['QB', 15, 10, -1], ['FV', 60, 5, 1], ['QB', 60, 0, 1], ['FV', 60, 50, 1], ['FV', 60, 90, -1],
    ['WD', 15, 600, 1]];
  const { rows, hidden } = signalRows(signals, 3);
  assert.deepEqual(rows.map(r => r.key), ['QB|60', 'QB|15', 'FV|60']);
  assert.equal(hidden, 1);
  assert.deepEqual(rows[1].items, [{ off: -30, dir: 1 }, { off: 10, dir: -1 }]);
  const withBig = signalRows(signals, 3, [[-60, 60], [540, 600]]);
  assert.deepEqual(withBig.rows.map(r => r.key), ['QB|60', 'WD|15', 'QB|15']);
});

test('los elementos cerca del hallazgo, a favor o en contra del lado', () => {
  const near = nearSignals([['QB', 15, -90, 1], ['FV', 15, 30, -1], ['IM', 60, -30, 1], ['WD', 15, 300, 1]], -1);
  assert.deepEqual(near.map(s => [s.code, s.favor]), [['IM', false], ['FV', true]]);
});

test('una fila del informe', () => {
  assert.equal(rateText(62.4, 42), '62 % de 42');
  assert.equal(rateText(null, 0), '—');
});

let failed = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASA  ${name}`); } catch (e) { failed++; console.log(`FALLA ${name}\n  ${e.message}`); }
}
console.log(`\n${tests.length - failed} de ${tests.length} pruebas pasan`);
process.exit(failed ? 1 : 0);
