// Las piezas de una regla en palabras: el resumen «Vas a correr», las diferencias con una corrida, lo que trae una
// regla al cargarla, el embudo de señales y la escala en R de la salida. Uso: node tests/rulefacets.test.mjs
import assert from 'node:assert/strict';
import { defaultRule, describeRule, fromBackendRule, toBackendRule } from '../src/components/backtesting/ruleTester.js';
import {
  OFF_PATCH, exitScale, facetPhrase, loadedSummary, recipeText, ruleDifferences, ruleFacets, sectionCounts, sectionSummary, signalFunnel
} from '../src/components/backtesting/ruleFacets.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

// La regla de la corrida de 7 trades del usuario (20/11): heredó de la B5 la EMA 50, el OI y el trailing
const user = () => ({
  ...defaultRule(), name: 'prueba caja+vol+OF', tf: 240, codes: ['EX', 'ZP', 'DD', 'VD', 'CC'], mode: 'sequence', first: ['CC'], min: 2, window: 10,
  stopType: 'atr', stopAtr: 2, stopMaxAtr: 8, useTarget: true, targetR: 2, trailMode: 'atr', trailAtr: 3, useHorizon: false,
  emaMode: 'side', emaPeriod: 50, oiMode: 'rise', oiPct: 2, oiBars: 6, cooldown: 0
});
const keys = (rule) => ruleFacets(toBackendRule(rule)).map(f => f.key);
const text = (rule, key) => ruleFacets(toBackendRule(rule)).find(f => f.key === key)?.text;

test('los elementos en palabras: uno, todos, al menos N y en secuencia con «2 de 4»', () => {
  const r = (change) => toBackendRule({ ...defaultRule(), ...change });
  assert.equal(recipeText(r({ codes: ['FV'] })), 'FVG nuevo');
  assert.equal(recipeText(r({ codes: ['FV', 'DJ'], mode: 'all', window: 3 })), 'FVG nuevo + Doji, en 3 velas');
  assert.equal(recipeText(r({ codes: ['FV', 'DJ', 'EN'], mode: 'atLeast', min: 1, window: 2 })), 'FVG nuevo o Doji o Envolvente, en 2 velas');
  assert.equal(recipeText(r({ codes: ['FV', 'DJ', 'EN'], mode: 'atLeast', min: 2, window: 2 })), '2 de FVG nuevo, Doji, Envolvente, en 2 velas');
  assert.equal(recipeText(toBackendRule(user())),
    'Cambio de carácter → 2 de Agotamiento en el extremo, Cero en el extremo, Divergencia de delta, Volumen decreciente, en 10 velas');
  assert.match(describeRule(toBackendRule(user())), /Cambio de carácter → 2 de Agotamiento en el extremo, Cero en el extremo/,
    'el resumen de la regla ya no pone «+», que se leía como «los cuatro»');
});

test('lo que tiene la regla del usuario, por sección', () => {
  const facets = ruleFacets(toBackendRule(user()));
  const bySection = (section) => facets.filter(f => f.section === section).map(f => f.text);
  assert.deepEqual(bySection('filtros'), ['EMA 50 a favor', 'OI sube más de 2% en 6 velas']);
  assert.deepEqual(bySection('salida'), ['2R', 'a 3 ATR del mejor precio, desde la entrada', 'una a la vez']);
  assert.deepEqual(bySection('stop'), ['2 ATR · máximo 8 ATR']);
  assert.deepEqual(sectionCounts(facets), { elementos: 3, filtros: 2, entrada: 1, stop: 1, salida: 2, deteccion: 1 });
  assert.deepEqual(loadedSummary(toBackendRule(user())), [
    'EMA 50 a favor', 'OI sube más de 2% en 6 velas', 'entrada a mercado, en la apertura siguiente', 'stop 2 ATR · máximo 8 ATR',
    'objetivo 2R', 'trailing del stop a 3 ATR del mejor precio, desde la entrada'
  ]);
});

test('el resumen de cada sección plegada y las frases de las fichas', () => {
  const facets = ruleFacets(toBackendRule(user()));
  assert.equal(sectionSummary(facets, 'filtros'), 'EMA 50 a favor · OI sube más de 2% en 6 velas');
  assert.equal(sectionSummary(facets, 'entrada'), 'a mercado, en la apertura siguiente', 'sin repetir el nombre de la sección');
  assert.equal(sectionSummary(facets, 'stop'), '2 ATR · máximo 8 ATR');
  assert.equal(sectionSummary(facets, 'salida'), 'objetivo 2R · trailing del stop a 3 ATR del mejor precio, desde la entrada · una a la vez');
  assert.equal(sectionSummary(facets, 'elementos'),
    'Cambio de carácter → 2 de Agotamiento en el extremo, Cero en el extremo, Divergencia de delta, Volumen decreciente, en 10 velas · '
    + 'Cambio de carácter: estructura en 4h, swing de 3, 2 tramos', 'el marco va aparte');
  const phrases = Object.fromEntries(facets.map(f => [f.key, facetPhrase(f)]));
  assert.equal(phrases.entrada, 'entrada a mercado, en la apertura siguiente');
  assert.equal(phrases.trailing, 'trailing del stop a 3 ATR del mejor precio, desde la entrada');
  assert.equal(phrases.ema, 'EMA 50 a favor');
  // Sin otra salida que la señal contraria, el backend también cierra a las 96 velas
  const only = ruleFacets(toBackendRule({ ...defaultRule(), useTarget: false, useHorizon: false, opposite: true, cooldown: 0 }));
  assert.equal(sectionSummary(only, 'salida'), 'cierre por tiempo a las 96 velas (lo pone el backend) · cierre con la señal contraria · una a la vez');
  assert.deepEqual(loadedSummary(toBackendRule({ ...defaultRule(), useTarget: false, useHorizon: false, opposite: true })).slice(-2),
    ['cierre por tiempo a las 96 velas (lo pone el backend)', 'cierre con la señal contraria']);
});

test('sin ninguna salida, el cierre a las 96 velas que pone el backend se ve, marcado', () => {
  const none = { ...defaultRule(), useTarget: false, useHorizon: false };
  const facet = ruleFacets(toBackendRule(none)).find(f => f.key === 'tiempo');
  assert.deepEqual([facet.text, facet.implicit], ['a las 96 velas', true]);
  // La corrida guardada trae el 96 que puso el backend: no es una diferencia
  const saved = { ...toBackendRule(none), exit: { ...toBackendRule(none).exit, horizon: 96 } };
  assert.deepEqual(ruleDifferences(toBackendRule(none), saved), []);
  assert.equal(text({ ...defaultRule(), useTarget: false, useHorizon: true, horizon: 24 }, 'tiempo'), 'a las 24 velas');
});

test('las diferencias entre el formulario y la corrida dicen qué cambió, con lo apagado en palabras', () => {
  const run = toBackendRule(user());
  const form = toBackendRule({ ...user(), name: 'otro nombre', trailMode: 'off', emaMode: 'off', targetR: 3 });
  assert.deepEqual(ruleDifferences(form, run).map(d => [d.label, d.run, d.form]), [
    ['EMA', 'EMA 50 a favor', 'sin filtro'],
    ['Objetivo', '2R', '3R'],
    ['Trailing del stop', 'a 3 ATR del mejor precio, desde la entrada', 'sin trailing']
  ]);
  assert.deepEqual(ruleDifferences(run, run), [], 'el nombre no cuenta');
  // Cargar la regla de la corrida deja el formulario igual a ella
  assert.deepEqual(ruleDifferences(toBackendRule(fromBackendRule(run)), run), []);
});

test('cada × de «Vas a correr» apaga solo su pieza', () => {
  const on = {
    ...user(), vwapMode: 'touch', regimeMode: 'outside', cvdOn: true, crowdMode: 'nocon', steadyOn: true, swing: true, momentum: true, confirm: true,
    useHours: true, filters: [{ key: 'x', op: '>=', value: 1 }], tpTrailOn: true, targetR: 3, breakEvenOn: true, useHorizon: true, opposite: true,
    codes: [...user().codes, 'GC'], gcExit: 'band'
  };
  const before = keys(on);
  for (const [key, patch] of Object.entries(OFF_PATCH)) {
    assert.ok(before.includes(key), `${key} está en la regla de prueba`);
    const after = keys({ ...on, ...patch });
    assert.ok(!after.includes(key), `${key} se apaga`);
    // Lo demás sigue: quitar el objetivo también quita su arrastre, y quitar todas las salidas trae el cierre por tiempo
    const lost = before.filter(k => !after.includes(k) && k !== key);
    assert.deepEqual(lost, key === 'objetivo' ? ['arrastre'] : [], `${key} no apaga otras piezas`);
  }
});

test('el embudo de la corrida del usuario: 14 señales, el OI quitó 7 y quedaron 7 trades', () => {
  const steps = signalFunnel({ signals: 14, skipped: { 'filtro de CVD u OI': 7 }, busy: 0, open: 0, summary: { n: 7 } });
  assert.deepEqual(steps.map(s => [s.label, s.count, s.left]), [
    ['Señales de los elementos', 14, 14], ['filtro de CVD u OI', 7, 7], ['Trades cerrados', 7, 7]
  ]);
  const many = signalFunnel({ signals: 100, skipped: { 'filtro de VWAP o EMA': 10, 'fuera de horario': 30 }, busy: 20, open: 2, summary: { n: 35 } });
  assert.deepEqual(many.map(s => [s.label, s.left]), [
    ['Señales de los elementos', 100], ['con una posición ya abierta', 80], ['fuera de horario', 50], ['filtro de VWAP o EMA', 40],
    ['abiertas al final de la fase', 38], ['sin vela siguiente u otros motivos', 35], ['Trades cerrados', 35]
  ]);
  assert.equal(signalFunnel(null), null);
});

test('la escala en R de la salida: stop, entrada y lo que haya de salidas', () => {
  const marks = exitScale({ ...defaultRule(), targetR: 3, tpTrailOn: true, tpTrailStart: 2.5, breakEvenOn: true, breakEven: 1.5, trailMode: 'atr', trailStartOn: true, trailStart: 1 });
  assert.deepEqual(marks.map(m => [m.r, m.kind]), [[-1, 'stop'], [0, 'entry'], [1, 'trail'], [1.5, 'even'], [2.5, 'drag'], [3, 'target']]);
  assert.deepEqual(exitScale({ ...defaultRule(), useTarget: false }).map(m => m.kind), ['stop', 'entry']);
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
