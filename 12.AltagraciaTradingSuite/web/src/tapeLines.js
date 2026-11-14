// tapeLines.js - Una orden de la cinta como línea horizontal en el gráfico (14/11/2026).
// Pedido del usuario: al hacer clic en una orden de la cinta, verla en el gráfico como una línea con su información,
// y poder dejarla en firme o borrarla, como referencia. La línea es un dibujo de la moneda (tipo "horizontal" de App 1,
// con texto): se ve en el mapa, en el gráfico principal y en la Watchlist. Mientras está provisional va punteada; solo
// hay una provisional por moneda (otro clic la reemplaza). Lógica pura, probada en tests/tapelines.test.mjs.

const fmtUsd = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`);
const fmtPrice = (p) => Number(Number(p).toPrecision(8)).toLocaleString('en-US');
const fmtTime = (t) => new Date(t).toLocaleTimeString('es-CO', { hour12: false });

export const tapeLineId = (symbol, order) => `tape_${symbol}_${order.t}_${order.side}`;

/** Precio de la línea: el promedio de la orden (USD / cantidad); si cruzó varios precios, ese promedio */
export function orderPrice(order) {
  return order.qty > 0 ? order.usd / order.qty : order.p0;
}

/** Texto de la línea: "Cinta ▲ compra 15.2 · 1.0M · 14:33:10 · 65,612→65,620" */
export function tapeLabel(order, qtyText = (q) => String(q)) {
  const range = order.levels > 1 ? ` · ${fmtPrice(order.p0)}→${fmtPrice(order.p1)}` : '';
  return `Cinta ${order.side === 'buy' ? '▲ compra' : '▼ venta'} ${qtyText(order.qty)} · ${fmtUsd(order.usd)} · ${fmtTime(order.t)}${range}`;
}

/** La línea de una orden. pending: punteada y fina, con "(provisional)"; firme: continua */
export function tapeLine(symbol, order, color, pending = true, qtyText) {
  const label = tapeLabel(order, qtyText);
  return {
    type: 'horizontal', id: tapeLineId(symbol, order), price: orderPrice(order), time: order.t,
    style: { color, lineWidth: pending ? 1 : 2, dash: pending ? [4, 3] : [] },
    label: pending ? `${label} (provisional)` : label,
    tape: { pending, t: order.t, side: order.side, usd: order.usd, qty: order.qty, lo: order.lo, hi: order.hi },
  };
}

/** Los dibujos con esta línea provisional: quita las otras provisionales de la cinta (las firmes quedan) */
export function withPendingLine(shapes, line) {
  return [...(shapes || []).filter(s => s && s.id !== line.id && !(s.tape?.pending)), line];
}

/** Deja en firme la línea: continua, más gruesa y sin "(provisional)". Si no está, los dibujos no cambian */
export function firmLine(shapes, id) {
  return (shapes || []).map(s => {
    if (!s || s.id !== id) return s;
    return { ...s, style: { ...s.style, lineWidth: 2, dash: [] }, label: String(s.label || '').replace(/ \(provisional\)$/, ''),
      tape: { ...(s.tape || {}), pending: false } };
  });
}

export function removeLine(shapes, id) {
  return (shapes || []).filter(s => s && s.id !== id);
}

/** Estado de la línea de una orden en los dibujos: 'pending', 'firm' o null */
export function lineState(shapes, id) {
  const s = (shapes || []).find(x => x && x.id === id);
  if (!s) return null;
  return s.tape?.pending ? 'pending' : 'firm';
}
