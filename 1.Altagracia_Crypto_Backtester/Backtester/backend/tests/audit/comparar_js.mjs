// Protocolo (22/11/2026), etapa 4: las piezas de nivel B y C de prioridad 1 contra sus indicadores en JavaScript, que
// tienen sus propias pruebas de paridad con Python (regimeDetectors.js, responseBalance.js, vpa.js y williams.js).
// Lee el volcado del motor (volcar_eventos.py) y, con las mismas velas:
//   - sabios WD, WA y WF: los de computeWilliams con los ajustes de la regla (nivel C), evento por evento;
//   - cajas: las de erBox con los valores afinados; CP en la vela en que se detecta cada caja, BX en la vela que la
//     termina (lado por el cierre contra el centro) y BE en las velas que llegan al borde de una caja ya detectada, con
//     las condiciones de la hoja "Elementos" y "Opciones" (nivel B: condiciones necesarias);
//   - rombo RB: la señal de ResponseSeries (nivel C);
//   - ruptura con volumen QB: el evento QB de VpaReader (nivel C);
//   - filtro de régimen: el estado de las cajas y del rango mayor en la vela de la señal, en 4h y en 1D (nivel C),
//     con las variantes que la documentación deja abiertas.
// Uso: node tests/audit/comparar_js.mjs <volcado.json> [salida.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ind = (f) => pathToFileURL(path.resolve(here, '../../../frontend/src/components/indicators', f)).href;
const rd = await import(ind('regimeDetectors.js'));
const { ResponseSeries, defaultResponseConfig } = await import(ind('responseBalance.js'));
const { computeVpa, defaultVpaParams } = await import(ind('vpa.js'));
const { barsOf, computeWilliams, defaultWilliamsConfig } = await import(ind('williams.js'));

const [, , dumpPath, outPath] = process.argv;
const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
const tf = dump.tf, tfMs = tf * 60000;
const candles = dump.bars.map(([t, o, h, l, c, v]) => ({ timestamp: t, open: o, high: h, low: l, close: c, volume: v }));
const A = rd.toArrays(candles);
const n = A.c.length;
const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const close = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const out = { moneda: dump.moneda, tf, fase: dump.fase, velas: n };

function compare(name, engine, mine, extra = (e, m) => null) {
  const key = (e) => `${e.dir}|${e.t}`;
  const E = new Map(engine.map(e => [key(e), e])), M = new Map(mine.map(e => [key(e), e]));
  const onlyE = [...E.keys()].filter(k => !M.has(k)).sort((a, b) => +a.split('|')[1] - +b.split('|')[1]);
  const onlyM = [...M.keys()].filter(k => !E.has(k)).sort((a, b) => +a.split('|')[1] - +b.split('|')[1]);
  const diffs = [];
  for (const [k, e] of E) {
    if (!M.has(k)) continue;
    const m = M.get(k);
    const d = [];
    if (e.known !== undefined && m.known !== undefined && e.known !== m.known) d.push(`conocido ${iso(e.known)} vs ${iso(m.known)}`);
    if (m.lo !== undefined && !(close(e.lo, m.lo) && close(e.hi, m.hi))) d.push(`zona ${e.lo}–${e.hi} vs ${m.lo}–${m.hi}`);
    const x = extra(e, m);
    if (x) d.push(x);
    if (d.length) diffs.push(`${iso(e.t)} ${e.dir > 0 ? '↑' : '↓'} ${d.join('; ')}`);
  }
  const fmt = (map) => (k) => { const e = map.get(k); return `${iso(e.t)} ${e.dir > 0 ? '↑' : '↓'}` + (e.lo !== undefined ? ` ${(+e.lo).toPrecision(7)}–${(+e.hi).toPrecision(7)}` : ''); };
  const row = { pieza: name, motor: engine.length, js: mine.length, iguales: engine.length - onlyE.length, solo_motor: onlyE.length, solo_js: onlyM.length, distintos: diffs.length,
    ej_solo_motor: onlyE.slice(0, 8).map(fmt(E)), ej_solo_js: onlyM.slice(0, 8).map(fmt(M)), ej_distintos: diffs.slice(0, 8) };
  console.log(`${name}: motor ${row.motor}, js ${row.js}, iguales ${row.iguales}, solo motor ${row.solo_motor}, solo js ${row.solo_js}, con diferencias ${row.distintos}`);
  for (const x of row.ej_solo_motor.slice(0, 3)) console.log('   solo motor', x);
  for (const x of row.ej_solo_js.slice(0, 3)) console.log('   solo js   ', x);
  for (const x of row.ej_distintos.slice(0, 3)) console.log('   distinto  ', x);
  return row;
}

// ---------------------------------------------------------------- sabios
{
  const rule = dump.rules.W;
  const w = rule.wise || {};
  const cfg = defaultWilliamsConfig();
  cfg.wise = { ...cfg.wise, lookback: w.lookback ?? 1, angBars: w.angBars ?? 5, minGapAtr: w.minGapAtr ?? 0, requireAo: w.requireAo ?? true, alligatorFilter: w.teeth ?? true };
  const res = computeWilliams(barsOf(candles), cfg);
  const code = { 1: 'WD', 2: 'WA', 3: 'WF' };
  const rows = [];
  for (const wise of [1, 2, 3]) {
    const mine = res.signals.filter(s => s.wise === wise).map(s => ({ dir: s.dir, t: A.t[s.index], known: A.t[s.known] + tfMs, entry: s.entry, stop: s.stop, fractal: s.fractal != null ? A.t[s.fractal] : null }));
    const eng = dump.events.W.filter(e => e.code === code[wise]);
    rows.push(compare(`${code[wise]} (sabio ${wise})`, eng, mine, (e, m) => {
      const d = [];
      if (wise < 3) {
        if (!close(e.info.entry, m.entry)) d.push(`entrada ${e.info.entry} vs ${m.entry}`);
        if (!close(e.info.stop, m.stop)) d.push(`stop ${e.info.stop} vs ${m.stop}`);
      } else {
        if (!close(e.info.level, m.entry)) d.push(`nivel ${e.info.level} vs ${m.entry}`);
        if (e.info.fractal !== m.fractal) d.push(`fractal ${iso(e.info.fractal)} vs ${m.fractal ? iso(m.fractal) : '—'}`);
      }
      return d.join('; ') || null;
    }));
  }
  out.sabios = { ajustes: cfg.wise, filas: rows };
}

// ---------------------------------------------------------------- cajas
const P = rd.PARAMS.er_box.params;
const boxes = rd.erBox(A, P).zones;
const atrW = rd.atrWilder(A.h, A.l, A.c);
out.cajas = { valores: P, cajas: boxes.length };
{
  // CP: la vela en que se detecta cada caja, hacia los dos lados
  const cp = [];
  for (const z of boxes) for (const dir of [1, -1]) cp.push({ dir, t: A.t[z.detected], known: A.t[z.detected] + tfMs, lo: z.low, hi: z.high, start: A.t[z.start] });
  out.cajas.CP = compare('CP (compresión)', dump.events.CP, cp, (e, m) => (e.info.start !== m.start ? `inicio ${iso(e.info.start)} vs ${iso(m.start)}` : null));
  // BX: la vela que termina la caja (la primera fuera, end + 1); lado por el cierre contra el centro
  const bx = [], bxInfo = [];
  for (const z of boxes) {
    const b = z.end + 1;
    if (b >= n) continue;
    const mid = (z.low + z.high) / 2;
    const dir = A.c[b] > mid ? 1 : A.c[b] < mid ? -1 : 0;
    if (!dir) continue;
    bx.push({ dir, t: A.t[b], known: A.t[b] + tfMs, lo: z.low, hi: z.high, start: A.t[z.start], heightAtr: (z.high - z.low) / atrW[b] });
  }
  out.cajas.BX = compare('BX (ruptura, sin tope)', dump.events.BX, bx, (e, m) => {
    const d = [];
    if (e.info.start !== m.start) d.push(`inicio ${iso(e.info.start)} vs ${iso(m.start)}`);
    if (Math.abs(e.info.heightAtr - m.heightAtr) > 0.006) d.push(`alto ${e.info.heightAtr} vs ${m.heightAtr.toFixed(3)} ATR de Wilder`);
    return d.join('; ') || null;
  });
  const cap = dump.rules['BX-5.5'].bx?.maxHeight ?? 5.5;
  out.cajas['BX-5.5'] = compare(`BX (ruptura, tope ${cap} ATR)`, dump.events['BX-5.5'], bx.filter(x => x.heightAtr <= cap));
  // BE: velas que llegan al borde de una caja ya detectada, hacia el centro
  const be = dump.rules.BE.be || {};
  const share = be.share ?? 0.2, maxBody = be.maxBody ?? 1, rej = be.rejection ?? 0.6;
  const variants = {
    'despues de detectada, hasta su ultima vela': (z) => [z.detected + 1, z.end],
    'desde la vela en que se detecta': (z) => [z.detected, z.end],
    'incluye la vela que la termina': (z) => [z.detected + 1, Math.min(n - 1, z.end + 1)],
  };
  out.cajas.BE = {};
  for (const [vname, span] of Object.entries(variants)) {
    const mine = [];
    for (const z of boxes) {
      const H = z.high - z.low;
      const [i0, i1] = span(z);
      for (let i = i0; i <= i1; i++) {
        const range = A.h[i] - A.l[i];
        if (!(range > 0)) continue;
        const bodyOk = maxBody <= 0 || Math.abs(A.c[i] - A.o[i]) <= maxBody * atrW[i];
        if (!bodyOk) continue;
        if (A.l[i] <= z.low + share * H && (A.c[i] - A.l[i]) / range >= rej) mine.push({ dir: 1, t: A.t[i], known: A.t[i] + tfMs, lo: z.low, hi: z.low + share * H, closeAt: (A.c[i] - A.l[i]) / range });
        if (A.h[i] >= z.high - share * H && (A.h[i] - A.c[i]) / range >= rej) mine.push({ dir: -1, t: A.t[i], known: A.t[i] + tfMs, lo: z.high - share * H, hi: z.high, closeAt: (A.h[i] - A.c[i]) / range });
      }
    }
    out.cajas.BE[vname] = compare(`BE (borde, ${vname})`, dump.events.BE, mine, (e, m) => (Math.abs(e.info.closeAt - m.closeAt) > 0.006 ? `cierre ${e.info.closeAt} vs ${m.closeAt.toFixed(3)}` : null));
  }
  // Lo que dice el docstring de box_elements.py y no la documentación del usuario: un evento por llegada (la primera
  // vela que toca el borde gasta la llegada aunque no pase los filtros) y se rearma cuando el cierre vuelve al tercio
  // del centro de la caja. Se mira después de la comparación a ciegas, para nombrar la diferencia (E-08).
  {
    const mine = [];
    for (const z of boxes) {
      const H = z.high - z.low;
      if (!(H > 0)) continue;
      const mid = (z.low + z.high) / 2;
      const armed = { 1: true, '-1': true };
      for (let i = z.detected + 1; i <= Math.min(z.end, n - 1); i++) {
        if (Math.abs(A.c[i] - mid) < H / 6) { armed[1] = true; armed[-1] = true; }
        for (const [dir, hit] of [[1, A.l[i] <= z.low + share * H], [-1, A.h[i] >= z.high - share * H]]) {
          if (!hit || !armed[dir]) continue;
          armed[dir] = false;
          const range = Math.max(A.h[i] - A.l[i], 1e-12);
          const loc = dir > 0 ? (A.c[i] - A.l[i]) / range : (A.h[i] - A.c[i]) / range;
          if (maxBody > 0 && Math.abs(A.c[i] - A.o[i]) > maxBody * atrW[i]) continue;
          if (loc < rej) continue;
          mine.push({ dir, t: A.t[i], known: A.t[i] + tfMs, lo: dir > 0 ? z.low : z.high - share * H, hi: dir > 0 ? z.low + share * H : z.high, closeAt: loc });
        }
      }
    }
    out.cajas.BE['por llegada, se rearma en el tercio del centro'] = compare('BE (borde, por llegada, se rearma en el tercio del centro)', dump.events.BE, mine);
  }
}

// ---------------------------------------------------------------- rombo
{
  out.rombo = {};
  for (const name of ['RB', 'RB-sigue']) {
    const rule = dump.rules[name];
    const rv = rule.rv || {};
    const cfg = { ...defaultResponseConfig(), legAtr: rv.leg ?? 2 };
    const s = new ResponseSeries(cfg);
    s.update(candles);
    const follow = (rv.rombo || 'turn') === 'follow';
    const mine = [];
    for (let i = 0; i < n; i++) {
      if (!s.signal[i]) continue;
      const leg = s.direction[i];
      mine.push({ dir: follow ? leg : -leg, t: A.t[i], known: A.t[i] + tfMs });
    }
    out.rombo[name] = compare(`${name} (rombo, ${follow ? 'sigue' : 'giro'})`, dump.events[name], mine);
  }
}

// ---------------------------------------------------------------- ruptura con volumen
{
  const rule = dump.rules.QB;
  const params = { ...defaultVpaParams(), ...(rule.vpa || {}) };
  const reader = computeVpa(candles.map(c => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume })), tf, params);
  const mine = reader.events.filter(e => e.code === 'QB').map(e => ({ dir: e.dir, t: e.t, known: e.t + tfMs, lo: e.lo, hi: e.hi, info: e.info, grade: e.grade }));
  out.QB = compare('QB (ruptura con volumen)', dump.events.QB, mine, (e, m) => {
    const d = [];
    if (!close(e.info.level, m.info.level)) d.push(`nivel ${e.info.level} vs ${m.info.level}`);
    if (Math.abs(e.info.rv - m.info.rv) > 1e-3) d.push(`rv ${e.info.rv} vs ${m.info.rv}`);
    return d.join('; ') || null;
  });
  out.QB.params = params;
}

// ---------------------------------------------------------------- régimen
{
  const sig = dump.regime['sin filtro'].signals;
  // Estado por vela en un marco: cajas (sin rango mayor) o rango mayor; y la vela que termina cada rango
  const states = (a, major, majorOut) => {
    const zs = rd.erBox(a, P).zones;
    const zones = major ? rd.major(a, rd.partsFromZones(zs, a.t), { max_atr: 8.0, buffer: 0.5, closes_out: majorOut }).zones : zs;
    const st = new Int8Array(a.c.length);
    const ends = [];
    for (const z of zones) {
      for (let i = z.detected; i <= z.end; i++) st[i] = 1;
      if (z.end + 1 < a.c.length) ends.push(z.end + 1);
    }
    return { st, ends: ends.sort((x, y) => x - y), zones };
  };
  // Velas diarias UTC armadas con las de 4h (completas: 6 por día)
  const daily = (() => {
    const by = new Map();
    for (let i = 0; i < n; i++) {
      const d = Math.floor(A.t[i] / 86400000) * 86400000;
      if (!by.has(d)) by.set(d, []);
      by.get(d).push(i);
    }
    const rows = [];
    for (const [d, idx] of [...by.entries()].sort((x, y) => x[0] - y[0])) {
      if (tf === 240 && idx.length !== 6) continue;
      rows.push({ timestamp: d, open: A.o[idx[0]], high: Math.max(...idx.map(i => A.h[i])), low: Math.min(...idx.map(i => A.l[i])), close: A.c[idx[idx.length - 1]], volume: idx.reduce((s, i) => s + A.v[i], 0) });
    }
    return rd.toArrays(rows);
  })();
  const dayIndex = (ms) => { let lo = 0, hi = daily.t.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (daily.t[mid] <= ms) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k; };
  out.regimen = {};
  for (const [name, v] of Object.entries(dump.regime)) {
    if (name === 'sin filtro') continue;
    const reg = v.rule.regime || {};
    const engine = new Map(v.signals.map(s => [`${s.k}|${s.dir}`, s.what !== 'filtro de régimen']));
    const is1D = reg.tf === 1440;
    const S = is1D ? states(daily, reg.major !== false, reg.majorOut ?? 6) : states(A, reg.major !== false, reg.majorOut ?? 6);
    const after = reg.after ?? 6;
    // Variantes: en qué vela se mira (4h: la de la señal; 1D: el día anterior al de la señal, o el último cerrado
    // al cerrar la vela de la señal) y si "tras romper" cuenta N velas desde la ruptura con o sin la N-ésima
    // El último día cerrado en un instante: el último cuyo fin (su hora + 1 día) ya pasó. Restar uno al día de la vela
    // falla cuando falta un día (uno incompleto se descarta): DOGE no tiene la vela de 4h del 13/03/2023 12:00
    const closedBy = (ms) => dayIndex(ms - 86400000);
    const looks = is1D
      ? { 'dia anterior al de la senal': (k) => closedBy(Math.floor(A.t[k] / 86400000) * 86400000), 'ultimo dia cerrado al cerrar la senal': (k) => closedBy(A.t[k] + tfMs) }
      : { 'vela de la senal': (k) => k };
    const res = {};
    // Lecturas de "tras romper": N velas contadas desde la que rompe (con o sin la N-ésima), y si además la vela tiene
    // que estar fuera de un rango (una caja nueva detectada enseguida la saca). Sin dato (antes de que el detector tenga
    // sus n velas) no pasa: se prueba con y sin esa regla.
    const breakoutReads = reg.mode === 'breakout'
      ? { 'menos de N': (j) => S.ends.some(e => j >= e && j - e < after), 'hasta N inclusive': (j) => S.ends.some(e => j >= e && j - e <= after),
          'menos de N y fuera de un rango': (j) => S.st[j] === 0 && S.ends.some(e => j >= e && j - e < after) }
      : { '': null };
    for (const [lname, look] of Object.entries(looks)) {
      for (const [bname, brk] of Object.entries(breakoutReads)) {
       for (const warm of [false, true]) {
        let same = 0, onlyE = [], onlyM = [];
        for (const s of sig) {
          const j = look(s.k);
          let mine;
          if (j < 0 || (warm && j < P.n)) mine = false;
          else if (reg.mode === 'inside') mine = S.st[j] === 1;
          else if (reg.mode === 'outside') mine = S.st[j] === 0;
          else mine = brk(j);
          const eng = engine.get(`${s.k}|${s.dir}`);
          if (eng === mine) same++;
          else if (eng) onlyE.push(`${iso(A.t[s.k])} ${s.dir > 0 ? '↑' : '↓'}`);
          else onlyM.push(`${iso(A.t[s.k])} ${s.dir > 0 ? '↑' : '↓'}`);
        }
        const vname = lname + (bname ? ', ' + bname : '') + (warm ? `, sin dato las primeras ${P.n} velas del marco` : '');
        res[vname] = { iguales: same, de: sig.length, pasa_solo_motor: onlyE.length, pasa_solo_js: onlyM.length, ej_motor: onlyE.slice(0, 6), ej_js: onlyM.slice(0, 6) };
        console.log(`régimen ${name} (${vname}): ${same} de ${sig.length} iguales` + (same === sig.length ? '' : ` · pasa solo en el motor ${onlyE.length} ${onlyE.slice(0, 3).join(', ')} · solo en js ${onlyM.length} ${onlyM.slice(0, 3).join(', ')}`));
       }
      }
    }
    out.regimen[name] = { regla: reg, variantes: res };
  }
}

if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
