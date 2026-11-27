// La estrategia en borrador de la cocina (26/11/2026): el documento por capas, dónde va cada bloque que se elige, la
// frase que la resume, las versiones guardadas, las velas que se mandan al motor y lo que se pinta en el gráfico.
// Lógica pura: se prueba con node tests/kitchen.test.mjs. El cálculo de lo que se cumple está en backend/kitchen.py.
import { TF_MS, lastClosedIndex } from '../backtesting/replayClock.js';
import { STATE, ZONE_KINDS, ZONE_TYPES, isAbsDir, blockDef, blockText, lineLabel, pickText, zoneName } from './kitchenCatalog.js';

export const MAX_STEPS = 4;
export const MAX_BLOCKS = 8;
export const MAX_PICKS = 6;                    // Zonas elegidas en la capa de zona
export const ZONE_NEAR = { default: 0.5, min: 0.1, max: 3 };   // «Cerca de la zona», en ATR
export const VIEW_BARS = 1000;                 // Lo recorrido: las velas en que se pinta y se cuenta
// Velas anteriores que calientan los indicadores: como el probador (35 días o 300 velas), con tope en los marcos finos
export const LEAD_BARS = { '1m': 8000, '5m': 8000, '15m': 3360, '1h': 840, '4h': 300 };
export const TF_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
export const SIDE_NAMES = { short: 'Solo cortos', long: 'Solo largos', both: 'Largos y cortos' };
const NEAR_CANDLES = 3;                        // Lo elegido en velas tan cercanas va al mismo paso
const STORE_KEY = 'kitchen_strategies_v1';
const MAX_VERSIONS = 30;

const newStep = (src = null) => ({ mode: 'all', min: 1, win: 5, blocks: [], src });

/** La capa de zona vacía: sin zonas elegidas no pide nada */
export const blankZone = () => ({ picks: [], rel: 'near', atr: ZONE_NEAR.default, when: 'first' });

/** La cocina en blanco */
export const blankDoc = () => ({ side: 'short', ctx: [], ctxWhen: 'first', zone: blankZone(), gat: [newStep()], links: [] });

export const isBlank = (doc) => !doc.ctx.length && !doc.zone?.picks?.length && !doc.gat.some(step => step.blocks.length);
export const allBlocksOf = (doc) => [...doc.ctx, ...doc.gat.flatMap(step => step.blocks)];
export const makeUid = () => `u${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Una zona elegida bien formada, o null. Ver clean_pick en kitchen.py */
function normalizePick(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const uid = raw.uid || makeUid();
  if (raw.type === 'one') {
    if (!ZONE_TYPES[raw.kind] || !finite(raw.lo) || !finite(raw.hi) || !finite(raw.from) || Math.min(raw.lo, raw.hi) <= 0) return null;
    return {
      uid, type: 'one', kind: raw.kind, lo: Math.min(raw.lo, raw.hi), hi: Math.max(raw.lo, raw.hi), from: raw.from,
      way: raw.way === 1 || raw.way === -1 ? raw.way : 0,
      // Qué es dentro de su tipo: un dibujo, rect o line; un nivel de un VP fijo, poc, vah, val o va (su área de valor)
      ...(raw.shape ? { shape: String(raw.shape) } : {}),
      // Un nivel de un indicador: su nombre, como lo dice el gráfico
      ...(raw.kind === 'ind' && raw.label ? { label: String(raw.label).slice(0, 80) } : {}),
      // Un nivel de S&R: el toque más lejano, que es el que un cierre tiene que pasar para terminarlo
      ...(raw.kind === 'sr' && finite(raw.edge) && raw.edge > 0 ? { edge: raw.edge } : {})
    };
  }
  if (!ZONE_KINDS.includes(raw.kind)) return null;
  return { uid, type: 'kind', kind: raw.kind, dir: raw.kind !== 'liq' && ['favor', 'contra'].includes(raw.dir) ? raw.dir : 'any' };
}

function normalizeZone(raw) {
  const base = blankZone();
  if (!raw || typeof raw !== 'object') return base;
  const atr = Number(raw.atr);
  return {
    picks: (Array.isArray(raw.picks) ? raw.picks : []).map(normalizePick).filter(Boolean).slice(0, MAX_PICKS),
    rel: raw.rel === 'in' ? 'in' : 'near',
    atr: Number.isFinite(atr) ? Math.max(ZONE_NEAR.min, Math.min(ZONE_NEAR.max, atr)) : base.atr,
    when: raw.when === 'last' ? 'last' : 'first'
  };
}

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
    ctx: (raw.ctx || []).map(block).filter(Boolean).slice(0, MAX_BLOCKS), ctxWhen: raw.ctxWhen === 'last' ? 'last' : 'first',
    zone: normalizeZone(raw.zone), gat, links
  };
}

/** Lo que se manda al motor: sin la vela de donde salió cada paso, que solo sirve para ubicar lo siguiente */
export function docForEngine(doc) {
  const zone = doc.zone || blankZone();
  return {
    side: doc.side, ctx: doc.ctx, ctxWhen: doc.ctxWhen, links: doc.links,
    zone: {
      rel: zone.rel, atr: zone.atr, when: zone.when,
      picks: zone.picks.map(pick => (pick.type === 'one'
        ? { uid: pick.uid, type: 'one', kind: pick.kind, lo: pick.lo, hi: pick.hi, from: pick.from, way: pick.way, ...(finite(pick.edge) ? { edge: pick.edge } : {}) }
        : { uid: pick.uid, type: 'kind', kind: pick.kind, dir: pick.dir }))
    },
    gat: doc.gat.map(step => ({ mode: step.mode, min: step.min, win: step.win, blocks: step.blocks }))
  };
}

// ==================== La capa de zona ====================

/** Si dos elecciones son la misma zona: el mismo tipo con el mismo sentido, o la misma franja */
export function samePick(a, b) {
  if (!a || !b || a.type !== b.type || a.kind !== b.kind) return false;
  return a.type === 'one' ? a.lo === b.lo && a.hi === b.hi && a.way === b.way : a.dir === b.dir;
}

/**
 * La elección que sale de una zona del gráfico (la que ofrece el motor en la vela elegida: kind, way, lo, hi, from).
 * mode 'kind': todas las de su tipo, con su sentido dicho frente al trade (una regla). mode 'one': solo esa franja.
 */
export function pickFromZone(zone, mode, side, viewSide = 'short') {
  if (mode === 'one') {
    return { type: 'one', kind: zone.kind, lo: zone.lo, hi: zone.hi, from: zone.from, way: zone.way || 0, ...(finite(zone.edge) ? { edge: zone.edge } : {}) };
  }
  return { type: 'kind', kind: zone.kind, dir: zone.kind === 'liq' || !zone.way ? 'any' : relativeDir(zone.way, side, viewSide) };
}

/**
 * Los dibujos del gráfico que pueden ser una zona: rectángulos (su franja de precio) y líneas horizontales (un precio).
 * Un dibujo se traza sabiendo lo que pasó, así que cuenta desde `now`, la hora simulada en que se suma a la estrategia,
 * y nunca hacia atrás. Tampoco antes de la hora en que se dibujó (`createdAt`), si la simulación retrocedió después.
 */
export function drawnZones(shapes, now) {
  const out = [];
  for (const shape of shapes || []) {
    const drawnAt = finite(shape?.createdAt) ? shape.createdAt : null;
    const since = finite(now) ? Math.max(now, drawnAt ?? now) : drawnAt;
    if (!finite(since)) continue;
    if (shape.type === 'rectangle' && finite(shape.price1) && finite(shape.price2)) {
      const [lo, hi] = [Math.min(shape.price1, shape.price2), Math.max(shape.price1, shape.price2)];
      if (lo > 0) out.push({ id: shape.id, type: 'one', kind: 'draw', shape: 'rect', lo, hi, from: since, way: 0 });
    } else if (shape.type === 'horizontal' && finite(shape.price) && shape.price > 0) {
      out.push({ id: shape.id, type: 'one', kind: 'draw', shape: 'line', lo: shape.price, hi: shape.price, from: since, way: 0 });
    }
  }
  return out;
}

/**
 * Lo que ofrece como zona cada perfil de volumen de rango fijo del gráfico (VP Fixed Range): su POC, su VAH y su VAL
 * (un precio cada uno) y su área de valor (del VAL al VAH).
 * `profiles`: lo que el indicador tiene calculado a la hora simulada, solo con lo ya ocurrido
 * ({ id, label, start, end, poc, vah, val, real }). Como con un dibujo, el rango lo eligió el usuario viendo lo que ya
 * pasó: cada nivel cuenta desde `now`, la hora simulada en que se suma, con el precio que tiene en ese momento.
 */
export function profileZones(profiles, now) {
  if (!finite(now)) return [];
  const out = [];
  for (const profile of profiles || []) {
    const { poc, vah, val } = profile || {};
    if (![poc, vah, val].every(value => finite(value) && value > 0)) continue;
    const [low, high] = [Math.min(val, vah), Math.max(val, vah)];
    const zone = (shape, lo, hi) => ({ id: `${profile.id}|${shape}`, type: 'one', kind: 'vp', shape, lo, hi, from: now, way: 0 });
    out.push({
      id: profile.id, label: profile.label || '', start: profile.start, end: profile.end, real: !!profile.real,
      zones: [zone('poc', poc, poc), zone('vah', high, high), zone('val', low, low), ...(high > low ? [zone('va', low, high)] : [])]
    });
  }
  return out;
}

// Lo que el gráfico dibuja como línea que cambia con cada vela: no es una franja fija sino una línea de la estrategia
const ALLIGATOR_LINES = [['labios', 'lips'], ['dientes', 'teeth'], ['mandíbula', 'jaw']];

/**
 * La línea de la cocina que corresponde a un elegible del gráfico, o null si no es una línea: una EMA ("e50"), el VWAP
 * o una de sus bandas ("p:vwap", "p:vwap_u1") o una del Alligator. Con ella se arman condiciones que no dependen de
 * la vela del clic: el precio la cruza, rebota en ella, cierra de un lado o está lejos.
 */
export function lineOfLevel(level) {
  if (!level) return null;
  if (typeof level.line === 'string') return level.line;
  const kind = String(level.kind || '');
  if (level.source === 'VWAP') {
    if (kind === 'VWAP') return 'p:vwap';
    const band = /^Banda (superior|inferior) ([123])$/.exec(kind);
    return band ? `p:vwap_${band[1] === 'superior' ? 'u' : 'l'}${band[2]}` : null;
  }
  if (level.source === 'Alligator') {
    const found = ALLIGATOR_LINES.find(([word]) => kind.toLowerCase().includes(word));
    return found ? found[1] : null;
  }
  return null;
}

/**
 * Los niveles del gráfico que quedaron bajo el clic, como zonas fijas: cada uno es lo que dibuja su indicador con los
 * ajustes de la sesión (una zona de liquidaciones, un POC, un borde de un FVG, un soporte). Como un dibujo, cuenta desde
 * `now`, la hora simulada en que se suma, con el precio de ese momento. Las marcas, las lecturas de un panel y las
 * líneas que cambian con cada vela no son zonas.
 */
export function levelZones(levels, now) {
  if (!finite(now)) return [];
  const out = [];
  const seen = new Set();
  for (const level of levels || []) {
    if (!level || level.mark || level.panel || level.volumeBar || lineOfLevel(level)) continue;
    const [low, high] = finite(level.low) && finite(level.high) ? [Math.min(level.low, level.high), Math.max(level.low, level.high)] : [level.price, level.price];
    if (!finite(low) || !finite(high) || low <= 0) continue;
    const label = [level.kind, level.source].filter(Boolean).join(' · ').slice(0, 80);
    const id = `ind|${level.id ?? label}|${low}|${high}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, type: 'one', kind: 'ind', label, lo: low, hi: high, from: now, way: 0 });
  }
  return out;
}

/** Las líneas del gráfico bajo el clic, sin repetir */
export const levelLines = (levels) => [...new Set((levels || []).map(lineOfLevel).filter(Boolean))];

/** Esas zonas como las pide el motor para ordenarlas en la vela elegida, junto a las suyas (kitchen.py, clean_offers) */
export const offersForEngine = (groups) => (groups || []).flatMap(group => group.zones.map(zone => ({ ref: zone.id, kind: zone.kind, lo: zone.lo, hi: zone.hi })));

/** La estrategia con una zona más. No repite una igual, y la capa admite hasta MAX_PICKS */
export function addPick(doc, pick) {
  const zone = doc.zone || blankZone();
  const item = normalizePick({ ...pick, uid: makeUid() });
  if (!item || zone.picks.length >= MAX_PICKS || zone.picks.some(other => samePick(other, item))) return doc;
  return { ...doc, zone: { ...zone, picks: [...zone.picks, item] } };
}

export const removePick = (doc, uid) => ({ ...doc, zone: { ...(doc.zone || blankZone()), picks: (doc.zone?.picks || []).filter(pick => pick.uid !== uid) } });
export const setZone = (doc, patch) => ({ ...doc, zone: normalizeZone({ ...(doc.zone || blankZone()), ...patch }) });

/** Al espejar la estrategia, «todas las de este tipo» pasan a su contrario; una zona fija es la que es */
const flipPick = (pick) => (pick.type === 'kind' && pick.dir !== 'any' ? { ...pick, dir: pick.dir === 'contra' ? 'favor' : 'contra' } : pick);

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
  const flip = (block) => (blockDef(block.id)?.sided && !isAbsDir(block.p.dir) ? { ...block, p: { ...block.p, dir: block.p.dir === 'contra' ? 'favor' : 'contra' } } : block);
  const zone = doc.zone || blankZone();
  return {
    ...doc, ctx: doc.ctx.map(flip), zone: { ...zone, picks: zone.picks.map(flipPick) },
    gat: doc.gat.map(step => ({ ...step, blocks: step.blocks.map(flip) }))
  };
}

/** Al cambiar de lado, cada bloque sigue diciendo lo mismo en el gráfico (lo que era alcista sigue alcista) */
export function withSide(doc, side) {
  if (side === doc.side) return doc;
  const turns = side !== 'both' && doc.side !== 'both' && side !== doc.side;
  return { ...(turns ? mirrored(doc) : doc), side };
}

// Una sigla (EMA, FVG, CVD) se queda como está
const lower = (text) => (/^[A-ZÁÉÍÓÚÑ]{2}/.test(text) ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);
const listAnd = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);
const listOr = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} o ${items[items.length - 1]}`);
const candles = (n) => `${n} ${Number(n) === 1 ? 'vela' : 'velas'}`;
const plain = (value) => String(Math.round(value * 1e8) / 1e8);

/** El precio de una zona fija, escrito: un número o un rango. `price` escribe cada precio (con fecha oculta, el índice) */
export const pickRange = (pick, price = plain) => (pick.lo === pick.hi ? price(pick.lo) : `${price(pick.lo)} a ${price(pick.hi)}`);

/** La capa de zona en palabras, o '' si no hay zonas elegidas */
export function zoneText(doc, price = plain) {
  const zone = doc.zone;
  if (!zone?.picks?.length) return '';
  const names = zone.picks.map(pick => {
    if (pick.type !== 'one') return lower(pickText(pick, doc.side));
    const name = pick.kind === 'draw' ? `tu ${pick.lo === pick.hi ? 'línea dibujada' : 'zona dibujada'}` : `${/a$/.test(zoneName(pick).split(' ')[0]) ? 'esta' : 'este'} ${lower(zoneName(pick))}`;
    return `${name} (${pickRange(pick, price)})`;
  });
  const ask = zone.rel === 'in' ? 'el precio toca ' : `el precio queda a ${plain(zone.atr)} ATR o menos de `;
  return `Zona${zone.when === 'last' ? ', en la señal' : ''}: ${ask}${listOr(names)}.`;
}

/** Un paso en palabras */
export function stepText(step, side) {
  const texts = step.blocks.map(block => lower(blockText(block, side)));
  if (!texts.length) return '';
  if (texts.length === 1) return texts[0];
  if (step.mode === 'any') return listOr(texts);
  return `${step.mode === 'min' ? `se juntan al menos ${Math.min(step.min, texts.length)} de: ` : 'se juntan '}${listAnd(texts)}, en ${candles(step.win)}`;
}

export const linkText = (link) => `${link.type === 'any' ? 'en cualquier orden' : link.type === 'same' ? 'al tiempo o después' : 'después'}, hasta ${candles(link.max)}`;

/** La estrategia en una frase. `price` escribe los precios de las zonas fijas (con fecha oculta, el índice) */
export function phrase(doc, price = plain) {
  const parts = [];
  const context = doc.ctx.map(block => lower(blockText(block, doc.side)));
  if (context.length) parts.push(`Contexto${doc.ctxWhen === 'last' ? ', en la señal: ' : ': '}${listAnd(context)}.`);
  const zone = zoneText(doc, price);
  if (zone) parts.push(zone);
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

export const TONES = { context: '41, 98, 255', zone: '0, 121, 107', step: '245, 124, 0', signal: '33, 37, 41', block: '123, 31, 162' };

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
 * Las zonas: una zona fija («solo esta») se dibuja siempre, porque es de la estrategia y no de un indicador; las de
 * «todas las de este tipo», solo mientras su elección está abierta (`focusZone`), para no llenar el gráfico.
 */
export function kitchenBands(result, { tf, pick = null, focus = null, focusText = '', focusZone = null, behind = 0 } = {}) {
  const tfMs = TF_MS[tf];
  if (!result?.success || !tfMs) return [];
  const { times } = result;
  const bands = [];
  const rows = [];
  for (const chosen of result.doc?.zone?.picks || []) {
    const info = result.zone?.picks?.[chosen.uid];
    const open = focusZone === chosen.uid;
    if (!info || (!open && chosen.type !== 'one')) continue;
    for (const [start, end, low, high] of info.bands) {
      bands.push({ kind: 'kzone', start, end, low, high, strong: open, label: chosen.type === 'one' ? 'Zona fija' : '' });
    }
  }
  if (focus && result.blocks?.[focus]) rows.push({ label: focusText || 'Bloque elegido', tone: TONES.block, items: expand(result.blocks[focus].runs, times) });
  if (result.context?.has) rows.push({ label: 'Contexto', tone: TONES.context, items: expand(result.context.runs, times) });
  if (result.zone?.has) rows.push({ label: 'Zona', tone: TONES.zone, items: expand(result.zone.runs, times) });
  (result.steps || []).forEach((step, k) => {
    rows.push({ label: `Paso ${k + 1}`, tone: TONES.step,
      items: [...step.alone.map(i => [times[i], 2]), ...step.chained.map(i => [times[i], 1])].filter(item => item[0] !== undefined) });
  });
  if (result.steps?.length) {
    rows.push({ label: 'Señal', tone: TONES.signal,
      items: [...expand(result.near, times, 2), ...result.signals.map(s => [times[s.i], 1])].filter(item => item[0] !== undefined) });
  }
  // Reproduciendo, el cálculo puede ir unas velas atrás: la última fila lo dice, para no leer un hueco como «no se cumple»
  if (behind > 0 && rows.length) rows[rows.length - 1] = { ...rows[rows.length - 1], label: `${rows[rows.length - 1].label} · faltan ${behind}` };
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
    if (doc.zone?.picks?.length) {
      // La zona, como el contexto, se mira en las velas en que se junta el paso 1 o el último
      const last = doc.zone.when === 'last';
      const held = last ? diag.signal : top >= 0 || passed >= 0;
      const what = doc.zone.rel === 'in' ? 'toca la zona' : 'está cerca de la zona';
      if (diag.zone) lines.push({ ok: true, text: `El precio ${what} en esta vela` });
      else if (held) lines.push({ ok: true, text: `La zona se cumplió mientras se juntaba el ${last ? 'último paso' : 'paso 1'}` });
      else lines.push({ ok: false, text: `El precio no ${what} en esta vela` });
    }
    diag.steps.forEach((step, k) => {
      const name = `Paso ${k + 1}`;
      if (step.reached) lines.push({ ok: true, text: `${name}: se cumple aquí${k ? ', encadenado con el anterior' : ''}` });
      else if (k <= passed) lines.push({ ok: true, text: `${name}: se cumplió antes, dentro de su plazo` });
      else if (step.done) lines.push({ ok: false, text: `${name}: se cumple aquí, pero suelto: falta lo anterior` });
      else lines.push({ ok: false, text: `${name}: no se cumple en esta vela` });
    });
    const alone = doc.ctx.length && doc.zone?.picks?.length ? 'el contexto y la zona solos no dan' : doc.zone?.picks?.length ? 'la zona sola no da' : 'el contexto solo no da';
    const title = !diag.steps.length ? `Todavía no hay gatillo: ${alone} entradas (${side})`
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
