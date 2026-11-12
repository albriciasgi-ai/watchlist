/**
 * Posiciones y órdenes reales sobre el gráfico, como en TradingView (pedido del usuario el 12/11/2026 para la suite).
 *
 * - Posición: línea de entrada con tamaño y P&L que cambia con el precio, y × para cerrarla.
 * - SL y TP: líneas con lo que se perdería o ganaría ahí. Se mueven arrastrando su etiqueta. El TP se quita con ×;
 *   el SL no se quita, solo se mueve. Sin SL o sin TP, las etiquetas "SL" y "TP" junto a la entrada se arrastran
 *   para ponerlos.
 * - Precio de liquidación y órdenes de entrada pendientes (con × para cancelarlas y su SL/TP adjunto).
 *
 * Solo dibuja y dice qué se tocó: las acciones las decide quien da los datos (onPositionAction de MiniChart),
 * con confirmación. App 1 en reproducción no pasa posiciones, así que nada de esto aparece allí.
 *
 * Línea: { kind: 'position', id, side: 'Buy'|'Sell', size, entry, stopLoss, takeProfit, liqPrice, leverage, pending }
 *        { kind: 'order', id, side, qty, price, orderType, stopLoss, takeProfit, pending }
 * pending: { field, price } mientras el cambio pedido viaja al bot (se dibuja punteado, "moviendo…").
 *
 * Fuera de la vista (12/11, al probarlo el usuario): la etiqueta queda en el borde con ▲ o ▼ y su precio real
 * ("@ 79261.4"), porque sin el precio parecía estar en el precio del borde. Un clic en ella, o en ⇕ de la
 * posición, ajusta la escala para ver todas las líneas con su precio en el eje (MiniChart, positionFitRef).
 * El % es el ROI sobre el margen, como en Bybit (con el apalancamiento de la posición), no el cambio del precio.
 */
import { THEME } from './uiTheme.js';
import { alignY, crispWidth } from './chartPixels.js';

const H = 18;          // alto de las etiquetas
const GAP = 4;         // separación entre etiquetas
const LIQ_COLOR = '#FF9800';
const OFF_COLOR = '#9E9E9E';

export const dirOf = (side) => (side === 'Buy' || side === 'long' ? 1 : -1);

/** P&L de la posición si el precio llega a `price` (sin comisiones). */
export function pnlAt(line, price) {
  if (!Number.isFinite(price) || !Number.isFinite(line.entry) || !Number.isFinite(line.size)) return null;
  return (price - line.entry) * line.size * dirOf(line.side);
}

const money = (v) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} USD`);
const qtyText = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(10))) : '');

/** % de la etiqueta: ROI sobre el margen como en Bybit (cambio del precio × apalancamiento); sin apalancamiento, el cambio del precio. */
export function pnlPercent(line, price) {
  if (!Number.isFinite(price) || !line.entry) return null;
  const move = ((price - line.entry) / line.entry) * 100 * dirOf(line.side);
  const leverage = Number(line.leverage);
  return leverage > 0 ? move * leverage : move;
}

/** El SL de un long va bajo el precio actual y el TP encima; al revés en un short. */
export function validLevel(line, field, price, lastPrice) {
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(lastPrice)) return true;
  const dir = dirOf(line.side);
  return field === 'stopLoss' ? (price - lastPrice) * dir < 0 : (price - lastPrice) * dir > 0;
}

function chip(ctx, x, y, w, text, { fill, stroke, color, bold = false, dashed = false }) {
  const top = Math.round(y - H / 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, top, w, H);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashed ? [3, 2] : []);
    ctx.strokeRect(x + 0.5, top + 0.5, w - 1, H - 1);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = color;
  ctx.font = `${bold ? '600 ' : ''}${THEME.fontSize}px ${THEME.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, top + H / 2 + 0.5);
}

const widthOf = (ctx, text, bold = false) => {
  ctx.font = `${bold ? '600 ' : ''}${THEME.fontSize}px ${THEME.font}`;
  return Math.ceil(ctx.measureText(text).width) + 12;
};

/**
 * Etiquetas de derecha a izquierda, desde `rightX`. parts: [{ text, color, fill, stroke, bold, target }].
 * Devuelve el borde izquierdo y agrega a `targets` las partes con target.
 */
function labelRow(ctx, parts, rightX, y, targets) {
  let x = rightX;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    const w = part.width || widthOf(ctx, part.text, part.bold);
    x -= w;
    chip(ctx, x, y, w, part.text, part);
    if (part.target) targets.push({ ...part.target, x0: x, x1: x + w, y0: y - H / 2, y1: y + H / 2 });
    x -= part.gap ?? 0;
  }
  return x;
}

function hline(ctx, v, y, color, dash, width = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = crispWidth(width);
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(v.left, alignY(y, width));
  ctx.lineTo(v.right, alignY(y, width));
  ctx.stroke();
  ctx.restore();
}

/** Etiqueta del precio en el eje, del color de la línea. */
function axisTag(ctx, v, y, price, color) {
  if (!v.axisRight || v.axisRight <= v.right) return;
  const top = Math.round(y - 9);
  ctx.fillStyle = color;
  ctx.fillRect(v.right + 1, top, v.axisRight - v.right - 2, 18);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${THEME.fontSize}px ${THEME.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(v.fmt(price), v.right + 6, top + 9.5);
}

/** Borde derecho de una etiqueta: a la izquierda de los botones del gráfico si su altura los toca (v.avoid). */
function rightFor(v, y) {
  const a = v.avoid;
  if (a && y + H / 2 > a.top && y - H / 2 < a.bottom) return Math.min(v.right - 8, a.left);
  return v.right - 8;
}

/**
 * y del precio. Fuera de la vista la etiqueta queda en el borde con ▲ o ▼, apilada con las otras de ese borde
 * (sin taparse), y la línea no se dibuja.
 */
function place(v, price) {
  const y = v.priceToY(price);
  if (!Number.isFinite(y)) return null;
  if (y < v.top + H / 2) return { y: v.topEdge + H / 2 + (v.slots.top++) * (H + 2), off: '▲ ' };
  if (y > v.bottom - H / 2) return { y: v.bottom - H / 2 - (v.slots.bottom++) * (H + 2), off: '▼ ' };
  return { y, off: '' };
}

function levelLine(ctx, v, line, field, price, targets, { preview = false, pendingMove = false } = {}) {
  const isSL = field === 'stopLoss';
  const valid = !preview || validLevel(line, field, price, v.lastPrice);
  const base = isSL ? THEME.downText : THEME.upText;
  const color = valid ? base : OFF_COLOR;
  const at = place(v, price);
  if (!at) return;
  if (!at.off) hline(ctx, v, at.y, color, pendingMove || preview ? [4, 3] : [6, 4]);
  const pnl = line.kind === 'position' ? pnlAt(line, price) : null;
  const what = isSL ? 'SL' : 'TP';
  const detail = pendingMove ? 'moviendo…' : !valid ? 'no válido' : line.kind === 'position' ? money(pnl) : 'orden';
  // Fuera de la vista: su precio real en la etiqueta, y un clic (sin arrastrar) ajusta la escala para verla
  const where = at.off ? ` @ ${v.fmt(price)}` : '';
  const target = line.kind === 'position' && !pendingMove
    ? { action: 'drag', line, field, price, cursor: 'ns-resize', priority: 2, fitOnClick: !!at.off }
    : (at.off ? { action: 'fit', line, cursor: 'pointer', priority: 2 } : null);
  const parts = [
    { text: `${at.off}${what}${where}`, color: '#FFFFFF', fill: color, bold: true, target },
    { text: detail, color, fill: THEME.chartBg, stroke: color, dashed: pendingMove || !!at.off, target },
  ];
  // El TP de una posición se puede quitar; el SL nunca (solo moverlo)
  if (line.kind === 'position' && !isSL && !preview && !pendingMove) {
    parts.push({ text: '×', color, fill: THEME.chartBg, stroke: color, bold: true,
      target: { action: 'remove', line, field, cursor: 'pointer', priority: 3 } });
  }
  labelRow(ctx, parts, rightFor(v, at.y), at.y, targets);
  if (!at.off) axisTag(ctx, v, at.y, price, color);
}

function drawPosition(ctx, line, v, targets) {
  const drag = v.drag && v.drag.lineId === line.id ? v.drag : null;
  const pending = line.pending || null;

  // Liquidación: solo si se ve (lejos no aporta y no ocupa lugar en el borde)
  if (Number.isFinite(line.liqPrice) && line.liqPrice > 0) {
    const y = v.priceToY(line.liqPrice);
    if (Number.isFinite(y) && y >= v.top + H / 2 && y <= v.bottom - H / 2) {
      hline(ctx, v, y, LIQ_COLOR, [2, 3]);
      labelRow(ctx, [{ text: `Liq. ${v.fmt(line.liqPrice)}`, color: LIQ_COLOR, fill: THEME.chartBg, stroke: LIQ_COLOR }], rightFor(v, y), y, targets);
    }
  }

  for (const field of ['takeProfit', 'stopLoss']) {
    if (drag && drag.field === field) {
      levelLine(ctx, v, line, field, drag.price, targets, { preview: true });
    } else if (pending && pending.field === field) {
      if (Number.isFinite(pending.price) && pending.price > 0) levelLine(ctx, v, line, field, pending.price, targets, { pendingMove: true });
    } else if (Number.isFinite(line[field])) {
      levelLine(ctx, v, line, field, line[field], targets);
    }
  }

  const at = place(v, line.entry);
  if (!at) return;
  const pnl = pnlAt(line, v.lastPrice);
  const pct = pnlPercent(line, v.lastPrice);
  const pnlColor = pnl === null ? THEME.text : pnl >= 0 ? THEME.upText : THEME.downText;
  const color = THEME.accent;
  if (!at.off) hline(ctx, v, at.y, color, []);
  const fit = at.off ? { action: 'fit', line, cursor: 'pointer', priority: 2 } : null;
  const parts = [
    // ⇕ ajusta la escala para ver entrada, SL y TP con su precio en el eje; otra vez, vuelve a seguir las velas
    { text: '⇕', color: v.fit ? '#FFFFFF' : color, fill: v.fit ? color : THEME.chartBg, stroke: color, bold: true,
      target: { action: 'fit', line, cursor: 'pointer', priority: 3 } },
  ];
  // Sin SL o sin TP: se arrastran desde aquí para ponerlos
  for (const [field, text, c] of [['stopLoss', 'SL', THEME.downText], ['takeProfit', 'TP', THEME.upText]]) {
    if (!Number.isFinite(line[field]) && !(drag && drag.field === field) && !(pending && pending.field === field)) {
      parts.push({ text, color: c, fill: THEME.chartBg, stroke: c, dashed: true, gap: GAP,
        target: { action: 'create', line, field, price: line.entry, cursor: 'ns-resize', priority: 3 } });
    }
  }
  parts.push(
    { text: `${at.off}${line.side === 'Buy' ? 'Long' : 'Short'} ${qtyText(line.size)}${at.off ? ` @ ${v.fmt(line.entry)}` : ''}`,
      color: '#FFFFFF', fill: color, bold: true, gap: GAP, target: fit },
    { text: pct === null ? money(pnl) : `${money(pnl)} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%)`,
      color: pnlColor, fill: THEME.chartBg, stroke: color, bold: true, dashed: !!at.off, target: fit },
    { text: '×', color, fill: THEME.chartBg, stroke: color, bold: true, target: { action: 'close', line, cursor: 'pointer', priority: 3 } },
  );
  labelRow(ctx, parts, rightFor(v, at.y), at.y, targets);
  if (!at.off) axisTag(ctx, v, at.y, line.entry, color);
}

function drawOrder(ctx, line, v, targets) {
  const price = line.price;
  if (!Number.isFinite(price)) return;
  for (const field of ['takeProfit', 'stopLoss']) {
    if (Number.isFinite(line[field])) levelLine(ctx, v, line, field, line[field], targets);
  }
  const at = place(v, price);
  if (!at) return;
  const color = THEME.accent;
  if (!at.off) hline(ctx, v, at.y, color, [6, 4]);
  const kind = line.orderType === 'Limit' ? 'Limit' : (line.orderType || 'Orden');
  labelRow(ctx, [
    { text: `${at.off}${kind} ${line.side === 'Buy' ? 'compra' : 'venta'} ${qtyText(line.qty)}${at.off ? ` @ ${v.fmt(price)}` : ''}`,
      color, fill: THEME.chartBg, stroke: color, dashed: true, bold: true,
      target: at.off ? { action: 'fit', line, cursor: 'pointer', priority: 2 } : null },
    line.pending
      ? { text: 'cancelando…', color, fill: THEME.chartBg, stroke: color, dashed: true }
      : { text: '×', color, fill: THEME.chartBg, stroke: color, bold: true, target: { action: 'cancel', line, cursor: 'pointer', priority: 3 } },
  ], rightFor(v, at.y), at.y, targets);
  if (!at.off) axisTag(ctx, v, at.y, price, color);
}

/** Precios que la escala debe incluir cuando se piden las posiciones a la vista (⇕): entrada, SL, TP y entradas pendientes. */
export function positionPrices(lines) {
  const prices = [];
  for (const line of lines || []) {
    const list = line.kind === 'position' ? [line.entry, line.stopLoss, line.takeProfit] : [line.price, line.stopLoss, line.takeProfit];
    for (const p of list) if (Number.isFinite(p) && p > 0) prices.push(p);
  }
  return prices;
}

/**
 * Dibuja las posiciones y órdenes. v: { priceToY, left, right, top, bottom, axisRight, lastPrice, fmt, drag }.
 * Devuelve los lugares que responden al mouse: { action, line, field, price, cursor, priority, x0, x1, y0, y1 }.
 */
export function drawPositionLines(ctx, lines, view) {
  const targets = [];
  // Las etiquetas de arriba fuera de la vista van bajo los botones del gráfico, a la derecha como las demás
  const topEdge = view.avoid ? Math.max(view.top, view.avoid.bottom + 2) : view.top;
  const v = { ...view, topEdge, slots: { top: 0, bottom: 0 } };
  ctx.save();
  ctx.beginPath();
  ctx.rect(v.left, v.top, (v.axisRight || v.right) - v.left, v.bottom - v.top);
  ctx.clip();
  // Órdenes primero: la posición queda encima si sus precios coinciden
  for (const line of lines) if (line.kind === 'order') drawOrder(ctx, line, v, targets);
  for (const line of lines) if (line.kind === 'position') drawPosition(ctx, line, v, targets);
  ctx.restore();
  return targets;
}

/** Lo que hay bajo el mouse (el de más prioridad: botones antes que etiquetas). */
export function hitPositionTarget(targets, x, y) {
  let best = null;
  for (const t of targets || []) {
    if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1 && (!best || t.priority > best.priority)) best = t;
  }
  return best;
}
