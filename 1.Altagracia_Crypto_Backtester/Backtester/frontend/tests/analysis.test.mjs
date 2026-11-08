// Niveles y marcas elegidos en el gráfico con su papel y su nota, lo que ofrece cada indicador
// y dónde queda cada uno en las imágenes. Uso: node tests/analysis.test.mjs
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
const { default: FVG } = await import('../src/components/indicators/FVGIndicator.js');
const { default: ResponseVolume } = await import('../src/components/indicators/ResponseVolumeIndicator.js');
const { default: OrderFlow } = await import('../src/components/indicators/OrderFlowIndicator.js');
const { default: Swing } = await import('../src/components/indicators/SwingDetectorIndicator.js');
const { default: DoubleTopBottom } = await import('../src/components/indicators/DoubleTopBottomIndicator.js');
const { default: Rejection } = await import('../src/components/indicators/RejectionPatternIndicator.js');

const tests = [];
const test = (name, run) => tests.push([name, run]);

let counter = 0;
const symbol = () => `ANALISIS${++counter}`;
const level = (price = 100, changes = {}) => ({ id: `Fuente|POC|${price}`, source: 'Fuente', kind: 'POC', price, ...changes });
const mark = (changes = {}) => ({
  id: 'Volumen de Respuesta|Rombo|5000', source: 'Volumen de Respuesta', kind: 'Rombo', price: 120, time: 5000, mark: true, ...changes
});
const area = { priceToY: (price) => 500 - price, timeToX: (time) => time / 10, left: 10, right: 400, top: 20, bottom: 480 };

/** Contexto de canvas que anota lo que importa y acepta todo lo demás */
function recorder() {
  const calls = { fonts: [], moveTo: [], arcs: [] };
  const target = {
    calls,
    measureText: () => ({ width: 10 }),
    moveTo: (x, y) => calls.moveTo.push([x, y]),
    arc: (x, y) => calls.arcs.push([x, y])
  };
  return new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : () => {}),
    set: (object, key, value) => {
      if (key === 'font') calls.fonts.push(value);
      object[key] = value;
      return true;
    }
  });
}

// ---- Papel y nota

test('papel: un nivel arriba del precio entra como resistencia y abajo como soporte', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1, '15m', 90);
  levels.toggleLevel(name, level(80), 1, '15m', 90);
  assert.deepEqual(levels.knownLevels(name, 1).map(item => item.role), ['resistance', 'support']);
});

test('papel: sin precio actual queda por elegir', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1, '15m');
  assert.equal(levels.knownLevels(name, 1)[0].role, null);
  assert.equal(levels.roleLabel(null), 'Nivel');
});

test('papel: una marca entra como solo marca y no es un precio de referencia', () => {
  const name = symbol();
  levels.toggleLevel(name, mark(), 6000, '15m', 90);
  const [item] = levels.knownLevels(name, 6000);
  assert.equal(item.role, levels.MARK_ONLY);
  assert.equal(levels.isPriceLevel(item), false);
  assert.equal(levels.roleLabel(item.role), 'Solo marca');
  assert.equal(levels.isPriceLevel({ price: 100 }), true, 'un nivel elegido antes de los papeles sigue contando');
});

test('papel y nota: se cambian, se guardan y lo inválido se ignora', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 1, '15m', 90);
  levels.updateLevel(name, 'Fuente|POC|100', { role: 'entry', note: 'Rechazo con volumen' });
  levels.updateLevel(name, 'Fuente|POC|100', { role: 'otro', note: 5 });
  const item = levels.chosenLevel(name, 'Fuente|POC|100');
  assert.deepEqual([item.role, item.note, levels.roleLabel(item.role)], ['entry', 'Rechazo con volumen', 'Entrada']);
  assert.match(stored.get(`analysis_levels_v2_${name}`), /Rechazo con volumen/);
});

test('papel: una marca puede volverse nivel', () => {
  const name = symbol();
  levels.toggleLevel(name, mark(), 6000, '15m', 90);
  levels.updateLevel(name, mark().id, { role: 'support' });
  assert.equal(levels.isPriceLevel(levels.chosenLevel(name, mark().id)), true);
});

test('papel: los papeles son los cuatro pedidos', () => {
  assert.deepEqual(levels.ROLES.map(role => role.label), ['Soporte', 'Resistencia', 'Entrada', 'Objetivo']);
});

test('elegir: guarda la vela, la zona y si es marca, no el lugar en pantalla', () => {
  const name = symbol();
  const drawn = { ...mark(), low: 1, high: 2, x: 5, y: 6, r: 7, left: 1, right: 2, top: 3, bottom: 4, start: 9, end: 10 };
  levels.toggleLevel(name, drawn, 6000, '15m', 100);
  assert.deepEqual(Object.keys(levels.knownLevels(name, 6000)[0]).sort(),
    ['high', 'id', 'kind', 'low', 'mark', 'note', 'price', 'role', 'selectedAt', 'source', 'time', 'timeframe']);
});

test('id: la vela de la misma hora en otro marco es otra', () => {
  assert.notEqual(levels.candleItemId('X', 'Rombo', 7, null, '15m'), levels.candleItemId('X', 'Rombo', 7, null, '1h'));
  assert.notEqual(levels.candleItemId('Order Flow', 'POC de la vela', 7, 100, '15m'), levels.candleItemId('Order Flow', 'POC de la vela', 7, 100, '1h'));
});

test('retroceso: lo elegido después no sale elegido ni con su nota', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 5000, '15m', 90);
  levels.updateLevel(name, 'Fuente|POC|100', { role: 'entry', note: 'escrita después' });
  assert.equal(levels.chosenLevel(name, 'Fuente|POC|100', 4000), null);
  assert.equal(levels.chosenLevel(name, 'Fuente|POC|100', 5000).note, 'escrita después');
  assert.equal(levels.chosenLevel(name, 'Fuente|POC|100').note, 'escrita después', 'sin hora mira todo');
});

test('retroceso: elegir antes reemplaza lo elegido después en vez de borrarlo', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 5000, '15m', 90);
  levels.updateLevel(name, 'Fuente|POC|100', { note: 'escrita después' });
  levels.toggleLevel(name, level(100), 4000, '15m', 90);
  assert.deepEqual(levels.knownLevels(name, 4000).map(item => [item.selectedAt, item.note]), [[4000, '']]);
  assert.deepEqual(levels.knownLevels(name, 9000).map(item => item.selectedAt), [4000], 'no queda el de después repetido');
  levels.toggleLevel(name, level(100), 4000, '15m', 90);
  assert.deepEqual(levels.knownLevels(name, 9000), [], 'un segundo clic lo quita');
});

test('retroceso: Quitar todos deja lo elegido después', () => {
  const name = symbol();
  levels.toggleLevel(name, level(100), 3000, '15m', 90);
  levels.toggleLevel(name, level(200), 5000, '15m', 90);
  levels.clearLevels(name, 4000);
  assert.deepEqual(levels.knownLevels(name, 9000).map(item => item.price), [200]);
  levels.clearLevels(name);
  assert.deepEqual(levels.knownLevels(name, 9000), []);
});

test('vela: lo de un marco menor va en la vela del marco mayor que contiene su hora', () => {
  const HOUR = 3600000;
  const candles = [0, 1, 2].map(i => ({ timestamp: HOUR * (100 + i) }));
  const x = (time) => levels.candleCenterX(candles, HOUR, 10, 20, time);
  assert.equal(x(HOUR * 101 + 45 * 60000), 40, '15:45 va en la vela de las 15:00');
  assert.equal(x(HOUR * 101), 40, 'una hora exacta queda igual');
  assert.equal(x(HOUR * 102 + 30 * 60000), 60, 'la última vela visible');
  assert.equal(x(HOUR * 99), 0, 'antes de la primera queda a la izquierda del área');
  assert.equal(x(HOUR * 103 + 1), 80, 'después de la última queda a la derecha');
  assert.equal(levels.candleCenterX(candles, 0, 10, 20, HOUR * 101), null, 'sin marco conocido');
  assert.equal(levels.candleCenterX([{ timestamp: 0 }, { timestamp: 5 * HOUR }], HOUR, 10, 20, 2 * HOUR), null, 'un hueco de datos');
});

test('vela: la posición, el aro y la línea usan la vela que contiene la hora', () => {
  const candleX = () => 55;
  const item = { ...mark(), time: 1234 };
  const [position] = levels.itemPositions([item], [], { ...area, candleX });
  assert.equal(position.x, 55);
  const ctx = recorder();
  levels.drawChosenLevels(ctx, [level(100, { time: 1234, role: 'support' })], { ...area, candleX });
  assert.deepEqual(ctx.calls.moveTo, [[55, 400]]);
  const [target] = levels.levelTargets([level(100, { time: 1234 })], { ...area, candleX });
  assert.equal(target.left, 55);
  const [ranged] = levels.levelTargets([level(100, { start: 1000, end: 2000 })], { ...area, candleX });
  assert.deepEqual([ranged.left, ranged.right], [100, 200], 'un rango con horas sigue con timeToX');
});

test('FVG: un gap que se recorta conserva el id de sus bordes', () => {
  const candles = [candle(0, 99, 100, 98, 99.5), candle(1, 100, 106, 99, 105), candle(2, 105.5, 108, 105, 107), candle(3, 107, 108, 106, 107.5)];
  const offer = (known) => {
    const fvg = new FVG('FVGRECORTE', '15m');
    fvg.enabled = true;
    fvg.renderOverlay(recorder(), { x: 0, y: 0, width: 40, height: 400 }, known, known,
      { knownCandles: known, priceToY: (price) => 500 - price, timeToX: timeToX(known) });
    return fvg.selectableLevels();
  };
  const before = offer(candles);
  const after = offer([...candles, candle(4, 107, 107.5, 102.5, 107)]);
  assert.deepEqual(after.map(item => item.price), [102.5, 101.25, 100], 'el gap se recortó');
  assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
});

test('id: lo de una vela no se confunde con el mismo precio en otra', () => {
  assert.notEqual(levels.candleItemId('Order Flow', 'POC de la vela', 1, 100), levels.candleItemId('Order Flow', 'POC de la vela', 2, 100));
  assert.equal(levels.candleItemId('X', 'Rombo', 7), 'X|Rombo|7');
});

// ---- Clic

test('clic: una marca se alcanza dentro de su círculo', () => {
  const targets = [{ id: 'm', x: 100, y: 100, r: 8 }];
  assert.deepEqual(levels.levelsNear(targets, 105, 104).map(item => item.id), ['m']);
  assert.deepEqual(levels.levelsNear(targets, 110, 110), []);
});

test('clic: una zona se alcanza en todo su alto y solo en su ancho', () => {
  const targets = [{ id: 'z', left: 0, right: 50, top: 100, bottom: 140 }];
  assert.equal(levels.levelsNear(targets, 25, 130).length, 1);
  assert.equal(levels.levelsNear(targets, 25, 150).length, 0);
  assert.equal(levels.levelsNear(targets, 60, 120).length, 0);
});

test('clic: una zona también se alcanza justo afuera de su borde', () => {
  const targets = [{ id: 'z', left: 0, right: 50, top: 100, bottom: 140 }];
  assert.equal(levels.levelsNear(targets, 25, 98).length, 1);
  assert.equal(levels.levelsNear(targets, 25, 142).length, 1);
});

test('clic: va primero lo más cercano; dentro de una zona cuenta su centro, más suave', () => {
  const targets = [
    { id: 'linea', y: 104, left: 0, right: 500 },
    { id: 'marca', x: 50, y: 100, r: 8 },
    { id: 'zona', left: 0, right: 500, top: 90, bottom: 130 }
  ];
  assert.deepEqual(levels.levelsNear(targets, 50, 101).map(item => item.id), ['marca', 'zona', 'linea']);
  assert.deepEqual(levels.levelsNear(targets, 50, 91).map(item => item.id), ['zona'], 'lejos del centro de la zona pero dentro');
});

test('pantalla: lo que el indicador ya ubicó pasa tal cual', () => {
  const placed = [{ id: 'a', x: 1, y: 2, r: 3 }, { id: 'b', left: 1, right: 2, top: 3, bottom: 4 }];
  assert.deepEqual(levels.levelTargets(placed, area), placed);
});

test('pantalla: lo que nace en una vela solo se alcanza desde ella', () => {
  const [target] = levels.levelTargets([level(100, { time: 1000 })], area);
  assert.deepEqual([target.left, target.right], [100, 400]);
});

// ---- Dibujo y posiciones

test('dibujo: un nivel de una vela empieza en ella y una marca sin papel no lleva línea', () => {
  const ctx = recorder();
  levels.drawChosenLevels(ctx, [level(100, { time: 1000, role: 'support' }), mark({ role: '' })], area);
  assert.deepEqual(ctx.calls.moveTo, [[100, 400]]);
});

test('posiciones: en la marca dibujada, en su vela y precio, o junto al borde derecho', () => {
  const items = [mark(), { ...level(100), time: 2000 }, level(150)];
  const targets = [{ id: mark().id, x: 77, y: 88, r: 5 }];
  assert.deepEqual(levels.itemPositions(items, targets, area).map(({ x, y }) => [x, y]), [[77, 88], [200, 400], [388, 350]]);
});

test('posiciones: una zona se ubica en su centro', () => {
  const item = { ...level(100), id: 'z' };
  const [position] = levels.itemPositions([item], [{ id: 'z', left: 0, right: 40, top: 100, bottom: 120 }], area);
  assert.deepEqual([position.x, position.y], [20, 110]);
});

test('posiciones: lo que queda fuera del área no aparece', () => {
  const items = [{ ...level(100), time: 9000 }, level(600), mark({ price: 100, time: 1000 })];
  assert.deepEqual(levels.itemPositions(items, [], area).map(({ item }) => item.id), [mark().id]);
});

test('imagen: cada marca como fracción del ancho y del alto', () => {
  assert.deepEqual(levels.imageMarkers([{ item: { id: 'a' }, x: 50, y: 25 }], 200, 100), [{ id: 'a', x: 0.25, y: 0.25 }]);
  assert.deepEqual(levels.imageMarkers([{ item: { id: 'a' }, x: 50, y: 25 }], 0, 100), []);
});

test('marcas: el aro va solo en las marcas', () => {
  const ctx = recorder();
  levels.drawChosenMarks(ctx, [{ item: mark(), x: 5, y: 6 }, { item: level(100), x: 7, y: 8 }]);
  assert.deepEqual(ctx.calls.arcs, [[5, 6]]);
});

// ---- Lo que ofrece cada indicador

const STEP = 900000;
const candle = (i, open, high, low, close, volume = 10) => ({ timestamp: STEP * (1000 + i), open, high, low, close, volume });
const timeToX = (candles) => (time) => {
  const index = candles.findIndex(item => item.timestamp === time);
  return index < 0 ? null : index * 10 + 5;
};

test('FVG: ofrece bordes y mitad de cada gap a la vista, desde su vela', () => {
  const candles = [candle(0, 99, 100, 98, 99.5), candle(1, 100, 106, 99, 105), candle(2, 105.5, 108, 105, 107), candle(3, 107, 108, 106, 107.5)];
  const fvg = new FVG('FVGPRUEBA', '15m');
  fvg.enabled = true;
  fvg.renderOverlay(recorder(), { x: 0, y: 0, width: 40, height: 400 }, candles, candles,
    { knownCandles: candles, priceToY: (price) => 500 - price, timeToX: timeToX(candles) });
  const offered = fvg.selectableLevels();
  assert.deepEqual(offered.map(item => [item.kind, item.price]), [['FVG alcista, borde alto', 105], ['FVG alcista, 50%', 102.5], ['FVG alcista, borde bajo', 100]]);
  assert.ok(offered.every(item => item.start === candles[1].timestamp && item.time === candles[1].timestamp));
});

test('FVG: apagado no ofrece nada', () => {
  const fvg = new FVG('FVGPRUEBA', '15m');
  fvg.renderOverlay(recorder(), { x: 0, y: 0, width: 40, height: 400 }, [candle(0, 1, 2, 0.5, 1.5)], [], { priceToY: () => 0, timeToX: () => 0 });
  assert.deepEqual(fvg.selectableLevels(), []);
});

function responseVolume(signal = [false, true]) {
  const indicator = new ResponseVolume('RVPRUEBA', '15m', 30);
  indicator.enabled = true;
  indicator.config = { ...indicator.config, showArrows: true, showSignals: true };
  indicator.series = {
    update: () => {},
    indexOf: (time) => (time === STEP * 1000 ? 0 : time === STEP * 1001 ? 1 : -1),
    isPrincipal: (index) => index === 0,
    signal,
    side: [1, -1],
    direction: [1, -1]
  };
  return indicator;
}

test('Volumen de Respuesta: ofrece flechas y rombos como marcas con su vela', () => {
  const candles = [candle(0, 100, 102, 98, 101), candle(1, 101, 103, 99, 100)];
  const indicator = responseVolume();
  indicator.renderOverlay(recorder(), { x: 0, y: 0, width: 20, height: 400 }, candles, candles,
    { knownCandles: candles, priceToY: (price) => 500 - price, timeToX: timeToX(candles) });
  const marks = indicator.selectableLevels();
  assert.deepEqual(marks.map(item => [item.kind, item.time, item.price, item.mark]), [
    ['Flecha de compra', candles[0].timestamp, 98, true],
    ['Rombo', candles[1].timestamp, 99, true]
  ]);
  assert.ok(marks.every(item => item.r >= 7 && item.x === timeToX(candles)(item.time)));
});

test('Volumen de Respuesta: cada dibujo empieza sin las marcas del anterior', () => {
  const candles = [candle(0, 100, 102, 98, 101), candle(1, 101, 103, 99, 100)];
  const indicator = responseVolume();
  const context = { knownCandles: candles, priceToY: (price) => 500 - price, timeToX: timeToX(candles) };
  indicator.renderOverlay(recorder(), { x: 0, y: 0, width: 20, height: 400 }, candles, candles, context);
  indicator.series.signal = [false, false];
  indicator.renderOverlay(recorder(), { x: 0, y: 0, width: 20, height: 400 }, candles, candles, context);
  assert.deepEqual(indicator.selectableLevels().map(item => item.kind), ['Flecha de compra']);
});

test('Swing: cada señal a la vista se ofrece como marca en su flecha', () => {
  const candles = [candle(0, 100, 102, 98, 101), candle(1, 101, 103, 99, 100)];
  const indicator = new Swing('SWPRUEBA', '15m', 30);
  indicator.enabled = true;
  indicator.detectSwings = () => {};
  indicator.priceZones = [];
  indicator.signals = [{ timestamp: candles[1].timestamp, type: 'SWING_LOW', volumeZScore: 1 }];
  indicator.renderOverlay(recorder(), { x: 0, y: 0, width: 20, height: 400 }, candles, candles, { priceToY: (price) => 500 - price });
  const [found] = indicator.selectableLevels();
  assert.deepEqual([found.kind, found.price, found.time, found.mark, found.x], ['Swing bajo', 99, candles[1].timestamp, true, 15]);
  assert.equal(found.y, 500 - 99 + indicator.arrowOffset + indicator.arrowSize);
});

test('Double Top/Bottom: la flecha de entrada se ofrece como marca', () => {
  const candles = [candle(0, 100, 102, 98, 101)];
  const indicator = new DoubleTopBottom('DTBPRUEBA', '15m', 30);
  indicator.marks = [];
  indicator._drawEntryArrow(recorder(), { entrySignal: { entry_candle_timestamp: candles[0].timestamp, direction: 'LONG' } }, candles, (price) => 500 - price, () => 40);
  assert.deepEqual(indicator.selectableLevels().map(item => [item.kind, item.price, item.x, item.y]), [['Entrada larga', 98, 40, 432]]);
});

test('Double Top/Bottom: su línea se ofrece como nivel y sus extremos como marcas', () => {
  const candles = [candle(0, 100, 105, 99, 101), candle(1, 101, 103, 100, 102), candle(2, 102, 105, 101, 101.5)];
  const indicator = new DoubleTopBottom('DTBPRUEBA', '15m', 30);
  indicator.marks = [];
  const pattern = {
    type: 'DOUBLE_TOP', levelPrice: 105,
    firstExtreme: { timestamp: candles[0].timestamp, price: 105, rejection_pattern: 'SHOOTING_STAR' },
    secondExtreme: { timestamp: candles[2].timestamp, price: 105, rejection_pattern: 'NADA' }
  };
  const toX = timeToX(candles);
  indicator._drawLevelLine(recorder(), pattern, { x: 0, y: 0, width: 30, height: 400 }, (price) => 500 - price, toX);
  indicator._drawRejectionIcons(recorder(), pattern, candles, (price) => 500 - price, toX);
  assert.deepEqual(indicator.selectableLevels().map(item => [item.kind, item.price, item.mark ?? false]), [
    ['Doble techo', 105, false], ['Primer techo', 105, true]
  ]);
  const [line, extreme] = indicator.selectableLevels();
  assert.deepEqual([line.left, line.right, line.y, line.time], [5, 25, 395, candles[0].timestamp]);
  assert.deepEqual([extreme.x, extreme.y], [5, 375], 'el icono va 20 px arriba del techo; sin icono no hay marca');
});

test('área: lo cortado por el borde del precio no se ofrece', () => {
  const box = { left: 10, right: 400, top: 20, bottom: 480 };
  assert.equal(levels.withinArea({ x: 50, y: 500, r: 8 }, box), false, 'una flecha bajo el área de precio');
  assert.equal(levels.withinArea({ x: 50, y: 300, r: 8 }, box), true);
  assert.equal(levels.withinArea({ left: 0, right: 30, top: 470, bottom: 520 }, box), true, 'una zona que asoma');
  assert.equal(levels.withinArea({ left: 0, right: 30, top: 490, bottom: 520 }, box), false);
  assert.equal(levels.withinArea({ left: 0, right: 30, y: 10 }, box), false);
  assert.equal(levels.withinArea({ price: 100 }, box), true, 'lo que no trae lugar lo ubica levelTargets');
});

test('Rejection: el punto dibujado dice dónde quedó y de qué lado', () => {
  const indicator = new Rejection('REJPRUEBA', '15m', 30);
  assert.deepEqual(indicator.drawPatternMarker(recorder(), 10, 100, { type: 'HAMMER', confidence: 50 }), { y: 108, radius: 5, bullish: true });
  assert.equal(indicator.drawPatternMarker(recorder(), 10, 100, { type: 'SHOOTING_STAR', confidence: 50 }).y, 92);
});

const footprint = (changes = {}) => ({
  levels: [
    { price_min: 99, price_max: 100, price_mid: 99.5 },
    { price_min: 100, price_max: 101, price_mid: 100.5 },
    { price_min: 101, price_max: 102, price_mid: 101.5 },
    { price_min: 102, price_max: 103, price_mid: 102.5 }
  ],
  poc_index: 1,
  step_size: 1,
  imbalances: [{ level_index: 0, type: 'SELL' }, { level_index: 2, type: 'BUY' }, { level_index: 3, type: 'BUY' }],
  stacked_imbalances: [{ direction: 'BUY', levels: [2, 3] }],
  total_delta: 5,
  total_volume: 10,
  ...changes
});

function orderFlow() {
  const indicator = new OrderFlow('OFPRUEBA', '15m', 7, true, STEP * 1000);
  indicator.enabled = true;
  indicator.targets = [];
  return indicator;
}

test('Order Flow: ofrece el POC de la vela, sus stacked y sus imbalances sueltos', () => {
  const indicator = orderFlow();
  indicator._unitTargets(candle(0, 100, 103, 99, 102), footprint(), 10, 100, { left: 40, right: 80 }, (price) => 500 - price, true);
  assert.deepEqual(indicator.selectableLevels().map(item => [item.kind, item.price]), [
    ['POC de la vela', 100.5], ['Stacked de compra', 102], ['Imbalance de venta', 99.5]
  ]);
  const [poc, stacked] = indicator.selectableLevels();
  assert.deepEqual([poc.left, poc.right, poc.y], [10, 110, 399.5]);
  assert.deepEqual([stacked.left, stacked.right, stacked.top, stacked.bottom, stacked.low, stacked.high], [40, 80, 397, 399, 101, 103]);
  assert.ok(indicator.selectableLevels().every(item => item.time === STEP * 1000 && !item.mark));
});

test('Order Flow: el dibujo de cada vela ofrece lo suyo, también con el footprint reemplazando la vela', () => {
  const indicator = orderFlow();
  const bar = candle(0, 100, 103, 99, 102);
  indicator.footprintMap = new Map([[bar.timestamp, footprint()]]);
  indicator.renderOnChart(recorder(), { x: 0, y: 0, width: 100, height: 400 }, [bar], { priceToY: (price) => 500 - price, knownUntil: bar.timestamp + STEP }, true);
  assert.deepEqual(indicator.selectableLevels().map(item => item.kind), ['POC de la vela', 'Stacked de compra', 'Imbalance de venta']);
});

test('Order Flow: sin cifras a la vista no ofrece imbalances sueltos', () => {
  const indicator = orderFlow();
  indicator._unitTargets(candle(0, 100, 103, 99, 102), footprint(), 10, 100, { left: 40, right: 80 }, (price) => 500 - price, false);
  assert.deepEqual(indicator.selectableLevels().map(item => item.kind), ['POC de la vela', 'Stacked de compra']);
});

test('Order Flow: un stacked que no pasa el filtro de volumen no se ofrece', () => {
  const indicator = orderFlow();
  indicator.config.stackedMinVolumeZScore = 2;
  indicator._unitTargets(candle(0, 100, 103, 99, 102), footprint({ volume_zscore: 1 }), 10, 100, { left: 40, right: 80 }, (price) => 500 - price, false);
  assert.deepEqual(indicator.selectableLevels().map(item => item.kind), ['POC de la vela']);
});

test('Order Flow: con velas angostas ofrece la línea de stacked y el rombo de delta contrario', () => {
  const indicator = orderFlow();
  const bar = candle(0, 103, 103, 99, 99.5);
  indicator.footprintMap = new Map([[bar.timestamp, footprint()]]);
  indicator.renderImbalanceMarkers(recorder(), { x: 0, y: 0, width: 10, height: 400 }, [bar], (price) => 500 - price, 10);
  const offered = indicator.selectableLevels();
  assert.deepEqual(offered.map(item => [item.kind, item.mark ?? false]), [['Delta contrario', true], ['Stacked de compra', false]]);
  assert.equal(offered[0].price, 99, 'el rombo va bajo la vela cuando compra el delta');
});

test('Order Flow: el delta usa su propio tamaño, más grande que las cifras', () => {
  const indicator = orderFlow();
  const ctx = recorder();
  indicator.renderDelta(ctx, footprint(), 0, 100, 99, (price) => price);
  indicator.config.deltaFontSize = 18;
  indicator.renderDelta(ctx, footprint(), 0, 100, 99, (price) => price);
  assert.deepEqual(ctx.calls.fonts, ['bold 13px Arial', 'bold 18px Arial']);
});

test('Order Flow: apagado no ofrece nada', () => {
  const indicator = orderFlow();
  indicator.targets = [{ id: 'viejo' }];
  indicator.enabled = false;
  indicator.renderOnChart(recorder(), { x: 0, y: 0, width: 10, height: 10 }, [candle(0, 1, 2, 0.5, 1.5)], { priceToY: () => 0 }, true);
  assert.deepEqual(indicator.selectableLevels(), []);
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
