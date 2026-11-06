// VP Periodic. Uso: node tests/sessions.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

console.warn = () => {};

const { SessionProfiles, buildProfile, candlesBetween, sessionLength, sessionStart } = await import('../src/components/indicators/sessionProfile.js');
const { default: VPPeriodic } = await import('../src/components/indicators/VolumeProfilePeriodicIndicator.js');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MONDAY = Date.UTC(2026, 5, 1); // 1 de junio de 2026 fue lunes
const tests = [];
const test = (name, run) => tests.push([name, run]);

const candle = (timestamp, low, high, volume = 10, extra = {}) => ({
  timestamp, open: low, close: high, high, low, volume, ...extra
});

/** Un día de velas de una hora entre low y high */
function day(start, low, high, volume = 10) {
  return Array.from({ length: 24 }, (_, i) => candle(start + i * HOUR, low, high, volume));
}

test('sesión: los días empiezan a medianoche UTC', () => {
  assert.equal(sessionStart(MONDAY + 5 * HOUR, 24), MONDAY);
  assert.equal(sessionStart(MONDAY, 24), MONDAY);
  assert.equal(sessionStart(MONDAY - 1, 24), MONDAY - DAY);
});

test('sesión: de 4 horas', () => {
  assert.equal(sessionStart(MONDAY + 5 * HOUR, 4), MONDAY + 4 * HOUR);
});

test('sesión: la semana empieza el lunes', () => {
  assert.equal(sessionStart(MONDAY + 3 * DAY, 168), MONDAY);
  assert.equal(sessionStart(MONDAY + 7 * DAY, 168), MONDAY + 7 * DAY);
  assert.equal(sessionStart(MONDAY - 1, 168), MONDAY - 7 * DAY);
});

test('velas: incluye el inicio y no el final', () => {
  const candles = day(MONDAY, 1, 2);
  const found = candlesBetween(candles, MONDAY + HOUR, MONDAY + 3 * HOUR);
  assert.deepEqual(found.map(c => c.timestamp), [MONDAY + HOUR, MONDAY + 2 * HOUR]);
  assert.deepEqual(candlesBetween(candles, MONDAY + 100 * HOUR, MONDAY + 101 * HOUR), []);
});

test('perfil: el POC está donde hubo más volumen', () => {
  const profile = buildProfile([candle(0, 100, 110, 1000), candle(1, 100, 190, 10)], 9, 0.7);
  assert.equal(profile.poc.index, 0);
  assert.ok(profile.poc.price >= 100 && profile.poc.price <= 110);
  assert.equal(profile.isReal, false);
});

test('perfil: reparte el volumen de cada vela sin perderlo', () => {
  const profile = buildProfile([candle(0, 100, 200, 500), candle(1, 150, 170, 300)], 20, 0.7);
  assert.ok(Math.abs(profile.totalVolume - 800) < 1e-6);
});

test('perfil: el área de valor cubre al menos esa parte del volumen', () => {
  const profile = buildProfile([candle(0, 100, 200, 500), candle(1, 140, 160, 900)], 25, 0.7);
  const covered = profile.levels.filter(level => level.isValueArea).reduce((sum, level) => sum + level.volume, 0);
  assert.ok(covered >= profile.totalVolume * 0.7);
  assert.ok(profile.valueArea.vahPrice >= profile.poc.price && profile.valueArea.valPrice <= profile.poc.price);
});

test('perfil: con el volumen en un extremo no se sale de las filas', () => {
  const volumes = Array(10).fill(0);
  volumes[9] = 100;
  volumes[0] = 1;
  const profile = buildProfile([candle(0, 100, 200)], 10, 0.999, volumes);
  assert.equal(profile.valueArea.highIndex, 9);
  assert.equal(profile.valueArea.lowIndex, 0);
});

test('perfil: usa el volumen real si llega', () => {
  const volumes = [1, 2, 30, 4];
  const profile = buildProfile([candle(0, 100, 200, 999)], 4, 0.7, volumes);
  assert.equal(profile.poc.index, 2);
  assert.equal(profile.totalVolume, 37);
  assert.equal(profile.isReal, true);
});

test('perfil: una vela sin rango cuenta su volumen', () => {
  const profile = buildProfile([candle(0, 100, 200, 10), candle(1, 150, 150, 40)], 10, 0.7);
  assert.ok(Math.abs(profile.totalVolume - 50) < 1e-6);
});

test('perfil: sin velas o sin rango no hay perfil', () => {
  assert.equal(buildProfile([], 10, 0.7), null);
  assert.equal(buildProfile([candle(0, 100, 100)], 10, 0.7), null);
});

function server(answer) {
  const requests = [];
  globalThis.fetch = async (url) => {
    const params = new URL(url, 'http://localhost').searchParams;
    requests.push(Object.fromEntries(params));
    return { ok: true, json: async () => answer(requests.length) };
  };
  return requests;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const ask = (profiles, candles, knownUntil, redraw) => profiles.get({
  start: MONDAY, end: MONDAY + DAY, candles, rows: 4, valueAreaShare: 0.7, knownUntil, requestRedraw: redraw
});

test('almacén: una sesión terminada pide su volumen real, cortada en su final', async () => {
  const requests = server(() => ({ success: true, minutes: 1440, expected_minutes: 1440, buy: [1, 1, 8, 1], sell: [1, 1, 8, 1] }));
  const profiles = new SessionProfiles('BTCUSDT');
  let redraws = 0;
  const candles = day(MONDAY, 100, 200);

  assert.equal(ask(profiles, candles, MONDAY + DAY, () => { redraws += 1; }).isReal, false, 'mientras llega usa el estimado');
  await flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].known_until, String(MONDAY + DAY));
  assert.equal(redraws, 1);
  const real = ask(profiles, candles, MONDAY + DAY);
  assert.equal(real.isReal, true);
  assert.equal(real.poc.index, 2);
});

test('almacén: la sesión en curso no se pide, porque todavía cambia', async () => {
  const requests = server(() => ({ success: true, minutes: 1, expected_minutes: 1, buy: [1, 1, 1, 1], sell: [1, 1, 1, 1] }));
  const profiles = new SessionProfiles('BTCUSDT');
  ask(profiles, day(MONDAY, 100, 200).slice(0, 10), MONDAY + 10 * HOUR);
  await flush();
  assert.equal(requests.length, 0);
});

test('almacén: sin cobertura completa queda el estimado y no insiste', async () => {
  const requests = server(() => ({ success: true, minutes: 1000, expected_minutes: 1440, buy: [1, 1, 1, 1], sell: [1, 1, 1, 1] }));
  const profiles = new SessionProfiles('BTCUSDT');
  const candles = day(MONDAY, 100, 200);
  ask(profiles, candles, MONDAY + DAY);
  await flush();
  assert.equal(ask(profiles, candles, MONDAY + DAY).isReal, false);
  await flush();
  assert.equal(requests.length, 1);
});

const positions = (bounds) => ({
  priceToY: (price) => bounds.y + bounds.height - price,
  timeToX: (time) => (time - MONDAY) / HOUR * 10
});
const bounds = { x: 0, y: 0, width: 2000, height: 400 };
const fakeCanvas = () => {
  const drawn = [];
  const ctx = new Proxy({ fillRect: (...args) => drawn.push(['rect', ...args]), fillText: (text) => drawn.push(['text', text]) }, {
    get: (target, name) => (name in target ? target[name] : () => {}),
    set: (target, name, value) => { target[name] = value; return true; }
  });
  return { ctx, drawn };
};

function periodic(config = {}) {
  server(() => null);
  const indicator = new VPPeriodic('BTCUSDT', '60', 30, new SessionProfiles('BTCUSDT'));
  indicator.enabled = true;
  indicator.updateConfig(config);
  return indicator;
}

const context = (known, knownUntil) => ({ ...positions(bounds), knownCandles: known, knownUntil, requestRedraw: () => {} });

test('periodic: nace apagado y sin panel propio', () => {
  const indicator = new VPPeriodic('BTCUSDT', '60', 30, new SessionProfiles('BTCUSDT'));
  assert.equal(indicator.enabled, false);
  assert.equal(indicator.height, 0);
});

test('periodic: arma un perfil por sesión visible', () => {
  const indicator = periodic();
  const candles = [...day(MONDAY, 100, 200), ...day(MONDAY + DAY, 150, 250)];
  const sessions = indicator.sessionsInView(candles.slice(10), candles, context(candles, MONDAY + 48 * HOUR));
  assert.deepEqual(sessions.map(item => item.start), [MONDAY, MONDAY + DAY]);
  assert.equal(sessions[0].candles.length, 24, 'la primera sesión usa también las velas fuera de la vista');
});

test('periodic: la sesión en curso solo usa lo ocurrido', () => {
  const indicator = periodic();
  const all = [...day(MONDAY, 100, 200), ...day(MONDAY + DAY, 150, 300)];
  const known = all.slice(0, 30);
  const [, current] = indicator.sessionsInView(known.slice(-12), known, context(known, MONDAY + 30 * HOUR));
  assert.equal(current.candles.length, 6);
});

test('periodic: las velas futuras no cambian el dibujo', () => {
  const known = [...day(MONDAY, 100, 200), ...day(MONDAY + DAY, 150, 250).slice(0, 6)];
  const future = [...known, ...day(MONDAY + DAY, 900, 1000).slice(6)];
  const draw = (allCandles) => {
    const { ctx, drawn } = fakeCanvas();
    periodic().renderOverlay(ctx, bounds, known.slice(-30), allCandles, context(known, MONDAY + 30 * HOUR));
    return drawn;
  };
  assert.deepEqual(draw(future), draw(known));
});

test('periodic: al cambiar la duración cambian las sesiones', () => {
  const indicator = periodic({ periodHours: 4 });
  const candles = day(MONDAY, 100, 200);
  assert.equal(indicator.sessionsInView(candles, candles, context(candles, MONDAY + DAY)).length, 6);
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
