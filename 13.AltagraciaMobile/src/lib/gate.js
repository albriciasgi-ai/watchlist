// Pedidos firmados a la puerta movil de la suite (12.AltagraciaTradingSuite/server/mobile_gate.py).
import { gateHeaders } from './sign.js';

const TIMEOUT_MS = 7000;
let clockOffset = 0; // hora del servidor - hora del celular, si el reloj del celular esta corrido

/** El contenido del QR de la suite: {v, host, port, id, secret, name}. Lanza un error con el motivo. */
export function parsePairing(text) {
  let data;
  try {
    data = JSON.parse(String(text).trim());
  } catch {
    throw new Error('Eso no es un código de la suite');
  }
  const ok = data && data.v === 1 && typeof data.host === 'string' && /^[0-9A-Za-z.:-]{1,64}$/.test(data.host)
    && Number.isInteger(data.port) && data.port > 0 && data.port < 65536
    && /^[a-f0-9]{12}$/.test(data.id || '') && /^[a-f0-9]{64}$/.test(data.secret || '');
  if (!ok) throw new Error('El código no es de la suite o está incompleto');
  return { host: data.host, port: data.port, id: data.id, secret: data.secret, name: String(data.name || 'Celular').slice(0, 40) };
}

export const baseUrl = (pairing) => `http://${pairing.host.includes(':') ? `[${pairing.host}]` : pairing.host}:${pairing.port}`;

export class GateError extends Error {
  constructor(message, { status = null, offline = false } = {}) {
    super(message);
    this.status = status;   // codigo HTTP; sin respuesta, null
    this.offline = offline; // no hubo respuesta: el PC esta apagado, sin Tailscale o sin la suite
  }
}

async function send(pairing, method, target, body, fetchImpl) {
  const headers = await gateHeaders(pairing, method, target, body || '', Date.now() + clockOffset);
  if (body) headers['Content-Type'] = 'application/json';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(baseUrl(pairing) + target, { method, headers, body: body || undefined, signal: abort.signal });
  } catch (e) {
    throw new GateError('Sin conexión con la suite', { offline: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Pide a la puerta y devuelve la respuesta (Response). Si el reloj del celular esta corrido, corrige y repite una vez. */
export async function gateFetch(pairing, method, target, payload = null, fetchImpl = fetch) {
  const body = payload === null ? '' : JSON.stringify(payload);
  let r = await send(pairing, method, target, body, fetchImpl);
  if (r.status === 401) {
    const data = await r.clone().json().catch(() => ({}));
    if (typeof data.now === 'number') {
      clockOffset = data.now - Date.now();
      r = await send(pairing, method, target, body, fetchImpl);
    }
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    const message = data.error || data.detail || `La suite respondió ${r.status}`;
    throw new GateError(r.status === 401 ? `${message}. Si revocaste este celular, emparéjalo de nuevo.` : message, { status: r.status });
  }
  return r;
}

export const gateGet = async (pairing, target, fetchImpl) => (await gateFetch(pairing, 'GET', target, null, fetchImpl)).json();
export const gatePost = async (pairing, target, payload, fetchImpl) => (await gateFetch(pairing, 'POST', target, payload, fetchImpl)).json();

/** Una imagen del journal como URL local (hay que soltarla con URL.revokeObjectURL). */
export async function gateImage(pairing, image) {
  const r = await gateFetch(pairing, 'GET', `/m/image/${image}`);
  return URL.createObjectURL(await r.blob());
}
