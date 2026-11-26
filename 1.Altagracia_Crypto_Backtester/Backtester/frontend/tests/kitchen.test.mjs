// La cocina de estrategias: el catálogo de bloques, dónde va cada bloque elegido, la frase, las velas que se mandan al
// motor, lo que se pinta en el gráfico y las versiones. Uso: node tests/kitchen.test.mjs
import assert from 'node:assert/strict';
import { EVENT, STATE, allBlocks, blockDef, blockText, kindIn, lineName, protoOf } from '../src/components/kitchen/kitchenCatalog.js';
import {
  LEAD_BARS, MAX_STEPS, addBlock, addStep, allBlocksOf, blankDoc, candleVerdict, closedWindow, docForEngine, isBlank, kitchenBands, linkFor,
  mirrored, normalizeDoc, phrase, placeFor, relativeDir, removeBlock, removeStep, setParam, withSide, withVersion, withoutStrategy
} from '../src/components/kitchen/kitchenDoc.js';

const tests = [];
const test = (name, run) => tests.push([name, run]);
const H = 3600000; // Velas de 1 hora
const T0 = Date.UTC(2023, 4, 10, 12);
const at = (n) => T0 + n * H;

test('cada bloque del catálogo se lee en los tres lados y trae sus valores de fábrica', () => {
  const blocks = allBlocks();
  assert.ok(blocks.length >= 40);
  for (const def of blocks) {
    assert.ok([STATE, EVENT].includes(def.kind), def.id);
    const proto = protoOf(def.id);
    const texts = ['long', 'short', 'both'].map(side => blockText(proto, side));
    texts.forEach(text => assert.ok(text && !/undefined|NaN/.test(text), `${def.id}: ${text}`));
    if (def.sided) {
      assert.notEqual(texts[0], texts[1], `${def.id} dice lo mismo en largo y en corto`);
      assert.ok(['favor', 'contra'].includes(proto.p.dir), def.id);
    } else assert.equal(proto.p.dir, undefined, def.id);
  }
  assert.equal(blockDef('nada'), null);
  assert.equal(lineName('e50'), 'la EMA 50');
  assert.equal(lineName('teeth'), 'los dientes');
});

test('un bloque dice lo mismo en el gráfico desde un corto o desde un largo', () => {
  const short = blockText(protoOf('side', { line: 'e20', dir: 'contra' }), 'short');
  const long = blockText(protoOf('side', { line: 'e20', dir: 'favor' }), 'long');
  assert.equal(short, 'Cierra por encima de la EMA 20');
  assert.equal(long, short);
  assert.equal(blockText(protoOf('HM'), 'short'), 'Estrella fugaz');
  assert.equal(blockText(protoOf('HM'), 'long'), 'Martillo');
  assert.equal(blockText(protoOf('xline', { a: 'lips', b: 'teeth' }), 'both'), 'Los labios cruzan los dientes, a favor');
  assert.equal(relativeDir(1, 'short'), 'contra');
  assert.equal(relativeDir(-1, 'short'), 'favor');
  assert.equal(relativeDir(1, 'both', 'long'), 'favor');
});

test('la cocina abre en blanco y la frase lo dice', () => {
  const doc = blankDoc();
  assert.ok(isBlank(doc));
  assert.match(phrase(doc), /Todavía está en blanco/);
  assert.deepEqual(docForEngine(doc), { side: 'short', ctx: [], ctxWhen: 'first', links: [], gat: [{ mode: 'all', min: 1, win: 5, blocks: [] }] });
});

test('lo de una misma vela va al mismo paso; un estado de esa vela, al contexto', () => {
  let doc = addBlock(blankDoc(), 'auto', protoOf('HM'), at(0), H);
  assert.equal(doc.gat[0].blocks.length, 1);
  assert.equal(doc.gat[0].src, at(0));
  doc = addBlock(doc, 'auto', protoOf('lejos', { line: 'e50', atr: 1.5, dir: 'contra' }), at(0), H);
  assert.equal(doc.ctx.length, 1);
  assert.equal(doc.ctx[0].conv, null);
  doc = addBlock(doc, 'auto', protoOf('VH'), at(2), H);        // Dos velas después: sigue siendo el mismo momento
  assert.equal(doc.gat.length, 1);
  assert.equal(doc.gat[0].blocks.length, 2);
  assert.equal(placeFor(doc, blockDef('lejos'), at(0), H, true).kind, 'step');  // El otro lugar posible de un estado
});

test('lo de una vela posterior va a un paso después, con un plazo que cubre la distancia', () => {
  let doc = addBlock(blankDoc(), 'auto', protoOf('HM'), at(0), H);
  doc = addBlock(doc, 'auto', protoOf('QB'), at(9), H);
  assert.equal(doc.gat.length, 2);
  assert.deepEqual(doc.links, [{ type: 'after', max: 12 }]);
  assert.deepEqual(linkFor(at(0), at(9), H), { type: 'after', max: 12 });
  doc = addBlock(doc, 'auto', protoOf('pausa'), at(9), H);     // Un estado de la vela del paso 2 va con ese paso
  assert.equal(doc.gat[1].blocks.length, 2);
  assert.equal(doc.gat[1].blocks[1].conv, 'during');
  assert.equal(doc.ctx.length, 0);
  doc = addBlock(doc, 'auto', protoOf('VH'), at(4), H);        // Entre los dos pasos: un paso nuevo en medio
  assert.equal(doc.gat.length, 3);
  assert.deepEqual(doc.gat.map(step => step.src), [at(0), at(4), at(9)]);
  assert.deepEqual(doc.links, [{ type: 'after', max: 7 }, { type: 'after', max: 8 }]);
});

test('un evento que se lleva al contexto cuenta si ocurrió hace poco', () => {
  const doc = addBlock(blankDoc(), 'ctx', protoOf('VH'), at(0), H);
  assert.equal(doc.ctx[0].conv, 'recent');
  assert.equal(kindIn(doc.ctx[0]), STATE);
  assert.match(blockText(doc.ctx[0], 'short'), /en las últimas 5 velas$/);
});

test('no pasa de cuatro pasos, y quitar un paso deja los enlaces en su sitio', () => {
  let doc = blankDoc();
  for (let k = 0; k < 6; k += 1) doc = addBlock(doc, 'auto', protoOf('HM'), at(k * 10), H);
  assert.equal(doc.gat.length, MAX_STEPS);
  assert.equal(doc.links.length, MAX_STEPS - 1);
  assert.equal(allBlocksOf(doc).length, 6);
  const less = removeStep(doc, 1);
  assert.equal(less.gat.length, 3);
  assert.equal(less.links.length, 2);
  const none = removeStep(removeStep(removeStep(removeStep(doc, 0), 0), 0), 0);
  assert.ok(isBlank(none));
  assert.equal(none.gat.length, 1);
  assert.equal(addStep(blankDoc()).gat.length, 1);              // Un paso vacío no pide otro
  assert.equal(addStep(addBlock(blankDoc(), 'auto', protoOf('HM'), at(0), H)).gat.length, 2);
});

test('quitar y cambiar un bloque', () => {
  let doc = addBlock(blankDoc(), 'auto', protoOf('IM'), at(0), H);
  const uid = doc.gat[0].blocks[0].uid;
  doc = setParam(doc, uid, 'atr', 3.5);
  assert.equal(doc.gat[0].blocks[0].p.atr, 3.5);
  assert.ok(isBlank(removeBlock(doc, uid)));
});

test('al cambiar de lado cada bloque sigue diciendo lo mismo; espejar lo da vuelta', () => {
  let doc = addBlock(blankDoc(), 'auto', protoOf('HM'), at(0), H);
  doc = addBlock(doc, 'ctx', protoOf('lejos', { line: 'e50', atr: 2, dir: 'contra' }), at(0), H);
  const before = allBlocksOf(doc).map(block => blockText(block, 'short'));
  const long = withSide(doc, 'long');
  assert.deepEqual(allBlocksOf(long).map(block => blockText(block, 'long')), before);
  const flipped = mirrored(doc);
  assert.equal(blockText(flipped.gat[0].blocks[0], 'short'), 'Martillo');
  assert.equal(withSide(doc, 'both').gat[0].blocks[0].p.dir, 'favor');
});

test('la estrategia en una frase', () => {
  let doc = addBlock(blankDoc(), 'ctx', protoOf('lejos', { line: 'e50', atr: 2, dir: 'contra' }), at(0), H);
  doc = addBlock(doc, 'auto', protoOf('HM'), at(0), H);
  doc = addBlock(doc, 'auto', protoOf('VH'), at(1), H);
  doc = addBlock(doc, 'auto', protoOf('QB'), at(8), H);
  assert.equal(phrase(doc), 'Solo cortos. Contexto: está a más de 2 ATR por encima de la EMA 50. '
    + 'Gatillo: se juntan estrella fugaz y vela bajista con volumen alto, en 5 velas; después, hasta 11 velas, ruptura con volumen, bajista.');
  assert.match(phrase({ ...doc, side: 'both' }), /^Largos y cortos, en espejo\. /);
});

test('al motor solo van velas ya cerradas, con las anteriores que calientan los indicadores', () => {
  const main = Array.from({ length: 3000 }, (_, i) => ({ timestamp: at(i), open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }));
  const now = at(2500) + 20 * 60000;                            // La vela 2500 se está formando
  const win = closedWindow(main, '1h', now, 1000);
  assert.equal(win.lastTime, at(2499));
  assert.equal(win.rows.length, 1000 + LEAD_BARS['1h']);
  assert.equal(win.rows[win.rows.length - 1][0], at(2499));
  assert.equal(win.view, 1000);
  assert.deepEqual(win.rows[0], [at(2500 - 1840), 1, 2, 0.5, 1.5, 10]);
  assert.equal(closedWindow(main, '1h', at(0) + 1000), null);    // Todavía no cerró ninguna
  assert.equal(closedWindow(main, '1h', at(300), 1000).rows.length, 300);
  assert.equal(closedWindow([], '1h', now), null);
});

test('en el gráfico: una fila por capa, un triángulo por señal, las líneas y la vela elegida', () => {
  const times = Array.from({ length: 10 }, (_, i) => at(i));
  const result = {
    success: true, times, blocks: { u1: { runs: [[1, 2]], count: 2 } }, context: { has: true, runs: [[0, 3]], count: 4 },
    steps: [{ step: 0, alone: [4], chained: [2], done: 2, reached: 1 }, { step: 1, alone: [], chained: [6], done: 1, reached: 1 }],
    signals: [{ i: 6, side: -1 }], near: [[3, 5]], lines: { e50: [null, 100, 101, 102, 103, 104, 105, 106, 107, 108], teeth: [] }
  };
  const bands = kitchenBands(result, { tf: '1h', pick: at(6), focus: 'u1', focusText: 'Estrella fugaz' });
  const rows = bands.filter(band => band.kind === 'ticks');
  assert.deepEqual(rows.map(band => band.label), ['Estrella fugaz', 'Contexto', 'Paso 1', 'Paso 2', 'Señal']);
  assert.ok(rows.every(band => band.rows === 5 && band.tf === H));
  assert.deepEqual(rows[1].items, [[at(0), 1], [at(1), 1], [at(2), 1], [at(3), 1]]);
  assert.deepEqual(rows[2].items, [[at(4), 2], [at(2), 1]]);       // Solo: tono claro. Encadenado: tono fuerte
  assert.deepEqual(rows[4].items, [[at(3), 2], [at(4), 2], [at(5), 2], [at(6), 1]]);
  assert.deepEqual(bands.filter(band => band.kind === 'signal').map(band => [band.time, band.dir, band.rows]), [[at(6), -1, 5]]);
  const line = bands.find(band => band.kind === 'line');
  assert.equal(line.label, 'EMA 50');
  assert.equal(line.points.length, 9);
  assert.deepEqual(bands.find(band => band.kind === 'column'), { kind: 'column', tf: H, time: at(6), rows: 5 });
  assert.deepEqual(kitchenBands(null, { tf: '1h' }), []);
  assert.deepEqual(kitchenBands({ success: true, times, steps: [], signals: [], context: { has: false } }, { tf: '1h' }), []);
});

test('lo que la estrategia hace en la vela elegida, en palabras', () => {
  let doc = addBlock(blankDoc(), 'ctx', protoOf('lejos'), at(0), H);
  doc = addBlock(doc, 'auto', protoOf('HM'), at(0), H);
  doc = addBlock(doc, 'auto', protoOf('QB'), at(9), H);
  const candle = (diag) => ({ t: at(9), diag: [{ side: -1, ...diag }] });
  const enters = candleVerdict(candle({ context: false, signal: true, near: false, steps: [{ done: false, reached: false }, { done: true, reached: true }] }), doc)[0];
  assert.equal(enters.title, 'Aquí entra (corto): da señal en esta vela');
  // En la vela de la entrada, lo anterior ya se cumplió antes: no sale como una falla
  assert.deepEqual(enters.lines.map(line => line.ok), [true, true, true]);
  assert.match(enters.lines[0].text, /mientras se juntaba el paso 1/);
  assert.match(enters.lines[1].text, /se cumplió antes/);
  const near = candleVerdict(candle({ context: true, signal: false, near: true, steps: [{ done: true, reached: true }, { done: false, reached: false }] }), doc)[0];
  assert.match(near.title, /está a punto/);
  assert.deepEqual(near.lines.map(line => line.ok), [true, true, false]);
  const waiting = candleVerdict(candle({ context: false, signal: false, near: true, steps: [{ done: false, reached: false }, { done: false, reached: false }] }), doc)[0];
  assert.deepEqual(waiting.lines.map(line => line.ok), [true, true, false]);   // A punto, velas después del paso 1
  const noTrigger = candleVerdict(candle({ context: true, signal: false, near: false, steps: [] }), addBlock(blankDoc(), 'ctx', protoOf('lejos'), at(0), H))[0];
  assert.match(noTrigger.title, /Todavía no hay gatillo/);
  const loose = candleVerdict(candle({ context: false, signal: false, near: false, steps: [{ done: false, reached: false }, { done: true, reached: false }] }), doc)[0];
  assert.equal(loose.title, 'Aquí no entra (corto)');
  assert.match(loose.lines[2].text, /suelto/);
  assert.deepEqual(candleVerdict(candle({ context: true, signal: false, near: false, steps: [] }), blankDoc()), []);
});

test('cada guardado suma una versión; una igual a la vigente no', () => {
  const doc = addBlock(blankDoc(), 'auto', protoOf('HM'), at(0), H);
  const first = withVersion({ list: [] }, { id: null, name: ' Giro arriba ', symbol: 'BTCUSDT', tf: '1h' }, doc, 1000);
  assert.ok(first.saved);
  assert.equal(first.version, 1);
  assert.equal(first.store.list[0].name, 'Giro arriba');
  const same = withVersion(first.store, { id: first.id, name: 'Giro arriba', symbol: 'BTCUSDT', tf: '1h' }, doc, 2000);
  assert.ok(!same.saved);
  assert.equal(same.store.list[0].versions.length, 1);
  const changed = withVersion(first.store, { id: first.id, name: 'Giro arriba', symbol: 'BTCUSDT', tf: '1h' }, addBlock(doc, 'auto', protoOf('VH'), at(1), H), 3000);
  assert.equal(changed.version, 2);
  assert.equal(changed.store.list[0].versions[1].at, 3000);
  assert.deepEqual(withoutStrategy(changed.store, first.id), { list: [] });
});

test('un documento guardado se abre aunque le falten cosas o traiga bloques que ya no existen', () => {
  const doc = normalizeDoc({ side: 'long', ctx: [{ id: 'nada' }, { id: 'vpam' }], gat: [{ blocks: [{ id: 'HM', p: { dir: 'contra' } }], win: 99 }, { blocks: [] }], links: [] });
  assert.equal(doc.ctx.length, 1);
  assert.equal(doc.ctx[0].p.u, 0.3);
  assert.equal(doc.gat[0].win, 20);
  assert.equal(doc.gat[0].blocks[0].p.dir, 'contra');
  assert.deepEqual(doc.links, [{ type: 'after', max: 5 }]);
  assert.ok(isBlank(normalizeDoc(null)));
});

let failed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FALLA ${name}\n      ${error.message}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} correctas`);
process.exit(failed ? 1 : 0);
