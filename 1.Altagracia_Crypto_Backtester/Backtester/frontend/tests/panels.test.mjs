// Orden y altura de los paneles. Uso: node tests/panels.test.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolver.mjs', import.meta.url);

console.log = ((log) => (...args) => {
  if (String(args[0]).startsWith('ok ') || String(args[0]).startsWith('FALLA') || String(args[0]).includes('pruebas correctas')) log(...args);
})(console.log);

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};

const { MIN_PANEL_HEIGHT, clearPanelLayout, movePanel, orderPanels, panelLayout, resizePanel } = await import('../src/components/indicators/panelLayout.js');
const { default: IndicatorManager } = await import('../src/components/indicators/IndicatorManager.js');

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('orden: sin elegir nada queda el de siempre', () => {
  assert.deepEqual(orderPanels(['A', 'B', 'C'], []), ['A', 'B', 'C']);
});

test('orden: respeta lo elegido y deja al final lo que nunca se movió', () => {
  assert.deepEqual(orderPanels(['A', 'B', 'C', 'D'], ['C', 'A']), ['C', 'A', 'B', 'D']);
});

test('orden: ignora nombres que ya no existen', () => {
  assert.deepEqual(orderPanels(['A', 'B'], ['X', 'B', 'A']), ['B', 'A']);
});

test('mover: cambia de lugar con su vecino', () => {
  assert.deepEqual(movePanel([], ['A', 'B', 'C'], ['A', 'B', 'C'], 'B', -1), ['B', 'A', 'C']);
  assert.deepEqual(movePanel([], ['A', 'B', 'C'], ['A', 'B', 'C'], 'B', 1), ['A', 'C', 'B']);
});

test('mover: en los extremos no hace nada', () => {
  assert.deepEqual(movePanel([], ['A', 'B'], ['A', 'B'], 'A', -1), ['A', 'B']);
  assert.deepEqual(movePanel([], ['A', 'B'], ['A', 'B'], 'B', 1), ['A', 'B']);
});

test('mover: salta los paneles apagados y estos conservan su sitio', () => {
  assert.deepEqual(movePanel([], ['A', 'B', 'C', 'D'], ['A', 'C', 'D'], 'C', -1), ['C', 'B', 'A', 'D']);
});

test('mover: parte del orden ya elegido', () => {
  assert.deepEqual(movePanel(['C', 'A', 'B'], ['A', 'B', 'C'], ['A', 'B', 'C'], 'A', -1), ['A', 'C', 'B']);
});

/** El mismo reparto que hace MiniChart */
function draw(available, ratio, volume, heights) {
  const target = Math.floor(available * ratio);
  const total = volume + heights.reduce((sum, height) => sum + height, 0);
  const scale = Math.min(1, (available - target) / total);
  const shown = heights.map(height => Math.max(Math.min(height, MIN_PANEL_HEIGHT), Math.floor(height * scale)));
  const shownVolume = Math.max(Math.min(volume, 40), Math.floor(volume * scale));
  const price = Math.max(Math.floor(available * 0.3), available - shownVolume - shown.reduce((sum, height) => sum + height, 0));
  return { scale, shown, price };
}

const drag = (available, ratio, volume, heights, index, delta) => {
  const before = draw(available, ratio, volume, heights);
  const others = volume + heights.reduce((sum, height, i) => sum + (i === index ? 0 : height), 0);
  const result = resizePanel({ shown: before.shown[index], delta, scale: before.scale, others, availableHeight: available, ratio });
  const nextHeights = heights.map((height, i) => (i === index ? result.height : height));
  return { before, result, after: draw(available, result.ratio, volume, nextHeights) };
};

test('altura: con paneles comprimidos solo cambia ese panel y el precio cede', () => {
  const { before, after } = drag(760, 0.65, 80, [80, 150, 120, 90], 1, 40);
  assert.ok(before.scale < 1);
  assert.ok(Math.abs(after.shown[1] - before.shown[1] - 40) <= 2, `creció ${after.shown[1] - before.shown[1]}`);
  for (const i of [0, 2, 3]) assert.ok(Math.abs(after.shown[i] - before.shown[i]) <= 1, `panel ${i}`);
  assert.ok(Math.abs(before.price - after.price - 40) <= 4, `precio cedió ${before.price - after.price}`);
});

test('altura: bajar un panel comprimido le devuelve espacio al precio', () => {
  const { before, after } = drag(760, 0.65, 80, [200, 200], 0, -30);
  assert.ok(Math.abs(before.shown[0] - after.shown[0] - 30) <= 2);
  assert.ok(Math.abs(after.shown[1] - before.shown[1]) <= 1);
  assert.ok(after.price > before.price);
});

test('altura: si sobra espacio el precio sigue igual de reparto', () => {
  const { result, after } = drag(760, 0.65, 80, [90], 0, 30);
  assert.equal(result.height, 120);
  assert.equal(result.ratio, 0.65);
  assert.equal(after.shown[0], 120);
});

test('altura: al acabarse lo que sobra el precio cede sin comprimir a nadie', () => {
  const { result, after } = drag(760, 0.65, 80, [90], 0, 200);
  assert.ok(result.ratio < 0.65);
  assert.equal(after.scale, 1);
  assert.equal(after.shown[0], 290);
});

test('altura: no baja de lo legible', () => {
  assert.equal(drag(760, 0.65, 80, [90], 0, -500).result.height, MIN_PANEL_HEIGHT);
});

test('altura: el precio conserva al menos su mínimo', () => {
  const { result } = drag(760, 0.65, 80, [90, 90], 0, 2000);
  assert.ok(result.ratio >= 0.3);
  assert.ok(result.height <= 760 * 0.7);
});

test('altura: el precio no pasa de su máximo', () => {
  const { result } = drag(760, 0.84, 30, [300], 0, -200);
  assert.ok(result.ratio <= 0.85);
});

const panel = (name, height, extra = {}) => ({
  name,
  enabled: true,
  height,
  getHeight() { return this.enabled ? this.height : 0; },
  render(ctx, bounds) { ctx.push([name, bounds.y, bounds.height]); },
  ...extra
});

let count = 0;
function manager(indicators) {
  const symbol = `PRUEBA${++count}`;
  const result = new IndicatorManager(symbol, '60', 30);
  result.indicators = indicators;
  return result;
}

test('paneles: sin elegir nada se apilan como siempre', () => {
  const target = manager([panel('A', 80), panel('B', 100)]);
  const drawn = [];
  target.renderIndicators(drawn, { x: 0, y: 500, width: 100, height: 180 }, []);
  assert.deepEqual(drawn, [['A', 500, 80], ['B', 580, 100]]);
});

test('paneles: se dibujan en el orden elegido', () => {
  const target = manager([panel('A', 80), panel('B', 100), panel('C', 60)]);
  target.movePanel('C', -1);
  const drawn = [];
  target.renderIndicators(drawn, { x: 0, y: 500, width: 100, height: 240 }, []);
  assert.deepEqual(drawn, [['A', 500, 80], ['C', 580, 60], ['B', 640, 100]]);
});

test('paneles: los apagados, sin panel o sin dibujo no se apilan', () => {
  const target = manager([panel('A', 80, { enabled: false }), panel('B', 0), panel('C', 60, { render: undefined }), panel('D', 60)]);
  assert.deepEqual(target.getPanels().map(item => item.name), ['D']);
});

test('altura: la elegida manda sobre la de fábrica', () => {
  const target = manager([panel('A', 80), panel('B', 100)]);
  target.setPanelHeight('A', 140);
  assert.equal(target.getTotalHeight(), 240);
  assert.equal(target.getPanelHeight(target.indicators[0]), 140);
  assert.deepEqual(target.getPanelRects(10), [
    { name: 'A', top: 10, height: 140, requested: 140 },
    { name: 'B', top: 150, height: 100, requested: 100 }
  ]);
});

test('altura: un panel apagado no pide espacio aunque tenga altura elegida', () => {
  const target = manager([panel('A', 80, { enabled: false })]);
  target.setPanelHeight('A', 140);
  assert.equal(target.getTotalHeight(), 0);
  assert.equal(target.getPanelHeight(target.indicators[0]), 0);
});

test('altura: también se comprime cuando no cabe, sin bajar de lo legible', () => {
  const target = manager([panel('A', 80), panel('B', 300)]);
  target.setHeightScale(0.5);
  assert.equal(target.getPanelHeight(target.indicators[0]), MIN_PANEL_HEIGHT);
  assert.equal(target.getPanelHeight(target.indicators[1]), 150);
});

test('altura: escribirla en el modal del indicador reemplaza la arrastrada', async () => {
  const target = manager([panel('A', 80, { applyConfig(config) { this.height = config.height; } })]);
  target.setPanelHeight('A', 140);
  await target.applyConfig('A', { height: 100 });
  assert.equal(target.getPanelHeight(target.indicators[0]), 100);
});

test('altura: un modal que no cambia la altura conserva la arrastrada', async () => {
  const target = manager([panel('A', 80, { applyConfig() {} })]);
  target.setPanelHeight('A', 140);
  await target.applyConfig('A', { height: 80, color: 'red' });
  assert.equal(target.getPanelHeight(target.indicators[0]), 140);
});

test('reparto: los marcos de un símbolo comparten orden y altura', () => {
  const first = new IndicatorManager('COMPARTIDO', '15', 30);
  const second = new IndicatorManager('COMPARTIDO', '60', 30);
  first.indicators = [panel('A', 80), panel('B', 100)];
  second.indicators = [panel('A', 80), panel('B', 100)];
  first.movePanel('B', -1);
  first.setPanelHeight('A', 120);
  assert.deepEqual(second.getPanels().map(item => item.name), ['B', 'A']);
  assert.equal(second.getPanelHeight(second.indicators[0]), 120);
});

test('reparto: cada símbolo tiene el suyo', () => {
  const first = manager([panel('A', 80)]);
  const second = manager([panel('A', 80)]);
  first.setPanelHeight('A', 200);
  assert.equal(second.getPanelHeight(second.indicators[0]), 80);
});

test('reparto: se guarda y vuelve al recargar', () => {
  const target = manager([panel('A', 80), panel('B', 100)]);
  target.movePanel('B', -1);
  target.setPanelHeight('A', 120);
  target.savePanels();
  const saved = JSON.parse(stored.get(`indicator_panels_${target.symbol}`));
  assert.deepEqual(saved, { order: ['B', 'A'], heights: { A: 120 } });
});

test('reparto: mover un panel queda guardado de una vez', () => {
  const target = manager([panel('A', 80), panel('B', 100)]);
  target.movePanel('B', -1);
  assert.deepEqual(JSON.parse(stored.get(`indicator_panels_${target.symbol}`)).order, ['B', 'A']);
});

test('reparto: lo guardado se lee al abrir', () => {
  stored.set('indicator_panels_GUARDADO', JSON.stringify({ order: ['B', 'A'], heights: { B: 70 } }));
  assert.deepEqual(panelLayout('GUARDADO'), { order: ['B', 'A'], heights: { B: 70 } });
});

test('reparto: sin almacenamiento sigue funcionando', () => {
  const saved = globalThis.localStorage;
  delete globalThis.localStorage;
  const target = manager([panel('A', 80), panel('B', 100)]);
  target.movePanel('B', -1);
  target.resetPanels();
  assert.deepEqual(target.getPanels().map(item => item.name), ['A', 'B']);
  globalThis.localStorage = saved;
});

test('reparto: restablecer vuelve a lo de fábrica y borra lo guardado', () => {
  const target = manager([panel('A', 80), panel('B', 100)]);
  target.movePanel('B', -1);
  target.setPanelHeight('A', 120);
  target.savePanels();
  target.resetPanels();
  assert.deepEqual(target.getPanels().map(item => item.name), ['A', 'B']);
  assert.equal(target.getPanelHeight(target.indicators[0]), 80);
  assert.equal(stored.has(`indicator_panels_${target.symbol}`), false);
});

test('reparto: limpiar deja el mismo objeto para los marcos abiertos', () => {
  const layout = panelLayout('MISMO');
  layout.heights.A = 100;
  clearPanelLayout('MISMO');
  assert.equal(panelLayout('MISMO'), layout);
  assert.deepEqual(layout, { order: [], heights: {} });
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`ok ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}: ${error.message}`);
  }
}
console.log(`${tests.length - failed} de ${tests.length} pruebas correctas`);
process.exit(failed ? 1 : 0);
