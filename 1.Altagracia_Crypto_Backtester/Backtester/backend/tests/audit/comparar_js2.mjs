// Protocolo (22/11/2026), etapa 6: las piezas de nivel C del VPA y de SMC contra sus indicadores en JavaScript, que
// tienen sus propias pruebas de paridad con Python (vpa.parity.test.mjs y williamssmc.parity.test.mjs).
// Lee el volcado del motor (volcar_eventos2.py) y, con las mismas velas:
//   - VPA: los elementos QA, QF, QR, QT, QS, QC y QE de computeVpa (vpa.js) con los parámetros de la regla, evento por
//     evento: vela, lado, cuándo se sabe, zona e info (la del motor va redondeada a 4 decimales: O-12);
//   - SMC: BS, OB, BK y EQ leídos de computeSmc (smcStructure.js) con la configuración de la regla (ruleSmcConfig, la
//     que usa el gráfico al elegir un trade), con la definición de la documentación (CLAUDE.md, "Fase 2: el probador
//     de reglas"): BS en la vela que rompe, zona del nivel al cierre; OB nace con la ruptura y su zona es el OB; BK es
//     el OB roto, del lado contrario, en la vela que lo rompe; EQ en la vela que barre (la primera que pasa el nivel),
//     contra el lado barrido y, con `reclaim`, si cierra de vuelta;
//   - filtros, en cada señal del FVG 0.3 sin "una posición a la vez": premium/discount y estructura mayor a favor
//     (computeSmc) y el medidor VPA a favor o que no esté en contra (computeVpa), contra lo que hizo el motor.
// Aparte, sin entrar en la cuenta de las mismas velas:
//   - "gráfico": lo mismo con las velas que tiene el gráfico de la ventana (desde su primera vela, que puede ser
//     anterior a la fase, y en las monedas de siempre las del caché de App 1), separando el arranque de las velas;
//   - "ventana SMC": SMCIndicator calcula una ventana (la vista y 1,500 velas antes, en bloques de 200): con las mismas
//     velas, lo que vería el gráfico al elegir un trade en cada evento y en cada señal del filtro.
// Uso: node tests/audit/comparar_js2.mjs <volcado2.json> [salida.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ind = (f) => pathToFileURL(path.resolve(here, '../../../frontend/src/components/indicators', f)).href;
const bt = (f) => pathToFileURL(path.resolve(here, '../../../frontend/src/components/backtesting', f)).href;
const { computeVpa, defaultVpaParams } = await import(ind('vpa.js'));
const { computeSmc, defaultSmcConfig } = await import(ind('smcStructure.js'));
const { barsOf } = await import(ind('williams.js'));
const { ruleSmcConfig } = await import(bt('ruleTester.js'));

const [, , dumpPath, outPath] = process.argv;
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
const tf = dump.tf, tfMs = tf * 60000;
const toCandles = (rows) => rows.map(([t, o, h, l, c, v]) => ({ timestamp: t, open: o, high: h, low: l, close: c, volume: v }));
const candles = toCandles(dump.bars);
const n = candles.length;
const T = candles.map(k => k.timestamp);
const C = candles.map(k => k.close);
const iso = (ms) => (ms === null || ms === undefined ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' '));
const close = (a, b, rel = 1e-9) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b)));
const num = (x) => (x === null || x === undefined ? NaN : x);
// Igual, o los dos sin dato (el motor guarda None donde el JS tiene NaN)
const sameValue = (a, b) => (!Number.isFinite(num(a)) && !Number.isFinite(num(b))) || close(num(a), num(b));
const fmt = (x) => (Number.isFinite(x) ? (+x).toPrecision(7) : String(x));
const arrow = (d) => (d > 0 ? '↑' : '↓');
const out = { moneda: dump.moneda, tf, fase: dump.fase, velas: n, desde: iso(T[0]), hasta: iso(T[n - 1]) };
const MAX_EJ = 12;

// ---------------------------------------------------------------- comparación evento por evento
const TIME_KEYS = new Set(['breakout', 'heavy', 'pivot', 'candle', 'first', 'second']);

/** Info del motor contra la del JS: diferencias reales y las que solo son el redondeo del motor (O-12) */
function infoDiff(ei = {}, mi = {}, rounded) {
  const real = [], round = [];
  for (const [key, b] of Object.entries(mi)) {
    const a = ei[key];
    if (typeof b === 'string' || typeof b === 'boolean' || TIME_KEYS.has(key)) {
      if (a !== b) real.push(`${key} ${TIME_KEYS.has(key) ? iso(a) : a} vs ${TIME_KEYS.has(key) ? iso(b) : b}`);
      continue;
    }
    if (close(num(a), b) || (a === null && !Number.isFinite(b))) continue;
    const tol = key === 'grade' ? 5.0001e-4 : 5.0001e-5;
    if (rounded && Number.isFinite(a) && Math.abs(a - b) <= tol) round.push(`${key} ${a} vs ${b}`);
    else real.push(`${key} ${a} vs ${b}`);
  }
  return { real, round };
}

function compare(name, engine, mine, { rounded = false, quiet = false } = {}) {
  const key = (e) => `${e.dir}|${e.t}`;
  const group = (arr) => {
    const m = new Map();
    for (const e of arr) {
      if (!m.has(key(e))) m.set(key(e), []);
      m.get(key(e)).push(e);
    }
    for (const list of m.values()) list.sort((p, q) => p.lo - q.lo || p.hi - q.hi);
    return m;
  };
  const E = group(engine), M = group(mine);
  const onlyE = [], onlyM = [], diffs = [], infoEx = [], roundEx = [];
  let same = 0, roundOnly = 0, zoneOff = 0, infoOff = 0, lastT = null;
  const seenAt = (t) => { if (lastT === null || t > lastT) lastT = t; };
  const label = (e) => `${iso(e.t)} ${arrow(e.dir)} ${fmt(e.lo)}–${fmt(e.hi)}`;
  for (const [k, es] of E) {
    const ms = M.get(k) || [];
    for (let j = 0; j < es.length; j += 1) {
      const e = es[j], m = ms[j];
      if (!m) { onlyE.push(e); seenAt(e.t); continue; }
      const d = [];
      if (e.known !== m.known) d.push(`se sabe ${iso(e.known)} vs ${iso(m.known)}`);
      if (!(close(e.lo, m.lo) && close(e.hi, m.hi))) d.push(`zona ${fmt(e.lo)}–${fmt(e.hi)} vs ${fmt(m.lo)}–${fmt(m.hi)}`);
      const { real, round } = infoDiff(e.info, m.info, rounded);
      if (d.length) { zoneOff += 1; seenAt(e.t); diffs.push(`${iso(e.t)} ${arrow(e.dir)} ${[...d, ...real].join('; ')}`); }
      else if (real.length) { infoOff += 1; infoEx.push(`${iso(e.t)} ${arrow(e.dir)} ${real.join('; ')}`); }
      else {
        same += 1;
        if (round.length) { roundOnly += 1; roundEx.push(`${iso(e.t)} ${arrow(e.dir)} ${round.join('; ')}`); }
      }
    }
  }
  for (const [k, ms] of M) {
    const es = E.get(k) || [];
    for (let j = es.length; j < ms.length; j += 1) { onlyM.push(ms[j]); seenAt(ms[j].t); }
  }
  const byT = (p, q) => p.t - q.t || q.dir - p.dir;
  onlyE.sort(byT); onlyM.sort(byT);
  const row = {
    pieza: name, motor: engine.length, js: mine.length, iguales: same, de_ellos_con_info_redondeada: roundOnly,
    solo_motor: onlyE.length, solo_js: onlyM.length, con_otra_zona: zoneOff, con_otra_info: infoOff,
    // La última vela con un evento de más, de menos o con otra zona (la info distinta no cuenta)
    ultima_diferencia: lastT === null ? null : iso(lastT),
    ej_solo_motor: onlyE.slice(0, MAX_EJ).map(label), ej_solo_js: onlyM.slice(0, MAX_EJ).map(label),
    ej_otra_zona: diffs.slice(0, MAX_EJ), ej_otra_info: infoEx.slice(0, MAX_EJ), ej_redondeo: roundEx.slice(0, MAX_EJ)
  };
  if (!quiet) {
    console.log(`${name}: motor ${row.motor}, js ${row.js}, iguales ${row.iguales} (${roundOnly} con la info redondeada), solo motor ${row.solo_motor}, solo js ${row.solo_js}, con otra zona ${zoneOff}, con otra info ${infoOff}`);
    for (const x of row.ej_solo_motor.slice(0, 3)) console.log('   solo motor', x);
    for (const x of row.ej_solo_js.slice(0, 3)) console.log('   solo js   ', x);
    for (const x of row.ej_otra_zona.slice(0, 3)) console.log('   otra zona ', x);
    for (const x of row.ej_otra_info.slice(0, 3)) console.log('   otra info ', x);
  }
  return row;
}

// ---------------------------------------------------------------- VPA
const VPA_CODES = ['QA', 'QF', 'QR', 'QT', 'QS', 'QC', 'QE'];
const vpaParams = (rule) => ({ ...defaultVpaParams(), ...(rule.vpa || {}) });
const vpaBars = (cands) => cands.map(k => ({ t: k.timestamp, o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume }));

/** Los elementos del lector en la forma de los del motor */
function vpaEventsJs(reader, code) {
  return reader.events.filter(e => e.code === code)
    .map(e => ({ dir: e.dir, t: e.t, known: e.t + tfMs, lo: e.lo, hi: e.hi, info: { ...e.info, grade: e.grade } }));
}

out.vpa = {};
const readers = new Map();
const readerFor = (rule, cands = candles, tag = 'fase') => {
  const params = vpaParams(rule);
  const key = `${tag}|${JSON.stringify(params)}`;
  if (!readers.has(key)) readers.set(key, computeVpa(vpaBars(cands), tf, params));
  return readers.get(key);
};
for (const code of VPA_CODES) {
  const rule = dump.rules[code];
  out.vpa[code] = compare(`${code} (VPA)`, dump.events[code], vpaEventsJs(readerFor(rule), code), { rounded: true });
  out.vpa[code].params = vpaParams(rule);
}

// ---------------------------------------------------------------- SMC
const SMC_CODES = ['BS', 'OB', 'BK', 'EQ'];

/** BS, OB, BK y EQ de computeSmc, con la definición de la documentación */
function smcEventsJs(cands, rule) {
  const sm = rule.smc || {};
  const cfg = ruleSmcConfig(rule, defaultSmcConfig());
  const bars = barsOf(cands);
  const r = computeSmc(bars, cfg);
  const t = (i) => bars.t[i];
  const scope = sm.scope || 'swing', brk = sm.break || 'any', reclaim = sm.reclaim !== false;
  const ev = { BS: [], OB: [], BK: [], EQ: [] };
  for (const b of r.breaks) {
    if (b.scope !== scope) continue;
    if ((brk === 'bos' && b.tag !== 'BOS') || (brk === 'choch' && b.tag !== 'CHoCH')) continue;
    const c = bars.c[b.index];
    ev.BS.push({ dir: b.dir, t: t(b.index), known: t(b.known) + tfMs, lo: Math.min(b.price, c), hi: Math.max(b.price, c),
      info: { tag: b.tag, scope: b.scope, level: b.price, pivot: t(b.pivot) } });
  }
  for (const o of r.obs) {
    if (o.scope !== scope) continue;
    const info = { scope: o.scope, candle: t(o.index), top: o.top, bottom: o.bottom };
    ev.OB.push({ dir: o.dir, t: t(o.created), known: t(o.known) + tfMs, lo: o.bottom, hi: o.top, info });
    if (o.broken !== null) ev.BK.push({ dir: -o.dir, t: t(o.broken), known: t(o.broken) + tfMs, lo: o.bottom, hi: o.top, info });
  }
  for (const e of r.equals) {
    if (e.swept === null || (reclaim && !e.reclaimed)) continue;
    const u = e.swept;
    const extreme = e.dir > 0 ? bars.h[u] : bars.l[u];
    ev.EQ.push({ dir: -e.dir, t: t(u), known: t(u) + tfMs, lo: Math.min(e.level, extreme), hi: Math.max(e.level, extreme),
      info: { level: e.level, first: t(e.first), second: t(e.index), reclaimed: e.reclaimed } });
  }
  return { ev, r, cfg, bars };
}

out.smc = {};
for (const code of SMC_CODES) {
  const rule = dump.rules[code];
  const { ev, cfg } = smcEventsJs(candles, rule);
  out.smc[code] = compare(`${code} (SMC)`, dump.events[code], ev[code]);
  out.smc[code].config = { internal: cfg.internal.length, swing: cfg.swing.length, ob: { pick: cfg.ob.pick, area: cfg.ob.area, mitigation: cfg.ob.mitigation, breakers: cfg.ob.breakers }, equal: { length: cfg.equal.length, threshold: cfg.equal.threshold }, regla: rule.smc };
}
// Con entrada a mercado, el OB y la ruptura caen en las mismas velas y del mismo lado: cada ruptura de la estructura
// elegida deja su OB. Solo cambia la zona (que a mercado y con stop en ATR no se usa)
{
  const bs = new Set(dump.events.BS.map(e => `${e.dir}|${e.t}`));
  const ob = dump.events.OB.map(e => `${e.dir}|${e.t}`);
  out.smc.OB_igual_a_BS = { ob: ob.length, bs: bs.size, en_la_misma_vela_y_lado: ob.filter(k => bs.has(k)).length };
  console.log(`OB contra BS (motor): ${out.smc.OB_igual_a_BS.en_la_misma_vela_y_lado} de ${ob.length} OB en la vela y el lado de una ruptura (${bs.size} rupturas)`);
}

// ---------------------------------------------------------------- filtros
const baseSignals = dump.filters.FV.signals.map(s => `${s.k}|${s.dir}`).join(',');

function smcPass(smcf, r, closes, k, side) {
  if (smcf.pd) {
    const top = r.top[k], bottom = r.bottom[k];
    if (!(Number.isFinite(top) && Number.isFinite(bottom) && top > bottom)) return false;
    if ((closes[k] - (top + bottom) / 2) * side >= 0) return false;
  }
  if (smcf.bias && r.bias[k] !== side) return false;
  return true;
}

function vpaPass(vpaf, reader, k, side, needRv = true) {
  const meter = reader.s.meter[k], rv = reader.s.rv[k];
  if (!Number.isFinite(meter) || (needRv && !Number.isFinite(rv))) return false;
  return vpaf.mode === 'favor' ? meter * side >= vpaf.thr : meter * side > -vpaf.thr;
}

/** Cuántas señales deja pasar cada lado y en cuáles difieren */
function filterRow(name, signals, reason, jsPass, extra = {}) {
  let same = 0, engPass = 0, jsPassN = 0;
  const onlyE = [], onlyM = [];
  for (const s of signals) {
    const eng = s.what !== reason;
    const mine = jsPass(s);
    if (eng) engPass += 1;
    if (mine) jsPassN += 1;
    if (eng === mine) same += 1;
    else (eng ? onlyE : onlyM).push(s);
  }
  const lastT = Math.max(-Infinity, ...onlyE.map(s => s.t), ...onlyM.map(s => s.t));
  return { filtro: name, senales: signals.length, iguales: same, pasan_motor: engPass, pasan_js: jsPassN,
    pasa_solo_en_el_motor: onlyE.length, pasa_solo_en_el_js: onlyM.length,
    ultima_diferencia: Number.isFinite(lastT) ? iso(lastT) : null, ...extra,
    ej_solo_motor: onlyE.slice(0, MAX_EJ), ej_solo_js: onlyM.slice(0, MAX_EJ) };
}

out.filtros = {};
for (const name of ['FL-PD', 'FL-BIAS', 'FL-VPAf', 'FL-VPAn']) {
  const f = dump.filters[name];
  const rule = f.rule;
  const sameSignals = f.signals.map(s => `${s.k}|${s.dir}`).join(',') === baseSignals;
  let row;
  if (rule.smcf) {
    const r = computeSmc(barsOf(candles), ruleSmcConfig(rule, defaultSmcConfig()));
    let valuesOff = 0;
    const valueEx = [];
    for (const s of f.signals) {
      const e = s.eng || {};
      const ok = sameValue(e.top, r.top[s.k]) && sameValue(e.bottom, r.bottom[s.k]) && e.bias === r.bias[s.k];
      if (!ok) { valuesOff += 1; if (valueEx.length < MAX_EJ) valueEx.push(`${iso(s.t)} ${arrow(s.dir)} motor ${fmt(num(e.top))}/${fmt(num(e.bottom))}/${e.bias} vs js ${fmt(r.top[s.k])}/${fmt(r.bottom[s.k])}/${r.bias[s.k]}`); }
    }
    row = filterRow(name, f.signals, 'filtro SMC', (s) => smcPass(rule.smcf, r, C, s.k, s.dir),
      { mismas_senales_que_sin_filtro: sameSignals, valores_distintos: valuesOff, ej_valores: valueEx, regla: rule.smcf });
    const fmtS = (s) => { const top = r.top[s.k], bottom = r.bottom[s.k]; return `${iso(s.t)} ${arrow(s.dir)} cierre ${fmt(C[s.k])}, rango ${fmt(bottom)}–${fmt(top)} (mitad ${fmt((top + bottom) / 2)}), tendencia ${r.bias[s.k]}`; };
    row.ej_solo_motor = row.ej_solo_motor.map(fmtS);
    row.ej_solo_js = row.ej_solo_js.map(fmtS);
  } else {
    const reader = readerFor(rule);
    let valuesOff = 0;
    const valueEx = [];
    for (const s of f.signals) {
      const e = s.eng || {};
      const rv = reader.s.rv[s.k];
      const ok = sameValue(e.meter, reader.s.meter[s.k]) && sameValue(e.rv, rv);
      if (!ok) { valuesOff += 1; if (valueEx.length < MAX_EJ) valueEx.push(`${iso(s.t)} ${arrow(s.dir)} medidor ${e.meter} vs ${reader.s.meter[s.k]}, vol. relativo ${e.rv} vs ${rv}`); }
    }
    // Sin pedir volumen relativo en la vela: lo que cambia es la regla de la documentación de vpa.py (los primeros días no pasan)
    const noRv = f.signals.filter(s => vpaPass(rule.vpaf, reader, s.k, s.dir, false) !== vpaPass(rule.vpaf, reader, s.k, s.dir, true)).length;
    row = filterRow(name, f.signals, 'filtro VPA', (s) => vpaPass(rule.vpaf, reader, s.k, s.dir),
      { mismas_senales_que_sin_filtro: sameSignals, valores_distintos: valuesOff, ej_valores: valueEx, regla: rule.vpaf,
        cambian_sin_pedir_volumen_relativo: noRv });
    const fmtS = (s) => `${iso(s.t)} ${arrow(s.dir)} medidor ${fmt(reader.s.meter[s.k])}, vol. relativo ${fmt(reader.s.rv[s.k])}`;
    row.ej_solo_motor = row.ej_solo_motor.map(fmtS);
    row.ej_solo_js = row.ej_solo_js.map(fmtS);
  }
  out.filtros[name] = row;
  console.log(`${name}: ${row.iguales} de ${row.senales} señales iguales (pasan ${row.pasan_motor} en el motor y ${row.pasan_js} en el js; solo motor ${row.pasa_solo_en_el_motor}, solo js ${row.pasa_solo_en_el_js}); valores distintos ${row.valores_distintos}; mismas señales que sin filtro: ${row.mismas_senales_que_sin_filtro ? 'sí' : 'NO'}`);
  for (const x of row.ej_solo_motor.slice(0, 3)) console.log('   solo motor', x);
  for (const x of row.ej_solo_js.slice(0, 3)) console.log('   solo js   ', x);
}

// ---------------------------------------------------------------- lo que mostraría el gráfico
// Sus indicadores corren desde la primera vela del gráfico (VPAIndicator y, en la ventana, SMCIndicator), que puede ser
// anterior a la fase, y en las monedas de siempre sus velas son las del caché de App 1 (O-09). Se separan dos efectos:
// "arranque" (las velas del gráfico anteriores a la fase y, desde su inicio, las del motor) y "velas" (todas del gráfico)
if (dump.chart?.bars?.length) {
  const chartAll = toCandles(dump.chart.bars);
  const start = dump.fase_desde, end = dump.fase_hasta;
  const pre = chartAll.filter(k => k.timestamp < start);
  const inPhase = chartAll.filter(k => k.timestamp >= start && k.timestamp < end);
  // Las velas de la fase del gráfico contra las del motor
  const engineAt = new Map(candles.map((k, i) => [k.timestamp, i]));
  let volDiff = 0, priceDiff = 0, missing = 0;
  for (const k of inPhase) {
    const i = engineAt.get(k.timestamp);
    if (i === undefined) { missing += 1; continue; }
    const e = candles[i];
    if (!close(e.volume, k.volume, 1e-6)) volDiff += 1;
    if (!(close(e.open, k.open) && close(e.high, k.high) && close(e.low, k.low) && close(e.close, k.close))) priceDiff += 1;
  }
  const chartTimes = new Set(inPhase.map(k => k.timestamp));
  out.grafico = {
    fuente: dump.chart.source, primera_vela: iso(chartAll[0].timestamp), velas_antes_de_la_fase: pre.length,
    velas_de_la_fase: inPhase.length, faltan_en_el_grafico: candles.filter(k => !chartTimes.has(k.timestamp)).length,
    faltan_en_el_motor: missing, con_otro_volumen: volDiff, con_otro_precio: priceDiff, vpa: {}, smc: {}, filtros: {}
  };
  console.log(`\nGráfico: ${dump.chart.source}, desde ${iso(chartAll[0].timestamp)} (${pre.length} velas antes de la fase); en la fase ${inPhase.length} velas, ${volDiff} con otro volumen y ${priceDiff} con otro precio que las del motor`);
  const sets = { arranque: [...pre, ...candles], velas: [...pre, ...inPhase] };
  const inside = (e) => e.t >= start && e.t < end;
  for (const [tag, cands] of Object.entries(sets)) {
    if (tag === 'arranque' && !pre.length) continue; // Sin velas antes de la fase es lo mismo que en las mismas velas
    const tIndex = new Map(cands.map((k, i) => [k.timestamp, i]));
    const closes = cands.map(k => k.close);
    out.grafico.vpa[tag] = {}; out.grafico.smc[tag] = {}; out.grafico.filtros[tag] = {};
    for (const code of VPA_CODES) {
      const reader = readerFor(dump.rules[code], cands, tag);
      out.grafico.vpa[tag][code] = compare(`gráfico (${tag}) ${code}`, dump.events[code], vpaEventsJs(reader, code).filter(inside), { rounded: true, quiet: true });
    }
    for (const code of SMC_CODES) {
      const { ev } = smcEventsJs(cands, dump.rules[code]);
      out.grafico.smc[tag][code] = compare(`gráfico (${tag}) ${code}`, dump.events[code], ev[code].filter(inside), { quiet: true });
    }
    for (const name of ['FL-PD', 'FL-BIAS', 'FL-VPAf', 'FL-VPAn']) {
      const f = dump.filters[name];
      const rule = f.rule;
      let pass;
      if (rule.smcf) {
        const r = computeSmc(barsOf(cands), ruleSmcConfig(rule, defaultSmcConfig()));
        pass = (s) => { const k = tIndex.get(s.t); return k !== undefined && smcPass(rule.smcf, r, closes, k, s.dir); };
      } else {
        const reader = readerFor(rule, cands, tag);
        pass = (s) => { const k = tIndex.get(s.t); return k !== undefined && vpaPass(rule.vpaf, reader, k, s.dir); };
      }
      const row = filterRow(name, f.signals, rule.smcf ? 'filtro SMC' : 'filtro VPA', pass);
      row.ej_solo_motor = row.ej_solo_motor.map(s => `${iso(s.t)} ${arrow(s.dir)}`);
      row.ej_solo_js = row.ej_solo_js.map(s => `${iso(s.t)} ${arrow(s.dir)}`);
      out.grafico.filtros[tag][name] = row;
    }
    // iguales/motor (solo en el motor, solo en el js, otra zona, otra info)
    const line = (rows) => Object.entries(rows).map(([code, r]) => `${code} ${r.iguales}/${r.motor}` + (r.solo_motor || r.solo_js || r.con_otra_zona || r.con_otra_info ? ` (−${r.solo_motor} +${r.solo_js} zona ${r.con_otra_zona} info ${r.con_otra_info})` : '')).join(' · ');
    console.log(`  ${tag}: VPA ${line(out.grafico.vpa[tag])}`);
    console.log(`  ${tag}: SMC ${line(out.grafico.smc[tag])}`);
    console.log(`  ${tag}: filtros ` + Object.entries(out.grafico.filtros[tag]).map(([k, r]) => `${k} ${r.iguales}/${r.senales}`).join(' · '));
    // Hasta cuándo dura la diferencia: la última vela de la fase con un evento de más, de menos o con otra zona
    const last = [];
    for (const rows of [out.grafico.vpa[tag], out.grafico.smc[tag]]) {
      for (const [code, r] of Object.entries(rows)) if (r.ultima_diferencia) last.push(`${code}: ${r.ultima_diferencia}`);
    }
    for (const [name, r] of Object.entries(out.grafico.filtros[tag])) if (r.ultima_diferencia) last.push(`${name}: ${r.ultima_diferencia}`);
    out.grafico[`ultima_diferencia_${tag}`] = last;
    console.log(`  ${tag}: última diferencia ${last.join(' · ') || '—'}`);
  }
}

// ---------------------------------------------------------------- la ventana de SMCIndicator
// Con las mismas velas: al elegir un trade, la vista va de 150 velas antes de la señal a 60 después de la salida, y el
// indicador calcula desde floor((primera visible − 1500) / 200) × 200. Basta mirar las velas hasta la de la señal: lo
// posterior no cambia lo que ya se supo
{
  const WARM = 1500, BLOCK = 200, BEFORE = 150;
  const windowStart = (i) => Math.max(0, Math.floor((i - BEFORE - WARM) / BLOCK) * BLOCK);
  const cache = new Map();
  const windowResult = (rule, s) => {
    const key = `${JSON.stringify(rule.smc || {})}|${JSON.stringify(rule.smcf || {})}|${s}`;
    if (!cache.has(key)) cache.set(key, smcEventsJs(candles.slice(s), rule));
    return cache.get(key);
  };
  out.ventana_smc = { velas_antes: WARM, bloque: BLOCK, antes_de_la_senal: BEFORE, eventos: {}, filtros: {} };
  const index = new Map(T.map((t, i) => [t, i]));
  // Lo que el gráfico muestra en cada vela i es lo que calcula la ventana que empieza en windowStart(i): se arma la
  // lista de eventos de cada vela con su ventana y se compara con la del motor
  const starts = [...new Set(T.map((_, i) => windowStart(i)))];
  for (const code of SMC_CODES) {
    const rule = dump.rules[code];
    const seen = [];
    for (const s of starts) {
      const { ev } = windowResult(rule, s);
      for (const m of ev[code]) if (windowStart(index.get(m.t)) === s) seen.push(m);
    }
    const row = compare(`ventana SMC ${code}`, dump.events[code], seen);
    const fromStart = dump.events[code].filter(e => windowStart(index.get(e.t)) === 0).length;
    // Por qué no los ve: de cuándo es lo que usa el evento (la vela del OB, los dos iguales, el pivote roto) y desde dónde calcula la ventana
    const has = new Set(seen.map(m => `${m.dir}|${m.t}|${m.lo}|${m.hi}`));
    const why = dump.events[code].filter(e => !has.has(`${e.dir}|${e.t}|${e.lo}|${e.hi}`)).map(e => {
      const from = e.info.candle ?? e.info.first ?? e.info.pivot;
      return `${iso(e.t)} ${arrow(e.dir)}: usa ${code === 'EQ' ? `iguales del ${iso(e.info.first)} y ${iso(e.info.second)}` : code === 'BS' ? `el pivote del ${iso(e.info.pivot)}` : `el OB del ${iso(e.info.candle)}`}`
        + ` (${((e.t - from) / 86400000).toFixed(0)} días antes); la ventana del gráfico empieza el ${iso(T[windowStart(index.get(e.t))])}`;
    });
    out.ventana_smc.eventos[code] = { ...row, eventos_con_la_ventana_desde_la_primera_vela: fromStart, por_que: why.slice(0, MAX_EJ) };
    for (const x of why.slice(0, 3)) console.log('   ', x);
  }
  for (const name of ['FL-PD', 'FL-BIAS']) {
    const f = dump.filters[name];
    const rule = f.rule;
    let same = 0;
    const off = [];
    for (const s of f.signals) {
      const st = windowStart(s.k);
      const { r } = windowResult(rule, st);
      const k = s.k - st;
      const mine = smcPass(rule.smcf, r, C.slice(st), k, s.dir);
      const eng = s.what !== 'filtro SMC';
      if (mine === eng) same += 1;
      else off.push(`${iso(s.t)} ${arrow(s.dir)} motor ${eng ? 'pasa' : 'no pasa'}, gráfico ${mine ? 'pasa' : 'no pasa'} (rango ${fmt(r.bottom[k])}–${fmt(r.top[k])}, tendencia ${r.bias[k]}; motor ${fmt(num(s.eng?.bottom))}–${fmt(num(s.eng?.top))}, ${s.eng?.bias})`);
    }
    out.ventana_smc.filtros[name] = { senales: f.signals.length, iguales: same, distintas: off.length, ej: off.slice(0, MAX_EJ) };
    console.log(`ventana SMC ${name}: ${same} de ${f.signals.length} señales iguales`);
    for (const x of off.slice(0, 3)) console.log('  ', x);
  }
}

if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
