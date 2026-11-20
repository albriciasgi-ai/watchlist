// Detectores de horizontalidad de App 1: en cada vela dicen si el mercado está en rango, solo con lo ocurrido hasta
// el cierre de esa vela. Repite backend/regime_detectors.py y la ATR de Wilder de backend/regime.py, con los mismos
// parámetros, valores de fábrica, bucles y decisiones, y da lo mismo vela por vela. Para eso las cuentas siguen el
// orden de numpy: np.sum suma de a pares (pairwise_sum), la suma por columnas va vela tras vela, np.cumsum una tras
// otra, np.std es poblacional (ddof 0), round() redondea al par en la mitad exacta e int() trunca.
// Si cambia una regla en Python hay que cambiarla aquí y correr tests/regimedetectors.test.mjs.
//
// Velas: {t, o, h, l, c, v} como arreglos (Float64Array o Array), en orden, solo cerradas, con t en ms (UTC).
// Cada detector devuelve {state, zones}:
//   state      Uint8Array, 1 = rango en esa vela
//   zones      [{start, detected, end, low, high, ...}], con índices de vela, como en Python:
//     start     primera vela que el detector incluye (puede ser anterior a cuando se supo: así se dibuja la caja)
//     detected  vela en que se supo que había rango (desde ahí cuenta el estado)
//     end       última vela del rango
//     low, high caja de precios conocida al terminar
//   vp_prog suma shape ("D", "P" o "b") y d (d_score); major, parts y startT; adx y er devuelven además value.

const DAY_MS = 86400000;
export const APP1_BW = { 15: 2.15, 60: 2.05, 240: 2.05 }; // Umbral "consolidación" del BandWidth de App 1 por marco
const VWAP_MIN_BARS = { 15: 10, 60: 3, 240: 2 };          // Velas que la sesión necesita para leerse, como en App 1

// ==================== CUENTAS COMO NUMPY ====================

/**
 * np.sum de un tramo de x, al bit: la suma de a pares de numpy (pairwise_sum). Con menos de 8 valores, uno tras otro;
 * hasta 128, en 8 acumuladores; con más, en dos mitades, la primera múltiplo de 8.
 */
export function npSum(x, start = 0, n = x.length - start) {
  return 0 + pairwise(x, start, n);
}

function pairwise(x, start, n) {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += x[start + i];
    return res;
  }
  if (n <= 128) {
    let r0 = x[start], r1 = x[start + 1], r2 = x[start + 2], r3 = x[start + 3];
    let r4 = x[start + 4], r5 = x[start + 5], r6 = x[start + 6], r7 = x[start + 7];
    const stop = start + n - (n % 8);
    let i = start + 8;
    for (; i < stop; i += 8) {
      r0 += x[i]; r1 += x[i + 1]; r2 += x[i + 2]; r3 += x[i + 3];
      r4 += x[i + 4]; r5 += x[i + 5]; r6 += x[i + 6]; r7 += x[i + 7];
    }
    let res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (const end = start + n; i < end; i++) res += x[i];
    return res;
  }
  let half = Math.floor(n / 2);
  half -= half % 8;
  return pairwise(x, start, half) + pairwise(x, start + half, n - half);
}

/** np.std de un tramo (poblacional, ddof 0): media con np.sum, y los desvíos al cuadrado sumados con np.sum */
export function npStd(x, start = 0, n = x.length - start, scratch = new Float64Array(n)) {
  const mean = npSum(x, start, n) / n;
  for (let k = 0; k < n; k++) {
    const d = x[start + k] - mean;
    scratch[k] = d * d;
  }
  return Math.sqrt(npSum(scratch, 0, n) / n);
}

// min() y max() de Python con dos valores: el primero, salvo que el segundo sea menor (o mayor)
const pyMin = (a, b) => (b < a ? b : a);
const pyMax = (a, b) => (b > a ? b : a);

// np.min y np.max de un tramo [s, e): un NaN da NaN
function rangeMin(x, s, e) {
  let m = x[s];
  for (let k = s; k < e; k++) {
    const v = x[k];
    if (v !== v) return NaN;
    if (v < m) m = v;
  }
  return m;
}

function rangeMax(x, s, e) {
  let m = x[s];
  for (let k = s; k < e; k++) {
    const v = x[k];
    if (v !== v) return NaN;
    if (v > m) m = v;
  }
  return m;
}

// round() de Python: al entero más cercano y, en la mitad exacta, al par
function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// np.nan_to_num: NaN pasa a `nan` y los infinitos al mayor número finito
function nanToNum(x, nan = 0) {
  if (x !== x) return nan;
  if (x === Infinity) return Number.MAX_VALUE;
  if (x === -Infinity) return -Number.MAX_VALUE;
  return x;
}

// np.linspace(lo, hi, out.length): k × paso + lo, y el último exacto en hi
function linspaceInto(out, lo, hi) {
  const num = out.length;
  const div = num - 1;
  const delta = hi - lo;
  const step = delta / div;
  if (step === 0) for (let k = 0; k < num; k++) out[k] = (k / div) * delta + lo; // Números subnormales, como numpy
  else for (let k = 0; k < num; k++) out[k] = k * step + lo;
  if (num > 1) out[num - 1] = hi;
  return out;
}

// ==================== AYUDAS ====================

/** Media de las últimas n velas; NaN mientras no hay n. Con la suma acumulada, como Python */
export function sma(x, n) {
  const len = x.length;
  const out = new Float64Array(len).fill(NaN);
  if (len >= n) {
    const acc = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) acc[i + 1] = acc[i] + x[i];
    for (let i = n - 1; i < len; i++) out[i] = (acc[i + 1] - acc[i + 1 - n]) / n;
  }
  return out;
}

/** Rango verdadero; la primera vela usa su propio cierre como cierre anterior */
export function trueRange(h, l, c) {
  const n = c.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const prev = i ? c[i - 1] : c[0];
    out[i] = Math.max(h[i] - l[i], Math.max(Math.abs(h[i] - prev), Math.abs(l[i] - prev)));
  }
  return out;
}

/** ATR de Wilder (regime.atr): empieza en el rango verdadero de la primera vela */
export function atrWilder(h, l, c, n = 14) {
  const tr = trueRange(h, l, c);
  const out = new Float64Array(tr.length);
  if (!tr.length) return out;
  out[0] = tr[0];
  for (let i = 1; i < tr.length; i++) out[i] = out[i - 1] + (tr[i] - out[i - 1]) / n;
  return out;
}

/** Tramos seguidos con estado de rango como zonas, con la caja de sus máximos y mínimos. Desde la vela `warm` */
export function zonesFromState(a, state, warm = 0) {
  const zones = [];
  const n = state.length;
  let i = warm;
  while (i < n) {
    if (!state[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && state[j + 1]) j++;
    zones.push({ start: i, detected: i, end: j, low: rangeMin(a.l, i, j + 1), high: rangeMax(a.h, i, j + 1) });
    i = j + 1;
  }
  return zones;
}

/** Estado por vela de unas zonas: rango desde que se supo hasta su última vela */
export function stateFromZones(n, zones) {
  const state = new Uint8Array(n);
  for (const z of zones) state.fill(1, z.detected, z.end + 1);
  return state;
}

// ==================== RANGE DETECTION (App 1) ====================

/**
 * Rango cuando los últimos `length` cierres quedan a menos de `mult` ATR (media de `atr_len` velas) de su media.
 * Se conoce en la vela que lo cumple; la caja empieza `length` velas antes. Sigue mientras el cierre no salga de la
 * caja más de `max_out` velas seguidas.
 */
export function atrRange(a, { length = 20, atr_len = 200, mult = 1.0, max_out = 5 } = {}) {
  const { c, h, l } = a;
  const n = c.length;
  const atr = sma(trueRange(h, l, c), atr_len);
  for (let i = 0; i < n; i++) atr[i] *= mult;
  const ma = sma(c, length);
  const zones = [];
  let active = false, out = 0, z = null;
  const first = Math.max(atr_len, length) - 1;
  for (let i = first; i < n; i++) {
    const width = atr[i], mean = ma[i];
    if (Number.isNaN(width) || Number.isNaN(mean)) continue;
    let insideAll = true;
    for (let k = i - length + 1; k <= i; k++) {
      if (!(Math.abs(c[k] - mean) <= width)) {
        insideAll = false;
        break;
      }
    }
    if (insideAll) {
      const low = mean - width, high = mean + width;
      if (!active) {
        z = { start: i - length + 1, detected: i, end: i, low, high };
        active = true;
      }
      z.end = i;
      z.low = pyMin(z.low, low);
      z.high = pyMax(z.high, high);
      out = 0;
    } else if (active) {
      if (c[i] > z.high || c[i] < z.low) {
        out++;
        if (out > max_out) {
          zones.push(z);
          active = false;
        }
      } else {
        out = 0;
        z.end = i;
      }
    }
  }
  if (active) zones.push(z);
  return { state: stateFromZones(n, zones), zones };
}

// ==================== VWAP, TTM Y BBWP ====================

/**
 * BandWidth del VWAP de sesión de App 1: 2 × 1.15 × σ ÷ VWAP × 100, con σ la desviación del precio típico ponderada
 * por volumen desde el inicio de la sesión (día UTC). Rango si queda bajo `threshold` (el umbral de "consolidación"
 * de App 1 para el marco `tf`, en minutos). Mientras la sesión tiene menos de `min_bars` velas no se lee, como en
 * App 1: con 2 queda fuera solo la primera (el docstring de Python dice "las primeras min_bars", pero cuenta así).
 */
export function vwapBw(a, tf, { threshold = null, min_bars = null } = {}) {
  const limit = threshold == null ? (APP1_BW[tf] ?? 2.15) : threshold;
  const minBars = min_bars == null ? (VWAP_MIN_BARS[tf] ?? 2) : min_bars;
  const { h, l, c, v, t } = a;
  const n = c.length;
  const tp = new Float64Array(n);
  const weighted = new Float64Array(n); // Volumen × precio típico: no cambia con la vela
  const spread = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tp[i] = (h[i] + l[i] + c[i]) / 3;
    weighted[i] = v[i] * tp[i];
  }
  const state = new Uint8Array(n);
  let start = 0, prevDay = 0;
  for (let i = 0; i < n; i++) {
    const day = Math.floor(t[i] / DAY_MS);
    if (i && day !== prevDay) start = i;
    prevDay = day;
    const m = i - start + 1;
    if (m < minBars) continue;
    const volume = npSum(v, start, m);
    if (volume <= 0) continue;
    const vw = npSum(weighted, start, m) / volume;
    for (let k = start; k <= i; k++) {
      const d = tp[k] - vw;
      spread[k] = v[k] * (d * d);
    }
    const sd = Math.sqrt(npSum(spread, start, m) / volume);
    state[i] = 2 * 1.15 * sd / vw * 100 < limit ? 1 : 0;
  }
  return { state, zones: zonesFromState(a, state) };
}

/** Bandas de Bollinger de n velas a k desviaciones (poblacionales, como np.std); NaN mientras no hay n */
export function bollinger(c, n = 20, k = 2.0) {
  const len = c.length;
  const mid = sma(c, n);
  const up = new Float64Array(len);
  const lo = new Float64Array(len);
  const scratch = new Float64Array(Math.max(0, n));
  for (let i = 0; i < len; i++) {
    const sd = i >= n - 1 ? npStd(c, i - n + 1, n, scratch) : NaN;
    up[i] = mid[i] + k * sd;
    lo[i] = mid[i] - k * sd;
  }
  return { mid, up, lo };
}

/** TTM Squeeze: la banda de Bollinger cabe dentro del canal de Keltner. Rango con `min_bars` velas seguidas así */
export function ttm(a, { n = 20, bb_k = 2.0, kc_k = 1.5, min_bars = 1 } = {}) {
  const { h, l, c } = a;
  const { mid, up, lo } = bollinger(c, n, bb_k);
  const atr = sma(trueRange(h, l, c), n);
  const len = c.length;
  const state = new Uint8Array(len);
  let run = 0;
  for (let i = 0; i < len; i++) {
    const band = kc_k * atr[i];
    const on = up[i] < mid[i] + band && lo[i] > mid[i] - band;
    if (min_bars > 1) {
      run = on ? (i ? run + 1 : 1) : 0;
      state[i] = run >= min_bars ? 1 : 0;
    } else {
      state[i] = on ? 1 : 0;
    }
  }
  return { state, zones: zonesFromState(a, state) };
}

/** Ancho de Bollinger en su percentil de las `lookback` velas anteriores (con la propia); rango si queda bajo `below` */
export function bbwp(a, { n = 20, lookback = 252, below = 20.0 } = {}) {
  const { mid, up, lo } = bollinger(a.c, n, 2.0);
  const len = a.c.length;
  const width = new Float64Array(len);
  for (let i = 0; i < len; i++) width[i] = (up[i] - lo[i]) / mid[i];
  const state = new Uint8Array(len);
  for (let i = n - 1 + lookback; i < len; i++) {
    const w = width[i];
    let count = 0;
    for (let k = i - lookback + 1; k <= i; k++) if (width[k] < w) count++;
    state[i] = (count / lookback) * 100 < below ? 1 : 0;
  }
  return { state, zones: zonesFromState(a, state) };
}

// ==================== VP PROGRESIVO (App 8) ====================

/**
 * Perfil de volumen de las velas [s, e) en `bins` franjas iguales entre su mínimo y su máximo, como volume_profile
 * de Python. Se puede extender vela a vela con el mismo resultado que armarlo de nuevo: si la vela nueva no cambia el
 * mínimo ni el máximo, las franjas son las mismas y su volumen se suma al final, en el orden en que numpy suma las
 * velas (una tras otra). Si los cambia, se arma de nuevo.
 */
class Profile {
  constructor(a, bins) {
    this.h = a.h;
    this.l = a.l;
    this.v = a.v;
    this.bins = bins;
    this.edges = new Float64Array(bins + 1);
    this.vol = new Float64Array(bins);
  }

  build(s, e) {
    this.s = s;
    this.e = e;
    this.lo = rangeMin(this.l, s, e);
    this.hi = rangeMax(this.h, s, e);
    this.any = false;
    this.vol.fill(0);
    this.none = this.hi <= this.lo; // Python: si hi <= lo no hay perfil
    if (this.none) return;
    linspaceInto(this.edges, this.lo, this.hi);
    for (let j = s; j < e; j++) this.add(j);
  }

  /** Suma la vela j, la que sigue al tramo */
  push(j) {
    const lo = pyMin(this.lo, this.l[j]), hi = pyMax(this.hi, this.h[j]);
    if (lo !== this.lo || hi !== this.hi) {
      this.build(this.s, j + 1);
      return;
    }
    this.e = j + 1;
    if (!this.none) this.add(j);
  }

  add(j) {
    const hj = this.h[j], lj = this.l[j], vj = this.v[j];
    const r = hj - lj;
    if (!(r > 0 && vj > 0)) return; // Solo velas con rango y volumen
    this.any = true;
    const { edges, vol, bins } = this;
    for (let b = 0; b < bins; b++) {
      const overlap = Math.min(hj, edges[b + 1]) - Math.max(lj, edges[b]);
      if (overlap > 0) vol[b] += vj * overlap / r; // Sumar el cero de las franjas que no toca no cambia nada
    }
  }

  /** El perfil como lo da Python, o null: POC, área de valor (`va`) creciendo hacia la vecina mayor y total */
  read(va = 0.70) {
    if (this.none || !this.any) return null;
    const { vol, edges, bins } = this;
    const total = npSum(vol, 0, bins);
    if (total <= 0) return null;
    let poc = 0;
    for (let b = 1; b < bins; b++) if (vol[b] > vol[poc]) poc = b;
    let lowI = poc, highI = poc, acc = vol[poc];
    while (acc < total * va) {
      const up = highI < bins - 1 ? vol[highI + 1] : -1;
      const down = lowI > 0 ? vol[lowI - 1] : -1;
      if (up < 0 && down < 0) break;
      if (up >= down) acc += vol[++highI];
      else acc += vol[--lowI];
    }
    return { vol, edges, poc, val: edges[lowI], vah: edges[highI + 1], low: this.lo, high: this.hi, total };
  }
}

/** volume_profile de Python sobre estas velas (arreglos del mismo largo): {vol, edges, poc, val, vah, low, high, total} o null */
export function volumeProfile(h, l, v, bins = 50, va = 0.70) {
  const profile = new Profile({ h, l, v }, bins);
  profile.build(0, h.length);
  return profile.read(va);
}

/** La clasificación y el d_score de App 8 (zone_vp_scanner.classify_shape), sin cambios: [forma, d] */
export function shape(p) {
  const { vol } = p;
  const n = vol.length;
  const rng = p.high - p.low;
  const pocPrice = (p.edges[p.poc] + p.edges[p.poc + 1]) / 2;
  const pocC = (pocPrice - p.low) / rng;
  const vaC = (p.vah - p.val) / rng;
  const above = npSum(vol, p.poc + 1, n - p.poc - 1);
  const below = npSum(vol, 0, p.poc);
  const sym = above + below > 0 ? Math.abs(above - below) / (above + below) : 0.5;
  const from = Math.trunc(n * 0.3), to = Math.trunc(n * 0.7); // int() de Python: 15 y 35 con 50 franjas
  const kurt = npSum(vol, from, Math.max(0, to - from)) / p.total;
  let kind;
  if (kurt < 0.25 && vaC > 0.85) kind = 'thin';
  else if (0.25 <= pocC && pocC <= 0.75 && sym < 0.40) kind = 'D';
  else if (pocC > 0.60) kind = 'P';
  else if (pocC < 0.40) kind = 'b';
  else kind = 'D';
  const pocS = pyMax(0, 25 * (1 - Math.abs(pocC - 0.5) * 2.5));
  let vaS;
  if (vaC < 0.25) vaS = vaC / 0.25 * 15;
  else if (vaC <= 0.65) vaS = 25;
  else if (vaC <= 0.85) vaS = pyMax(0, 25 * (1 - (vaC - 0.65) / 0.20 * 0.8));
  else vaS = pyMax(0, 25 * 0.2 * (1 - (vaC - 0.85) / 0.15));
  const symS = pyMax(0, 25 * (1 - sym * 2));
  const kurtS = kurt >= 0.55 ? 25 : (kurt >= 0.30 ? 25 * (kurt - 0.30) / 0.25 : pyMax(0, 25 * kurt / 0.30 * 0.5));
  return [kind, Math.trunc(pyMin(100, pyMax(0, roundHalfEven(pocS + vaS + symS + kurtS))))];
}

/**
 * Zona cuando las últimas `min_c` velas caben en `range_pct` % del precio (o en `range_atr` ATR de 14, si se da)
 * y su perfil de volumen es D con d_score ≥ `min_d` (o P/b con 0.7 × d + 20 ≥ `min_d`). Se publica en esa vela.
 * Crece vela a vela mientras el rango total siga dentro del límite y no haya `close_out` cierres seguidos fuera del
 * área de valor de ese momento (`ref="va"`) o de la caja (`ref="zone"`). El perfil se rehace con cada vela que entra.
 */
export function vpProg(a, { min_c = 30, range_pct = 1.5, range_atr = null, min_d = 40, close_out = 3, ref = 'va', pb = true, bins = 50 } = {}) {
  const { h, l, c } = a;
  const n = c.length;
  const atr = range_atr ? atrWilder(h, l, c) : null;
  const profile = new Profile(a, bins);
  const zones = [];
  let i = min_c - 1;
  while (i < n) {
    const s = i - min_c + 1;
    let lo = rangeMin(l, s, i + 1), hi = rangeMax(h, s, i + 1);
    const mid = (lo + hi) / 2;
    const limit = range_atr ? range_atr * atr[i] : range_pct / 100 * mid; // Fijo desde que se detecta
    if (hi - lo > limit) {
      i++;
      continue;
    }
    profile.build(s, i + 1);
    let p = profile.read();
    if (p === null) {
      i++;
      continue;
    }
    const [kind, d] = shape(p);
    if (!(kind === 'D' && d >= min_d) && !(pb && (kind === 'P' || kind === 'b') && Math.trunc(d * 0.7 + 20) >= min_d)) {
      i++;
      continue;
    }
    const z = { start: s, detected: i, end: i, low: lo, high: hi, shape: kind, d };
    let vah = p.vah, val = p.val, outside = 0, j = i + 1;
    while (j < n) {
      const nlo = pyMin(lo, l[j]), nhi = pyMax(hi, h[j]);
      if (nhi - nlo > limit) break;
      const top = ref === 'zone' ? hi : vah;
      const bot = ref === 'zone' ? lo : val;
      if (c[j] > top || c[j] < bot) {
        outside++;
        if (outside >= close_out) break;
      } else {
        outside = 0;
      }
      lo = nlo;
      hi = nhi;
      z.end = j;
      z.low = lo;
      z.high = hi;
      profile.push(j);
      p = profile.read();
      if (p !== null) {
        vah = p.vah;
        val = p.val;
      }
      j++;
    }
    zones.push(z);
    i = z.end + 1;
  }
  return { state: stateFromZones(n, zones), zones };
}

// ==================== REFERENCIAS SIMPLES ====================

/** ADX de Wilder: rango si queda bajo `below`. Las primeras 3 × n velas no cuentan */
export function adx(a, { n = 14, below = 20.0 } = {}) {
  const { h, l, c } = a;
  const len = c.length;
  const pdm = new Float64Array(len), mdm = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const up = i ? h[i] - h[i - 1] : h[0] - h[0];       // np.diff con prepend: la primera es cero
    const dn = -(i ? l[i] - l[i - 1] : l[0] - l[0]);
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const wilder = (x) => {
    const out = new Float64Array(x.length);
    if (!x.length) return out;
    out[0] = x[0];
    for (let i = 1; i < x.length; i++) out[i] = out[i - 1] + (x[i] - out[i - 1]) / n;
    return out;
  };
  const atr = wilder(trueRange(h, l, c)), plus = wilder(pdm), minus = wilder(mdm);
  const dx = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const range = atr[i] > 0 ? atr[i] : NaN;
    const pdi = 100 * plus[i] / range, mdi = 100 * minus[i] / range;
    const sum = pdi + mdi;
    dx[i] = nanToNum(100 * Math.abs(pdi - mdi) / (sum > 0 ? sum : NaN));
  }
  const value = wilder(dx);
  const state = new Uint8Array(len);
  for (let i = 3 * n; i < len; i++) state[i] = value[i] < below ? 1 : 0;
  return { state, zones: zonesFromState(a, state, 3 * n), value };
}

/** Eficiencia de las últimas `n` velas (avance neto ÷ recorrido): rango si queda bajo `below` */
export function er(a, { n = 20, below = 0.3 } = {}) {
  const { c } = a;
  const len = c.length;
  const path = new Float64Array(len); // np.cumsum de |cierre − cierre anterior|, con la primera en cero
  for (let i = 0; i < len; i++) {
    const step = Math.abs(c[i] - (i ? c[i - 1] : c[0]));
    path[i] = i ? path[i - 1] + step : step;
  }
  const value = new Float64Array(len).fill(NaN);
  for (let i = n; i < len; i++) {
    const travelled = path[i] - path[i - n];
    value[i] = Math.abs(c[i] - c[i - n]) / (travelled >= 1e-12 || travelled !== travelled ? travelled : 1e-12);
  }
  const state = new Uint8Array(len);
  for (let i = 0; i < len; i++) state[i] = nanToNum(value[i], 1.0) < below ? 1 : 0;
  return { state, zones: zonesFromState(a, state, n), value };
}

/**
 * Entrada lenta y salida rápida. El rango empieza cuando la eficiencia de las últimas `n` velas queda bajo `below`
 * durante `min_bars` velas; su caja son el máximo y el mínimo de esas `n` velas, y sigue con las velas que quedan
 * dentro. Termina en la primera vela que cierra a más de `buffer` ATR fuera de la caja, o (si se da `exit_er`)
 * cuando la eficiencia pasa de `exit_er`. La caja no crece: un precio que se va moviendo de a poco termina saliendo.
 */
export function erBox(a, { n = 20, below = 0.3, buffer = 0.5, exit_er = null, min_bars = 1 } = {}) {
  const { h, l, c } = a;
  const eff = er(a, { n, below }).value;
  const atr = atrWilder(h, l, c);
  const zones = [];
  let z = null, lowRun = 0;
  for (let i = n; i < c.length; i++) {
    if (z === null) {
      lowRun = eff[i] < below ? lowRun + 1 : 0;
      if (lowRun >= min_bars) {
        const s = i - n + 1;
        z = { start: s, detected: i, end: i, low: rangeMin(l, s, i + 1), high: rangeMax(h, s, i + 1) };
      }
      continue;
    }
    const out = c[i] > z.high + buffer * atr[i] || c[i] < z.low - buffer * atr[i];
    if (out || (exit_er != null && eff[i] > exit_er)) {
      zones.push(z);
      z = null;
      lowRun = 0;
      continue;
    }
    z.end = i; // La caja queda fija: la de las velas con que se detectó el rango
  }
  if (z !== null) zones.push(z);
  return { state: stateFromZones(c.length, zones), zones };
}

export const DETECTORS = { er_box: erBox, atr_range: atrRange, vwap_bw: vwapBw, ttm, bbwp, vp_prog: vpProg, adx, er };

// ==================== RANGO MAYOR ====================

/**
 * Rango mayor armado con las cajas de un detector, sin futuro. Empieza con una caja, en la vela en que se supo, y
 * sigue mientras los cierres queden dentro de su caja con `buffer` ATR de margen. Una caja nueva que aparece mientras
 * sigue activo lo agranda si el conjunto no pasa de `max_atr` ATR de alto; si pasa, el rango mayor termina y empieza
 * otro con la caja nueva. Termina tras `closes_out` cierres seguidos fuera de la caja (con 1, el primero; con más,
 * aguanta las falsas rupturas, y las velas de afuera que no llegan a cortarlo siguen contando como rango).
 * `parts`: [{i: vela en que se supo, low, high, startT?}], en el marco de `a` (partsFromZones las arma).
 */
export function major(a, parts, { max_atr = 8.0, buffer = 0.5, closes_out = 1 } = {}) {
  const { c } = a;
  const atr = atrWilder(a.h, a.l, c);
  const byBar = new Map();
  for (const p of parts) {
    const key = Math.trunc(p.i);
    if (!byBar.has(key)) byBar.set(key, []);
    byBar.get(key).push(p);
  }
  const n = c.length;
  const state = new Uint8Array(n);
  const zones = [];
  let z = null, out = 0;
  for (let i = 0; i < n; i++) {
    if (z !== null) {
      if (c[i] > z.high + buffer * atr[i] || c[i] < z.low - buffer * atr[i]) {
        out++;
        if (out >= closes_out) {
          zones.push(z);
          z = null;
        }
      } else {
        out = 0;
      }
    }
    for (const p of byBar.get(i) || []) {
      if (z !== null) {
        const lo = pyMin(z.low, p.low), hi = pyMax(z.high, p.high);
        if (hi - lo <= max_atr * atr[i]) {
          z.low = lo;
          z.high = hi;
          z.parts += 1;
          continue;
        }
        zones.push(z);
      }
      z = { start: i, detected: i, end: i, low: p.low, high: p.high, parts: 1, startT: p.startT ?? null };
      out = 0;
    }
    if (z !== null) {
      z.end = i;
      state[i] = 1;
    }
  }
  if (z !== null) zones.push(z);
  return { state, zones };
}

/** Las cajas de un detector como piezas del rango mayor, en el mismo marco: cada una en la vela en que se supo, como view() */
export function partsFromZones(zones, t = null) {
  return zones.map(z => ({ i: z.detected, low: z.low, high: z.high, startT: t ? t[z.start] : null }));
}

// ==================== PARÁMETROS ====================
// Los afinados en la fase 1 (lo anterior a 2023, calificados en 2023) contra la referencia de 48 velas, y los "original"
// (de fábrica: como estaban en App 1 y App 8), tal cual regime_detectors.PARAMS. Ver la sección "REGÍMENES" del
// CLAUDE.md de App 1.

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const PARAMS = deepFreeze({
  er_box: { label: 'Eficiencia con caja', params: { n: 20, below: 0.2, buffer: 0.5, exit_er: 0.5, min_bars: 1 } },
  er: { label: 'Eficiencia baja (referencia simple)', params: { n: 20, below: 0.3 } },
  adx: { label: 'ADX bajo (referencia simple)', params: { n: 14, below: 30 }, original: { n: 14, below: 20 } },
  ttm: { label: 'TTM Squeeze', params: { n: 20, bb_k: 2.0, kc_k: 2.0, min_bars: 1 }, original: { n: 20, bb_k: 2.0, kc_k: 1.5, min_bars: 1 } },
  bbwp: { label: 'BBWP', params: { n: 20, lookback: 126, below: 50 }, original: { n: 20, lookback: 252, below: 20 } },
  atr_range: {
    label: 'Range Detection de App 1 (ATR)',
    params: { length: 30, atr_len: 50, mult: 2.0, max_out: 5 },
    original: { length: 20, atr_len: 200, mult: 1.0, max_out: 5 }
  },
  vwap_bw: { label: 'BandWidth del VWAP de sesión de App 1', params: { threshold: null } },
  vp_prog: {
    label: 'VP progresivo (D creciente) de App 8',
    params: { min_c: 20, range_pct: 99, range_atr: 5, min_d: 45, close_out: 3 },
    original: { min_c: 30, range_pct: 1.5, range_atr: null, min_d: 40, close_out: 3 }
  }
});

/** Detectores con su etiqueta y sus valores, como catalog() de Python */
export function catalog() {
  return Object.entries(PARAMS).map(([key, entry]) => ({ key, label: entry.label, params: entry.params, original: entry.original ?? null }));
}

/**
 * Los valores de un detector como _clean_params de Python: parte de los afinados y toma de `raw` solo las claves de
 * los afinados o de los de fábrica. null o '' dejan la clave en null (vwap_bw: el umbral de App 1; vp_prog: sin rango
 * en ATR); un texto que no es número no cambia nada.
 */
export function cleanParams(name, raw) {
  const entry = PARAMS[name];
  const clean = { ...entry.params };
  const known = { ...entry.params, ...(entry.original || {}) };
  for (const [key, value] of Object.entries(raw || {})) {
    if (!(key in known) || value === undefined) continue;
    if (value === null || value === '') {
      clean[key] = null;
      continue;
    }
    const number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isNaN(number)) clean[key] = number;
  }
  return clean;
}

/**
 * Corre un detector con sus valores limpios (cleanParams sobre los afinados), como la vista de regímenes del backend.
 * `tfMinutes` solo lo usa vwap_bw: sus umbrales van por marco (15, 60 o 240).
 */
export function runDetector(name, bars, tfMinutes, params) {
  const detector = DETECTORS[name];
  if (!detector || !PARAMS[name]) throw new Error(`Detector desconocido: ${name}`);
  const clean = cleanParams(name, params);
  return name === 'vwap_bw' ? detector(bars, Number(tfMinutes), clean) : detector(bars, clean);
}

/**
 * Velas de App 1 ({timestamp, open, high, low, close, volume}) o del backend ({t, o, h, l, c, vol}) como arreglos.
 * La vela en formación (in_progress) queda fuera: los detectores leen solo velas cerradas.
 */
export function toArrays(candles) {
  const closed = candles.filter(k => !k.in_progress);
  const n = closed.length;
  const out = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  closed.forEach((k, i) => {
    out.t[i] = k.timestamp ?? k.t;
    out.o[i] = k.open ?? k.o;
    out.h[i] = k.high ?? k.h;
    out.l[i] = k.low ?? k.l;
    out.c[i] = k.close ?? k.c;
    out.v[i] = k.volume ?? k.vol ?? k.v ?? 0;
  });
  return out;
}
