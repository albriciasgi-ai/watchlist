/**
 * Fecha oculta: con una fecha de inicio al azar, la app muestra días relativos a ese inicio.
 * El gráfico se dibuja en canvas fuera de React, por eso el estado vive en este módulo.
 */
const DAY_MS = 86400000;
const COLOMBIA_OFFSET_MS = 5 * 3600000;

let anchor = null;

const colombiaDay = (timestamp) => Math.floor((timestamp - COLOMBIA_OFFSET_MS) / DAY_MS);

export function setBlindAnchor(timestamp) {
  anchor = timestamp ?? null;
}

export function blindAnchor() {
  return anchor;
}

export function isBlind() {
  return anchor !== null;
}

/** "Día 3 14:30", contado desde el inicio de la simulación, en hora de Colombia */
export function maskDate(timestamp) {
  const clock = new Date(timestamp - COLOMBIA_OFFSET_MS).toISOString().slice(11, 16);
  return `Día ${colombiaDay(timestamp) - colombiaDay(anchor)} ${clock}`;
}

// ==================== PRECIO Y VOLUMEN OCULTOS ====================
//
// Con fecha oculta el nivel del precio y el volumen en monedas también ubican la época. El precio se
// muestra como índice: el del inicio vale `base`, un número al azar entre 80 y 120, y el resto se mueve
// en el mismo porcentaje. El volumen y las cantidades en monedas se multiplican por un factor que deja
// la vela mediana del inicio en 1,000. Solo cambia lo que se lee: el gráfico, las órdenes y el registro
// siguen en precios reales.

let scale = null; // { ref, base, volRef }

const INDEX_DECIMALS = 3;

/** Escala nueva para un inicio: precio de esa hora y volumen mediano de las velas anteriores */
export function makeBlindScale(price, medianVolume, random = Math.random) {
  if (!(price > 0)) return null;
  const base = Math.round((80 + random() * 40) * 1000) / 1000;
  return { ref: price, base, volRef: medianVolume > 0 ? medianVolume : 1 };
}

export function setBlindScale(next) {
  scale = next && next.ref > 0 && next.base > 0 ? { ref: next.ref, base: next.base, volRef: next.volRef > 0 ? next.volRef : 1 } : null;
}

export function blindScale() {
  return scale;
}

/** Precio oculto activo: fecha oculta y escala fijada */
export const pricesHidden = () => anchor !== null && scale !== null;

/** Precio real a índice (o el mismo precio sin modo oculto) */
export function maskPrice(price) {
  return pricesHidden() && Number.isFinite(price) ? (price * scale.base) / scale.ref : price;
}

/** Índice a precio real, para lo que se escribe en un campo */
export function unmaskPrice(value) {
  return pricesHidden() && Number.isFinite(value) ? (value * scale.ref) / scale.base : value;
}

/** Una distancia de precio (no un nivel): misma proporción, sin desplazamiento */
export const maskPriceDelta = (delta) => maskPrice(delta);

/** Texto de un precio: índice con 3 decimales o el precio con sus decimales */
export function priceText(price, digits = 2) {
  if (!Number.isFinite(price)) return '–';
  return pricesHidden() ? maskPrice(price).toFixed(INDEX_DECIMALS) : price.toFixed(digits);
}

/** Decimales a usar para un precio ya escalado (los ejes redondean en el índice) */
export const shownDecimals = (digits) => (pricesHidden() ? INDEX_DECIMALS : digits);

/** Volumen o cantidad en monedas, en la escala oculta */
export function maskVolume(volume) {
  return pricesHidden() && Number.isFinite(volume) ? (volume * 1000) / scale.volRef : volume;
}

/** Escala para un inicio a partir de las velas: cierre de la última vela antes de `time` y mediana de 96 velas */
export function scaleFromCandles(candles, time, random = Math.random) {
  if (!candles?.length) return null;
  let k = candles.length - 1;
  while (k > 0 && candles[k].timestamp >= time) k -= 1;
  const volumes = candles.slice(Math.max(0, k - 95), k + 1).map(c => c.volume).filter(v => v > 0).sort((a, b) => a - b);
  const median = volumes.length ? volumes[Math.floor(volumes.length / 2)] : 0;
  return makeBlindScale(candles[k].close, median, random);
}

/** Precio para leer con signo de dólar, o el índice sin él con precio oculto */
export function priceLabel(price, digits = 2) {
  if (!Number.isFinite(price)) return '–';
  return pricesHidden() ? priceText(price) : '$' + price.toFixed(digits);
}

/** Cantidad en monedas para leer: en la escala oculta, con 3 decimales */
export function quantityText(quantity) {
  if (!Number.isFinite(quantity)) return quantity ?? '–';
  return pricesHidden() ? maskVolume(quantity).toFixed(3) : quantity;
}
