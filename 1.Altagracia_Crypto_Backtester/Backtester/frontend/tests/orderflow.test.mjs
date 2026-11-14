// Pruebas del indicador de Order Flow sin navegador: que pide, cuando y que descarta.
// Uso: node tests/orderflow.test.mjs
import assert from 'node:assert/strict';
import OrderFlowIndicator, { valueAreaRange } from '../src/components/indicators/OrderFlowIndicator.js';

const TF = 900000;
const T0 = 1792800000000;

let requests = [];
let respond = null;

globalThis.fetch = (url) => {
  const query = new URL(url).searchParams;
  const request = {
    start: Number(query.get('start_timestamp')),
    end: Number(query.get('end_timestamp')),
    known: Number(query.get('known_until')),
    step: query.get('step'),
    interval: query.get('interval'),
    query
  };
  requests.push(request);
  return new Promise((resolve, reject) => {
    const answer = () => {
      const body = respond ? respond(request) : serve(request);
      if (body instanceof Error) reject(body);
      else resolve({ ok: true, json: async () => body });
    };
    request.answer = answer;
    if (!holdResponses) answer();
  });
};

let holdResponses = false;
const holes = new Set();

// Como el backend: nada despues de known_until
function serve({ start, end, known }) {
  const footprints = [];
  for (let t = start; t < end; t += TF) {
    if (t >= known || holes.has(t)) continue;
    footprints.push({
      candle_timestamp: t,
      candle_close: 80000,
      step_size: 10,
      complete: t + TF <= known,
      levels: [{ price_min: 79990, price_max: 80000, price_mid: 79995, bid_volume: 1, ask_volume: 2, total_volume: 3 }],
      stacked_imbalances: []
    });
  }
  return { success: true, footprints, step_size: 10, known_until: Math.min(known, end) };
}

const closed = (i) => ({ timestamp: T0 + i * TF, open: 80000, high: 80010, low: 79990, close: 80000, volume: 5 });
const forming = (i, knownUntil) => ({ ...closed(i), in_progress: true, knownUntil });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function newIndicator() {
  requests = [];
  respond = null;
  holdResponses = false;
  holes.clear();
  const indicator = new OrderFlowIndicator('BTCUSDT', '15m', 7, true, T0);
  indicator.enabled = true;
  return indicator;
}

// Un dibujo: pide lo que falte. Salta la espera entre peticiones, que se prueba aparte
async function draw(indicator, candles, knownUntil) {
  indicator.nextRequestAt = 0;
  indicator._loadVisible(candles, { knownUntil, requestRedraw: () => {} });
  await flush();
  await flush();
}

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('pide solo lo visible y en el marco correcto', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1), closed(2)], T0 + 3 * TF);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].interval, '15');
  assert.equal(requests[0].start, T0);
  assert.equal(requests[0].end, T0 + 3 * TF);
  assert.equal(requests[0].known, T0 + 3 * TF);
  assert.equal(of.footprintMap.size, 3);
});

test('no repite la peticion si ya tiene las velas', async () => {
  const of = newIndicator();
  const candles = [closed(0), closed(1)];
  await draw(of, candles, T0 + 2 * TF);
  await draw(of, candles, T0 + 2 * TF);
  await draw(of, candles, T0 + 2 * TF + 60000);
  assert.equal(requests.length, 1);
});

test('la vela en formacion se pide de nuevo solo cuando avanza', async () => {
  const of = newIndicator();
  const known = T0 + 60000 * 7;
  await draw(of, [closed(-1), forming(0, known)], known);
  assert.equal(requests.length, 1);
  await draw(of, [closed(-1), forming(0, known)], known);
  assert.equal(requests.length, 1);
  await draw(of, [closed(-1), forming(0, known + 60000)], known + 60000);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].start, T0, 'solo la vela que avanza');
  assert.equal(requests[1].end, T0 + TF);
  assert.equal(requests[1].known, known + 60000);
});

test('al cerrar, la vela parcial se vuelve a pedir completa', async () => {
  const of = newIndicator();
  const known = T0 + 300000;
  await draw(of, [forming(0, known)], known);
  assert.equal(of.footprintMap.get(T0).complete, false);
  await draw(of, [closed(0)], T0 + TF);
  assert.equal(requests.length, 2);
  assert.equal(of.footprintMap.get(T0).complete, true);
});

test('una vela sin trades no se pide una y otra vez', async () => {
  const of = newIndicator();
  holes.add(T0);
  const candles = [closed(0), closed(1)];
  await draw(of, candles, T0 + 2 * TF);
  await draw(of, candles, T0 + 2 * TF);
  await draw(of, candles, T0 + 2 * TF);
  assert.equal(requests.length, 1);
  assert.equal(of.footprintMap.has(T0), false);
  assert.equal(of.footprintMap.has(T0 + TF), true);
});

test('al retroceder se borra lo que aun no se conocia', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1), closed(2)], T0 + 3 * TF);
  assert.equal(of.footprintMap.size, 3);

  const earlier = T0 + TF + 300000;
  await draw(of, [closed(0), forming(1, earlier)], earlier);
  assert.equal(of.footprintMap.has(T0 + 2 * TF), false, 'vela futura borrada');
  assert.equal(of.footprintMap.get(T0).complete, true, 'vela ya cerrada se conserva');
  const partial = of.footprintMap.get(T0 + TF);
  assert.equal(partial.complete, false, 'la vela en curso vuelve a ser parcial');
  assert.equal(requests[requests.length - 1].known, earlier);
});

test('una respuesta vieja no entra despues de retroceder', async () => {
  const of = newIndicator();
  holdResponses = true;
  of.nextRequestAt = 0;
  of._loadVisible([closed(0), closed(1)], { knownUntil: T0 + 2 * TF, requestRedraw: () => {} });
  const slow = requests[0];

  of._syncClock(T0 + 300000, 80000);
  holdResponses = false;
  slow.answer();
  await flush();
  await flush();
  assert.equal(of.footprintMap.size, 0);
});

test('un solo step para toda la sesion', async () => {
  const of = newIndicator();
  await draw(of, [closed(0)], T0 + TF);
  assert.equal(requests[0].step, null);
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  assert.equal(requests[1].step, '10');
});

test('si el precio se aleja mucho se elige otro step', async () => {
  const of = newIndicator();
  await draw(of, [closed(0)], T0 + TF);
  assert.equal(of.stepSize, 10);
  const far = { ...closed(50), close: 40000 };
  await draw(of, [far], T0 + 51 * TF);
  assert.equal(requests[requests.length - 1].step, null);
  assert.equal(of.footprintMap.has(T0), false);
});

test('con demasiadas velas en pantalla no pide nada', async () => {
  const of = newIndicator();
  const candles = Array.from({ length: 1601 }, (_, i) => closed(i));
  await draw(of, candles, T0 + 1601 * TF);
  assert.equal(requests.length, 0);
  await draw(of, candles.slice(0, 1600), T0 + 1601 * TF);
  assert.equal(requests.length, 1);
});

test('una vista alejada de 481 velas se carga: antes no pedia nada desde 401', async () => {
  const of = newIndicator();
  const candles = Array.from({ length: 481 }, (_, i) => closed(i + 300));
  await draw(of, candles, T0 + 1000 * TF);
  assert.equal(requests.length, 1);
  assert.ok(candles.every(candle => of.footprintMap.has(candle.timestamp)));
});

test('al desplazarse pide media pantalla de mas a cada lado, hasta 200 velas', async () => {
  const of = newIndicator();
  await draw(of, Array.from({ length: 100 }, (_, i) => closed(i + 500)), T0 + 2000 * TF);
  assert.equal(requests[0].start, T0 + 450 * TF);
  assert.equal(requests[0].end, T0 + 650 * TF);

  const wide = newIndicator();
  await draw(wide, Array.from({ length: 1000 }, (_, i) => closed(i + 500)), T0 + 3000 * TF);
  assert.equal(requests[0].start, T0 + 300 * TF);
  assert.equal(requests[0].end, T0 + 1700 * TF);
});

test('ningun pedido pasa de 70 dias de trades: en 4h, hasta 420 velas', async () => {
  const H4 = 4 * 3600000;
  const make = () => {
    const of = newIndicator();
    const h4 = new OrderFlowIndicator('BTCUSDT', '4h', 7, true, T0);
    h4.enabled = true;
    respond = ({ end }) => ({ success: true, footprints: [], step_size: 10, known_until: end });
    return [of, h4];
  };
  const candles = count => Array.from({ length: count }, (_, i) => ({ ...closed(0), timestamp: T0 + i * H4 }));

  let [, h4] = make();
  await draw(h4, candles(421), T0 + 500 * H4);
  assert.equal(requests.length, 0, '421 velas de 4h son mas de 70 dias');

  [, h4] = make();
  await draw(h4, candles(400), T0 + 500 * H4);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].end - requests[0].start <= 70 * 86400000, 'la ventana de mas no pasa el tope');
  assert.equal(requests[0].start, T0 - 10 * H4);
});

test('con mas velas de las que se cargan avisa que hay que acercar el zoom', () => {
  const of = newIndicator();
  const texts = [];
  const ctx = { fillText: text => texts.push(text) };
  const bounds = { x: 0, y: 0, width: 1000, height: 500 };
  const candles = Array.from({ length: 1601 }, (_, i) => closed(i));
  of._renderNotice(ctx, bounds, candles);
  assert.deepEqual(texts, ['Order Flow: acerca el zoom para cargar los footprints']);

  // Si todo lo visible ya está cargado o no tiene trades, no hay aviso
  candles.forEach((candle, i) => (i % 2 ? of.noData.set(candle.timestamp, T0) : of.footprintMap.set(candle.timestamp, { levels: [] })));
  texts.length = 0;
  of._renderNotice(ctx, bounds, candles);
  assert.deepEqual(texts, []);
});

test('solo una peticion a la vez y una espera entre peticiones', async () => {
  const of = newIndicator();
  holdResponses = true;
  of._loadVisible([closed(0)], { knownUntil: T0 + TF, requestRedraw: () => {} });
  of._loadVisible([closed(0)], { knownUntil: T0 + TF, requestRedraw: () => {} });
  assert.equal(requests.length, 1, 'no se pisa con la anterior');
  requests[0].answer();
  await flush();
  await flush();

  let redraws = 0;
  of._loadVisible([closed(1)], { knownUntil: T0 + 2 * TF, requestRedraw: () => { redraws += 1; } });
  assert.equal(requests.length, 1, 'espera el intervalo');
  assert.ok(of.retryTimer, 'deja programado un nuevo intento');
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(redraws, 1);
});

test('tras un error espera y no repite el mensaje', async () => {
  const of = newIndicator();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  respond = () => new Error('caido');
  await draw(of, [closed(0)], T0 + TF);
  assert.equal(of.error, 'caido');
  assert.ok(of.nextRequestAt - performance.now() > 4000);

  of._loadVisible([closed(0)], { knownUntil: T0 + TF, requestRedraw: () => {} });
  assert.equal(requests.length, 1, 'no insiste durante la espera');
  clearTimeout(of.retryTimer);
  of.retryTimer = null;

  await draw(of, [closed(0)], T0 + TF);
  await flush();
  console.error = original;
  assert.equal(errors.length, 1);

  respond = null;
  await draw(of, [closed(0)], T0 + TF);
  assert.equal(of.error, null);
  assert.equal(of.footprintMap.size, 1);
});

test('el footprint reemplaza la vela solo si hay datos y ancho suficiente', async () => {
  const of = newIndicator();
  assert.equal(of.shouldReplaceCandles(200), false);
  await draw(of, [closed(0)], T0 + TF);
  assert.equal(of.shouldReplaceCandles(8), false);
  assert.equal(of.shouldReplaceCandles(16), true);
  of.enabled = false;
  assert.equal(of.shouldReplaceCandles(200), false);
});

test('los niveles vacios llegan a los extremos de la vela oficial', () => {
  const of = newIndicator();
  const footprint = {
    step_size: 10,
    levels: [{ price_min: 100, price_max: 110 }, { price_min: 110, price_max: 120 }]
  };
  const extra = of._levelsToCoverCandle(footprint, { high: 135, low: 85 });
  assert.deepEqual(extra.map(level => level.price_min).sort((a, b) => a - b), [80, 90, 120, 130]);
  assert.deepEqual(of._levelsToCoverCandle(footprint, { high: 120, low: 100 }), []);
});

test('el rango de precio incluye los niveles visibles', async () => {
  const of = newIndicator();
  await draw(of, [closed(0)], T0 + TF);
  assert.deepEqual(of.priceExtent([closed(0)]), { low: 79990, high: 80000 });
  assert.equal(of.priceExtent([closed(9)]), null);
});

test('el delta real solo se entrega si todas las velas lo tienen', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  of.footprintMap.get(T0).total_delta = 5;
  of.footprintMap.get(T0 + TF).total_delta = -3;
  assert.deepEqual(of.realDeltas([closed(0), closed(1)]), [5, -3]);
  assert.equal(of.realDeltas([closed(0), closed(1), closed(2)]), null);
  of.enabled = false;
  assert.equal(of.realDeltas([closed(0)]), null);
});

test('la marca de delta exige ir contra la vela y un minimo del volumen', () => {
  const of = newIndicator();
  const red = { open: 100, close: 90 };
  const green = { open: 90, close: 100 };
  const doji = { open: 90, close: 90 };
  assert.equal(of.deltaAgainstCandle({ total_delta: 30, total_volume: 100 }, red), true);
  assert.equal(of.deltaAgainstCandle({ total_delta: -30, total_volume: 100 }, green), true);
  assert.equal(of.deltaAgainstCandle({ total_delta: -30, total_volume: 100 }, red), false);
  assert.equal(of.deltaAgainstCandle({ total_delta: 10, total_volume: 100 }, red), false);
  assert.equal(of.deltaAgainstCandle({ total_delta: 30, total_volume: 100 }, doji), false);
});

test('cada peticion lleva las reglas de imbalance', async () => {
  const of = newIndicator();
  of.updateConfig({ imbalanceRatio: 4.5, imbalanceMode: 'diagonal', imbalanceCandleVolumePct: 150, imbalanceCandleVolumeBars: 30, imbalanceCellSharePct: 12, imbalanceCountZero: true, stackedMinLevels: 5 });
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  const { query } = requests[0];
  assert.equal(query.get('imbalance_ratio'), '4.5');
  assert.equal(query.get('imbalance_mode'), 'diagonal');
  assert.equal(query.get('imbalance_candle_pct'), '150');
  assert.equal(query.get('imbalance_candle_bars'), '30');
  assert.equal(query.get('imbalance_cell_pct'), '12');
  assert.equal(query.get('imbalance_min_volume'), null, 'el minimo en monedas ya no se envia');
  assert.equal(query.get('imbalance_zero'), 'true');
  assert.equal(query.get('stacked_levels'), '5');
});

test('el step elegido es por marco', async () => {
  const of = newIndicator();
  of.updateConfig({ stepByMinutes: { 15: 25, 60: 100 } });
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  assert.equal(requests[0].step, '25');

  const hour = new OrderFlowIndicator('BTCUSDT', '1h', 7, true, T0);
  hour.updateConfig({ stepByMinutes: { 15: 25 } });
  assert.equal(hour._stepOverride(), null, 'el marco sin valor queda automatico');
});

test('cambiar una regla descarta lo cargado y vuelve a pedir', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  assert.equal(of.footprintMap.size > 0, true);
  const before = requests.length;

  of.updateConfig({ imbalanceRatio: 5 });
  assert.equal(of.footprintMap.size, 0);
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  assert.equal(requests.length, before + 1);
  assert.equal(requests[before].query.get('imbalance_ratio'), '5');
});

test('una respuesta pedida con reglas viejas no se guarda', async () => {
  const of = newIndicator();
  holdResponses = true;
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  of.updateConfig({ imbalanceRatio: 5 });
  requests[0].answer();
  await flush();
  assert.equal(of.footprintMap.size, 0);
});

test('un parametro de dibujo no vuelve a pedir datos', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  const loaded = of.footprintMap.size;
  of.updateConfig({ fontSize: 12, showDelta: false, stackedOpacity: 0.3, minCandleWidth: 30 });
  assert.equal(of.footprintMap.size, loaded);
});

test('los parametros guardados se aplican al crear el indicador', () => {
  globalThis.localStorage = { getItem: () => JSON.stringify({ imbalanceRatio: 6, stepByMinutes: { 15: 40 } }) };
  const of = new OrderFlowIndicator('BTCUSDT', '15m', 7, true, T0);
  delete globalThis.localStorage;
  assert.equal(of.config.imbalanceRatio, 6);
  assert.equal(of._stepOverride(), 40);
  assert.equal(of.config.showDelta, true, 'lo no guardado queda de fabrica');
});

test('sin almacenamiento quedan los valores de fabrica', () => {
  const of = new OrderFlowIndicator('BTCUSDT', '15m', 7, true, T0);
  assert.equal(of.config.imbalanceRatio, 3);
  assert.equal(of.config.imbalanceMode, 'level');
  assert.equal(of.config.stackedMinLevels, 3);
});

// ---- Dibujo con el footprint a la vista (14/11): franjas de stacked, imbalances sueltos y perfil de delta ----

function recorder() {
  const calls = { fills: [], lines: [] };
  let path = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, rect() {}, clip() {}, closePath() {}, fill() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { calls.lines.push({ style: this.strokeStyle, points: path }); },
    fillRect(x, y, w, h) { calls.fills.push({ style: this.fillStyle, x, y, w, h }); },
    strokeRect() {}, fillText() {}, strokeText() {},
  };
  return { ctx, calls };
}

// Vela de 80,000 a 80,050 con cinco niveles: los tres de abajo, stacked de compra; el cuarto, imbalance de venta
function zoomedFootprint(t) {
  const rows = [[1, 9], [1, 8], [1, 7], [6, 1], [2, 2]];
  return {
    candle_timestamp: t, candle_close: 80040, step_size: 10, total_delta: 9, total_volume: 40, poc_index: 0,
    levels: rows.map(([bid, ask], i) => ({
      price_min: 80000 + i * 10, price_max: 80010 + i * 10, price_mid: 80005 + i * 10,
      bid_volume: bid, ask_volume: ask, total_volume: bid + ask, delta: ask - bid,
    })),
    imbalances: [{ level_index: 0, type: 'BUY' }, { level_index: 1, type: 'BUY' }, { level_index: 2, type: 'BUY' }, { level_index: 3, type: 'SELL' }],
    stacked_imbalances: [{ direction: 'BUY', levels: [0, 1, 2] }],
  };
}

function drawZoomed(config = {}) {
  const of = newIndicator();
  of.updateConfig(config);
  const candles = [0, 1, 2, 3].map(i => ({ ...closed(i), open: 80000, close: 80040, high: 80050, low: 80000 }));
  candles.forEach(c => of.footprintMap.set(c.timestamp, { ...zoomedFootprint(c.timestamp), knownUntil: Infinity }));
  of.nextRequestAt = Infinity; // nada que pedir: todo cargado
  const { ctx, calls } = recorder();
  const bounds = { x: 0, y: 0, width: 400, height: 600 }; // 100 px por vela: footprint con cifras
  const priceToY = price => 600 - (price - 79950) * 4; // 4 px por dolar: 40 px por nivel
  of.renderOnChart(ctx, bounds, candles, { priceToY, knownUntil: T0 + 4 * TF, requestRedraw: () => {} }, true);
  return { of, calls };
}

test('con zoom, cada stacked deja una franja desde su vela hacia la derecha', () => {
  const { calls } = drawZoomed({ stackedLineExtend: 3 });
  // El stacked va de 80,000 a 80,030: de y 280 a 400
  // Sin navegador se dibuja en Clásico: la vela ya pinta su franja y la nueva sigue desde su borde derecho
  const bands = calls.fills.filter(f => Math.abs(f.y - 280) <= 1 && Math.abs(f.h - 120) <= 1 && f.w >= 99);
  assert.ok(bands.length >= 3, 'una franja por vela con stacked');
  const first = bands.find(f => Math.abs(f.x - 100) <= 1);
  assert.ok(first, 'la franja de la primera vela sigue tras ella');
  assert.ok(Math.abs(first.x + first.w - 300) <= 1, 'y llega a tres anchos de vela');
  assert.ok(bands.every(f => f.x + f.w <= 400 + 0.5), 'sin pasar del borde del gráfico');
  const edges = calls.lines.filter(l => l.points.length === 4 && l.points[1][0] - l.points[0][0] >= 99);
  assert.ok(edges.length >= 2, 'con su borde arriba y abajo');
});

test('sin "Resaltar imbalances" no hay franjas', () => {
  const { calls } = drawZoomed({ showImbalances: false });
  assert.equal(calls.fills.filter(f => f.w >= 99 && f.h >= 100).length, 0);
});

test('con poco zoom quedan las lineas y no las franjas', () => {
  const of = newIndicator();
  const candles = [0, 1, 2, 3].map(i => ({ ...closed(i), open: 80000, close: 80040, high: 80050, low: 80000 }));
  candles.forEach(c => of.footprintMap.set(c.timestamp, { ...zoomedFootprint(c.timestamp), knownUntil: Infinity }));
  of.nextRequestAt = Infinity;
  const { ctx, calls } = recorder();
  of.renderOnChart(ctx, { x: 0, y: 0, width: 40, height: 600 }, candles, { priceToY: p => 600 - (p - 79950) * 4, knownUntil: T0 + 4 * TF }, false);
  assert.equal(calls.fills.filter(f => f.h >= 100).length, 0, 'sin franjas');
  assert.ok(calls.lines.length >= 3, 'las líneas de stacked siguen');
});

test('perfil de delta: solo, o al lado del perfil de volumen', () => {
  const buyRgb = '38, 166, 154';
  const sellRgb = '239, 83, 80';
  const isDelta = f => f.style.startsWith(`rgba(${buyRgb}, 0.8`) || f.style.startsWith(`rgba(${sellRgb}, 0.8`);
  // Clásico (sin navegador): barras del perfil de volumen en azul
  const isVolume = f => f.style.startsWith('rgba(100, 149, 237');

  const volume = drawZoomed({ profileMode: 'volume' }).calls.fills;
  assert.ok(volume.some(isVolume) && !volume.some(isDelta), 'de fábrica, solo volumen');

  const delta = drawZoomed({ profileMode: 'delta' }).calls.fills;
  assert.ok(delta.some(isDelta) && !delta.some(isVolume), 'solo delta');
  // Primera vela: delta por nivel 8, 7, 6, -5, 0. El mayor llena el ancho; el de cero no se dibuja
  const firstUnit = delta.filter(f => isDelta(f) && f.x < 100);
  assert.equal(firstUnit.length, 4);
  const widths = firstUnit.map(f => f.w).sort((a, b) => b - a);
  assert.ok(Math.abs(widths[1] / widths[0] - 7 / 8) < 0.02, 'largo según su |delta|');
  assert.equal(firstUnit.filter(f => f.style.startsWith(`rgba(${sellRgb}`)).length, 1, 'el nivel de venta en rojo');

  const both = drawZoomed({ profileMode: 'both' }).calls.fills;
  const vol = both.filter(f => isVolume(f) && f.x < 100);
  const del = both.filter(f => isDelta(f) && f.x < 100);
  assert.ok(vol.length && del.length, 'los dos');
  const volRight = Math.max(...vol.map(f => f.x));
  assert.ok(Math.min(...del.map(f => f.x)) > volRight, 'el delta va a la derecha del volumen');
  assert.ok(Math.max(...del.map(f => f.x + f.w)) <= 100 + 0.5, 'y los dos caben en la vela');
});

test('el modo del perfil no vuelve a pedir datos', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  const loaded = of.footprintMap.size;
  of.updateConfig({ profileMode: 'both' });
  assert.equal(of.footprintMap.size, loaded);
});

test('los filtros relativos son parte de las reglas: cambiarlo vuelve a pedir', async () => {
  const of = newIndicator();
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  of.updateConfig({ imbalanceCellSharePct: 20 });
  assert.equal(of.footprintMap.size, 0);
  await draw(of, [closed(0), closed(1)], T0 + 2 * TF);
  assert.equal(requests.at(-1).query.get('imbalance_cell_pct'), '20');
  assert.equal(requests.at(-1).query.get('imbalance_candle_pct'), '0', 'de fábrica sin filtro de vela');
});

test('area de valor de la vela: desde el POC, el vecino con mas volumen hasta el 70%', () => {
  const lv = vols => vols.map(v => ({ total_volume: v }));
  // Total 100, POC en 2 (40): suma 25 (arriba) -> 65, luego 20 (abajo) -> 85
  assert.deepEqual(valueAreaRange(lv([5, 20, 40, 25, 10]), 2, 0.7), [1, 3]);
  assert.deepEqual(valueAreaRange(lv([5, 20, 40, 25, 10]), 2, 0.6), [2, 3]);
  assert.deepEqual(valueAreaRange(lv([80, 10, 10]), 0, 0.7), [0, 0], 'el POC solo ya pasa del 70%');
  assert.deepEqual(valueAreaRange(lv([10, 10, 80]), 2, 0.95), [0, 2], 'llega a los bordes sin pasarse');
  assert.equal(valueAreaRange(lv([0, 0]), 0), null);
});

test('las barras del area de valor van en otro color, y se puede apagar', () => {
  const inArea = 'rgba(100, 149, 237, 0.7)';
  const outside = 'rgba(100, 149, 237, 0.3)';
  // Perfil de la primera vela: 10, 9, 8, 7, 4 con POC en 0 -> area 70% (26.6 de 38) = niveles 0 a 2 (27); fuera, 3 y 4
  const on = drawZoomed({}).calls.fills.filter(f => f.x < 100);
  assert.equal(on.filter(f => f.style === inArea).length, 2, 'dos barras dentro, ademas del POC en su color');
  assert.equal(on.filter(f => f.style === outside).length, 2, 'dos fuera');
  const off = drawZoomed({ showValueArea: false }).calls.fills.filter(f => f.x < 100);
  assert.equal(off.filter(f => f.style === outside).length, 0, 'sin area: todas iguales');
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}: ${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
