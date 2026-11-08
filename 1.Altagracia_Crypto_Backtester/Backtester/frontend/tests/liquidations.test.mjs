// Zonas de liquidaciones: cálculo, sin futuro, carga por partes, zonas cruzadas, dibujo y velocidad.
// Uso: node tests/liquidations.test.mjs
// Si existe OrderFlowData/liquidations, también recorre los datos reales de BTC con retrocesos.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

console.log = ((log) => (...args) => {
  if (String(args[0]).startsWith('ok ') || String(args[0]).startsWith('FALLA') || String(args[0]).startsWith('  ') || String(args[0]).includes('pruebas correctas')) log(...args);
})(console.log);
console.warn = () => {};

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};

let clock = 0; // Tiempo real simulado para el límite entre pedidos
Object.defineProperty(globalThis.performance, 'now', { value: () => clock, configurable: true, writable: true });

const Z = await import('../src/components/indicators/liquidationZones.js');
const {
  default: LiquidationsIndicator, ageText, spanText, zoneLabel, defaultLiquidationsConfig, cleanLiquidationsSettings
} = await import('../src/components/indicators/LiquidationsIndicator.js');
const { setBlindAnchor } = await import('../src/components/backtesting/blindClock.js');

const H = 3600000;
const D = 86400000;
const T0 = Date.UTC(2024, 2, 1);
const cell = (known, price, long, short = 0, width = 0) => ({ known, start: known, end: known, low: price - width / 2, high: price + width / 2, long, short });

const tests = [];
const test = (name, run) => tests.push([name, run]);

// Generador repetible
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomCells(rand, count, from, to, center = 60000) {
  const cells = [];
  for (let i = 0; i < count; i++) {
    const known = Math.floor(from + rand() * (to - from));
    const price = center * (1 + (rand() - 0.5) * 0.12);
    const usd = Math.floor(rand() ** 3 * 2e6) + 100;
    cells.push(rand() < 0.6 ? cell(known, price, usd) : cell(known, price, 0, usd));
  }
  return cells.sort((a, b) => a.known - b.known);
}

// ------------------------------------------------------------------ cálculo

test('paso redondo más cercano', () => {
  assert.equal(Z.niceStep(75), 100);
  assert.equal(Z.niceStep(60), 50);
  assert.equal(Z.niceStep(2.2), 2);
  assert.equal(Z.niceStep(0.0023), 0.0025);
  assert.equal(Z.binWidthFor(75000, 0.1, 0), 100);
  assert.equal(Z.binWidthFor(2200, 0.1, 5), 5, 'nunca más fino que la celda de la fuente');
});

test('un pico arma una zona con sus vecinas que bajan sin caer de la fracción', () => {
  const cells = [cell(1, 1005, 100), cell(2, 1015, 300), cell(3, 1025, 120), cell(4, 1035, 10)];
  const zones = Z.buildZones(cells, 0, cells.length, 10);
  assert.equal(zones.length, 1);
  const [zone] = zones;
  assert.equal(zone.low, 1000);
  assert.equal(zone.high, 1030, 'la franja de 10 USD queda afuera: es menos de 35% del pico');
  assert.equal(zone.peak, 1015);
  assert.equal(zone.long, 520);
  assert.equal(zone.side, 'long');
});

test('dos picos separados son dos zonas, de la mayor a la menor', () => {
  const cells = [cell(1, 1105, 0, 300), cell(2, 1005, 500)];
  const zones = Z.buildZones(cells, 0, cells.length, 10);
  assert.deepEqual(zones.map(zone => [zone.peak, zone.side, zone.total]), [[1005, 'long', 500], [1105, 'short', 300]]);
});

test('una zona no pasa de maxHalfBins franjas a cada lado', () => {
  const cells = [990, 1000, 1010, 1020, 1030, 1040, 1050].map((price, i) => cell(i, price + 5, 100 - Math.abs(i - 3) * 5));
  const zone = Z.buildZones(cells, 0, cells.length, 10, { maxHalfBins: 2, halfFraction: 0.1 })[0];
  assert.equal(zone.high - zone.low, 50);
});

test('nace cuando junta la mitad de su dinero', () => {
  const late = Z.buildZones([cell(10, 1005, 100), cell(20, 1005, 100), cell(30, 1005, 300)], 0, 3, 10)[0];
  assert.equal(late.birth, 30);
  assert.equal(late.first, 10);
  assert.equal(late.last, 30);
  const early = Z.buildZones([cell(10, 1005, 300), cell(20, 1005, 100)], 0, 2, 10)[0];
  assert.equal(early.birth, 10);
});

test('solo usa las celdas [from, to)', () => {
  const cells = [cell(1, 1005, 900), cell(2, 2005, 100), cell(3, 3005, 900)];
  const zones = Z.buildZones(cells, 1, 2, 10);
  assert.deepEqual(zones.map(zone => zone.peak), [2005]);
});

test('ventana (hora - días, hora]: lo de la hora entra y lo del borde viejo no', () => {
  const cells = [cell(T0 - 30 * D, 100, 1), cell(T0 - 30 * D + 1, 100, 1), cell(T0, 100, 1), cell(T0 + 1, 100, 1)];
  assert.deepEqual(Z.windowRange(cells, T0, 30 * D), [1, 3]);
});

test('cerca del precio: las mayores de cada lado, las que lo tienen adentro y nada lejos', () => {
  const zones = [
    { low: 990, high: 1010, peak: 1000, total: 50, long: 50, short: 0, side: 'long' },
    { low: 1100, high: 1110, peak: 1105, total: 400, long: 400, short: 0, side: 'long' },
    { low: 1050, high: 1060, peak: 1055, total: 200, long: 0, short: 200, side: 'short' },
    { low: 1030, high: 1040, peak: 1035, total: 90, long: 0, short: 90, side: 'short' },
    { low: 900, high: 910, peak: 905, total: 300, long: 300, short: 0, side: 'long' },
    { low: 2000, high: 2010, peak: 2005, total: 1000, long: 1000, short: 0, side: 'long' },
    { low: 960, high: 970, peak: 965, total: 20, long: 0, short: 20, side: 'short' }
  ];
  const picked = Z.pickZones(zones.sort((a, b) => b.total - a.total), 1000, { perSide: 2, maxDistancePct: 15, minShare: 0.03 });
  assert.equal(picked.max, 1000, 'la intensidad se mide contra la mayor de la ventana, aunque esté lejos');
  assert.deepEqual(picked.zones.map(zone => zone.peak), [1105, 905, 1055, 1000], 'de la mayor a la menor: dos arriba, lo que hay abajo y la que tiene el precio adentro');
  assert.deepEqual(picked.above.map(zone => zone.peak), [1105, 1055]);
  assert.equal(picked.zones[0].share, 0.4);
  assert.ok(Math.abs(picked.zones[0].distancePct - 10) < 1e-9);
  const strict = Z.pickZones(zones, 1000, { perSide: 3, maxDistancePct: 15, minShare: 0.06 });
  assert.ok(!strict.zones.some(zone => zone.peak === 1000), 'el tamaño mínimo también aplica a la que tiene el precio adentro');
  const onlyShorts = Z.pickZones(zones, 1000, { perSide: 3, maxDistancePct: 15, minShare: 0, showLongs: false });
  assert.ok(onlyShorts.zones.every(zone => zone.side === 'short'));
});

test('separación: una zona pegada a otra mayor no se muestra y deja su lugar a la siguiente', () => {
  const zone = (peak, total) => ({ low: peak - 1, high: peak + 1, peak, total, long: total, short: 0, side: 'long' });
  const zones = [zone(1010, 100), zone(1011, 95), zone(1012, 90), zone(1014, 85), zone(1020, 80), zone(1030, 70)];
  // 0.25% de 1000 son 2.5 de espacio entre bordes: 1011 se monta, 1012 toca, 1014 deja 2 y 1020 deja 8
  const picked = Z.pickZones(zones, 1000, { perSide: 2, maxDistancePct: 10, minShare: 0, minGapPct: 0.25 });
  assert.deepEqual(picked.zones.map(item => item.peak), [1010, 1020]);
  const loose = Z.pickZones(zones, 1000, { perSide: 2, maxDistancePct: 10, minShare: 0, minGapPct: 0 });
  assert.deepEqual(loose.zones.map(item => item.peak), [1010, 1012], 'sin espacio exigido solo se descartan las que se montan');
});

test('fuente: la de mayor prioridad que cubre la hora, y si ninguna, la que tiene datos en la ventana', () => {
  const sources = [
    { id: 'marginpad', first: Date.UTC(2026, 9, 8), last: Date.UTC(2026, 10, 8) },
    { id: 'binance_cm', first: Date.UTC(2023, 5, 25), last: Date.UTC(2024, 9, 14, 20) },
    { id: 'bitfinex', first: Date.UTC(2021, 7, 1), last: Date.UTC(2026, 10, 7) }
  ];
  const at = (time) => Z.activeSource(sources, time, 30 * D)?.id ?? null;
  assert.equal(at(Date.UTC(2024, 0, 1)), 'binance_cm');
  assert.equal(at(Date.UTC(2024, 9, 15, 12)), 'binance_cm', 'hasta un día después de su último dato');
  assert.equal(at(Date.UTC(2024, 9, 20)), 'bitfinex', 'después manda la que sí cubre la hora');
  assert.equal(at(Date.UTC(2026, 9, 20)), 'marginpad');
  assert.equal(at(Date.UTC(2022, 0, 1)), 'bitfinex');
  assert.equal(at(Date.UTC(2021, 0, 1)), null);
  assert.equal(Z.activeSource(sources.slice(0, 2), Date.UTC(2024, 10, 1), 30 * D)?.id, 'binance_cm', 'sin otra fuente, la que tiene datos en la ventana');
  assert.equal(Z.activeSource(sources, Date.UTC(2024, 0, 1), 30 * D, 'bitfinex')?.id, 'bitfinex', 'una fuente elegida a mano manda');
  assert.equal(Z.activeSource(sources, Date.UTC(2022, 0, 1), 30 * D, 'marginpad'), null, 'y si no tiene datos en la fecha no se usa otra');
});

test('fuente elegida sin datos en la fecha: lo dice con su tramo', async () => {
  const sources = [
    { ...SOURCES_EVENTS[0], id: 'binance_cm', label: 'Binance Coin-M', first: Date.UTC(2023, 5, 25), last: Date.UTC(2024, 9, 14) },
    { ...SOURCES_EVENTS[0], id: 'bitfinex', label: 'Bitfinex', first: Date.UTC(2021, 7, 1), last: Date.UTC(2026, 10, 7) }
  ];
  fakeBackend([], sources);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  indicator.updateConfig({ source: 'binance_cm' });
  const time = Date.UTC(2022, 0, 1);
  const candles = hourCandles(time - 100 * H, 100);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  await settle();
  const ctx = fakeContext();
  indicator.renderOverlay(ctx, BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  assert.deepEqual(ctx.calls.fillText.map(([text]) => text), ['Liquidaciones: sin datos de Binance Coin-M en esta fecha · hay Binance Coin-M 25/06/2023–13/10/2024']);
});

test('precio estimado: el estado dice el largo de los intervalos', async () => {
  const sources = [{ ...SOURCES_EVENTS[0], id: 'coinalyze', label: 'Coinalyze', scope: 'todo el mercado, precio estimado', kind: 'spans', cell_width: 30 }];
  const span = (start, length, low, long) => ({ known: start + length, start, end: start + length, low, high: low + 30, long, short: 0 });
  fakeBackend([span(T0 - 2 * D, D, 60000, 5e6), span(T0 - 3 * H, H, 60100, 2e6)], sources);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const candles = hourCandles(T0 - 150 * H, 150, 60300);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  await settle();
  const ctx = fakeContext();
  indicator.renderOverlay(ctx, BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  const texts = ctx.calls.fillText.map(([text]) => text);
  assert.ok(texts.includes('Liquidaciones · Coinalyze, todo el mercado, precio estimado · 30 d · intervalos de 1 h'), texts.join(' | '));
  assert.equal(spanText(15 * 60000), '15 min');
  assert.equal(spanText(D), '1 día');
});

test('sin futuro: agregar celdas posteriores nunca cambia las zonas de una hora', () => {
  const rand = random(7);
  const cells = randomCells(rand, 4000, T0, T0 + 90 * D);
  for (let k = 0; k < 60; k++) {
    const time = T0 + Math.floor(rand() * 90 * D);
    const known = cells.filter(item => item.known <= time);
    const [a, b] = Z.windowRange(cells, time, 30 * D);
    const [c, d] = Z.windowRange(known, time, 30 * D);
    assert.deepEqual(Z.buildZones(cells, a, b, 100), Z.buildZones(known, c, d, 100));
  }
});

test('edad y etiqueta', () => {
  assert.equal(ageText(20 * 60000), '20m');
  assert.equal(ageText(5 * H), '5h');
  assert.equal(ageText(3 * D), '3d');
  const zone = { side: 'long', long: 12.3e6, short: 5e6, total: 17.3e6, share: 0.42 };
  assert.equal(zoneLabel(zone), 'L 12.3M + C 5.0M');
  assert.equal(zoneLabel({ ...zone, short: 1e6, total: 13.3e6 }), 'L 12.3M');
  assert.equal(zoneLabel(zone, true), 'L 42%', 'con fecha oculta no va el monto');
});

// ------------------------------------------------------------------ zonas cruzadas

const bar = (timestamp, low, high, close = (low + high) / 2, extra = {}) => ({ timestamp, open: close, high, low, close, volume: 1, ...extra });

test('cruzada: la misma subida que formó la zona no la cruza', () => {
  const zone = { birth: 0, low: 100, high: 110 };
  const candles = [bar(0, 95, 112, 111), bar(1, 108, 120, 118)];
  const tracker = new Z.CrossTracker();
  assert.equal(tracker.crossed(zone, candles), false, 'la vela que sale de la zona no cuenta, aunque su mecha la atraviese');
  candles.push(bar(2, 99, 115, 100));
  assert.equal(tracker.crossed(zone, candles), true, 'después de salir por arriba, volver más abajo de su borde bajo la cruza');
});

test('cruzada: el precio salió de la zona y después la atravesó', () => {
  const zone = { birth: 5, low: 100, high: 110 };
  const candles = [bar(0, 90, 120), bar(5, 102, 108), bar(6, 109, 116, 115)];
  const tracker = new Z.CrossTracker();
  assert.equal(tracker.crossed(zone, candles), false, 'la vela del barrido, antes de nacer, no cuenta');
  candles.push(bar(7, 99, 112));
  assert.equal(tracker.crossed(zone, candles), true);
});

test('cruzada: la vela en formación cuenta sin guardarse', () => {
  const zone = { birth: 0, low: 100, high: 110 };
  const candles = [bar(0, 111, 118, 115), bar(1, 105, 112, 106, { in_progress: true })];
  const tracker = new Z.CrossTracker();
  assert.equal(tracker.crossed(zone, candles), false);
  candles[1] = bar(1, 98, 112, 99, { in_progress: true });
  assert.equal(tracker.crossed(zone, candles), true);
  candles[1] = bar(1, 105, 112, 106, { in_progress: true }); // Al retroceder la vela se rehace
  tracker.reset();
  assert.equal(tracker.crossed(zone, candles), false);
});

test('cruzada: revisar por partes da lo mismo que recorrer todo', () => {
  const rand = random(11);
  const all = [];
  let price = 1000;
  for (let i = 0; i < 3000; i++) {
    price *= 1 + (rand() - 0.5) * 0.01;
    all.push(bar(i * 60, price * (1 - rand() * 0.004), price * (1 + rand() * 0.004)));
  }
  const zones = Array.from({ length: 40 }, () => {
    const birth = Math.floor(rand() * 2900) * 60 + 30;
    const low = 950 + rand() * 100;
    return { birth, low, high: low + 2 + rand() * 6 };
  });
  // La regla recorrida desde cero en cada consulta
  const brute = (zone, candles) => {
    let side = null;
    for (const candle of candles) {
      if (candle.timestamp < zone.birth) continue;
      if (side === null) {
        side = candle.close > zone.high ? 'above' : candle.close < zone.low ? 'below' : null;
        continue;
      }
      if (side === 'above' ? candle.low < zone.low : candle.high > zone.high) return true;
    }
    return false;
  };
  const tracker = new Z.CrossTracker();
  const candles = [];
  let crossedCount = 0;
  for (let i = 0; i < all.length; i++) {
    candles.push(all[i]);
    if (i % 37 !== 0 && i !== all.length - 1) continue;
    for (const zone of zones) {
      const expected = brute(zone, candles);
      crossedCount += expected;
      assert.equal(tracker.crossed(zone, candles), expected);
    }
  }
  assert.ok(crossedCount > 0, 'la prueba tiene zonas cruzadas');
});

// ------------------------------------------------------------------ indicador con fetch simulado

const SOURCES_EVENTS = [{ id: 'binance_cm', label: 'Binance Coin-M', scope: 'un solo mercado', kind: 'events', first: T0 - 60 * D, last: T0 + 60 * D, days: 120, count: 0, cell_width: 0 }];

/** Backend falso con las reglas de liq_store.window: celdas en (start, min(end, known_until)], ordenadas por known */
function fakeBackend(unsorted, sources, { delay = false } = {}) {
  const calls = [];
  const pending = [];
  const cells = [...unsorted].sort((a, b) => a.known - b.known);
  globalThis.fetch = (url) => {
    const params = new URL(url, 'http://x').searchParams;
    const start = Number(params.get('start_timestamp'));
    const end = Number(params.get('end_timestamp'));
    const known = Number(params.get('known_until'));
    const cut = Math.min(end, known);
    calls.push({ url, start, end, known });
    const body = {
      success: true,
      sources,
      start,
      known_until: cut,
      cells: cells.filter(item => item.known > start && item.known <= cut).map(item => [item.known, item.start, item.end, item.low, item.high, item.long, item.short, item.source ?? 0])
    };
    const response = { ok: true, json: async () => body };
    if (!delay) return Promise.resolve(response);
    return new Promise(resolve => pending.push(() => resolve(response)));
  };
  return { calls, pending };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function fakeContext() {
  const calls = { fillRect: [], fillText: [], stroke: 0, dashes: [] };
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { calls.stroke += 1; },
    setLineDash(dash) { calls.dashes.push(dash); },
    fillRect(...args) { calls.fillRect.push([this.fillStyle, ...args]); },
    fillText(text, x, y) { calls.fillText.push([text, x, y]); },
    measureText: (text) => ({ width: text.length * 6 }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', globalAlpha: 1
  };
}

const BOUNDS = { x: 10, y: 25, width: 800, height: 400 };

// Todas las velas caben en el ancho, como en MiniChart
function chart(candles, time, low, high) {
  const barMs = candles.length > 1 ? candles[1].timestamp - candles[0].timestamp : H;
  const first = candles[0].timestamp;
  const barWidth = BOUNDS.width / candles.length;
  return {
    knownCandles: candles,
    knownUntil: time,
    priceToY: (price) => BOUNDS.y + (high - price) / (high - low) * BOUNDS.height,
    timeToX: (timestamp) => BOUNDS.x + (timestamp - first) / barMs * barWidth + barWidth / 2,
    requestRedraw: () => {}
  };
}

function hourCandles(from, count, price = 60000) {
  return Array.from({ length: count }, (_, i) => bar(from + i * H, price - 50, price + 50, price));
}

test('carga: nunca pide después de la hora simulada', async () => {
  const backend = fakeBackend([], SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const time = T0 + 10 * H + 123;
  const candles = hourCandles(time - 100 * H, 100);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  await settle();
  assert.equal(backend.calls.length, 1);
  assert.equal(backend.calls[0].known, time);
  assert.equal(backend.calls[0].end, time);
  assert.equal(backend.calls[0].start, time - 30 * D - 2 * D);
  assert.equal(indicator.loadedTo, time);
});

test('carga por partes: con eventos pide lo nuevo cada 5 minutos simulados, con 400 ms de distancia', async () => {
  const backend = fakeBackend([], SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  let time = T0;
  const candles = hourCandles(T0 - 100 * H, 100);
  const draw = () => indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  draw();
  await settle();
  clock += 1000;
  time += 4 * 60000;
  draw();
  await settle();
  assert.equal(backend.calls.length, 1, 'menos de 5 minutos simulados no pide');
  time += 2 * 60000;
  draw();
  await settle();
  assert.equal(backend.calls.length, 2);
  assert.equal(backend.calls[1].start, T0, 'pide desde lo ya cargado');
  assert.equal(backend.calls[1].known, time);
  time += 60 * 60000;
  draw();
  await settle();
  assert.equal(backend.calls.length, 2, 'menos de 400 ms reales desde el último pedido');
  clock += 500;
  draw();
  await settle();
  assert.equal(backend.calls.length, 3);
});

test('carga por partes: con fuentes por día solo pregunta al pasar la medianoche', async () => {
  const sources = [{ ...SOURCES_EVENTS[0], id: 'marginpad', kind: 'days', cell_width: 50 }];
  const backend = fakeBackend([], sources);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  let time = T0 + 20 * H;
  const candles = hourCandles(T0 - 80 * H, 100);
  const draw = () => indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  draw();
  await settle();
  clock += 1000;
  time += 3 * H;
  draw();
  await settle();
  assert.equal(backend.calls.length, 1);
  time += 2 * H;
  draw();
  await settle();
  assert.equal(backend.calls.length, 2);
});

test('carga por partes: sin fuente que pueda tener datos no pregunta', async () => {
  const sources = [{ ...SOURCES_EVENTS[0], first: T0 - 90 * D, last: T0 - 40 * D }];
  const backend = fakeBackend([], sources);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  let time = T0;
  const candles = hourCandles(T0 - 100 * H, 100);
  const ctx = fakeContext();
  indicator.renderOverlay(ctx, BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  await settle();
  clock += 1000;
  time += 6 * H;
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  await settle();
  assert.equal(backend.calls.length, 1);
  assert.equal(indicator.loadedTo, time);
});

test('retroceso: lo conocido después se quita y una respuesta vieja no entra', async () => {
  const cells = [cell(T0 - 2 * H, 60000, 5e5), cell(T0 + H, 60500, 7e5)];
  const backend = fakeBackend(cells, SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const candles = hourCandles(T0 - 100 * H, 100);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, T0 + 2 * H, 59000, 61000));
  await settle();
  assert.equal(indicator.bySource.get('binance_cm').length, 2);

  // Pedido en camino y retroceso antes de que llegue
  const slow = fakeBackend(cells, SOURCES_EVENTS, { delay: true });
  clock += 1000;
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, T0 + 3 * H, 59000, 61000));
  assert.equal(slow.calls.length, 1);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  assert.deepEqual(indicator.bySource.get('binance_cm').map(item => item.known), [T0 - 2 * H]);
  slow.pending.forEach(resolve => resolve());
  await settle();
  assert.deepEqual(indicator.bySource.get('binance_cm').map(item => item.known), [T0 - 2 * H], 'la respuesta de antes del retroceso se descarta');
  assert.equal(indicator.loadedTo, T0);
});

test('memoria: lo que salió de la ventana se suelta y las zonas no cambian', async () => {
  const rand = random(21);
  const cells = randomCells(rand, 6000, T0 - 60 * D, T0 + 60 * D);
  fakeBackend(cells, SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  let time = T0;
  let biggest = 0;
  while (time < T0 + 50 * D) {
    clock += 1000;
    time += 6 * H;
    const candles = hourCandles(time - 100 * H, 100, 60000);
    indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 50000, 70000));
    await settle();
    indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 50000, 70000));
    const list = indicator.bySource.get('binance_cm') || [];
    biggest = Math.max(biggest, list.length);
    if (indicator.loadedTo !== time) continue;
    const known = cells.filter(item => item.known <= time);
    const [a, b] = Z.windowRange(known, time, 30 * D);
    assert.deepEqual(indicator.zones, Z.buildZones(known, a, b, indicator.binWidth, indicator.config));
  }
  const inWindow = cells.filter(item => item.known > time - 30 * D - 2 * D - 7 * D && item.known <= time).length;
  assert.ok(biggest <= inWindow + 600, `guarda ${biggest} celdas con ${inWindow} en la ventana y su margen`);
  assert.ok(indicator.loadedFrom > T0 - 32 * D, 'el inicio de lo cargado avanzó');
});

test('dibujo: franjas, aviso fuera de la vista, estado con la fuente y zonas para el Observador', async () => {
  const cells = [
    cell(T0 - 5 * D, 60000, 9e6), cell(T0 - 5 * D + 60000, 60010, 2e6),
    cell(T0 - 2 * D, 60600, 0, 4e6),
    cell(T0 - 3 * D, 62000, 6e6) // Arriba de la vista
  ];
  fakeBackend(cells, SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const candles = hourCandles(T0 - 150 * H, 150, 60300);
  const context = chart(candles, T0, 59500, 61000);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, context);
  await settle();
  const ctx = fakeContext();
  indicator.renderOverlay(ctx, BOUNDS, candles, candles, context);
  const texts = ctx.calls.fillText.map(([text]) => text);
  assert.ok(texts.some(text => text.startsWith('L 11.0M · 5d')), texts.join(' | '));
  assert.ok(texts.some(text => text.startsWith('C 4.0M · 2d')), texts.join(' | '));
  assert.ok(texts.some(text => text === '▲ 1 zona · 2.8%'), texts.join(' | '));
  assert.ok(texts.some(text => text.startsWith('Liquidaciones · Binance Coin-M, un solo mercado · 30 d')), texts.join(' | '));

  const levels = indicator.selectableLevels();
  assert.equal(levels.length, 2);
  for (const level of levels) {
    assert.equal(level.source, 'Liquidaciones');
    assert.ok(level.left >= BOUNDS.x && level.right === BOUNDS.x + BOUNDS.width);
    assert.ok(level.top < level.bottom);
    assert.ok(level.low < level.price && level.price < level.high);
    assert.ok(Number.isFinite(level.time));
  }
  const again = fakeContext();
  indicator.renderOverlay(again, BOUNDS, candles, candles, context);
  assert.deepEqual(indicator.selectableLevels().map(level => level.id), levels.map(level => level.id), 'el mismo id entre cuadros');
});

test('dibujo: una zona cruzada queda tenue, punteada y avisa', async () => {
  const cells = [cell(T0 - 5 * D, 60000, 9e6)];
  fakeBackend(cells, SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const candles = hourCandles(T0 - 150 * H, 150, 60300);
  const context = chart(candles, T0, 59000, 61000);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, context);
  await settle();
  const before = fakeContext();
  indicator.renderOverlay(before, BOUNDS, candles, candles, context);
  // Una vela nueva baja por debajo de la zona: antes las velas solo habían estado arriba
  candles.push(bar(candles[candles.length - 1].timestamp + H, 59800, 60400, 59900, { in_progress: true }));
  const after = fakeContext();
  indicator.renderOverlay(after, BOUNDS, candles, candles, context);
  const band = (ctx) => ctx.calls.fillRect.find(([style]) => style.startsWith('rgba(233, 30, 99'));
  const alpha = (ctx) => Number(band(ctx)[0].match(/, ([\d.]+)\)$/)[1]);
  assert.ok(alpha(after) <= alpha(before) * 0.55, `${alpha(before)} → ${alpha(after)}`);
  assert.ok(after.calls.fillText.some(([text]) => text.endsWith('· cruzada')));
  assert.ok(after.calls.dashes.some(dash => dash.length === 2));
});

test('fecha oculta: sin fuente, sin fechas y sin montos', async () => {
  fakeBackend([cell(T0 - 5 * D, 60000, 9e6)], SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const candles = hourCandles(T0 - 150 * H, 150, 60300);
  const context = chart(candles, T0, 59000, 61000);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, context);
  await settle();
  setBlindAnchor(T0 - 3 * D);
  try {
    const ctx = fakeContext();
    indicator.renderOverlay(ctx, BOUNDS, candles, candles, context);
    const texts = ctx.calls.fillText.map(([text]) => text);
    assert.ok(texts.includes('Liquidaciones · 30 d'), texts.join(' | '));
    assert.ok(texts.some(text => text.startsWith('L 100% · 5d')), texts.join(' | '));
    assert.ok(!texts.some(text => /Binance|\d\d\/\d\d\/\d{4}|M ·/.test(text)), texts.join(' | '));
  } finally {
    setBlindAnchor(null);
  }
});

test('sin datos en la fecha: dice qué tramos hay y no dibuja zonas', async () => {
  fakeBackend([], [{ ...SOURCES_EVENTS[0], first: Date.UTC(2023, 5, 25), last: Date.UTC(2024, 9, 14) }]);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const time = Date.UTC(2022, 0, 1);
  const candles = hourCandles(time - 100 * H, 100);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  await settle();
  const ctx = fakeContext();
  indicator.renderOverlay(ctx, BOUNDS, candles, candles, chart(candles, time, 59000, 61000));
  const texts = ctx.calls.fillText.map(([text]) => text);
  assert.deepEqual(texts, ['Liquidaciones: sin datos en esta fecha · hay Binance Coin-M 25/06/2023–13/10/2024']);
  assert.deepEqual(indicator.selectableLevels(), []);
});

test('apagado no pide nada ni dibuja', async () => {
  const backend = fakeBackend([], SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  const candles = hourCandles(T0 - 100 * H, 100);
  const ctx = fakeContext();
  indicator.renderOverlay(ctx, BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  await settle();
  assert.equal(backend.calls.length, 0);
  assert.equal(ctx.calls.fillRect.length + ctx.calls.fillText.length, 0);
});

test('parámetros: se limpian y la ventana nueva se pide completa', async () => {
  const clean = cleanLiquidationsSettings({ ...defaultLiquidationsConfig(), perSide: '12', lookbackDays: '0', maxDistancePct: 'x', minShare: 0.2, source: 'otra', longColor: 'rojo' });
  assert.equal(clean.perSide, 8);
  assert.equal(clean.lookbackDays, 1);
  assert.equal(clean.maxDistancePct, 6);
  assert.equal(clean.minShare, 0.2);
  assert.equal(clean.source, 'auto', 'una fuente que no existe vuelve a automática');
  assert.equal(clean.longColor, '#E91E63');
  stored.set('liquidations_settings_GUARDADO', JSON.stringify({ perSide: null, source: 'bitfinex', maxHalfBins: 7 }));
  const saved = new LiquidationsIndicator('GUARDADO', '60');
  assert.equal(saved.config.perSide, 3, 'un null guardado no llega al cálculo');
  assert.equal(saved.config.source, 'bitfinex');
  assert.equal(saved.config.maxHalfBins, 1, 'las reglas internas guardadas antes no se usan');
  const { saveLiquidationsSettings } = await import('../src/components/indicators/LiquidationsIndicator.js');
  saveLiquidationsSettings('GUARDADO', { ...defaultLiquidationsConfig(), perSide: 4 });
  const written = JSON.parse(stored.get('liquidations_settings_GUARDADO'));
  assert.equal(written.perSide, 4);
  assert.ok(!('maxHalfBins' in written) && !('halfFraction' in written));
  const backend = fakeBackend([], SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const candles = hourCandles(T0 - 100 * H, 100);
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  await settle();
  indicator.updateConfig({ lookbackDays: 60 });
  indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  await settle();
  assert.equal(backend.calls.length, 2);
  assert.equal(backend.calls[1].start, T0 - 62 * D);
});

test('IndicatorManager: lo tiene primero, con su modal y en lo que se puede elegir', async () => {
  fakeBackend([cell(T0 - 5 * D, 60000, 9e6)], SOURCES_EVENTS);
  const { default: IndicatorManager } = await import('../src/components/indicators/IndicatorManager.js');
  const manager = new IndicatorManager('BTCUSDT', '60', 30);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  await manager.initialize(true, T0 - 10 * D).catch(() => {});
  const indicator = manager.getLiquidationsIndicator();
  assert.equal(manager.indicators[0], indicator);
  assert.equal(indicator.name, 'Liquidaciones');
  assert.equal(indicator.getHeight(), 0, 'no ocupa panel');
  fakeBackend([cell(T0 - 5 * D, 60000, 9e6)], SOURCES_EVENTS);
  await manager.updateIndicatorStates({ Liquidaciones: true }, true);
  const candles = hourCandles(T0 - 150 * H, 150, 60300);
  manager.renderOverlays(fakeContext(), BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  await settle();
  manager.renderOverlays(fakeContext(), BOUNDS, candles, candles, chart(candles, T0, 59000, 61000));
  assert.ok(manager.getSelectableLevels().some(level => level.source === 'Liquidaciones'));
});

// ------------------------------------------------------------------ velocidad

test('velocidad: una ventana de 30 días se calcula en pocos ms y un cuadro con zonas ya calculadas cuesta menos de 0.5 ms', async () => {
  const rand = random(3);
  const realNow = () => Number(process.hrtime.bigint()) / 1e6;
  // 30 días de BTC en Binance Coin-M traen unos 3,500 eventos: aquí 5,000
  const month = randomCells(rand, 5000, T0 - 30 * D, T0);
  let begin = realNow();
  for (let i = 0; i < 20; i++) Z.buildZones(month, 0, month.length, 50);
  const monthMs = (realNow() - begin) / 20;
  assert.ok(monthMs < 8, `${monthMs.toFixed(2)} ms`);
  // Caso extremo: 90 días con 60,000 eventos
  const cells = randomCells(rand, 60000, T0 - 90 * D, T0);
  begin = realNow();
  const zones = Z.buildZones(cells, 0, cells.length, 50);
  const build = realNow() - begin;
  assert.ok(zones.length > 0);
  assert.ok(build < 150, `${build.toFixed(1)} ms`);

  fakeBackend(cells, SOURCES_EVENTS);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  indicator.updateConfig({ lookbackDays: 90 });
  const candles = hourCandles(T0 - 2000 * H, 2000, 60000);
  const context = chart(candles.slice(-200), T0, 57000, 63000);
  context.knownCandles = candles;
  const visible = candles.slice(-200);
  indicator.renderOverlay(fakeContext(), BOUNDS, visible, candles, context);
  await settle();
  indicator.renderOverlay(fakeContext(), BOUNDS, visible, candles, context);
  begin = realNow();
  for (let i = 0; i < 2000; i++) indicator.renderOverlay(fakeContext(), BOUNDS, visible, candles, context);
  const frame = (realNow() - begin) / 2000;
  console.log(`  ventana de 5,000 celdas ${monthMs.toFixed(2)} ms, de 60,000 celdas ${build.toFixed(1)} ms, cuadro ${frame.toFixed(3)} ms`);
  assert.ok(frame < 0.5, `${frame.toFixed(3)} ms por cuadro`);
});

// ------------------------------------------------------------------ datos reales

const STORE = process.env.ORDERFLOW_LIQ || 'C:\\Users\\inven\\OrderFlowData\\liquidations';

function readStore(symbol) {
  const sources = [];
  const cells = [];
  const files = [['marginpad', 'days'], ['coinalyze', 'spans'], ['binance_cm', 'events'], ['bitfinex', 'events']]; // Orden de liq_store.SOURCES
  for (const [id, kind] of files) {
    const path = `${STORE}\\${symbol}_${id}.csv`;
    if (!existsSync(path)) continue;
    const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
    const keys = header.split(',');
    const index = sources.length;
    const mine = lines.map(line => {
      const row = Object.fromEntries(line.split(',').map((value, i) => [keys[i], value]));
      if (kind === 'days') {
        const start = Date.parse(`${row.date_utc}T00:00:00Z`);
        return { known: start + D, start, end: start + D, low: +row.price_low, high: +row.price_high, long: +row.long_usd, short: +row.short_usd, source: index };
      }
      if (kind === 'spans') {
        return { known: +row.end_ms, start: +row.start_ms, end: +row.end_ms, low: +row.price_low, high: +row.price_high, long: +row.long_usd, short: +row.short_usd, source: index };
      }
      const t = +row.time_ms;
      return { known: t, start: t, end: t, low: +row.price, high: +row.price, long: row.side === 'long' ? +row.usd : 0, short: row.side === 'short' ? +row.usd : 0, source: index };
    });
    for (const item of mine) cells.push(item);
    const fold = (pick, take) => mine.reduce((best, c) => pick(best, take(c)), pick === Math.min ? Infinity : -Infinity);
    sources.push({ id, kind, label: id, scope: '', first: fold(Math.min, c => c.start), last: fold(Math.max, c => c.end), cell_width: fold(Math.max, c => c.high - c.low) });
  }
  cells.sort((a, b) => a.known - b.known);
  return { sources, cells };
}

test('datos reales de BTC: cargando por partes y con retrocesos, las zonas son las de calcular todo de una vez', async () => {
  const { sources, cells } = readStore('BTCUSDT');
  if (!cells.length) {
    console.log('  sin almacén de liquidaciones: prueba omitida');
    return;
  }
  fakeBackend(cells, sources);
  const indicator = new LiquidationsIndicator('BTCUSDT', '60');
  indicator.enabled = true;
  const rand = random(5);
  const periods = sources.map(source => [source.first + 3 * D, Math.min(source.last, source.first + 200 * D)]);
  let checked = 0;
  for (const [from, to] of periods) {
    let time = from;
    while (time < to) {
      // Avanza de 10 minutos a 9 horas, y a veces retrocede hasta 2 días
      time += rand() < 0.08 ? -Math.floor(rand() * 2 * D) : Math.floor(600000 + rand() * 9 * H);
      clock += 1000;
      const candles = hourCandles(time - 100 * H, 100, 60000);
      indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 50000, 70000));
      await settle();
      indicator.renderOverlay(fakeContext(), BOUNDS, candles, candles, chart(candles, time, 50000, 70000));
      if (indicator.loadedTo !== time) continue; // Esperando el límite entre pedidos
      const source = Z.activeSource(sources, time, 30 * D);
      if (!source) continue;
      const mine = cells.filter(item => sources[item.source].id === source.id && item.known <= time);
      const [a, b] = Z.windowRange(mine, time, 30 * D);
      const expected = Z.buildZones(mine, a, b, indicator.binWidth, indicator.config);
      assert.deepEqual(indicator.zones, expected, `${source.id} en ${new Date(time).toISOString()}`);
      checked += 1;
    }
  }
  console.log(`  ${checked} momentos comparados en ${sources.map(source => source.id).join(', ')}`);
  assert.ok(checked > 50);
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
