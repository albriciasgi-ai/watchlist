// Pruebas del indicador "Rangos horizontales": que sus cajas sean las de los detectores, que lo conocido no cambie con
// velas posteriores, que la vela en formación no cuente, que en vivo (arreglo corrido) dé lo mismo y que el modal acote.
// Uso: node tests/horizontalranges.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);
const say = (...args) => process.stdout.write(`${args.join(' ')}\n`);
console.log = () => {};
console.warn = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const {
  default: HorizontalRangesIndicator, METHODS, computeRanges, cleanHorizontalRangesSettings, defaultHorizontalRangesConfig, intervalMinutes,
  profileTargets
} = await import('../src/components/indicators/HorizontalRangesIndicator.js');
const { runDetector, toArrays } = await import('../src/components/indicators/regimeDetectors.js');
const { RangeProfiles, rangeSpan } = await import('../src/components/indicators/rangeProfiles.js');
const { buildProfile } = await import('../src/components/indicators/sessionProfile.js');

const tests = [];
const test = (name, run) => tests.push([name, run]);

// Velas reales de BTC 4h del caché de App 1; sin él, un camino al azar reproducible
function loadCandles() {
  const file = new URL('../../backend/backtesting_cache/BTCUSDT_backtesting_data.json.gz', import.meta.url);
  if (existsSync(file)) {
    const raw = JSON.parse(gunzipSync(readFileSync(file)));
    const main = (raw.timeframes || raw)['4h']?.main;
    if (main?.length > 1500) return main.slice(-1500).map(c => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  }
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  let price = 100;
  for (let i = 0; i < 1500; i += 1) {
    const open = price;
    price *= 1 + (rnd() - 0.5) * 0.02 * (i % 300 < 150 ? 0.3 : 1.5);
    out.push({ timestamp: 1700000000000 + i * 14400000, open, high: Math.max(open, price) * (1 + rnd() * 0.004), low: Math.min(open, price) * (1 - rnd() * 0.004), close: price, volume: 100 + rnd() * 900 });
  }
  return out;
}
const CANDLES = loadCandles();
const STEP = 240 * 60000;
const cfg = (method, extra = {}) => ({ ...defaultHorizontalRangesConfig(), method, ...extra });
const same = (a, b) => a.start === b.start && a.known === b.known && a.end === b.end && a.low === b.low && a.high === b.high;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Ninguna prueba llega al backend: el perfil real pide aquí, y cada prueba que lo usa pone su respuesta
globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, buy: [], sell: [], minutes: 0, expected_minutes: 0 }) });

test('las cajas son las del detector, en horas: empieza al abrir su primera vela y se supo al cerrar la de detección', () => {
  for (const method of METHODS) {
    const { zones } = computeRanges(CANDLES, cfg(method), 240);
    const bars = toArrays(CANDLES);
    const direct = runDetector(method, bars, 240, defaultHorizontalRangesConfig().params[method]).zones;
    assert.equal(zones.length, direct.length, method);
    zones.forEach((z, k) => {
      const d = direct[k];
      assert.equal(z.start, CANDLES[d.start].timestamp, `${method} start`);
      assert.equal(z.known, CANDLES[d.detected].timestamp + STEP, `${method} known`);
      assert.equal(z.end, CANDLES[d.end].timestamp + STEP, `${method} end`);
      assert.equal(z.low, d.low);
      assert.equal(z.high, d.high);
      assert.ok(z.known > z.start && z.end >= z.known, `${method}: se supo después de empezar y antes de terminar`);
    });
  }
});

// atr_range queda fuera a propósito: repinta (un cierre fuera que no alcanza a terminar el rango pasa a contar como rango
// si el precio vuelve), como su original en Python. El indicador lo calcula siempre con lo conocido, así que no ve el futuro
test('lo conocido en una hora no cambia al sumar velas posteriores (todos menos atr_range), también el rango mayor', () => {
  for (const method of METHODS.filter(m => m !== 'atr_range')) {
    for (const cut of [900, 1100, 1300]) {
      const early = computeRanges(CANDLES.slice(0, cut), cfg(method, { major: true }), 240);
      const late = computeRanges(CANDLES, cfg(method, { major: true }), 240);
      for (const [kind, a, b] of [['caja', early.zones, late.zones], ['mayor', early.majors, late.majors]]) {
        for (const z of a.filter(z => !z.live)) {
          assert.ok(b.some(w => same(w, z)), `${method} ${kind} terminada antes de la vela ${cut} cambió con velas posteriores`);
        }
        for (const z of a.filter(z => z.live)) {
          assert.ok(b.some(w => w.start === z.start && w.known === z.known), `${method} ${kind} viva en ${cut} desapareció`);
        }
      }
    }
  }
});

test('la vela en formación no crea, cierra ni mueve rangos', () => {
  const indicator = new HorizontalRangesIndicator('BTCUSDT', '4h');
  indicator.updateConfig({ method: 'er_box', major: true });
  const visible = CANDLES.slice(-300);
  const closed = indicator._rangesFor(visible, CANDLES);
  indicator.cacheKey = null;
  const last = CANDLES[CANDLES.length - 1];
  const forming = { timestamp: last.timestamp + STEP, open: last.close, high: last.close * 1.3, low: last.close * 0.7, close: last.close * 1.25, volume: 1e9, in_progress: true };
  const withForming = indicator._rangesFor([...visible, forming], [...CANDLES, forming]);
  assert.deepEqual(withForming, closed);
});

test('en vivo, con el arreglo corrido por delante, las cajas de lo que quedó son las mismas (er y ttm, que miran solo su ventana)', () => {
  for (const method of ['er', 'ttm']) {
    const full = computeRanges(CANDLES.slice(200), cfg(method), 240).zones;
    const shifted = computeRanges(CANDLES.slice(300), cfg(method), 240).zones;
    const after = CANDLES[300 + 60].timestamp; // Lejos del arranque del arreglo corto
    for (const z of shifted.filter(z => z.start >= after)) assert.ok(full.some(w => same(w, z)), `${method} cambió al correr el arreglo`);
  }
});

test('el indicador no dibuja con la vela que aún no cerró, ni ocupa panel, ni recalcula sin cambios', () => {
  const indicator = new HorizontalRangesIndicator('BTCUSDT', '4h');
  assert.equal(indicator.getHeight(), 0);
  assert.equal(indicator.enabled, false);
  const visible = CANDLES.slice(-300);
  const first = indicator._rangesFor(visible, CANDLES);
  const again = indicator._rangesFor(visible, CANDLES);
  assert.equal(first, again, 'misma ventana: el mismo resultado guardado');
  indicator.updateConfig({ method: 'ttm' });
  assert.notEqual(indicator._rangesFor(visible, CANDLES), first, 'otros ajustes: se recalcula');
});

test('el modal acota los valores, deja vacío lo que puede ir vacío y vuelve al método de fábrica si no lo conoce', () => {
  const clean = cleanHorizontalRangesSettings({
    method: 'nada', majorAtr: 900, majorOut: 2.6, opacity: 5,
    params: { er_box: { n: 1, below: 3, exit_er: '', buffer: 'x' }, adx: { below: 0 }, vp_prog: { range_atr: null, min_c: 1000 } }
  });
  assert.equal(clean.method, 'er_box');
  assert.equal(clean.majorAtr, 50);
  assert.equal(clean.majorOut, 3);
  assert.equal(clean.opacity, 0.6);
  assert.equal(clean.params.er_box.n, 2);
  assert.equal(clean.params.er_box.below, 1);
  assert.equal(clean.params.er_box.exit_er, null);
  assert.equal(clean.params.er_box.buffer, 0.5, 'texto que no es número: vuelve al afinado');
  assert.equal(clean.params.adx.below, 1);
  assert.equal(clean.params.vp_prog.range_atr, null);
  assert.equal(clean.params.vp_prog.min_c, 500);
  assert.deepEqual(Object.keys(clean.params).sort(), [...METHODS].sort());
});

test('el marco del gráfico se lee en minutos, con la M mayúscula como mes', () => {
  assert.equal(intervalMinutes('1m'), 1);
  assert.equal(intervalMinutes('15m'), 15);
  assert.equal(intervalMinutes('4h'), 240);
  assert.equal(intervalMinutes('240'), 240);
  assert.equal(intervalMinutes('1D'), 1440);
  assert.equal(intervalMinutes('D'), 1440);
  assert.equal(intervalMinutes('1W'), 10080);
  assert.equal(intervalMinutes('1M'), 43200);
});

// ---------- Perfil de volumen sobre cada rango (20/11/2026) ----------
const PROFILE = { rows: 50, valueAreaShare: 0.7, real: false };
const inRange = (zone) => CANDLES.filter(c => c.timestamp >= zone.start && c.timestamp <= zone.lastOpen);
const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const volumeOf = (candles) => candles.reduce((sum, c) => sum + c.volume, 0);

function fakeCtx() {
  const calls = { fillRect: 0, text: [] };
  return {
    calls, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {}, strokeRect() {},
    rect() {}, clip() {}, arc() {}, fill() {}, fillRect() { calls.fillRect += 1; }, fillText(text) { calls.text.push(text); },
    measureText: (text) => ({ width: text.length * 6 })
  };
}

/** Un gráfico de 1200 × 600 con esas velas a la vista y `known` como las velas conocidas */
function view(visible, known) {
  const bounds = { x: 0, y: 0, width: 1200, height: 600 };
  const barWidth = bounds.width / visible.length;
  const low = Math.min(...visible.map(c => c.low));
  const high = Math.max(...visible.map(c => c.high));
  const priceContext = {
    knownCandles: known,
    timeToX: (t) => bounds.x + ((t - visible[0].timestamp) / STEP) * barWidth + barWidth / 2,
    priceToY: (p) => bounds.y + bounds.height - ((p - low) / (high - low)) * bounds.height,
    requestRedraw: () => {}
  };
  return { bounds, priceContext };
}

test('el perfil de un rango es el de sus velas, de la primera a la última, con todo su volumen', () => {
  const profiles = new RangeProfiles('BTCUSDT');
  let checked = 0;
  for (const method of ['er_box', 'ttm', 'vp_prog']) {
    const { zones, majors } = computeRanges(CANDLES, cfg(method, { major: true }), 240);
    for (const zone of [...zones.slice(0, 25), ...majors.slice(0, 10)]) {
      const own = inRange(zone);
      assert.equal(zone.end, zone.lastOpen + STEP, `${method}: el fin es el cierre de su última vela`);
      assert.equal(own[0].timestamp, zone.start);
      assert.equal(own[own.length - 1].timestamp, zone.lastOpen);
      const [from, to] = rangeSpan(CANDLES, zone);
      assert.equal(CANDLES[from].timestamp, zone.start);
      assert.equal(CANDLES[to - 1].timestamp, zone.lastOpen);
      const profile = profiles.get(zone, CANDLES, PROFILE);
      const expected = buildProfile(own, 50, 0.7);
      if (!expected) {
        assert.equal(profile, null);
        continue;
      }
      assert.equal(profile.poc.price, expected.poc.price, `${method}: POC`);
      assert.equal(profile.valueArea.vahPrice, expected.valueArea.vahPrice);
      assert.equal(profile.valueArea.valPrice, expected.valueArea.valPrice);
      assert.equal(profile.minPrice, Math.min(...own.map(c => c.low)), 'del mínimo de sus velas');
      assert.equal(profile.maxPrice, Math.max(...own.map(c => c.high)), 'al máximo de sus velas');
      assert.ok(near(profile.totalVolume, volumeOf(own)), `${method}: todo el volumen de sus velas, ni más ni menos`);
      assert.equal(profile.isReal, false);
      checked += 1;
    }
  }
  assert.ok(checked >= 40, `rangos comparados: ${checked}`);
});

test('el perfil de un rango vivo crece con cada vela que cierra y no usa las velas posteriores', () => {
  let checked = 0;
  for (let cut = 400; cut < CANDLES.length - 1 && checked < 12; cut += 1) {
    const now = computeRanges(CANDLES.slice(0, cut), cfg('er_box'), 240).zones.find(z => z.live);
    if (!now) continue;
    const next = computeRanges(CANDLES.slice(0, cut + 1), cfg('er_box'), 240).zones.find(z => z.live && z.start === now.start);
    if (!next) continue;
    const before = new RangeProfiles('BTCUSDT').get(now, CANDLES, PROFILE); // Con todas las velas a mano
    const alone = new RangeProfiles('BTCUSDT').get(now, CANDLES.slice(0, cut), PROFILE); // Solo con lo conocido entonces
    assert.deepEqual(before, alone, 'lo posterior a su última vela no cuenta');
    const after = new RangeProfiles('BTCUSDT').get(next, CANDLES, PROFILE);
    assert.equal(next.lastOpen, now.lastOpen + STEP, 'el rango sumó la vela que cerró');
    assert.ok(near(after.totalVolume, before.totalVolume + CANDLES[cut].volume), 'y el perfil, su volumen');
    checked += 1;
    cut += 20;
  }
  assert.ok(checked >= 5, `rangos vivos que siguen en la vela siguiente: ${checked}`);
});

test('la vela en formación no entra al perfil', () => {
  const last = CANDLES[CANDLES.length - 1];
  const forming = { timestamp: last.timestamp + STEP, open: last.close, high: last.close * 1.3, low: last.close * 0.7, close: last.close * 1.2, volume: 1e12, in_progress: true };
  const zone = computeRanges(CANDLES, cfg('er_box'), 240).zones.at(-1);
  assert.deepEqual(new RangeProfiles('BTCUSDT').get(zone, [...CANDLES, forming], PROFILE), new RangeProfiles('BTCUSDT').get(zone, CANDLES, PROFILE));
});

test('el volumen real se pide hasta el cierre del rango, con su misma rejilla, y se usa solo si el almacén lo cubre', async () => {
  const zones = computeRanges(CANDLES, cfg('er_box'), 240).zones.filter(z => !z.live);
  const urls = [];
  const answer = (minutes) => async (url) => {
    const query = new URL(url).searchParams;
    urls.push(query);
    const rows = Number(query.get('rows'));
    return { ok: true, json: async () => ({ success: true, buy: Array.from({ length: rows }, (_, i) => i + 1), sell: Array(rows).fill(1), minutes, expected_minutes: 100 }) };
  };
  globalThis.fetch = answer(100);
  let redraws = 0;
  const profiles = new RangeProfiles('BTCUSDT', { settleMs: 0, gapMs: 0 });
  const zone = zones[0];
  const first = profiles.get(zone, CANDLES, { rows: 50, valueAreaShare: 0.7, requestRedraw: () => { redraws += 1; } });
  assert.equal(first.isReal, false, 'mientras no llega, el estimado');
  await wait(40);
  assert.equal(urls.length, 1);
  assert.equal(Number(urls[0].get('start_timestamp')), zone.start);
  assert.equal(Number(urls[0].get('end_timestamp')), zone.end);
  assert.equal(Number(urls[0].get('known_until')), zone.end, 'nada posterior al cierre de su última vela');
  assert.equal(Number(urls[0].get('low')), first.minPrice);
  assert.equal(Number(urls[0].get('high')), first.maxPrice);
  assert.equal(Number(urls[0].get('rows')), 50);
  assert.equal(redraws, 1, 'al llegar, se vuelve a dibujar');
  const real = profiles.get(zone, CANDLES, { rows: 50, valueAreaShare: 0.7 });
  assert.equal(real.isReal, true);
  assert.equal(real.levels[49].volume, 51, 'compra más venta de la franja');
  assert.equal(real.poc.index, 49);
  await wait(20);
  assert.equal(urls.length, 1, 'no se pide dos veces');

  // Con menos del 99% de los minutos en el almacén queda el estimado, y no se vuelve a pedir
  globalThis.fetch = answer(98);
  const partial = new RangeProfiles('BTCUSDT', { settleMs: 0, gapMs: 0 });
  partial.get(zones[1], CANDLES, { rows: 50, valueAreaShare: 0.7 });
  await wait(40);
  assert.equal(partial.get(zones[1], CANDLES, { rows: 50, valueAreaShare: 0.7 }).isReal, false);
  await wait(20);
  assert.equal(urls.length, 2);
});

test('de un rango vivo se pide solo su fin más reciente, cuando deja de cambiar, y nada tras destruirlo', async () => {
  let cut0 = null;
  let ends = [];
  for (let cut = 400; cut < CANDLES.length - 6 && cut0 === null; cut += 1) {
    const first = computeRanges(CANDLES.slice(0, cut), cfg('er_box'), 240).zones.find(z => z.live);
    if (!first) continue;
    ends = [0, 1, 2, 3, 4, 5].map(k => computeRanges(CANDLES.slice(0, cut + k), cfg('er_box'), 240).zones.find(z => z.live && z.start === first.start));
    if (ends.every(Boolean)) cut0 = cut;
  }
  assert.ok(cut0 !== null, 'un rango que sigue vivo 6 velas');
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(new URL(url).searchParams);
    return { ok: true, json: async () => ({ success: true, buy: Array(50).fill(1), sell: Array(50).fill(1), minutes: 10, expected_minutes: 10 }) };
  };
  const profiles = new RangeProfiles('BTCUSDT', { settleMs: 150, gapMs: 0 });
  for (const zone of ends) profiles.get(zone, CANDLES, { rows: 50, valueAreaShare: 0.7 }); // Cambia de fin antes de quedarse quieto
  await wait(400);
  assert.equal(urls.length, 1, 'un solo pedido');
  assert.equal(Number(urls[0].get('end_timestamp')), ends.at(-1).end, 'el de su último fin');

  const gone = new RangeProfiles('BTCUSDT', { settleMs: 0, gapMs: 0 });
  gone.get(ends[0], CANDLES, { rows: 40, valueAreaShare: 0.7 });
  gone.dispose();
  await wait(40);
  assert.equal(urls.length, 1, 'destruido el indicador, no pide');
});

test('el perfil va sobre el rango mayor o sobre las cajas, y solo si se dibujan', () => {
  const zones = [{ start: 1 }];
  const majors = [{ start: 2 }];
  const base = { ...defaultHorizontalRangesConfig(), profile: true };
  assert.deepEqual(profileTargets({ ...base, profile: false }, zones, majors), [], 'apagado');
  assert.deepEqual(profileTargets(base, zones, majors).map(t => [t.zone.start, t.isMajor]), [[1, false]], 'sin rango mayor, sobre las cajas');
  assert.deepEqual(profileTargets({ ...base, major: true }, zones, majors).map(t => [t.zone.start, t.isMajor]), [[2, true]], 'con él, sobre el rango mayor');
  assert.deepEqual(profileTargets({ ...base, major: true, profileOn: 'boxes' }, zones, majors).map(t => t.zone.start), [1]);
  assert.deepEqual(profileTargets({ ...base, showBoxes: false }, zones, majors), [], 'cajas ocultas: ningún perfil');
});

test('en el gráfico: un perfil por rango a la vista, sin la vela en formación, y su POC, VAH y VAL para el análisis', () => {
  const visible = CANDLES.slice(-300);
  const render = (known, extra = {}) => {
    const indicator = new HorizontalRangesIndicator('BTCUSDT', '4h');
    indicator.enabled = true;
    indicator.updateConfig({ method: 'er_box', profile: true, ...extra });
    const { bounds, priceContext } = view(visible, known);
    const ctx = fakeCtx();
    indicator.renderOverlay(ctx, bounds, visible, known, priceContext);
    indicator.dispose();
    return { indicator, ctx };
  };
  const plain = render(CANDLES);
  const shown = plain.indicator.shownProfiles;
  assert.ok(shown.length >= 2, `perfiles a la vista: ${shown.length}`);
  for (const { zone, profile, isMajor } of shown) {
    assert.equal(isMajor, false);
    assert.equal(profile.poc.price, buildProfile(inRange(zone), 50, 0.7).poc.price);
  }
  const levels = plain.indicator.selectableLevels().filter(l => l.kind.startsWith('Perfil del rango'));
  assert.equal(levels.length, shown.length * 3, 'POC, VAH y VAL de cada uno');
  assert.ok(levels.every(l => Number.isFinite(l.price) && l.end > l.start && l.time === l.end), 'se saben al cierre de su última vela');
  assert.ok(plain.ctx.calls.text.some(text => text.startsWith('POC ')), 'la etiqueta del POC');

  const last = CANDLES[CANDLES.length - 1];
  const forming = { timestamp: last.timestamp + STEP, open: last.close, high: last.close * 1.3, low: last.close * 0.7, close: last.close * 1.2, volume: 1e12, in_progress: true };
  const withForming = render([...CANDLES, forming]);
  const summary = (list) => list.map(({ zone, profile }) => [zone.start, zone.end, profile.poc.price, profile.totalVolume]);
  assert.deepEqual(summary(withForming.indicator.shownProfiles), summary(shown), 'la vela en formación no cambia ningún perfil');

  const off = render(CANDLES, { profile: false });
  assert.equal(off.indicator.shownProfiles.length, 0);
  assert.ok(off.ctx.calls.fillRect < plain.ctx.calls.fillRect, 'sin la opción no se dibujan barras');
  const major = render(CANDLES, { major: true, majorOut: 6 });
  assert.ok(major.indicator.shownProfiles.length >= 1, 'hay rango mayor a la vista');
  assert.ok(major.indicator.shownProfiles.every(p => p.isMajor), 'con el rango mayor, sobre él');
});

test('el modal acota las opciones del perfil', () => {
  const defaults = defaultHorizontalRangesConfig();
  assert.equal(defaults.profile, false, 'apagado de fábrica: el indicador se ve como antes');
  const clean = cleanHorizontalRangesSettings({
    profile: 1, profileOn: 'otro', profileRows: 5000, profileVa: 5, profileWidth: 0, profilePoc: 0, profileVaLines: true, profileLabel: ''
  });
  assert.equal(clean.profile, true);
  assert.equal(clean.profileOn, 'major');
  assert.equal(clean.profileRows, 400);
  assert.equal(clean.profileVa, 20);
  assert.equal(clean.profileWidth, 5);
  assert.equal(clean.profilePoc, false);
  assert.equal(clean.profileVaLines, true);
  assert.equal(clean.profileLabel, false);
  const kept = cleanHorizontalRangesSettings({ ...defaults, profileOn: 'boxes', profileRows: '80.4', profileVa: 'x' });
  assert.equal(kept.profileOn, 'boxes');
  assert.equal(kept.profileRows, 80);
  assert.equal(kept.profileVa, 70, 'texto que no es número: el de fábrica');
});

test('está en el administrador de indicadores, apagado, sobre las velas y no en el primer lugar', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, data: [], patterns: [] }) });
  const { default: IndicatorManager } = await import('../src/components/indicators/IndicatorManager.js');
  const manager = new IndicatorManager('BTCUSDT', '4h', 30);
  await manager.initialize(true, CANDLES[0].timestamp);
  const indicator = manager.getHorizontalRangesIndicator();
  assert.ok(indicator instanceof HorizontalRangesIndicator);
  assert.equal(indicator.name, 'Rangos horizontales');
  assert.ok(manager.indicators.indexOf(indicator) > 0);
  assert.equal(indicator.getHeight(), 0);
  manager.destroy?.();
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    say(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    say(`MAL ${name}\n    ${error.message}`);
  }
}
say(`\n${tests.length - failed} de ${tests.length} pasaron (${CANDLES.length} velas)`);
process.exit(failed ? 1 : 0);
