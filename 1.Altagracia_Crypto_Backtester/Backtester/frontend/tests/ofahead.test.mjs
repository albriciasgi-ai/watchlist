// Elementos OF por adelantado (27/11): en reproducción el indicador pide antes los elementos y la tabla de las velas
// que vienen, y el dibujo solo usa lo que ya se conoce en la hora simulada. Uso: node tests/ofahead.test.mjs
import assert from 'node:assert/strict';
import OrderFlowElementsIndicator from '../src/components/indicators/OrderFlowElementsIndicator.js';
import { knownEvents } from '../src/components/indicators/ofElements.js';

const TF = 900000;
const T0 = 1792800000000;
let requests = [];

// Como el backend: un evento y una fila de la tabla por vela cerrada antes de known_until; el evento se conoce al cerrar
globalThis.fetch = (url, options) => {
  const query = options?.body ? JSON.parse(options.body) : Object.fromEntries(new URL(url).searchParams);
  const request = { setups: !!options?.body, start: Number(query.start_timestamp), end: Number(query.end_timestamp), known: Number(query.known_until) };
  requests.push(request);
  const first = Math.ceil(request.start / TF) * TF;
  const events = [];
  const bars = [];
  const matches = [];
  for (let t = first; t < request.end && t + TF <= request.known; t += TF) {
    events.push({ code: CODE, dir: 1, t, t0: t, known: t + TF, lo: 100, hi: 101 });
    bars.push({ t, delta: 1, vol: 2, dv: 50, cum: 3 });
    matches.push({ id: 'r1', dir: 1, t, t0: t, known: t + TF, votes: [] });
  }
  return Promise.resolve({ ok: true, json: async () => ({ success: true, events, bars, matches, known_until: Math.min(request.known, request.end) }) });
};

const probe = new OrderFlowElementsIndicator('BTCUSDT', '15m', 7);
const CODE = Object.keys(probe.config.codes).find(code => probe.config.codes[code] && !['DV', 'XD', 'SM'].includes(code));

const candle = (i) => ({ timestamp: T0 + i * TF, open: 100, high: 101, low: 99, close: 100, volume: 5 });
const view = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => candle(from + i));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function newIndicator() {
  requests = [];
  const indicator = new OrderFlowElementsIndicator('BTCUSDT', '15m', 7);
  indicator.enabled = true;
  return indicator;
}

// Un dibujo en reproducción (con knownCandles) o en vivo (sin ellas)
async function draw(indicator, candles, knownUntil, replay = true) {
  indicator.nextRequestAt = 0;
  indicator._load(candles, { knownUntil, requestRedraw: () => {}, knownCandles: replay ? candles : null });
  await flush();
  await flush();
}
const shown = (indicator, knownUntil) => knownEvents(Array.from(indicator.events.values()), knownUntil, indicator.config.codes);

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('en reproducción pide las velas que vienen, y el dibujo solo recibe lo ya conocido', async () => {
  const of = newIndicator();
  const now = T0 + 20 * TF + 60000;                       // La vela 20 se está formando
  await draw(of, view(0, 20), now);                       // Lo visible, cortado en la hora
  assert.equal(requests[0].known, now);
  await draw(of, view(0, 20), now);                       // Y lo que viene
  const ahead = requests[requests.length - 1];
  assert.equal(ahead.end, T0 + 420 * TF, '400 velas desde la última cerrada');
  assert.equal(ahead.known, ahead.end);
  assert.ok(of.loaded.end >= T0 + 420 * TF);
  assert.ok(of.events.size > 300, 'lo adelantado está guardado');
  // El dibujo filtra por la hora en que se conoce cada evento: nada posterior a ahora
  const visible = shown(of, now).filter(event => event.t >= T0);   // El primer pedido trae unas velas anteriores a la vista
  assert.equal(visible.length, 20);
  assert.ok(visible.every(event => event.known <= now && event.t + TF <= now));
});

test('al avanzar la hora no pide nada: lo que entra ya estaba, y se ve solo al cerrar su vela', async () => {
  const of = newIndicator();
  let now = T0 + 20 * TF + 60000;
  await draw(of, view(0, 20), now);
  await draw(of, view(0, 20), now);
  const before = requests.length;
  now = T0 + 120 * TF + 60000;                            // Cien velas después, como a velocidad alta
  await draw(of, view(100, 120), now);
  assert.equal(requests.length, before, 'ningún pedido');
  assert.equal(shown(of, now).filter(event => event.t >= T0 + 100 * TF).length, 20);
  assert.ok(shown(of, now).every(event => event.known <= now));
  // Al pasar la mitad de lo adelantado pide el tramo siguiente
  now = T0 + 230 * TF + 60000;
  await draw(of, view(210, 230), now);
  assert.equal(requests.length, before + 1);
  assert.equal(requests[before].end, T0 + 630 * TF);
  assert.equal(requests[before].known, requests[before].end);
});

test('si la reproducción se come lo adelantado, pide el doble', async () => {
  const of = newIndicator();
  let now = T0 + 20 * TF + 60000;
  await draw(of, view(0, 20), now);
  await draw(of, view(0, 20), now);
  now = T0 + 500 * TF + 60000;                            // Pasó de las 420 adelantadas
  await draw(of, view(380, 500), now);
  assert.equal(of.ahead.size, 800);
  assert.equal(requests[requests.length - 1].end, T0 + 1300 * TF);
});

test('en vivo, o mirando velas viejas, no pide nada más allá de la hora', async () => {
  const live = newIndicator();
  const now = T0 + 20 * TF + 60000;
  await draw(live, view(0, 20), now, false);
  await draw(live, view(0, 20), now, false);
  assert.ok(requests.every(request => request.known <= now));
  const past = newIndicator();
  const farNow = T0 + 200 * TF + 60000;
  await draw(past, view(0, 20), farNow);
  await draw(past, view(0, 20), farNow);
  assert.ok(requests.every(request => request.known <= farNow), 'con la vista en el pasado se pide como siempre');
  const off = newIndicator();
  off.ahead.on = false;
  await draw(off, view(0, 20), now);
  await draw(off, view(0, 20), now);
  assert.ok(requests.every(request => request.known <= now));
});

test('al retroceder la hora, lo ya cargado sirve y sigue sin verse lo posterior', async () => {
  const of = newIndicator();
  let now = T0 + 120 * TF + 60000;
  await draw(of, view(100, 120), now);
  await draw(of, view(100, 120), now);
  const before = requests.length;
  now = T0 + 110 * TF + 60000;
  await draw(of, view(100, 110), now);
  assert.equal(requests.length, before);
  assert.ok(shown(of, now).every(event => event.known <= now));
  assert.equal(shown(of, now).filter(event => event.t >= T0 + 100 * TF).length, 10);
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
