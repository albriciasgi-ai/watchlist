// Protocolo (21/11/2026), R13c y R13d: ver smc_box_check.py.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [, , dataPath, indDir] = process.argv;
const { computeSmc } = await import(pathToFileURL(join(indDir, 'smcStructure.js')).href);
const { erBox } = await import(pathToFileURL(join(indDir, 'regimeDetectors.js')).href);
const d = JSON.parse(readFileSync(dataPath, 'utf8'));
const n = d.T.length;
const bars = { t: Float64Array.from(d.T), o: Float64Array.from(d.O), h: Float64Array.from(d.H), l: Float64Array.from(d.L), c: Float64Array.from(d.C), v: new Float64Array(n) };
const index = new Map(d.T.map((t, i) => [t, i]));
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const near = (a, b, tol = 2e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const tr = d.H.map((h, i) => (i ? Math.max(h - d.L[i], Math.abs(h - d.C[i - 1]), Math.abs(d.L[i] - d.C[i - 1])) : h - d.L[i]));
const sma14 = tr.map((_, i) => { const w = tr.slice(Math.max(0, i - 13), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
const rule = d.rule;
const code = rule.recipe.slots[0].codes[0];
const stopOf = (t, k, zone) => {
  const s = rule.stop;
  if (s.type === 'atr') return t.entry - t.dir * s.atr * sma14[k];
  const far = t.dir > 0 ? zone[0] : zone[1];
  return far - t.dir * (s.buffer || 0) * sma14[k];
};
let ok = 0, bad = 0;

if (code === 'OB') {
  const s = rule.smc;
  const cfg = { internal: { length: s.internal }, swing: { length: s.swing }, ob: { pick: s.pick, area: s.area, mitigation: s.mitigation }, equal: { length: s.eqLength, threshold: s.eqThreshold } };
  const out = computeSmc(bars, cfg);
  const evs = out.obs.filter(o => o.scope === s.scope && (s.break === 'any' || (s.break === 'bos' ? true : true)));
  const sideOk = { both: [1, -1], long: [1], short: [-1] }[rule.recipe.side || 'both'];
  const mine = evs.filter(o => sideOk.includes(o.dir));
  console.log(`  OB (${s.scope}) con smcStructure.js: ${mine.length} en la fase; la corrida dice ${d.signals} señales; campos del OB: ${Object.keys(evs[0] || {}).join(', ')}`);
  for (const t of d.trades) {
    const k = index.get(t.signal);
    const ev = mine.find(o => o.known === k && o.dir === t.dir);
    const msgs = [];
    if (!ev) msgs.push('no hay OB de smcStructure.js en la vela de la señal');
    else {
      if (!(near(ev.bottom, t.zone[0]) && near(ev.top, t.zone[1]))) msgs.push(`zona ${ev.bottom}–${ev.top} · trade ${t.zone}`);
      const weak = t.dir > 0 ? out.top[k] : out.bottom[k];
      if (!near(weak, t.target)) msgs.push(`objetivo (rango mayor) ${weak} · trade ${t.target}`);
    }
    const st = stopOf(t, k, t.zone);
    if (!near(st, t.stop, 1e-5)) msgs.push(`stop ${st.toFixed(6)} · trade ${t.stop}`);
    if (msgs.length) { bad += 1; console.log(`  ⚠ #${t.n} ${iso(t.signal)}: ${msgs.join('; ')}`); } else ok += 1;
  }
  const traded = new Set(d.trades.map(t => index.get(t.signal)));
  console.log(`  OB sin trade: ${mine.filter(o => !traded.has(o.known)).map(o => `${iso(d.T[o.known])} ${o.dir > 0 ? '↑' : '↓'}`).join(', ') || '—'}`);
} else if (code === 'BE') {
  const z = erBox(bars, d.erBox).zones;   // con los parámetros afinados del detector, los que usa el motor
  console.log(`  cajas de erBox con ${JSON.stringify(d.erBox)}: ${z.length}`);
  for (const t of d.trades) {
    const k = index.get(t.signal);
    const b = t.box;
    const msgs = [];
    const zone = z.find(q => d.T[q.start] === b.start && d.T[q.detected] === b.detected);
    if (!zone) msgs.push('la caja no sale con erBox de regimeDetectors.js');
    else {
      if (!(near(zone.low, b.low) && near(zone.high, b.high))) msgs.push(`caja ${zone.low}–${zone.high} · trade ${b.low}–${b.high}`);
      if (!(zone.detected <= k && k <= zone.end)) msgs.push(`la señal no cae dentro de la vida de la caja (${iso(d.T[zone.detected])} a ${iso(d.T[zone.end])})`);
    }
    const height = b.high - b.low;
    const frac = (t.zone[1] - t.zone[0]) / height;
    const edgeOk = t.dir < 0 ? near(t.zone[1], b.high) : near(t.zone[0], b.low);
    if (!edgeOk) msgs.push(`la zona no toca el borde de su lado (${t.zone})`);
    const reached = t.dir < 0 ? d.H[k] >= t.zone[0] : d.L[k] <= t.zone[1];
    if (!reached) msgs.push('la vela de la señal no llega a la zona del borde');
    const mid = (b.low + b.high) / 2;
    if (!near(mid, t.target)) msgs.push(`objetivo (centro) ${mid} · trade ${t.target}`);
    const st = stopOf(t, k, t.zone);
    if (!near(st, t.stop, 1e-5)) msgs.push(`stop ${st.toFixed(6)} · trade ${t.stop}`);
    if (msgs.length) { bad += 1; console.log(`  ⚠ #${t.n} ${iso(t.signal)}: ${msgs.join('; ')}`); }
    else { ok += 1; console.log(`  #${t.n} ${t.dir > 0 ? 'largo' : 'corto'} ${iso(t.signal)}: caja ${b.low}–${b.high}, zona del borde ${(frac * 100).toFixed(1)}% del alto, cierre de la señal a ${b.closeAt} de la caja`); }
  }
}
console.log(`  trades: ${ok} iguales, ${bad} distintos`);
