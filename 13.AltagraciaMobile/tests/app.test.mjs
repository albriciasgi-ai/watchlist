// Pruebas de la app sin telefono ni red: firmas, puerta, modo directo y cuentas de las pantallas.
// Uso, desde 13.AltagraciaMobile:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { bybitHeaders, gateHeaders, hexToBytes, randomNonce } from '../src/lib/sign.js';
import { GateError, baseUrl, gateGet, parsePairing } from '../src/lib/gate.js';
import { directBalance, directPositions, normalizePosition } from '../src/lib/bybit.js';
import { ago, duration, positionView, price, signed, tradeSummary } from '../src/lib/format.js';

const PAIRING = { host: '100.64.0.1', port: 13002, id: '0123456789ab', secret: 'ab'.repeat(32), name: 'Prueba' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('la firma es la misma que calcula el servidor (mobile_devices.signature)', async () => {
  // Valores calculados con Python: mobile_devices.signature('ab'*32, ...)
  const get = await gateHeaders(PAIRING, 'GET', '/m/hello', '', 1794000000000, 'abcdefghijklmnop_-01');
  assert.equal(get['X-Sign'], '536adf5ee3120c0971625d9a31a64610c72fa924ed6a18508a3e5d7eb40889a1');
  const post = await gateHeaders(PAIRING, 'post', '/m/push-token?x=1', '{"token":null}', 1794000000000, 'abcdefghijklmnop_-01');
  assert.equal(post['X-Sign'], '3f498362aa86b8beaa5aa86a4de18839f1422db6cbfcfde2a40e20d88f400c38');
  assert.deepEqual([post['X-Device'], post['X-Time'], post['X-Nonce']], ['0123456789ab', '1794000000000', 'abcdefghijklmnop_-01']);
});

test('nonce: valido para el servidor y distinto cada vez', () => {
  const a = randomNonce();
  assert.match(a, /^[A-Za-z0-9_-]{16,64}$/);
  assert.notEqual(a, randomNonce());
  assert.throws(() => hexToBytes('xyz'));
});

test('codigo de emparejamiento: se acepta el de la suite y se rechaza lo demas', () => {
  const qr = { v: 1, ...PAIRING };
  assert.deepEqual(parsePairing(JSON.stringify(qr)), PAIRING);
  assert.equal(baseUrl(PAIRING), 'http://100.64.0.1:13002');
  assert.equal(baseUrl({ host: 'fd7a::1', port: 13002 }), 'http://[fd7a::1]:13002');
  for (const bad of ['hola', '{}', JSON.stringify({ ...qr, v: 2 }), JSON.stringify({ ...qr, secret: 'corto' }),
    JSON.stringify({ ...qr, host: 'a/b' }), JSON.stringify({ ...qr, port: 0 }), JSON.stringify({ ...qr, id: 'ZZ' })]) {
    assert.throws(() => parsePairing(bad), /código/);
  }
});

test('puerta: pedido firmado, error de la suite y sin conexion', async () => {
  const seen = [];
  const ok = async (url, init) => { seen.push([url, init]); return json({ success: true, device: 'Prueba' }); };
  assert.equal((await gateGet(PAIRING, '/m/hello', ok)).device, 'Prueba');
  assert.equal(seen[0][0], 'http://100.64.0.1:13002/m/hello');
  assert.match(seen[0][1].headers['X-Sign'], /^[a-f0-9]{64}$/);

  await assert.rejects(gateGet(PAIRING, '/m/positions', async () => json({ detail: 'bot no disponible' }, 503)),
    (e) => e instanceof GateError && e.status === 503 && !e.offline && /bot no disponible/.test(e.message));
  await assert.rejects(gateGet(PAIRING, '/m/hello', async () => json({ error: 'pedido sin firma valida' }, 401)),
    (e) => e.status === 401 && /emparéjalo de nuevo/.test(e.message));
  await assert.rejects(gateGet(PAIRING, '/m/hello', async () => { throw new TypeError('fetch failed'); }),
    (e) => e.offline === true && e.status === null);
});

test('puerta: con el reloj del celular corrido, corrige con la hora del servidor y repite una vez', async () => {
  const times = [];
  const serverNow = Date.now() + 10 * 60_000;
  const fetchImpl = async (url, init) => {
    times.push(Number(init.headers['X-Time']));
    return times.length === 1 ? json({ error: 'la hora del celular no coincide', now: serverNow }, 401) : json({ success: true });
  };
  assert.equal((await gateGet(PAIRING, '/m/hello', fetchImpl)).success, true);
  assert.equal(times.length, 2);
  assert.ok(Math.abs(times[1] - serverNow) < 2000, 'el segundo pedido va con la hora del servidor');
});

test('modo directo: firma de Bybit V5 y solo pedidos GET de lectura', async () => {
  const h = await bybitHeaders('KEY', 'SECRET', 'category=linear&settleCoin=USDT', 1794000000000, 10000);
  const expected = createHmac('sha256', 'SECRET').update('1794000000000KEY10000category=linear&settleCoin=USDT').digest('hex');
  assert.equal(h['X-BAPI-SIGN'], expected);

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    if (url.includes('/v5/position/list')) {
      return json({ retCode: 0, result: { list: [
        { symbol: 'BTCUSDT', side: 'Sell', size: '0.003', avgPrice: '79261.4', markPrice: '71534', unrealisedPnl: '23.18', leverage: '10', stopLoss: '82293.4', takeProfit: '65227.5', liqPrice: '' },
        { symbol: 'ETHUSDT', side: '', size: '0' },
      ] } });
    }
    return json({ retCode: 0, result: { list: [{ totalEquity: '1050.5', totalAvailableBalance: '900' }] } });
  };
  const account = { name: 'Demo', apiKey: 'KEY', apiSecret: 'SECRET', demo: true };
  const positions = await directPositions(account, fetchImpl);
  assert.equal(positions.length, 1, 'las posiciones de tamaño 0 no cuentan');
  assert.deepEqual([positions[0].symbol, positions[0].entryPrice, positions[0].stopLoss, positions[0].liqPrice, positions[0].broker],
    ['BTCUSDT', '79261.4', 82293.4, null, 'bybit']);
  assert.deepEqual(await directBalance(account, fetchImpl), { equity: 1050.5, available: 900 });
  assert.ok(calls.every(([url, init]) => url.startsWith('https://api-demo.bybit.com/v5/') && (init.method || 'GET') === 'GET' && !init.body));
  assert.ok(calls.every(([url]) => /\/v5\/(position\/list|account\/wallet-balance)\?/.test(url)), 'solo rutas de lectura');
  await directPositions({ ...account, demo: false }, fetchImpl);
  assert.ok(calls.at(-1)[0].startsWith('https://api.bybit.com/'));

  await assert.rejects(directPositions(account, async () => json({ retCode: 10003, retMsg: 'API key is invalid.' })), /Revisa la clave/);
  await assert.rejects(directPositions(account, async () => { throw new TypeError('x'); }), /Sin conexión con Bybit/);
  assert.equal(normalizePosition({ symbol: 'X', size: '2', stopLoss: '0' }).stopLoss, null);
});

test('tarjeta de una posicion: P&L, ROI, al TP y al SL', () => {
  // El short de BTC del usuario del 12/11: entrada 79261.4, marca 71534, SL 82293.4, TP 65227.5
  const v = positionView({ side: 'Sell', size: 0.003, entryPrice: '79261.4', markPrice: '71534', unrealizedPnl: '23.18', leverage: '10', stopLoss: 82293.4, takeProfit: 65227.5 });
  assert.equal(v.long, false);
  assert.ok(Math.abs(v.movePct - 9.749) < 0.01);
  assert.ok(Math.abs(v.roiPct - 97.49) < 0.1);
  assert.ok(Math.abs(v.toTpPct - 8.816) < 0.01, 'al TP: lo que debe bajar el precio');
  assert.ok(Math.abs(v.toSlPct - 15.04) < 0.01, 'al SL: lo que debe subir');
  assert.ok(Math.abs(v.riskAtSl - -9.096) < 0.001 && Math.abs(v.gainAtTp - 42.1017) < 0.001);
  const long = positionView({ side: 'Buy', size: 1, entryPrice: 100, markPrice: 99, stopLoss: null, takeProfit: 98.5, leverage: null });
  assert.equal(long.sl, null);
  assert.equal(long.toSlPct, null);
  assert.ok(long.toTpPct < 0, 'TP ya pasado: negativo');
  assert.equal(long.roiPct, null);
});

test('formatos y resumen de trades', () => {
  assert.equal(price(0.14702), '0.14702');
  assert.equal(price(null), '—');
  assert.match(price(79261.4), /79[.,]261,40|79,261\.40/);
  assert.equal(signed(null), '—');
  assert.ok(signed(12.5).startsWith('+') && signed(-12.5).startsWith('−'));
  assert.equal(ago(1000, 31_000), 'hace 30 s');
  assert.equal(ago(0, 7_200_000 + 1), '');
  assert.equal(duration(90), '1.5 h');
  const s = tradeSummary([
    { status: 'closed', pnl: 10, r: 2 }, { status: 'closed', pnl: -5, r: -1 }, { status: 'closed', pnl: 1, r: null }, { status: 'open', pnl: null },
  ]);
  assert.deepEqual([s.closed, s.open, s.pnl, s.avgR], [3, 1, 6, 0.5]);
  assert.ok(Math.abs(s.winRate - 66.67) < 0.01);
  assert.equal(tradeSummary([]).winRate, null);
});
