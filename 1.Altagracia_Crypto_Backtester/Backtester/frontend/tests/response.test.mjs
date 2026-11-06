// Volumen de Respuesta. Uso: node tests/response.test.mjs [ruta\response_parity.json]
// El archivo sale de research/response_volume/export_parity.py y compara con el motor del estudio.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

const { ResponseSeries, cleanResponseConfig, defaultResponseConfig } = await import('../src/components/indicators/responseBalance.js');
const { default: ResponseVolume, saveResponseVolumeSettings } = await import('../src/components/indicators/ResponseVolumeIndicator.js');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 5, 1);
const tests = [];
const test = (name, run) => tests.push([name, run]);

/** Velas de una hora desde [apertura, cierre, volumen] */
const candles = (rows, wick = 0) => rows.map(([open, close, volume = 10], i) => ({
  timestamp: START + i * HOUR,
  open,
  close,
  high: Math.max(open, close) + wick,
  low: Math.min(open, close) - wick,
  volume
}));

const config = (changes = {}) => ({ ...defaultResponseConfig(), adjustHour: false, ...changes });

function run(rows, changes, wick) {
  const series = new ResponseSeries(config(changes));
  series.update(candles(rows, wick));
  return series;
}

/** Serie con subidas, bajadas y volumen variable, igual en cada corrida */
function wandering(count) {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let price = 1000;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    price += (random() - 0.48) * 12;
    return {
      timestamp: START + i * HOUR,
      open,
      close: price,
      high: Math.max(open, price) + random() * 3,
      low: Math.min(open, price) - random() * 3,
      volume: 10 + random() * 90 + (i % 37 === 0 ? 400 : 0)
    };
  });
}

test('balance: promedio de las velas principales de cada lado', () => {
  const series = run([[100, 101, 100], [101, 102, 80], [102, 101.5, 20], [101.5, 103, 60], [103, 102.5, 30]], { legAtr: 6, window: 20, top: 2 });
  assert.equal(series.direction[4], 1);
  assert.equal(series.balance[4], 90 / 25);
});

test('balance: con menos velas que las principales usa las que hay', () => {
  const series = run([[100, 101, 100], [101, 102, 80], [102, 101.5, 20]], { legAtr: 6, window: 20, top: 5 });
  assert.equal(series.balance[2], 90 / 20);
});

test('balance: sin respuesta vale 10 y sin tendencia 0.1', () => {
  assert.equal(run([[100, 101], [101, 102]], { legAtr: 6 }).balance[1], 10);
  assert.equal(run([[100, 99.9], [99.9, 99.8]], { legAtr: 6 }).balance[1], 0.1);
});

test('balance: queda entre 0.1 y 10', () => {
  const up = run([[100, 101, 1000], [101, 100.9, 1]], { legAtr: 6 });
  const down = run([[100, 101, 1], [101, 100.9, 1000]], { legAtr: 6 });
  assert.equal(up.balance[1], 10);
  assert.equal(down.balance[1], 0.1);
});

test('balance: una vela sin cuerpo no cuenta para ningún lado', () => {
  const series = run([[100, 100, 500], [100, 101, 20], [101, 100.5, 10]], { legAtr: 6, top: 1 });
  assert.equal(series.balance[0], 1, 'sin velas de ningún lado');
  assert.equal(series.balance[2], 2);
});

test('balance: solo mira la ventana', () => {
  const series = run([[100, 101, 900], [101, 102, 40], [102, 103, 40], [103, 102.5, 20]], { legAtr: 6, window: 3, top: 1 });
  assert.equal(series.balance[3], 2, 'la vela de 900 quedó fuera');
});

const turning = [[100, 101], [101, 102], [102, 103], [103, 104], [104, 105], [105, 106], [105.5, 105], [105, 104.5], [104.5, 103.5]];

test('tramo: cambia cuando un cierre se aleja del extremo y empieza en ese extremo', () => {
  const series = run(turning, { legAtr: 2 });
  assert.equal(series.direction[7], 1);
  assert.equal(series.direction[8], -1);
  assert.equal(series.start[8], 5);
  assert.equal(series.leg.extreme, 103.5);
  assert.equal(series.leg.extremeAt, 8);
});

test('tramo: la distancia se mide en ATR', () => {
  assert.equal(run(turning, { legAtr: 3 }).direction[8], 1);
});

test('tramo: un hueco de precio cuenta en el ATR', () => {
  const series = run([[100, 101], [101, 102], [102, 103], [110, 111], [110.9, 109.5]], { legAtr: 1 });
  assert.equal(series.direction[4], 1, 'el rango verdadero incluye el salto de 103 a 111');
});

test('tramo: un tramo bajista gira hacia arriba de la misma forma', () => {
  const mirror = turning.map(([open, close]) => [300 - open, 300 - close]);
  const series = run([[201, 200], ...mirror], { legAtr: 2 });
  assert.equal(series.direction[8], -1, 'empezó a bajar');
  assert.equal(series.direction[series.direction.length - 1], 1);
  assert.equal(series.start[series.start.length - 1], 6);
});

test('tramo: la ventana no pasa del inicio del tramo', () => {
  const rows = [[100, 101, 900], ...turning.slice(1).map(([open, close]) => [open, close, 10]), [103.5, 103, 5]];
  const series = run(rows, { legAtr: 2, window: 40, top: 1 });
  const last = rows.length - 1;
  assert.equal(series.direction[last], -1);
  assert.equal(series.balance[last], 1, 'la vela de 900 quedó antes del inicio: solo cuenta la verde del extremo');
});

const signalRows = [[100, 101, 100], [101, 100.5, 30], [100.5, 100, 100], [100, 99.5, 110], [99.5, 101, 300], [101, 100.5, 300]];

test('señal: aparece al bajar al equilibrio después de que la tendencia dominó', () => {
  const series = run(signalRows, { legAtr: 6, window: 4, top: 1 });
  assert.deepEqual(series.balance.slice(0, 3).map(value => Number(value.toFixed(2))), [10, 3.33, 1]);
  assert.equal(series.signal[2], true);
});

test('señal: no se repite hasta que la tendencia vuelve a dominar', () => {
  const series = run(signalRows, { legAtr: 6, window: 4, top: 1 });
  assert.deepEqual(series.signal, [false, false, true, false, false, true]);
});

test('señal: llegar justo al dominio ya la arma', () => {
  const series = run([[100, 99.9, 50], [99.9, 100.5, 100], [100.5, 100, 100]], { legAtr: 6, window: 4, top: 1 });
  assert.equal(series.balance[1], 2);
  assert.equal(series.signal[2], true);
});

test('señal: sin dominio previo no hay señal', () => {
  const series = run(signalRows, { legAtr: 6, window: 4, top: 1, dominance: 50 });
  assert.ok(!series.signal.includes(true));
});

test('señal: respeta el umbral de equilibrio', () => {
  const series = run(signalRows, { legAtr: 6, window: 4, top: 1, balance: 0.95 });
  assert.equal(series.signal[2], false);
  assert.equal(series.signal[3], true);
});

test('señal: cambiar de tramo desarma', () => {
  const series = run([[100, 101, 100], [100.9, 97, 50]], { legAtr: 1, window: 10, top: 1 });
  assert.equal(series.direction[1], -1);
  assert.ok(series.balance[1] <= 1);
  assert.equal(series.signal[1], false);
});

const hourly = (volumeOf, days = 7) => Array.from({ length: days * 24 }, (_, i) => ({
  timestamp: START + i * HOUR, open: 100, close: 101, high: 101, low: 100, volume: volumeOf(Math.floor(i / 24), i % 24)
}));

test('hora: compara con la mediana de esa misma hora en los días anteriores', () => {
  const series = new ResponseSeries(config());
  series.update(hourly((day, hour) => (day === 6 && hour === 3 ? 30 : hour === 3 ? 10 : 1000)));
  assert.equal(series.relative[6 * 24 + 3], 3);
  assert.equal(series.relative[6 * 24 + 4], 1, 'las otras horas tienen su propio normal');
});

test('hora: con menos de 5 días queda en lo normal', () => {
  const series = new ResponseSeries(config());
  series.update(hourly((day) => (day === 4 ? 50 : 10)));
  assert.equal(series.relative[4 * 24], 1);
  assert.equal(series.relative[5 * 24], 1, 'con 5 días la mediana sigue siendo 10');
});

test('hora: solo usa los 30 días anteriores', () => {
  const daily = Array.from({ length: 62 }, (_, i) => ({
    timestamp: START + i * DAY, open: 100, close: 101, high: 101, low: 100, volume: i < 31 ? 1000 : 10
  }));
  const series = new ResponseSeries(config());
  series.update(daily);
  assert.equal(series.relative[61], 1);
});

test('hora: la vela no entra en su propio normal', () => {
  const series = new ResponseSeries(config());
  series.update(hourly((day) => (day === 5 ? 100 : 10)));
  assert.equal(series.relative[5 * 24], 10);
});

test('hora: con el ajuste las velas pesan por su volumen relativo', () => {
  const rows = hourly((day, hour) => (day === 6 && hour === 1 ? 20 : hour === 1 ? 10 : 100));
  const adjusted = new ResponseSeries(config({ adjustHour: true }));
  const raw = new ResponseSeries(config({ adjustHour: false }));
  adjusted.update(rows);
  raw.update(rows);
  assert.equal(adjusted.weight[6 * 24 + 1], 2);
  assert.equal(raw.weight[6 * 24 + 1], 20);
});

test('agresión: vela con cuerpo y varias veces lo normal de su hora', () => {
  const series = new ResponseSeries(config({ spikeMultiple: 2 }));
  series.update(hourly((day, hour) => (day === 6 && hour === 3 ? 20 : day === 6 && hour === 4 ? 19 : 10)));
  assert.equal(series.isPrincipal(6 * 24 + 3), true);
  assert.equal(series.isPrincipal(6 * 24 + 4), false);
  series.side[6 * 24 + 3] = 0;
  assert.equal(series.isPrincipal(6 * 24 + 3), false);
});

test('presión: positiva cuando pesa la compra y negativa cuando pesa la venta', () => {
  const series = run([[100, 101, 80], [101, 100.9, 20]], { legAtr: 6, top: 1 });
  assert.equal(series.pressure(1), 2);
  series.direction[1] = -1;
  assert.equal(series.pressure(1), -2);
});

test('sin futuro: agregar velas no cambia nada de lo ya calculado', () => {
  const all = wandering(900);
  const complete = new ResponseSeries(config({ adjustHour: true, legAtr: 2 }));
  complete.update(all);
  for (const cut of [50, 333, 700]) {
    const partial = new ResponseSeries(config({ adjustHour: true, legAtr: 2 }));
    partial.update(all.slice(0, cut));
    for (const field of ['balance', 'direction', 'start', 'signal', 'relative']) {
      assert.deepEqual(partial[field], complete[field].slice(0, cut), `${field} con corte en ${cut}`);
    }
  }
});

test('sin futuro: la serie extendida es igual a la calculada de una vez', () => {
  const all = wandering(600);
  const steps = new ResponseSeries(config({ adjustHour: true }));
  for (let end = 1; end <= all.length; end += 37) steps.update(all.slice(0, end));
  steps.update(all);
  const once = new ResponseSeries(config({ adjustHour: true }));
  once.update(all);
  assert.deepEqual(steps.balance, once.balance);
  assert.deepEqual(steps.signal, once.signal);
});

test('sin futuro: la vela en formación no entra', () => {
  const all = wandering(30);
  const forming = { ...all[29], in_progress: true };
  const series = new ResponseSeries(config());
  series.update([...all.slice(0, 29), forming]);
  assert.equal(series.known, 29);
  assert.equal(series.timestamps.length, 29);
  assert.equal(series.indexOf(forming.timestamp), -1);
});

test('sin futuro: al retroceder deja de verse lo que aún no se conocía', () => {
  const all = wandering(100);
  const series = new ResponseSeries(config());
  series.update(all);
  const value = series.balance[59];
  series.update([...all.slice(0, 60), { ...all[60], in_progress: true }]);
  assert.equal(series.indexOf(all[60].timestamp), -1, 'esa vela ahora está en formación');
  assert.equal(series.indexOf(all[80].timestamp), -1);
  assert.equal(series.balance[series.indexOf(all[59].timestamp)], value);
  series.update(all);
  assert.equal(series.indexOf(all[80].timestamp), 80, 'al avanzar reaparece sin recalcular');
});

test('serie: otras velas obligan a empezar de nuevo', () => {
  const series = new ResponseSeries(config());
  series.update(wandering(40));
  const other = wandering(40).map(candle => ({ ...candle, timestamp: candle.timestamp + DAY }));
  series.update(other);
  assert.equal(series.timestamps[0], other[0].timestamp);
  assert.equal(series.timestamps.length, 40);
});

test('serie: sin velas no hay nada conocido', () => {
  const series = new ResponseSeries(config());
  series.update(wandering(20));
  series.update([]);
  assert.equal(series.known, 0);
  assert.equal(series.indexOf(START), -1);
});

test('parámetros: se ajustan a su rango y el equilibrio queda bajo el dominio', () => {
  const clean = cleanResponseConfig({ ...defaultResponseConfig(), legAtr: '99', window: '7.6', top: 'x', dominance: 1.2, balance: 1.5, spikeMultiple: 0 });
  assert.equal(clean.legAtr, 6);
  assert.equal(clean.window, 8);
  assert.equal(clean.top, defaultResponseConfig().top);
  assert.equal(clean.dominance, 1.2);
  assert.equal(clean.balance, 1.1);
  assert.equal(clean.spikeMultiple, 1.2);
});

const bounds = { x: 0, y: 0, width: 400, height: 300 };
const panel = { x: 0, y: 300, width: 400, height: 90 };
const fakeCanvas = () => {
  const drawn = [];
  const record = (name) => (...args) => drawn.push([name, ...args]);
  const ctx = new Proxy({ fillRect: record('rect'), fillText: record('text'), fill: record('fill'), moveTo: record('move') }, {
    get: (target, name) => (name in target ? target[name] : () => {}),
    set: (target, name, value) => { target[name] = value; return true; }
  });
  return { ctx, drawn };
};

const context = (known) => ({
  priceToY: (price) => 300 - price / 10,
  timeToX: (time) => (time - START) / HOUR * 4,
  knownCandles: known,
  knownUntil: known[known.length - 1].timestamp + HOUR
});

function indicator(changes = {}) {
  const result = new ResponseVolume('BTCUSDT', '60', 30);
  result.enabled = true;
  result.updateConfig({ adjustHour: false, ...changes });
  return result;
}

function draw(target, known, allCandles = known, visible = known.slice(-40)) {
  const { ctx, drawn } = fakeCanvas();
  target.renderOverlay(ctx, bounds, visible, allCandles, context(known));
  target.render(ctx, panel, visible);
  return drawn;
}

const bars = (drawn) => drawn.filter(item => item[0] === 'rect').slice(1);

test('indicador: nace apagado, con panel propio y con la regla validada', () => {
  const target = new ResponseVolume('BTCUSDT', '60', 30);
  assert.equal(target.enabled, false);
  assert.equal(target.height, 90);
  assert.deepEqual([target.config.legAtr, target.config.window, target.config.top, target.config.balance, target.config.adjustHour], [2, 10, 5, 1, true]);
});

test('indicador: recuerda los parámetros del símbolo', () => {
  const stored = new Map();
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  saveResponseVolumeSettings('BTCUSDT', { window: 25 });
  assert.equal(new ResponseVolume('BTCUSDT', '60', 30).config.window, 25);
  assert.equal(new ResponseVolume('ETHUSDT', '60', 30).config.window, 10);
  delete globalThis.localStorage;
});

test('indicador: una barra por vela cerrada y ninguna para la que se forma', () => {
  const all = wandering(60);
  const known = [...all.slice(0, 59), { ...all[59], in_progress: true }];
  const drawn = draw(indicator(), known);
  assert.equal(bars(drawn).length, 39);
  assert.ok(drawn.some(item => item[0] === 'text' && item[1] === 'Volumen de Respuesta'));
});

test('indicador: el futuro no cambia lo dibujado', () => {
  const all = wandering(300);
  const known = [...all.slice(0, 200), { ...all[200], in_progress: true }];
  assert.deepEqual(draw(indicator(), known, all), draw(indicator(), known, known));
  assert.equal(bars(draw(indicator(), known, all)).length, 39, 'la vela que se forma no toma su valor final');
});

test('indicador: fuera de la reproducción usa las velas del gráfico', () => {
  const all = wandering(60);
  const target = indicator();
  const { ctx } = fakeCanvas();
  target.renderOverlay(ctx, bounds, all, all, { priceToY: () => 0, timeToX: () => 0, knownCandles: null });
  assert.equal(target.series.known, 60);
});

test('indicador: la barra sube con compra y baja con venta', () => {
  const rows = candles([[100, 101, 80], [101, 100.9, 20]]);
  const target = indicator({ legAtr: 6, top: 1 });
  const drawn = draw(target, rows, rows, rows);
  const [, barX, barY, barWidth, barHeight] = bars(drawn)[1];
  assert.ok(barWidth > 0 && barX > 0);
  assert.equal(barHeight, 33, 'cuatro veces de ventaja llena medio panel');
  assert.equal(barY, 320, 'parte de la línea superior');
  target.series.direction[1] = -1;
  const { ctx, drawn: again } = fakeCanvas();
  target.render(ctx, panel, rows);
  assert.equal(bars(again)[1][2], 353, 'cae desde el cero');
});

test('indicador: la barra se corta en cuatro veces de ventaja', () => {
  const rows = candles([[100, 101, 900], [101, 100.9, 10]]);
  const drawn = draw(indicator({ legAtr: 6, top: 1 }), rows, rows, rows);
  assert.equal(bars(drawn)[1][4], 33);
});

test('indicador: la lectura dice en qué va el tramo', () => {
  const rows = candles(signalRows);
  const target = indicator({ legAtr: 6, window: 4, top: 1 });
  target.series.update(rows);
  assert.equal(target.reading(0), 'Tramo alcista · tendencia / respuesta 10.00 · domina la tendencia');
  assert.equal(target.reading(2), 'Tramo alcista · tendencia / respuesta 1.00 · equilibrio');
  target.series.balance[1] = 1.5;
  assert.equal(target.reading(1), 'Tramo alcista · tendencia / respuesta 1.50 · la respuesta se acerca');
});

test('indicador: rombo en el precio y en el panel cuando hay equilibrio', () => {
  const rows = candles(signalRows);
  const shapes = (changes) => draw(indicator({ legAtr: 6, window: 4, top: 1, showArrows: false, ...changes }), rows, rows, rows).filter(item => item[0] === 'fill').length;
  assert.equal(shapes({}), 4, 'dos señales, cada una en el precio y en el panel');
  assert.equal(shapes({ showSignals: false }), 0);
});

test('indicador: el rombo va del lado del extremo del tramo y más allá de la flecha', () => {
  const rows = candles(signalRows);
  const target = indicator({ legAtr: 6, window: 4, top: 1, showArrows: false });
  const y = (price) => 300 - price / 10;
  const size = 7;
  const lastMove = () => {
    const { ctx, drawn } = fakeCanvas();
    target.renderOverlay(ctx, bounds, rows.slice(0, 3), rows, context(rows));
    return drawn.filter(item => item[0] === 'move').pop()[2];
  };
  assert.equal(lastMove(), y(100.5) - 4 - size - size, 'tramo alcista: encima de la vela');

  target.updateConfig({ showArrows: true });
  target.series.relative[2] = 5;
  assert.equal(lastMove(), y(100.5) - size * 1.6 - 6 - size - size, 'la flecha roja también va encima');

  target.series.direction[2] = -1;
  assert.equal(lastMove(), y(100) + 4 + size - size, 'tramo bajista: debajo de la vela');
});

test('indicador: cada casilla apaga solo su marca', () => {
  const rows = candles(signalRows);
  const shapes = (changes) => {
    const target = indicator({ legAtr: 6, window: 4, top: 1, ...changes });
    target.series.update(rows);
    target.series.relative[2] = 5;
    const { ctx, drawn } = fakeCanvas();
    target.renderOverlay(ctx, bounds, rows, rows, context(rows));
    return drawn.filter(item => item[0] === 'fill').length;
  };
  assert.equal(shapes({}), 3, 'una flecha y dos rombos');
  assert.equal(shapes({ showArrows: false }), 2);
  assert.equal(shapes({ showSignals: false }), 1);
});

test('indicador: flecha en velas de agresión', () => {
  const rows = hourly((day, hour) => (day === 6 && hour === 3 ? 50 : 10));
  const target = indicator({ adjustHour: true, showSignals: false, spikeMultiple: 2 });
  const visible = rows.slice(-30);
  const shapes = draw(target, rows, rows, visible).filter(item => item[0] === 'fill');
  assert.equal(shapes.length, 1);
  target.updateConfig({ showArrows: false });
  assert.equal(draw(target, rows, rows, visible).filter(item => item[0] === 'fill').length, 0);
});

test('indicador: la flecha apunta a la vela desde su lado', () => {
  const rows = hourly((day, hour) => (day === 6 && hour === 3 ? 50 : 10));
  const down = rows.map((candle, i) => (i === 6 * 24 + 3 ? { ...candle, open: 101, close: 100 } : candle));
  const target = indicator({ adjustHour: true, showSignals: false });
  const tipOf = (known) => {
    const { ctx, drawn } = fakeCanvas();
    target.series.reset();
    target.renderOverlay(ctx, bounds, known.slice(-30), known, context(known));
    return drawn.find(item => item[0] === 'move')[2];
  };
  const y = (price) => 300 - price / 10;
  assert.equal(tipOf(rows), y(100) + 4, 'verde: debajo de su mínimo');
  assert.equal(tipOf(down), y(101) - 4, 'roja: encima de su máximo');
});

test('indicador: con velas muy angostas no hay marcas', () => {
  const rows = hourly((day, hour) => (day === 6 && hour === 3 ? 50 : 10));
  const target = indicator({ adjustHour: true, showSignals: false });
  const { ctx, drawn } = fakeCanvas();
  target.renderOverlay(ctx, { ...bounds, width: 100 }, rows, rows, context(rows));
  assert.equal(drawn.filter(item => item[0] === 'fill').length, 0);
});

test('indicador: cambiar una regla recalcula y cambiar marcas no', () => {
  const target = indicator();
  const rows = wandering(50);
  target.series.update(rows);
  target.updateConfig({ showArrows: false, spikeMultiple: 3 });
  assert.equal(target.series.timestamps.length, 50);
  assert.equal(target.series.config.spikeMultiple, 3);
  target.updateConfig({ window: 20 });
  assert.equal(target.series.timestamps.length, 0);
  assert.equal(target.series.config.window, 20);
});

test('indicador: apagado no dibuja nada', () => {
  const target = indicator();
  target.enabled = false;
  const { ctx, drawn } = fakeCanvas();
  target.render(ctx, panel, wandering(5));
  assert.deepEqual(drawn, []);
});

const parityPath = process.argv[2];
if (parityPath) {
  const report = JSON.parse(readFileSync(parityPath, 'utf8'));
  for (const [frame, { candles: source, adjusted, rules }] of Object.entries(report)) {
    const rows = source.ts.map((timestamp, i) => ({
      timestamp, open: source.open[i], high: source.high[i], low: source.low[i], close: source.close[i], volume: source.volume[i]
    }));
    for (const [label, rule] of Object.entries(rules)) {
      test(`paridad con el motor: ${frame} ${label}`, () => {
        const series = new ResponseSeries({ ...defaultResponseConfig(), ...rule.config });
        const begin = performance.now();
        series.update(rows);
        const seconds = ((performance.now() - begin) / 1000).toFixed(2);

        let worst = 0;
        rows.forEach((_, i) => {
          worst = Math.max(worst, Math.abs(series.balance[i] - rule.balance[i]), Math.abs(series.relative[i] - adjusted[i]));
          assert.equal(series.direction[i], rule.direction[i], `dirección en ${i}`);
          assert.equal(series.start[i], rule.start[i], `inicio en ${i}`);
        });
        assert.ok(worst < 1e-9, `diferencia máxima ${worst}`);
        const found = series.signal.flatMap((signal, i) => (signal ? [i] : []));
        assert.deepEqual(found, rule.signals);
        console.log(`   ${rows.length} velas en ${seconds} s, ${found.length} señales, diferencia máxima ${worst}`);
      });
    }
  }
}

let failed = 0;
for (const [name, runTest] of tests) {
  try {
    await runTest();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}: ${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
