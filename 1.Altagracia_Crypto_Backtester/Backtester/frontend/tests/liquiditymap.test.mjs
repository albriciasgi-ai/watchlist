// Mapa de liquidez (13/11/2026): lo que llega de /api/book/heatmap de la suite se guarda por vela con una sola grilla
// de precios, el contraste sale de lo que esta a la vista y la imagen pone el precio mas alto arriba.
// Uso: node tests/liquiditymap.test.mjs
import assert from 'node:assert/strict';

const { LiquidityMapStore, decodeCells, visibleScale, ramp, buildImage, cellUsd, ENC, sideRamp, hexRgb } = await import('../src/components/liquidityMap.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

const b64 = (bytes) => Buffer.from(Uint8Array.from(bytes)).toString('base64');
const resp = (over = {}) => ({
  success: true, t0: 1_000_000, cols: 3, frame_ms: 900_000, rows: 4, row0: 3480, step: 20,
  cells: b64([0, 10, 20, 30, 5, 5, 5, 5, 0, 0, 0, 100]), coverage: [100, 100, 40], first_ms: 1_000_000, last_ms: 3_500_000,
  ...over,
});

t('decodifica las celdas en base64', () => {
  assert.deepEqual([...decodeCells(b64([1, 2, 255]))], [1, 2, 255]);
  assert.equal(decodeCells('').length, 0);
});

t('un byte vuelve a su USD: 16 pasos por cada x10', () => {
  assert.equal(cellUsd(0), 0);
  assert.ok(Math.abs(cellUsd(ENC * 6) - 999_999) < 1);   // 10^6 - 1
  assert.ok(Math.abs(cellUsd(97) / cellUsd(96) - 10 ** (1 / 16)) < 1e-5);
});

t('guarda cada vela con su columna (fila 0 = precio mas bajo) y su cobertura', () => {
  const s = new LiquidityMapStore();
  assert.equal(s.merge(resp()), true);
  assert.deepEqual([...s.column(1_000_000)], [0, 10, 20, 30]);
  assert.deepEqual([...s.column(2_800_000)], [0, 0, 0, 100]);
  assert.equal(s.coverage.get(2_800_000), 40);
  assert.deepEqual(s.priceRange(), [3480 * 20, 3484 * 20]);
  assert.equal(s.covers(69_610, 69_670), true);
  assert.equal(s.covers(69_590, 69_670), false);
  assert.equal(s.lastMs, 3_500_000);
});

t('una vela pedida sin libro queda marcada para no pedirla otra vez, sin borrar lo que ya tenia', () => {
  const s = new LiquidityMapStore();
  s.merge(resp());
  s.merge(resp({ t0: 2_800_000, cols: 2, cells: b64([0, 0, 0, 0, 0, 0, 0, 0]), coverage: [0, 0] }));
  assert.deepEqual([...s.column(2_800_000)], [0, 0, 0, 100]);      // ya tenia libro: sigue
  assert.equal(s.coverage.get(3_700_000), 0);                      // pedida y sin libro
  assert.deepEqual(s.missing([1_000_000, 3_700_000, 4_600_000]), [4_600_000]);
});

t('la ultima vela se actualiza con el pedido corto de la cola', () => {
  const s = new LiquidityMapStore();
  s.merge(resp());
  s.merge(resp({ t0: 2_800_000, cols: 1, cells: b64([0, 0, 50, 120]), coverage: [100], last_ms: 3_600_000 }));
  assert.deepEqual([...s.column(2_800_000)], [0, 0, 50, 120]);
  assert.equal(s.coverage.get(2_800_000), 100);
  assert.equal(s.lastMs, 3_600_000);
});

t('otra grilla de precios empieza de cero', () => {
  const s = new LiquidityMapStore();
  s.merge(resp());
  s.merge(resp({ row0: 1740, step: 40, rows: 2, cols: 1, cells: b64([7, 8]), coverage: [100] }));
  assert.equal(s.step, 40);
  assert.equal(s.column(1_900_000), null);
  assert.deepEqual([...s.column(1_000_000)], [7, 8]);
});

t('sin filas (sin libro grabado) no arma grilla', () => {
  const s = new LiquidityMapStore();
  assert.equal(s.merge(resp({ rows: 0, cells: '', coverage: [0, 0, 0], last_ms: null, first_ms: null })), false);
  assert.equal(s.step, null);
  assert.deepEqual(s.missing([1_000_000, 1_900_000]), []);
});

t('el contraste sale de lo que esta a la vista, sin contar las celdas vacias', () => {
  const cols = [Uint8Array.from([0, 10, 20, 30]), Uint8Array.from([0, 0, 0, 100]), null];
  const sc = visibleScale(cols, { lo: 0.25, hi: 1 });
  assert.equal(sc.lo, 10);
  assert.equal(sc.hi, 100);
  assert.equal(visibleScale([Uint8Array.from([0, 0])]), null);
  // por omision, lo de abajo del percentil 30 queda transparente
  assert.equal(visibleScale(cols).lo, 20);
});

t('la rampa va de transparente a opaco, en fondo claro y oscuro', () => {
  assert.equal(ramp(0)[3], 0);
  assert.equal(ramp(0, true)[3], 0);
  assert.ok(ramp(1)[3] > 200 && ramp(1, true)[3] > 200);
  assert.ok(ramp(0.5)[3] > ramp(0.25)[3]);
  assert.deepEqual(ramp(-1), ramp(0));
  assert.deepEqual(ramp(2), ramp(1));
});

t('la imagen pone una columna por vela y el precio mas alto en la fila de arriba', () => {
  const cols = [Uint8Array.from([0, 0, 0, 100]), null, Uint8Array.from([100, 0, 0, 0])];
  const img = buildImage(cols, 4, { lo: 1, hi: 100 }, false, 1);
  assert.equal(img.width, 3);
  assert.equal(img.height, 4);
  const alpha = (x, y) => img.data[(y * 3 + x) * 4 + 3];
  assert.ok(alpha(0, 0) > 200);   // vela 0, fila mas alta (precio mas alto)
  assert.equal(alpha(0, 3), 0);
  assert.equal(alpha(1, 0), 0);   // vela sin datos: transparente
  assert.ok(alpha(2, 3) > 200);   // vela 2, fila mas baja
  const faint = buildImage(cols, 4, { lo: 1, hi: 100 }, false, 0.5);
  assert.equal(faint.data[3], Math.round(img.data[3] * 0.5));
});

t('compra y venta por separado: la columna guarda las dos y la imagen pinta el lado que más tiene', () => {
  const st = new LiquidityMapStore();
  // 2 velas, 3 filas: vela 0 con compra en la fila 0; vela 1 con venta en la fila 0 (el soporte pasó a resistencia)
  const r = { t0: 0, cols: 2, frame_ms: 900000, rows: 3, row0: 100, step: 20, sides: true, coverage: [100, 100],
    cells_b: b64([80, 0, 0, 0, 0, 0]), cells_a: b64([0, 0, 0, 90, 0, 0]) };
  assert.ok(st.merge(r));
  assert.equal(st.column(0).length, 6);
  assert.deepEqual([...st.column(900000)], [0, 0, 0, 90, 0, 0]);
  const blue = [41, 98, 255];
  const orange = [245, 124, 0];
  const img = buildImage([st.column(0), st.column(900000)], 3, { lo: 1, hi: 100 }, false, 1, { b: blue, a: orange });
  const px = (c, row) => [...img.data.slice(((3 - 1 - row) * 2 + c) * 4, ((3 - 1 - row) * 2 + c) * 4 + 4)];
  assert.ok(px(0, 0)[2] > px(0, 0)[0], 'compra en azul');
  assert.ok(px(1, 0)[0] > px(1, 0)[2], 'venta en naranja');
  assert.equal(px(0, 1)[3], 0);
  // otra respuesta sin lados es otra grilla: empieza de cero
  st.merge({ t0: 0, cols: 1, frame_ms: 900000, rows: 3, row0: 100, step: 20, coverage: [100], cells: b64([5, 5, 5]) });
  assert.equal(st.sides, false);
  assert.equal(st.column(900000), null);
});

t('rampa de un lado: transparente con poco, firme con mucho; colores del estilo', () => {
  assert.equal(sideRamp(0, [41, 98, 255])[3], 0);
  assert.ok(sideRamp(1, [41, 98, 255])[3] >= 230);
  assert.ok(sideRamp(1, [41, 98, 255])[2] < 255, 'en lo más alto se oscurece en fondo claro');
  assert.ok(sideRamp(1, [41, 98, 255], true)[0] > 41, 'y se aclara en fondo oscuro');
  assert.deepEqual(hexRgb('#2962FF'), [41, 98, 255]);
  assert.deepEqual(hexRgb('rojo', [1, 2, 3]), [1, 2, 3]);
});

console.log(`\n${count} pruebas pasan`);
