// Journal de trades: líneas, imágenes y sesión. Uso: node tests/journal.test.mjs
import assert from 'node:assert/strict';
import OrderManager, { numberTrades } from '../src/components/backtesting/OrderManager.js';
import SessionManager from '../src/components/backtesting/SessionManager.js';
import {
  CaptureHold, EXIT_CAPTURE_CANDLES, candlesToFrame, contextBarWidth, exitCaptureTime, exitCapturesDue, tradeBoundaries, tradeStats, viewIncluding
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

test('número: una orden cancelada no gasta número de trade', () => {
  const manager = new OrderManager();
  const first = market(manager);
  const cancelled = limit(manager);
  manager.cancelPendingOrder(cancelled.id);
  const second = market(manager);
  assert.equal(first.tradeNumber, 1);
  assert.equal(cancelled.tradeNumber, undefined);
  assert.equal(second.tradeNumber, 2, 'el siguiente sigue en 2 aunque su orden sea la 3');
  assert.equal(second.id, 3);
  assert.deepEqual(tradeBoundaries(manager.orders).map(line => line.tradeNumber), [1, 2]);
});

test('número: una limit recibe número al ejecutarse, no al crearse', () => {
  const manager = new OrderManager();
  const waiting = limit(manager);
  const now = market(manager);
  manager.executePendingOrder(waiting, 90, START + 45 * MINUTE);
  assert.equal(now.tradeNumber, 1);
  assert.equal(waiting.tradeNumber, 2);
});

test('número: una sesión vieja se numera por hora de ejecución, sin contar canceladas', () => {
  const orders = [
    { id: 1, status: 'closed', executedAt: START },
    { id: 2, status: 'cancelled', executedAt: null },
    { id: 3, status: 'closed', executedAt: START + 3 * MINUTE },
    { id: 4, status: 'open', executedAt: START + 2 * MINUTE },
    { id: 5, status: 'pending', executedAt: null }
  ];
  assert.equal(numberTrades(orders), 4);
  assert.deepEqual(orders.map(order => order.tradeNumber), [1, undefined, 3, 2, undefined]);
  const manager = new OrderManager();
  manager.importFromJSON({ initialBalance: 1000, currentBalance: 1000, orders });
  assert.equal(market(manager).tradeNumber, 4);
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

test('contexto: la primera imagen muestra unas 5 veces las velas a la vista', () => {
  assert.equal(contextBarWidth(160), 32);
  assert.equal(contextBarWidth(40), 8);
  assert.equal(contextBarWidth(15), 3);
});

test('contexto: sin velas de menos de 3 px y sin acercar la vista', () => {
  assert.equal(contextBarWidth(8), 3);
  assert.equal(contextBarWidth(3), 3);
  assert.equal(contextBarWidth(2), 2);
  assert.equal(contextBarWidth(0.5), 0.5);
});

test('encuadre: la imagen se aleja hasta la marca más vieja sin mover el borde derecho', () => {
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, 850, 950), { offset: 0, count: 153 });
});

test('encuadre: si todo se ve, la imagen no cambia', () => {
  assert.equal(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, 950, 990), null);
  assert.equal(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, null, null), null);
});

test('encuadre: una marca pegada al borde deja velas de aire', () => {
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, 901, null), { offset: 0, count: 102 });
});

test('encuadre: al alejarse mucho, el aire junto a la marca crece con las velas que abarca', () => {
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 200, offset: 0 }, 500, null, 0.02), { offset: 0, count: 510 });
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, 850, null, 0.02), { offset: 0, count: 153 }, 'cerca, el mínimo de 3 velas');
});

test('encuadre: una marca a más de 3 veces las velas no aleja la imagen', () => {
  assert.equal(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, 500, null), null);
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 0 }, 703, null), { offset: 0, count: 300 }, 'justo en el límite sí');
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 200 }, 100, 850), { offset: 146, count: 154 }, 'el otro lado sí se mueve');
});

test('encuadre: con la vista corrida, lo que queda a la derecha mueve el borde derecho y conserva lo que se veía', () => {
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 200 }, null, 850), { offset: 146, count: 154 });
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 200 }, 600, 850), { offset: 146, count: 257 });
});

test('encuadre: no pasa del inicio ni del final de las velas', () => {
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 400, offset: 0 }, 1, null), { offset: 0, count: 1000 });
  assert.deepEqual(viewIncluding({ length: 1000, perScreen: 100, offset: 10 }, null, 999), { offset: 0, count: 110 });
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

// ---- Llenado y cierre

const candleAt = (minute, low, high, close = high) => ({ timestamp: START + minute * MINUTE, open: close, high, low, close, volume: 1 });
const settle = (manager, candle) => manager.updateOrders(candle, candle.timestamp + MINUTE);
const limitOrder = (manager) => manager.createOrder({
  type: 'limit', side: 'long', quantity: 1, entryPrice: 100, currentPrice: 105, currentTime: START, stopLoss: 95, takeProfit: 103
});

test('orden: una vela anterior al llenado no la cierra aunque se repita', () => {
  const manager = new OrderManager(10000);
  const order = limitOrder(manager);
  const before = candleAt(2, 102, 103.2);

  settle(manager, before);
  settle(manager, candleAt(4, 100, 101));
  assert.equal(order.status, 'open');

  settle(manager, before);
  assert.equal(order.status, 'open');

  settle(manager, candleAt(6, 101, 103.5));
  assert.equal(order.status, 'closed');
  assert.equal(order.exitTime, START + 7 * MINUTE);
});

test('orden: la vela del llenado revisa su stop en el mismo paso', () => {
  const manager = new OrderManager(10000);
  const order = limitOrder(manager);
  settle(manager, candleAt(4, 94, 101, 96));
  assert.equal(order.status, 'closed');
  assert.equal(order.closeReason, 'stop_loss');
  assert.equal(order.exitTime, order.executedAt);
});

// ---- Retención del reloj

const turn = () => new Promise(resolve => setTimeout(resolve, 5));

function holdClock(isPlaying = true) {
  return { isPlaying, plays: 0, pause() { this.isPlaying = false; }, play() { this.isPlaying = true; this.plays++; } };
}

test('retención: detiene el reloj hasta copiar el gráfico, sin esperar la subida', async () => {
  const clock = holdClock();
  const hold = new CaptureHold(() => clock, 0);
  let uploaded;
  hold.run(async (release) => {
    assert.equal(clock.isPlaying, false);
    release();
    await new Promise(resolve => { uploaded = resolve; });
  });
  assert.equal(clock.isPlaying, false);
  await turn();
  assert.equal(clock.isPlaying, true);
  uploaded();
});

test('retención: sin aviso el reloj sigue cuando termina la imagen', async () => {
  const clock = holdClock();
  new CaptureHold(() => clock, 0).run(async () => {});
  await turn();
  assert.equal(clock.isPlaying, true);
});

test('retención: con dos imágenes espera a la última', async () => {
  const clock = holdClock();
  const hold = new CaptureHold(() => clock, 0);
  let second;
  hold.run(async () => {});
  hold.run(() => new Promise(resolve => { second = resolve; }));
  await turn();
  assert.equal(clock.isPlaying, false);
  second();
  await turn();
  assert.deepEqual([clock.isPlaying, clock.plays], [true, 1]);
});

test('retención: si una imagen falla el reloj sigue', async () => {
  const clock = holdClock();
  const failures = [];
  const report = (reason) => failures.push(reason.message);
  process.once('unhandledRejection', report);
  new CaptureHold(() => clock, 0).run(async () => { throw new Error('Gráfico oculto'); });
  await turn();
  process.off('unhandledRejection', report);
  assert.equal(clock.isPlaying, true);
});

test('retención: avisar dos veces no suelta el reloj de otra imagen', async () => {
  const clock = holdClock();
  const hold = new CaptureHold(() => clock, 0);
  let second;
  hold.run(async (release) => { release(); release(); });
  hold.run(() => new Promise(resolve => { second = resolve; }));
  await turn();
  assert.equal(clock.isPlaying, false);
  second();
  await turn();
});

test('retención: si quien opera pausa, la imagen no pone a andar el reloj', async () => {
  const clock = holdClock();
  const hold = new CaptureHold(() => clock, 0);
  hold.run(async () => {});
  hold.cancel();
  await turn();
  assert.equal(clock.plays, 0);
});

test('retención: con el reloj quieto no lo pone a andar', async () => {
  const clock = holdClock(false);
  new CaptureHold(() => clock, 0).run(async () => {});
  await turn();
  assert.equal(clock.plays, 0);
});

test('retención: si el reloj cambió sigue el nuevo y no el anterior', async () => {
  const old = holdClock();
  const current = holdClock(false);
  let clock = old;
  const hold = new CaptureHold(() => clock, 0);
  hold.run(async () => { clock = current; });
  await turn();
  assert.deepEqual([old.plays, current.plays], [0, 1]);
});

test('retención: espera a que se dibuje antes de tomar la imagen', async () => {
  const hold = new CaptureHold(() => holdClock(), 40);
  let taken = false;
  hold.run(async () => { taken = true; });
  await turn();
  assert.equal(taken, false);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(taken, true);
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
