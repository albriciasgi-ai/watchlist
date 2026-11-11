// Reloj de la reproducción: mantiene la velocidad elegida aunque un tick llegue tarde.
// Uso: node tests/clock.test.mjs
import assert from 'node:assert/strict';
import { candlesBetween, tickAlreadySettled, timestampIndex } from '../src/components/backtesting/replayClock.js';

const log = console.log;
console.log = () => {};

const { default: TimeController } = await import('../src/components/backtesting/TimeController.js');

const MINUTE = 60000;
const STEP = 5 * MINUTE; // Subdivisión de 15m
const START = 1000 * STEP;
const END = START + 100000 * STEP;

const tests = [];
const test = (name, run) => tests.push([name, run]);

/** Controla el tiempo real: cada "advance" hace llegar un tick del intervalo */
function fakeClock() {
  let now = 0;
  let tick = null;
  let every = null;
  globalThis.setInterval = (run, ms) => { tick = run; every = ms; return 1; };
  globalThis.clearInterval = () => { tick = null; };
  Object.defineProperty(globalThis.performance, 'now', { value: () => now, configurable: true });
  return {
    advance: (ms) => { now += ms; tick?.(); },
    every: () => every,
    running: () => tick !== null
  };
}

function playing(speed, end = END) {
  const clock = fakeClock();
  const times = [];
  const controller = new TimeController(START, end, '15m', time => times.push(time), START);
  controller.playbackSpeed = speed;
  controller.play();
  return { clock, controller, times };
}

test('paso: con un gráfico de marco menor a la vista, el reloj avanza con su paso', () => {
  const controller = new TimeController(START, START + 86400000, '1h', () => {}, START);
  assert.equal(controller.getTimeIncrement(), 15 * 60000, 'el de 1h: 15 minutos');
  controller.setStepTimeframes(['1h', '15m']);
  assert.equal(controller.getTimeIncrement(), 5 * 60000, 'con 15m a la vista: 5 minutos');
  controller.setStepTimeframes(['1h', '4h']);
  assert.equal(controller.getTimeIncrement(), 15 * 60000, 'un marco mayor no lo vuelve más grueso');
  controller.setStepTimeframes([]);
  assert.equal(controller.getTimeIncrement(), 15 * 60000);
});

test('segundo plano: con Worker el tick lo marca el Worker y pausar lo termina', () => {
  // El navegador frena los setInterval de una pestaña oculta a uno por segundo; los de un Worker no
  const workers = [];
  class FakeWorker {
    constructor(url) { this.url = url; this.sent = []; this.ended = false; workers.push(this); }
    postMessage(ms) { this.sent.push(ms); }
    terminate() { this.ended = true; }
  }
  const saved = { Worker: globalThis.Worker, Blob: globalThis.Blob, create: URL.createObjectURL };
  globalThis.Worker = FakeWorker;
  URL.createObjectURL = () => 'blob:reloj';
  let pageTimer = false;
  globalThis.setInterval = () => { pageTimer = true; return 1; };
  let now = 0;
  Object.defineProperty(globalThis.performance, 'now', { value: () => now, configurable: true });
  try {
    const times = [];
    const controller = new TimeController(START, END, '15m', time => times.push(time), START);
    controller.playbackSpeed = 1000;
    controller.play();
    assert.equal(pageTimer, false, 'no usa el temporizador de la página');
    assert.equal(workers.length, 1);
    assert.deepEqual(workers[0].sent, [300]);
    now += 1000; // Un segundo real de una vez, como una pestaña oculta
    workers[0].onmessage();
    assert.deepEqual(times, [START + Math.round(1000 * 1000 / STEP) * STEP]);
    controller.pause();
    assert.equal(workers[0].ended, true, 'pausar termina el Worker');
    assert.equal(workers[0].onmessage, null);
    controller.play();
    assert.equal(workers.length, 2, 'cada reproducción tiene el suyo');
    controller.pause();
  } finally {
    globalThis.Worker = saved.Worker;
    URL.createObjectURL = saved.create;
  }
});

test('a tiempo: cada tick avanza una subdivisión', () => {
  const { clock, times } = playing(1000);
  assert.equal(clock.every(), 300);
  clock.advance(300);
  clock.advance(300);
  assert.deepEqual(times, [START + STEP, START + 2 * STEP]);
});

test('tarde: un tick demorado recupera lo que debía avanzar', () => {
  const { clock, times } = playing(1000);
  clock.advance(900);
  assert.deepEqual(times, [START + 3 * STEP]);
});

test('tarde: después de recuperar sigue al ritmo normal', () => {
  const { clock, times } = playing(1000);
  clock.advance(900);
  clock.advance(300);
  assert.deepEqual(times, [START + 3 * STEP, START + 4 * STEP]);
});

test('lenta: un tick que llega un poco antes no se pierde', () => {
  const { clock, times } = playing(1);
  clock.advance(299998);
  assert.deepEqual(times, [START + STEP]);
});

test('lenta: el adelanto no se acumula', () => {
  const { clock, controller } = playing(1);
  for (let i = 0; i < 1000; i++) clock.advance(i % 2 ? 299990 : 300010);
  assert.equal(controller.currentTime, START + 1000 * STEP);
});

test('velocidad alta: pide más que un tick y el reloj la cumple', () => {
  const { clock, controller } = playing(50000);
  assert.equal(clock.every(), 16);
  for (let i = 0; i < 300; i++) clock.advance(16);
  const expected = 300 * 16 * 50000;
  assert.ok(Math.abs(controller.currentTime - START - expected) <= STEP);
});

test('velocidad alta: la hora sigue cayendo en subdivisiones', () => {
  const { clock, times } = playing(50000);
  for (let i = 0; i < 50; i++) clock.advance(16);
  assert.ok(times.every(time => (time - START) % STEP === 0));
});

test('bloqueo largo: no salta más de un segundo de tiempo real', () => {
  const { clock, times } = playing(1000);
  clock.advance(600000);
  assert.equal(times[0], START + Math.round(1300 * 1000 / STEP) * STEP);
});

test('bloqueo largo: a velocidad lenta el tope no acorta el tick normal', () => {
  const { clock, times } = playing(1);
  clock.advance(300000);
  assert.deepEqual(times, [START + STEP]);
});

test('sin deuda: un tick que llega muy pronto no avanza', () => {
  const { clock, times } = playing(1000);
  clock.advance(100);
  assert.deepEqual(times, []);
});

test('final: se detiene en la última hora y avisa ya pausado', () => {
  const clock = fakeClock();
  const seen = [];
  const controller = new TimeController(START, START + 2 * STEP, '15m', time => seen.push([time, controller.isPlaying]), START);
  controller.playbackSpeed = 1000;
  controller.play();
  clock.advance(3000);
  assert.deepEqual(seen, [[START + 2 * STEP, false]]);
  assert.equal(clock.running(), false);
});

test('pausa: al seguir no cobra el tiempo detenido', () => {
  const { clock, controller, times } = playing(1000);
  clock.advance(300);
  controller.pause();
  clock.advance(100000);
  controller.play();
  clock.advance(300);
  assert.deepEqual(times, [START + STEP, START + 2 * STEP]);
});

test('velocidad: cambiarla reinicia la cuenta', () => {
  const { clock, controller, times } = playing(1000);
  clock.advance(100);
  controller.setSpeed(2000);
  assert.equal(clock.every(), 150);
  clock.advance(150);
  assert.deepEqual(times, [START + STEP]);
});

const candles = [100, 200, 300, 400, 500].map(timestamp => ({ timestamp }));

test('buscar: halla el timestamp exacto', () => {
  assert.equal(timestampIndex(candles, 300), 2);
  assert.equal(timestampIndex(candles, 100), 0);
  assert.equal(timestampIndex(candles, 500), 4);
});

test('buscar: sin vela en esa hora da -1', () => {
  assert.equal(timestampIndex(candles, 250), -1);
  assert.equal(timestampIndex(candles, 50), -1);
  assert.equal(timestampIndex(candles, 900), -1);
  assert.equal(timestampIndex([], 100), -1);
});

test('rango: incluye los dos extremos', () => {
  assert.deepEqual(candlesBetween(candles, 200, 400).map(c => c.timestamp), [200, 300, 400]);
});

test('rango: extremos que no son velas', () => {
  assert.deepEqual(candlesBetween(candles, 150, 450).map(c => c.timestamp), [200, 300, 400]);
  assert.deepEqual(candlesBetween(candles, 0, 1000).length, 5);
  assert.deepEqual(candlesBetween(candles, 600, 900), []);
  assert.deepEqual(candlesBetween(candles, 300, 300).map(c => c.timestamp), [300]);
});

test('rango: da lo mismo que filtrar todas las velas', () => {
  const list = Array.from({ length: 200 }, (_, i) => ({ timestamp: i * 7 }));
  for (let start = -5; start < 1500; start += 13) {
    for (const span of [0, 1, 6, 7, 8, 100, 2000]) {
      const expected = list.filter(c => c.timestamp >= start && c.timestamp <= start + span);
      assert.deepEqual(candlesBetween(list, start, start + span), expected);
    }
  }
});

test('pantalla: con el reloj andando cada tick ya revisó las órdenes', () => {
  assert.equal(tickAlreadySettled({ isPlaying: true, currentTime: START }, START), true);
});

test('pantalla: con el reloj detenido una hora vieja no revisa órdenes', () => {
  const clock = { isPlaying: false, currentTime: START + STEP };
  assert.equal(tickAlreadySettled(clock, START), true);
});

test('pantalla: detenido y en la hora del reloj sí revisa órdenes', () => {
  assert.equal(tickAlreadySettled({ isPlaying: false, currentTime: START }, START), false);
});

test('pantalla: sin reloj todavía sí revisa órdenes', () => {
  assert.equal(tickAlreadySettled(null, START), false);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    log(`ok    ${name}`);
  } catch (error) {
    failed++;
    log(`FALLA ${name}\n${error.message}`);
  }
}
log(`${tests.length - failed} de ${tests.length} correctas`);
process.exit(failed ? 1 : 0);
