// Niveles elegidos en el gráfico y dibujos que viajan con cada orden. Uso: node tests/levels.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

const log = console.log;
console.log = () => {};
console.warn = () => {};

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};

const levels = await import('../src/components/indicators/analysisLevels.js');
const { DRAWING_WINDOW_CANDLES, drawingsForOrder } = await import('../src/components/backtesting/tradeContext.js');
const { default: DrawingToolManager } = await import('../src/components/drawing/DrawingToolManager.js');
const { default: IndicatorManager } = await import('../src/components/indicators/IndicatorManager.js');
const { default: VolumeProfile } = await import('../src/components/indicators/VolumeProfileIndicator.js');
const { default: FixedRange } = await import('../src/components/indicators/VolumeProfileFixedRangeIndicator.js');
const { default: Periodic } = await import('../src/components/indicators/VolumeProfilePeriodicIndicator.js');
const { default: SupportResistance } = await import('../src/components/indicators/SupportResistanceIndicator.js');
const { default: SupportResistance2 } = await import('../src/components/indicators/SupportResistance2Indicator.js');
const { SessionProfiles } = await import('../src/components/indicators/sessionProfile.js');
const observer = await import('../src/components/backtesting/observer.js');

const HOUR = 3600000;
const MINUTE = 60000;
const tests = [];
const test = (name, run) => tests.push([name, run]);

let counter = 0;
const symbol = () => `PRUEBA${++counter}`;
const level = (price = 100, changes = {}) => ({ id: `Fuente|POC|${price}`, source: 'Fuente', kind: 'POC', price, ...changes });

test('elegir: se agrega con la hora simulada y el marco', () => {
  const name = symbol();
  levels.toggleLevel(name, level(), 5000, '15m');
  assert.deepEqual(levels.knownLevels(name, 5000), [{ id: 'Fuente|POC|100', source: 'Fuente', kind: 'POC', price: 100, role: null, note: '', selectedAt: 5000, timeframe: '15m' }]);
  assert.equal(levels.isChosen(name, 'Fuente|POC|100'), true);
});

test('elegir: el mismo nivel otra vez lo quita', () => {
  const name = symbol();
  levels.toggleLevel(name, level(), 5000, '15m');
  levels.toggleLevel(name, level(), 6000, '15m');
  assert.deepEqual(levels.knownLevels(name, 9000), []);
});

test('elegir: guarda solo lo que describe al nivel', () => {
  const name = symbol();
  levels.toggleLevel(name, { ...level(), y: 40, left: 1, right: 2, start: 3, end: 4 }, 5000, '1h');
  assert.deepEqual(Object.keys(levels.knownLevels(name, 5000)[0]).sort(), ['id', 'kind', 'note', 'price', 'role', 'selectedAt', 'source', 'timeframe']);
});

test('sin futuro: al retroceder no aparece lo elegido después', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 5000, '15m');
  levels.toggleLevel(name, level(200), 9000, '15m');
  assert.deepEqual(levels.knownLevels(name, 6000).map(item => item.price), [100]);
});

test('lista: quitar uno y quitar todos', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1, '15m');
  levels.toggleLevel(name, level(200), 1, '15m');
  levels.removeLevel(name, 'Fuente|POC|100');
  assert.deepEqual(levels.knownLevels(name, 2).map(item => item.price), [200]);
  levels.clearLevels(name);
  assert.deepEqual(levels.knownLevels(name, 2), []);
});

test('lista: cada símbolo tiene la suya', () => {
  const first = symbol();
  const second = symbol();
  levels.toggleLevel(first, level(), 1, '15m');
  assert.deepEqual(levels.knownLevels(second, 2), []);
});

test('lista: se guarda y vuelve al abrir', () => {
  const name = symbol();
  stored.set(`analysis_levels_v2_${name}`, JSON.stringify([{ ...level(), selectedAt: 1 }]));
  assert.equal(levels.knownLevels(name, 2).length, 1);
  levels.toggleLevel(name, level(300), 1, '1h');
  assert.equal(JSON.parse(stored.get(`analysis_levels_v2_${name}`)).length, 2);
});

test('lista: la de antes, que juntaba lo elegido para todos los trades, no se carga', () => {
  const name = symbol();
  stored.set(`analysis_levels_${name}`, JSON.stringify([{ ...level(), selectedAt: 1 }]));
  assert.deepEqual(levels.knownLevels(name, 2), []);
});

test('trade: lo elegido pasa a la orden y la lista queda vacía', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1000, '15m');
  levels.toggleLevel(name, level(200, { id: 'Fuente|VAH|200', kind: 'VAH' }), 2000, '1h');
  const taken = levels.takeLevels(name, 3000);
  assert.deepEqual(taken.map(item => [item.kind, item.price, item.timeframe]), [['POC', 100, '15m'], ['VAH', 200, '1h']]);
  assert.deepEqual(levels.knownLevels(name, 3000), []);
  assert.equal(levels.isChosen(name, 'Fuente|POC|100'), false);
  assert.equal(levels.chosenLevel(name, 'Fuente|VAH|200', 3000), null);
});

test('trade: el siguiente lleva solo lo elegido para él', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1000, '15m');
  const first = levels.takeLevels(name, 1500);
  levels.toggleLevel(name, level(300), 2000, '15m');
  const second = levels.takeLevels(name, 2500);
  const third = levels.takeLevels(name, 3000);
  assert.deepEqual(first.map(item => item.price), [100]);
  assert.deepEqual(second.map(item => item.price), [300]);
  assert.deepEqual(third, []);
});

test('trade: la orden conserva su papel y su nota aunque se vuelva a elegir lo mismo', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1000, '15m');
  levels.updateLevel(name, 'Fuente|POC|100', { role: 'support', note: 'rebote' });
  const taken = levels.takeLevels(name, 1500);
  levels.toggleLevel(name, level(100), 2000, '15m');
  levels.updateLevel(name, 'Fuente|POC|100', { role: 'resistance', note: 'otra idea' });
  assert.deepEqual([taken[0].role, taken[0].note, taken[0].selectedAt], ['support', 'rebote', 1000]);
  assert.deepEqual(levels.knownLevels(name, 2000).map(item => [item.role, item.note]), [['resistance', 'otra idea']]);
});

test('trade: lo elegido después de la hora de la orden, tras retroceder, sigue guardado', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1000, '15m');
  levels.toggleLevel(name, level(200), 9000, '15m');
  assert.deepEqual(levels.takeLevels(name, 5000).map(item => item.price), [100]);
  assert.deepEqual(levels.knownLevels(name, 9000).map(item => item.price), [200]);
});

test('trade: lo elegido en la misma hora de la orden también pasa a ella', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1000, '15m');
  assert.deepEqual(levels.takeLevels(name, 1000).map(item => item.price), [100]);
});

test('trade: avisa al panel y al gráfico al vaciar la lista, y sin nada elegido no avisa', () => {
  const name = symbol();
  let calls = 0;
  const stop = levels.subscribeLevels(name, () => { calls += 1; });
  assert.deepEqual(levels.takeLevels(name, 1000), []);
  assert.equal(calls, 0);
  levels.toggleLevel(name, level(100), 1000, '15m');
  levels.takeLevels(name, 1500);
  assert.equal(calls, 2);
  stop();
});

test('trade: al recargar, la lista sigue vacía', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1000, '15m');
  levels.takeLevels(name, 1500);
  assert.deepEqual(JSON.parse(stored.get(`analysis_levels_v2_${name}`)), []);
});

test('lista: avisa los cambios y deja de avisar', () => {
  const name = symbol();
  let calls = 0;
  const stop = levels.subscribeLevels(name, () => { calls += 1; });
  levels.toggleLevel(name, level(), 1, '15m');
  assert.equal(calls, 1);
  stop();
  levels.clearLevels(name);
  assert.equal(calls, 1);
});

test('perfil: POC, VAH y VAL', () => {
  const profile = { poc: { price: 100 }, valueArea: { vahPrice: 110, valPrice: 90 } };
  const found = levels.profileLevels(profile, 'VP Fixed Range');
  assert.deepEqual(found.map(item => [item.kind, item.price]), [['POC', 100], ['VAH', 110], ['VAL', 90]]);
  assert.equal(found[0].id, 'VP Fixed Range|POC|100.00');
  assert.equal(new Set(found.map(item => item.id)).size, 3);
  assert.deepEqual(levels.profileLevels(null, 'X'), []);
});

test('perfil: las horas de la sesión viajan con cada nivel', () => {
  const profile = { poc: { price: 100 }, valueArea: { vahPrice: 110, valPrice: 90 } };
  assert.equal(levels.profileLevels(profile, 'VP Periodic', { start: 1, end: 2 })[0].end, 2);
});

test('soportes y resistencias: una fila por precio', () => {
  assert.deepEqual(levels.priceLevels([{ price: 50, touches: 3 }], 'S&R v2', 'Soporte'), [{ id: 'S&R v2|Soporte|50.00', source: 'S&R v2', kind: 'Soporte', price: 50 }]);
  assert.deepEqual(levels.priceLevels(undefined, 'S&R v2', 'Soporte'), []);
});

const area = { priceToY: (price) => 500 - price, timeToX: (time) => time / 10, left: 10, right: 400, top: 20, bottom: 480 };

test('pantalla: ubica cada nivel y deja fuera los que no se ven', () => {
  const targets = levels.levelTargets([level(100), level(10)], area);
  assert.equal(targets.length, 1);
  assert.deepEqual([targets[0].y, targets[0].left, targets[0].right], [400, 10, 400]);
});

test('pantalla: un nivel con horas solo ocupa su sesión', () => {
  const [target] = levels.levelTargets([level(100, { start: 1000, end: 2000 })], area);
  assert.deepEqual([target.left, target.right], [100, 200]);
});

test('pantalla: sin posición para la hora usa los bordes', () => {
  const [target] = levels.levelTargets([level(100, { start: 1000, end: 2000 })], { ...area, timeToX: () => null });
  assert.deepEqual([target.left, target.right], [10, 400]);
});

test('clic: encuentra el nivel bajo el puntero y ordena por cercanía', () => {
  const targets = [{ id: 'a', y: 100, left: 0, right: 500 }, { id: 'b', y: 104, left: 0, right: 500 }, { id: 'c', y: 200, left: 0, right: 500 }];
  assert.deepEqual(levels.levelsNear(targets, 50, 103).map(item => item.id), ['b', 'a']);
  assert.deepEqual(levels.levelsNear(targets, 50, 150), []);
});

test('clic: fuera de su sesión no lo alcanza', () => {
  assert.deepEqual(levels.levelsNear([{ id: 'a', y: 100, left: 100, right: 200 }], 50, 100), []);
  assert.deepEqual(levels.levelsNear([{ id: 'a', y: 100, left: 100, right: 200 }], 250, 100), []);
  assert.equal(levels.levelsNear([{ id: 'a', y: 100, left: 100, right: 200 }], 150, 100).length, 1);
});

const fakeCanvas = () => {
  const drawn = [];
  const ctx = new Proxy({ fillText: (text) => drawn.push(text), measureText: () => ({ width: 40 }) }, {
    get: (target, name) => (name in target ? target[name] : () => {}),
    set: (target, name, value) => { target[name] = value; return true; }
  });
  return { ctx, drawn };
};

test('dibujo: etiqueta cada nivel elegido a la vista', () => {
  const { ctx, drawn } = fakeCanvas();
  levels.drawChosenLevels(ctx, [{ kind: 'POC', price: 100 }, { kind: 'VAH', price: 2 }], area);
  assert.deepEqual(drawn, ['POC 100.0']);
});

const DRAWING_TIME = 1000 * HOUR;
const CANDLE = 15 * MINUTE;
const WINDOW = DRAWING_WINDOW_CANDLES * CANDLE;
const horizontal = (changes = {}) => ({ type: 'horizontal', price: 105, time: DRAWING_TIME - CANDLE, createdAt: null, ...changes });

test('dibujos: la ventana mide 100 velas', () => {
  assert.equal(DRAWING_WINDOW_CANDLES, 100);
});

test('dibujos: línea anclada en las últimas velas', () => {
  assert.equal(drawingsForOrder([horizontal()], DRAWING_TIME, CANDLE).length, 1);
  assert.equal(drawingsForOrder([horizontal({ time: DRAWING_TIME - WINDOW })], DRAWING_TIME, CANDLE).length, 1);
  assert.equal(drawingsForOrder([horizontal({ time: DRAWING_TIME - WINDOW - 1 })], DRAWING_TIME, CANDLE).length, 0);
});

test('dibujos: una línea anclada lejos cuenta si se trazó hace poco', () => {
  const old = horizontal({ time: DRAWING_TIME - 10 * WINDOW, createdAt: DRAWING_TIME - CANDLE });
  assert.equal(drawingsForOrder([old], DRAWING_TIME, CANDLE).length, 1);
});

test('dibujos: lo hecho después de la orden no cuenta', () => {
  assert.equal(drawingsForOrder([horizontal({ createdAt: DRAWING_TIME + 1 })], DRAWING_TIME, CANDLE).length, 0);
  assert.equal(drawingsForOrder([horizontal({ time: DRAWING_TIME + 1 })], DRAWING_TIME, CANDLE).length, 0);
});

test('dibujos: un rectángulo que cruza la ventana cuenta y trae sus bordes', () => {
  const shape = { type: 'rectangle', price1: 90, price2: 110, time1: DRAWING_TIME - 2 * WINDOW, time2: DRAWING_TIME - 10 };
  assert.deepEqual(drawingsForOrder([shape], DRAWING_TIME, CANDLE), [{ type: 'rectangle', high: 110, low: 90, start: shape.time1, end: shape.time2, createdAt: null }]);
});

test('dibujos: una línea de tendencia conserva sus puntos', () => {
  const shape = { type: 'trendline', price1: 90, price2: 110, time1: DRAWING_TIME - 40, time2: DRAWING_TIME - 10 };
  assert.deepEqual(drawingsForOrder([shape], DRAWING_TIME, CANDLE)[0], { ...shape, createdAt: null });
});

test('dibujos: Fibonacci calcula sus niveles como en el gráfico', () => {
  const shape = { type: 'fibonacci', price1: 100, price2: 200, time1: DRAWING_TIME - 40, time2: DRAWING_TIME - 10 };
  const [drawing] = drawingsForOrder([shape], DRAWING_TIME, CANDLE);
  assert.deepEqual(drawing.levels.map(item => item.price), [200, 227, 261.8, 300]);
});

test('dibujos: la caja TP/SL, las medidas y los textos no son referencias', () => {
  const shapes = ['tpsl', 'measurement', 'textbox'].map(type => ({ type, time1: DRAWING_TIME, time2: DRAWING_TIME, time: DRAWING_TIME }));
  assert.deepEqual(drawingsForOrder(shapes, DRAWING_TIME, CANDLE), []);
});

test('dibujos: sin dibujos no falla', () => {
  assert.deepEqual(drawingsForOrder(undefined, DRAWING_TIME, CANDLE), []);
});

test('dibujos: la hora en que se trazó sobrevive al guardar y cargar', () => {
  const manager = new DrawingToolManager('X', '15m');
  manager.loadShapes([{ type: 'horizontal', id: 'h', price: 100, time: 5, createdAt: 77 }]);
  assert.equal(manager.getShapes()[0].createdAt, 77);
  manager.saveToHistory();
  manager.loadShapes(manager.getShapes());
  assert.equal(manager.shapes[0].createdAt, 77);
});

test('dibujos: uno viejo sin esa hora sigue cargando', () => {
  const manager = new DrawingToolManager('X', '15m');
  manager.loadShapes([{ type: 'horizontal', id: 'h', price: 100, time: 5 }]);
  assert.equal(manager.getShapes()[0].createdAt, null);
});

test('indicadores: cada uno ofrece los niveles que muestra', () => {
  const profile = { poc: { price: 100 }, valueArea: { vahPrice: 110, valPrice: 90 } };
  const dynamic = new VolumeProfile('X', '15');
  dynamic.profile = profile;
  assert.equal(dynamic.selectableLevels()[0].source, 'Volume Profile');

  const fixed = new FixedRange('X', '15', 'r1');
  fixed.setTimeRange(1000, 2000);
  fixed.profile = profile;
  const inRange = fixed.selectableLevels()[1];
  assert.deepEqual([inRange.source, inRange.start, inRange.end], ['VP Fixed Range', 1000, 2000]);

  const periodic = new Periodic('X', '15', 30, new SessionProfiles('X'));
  periodic.shownSessions = [{ start: 0, profile }];
  const session = periodic.selectableLevels()[0];
  assert.deepEqual([session.source, session.start, session.end], ['VP Periodic', 0, 24 * HOUR]);

  for (const [Indicator, source] of [[SupportResistance, 'Support & Resistance'], [SupportResistance2, 'S&R v2']]) {
    const target = new Indicator('X', '15', 30);
    target.resistances = [{ price: 120 }];
    target.supports = [{ price: 80 }];
    assert.deepEqual(target.selectableLevels().map(item => [item.source, item.kind, item.price]), [[source, 'Resistencia', 120], [source, 'Soporte', 80]]);
  }
});

test('indicadores: soportes o resistencias ocultos no se ofrecen', () => {
  for (const Indicator of [SupportResistance, SupportResistance2]) {
    const target = new Indicator('X', '15', 30);
    target.resistances = [{ price: 120 }];
    target.supports = [{ price: 80 }];
    target.showResistances = false;
    assert.deepEqual(target.selectableLevels().map(item => item.price), [80]);
    target.showResistances = true;
    target.showSupports = false;
    assert.deepEqual(target.selectableLevels().map(item => item.price), [120]);
  }
});

test('indicadores: periodic sin dibujar no ofrece nada', () => {
  assert.deepEqual(new Periodic('X', '15', 30, new SessionProfiles('X')).selectableLevels(), []);
});

test('indicadores: un rango que no se dibuja por la hora simulada no ofrece niveles', () => {
  const manager = new IndicatorManager('X', '15', 30);
  const range = { enabled: true, symbol: 'X', rangeId: 'r', selectableLevels: () => [level(1)], renderOverlay: () => {} };
  manager.indicators = [];
  manager.fixedRangeIndicators = [range];
  manager.fixedRangeProfiles = [{ rangeId: 'r', isAutoDetected: true, endTimestamp: 2000, interval: '15' }];
  const context = (knownUntil) => ({ knownCandles: [], knownUntil });

  manager.renderFixedRangeProfiles(null, {}, [], [], context(1000));
  assert.deepEqual(manager.getSelectableLevels(), []);
  manager.renderFixedRangeProfiles(null, {}, [], [], context(3000));
  assert.equal(manager.getSelectableLevels().length, 1);
});

test('indicadores: solo los encendidos y también los rangos fijos', () => {
  const manager = new IndicatorManager('X', '15', 30);
  const on = { enabled: true, selectableLevels: () => [level(1)] };
  const off = { enabled: false, selectableLevels: () => [level(2)] };
  const fixed = { enabled: true, selectableLevels: () => [level(3)] };
  manager.indicators = [on, off, { enabled: true }];
  manager.fixedRangeIndicators = [fixed];
  assert.deepEqual(manager.getSelectableLevels().map(item => item.price), [1, 3]);
});

test('indicadores: el perfil oculto por los rangos fijos no se ofrece', () => {
  const manager = new IndicatorManager('X', '15', 30);
  const dynamic = { enabled: true, hideWhenFixedRanges: true, selectableLevels: () => [level(1)] };
  const range = { enabled: true, symbol: 'X', selectableLevels: () => [level(2)] };
  manager.indicators = [dynamic];
  manager.fixedRangeIndicators = [range];
  assert.deepEqual(manager.getSelectableLevels().map(item => item.price), [2]);
  range.enabled = false;
  assert.deepEqual(manager.getSelectableLevels().map(item => item.price), [1]);
});

test('orden: viaja con sus dibujos y niveles y sin motivos', async () => {
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push([url, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({}) };
  };
  await observer.recordOrder({ id: 1, entryTime: 5, type: 'limit', side: 'long', entryPrice: 100, marks: { reasons: ['fvg'] } }, {
    symbol: 'X', timeframe: '15m', session: 's', price: 101, rewound: false, indicators: [], ranges: [],
    drawings: [{ type: 'horizontal', price: 90 }], levels: [{ kind: 'POC', price: 95 }]
  });
  const [, body] = sent[0];
  assert.deepEqual(body.drawings, [{ type: 'horizontal', price: 90 }]);
  assert.deepEqual(body.levels, [{ kind: 'POC', price: 95 }]);
  assert.deepEqual(body.marks.reasons, []);
});

test('motivos: se agregan después como un evento de la orden', async () => {
  const sent = [];
  globalThis.fetch = async (url, options) => {
    sent.push([url, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({}) };
  };
  await observer.recordMarks('abc', { reasons: ['fvg'] });
  assert.ok(sent[0][0].endsWith('/orders/abc/events'));
  assert.deepEqual(sent[0][1], { event: 'marks', marks: { reasons: ['fvg'] } });
});

test('medidas: cada valor se lee en palabras', () => {
  assert.equal(observer.formatMeasure('leg_1h', 1), 'A favor');
  assert.equal(observer.formatMeasure('leg_4h', -1), 'En contra');
  assert.equal(observer.formatMeasure('leg_age_1h', 12), 12);
  assert.equal(observer.formatMeasure('hour', 14), '14:00');
  assert.equal(observer.formatMeasure('poc_dist', 1.23456), 1.23);
  assert.equal(observer.formatMeasure('poc_dist', null), '—');
});

test('regla: arma la petición y avisa lo que falta', () => {
  const fields = { conditions: [{ key: 'a', op: '>=', value: '1.5' }], side: 'both', stopAtr: '1.5', targetR: '2', horizon: '96', cooldown: '16' };
  assert.deepEqual(observer.ruleRequest(fields).rule, { conditions: [{ key: 'a', op: '>=', value: 1.5 }], side: 'both', stop_atr: 1.5, target_r: 2, horizon: 96, cooldown: 16 });
  assert.ok(observer.ruleRequest({ ...fields, conditions: [{ key: 'a', op: '>=', value: '' }] }).error);
  assert.ok(observer.ruleRequest({ ...fields, stopAtr: '0' }).error);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    log(`FALLA ${name}: ${error.message}`);
  }
}
log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
