// Protocolo (22/11/2026), etapa 6: el barrido de liquidaciones (LIQ, nivel C) contra la regla del navegador que repite.
//
// Desde la documentación (CLAUDE.md de App 1, "Barrido de liquidaciones, LIQ (17/11, liq_sweeps.py)"), sin usar
// liq_sweeps.py:
// - zonas: las de liquidationZones.js (buildZones y pickZones con sus reglas de fábrica: 30 días, franjas de 0.1%, 3 por
//   lado a 6% o menos) con las celdas conocidas antes de abrir la vela del barrido y el precio de esa apertura, de una
//   sola fuente: la que da activeSource en esa hora. El ancho de franja, binWidthFor(apertura, 0.1, ancho de celda de la
//   fuente), como el indicador cuando fija el ancho con ese precio;
// - swing (what = "swing"): el único extremo de swingBars velas por lado; barrido: la primera vela posterior que lo pasa;
//   cada swing se barre una vez y deja de seguirse a los 30 días; el swing cae en una zona mostrada, con 0.1% de margen;
//   barrer un mínimo es alcista y un máximo, bajista;
// - zona (what = "zone"): el precio estuvo entero de un lado de una zona mostrada (la vela no la toca), que queda
//   armada, y después una vela pasa su borde contrario; bajar a través de la zona es alcista; cada zona se barre una vez
//   hasta que el precio vuelve a salir;
// - pierce: se conoce al cerrar la vela del barrido;
// - la zona del evento va del extremo del barrido al swing (o al borde pasado de la zona); cada trade guarda en `liq`
//   las zonas mostradas en la vela del barrido, con la barrida marcada, el dinero y el lado de la zona, los días desde su
//   última liquidación y la profundidad en ATR.
// Los datos: los archivos de OrderFlowData/liquidations que lee el motor, leídos aquí con las columnas y la hora en que se
// conoce cada celda de liq_store.py, y las fuentes (tramos y ancho de celda) como el backend se las entrega al navegador.
// Lo que la documentación no decide se cuenta con cada lectura ("lecturas" en la salida), y la reconstrucción de todos los
// eventos con cada combinación dice cuál sigue el motor.
// Sin futuro: el ancho de celda que entrega el backend (liq_store, `cell_width`) es el más ancho de todo el archivo, también
// de fechas posteriores; "sin_futuro_ancho_de_celda" repite la reconstrucción con el de lo conocido hasta cada vela, el de
// la ventana de 30 días y sin ancho de celda (franjas de 0.1% puras), y cuenta los trades que se quedarían sin evento.
//
// Uso: node tests/audit/liq_check.mjs <volcado.json> <salida.json>   (el volcado sale de liq_volcado.py; BTC pide
// --max-old-space-size=6144 y unos 3 minutos)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const Z = await import(pathToFileURL(path.resolve(here, '../../../frontend/src/components/indicators/liquidationZones.js')).href);

const [, , dumpPath, outPath] = process.argv;
if (!dumpPath || !outPath) {
  console.error('Uso: node tests/audit/liq_check.mjs <volcado.json> <salida.json>');
  process.exit(2);
}
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
const DAY = Z.DAY_MS;
const ZR = Z.defaultZoneRules();
const LOOK = ZR.lookbackDays * DAY;
const MARGIN = 0.1 / 100;
const MAX_EX = 12;
const tfMs = dump.tf * 60000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const sideText = (d) => (d > 0 ? 'largo' : 'corto');
const near = (a, b, abs = 1e-8) => a !== null && b !== null && a !== undefined && b !== undefined && Math.abs(a - b) <= abs + 1e-9 * Math.max(Math.abs(a), Math.abs(b));

class Tally {
  constructor() { this.data = new Map(); }
  add(name, ok, example) {
    if (!this.data.has(name)) this.data.set(name, { cumplen: 0, de: 0, fallas: [] });
    const row = this.data.get(name);
    row.de += 1;
    if (ok) row.cumplen += 1;
    else if (example !== undefined && row.fallas.length < MAX_EX) row.fallas.push(example);
  }
  out() {
    const o = {};
    for (const [k, v] of this.data) o[k] = v.fallas.length ? v : { cumplen: v.cumplen, de: v.de };
    return o;
  }
}

// ---------- Velas del motor ----------
const T = [], O = [], H = [], L = [], C = [];
for (const [t, o, h, l, c] of dump.velas) { T.push(t); O.push(o); H.push(h); L.push(l); C.push(c); }
const n = T.length;
const at = new Map(T.map((t, i) => [t, i]));
const TR = T.map((_, i) => (i === 0 ? H[0] - L[0] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]))));
const atrSma = TR.map((_, i) => { let s = 0; const a = Math.max(0, i - 13); for (let j = a; j <= i; j++) s += TR[j]; return s / (i - a + 1); });
const atrWilder = []; for (let i = 0, prev = null; i < n; i++) { prev = prev === null ? TR[i] : prev + (TR[i] - prev) / 14; atrWilder.push(prev); }

// ---------- Celdas de liquidaciones, como las lee liq_store.py ----------
function parseCsv(file, kind) {
  const lines = fs.readFileSync(file, 'ascii').split(/\r?\n/);
  const head = lines[0].split(',');
  const col = Object.fromEntries(head.map((name, i) => [name, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split(',');
    if (kind === 'events') {
      const t = Number(f[col.time_ms]);
      const price = Number(f[col.price]);
      const usd = Number(f[col.usd]);
      const isLong = f[col.side] === 'long';
      rows.push({ known: t, start: t, end: t, low: price, high: price, long: isLong ? usd : 0, short: isLong ? 0 : usd });
    } else if (kind === 'spans') {
      const start = Number(f[col.start_ms]);
      const end = Number(f[col.end_ms]);
      rows.push({ known: end, start, end, low: Number(f[col.price_low]), high: Number(f[col.price_high]), long: Number(f[col.long_usd]), short: Number(f[col.short_usd]) });
    } else {
      const start = Date.parse(`${f[col.date_utc]}T00:00:00Z`);
      rows.push({ known: start + DAY, start, end: start + DAY, low: Number(f[col.price_low]), high: Number(f[col.price_high]), long: Number(f[col.long_usd]), short: Number(f[col.short_usd]) });
    }
  }
  rows.sort((a, b) => a.known - b.known || a.low - b.low);   // como liq_store: por hora en que se conoce y precio
  return rows;
}
const sources = dump.fuentes;   // en orden de prioridad, como las entrega el backend
const cellsBy = {};
const widestBy = {};   // por fuente, el ancho de celda más grande hasta cada celda (en el orden en que se conocen)
for (const s of sources) {
  cellsBy[s.id] = parseCsv(dump.archivos[s.id], s.kind);
  let w = 0;
  widestBy[s.id] = cellsBy[s.id].map((c) => (w = Math.max(w, c.high - c.low)));
}

// Zonas en una hora con un precio. cut "incl": celdas conocidas en (t - 30 d, t]; "excl": en (t - 30 d, t).
// wmode, el ancho de celda con que binWidthFor fija el ancho de franja: "archivo", el de la fuente que entrega el backend
// (el más ancho de todo el archivo, también de fechas posteriores: lo que usan el motor y el navegador); "conocido", el
// más ancho de las celdas conocidas hasta esa hora; "ventana", el más ancho de las celdas de la ventana
const built = new Map();
const pickedCache = new Map();
const windowWidest = new Map();
function zonesAt(t, price, cut = 'incl', wmode = 'archivo') {
  const key0 = `${t}|${price}|${cut}|${wmode}`;
  if (pickedCache.has(key0)) return pickedCache.get(key0);
  const src = Z.activeSource(sources, t, LOOK, 'auto');
  let got = null;
  if (src) {
    const cells = cellsBy[src.id];
    const from = Z.knownAfter(cells, t - LOOK);
    const to = cut === 'incl' ? Z.knownAfter(cells, t) : Z.knownAfter(cells, t - 1);
    let cellWidth = src.cell_width || 0;
    if (wmode === 'conocido') cellWidth = to > 0 ? widestBy[src.id][to - 1] : 0;
    else if (wmode === 'nada') cellWidth = 0;   // las franjas de 0.1% de la documentación, sin mirar el ancho de celda
    else if (wmode === 'ventana') {
      const wk = `${src.id}|${from}|${to}`;
      if (!windowWidest.has(wk)) {
        let w = 0;
        for (let i = from; i < to; i++) w = Math.max(w, cells[i].high - cells[i].low);
        windowWidest.set(wk, w);
      }
      cellWidth = windowWidest.get(wk);
    }
    const width = Z.binWidthFor(price, ZR.binPct, cellWidth);
    const key = `${src.id}|${from}|${to}|${width}`;
    let zones = built.get(key);
    if (!zones) {
      zones = Z.buildZones(cells, from, to, width, ZR);
      built.set(key, zones);
      if (built.size > 4000) built.delete(built.keys().next().value);
    }
    got = { src: src.id, width, from, to, zones, picked: Z.pickZones(zones, price).zones };
  }
  pickedCache.set(key0, got);
  if (pickedCache.size > 200000) pickedCache.delete(pickedCache.keys().next().value);
  return got;
}

const r8 = (x) => Number(Number(x).toFixed(8));   // como el motor guarda los precios de las zonas: a 8 decimales
// Un precio en una llave: a 6 decimales, para que el redondeo a 8 del motor (y el de toFixed) no separe la misma zona
const pk = (x) => Math.round(Number(x) * 1e6);
const rowOf = (z) => [r8(z.low), r8(z.high), Math.round(z.total), z.side];
function sameRows(stored, picked) {
  if (!stored || stored.length !== picked.length) return false;
  return stored.every((row, i) => near(row[0], picked[i].low) && near(row[1], picked[i].high)
    && Math.abs(row[2] - picked[i].total) <= 1 && row[3] === picked[i].side);
}
function sameSet(stored, picked) {   // las mismas zonas aunque en otro orden
  if (!stored || stored.length !== picked.length) return false;
  return stored.every((row) => picked.some((z) => near(row[0], z.low) && near(row[1], z.high) && Math.abs(row[2] - z.total) <= 1 && row[3] === z.side));
}
const findZone = (list, low, high) => list.find((z) => near(z.low, low) && near(z.high, high)) || null;
const contains = (z, v, mode) => (mode === 'swing'
  ? z.low - v * MARGIN <= v && v <= z.high + v * MARGIN
  : z.low * (1 - MARGIN) <= v && v <= z.high * (1 + MARGIN));

// ---------- Reconstrucción de los barridos de swings ----------
function rebuildSwings(swingBars, cut, mode, ageFrom, onePerBar = false, wmode = 'archivo') {
  const out = [];
  for (let p = swingBars; p < n - swingBars; p++) {
    for (const d of [-1, 1]) {   // d = -1: se barre un máximo (bajista); d = 1: un mínimo (alcista)
      const vals = d < 0 ? H : L;
      const v = vals[p];
      let unique = true;
      for (let j = p - swingBars; j <= p + swingBars && unique; j++) {
        if (j !== p && (d < 0 ? vals[j] >= v : vals[j] <= v)) unique = false;
      }
      if (!unique) continue;
      const t0 = ageFrom === 'swing' ? T[p] : T[p + swingBars] + tfMs;
      for (let k = p + 1; k < n; k++) {
        if (T[k] - t0 > LOOK) break;   // deja de seguirse a los 30 días
        if (!(d < 0 ? H[k] > v : L[k] < v)) continue;
        const zs = zonesAt(T[k], O[k], cut, wmode);
        if (zs) {
          const inside = zs.picked.filter((z) => contains(z, v, mode));
          if (inside.length) out.push({ t: T[k], dir: d, swingT: T[p], swing: v, zone: inside[0], inside: inside.length });
        }
        break;   // cada swing se barre una vez, con zona o sin ella
      }
    }
  }
  if (!onePerBar) return out;
  // Una vela que barre varios swings del mismo lado da un solo evento: el del swing con la zona de más dinero
  const best = new Map();
  for (const e of out) {
    const key = `${e.t}|${e.dir}`;
    const b = best.get(key);
    if (!b || e.zone.total > b.zone.total) best.set(key, e);
  }
  return [...best.values()];
}

// ---------- Reconstrucción de los barridos de zonas ----------
// Cada zona mostrada queda armada con la última vela entera de un lado (sin tocarla); la barre la primera vela que pasa su
// borde contrario estando armada (con shownAtSweep, solo si en esa vela está mostrada), y queda desarmada hasta otra vela
// entera fuera. firstK y lastK: la primera y la última vela que la armaron de ese lado antes del barrido
function rebuildZones(cut, shownAtSweep, idMode, wmode = 'archivo') {
  const idOf = (z) => (idMode === 'low' ? `${z.low}` : `${z.low}|${z.high}`);
  const armed = new Map();
  const out = [];
  for (let k = 0; k < n; k++) {
    const zs = zonesAt(T[k], O[k], cut, wmode);
    const shown = zs ? zs.picked : [];
    const byId = new Map(shown.map((z) => [idOf(z), z]));
    for (const [id, st] of armed) {
      if (!st.side) continue;
      if (shownAtSweep && !byId.has(id)) continue;
      const z = byId.get(id) || st.zone;
      if (st.side === 'above' && L[k] < z.low) { out.push({ t: T[k], k, dir: 1, low: z.low, high: z.high, firstK: st.firstK, lastK: st.lastK }); st.side = null; }
      else if (st.side === 'below' && H[k] > z.high) { out.push({ t: T[k], k, dir: -1, low: z.low, high: z.high, firstK: st.firstK, lastK: st.lastK }); st.side = null; }
    }
    for (const z of shown) {
      const side = L[k] > z.high ? 'above' : H[k] < z.low ? 'below' : null;
      if (!side) continue;
      const id = idOf(z);
      const st = armed.get(id);
      if (st && st.side === side) { st.lastK = k; st.zone = z; }
      else armed.set(id, { side, zone: z, firstK: k, lastK: k });
    }
  }
  return out;
}

function compareSets(engineKeys, mine, keyOf, label) {
  const mineKeys = new Map(mine.map((e) => [keyOf(e), e]));
  const onlyMine = [...mineKeys.keys()].filter((k) => !engineKeys.has(k));
  const onlyEng = [...engineKeys.keys()].filter((k) => !mineKeys.has(k));
  return {
    lectura: label, recalculados: mineKeys.size, iguales: mineKeys.size - onlyMine.length, solo_recalculados: onlyMine.length, solo_motor: onlyEng.length,
    ejemplos_solo_recalculados: onlyMine.slice(0, MAX_EX).map((k) => describeKey(k)),
    ejemplos_solo_motor: onlyEng.slice(0, MAX_EX).map((k) => describeKey(k)),
  };
}
function describeKey(k) {
  const [t, d, x] = k.split('|');
  return { vela: iso(Number(t)), lado: sideText(Number(d)), swing_o_borde_de_abajo: Number(x) / 1e6 };
}

// ---------- Cada regla ----------
function checkRule(R) {
  const what = R.liq.what;
  const swingBars = R.liq.swingBars;
  const tally = new Tally();
  const lect = new Tally();
  const events = R.eventos;
  const byKnown = new Map();
  for (const e of events) {
    const key = `${e.dir}|${e.known}`;
    if (!byKnown.has(key)) byKnown.set(key, []);
    byKnown.get(key).push(e);
  }
  const once = new Map();
  for (const e of events) {
    const key = what === 'swing' ? `${e.dir}|${e.info.swingT}` : `${e.dir}|${e.info.zoneLow}`;
    if (!once.has(key)) once.set(key, []);
    once.get(key).push(e);
  }
  // Con what = zone, la reconstrucción con la lectura que sigue el motor da la vela que armó cada zona
  const recZ = new Map(what === 'zone' ? rebuildZones('incl', true, 'lowhigh').map((e) => [`${e.t}|${e.dir}|${pk(e.low)}|${pk(e.high)}`, e]) : []);
  const armAge = [];
  const widths = new Set();  // anchos de franja usados
  const oldest = [];         // los armados más viejos (el primero, el mayor)
  const flags = new Map();   // con what = zone: si la vela del barrido toca la zona y si abre del lado de donde viene
  for (const e of events) {
    const info = e.info;
    const k = at.get(e.t);
    const ex = { vela: iso(e.t), lado: sideText(e.dir), swing: info.swing, extremo: info.extreme, zona_barrida: [info.zoneLow, info.zoneHigh], fuente: info.source };
    tally.add('la vela del barrido está en las velas del motor', k !== undefined, ex);
    if (k === undefined) continue;
    const price = O[k];
    tally.add('pierce: se conoce al cerrar la vela del barrido', e.known === e.t + tfMs, ex);
    const zi = zonesAt(e.t, price, 'incl');
    const ze = zonesAt(e.t, price, 'excl');
    tally.add('hay datos de liquidaciones en esa fecha (activeSource da una fuente)', !!zi, ex);
    if (!zi) continue;
    tally.add('la fuente es la de activeSource en esa hora', zi.src === info.source, { ...ex, fuente_js: zi.src });
    const okI = sameRows(info.zones, zi.picked);
    const okE = sameRows(info.zones, ze ? ze.picked : []);
    tally.add('zonas guardadas = las de liquidationZones.js (celdas conocidas hasta la apertura, incluida)', okI,
      { ...ex, guardadas: info.zones, js: zi.picked.map(rowOf), ancho: zi.width });
    lect.add('zonas guardadas = las de liquidationZones.js con las celdas conocidas antes de la apertura (sin la que se conoce justo a esa hora)', okE, ex);
    lect.add('zonas guardadas = las de liquidationZones.js, aunque en otro orden', sameSet(info.zones, zi.picked), ex);
    lect.add('la vela del barrido abre justo cuando se conoce una celda nueva (las dos lecturas de "antes de abrir" difieren)',
      !(ze && (ze.to !== zi.to)), ex);
    // Sin futuro: el ancho de celda de la fuente sale de todo el archivo, también de fechas posteriores al barrido
    const zk = zonesAt(e.t, price, 'incl', 'conocido');
    widths.add(`${zi.width}`);
    tally.add('el ancho de franja es el mismo con solo las celdas conocidas hasta la apertura (sin futuro)', zk && zk.width === zi.width,
      { ...ex, ancho_usado: zi.width, ancho_con_lo_conocido: zk ? zk.width : null, ancho_de_celda_del_archivo: sources.find((s) => s.id === zi.src).cell_width,
        ancho_de_celda_conocido: zk ? widestBy[zi.src][zk.to - 1] : null });
    lect.add('las zonas mostradas serían las mismas con el ancho de franja de lo conocido hasta la apertura', zk && sameRows(info.zones, zk.picked), ex);
    const marked = (info.zones || []).filter((row) => row[4] === true);
    tally.add('una sola zona marcada como barrida, y es la de zoneLow y zoneHigh', marked.length === 1 && near(marked[0][0], info.zoneLow) && near(marked[0][1], info.zoneHigh),
      { ...ex, marcadas: marked });
    const zj = findZone(zi.picked, info.zoneLow, info.zoneHigh);
    tally.add('la zona barrida es una de las mostradas por liquidationZones.js en la vela del barrido', !!zj, ex);
    if (zj) {
      tally.add('dinero de la zona = el de liquidationZones.js (usd, longUsd, shortUsd)', Math.abs(info.usd - zj.total) <= 1 && Math.abs(info.longUsd - zj.long) <= 1 && Math.abs(info.shortUsd - zj.short) <= 1,
        { ...ex, js: [zj.total, zj.long, zj.short], guardado: [info.usd, info.longUsd, info.shortUsd] });
      tally.add('lado liquidado = el de la zona (más largos o más cortos)', info.zoneSide === zj.side, { ...ex, js: zj.side, guardado: info.zoneSide });
      const max = zi.zones.reduce((m, z) => Math.max(m, z.total), 0);
      tally.add('share = dinero de la zona ÷ la mayor zona de la ventana', Math.abs(info.share - zj.total / max) <= 0.0006, { ...ex, js: zj.total / max, guardado: info.share });
      for (const [label, ref] of [['su última liquidación', zj.last], ['su nacimiento (la mitad de su dinero)', zj.birth], ['su primera liquidación', zj.first]]) {
        lect.add(`zoneAgeDays = días desde ${label}`, ref !== null && Math.abs(info.zoneAgeDays - (e.t - ref) / DAY) <= 0.006, { ...ex, js: ref !== null ? (e.t - ref) / DAY : null, guardado: info.zoneAgeDays });
      }
    }
    // Profundidad en ATR: lo que el barrido pasó del swing (o del borde)
    const depth = Math.abs(info.extreme - info.swing);
    for (const [label, atr] of [['ATR media simple de 14 en la vela del barrido', atrSma[k]], ['ATR media simple de 14 en la vela anterior', atrSma[k - 1]], ['ATR de Wilder en la vela del barrido', atrWilder[k]]]) {
      lect.add(`depthAtr = lo que pasó ÷ ${label}`, atr > 0 && Math.abs(info.depthAtr - depth / atr) <= 0.0006, { ...ex, js: atr > 0 ? depth / atr : null, guardado: info.depthAtr });
    }
    if (what === 'swing') {
      const p = at.get(info.swingT);
      const vals = e.dir < 0 ? H : L;
      tally.add('el swing está en las velas', p !== undefined, ex);
      if (p === undefined) continue;
      let unique = p - swingBars >= 0 && p + swingBars < n;
      for (let j = p - swingBars; unique && j <= p + swingBars; j++) if (j !== p && (e.dir < 0 ? vals[j] >= vals[p] : vals[j] <= vals[p])) unique = false;
      tally.add(`el swing es el único extremo de ${swingBars} velas por lado (un máximo en un corto, un mínimo en un largo)`, unique && vals[p] === info.swing,
        { ...ex, precio_de_la_vela: vals[p] });
      tally.add('el swing se conoce antes del barrido (al cerrar la última vela de su derecha)', p + swingBars < k, { ...ex, velas: k - p });
      const passes = e.dir < 0 ? H[k] > info.swing : L[k] < info.swing;
      tally.add('la vela pasa el swing (barrer un mínimo es alcista; un máximo, bajista)', passes, { ...ex, maximo: H[k], minimo: L[k] });
      let first = true;
      for (let j = p + 1; j < k && first; j++) if (e.dir < 0 ? H[j] > info.swing : L[j] < info.swing) first = false;
      tally.add('es la primera vela posterior que lo pasa', first, ex);
      let firstEq = true;
      for (let j = p + 1; j < k && firstEq; j++) if (e.dir < 0 ? H[j] >= info.swing : L[j] <= info.swing) firstEq = false;
      lect.add('es la primera vela posterior que lo toca o lo pasa (con >= en vez de >)', firstEq, ex);
      tally.add('el extremo del barrido es el de la vela (su máximo en un corto)', info.extreme === (e.dir < 0 ? H[k] : L[k]), ex);
      tally.add('zona del evento = del extremo del barrido al swing', near(e.lo, Math.min(info.swing, info.extreme)) && near(e.hi, Math.max(info.swing, info.extreme)), { ...ex, zona: [e.lo, e.hi] });
      tally.add('swingAgeBars = velas del swing al barrido', info.swingAgeBars === k - p, { ...ex, velas: k - p });
      tally.add('el swing tiene 30 días o menos al barrerse', e.t - info.swingT <= LOOK, { ...ex, dias: (e.t - info.swingT) / DAY });
      tally.add('cada swing se barre una vez (ningún otro evento con el mismo swing y lado)', once.get(`${e.dir}|${info.swingT}`).length === 1, ex);
      const ins = zi.picked.filter((z) => contains(z, info.swing, 'swing'));
      const insZ = zi.picked.filter((z) => contains(z, info.swing, 'zone'));
      tally.add('el swing cae en la zona barrida con 0.1% de margen', !!zj && (contains(zj, info.swing, 'swing') || contains(zj, info.swing, 'zone')), ex);
      lect.add('margen de 0.1% del precio del swing: el swing cae en la zona barrida', !!zj && contains(zj, info.swing, 'swing'), ex);
      lect.add('margen de 0.1% de cada borde de la zona: el swing cae en la zona barrida', !!zj && contains(zj, info.swing, 'zone'), ex);
      if (ins.length > 1) lect.add('con varias zonas que contienen el swing, la barrida es la de más dinero (la primera de pickZones)', !!zj && ins[0] === zj, { ...ex, zonas: ins.map(rowOf) });
      lect.add('el swing cae en una sola zona mostrada', ins.length === 1 && insZ.length === 1, { ...ex, zonas: ins.map(rowOf) });
    } else {
      const down = e.dir > 0;   // bajar a través de la zona es alcista
      tally.add('el borde pasado es el contrario: el de abajo al bajar (largo), el de arriba al subir (corto)', info.swing === (down ? info.zoneLow : info.zoneHigh), ex);
      const passes = down ? L[k] < info.zoneLow : H[k] > info.zoneHigh;
      tally.add('la vela pasa el borde contrario de la zona', passes, { ...ex, maximo: H[k], minimo: L[k] });
      tally.add('el extremo del barrido es el de la vela (su mínimo al bajar)', info.extreme === (down ? L[k] : H[k]), ex);
      tally.add('zona del evento = del extremo del barrido al borde pasado', near(e.lo, Math.min(info.swing, info.extreme)) && near(e.hi, Math.max(info.swing, info.extreme)), { ...ex, zona: [e.lo, e.hi] });
      // El armado: la última vela que la armó según la reconstrucción (abajo, la que coincide con el motor), comprobado aquí
      // vela por vela: entera del lado de donde viene el precio (no toca la zona) con la zona mostrada; desde ella, ninguna
      // vela con la zona mostrada pasó el borde contrario (habría sido el barrido) ni quedó entera del otro lado (la habría
      // armado al revés)
      const rec = recZ.get(`${e.t}|${e.dir}|${pk(info.zoneLow)}|${pk(info.zoneHigh)}`);
      tally.add('hay una vela anterior que la armó (entera del lado de donde viene el precio, con la zona mostrada)', !!rec, ex);
      if (rec) {
        const j = rec.lastK;
        const zsj = zonesAt(T[j], O[j], 'incl');
        const outside = down ? L[j] > info.zoneHigh : H[j] < info.zoneLow;
        tally.add('la vela que la armó no toca la zona, está del lado de donde viene y tiene la zona mostrada', outside && !!(zsj && findZone(zsj.picked, info.zoneLow, info.zoneHigh)),
          { ...ex, vela_que_arma: iso(T[j]) });
        let blocked = null;
        let hiddenPass = null;
        let otherHidden = null;
        for (let m = j + 1; m < k; m++) {
          const zs = zonesAt(T[m], O[m], 'incl');
          const shownM = !!(zs && findZone(zs.picked, info.zoneLow, info.zoneHigh));
          const passed = down ? L[m] < info.zoneLow : H[m] > info.zoneHigh;
          const other = down ? H[m] < info.zoneLow : L[m] > info.zoneHigh;
          if ((passed || other) && shownM) { blocked = m; break; }
          if (passed && hiddenPass === null) hiddenPass = m;
          if (other && otherHidden === null) otherHidden = m;
        }
        tally.add('desde que se armó, ninguna vela con la zona mostrada pasó el borde contrario ni quedó entera del otro lado', blocked === null,
          { ...ex, vela_que_arma: iso(T[j]), vela_que_lo_impide: blocked !== null ? iso(T[blocked]) : null });
        const days = (T[k] - T[j]) / DAY;
        armAge.push(days);
        const arming = { ...ex, vela_que_arma: iso(T[j]), dias_desde_el_armado: Math.round(days * 100) / 100, apertura: O[k], maximo: H[k], minimo: L[k] };
        if (!oldest.length || days > oldest[0].dias_desde_el_armado) oldest.unshift(arming);
        if (oldest.length > 3) oldest.pop();
        lect.add('el barrido es la primera vela que pasa el borde contrario desde que se armó (también contando las velas en que la zona no estaba mostrada)', hiddenPass === null,
          { ...arming, paso_antes_sin_zona: hiddenPass !== null ? iso(T[hiddenPass]) : null });
        lect.add('desde que se armó, el precio no quedó entero del otro lado de la zona antes del barrido (con la zona sin mostrar)', otherHidden === null,
          { ...arming, entera_del_otro_lado: otherHidden !== null ? iso(T[otherHidden]) : null });
        const touches = down ? H[k] >= info.zoneLow : L[k] <= info.zoneHigh;
        const opensOk = down ? O[k] >= info.zoneLow : O[k] <= info.zoneHigh;
        flags.set(e, { touches, opensOk, days });
        lect.add('la vela del barrido toca la zona', touches, arming);
        lect.add('la vela del barrido abre del lado de donde viene el precio o dentro de la zona (no ya del otro lado)', opensOk, arming);
        lect.add('se armó 1 día antes del barrido o menos', days <= 1, arming);
      }
      lect.add('la zona barrida está mostrada en la vela del barrido', !!zj, ex);
      const same = once.get(`${e.dir}|${info.zoneLow}`);
      const idx = same.indexOf(e);
      if (idx > 0) {
        const prev = same[idx - 1];
        const kp = at.get(prev.t);
        let rearm = false;
        for (let j = kp + 1; j < k && !rearm; j++) if (down ? L[j] > info.zoneHigh : H[j] < info.zoneLow) rearm = true;
        tally.add('cada zona se barre una vez hasta que el precio vuelve a salir (entre dos barridos de la misma zona y lado, una vela entera fuera)', rearm,
          { ...ex, barrido_anterior: iso(prev.t) });
      }
    }
  }

  // Señales y trades
  const evKey = new Set(events.map((e) => `${e.dir}|${e.t}`));
  const flip = R.invert ? -1 : 1;
  for (const s of R['señales']) tally.add('cada señal es un evento LIQ del motor (misma vela y lado)', evKey.has(`${s.dir * flip}|${s.t}`), { vela: iso(s.t), lado: sideText(s.dir) });
  let multi = 0;
  for (const list of byKnown.values()) if (list.length > 1) multi += 1;
  for (const t of R.trades) {
    const list = byKnown.get(`${t.dir * flip}|${t.known}`) || [];
    const ex = { trade: t.n, vela: iso(t.signal), lado: sideText(t.dir), entrada: t.entry, stop: t.stop, zona: t.zone };
    tally.add('el trade sale de un evento LIQ (mismo lado y hora)', list.length > 0, ex);
    if (!list.length) continue;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    tally.add('el trade guarda en liq lo de un evento con su lado y hora', list.some((e) => same(e.info, t.liq)), ex);
    if (list.length > 1) {
      lect.add('con varios eventos en la misma vela y lado, el trade guarda el último', same(list[list.length - 1].info, t.liq),
        { ...ex, eventos: list.map((e) => [e.info.zoneLow, e.info.zoneHigh]) });
    }
    if (what === 'zone' && list.every((e) => flags.has(e))) {
      lect.add('trades: al menos una zona de la señal la toca la vela del barrido', list.some((e) => flags.get(e).touches), ex);
      lect.add('trades: al menos una zona de la señal la vela del barrido no la abre ya del otro lado', list.some((e) => flags.get(e).opensOk), ex);
      lect.add('trades: al menos una zona de la señal se armó 7 días antes del barrido o menos', list.some((e) => flags.get(e).days <= 7), ex);
    }
    const lo = Math.min(...list.map((e) => e.lo));
    const hi = Math.max(...list.map((e) => e.hi));
    tally.add('la zona del trade va de la zona más baja a la más alta de sus eventos', t.zone && near(t.zone[0], lo) && near(t.zone[1], hi), { ...ex, eventos: list.map((e) => [e.lo, e.hi]) });
    const k = at.get(t.signal);
    const far = t.dir > 0 ? lo : hi;
    const buf = Number(R.stop.buffer || 0);
    tally.add(`stop "extremo de la vela del elemento" + ${buf} ATR: detrás del extremo del barrido`, t.dir > 0 ? t.stop < far : t.stop > far, ex);
    lect.add(`stop = extremo del barrido ∓ ${buf} ATR (media simple de 14)`, k !== undefined && near(t.stop, far - (t.dir > 0 ? 1 : -1) * buf * atrSma[k], 1e-9), { ...ex, recalculado: k !== undefined ? far - (t.dir > 0 ? 1 : -1) * buf * atrSma[k] : null });
  }

  // Reconstrucción de todos los eventos con cada lectura
  const recon = [];
  if (what === 'swing') {
    const eng = new Map(events.map((e) => [`${e.t}|${e.dir}|${pk(e.info.swing)}|${e.info.swingT}`, e]));
    const engBar = new Map(events.map((e) => [`${e.t}|${e.dir}`, e]));
    const engSwing = new Map(events.map((e) => [`${e.dir}|${e.info.swingT}`, e]));
    for (const cut of ['incl', 'excl']) for (const mode of ['swing', 'zone']) for (const ageFrom of ['swing', 'conocido']) for (const onePerBar of [false, true]) {
      const mine = rebuildSwings(swingBars, cut, mode, ageFrom, onePerBar);
      const row = compareSets(eng, mine, (e) => `${e.t}|${e.dir}|${pk(e.swing)}|${e.swingT}`,
        { celdas: cut === 'incl' ? 'hasta la apertura, incluida' : 'antes de la apertura', margen: mode === 'swing' ? '0.1% del swing' : '0.1% de cada borde',
          edad: ageFrom === 'swing' ? 'desde el swing' : 'desde que se conoce', por_vela: onePerBar ? 'un evento por vela y lado (la zona de más dinero)' : 'todos los swings barridos' });
      // Por qué sobra cada recalculado: en esa vela el motor barrió otro swing del mismo lado, o barrió este en otra vela
      const why = { otro_swing_en_esa_vela: 0, este_swing_en_otra_vela: 0, otro: 0 };
      const pick = { el_mas_reciente: 0, el_mas_viejo: 0, el_mas_extremo: 0, el_menos_extremo: 0 };
      const otherEx = [];
      for (const e of mine) {
        if (eng.has(`${e.t}|${e.dir}|${pk(e.swing)}|${e.swingT}`)) continue;
        const sameBar = engBar.get(`${e.t}|${e.dir}`);
        if (sameBar) {
          why.otro_swing_en_esa_vela += 1;
          pick[sameBar.info.swingT > e.swingT ? 'el_mas_reciente' : 'el_mas_viejo'] += 1;
          const moreExtreme = e.dir < 0 ? sameBar.info.swing > e.swing : sameBar.info.swing < e.swing;
          pick[moreExtreme ? 'el_mas_extremo' : 'el_menos_extremo'] += 1;
        } else if (engSwing.has(`${e.dir}|${e.swingT}`)) why.este_swing_en_otra_vela += 1;
        else {
          why.otro += 1;
          if (otherEx.length < MAX_EX) otherEx.push({ vela: iso(e.t), lado: sideText(e.dir), swing: e.swing, swing_en: iso(e.swingT), zona: rowOf(e.zone) });
        }
      }
      // Lo que eligió el motor cuando una vela barre varios swings del mismo lado (comparado contra cada uno que sobra)
      // y, por vela, qué regla de elección lo explica
      const groups = new Map();
      for (const e of mine) {
        const key = `${e.t}|${e.dir}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      const hyp = {
        'el swing más viejo': (list) => list.reduce((a, b) => (b.swingT < a.swingT ? b : a)),
        'el swing más reciente': (list) => list.reduce((a, b) => (b.swingT > a.swingT ? b : a)),
        'el más extremo (el máximo más alto en un corto)': (list) => list.reduce((a, b) => ((b.dir < 0 ? b.swing > a.swing : b.swing < a.swing) ? b : a)),
        'el menos extremo (el más pasado)': (list) => list.reduce((a, b) => ((b.dir < 0 ? b.swing < a.swing : b.swing > a.swing) ? b : a)),
        'el de la zona con más dinero': (list) => list.reduce((a, b) => (b.zone.total > a.zone.total ? b : a)),
        'el de la zona con menos dinero': (list) => list.reduce((a, b) => (b.zone.total < a.zone.total ? b : a)),
      };
      const multiPick = Object.fromEntries(Object.keys(hyp).map((h) => [h, 0]));
      let multiBars = 0;
      const multiEx = [];
      for (const [key, list] of groups) {
        if (list.length < 2) continue;
        const engE = engBar.get(key);
        if (!engE) continue;
        multiBars += 1;
        for (const [h, f] of Object.entries(hyp)) {
          const c = f(list);
          if (c.swingT === engE.info.swingT) multiPick[h] += 1;
        }
        if (multiEx.length < MAX_EX) {
          multiEx.push({ vela: iso(list[0].t), lado: sideText(list[0].dir), motor: { swing: engE.info.swing, en: iso(engE.info.swingT), zona: [engE.info.zoneLow, engE.info.zoneHigh] },
            candidatos: list.map((e) => ({ swing: e.swing, en: iso(e.swingT), zona: rowOf(e.zone) })) });
        }
      }
      recon.push({ ...row, por_que_sobran: why, en_esa_vela_el_motor_eligio: pick, ejemplos_otro: otherEx,
        varios_swings_en_una_vela: { velas: multiBars, eleccion_que_lo_explica: multiPick, ejemplos: multiEx } });
    }
  } else {
    const eng = new Map(events.map((e) => [`${e.t}|${e.dir}|${pk(e.info.zoneLow)}|${pk(e.info.zoneHigh)}`, e]));
    for (const cut of ['incl', 'excl']) for (const shownAtSweep of [false, true]) for (const idMode of ['lowhigh', 'low']) {
      const mine = rebuildZones(cut, shownAtSweep, idMode);
      recon.push(compareSets(eng, mine, (e) => `${e.t}|${e.dir}|${pk(e.low)}|${pk(e.high)}`,
        { celdas: cut === 'incl' ? 'hasta la apertura, incluida' : 'antes de la apertura', mostrada_al_barrer: shownAtSweep, zona_por: idMode === 'low' ? 'su borde de abajo' : 'sus dos bordes' }));
    }
  }
  recon.sort((a, b) => (a.solo_recalculados + a.solo_motor) - (b.solo_recalculados + b.solo_motor));

  // Sin futuro: la misma reconstrucción, con las lecturas que sigue el motor, pero con el ancho de celda de lo conocido
  // hasta cada vela (o de la ventana de 30 días) en vez del de todo el archivo
  const noFuture = [];
  for (const wmode of ['conocido', 'ventana', 'nada']) {
    let mine, eng, keyOf;
    if (what === 'swing') {
      mine = rebuildSwings(swingBars, 'incl', 'swing', 'swing', true, wmode);
      eng = new Map(events.map((e) => [`${e.t}|${e.dir}|${pk(e.info.swing)}|${e.info.swingT}`, e]));
      keyOf = (e) => `${e.t}|${e.dir}|${pk(e.swing)}|${e.swingT}`;
    } else {
      mine = rebuildZones('incl', true, 'lowhigh', wmode);
      eng = new Map(events.map((e) => [`${e.t}|${e.dir}|${pk(e.info.zoneLow)}|${pk(e.info.zoneHigh)}`, e]));
      keyOf = (e) => `${e.t}|${e.dir}|${pk(e.low)}|${pk(e.high)}`;
    }
    const row = compareSets(eng, mine, keyOf, { ancho_de_celda: { conocido: 'el más ancho de lo conocido hasta esa vela', ventana: 'el más ancho de la ventana de 30 días', nada: 'ninguno: franjas de 0.1% del precio' }[wmode] });
    const mineSides = new Set(mine.map((e) => `${e.dir}|${e.t}`));
    row.velas_y_lados_iguales = events.filter((e) => mineSides.has(`${e.dir}|${e.t}`)).length;
    const mineBars = new Set(mine.map((e) => `${e.dir}|${e.t + tfMs}`));
    const lost = R.trades.filter((t) => !mineBars.has(`${t.dir * flip}|${t.known}`));
    noFuture.push({ ...row, trades_sin_ningun_evento: lost.length, de_trades: R.trades.length,
      ejemplos_trades: lost.slice(0, MAX_EX).map((t) => ({ trade: t.n, vela: iso(t.signal), lado: sideText(t.dir), entrada: t.entry })) });
  }
  const ages = armAge.slice().sort((a, b) => a - b);
  const q = (f) => (ages.length ? Math.round(ages[Math.min(ages.length - 1, Math.floor(f * ages.length))] * 100) / 100 : null);
  return {
    regla: R.regla, liq: R.liq,
    motor: { eventos: events.length, 'señales': R['señales'].length, trades: R.trades.length, velas_con_varios_eventos_del_mismo_lado: multi },
    condiciones: tally.out(), lecturas: lect.out(), reconstruccion: recon, anchos_de_franja_usados: [...widths].map(Number).sort((a, b) => a - b),
    sin_futuro_ancho_de_celda: noFuture,
    ...(ages.length ? { dias_desde_el_armado: { mediana: q(0.5), p90: q(0.9), p99: q(0.99), maximo: q(1), mas_de_7_dias: ages.filter((d) => d > 7).length, de: ages.length,
      los_mas_viejos: oldest } } : {}),
  };
}

const t0 = Date.now();
const out = {
  moneda: dump.moneda, tf: dump.tf, fase: dump.fase, desde: dump.desde, hasta: dump.hasta,
  fuentes: sources.map((s) => ({ id: s.id, kind: s.kind, primero: iso(s.first), ultimo: iso(s.last), tramos: s.ranges.length, ancho_de_celda: s.cell_width })),
  reglas: {},
};
for (const R of dump.reglas) {
  const got = checkRule(R);
  out.reglas[R.regla] = got;
  console.log(`${dump.moneda} ${R.regla}: ${JSON.stringify(got.motor)}`);
  for (const [k, v] of Object.entries(got.condiciones)) console.log(`  ${v.cumplen === v.de ? '✓' : '⚠'} ${k}: ${v.cumplen} de ${v.de}`);
  for (const [k, v] of Object.entries(got.lecturas)) console.log(`  · ${k}: ${v.cumplen} de ${v.de}`);
  for (const c of got.reconstruccion.slice(0, 4)) {
    console.log(`  reconstrucción ${JSON.stringify(c.lectura)}: ${c.iguales} iguales, ${c.solo_recalculados} solo recalculados, ${c.solo_motor} solo del motor`
      + (c.por_que_sobran ? ` · sobran: ${JSON.stringify(c.por_que_sobran)} · velas con varios: ${JSON.stringify(c.varios_swings_en_una_vela.velas)} ${JSON.stringify(c.varios_swings_en_una_vela.eleccion_que_lo_explica)}` : ''));
  }
  console.log(`  anchos de franja usados: ${JSON.stringify(got.anchos_de_franja_usados)}`);
  for (const c of got.sin_futuro_ancho_de_celda) {
    console.log(`  sin futuro ${JSON.stringify(c.lectura)}: ${c.iguales} iguales, ${c.solo_recalculados} solo sin futuro, ${c.solo_motor} solo del motor `
      + `(${c.velas_y_lados_iguales} eventos del motor con un evento en su vela y lado); trades sin ningún evento: ${c.trades_sin_ningun_evento} de ${c.de_trades}`);
  }
}
out.segundos = Math.round((Date.now() - t0) / 100) / 10;
fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
console.log(`→ ${outPath} (${out.segundos} s)`);
