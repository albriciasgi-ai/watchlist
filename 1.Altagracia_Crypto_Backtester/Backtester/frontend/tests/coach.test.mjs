// Estado de App 1 para el entrenador (/entrenar). Uso: node tests/coach.test.mjs
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

const { buildCoachState, installCoach } = await import('../src/components/backtesting/coachState.js');
const blind = await import('../src/components/backtesting/blindClock.js');
const levels = await import('../src/components/indicators/analysisLevels.js');

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; log(`ok - ${name}`); };

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 25, 15, 0); // 10:00 en Colombia
const candles = Array.from({ length: 40 }, (_, i) => ({
  timestamp: T0 + i * 15 * MIN, open: 80000 + i, high: 80010 + i, low: 79990 + i, close: 80005 + i, volume: 100 + i
}));
const now = candles[34].timestamp + 5 * MIN; // Las velas 35 en adelante son futuro
const chart = {
  getVisibleCandles: () => candles, // Aunque el gráfico tuviera velas posteriores, no salen
  getIndicatorManager: () => ({ indicators: [{ name: 'Order Flow', config: { ratio: 3, fn: () => 1, nested: { step: 10 } } }] })
};
const orders = [
  { side: 'long', type: 'limit', status: 'pending', entryPrice: 79900, stopLoss: 79800, takeProfit: 80200, quantity: 0.01, entryTime: now - MIN, tradeNumber: null },
  { side: 'short', type: 'market', status: 'closed', entryPrice: 80100, executedPrice: 80100, stopLoss: 80300, takeProfit: 79700, quantity: 0.02, entryTime: T0, executedAt: T0, exitPrice: 79700, exitTime: T0 + 60 * MIN, pnl: 8, pnlPercent: 0.5, tradeNumber: 1 },
  { side: 'long', type: 'limit', status: 'cancelled', entryPrice: 79000, quantity: 1, entryTime: T0 }
];
const app = {
  symbol: 'BTCUSDT', timeframe: '15m', currentTime: now, currentPrice: 80039, playing: false, speed: 100,
  indicatorStates: { 'Order Flow': true, VWAP: false }, chart, orders,
  shapes: [{ type: 'tpsl', id: 'box1', entryPrice: 80000, slPrice: 79900, tpPrice: 80300 }]
};

test('sin simulación avisa y no da nada', () => {
  assert.equal(buildCoachState({ symbol: '', currentTime: null }).listo, false);
});

test('solo lo ocurrido hasta la hora a la vista', () => {
  const s = buildCoachState(app);
  assert.equal(s.listo, true);
  assert.equal(s.velasALaVista, 35);
  assert.equal(s.ultimasVelas.length, 30);
  assert.equal(s.ultimasVelas.at(-1).c, 80039);
  assert.equal(s.query.end_timestamp, candles[34].timestamp);
  assert.equal(s.query.known_until, now);
  assert.equal(s.hora, '2026-10-25 18:35 COL');
});

test('indicadores encendidos con sus ajustes, sin funciones', () => {
  const s = buildCoachState(app);
  assert.deepEqual(s.indicadores, [{ nombre: 'Order Flow', ajustes: { ratio: 3, nested: { step: 10 } } }]);
});

test('órdenes vivas, cerradas y caja libre; las canceladas no', () => {
  const s = buildCoachState(app);
  assert.equal(s.ordenesVivas.length, 1);
  assert.equal(s.ordenesVivas[0].lado, 'compra');
  assert.equal(s.ultimasCerradas[0].lado, 'venta');
  assert.equal(s.ultimasCerradas[0].resultado, 'ganó');
  assert.deepEqual(s.cajaTPSL, { lado: 'compra', entrada: 80000, stop: 79900, objetivo: 80300 });
});

test('lo elegido después de la hora a la vista no sale', () => {
  levels.toggleLevel('BTCUSDT', { id: 'a', source: 'VP', kind: 'POC', price: 80000 }, now - MIN, '15m', 80039);
  levels.toggleLevel('BTCUSDT', { id: 'b', source: 'VP', kind: 'VAH', price: 80100 }, now + MIN, '15m', 80039);
  const s = buildCoachState(app);
  assert.equal(s.elegidoParaElAnalisis.length, 1);
  assert.equal(s.elegidoParaElAnalisis[0].precio, 80000);
});

test('con fecha oculta: días relativos, precio como índice y sin P&L en dólares', () => {
  blind.setBlindAnchor(T0);
  blind.setBlindScale({ ref: 80000, base: 100, volRef: 100 });
  const s = buildCoachState(app);
  assert.equal(s.fechaOculta, true);
  assert.match(s.hora, /^Día 0 /);
  assert.ok(!JSON.stringify({ ...s, query: null }).includes('2026'));
  assert.equal(s.cajaTPSL.entrada, 100);
  assert.equal(s.ultimasVelas.at(-1).v, 1340);
  assert.equal(s.ultimasCerradas[0].pnl, undefined);
  blind.setBlindAnchor(null);
  blind.setBlindScale(null);
});

test('installCoach pone y quita window.__app1Coach', () => {
  const target = {};
  const remove = installCoach(() => app, target);
  assert.equal(target.__app1Coach.state().moneda, 'BTCUSDT');
  assert.equal(target.__app1Coach.price(80000), 80000);
  remove();
  assert.equal(target.__app1Coach, undefined);
});

// Lo que dibuja el entrenador (23/11): una capa aparte, en lo que ve el usuario y sin futuro
const { normalizeNotes, coachNotes, coachDraw, coachClear, onCoachNotes } = await import('../src/components/backtesting/coachState.js');
const closed = candles.filter(c => c.timestamp <= now); // 35 velas: la última es la 34

test('figuras: línea, zona y marca en velas contadas hacia atrás', () => {
  const { items, rechazadas } = normalizeNotes([
    { tipo: 'linea', precio: 80020, texto: '  POC   de la sesión ' },
    { tipo: 'zona', desde: 80040, hasta: 80010, velasAtras: 5, texto: 'apilados' },
    { tipo: 'marca', velasAtras: 0, texto: 'absorción' },
    { tipo: 'marca', velasAtras: 3, precio: 80000 }
  ], closed);
  assert.deepEqual(rechazadas, []);
  assert.deepEqual(items[0], { kind: 'line', price: 80020, time: closed[0].timestamp, text: 'POC de la sesión' });
  assert.deepEqual(items[1], { kind: 'zone', low: 80010, high: 80040, time: closed[29].timestamp, text: 'apilados' });
  assert.deepEqual(items[2], { kind: 'mark', price: closed[34].high, above: true, time: closed[34].timestamp, text: 'absorción' });
  assert.equal(items[3].above, false);
  assert.ok(items.every(item => item.time <= now), 'nada después de la hora a la vista');
});

test('figuras: se rechaza lo desconocido, lo lejano, lo que no está a la vista y lo que pasa del máximo', () => {
  const { items, rechazadas } = normalizeNotes([
    { tipo: 'flecha', precio: 80000 },
    { tipo: 'linea', precio: 250000 },
    { tipo: 'linea', precio: 'abc' },
    { tipo: 'zona', desde: 80000 },
    { tipo: 'marca', texto: 'sin vela' },
    { tipo: 'marca', velasAtras: 35 },
    { tipo: 'marca', velasAtras: -1 },
    { tipo: 'linea', precio: 80000, texto: 'x'.repeat(200) }
  ], closed);
  assert.equal(items.length, 1);
  assert.equal(items[0].text.length, 80);
  assert.equal(rechazadas.length, 7);
  assert.equal(normalizeNotes([{ tipo: 'linea', precio: 80000 }], []).items.length, 0);
  const many = normalizeNotes(Array.from({ length: 25 }, () => ({ tipo: 'linea', precio: 80000 })), closed);
  assert.equal(many.items.length, 20);
  assert.equal(many.rechazadas.length, 5);
});

test('dibujar reemplaza o suma, avisa al gráfico y solo cuenta velas ya ocurridas', () => {
  let redraws = 0;
  let heard = 0;
  const stop = onCoachNotes(() => { heard += 1; });
  const drawApp = { ...app, chart: { ...chart, redraw: () => { redraws += 1; } } };
  const first = coachDraw(drawApp, [{ tipo: 'linea', precio: 80020, texto: 'uno' }, { tipo: 'marca', velasAtras: 36 }]);
  assert.deepEqual({ listo: first.listo, dibujadas: first.dibujadas, rechazadas: first.rechazadas.length }, { listo: true, dibujadas: 1, rechazadas: 1 });
  assert.equal(coachNotes('BTCUSDT').length, 1);
  assert.equal(coachNotes('ETHUSDT').length, 0, 'son de la moneda en que se dibujaron');
  // velasAtras 0 es la última vela ya ocurrida (la 34), aunque el gráfico tenga velas posteriores
  coachDraw(drawApp, { tipo: 'marca', velasAtras: 0, texto: 'dos' }, { sumar: true });
  assert.equal(coachNotes('BTCUSDT').length, 2);
  assert.equal(coachNotes('BTCUSDT')[1].time, candles[34].timestamp);
  coachDraw(drawApp, [{ tipo: 'linea', precio: 80030 }]);
  assert.equal(coachNotes('BTCUSDT').length, 1, 'sin `sumar`, reemplaza');
  assert.equal(coachClear(drawApp).dibujadas, 0);
  assert.equal(coachNotes('BTCUSDT').length, 0);
  assert.equal(redraws, 4);
  assert.equal(heard, 4);
  stop();
  assert.equal(coachDraw({}, []).listo, false);
});

test('con fecha oculta se dibuja con el precio que ve el usuario (el índice)', () => {
  blind.setBlindAnchor(T0);
  blind.setBlindScale({ ref: 80000, base: 100, volRef: 100 });
  const { items, rechazadas } = normalizeNotes([{ tipo: 'linea', precio: 100.05 }, { tipo: 'linea', precio: 80040 }], closed);
  assert.equal(items.length, 1);
  assert.ok(Math.abs(items[0].price - 80040) < 1e-6);
  assert.equal(rechazadas.length, 1, 'un precio real, con fecha oculta, queda lejísimos del índice');
  blind.setBlindAnchor(null);
  blind.setBlindScale(null);
});

test('window.__app1Coach trae draw y clearDrawings', () => {
  const target = {};
  const remove = installCoach(() => app, target);
  assert.equal(target.__app1Coach.version, 2);
  assert.equal(target.__app1Coach.draw([{ tipo: 'linea', precio: 80010, texto: 'nivel' }]).dibujadas, 1);
  assert.equal(target.__app1Coach.clearDrawings().dibujadas, 0);
  remove();
});

log(`${passed} pruebas pasaron`);
