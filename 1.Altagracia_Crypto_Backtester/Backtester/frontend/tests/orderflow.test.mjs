// Pruebas del indicador de Order Flow sin navegador: que pide, cuando y que descarta.
// Uso: node tests/orderflow.test.mjs
import assert from 'node:assert/strict';
import OrderFlowIndicator from '../src/components/indicators/OrderFlowIndicator.js';

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
    interval: query.get('interval')
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
  const candles = Array.from({ length: 401 }, (_, i) => closed(i));
  await draw(of, candles, T0 + 401 * TF);
  assert.equal(requests.length, 0);
  await draw(of, candles.slice(0, 400), T0 + 401 * TF);
  assert.equal(requests.length, 1);
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
