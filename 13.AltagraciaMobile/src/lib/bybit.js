// Modo directo: con el PC apagado, la app lee las posiciones directo de Bybit con una clave de SOLO LECTURA
// guardada en el celular. Solo hace GET: aqui no existe ninguna ruta que opere. Las claves del bot no se usan.
import { bybitHeaders } from './sign.js';

export const HOSTS = { real: 'https://api.bybit.com', demo: 'https://api-demo.bybit.com' };
const TIMEOUT_MS = 8000;

async function privateGet(account, path, params, fetchImpl) {
  const query = new URLSearchParams(params).toString();
  const headers = await bybitHeaders(account.apiKey, account.apiSecret, query);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetchImpl(`${HOSTS[account.demo ? 'demo' : 'real']}${path}?${query}`, { headers, signal: abort.signal });
  } catch {
    throw new Error('Sin conexión con Bybit');
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json().catch(() => null);
  if (!data) throw new Error(`Bybit respondió ${r.status}`);
  if (data.retCode !== 0) {
    // 10003/10004: clave o firma invalida; 33004: clave vencida (sin IP fija, Bybit las caduca)
    const hint = [10003, 10004, 33004].includes(data.retCode) ? ' Revisa la clave: puede estar vencida o mal copiada.' : '';
    throw new Error(`Bybit: ${data.retMsg || data.retCode}.${hint}`);
  }
  return data.result || {};
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** Una posicion de Bybit con la misma forma que las del bot (private_stream.position_record). */
export function normalizePosition(p) {
  return {
    symbol: p.symbol, side: p.side || '', size: Number(p.size) || 0, entryPrice: p.avgPrice || p.entryPrice, markPrice: p.markPrice,
    unrealizedPnl: p.unrealisedPnl, leverage: p.leverage, liqPrice: num(p.liqPrice), positionValue: p.positionValue,
    stopLoss: num(p.stopLoss), takeProfit: num(p.takeProfit), createdTime: p.createdTime, updatedTime: p.updatedTime, broker: 'bybit',
  };
}

/** Posiciones abiertas (perpetuos USDT) de una cuenta, leidas directo de Bybit. */
export async function directPositions(account, fetchImpl = fetch) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 5; page += 1) {
    const params = { category: 'linear', settleCoin: 'USDT', limit: '200' };
    if (cursor) params.cursor = cursor;
    const result = await privateGet(account, '/v5/position/list', params, fetchImpl);
    out.push(...(result.list || []).filter(p => Number(p.size) > 0).map(normalizePosition));
    cursor = result.nextPageCursor || '';
    if (!cursor) break;
  }
  return out;
}

/** Patrimonio y disponible de la cuenta unificada. */
export async function directBalance(account, fetchImpl = fetch) {
  const result = await privateGet(account, '/v5/account/wallet-balance', { accountType: 'UNIFIED' }, fetchImpl);
  const wallet = (result.list || [])[0] || {};
  return { equity: num(wallet.totalEquity), available: num(wallet.totalAvailableBalance) };
}
