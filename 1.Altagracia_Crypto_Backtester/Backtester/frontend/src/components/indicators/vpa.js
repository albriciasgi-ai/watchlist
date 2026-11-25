/**
 * Lector VPA (21/11/2026): el Volume Price Analysis de Anna Coulling (A Complete Guide To Volume Price Analysis, 2013)
 * con reglas propias, en grados y sin futuro. Lógica pura, sin dibujo: la usa VPAIndicator.js y la repite
 * backend/vpa.py para el probador de reglas, operación por operación (paridad en tests/vpa.parity.test.mjs).
 * Si cambia una regla aquí, hay que cambiarla allá.
 *
 * El libro dice que VPA "es un arte": todo se juzga relativo, por grados y según dónde cae la vela. Aquí:
 * - Relativo: volumen y rango de cada vela contra la mediana de esa misma hora en los `days` días anteriores (en 1D,
 *   los días anteriores). Desde el motor 7 del probador (24/11/2026, galería 2), para los elementos un volumen alto (o
 *   un rango ancho) lo es también frente a la mediana de las `nearBars` velas anteriores: lo que ve el ojo. El medidor
 *   sigue con su hora, salvo en la vela ancha con volumen alto, que lee como los elementos (`wideMeter`).
 * - Por grados: rampas de 0 a 1 (bajo, alto, ultra alto, ancho), no un sí o no.
 * - Esfuerzo contra resultado: q = rango relativo ÷ volumen relativo. Mucho volumen y poco rango, esfuerzo sin
 *   resultado (absorción, contra el color de la vela); mucho rango y poco volumen, resultado sin esfuerzo (trampa).
 *   Desde el motor 7, en los elementos una vela ancha con volumen alto tuvo resultado aunque su volumen fuera todavía
 *   mayor que su rango (`wideResult`), y el medidor la lee igual (`wideMeter`).
 * - El lugar: el tramo (zigzag de `legAtr` ATR) y cuánto lleva. Un martillo arriba de un tramo alcista es un
 *   "hanging man": debilidad que pide confirmación; una estrella abajo de un tramo bajista, un martillo invertido:
 *   fuerza que pide confirmación (desde el 22/11, H22 del protocolo de pruebas).
 * - Paciencia: cada vela suma evidencia a un medidor que se desvanece (`decay` por vela). Positivo es fuerza
 *   (alcista); negativo, debilidad (bajista). Ninguna vela decide sola.
 *
 * Elementos (los mismos del probador): QA esfuerzo sin resultado, QV esfuerzo con resultado, QB ruptura con volumen,
 * QF ruptura sin volumen, QR retroceso sin volumen tras la ruptura, QT prueba de poco volumen, QS volumen de frenado o
 * de techo, QC clímax, QE el medidor cruza su umbral y QG el medidor gira. Todo se sabe al cerrar su vela. Lo que
 * cambió con el motor 7 (QA no tras una vela ancha ni en una vela ancha, QV la vela ancha con volumen alto, QT dentro de
 * una caja del Régimen y tras un frenado o un clímax, QS con mecha de media vela, QR con una vela en contra) tiene su
 * parámetro: con el valor de antes, la regla de antes.
 */

const SETTINGS_KEY = 'vpa_settings_';
const DAY_MS = 86400000;

export const VPA_NAME = 'Lector VPA';

export const VPA_CODES = {
  QA: 'Esfuerzo sin resultado', QV: 'Esfuerzo con resultado', QB: 'Ruptura con volumen', QF: 'Ruptura sin volumen',
  QR: 'Retroceso sin volumen', QT: 'Prueba de poco volumen', QS: 'Volumen de frenado o de techo', QC: 'Clímax de volumen',
  QE: 'Medidor cruza el umbral', QG: 'El medidor gira'
};

/** El signo con que cada elemento se dibuja sobre las velas (y que el modal muestra junto a su nombre) */
export const VPA_GLYPHS = { QA: '◆', QV: 'V', QB: '▲', QF: '✕', QR: '↺', QT: 'T', QS: 'S', QC: 'C', QE: 'E', QG: 'G' };

/** La caja de la pestaña Régimen (erBox de regimeDetectors.js con sus parámetros): la consolidación de la prueba (vpa.py, BOX) */
export const VPA_BOX = { n: 20, below: 0.2, buffer: 0.5, exit_er: 0.5 };

export function defaultVpaParams() {
  return {
    days: 30, minDays: 5, legAtr: 2,
    volLow: [0.6, 0.95], volHigh: [1.2, 1.8], volUltra: [2.0, 3.0], spreadWide: [1.2, 1.8],
    decay: 0.75, fire: 0.5, meter: 1,
    rangeBars: 20, maxRangeAtr: 6, pullBars: 8, testLook: 20, stopBars: 3, climaxBars: 6,
    // Motor 7 (24/11/2026, galería 2, decidido por el usuario). Entre paréntesis, el valor que repite la regla de antes:
    // volumen alto también frente a las N velas anteriores (0), el esfuerzo sin resultado no tras una vela ancha (false),
    // la prueba dentro de una caja (false) y tras un frenado o un clímax de su lado (false), la mecha del frenado de
    // media vela ([0.25, 0.4]) y el retroceso con una vela en contra (false). Con volumen alto, la vela ancha tuvo
    // resultado: no es esfuerzo sin resultado, y el esfuerzo con resultado no pide que el rango siga al volumen (false);
    // el medidor la lee igual (false)
    nearBars: 20, skipAfterWide: true, wideResult: true, wideMeter: true, testBox: true, testAfter: true, stopWick: [0.4, 0.6], pullBack: true
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
    // Los dos del motor 7 (esfuerzo con resultado y el giro del medidor), apagados: el primero sale en 1 de cada 12 velas
    show: { meter: true, marks: true, widthByVolume: false, QA: true, QV: false, QB: true, QF: true, QR: true, QT: false, QS: true, QC: true, QE: false, QG: false },
    minPx: 3
  };
}

export const VPA_LIMITS = {
  days: [5, 120], minDays: [2, 30], legAtr: [0.5, 10], decay: [0, 0.98], fire: [0.1, 1], meter: [0.2, 5],
  rangeBars: [5, 200], maxRangeAtr: [1, 50], pullBars: [1, 50], testLook: [3, 200], stopBars: [2, 10], climaxBars: [2, 30],
  nearBars: [0, 200]
};

const VPA_FLAGS = ['skipAfterWide', 'wideResult', 'wideMeter', 'testBox', 'testAfter', 'pullBack'];

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
  for (const key of ['days', 'minDays', 'rangeBars', 'pullBars', 'testLook', 'stopBars', 'climaxBars', 'nearBars']) out[key] = Math.round(out[key]);
  for (const key of ['volLow', 'volHigh', 'volUltra', 'spreadWide', 'stopWick']) out[key] = cleanPair(values[key], base[key]);
  for (const key of VPA_FLAGS) out[key] = typeof values[key] === 'boolean' ? values[key] : base[key];
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

/** Esfuerzo sin resultado con volumen x y rango y relativos (NaN si no se puede medir), como vpa._absorb_grade */
function absorbGrade(x, y, vh) {
  if (!(finite(x) && finite(y) && x > 0)) return NaN;
  return Math.min(up(x, vh[0], vh[1]), down(y / x, 0.35, 0.7));
}

/** Esfuerzo con resultado (la vela validada), como vpa._valid_grade */
function validGrade(x, y, vh, sw) {
  if (!(finite(x) && finite(y) && x > 0)) return NaN;
  return Math.min(up(y, sw[0], sw[1]), up(x, vh[0], vh[1]), up(y / x, 0.6, 0.9));
}

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
      'ext', 'maturity', 'fade', 'contrib', 'meter', 'leg', 'legStart', 'legExtreme', 'dir', 'hang', 'invh',
      'rvn', 'rrn', 'rvHi', 'wide', 'absorbE', 'validE', 'boxLow', 'boxHigh'];
    this.s = Object.fromEntries(keys.map(k => [k, []]));
    this._rng = [];
    this._path = []; // np.cumsum de |cierre − cierre anterior| (la eficiencia de la caja del Régimen)
    this._box = null;
    this._boxRun = 0;
    this._turned = { 1: -1e9, [-1]: -1e9 }; // La última vela con un frenado o un clímax de cada lado
    this._gSide = 0; this._gBeyond = false; this._gPeak = 0; // El medidor: de qué lado del cero, si pasó el umbral, su pico
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

  /** El valor de la vela i dividido por la mediana de los n anteriores, sin el suyo (vpa.relative_to_near) */
  _near(values, i, n) {
    if (n <= 0 || i < n) return NaN;
    const usual = median(values.slice(i - n, i));
    return usual > 0 ? values[i] / usual : NaN;
  }

  /** La caja del Régimen vigente en la vela i (vpa.boxes): [bajo, alto] o null */
  _boxAt(i) {
    const { c, h, l } = this;
    const step = Math.abs(c[i] - (i ? c[i - 1] : c[0]));
    this._path.push(i ? this._path[i - 1] + step : step);
    const n = VPA_BOX.n;
    if (i < n) return null;
    const travelled = this._path[i] - this._path[i - n];
    const eff = Math.abs(c[i] - c[i - n]) / (travelled >= 1e-12 || travelled !== travelled ? travelled : 1e-12);
    const a = this.s.atr[i];
    const box = this._box;
    if (box === null) {
      this._boxRun = eff < VPA_BOX.below ? this._boxRun + 1 : 0;
      if (this._boxRun >= 1) this._box = [minOf(l, i - n + 1, i + 1), maxOf(h, i - n + 1, i + 1)];
      return null;
    }
    if (c[i] > box[1] + VPA_BOX.buffer * a || c[i] < box[0] - VPA_BOX.buffer * a || eff > VPA_BOX.exit_er) {
      this._box = null;
      this._boxRun = 0;
      return null;
    }
    return box;
  }

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
    this._rng.push(r);
    const x = this._relative(this._volSlots, i, this.v[i]);
    const y = this._relative(this._rngSlots, i, r);
    s.rv.push(x); s.rr.push(y);
    const near = cfg.nearBars;
    const xn = this._near(this.v, i, near), yn = this._near(this._rng, i, near);
    s.rvn.push(xn); s.rrn.push(yn);
    const box = this._boxAt(i);
    s.boxLow.push(box ? box[0] : NaN); s.boxHigh.push(box ? box[1] : NaN);
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
    let contrib = 0, q = NaN, absorb = NaN, trap = NaN, valid = NaN, fade = NaN, hang = 0, invh = 0, absorbE = NaN, validE = NaN;
    const { volLow: vl, volHigh: vh, spreadWide: sw } = cfg;
    // Lo alto de los elementos (motor 7): alto para su hora y frente a las velas anteriores. Sin nearBars, su hora
    let xHi = x, yWide = y;
    if (near > 0) {
      xHi = finite(x) && finite(xn) ? Math.min(x, xn) : NaN;
      yWide = finite(y) && finite(yn) ? Math.min(y, yn) : NaN;
    }
    s.rvHi.push(xHi);
    s.wide.push(finite(yWide) ? up(yWide, sw[0], sw[1]) : NaN);
    if (finite(x) && finite(y) && x > 0) {
      q = y / x;
      absorb = Math.min(up(x, vh[0], vh[1]), down(q, 0.35, 0.7));
      trap = Math.min(down(x, vl[0], vl[1]), up(q, 1.6, 2.5), up(y, sw[0], sw[1]));
      valid = Math.min(up(y, sw[0], sw[1]), up(x, vh[0], vh[1]), up(q, 0.6, 0.9));
      // Las de los elementos: el mismo grado también contra las velas anteriores, el menor. El medidor, con su hora
      absorbE = absorb; validE = valid;
      if (near > 0) {
        const a2 = absorbGrade(xn, yn, vh), v2 = validGrade(xn, yn, vh, sw);
        absorbE = finite(a2) ? Math.min(absorb, a2) : 0;
        validE = finite(v2) ? Math.min(valid, v2) : 0;
      }
      // La vela ancha (contra su hora y las velas anteriores) con volumen alto tuvo resultado: el caso 2 de la galería 2,
      // de 10 veces su rango con 20 veces su volumen, era esfuerzo con resultado
      const w = s.wide[i];
      if (cfg.wideResult && finite(w)) {
        absorbE = Math.min(absorbE, 1 - w);
        validE = Math.min(w, up(xHi, vh[0], vh[1]));
      }
      // El medidor la lee igual (lo pidió el usuario): no le suma como esfuerzo sin resultado y le suma como esfuerzo con
      // resultado, con el grado del elemento. Lo demás del medidor sigue con su hora
      if (cfg.wideMeter && finite(w)) {
        absorb = Math.min(absorb, 1 - w);
        valid = Math.max(valid, Math.min(w, up(xHi, vh[0], vh[1])));
      }
      const against = d ? -d : -leg;
      contrib += against * absorb * W_ABSORB + against * trap * W_TRAP + d * valid * W_VALID;
      const weight = 0.25 + 0.35 * up(x, 0.8, 1.2) + 0.4 * up(x, 1.5, 2.5);
      if (r > 0) {
        // Estrella abajo de un tramo bajista: martillo invertido, fuerza que pide confirmación (H22, 22/11/2026)
        const nearBottom = leg === -1 && a > 0 && (l[i] - legExt) / a <= 0.5;
        if (nearBottom) {
          invh = star;
          contrib += star * weight * W_HANG * mat;
        } else {
          contrib -= star * weight * W_SHAPE * (0.5 + 0.5 * (leg === 1 ? mat : 1.0));
        }
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
    s.q.push(q); s.absorb.push(absorb); s.trap.push(trap); s.valid.push(valid); s.fade.push(fade); s.hang.push(hang); s.invh.push(invh);
    s.absorbE.push(absorbE); s.validE.push(validE);
    this._meter = this._meter * cfg.decay + contrib;
    s.contrib.push(contrib); s.meter.push(this._meter);
    const found = this._detect(i);
    this.events.push(...found);
    return found;
  }

  _detect(i) {
    const { h, l, c, s, cfg } = this;
    const fire = cfg.fire;
    const a = s.atr[i], x = s.rv[i], d = s.dir[i], leg = s.leg, hv = s.rvHi;
    const out = [];
    const add = (code, dir, lo, hi, grade, info) => out.push({ code, dir, index: i, t: this.t[i], lo, hi, grade, info });
    const volHigh = (value) => up(value, cfg.volHigh[0], cfg.volHigh[1]);
    const volLow = (value) => down(value, cfg.volLow[0], cfg.volLow[1]);
    const nearInfo = (info) => (finite(s.rvn[i]) ? { ...info, rvn: s.rvn[i] } : info);
    // Esfuerzo sin resultado; tras una vela ancha no cuenta (esa tuvo resultado: esta es su pausa)
    const absorbE = s.absorbE[i];
    if (finite(absorbE) && absorbE >= fire && d && !(cfg.skipAfterWide && i >= 1 && finite(s.wide[i - 1]) && s.wide[i - 1] >= fire)) {
      add('QA', -d, l[i], h[i], absorbE, nearInfo({ rv: x, rr: s.rr[i] }));
    }
    // Esfuerzo con resultado
    const validE = s.validE[i];
    if (finite(validE) && validE >= fire && d) add('QV', d, l[i], h[i], validE, nearInfo({ rv: x, rr: s.rr[i] }));
    // Rupturas del rango de las R velas anteriores
    const R = cfg.rangeBars;
    if (i > R && finite(x) && a > 0) {
      const hiR = maxOf(h, i - R, i), loR = minOf(l, i - R, i);
      const prevA = s.atr[i - 1];
      if (hiR - loR <= cfg.maxRangeAtr * prevA) {
        for (const [side, level] of [[1, hiR], [-1, loR]]) {
          const crossed = (c[i] - level) * side > 0.1 * a && (c[i - 1] - level) * side <= 0;
          if (!crossed) continue;
          const strong = volHigh(hv[i]), weak = volLow(x);
          if (strong >= fire) {
            const [lo, hi] = side > 0 ? [Math.min(l[i], level), level] : [level, Math.max(h[i], level)];
            add('QB', side, lo, hi, strong, nearInfo({ rv: x, level, height: (hiR - loR) / prevA }));
            this._breakouts.push({ dir: side, level, index: i, done: false });
          } else if (weak >= fire) {
            const [lo, hi] = side > 0 ? [level, h[i]] : [l[i], level];
            add('QF', -side, lo, hi, weak, { rv: x, level, height: (hiR - loR) / prevA });
          }
        }
      }
    }
    // Retroceso sin volumen al nivel roto, con al menos una vela que vuelva en contra de la ruptura (motor 7)
    for (const b of this._breakouts) {
      if (b.done || b.index >= i) continue;
      const side = b.dir, level = b.level;
      if (i - b.index > cfg.pullBars || (c[i] - level) * side < -0.5 * a) { b.done = true; continue; }
      const touched = side > 0 ? (l[i] - level <= 0.5 * a) : (level - h[i] <= 0.5 * a);
      if (!touched || d !== side || (c[i] - level) * side <= 0) continue;
      if (cfg.pullBack) {
        let back = false;
        for (let j = b.index + 1; j < i; j += 1) if (s.dir[j] === -side) { back = true; break; }
        if (!back) continue;
      }
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
    // Prueba de poco volumen: dentro de una consolidación y tras un frenado o un clímax de su lado (motor 7)
    const look = cfg.testLook;
    if (finite(x) && finite(s.body[i])) {
      const weak = volLow(x);
      const bodyOk = down(s.body[i], 0.25, 0.4);
      const from = Math.max(0, i - look);
      for (const [side, wick] of [[1, s.lower[i]], [-1, s.upper[i]]]) {
        const grade = Math.min(weak, bodyOk, up(wick, 0.45, 0.6));
        if (grade < fire) continue;
        if (cfg.testAfter && i - this._turned[side] > look) continue;
        if (cfg.testBox) {
          const boxLo = s.boxLow[i], boxHi = s.boxHigh[i];
          if (!finite(boxLo)) continue;
          const mid = (boxLo + boxHi) / 2;
          if ((side > 0 && l[i] > mid) || (side < 0 && h[i] < mid)) continue;
        }
        let heavy = -1;
        for (let j = from; j < i; j += 1) {
          if (finite(hv[j]) && hv[j] >= cfg.volHigh[1] && s.dir[j] === -side && (side > 0 ? l[i] <= h[j] : h[i] >= l[j])) heavy = j;
        }
        if (heavy >= 0) {
          const info = { rv: x, heavy: this.t[heavy] };
          if (cfg.testAfter) info.turn = this.t[this._turned[side]];
          add('QT', side, l[i], h[i], grade, info);
        }
      }
    }
    // Volumen de frenado (tramo bajista) o de techo (alcista), con la mecha de media vela (motor 7)
    const k = cfg.stopBars;
    const [sw0, sw1] = cfg.stopWick;
    const legKey = `${leg[i]}:${s.legStart[i]}`;
    if (i >= k - 1 && finite(s.ext[i]) && s.ext[i] >= cfg.legAtr && !this._usedStop.has(legKey)) {
      const g = leg[i];
      const grades = [];
      for (let j = i - k + 1; j <= i; j += 1) {
        const wick = g < 0 ? s.lower[j] : s.upper[j];
        const loc = s.closeLoc[j];
        if (!(finite(wick) && finite(loc) && finite(hv[j]))) { grades.push(0); continue; }
        const sideLoc = g < 0 ? loc : 1 - loc;
        grades.push(Math.min(up(wick, sw0, sw1), up(sideLoc, 0.45, 0.55), volHigh(hv[j])));
      }
      const hits = grades.filter(gr => gr >= fire);
      if (hits.length >= 2 && grades[grades.length - 1] >= fire) {
        let sum = 0;
        for (const gr of hits) sum += gr;
        add('QS', -g, minOf(l, i - k + 1, i + 1), maxOf(h, i - k + 1, i + 1), sum / hits.length, { bars: hits.length, leg: g, ext: s.ext[i] });
        this._usedStop.add(legKey);
        this._turned[-g] = i;
      }
    }
    // Clímax
    const m = cfg.climaxBars;
    if (i >= 1 && !this._usedClimax.has(legKey) && a > 0) {
      const g = leg[i];
      const hits = [];
      for (let j = Math.max(0, i - m + 1); j <= i; j += 1) {
        const wick = g > 0 ? s.upper[j] : s.lower[j];
        if (!(finite(wick) && finite(hv[j]))) continue;
        const grade = Math.min(up(hv[j], cfg.volUltra[0], cfg.volUltra[1]), up(wick, 0.25, 0.4));
        if (grade >= fire) hits.push(j);
      }
      if (hits.length >= 2 && hits[hits.length - 1] === i) {
        const ends = hits.map(j => (g > 0 ? h[j] : l[j]));
        if (Math.max(...ends) - Math.min(...ends) <= a) {
          add('QC', -g, Math.min(...hits.map(j => l[j])), Math.max(...hits.map(j => h[j])), 1.0, { bars: hits.length, leg: g });
          this._usedClimax.add(legKey);
          this._turned[-g] = i;
        }
      }
    }
    if (i >= 1) {
      const now = s.meter[i], before = s.meter[i - 1], thr = cfg.meter;
      // El medidor cruza el umbral
      if (now >= thr && thr > before) add('QE', 1, l[i], h[i], 1.0, { meter: now });
      else if (now <= -thr && -thr < before) add('QE', -1, l[i], h[i], 1.0, { meter: now });
      // El medidor gira: cruza el cero después de haber pasado el umbral del otro lado
      const sideNow = now > 0 ? 1 : (now < 0 ? -1 : 0);
      if (sideNow && sideNow !== this._gSide) {
        if (this._gSide && this._gBeyond) add('QG', sideNow, l[i], h[i], 1.0, { meter: now, peak: this._gPeak });
        this._gSide = sideNow; this._gBeyond = false; this._gPeak = now;
      } else if (sideNow && Math.abs(now) > Math.abs(this._gPeak)) {
        this._gPeak = now;
      }
      if (sideNow && Math.abs(now) >= thr) this._gBeyond = true;
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
  // Lo alto, para su hora y frente a las velas anteriores (motor 7); lo bajo, para su hora
  const hi = s.rvHi[i];
  const level = hi >= reader.cfg.volUltra[0] ? 'ultra alto' : hi >= reader.cfg.volHigh[0] ? 'alto' : x <= reader.cfg.volLow[1] ? 'bajo' : 'normal';
  const near = finite(s.rvn[i]) ? ` · ${pct(s.rvn[i])} las ${reader.cfg.nearBars} anteriores` : '';
  lines.push(`Volumen ${level} (${pct(x)} su hora${near}) · rango ${pct(y)} · resultado por esfuerzo ${pct(s.q[i])}`);
  const grade = (g) => `${Math.round(g * 100)}%`;
  if (s.absorbE[i] > 0.05) lines.push(`Esfuerzo sin resultado ${grade(s.absorbE[i])}: ${s.dir[i] > 0 ? 'la compra no avanza (debilidad)' : s.dir[i] < 0 ? 'la venta no avanza (fuerza)' : 'nadie avanza'}`);
  if (s.trap[i] > 0.05) lines.push(`Resultado sin esfuerzo ${grade(s.trap[i])}: movimiento sin volumen, posible trampa`);
  if (s.validE[i] > 0.05) lines.push(`Esfuerzo con resultado ${grade(s.validE[i])}: el volumen acompaña el rango`);
  if (s.invh[i] > 0.05) lines.push(`Martillo invertido ${grade(s.invh[i])}: estrella abajo del tramo, fuerza por confirmar`);
  else if (s.star[i] > 0.05) lines.push(`Estrella ${grade(s.star[i])}: debilidad`);
  if (s.hang[i] > 0.05) lines.push(`Hanging man ${grade(s.hang[i])}: martillo arriba del tramo, debilidad por confirmar`);
  else if (s.hammer[i] > 0.05) lines.push(`Martillo ${grade(s.hammer[i])}: fuerza`);
  if (s.doji[i] > 0.05) lines.push(`Doji de patas largas ${grade(s.doji[i])}${x < 1 ? ' con poco volumen: trampa, no giro' : ': indecisión'}`);
  if (s.fade[i] > 0.05) lines.push(`El esfuerzo se agota ${grade(s.fade[i])}: el precio sigue y el volumen cae`);
  const legText = s.leg[i] > 0 ? 'alcista' : 'bajista';
  lines.push(`Tramo ${legText} de ${finite(s.ext[i]) ? s.ext[i].toFixed(1) : '—'} ATR · medidor ${s.meter[i] >= 0 ? '+' : ''}${s.meter[i].toFixed(2)} (${s.meter[i] >= 0 ? 'fuerza' : 'debilidad'})`);
  return lines;
}
