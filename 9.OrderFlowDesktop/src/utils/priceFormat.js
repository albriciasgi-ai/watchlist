// Decimales de un precio segun su tamano.
// Antes el grafico usaba siempre 2 decimales: GALA salia 0.00 y DOGE 0.07 en todo el eje.
// Para precios de 10 o mas no cambia nada (BTC, ETH, SOL siguen con 2 decimales).
export function priceDecimals(price) {
  const p = Math.abs(Number(price));
  if (!Number.isFinite(p) || p === 0) return 2;
  if (p >= 10) return 2;
  if (p >= 1) return 3;
  // Monedas baratas: unas 4 cifras significativas (DOGE 0.07123, GALA 0.006312, PEPE 0.00001234)
  return Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(p))));
}

export function formatPrice(price, decimals) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(decimals ?? priceDecimals(n));
}

// Momento en que se toco por ultima vez una caja TP/SL: updatedAt si existe,
// si no la hora de creacion que lleva su id (tpsl_1772484936348_0.65...)
export function shapeTouchedAt(shape) {
  if (!shape) return 0;
  if (Number.isFinite(shape.updatedAt)) return shape.updatedAt;
  const match = /_(\d{12,14})_/.exec(String(shape.id || ''));
  return match ? Number(match[1]) : 0;
}
