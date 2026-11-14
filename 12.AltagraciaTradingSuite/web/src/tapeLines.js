// tapeLines.js - Una orden de la cinta como línea horizontal en el gráfico (14/11/2026).
// Pedido del usuario: al hacer clic en una orden de la cinta, verla en el gráfico como una línea con su información,
// y poder dejarla en firme o borrarla, como referencia. La línea es un dibujo de la moneda (tipo "horizontal" de App 1,
// con texto): se ve en el mapa, en el gráfico principal y en la Watchlist. Mientras está provisional va punteada; solo
// hay una provisional por moneda (otro clic la reemplaza). Lógica pura, probada en tests/tapelines.test.mjs.
// Estilo (14/11, pedido del usuario: se veían muy protagonistas): grosor, trazo, opacidad y texto (completo, corto o
// sin texto), para todas las líneas de la cinta; de fábrica, discretas. Una en firme solo se borra a mano: la cinta
// guarda 30 minutos, pero la lista "En firme" las muestra todas.

const fmtUsd = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k` : `${Math.round(v)}`);
const fmtPrice = (p) => Number(Number(p).toPrecision(8)).toLocaleString('en-US');
const fmtTime = (t) => new Date(t).toLocaleTimeString('es-CO', { hour12: false });

export const tapeLineId = (symbol, order) => `tape_${symbol}_${order.t}_${order.side}`;

export const TAPE_STYLE_KEY = 'suite_tape_line_style';
export const TAPE_STYLE_DEFAULT = { width: 1, dashed: false, opacity: 0.55, label: 'short', size: 10 };

/** Estilo guardado, con cada campo dentro de lo permitido */
export function cleanStyle(v = {}) {
  const d = TAPE_STYLE_DEFAULT;
  const n = (x, lo, hi, def) => (Number.isFinite(Number(x)) ? Math.min(hi, Math.max(lo, Number(x))) : def);
  return {
    width: Math.round(n(v.width, 1, 4, d.width)),
    dashed: typeof v.dashed === 'boolean' ? v.dashed : d.dashed,
    opacity: n(v.opacity, 0.15, 1, d.opacity),
    label: ['full', 'short', 'none'].includes(v.label) ? v.label : d.label,
    size: Math.round(n(v.size, 8, 14, d.size)),
  };
}

/** Precio de la línea: el promedio de la orden (USD / cantidad); si cruzó varios precios, ese promedio */
export function orderPrice(order) {
  return order.qty > 0 ? order.usd / order.qty : order.p0;
}

/** Texto de la línea: "Cinta ▲ compra 15.2 · 1.0M · 14:33:10 · 65,612→65,620" */
export function tapeLabel(order, qtyText = (q) => String(q)) {
  const range = order.levels > 1 ? ` · ${fmtPrice(order.p0)}→${fmtPrice(order.p1)}` : '';
  return `Cinta ${order.side === 'buy' ? '▲ compra' : '▼ venta'} ${qtyText(order.qty)} · ${fmtUsd(order.usd)} · ${fmtTime(order.t)}${range}`;
}

/** Texto corto: "▼ 76k · 14:47" */
export function shortLabel(order) {
  const t = new Date(order.t).toLocaleTimeString('es-CO', { hour12: false, hour: '2-digit', minute: '2-digit' });
  return `${order.side === 'buy' ? '▲' : '▼'} ${fmtUsd(order.usd)} · ${t}`;
}

/** Estilo y texto de una línea de la cinta según el estilo elegido; la provisional va punteada y algo más visible */
export function lineLook(tape, color, pending, style = TAPE_STYLE_DEFAULT, qtyText) {
  const st = cleanStyle(style);
  const order = { ...tape };
  let label = st.label === 'none' ? '' : st.label === 'short' ? shortLabel(order) : tapeLabel(order, qtyText);
  if (pending) label = label ? `${label} (provisional)` : 'Cinta (provisional)';
  return {
    style: { color, lineWidth: st.width, dash: pending ? [4, 3] : st.dashed ? [6, 4] : [], opacity: pending ? Math.min(1, st.opacity + 0.25) : st.opacity,
      labelSize: st.size, labelBg: false },
    label: label || null,
  };
}

/** La línea de una orden: provisional (punteada, con "(provisional)") o en firme, con el estilo elegido */
export function tapeLine(symbol, order, color, pending = true, qtyText, style = TAPE_STYLE_DEFAULT) {
  const tape = { pending, t: order.t, side: order.side, usd: order.usd, qty: order.qty, lo: order.lo, hi: order.hi,
    p0: order.p0, p1: order.p1, levels: order.levels };
  return { type: 'horizontal', id: tapeLineId(symbol, order), price: orderPrice(order), time: order.t, ...lineLook(tape, color, pending, style, qtyText), tape };
}

/** Todas las líneas de la cinta con otro estilo (su color, su estado y su orden no cambian) */
export function restyle(shapes, style, qtyText) {
  return (shapes || []).map(s => (s && s.type === 'horizontal' && s.tape
    ? { ...s, ...lineLook(s.tape, s.style?.color, !!s.tape.pending, style, qtyText) }
    : s));
}

/** Las líneas de la cinta en firme, de la más nueva a la más vieja (para la lista "En firme") */
export function firmLines(shapes) {
  return (shapes || []).filter(s => s && s.tape && !s.tape.pending).sort((a, b) => (b.tape.t || 0) - (a.tape.t || 0));
}

/** Los dibujos con esta línea provisional: quita las otras provisionales de la cinta (las firmes quedan) */
export function withPendingLine(shapes, line) {
  return [...(shapes || []).filter(s => s && s.id !== line.id && !(s.tape?.pending)), line];
}

/** Deja en firme la línea con el estilo elegido, sin "(provisional)". Si no está, los dibujos no cambian */
export function firmLine(shapes, id, style = TAPE_STYLE_DEFAULT, qtyText) {
  return (shapes || []).map(s => {
    if (!s || s.id !== id) return s;
    const tape = { ...(s.tape || {}), pending: false };
    return { ...s, ...lineLook(tape, s.style?.color, false, style, qtyText), tape };
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
