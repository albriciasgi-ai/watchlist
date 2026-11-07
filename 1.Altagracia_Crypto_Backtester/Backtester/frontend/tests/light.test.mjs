// Atajos de rendimiento: cada uno debe dar lo mismo que el cálculo largo que reemplaza.
// También las bandas de VWAP contra backend/vwap_calculator.py: corre el Python del backend
// (BACKEND_PYTHON, backend/.venv o python del sistema, con numpy).
// Uso: node tests/light.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./resolver.mjs', import.meta.url);

const log = console.log;
console.log = () => {};
console.warn = () => {};
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { syncKnownCandles } = await import('../src/components/backtesting/replayClock.js');
const { default: VWAP, volatilityDefaults } = await import('../src/components/indicators/VWAPIndicator.js');
const { default: Swing } = await import('../src/components/indicators/SwingDetectorIndicator.js');
const { default: SupportResistance } = await import('../src/components/indicators/SupportResistanceIndicator.js');
const { default: DoubleTopBottom } = await import('../src/components/indicators/DoubleTopBottomIndicator.js');
const { default: VerticalLine } = await import('../src/components/drawing/shapes/VerticalLine.js');
const { default: Rectangle } = await import('../src/components/drawing/shapes/Rectangle.js');
const { setBlindAnchor } = await import('../src/components/backtesting/blindClock.js');

const HOUR = 3600000;
const tests = [];
const test = (name, run) => tests.push([name, run]);

let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function market(count, step = 900000, start = Date.UTC(2026, 0, 1, 3)) {
  let price = 90000;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    price += (random() - 0.5) * 200;
    return {
      timestamp: start + i * step,
      open,
      high: Math.max(open, price) + random() * 40,
      low: Math.min(open, price) - random() * 40,
      close: price,
      volume: 50 + random() * 400
    };
  });
}

// ---- Velas conocidas

const closedOnly = (all, lastIndex, forming) => [...all.slice(0, lastIndex + 1), ...(forming ? [forming] : [])];

test('velas: avanzar y retroceder da lo mismo que cortar el historial', () => {
  const all = market(300);
  const known = [];
  for (let i = 0; i < 2000; i++) {
    const lastIndex = Math.floor(random() * 301) - 1;
    const forming = random() < 0.5 ? { timestamp: 1, close: i, in_progress: true } : null;
    syncKnownCandles(known, all, lastIndex, forming);
    assert.deepEqual(known, closedOnly(all, lastIndex, forming));
  }
});

test('velas: la vela en formación se reemplaza y no se acumula', () => {
  const all = market(5);
  const known = [];
  syncKnownCandles(known, all, 2, { in_progress: true, close: 1 });
  syncKnownCandles(known, all, 2, { in_progress: true, close: 2 });
  assert.equal(known.length, 4);
  assert.equal(known[3].close, 2);
});

test('velas: al cerrar, la vela real reemplaza a la de formación', () => {
  const all = market(5);
  const known = [];
  syncKnownCandles(known, all, 2, { in_progress: true });
  syncKnownCandles(known, all, 3, null);
  assert.equal(known[3], all[3]);
});

test('velas: al cerrar una vela solo agrega lo nuevo', () => {
  class Counted extends Array {
    pushed = 0;
    push(...items) {
      this.pushed += items.length;
      return super.push(...items);
    }
  }
  const all = market(100);
  const known = new Counted();
  syncKnownCandles(known, all, 89, { in_progress: true });
  known.pushed = 0;
  syncKnownCandles(known, all, 90, { in_progress: true });
  assert.equal(known.pushed, 2);
});

test('velas: mantiene el mismo arreglo', () => {
  const all = market(5);
  const known = [];
  assert.equal(syncKnownCandles(known, all, 2, null), known);
});

test('velas: si el arreglo venía de otra fuente lo arma de nuevo', () => {
  const all = market(5);
  const known = market(3);
  syncKnownCandles(known, all, 3, null);
  assert.deepEqual(known, all.slice(0, 4));
});

test('velas: sin velas cerradas solo queda la de formación', () => {
  const all = market(5);
  const forming = { in_progress: true };
  assert.deepEqual(syncKnownCandles(market(2), all, -1, forming), [forming]);
  assert.deepEqual(syncKnownCandles([], all, -1, null), []);
});

// ---- VWAP

const sameBands = (a, b) => Object.keys(a).every(key => Math.abs(a[key] - b[key]) < 1e-5);
const typical = (candle) => (candle.high + candle.low + candle.close) / 3;

function bandsMatch(config, candles) {
  const indicator = new VWAP('X', '15m', 30, config);
  const data = candles.map((candle, i) => ({ timestamp: candle.timestamp, vwap: candle.close + (i % 7) - 3 }));
  indicator._calculateStdBands(candles, data);
  candles.forEach((_, i) => {
    assert.ok(sameBands(data[i].bands, indicator._bandsAt(candles, i, data[i].vwap)), `vela ${i}`);
  });
}

// Referencia de sesión hecha aparte con la regla de backend/vwap_calculator.py: la sesión empieza en la
// primera vela y vuelve a empezar en la primera vela de la hora de reinicio con 23 horas o más desde su
// inicio. VWAP y bandas suman directo desde la primera vela de la sesión
function sessionReference(candles, resetHour) {
  const multipliers = [1, 2, 3].map(multiplier => multiplier * 1.15);
  let start = 0;
  return candles.map((candle, i) => {
    if (i > 0 && new Date(candle.timestamp).getUTCHours() === resetHour && candle.timestamp - candles[start].timestamp >= 23 * HOUR) start = i;
    const window = candles.slice(start, i + 1);
    const volume = window.reduce((sum, item) => sum + item.volume, 0);
    const vwap = volume > 0 ? window.reduce((sum, item) => sum + typical(item) * item.volume, 0) / volume : typical(candle);
    const variance = window.reduce((sum, item) => sum + (typical(item) - vwap) ** 2 * item.volume, 0) / volume;
    const std = window.length < 2 || !(volume > 0) ? 0 : Math.sqrt(variance);
    const bands = {};
    multipliers.forEach((multiplier, k) => {
      bands[`upper_${k + 1}`] = vwap + std * multiplier;
      bands[`lower_${k + 1}`] = vwap - std * multiplier;
    });
    return { session_start: candles[start].timestamp, vwap, bands };
  });
}

function sessionBandsMatch(resetHour, candles) {
  const indicator = new VWAP('X', '15m', 30, { vwapType: 'session', resetHour });
  const data = indicator.calculateVWAP(candles);
  indicator._calculateStdBands(candles, data);
  const truth = sessionReference(candles, resetHour);
  candles.forEach((_, i) => {
    assert.equal(data[i].session_start, truth[i].session_start, `sesión de la vela ${i}`);
    assert.ok(sameBands(data[i].bands, truth[i].bands), `vela ${i}`);
    // La vela en formación recorre la ventana con la sesión de su VWAP
    assert.ok(sameBands(indicator._bandsAt(candles, i, data[i].vwap, data[i].session_start), truth[i].bands), `vela ${i} recorriendo la ventana`);
  });
}

test('VWAP: bandas de sesión desde la primera vela de su sesión', () => {
  sessionBandsMatch(0, market(500));
});

test('VWAP: otra hora de reinicio', () => {
  sessionBandsMatch(13, market(500));
});

test('VWAP: sesión con velas de 1 hora y de 4 horas', () => {
  sessionBandsMatch(0, market(300, HOUR));
  sessionBandsMatch(0, market(200, 4 * HOUR));
});

test('VWAP: sesión con huecos en las velas', () => {
  const candles = market(400).filter((_, i) => i % 37 > 3);
  sessionBandsMatch(0, candles);
});

test('VWAP: una sesión tranquila después de mucha variación mide su propia variación', () => {
  // Con sumas de todo el historial, el redondeo de 31 días ruidosos tapa una sesión quieta
  const candle = (i, price, volume) => ({ timestamp: Date.UTC(2026, 0, 1) + i * 900000, open: price, high: price, low: price, close: price, volume });
  const loud = Array.from({ length: 31 * 96 }, (_, i) => candle(i, 90000 + (i % 2 ? 40000 : -40000), 1e9));
  const quiet = Array.from({ length: 30 }, (_, i) => candle(31 * 96 + i, 90000 + (i % 2 ? 0.01 : -0.01), 1));
  const candles = [...loud, ...quiet];

  const indicator = new VWAP('X', '15m', 30, { vwapType: 'session', resetHour: 0 });
  const data = indicator.calculateVWAP(candles);
  indicator._calculateStdBands(candles, data);

  const last = candles.length - 1;
  assert.equal(data[last].session_start, quiet[0].timestamp);
  assert.ok(sameBands(data[last].bands, sessionReference(candles, 0)[last].bands));
});

test('VWAP: bandas móviles', () => {
  bandsMatch({ vwapType: 'rolling', rollingPeriod: 20 }, market(200));
});

test('VWAP: la ventana móvil mide un tramo tranquilo después de mucha variación', () => {
  const candle = (i, price, volume) => ({ timestamp: i * 900000, open: price, high: price, low: price, close: price, volume });
  const loud = Array.from({ length: 3000 }, (_, i) => candle(i, 90000 + (i % 2 ? 40000 : -40000), 1e9));
  const quiet = Array.from({ length: 30 }, (_, i) => candle(3000 + i, 90000 + (i % 2 ? 0.01 : -0.01), 1));
  const candles = [...loud, ...quiet];

  const indicator = new VWAP('X', '15m', 30, { vwapType: 'rolling', rollingPeriod: 5 });
  const data = candles.map(item => ({ timestamp: item.timestamp, vwap: item.close }));
  indicator._calculateStdBands(candles, data);

  const last = candles.length - 1;
  assert.ok(sameBands(data[last].bands, indicator._bandsAt(candles, last, data[last].vwap)));
});

test('VWAP: bandas ancladas', () => {
  bandsMatch({ vwapType: 'anchored' }, market(200));
});

test('VWAP: la primera vela de cada sesión no tiene varianza', () => {
  const indicator = new VWAP('X', '15m', 30, { vwapType: 'session' });
  const candles = market(300);
  const data = indicator.calculateVWAP(candles);
  indicator._calculateStdBands(candles, data);
  const firsts = data.filter((point, i) => point.session_start === candles[i].timestamp);
  assert.equal(firsts.length, 3);
  for (const point of firsts) {
    assert.equal(point.bands.upper_1, point.vwap);
    assert.equal(point.bands.lower_1, point.vwap);
  }
});

test('VWAP: sin futuro, cortar las velas no cambia las bandas anteriores', () => {
  const candles = market(300);
  const indicator = new VWAP('X', '15m', 30, { vwapType: 'session' });
  const full = indicator.calculateVWAP(candles);
  const cut = indicator.calculateVWAP(candles.slice(0, 200));
  indicator._calculateStdBands(candles, full);
  indicator._calculateStdBands(candles.slice(0, 200), cut);
  cut.forEach((point, i) => assert.ok(sameBands(point.bands, full[i].bands)));
});

// ---- VWAP contra el backend, con velas reales de BTC

const fixture = JSON.parse(readFileSync(new URL('./data/btc_vwap.json', import.meta.url), 'utf8'));
const asCandles = (rows) => rows.map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }));
const BAND_KEYS = ['upper_1', 'lower_1', 'upper_2', 'lower_2', 'upper_3', 'lower_3'];

// Corre un script con el Python del backend: BACKEND_PYTHON, backend/.venv o el del sistema
function runBackendPython(script, input) {
  const backend = fileURLToPath(new URL('../../backend/', import.meta.url));
  const venv = fileURLToPath(new URL(process.platform === 'win32' ? '../../backend/.venv/Scripts/python.exe' : '../../backend/.venv/bin/python', import.meta.url));
  const candidates = [process.env.BACKEND_PYTHON, existsSync(venv) ? venv : null, 'python', 'python3'].filter(Boolean);
  const errors = [];
  for (const python of candidates) {
    try {
      return execFileSync(python, ['-B', '-c', script, backend], { input, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      errors.push(`${python}: ${String(error.stderr || error.message).trim().split('\n').pop()}`);
    }
  }
  throw new Error(`No pude correr backend/vwap_calculator.py. Indica el Python del backend en BACKEND_PYTHON. ${errors.join(' | ')}`);
}

test('VWAP: bandas de sesión iguales a backend/vwap_calculator.py en velas reales de BTC', () => {
  const script = [
    'import json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'from vwap_calculator import VWAPCalculator',
    'out = {}',
    'for tf, rows in json.load(sys.stdin).items():',
    '    candles = [dict(timestamp=r[0], open=r[1], high=r[2], low=r[3], close=r[4], volume=r[5]) for r in rows]',
    '    points = VWAPCalculator().calculate_vwap_with_bands(candles, "session", {"reset_hour": 0})',
    `    out[tf] = [[p["session_start"], p["vwap"]] + [p["bands"][k] for k in ${JSON.stringify(BAND_KEYS)}] for p in points]`,
    'print(json.dumps(out))'
  ].join('\n');
  const timeframes = ['15m', '1h', '4h'];
  const backend = JSON.parse(runBackendPython(script, JSON.stringify(Object.fromEntries(timeframes.map(tf => [tf, fixture[tf]])))));

  for (const tf of timeframes) {
    const candles = asCandles(fixture[tf]);
    const indicator = new VWAP('BTCUSDT', tf, 30, { vwapType: 'session', resetHour: 0 });
    const data = indicator.calculateVWAP(candles);
    indicator._calculateStdBands(candles, data);
    assert.equal(backend[tf].length, candles.length);
    data.forEach((point, i) => {
      const [sessionStart, vwap, ...bands] = backend[tf][i];
      assert.equal(point.session_start, sessionStart, `${tf} vela ${i}: sesión`);
      assert.ok(Math.abs(point.vwap - vwap) < 1e-6, `${tf} vela ${i}: vwap ${point.vwap} contra ${vwap}`);
      BAND_KEYS.forEach((key, k) => {
        assert.ok(Math.abs(point.bands[key] - bands[k]) < 1e-6, `${tf} vela ${i}: ${key} ${point.bands[key]} contra ${bands[k]}`);
      });
    });
  }

  // El caso de la revisión: 2026-11-06 15:30 en 15m. La ventana anterior empezaba el día antes y daba 2014.8
  const candles = asCandles(fixture['15m']);
  const indicator = new VWAP('BTCUSDT', '15m', 30, { vwapType: 'session', resetHour: 0 });
  const data = indicator._calculateStdBands(candles, indicator.calculateVWAP(candles));
  const point = data[candles.findIndex(candle => candle.timestamp === Date.UTC(2026, 10, 6, 15, 30))];
  assert.equal(point.session_start, Date.UTC(2026, 10, 6));
  assert.ok(Math.abs((point.bands.upper_1 - point.vwap) / 1.15 - 253.6) < 0.05);
});

// ---- Lecturas de volatilidad

function readings(config, candles) {
  const indicator = new VWAP('X', '15m', 30, { vwapType: 'session', showBandWidth: true, showBBWP: true, showTTMSqueeze: true, ...config });
  indicator._recalculateVWAP(candles);
  return candles.map(candle => indicator.dataMap.get(candle.timestamp));
}

test('VWAP: sin lectura de volatilidad hasta que la sesión tiene minSessionCandles velas', () => {
  const points = readings({ minSessionCandles: 10 }, market(400));
  let read = 0;
  for (const point of points) {
    const early = point.band_candles < 10;
    assert.equal(point.bandwidthState === 'unknown', early, 'BandWidth');
    assert.equal(point.bbwpState === 'unknown', early, 'BBWP');
    assert.equal(point.squeezeState === 'unknown', early, 'TTM');
    if (!early) read++;
  }
  // Cuatro sesiones: la primera vela, y 3, 4 y 5 de enero (el 2 queda a menos de 23 horas del inicio)
  assert.equal(points.filter(point => point.band_candles === 1).length, 4);
  assert.equal(read, 400 - 4 * 9);

  // Con mínimo 1 todo se lee, y la ventana móvil no usa el mínimo de la sesión
  assert.ok(readings({ minSessionCandles: 1 }, market(200)).every(point => point.bandwidthState !== 'unknown' && point.squeezeState !== 'unknown'));
  assert.ok(readings({ vwapType: 'rolling', rollingPeriod: 5, minSessionCandles: 10 }, market(200)).every(point => point.bandwidthState !== 'unknown'));
});

test('VWAP: BBWP compara solo con anchos que tienen lectura', () => {
  const indicator = new VWAP('X', '15m', 30, { bbwpLookback: 3 });
  const widths = [[5, 'normal'], [0, 'unknown'], [1, 'squeeze'], [0, 'unknown'], [3, 'consolidation']];
  const bbwp = indicator._calculateBBWP(widths.map(([bandwidth, state], i) => ({ timestamp: i, bandwidth, state })));
  assert.deepEqual(bbwp.map(point => point.state), ['squeeze', 'unknown', 'squeeze', 'unknown', 'normal']);
  // 3 contra 5, 1 y 3: solo 1 es menor
  assert.ok(Math.abs(bbwp[4].percentile - 100 / 3) < 1e-9);
});

test('VWAP: valores de fábrica de la volatilidad según el marco', () => {
  assert.deepEqual(volatilityDefaults('15'), volatilityDefaults('15m'));
  assert.deepEqual(volatilityDefaults('240'), volatilityDefaults('4h'));
  for (const tf of ['1m', '5m', '15m', '1h', '4h']) {
    const indicator = new VWAP('X', tf, 30, {});
    const defaults = volatilityDefaults(tf);
    assert.deepEqual(indicator.bandWidthThresholds, defaults.bandWidthThresholds);
    assert.equal(indicator.ttmATRMultiplier, defaults.ttmATRMultiplier);
    assert.equal(indicator.minSessionCandles, defaults.minSessionCandles);
    assert.equal(indicator.getConfig().minSessionCandles, defaults.minSessionCandles);
  }
  // Cada indicador recibe su copia de los umbrales
  new VWAP('X', '4h', 30, {}).bandWidthThresholds.squeeze = 99;
  assert.notEqual(volatilityDefaults('4h').bandWidthThresholds.squeeze, 99);
  // Lo configurado manda, también un mínimo de cero
  assert.equal(new VWAP('X', '4h', 30, { minSessionCandles: 0 }).minSessionCandles, 0);
  const indicator = new VWAP('X', '4h', 30, {});
  indicator.applyConfig({ minSessionCandles: 7 });
  assert.equal(indicator.minSessionCandles, 7);
});

// ---- Swing

test('Swing: las señales conocidas son las mismas que con el filtro largo', () => {
  const indicator = new Swing('X', '15m', 30);
  indicator.swingBars = 3;
  const signals = market(200).map((candle, i) => ({ timestamp: candle.timestamp + (i % 3), price: candle.high }));
  const delay = 4 * 900000;
  for (let i = 0; i < 300; i++) {
    const now = signals[0].timestamp + Math.floor(random() * 200 * 900000);
    indicator._currentPlaybackTime = now;
    assert.deepEqual(indicator._filterByPlaybackTime(signals), signals.filter(signal => signal.timestamp + delay <= now));
  }
});

test('Swing: una señal se conoce justo al cerrar su última vela', () => {
  const indicator = new Swing('X', '15m', 30);
  indicator.swingBars = 3;
  const signals = [{ timestamp: 0 }, { timestamp: 900000 }];
  indicator._currentPlaybackTime = 4 * 900000;
  assert.equal(indicator._filterByPlaybackTime(signals).length, 1);
  indicator._currentPlaybackTime = 4 * 900000 - 1;
  assert.equal(indicator._filterByPlaybackTime(signals).length, 0);
});

// Punto de VWAP con bandas a 1, 2 y 3 veces std, con los nombres de VWAPIndicator
const vwapPoint = (vwap, std) => ({
  vwap,
  bands: Object.fromEntries([1, 2, 3].flatMap(k => [[`upper_${k}`, vwap + k * std], [`lower_${k}`, vwap - k * std]]))
});
const vwapSwing = (vwapFilter) => new Swing('X', '15m', 30, { vwapFilter: { enabled: true, ...vwapFilter } });

test('Swing: el filtro VWAP lee las bandas upper_N y lower_N', () => {
  const map = new Map([[1000, vwapPoint(100, 10)]]);
  const swing = vwapSwing({});
  assert.equal(swing._checkVWAPFilter(1000, 85, map), 'LONG');
  assert.equal(swing._checkVWAPFilter(1000, 115, map), 'SHORT');
  assert.equal(swing._checkVWAPFilter(1000, 100, map), null);
});

test('Swing: el margen del filtro VWAP es parte de la distancia de la banda al VWAP', () => {
  const map = new Map([[1000, vwapPoint(100, 10)]]);
  // Banda 1 a 10 del VWAP: con 20% se acepta hasta 2 por dentro de ella
  const swing = vwapSwing({ deviations: [1], marginPercent: 20 });
  assert.equal(swing._checkVWAPFilter(1000, 108.01, map), 'SHORT');
  assert.equal(swing._checkVWAPFilter(1000, 107.99, map), null);
  assert.equal(swing._checkVWAPFilter(1000, 91.99, map), 'LONG');
  assert.equal(swing._checkVWAPFilter(1000, 92.01, map), null);
});

test('Swing: el filtro VWAP solo usa las bandas elegidas', () => {
  const map = new Map([[1000, vwapPoint(100, 10)]]);
  const swing = vwapSwing({ deviations: [3], marginPercent: 20 });
  assert.equal(swing._checkVWAPFilter(1000, 115, map), null);
  assert.equal(swing._checkVWAPFilter(1000, 124.01, map), 'SHORT');
  assert.equal(swing._checkVWAPFilter(1000, 75.99, map), 'LONG');
});

test('Swing: en un rectángulo con filtro VWAP pasa la señal que sale de la banda y no la que queda dentro', () => {
  // Mínimo en 25 bajo la banda, máximo en 30 sobre ella y máximo en 35 dentro de ella
  const candles = Array.from({ length: 45 }, (_, i) => ({
    timestamp: i * 900000, open: 100, close: 100, volume: 10,
    high: i === 30 ? 102 : i === 35 ? 100.5 : 100.3,
    low: i === 25 ? 95 : 99.7
  }));
  const zone = { id: 'z', sourceRectId: 'r', min: 0, max: 1000, direction: 'BOTH', enabled: true, timeBound: false };
  const swing = new Swing('X', '15m', 30, { swingBars: 3, vwapFilter: { enabled: true }, priceZones: [zone] });
  swing.setVWAPIndicator({ enabled: true, dataMap: new Map(candles.map(candle => [candle.timestamp, vwapPoint(100, 1)])) });
  assert.deepEqual(swing.detectSwings(candles).map(signal => [signal.type, signal.candleIndex]), [['SWING_LOW', 25], ['SWING_HIGH', 30]]);
});

// Mínimo en 25 bajo la banda, máximo en 30 sobre ella y máximos en 35 y 40 dentro de ella
const bandCandles = () => Array.from({ length: 45 }, (_, i) => ({
  timestamp: i * 900000, open: 100, close: 100, volume: 10,
  high: i === 30 ? 102 : i === 35 ? 100.5 : i === 40 ? 100.6 : 100.3,
  low: i === 25 ? 95 : 99.7
}));
const bandMap = (candles) => new Map(candles.map(candle => [candle.timestamp, vwapPoint(100, 1)]));
// Rectángulo dibujado de 100 a 101 alrededor de una vela
const rectangleAround = (index, id = 'r1') => {
  const shape = new Rectangle(100, (index - 1) * 900000, 101, (index + 1) * 900000);
  shape.id = id;
  return shape;
};
function rectangleSwing({ shapes = [], vwapFilter = { enabled: true }, vwap = null } = {}) {
  const candles = bandCandles();
  const swing = new Swing('X', '15m', 30, { swingBars: 3, vwapFilter });
  swing.setVWAPIndicator(vwap || { enabled: true, calculations: 1, dataMap: bandMap(candles) });
  const manager = { shapes };
  swing.setDrawingManager(() => manager);
  const indexes = () => swing.detectSwings(candles).map(signal => signal.candleIndex);
  return { swing, candles, manager, indexes };
}

test('Swing: el filtro VWAP actúa dentro de los rectángulos del gráfico y deja igual lo de afuera', () => {
  assert.deepEqual(rectangleSwing().indexes(), [25, 30, 35, 40]);
  // El máximo de 35 queda entre bandas dentro del rectángulo; el de 40 también, pero afuera
  assert.deepEqual(rectangleSwing({ shapes: [rectangleAround(35)] }).indexes(), [25, 30, 40]);
  assert.deepEqual(rectangleSwing({ shapes: [rectangleAround(35), rectangleAround(40, 'r2')] }).indexes(), [25, 30]);
});

test('Swing: sin el VWAP activo o con el filtro apagado los rectángulos no cambian las señales', () => {
  const shapes = [rectangleAround(35)];
  const candles = bandCandles();
  assert.deepEqual(rectangleSwing({ shapes, vwap: { enabled: false, calculations: 1, dataMap: bandMap(candles) } }).indexes(), [25, 30, 35, 40]);
  assert.deepEqual(rectangleSwing({ shapes, vwapFilter: { enabled: false } }).indexes(), [25, 30, 35, 40]);
});

test('Swing: el rectángulo de un VP Fixed no cuenta para el filtro VWAP', () => {
  const setup = rectangleSwing({ shapes: [rectangleAround(35), rectangleAround(40, 'r2')] });
  setup.swing.getProfileRectIds = () => new Set(['r1']);
  assert.deepEqual(setup.indexes(), [25, 30, 35]);
});

test('Swing: un rectángulo movido cuenta al soltarlo, no mientras se arrastra', () => {
  const shape = rectangleAround(35);
  const setup = rectangleSwing({ shapes: [shape] });
  assert.deepEqual(setup.indexes(), [25, 30, 40]);
  shape.isDragging = true;
  shape.timeStart = 39 * 900000;
  shape.timeEnd = 41 * 900000;
  assert.deepEqual(setup.indexes(), [25, 30, 40]);
  shape.isDragging = false;
  assert.deepEqual(setup.indexes(), [25, 30, 35]);
  setup.manager.shapes = [];
  assert.deepEqual(setup.indexes(), [25, 30, 35, 40]);
});

test('Swing: un cálculo nuevo del VWAP rehace el filtro', () => {
  const vwap = { enabled: true, calculations: 0, dataMap: new Map() };
  const setup = rectangleSwing({ shapes: [rectangleAround(35)], vwap });
  assert.deepEqual(setup.indexes(), [25, 30, 35, 40]);
  for (const [time, point] of bandMap(setup.candles)) vwap.dataMap.set(time, point);
  vwap.calculations = 1;
  assert.deepEqual(setup.indexes(), [25, 30, 40]);
});

test('Swing: un cálculo sin señales también queda guardado', () => {
  const swing = new Swing('X', '15m', 30, { swingBars: 3 });
  const flat = Array.from({ length: 45 }, (_, i) => ({ timestamp: i * 900000, open: 100, high: 100, low: 100, close: 100, volume: 10 }));
  let passes = 0;
  const isSwingHigh = swing._isSwingHigh.bind(swing);
  swing._isSwingHigh = (...args) => { passes++; return isSwingHigh(...args); };
  assert.deepEqual(swing.detectSwings(flat), []);
  const first = passes;
  assert.deepEqual(swing.detectSwings(flat), []);
  assert.equal(passes, first);
});

test('VWAP: cada cálculo nuevo cuenta en calculations', () => {
  const indicator = new VWAP('X', '15m', 30, { backtestingMode: true });
  assert.equal(indicator.calculations, 0);
  const candles = market(120);
  indicator._recalculateVWAP(candles);
  assert.equal(indicator.calculations, 1);
  indicator._recalculateVWAP(candles);
  assert.equal(indicator.calculations, 2);
});

// ---- Double Top/Bottom

test('Double Top/Bottom: halla la vela exacta o ninguna', () => {
  const indicator = new DoubleTopBottom('X', '15m', 30);
  const candles = market(50);
  assert.equal(indicator._findCandleByTimestamp(candles, candles[17].timestamp), candles[17]);
  assert.equal(indicator._findCandleByTimestamp(candles, candles[17].timestamp + 1), undefined);
});

// ---- S&R clásico

function classic() {
  const indicator = new SupportResistance('X', '15m', 30);
  indicator.enabled = true;
  indicator.localOnly = true;
  let raw = 0;
  const calculate = indicator._calculateRawLevels.bind(indicator);
  indicator._calculateRawLevels = (candles) => { raw++; return calculate(candles); };
  return { indicator, raw: () => raw };
}

test('S&R clásico: al retroceder vuelve a buscar pivots', () => {
  const { indicator, raw } = classic();
  const candles = market(600);
  indicator.calculateFromCandles(candles);
  indicator.calculateFromCandles(candles.slice(0, 300));
  assert.equal(raw(), 2);
});

test('S&R clásico: al retroceder no quedan niveles de velas posteriores', () => {
  const candles = market(600);
  const { indicator } = classic();
  indicator.calculateFromCandles(candles);
  indicator.calculateFromCandles(candles.slice(0, 300));
  const { indicator: fresh } = classic();
  fresh.calculateFromCandles(candles.slice(0, 300));
  assert.deepEqual(indicator.resistances, fresh.resistances);
  assert.deepEqual(indicator.supports, fresh.supports);
});

test('S&R clásico: al avanzar reusa los pivots unas velas y luego los refresca', () => {
  const { indicator, raw } = classic();
  const candles = market(400);
  indicator.calculateFromCandles(candles.slice(0, 300));
  indicator.calculateFromCandles(candles.slice(0, 319));
  assert.equal(raw(), 1);
  indicator.calculateFromCandles(candles.slice(0, 320));
  assert.equal(raw(), 2);
});

test('S&R clásico: en reproducción no pide al backend, que solo conoce el presente', async () => {
  const { indicator } = classic();
  let fetched = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; return { json: async () => ({}) }; };
  assert.equal(await indicator.fetchData(), true);
  globalThis.fetch = real;
  assert.equal(fetched, 0);
});

test('S&R clásico: dibuja con lo conocido aunque le lleguen velas futuras', () => {
  const { indicator } = classic();
  let used = null;
  indicator.calculateFromCandles = (candles) => { used = candles; };
  const all = market(100);
  const known = all.slice(0, 40);
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  indicator.renderOverlay(ctx, { x: 0, y: 0, width: 100, height: 100 }, known.slice(-5), all, { knownCandles: known, minPrice: 0, maxPrice: 1, priceToY: () => 0 });
  assert.equal(used, known);
});

// ---- Fecha oculta

test('línea vertical: con fecha oculta su etiqueta no muestra la fecha real', () => {
  const texts = [];
  const ctx = new Proxy({}, { get: (target, key) => (key === 'fillText' ? (text) => texts.push(text) : () => {}), set: () => true });
  const scale = { timeToX: () => 50, marginTop: 0, chartHeight: 100 };
  const time = Date.UTC(2026, 5, 3, 15);
  const line = new VerticalLine(100, time);

  line.render(ctx, scale);
  setBlindAnchor(Date.UTC(2026, 5, 1));
  line.render(ctx, scale);
  setBlindAnchor(null);

  assert.match(texts[0], /^6\/3 /);
  assert.doesNotMatch(texts[1], /^6\/3 /);
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
