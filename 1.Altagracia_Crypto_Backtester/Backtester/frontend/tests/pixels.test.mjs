// Nitidez del lienzo: líneas, velas y rectángulos en píxeles reales enteros. Uso: node tests/pixels.test.mjs
import assert from 'node:assert/strict';

// Un lienzo falso que anota lo que se dibuja. Va antes de cargar el módulo, que toma su prototipo al cargarse
const drawn = [];
globalThis.CanvasRenderingContext2D = class {
  constructor() { this.lineWidth = 1; this.globalAlpha = 1; this.matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  fillRect(x, y, w, h) { drawn.push({ op: 'fill', x, y, w, h }); }
  strokeRect(x, y, w, h) { drawn.push({ op: 'stroke', x, y, w, h, lineWidth: this.lineWidth, alpha: this.globalAlpha }); }
  setTransform(a, b, c, d, e, f) { this.matrix = { a, b, c, d, e, f }; }
  translate(x, y) { this.matrix = { ...this.matrix, e: this.matrix.e + x * this.matrix.a, f: this.matrix.f + y * this.matrix.d }; }
  rotate() { this.matrix = { ...this.matrix, b: 0.5, c: -0.5 }; }
  scale() {}
  transform() {}
  resetTransform() { this.matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  getTransform() { return { ...this.matrix }; }
};

const {
  alignX, alignY, candleColumns, crispWidth, installCrispRects, pixelRatio, rectEdge, resetCanvasMoves, setCanvasPixels,
  snapEdge, snapSpanY
} = await import('../src/components/chartPixels.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };
const DENSITIES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const integer = value => Math.abs(value - Math.round(value)) < 1e-6;
const near = (a, b) => Math.abs(a - b) < 1e-6;

t('sin la mejora todo queda como antes', () => {
  setCanvasPixels(1.5, 1.5, false);
  for (const v of [10.3, 7, -4.6, 0.25]) {
    assert.equal(alignY(v), v);
    assert.equal(alignX(v, 2), v);
    assert.equal(snapEdge(v), v);
    assert.equal(rectEdge(v, 1), v);
  }
  assert.equal(crispWidth(1.5), 1.5);
  assert.deepEqual(snapSpanY(10.2, 20.7), [10.2, 20.7 - 10.2]);
  assert.equal(candleColumns(100.3, 6), null);
  assert.equal(pixelRatio(), 1);
});

t('una línea queda entera en píxeles reales, cerca de donde estaba', () => {
  for (const density of DENSITIES) {
    setCanvasPixels(density, density, true);
    for (const width of [0.5, 1, 1.5, 2, 3]) {
      const device = crispWidth(width) * density;
      assert.ok(integer(device) && device >= 1, `grosor ${width} a ${density}`);
      for (let v = 3; v < 40; v += 0.37) {
        const y = alignY(v, width) * density;
        // Sus dos bordes caen en píxeles enteros
        assert.ok(integer(y - device / 2) && integer(y + device / 2), `línea ${v} ${width} a ${density}`);
        assert.ok(Math.abs(y / density - v) <= 0.5 / density + 1e-9 + device / density / 2, 'no se aleja');
      }
    }
  }
});

t('la mecha queda al centro del cuerpo, todo en píxeles enteros', () => {
  for (const density of DENSITIES) {
    setCanvasPixels(density, density, true);
    for (let center = 10; center < 60; center += 0.29) {
      for (const body of [1, 2, 2.6, 5.6, 7, 11.2, 40]) {
        const c = candleColumns(center, body);
        for (const value of [c.wickX, c.wickWidth, c.bodyX, c.bodyWidth]) assert.ok(integer(value * density));
        assert.ok(near(c.wickX + c.wickWidth / 2, c.bodyX + c.bodyWidth / 2), `centrada ${center} ${body} a ${density}`);
        assert.ok(c.wickWidth * density >= 1 && c.bodyWidth >= c.wickWidth);
        assert.ok(Math.abs(c.wickX + c.wickWidth / 2 - center) <= 1 / density, 'no se corre');
      }
    }
  }
});

t('un tramo vertical mide al menos un píxel real', () => {
  setCanvasPixels(1.5, 1.5, true);
  const [y, h] = snapSpanY(20.1, 20.2);
  assert.ok(integer(y * 1.5) && near(h * 1.5, 1));
  const [y2, h2] = snapSpanY(30.9, 10.2);
  assert.ok(integer(y2 * 1.5) && integer((y2 + h2) * 1.5) && y2 <= 10.2 + 1);
});

t('fillRect lleva sus bordes a píxeles enteros y deja los angostos como están', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  for (const density of DENSITIES) {
    setCanvasPixels(density, density, true);
    resetCanvasMoves(ctx);
    drawn.length = 0;
    ctx.fillRect(10.2, 20.7, 30.3, 5.1);
    const r = drawn[0];
    for (const value of [r.x, r.y, r.x + r.w, r.y + r.h]) assert.ok(integer(value * density), `borde a ${density}`);
    assert.ok(Math.abs(r.x - 10.2) <= 0.5 / density + 1e-9 && Math.abs(r.w - 30.3) <= 1 / density + 1e-9);
    // Una vela de 0.1 px con miles en la pantalla: se deja como venía
    drawn.length = 0;
    ctx.fillRect(10.23, 20.7, 0.1 / density, 8);
    assert.ok(near(drawn[0].x, 10.23) && near(drawn[0].w, 0.1 / density));
  }
});

t('dos rectángulos vecinos siguen tocándose sin taparse', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  setCanvasPixels(1.25, 1.25, true);
  resetCanvasMoves(ctx);
  drawn.length = 0;
  ctx.fillRect(10, 5.3, 20, 7.71);
  ctx.fillRect(10, 5.3 + 7.71, 20, 7.71);
  assert.ok(near(drawn[0].y + drawn[0].h, drawn[1].y));
});

t('ancho negativo: dibuja el mismo rectángulo que antes', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  setCanvasPixels(1, 1, true);
  resetCanvasMoves(ctx);
  drawn.length = 0;
  ctx.fillRect(40.4, 10, -20.2, 5);
  assert.ok(near(drawn[0].x, 20) && near(drawn[0].w, 20));
});

t('strokeRect: borde entero, centrado en la orilla, y dos zonas que comparten orilla pintan en el mismo lugar', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  for (const density of DENSITIES) {
    setCanvasPixels(density, density, true);
    resetCanvasMoves(ctx);
    for (const width of [1, 2, 3]) {
      drawn.length = 0;
      ctx.lineWidth = width;
      ctx.strokeRect(50.3, 30.6, 80.2, 40.45); // Zona TP
      ctx.strokeRect(50.3, 71.05, 80.2, 33.1); // Zona SL, desde la entrada
      const [tp, sl] = drawn;
      const device = tp.lineWidth * density;
      assert.ok(integer(device), 'grosor entero');
      assert.ok(near(tp.y + tp.h, sl.y), 'la entrada es una sola línea');
      for (const edge of [tp.x, tp.y, tp.x + tp.w, tp.y + tp.h]) assert.ok(integer(edge * density - device / 2), 'borde entero');
      assert.equal(ctx.lineWidth, width, 'el grosor vuelve');
      assert.ok(near(rectEdge(71.05, width) * density, sl.y * density), 'rectEdge da el mismo lugar');
    }
  }
});

t('strokeRect más fino que un píxel: un píxel con la misma tinta, y la transparencia vuelve', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  setCanvasPixels(1, 1, true);
  resetCanvasMoves(ctx);
  drawn.length = 0;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.8;
  ctx.strokeRect(10, 10, 20, 9.4);
  assert.ok(near(drawn[0].lineWidth, 1) && near(drawn[0].alpha, 0.4));
  assert.equal(ctx.globalAlpha, 0.8);
  assert.equal(ctx.lineWidth, 0.5);
});

t('con traslado se alinea con la matriz real y girado no se toca', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  setCanvasPixels(1.5, 1.5, true);
  ctx.setTransform(1.5, 0, 0, 1.5, 0, 0);
  resetCanvasMoves(ctx);
  ctx.translate(0.3, 0.7);
  drawn.length = 0;
  ctx.fillRect(10.2, 20.7, 30.3, 5.1);
  const m = ctx.getTransform();
  const r = drawn[0];
  assert.ok(integer(r.x * m.a + m.e) && integer(r.y * m.d + m.f));
  ctx.rotate(0.5);
  drawn.length = 0;
  ctx.fillRect(10.2, 20.7, 30.3, 5.1);
  assert.deepEqual([drawn[0].x, drawn[0].y, drawn[0].w, drawn[0].h], [10.2, 20.7, 30.3, 5.1]);
});

t('sin la mejora fillRect y strokeRect pasan intactos', () => {
  const ctx = installCrispRects(new CanvasRenderingContext2D());
  setCanvasPixels(2, 2, false);
  resetCanvasMoves(ctx);
  drawn.length = 0;
  ctx.lineWidth = 1.5;
  ctx.fillRect(10.2, 20.7, 30.3, 5.1);
  ctx.strokeRect(10.2, 20.7, 30.3, 5.1);
  assert.deepEqual([drawn[0].x, drawn[0].y, drawn[0].w, drawn[0].h], [10.2, 20.7, 30.3, 5.1]);
  assert.deepEqual([drawn[1].x, drawn[1].lineWidth], [10.2, 1.5]);
});

console.log(`${count} de ${count} pruebas correctas`);
