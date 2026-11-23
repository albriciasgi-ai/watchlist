// Protocolo (21/11/2026), R11: rearma con vpa.js el mapa de avisos de la salida VPA y lo compara con el del motor.
// Lo llama vpa_exit_check.py con el JSON de las velas del motor. Ver la explicación allí.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , dataPath, vpaPath] = process.argv;
const { VpaReader, defaultVpaParams } = await import(pathToFileURL(vpaPath).href);
const d = JSON.parse(readFileSync(dataPath, 'utf8'));
const n = d.T.length;
const reader = new VpaReader(d.tf, { ...defaultVpaParams(), ...d.vpaCfg });
for (let i = 0; i < n; i += 1) reader.push({ t: d.T[i], o: d.O[i], h: d.H[i], l: d.L[i], c: d.C[i], v: d.V[i] });
const s = reader.s;
const fire = reader.cfg.fire;
const on = new Set(d.exitVpa.on);
const thr = d.exitVpa.thr ?? 1.0;
const fromR = d.exitVpa.fromR ?? 0;
const LABEL = { climax: 'VPA: clímax o frenado', absorb: 'VPA: esfuerzo en contra', push: 'VPA: retroceso con volumen',
  meter: 'VPA: medidor en contra', fade: 'VPA: esfuerzo que se agota' };
const ok = (x) => Number.isFinite(x);
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

function build(meterNeedsRv) {
  const map = { 1: new Map(), '-1': new Map() };
  const put = (side, i, key) => { const m = map[side]; if (!m.has(i)) m.set(i, LABEL[key]); };
  const climax = new Map();
  if (on.has('climax')) {
    for (const e of reader.events) {
      if (e.code !== 'QC' && e.code !== 'QS') continue;
      if (!climax.has(e.index)) climax.set(e.index, []);
      climax.get(e.index).push(e);
    }
  }
  for (let i = 0; i < n; i += 1) {
    for (const e of climax.get(i) || []) put(-e.dir, i, 'climax');   // el clímax va contra el tramo: avisa a quien va con él
    const dir = s.dir[i], leg = s.leg[i];
    if (on.has('absorb') && ok(s.absorb[i]) && s.absorb[i] >= fire) {
      const pointsTo = dir ? -dir : -leg;                               // contra el color, o contra el tramo en un doji
      if (pointsTo) put(-pointsTo, i, 'absorb');
    }
    if (on.has('push') && dir && ok(s.valid[i]) && s.valid[i] >= fire) put(-dir, i, 'push');
    if (on.has('meter') && ok(s.meter[i]) && (!meterNeedsRv || ok(s.rv[i]))) {
      for (const side of [1, -1]) if (s.meter[i] * side <= -thr) put(side, i, 'meter');
    }
    if (on.has('fade') && leg && ok(s.fade[i]) && s.fade[i] >= fire) put(leg, i, 'fade');
  }
  return map;
}

function compare(map) {
  const out = [];
  for (const side of ['1', '-1']) {
    const mine = map[side];
    const theirs = new Map(Object.entries(d.engine[side] || {}).map(([i, why]) => [Number(i), why]));
    let same = 0, onlyMine = [], onlyTheirs = [], other = [];
    for (const [i, why] of mine) {
      if (!theirs.has(i)) onlyMine.push([i, why]);
      else if (theirs.get(i) !== why) other.push([i, why, theirs.get(i)]);
      else same += 1;
    }
    for (const [i, why] of theirs) if (!mine.has(i)) onlyTheirs.push([i, why]);
    out.push({ side, mine: mine.size, theirs: theirs.size, same, onlyMine, onlyTheirs, other });
  }
  return out;
}

for (const needsRv of [true, false]) {
  const rows = compare(build(needsRv));
  const bad = rows.reduce((a, r) => a + r.onlyMine.length + r.onlyTheirs.length + r.other.length, 0);
  console.log(`  mapa de avisos con vpa.js (${needsRv ? 'medidor solo con la vela leída' : 'medidor siempre'}): ` +
    rows.map(r => `${r.side === '1' ? 'largos' : 'cortos'} ${r.mine} (motor ${r.theirs}, iguales ${r.same})`).join('; ') +
    (bad ? ` · ${bad} distintos` : ' · todo igual'));
  for (const r of rows) {
    for (const [i, why] of r.onlyMine.slice(0, 5)) console.log(`    solo vpa.js, ${r.side === '1' ? 'largos' : 'cortos'}: ${iso(d.T[i])} ${why} (rv ${s.rv[i]})`);
    for (const [i, why] of r.onlyTheirs.slice(0, 5)) console.log(`    solo el motor, ${r.side === '1' ? 'largos' : 'cortos'}: ${iso(d.T[i])} ${why}`);
    for (const [i, a, b] of r.other.slice(0, 5)) console.log(`    otro motivo, ${r.side === '1' ? 'largos' : 'cortos'}: ${iso(d.T[i])} vpa.js ${a} · motor ${b}`);
  }
}

// Cada trade con el mapa de vpa.js (medidor solo con la vela leída, como pide "sabidas al cierre de su vela")
const map = build(true);
const barOf = (t) => { let lo = 0, hi = n - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
let good = 0, bad = 0, ambiguous = 0;
const counts = {};
for (const t of d.trades) {
  const side = t.dir, ei = barOf(t.entry_t), risk = Math.abs(t.entry - t.stop);
  let mfe = 0, want = null;
  for (let j = ei; j < n && !want; j += 1) {
    const hitS = side > 0 ? d.L[j] <= t.stop : d.H[j] >= t.stop;
    const hitT = t.target != null && (side > 0 ? d.H[j] >= t.target : d.L[j] <= t.target);
    if (hitS || hitT) { want = { bar: j, reason: hitS && hitT ? 'dudosa' : (hitS ? 'stop' : 'objetivo') }; break; }
    mfe = Math.max(mfe, (side > 0 ? d.H[j] - t.entry : t.entry - d.L[j]) / risk);
    const warn = map[side].get(j);
    if (warn && j + 1 < n && mfe >= fromR) want = { bar: j + 1, reason: warn };
  }
  const got = { bar: barOf(t.exit_t), reason: t.reason };
  counts[t.reason] = (counts[t.reason] || 0) + 1;
  if (!want) { console.log(`  #${t.n}: sin salida recalculada (abierta al final)`); bad += 1; continue; }
  if (want.reason === 'dudosa') {
    if (want.bar === got.bar && (got.reason === 'stop' || got.reason === 'objetivo')) ambiguous += 1;
    else { bad += 1; console.log(`  ⚠ #${t.n}: vela dudosa ${iso(d.T[want.bar])}; el motor ${got.reason} ${iso(t.exit_t)}`); }
    continue;
  }
  if (want.bar === got.bar && want.reason === got.reason) good += 1;
  else { bad += 1; console.log(`  ⚠ #${t.n} ${side > 0 ? 'largo' : 'corto'}: recalculada ${want.reason} en ${iso(d.T[want.bar])}; el motor ${got.reason} en ${iso(t.exit_t)}`); }
}
console.log(`  trades: ${good} con la misma salida, ${ambiguous} en vela dudosa (stop y objetivo; la decide el minuto a minuto), ${bad} distintos · motivos ${JSON.stringify(counts)}`);

// El mapa de vpa.js por hora de la vela, en letras (c clímax, a esfuerzo en contra, p retroceso, m medidor, f se agota),
// para la comprobación de cada trade en pantalla (exitCheck con opts.vpa del ayudante capa_bc.js)
const CODE = { [LABEL.climax]: 'c', [LABEL.absorb]: 'a', [LABEL.push]: 'p', [LABEL.meter]: 'm', [LABEL.fade]: 'f' };
const compact = { 1: {}, '-1': {} };
for (const side of ['1', '-1']) for (const [i, why] of map[side]) compact[side][d.T[i]] = CODE[why];
const { writeFileSync } = await import('node:fs');
writeFileSync(dataPath.replace(/vpa_exit_(.+)\.json$/, 'vpa_map_$1.json'), JSON.stringify(compact));
