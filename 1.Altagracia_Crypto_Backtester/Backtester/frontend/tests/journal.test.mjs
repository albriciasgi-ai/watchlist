// Journal de trades: líneas, imágenes y sesión. Uso: node tests/journal.test.mjs
import assert from 'node:assert/strict';
import OrderManager from '../src/components/backtesting/OrderManager.js';
import SessionManager from '../src/components/backtesting/SessionManager.js';
import {
  EXIT_CAPTURE_CANDLES, candlesToFrame, exitCaptureTime, exitCapturesDue, tradeBoundaries, tradeStats
} from '../src/components/backtesting/tradeJournal.js';

console.log = ((log) => (...args) => {
  if (typeof args[0] === 'string' && /^(ok |FALLA |\d+ de )/.test(args[0])) log(...args);
})(console.log);
console.warn = () => {};

const MINUTE = 60000;
const START = Date.UTC(2026, 5, 3, 15, 0);
const tests = [];
const test = (name, run) => tests.push([name, run]);

const market = (manager, extra = {}) => manager.createOrder({
  type: 'market', side: 'long', quantity: 0.01, entryPrice: 100, currentPrice: 100, currentTime: START, ...extra
});
const limit = (manager, extra = {}) => manager.createOrder({
  type: 'limit', side: 'long', quantity: 0.01, entryPrice: 90, currentPrice: 100, currentTime: START, ...extra
});

test('línea: una orden de mercado se marca al abrir', () => {
  const manager = new OrderManager();
  const order = market(manager);
  assert.deepEqual(tradeBoundaries(manager.orders), [{ entryTime: START, exitTime: null, tradeNumber: order.id }]);
});

test('línea: una orden limit pendiente todavía no tiene línea', () => {
  const manager = new OrderManager();
  limit(manager);
  assert.deepEqual(tradeBoundaries(manager.orders), []);
});

test('línea: una orden limit se marca cuando se ejecuta, no cuando se crea', () => {
  const manager = new OrderManager();
  const order = limit(manager);
  manager.executePendingOrder(order, 90, START + 45 * MINUTE);
  assert.equal(tradeBoundaries(manager.orders)[0].entryTime, START + 45 * MINUTE);
});

test('línea: al cerrar agrega la salida', () => {
  const manager = new OrderManager();
  const order = market(manager);
  manager.closeOrder(order.id, 110, START + 30 * MINUTE);
  assert.equal(tradeBoundaries(manager.orders)[0].exitTime, START + 30 * MINUTE);
});

test('línea: una orden cancelada no deja línea', () => {
  const manager = new OrderManager();
  const order = limit(manager);
  manager.cancelPendingOrder(order.id);
  assert.deepEqual(tradeBoundaries(manager.orders), []);
});

test('línea: una orden de una sesión vieja sin ejecución usa la hora de entrada', () => {
  const [line] = tradeBoundaries([{ id: 7, status: 'open', entryTime: START }]);
  assert.deepEqual(line, { entryTime: START, exitTime: null, tradeNumber: 7 });
});

test('línea: sin órdenes no hay nada que dibujar', () => {
  assert.deepEqual(tradeBoundaries(undefined), []);
});

test('apertura: la orden de mercado avisa una vez', () => {
  const manager = new OrderManager();
  const opened = [];
  manager.on('tradeOpened', ({ order }) => opened.push(order.id));
  const order = market(manager);
  assert.deepEqual(opened, [order.id]);
});

test('apertura: la orden limit avisa al ejecutarse, ya con su caja TP/SL', () => {
  const manager = new OrderManager();
  const steps = [];
  manager.onOrderExecuted = () => steps.push('caja');
  manager.on('tradeOpened', ({ order }) => steps.push(`abierto ${order.executedAt}`));
  const order = limit(manager);
  assert.deepEqual(steps, [], 'crear la orden no abre el trade');
  manager.executePendingOrder(order, 90, START + MINUTE);
  assert.deepEqual(steps, ['caja', `abierto ${START + MINUTE}`]);
});

test('cierre: la imagen toca varias velas después, según el marco', () => {
  assert.ok(EXIT_CAPTURE_CANDLES >= 5, 'varias velas');
  assert.equal(exitCaptureTime(START, 15 * MINUTE), START + EXIT_CAPTURE_CANDLES * 15 * MINUTE);
  assert.equal(exitCaptureTime(START, 60 * MINUTE), START + EXIT_CAPTURE_CANDLES * 60 * MINUTE);
});

test('cierre: solo se toma al llegar a su hora', () => {
  const order = { id: 1, exitCaptureAt: START };
  assert.deepEqual(exitCapturesDue([order], START - 1), []);
  assert.deepEqual(exitCapturesDue([order], START), [order]);
  assert.deepEqual(exitCapturesDue([order], START + MINUTE), [order], 'a alta velocidad el tiempo puede pasarse');
});

test('cierre: un trade sin imagen pendiente no se vuelve a tomar', () => {
  assert.deepEqual(exitCapturesDue([{ id: 1, exitCaptureAt: null }], START), []);
  assert.deepEqual(exitCapturesDue([{ id: 2 }], START), [], 'órdenes de sesiones viejas');
  assert.deepEqual(exitCapturesDue(undefined, START), []);
});

test('cierre: cada trade espera su propia hora', () => {
  const first = { id: 1, exitCaptureAt: START };
  const second = { id: 2, exitCaptureAt: START + 60 * MINUTE };
  assert.deepEqual(exitCapturesDue([first, second], START + MINUTE), [first]);
});

test('encuadre: un trade corto deja 20 velas antes de la entrada', () => {
  assert.equal(candlesToFrame(15), 35);
  assert.equal(candlesToFrame(1), 21);
});

test('encuadre: un trade largo deja una cuarta parte de contexto', () => {
  assert.equal(candlesToFrame(400), 500);
  assert.equal(candlesToFrame(401), 502);
});

test('sesión: una imagen de cierre pendiente sigue pendiente al cargar', () => {
  const manager = new OrderManager();
  const order = market(manager);
  assert.equal(order.exitCaptureAt, null, 'la orden nace sin imagen pendiente');
  assert.equal(order.exitScreenshotPath, null);
  manager.closeOrder(order.id, 110, START + 30 * MINUTE);
  order.exitCaptureAt = START + 180 * MINUTE;

  const restored = new OrderManager();
  restored.importFromJSON(JSON.parse(JSON.stringify(manager.exportToJSON())));
  assert.deepEqual(exitCapturesDue(restored.closedOrders, START + 179 * MINUTE), []);
  assert.equal(exitCapturesDue(restored.closedOrders, START + 180 * MINUTE)[0].id, order.id);
});

test('sesión: los datos del trade sobreviven a guardar y cargar', () => {
  const manager = new OrderManager();
  const order = market(manager, { stopLoss: 95, takeProfit: 120, notes: 'zona POC' });
  Object.assign(order, {
    marks: { context: 'alcista' }, observerId: 'obs-1', tpslBoxId: 'tpsl_1', screenshotPath: 'session_1/order_1.png', screenshotCaptured: true,
    screenshotTimestamp: 123, screenshotMetadata: { width: 800, height: 400, size: 5000 },
    exitScreenshotPath: 'session_1/order_2.png', exitScreenshotTimestamp: 456, exitScreenshotMetadata: { width: 800, height: 400, size: 6000 }
  });
  manager.closeOrder(order.id, 110, START + 30 * MINUTE, 'take_profit');
  const pending = limit(manager, { notes: 'pendiente' });

  const restored = new OrderManager();
  restored.importFromJSON(JSON.parse(JSON.stringify(manager.exportToJSON())));

  assert.deepEqual(restored.orders, JSON.parse(JSON.stringify(manager.orders)));
  assert.deepEqual(tradeBoundaries(restored.orders), tradeBoundaries(manager.orders));
  assert.equal(restored.closedOrders[0].screenshotPath, 'session_1/order_1.png');
  assert.equal(restored.closedOrders[0].exitScreenshotPath, 'session_1/order_2.png');
  assert.equal(restored.closedOrders[0].closeReason, 'take_profit');
  assert.equal(restored.pendingOrders[0].id, pending.id);
  assert.equal(restored.currentBalance, manager.currentBalance);
});

test('sesión: un trade abierto conserva su caja para extenderla al cerrar', () => {
  const manager = new OrderManager();
  const order = market(manager);
  assert.equal(order.tpslBoxId, null, 'la orden nace sin caja');
  order.tpslBoxId = 'tpsl_9';
  const restored = new OrderManager();
  restored.importFromJSON(JSON.parse(JSON.stringify(manager.exportToJSON())));
  assert.equal(restored.openOrders[0].tpslBoxId, 'tpsl_9');
});

test('resumen: cuenta trades cerrados y porcentaje ganador', () => {
  const orders = [
    { status: 'closed', pnl: 5 }, { status: 'closed', pnl: -2 }, { status: 'closed', pnl: 1 }, { status: 'closed', pnl: 0 },
    { status: 'open', pnl: 9 }, { status: 'pending', pnl: 0 }
  ];
  assert.deepEqual(tradeStats(orders), { totalTrades: 4, winRate: '50.00' });
  assert.deepEqual(tradeStats([]), { totalTrades: 0, winRate: 0 });
});

function memorySessions(saved = null) {
  const sessions = new SessionManager();
  const writes = [];
  sessions.loadSession = async () => saved;
  sessions.saveSession = async (data) => {
    writes.push(data);
    saved = data;
    return data;
  };
  return { sessions, writes };
}

const state = (extra = {}) => ({
  sessionId: 's1', sessionName: 'Sesión 6/11/2026', createdAt: 2000, symbol: 'BTCUSDT',
  orderManagerState: { orders: [{ status: 'closed', pnl: 4 }, { status: 'closed', pnl: -1 }] }, ...extra
});

test('guardado: una sesión nueva nace con su resumen', async () => {
  const { sessions, writes } = memorySessions();
  await sessions.mergeSession(state());
  assert.equal(writes[0].sessionName, 'Sesión 6/11/2026');
  assert.equal(writes[0].createdAt, 2000);
  assert.deepEqual(writes[0].metadata, { totalTrades: 2, winRate: '50.00' });
});

test('guardado: no pierde el nombre, la fecha ni las notas de la sesión', async () => {
  const { sessions, writes } = memorySessions({
    sessionId: 's1', sessionName: 'Junio con perfil', createdAt: 1000, metadata: { tags: ['perfil'], notes: 'probar 15m', totalTrades: 0, winRate: 0 }
  });
  await sessions.mergeSession(state());
  assert.equal(writes[0].sessionName, 'Junio con perfil');
  assert.equal(writes[0].createdAt, 1000);
  assert.deepEqual(writes[0].metadata, { tags: ['perfil'], notes: 'probar 15m', totalTrades: 2, winRate: '50.00' });
  assert.equal(writes[0].orderManagerState.orders.length, 2, 'las órdenes son las actuales');
});

test('guardado: el automático usa la misma protección', async () => {
  const { sessions, writes } = memorySessions({ sessionId: 's1', sessionName: 'Junio', createdAt: 1000, metadata: { notes: 'nota' } });
  sessions.enableAutoSave('s1', () => state({ sessionName: 'Otro' }), 0.01);
  await new Promise(resolve => setTimeout(resolve, 40));
  sessions.disableAutoSave();
  assert.ok(writes.length > 0);
  assert.equal(writes[0].sessionName, 'Junio');
  assert.equal(writes[0].metadata.notes, 'nota');
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
