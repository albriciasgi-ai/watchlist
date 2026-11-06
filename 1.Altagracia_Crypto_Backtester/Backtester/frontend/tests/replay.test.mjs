// Pruebas de la reproduccion sin futuro. Uso: node tests/replay.test.mjs [velas_reales.json]
import assert from 'node:assert';
import fs from 'node:fs';
import { TF_MS, candlesToSettle, formingCandle, lastClosedIndex, priceAt } from '../src/components/backtesting/replayClock.js';
import OrderManager from '../src/components/backtesting/OrderManager.js';

console.log = (log => (...a) => (typeof a[0] === 'string' && a[0].startsWith('[OrderManager]') ? null : log(...a)))(console.log);
let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
const MIN = 60000;
const bar = (minute, o, h, l, c, v = 1) => ({ timestamp: minute * MIN, open: o, high: h, low: l, close: c, volume: v });
const flat = (start, n, p = 100) => Array.from({ length: n }, (_, i) => bar(start + i, p, p + 1, p - 1, p));
const tf = main => ({ main });

t('una vela solo cierra cuando termina su marco', () => {
  const c = [bar(0, 1, 1, 1, 1), bar(15, 1, 1, 1, 1), bar(30, 1, 1, 1, 1)];
  assert.strictEqual(lastClosedIndex(c, '15m', 14 * MIN), -1);
  assert.strictEqual(lastClosedIndex(c, '15m', 15 * MIN), 0);
  assert.strictEqual(lastClosedIndex(c, '15m', 29 * MIN), 0);
  assert.strictEqual(lastClosedIndex(c, '15m', 45 * MIN), 2);
});

const oneMinute = flat(480, 240);
oneMinute[180].high = 500;
const data = { '1m': tf(oneMinute), '4h': tf([bar(480, 100, 500, 99, 100, 240)]) };

t('la vela de 4 horas en formacion no ve el maximo que aun no ocurrio', () => {
  const f = formingCandle(data, '4h', (480 + 135) * MIN);
  assert.deepStrictEqual([f.timestamp, f.high, f.low, f.close, f.volume, f.knownUntil, f.in_progress], [480 * MIN, 101, 99, 100, 135, 615 * MIN, true]);
});
t('la vela en formacion llega al maximo cuando ese minuto ya cerro', () => {
  assert.strictEqual(formingCandle(data, '4h', (480 + 180) * MIN).high, 101);
  assert.strictEqual(formingCandle(data, '4h', (480 + 181) * MIN).high, 500);
});
t('al abrir una vela todavia no hay nada que mostrar', () => {
  assert.strictEqual(formingCandle(data, '4h', 480 * MIN), null);
});
t('sin minuto cerrado tampoco hay vela en formacion', () => {
  assert.strictEqual(formingCandle(data, '4h', 480 * MIN + 30000), null);
});
t('el marco mas fino no necesita vela en formacion', () => {
  assert.strictEqual(formingCandle(data, '1m', 500 * MIN + 30000), null);
});
t('si no hay minutos para esa fecha usa el siguiente marco', () => {
  const five = Array.from({ length: 12 }, (_, i) => bar(480 + i * 5, 100 + i, 101 + i, 99 + i, 100 + i, 5));
  const d = { '1m': tf(flat(540, 10)), '5m': tf(five), '1h': tf([bar(480, 100, 111, 99, 111, 60)]) };
  const f = formingCandle(d, '1h', 500 * MIN);
  assert.deepStrictEqual([f.open, f.high, f.close, f.volume], [100, 104, 103, 20]);
});

t('el precio conocido es el ultimo cierre ya ocurrido', () => {
  const c = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 105), bar(2, 105, 200, 99, 180)];
  const d = { '1m': tf(c) };
  assert.strictEqual(priceAt(d, 2 * MIN), 105);
  assert.strictEqual(priceAt(d, 2 * MIN + 59000), 105);
  assert.strictEqual(priceAt(d, 3 * MIN), 180);
});

t('las ordenes se revisan vela por vela y sin repetir', () => {
  const d = { '1m': tf(flat(0, 10)) };
  const a = candlesToSettle(d, 2 * MIN, 5 * MIN);
  assert.deepStrictEqual([a.tf, a.candles.map(c => c.timestamp / MIN), a.settledTo / MIN], ['1m', [2, 3, 4], 5]);
  assert.deepStrictEqual(candlesToSettle(d, a.settledTo, 5 * MIN).candles, []);
});
t('sin avance de tiempo no se revisa nada, aunque cambie la pestana', () => {
  const d = { '1m': tf(flat(0, 10)), '4h': tf([bar(0, 100, 900, 1, 100)]) };
  assert.deepStrictEqual(candlesToSettle(d, 5 * MIN, 5 * MIN).candles, []);
});

const manager = () => new OrderManager(10000);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

t('limit paga maker al entrar y taker al salir', () => {
  const m = manager();
  m.createOrder({ type: 'limit', side: 'long', quantity: 1, entryPrice: 100, currentTime: 0, currentPrice: 105, stopLoss: 90, takeProfit: 110 });
  m.updateOrders(bar(0, 105, 106, 99, 101), MIN);
  m.updateOrders(bar(1, 101, 111, 100, 110), 2 * MIN);
  const o = m.closedOrders[0];
  near(o.commission, 0.02);
  near(o.pnl, 10 - 0.02 - 110 * 0.00055);
});
t('mercado paga taker al entrar y usa el precio ejecutado', () => {
  const m = manager();
  m.createOrder({ type: 'market', side: 'long', quantity: 1, entryPrice: 90, currentTime: 0, currentPrice: 100 });
  near(m.openOrders[0].commission, 100 * 0.00055);
  m.closeOrder(m.openOrders[0].id, 110, MIN);
  near(m.closedOrders[0].pnl, 10 - 100 * 0.00055 - 110 * 0.00055);
});
t('una orden no responde a una vela anterior a su creacion', () => {
  const m = manager();
  m.createOrder({ type: 'limit', side: 'long', quantity: 1, entryPrice: 100, currentTime: 10 * MIN, currentPrice: 105 });
  m.updateOrders(bar(9, 105, 106, 95, 105), 10 * MIN);
  assert.strictEqual(m.pendingOrders.length, 1);
  m.updateOrders(bar(10, 105, 106, 99, 105), 11 * MIN);
  assert.strictEqual(m.pendingOrders.length, 0);
});
t('stop y objetivo en el mismo minuto cuentan como stop', () => {
  const m = manager();
  m.createOrder({ type: 'market', side: 'long', quantity: 1, entryPrice: 100, currentTime: 0, currentPrice: 100, stopLoss: 95, takeProfit: 105 });
  const err = console.error; console.error = () => {};
  m.updateOrders(bar(1, 100, 106, 94, 100), 2 * MIN);
  console.error = err;
  assert.strictEqual(m.closedOrders[0].closeReason, 'stop_loss');
});
t('corto limit, stop arriba y objetivo abajo', () => {
  const m = manager();
  m.createOrder({ type: 'limit', side: 'short', quantity: 1, entryPrice: 110, currentTime: 0, currentPrice: 100, stopLoss: 115, takeProfit: 100 });
  m.updateOrders(bar(0, 100, 111, 99, 108), MIN);
  m.updateOrders(bar(1, 108, 109, 99.5, 101), 2 * MIN);
  const o = m.closedOrders[0];
  assert.strictEqual(o.closeReason, 'take_profit');
  near(o.pnl, 10 - 110 * 0.0002 - 100 * 0.00055);
});

const realPath = process.argv[2];
if (realPath) {
  const real = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  const keys = ['1m', '5m', '15m', '1h', '4h'], timeframes = Object.fromEntries(keys.map(k => [k, tf(real[k])]));
  t('con datos reales, las velas de minutos reconstruyen cada vela mayor', () => {
    const one = real['1m'];
    for (const k of ['5m', '15m', '1h', '4h']) {
      let checked = 0, bad = 0;
      for (const c of real[k]) {
        const inside = one.filter(x => x.timestamp >= c.timestamp && x.timestamp < c.timestamp + TF_MS[k]);
        if (inside.length !== TF_MS[k] / MIN) continue;
        checked++;
        const hi = Math.max(...inside.map(x => x.high)), lo = Math.min(...inside.map(x => x.low)), v = inside.reduce((s, x) => s + x.volume, 0);
        if (Math.abs(hi - c.high) > 1e-6 || Math.abs(lo - c.low) > 1e-6 || Math.abs(inside[inside.length - 1].close - c.close) > 1e-6 || Math.abs(v - c.volume) > 1e-3 * Math.max(1, c.volume)) bad++;
      }
      console.log(`   ${k}: ${checked} velas revisadas, ${bad} diferencias`);
      assert.ok(checked > 0 && bad === 0);
    }
  });
  t('con datos reales, borrar el futuro no cambia lo que se ve', () => {
    const lo = real['1m'][1000].timestamp, hi = real['1m'][real['1m'].length - 1000].timestamp;
    let seed = 12345, n = 0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 400; i++) {
      const now = Math.floor((lo + rnd() * (hi - lo)) / MIN) * MIN;
      const cut = Object.fromEntries(keys.map(k => [k, tf(real[k].filter(c => c.timestamp + TF_MS[k] <= now))]));
      for (const k of ['5m', '15m', '1h', '4h']) {
        assert.deepStrictEqual(formingCandle(cut, k, now), formingCandle(timeframes, k, now));
        n++;
      }
      assert.strictEqual(priceAt(cut, now), priceAt(timeframes, now));
    }
    console.log(`   ${n} velas en formacion iguales con y sin datos futuros`);
  });
}
console.log(count, 'pruebas correctas');
