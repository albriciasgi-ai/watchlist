/**
 * Lector VPA (21/11/2026): el Volume Price Analysis de Anna Coulling (A Complete Guide To Volume Price Analysis, 2013)
 * con reglas propias, en grados y sin futuro. Lógica pura, sin dibujo: la usa VPAIndicator.js y la repite
 * backend/vpa.py para el probador de reglas, operación por operación (paridad en tests/vpa.parity.test.mjs).
 * Si cambia una regla aquí, hay que cambiarla allá.
 *
 * El libro dice que VPA "es un arte": todo se juzga relativo, por grados y según dónde cae la vela. Aquí:
 * - Relativo: volumen y rango de cada vela contra la mediana de esa misma hora en los `days` días anteriores (en 1D,
 *   los días anteriores).
 * - Por grados: rampas de 0 a 1 (bajo, alto, ultra alto, ancho), no un sí o no.
 * - Esfuerzo contra resultado: q = rango relativo ÷ volumen relativo. Mucho volumen y poco rango, esfuerzo sin
 *   resultado (absorción, contra el color de la vela); mucho rango y poco volumen, resultado sin esfuerzo (trampa).
 * - El lugar: el tramo (zigzag de `legAtr` ATR) y cuánto lleva. Un martillo arriba de un tramo alcista es un
 *   "hanging man": debilidad que pide confirmación.
 * - Paciencia: cada vela suma evidencia a un medidor que se desvanece (`decay` por vela). Positivo es fuerza
 *   (alcista); negativo, debilidad (bajista). Ninguna vela decide sola.
 *
 * Elementos (los mismos del probador): QA esfuerzo sin resultado, QB ruptura con volumen, QF ruptura sin volumen,
 * QR retroceso sin volumen tras la ruptura, QT prueba de poco volumen, QS volumen de frenado o de techo, QC clímax y
 * QE el medidor cruza su umbral. Todo se sabe al cerrar su vela.
 */

const SETTINGS_KEY = 'vpa_settings_';
const DAY_MS = 86400000;

export const VPA_NAME = 'Lector VPA';

export const VPA_CODES = {
  QA: 'Esfuerzo sin resultado', QB: 'Ruptura con volumen', QF: 'Ruptura sin volumen', QR: 'Retroceso sin volumen',
  QT: 'Prueba de poco volumen', QS: 'Volumen de frenado o de techo', QC: 'Clímax de volumen', QE: 'Medidor cruza el umbral'
};

export function defaultVpaParams() {
  return {
    days: 30, minDays: 5, legAtr: 2,
    volLow: [0.6, 0.95], volHigh: [1.2, 1.8], volUltra: [2.0, 3.0], spreadWide: [1.2, 1.8],
    decay: 0.75, fire: 0.5, meter: 1,
    rangeBars: 20, maxRangeAtr: 6, pullBars: 8, testLook: 20, stopBars: 3, climaxBars: 6
  };
}

/** Ajustes del indicador: los parámetros de la regla y lo que se dibuja */
/**
 * Ancho del cuerpo de una vela, en parte de su lugar, según su volumen relativo a su hora (rv): 0.7 con el volumen
 * normal (el ancho de siempre), lo doble de volumen llena el lugar y poco volumen la angosta hasta 0.25. Raíz cuadrada:
 * el contraste se ve sin que las velas de poco volumen desaparezcan. Sin volumen relativo todavía, null (ancho de siempre).
 */
export function volumeWidthFactor(rv) {
  if (!Number.isFinite(rv) || rv < 0) return null;
  return Math.max(0.25, Math.min(1, 0.7 * Math.sqrt(rv)));
}

export function defaultVpaConfig() {
  return {
    params: defaultVpaParams(),
    // La prueba de poco volumen sale muy seguido y en la fase 1 perdió: apagada de fábrica, como el cruce del medidor
    // widthByVolume: el cuerpo de cada vela, más ancho cuanto más volumen tuvo frente a lo normal de su hora (apagado)
    show: { meter: true, marks: true, widthByVolume: false, QA: true, QB: true, QF: true, QR: true, QT: false, QS: true, QC: true, QE: false },
    minPx: 3
  };
}

export const VPA_LIMITS = {
  days: [5, 120], minDays: [2, 30], legAtr: [0.5, 10], decay: [0, 0.98], fire: [0.1, 1], meter: [0.2, 5],
  rangeBars: [5, 200], maxRangeAtr: [1, 50], pullBars: [1, 50], testLook: [3, 200], stopBars: [2, 10], climaxBars: [2, 30]
};

const clamp = (value, [lo, hi], fallback) => {
  const x = Number(value);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
};

function cleanPair(pair, fallback) {
  if (!Array.isArray(pair) || pair.length !== 2) return fallback;
  const a = Number(pair[0]), b = Number(pair[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= a) return fallback;
  return [a, b];
}

/** Parámetros guardados o del modal, acotados; lo que no sirve vuelve al de fábrica */
export function cleanVpaParams(values = {}) {
  const base = defaultVpaParams();
  const out = { ...base };
  for (const [key, range] of Object.entries(VPA_LIMITS)) out[key] = clamp(values[key], range, base[key]);
  for (const key of ['days', 'minDays', 'rangeBars', 'pullBars', 'testLook', 'stopBars', 'climaxBars']) out[key] = Math.round(out[key]);
  for (const key of ['volLow', 'volHigh', 'volUltra', 'spreadWide']) out[key] = cleanPair(values[key], base[key]);
  if (out.minDays > out.days) out.minDays = out.days;
  return out;
}

export function cleanVpaConfig(values = {}) {
  const base = defaultVpaConfig();
  return {
    params: cleanVpaParams(values.params || {}),
    show: { ...base.show, ...Object.fromEntries(Object.entries(values.show || {}).filter(([k, v]) => k in base.show && typeof v === 'boolean')) },
    minPx: clamp(values.minPx, [1, 20], base.minPx)
  };
}

export function loadVpaSettings(symbol, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SETTINGS_KEY + symbol);
    return cleanVpaConfig(raw ? JSON.parse(raw) : {});
  } catch {
    return defaultVpaConfig();
  }
}

export function saveVpaSettings(symbol, config, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SETTINGS_KEY + symbol, JSON.stringify(cleanVpaConfig(config)));
  } catch { /* sin almacenamiento: queda solo en memoria */ }
}

// Pesos de cada lectura en el medidor (los mismos de vpa.py)
const W_ABSORB = 1.0, W_TRAP = 0.8, W_VALID = 0.5, W_SHAPE = 1.0, W_HANG = 0.5, W_DOJI = 0.6, W_FADE = 0.8;
const FADE_BARS = 4;

const finite = Number.isFinite;

/** Rampa que sube: 0 hasta a, 1 desde b */
export function up(x, a, b) {
  if (!finite(x)) return 0;
  if (x <= a) return 0;
  if (x >= b) return 1;
  return (x - a) / (b - a);
}

/** Rampa que baja: 1 hasta full, 0 desde zero */
export function down(x, full, zero) {
  if (!finite(x)) return 0;
  if (x <= full) return 1;
  if (x >= zero) return 0;
  return (zero - x) / (zero - full);
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n % 2) return s[(n - 1) / 2];
  return (s[n / 2 - 1] + s[n / 2]) / 2;
}

const minOf = (arr, a, b) => { let m = Infinity; for (let j = a; j < b; j += 1) if (arr[j] < m) m = arr[j]; return m; };
const maxOf = (arr, a, b) => { let m = -Infinity; for (let j = a; j < b; j += 1) if (arr[j] > m) m = arr[j]; return m; };

/**
 * El lector, vela cerrada por vela cerrada: push() agrega una y calcula sus lecturas y sus elementos. Lo ya calculado
 * no cambia al agregar velas (nada mira el futuro): el gráfico solo procesa las velas nuevas.
 */
export class VpaReader {
  constructor(tf, params = defaultVpaParams()) {
    this.cfg = cleanVpaParams(params);
    this.tfMs = Number(tf) * 60000;
    this.t = []; this.o = []; this.h = []; this.l = []; this.c = []; this.v = [];
    const keys = ['atr', 'rv', 'rr', 'q', 'absorb', 'trap', 'valid', 'upper', 'lower', 'body', 'closeLoc', 'star', 'hammer', 'doji',
      'ext', 'maturity', 'fade', 'contrib', 'meter', 'leg', 'legStart', 'legExtreme', 'dir', 'hang'];
    this.s = Object.fromEntries(keys.map(k => [k, []]));
    this.events = [];
    this._volSlots = new Map();
    this._rngSlots = new Map();
    this._meter = 0;
    this._zz = null;
    this._breakouts = [];
    this._usedStop = new Set();
    this._usedClimax = new Set();
  }

  get length() { return this.c.length; }

  _relative(slots, i, value) {
    const cfg = this.cfg;
    const slot = this.tfMs < DAY_MS ? Math.floor((this.t[i] % DAY_MS) / this.tfMs) : 0;
    let seen = slots.get(slot);
    if (!seen) { seen = []; slots.set(slot, seen); }
    let out = NaN;
    if (seen.length >= cfg.minDays) {
      const usual = median(seen.slice(-cfg.days));
      if (usual > 0) out = value / usual;
    }
    seen.push(value);
    if (seen.length > cfg.days) seen.shift();
    return out;
  }

  _zigzag(i) {
    const { h, l, c } = this;
    const atr = this.s.atr[i];
    const k = this.cfg.legAtr;
    if (!this._zz) this._zz = { dir: 1, start: 0, extreme: h[0], at: 0 };
    const z = this._zz;
    if (z.dir === 1) {
      if (h[i] >= z.extreme) { z.extreme = h[i]; z.at = i; }
      else if (c[i] <= z.extreme - k * atr) {
        z.dir = -1; z.start = z.at;
        let best = z.at;
        for (let j = z.at; j <= i; j += 1) if (l[j] < l[best]) best = j;
        z.extreme = l[best]; z.at = best;
      }
    } else {
      if (l[i] <= z.extreme) { z.extreme = l[i]; z.at = i; }
      else if (c[i] >= z.extreme + k * atr) {
        z.dir = 1; z.start = z.at;
        let best = z.at;
        for (let j = z.at; j <= i; j += 1) if (h[j] > h[best]) best = j;
        z.extreme = h[best]; z.at = best;
      }
    }
    return [z.dir, z.start, z.extreme];
  }

  /** Agrega una vela cerrada {t, o, h, l, c, v} y devuelve los elementos que aparecen en ella */
  push(bar) {
    const i = this.c.length;
    this.t.push(bar.t); this.o.push(bar.o); this.h.push(bar.h); this.l.push(bar.l); this.c.push(bar.c); this.v.push(Number(bar.v) || 0);
    const { o, h, l, c, s, cfg } = this;
    // ATR de Wilder (como vpa.py y williams.py)
    const previous = i ? c[i - 1] : c[0];
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - previous), Math.abs(l[i] - previous));
    s.atr.push(i ? s.atr[i - 1] + (tr - s.atr[i - 1]) / 14 : tr);
    const r = h[i] - l[i];
    const x = this._relative(this._volSlots, i, this.v[i]);
    const y = this._relative(this._rngSlots, i, r);
    s.rv.push(x); s.rr.push(y);
    const [leg, legStart, legExt] = this._zigzag(i);
    s.leg.push(leg); s.legStart.push(legStart); s.legExtreme.push(legExt);
    const d = c[i] > o[i] ? 1 : (c[i] < o[i] ? -1 : 0);
    s.dir.push(d);
    const a = s.atr[i];
    const startPrice = leg === 1 ? l[legStart] : h[legStart];
    const ext = a > 0 ? Math.abs(legExt - startPrice) / a : NaN;
    const mat = up(ext, cfg.legAtr, 3 * cfg.legAtr);
    s.ext.push(ext); s.maturity.push(mat);
    let upper = NaN, lower = NaN, body = NaN, closeLoc = NaN, star = NaN, hammer = NaN, doji = NaN;
    if (r > 0) {
      const top = Math.max(o[i], c[i]), bottom = Math.min(o[i], c[i]);
      upper = (h[i] - top) / r; lower = (bottom - l[i]) / r; body = (top - bottom) / r;
      closeLoc = (c[i] - l[i]) / r;
      star = Math.min(up(upper, 0.45, 0.6), down(body, 0.2, 0.35), down(lower, 0.1, 0.25));
      hammer = Math.min(up(lower, 0.45, 0.6), down(body, 0.2, 0.35), down(upper, 0.1, 0.25));
      doji = Math.min(down(body, 0.05, 0.15), up(Math.min(upper, lower), 0.25, 0.35));
    }
    s.upper.push(upper); s.lower.push(lower); s.body.push(body); s.closeLoc.push(closeLoc);
    s.star.push(star); s.hammer.push(hammer); s.doji.push(doji);
    let contrib = 0, q = NaN, absorb = NaN, trap = NaN, valid = NaN, fade = NaN, hang = 0;
    const { volLow: vl, volHigh: vh, spreadWide: sw } = cfg;
    if (finite(x) && finite(y) && x > 0) {
      q = y / x;
      absorb = Math.min(up(x, vh[0], vh[1]), down(q, 0.35, 0.7));
      trap = Math.min(down(x, vl[0], vl[1]), up(q, 1.6, 2.5), up(y, sw[0], sw[1]));
      valid = Math.min(up(y, sw[0], sw[1]), up(x, vh[0], vh[1]), up(q, 0.6, 0.9));
      const against = d ? -d : -leg;
      contrib += against * absorb * W_ABSORB + against * trap * W_TRAP + d * valid * W_VALID;
      const weight = 0.25 + 0.35 * up(x, 0.8, 1.2) + 0.4 * up(x, 1.5, 2.5);
      if (r > 0) {
        contrib -= star * weight * W_SHAPE * (0.5 + 0.5 * (leg === 1 ? mat : 1.0));
        const nearTop = leg === 1 && a > 0 && (legExt - h[i]) / a <= 0.5;
        if (nearTop) {
          hang = hammer;
          contrib -= hammer * weight * W_HANG * mat;
        } else {
          contrib += hammer * weight * W_SHAPE * (0.5 + 0.5 * (leg === -1 ? mat : 1.0));
        }
        contrib -= leg * doji * up(x, 1.0, 1.8) * W_DOJI * mat;
      }
      if (i >= FADE_BARS && a > 0) {
        const past = s.rv[i - FADE_BARS] + s.rv[i - FADE_BARS + 1];
        const now = s.rv[i] + s.rv[i - 1];
        if (finite(past) && finite(now) && past > 0) {
          const advance = (c[i] - c[i - FADE_BARS]) * leg / a;
          fade = Math.min(up(advance, 0.5, 1.5), down(now / past, 0.6, 0.85));
          contrib -= leg * fade * W_FADE;
        }
      }
    }
    s.q.push(q); s.absorb.push(absorb); s.trap.push(trap); s.valid.push(valid); s.fade.push(fade); s.hang.push(hang);
    this._meter = this._meter * cfg.decay + contrib;
    s.contrib.push(contrib); s.meter.push(this._meter);
    const found = this._detect(i);
    this.events.push(...found);
    return found;
  }

  _detect(i) {
    const { h, l, c, s, cfg } = this;
    const fire = cfg.fire;
    const a = s.atr[i], x = s.rv[i], d = s.dir[i], leg = s.leg;
    const out = [];
    const add = (code, dir, lo, hi, grade, info) => out.push({ code, dir, index: i, t: this.t[i], lo, hi, grade, info });
    const volHigh = (value) => up(value, cfg.volHigh[0], cfg.volHigh[1]);
    const volLow = (value) => down(value, cfg.volLow[0], cfg.volLow[1]);
    // Esfuerzo sin resultado
    if (finite(s.absorb[i]) && s.absorb[i] >= fire && d) add('QA', -d, l[i], h[i], s.absorb[i], { rv: x, rr: s.rr[i] });
    // Rupturas del rango de las R velas anteriores
    const R = cfg.rangeBars;
    if (i > R && finite(x) && a > 0) {
      const hiR = maxOf(h, i - R, i), loR = minOf(l, i - R, i);
      const prevA = s.atr[i - 1];
      if (hiR - loR <= cfg.maxRangeAtr * prevA) {
        for (const [side, level] of [[1, hiR], [-1, loR]]) {
          const crossed = (c[i] - level) * side > 0.1 * a && (c[i - 1] - level) * side <= 0;
          if (!crossed) continue;
          const strong = volHigh(x), weak = volLow(x);
          if (strong >= fire) {
            const [lo, hi] = side > 0 ? [Math.min(l[i], level), level] : [level, Math.max(h[i], level)];
            add('QB', side, lo, hi, strong, { rv: x, level, height: (hiR - loR) / prevA });
            this._breakouts.push({ dir: side, level, index: i, done: false });
          } else if (weak >= fire) {
            const [lo, hi] = side > 0 ? [level, h[i]] : [l[i], level];
            add('QF', -side, lo, hi, weak, { rv: x, level, height: (hiR - loR) / prevA });
          }
        }
      }
    }
    // Retroceso sin volumen al nivel roto
    for (const b of this._breakouts) {
      if (b.done || b.index >= i) continue;
      const side = b.dir, level = b.level;
      if (i - b.index > cfg.pullBars || (c[i] - level) * side < -0.5 * a) { b.done = true; continue; }
      const touched = side > 0 ? (l[i] - level <= 0.5 * a) : (level - h[i] <= 0.5 * a);
      if (!touched || d !== side || (c[i] - level) * side <= 0) continue;
      const seg = s.rv.slice(b.index + 1, i + 1);
      if (!seg.every(finite)) continue;
      let sum = 0;
      for (const y of seg) sum += y;
      const mean = sum / seg.length;
      const grade = down(mean, 0.7, 1.0);
      if (grade >= fire) {
        const far = side > 0 ? minOf(l, b.index + 1, i + 1) : maxOf(h, b.index + 1, i + 1);
        const [lo, hi] = side > 0 ? [far, level] : [level, far];
        add('QR', side, lo, hi, grade, { level, breakout: this.t[b.index], rv: mean });
        b.done = true;
      }
    }
    if (this._breakouts.length && this._breakouts[0].done) this._breakouts = this._breakouts.filter(b => !b.done);
    // Prueba de poco volumen
    if (finite(x) && finite(s.body[i])) {
      const weak = volLow(x);
      const bodyOk = down(s.body[i], 0.25, 0.4);
      const from = Math.max(0, i - cfg.testLook);
      for (const [side, wick] of [[1, s.lower[i]], [-1, s.upper[i]]]) {
        const grade = Math.min(weak, bodyOk, up(wick, 0.45, 0.6));
        if (grade < fire) continue;
        let heavy = -1;
        for (let j = from; j < i; j += 1) {
          if (finite(s.rv[j]) && s.rv[j] >= cfg.volHigh[1] && s.dir[j] === -side && (side > 0 ? l[i] <= h[j] : h[i] >= l[j])) heavy = j;
        }
        if (heavy >= 0) add('QT', side, l[i], h[i], grade, { rv: x, heavy: this.t[heavy] });
      }
    }
    // Volumen de frenado (tramo bajista) o de techo (alcista)
    const k = cfg.stopBars;
    const legKey = `${leg[i]}:${s.legStart[i]}`;
    if (i >= k - 1 && finite(s.ext[i]) && s.ext[i] >= cfg.legAtr && !this._usedStop.has(legKey)) {
      const g = leg[i];
      const grades = [];
      for (let j = i - k + 1; j <= i; j += 1) {
        const wick = g < 0 ? s.lower[j] : s.upper[j];
        const loc = s.closeLoc[j];
        if (!(finite(wick) && finite(loc) && finite(s.rv[j]))) { grades.push(0); continue; }
        const sideLoc = g < 0 ? loc : 1 - loc;
        grades.push(Math.min(up(wick, 0.25, 0.4), up(sideLoc, 0.45, 0.55), volHigh(s.rv[j])));
      }
      const hits = grades.filter(gr => gr >= fire);
      if (hits.length >= 2 && grades[grades.length - 1] >= fire) {
        let sum = 0;
        for (const gr of hits) sum += gr;
        add('QS', -g, minOf(l, i - k + 1, i + 1), maxOf(h, i - k + 1, i + 1), sum / hits.length, { bars: hits.length, leg: g, ext: s.ext[i] });
        this._usedStop.add(legKey);
      }
    }
    // Clímax
    const m = cfg.climaxBars;
    if (i >= 1 && !this._usedClimax.has(legKey) && a > 0) {
      const g = leg[i];
      const hits = [];
      for (let j = Math.max(0, i - m + 1); j <= i; j += 1) {
        const wick = g > 0 ? s.upper[j] : s.lower[j];
        if (!(finite(wick) && finite(s.rv[j]))) continue;
        const grade = Math.min(up(s.rv[j], cfg.volUltra[0], cfg.volUltra[1]), up(wick, 0.25, 0.4));
        if (grade >= fire) hits.push(j);
      }
      if (hits.length >= 2 && hits[hits.length - 1] === i) {
        const ends = hits.map(j => (g > 0 ? h[j] : l[j]));
        if (Math.max(...ends) - Math.min(...ends) <= a) {
          add('QC', -g, Math.min(...hits.map(j => l[j])), Math.max(...hits.map(j => h[j])), 1.0, { bars: hits.length, leg: g });
          this._usedClimax.add(legKey);
        }
      }
    }
    // El medidor cruza el umbral
    if (i >= 1) {
      const now = s.meter[i], before = s.meter[i - 1], thr = cfg.meter;
      if (now >= thr && thr > before) add('QE', 1, l[i], h[i], 1.0, { meter: now });
      else if (now <= -thr && -thr < before) add('QE', -1, l[i], h[i], 1.0, { meter: now });
    }
    out.sort((p, r) => (p.code < r.code ? -1 : p.code > r.code ? 1 : r.dir - p.dir));
    return out;
  }
}

/** Velas del gráfico ({timestamp, open, ...}) en la forma del lector */
export const vpaBar = (candle) => ({ t: candle.timestamp, o: candle.open, h: candle.high, l: candle.low, c: candle.close, v: candle.volume });

/** Todo de una vez (pruebas y paridad) */
export function computeVpa(bars, tf, params) {
  const reader = new VpaReader(tf, params);
  for (const bar of bars) reader.push(bar);
  return reader;
}

const pct = (x) => (finite(x) ? `${x.toFixed(2)}×` : '—');

/** Lo que leyó el lector en la vela i, en palabras, para el cuadro al pasar el mouse */
export function describeVpa(reader, i) {
  const s = reader.s;
  if (i < 0 || i >= reader.length) return [];
  const lines = [];
  const x = s.rv[i], y = s.rr[i];
  if (!finite(x)) return ['Sin volumen normal de esta hora todavía (primeros días)'];
  const level = x >= reader.cfg.volUltra[0] ? 'ultra alto' : x >= reader.cfg.volHigh[0] ? 'alto' : x <= reader.cfg.volLow[1] ? 'bajo' : 'normal';
  lines.push(`Volumen ${level} (${pct(x)} su hora) · rango ${pct(y)} · resultado por esfuerzo ${pct(s.q[i])}`);
  const grade = (g) => `${Math.round(g * 100)}%`;
  if (s.absorb[i] > 0.05) lines.push(`Esfuerzo sin resultado ${grade(s.absorb[i])}: ${s.dir[i] > 0 ? 'la compra no avanza (debilidad)' : s.dir[i] < 0 ? 'la venta no avanza (fuerza)' : 'nadie avanza'}`);
  if (s.trap[i] > 0.05) lines.push(`Resultado sin esfuerzo ${grade(s.trap[i])}: movimiento sin volumen, posible trampa`);
  if (s.valid[i] > 0.05) lines.push(`Validado ${grade(s.valid[i])}: el volumen acompaña el rango`);
  if (s.star[i] > 0.05) lines.push(`Estrella ${grade(s.star[i])}: debilidad`);
  if (s.hang[i] > 0.05) lines.push(`Hanging man ${grade(s.hang[i])}: martillo arriba del tramo, debilidad por confirmar`);
  else if (s.hammer[i] > 0.05) lines.push(`Martillo ${grade(s.hammer[i])}: fuerza`);
  if (s.doji[i] > 0.05) lines.push(`Doji de patas largas ${grade(s.doji[i])}${x < 1 ? ' con poco volumen: trampa, no giro' : ': indecisión'}`);
  if (s.fade[i] > 0.05) lines.push(`El esfuerzo se agota ${grade(s.fade[i])}: el precio sigue y el volumen cae`);
  const legText = s.leg[i] > 0 ? 'alcista' : 'bajista';
  lines.push(`Tramo ${legText} de ${finite(s.ext[i]) ? s.ext[i].toFixed(1) : '—'} ATR · medidor ${s.meter[i] >= 0 ? '+' : ''}${s.meter[i].toFixed(2)} (${s.meter[i] >= 0 ? 'fuerza' : 'debilidad'})`);
  return lines;
}
