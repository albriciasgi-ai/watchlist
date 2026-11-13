// Rectángulo de la barra de dibujo: lo que se arrastra o se cambia de tamaño queda en lo que se guarda.
// Antes un cambio de tamaño solo se veía: se guardaba el rectángulo anterior y volvía al recargar.
// Uso: node tests/rectangle.test.mjs
import assert from 'node:assert/strict';

const { default: Rectangle } = await import('../src/components/drawing/shapes/Rectangle.js');

let count = 0;
const t = (name, fn) => { fn(); count++; console.log('ok', name); };

// Escala 1 a 1: y es el precio y x la hora (x = 0 no es una hora válida para el rectángulo)
const scale = { yToPrice: (y) => y, xToTime: (x) => x, priceToY: (p) => p, timeToX: (time) => time };
const reload = (rect) => Rectangle.deserialize(JSON.parse(JSON.stringify(rect.serialize())));
const box = (r) => [r.priceLow, r.priceHigh, r.timeStart, r.timeEnd];

t('cambiar el borde de arriba queda guardado', () => {
  const r = new Rectangle(100, 1000, 90, 2000);
  r.startResize('top', 1500, 100, scale);
  r.updateDrag(1500, 120, scale);
  r.endDrag();
  assert.deepEqual(box(r), [90, 120, 1000, 2000]);
  assert.deepEqual(box(reload(r)), [90, 120, 1000, 2000]);
});

t('cambiar una esquina (precio y hora) queda guardado', () => {
  const r = new Rectangle(100, 1000, 90, 2000);
  r.startResize('bottom-right', 2000, 90, scale);
  r.updateDrag(2600, 80, scale);
  r.endDrag();
  assert.deepEqual(box(reload(r)), [80, 100, 1000, 2600]);
});

t('pasar un borde al otro lado invierte bien el rectángulo', () => {
  const r = new Rectangle(100, 1000, 90, 2000);
  r.startResize('left', 1000, 95, scale);
  r.updateDrag(2500, 95, scale);
  r.endDrag();
  assert.deepEqual(box(reload(r)), [90, 100, 2000, 2500]);
});

t('arrastrarlo entero sigue quedando guardado', () => {
  const r = new Rectangle(100, 1000, 90, 2000);
  r.startDrag(1500, 95, scale);
  r.updateDrag(1800, 105, scale);
  r.endDrag();
  assert.deepEqual(box(reload(r)), [100, 110, 1300, 2300]);
});

console.log(`${count} pruebas pasan`);
