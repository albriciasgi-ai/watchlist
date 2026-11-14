// ladderLogic.js - Cuentas del price ladder (14/11/2026), aparte del dibujo para poder probarlas (tests/ladder.test.mjs).

// Pasos que se pueden elegir, en ticks (0 = automático, ~0.01% del precio)
export const LADDER_STEPS = [0, 1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500, 5000];
// Ventana de lo negociado, en segundos (las mismas que acepta el servidor)
export const LADDER_WINDOWS = [60, 300, 900, 1800];

/** Cantidad corta: 0.004, 1.25, 37.5, 1.2k, 3.4M. Vacío para 0. */
export function fmtQty(v) {
  const a = Math.abs(v);
  if (!a) return '';
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 100) return `${sign}${a.toFixed(0)}`;
  if (a >= 10) return `${sign}${a.toFixed(1)}`;
  if (a >= 1) return `${sign}${a.toFixed(2)}`;
  return `${sign}${a.toFixed(3)}`;
}

/** Decimales del precio para el step y el tick */
export function priceDigits(step, tick) {
  const d = (x) => {
    const text = String(x);
    if (text.includes('e-')) return Number(text.split('e-')[1]);
    const dot = text.indexOf('.');
    return dot < 0 ? 0 : text.length - dot - 1;
  };
  return Math.max(d(step), Math.min(d(tick), d(step) + 1), 0);
}

/**
 * Centro de la vista: con "seguir al precio" se mueve solo cuando el precio se acerca a menos de 1/5 del borde (como
 * un DOM, sin saltar con cada tick). Devuelve el centro nuevo o el mismo.
 */
export function followCenter(center, price, step, rows) {
  if (!(price > 0) || !(step > 0)) return center;
  if (!(center > 0)) return price;
  const half = (rows / 2) * step;
  const margin = Math.max(1, Math.floor(rows / 5)) * step;
  if (price > center + half - margin || price < center - half + margin) return price;
  return center;
}

/** Umbral de los muros: el percentil 95 de lo que espera en la vista (compras y ventas juntas, sin ceros). */
export function wallThreshold(rows) {
  const v = [];
  for (const r of rows || []) {
    if (r[1] > 0) v.push(r[1]);
    if (r[2] > 0) v.push(r[2]);
  }
  if (v.length < 8) return Infinity;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.95))];
}

/**
 * Marcas de tus posiciones y órdenes (las líneas del bot, de botBook.linesFor): entrada, SL, TP, liquidación y Limit.
 * Cada una: { price, text, side: 'buy' | 'sell' | 'risk' | 'target' }
 */
export function ladderMarks(lines) {
  const out = [];
  for (const l of lines || []) {
    if (l.kind === 'position') {
      const buy = l.side === 'Buy';
      if (l.entry > 0) out.push({ price: l.entry, text: `${buy ? 'Long' : 'Short'} ${l.size}`, side: buy ? 'buy' : 'sell' });
      if (l.stopLoss > 0) out.push({ price: l.stopLoss, text: 'SL', side: 'risk' });
      if (l.takeProfit > 0) out.push({ price: l.takeProfit, text: 'TP', side: 'target' });
      if (l.liqPrice > 0) out.push({ price: l.liqPrice, text: 'Liq', side: 'risk' });
    } else if (l.kind === 'order' && l.price > 0) {
      out.push({ price: l.price, text: `${l.orderType === 'Market' ? 'Stop' : 'Limit'} ${l.qty}`, side: l.side === 'Buy' ? 'buy' : 'sell' });
    }
  }
  return out;
}

/** Fila (0 = arriba) de un precio en la vista, o -1 arriba / rows abajo si queda fuera. */
export function rowOf(price, top, step, rows) {
  const i = Math.round((top - Math.floor(price / step + 1e-9) * step) / step);
  if (i < 0) return -1;
  if (i >= rows) return rows;
  return i;
}

/** Un step en precio sin ceros sobrantes: 2.5, 0.1, 0.00005 */
export function fmtStep(v) {
  return String(Number(Number(v).toPrecision(6)));
}

/**
 * Texto de cada opción del step (14/11/2026): en precio y en ticks, porque 10 ticks en ETH (tick 0.01) son 0.1 USD y en
 * BTC (tick 0.1) son 1 USD. Sin el tick todavía, solo ticks.
 */
export function stepLabel(mult, tick, autoStep) {
  if (!mult) return autoStep > 0 ? `Auto · ${fmtStep(autoStep)}` : 'Step auto';
  if (!(tick > 0)) return `${mult} tick${mult > 1 ? 's' : ''}`;
  return `${fmtStep(mult * tick)} · ${mult} tick${mult > 1 ? 's' : ''}`;
}

/** El step guardado para esa moneda (cada moneda recuerda el suyo); 0 = automático */
export function stepFor(settings, symbol) {
  const v = settings?.steps?.[symbol];
  return LADDER_STEPS.includes(v) ? v : 0;
}
