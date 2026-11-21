// Probador de reglas del Observador: la regla de la ventana, su forma para el backend y las reglas guardadas.
// Uso: node tests/ruletester.test.mjs
import assert from 'node:assert/strict';
import {
  defaultRule, deleteRule, describeRule, fromBackendRule, isRuleTester, loadSavedRules, ruleTesterUrl, saveRule,
  accountStats, sortTrades, testerSymbol, toBackendRule, tradeBoxes, contextBands, skippedSignals, signalChecklist, checklistBand, tradeBands,
  targetInR, chartTfOf, ruleIndicators, ruleWilliamsConfig, ruleSmcConfig, listText
} from '../src/components/backtesting/ruleTester.js';
import { defaultWilliamsConfig } from '../src/components/indicators/williams.js';
import { defaultSmcConfig } from '../src/components/indicators/smcStructure.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('la regla de fábrica es el ejemplo del pedido: VA, stop en el swing y 2R', () => {
  const rule = toBackendRule(defaultRule());
  assert.deepEqual(rule.recipe.slots, [{ codes: ['VA'], group: 0 }]);
  assert.equal(rule.stop.type, 'swing');
  assert.equal(rule.exit.targetR, 2);
  assert.equal(rule.entry.type, 'market');
  assert.equal(rule.tf, 15);
});

test('sin objetivo viaja como null, y cada elemento elegido es una casilla', () => {
  const rule = toBackendRule({ ...defaultRule(), codes: ['VA', 'EX', 'EX', 'ST'], useTarget: false, mode: 'atLeast', min: 2, window: 3 });
  assert.equal(rule.exit.targetR, null);
  assert.equal(rule.recipe.slots.length, 3, 'un código repetido no hace otra casilla');
  assert.equal(rule.recipe.mode, 'threshold');
  assert.equal(rule.recipe.min, 2);
  assert.equal(rule.recipe.window, 3);
  const all = toBackendRule({ ...defaultRule(), codes: ['VA', 'EX'], mode: 'all', min: 1 });
  assert.equal(all.recipe.mode, 'strict');
});

test('un campo vacío o un marco raro no llegan al backend', () => {
  const rule = toBackendRule({ ...defaultRule(), tf: 7, targetR: '', stopBars: '', filters: [{ key: 'x', op: '>=', value: '' }, { key: 'y', op: '<=', value: 1 }] });
  assert.equal(rule.tf, 15);
  assert.equal(rule.exit.targetR, 2);
  assert.equal(rule.stop.bars, 5);
  assert.deepEqual(rule.filters, [{ key: 'y', op: '<=', value: 1 }]);
});

test('una regla del historial vuelve al editor igual', () => {
  const original = { ...defaultRule(), name: 'Mia', tf: 30, codes: ['EX', 'ST'], window: 2, invert: true, entryType: 'limit', entryAt: 'mid',
    stopType: 'zone', useTarget: false, trail: true, useHorizon: false, opposite: true, oneAtATime: false, filters: [{ key: 'k', op: '<=', value: 2 }] };
  const back = fromBackendRule(toBackendRule(original));
  assert.deepEqual(toBackendRule(back), toBackendRule(original));
  assert.match(describeRule(toBackendRule(original)), /30m · Agotamiento en el extremo \+ Desequilibrios apilados @2 · invertida · limit · stop borde de la zona · stop arrastrado, señal contraria/);
});

test('guardar reemplaza la del mismo nombre y borrar la quita', () => {
  const storage = fakeStorage();
  saveRule({ ...defaultRule(), name: 'A', targetR: 2 }, storage);
  saveRule({ ...defaultRule(), name: 'B' }, storage);
  const list = saveRule({ ...defaultRule(), name: 'A', targetR: 3 }, storage);
  assert.deepEqual(list.map(r => r.name), ['A', 'B']);
  assert.equal(loadSavedRules(storage)[0].targetR, 3);
  assert.deepEqual(deleteRule('A', storage).map(r => r.name), ['B']);
  storage.setItem('tester_rules_v1', 'no es json');
  assert.deepEqual(loadSavedRules(storage), []);
});

test('la dirección de la ventana y su símbolo', () => {
  const location = { origin: 'http://localhost:5173', pathname: '/', search: '?probador=1&symbol=ethusdt' };
  assert.equal(ruleTesterUrl('ETHUSDT', location), 'http://localhost:5173/?probador=1&symbol=ETHUSDT');
  assert.equal(isRuleTester(location), true);
  assert.equal(isRuleTester({ search: '?grafico=2' }), false);
  assert.equal(testerSymbol(location), 'ETHUSDT');
  assert.equal(testerSymbol({ search: '?probador=1&symbol=../x' }), 'BTCUSDT');
});

test('cajas para el gráfico: sin objetivo no hay zona TP y la salida va aparte, y nunca miden menos de una vela', () => {
  const boxes = tradeBoxes([
    { dir: 1, entry: 100, stop: 99, target: 102, exit: 102, entry_t: 0, exit_t: 3600000 },
    { dir: -1, entry: 100, stop: 101, target: null, exit: 98.5, entry_t: 0, exit_t: 0 }
  ], 15);
  assert.deepEqual(boxes[0], { side: 'long', entry: 100, stop: 99, target: 102, noTarget: false, exit: 102, start: 0, end: 3600000 });
  assert.deepEqual(boxes[1], { side: 'short', entry: 100, stop: 101, target: null, noTarget: true, exit: 98.5, start: 0, end: 900000 },
    'su salida ya no se pinta como un TP');
});

test('el trade elegido lleva su salida con el motivo, y el stop de cada vela con su fase', () => {
  const H = 3600000;
  const trade = { dir: -1, entry: 64319, stop: 64589, target: null, exit: 58074, exit_t: 30 * H, entry_t: 2 * H, r: 22.87, reason: 'tiempo', marks: [] };
  const exit = tradeBands(trade, 240).find(b => b.kind === 'exit');
  assert.deepEqual([exit.time, exit.price, exit.good, exit.atEdge], [30 * H, 58074, true, true], 'por tiempo sale al cierre de la vela');
  assert.equal(exit.label, 'Salida por tiempo · +22.87 R');
  const stopped = tradeBands({ ...trade, reason: 'stop en la entrada', exit: 64319, r: -0.03 }, 240).find(b => b.kind === 'exit');
  assert.deepEqual([stopped.good, stopped.atEdge, stopped.label], [false, false, 'Salida en el stop a la entrada · -0.03 R']);
  const byVpa = tradeBands({ ...trade, reason: 'VPA: esfuerzo en contra', r: 1.4 }, 240).find(b => b.kind === 'exit');
  assert.deepEqual([byVpa.atEdge, byVpa.label], [true, 'Salida por el VPA (esfuerzo en contra) · +1.40 R'], 'la salida VPA, en la apertura siguiente');
  const path = [[2 * H, 64589, 'inicial'], [6 * H, 64319, 'entrada'], [10 * H, 63000, 'arrastrado']];
  const steps = contextBands({ success: true, tf: 240, stopPath: path, rows: [], lines: [], elements: [], signals: [] }).find(b => b.kind === 'steps');
  assert.deepEqual([steps.tf, steps.points], [4 * H, path]);
  assert.equal(contextBands({ success: true, tf: 240, rows: [] }).some(b => b.kind === 'steps'), false, 'sin recorrido, nada');
});

test('orden de la tabla: por R, con los vacíos al final', () => {
  const trades = [{ n: 1, r: 0.5, reach: null, votes: ['B'] }, { n: 2, r: -1, reach: 2, votes: ['A'] }, { n: 3, r: 2, reach: 1, votes: ['A'] }];
  assert.deepEqual(sortTrades(trades, 'r', true).map(t => t.n), [3, 1, 2]);
  assert.deepEqual(sortTrades(trades, 'reach', false).map(t => t.n), [3, 2, 1]);
  assert.deepEqual(sortTrades(trades, 'votes', false).map(t => t.n), [2, 3, 1]);
});

test('como cuenta: cada trade arriesga un % del capital al entrar, con posiciones a la vez y retornos diarios', () => {
  const DAY = 86400000;
  // Dos trades abiertos a la vez el día 0 (los dos miden su tamaño con el capital inicial), y uno el día 2
  const trades = [
    { entry_t: 0, exit_t: DAY / 2, r: 2 },
    { entry_t: 1000, exit_t: DAY / 2 + 1000, r: -1 },
    [2 * DAY, 2 * DAY + 3600000, -1]
  ];
  const stats = accountStats(trades, 1);
  assert.equal(stats.trades, 3);
  assert.equal(stats.maxOpen, 2);
  assert.equal(stats.maxOpenRisk, 2);
  assert.equal(stats.days, 3, 'del día 0 al 2, con un día sin cierres');
  // 1 + 0.02 - 0.01 = 1.01, y el tercero pierde 1% de 1.01
  assert.equal(stats.totalReturn, -0.0);
  assert.ok(Math.abs(stats.equity[2][1] - (1.01 * 0.99 - 1) * 100) < 0.01);
  assert.equal(stats.maxDrawdown, 2, 'del máximo de 1.02 a 0.9999: las dos pérdidas seguidas');
  assert.equal(stats.bestDay, 1);
  assert.equal(stats.worstDay, -1);
  assert.equal(stats.annualReturn, null, 'con menos de 3 meses no se anualiza');
  assert.ok(stats.sharpe === null || Number.isFinite(stats.sharpe));
  // El doble de riesgo, el doble de resultado en cada trade
  assert.equal(accountStats(trades, 2).bestDay, 2);
  // Sortino mayor que Sharpe cuando se pierde poco muchas veces y se gana mucho pocas
  const many = Array.from({ length: 300 }, (_, i) => ({ entry_t: i * DAY, exit_t: i * DAY + 3600000, r: i % 5 < 2 ? 2 : -1 }));
  const long = accountStats(many, 1);
  assert.ok(long.sharpe > 0 && long.sortino > long.sharpe);
  assert.ok(long.annualReturn > 0 && long.positiveMonths <= long.months && long.months >= 9);
  assert.equal(accountStats([], 1), null);
  assert.equal(accountStats(trades, 0), null);
});

test('lo que usó la regla en el trade elegido pasa al gráfico: líneas, elementos, régimen, filas y señales', () => {
  const H = 3600000;
  const context = {
    success: true, tf: 240, from: 0, to: 40 * H, side: 1, signal: 8 * H,
    lines: [{ label: 'EMA 50', type: 'ema', points: [[0, 100], [4 * H, 101]] },
      { label: 'VWAP 200', type: 'vwap', points: [[0, 99]], limit: [[0, 103]], limitLabel: 'VWAP 200 +2 desv.' }],
    channel: { mid: [[0, 100]], high: [[0, 104]], low: [[0, 96]] },
    elements: [{ code: 'FV', dir: 1, t: 4 * H, known: 8 * H, lo: 98, hi: 99 }, { code: 'FV', dir: -1, t: 12 * H, known: 16 * H, lo: null, hi: 100 }],
    regime: { label: 'Régimen', boxes: [{ start: 0, known: 8 * H, end: 20 * H, low: 95, high: 105, major: true }] },
    rows: [{ key: 'oi', label: 'OI sube', items: [[0, 1], [4 * H, 0], [8 * H, null]], note: 'OI +3%' }, { key: 'cvd', label: 'CVD', items: [], note: '' }],
    signals: [{ t: 8 * H, dir: 1, what: 'trade', n: 3 }, { t: 12 * H, dir: -1, what: 'filtro de CVD u OI' }]
  };
  const bands = contextBands(context, { FV: 'FVG nuevo' });
  const kinds = (kind) => bands.filter(b => b.kind === kind);
  assert.equal(kinds('outline').length, 2, 'la caja del régimen: punteada antes de saberse y continua después');
  assert.ok(kinds('outline').every(b => b.tone === 'major'));
  assert.equal(kinds('event').length, 1, 'un elemento sin zona no se dibuja');
  assert.equal(kinds('event')[0].label, '▲ FVG nuevo');
  assert.equal(kinds('event')[0].end, 12 * H, 'llega una vela más allá de cuando se supo');
  assert.deepEqual(kinds('line').map(b => b.label), ['EMA 50', 'VWAP 200', 'VWAP 200 +2 desv.', 'Línea central', 'Banda superior', 'Banda inferior']);
  assert.ok(kinds('line').every(b => b.tf === 4 * H), 'cada punto en su vela de la regla');
  assert.deepEqual(kinds('ticks').map(b => [b.row, b.rows, b.label]), [[0, 2, 'OI sube'], [1, 2, 'CVD']]);
  assert.deepEqual(kinds('signal').map(b => [b.taken, b.label, b.dir]), [[true, 'T3', 1], [false, '', -1]]);
  assert.deepEqual(skippedSignals(context).map(s => s.what), ['filtro de CVD u OI']);
  assert.deepEqual(contextBands({ success: false }), []);
  assert.deepEqual(contextBands(null), []);
});

test('cada condición de la regla al cerrar la vela de la señal: elementos que dispararon y filtros con su valor', () => {
  const H = 3600000;
  const context = {
    success: true, tf: 240, signal: 8 * H,
    rows: [
      { key: 'line1', label: 'EMA 50 a favor', items: [[4 * H, 0], [8 * H, 1]], note: 'EMA 50 en 11698.7, cierre en 11305.5' },
      { key: 'oi', label: 'OI sube más de 2% en 6 velas', items: [[8 * H, 1]], note: 'OI +6.89% en 6 velas' }
    ]
  };
  const recipe = { mode: 'threshold', min: 1, window: 1, slots: [{ codes: ['FV'] }, { codes: ['DJ'] }] };
  const trade = { votes: ['FV'], entry_t: 12 * H, dir: -1 };
  const check = signalChecklist(context, trade, recipe, { FV: 'FVG nuevo', DJ: 'Doji' });
  assert.equal(check.all, true, 'un trade que se repite igual tiene todo en ✓');
  assert.deepEqual(check.items.map(i => [i.ok, i.label]), [
    [true, 'Elementos (al menos 1 de 2)'], [true, 'EMA 50 a favor'], [true, 'OI sube más de 2% en 6 velas']
  ]);
  assert.equal(check.items[0].note, '✓ FVG nuevo  ✗ Doji', 'qué elementos dispararon');
  assert.equal(check.items[2].note, 'OI +6.89% en 6 velas');
  // Un filtro que no pasa o sin dato en la señal se ve: algo no cuadra
  const broken = signalChecklist({ ...context, signal: 4 * H }, trade, recipe);
  assert.equal(broken.all, false);
  assert.deepEqual(broken.items.slice(1).map(i => i.ok), [false, null]);
  const band = checklistBand(check, context, 'Señal');
  assert.deepEqual([band.kind, band.tf, band.rows, band.time, band.items.length], ['checklist', 4 * H, 2, 8 * H, 3]);
  assert.equal(signalChecklist({ success: false }, trade, recipe), null);
  assert.equal(checklistBand(null, context, 'x'), null);
  const strict = signalChecklist(context, { votes: ['FV', 'DJ'] }, { mode: 'strict', min: 2, window: 3, slots: [{ codes: ['FV'] }, { codes: ['DJ'] }] });
  assert.equal(strict.items[0].label, 'Elementos (todos, en 3 velas)');
});

test('el objetivo arrastrado: viaja solo si se pide y con el objetivo en R, y vuelve igual del historial', () => {
  const plain = toBackendRule({ ...defaultRule(), targetR: 3 });
  assert.equal('tpTrail' in plain.exit, false, 'sin pedirlo no cambia la identidad de la regla');
  const rule = { ...defaultRule(), codes: ['FV'], targetR: 3, tpTrailOn: true, tpTrailStart: 2.5, tpTrailDist: 0.5, tpTrailUnit: 'r' };
  const sent = toBackendRule(rule);
  assert.deepEqual(sent.exit.tpTrail, { start: 2.5, dist: 0.5, unit: 'r' });
  assert.equal(toBackendRule({ ...rule, tpTrailStart: 4 }).exit.tpTrail.start, 3, 'el arranque no pasa del objetivo');
  assert.equal('tpTrail' in toBackendRule({ ...rule, useTarget: false }).exit, false, 'sin objetivo no hay qué arrastrar');
  const profile = { ...rule, codes: ['VE'], targetAt: 'poc' };
  assert.equal(targetInR(profile), false);
  assert.equal('tpTrail' in toBackendRule(profile).exit, false, 'un objetivo en el perfil no se arrastra');
  assert.equal(targetInR({ ...profile, targetAt: 'r' }), true);
  const back = fromBackendRule(sent);
  assert.deepEqual([back.tpTrailOn, back.tpTrailStart, back.tpTrailDist, back.tpTrailUnit], [true, 2.5, 0.5, 'r']);
  assert.deepEqual(toBackendRule(back).exit, sent.exit);
  assert.equal(fromBackendRule(plain).tpTrailOn, false);
  assert.match(describeRule(sent), /3R arrastrado desde 2\.5R a 0\.5R/);
  assert.match(describeRule(toBackendRule({ ...rule, tpTrailUnit: 'pct', tpTrailDist: 1 })), /a 1%/);
});

test('el trade elegido dibuja dónde se activa el trailing del objetivo y el objetivo arrastrado', () => {
  const H = 3600000;
  const context = {
    success: true, tf: 240, side: 1, stopPath: [[0, 98, 'inicial'], [4 * H, 98, 'inicial'], [8 * H, 98, 'inicial']],
    tpStart: { price: 105, r: 2.5, t: 4 * H + 2 }, tpPath: [[4 * H, 104.5], [8 * H, 106]]
  };
  const bands = contextBands(context);
  const level = bands.find(b => b.kind === 'level');
  assert.deepEqual([level.price, level.start, level.end], [105, 0, 4 * H + 2]);
  assert.match(level.label, /Se activa el trailing · 2\.5R$/);
  assert.equal(level.labelBelow, false, 'en un largo, arriba: ahí no hay velas mientras no se activa');
  const steps = bands.filter(b => b.kind === 'steps');
  assert.equal(steps.length, 2, 'el stop y el objetivo arrastrado');
  assert.deepEqual(steps[1].points, [[4 * H, 104.5, 'objetivo'], [8 * H, 106, 'objetivo']]);
  assert.equal(steps[1].label, 'objetivo arrastrado');
  // Si el precio nunca llegó al arranque, la línea va hasta la salida y lo dice
  const never = contextBands({ ...context, tpStart: { price: 105, r: 2.5, t: null }, tpPath: [] });
  const line = never.find(b => b.kind === 'level');
  assert.equal(line.end, 12 * H);
  assert.match(line.label, /no llegó/);
  assert.equal(never.filter(b => b.kind === 'steps').length, 1);
  // Si se activa y sale en la misma vela, los escalones van sin rótulo: la salida ya lo dice
  const quick = contextBands({ ...context, side: -1, tpPath: [[4 * H, 104.5]] });
  assert.equal(quick.find(b => b.kind === 'level').labelBelow, true, 'en un corto, abajo');
  assert.equal(quick.filter(b => b.kind === 'steps')[1].label, '');
  // La salida dice su motivo
  const trade = { dir: 1, entry_t: 0, exit_t: 12 * H, exit: 107, r: 3.44, reason: 'objetivo arrastrado', target: 106, signal: -4 * H };
  const exit = tradeBands(trade, 240).find(b => b.kind === 'exit');
  assert.equal(exit.label, 'Salida en el objetivo arrastrado · +3.44 R');
  assert.equal(exit.atEdge, false, 'sale dentro de la vela, en su precio');
  assert.equal(tradeBoxes([trade], 240)[0].noTarget, false, 'la caja lleva su objetivo fijo');
  // El cuadro de la vela de la señal va abajo en un largo (el trade sube por donde iría) y arriba en un corto
  const check = { time: 0, items: [] };
  assert.equal(checklistBand(check, { tf: 240, rows: [], side: 1 }, 'x').below, true);
  assert.equal(checklistBand(check, { tf: 240, rows: [], side: -1 }, 'x').below, false);
});

test('al elegir un trade, los indicadores de la regla: cuáles, en qué marco y con qué ajustes (21/11)', () => {
  const back = (change) => toBackendRule({ ...defaultRule(), tf: 240, ...change });
  // La regla del usuario: los tres sabios con el cierre del lado de los dientes
  const sabios = back({ codes: ['WD', 'WA', 'WF'], mode: 'atLeast', min: 1, bwAlligator: 'side' });
  assert.deepEqual(ruleIndicators(sabios), ['Alligator', 'Fractales', 'Tres sabios', 'AO']);
  assert.deepEqual(ruleIndicators(back({ codes: ['WA'], bwAo: 'zero', bwGator: 'open', bwMfi: 'volume', bwAc: 'color', bwZone: true })),
    ['Tres sabios', 'Zonas de Williams', 'AO', 'AC', 'Gator', 'MFI']);
  assert.deepEqual(ruleIndicators(back({ codes: ['WF'], wiseTeeth: false })), ['Fractales', 'Tres sabios'], 'sin mirar los dientes, sin Alligator');
  assert.deepEqual(ruleIndicators(back({ codes: ['WD'], wiseRequireAo: false })), ['Alligator', 'Tres sabios']);
  assert.deepEqual(ruleIndicators(back({ codes: ['OB'] })), ['Estructura SMC']);
  assert.deepEqual(ruleIndicators(back({ codes: ['FV'], smcPd: true })), ['Estructura SMC']);
  assert.deepEqual(ruleIndicators(back({ codes: ['FV'], cvdOn: true, oiMode: 'rise' })), ['CVD', 'Open Interest']);
  assert.deepEqual(ruleIndicators(back({ codes: ['FV'], oiMode: 'conf' })), ['OI-Volume Confluence']);
  assert.deepEqual(ruleIndicators(back({ codes: ['FV'], emaMode: 'side' })), [], 'la EMA la dibuja el contexto del trade');
  assert.deepEqual(ruleIndicators(null), []);
  // El marco del gráfico de la regla: 30m y 1D no están en el gráfico
  assert.equal(chartTfOf(240), '4h');
  assert.equal(chartTfOf(15), '15m');
  assert.equal(chartTfOf(30), null);
  assert.equal(chartTfOf(1440), null);
  // Williams: el cálculo con los de fábrica (los de williams.py) y los sabios de la regla; el gráfico conserva lo suyo
  const mine = defaultWilliamsConfig();
  mine.alligator = { ...mine.alligator, jawLen: 21, jawColor: '#000000' };
  mine.ao = { ...mine.ao, slow: 55 };
  mine.wise = { ...mine.wise, angBars: 9 };
  const solo2 = back({ codes: ['WA'], entryType: 'stop', entryExpiry: 6, wiseAngBars: 7, wiseRequireAo: false });
  const cfg = ruleWilliamsConfig(solo2, mine);
  assert.equal(cfg.alligator.jawLen, 13);
  assert.equal(cfg.alligator.jawColor, '#000000', 'los colores siguen siendo los del gráfico');
  assert.equal(cfg.ao.slow, 34);
  assert.deepEqual([cfg.wise.first, cfg.wise.second, cfg.wise.third], [false, true, false], 'solo el 2.º sabio');
  assert.equal(cfg.wise.angBars, 7);
  assert.equal(cfg.wise.requireAo, false);
  assert.equal(cfg.wise.pendingBars, 6, 'lo que espera la orden stop de la regla');
  assert.equal(ruleWilliamsConfig(back({ codes: ['WA'] }), mine).wise.pendingBars, defaultWilliamsConfig().wise.pendingBars, 'a mercado, lo de fábrica');
  assert.deepEqual(ruleWilliamsConfig(back({ codes: ['FV'], bwAo: 'color' }), mine).wise, mine.wise, 'sin sabios en la regla, los del gráfico quedan');
  // SMC: las longitudes y el order block de la regla, y el rango de sus filtros
  const smcRule = back({ codes: ['OB', 'EQ'], smcScope: 'internal', smcSwing: 20, smcInternal: 7, smcPick: 'opposite', smcArea: 'body', smcMitigation: 'wick',
    smcEqLength: 4, smcEqThreshold: 0.25, smcPd: true, useTarget: true, targetAt: 'weak' });
  const mineSmc = defaultSmcConfig();
  mineSmc.bullColor = '#123456';
  const smc = ruleSmcConfig(smcRule, mineSmc);
  assert.equal(smc.swing.length, 20);
  assert.equal(smc.internal.length, 7);
  assert.deepEqual([smc.ob.pick, smc.ob.area, smc.ob.mitigation], ['opposite', 'body', 'wick']);
  assert.deepEqual([smc.equal.length, smc.equal.threshold], [4, 0.25]);
  assert.equal(smc.zones.show, true, 'con premium y discount en la regla, sus zonas a la vista');
  assert.equal(smc.strongWeak.show, true);
  assert.equal(smc.bullColor, '#123456');
  assert.equal(listText(['Alligator', 'Fractales', 'AO']), 'Alligator, Fractales y AO');
  assert.equal(listText(['AO']), 'AO');
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
