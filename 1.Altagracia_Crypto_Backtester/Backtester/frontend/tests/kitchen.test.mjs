// La cocina de estrategias: el catálogo de bloques, dónde va cada bloque elegido, la frase, las velas que se mandan al
// motor, lo que se pinta en el gráfico y las versiones. Uso: node tests/kitchen.test.mjs
import assert from 'node:assert/strict';
import {
  EVENT, FLOW_STATES, STATE, USER_ZONE_KINDS, VP_PARTS, ZONE_KINDS, ZONE_TYPES, allBlocks, blockDef, blockText, kindIn, lineName, pickText, protoOf,
  zoneName
} from '../src/components/kitchen/kitchenCatalog.js';
import {
  LEAD_BARS, MAX_PICKS, MAX_STEPS, addBlock, addPick, addStep, allBlocksOf, blankDoc, candleVerdict, closedWindow, docForEngine, drawnZones, isBlank,
  kitchenBands, linkFor, mirrored, normalizeDoc, offersForEngine, phrase, pickFromZone, pickRange, placeFor, profileZones, relativeDir, removeBlock,
  removePick, removeStep, samePick, setParam, setZone, withSide, withVersion, withoutStrategy, zoneText
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
  assert.deepEqual(docForEngine(doc), {
    side: 'short', ctx: [], ctxWhen: 'first', links: [], zone: { rel: 'near', atr: 0.5, when: 'first', picks: [] },
    gat: [{ mode: 'all', min: 1, win: 5, blocks: [] }]
  });
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

// ==================== La capa de zona y el order flow (paso 1.2) ====================

const RESISTANCE = { kind: 'sr', way: -1, lo: 65480, hi: 65520, from: at(3), touch: true, gapAtr: 0, under: true };
const GAP = { kind: 'fvg', way: 1, lo: 64000, hi: 64200, from: at(5), touch: false, gapAtr: 1.2, under: false };

test('una zona del gráfico se suma de dos maneras: todas las de su tipo o solo esa', () => {
  const all = pickFromZone(RESISTANCE, 'kind', 'short');
  assert.deepEqual(all, { type: 'kind', kind: 'sr', dir: 'favor' });            // Una resistencia va a favor de un corto
  assert.deepEqual(pickFromZone(RESISTANCE, 'kind', 'long'), { type: 'kind', kind: 'sr', dir: 'contra' });
  assert.deepEqual(pickFromZone(RESISTANCE, 'kind', 'both', 'long'), { type: 'kind', kind: 'sr', dir: 'contra' });
  assert.deepEqual(pickFromZone({ kind: 'liq', way: 0, lo: 1, hi: 2, from: at(0) }, 'kind', 'short'), { type: 'kind', kind: 'liq', dir: 'any' });
  const one = pickFromZone(RESISTANCE, 'one', 'short');
  assert.deepEqual(one, { type: 'one', kind: 'sr', lo: 65480, hi: 65520, from: at(3), way: -1 });
  let doc = addPick(blankDoc(), all);
  assert.equal(doc.zone.picks.length, 1);
  assert.ok(doc.zone.picks[0].uid && !isBlank(doc));
  assert.equal(addPick(doc, all), doc);                                          // La misma no entra dos veces
  doc = addPick(doc, one);
  doc = addPick(doc, pickFromZone(GAP, 'kind', 'short'));
  assert.deepEqual(doc.zone.picks.map(pick => pickText(pick, 'short', pick.type === 'one' ? pickRange(pick) : '')),
    ['Resistencias', 'Solo esta: resistencia 65480 a 65520', 'FVG abiertos alcistas']);
  assert.ok(samePick(doc.zone.picks[1], one) && !samePick(doc.zone.picks[0], one));
  assert.equal(removePick(doc, doc.zone.picks[0].uid).zone.picks.length, 2);
  for (let k = 0; k < 10; k += 1) doc = addPick(doc, { type: 'one', kind: 'draw', lo: 100 + k, hi: 101 + k, from: at(k), way: 0 });
  assert.equal(doc.zone.picks.length, MAX_PICKS);
  assert.equal(setZone(doc, { rel: 'in', atr: 99, when: 'last' }).zone.rel, 'in');
  assert.equal(setZone(doc, { atr: 99 }).zone.atr, 3);
  assert.equal(setZone(doc, { atr: 'x' }).zone.atr, 0.5);
  // Al motor va la zona sin lo que solo le sirve a la pantalla
  const sent = docForEngine(addPick(blankDoc(), { ...one, shape: 'rect' })).zone.picks[0];
  assert.deepEqual(Object.keys(sent).sort(), ['from', 'hi', 'kind', 'lo', 'type', 'uid', 'way']);
  // Un nivel de S&R es una línea; va con su toque más lejano, que es el que un cierre tiene que pasar para romperlo
  const level = { kind: 'sr', way: -1, lo: 65500, hi: 65500, edge: 65530, from: at(3) };
  const line = pickFromZone(level, 'one', 'short');
  assert.equal(line.edge, 65530);
  assert.equal(docForEngine(addPick(blankDoc(), line)).zone.picks[0].edge, 65530);
  assert.equal(pickFromZone(level, 'kind', 'short').edge, undefined);
  assert.equal(normalizeDoc({ zone: { picks: [{ type: 'one', kind: 'draw', lo: 1, hi: 2, from: at(0), edge: 3 }] } }).zone.picks[0].edge, undefined);
});

test('cada zona elegida se lee según el lado del trade', () => {
  const pick = (kind, dir) => ({ type: 'kind', kind, dir });
  assert.equal(pickText(pick('sr', 'favor'), 'short'), 'Resistencias');
  assert.equal(pickText(pick('sr', 'favor'), 'long'), 'Soportes');
  assert.equal(pickText(pick('sr', 'contra'), 'long'), 'Resistencias');
  assert.equal(pickText(pick('sr', 'favor'), 'both'), 'Soportes y resistencias, a favor');
  assert.equal(pickText(pick('sr', 'any'), 'short'), 'Soportes y resistencias');
  assert.equal(pickText(pick('ob', 'contra'), 'short'), 'Order blocks alcistas');
  assert.equal(pickText(pick('fvg', 'contra'), 'both'), 'FVG abiertos, en contra');
  assert.equal(pickText(pick('liq', 'favor'), 'short'), 'Zonas de liquidaciones');
  assert.equal(pickText({ type: 'one', kind: 'draw', lo: 5, hi: 5, way: 0 }, 'short', '5'), 'Solo esta: línea dibujada 5');
  assert.equal(pickText({ type: 'one', kind: 'ob', lo: 5, hi: 6, way: 1 }, 'short', '5 a 6'), 'Solo esta: order block alcista 5 a 6');
  assert.equal(pickText({ type: 'one', kind: 'fvg', lo: 5, hi: 6, way: 1 }, 'short', '5 a 6'), 'Solo esta: FVG alcista 5 a 6');   // La sigla, como es
  assert.equal(zoneName({ kind: 'sr', way: 1 }), 'Soporte');
  assert.equal(zoneName({ kind: 'liq', way: 0 }), 'Zona de liquidaciones');
  assert.deepEqual(ZONE_KINDS, ['sr', 'fvg', 'ob', 'liq']);
  assert.deepEqual(USER_ZONE_KINDS, ['draw', 'vp']);
  for (const kind of [...ZONE_KINDS, ...USER_ZONE_KINDS]) assert.ok(ZONE_TYPES[kind].help && ZONE_TYPES[kind].all);
});

test('al cambiar de lado las zonas siguen siendo las mismas; espejar las da vuelta', () => {
  let doc = addPick(blankDoc(), pickFromZone(RESISTANCE, 'kind', 'short'));
  doc = addPick(doc, pickFromZone(RESISTANCE, 'one', 'short'));
  const texts = (d) => d.zone.picks.map(pick => pickText(pick, d.side, ''));
  assert.deepEqual(texts(withSide(doc, 'long')), texts(doc));                   // Siguen siendo resistencias
  assert.deepEqual(texts(mirrored(doc)), ['Soportes', 'Solo esta: resistencia']);  // Espejada: soportes; la fija es la que es
});

test('los dibujos del usuario que pueden ser una zona, y desde cuándo cuentan', () => {
  const shapes = [
    { id: 'r1', type: 'rectangle', price1: 107, price2: 105, time1: at(1), time2: at(4), createdAt: at(4) },
    { id: 'h1', type: 'horizontal', price: 110, time: at(2), createdAt: null },
    { id: 't1', type: 'trendline', price1: 1, price2: 2, time1: at(0), time2: at(1), createdAt: at(1) },
    { id: 'b1', type: 'tpsl', entry: 100 },
    { id: 'r2', type: 'rectangle', price1: 120, price2: 121, time1: at(1), time2: at(2), createdAt: at(30) }
  ];
  // Cuenta desde que se suma (la hora simulada de ese momento), no desde que se dibujó: se trazó viendo lo que ya pasó.
  // Y nunca antes de la hora en que se dibujó, si la simulación retrocedió después
  const found = drawnZones(shapes, at(10));
  assert.deepEqual(found.map(zone => [zone.id, zone.shape, zone.lo, zone.hi, zone.from]),
    [['r1', 'rect', 105, 107, at(10)], ['h1', 'line', 110, 110, at(10)], ['r2', 'rect', 120, 121, at(30)]]);
  assert.ok(found.every(zone => zone.type === 'one' && zone.kind === 'draw' && zone.way === 0));
  const doc = addPick(blankDoc(), found[0]);
  assert.equal(pickText(doc.zone.picks[0], 'short', pickRange(doc.zone.picks[0])), 'Solo esta: zona dibujada 105 a 107');
  assert.ok(samePick(doc.zone.picks[0], drawnZones(shapes, at(50))[0]));         // El mismo dibujo, más tarde: ya está
  assert.deepEqual(drawnZones(null, at(1)), []);
  assert.deepEqual(drawnZones(shapes, null).map(zone => zone.id), ['r1', 'r2']);  // Sin hora simulada, solo los que traen la suya
});

test('los perfiles de rango fijo del gráfico: sus niveles como zona, y desde cuándo cuentan', () => {
  const charted = [
    { id: 'range_1', label: 'A', start: at(1), end: at(6), poc: 105.5, vah: 107, val: 104, real: true },
    { id: 'range_2', label: '', start: at(2), end: at(40), poc: 200, vah: 200, val: 200, real: false },   // Un perfil de un solo precio
    { id: 'range_3', start: at(2), end: at(5), poc: null, vah: 1, val: 1 },                               // Sin calcular todavía
    null
  ];
  // Cada nivel cuenta desde que se suma (la hora simulada de ese momento), no desde el rango: se eligió viendo lo que ya pasó
  const groups = profileZones(charted, at(10));
  assert.deepEqual(groups.map(group => [group.id, group.label, group.start, group.end, group.real]),
    [['range_1', 'A', at(1), at(6), true], ['range_2', '', at(2), at(40), false]]);
  assert.deepEqual(groups[0].zones.map(zone => [zone.id, zone.shape, zone.lo, zone.hi]),
    [['range_1|poc', 'poc', 105.5, 105.5], ['range_1|vah', 'vah', 107, 107], ['range_1|val', 'val', 104, 104], ['range_1|va', 'va', 104, 107]]);
  assert.deepEqual(groups[1].zones.map(zone => zone.shape), ['poc', 'vah', 'val']);    // Sin área de valor: no tiene alto
  assert.ok(groups.flatMap(group => group.zones).every(zone => zone.type === 'one' && zone.kind === 'vp' && zone.way === 0 && zone.from === at(10)));
  assert.deepEqual(profileZones(charted, null), []);        // Sin hora simulada no hay desde cuándo
  assert.deepEqual(profileZones(null, at(1)), []);
  // Lo que va al motor para ordenarlos en la vela elegida: la franja y cómo reconocerla a la vuelta
  assert.deepEqual(offersForEngine(groups)[3], { ref: 'range_1|va', kind: 'vp', lo: 104, hi: 107 });
  assert.equal(offersForEngine(groups).length, 7);

  // Entran como zona fija, cada una con su nombre
  const [poc, vah, val, area] = groups[0].zones;
  let doc = addPick(addPick(blankDoc(), poc), area);
  assert.deepEqual(doc.zone.picks.map(pick => [pick.type, pick.kind, pick.shape, pick.lo, pick.hi, pick.from, 'id' in pick]),
    [['one', 'vp', 'poc', 105.5, 105.5, at(10), false], ['one', 'vp', 'va', 104, 107, at(10), false]]);
  assert.deepEqual(doc.zone.picks.map(pick => pickText(pick, 'short', pickRange(pick))),
    ['Solo esta: POC del VP fijo 105.5', 'Solo esta: área de valor del VP fijo 104 a 107']);
  assert.deepEqual([vah, val].map(zoneName), ['VAH del VP fijo', 'VAL del VP fijo']);
  assert.deepEqual(Object.keys(VP_PARTS), ['poc', 'vah', 'val', 'va']);
  assert.equal(zoneText(doc), 'Zona: el precio queda a 0.5 ATR o menos de este POC del VP fijo (105.5) o esta área de valor del VP fijo (104 a 107).');
  // El mismo nivel más tarde ya está; si el perfil cambió (otro precio), es otra zona
  assert.ok(samePick(doc.zone.picks[0], profileZones(charted, at(50))[0].zones[0]));
  assert.ok(!samePick(doc.zone.picks[0], profileZones([{ ...charted[0], poc: 106 }], at(50))[0].zones[0]));
  assert.equal(addPick(doc, profileZones(charted, at(50))[0].zones[0]), doc);
  // Al motor va como una franja fija más; se guarda y se abre igual
  assert.deepEqual(docForEngine(doc).zone.picks[0], { uid: doc.zone.picks[0].uid, type: 'one', kind: 'vp', lo: 105.5, hi: 105.5, from: at(10), way: 0 });
  assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(doc))).zone.picks, doc.zone.picks);
});

test('la frase dice la zona, con el precio como lo escriba la pantalla', () => {
  let doc = addPick(blankDoc(), pickFromZone(RESISTANCE, 'kind', 'short'));
  doc = addBlock(doc, 'auto', protoOf('zrech'), at(0), H);
  assert.equal(phrase(doc), 'Solo cortos. Zona: el precio queda a 0.5 ATR o menos de resistencias. Gatillo: rechazo en la zona.');
  doc = addPick(setZone(doc, { rel: 'in', when: 'last' }), pickFromZone(RESISTANCE, 'one', 'short'));
  doc = addPick(doc, { type: 'one', kind: 'draw', lo: 105, hi: 105, from: at(1), way: 0 });
  assert.equal(zoneText(doc), 'Zona, en la señal: el precio toca resistencias, esta resistencia (65480 a 65520) o tu línea dibujada (105).');
  // Con fecha oculta la pantalla escribe el índice: la frase no trae precios reales
  assert.match(phrase(doc, () => '#'), /esta resistencia \(# a #\) o tu línea dibujada \(#\)/);
  assert.equal(zoneText(blankDoc()), '');
  // Una sigla no pierde su mayúscula dentro de la frase
  const fvg = addBlock(addPick(blankDoc(), pickFromZone(GAP, 'kind', 'long')), 'auto', protoOf('FV'), at(0), H);
  assert.match(phrase({ ...fvg, side: 'long' }), /menos de FVG abiertos alcistas\. Gatillo: FVG nuevo alcista\.$/);
});

test('en el gráfico: la fila de la zona, la zona fija siempre y las de un tipo solo con su elección abierta', () => {
  const times = Array.from({ length: 10 }, (_, i) => at(i));
  const result = {
    success: true, times, blocks: {}, context: { has: false }, steps: [{ step: 0, alone: [], chained: [5], done: 1, reached: 1 }],
    signals: [{ i: 5, side: -1 }], near: [], lines: {},
    doc: { zone: { picks: [{ uid: 'k', type: 'kind', kind: 'sr', dir: 'favor' }, { uid: 'f', type: 'one', kind: 'draw', lo: 105, hi: 107 }] } },
    zone: {
      has: true, runs: [[4, 6]], count: 3, arrivals: 1,
      picks: {
        k: { count: 2, open: true, bands: [[at(0), at(3), 110, 110, -1], [at(2), at(10), 112, 112.5, -1]] },
        f: { count: 1, open: true, bands: [[at(4), at(10), 105, 107, 0]] }
      }
    }
  };
  const closed = kitchenBands(result, { tf: '1h' });
  assert.deepEqual(closed.filter(band => band.kind === 'ticks').map(band => band.label), ['Zona', 'Paso 1', 'Señal']);
  assert.deepEqual(closed.find(band => band.label === 'Zona').items, [[at(4), 1], [at(5), 1], [at(6), 1]]);
  assert.deepEqual(closed.filter(band => band.kind === 'kzone'), [{ kind: 'kzone', start: at(4), end: at(10), low: 105, high: 107, strong: false, label: 'Zona fija' }]);
  const open = kitchenBands(result, { tf: '1h', focusZone: 'k' }).filter(band => band.kind === 'kzone');
  assert.equal(open.length, 3);
  assert.deepEqual(open[0], { kind: 'kzone', start: at(0), end: at(3), low: 110, high: 110, strong: true, label: '' });
  assert.ok(open.every(band => typeof band.label === 'string'));                 // El gráfico escribe la etiqueta tal cual
  assert.equal(kitchenBands(result, { tf: '1h', focusZone: 'f' }).filter(band => band.kind === 'kzone')[0].strong, true);
});

test('la zona en «¿entra aquí?»', () => {
  let doc = addPick(blankDoc(), pickFromZone(RESISTANCE, 'kind', 'short'));
  const lonely = candleVerdict({ t: at(1), diag: [{ side: -1, context: true, zone: true, signal: false, near: false, steps: [] }] }, doc)[0];
  assert.match(lonely.title, /la zona sola no da entradas/);
  doc = addBlock(doc, 'auto', protoOf('HM'), at(0), H);
  doc = addBlock(doc, 'auto', protoOf('QB'), at(9), H);
  const candle = (diag) => ({ t: at(9), diag: [{ side: -1, context: true, ...diag }] });
  const enters = candleVerdict(candle({ zone: false, signal: true, near: false, steps: [{ done: false, reached: false }, { done: true, reached: true }] }), doc)[0];
  assert.deepEqual(enters.lines.map(line => line.ok), [true, true, true]);
  assert.match(enters.lines[0].text, /La zona se cumplió mientras se juntaba el paso 1/);
  const here = candleVerdict(candle({ zone: true, signal: false, near: false, steps: [{ done: true, reached: true }, { done: false, reached: false }] }), doc)[0];
  assert.equal(here.lines[0].text, 'El precio está cerca de la zona en esta vela');
  const away = candleVerdict(candle({ zone: false, signal: false, near: false, steps: [{ done: true, reached: false }, { done: false, reached: false }] }), setZone(doc, { rel: 'in' }))[0];
  assert.deepEqual([away.lines[0].ok, away.lines[0].text], [false, 'El precio no toca la zona en esta vela']);
});

test('los bloques nuevos: con trades reales y de la capa de zona', () => {
  assert.deepEqual(FLOW_STATES, ['delta', 'cvd']);
  for (const id of FLOW_STATES) assert.ok(blockDef(id).flow && blockDef(id).kind === STATE && blockDef(id).fam === 'of', id);
  const flow = allBlocks().filter(def => def.flow && def.kind === EVENT);
  assert.equal(flow.length, 30);  // sin el ratio de extremos (motor 8)
  assert.ok(!flow.some(def => def.id === 'RX'));
  assert.ok(flow.every(def => def.fam === 'of' && def.shown === 'Elementos OF' && /almacén de trades/.test(def.help)));
  assert.equal(blockText(protoOf('ST'), 'short'), 'Desequilibrios apilados, bajista');
  assert.equal(blockText(protoOf('delta'), 'long'), 'Delta de la vela comprador');
  assert.equal(blockText(protoOf('cvd', { n: 12, dir: 'contra' }), 'long'), 'CVD de 12 velas a la baja');
  assert.ok(blockDef('ztoca').zone && blockDef('zrech').zone && !blockDef('zrech').sided);
  // Un evento de zona va a un paso como cualquier otro, y en el contexto cuenta «si ocurrió hace poco»
  const doc = addBlock(addBlock(blankDoc(), 'auto', protoOf('ztoca'), at(0), H), 'ctx', protoOf('zrech'), null, H);
  assert.equal(doc.gat[0].blocks[0].id, 'ztoca');
  assert.equal(doc.ctx[0].conv, 'recent');
  assert.equal(blockText(doc.ctx[0], 'short'), 'Rechazo en la zona, en las últimas 5 velas');
});

test('un documento guardado antes de las zonas, o con zonas rotas, se abre igual', () => {
  const old = normalizeDoc({ side: 'long', ctx: [{ id: 'vpam' }], gat: [{ blocks: [{ id: 'HM' }] }] });
  assert.deepEqual(old.zone, { picks: [], rel: 'near', atr: 0.5, when: 'first' });
  const doc = normalizeDoc({
    zone: {
      rel: 'in', atr: 0.01, when: 'last',
      picks: [
        { type: 'kind', kind: 'sr', dir: 'favor' }, { type: 'kind', kind: 'nube' }, { type: 'kind', kind: 'liq', dir: 'favor' },
        { type: 'one', kind: 'draw', lo: 9, hi: 7, from: at(1) }, { type: 'one', kind: 'sr', lo: 'x', hi: 7, from: at(1) }, { type: 'one', kind: 'ob', lo: 5, hi: 6 }
      ]
    }
  });
  assert.deepEqual(doc.zone.picks.map(pick => [pick.type, pick.kind, pick.dir ?? pick.way]), [['kind', 'sr', 'favor'], ['kind', 'liq', 'any'], ['one', 'draw', 0]]);
  assert.deepEqual([doc.zone.picks[2].lo, doc.zone.picks[2].hi, doc.zone.rel, doc.zone.atr, doc.zone.when], [7, 9, 'in', 0.1, 'last']);
  // Dos versiones que solo difieren en la zona son distintas
  const base = addBlock(blankDoc(), 'auto', protoOf('HM'), at(0), H);
  const first = withVersion({ list: [] }, { id: null, name: 'a', symbol: 'BTCUSDT', tf: '1h' }, base, 1000);
  const second = withVersion(first.store, { id: first.id, name: 'a', symbol: 'BTCUSDT', tf: '1h' }, addPick(base, pickFromZone(RESISTANCE, 'kind', 'short')), 2000);
  assert.ok(second.saved && second.version === 2);
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
