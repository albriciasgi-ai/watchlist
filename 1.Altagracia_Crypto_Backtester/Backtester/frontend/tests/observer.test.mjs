// Pruebas del observador en el navegador: que se envía, en qué orden y cómo se lee.
// Uso: node tests/observer.test.mjs
import assert from 'node:assert/strict';
import {
  describeComparison, emptyMarks, formatR, rangesInUse, recordCancel, recordClose, recordFill, recordOrder, simulatedDate
} from '../src/components/backtesting/observer.js';
import { blindAnchor, isBlind, maskDate, setBlindAnchor } from '../src/components/backtesting/blindClock.js';

console.warn = () => {};

const DAY = 86400000;
const START = Date.UTC(2026, 5, 3, 15, 0); // 3 de junio, 10:00 en Colombia

let sent = [];
let failNext = false;
let delays = [];

globalThis.fetch = async (url, options) => {
  const wait = delays.shift() || 0;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  if (failNext) {
    failNext = false;
    return { ok: false, status: 500 };
  }
  sent.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
  return { ok: true, json: async () => ({}) };
};

const order = (extra = {}) => ({
  id: 3, type: 'limit', side: 'long', quantity: 0.01, entryPrice: 81800, entryTime: START, stopLoss: 81000, takeProfit: 83000,
  notes: 'zona', executedAt: null, executedPrice: null, marks: { context4h: 'up', context1h: null, reasons: ['fvg'] }, ...extra
});

const context = { symbol: 'BTCUSDT', timeframe: '15m', session: 's1', price: 82000, rewound: false, indicators: ['FVG'], ranges: [] };

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('la orden guarda hora simulada, marco, precios, motivos y lo que habia en pantalla', async () => {
  sent = [];
  const target = order();
  await recordOrder(target, context);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/api/observer/orders');
  const { body } = sent[0];
  assert.equal(body.id, target.observerId);
  assert.equal(body.time, START);
  assert.equal(body.timeframe, '15m');
  assert.equal(body.entry, 81800);
  assert.equal(body.stop, 81000);
  assert.equal(body.target, 83000);
  assert.equal(body.market, 82000);
  assert.equal(body.notes, 'zona');
  assert.deepEqual(body.marks.reasons, ['fvg']);
  assert.deepEqual(body.indicators, ['FVG']);
  assert.equal(body.rewound, false);
  assert.equal(body.blind, false);
});

test('una orden a mercado viaja ya llena', async () => {
  sent = [];
  await recordOrder(order({ type: 'market', executedAt: START, executedPrice: 82000 }), context);
  assert.equal(sent[0].body.fill_time, START);
  assert.equal(sent[0].body.fill_price, 82000);
});

test('sin marcas se envian vacias', async () => {
  sent = [];
  await recordOrder(order({ marks: undefined }), context);
  assert.deepEqual(sent[0].body.marks, emptyMarks());
});

test('cada orden tiene su propia identidad', async () => {
  const first = order();
  const second = order();
  await recordOrder(first, context);
  await recordOrder(second, context);
  assert.notEqual(first.observerId, second.observerId);
});

test('llenado, cierre y cancelacion viajan con la hora simulada', async () => {
  sent = [];
  const target = order();
  await recordOrder(target, context);
  await recordFill({ ...target, executedAt: START + 60000, executedPrice: 81800 });
  await recordClose({ ...target, exitTime: START + 120000, exitPrice: 83000, closeReason: 'take_profit', pnl: 11.9, pnlPercent: 1.4 });
  await recordCancel(target, START + 180000);
  const path = `/api/observer/orders/${target.observerId}/events`;
  assert.deepEqual(sent.slice(1).map(item => item.path), [path, path, path]);
  assert.deepEqual(sent[1].body, { event: 'fill', time: START + 60000, price: 81800 });
  assert.deepEqual(sent[2].body, { event: 'close', time: START + 120000, price: 83000, reason: 'take_profit', pnl: 11.9, pnl_percent: 1.4 });
  assert.deepEqual(sent[3].body, { event: 'cancel', time: START + 180000 });
});

test('una orden de una sesion vieja, sin registro, no envia eventos', async () => {
  sent = [];
  await recordFill(order());
  await recordClose(order());
  await recordCancel(order(), START);
  assert.equal(sent.length, 0);
});

test('los eventos llegan en orden aunque la orden tarde en guardarse', async () => {
  sent = [];
  delays = [30, 0];
  const target = order();
  recordOrder(target, context);
  await recordFill({ ...target, executedAt: START, executedPrice: 81800 });
  assert.deepEqual(sent.map(item => item.path.endsWith('/events')), [false, true]);
});

test('una falla al guardar no detiene los siguientes eventos', async () => {
  sent = [];
  failNext = true;
  const target = order();
  await recordOrder(target, context);
  await recordFill({ ...target, executedAt: START, executedPrice: 81800 });
  assert.equal(sent.length, 1);
});

test('perfiles usados: existian al crear la orden y se cortan en la hora simulada', () => {
  const profiles = [
    { enabled: true, startTimestamp: START - DAY, endTimestamp: START + DAY },
    { enabled: true, startTimestamp: START + 1, endTimestamp: START + DAY },
    { enabled: false, startTimestamp: START - DAY, endTimestamp: START },
    { enabled: true, startTimestamp: START - 200 * DAY, endTimestamp: START - 100 * DAY }
  ];
  assert.deepEqual(rangesInUse(profiles, START), [{ start: START - DAY, end: START }]);
});

test('fecha oculta: dias relativos y hora de Colombia', () => {
  setBlindAnchor(START);
  assert.equal(isBlind(), true);
  assert.equal(blindAnchor(), START);
  assert.equal(maskDate(START), 'Día 0 10:00');
  assert.equal(maskDate(START + 5 * 3600000), 'Día 0 15:00');
  assert.equal(maskDate(START + 14 * 3600000), 'Día 1 00:00', 'cambia a medianoche de Colombia');
  assert.equal(maskDate(START - 3 * DAY), 'Día -3 10:00');
  setBlindAnchor(undefined);
  assert.equal(isBlind(), false);
});

test('el texto oculto no deja ver mes ni ano', () => {
  setBlindAnchor(START);
  const text = maskDate(START + 40 * DAY);
  assert.equal(/2026|jun|jul|\/|-/i.test(text), false);
  setBlindAnchor(null);
});

test('las ordenes con fecha oculta no muestran la fecha real aunque ya se haya revelado otra', () => {
  setBlindAnchor(START);
  assert.equal(simulatedDate({ blind: true }, START), 'Día 0 10:00');
  setBlindAnchor(null);
  assert.equal(simulatedDate({ blind: true }, START), 'Fecha oculta');
  assert.match(simulatedDate({ blind: false }, START), /03\/06\/26/);
});

const comparison = {
  available: true,
  rows: [
    { block: 'context_240', you: 'up', rule: 'range', agree: false, efficiency: 0.18, up_volume: 0.6 },
    { block: 'context_60', you: null, rule: null, agree: null, efficiency: null },
    {
      block: 'move', you: true, agree: true, same_move: { tf: '240', overlap: 0.784 },
      rule: {
        15: { lo: 81000, hi: 81900, ratio: 1.6, atrs: 2.2 },
        240: { lo: 78100.4, hi: 83000, ratio: 2.14, atrs: 3.2 }
      }
    },
    { block: 'zone', you: ['profile', 'fvg'], rule: { typ: 'HVN', tf: 60, x0: 81760, x1: 81850 }, gap: 0, near: true, chance: 0.38, agree: true },
    { block: 'oi', you: true, rule: 'mixed', change: 0.0092, agree: false },
    { block: 'volume', you: null, rule: 1.84, agree: null }
  ]
};

test('la comparacion se lee bloque por bloque', () => {
  const { rows } = describeComparison(comparison);
  const [ctx4, ctx1, move, zone, oi, volume] = rows;
  assert.deepEqual([ctx4.you, ctx4.rule, ctx4.verdict], ['Alcista', 'Consolidación (eficiencia 0.18)', 'No coincide']);
  assert.deepEqual([ctx1.you, ctx1.rule, ctx1.verdict], ['—', 'Sin velas suficientes', null]);
  assert.equal(move.rule, '4h: 78,100 a 83,000, volumen 2.1x, 3.2 ATR; 15m: 81,000 a 81,900, volumen 1.6x, 2.2 ATR');
  assert.equal(move.note, 'Tu perfil y el movimiento de 4h comparten 78%');
  assert.equal(move.verdict, 'Coincide');
  assert.equal(zone.you, 'Nivel de perfil, FVG');
  assert.equal(zone.rule, 'Cluster de 1h 81,760 a 81,850, a 0.00%');
  assert.equal(zone.note, 'Por azar: 38% de los precios cercanos');
  assert.equal(oi.rule, 'Mixto (+0.92% en 4 horas)');
  assert.equal(oi.verdict, 'No coincide');
  assert.equal(volume.rule, 'Última vela de 15m: 1.8x su promedio');
});

test('sin movimiento, sin zona y sin OI se dice asi', () => {
  const rows = describeComparison({
    available: true,
    rows: [
      { block: 'move', you: null, rule: null, agree: null, same_move: null },
      { block: 'zone', you: null, rule: null, gap: null, chance: null, agree: null },
      { block: 'oi', you: null, rule: null, change: null, agree: null },
      { block: 'volume', you: null, rule: null, agree: null }
    ]
  }).rows;
  assert.deepEqual(rows.map(row => row.rule), ['Sin movimiento vigente a favor', 'Sin zonas del lado de la orden', 'Sin dato de OI', 'Sin dato']);
});

test('sin lectura lo dice en vez de inventar', () => {
  assert.match(describeComparison({ available: false, missing: 'trades' }).missing, /trades descargados/);
  assert.match(describeComparison({ available: false, missing: 'error' }).missing, /Sin lectura/);
  assert.match(describeComparison(undefined).missing, /Sin lectura/);
});

test('resultado en R', () => {
  assert.equal(formatR(1.5), '+1.50R');
  assert.equal(formatR(-1), '-1.00R');
  assert.equal(formatR(null), '—');
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
