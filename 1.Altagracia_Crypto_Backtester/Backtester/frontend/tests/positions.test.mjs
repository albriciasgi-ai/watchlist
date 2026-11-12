// Posiciones reales sobre el gráfico (suite en vivo): P&L, validez de SL/TP y lo que responde al mouse.
// Uso: node tests/positions.test.mjs
import assert from 'node:assert/strict';

const { drawPositionLines, hitPositionTarget, pnlAt, validLevel } = await import('../src/components/positionLines.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

// Lienzo falso: anota textos y líneas horizontales
function fakeCtx() {
  const texts = [];
  const lines = [];
  let path = [];
  return {
    texts, lines,
    save() {}, restore() {}, beginPath() { path = []; }, rect() {}, clip() {},
    moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { if (path.length === 2) lines.push({ y: path[0][1], color: this.strokeStyle }); },
    fillRect() {}, strokeRect() {}, setLineDash() {},
    fillText(text, x, y) { texts.push({ text, x, y }); },
    measureText(text) { return { width: String(text).length * 6 }; },
  };
}

// Precio 100 en y=300, 1 de precio = 10 px (más precio, más arriba)
const view = (extra = {}) => ({
  priceToY: (p) => 300 - (p - 100) * 10, left: 0, right: 800, top: 0, bottom: 600, axisRight: 865,
  lastPrice: 102, fmt: (p) => p.toFixed(2), drag: null, ...extra,
});
const long = { kind: 'position', id: 'pos:BTC:0:Buy', side: 'Buy', size: 2, entry: 100, stopLoss: 95, takeProfit: 110, liqPrice: 80 };

t('P&L de long y short sin comisiones', () => {
  assert.equal(pnlAt(long, 102), 4);
  assert.equal(pnlAt({ ...long, side: 'Sell' }, 102), -4);
  assert.equal(pnlAt(long, NaN), null);
});

t('SL bajo el precio en long y sobre él en short; TP al revés', () => {
  assert.equal(validLevel(long, 'stopLoss', 101, 102), true);
  assert.equal(validLevel(long, 'stopLoss', 103, 102), false);
  assert.equal(validLevel(long, 'takeProfit', 101, 102), false);
  const short = { ...long, side: 'Sell' };
  assert.equal(validLevel(short, 'stopLoss', 103, 102), true);
  assert.equal(validLevel(short, 'takeProfit', 101, 102), true);
  assert.equal(validLevel(long, 'stopLoss', 0, 102), false);
  assert.equal(validLevel(long, 'stopLoss', 101, null), true); // sin precio decide el bot
});

t('entrada con tamaño y P&L al último precio, SL y TP con lo que se perdería o ganaría', () => {
  const ctx = fakeCtx();
  drawPositionLines(ctx, [long], view());
  const all = ctx.texts.map(x => x.text).join(' | ');
  assert.match(all, /Long 2/);
  assert.match(all, /\+4\.00 USD \(\+2\.00%\)/);
  assert.match(all, /−10\.00 USD/); // SL en 95: (95 - 100) * 2
  assert.match(all, /\+20\.00 USD/); // TP en 110
  assert.match(all, /Liq\. 80\.00/);
  const entryLine = ctx.lines.find(l => Math.abs(l.y - 300) < 1);
  assert.ok(entryLine, 'línea de entrada en su precio');
});

t('× cierra, la etiqueta del TP se arrastra y el TP se quita; el SL no tiene ×', () => {
  const targets = drawPositionLines(fakeCtx(), [long], view());
  const actions = targets.map(x => `${x.action}:${x.field || ''}`).sort();
  assert.deepEqual(actions, ['close:', 'drag:stopLoss', 'drag:stopLoss', 'drag:takeProfit', 'drag:takeProfit', 'remove:takeProfit']);
  const close = targets.find(x => x.action === 'close');
  assert.equal(hitPositionTarget(targets, (close.x0 + close.x1) / 2, 300).action, 'close');
  assert.equal(hitPositionTarget(targets, 10, 300), null); // la línea misma no captura el mouse
});

t('sin SL ni TP aparecen las etiquetas para arrastrarlos desde la entrada', () => {
  const targets = drawPositionLines(fakeCtx(), [{ ...long, stopLoss: null, takeProfit: null }], view());
  assert.deepEqual(targets.filter(x => x.action === 'create').map(x => x.field).sort(), ['stopLoss', 'takeProfit']);
});

t('mientras se arrastra se ve el precio nuevo, y un SL del lado equivocado dice "no válido"', () => {
  const ctx = fakeCtx();
  drawPositionLines(ctx, [long], view({ drag: { lineId: long.id, field: 'stopLoss', price: 98 } }));
  assert.match(ctx.texts.map(x => x.text).join('|'), /−4\.00 USD/); // (98 - 100) * 2
  const bad = fakeCtx();
  drawPositionLines(bad, [long], view({ drag: { lineId: long.id, field: 'stopLoss', price: 103 } }));
  assert.match(bad.texts.map(x => x.text).join('|'), /no válido/);
});

t('cambio en camino: "moviendo…" y sin acciones en esa etiqueta', () => {
  const ctx = fakeCtx();
  const targets = drawPositionLines(ctx, [{ ...long, pending: { field: 'stopLoss', price: 97 } }], view());
  assert.match(ctx.texts.map(x => x.text).join('|'), /moviendo…/);
  assert.equal(targets.filter(x => x.field === 'stopLoss').length, 0);
});

t('fuera de la vista: la etiqueta queda en el borde con flecha y sin línea', () => {
  const ctx = fakeCtx();
  drawPositionLines(ctx, [{ ...long, entry: 200, stopLoss: null, takeProfit: null, liqPrice: null }], view());
  assert.ok(ctx.texts.some(x => x.text.startsWith('▲ Long')));
  assert.equal(ctx.lines.length, 0);
});

t('orden de entrada pendiente con × para cancelarla', () => {
  const order = { kind: 'order', id: 'ord:1', side: 'Buy', qty: 0.5, price: 99, orderType: 'Limit', stopLoss: 97, takeProfit: 104 };
  const ctx = fakeCtx();
  const targets = drawPositionLines(ctx, [order], view());
  assert.match(ctx.texts.map(x => x.text).join('|'), /Limit compra 0\.5/);
  assert.deepEqual(targets.map(x => x.action), ['cancel']); // su SL/TP no se mueven desde aquí
});

console.log(`${count} de ${count} pruebas correctas`);
