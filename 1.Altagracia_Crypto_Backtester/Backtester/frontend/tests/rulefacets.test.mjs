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

test('motor 8: las velas de la absorción en la detección y en las diferencias con la corrida', () => {
  const absorb = { ...defaultRule(), codes: ['RL'] };
  assert.equal(text(absorb, 'deteccion'), 'volumen 2 · frecuencia 0.05');
  assert.equal(text({ ...absorb, absorbBars: 25 }, 'deteccion'), 'volumen 2 · frecuencia 0.05 · absorción en 25 velas');
  const diffs = ruleDifferences(toBackendRule({ ...absorb, absorbBars: 25 }), toBackendRule(absorb));
  assert.deepEqual(diffs.map(d => d.key), ['deteccion']);
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
    codes: [...user().codes, 'GC'], gcExit: 'band', bwAlligator: 'awake', bwZone: true, smcPd: true, smcBias: true,
    bwAo: 'color', bwAc: 'zero', bwGator: 'eating', bwMfi: 'squat', vpaMode: 'favor', vpaThr: 0.5,
    vpaExitOn: true, vpaExit: ['absorb', 'meter'], vpaExitThr: 0.8, chainMetric: 'net', chainDays: 7,
    slippage: 0.02, funding: true, marketOn: true, marketAllow: ['rango-alta', 'rango-baja']
  };
  const before = keys(on);
  for (const [key, patch] of Object.entries(OFF_PATCH)) {
    if (key === 'objetivoOnchain') continue;  // Va sin el arrastre: tiene su propia prueba
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
  // En el orden del motor (O-27): la línea se mira antes que el horario
  assert.deepEqual(many.map(s => [s.label, s.left]), [
    ['Señales de los elementos', 100], ['con una posición ya abierta', 80], ['filtro de VWAP o EMA', 70], ['fuera de horario', 40],
    ['abiertas al final de la fase', 38], ['sin vela siguiente u otros motivos', 35], ['Trades cerrados', 35]
  ]);
  // A mercado, el enfriamiento va antes que los filtros (DOGE del paso 77: decía "filtro de contexto −188 → 1, enfriamiento −1 → 0")
  const doge = signalFunnel({ signals: 189, skipped: { 'filtro de contexto': 188, 'enfriamiento': 1 }, busy: 0, open: 0, summary: { n: 0 },
    rule: { entry: { type: 'market' } } });
  assert.deepEqual(doge.map(s => [s.label, s.left]), [
    ['Señales de los elementos', 189], ['enfriamiento', 188], ['filtro de contexto', 0], ['Trades cerrados', 0]
  ]);
  // Con órdenes que esperan, la posición abierta y el enfriamiento se miran al final, con la vela del llenado
  const limit = signalFunnel({ signals: 50, skipped: { 'limit sin llenar': 20, 'enfriamiento': 5, 'filtro de régimen': 10 }, busy: 5, open: 0,
    summary: { n: 10 }, rule: { entry: { type: 'limit' } } });
  assert.deepEqual(limit.map(s => s.label), ['Señales de los elementos', 'filtro de régimen', 'limit sin llenar',
    'con una posición ya abierta', 'enfriamiento', 'Trades cerrados']);
  assert.equal(signalFunnel(null), null);
});

test('la escala en R de la salida: stop, entrada y lo que haya de salidas', () => {
  const marks = exitScale({ ...defaultRule(), targetR: 3, tpTrailOn: true, tpTrailStart: 2.5, breakEvenOn: true, breakEven: 1.5, trailMode: 'atr', trailStartOn: true, trailStart: 1 });
  assert.deepEqual(marks.map(m => [m.r, m.kind]), [[-1, 'stop'], [0, 'entry'], [1, 'trail'], [1.5, 'even'], [2.5, 'drag'], [3, 'target']]);
  assert.deepEqual(exitScale({ ...defaultRule(), useTarget: false }).map(m => m.kind), ['stop', 'entry']);
});

test('los sabios de Williams y la estructura SMC en palabras, ida y vuelta por el backend', () => {
  const rule = {
    ...defaultRule(), name: 'sabios', tf: 240, codes: ['WD', 'WF', 'OB'], mode: 'atLeast', min: 1, window: 1, entryType: 'stop', entryExpiry: 6,
    entryStopOffset: 0.1, wiseAngBars: 8, smcScope: 'internal', smcInternal: 7, bwAlligator: 'side', smcPd: true, trailMode: 'bars', trailBars: 4,
    useTarget: true, targetAt: 'weak'
  };
  const back = toBackendRule(rule);
  assert.deepEqual(back.entry, { type: 'stop', offset: 0.1, expiry: 6, cancel: true });
  assert.deepEqual(back.bwf, { alligator: 'side' });
  assert.deepEqual(back.smcf, { pd: true, swing: 50 });
  assert.equal(back.exit.trail, 'bars');
  assert.equal(back.exit.targetAt, 'weak');
  const facets = Object.fromEntries(ruleFacets(back).map(f => [f.key, f.text]));
  assert.match(facets.entrada, /^orden stop en el borde de la zona \+ 0.1 ATR, espera 6 velas/);
  assert.equal(facets.alligator, 'cierre del lado de los dientes del Alligator');
  assert.match(facets.premium, /^largos en discount y cortos en premium/);
  assert.match(facets.smc, /^estructura interna de 7 velas/);
  assert.match(facets.wise, /angulación de 8/);
  assert.equal(facets.objetivo, 'el máximo (largo) o el mínimo (corto) del rango mayor SMC');
  assert.match(facets.trailing, /últimas 4 velas/);
  // Cargar la regla de la corrida deja el formulario igual a ella
  assert.deepEqual(ruleDifferences(toBackendRule(fromBackendRule(back)), back), []);
  assert.match(describeRule(back), /orden stop en el borde de la zona/);
});

test('el AO, el AC, el Gator y el MFI como filtros: en palabras, ida y vuelta, y cada uno con su ×', () => {
  const rule = { ...defaultRule(), name: 'ao', tf: 240, codes: ['WA'], bwAo: 'both', bwAc: 'color', bwGator: 'open', bwMfi: 'volume', bwZone: true };
  const back = toBackendRule(rule);
  assert.deepEqual(back.bwf, { zone: true, ao: 'both', ac: 'color', gator: 'open', mfi: 'volume' });
  assert.equal(toBackendRule({ ...defaultRule(), codes: ['WA'] }).bwf, undefined, 'sin filtros no hay bwf: la regla conserva su identidad');
  const facets = Object.fromEntries(ruleFacets(back).map(f => [f.key, f.text]));
  assert.equal(facets.ao, 'AO con la barra a favor y del lado del cero');
  assert.equal(facets.ac, 'AC con la barra a favor');
  assert.equal(facets.gator, 'Gator despierto (al menos una barra crece)');
  assert.equal(facets.mfi, 'MFI: vela verde o squat (sube el volumen)');
  assert.equal(facets.zonaWilliams, 'zona de Williams a favor (verde en un largo, roja en un corto)');
  // Las fichas de «Vas a correr» dicen el nombre del filtro
  for (const [key, name] of [['ao', 'AO'], ['ac', 'AC'], ['gator', 'Gator'], ['mfi', 'MFI']]) {
    assert.ok(facetPhrase(ruleFacets(back).find(f => f.key === key)).startsWith(name), key);
  }
  assert.equal(sectionCounts(ruleFacets(back)).filtros, 5);
  assert.deepEqual(ruleDifferences(toBackendRule(fromBackendRule(back)), back), [], 'cargarla deja el formulario igual');
  assert.match(describeRule(back), /AO con la barra a favor y del lado del cero · AC con la barra a favor · Gator despierto · MFI vela verde o squat/);
  // La angulación y el AO en contra son de la barra divergente: con solo el AO de tres barras no se nombran
  assert.doesNotMatch(describeRule(back), /angulación|AO en contra/);
  assert.match(describeRule(toBackendRule({ ...rule, codes: ['WD', 'WA'] })), /angulación de 5 velas, AO en contra/);
  // Los detalles de la flecha de volumen salen en el resumen (hasta el 21/11 nunca salían)
  assert.match(describeRule(toBackendRule({ ...defaultRule(), codes: ['RF'] })), /flecha ≥ 2x a favor del tramo/);
  // La corrida con otro modo lo avisa con su nombre
  const diffs = ruleDifferences(toBackendRule({ ...rule, bwGator: 'eating', bwMfi: 'off' }), back);
  assert.deepEqual(diffs.map(d => [d.key, d.form]), [['gator', 'Gator comiendo (sus dos barras crecen)'], ['mfi', 'sin filtro']]);
});


test('el lector VPA en palabras, ida y vuelta por el formulario', () => {
  const form = { ...defaultRule(), codes: ['QB', 'QR'], vpaFire: 0.6, vpaRangeBars: 30, vpaMode: 'notAgainst', vpaThr: 0.8 };
  const rule = toBackendRule(form);
  assert.deepEqual(rule.vpaf, { mode: 'notAgainst', thr: 0.8 });
  assert.equal(rule.vpa.fire, 0.6);
  assert.equal(text(form, 'vpaMedidor'), 'medidor VPA que no esté en contra (> −0.8)');
  assert.match(text(form, 'vpa'), /cuenta desde 60%.*rango de 30 velas.*retroceso en 8 velas/);
  assert.deepEqual(ruleDifferences(toBackendRule(fromBackendRule(rule)), rule), []);
  // Sin sus elementos ni su filtro, la regla no lleva nada del lector: conserva su identidad
  const plain = toBackendRule({ ...defaultRule(), codes: ['FV'], vpaFire: 0.9 });
  assert.ok(!('vpa' in plain) && !('vpaf' in plain));
});

test('la salida VPA en palabras, ida y vuelta, y sin el cierre a las 96 velas', () => {
  const form = { ...defaultRule(), codes: ['FV'], useTarget: false, useHorizon: false, vpaExitOn: true, vpaExit: ['meter', 'climax'], vpaExitThr: 0.8, vpaExitFrom: 1 };
  const rule = toBackendRule(form);
  assert.deepEqual(rule.exit.vpa, { on: ['climax', 'meter'], fromR: 1, thr: 0.8 }, 'en el orden del backend');
  assert.ok(rule.vpa, 'lleva la configuración del lector');
  assert.equal(text(form, 'salidaVpa'), 'con clímax o frenado, medidor en contra (medidor ±0.8), desde 1R');
  assert.ok(!keys(form).includes('tiempo'), 'la salida VPA cuenta como salida');
  assert.match(describeRule(rule), /salida VPA: clímax o frenado, medidor en contra/);
  assert.deepEqual(ruleDifferences(toBackendRule(fromBackendRule(rule)), rule), []);
  assert.ok(exitScale(form).some(m => m.label === 'salida VPA' && m.r === 1));
  // Sin lecturas marcadas no hay salida VPA, y una regla sin ella conserva su identidad
  assert.ok(!('vpa' in toBackendRule({ ...form, vpaExit: [] }).exit));
  assert.ok(!('vpa' in toBackendRule({ ...defaultRule(), codes: ['FV'] }).exit));
});

test('el objetivo con los flujos on-chain: su ficha, su × y sin arrastre', () => {
  const on = { ...user(), useTarget: true, targetR: 3, tpTrailOn: false, chainTargetOn: true, chainTargetR: 5, chainTargetMetric: 'stable', chainTargetDays: 30 };
  const rule = toBackendRule(on);
  assert.deepEqual(rule.exit.chainTarget, { r: 5, metric: 'stable', days: 30, z: 0.5, mode: 'favor' });
  assert.ok(keys(on).includes('objetivoOnchain'));
  assert.ok(!keys({ ...on, ...OFF_PATCH.objetivoOnchain }).includes('objetivoOnchain'));
  assert.equal(toBackendRule({ ...on, tpTrailOn: true }).exit.chainTarget, undefined, 'con el arrastre no va');
  assert.deepEqual(ruleDifferences(toBackendRule(fromBackendRule(rule)), rule), [], 'cargarla deja el formulario igual');
});

test('el medidor VPA leído en un marco mayor: ida y vuelta, en palabras y solo con un marco mayor', () => {
  const form = { ...defaultRule(), tf: 240, elements: ['QB'], vpaMode: 'favor', vpaThr: 0.5, vpaTf: 1440 };
  const rule = toBackendRule(form);
  assert.deepEqual(rule.vpaf, { mode: 'favor', thr: 0.5, tf: 1440 });
  assert.equal(fromBackendRule(rule).vpaTf, 1440);
  assert.match(describeRule(rule), /medidor VPA a favor de 1 día \(≥0\.5\)/);
  assert.match(ruleFacets(rule).map(f => f.text).join(' · '), /medidor VPA de 1 día a favor \(≥ 0\.5\)/);
  assert.deepEqual(toBackendRule({ ...form, vpaTf: 60 }).vpaf, { mode: 'favor', thr: 0.5 }, 'un marco menor no se envía');
  assert.deepEqual(toBackendRule({ ...form, vpaTf: 0 }).vpaf, { mode: 'favor', thr: 0.5 }, 'sin pedirlo, la regla no cambia');
});

test('la EMA leída en un marco mayor (la tendencia de DX): ida y vuelta, en palabras y solo con un marco mayor', () => {
  const form = { ...defaultRule(), tf: 30, elements: ['DX'], emaMode: 'side', emaPeriod: 200, emaTf: 240 };
  const rule = toBackendRule(form);
  assert.deepEqual(rule.lines, [{ type: 'ema', period: 200, mode: 'side', slope: false, tf: 240 }]);
  assert.equal(fromBackendRule(rule).emaTf, 240);
  assert.match(describeRule(rule), /a favor de EMA 200 de 4 horas/);
  assert.match(ruleFacets(rule).map(f => f.text).join(' · '), /EMA 200 de 4 horas a favor/);
  assert.deepEqual(toBackendRule({ ...form, emaTf: 0 }).lines, [{ type: 'ema', period: 200, mode: 'side', slope: false }], 'sin pedirlo, la regla no cambia');
  assert.deepEqual(toBackendRule({ ...form, tf: 240, emaTf: 240 }).lines[0].tf, undefined, 'el marco de la regla no se envía');
  assert.ok(ruleDifferences(toBackendRule(form), toBackendRule({ ...form, emaTf: 0 })).length > 0, 'cambiar el marco de la EMA es otra regla');
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

