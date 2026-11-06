// Pruebas de la ventana de Open Interest sin navegador: que pide, cuando y que conserva.
// Uso: node tests/oi.test.mjs
import assert from 'node:assert/strict';
import OpenInterestIndicator from '../src/components/indicators/OpenInterestIndicator.js';

const TF = 900000;
const T0 = 1780444800000;

console.log = () => {};
console.warn = () => {};
const report = (...args) => process.stdout.write(`${args.join(' ')}\n`);

let requests = [];
let respond = null;

globalThis.fetch = (url) => {
  const query = new URL(url).searchParams;
  const request = {
    start: Number(query.get('start_timestamp_ms')),
    end: Number(query.get('end_timestamp_ms')),
    interval: query.get('interval'),
    localOnly: query.get('local_only')
  };
  requests.push(request);
  const body = respond ? respond(request) : serve(request);
  if (body instanceof Error) return Promise.reject(body);
  return Promise.resolve({ ok: true, json: async () => body });
};

// Como el backend: un punto por vela dentro del rango pedido
function serve({ start, end }) {
  const data = [];
  for (let t = Math.ceil(start / TF) * TF; t < end; t += TF) {
    data.push({ timestamp: t, openInterest: 50000 + (t - T0) / TF });
  }
  return {
    success: true, source: 'local', data,
    oi_first_timestamp: 1596527400000, oi_last_timestamp: 1793910600000,
    oi_first_date: '2020-08-04 02:50:00', oi_last_date: '2026-11-05 15:30:00', oi_interval: '15min'
  };
}

const bar = (i) => ({ timestamp: T0 + i * TF });
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
};

function newIndicator() {
  requests = [];
  respond = null;
  const oi = new OpenInterestIndicator('BTCUSDT', '15m', 30);
  oi.redraws = 0;
  oi.requestRedraw = () => { oi.redraws += 1; };
  return oi;
}

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('pide la ventana alrededor de las velas visibles', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].interval, '15m');
  assert.equal(requests[0].localOnly, 'true');
  assert.ok(requests[0].start < T0 && requests[0].end > T0 + 99 * TF);
  assert.equal(oi.findClosestOI(T0 + 10 * TF), 50010);
  assert.equal(oi.redraws, 1);
});

test('no vuelve a pedir mientras las velas esten dentro de lo cargado', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  oi._loadVisibleRange([bar(50), bar(149)]);
  oi._loadVisibleRange([bar(-500), bar(-400)]);
  await flush();
  assert.equal(requests.length, 1);
});

test('fuera de lo cargado pide otra ventana y conserva la anterior', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  oi._loadVisibleRange([bar(20000), bar(20099)]);
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(oi.findClosestOI(T0), 50000, 'la ventana anterior sigue');
  assert.equal(oi.findClosestOI(T0 + 20000 * TF), 70000);
});

test('la serie queda ordenada tras unir ventanas', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(20000), bar(20099)]);
  await flush();
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  const times = oi.data.map(item => item.timestamp);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(oi.data.length, oi.dataMap.size);
  assert.equal(oi._sortedTimestamps[0], times[0]);
});

test('el histograma funciona con la ventana cargada', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(3)]);
  await flush();
  const data = oi.calculateHistogramMode([bar(0), bar(1), bar(2), bar(3)]);
  assert.equal(data._hasOICoverage, true);
  assert.deepEqual(data.map(item => item.delta), [0, 1, 1, 1]);
});

test('una sola peticion a la vez', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(99)]);
  oi._loadVisibleRange([bar(0), bar(99)]);
  assert.equal(requests.length, 1);
  assert.equal(oi._isFetching, true);
  await flush();
  assert.equal(oi._isFetching, false);
});

test('sin serie local no insiste y conserva lo precargado', async () => {
  const oi = newIndicator();
  oi.loadFromData([{ timestamp: T0, openInterest: 123 }]);
  respond = () => ({ success: false, source: 'none', data: [] });
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(oi.findClosestOI(T0), 123);
  assert.equal(oi.data.length, 1);
});

test('tras un error espera antes de reintentar', async () => {
  const oi = newIndicator();
  respond = () => new Error('caido');
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  assert.equal(requests.length, 1, 'no reintenta de inmediato');
  assert.equal(oi._isFetching, false);

  oi._rangeRetryAt = 0;
  respond = null;
  oi._loadVisibleRange([bar(0), bar(99)]);
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(oi.findClosestOI(T0), 50000);
});

test('la cobertura informa desde cuando hay datos', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(9)]);
  await flush();
  assert.match(oi._getOICoverageMessage(), /2020-08-04/);
});

test('cargar datos de nuevo reinicia el rango', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(9)]);
  await flush();
  oi.loadFromData([{ timestamp: T0, openInterest: 1 }]);
  oi._loadVisibleRange([bar(0), bar(9)]);
  await flush();
  assert.equal(requests.length, 2);
});

test('una carga completa que llega tarde no deja la ventana vacia', async () => {
  const oi = newIndicator();
  oi._loadVisibleRange([bar(0), bar(9)]);
  await flush();
  assert.equal(oi.findClosestOI(T0), 50000);

  respond = () => ({ success: true, data: [{ timestamp: T0 - 500000 * TF, openInterest: 1 }] });
  await oi.fetchData(true);
  assert.equal(oi.findClosestOI(T0), 1, 'la carga vieja reemplazo la ventana');

  respond = null;
  oi._loadVisibleRange([bar(0), bar(9)]);
  await flush();
  assert.equal(requests.length, 3);
  assert.equal(oi.findClosestOI(T0), 50000);
  assert.match(oi._getOICoverageMessage(), /2020-08-04/);
});

test('en 1 minuto el margen usa la resolucion de 5 minutos', async () => {
  requests = [];
  respond = null;
  const oi = new OpenInterestIndicator('BTCUSDT', '1m', 30);
  oi._loadVisibleRange([{ timestamp: T0 }, { timestamp: T0 + 60000 }]);
  await flush();
  assert.equal(T0 - requests[0].start, 2000 * 300000);
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    report(`ok ${name}`);
  } catch (error) {
    failed += 1;
    report(`FALLA ${name}: ${error.message}`);
  }
}
report(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
