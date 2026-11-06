// Pruebas de que VWAP, Swing, Rejection y Double Top/Bottom no muestran lo que todavía no ocurrió.
// Comparan lo que se dibuja con todos los datos contra lo que da el cálculo con solo lo conocido.
// Uso: node tests/leaks.test.mjs [velas.json]   El archivo trae { "5m": [...], "15m": [...], "1h": [...], "4h": [...] }
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

const say = (...args) => process.stdout.write(`${args.join(' ')}\n`);
console.log = () => {};
console.warn = () => {};
console.error = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {} };

const { default: Swing } = await import('../src/components/indicators/SwingDetectorIndicator.js');
const { default: VWAP } = await import('../src/components/indicators/VWAPIndicator.js');
const { default: Rejection } = await import('../src/components/indicators/RejectionPatternIndicator.js');
const { default: DoubleTop } = await import('../src/components/indicators/DoubleTopBottomIndicator.js');
const { default: IndicatorManager } = await import('../src/components/indicators/IndicatorManager.js');
const { TF_MS, formingCandle, lastClosedIndex } = await import('../src/components/backtesting/replayClock.js');

const HOUR = 3600000;
const START = Date.UTC(2026, 5, 1);

const ctx = new Proxy({}, {
  get: (target, name) => (name in target ? target[name] : () => ({ width: 10 })),
  set: (target, name, value) => { target[name] = value; return true; }
});
const bounds = { x: 0, y: 0, width: 800, height: 400 };
const context = (known, knownUntil) => ({
  knownCandles: known, knownUntil, minPrice: 0, maxPrice: 1000000, yScale: 1, verticalOffset: 0,
  priceToY: price => price, timeToX: timestamp => timestamp
});

const candle = (i, tfMs, low, high, extra = {}) => ({
  timestamp: START + i * tfMs, open: low + 1, close: high - 1, low, high, volume: 100, ...extra
});

const tests = [];
const test = (name, run) => tests.push([name, run]);

// ==================== SWING ====================

// Un máximo claro en la vela 30
function swingCandles(tfMs) {
  return Array.from({ length: 50 }, (_, i) => {
    const peak = 200 - Math.abs(i - 30) * 2;
    return candle(i, tfMs, peak - 5, peak);
  });
}

function drawnSwings(tf, now) {
  const tfMs = TF_MS[tf];
  const all = swingCandles(tfMs);
  const known = all.slice(0, lastClosedIndex(all, tf, now) + 1);
  const swing = new Swing('BTCUSDT', tf, 30, {});
  swing.enabled = true;
  swing.renderOverlay(ctx, bounds, known, all, context(known, now));
  return swing.signals.filter(signal => signal.timestamp === START + 30 * tfMs).length;
}

for (const tf of ['15m', '1h', '4h']) {
  test(`swing en ${tf}: aparece al cerrar la quinta vela de la derecha, ni antes ni después`, () => {
    const opened = START + 30 * TF_MS[tf];
    assert.equal(drawnSwings(tf, opened + 6 * TF_MS[tf] - 60000), 0, 'un minuto antes');
    assert.equal(drawnSwings(tf, opened + 6 * TF_MS[tf]), 1, 'al cerrar');
  });
}

test('swing: una pestaña que nunca recibió la hora tampoco adelanta señales', () => {
  // drawnSwings nunca llama updatePlaybackTime: la hora llega con el dibujo
  assert.equal(drawnSwings('4h', START + 33 * TF_MS['4h']), 0);
});

test('swing: al retroceder el tiempo las señales vuelven a ocultarse', () => {
  const tf = '1h';
  const all = swingCandles(HOUR);
  const swing = new Swing('BTCUSDT', tf, 30, {});
  swing.enabled = true;
  const draw = (now) => {
    const known = all.slice(0, lastClosedIndex(all, tf, now) + 1);
    swing.renderOverlay(ctx, bounds, known, all, context(known, now));
    return swing.signals.length;
  };
  assert.ok(draw(START + 40 * HOUR) > 0);
  assert.equal(draw(START + 31 * HOUR), 0);
});

// ==================== VWAP ====================

function hourCandles(count) {
  return Array.from({ length: count }, (_, i) => {
    const base = 1000 + i * 3 + (i % 5) * 7;
    return { timestamp: START + i * HOUR, open: base, high: base + 12, low: base - 9, close: base + 4, volume: 50 + (i % 7) * 11 };
  });
}

const partialOf = (full, minutes) => ({
  timestamp: full.timestamp, open: full.open, high: full.open + 3, low: full.open - 2, close: full.open + 1,
  volume: full.volume / 4, in_progress: true, knownUntil: full.timestamp + minutes * 60000
});

// Lo que se dibuja con todos los datos: el punto de la vela en formación
function drawnPoint(config, all, index) {
  const vwap = new VWAP('BTCUSDT', '1h', 7, { backtestingMode: true, ...config });
  vwap.enabled = true;
  const forming = partialOf(all[index], 20);
  const known = [...all.slice(0, index), forming];
  vwap.renderOverlay(ctx, bounds, known, all, context(known, forming.knownUntil));
  return { drawn: vwap._pointFor(forming), stored: vwap.dataMap.get(forming.timestamp), known, forming };
}

// El mismo cálculo sin ninguna vela posterior
function honestPoint(config, known) {
  const vwap = new VWAP('BTCUSDT', '1h', 7, { backtestingMode: true, ...config });
  vwap._recalculateVWAP(known);
  return vwap.dataMap.get(known[known.length - 1].timestamp);
}

const closeTo = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} contra ${b}`);

for (const [label, config] of [
  ['sesión', { vwapType: 'session', showBands: true }],
  ['móvil', { vwapType: 'rolling', rollingPeriod: 12, showBands: true }],
  ['anclado', { vwapType: 'anchored', anchorTimestamp: START, showBands: true }]
]) {
  test(`VWAP ${label}: la vela en formación usa lo ya ocurrido`, () => {
    const all = hourCandles(120);
    const { drawn, stored, known } = drawnPoint(config, all, 70);
    const honest = honestPoint(config, known);
    closeTo(drawn.vwap, honest.vwap, 'vwap');
    assert.notEqual(drawn.vwap, stored.vwap, 'el punto guardado sale de la vela final');
    for (const name of Object.keys(honest.bands)) closeTo(drawn.bands[name], honest.bands[name], name);
  });
}

test('VWAP sesión: una vela en formación que abre sesión empieza de cero', () => {
  const all = hourCandles(120);
  const config = { vwapType: 'session', resetHour: 0, showBands: false };
  const { drawn, forming } = drawnPoint(config, all, 48); // Dos días después del inicio, a las 00:00 UTC
  const typical = (forming.high + forming.low + forming.close) / 3;
  closeTo(drawn.vwap, typical, 'vwap de una sola vela');
});

test('VWAP: las velas cerradas no cambian y un anclaje posterior no dibuja', () => {
  const all = hourCandles(120);
  const config = { vwapType: 'session', showBands: false };
  const vwap = new VWAP('BTCUSDT', '1h', 7, { backtestingMode: true, ...config });
  vwap.enabled = true;
  const known = all.slice(0, 60);
  vwap.renderOverlay(ctx, bounds, known, all, context(known, known[59].timestamp + HOUR));
  closeTo(vwap._pointFor(known[40]).vwap, honestPoint(config, all.slice(0, 41)).vwap, 'vela cerrada');

  const anchored = new VWAP('BTCUSDT', '1h', 7, { backtestingMode: true, vwapType: 'anchored', anchorTimestamp: START + 100 * HOUR, showBands: false });
  anchored.enabled = true;
  const forming = partialOf(all[60], 10);
  const withForming = [...known, forming];
  anchored.renderOverlay(ctx, bounds, withForming, all, context(withForming, forming.knownUntil));
  assert.equal(anchored._pointFor(forming), undefined);
});

test('VWAP: el estado de volatilidad es el de la hora simulada, no el del final de los datos', () => {
  const all = hourCandles(120);
  const vwap = new VWAP('BTCUSDT', '1h', 7, { backtestingMode: true, vwapType: 'session', showBands: false });
  vwap.enabled = true;
  const forming = partialOf(all[60], 20);
  const known = [...all.slice(0, 60), forming];
  vwap.renderOverlay(ctx, bounds, known, all, context(known, forming.knownUntil));
  assert.equal(vwap._latestPoint().timestamp, all[59].timestamp);
});

// ==================== REJECTION ====================

// Vela anterior bajista y una vela final con forma de martillo
function hammerCandles() {
  const flat = Array.from({ length: 30 }, (_, i) => ({
    timestamp: START + i * HOUR, open: 1000 + (i % 2), high: 1012, low: 995, close: 1004 + (i % 2), volume: 100
  }));
  const hammer = { timestamp: START + 30 * HOUR, open: 995, high: 999.5, low: 960, close: 999, volume: 100 };
  const after = { timestamp: START + 31 * HOUR, open: 999, high: 1006, low: 995, close: 1001, volume: 100 };
  return [...flat, hammer, after];
}

function drawnPatterns(known, all) {
  const rejection = new Rejection('BTCUSDT', '1h', 30);
  rejection.enabled = true;
  const marks = [];
  rejection.drawPatternMarker = (_, x, y, pattern) => marks.push(pattern);
  rejection.renderOverlay(ctx, bounds, known, all, context(known, known[known.length - 1].timestamp));
  return marks;
}

test('rejection: la forma final de una vela no se ve mientras se forma', () => {
  const all = hammerCandles();
  const forming = { ...all[30], high: 1000, low: 990, open: 996, close: 992, in_progress: true, knownUntil: all[30].timestamp + 1200000 };
  const known = [...all.slice(0, 30), forming];
  assert.equal(drawnPatterns(known, all).filter(mark => mark.timestamp === all[30].timestamp).length, 0);
});

test('rejection: el patrón de la vela final ni siquiera se calcula', () => {
  const all = hammerCandles();
  const forming = { ...all[30], high: 1000, low: 990, open: 996, close: 992, in_progress: true, knownUntil: all[30].timestamp + 1200000 };
  const known = [...all.slice(0, 30), forming];
  const rejection = new Rejection('BTCUSDT', '1h', 30);
  rejection.enabled = true;
  rejection.renderOverlay(ctx, bounds, known, all, context(known, forming.knownUntil));
  assert.equal(rejection.localPatterns.filter(pattern => pattern.timestamp >= forming.timestamp).length, 0);
});

test('rejection validado: tampoco marca la vela en formación', () => {
  const all = hammerCandles();
  const forming = { ...all[30], in_progress: true, knownUntil: all[30].timestamp + 1200000 };
  const known = [...all.slice(0, 30), forming];
  const rejection = new Rejection('BTCUSDT', '1h', 30);
  rejection.enabled = true;
  rejection.setShowMode('validated');
  rejection.patterns = [{ timestamp: all[29].timestamp, patternType: 'HAMMER', confidence: 80 }, { timestamp: forming.timestamp, patternType: 'HAMMER', confidence: 80 }];
  const marks = [];
  rejection.drawPatternMarker = (_, x, y, pattern) => marks.push(pattern.timestamp);
  rejection.renderOverlay(ctx, bounds, known, all, context(known, forming.knownUntil));
  assert.deepEqual(marks, [all[29].timestamp]);
});

test('rejection: un patrón aparece al cerrar su vela', () => {
  const all = hammerCandles();
  const known = all.slice(0, 31);
  assert.equal(drawnPatterns(known, all).filter(mark => mark.type === 'HAMMER' && mark.timestamp === all[30].timestamp).length, 1);
});

test('rejection: mirar solo la vista da los mismos patrones que mirar todo', () => {
  const all = hammerCandles();
  const rejection = new Rejection('BTCUSDT', '1h', 30);
  rejection.config.volumeZScore = { enabled: true, lookbackPeriod: 5, minZScore: -5 };
  const visible = all.slice(20, 31);
  const slice = rejection._closedCandlesToDetect(visible, all, context(all.slice(0, 31), all[30].timestamp));
  assert.equal(slice[0].timestamp, all[14].timestamp, 'incluye las velas del Z-Score');
  const types = candles => rejection.localDetector.detectPatterns(candles, rejection.config)
    .filter(pattern => pattern.timestamp >= visible[0].timestamp).map(pattern => `${pattern.timestamp}${pattern.type}`);
  assert.deepEqual(types(slice), types(all.slice(0, 31)));
});

// ==================== REJECTION VALIDADO ====================

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function detectorServer(answer = () => ({ success: true, patterns: [] })) {
  const requests = [];
  globalThis.fetch = (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : null;
    requests.push({ url, body });
    const result = answer(body, requests.length);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ ok: true, json: async () => result });
  };
  return requests;
}

const fixedRange = (id, extra = {}) => ({
  id, type: 'VOLUME_PROFILE_FIXED', enabled: true, weight: 0.5, levels: ['POC', 'VAH', 'VAL'],
  metadata: { poc: 1000, vah: 1010, val: 990, startTimestamp: START, endTimestamp: START + 5 * HOUR },
  ...extra
});

function validatedRejection(contexts) {
  const rejection = new Rejection('BTCUSDT', '1h', 30, true);
  rejection.enabled = true;
  rejection.setShowMode('validated');
  rejection.config = { ...rejection.config, referenceContexts: contexts };
  rejection.drawn = [];
  rejection.drawPatternMarker = (_, x, y, pattern) => rejection.drawn.push(pattern.timestamp);
  return rejection;
}

async function drawValidated(rejection, known, all) {
  rejection.validatedNextAt = 0;
  const newest = known[known.length - 1];
  rejection.renderOverlay(ctx, bounds, known, all, context(known, newest.knownUntil || newest.timestamp + HOUR));
  await flush();
  await flush();
}

test('rejection validado: pide con las velas cerradas de la hora simulada', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const forming = { ...all[30], in_progress: true, knownUntil: all[30].timestamp + 1200000 };
  const known = [...all.slice(0, 30), forming];
  await drawValidated(validatedRejection([fixedRange('a')]), known, all);

  assert.equal(requests.length, 1);
  const { candles, referenceContexts } = requests[0].body;
  assert.equal(candles[candles.length - 1].timestamp, all[29].timestamp, 'sin la vela en formación ni las futuras');
  assert.deepEqual(Object.keys(candles[0]).sort(), ['close', 'high', 'low', 'open', 'timestamp', 'volume']);
  assert.equal(referenceContexts[0].id, 'a');
});

test('rejection validado: incluye las velas anteriores que necesita el detector', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const known = all.slice(0, 31);
  const rejection = validatedRejection([fixedRange('a')]);
  rejection.validatedNextAt = 0;
  rejection.renderOverlay(ctx, bounds, known.slice(25), all, context(known, known[30].timestamp + HOUR));
  await flush();
  assert.equal(requests[0].body.candles[0].timestamp, all[4].timestamp, 'la vista empieza en 25 y se piden 21 antes');
});

test('rejection validado: dibuja lo que confirma el backend, en velas cerradas', async () => {
  const all = hammerCandles();
  detectorServer(() => ({ success: true, patterns: [{ timestamp: all[28].timestamp, patternType: 'HAMMER', confidence: 80 }] }));
  const rejection = validatedRejection([fixedRange('a')]);
  const known = all.slice(0, 30);
  await drawValidated(rejection, known, all);
  await drawValidated(rejection, known, all);
  assert.deepEqual([...new Set(rejection.drawn)], [all[28].timestamp]);
});

test('rejection validado: no repite mientras nada cambie y pide al cerrar una vela', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a')]);
  await drawValidated(rejection, all.slice(0, 20), all);
  await drawValidated(rejection, all.slice(0, 20), all);
  assert.equal(requests.length, 1);
  await drawValidated(rejection, all.slice(0, 21), all);
  assert.equal(requests.length, 2);
});

test('rejection validado: no pide otra vez mientras espera la respuesta', async () => {
  let answer;
  const requests = [];
  globalThis.fetch = (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise(resolve => { answer = () => resolve({ json: async () => ({ success: true, patterns: [] }) }); });
  };
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a')]);
  await drawValidated(rejection, all.slice(0, 20), all);
  await drawValidated(rejection, all.slice(0, 21), all);
  assert.equal(requests.length, 1);
  answer();
  await flush();
  await flush();
  await drawValidated(rejection, all.slice(0, 21), all);
  assert.equal(requests.length, 2, 'al llegar la respuesta pide lo que faltó');
});

test('rejection validado: envía como máximo 1,500 velas, las más recientes', async () => {
  const requests = detectorServer();
  const many = Array.from({ length: 1600 }, (_, i) => ({ timestamp: START + i * HOUR, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
  await drawValidated(validatedRejection([fixedRange('a')]), many, many);
  const { candles } = requests[0].body;
  assert.equal(candles.length, 1500);
  assert.equal(candles[candles.length - 1].timestamp, many[1599].timestamp);
});

test('rejection validado: cambiar contextos o filtros vuelve a pedir', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a')]);
  await drawValidated(rejection, all.slice(0, 20), all);
  rejection.updateConfig({ ...rejection.config, filters: { ...rejection.config.filters, minConfidence: 80 } });
  await drawValidated(rejection, all.slice(0, 20), all);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.config.filters.minConfidence, 80);
});

test('rejection validado: sin contextos activos no pide nada y limpia lo anterior', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a', { enabled: false })]);
  rejection.patterns = [{ timestamp: all[10].timestamp }];
  await drawValidated(rejection, all.slice(0, 20), all);
  assert.equal(requests.length, 0);
  assert.deepEqual(rejection.patterns, []);
});

test('rejection validado: usa los valores actuales del perfil', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a')]);
  rejection.getRangeProfile = () => ({ poc: { price: 1234 }, valueArea: { vahPrice: 1300, valPrice: 1200 } });
  await drawValidated(rejection, all.slice(0, 20), all);
  const { metadata } = requests[0].body.referenceContexts[0];
  assert.deepEqual([metadata.poc, metadata.vah, metadata.val], [1234, 1300, 1200]);
  assert.equal(metadata.endTimestamp, START + 5 * HOUR, 'la fecha del nivel no cambia');
});

test('rejection validado: una respuesta vieja no reemplaza a una nueva', async () => {
  const pending = [];
  globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a')]);
  rejection.renderOverlay(ctx, bounds, all.slice(0, 20), all, context(all.slice(0, 20), all[19].timestamp + HOUR));
  rejection.validatedRequest += 1; // Otra petición salió después
  pending[0]({ json: async () => ({ success: true, patterns: [{ timestamp: 1 }] }) });
  await flush();
  await flush();
  assert.deepEqual(rejection.patterns, []);
});

test('rejection validado: tras un error espera y vuelve a intentar', async () => {
  const all = hammerCandles();
  const requests = detectorServer((body, count) => (count === 1 ? new Error('caido') : { success: true, patterns: [] }));
  const rejection = validatedRejection([fixedRange('a')]);
  await drawValidated(rejection, all.slice(0, 20), all);
  assert.ok(rejection.validatedNextAt > performance.now() + 1000, 'espera antes de reintentar');
  rejection.renderOverlay(ctx, bounds, all.slice(0, 20), all, context(all.slice(0, 20), all[19].timestamp + HOUR));
  assert.equal(requests.length, 1);
  clearTimeout(rejection.validatedTimer);
  rejection.validatedTimer = null;
  await drawValidated(rejection, all.slice(0, 20), all);
  assert.equal(requests.length, 2);
});

test('rejection: en backtesting nunca pide velas recientes', async () => {
  const requests = detectorServer();
  const rejection = validatedRejection([fixedRange('a')]);
  await rejection.fetchData();
  rejection.updateConfig(rejection.config);
  await flush();
  assert.equal(requests.length, 0);
});

test('rejection: el modo que muestra todos no llama al backend', async () => {
  const requests = detectorServer();
  const all = hammerCandles();
  const rejection = validatedRejection([fixedRange('a')]);
  rejection.setShowMode('all');
  await drawValidated(rejection, all.slice(0, 31), all);
  assert.equal(requests.length, 0);
});

// ==================== ACTIVACIÓN ====================

async function newManager() {
  detectorServer(() => ({ success: true, data: [], patterns: [] }));
  const manager = new IndicatorManager('BTCUSDT', '1h', 30);
  await manager.initialize(true, START);
  const dtb = manager.indicators.find(indicator => indicator.name === 'Double Top/Bottom');
  dtb.calls = [];
  dtb.precalculateWithCandles = async (candles) => { dtb.calls.push(candles); };
  return { manager, dtb };
}

test('doble techo: calcula al marcar su casilla, con las velas del gráfico', async () => {
  const { manager, dtb } = await newManager();
  const candles = swingCandles(HOUR);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': false }, true, candles);
  assert.equal(dtb.calls.length, 0);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': true }, true, candles);
  assert.deepEqual(dtb.calls, [candles]);
});

test('doble techo: desmarcar y volver a marcar no necesita más datos', async () => {
  const { manager, dtb } = await newManager();
  const candles = swingCandles(HOUR);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': false }, true, candles);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': true }, true);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': false }, true);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': true }, true);
  assert.equal(dtb.calls.length, 2, 'conserva las velas recibidas');
});

test('doble techo: una sesión que lo trae activo también calcula, una sola vez', async () => {
  const { manager, dtb } = await newManager();
  const candles = swingCandles(HOUR);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': true }, true, candles);
  assert.deepEqual(dtb.calls, [candles]);
  dtb.candlesSentToBackend = true;
  await manager.updateIndicatorStates({ 'Double Top/Bottom': true }, true, candles);
  assert.equal(dtb.calls.length, 1, 'cambiar otro indicador no recalcula');
});

test('doble techo: sin velas no hace nada hasta recibirlas', async () => {
  const { manager, dtb } = await newManager();
  await manager.updateIndicatorStates({ 'Double Top/Bottom': false }, true);
  await manager.updateIndicatorStates({ 'Double Top/Bottom': true }, true);
  assert.equal(dtb.calls.length, 0);
});

test('doble techo: si el backend perdió las velas las envía otra vez', async () => {
  const candles = swingCandles(HOUR);
  const sent = [];
  globalThis.fetch = (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('/chunk')) return Promise.resolve({ ok: true, json: async () => ({ success: true, patterns: [doubleTop()] }) });
    sent.push(body);
    const answer = body.candles ? { success: true, cached: true, chunks: ['2026-Q2'] } : { success: false, needsCandles: true };
    return Promise.resolve({ json: async () => answer });
  };
  const indicator = new DoubleTop('BTCUSDT', '1h', 30, { backtestingMode: true });
  indicator.candlesSentToBackend = true;
  await indicator.precalculateWithCandles(candles);
  assert.deepEqual(sent.map(body => !!body.candles), [false, true]);
  assert.equal(sent[0].backtesting, true);
  assert.equal(indicator.patterns.length, 1);
  assert.equal(indicator.loading, false);
});

test('doble techo: avisa mientras calcula', async () => {
  const dtb = new DoubleTop('BTCUSDT', '1h', 30, { backtestingMode: true });
  dtb.enabled = true;
  dtb.loading = true;
  const texts = [];
  const canvas = new Proxy({ fillText: (text) => texts.push(text) }, {
    get: (target, name) => (name in target ? target[name] : () => ({ width: 10 })),
    set: (target, name, value) => { target[name] = value; return true; }
  });
  const known = [{ timestamp: START, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  dtb.renderOverlay(canvas, bounds, known, known, context(known, START));
  assert.ok(texts.some(text => text.includes('calculando')));
});

test('doble techo: redibuja al empezar, para que se vea el aviso', async () => {
  globalThis.fetch = () => Promise.resolve({ ok: true, json: async () => ({ success: true, patterns: [] }) });
  const dtb = new DoubleTop('BTCUSDT', '1h', 30, { backtestingMode: true });
  const loadingAtRedraw = [];
  dtb.requestRedraw = () => loadingAtRedraw.push(dtb.loading);
  await dtb.precalculateWithCandles(swingCandles(HOUR));
  assert.deepEqual(loadingAtRedraw, [true]);
});

test('gestor: el modo validado conoce los perfiles fijos y el modo backtesting', async () => {
  const { manager } = await newManager();
  const rejection = manager.getRejectionPatternIndicator();
  assert.equal(rejection.backtestingMode, true);
  manager.fixedRangeIndicators = [{ rangeId: 'a', profile: { poc: { price: 1 } } }];
  assert.equal(rejection.getRangeProfile('a').poc.price, 1);
  assert.equal(rejection.getRangeProfile('otro'), undefined);
});

test('gestor: un rango automático que termina después de la hora simulada no se dibuja', async () => {
  const { manager } = await newManager();
  const drawn = [];
  const range = (id, end, isAutoDetected) => {
    manager.fixedRangeProfiles.push({ rangeId: id, symbol: 'BTCUSDT', interval: '1h', endTimestamp: end, isAutoDetected });
    return { rangeId: id, symbol: 'BTCUSDT', enabled: true, renderOverlay: () => drawn.push(id) };
  };
  const now = START + 10 * HOUR;
  manager.fixedRangeIndicators = [range('pasado', now - HOUR, true), range('futuro', now + HOUR, true), range('manual', now + HOUR, false)];
  const known = [{ timestamp: START }];
  manager.renderFixedRangeProfiles(ctx, bounds, known, known, context(known, now));
  assert.deepEqual(drawn, ['pasado', 'manual']);
});

// ==================== DOUBLE TOP/BOTTOM ====================

function doubleTop(extra = {}) {
  return {
    type: 'DOUBLE_TOP', timestamp: START, levelPrice: 1000, confidence: 80,
    firstExtreme: { timestamp: START, price: 1000, rejection_pattern: 'HAMMER' },
    secondExtreme: { timestamp: START + 10 * HOUR, price: 1000, rejection_pattern: 'HAMMER' },
    knownAt: START + 16 * HOUR, replacedAt: null, entrySignal: null, ...extra
  };
}

function drawnDoubleTops(patterns, now) {
  const indicator = new DoubleTop('BTCUSDT', '1h', 30, { backtestingMode: true });
  indicator.enabled = true;
  indicator.patterns = patterns;
  const lines = [];
  const arrows = [];
  indicator._drawLevelLine = (_, pattern) => lines.push(pattern);
  indicator._drawRejectionIcons = () => {};
  indicator._drawMomentumIcon = () => {};
  indicator._drawEntryArrow = (_, pattern) => arrows.push(pattern);
  indicator.config.visualization.showEntryArrows = true;
  indicator.config.visualization.showMomentumIcons = true;
  indicator.updatePlaybackDate(START + 500 * HOUR); // Una hora vieja no debe mandar
  const known = [{ timestamp: START, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  indicator.renderOverlay(ctx, bounds, known, known, context(known, now));
  return { lines: lines.length, arrows: arrows.length };
}

test('doble techo: aparece al cerrar la última vela que lo confirma', () => {
  assert.equal(drawnDoubleTops([doubleTop()], START + 16 * HOUR - 60000).lines, 0);
  assert.equal(drawnDoubleTops([doubleTop()], START + 16 * HOUR).lines, 1);
});

test('doble techo: al abrir el segundo extremo todavía no existe', () => {
  assert.equal(drawnDoubleTops([doubleTop()], START + 10 * HOUR).lines, 0);
});

test('doble techo: un patrón reemplazado se ve solo hasta el reemplazo', () => {
  const replaced = doubleTop({ replacedAt: START + 20 * HOUR });
  assert.equal(drawnDoubleTops([replaced], START + 19 * HOUR).lines, 1);
  assert.equal(drawnDoubleTops([replaced], START + 20 * HOUR).lines, 0);
});

test('doble techo: la flecha de entrada espera a que cierre su vela', () => {
  const entrySignal = { has_momentum: true, known_at: START + 18 * HOUR, entry_candle_timestamp: START + 17 * HOUR };
  const pattern = doubleTop({ entrySignal });
  assert.deepEqual(drawnDoubleTops([pattern], START + 17 * HOUR), { lines: 1, arrows: 0 });
  assert.deepEqual(drawnDoubleTops([pattern], START + 18 * HOUR), { lines: 1, arrows: 1 });
});

// ==================== VELAS REALES ====================

const file = process.argv[2];
if (file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const timeframes = Object.fromEntries(Object.entries(data).map(([tf, main]) => [tf, { main }]));
  let seed = 2026;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const randomTime = (tf) => {
    const candles = data[tf];
    const first = candles[300].timestamp;
    const span = candles[candles.length - 30].timestamp - first;
    return Math.floor((first + random() * span) / 300000) * 300000;
  };

  for (const tf of ['15m', '1h', '4h']) {
    test(`velas reales ${tf}: swing igual con y sin el futuro`, () => {
      const candles = data[tf];
      const swing = new Swing('BTCUSDT', tf, 30, {});
      swing.enabled = true;
      let compared = 0;
      for (let i = 0; i < 250; i++) {
        const now = randomTime(tf);
        const known = candles.slice(0, lastClosedIndex(candles, tf, now) + 1);
        swing.renderOverlay(ctx, bounds, known, candles, context(known, now));
        const truth = new Swing('BTCUSDT', tf, 30, {}).detectSwings(known);
        const keys = list => list.map(signal => `${signal.timestamp}${signal.type}`).sort();
        assert.deepEqual(keys(swing.signals), keys(truth));
        compared += truth.length;
      }
      assert.ok(compared > 1000);
    });

    test(`velas reales ${tf}: VWAP y bandas iguales con y sin el futuro`, () => {
      const candles = data[tf];
      const config = { vwapType: 'session', showBands: true };
      const vwap = new VWAP('BTCUSDT', tf, 7, { backtestingMode: true, ...config });
      vwap.enabled = true;
      const end = Math.min(3000, candles.length - 30);
      const window = candles.slice(0, end);
      let compared = 0;
      for (let i = 0; i < 40; i++) {
        const start = window[400 + Math.floor(random() * (end - 500))].timestamp;
        const now = start + 300000 * (1 + Math.floor(random() * (TF_MS[tf] / 300000 - 1)));
        const forming = formingCandle(timeframes, tf, now);
        if (!forming) continue;
        const known = [...window.slice(0, lastClosedIndex(window, tf, now) + 1), forming];
        vwap.renderOverlay(ctx, bounds, known, window, context(known, forming.knownUntil));
        const honest = new VWAP('BTCUSDT', tf, 7, { backtestingMode: true, ...config });
        honest._recalculateVWAP(known);
        const point = honest.dataMap.get(forming.timestamp);
        const drawn = vwap._pointFor(forming);
        closeTo(drawn.vwap, point.vwap, 'vwap');
        for (const name of Object.keys(point.bands)) closeTo(drawn.bands[name], point.bands[name], name);
        compared += 1;
      }
      assert.ok(compared >= 20);
    });

    test(`velas reales ${tf}: rejection no marca la vela en formación`, () => {
      const candles = data[tf];
      let marked = 0;
      let formingSeen = 0;
      for (let i = 0; i < 400; i++) {
        const now = randomTime(tf);
        const forming = formingCandle(timeframes, tf, now);
        if (!forming) continue;
        const known = [...candles.slice(Math.max(0, lastClosedIndex(candles, tf, now) - 40), lastClosedIndex(candles, tf, now) + 1), forming];
        formingSeen += 1;
        marked += drawnPatterns(known, candles).filter(mark => mark.timestamp === forming.timestamp).length;
      }
      assert.ok(formingSeen > 200);
      assert.equal(marked, 0);
    });
  }
}

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    say(`ok ${name}`);
  } catch (error) {
    failed += 1;
    say(`FALLA ${name}: ${error.message}`);
  }
}
say(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
