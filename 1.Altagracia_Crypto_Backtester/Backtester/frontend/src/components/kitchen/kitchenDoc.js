// La estrategia en borrador de la cocina (26/11/2026): el documento por capas, dónde va cada bloque que se elige, la
// frase que la resume, las versiones guardadas, las velas que se mandan al motor y lo que se pinta en el gráfico.
// Lógica pura: se prueba con node tests/kitchen.test.mjs. El cálculo de lo que se cumple está en backend/kitchen.py.
import { TF_MS, lastClosedIndex } from '../backtesting/replayClock.js';
import { STATE, blockDef, blockText, lineLabel } from './kitchenCatalog.js';

export const MAX_STEPS = 4;
export const MAX_BLOCKS = 8;
export const VIEW_BARS = 1000;                 // Lo recorrido: las velas en que se pinta y se cuenta
// Velas anteriores que calientan los indicadores: como el probador (35 días o 300 velas), con tope en los marcos finos
export const LEAD_BARS = { '1m': 8000, '5m': 8000, '15m': 3360, '1h': 840, '4h': 300 };
export const TF_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
export const SIDE_NAMES = { short: 'Solo cortos', long: 'Solo largos', both: 'Largos y cortos' };
const NEAR_CANDLES = 3;                        // Lo elegido en velas tan cercanas va al mismo paso
const STORE_KEY = 'kitchen_strategies_v1';
const MAX_VERSIONS = 30;

const newStep = (src = null) => ({ mode: 'all', min: 1, win: 5, blocks: [], src });

/** La cocina en blanco */
export const blankDoc = () => ({ side: 'short', ctx: [], ctxWhen: 'first', gat: [newStep()], links: [] });

export const isBlank = (doc) => !doc.ctx.length && !doc.gat.some(step => step.blocks.length);
export const allBlocksOf = (doc) => [...doc.ctx, ...doc.gat.flatMap(step => step.blocks)];
export const makeUid = () => `u${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/** Un documento guardado o a medio escribir, con todo lo que la pantalla espera */
export function normalizeDoc(raw) {
  const base = blankDoc();
  if (!raw || typeof raw !== 'object') return base;
  const block = (b) => (b && blockDef(b.id) ? { uid: b.uid || makeUid(), id: b.id, p: { ...blockDef(b.id).p, ...(b.p || {}) }, conv: b.conv || null, cn: Number(b.cn) || 5 } : null);
  const gat = (Array.isArray(raw.gat) ? raw.gat : []).slice(0, MAX_STEPS).map(step => ({
    mode: ['all', 'min', 'any'].includes(step?.mode) ? step.mode : 'all', min: Math.max(1, Number(step?.min) || 1),
    win: Math.max(1, Math.min(20, Number(step?.win) || 5)), src: Number.isFinite(step?.src) ? step.src : null,
    blocks: (step?.blocks || []).map(block).filter(Boolean).slice(0, MAX_BLOCKS)
  }));
  if (!gat.length) gat.push(newStep());
  const links = [];
  for (let i = 0; i < gat.length - 1; i += 1) {
    const link = raw.links?.[i] || {};
    links.push({ type: ['after', 'same', 'any'].includes(link.type) ? link.type : 'after', max: Math.max(1, Math.min(60, Number(link.max) || 5)) });
  }
  return {
    side: ['long', 'short', 'both'].includes(raw.side) ? raw.side : 'short',
    ctx: (raw.ctx || []).map(block).filter(Boolean).slice(0, MAX_BLOCKS), ctxWhen: raw.ctxWhen === 'last' ? 'last' : 'first', gat, links
  };
}

/** Lo que se manda al motor: sin la vela de donde salió cada paso, que solo sirve para ubicar lo siguiente */
export function docForEngine(doc) {
  return {
    side: doc.side, ctx: doc.ctx, ctxWhen: doc.ctxWhen, links: doc.links,
    gat: doc.gat.map(step => ({ mode: step.mode, min: step.min, win: step.win, blocks: step.blocks }))
  };
}

/** El lado que se ve en el gráfico (1 alcista, −1 bajista) dicho frente al trade: a favor o en contra.
 * Con largos y cortos en espejo, frente al lado que se está mirando (`viewSide`). */
export function relativeDir(seen, side, viewSide = 'short') {
  const trade = (side === 'both' ? viewSide : side) === 'long' ? 1 : -1;
  return seen === trade ? 'favor' : 'contra';
}

/** El enlace entre dos pasos según las velas de donde salieron: «después», con un plazo que cubre esa distancia */
export function linkFor(a, b, tfMs) {
  const known = Number.isFinite(a) && Number.isFinite(b) && tfMs > 0;
  return { type: 'after', max: known ? Math.max(3, Math.round(Math.abs(b - a) / tfMs) + 3) : 5 };
}

/**
 * Dónde va un bloque elegido en la vela `at` (su hora). Lo de una misma vela, o de velas pegadas, va al mismo paso; lo
 * de una vela posterior, a un paso después. Un estado de la primera vela es contexto; uno de una vela posterior va con
 * el paso de esa vela. `alt` da el otro lugar posible.
 */
export function placeFor(doc, def, at, tfMs, alt = false) {
  const gat = doc.gat;
  let near = -1;
  let firstSrc = null;
  let used = 0;
  gat.forEach((step, i) => {
    if (!step.blocks.length) return;
    used += 1;
    if (!Number.isFinite(step.src)) return;
    if (firstSrc === null || step.src < firstSrc) firstSrc = step.src;
    if (near < 0 && Number.isFinite(at) && Math.abs(step.src - at) <= NEAR_CANDLES * tfMs) near = i;
  });
  const last = gat.length - 1;
  let step;
  if (near >= 0) step = { kind: 'step', index: near, isNew: false };
  else if (!used) step = { kind: 'step', index: 0, isNew: false };
  else if (firstSrc === null || !Number.isFinite(at)) step = { kind: 'step', index: last, isNew: false };
  else {
    let pos = gat.length;
    for (let i = 0; i < gat.length; i += 1) {
      if (gat[i].blocks.length && Number.isFinite(gat[i].src) && gat[i].src > at) { pos = i; break; }
    }
    if (pos === gat.length && !gat[last].blocks.length) step = { kind: 'step', index: last, isNew: false };
    else step = gat.length >= MAX_STEPS ? { kind: 'step', index: Math.min(pos, MAX_STEPS - 1), isNew: false } : { kind: 'step', index: pos, isNew: true };
  }
  const context = { kind: 'ctx' };
  const early = firstSrc === null || !Number.isFinite(at) || at <= firstSrc + NEAR_CANDLES * tfMs;
  const natural = def.kind === STATE && early ? context : step;
  if (!alt) return natural;
  return natural.kind === 'ctx' ? step : context;
}

/**
 * La estrategia con un bloque más. target: 'ctx', 'auto' (donde le toca por su vela), 'alt' (el otro lugar), 'newstep'
 * o { step: n }. `at`: la hora de la vela de donde se eligió, si salió del gráfico.
 */
export function addBlock(doc, target, proto, at, tfMs) {
  const def = blockDef(proto?.id);
  if (!def) return doc;
  const item = { uid: makeUid(), id: proto.id, p: { ...def.p, ...(proto.p || {}) }, conv: null, cn: 5 };
  const src = Number.isFinite(at) ? at : null;
  const lastIndex = Math.max(0, doc.gat.length - 1);
  let place;
  if (target === 'ctx') place = { kind: 'ctx' };
  else if (target === 'auto' || target === 'alt') place = placeFor(doc, def, at, tfMs, target === 'alt');
  else if (target && typeof target === 'object') place = { kind: 'step', index: Math.max(0, Math.min(lastIndex, target.step)), isNew: false };
  else {
    const room = target === 'newstep' && doc.gat.length < MAX_STEPS && doc.gat[lastIndex]?.blocks.length;
    place = room ? { kind: 'step', index: doc.gat.length, isNew: true } : { kind: 'step', index: lastIndex, isNew: false };
  }
  if (place.kind === 'ctx') {
    if (doc.ctx.length >= MAX_BLOCKS) return doc;
    if (def.kind !== STATE) item.conv = 'recent';   // Un evento en el contexto: «ocurrió en las últimas N velas»
    return { ...doc, ctx: [...doc.ctx, item] };
  }
  if (def.kind === STATE) item.conv = 'during';      // Un estado en un paso: «se cumple en esas velas»
  const gat = doc.gat.map(step => ({ ...step, blocks: [...step.blocks] }));
  const links = doc.links.map(link => ({ ...link }));
  while (links.length < gat.length - 1) links.push({ type: 'after', max: 5 });
  if (place.isNew && gat.length) {
    const pos = Math.min(place.index, gat.length);
    if (pos >= gat.length) links.push(linkFor(gat[gat.length - 1].src, src, tfMs));
    else if (pos === 0) links.unshift(linkFor(src, gat[0].src, tfMs));
    else {
      links[pos - 1] = linkFor(gat[pos - 1].src, src, tfMs);
      links.splice(pos, 0, linkFor(src, gat[pos].src, tfMs));
    }
    gat.splice(pos, 0, { ...newStep(src), blocks: [item] });
  } else {
    if (!gat.length) gat.push(newStep());
    const index = Math.min(place.index, gat.length - 1);
    const step = gat[index];
    if (step.blocks.length >= MAX_BLOCKS) return doc;
    const wasEmpty = !step.blocks.length;
    step.blocks.push(item);
    if (!Number.isFinite(step.src) && src !== null) step.src = src;
    // Un paso vacío que se llena desde una vela: su enlace con el anterior toma la distancia entre las dos velas
    if (wasEmpty && index > 0 && src !== null && Number.isFinite(gat[index - 1].src)) links[index - 1] = linkFor(gat[index - 1].src, src, tfMs);
  }
  return { ...doc, gat, links };
}

/** Cambia un bloque (fn lo devuelve cambiado) o lo quita (fn devuelve null) */
export function editBlock(doc, uid, fn) {
  const apply = (list) => list.flatMap(block => {
    if (block.uid !== uid) return [block];
    const next = fn(block);
    return next ? [next] : [];
  });
  return { ...doc, ctx: apply(doc.ctx), gat: doc.gat.map(step => ({ ...step, blocks: apply(step.blocks) })) };
}

export const removeBlock = (doc, uid) => editBlock(doc, uid, () => null);
export const setParam = (doc, uid, key, value) => editBlock(doc, uid, block => ({ ...block, p: { ...block.p, [key]: value } }));
export const setStep = (doc, index, patch) => ({ ...doc, gat: doc.gat.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
export const setLink = (doc, index, patch) => ({ ...doc, links: doc.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) });

/** Un paso vacío al final, si cabe y el último ya tiene algo */
export function addStep(doc) {
  if (doc.gat.length >= MAX_STEPS || !doc.gat[doc.gat.length - 1].blocks.length) return doc;
  return { ...doc, gat: [...doc.gat, newStep()], links: [...doc.links, { type: 'after', max: 5 }] };
}

/** Quita un paso con lo que tenga. Siempre queda al menos uno */
export function removeStep(doc, index) {
  if (doc.gat.length <= 1) return { ...doc, gat: [newStep()], links: [] };
  const gat = doc.gat.filter((_, i) => i !== index);
  const links = doc.links.filter((_, i) => i !== (index === 0 ? 0 : index - 1));
  return { ...doc, gat, links: links.slice(0, gat.length - 1) };
}

/** Los mismos bloques, cada uno con su sentido al revés: para pasar una estrategia de cortos a largos */
export function mirrored(doc) {
  const flip = (block) => (blockDef(block.id)?.sided ? { ...block, p: { ...block.p, dir: block.p.dir === 'contra' ? 'favor' : 'contra' } } : block);
  return { ...doc, ctx: doc.ctx.map(flip), gat: doc.gat.map(step => ({ ...step, blocks: step.blocks.map(flip) })) };
}

/** Al cambiar de lado, cada bloque sigue diciendo lo mismo en el gráfico (lo que era alcista sigue alcista) */
export function withSide(doc, side) {
  if (side === doc.side) return doc;
  const turns = side !== 'both' && doc.side !== 'both' && side !== doc.side;
  return { ...(turns ? mirrored(doc) : doc), side };
}

const lower = (text) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const listAnd = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
const listOr = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} o ${items[items.length - 1]}`);
const candles = (n) => `${n} ${Number(n) === 1 ? 'vela' : 'velas'}`;

/** Un paso en palabras */
export function stepText(step, side) {
  const texts = step.blocks.map(block => lower(blockText(block, side)));
  if (!texts.length) return '';
  if (texts.length === 1) return texts[0];
  if (step.mode === 'any') return listOr(texts);
  return `${step.mode === 'min' ? `se juntan al menos ${Math.min(step.min, texts.length)} de: ` : 'se juntan '}${listAnd(texts)}, en ${candles(step.win)}`;
}

export const linkText = (link) => `${link.type === 'any' ? 'en cualquier orden' : link.type === 'same' ? 'al tiempo o después' : 'después'}, hasta ${candles(link.max)}`;

/** La estrategia en una frase */
export function phrase(doc) {
  const parts = [];
  const context = doc.ctx.map(block => lower(blockText(block, doc.side)));
  if (context.length) parts.push(`Contexto${doc.ctxWhen === 'last' ? ', en la señal: ' : ': '}${listAnd(context)}.`);
  const steps = [];
  doc.gat.forEach((step, i) => {
    const text = stepText(step, doc.side);
    if (!text) return;
    steps.push(steps.length ? `${linkText(doc.links[i - 1] || { type: 'after', max: 5 })}, ${text}` : text);
  });
  if (steps.length) parts.push(`Gatillo: ${steps.join('; ')}.`);
  if (!parts.length) return 'Todavía está en blanco. Reproduce, pausa donde veas algo y elige en el gráfico lo que quieras usar.';
  return `${SIDE_NAMES[doc.side]}${doc.side === 'both' ? ', en espejo' : ''}. ${parts.join(' ')}`;
}

// ==================== Velas para el motor ====================

/**
 * Las velas ya cerradas en la hora simulada que se mandan al motor: las de lo recorrido y las anteriores que calientan
 * los indicadores. Nunca la vela en formación ni nada posterior. null si todavía no cerró ninguna.
 */
export function closedWindow(main, tf, now, view = VIEW_BARS) {
  if (!Array.isArray(main) || !main.length || !Number.isFinite(now) || !TF_MS[tf]) return null;
  const last = lastClosedIndex(main, tf, now);
  if (last < 0) return null;
  const first = Math.max(0, last + 1 - view - (LEAD_BARS[tf] || 300));
  const rows = [];
  for (let i = first; i <= last; i += 1) {
    const c = main[i];
    rows.push([c.timestamp, c.open, c.high, c.low, c.close, c.volume]);
  }
  return { rows, view: Math.min(view, rows.length), lastTime: main[last].timestamp, firstTime: main[first].timestamp };
}

// ==================== Lo que se pinta en el gráfico ====================

export const TONES = { context: '41, 98, 255', step: '245, 124, 0', signal: '33, 37, 41', block: '123, 31, 162' };

const expand = (runs, times, state = 1) => {
  const items = [];
  for (const [a, b] of runs || []) {
    for (let i = a; i <= b; i += 1) if (times[i] !== undefined) items.push([times[i], state]);
  }
  return items;
};

/**
 * Las franjas para MiniChart (getTradeBands): una fila por capa bajo las velas, pintada donde se cumple; un triángulo
 * en cada señal; las líneas que miran los bloques; la vela elegida, y el bloque elegido en su propia fila.
 * En cada paso, el tono fuerte es el paso encadenado con lo anterior y el claro, el paso solo.
 */
export function kitchenBands(result, { tf, pick = null, focus = null, focusText = '' } = {}) {
  const tfMs = TF_MS[tf];
  if (!result?.success || !tfMs) return [];
  const { times } = result;
  const bands = [];
  const rows = [];
  if (focus && result.blocks?.[focus]) rows.push({ label: focusText || 'Bloque elegido', tone: TONES.block, items: expand(result.blocks[focus].runs, times) });
  if (result.context?.has) rows.push({ label: 'Contexto', tone: TONES.context, items: expand(result.context.runs, times) });
  (result.steps || []).forEach((step, k) => {
    rows.push({ label: `Paso ${k + 1}`, tone: TONES.step,
      items: [...step.alone.map(i => [times[i], 2]), ...step.chained.map(i => [times[i], 1])].filter(item => item[0] !== undefined) });
  });
  if (result.steps?.length) {
    rows.push({ label: 'Señal', tone: TONES.signal,
      items: [...expand(result.near, times, 2), ...result.signals.map(s => [times[s.i], 1])].filter(item => item[0] !== undefined) });
  }
  rows.forEach((row, index) => bands.push({ kind: 'ticks', tf: tfMs, rows: rows.length, row: index, label: row.label, tone: row.tone, items: row.items }));
  for (const signal of result.signals || []) {
    if (times[signal.i] !== undefined) bands.push({ kind: 'signal', tf: tfMs, time: times[signal.i], rows: rows.length, dir: signal.side, taken: true, label: '' });
  }
  for (const [name, values] of Object.entries(result.lines || {})) {
    const points = [];
    values.forEach((value, i) => { if (value !== null && times[i] !== undefined) points.push([times[i], value]); });
    if (points.length) bands.push({ kind: 'line', tf: tfMs, tone: name.startsWith('e') ? 'ema' : 'channel', points, label: lineLabel(name) });
  }
  if (Number.isFinite(pick)) bands.push({ kind: 'column', tf: tfMs, time: pick, rows: rows.length });
  return bands;
}

/** Lo que la estrategia hace en la vela elegida, en palabras: si entra, si está a punto y qué le falta */
export function candleVerdict(candle, doc) {
  if (!candle || isBlank(doc)) return [];
  return (candle.diag || []).map(diag => {
    const side = diag.side > 0 ? 'largo' : 'corto';
    const lines = [];
    // El paso más avanzado que se cumple aquí encadenado: los anteriores ya se cumplieron, en esta vela o antes.
    // «A punto»: se cumplieron todos menos el último
    const top = diag.steps.reduce((best, step, k) => (step.reached ? k : best), -1);
    const passed = Math.max(top - 1, diag.near ? diag.steps.length - 2 : -1);
    if (doc.ctx.length) {
      // El contexto se mira en las velas en que se junta un paso (el primero o el último), no solo en esta
      const last = doc.ctxWhen === 'last';
      const held = last ? diag.signal : top >= 0 || passed >= 0;
      if (diag.context) lines.push({ ok: true, text: 'El contexto se cumple en esta vela' });
      else if (held) lines.push({ ok: true, text: `El contexto se cumplió mientras se juntaba el ${last ? 'último paso' : 'paso 1'}` });
      else lines.push({ ok: false, text: 'El contexto no se cumple en esta vela' });
    }
    diag.steps.forEach((step, k) => {
      const name = `Paso ${k + 1}`;
      if (step.reached) lines.push({ ok: true, text: `${name}: se cumple aquí${k ? ', encadenado con el anterior' : ''}` });
      else if (k <= passed) lines.push({ ok: true, text: `${name}: se cumplió antes, dentro de su plazo` });
      else if (step.done) lines.push({ ok: false, text: `${name}: se cumple aquí, pero suelto: falta lo anterior` });
      else lines.push({ ok: false, text: `${name}: no se cumple en esta vela` });
    });
    const title = !diag.steps.length ? `Todavía no hay gatillo: el contexto solo no da entradas (${side})`
      : diag.signal ? `Aquí entra (${side}): da señal en esta vela`
        : diag.near ? `Aquí no entra (${side}), pero está a punto: falta el último paso`
          : `Aquí no entra (${side})`;
    return { side: diag.side, signal: diag.signal, near: diag.near, title, lines };
  });
}

// ==================== Versiones guardadas ====================

export function loadStore(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(STORE_KEY) || 'null');
    return raw && Array.isArray(raw.list) ? raw : { list: [] };
  } catch {
    return { list: [] };
  }
}

export function saveStore(store, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

const core = (doc) => JSON.stringify(docForEngine(normalizeDoc(doc)));

/** El almacén con una versión nueva de esa estrategia, con la fecha real en que se guardó. No repite una igual a la vigente */
export function withVersion(store, { id, name, symbol, tf }, doc, now = Date.now()) {
  const list = store.list || [];
  const found = list.find(item => item.id === id);
  const versions = found?.versions || [];
  const last = versions[versions.length - 1];
  const title = String(name || '').trim().slice(0, 60) || 'Estrategia sin nombre';
  if (last && core(last.doc) === core(doc) && found.name === title) return { store, id, version: last.v, saved: false };
  const entry = { v: (last?.v ?? 0) + 1, at: now, doc: normalizeDoc(doc) };
  const next = { id: found?.id || `k${now.toString(36)}`, name: title, symbol, tf, versions: [...versions, entry].slice(-MAX_VERSIONS) };
  return { store: { list: found ? list.map(item => (item.id === id ? next : item)) : [...list, next] }, id: next.id, version: entry.v, saved: true };
}

export const withoutStrategy = (store, id) => ({ list: (store.list || []).filter(item => item.id !== id) });

/** El borrador en curso de una moneda: sigue ahí al cambiar de pestaña o recargar */
export const draftKey = (symbol) => `kitchen_draft_v1_${symbol}`;
