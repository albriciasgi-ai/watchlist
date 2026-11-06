// Tamaño y tipo de orden, y cajas TP/SL. Uso: node tests/orders.test.mjs
import assert from 'node:assert/strict';
import {
  AUTO_ENTRY_DISTANCE, autoOrderType, latestFreeBox, orderPreview, orderQuantity, priceAtPercent
} from '../src/components/backtesting/orderPlan.js';
import TPSLBox, { DEFAULT_REWARD_RATIO, defaultBoxSize } from '../src/components/drawing/shapes/TPSLBox.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} no es ${expected}`);

test('precio: el stop va en contra y el objetivo a favor', () => {
  close(priceAtPercent(100, 'long', '2', false), 98);
  close(priceAtPercent(100, 'long', '4', true), 104);
  close(priceAtPercent(100, 'short', '2', false), 102);
  close(priceAtPercent(100, 'short', '4', true), 96);
});

test('precio: sin porcentaje no hay nivel', () => {
  assert.equal(priceAtPercent(100, 'long', '', false), null);
  assert.equal(priceAtPercent(100, 'long', '0', false), null);
  assert.equal(priceAtPercent(100, 'long', '-1', false), null);
  assert.equal(priceAtPercent(NaN, 'long', '1', false), null);
});

test('tipo: cerca del precio entra a mercado', () => {
  assert.equal(AUTO_ENTRY_DISTANCE, 0.001, 'la misma distancia de App 8');
  assert.equal(autoOrderType(100, 100, 'long'), 'market');
  assert.equal(autoOrderType(99.9, 100, 'long'), 'market');
  assert.equal(autoOrderType(100.1, 100, 'short'), 'market');
});

test('tipo: lejos espera el retroceso con una limit', () => {
  assert.equal(autoOrderType(99, 100, 'long'), 'limit');
  assert.equal(autoOrderType(101, 100, 'short'), 'limit');
});

test('tipo: si la entrada está a favor del movimiento espera con un stop', () => {
  assert.equal(autoOrderType(101, 100, 'long'), 'stop');
  assert.equal(autoOrderType(99, 100, 'short'), 'stop');
});

test('cantidad: monto fijo compra ese monto', () => {
  close(orderQuantity({ mode: 'fixed', amount: 100, entry: 50000, stopLoss: 49000 }), 0.002);
});

test('cantidad: por riesgo, llegar al stop pierde justo ese capital', () => {
  const quantity = orderQuantity({ mode: 'risk', amount: 10, entry: 50000, stopLoss: 49750 });
  close(quantity, 0.04);
  close(quantity * (50000 - 49750), 10);
});

test('cantidad: por riesgo vale igual para un short', () => {
  close(orderQuantity({ mode: 'risk', amount: 10, entry: 50000, stopLoss: 50250 }), 0.04);
});

test('cantidad: como en App 8, riesgo entre el porcentaje del stop', () => {
  const entry = 66439.2;
  const stopLoss = entry * 0.995;
  const investment = 10 / 0.005;
  close(orderQuantity({ mode: 'risk', amount: 10, entry, stopLoss }), investment / entry);
});

test('cantidad: por riesgo sin stop no hay orden', () => {
  assert.equal(orderQuantity({ mode: 'risk', amount: 10, entry: 100, stopLoss: null }), 0);
  assert.equal(orderQuantity({ mode: 'risk', amount: 10, entry: 100, stopLoss: 100 }), 0);
});

test('cantidad: un monto o precio inválido no da orden', () => {
  assert.equal(orderQuantity({ mode: 'fixed', amount: 0, entry: 100 }), 0);
  assert.equal(orderQuantity({ mode: 'fixed', amount: NaN, entry: 100 }), 0);
  assert.equal(orderQuantity({ mode: 'fixed', amount: 10, entry: NaN }), 0);
});

test('resumen: inversión, pérdida, ganancia y riesgo beneficio', () => {
  const preview = orderPreview({ quantity: 0.04, entry: 50000, stopLoss: 49750, takeProfit: 50500 });
  close(preview.investment, 2000);
  close(preview.loss, 10);
  close(preview.profit, 20);
  close(preview.ratio, 2);
});

test('resumen: sin stop ni objetivo no inventa cifras', () => {
  const preview = orderPreview({ quantity: 1, entry: 100, stopLoss: null, takeProfit: null });
  assert.equal(preview.loss, null);
  assert.equal(preview.profit, null);
  assert.equal(preview.ratio, null);
});

const shape = (id, extra = {}) => ({ type: 'tpsl', id, entryPrice: 100, slPrice: 99, tpPrice: 102, ...extra });

test('caja: toma la última dibujada', () => {
  const box = latestFreeBox([shape('a'), { type: 'trendline', id: 'x' }, shape('b', { entryPrice: 200 }), { type: 'rectangle', id: 'y' }]);
  assert.equal(box.id, 'b');
  assert.equal(box.entryPrice, 200);
});

test('caja: una que ya es de una orden no se ofrece', () => {
  const orders = [{ status: 'open', tpslBoxId: 'b' }, { status: 'closed', tpslBoxId: 'c' }, { status: 'pending', tpslBoxId: 'd' }];
  assert.equal(latestFreeBox([shape('a'), shape('b'), shape('c'), shape('d')], orders).id, 'a');
  assert.equal(latestFreeBox([shape('b')], orders), null);
});

test('caja: cancelar la orden la deja libre', () => {
  assert.equal(latestFreeBox([shape('a')], [{ status: 'cancelled', tpslBoxId: 'a' }]).id, 'a');
});

test('caja: el lado sale de dónde está el objetivo', () => {
  assert.equal(latestFreeBox([shape('a')]).side, 'long');
  assert.equal(latestFreeBox([shape('a', { slPrice: 101, tpPrice: 98 })]).side, 'short');
});

test('caja: sin dibujos no hay caja', () => {
  assert.equal(latestFreeBox(undefined, undefined), null);
  assert.equal(latestFreeBox([], []), null);
});

const ratio = (box) => Math.abs(box.tpPrice - box.entryPrice) / Math.abs(box.entryPrice - box.slPrice);

test('caja nueva: riesgo beneficio de 2 en long y en short', () => {
  assert.equal(DEFAULT_REWARD_RATIO, 2);
  const long = new TPSLBox(100, 1000, 'long');
  const short = new TPSLBox(100, 1000, 'short');
  close(ratio(long), 2);
  close(ratio(short), 2);
  assert.ok(long.slPrice < 100 && long.tpPrice > 100);
  assert.ok(short.slPrice > 100 && short.tpPrice < 100);
});

test('caja nueva: sin escala queda pequeña, 0.5% de riesgo', () => {
  const box = new TPSLBox(100000, 1000, 'long');
  close(box.slPrice, 99500);
  close(box.tpPrice, 101000);
});

const HOUR = 3600000;
const scale = (count = 150, width = 1200) => ({
  visibleCandles: Array.from({ length: count }, (_, i) => ({ timestamp: i * HOUR })),
  chartWidth: width,
  yToPrice: (y) => 1000 - y * 2
});

test('tamaño: la caja mide lo mismo en pantalla en cualquier marco', () => {
  const wide = defaultBoxSize(scale(), 100, 40 * HOUR);
  const pxPerMs = 1200 / (150 * HOUR);
  close((wide.timeEnd - wide.timeStart) * pxPerMs, 130);
  close(wide.risk, 90);
});

test('tamaño: lejos del borde queda centrada en el clic', () => {
  const size = defaultBoxSize(scale(), 100, 40 * HOUR);
  close((size.timeStart + size.timeEnd) / 2, 40 * HOUR);
});

test('tamaño: junto al borde no se sale del gráfico', () => {
  const size = defaultBoxSize(scale(), 100, 149 * HOUR);
  assert.equal(size.timeEnd, 150 * HOUR);
  assert.ok(size.timeStart < 149 * HOUR);
  close((size.timeEnd - size.timeStart) * (1200 / (150 * HOUR)), 130);
});

test('tamaño: la escala manda sobre el porcentaje', () => {
  const size = defaultBoxSize(scale(), 100, 40 * HOUR);
  const box = new TPSLBox(1000, 40 * HOUR, 'short', size);
  close(box.slPrice, 1090);
  close(box.tpPrice, 820);
  close(ratio(box), 2);
  assert.equal(box.timeEnd, size.timeEnd, 'el ancho también sale de la escala');
});

test('caja: se guarda y se recupera igual', () => {
  const box = new TPSLBox(1000, 40 * HOUR, 'long', defaultBoxSize(scale(), 100, 40 * HOUR));
  const copy = TPSLBox.deserialize(box.serialize());
  assert.equal(copy.id, box.id);
  assert.equal(copy.slPrice, box.slPrice);
  assert.equal(copy.tpPrice, box.tpPrice);
  assert.equal(copy.timeStart, box.timeStart);
  assert.equal(copy.timeEnd, box.timeEnd);
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
