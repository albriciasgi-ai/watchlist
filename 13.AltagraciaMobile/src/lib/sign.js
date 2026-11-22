// Firmas HMAC-SHA256 con WebCrypto (sin React ni Capacitor: lo usan las pruebas con node).
const encoder = new TextEncoder();

const toHex = (buffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('hexadecimal invalido');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : (data || new Uint8Array());
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/** HMAC-SHA256 en hexadecimal. `key` son bytes (Uint8Array) o un texto. */
export async function hmacHex(key, message) {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

export function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Cabeceras de un pedido a la puerta movil de la suite (mobile_devices.py):
 * X-Sign = HMAC(secreto, "METODO\nruta?consulta\nhora\nnonce\nsha256(cuerpo)").
 */
export async function gateHeaders(pairing, method, target, body = '', at = Date.now(), nonce = randomNonce()) {
  const message = [method.toUpperCase(), target, String(at), nonce, await sha256Hex(body)].join('\n');
  return {
    'X-Device': pairing.id,
    'X-Time': String(at),
    'X-Nonce': nonce,
    'X-Sign': await hmacHex(hexToBytes(pairing.secret), message),
  };
}

/** Cabeceras de un GET privado de Bybit V5: firma de hora + clave + ventana + consulta. */
export async function bybitHeaders(apiKey, apiSecret, query, at = Date.now(), recvWindow = 10000) {
  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-TIMESTAMP': String(at),
    'X-BAPI-RECV-WINDOW': String(recvWindow),
    'X-BAPI-SIGN': await hmacHex(apiSecret, `${at}${apiKey}${recvWindow}${query}`),
  };
}
