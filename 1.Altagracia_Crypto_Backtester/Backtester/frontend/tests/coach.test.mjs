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

log(`${passed} pruebas pasaron`);
