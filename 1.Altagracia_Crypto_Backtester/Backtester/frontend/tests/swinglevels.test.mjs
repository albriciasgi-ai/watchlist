// Niveles de S&R v2: swings, filtro de volumen, ruptura y recorrido. Uso: node tests/swinglevels.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

const log = console.log;
console.log = () => {};
console.warn = () => {};

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};

const { LevelBook, cleanLevelConfig, closedCount, DEFAULT_LEVEL_CONFIG } = await import('../src/components/indicators/swingLevels.js');
const { default: SupportResistance2, configStorageKey } = await import('../src/components/indicators/SupportResistance2Indicator.js');

const STEP = 900000;
const START = Date.UTC(2026, 0, 5);
const tests = [];
const test = (name, run) => tests.push([name, run]);

// Vela sencilla: alto, bajo, cierre y volumen. La apertura es el cierre anterior
function series(rows) {
  let previous = rows[0].c;
  return rows.map((row, i) => {
    const candle = { timestamp: START + i * STEP, open: previous, high: row.h, low: row.l, close: row.c, volume: row.v ?? 100 };
    previous = row.c;
    return candle;
  });
}
const flat = (count, price = 90, v = 100) => Array.from({ length: count }, () => ({ h: price + 0.2, l: price - 0.2, c: price, v }));
// Un pico aislado: 5 velas más bajas a cada lado
const peak = (high, base = 90, v = 100) => [...flat(5, base), { h: high, l: base - 0.2, c: base + 0.1, v }, ...flat(5, base)];
const dip = (low, base = 90, v = 100) => [...flat(5, base), { h: base + 0.2, l: low, c: base - 0.1, v }, ...flat(5, base)];
const LONG = flat(520);

function levelsOf(rows, config = {}) {
  const candles = series([...LONG, ...rows]);
  const book = new LevelBook({ priceRangePct: 20, ...config });
  book.advance(candles);
  return book.publish(candles);
}
const find = (levels, price, tolerance = 0.02) => levels.find(level => Math.abs(level.price - price) <= tolerance);
const prices = (levels) => levels.map(level => Number(level.price.toFixed(2)));

test('ruptura: el cierre más allá la deja dibujada como rota aunque el precio esté arriba', () => {
  const { resistances } = levelsOf([...flat(10), ...peak(100), ...flat(3, 95), { h: 101.5, l: 99, c: 101 }, ...flat(6, 101)]);
  assert.equal(find(resistances, 100).status, 'broken');
});

test('ruptura: una mecha sin cierre no la rompe', () => {
  const { resistances } = levelsOf([...flat(10), ...peak(100), ...flat(3, 95), { h: 100.6, l: 95, c: 96 }, ...flat(6, 95)]);
  assert.equal(find(resistances, 100).status, 'active');
});

test('ruptura: rota hace más de sus velas ya no se dibuja', () => {
  const rows = [...flat(10), ...peak(100), ...flat(3, 95), { h: 101.5, l: 99, c: 101 }, ...flat(3, 101), { h: 101, l: 94, c: 95 }, ...flat(60, 95)];
  assert.equal(find(levelsOf(rows).resistances, 100), undefined);
});

test('ruptura: justo en el límite de velas sigue, una después no', () => {
  const start = [...flat(10), ...peak(100), ...flat(3, 95), { h: 101.5, l: 99, c: 101 }];
  assert.ok(find(levelsOf([...start, ...flat(3, 95)], { brokenKeepBars: 3 }).resistances, 100));
  assert.equal(find(levelsOf([...start, ...flat(4, 95)], { brokenKeepBars: 3 }).resistances, 100), undefined);
});

test('ruptura: el soporte roto se dibuja con el precio debajo', () => {
  const { supports } = levelsOf([...flat(10), ...dip(80), ...flat(3, 85), { h: 82, l: 78, c: 79 }, ...flat(6, 79)]);
  assert.equal(find(supports, 80).status, 'broken');
});

test('ruptura: un toque propio no rompe su nivel', () => {
  const { resistances } = levelsOf([...flat(10), ...peak(100), ...peak(100.2, 95), ...flat(10, 95)]);
  const level = find(resistances, 100.1, 0.05);
  assert.equal(level.status, 'active');
  assert.equal(level.touches, 2);
});

test('ruptura: cerrar entre el promedio y el toque más alto no rompe', () => {
  const rows = [...flat(10), ...peak(100), ...peak(100.2, 95), ...flat(3, 95), { h: 100.1, l: 95, c: 100.15 }, ...flat(3, 95)];
  assert.equal(find(levelsOf(rows).resistances, 100.1, 0.05).status, 'active');
});

test('ruptura: un swing ya superado no suma a un nivel nuevo en su precio', () => {
  const rows = [...flat(10), ...peak(100), ...flat(3, 95), { h: 103, l: 99, c: 102 }, ...flat(3, 102), { h: 102, l: 94, c: 95 }, ...flat(6, 95), ...peak(100.1, 95), ...flat(6, 95)];
  assert.equal(find(levelsOf(rows).resistances, 100.1).touches, 1);
});

test('grupo: el swing cercano refuerza contra el primer toque, sin cadena', () => {
  // 100.35 está a 0.35% del primer toque, aunque solo a 0.20% del promedio
  const rows = [...flat(10), ...peak(100, 95), ...peak(100.29, 95), ...peak(100.35, 95), ...flat(6, 95)];
  const { resistances } = levelsOf(rows, { clusterDistancePct: 0.3 });
  assert.deepEqual(resistances.map(level => level.touches), [2, 1]);
  assert.deepEqual(prices(resistances), [100.15, 100.35]);
});

test('grupo: guarda el primer y el último toque', () => {
  const candles = series([...LONG, ...peak(100, 95), ...peak(100.2, 95), ...flat(6, 95)]);
  const book = new LevelBook({ priceRangePct: 20 });
  book.advance(candles);
  const [level] = book.publish(candles).resistances;
  assert.equal(level.firstTouch, candles[525].timestamp);
  assert.equal(level.lastTouch, candles[536].timestamp);
});

test('rango: decide lo que se dibuja, no lo que existe', () => {
  const body = Array.from({ length: 60 }, (_, j) => Number((90.1 + 0.25 * j).toFixed(2))).flatMap(price => peak(price, 85));
  const nearest = (close) => {
    const candles = series([...flat(520, 85), ...body, ...flat(60, 85), ...flat(12, close)]);
    const book = new LevelBook({ priceRangePct: 10, maxLevels: 3 });
    book.advance(candles);
    return book.publish(candles).resistances.filter(level => level.status === 'active').map(level => level.price);
  };
  const near = nearest(100);
  const moved = nearest(100.3);
  assert.ok(near.filter(price => price > 100.6).every(price => moved.includes(price)));
});

test('rango: fuera del porcentaje no se dibuja', () => {
  const rows = [...flat(10), ...peak(150), ...flat(6)];
  assert.deepEqual(levelsOf(rows, { priceRangePct: 10 }).resistances, []);
  assert.deepEqual(prices(levelsOf(rows, { priceRangePct: 70 }).resistances), [150]);
});

test('sin futuro: un swing necesita sus velas cerradas a la derecha', () => {
  const rows = [...LONG, ...flat(5), { h: 100, l: 89.8, c: 90 }, ...flat(4)];
  const candles = series(rows);
  const forming = { ...candles[candles.length - 1], timestamp: candles[candles.length - 1].timestamp + STEP, in_progress: true };

  const book = new LevelBook({ priceRangePct: 20 });
  book.advance([...candles, forming]);
  assert.equal(find(book.publish([...candles, forming]).resistances, 100), undefined);

  const closed = series([...rows, ...flat(1)]);
  book.advance(closed);
  assert.ok(find(book.publish(closed).resistances, 100));
});

test('sin futuro: la vela en formación no rompe, solo mueve el precio', () => {
  const candles = series([...LONG, ...peak(100), ...flat(6)]);
  const forming = { timestamp: candles[candles.length - 1].timestamp + STEP, open: 90, high: 120, low: 90, close: 120, volume: 500, in_progress: true };
  const book = new LevelBook({ priceRangePct: 30 });
  book.advance([...candles, forming]);
  const published = book.publish([...candles, forming]);
  assert.equal(published.price, 120);
  assert.equal(find(published.resistances, 100).status, 'active');
});

test('sin futuro: lo calculado antes no depende de velas posteriores', () => {
  const candles = series([...LONG, ...peak(100), ...flat(10), ...peak(102), ...flat(10), { h: 130, l: 90, c: 130 }]);
  const before = new LevelBook({ priceRangePct: 20 });
  before.advance(candles.slice(0, 540));

  const after = new LevelBook({ priceRangePct: 20 });
  after.advance(candles);
  after.advance(candles.slice(0, 540));
  assert.deepEqual(after.publish(candles.slice(0, 540)), before.publish(candles.slice(0, 540)));
});

test('recorrido: vela por vela da lo mismo que de una vez', () => {
  const candles = series([...LONG, ...peak(100), ...flat(3, 95), ...dip(80, 95), { h: 101.5, l: 99, c: 101 }, ...flat(6, 101), ...peak(103, 101)]);
  const stepped = new LevelBook({ priceRangePct: 30 });
  for (let i = 1; i <= candles.length; i += 7) stepped.advance(candles.slice(0, i));
  stepped.advance(candles);

  const whole = new LevelBook({ priceRangePct: 30 });
  whole.advance(candles);
  assert.deepEqual(stepped.publish(candles), whole.publish(candles));
});

test('recorrido: si cambian las velas empieza de cero', () => {
  const first = series([...LONG, ...peak(100), ...flat(6)]);
  const book = new LevelBook({ priceRangePct: 30 });
  book.advance(first);

  const other = first.map(candle => ({ ...candle, timestamp: candle.timestamp + 60000 }));
  const whole = new LevelBook({ priceRangePct: 30 });
  whole.advance(other);
  book.advance(other);
  assert.deepEqual(book.publish(other), whole.publish(other));
});

test('recorrido: las velas ya revisadas no se vuelven a revisar', () => {
  const candles = series([...LONG, ...peak(100), ...flat(6)]);
  const book = new LevelBook();
  let closes = 0;
  const close = book._close.bind(book);
  book._close = (...args) => { closes++; close(...args); };
  book.advance(candles);
  assert.equal(closes, candles.length);
  book.advance(candles);
  book.advance([...candles, { ...candles[0], timestamp: candles[candles.length - 1].timestamp + STEP, in_progress: true }]);
  assert.equal(closes, candles.length);
});

test('recorrido: los rotos viejos salen del libro', () => {
  const rows = [...flat(10), ...peak(100), ...flat(3, 95), { h: 101.5, l: 99, c: 101 }, ...flat(200, 101)];
  const candles = series([...LONG, ...rows]);
  const book = new LevelBook({ priceRangePct: 20 });
  book.advance(candles);
  assert.equal(book.levels.resistance.some(level => level.anchor === 100), false);
});

test('volumen: el filtro quita líneas', () => {
  const rows = [...flat(60), ...peak(100, 90, 100), ...flat(10), ...peak(103, 90, 1500), ...flat(10)];
  assert.deepEqual(prices(levelsOf(rows).resistances), [100, 103]);
  assert.deepEqual(prices(levelsOf(rows, { minVolumeZScore: 2 }).resistances), [103]);
});

test('volumen: cuenta swings hallados y los que pasan, por lado', () => {
  const rows = [...flat(60), ...peak(100, 90, 100), ...flat(10), ...peak(103, 90, 1500), ...dip(80, 90, 100), ...flat(10)];
  const { swings, kept } = levelsOf(rows, { minVolumeZScore: 2 });
  assert.deepEqual(swings, { resistance: 2, support: 1 });
  assert.deepEqual(kept, { resistance: 1, support: 0 });
});

test('volumen: z contra las velas que terminan en el swing, sin cambiar después', () => {
  const start = [...LONG, ...peak(100, 90, 500), ...flat(10)];
  const candles = series([...start, ...flat(80, 90, 20)]);
  const first = new LevelBook({ priceRangePct: 20 });
  first.advance(candles.slice(0, start.length));
  const later = new LevelBook({ priceRangePct: 20 });
  later.advance(candles);

  const now = find(first.publish(candles.slice(0, start.length)).resistances, 100).avgVolumeZScore;
  assert.equal(Number(now.toFixed(6)), 7);
  assert.equal(find(later.publish(candles).resistances, 100).avgVolumeZScore, now);
});

test('volumen: sin historia suficiente el z es 0', () => {
  const candles = series([...flat(5), { h: 100, l: 89.8, c: 90, v: 500 }, ...flat(6)]);
  const book = new LevelBook({ priceRangePct: 20 });
  book.advance(candles);
  assert.equal(book.publish(candles).resistances[0].avgVolumeZScore, 0);

  const filtered = new LevelBook({ priceRangePct: 20, minVolumeZScore: 0.5 });
  filtered.advance(candles);
  assert.deepEqual(filtered.publish(candles).resistances, []);
});

test('volumen: volumen plano no divide entre cero', () => {
  assert.equal(levelsOf([...flat(10), ...peak(100), ...flat(6)]).resistances[0].avgVolumeZScore, 0);
});

test('orden: activos más cercanos primero y cada estado con su límite', () => {
  const rows = [...flat(10), ...peak(106), ...peak(103), ...peak(109), ...peak(101.5), ...flat(6)];
  assert.deepEqual(prices(levelsOf(rows, { maxLevels: 2 }).resistances), [101.5, 103]);
});

test('orden: un roto reciente se ve aunque haya activos de sobra', () => {
  const rows = [...flat(10), ...peak(110, 100), ...peak(109, 100), ...peak(95), ...flat(3, 90), { h: 96, l: 90, c: 95.5 }, ...flat(6, 92)];
  const { resistances } = levelsOf(rows, { maxLevels: 2 });
  assert.deepEqual(resistances.map(level => level.status), ['active', 'active', 'broken']);
});

test('toques: el mínimo deja fuera los niveles de un solo swing', () => {
  const rows = [...flat(10), ...peak(100), ...peak(100.1), ...peak(120), ...flat(6)];
  assert.deepEqual(prices(levelsOf(rows, { priceRangePct: 40, minTouches: 2 }).resistances), [100.05]);
});

test('fuerza: suma toques, volumen y recencia, con tope de 10', () => {
  const rows = [...flat(10), ...peak(100), ...flat(6)];
  const [level] = levelsOf(rows).resistances;
  assert.ok(level.recency > 0.98 && level.recency <= 1);
  assert.equal(level.strength, 2 + level.recency * 3);
});

test('fuerza: mil velas sin toques ya no suman por recientes', () => {
  const [level] = levelsOf([...flat(10), ...peak(100), ...flat(1100)]).resistances;
  assert.equal(level.recency, 0);
  assert.equal(level.strength, 2);
});

test('pocas velas: no falla', () => {
  const book = new LevelBook();
  book.advance([]);
  assert.deepEqual(book.publish([]).resistances, []);
  assert.equal(closedCount([]), 0);
});

const context = (knownCandles) => ({ knownCandles, minPrice: 0, maxPrice: 1000, priceToY: price => price });
const fakeCtx = () => new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });
const bounds = { x: 0, y: 0, width: 100, height: 1000 };
const draw = (indicator, known, all = known) => indicator.renderOverlay(fakeCtx(), bounds, known.slice(-5), all, context(known));

function indicator(name = 'CUENTA', config = {}) {
  const target = new SupportResistance2(name, '15m', 30);
  target.enabled = true;
  target.updateConfig({ priceRangePct: 30, ...config });
  return target;
}

test('indicador: dibuja con lo conocido aunque le pasen las velas futuras', () => {
  const candles = series([...LONG, ...peak(100), ...flat(10), ...peak(102), ...flat(10)]);
  const target = indicator();
  draw(target, candles.slice(0, 540), candles);
  assert.deepEqual(prices(target.resistances), [100]);
});

test('indicador: la vela en formación es la conocida, no la vela final', () => {
  const all = series([...LONG, ...peak(100), ...flat(6), { h: 130, l: 90, c: 130 }]);
  const last = all[all.length - 1];
  const known = [...all.slice(0, -1), { ...last, high: 91, close: 91, in_progress: true }];
  const target = indicator();
  draw(target, known, all);
  assert.equal(target.currentPrice, 91);
});

test('indicador: al retroceder no quedan niveles posteriores', () => {
  const candles = series([...LONG, ...peak(100), ...flat(10), ...peak(102), ...flat(10)]);
  const target = indicator();
  draw(target, candles);
  assert.deepEqual(prices(target.resistances), [100, 102]);
  draw(target, candles.slice(0, 540));
  assert.deepEqual(prices(target.resistances), [100]);
});

test('indicador: un cambio de parámetros se aplica en el siguiente dibujo', () => {
  const candles = series([...LONG, ...flat(60), ...peak(100, 90, 100), ...flat(10), ...peak(103, 90, 1500), ...flat(10)]);
  const target = indicator();
  draw(target, candles);
  assert.equal(target.resistances.length, 2);
  target.updateConfig({ minVolumeZScore: 2 });
  draw(target, candles);
  assert.deepEqual(prices(target.resistances), [103]);
});

test('indicador: el precio de la vela en formación ordena las líneas', () => {
  const candles = series([...LONG, ...peak(95), ...peak(110), ...flat(6)]);
  const forming = { timestamp: candles[candles.length - 1].timestamp + STEP, open: 90, high: 109, low: 90, close: 109, volume: 1, in_progress: true };
  const target = indicator();
  draw(target, [...candles, forming]);
  assert.deepEqual(prices(target.resistances), [110, 95]);
});

test('indicador: mostrar u ocultar etiquetas no toca los parámetros de nivel', () => {
  const target = indicator('ETIQUETA');
  target.updateConfig({ showLabels: false, showSupports: false });
  assert.deepEqual([target.showLabels, target.showSupports, target.showResistances], [false, false, true]);
});

test('indicador: un valor vacío del modal no borra el parámetro', () => {
  const target = indicator('VACIO');
  target.updateConfig({ swingBars: Number.NaN, minVolumeZScore: 1.5 });
  assert.equal(target.swingBars, DEFAULT_LEVEL_CONFIG.swingBars);
  assert.equal(target.minVolumeZScore, 1.5);
});

test('indicador: arranca con lo guardado para el símbolo, en cualquier marco', () => {
  localStorage.setItem(configStorageKey('GUARDADO'), JSON.stringify({ minVolumeZScore: 1.5, swingBars: 7 }));
  for (const interval of ['15m', '4h']) {
    const target = new SupportResistance2('GUARDADO', interval, 30);
    assert.deepEqual([target.minVolumeZScore, target.swingBars, target.maxLevels], [1.5, 7, DEFAULT_LEVEL_CONFIG.maxLevels]);
  }
});

test('indicador: lo guardado dañado no impide arrancar', () => {
  localStorage.setItem(configStorageKey('DANADO'), '{no es json');
  assert.equal(new SupportResistance2('DANADO', '15m', 30).minVolumeZScore, 0);
});

test('indicador: la vista previa no cambia lo dibujado', () => {
  const target = indicator('VISTA');
  assert.equal(target.preview({ minVolumeZScore: 2 }), null);

  const candles = series([...LONG, ...flat(60), ...peak(100, 90, 100), ...flat(10), ...peak(103, 90, 1500), ...flat(10)]);
  draw(target, candles);
  const preview = target.preview({ minVolumeZScore: 2 });
  assert.deepEqual([preview.swings.resistance, preview.kept.resistance, preview.resistances.length], [2, 1, 1]);
  assert.equal(target.resistances.length, 2);
  assert.equal(target.minVolumeZScore, 0);

  draw(target, candles);
  assert.equal(target.resistances.length, 2);
});

test('indicador: dibuja toda línea que cae en el área de precio', () => {
  const target = indicator('AREA');
  target.resistances = [{ price: 100, touches: 1, strength: 2, avgVolumeZScore: 0, status: 'active' }];
  const lines = [];
  const ctx = new Proxy({}, { get: (object, key) => (key === 'moveTo' ? (x, y) => lines.push(y) : () => {}), set: () => true });
  const area = { x: 10, y: 25, width: 100, height: 200 };
  const at = (y) => target._drawLevel(ctx, target.resistances[0], 'resistance', area, { priceToY: () => y }, 0);

  at(26);
  at(224);
  at(24);
  at(226);
  assert.deepEqual(lines, [26, 224]);
});

test('indicador: apagado no calcula', () => {
  const target = indicator('APAGADO');
  target.enabled = false;
  draw(target, series([...LONG, ...peak(100), ...flat(6)]));
  assert.deepEqual(target.resistances, []);
  assert.equal(target._book, null);
});

test('indicador: al limpiar queda sin niveles y vuelve a calcular', () => {
  const target = indicator('LIMPIA');
  const candles = series([...LONG, ...peak(100), ...flat(6)]);
  draw(target, candles);
  target.clearData();
  assert.deepEqual(target.selectableLevels(), []);
  draw(target, candles);
  assert.deepEqual(prices(target.resistances), [100]);
});

// ---- Rehacer el libro rápido

/** La regla sin atajos: revisa todos los niveles en cada vela */
class EveryLevelBook extends LevelBook {
  _breakLevels(side, { beyond }, close, index) {
    for (const level of this.levels[side]) {
      if (level.brokenAt === null && beyond(close, level.extreme)) level.brokenAt = index;
    }
  }
}

function walk(count, seed) {
  let state = seed;
  const random = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let price = 100;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    price = Math.max(20, price + (random() - 0.5) * 4);
    return {
      timestamp: START + i * STEP, open, close: price,
      high: Math.max(open, price) + random(), low: Math.min(open, price) - random(), volume: 50 + random() * 500
    };
  });
}

test('libro: saltar los niveles lejanos da lo mismo que revisarlos todos', () => {
  const configs = [{}, { swingBars: 2, clusterDistancePct: 0.1 }, { swingBars: 3, clusterDistancePct: 2, minTouches: 2 }, { minVolumeZScore: 1 }, { maxLevels: 20, priceRangePct: 20 }];
  configs.forEach((config, i) => {
    const candles = walk(4000, 11 + i);
    const fast = new LevelBook(config);
    const plain = new EveryLevelBook(config);
    for (let end = 60; end <= candles.length; end += 23) {
      const known = candles.slice(0, end);
      fast.advance(known);
      plain.advance(known);
      assert.deepEqual(fast.publish(known), plain.publish(known), `vela ${end} con ${JSON.stringify(config)}`);
    }
  });
});

test('libro: al retroceder sigue igual que revisarlos todos', () => {
  const candles = walk(1500, 5);
  const fast = new LevelBook();
  const plain = new EveryLevelBook();
  for (const end of [1200, 400, 900, 300, 1500]) {
    const known = candles.slice(0, end);
    fast.advance(known);
    plain.advance(known);
    assert.deepEqual(fast.publish(known), plain.publish(known), `vela ${end}`);
  }
});

test('libro: sin llegar al nivel más cercano no recorre los demás', () => {
  const book = new LevelBook();
  const level = { extreme: 100, brokenAt: null };
  book.levels.resistance = [level];
  book.nearest.resistance = 150;
  book._breakLevels('resistance', { beyond: (a, b) => a > b }, 120, 5);
  assert.equal(level.brokenAt, null);
});

test('libro: al romperse el nivel más cercano recuerda el siguiente', () => {
  const book = new LevelBook();
  book.levels.resistance = [{ extreme: 100, brokenAt: null }, { extreme: 120, brokenAt: null }];
  book.nearest.resistance = 100;
  book._breakLevels('resistance', { beyond: (a, b) => a > b }, 110, 5);
  assert.deepEqual(book.levels.resistance.map(level => level.brokenAt), [5, null]);
  assert.equal(book.nearest.resistance, 120);
});

// ---- Parámetros

test('parámetros: lo guardado vacío no se aplica al abrir', () => {
  const empty = { swingBars: null, maxLevels: null, priceRangePct: null, clusterDistancePct: null, volumeLookbackBars: null };
  localStorage.setItem(configStorageKey('NULO'), JSON.stringify({ ...empty, minVolumeZScore: 1.5 }));
  const target = new SupportResistance2('NULO', '15m', 30);
  Object.keys(empty).forEach(key => assert.equal(target[key], DEFAULT_LEVEL_CONFIG[key], key));
  assert.equal(target.minVolumeZScore, 1.5);
});

test('parámetros: con lo guardado vacío sigue dibujando niveles', () => {
  localStorage.setItem(configStorageKey('NULO2'), JSON.stringify({ swingBars: null, maxLevels: null, priceRangePct: null }));
  const target = new SupportResistance2('NULO2', '15m', 30);
  target.enabled = true;
  draw(target, series([...LONG, ...peak(95), ...flat(10)]));
  assert.equal(target.resistances.length, 1);
});

test('parámetros: fuera de rango quedan en el límite que anuncia el modal', () => {
  assert.deepEqual(cleanLevelConfig({
    swingBars: 0, clusterDistancePct: 0, minTouches: 0, maxLevels: 0, priceRangePct: 0, volumeLookbackBars: 1, minVolumeZScore: -1
  }), { swingBars: 2, clusterDistancePct: 0.1, minTouches: 1, maxLevels: 1, priceRangePct: 1, volumeLookbackBars: 20, minVolumeZScore: 0 });
  assert.deepEqual(cleanLevelConfig({
    swingBars: 99, clusterDistancePct: 9, minTouches: 99, maxLevels: 99, priceRangePct: 99, volumeLookbackBars: 999, minVolumeZScore: 9
  }), { swingBars: 15, clusterDistancePct: 2, minTouches: 10, maxLevels: 20, priceRangePct: 20, volumeLookbackBars: 200, minVolumeZScore: 3 });
});

test('parámetros: dentro del rango no cambian', () => {
  const config = { swingBars: 7, clusterDistancePct: 0.5, minTouches: 3, maxLevels: 8, priceRangePct: 12.5, volumeLookbackBars: 60, minVolumeZScore: 1.5, brokenKeepBars: 30 };
  assert.deepEqual(cleanLevelConfig(config), config);
});

test('parámetros: solo acepta números', () => {
  assert.deepEqual(cleanLevelConfig({ swingBars: '7', maxLevels: Number.POSITIVE_INFINITY, priceRangePct: undefined, otro: 5 }), {});
});

test('parámetros: la vista previa no se rompe con lo que se esté escribiendo', () => {
  const target = indicator('ESCRIBE');
  draw(target, series([...LONG, ...peak(100), ...flat(10)]));
  for (const swingBars of [-1, 0, Number.NaN, 2.0]) assert.ok(target.preview({ swingBars }), String(swingBars));
});

test('parámetros: una casilla solo acepta sí o no', () => {
  const target = indicator('CASILLA');
  target.updateConfig({ showLabels: null, showSupports: 'no' });
  assert.deepEqual([target.showLabels, target.showSupports], [true, true]);
});

test('parámetros: lo aplicado se guarda y vuelve igual en otro marco', () => {
  const target = indicator('APLICADO');
  target.updateConfig({ swingBars: 7, maxLevels: Number.NaN, showLabels: false });
  localStorage.setItem(configStorageKey('APLICADO2'), JSON.stringify(target.currentConfig()));
  const again = new SupportResistance2('APLICADO2', '1h', 30);
  assert.deepEqual(again.currentConfig(), target.currentConfig());
  assert.deepEqual([again.swingBars, again.showLabels], [7, false]);
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
