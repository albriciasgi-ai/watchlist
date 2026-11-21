/**
 * Indicadores de Bill Williams (20/11/2026): los de Trading Chaos (2.ª ed., 2004) y los de conocimiento general de sus
 * otros libros. Lógica pura, sin dibujo: la usan los indicadores del gráfico (WilliamsIndicators.js) y la repite
 * backend/williams.py para el probador de reglas, operación por operación (prueba de paridad en tests/williams.test.mjs).
 *
 * Todo con velas cerradas y en orden. Nada mira el futuro: el valor de la vela i usa velas hasta i, y lo que se sabe
 * después lo dice su campo `known` (el índice de la vela con cuyo cierre se supo).
 *
 * - Alligator: tres medias suavizadas (SMMA de Wilder, sembrada con la media simple) del precio medio (H+L)/2:
 *   mandíbula de 13 desplazada 8, dientes de 8 desplazados 5 y labios de 5 desplazados 3 (el código de TradeStation del
 *   libro). El desplazamiento lleva el valor de una vela pasada a una posterior: no usa el futuro. Estado: despierto al
 *   alza con labios > dientes > mandíbula y una abertura de al menos `sleepAtr` ATR; a la baja, al revés; si no, duerme.
 * - AO: media simple de 5 del precio medio menos la de 34. Verde si sube respecto de la anterior, roja si baja; igual
 *   conserva el color. El texto del libro dice (H−L)/2 por error: su código usa (H+L)/2. AC: el AO menos su media de 5.
 * - Gator: arriba |mandíbula − dientes| y abajo −|dientes − labios|, con las líneas como se dibujan en la vela. Cada
 *   barra es verde si crece y roja si se achica.
 * - MFI: (máximo − mínimo) ÷ volumen. Verde: suben el MFI y el volumen; fade: bajan los dos; fake: sube el MFI y baja
 *   el volumen; squat: baja el MFI y sube el volumen. Un empate conserva la dirección anterior.
 * - Zonas: verde con el AO y el AC subiendo, roja con los dos bajando, gris lo demás.
 * - Fractal: un máximo con dos máximos estrictamente menores a su izquierda y dos a su derecha; los iguales de la
 *   derecha se saltan (el patrón D del libro). Se sabe al cierre del segundo menor de la derecha. Mínimo, al revés.
 * - Tres sabios:
 *   1. Barra divergente alcista: un mínimo más bajo que las `lookback` anteriores y cierre en la mitad de arriba,
 *      entera bajo las tres líneas, con angulación (el hueco entre la mandíbula y su máximo creció en `angBars` velas)
 *      y el AO rojo. Entrada stop en su máximo, stop en su mínimo. La bajista, al revés.
 *   2. AO: la tercera barra seguida de un color después de una del otro. Entrada stop pasando la vela.
 *   3. Fractal: el precio pasa el último fractal de su lado estando del lado correcto de los dientes.
 *   Las entradas de los dos primeros esperan `pendingBars` velas: se cancelan si antes se toca su stop, y una señal
 *   nueva del mismo sabio y lado reemplaza a la anterior.
 */

const SETTINGS_KEY = 'williams_settings_';

/** Los nombres de los ocho indicadores en la lista del gráfico (todos abren el mismo modal de ajustes) */
export const WILLIAMS_NAMES = ['Alligator', 'Fractales', 'Tres sabios', 'Zonas de Williams', 'AO', 'AC', 'Gator', 'MFI'];

export const WISE_NAMES = { 1: 'Barra divergente', 2: 'AO, tres barras', 3: 'Ruptura de fractal' };
export const MFI_TYPES = { 1: 'green', 2: 'fade', 3: 'fake', 4: 'squat' };
export const MFI_LABELS = { 1: 'Verde', 2: 'Fade', 3: 'Fake', 4: 'Squat' };

export function defaultWilliamsConfig() {
  return {
    alligator: {
      jawLen: 13, jawShift: 8, teethLen: 8, teethShift: 5, lipsLen: 5, lipsShift: 3,
      sleepAtr: 0.5,      // Abertura mínima (en ATR de 14) para decir que está despierto
      projection: true,   // Las líneas desplazadas siguen a la derecha de la última vela
      showState: true,    // Tira bajo las velas: verde despierto al alza, roja a la baja, gris dormido
      width: 1.5,
      jawColor: '#2962FF', teethColor: '#E53935', lipsColor: '#43A047'
    },
    fractals: {
      showUp: true, showDown: true,
      maxRight: 20,        // Velas a la derecha para confirmar un fractal con máximos iguales
      alligatorFilter: true, // En gris los que se supieron dentro de la boca (del lado equivocado de los dientes)
      upColor: '#089981', downColor: '#F23645'
    },
    ao: { fast: 5, slow: 34, showSuper: true, upColor: '#089981', downColor: '#F23645' },
    ac: { signal: 5, upColor: '#089981', downColor: '#F23645' },
    gator: { upColor: '#089981', downColor: '#F23645' },
    mfi: { squatOnPrice: true, green: '#00C853', fade: '#8D6E63', fake: '#2962FF', squat: '#EC407A' },
    zones: { mode: 'candles', green: '#00A65A', red: '#E0302F', gray: '#9E9E9E' },
    wise: {
      first: true, second: true, third: true,
      lookback: 1,       // Velas anteriores cuyo mínimo debe quedar arriba (barra divergente)
      angBars: 5,        // Velas hacia atrás para medir la angulación
      minGapAtr: 0,      // Hueco mínimo entre la vela y la mandíbula, en ATR de 14
      requireAo: true,   // El AO en contra en la barra divergente (rojo en la alcista)
      pendingBars: 5,    // Velas que espera la entrada stop de los sabios 1 y 2
      alligatorFilter: true, // El 3.º solo del lado correcto de los dientes
      showEntries: true, showStops: true,
      upColor: '#089981', downColor: '#F23645'
    }
  };
}

/** La configuración guardada sobre la de fábrica, por indicador */
export function mergeWilliamsConfig(saved = {}) {
  const base = defaultWilliamsConfig();
  return Object.fromEntries(Object.keys(base).map(key => [key, { ...base[key], ...(saved?.[key] || {}) }]));
}

export function loadWilliamsSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveWilliamsSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los ajustes siguen vigentes hasta recargar
  }
}

// Límites de los números del modal: [mínimo, máximo, entero]
const LIMITS = {
  alligator: { jawLen: [2, 200, true], jawShift: [0, 50, true], teethLen: [2, 200, true], teethShift: [0, 50, true],
    lipsLen: [2, 200, true], lipsShift: [0, 50, true], sleepAtr: [0, 10], width: [0.5, 4] },
  fractals: { maxRight: [2, 100, true] },
  ao: { fast: [1, 200, true], slow: [2, 500, true] },
  ac: { signal: [1, 200, true] },
  wise: { lookback: [1, 20, true], angBars: [1, 50, true], minGapAtr: [0, 10], pendingBars: [1, 100, true] }
};

/** Valores listos para aplicar: números dentro de su rango y la AO rápida más corta que la lenta */
export function cleanWilliamsSettings(values) {
  const out = mergeWilliamsConfig(values);
  for (const [section, limits] of Object.entries(LIMITS)) {
    const base = defaultWilliamsConfig()[section];
    for (const [key, [min, max, integer]] of Object.entries(limits)) {
      const number = parseFloat(out[section][key]);
      const value = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : base[key];
      out[section][key] = integer ? Math.round(value) : value;
    }
  }
  if (out.ao.fast >= out.ao.slow) out.ao = { ...out.ao, fast: defaultWilliamsConfig().ao.fast, slow: defaultWilliamsConfig().ao.slow };
  if (!['candles', 'strip'].includes(out.zones.mode)) out.zones.mode = 'candles';
  return out;
}

/** Velas cerradas como columnas */
export function barsOf(candles) {
  const n = candles.length;
  const bars = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  for (let i = 0; i < n; i += 1) {
    const k = candles[i];
    bars.t[i] = k.timestamp;
    bars.o[i] = k.open;
    bars.h[i] = k.high;
    bars.l[i] = k.low;
    bars.c[i] = k.close;
    bars.v[i] = k.volume ?? 0;
  }
  return bars;
}

const nanArray = (n) => new Float64Array(n).fill(NaN);

/** Media simple de n con suma corrida, desde el primer valor finito */
export function sma(values, n) {
  const len = values.length;
  const out = nanArray(len);
  let first = 0;
  while (first < len && !Number.isFinite(values[first])) first += 1;
  let sum = 0;
  for (let i = first; i < len; i += 1) {
    sum += values[i];
    if (i - first >= n) sum -= values[i - n];
    if (i - first >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Media suavizada de Wilder: la primera es la media simple de n; después (anterior × (n − 1) + valor) ÷ n */
export function smma(values, n) {
  const len = values.length;
  const out = nanArray(len);
  if (len < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += values[i];
  let previous = sum / n;
  out[n - 1] = previous;
  for (let i = n; i < len; i += 1) {
    previous = (previous * (n - 1) + values[i]) / n;
    out[i] = previous;
  }
  return out;
}

/** Rango verdadero promedio de Wilder desde la primera vela (el `_atr` del probador) */
export function atrOf(h, l, c, n = 14) {
  const len = h.length;
  const out = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const previous = i ? c[i - 1] : c[0];
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - previous), Math.abs(l[i] - previous));
    out[i] = i ? out[i - 1] + (tr - out[i - 1]) / n : tr;
  }
  return out;
}

/** El valor de `shift` velas antes: lo que se dibuja en la vela i */
export function shifted(raw, shift) {
  const out = nanArray(raw.length);
  for (let i = shift; i < raw.length; i += 1) out[i] = raw[i - shift];
  return out;
}

/** 1 si sube respecto de la anterior, −1 si baja; un empate conserva la dirección anterior; 0 sin dato */
export function directions(values) {
  const len = values.length;
  const out = new Int8Array(len);
  for (let i = 1; i < len; i += 1) {
    const a = values[i];
    const b = values[i - 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    out[i] = a > b ? 1 : a < b ? -1 : out[i - 1];
  }
  return out;
}

/** Fractales de cinco velas o más (los iguales de la derecha se saltan), en el orden en que se saben */
export function fractals(h, l, maxRight = 20) {
  const out = [];
  const open = [];
  for (let i = 0; i < h.length; i += 1) {
    for (let k = 0; k < open.length; k += 1) {
      const f = open[k];
      if (f.done) continue;
      const x = f.dir > 0 ? h[i] : l[i];
      if ((f.dir > 0 ? x > f.price : x < f.price) || i - f.index > maxRight) {
        f.done = true;
        continue;
      }
      if (f.dir > 0 ? x < f.price : x > f.price) {
        f.lower += 1;
        if (f.lower === 2) {
          out.push({ dir: f.dir, index: f.index, price: f.price, known: i });
          f.done = true;
        }
      }
    }
    for (let k = open.length - 1; k >= 0; k -= 1) if (open[k].done) open.splice(k, 1);
    if (i >= 2) {
      if (h[i] > h[i - 1] && h[i] > h[i - 2]) open.push({ dir: 1, index: i, price: h[i], lower: 0, done: false });
      if (l[i] < l[i - 1] && l[i] < l[i - 2]) open.push({ dir: -1, index: i, price: l[i], lower: 0, done: false });
    }
  }
  return out;
}

/** Abertura de las tres líneas en ATR: estado 1 despierto al alza, −1 a la baja, 0 duerme (o sin dato) */
export function alligatorState(jaw, teeth, lips, atr, sleepAtr) {
  const len = jaw.length;
  const out = new Int8Array(len);
  for (let i = 0; i < len; i += 1) {
    const J = jaw[i];
    const T = teeth[i];
    const L = lips[i];
    if (!Number.isFinite(J) || !Number.isFinite(T) || !Number.isFinite(L)) continue;
    const spread = Math.max(J, T, L) - Math.min(J, T, L);
    if (spread < sleepAtr * atr[i]) continue;
    if (L > T && T > J) out[i] = 1;
    else if (L < T && T < J) out[i] = -1;
  }
  return out;
}

/** El cierre de una entrada stop: llenada, tocado su stop antes, vencida o reemplazada por una señal nueva */
function resolveEntry(signal, bars, pendingBars, nextSame) {
  const { o, h, l } = bars;
  const n = h.length;
  const last = signal.index + pendingBars;
  for (let j = signal.index + 1; j < n && j <= last; j += 1) {
    if (nextSame !== null && j > nextSame) {
      signal.end = 'replaced';
      signal.endAt = nextSame;
      return;
    }
    if (signal.dir > 0 ? h[j] > signal.entry : l[j] < signal.entry) {
      signal.end = 'filled';
      signal.endAt = j;
      signal.filledAt = j;
      signal.fillPrice = signal.dir > 0 ? Math.max(signal.entry, o[j]) : Math.min(signal.entry, o[j]);
      return;
    }
    if (signal.dir > 0 ? l[j] < signal.stop : h[j] > signal.stop) {
      signal.end = 'stop';
      signal.endAt = j;
      return;
    }
  }
  if (last <= n - 1) {
    signal.end = 'expired';
    signal.endAt = last;
  }
}

/** Las señales de los tres sabios, en el orden de la vela con que se saben */
export function wiseMen(bars, lines, ao, aoDir, atr, fractalList, cfg) {
  const { o, h, l, c } = bars;
  const { jaw, teeth, lips } = lines;
  const n = h.length;
  const k = Math.max(1, Math.round(cfg.angBars));
  const back = Math.max(1, Math.round(cfg.lookback));
  const entries = [];

  for (let i = Math.max(back, k); i < n; i += 1) {
    const J = jaw[i];
    const T = teeth[i];
    const L = lips[i];
    if (cfg.first !== false && Number.isFinite(J) && Number.isFinite(T) && Number.isFinite(L) && Number.isFinite(jaw[i - k])) {
      const mid = (h[i] + l[i]) / 2;
      let lowest = Infinity;
      let highest = -Infinity;
      for (let j = 1; j <= back; j += 1) {
        lowest = Math.min(lowest, l[i - j]);
        highest = Math.max(highest, h[i - j]);
      }
      if (l[i] < lowest && c[i] > mid && h[i] < Math.min(J, T, L)) {
        const gap = J - h[i];
        const before = jaw[i - k] - h[i - k];
        if (gap > before && gap >= cfg.minGapAtr * atr[i] && (!cfg.requireAo || aoDir[i] === -1)) {
          entries.push({ wise: 1, dir: 1, index: i, known: i, entry: h[i], stop: l[i], gap: gap / atr[i] });
        }
      } else if (h[i] > highest && c[i] < mid && l[i] > Math.max(J, T, L)) {
        const gap = l[i] - J;
        const before = l[i - k] - jaw[i - k];
        if (gap > before && gap >= cfg.minGapAtr * atr[i] && (!cfg.requireAo || aoDir[i] === 1)) {
          entries.push({ wise: 1, dir: -1, index: i, known: i, entry: l[i], stop: h[i], gap: gap / atr[i] });
        }
      }
    }
    if (cfg.second !== false && i >= 3) {
      const s = aoDir[i];
      if (s !== 0 && aoDir[i - 1] === s && aoDir[i - 2] === s && aoDir[i - 3] === -s) {
        entries.push({ wise: 2, dir: s, index: i, known: i, entry: s > 0 ? h[i] : l[i], stop: s > 0 ? l[i] : h[i] });
      }
    }
  }

  // Cada entrada stop espera; la siguiente del mismo sabio y lado la reemplaza
  const following = new Map();
  for (let e = entries.length - 1; e >= 0; e -= 1) {
    const key = `${entries[e].wise}|${entries[e].dir}`;
    entries[e].next = following.has(key) ? following.get(key) : null;
    following.set(key, entries[e].index);
  }
  for (const signal of entries) {
    signal.end = null;
    signal.endAt = null;
    resolveEntry(signal, bars, Math.max(1, Math.round(cfg.pendingBars)), signal.next);
    delete signal.next;
  }

  // El tercero: el último fractal de cada lado queda esperando hasta que el precio lo pasa o llega otro
  const thirds = [];
  if (cfg.third !== false) {
    const pending = { 1: null, '-1': null };
    let f = 0;
    for (let j = 0; j < n; j += 1) {
      for (const dir of [1, -1]) {
        const p = pending[dir];
        if (!p) continue;
        if (!(dir > 0 ? h[j] > p.price : l[j] < p.price)) continue;
        const T = teeth[j];
        const valid = cfg.alligatorFilter === false || (Number.isFinite(T) && (dir > 0 ? p.price > T : p.price < T));
        if (valid) {
          let stop = dir > 0 ? Infinity : -Infinity;
          for (let q = Math.max(0, j - 5); q < j; q += 1) stop = dir > 0 ? Math.min(stop, l[q]) : Math.max(stop, h[q]);
          if (!Number.isFinite(stop)) stop = dir > 0 ? l[j] : h[j];
          thirds.push({
            wise: 3, dir, index: j, known: j, entry: p.price, stop, fractal: p.index, fractalKnown: p.known,
            end: 'filled', endAt: j, filledAt: j, fillPrice: dir > 0 ? Math.max(p.price, o[j]) : Math.min(p.price, o[j])
          });
        }
        pending[dir] = null;
      }
      while (f < fractalList.length && fractalList[f].known === j) {
        const fr = fractalList[f];
        pending[fr.dir] = fr;
        f += 1;
      }
    }
  }

  return [...entries, ...thirds].sort((a, b) => a.known - b.known || a.wise - b.wise || b.dir - a.dir);
}

/** Todos los indicadores de Williams sobre velas cerradas (columnas de barsOf) */
export function computeWilliams(bars, config = defaultWilliamsConfig()) {
  const cfg = mergeWilliamsConfig(config);
  const { h, l, c, v } = bars;
  const n = h.length;
  const med = new Float64Array(n);
  for (let i = 0; i < n; i += 1) med[i] = (h[i] + l[i]) / 2;
  const a = cfg.alligator;
  const jawRaw = smma(med, a.jawLen);
  const teethRaw = smma(med, a.teethLen);
  const lipsRaw = smma(med, a.lipsLen);
  const jaw = shifted(jawRaw, a.jawShift);
  const teeth = shifted(teethRaw, a.teethShift);
  const lips = shifted(lipsRaw, a.lipsShift);
  const atr = atrOf(h, l, c, 14);
  const state = alligatorState(jaw, teeth, lips, atr, a.sleepAtr);

  const fast = sma(med, cfg.ao.fast);
  const slow = sma(med, cfg.ao.slow);
  const ao = nanArray(n);
  for (let i = 0; i < n; i += 1) if (Number.isFinite(slow[i])) ao[i] = fast[i] - slow[i];
  const aoDir = directions(ao);
  const aoAvg = sma(ao, cfg.ac.signal);
  const ac = nanArray(n);
  for (let i = 0; i < n; i += 1) if (Number.isFinite(aoAvg[i])) ac[i] = ao[i] - aoAvg[i];
  const acDir = directions(ac);

  const zone = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (!aoDir[i] || !acDir[i]) continue;
    zone[i] = aoDir[i] === 1 && acDir[i] === 1 ? 1 : aoDir[i] === -1 && acDir[i] === -1 ? -1 : 0;
  }

  const gUp = nanArray(n);
  const gDown = nanArray(n);
  const gDownAbs = nanArray(n);
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(jaw[i]) && Number.isFinite(teeth[i])) gUp[i] = Math.abs(jaw[i] - teeth[i]);
    if (Number.isFinite(teeth[i]) && Number.isFinite(lips[i])) {
      gDownAbs[i] = Math.abs(teeth[i] - lips[i]);
      gDown[i] = -gDownAbs[i];
    }
  }
  const gUpDir = directions(gUp);
  const gDownDir = directions(gDownAbs);

  const mfi = nanArray(n);
  for (let i = 0; i < n; i += 1) if (v[i] > 0) mfi[i] = (h[i] - l[i]) / v[i];
  const mfiDir = directions(mfi);
  const volDir = directions(v);
  const mfiType = new Int8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!mfiDir[i] || !volDir[i]) continue;
    mfiType[i] = mfiDir[i] > 0 ? (volDir[i] > 0 ? 1 : 3) : (volDir[i] > 0 ? 4 : 2);
  }

  const fractalList = fractals(h, l, cfg.fractals.maxRight);
  const signals = wiseMen(bars, { jaw, teeth, lips }, ao, aoDir, atr, fractalList, cfg.wise);

  return {
    n, med, atr, jawRaw, teethRaw, lipsRaw, jaw, teeth, lips, state,
    ao, aoDir, ac, acDir, zone, gUp, gDown, gUpDir, gDownDir, mfi, mfiType, fractals: fractalList, signals
  };
}

/**
 * Valores provisionales de la vela en formación, sin guardarlos: AO, AC, zona y Gator con lo ocurrido hasta ahora.
 * El MFI de una vela sin cerrar no se da (su volumen todavía crece)
 */
export function formingValues(result, bars, candle, config = defaultWilliamsConfig()) {
  const cfg = mergeWilliamsConfig(config);
  const n = result?.n ?? 0;
  if (!candle || n < 2) return null;
  const median = (candle.high + candle.low) / 2;
  const average = (values, last, count, extra) => {
    if (last - count + 2 < 0) return NaN;
    let sum = extra;
    for (let i = last - count + 2; i <= last; i += 1) sum += values[i];
    return sum / count;
  };
  const ao = average(result.med, n - 1, cfg.ao.fast, median) - average(result.med, n - 1, cfg.ao.slow, median);
  const prevAo = result.ao[n - 1];
  const aoDir = Number.isFinite(ao) && Number.isFinite(prevAo) ? (ao > prevAo ? 1 : ao < prevAo ? -1 : result.aoDir[n - 1]) : 0;
  const ac = Number.isFinite(ao) ? ao - average(result.ao, n - 1, cfg.ac.signal, ao) : NaN;
  const prevAc = result.ac[n - 1];
  const acDir = Number.isFinite(ac) && Number.isFinite(prevAc) ? (ac > prevAc ? 1 : ac < prevAc ? -1 : result.acDir[n - 1]) : 0;
  const zone = aoDir && acDir ? (aoDir === 1 && acDir === 1 ? 1 : aoDir === -1 && acDir === -1 ? -1 : 0) : NaN;
  const a = cfg.alligator;
  const at = (raw, shift) => (n - shift >= 0 && n - shift < n ? raw[n - shift] : NaN);
  const jaw = at(result.jawRaw, a.jawShift);
  const teeth = at(result.teethRaw, a.teethShift);
  const lips = at(result.lipsRaw, a.lipsShift);
  const gUp = Math.abs(jaw - teeth);
  const gDownAbs = Math.abs(teeth - lips);
  const dir = (value, previous, carry) => (Number.isFinite(value) && Number.isFinite(previous) ? (value > previous ? 1 : value < previous ? -1 : carry) : 0);
  return {
    timestamp: candle.timestamp, ao, aoDir, ac, acDir, zone, jaw, teeth, lips,
    gUp, gDown: -gDownAbs, gUpDir: dir(gUp, result.gUp[n - 1], result.gUpDir[n - 1]),
    gDownDir: dir(gDownAbs, -result.gDown[n - 1], result.gDownDir[n - 1])
  };
}

function lowerBound(times, timestamp) {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

function candleLowerBound(candles, timestamp) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

const WARM = 1000;  // Velas antes de la vista: la SMMA de 13 olvida su arranque en unas 200 y el AO pide 38
const BLOCK = 200;  // Los bordes de la ventana van de a 200 velas: al desplazarse no se recalcula a cada paso

/**
 * Lo que comparten los indicadores de Williams de un gráfico: la configuración (una para todos) y el cálculo de la
 * ventana a la vista, que se hace una vez por cuadro aunque estén encendidos los ocho.
 */
export class WilliamsHub {
  constructor(symbol, interval) {
    this.symbol = symbol;
    this.interval = interval;
    this.config = mergeWilliamsConfig(loadWilliamsSettings(symbol));
    this.version = 0;
    this.key = null;
    this.view = null;
  }

  setConfig(config) {
    this.config = mergeWilliamsConfig({ ...this.config, ...config });
    this.version += 1;
    this.key = null;
  }

  /** El cálculo de la ventana que cubre la vista, solo con velas cerradas, y la vela en formación si la hay */
  window(visibleCandles, candles) {
    if (!visibleCandles?.length || !candles?.length) return null;
    let lastClosed = candles.length - 1;
    if (candles[lastClosed].in_progress) lastClosed -= 1;
    if (lastClosed < 2) return null;
    const firstVisible = Math.min(lastClosed, candleLowerBound(candles, visibleCandles[0].timestamp));
    const lastVisible = Math.min(lastClosed, candleLowerBound(candles, visibleCandles[visibleCandles.length - 1].timestamp));
    const start = Math.max(0, Math.floor((firstVisible - WARM) / BLOCK) * BLOCK);
    const end = Math.min(lastClosed, (Math.floor(lastVisible / BLOCK) + 2) * BLOCK - 1);
    const newest = candles[end];
    const key = `${this.version}|${candles[start].timestamp}|${newest.timestamp}|${end - start}|${newest.close}|${newest.high}|${newest.low}`;
    if (key !== this.key) {
      const bars = barsOf(candles.slice(start, end + 1));
      this.view = { bars, result: computeWilliams(bars, this.config), forming: null, formingValues: null };
      this.key = key;
    }
    const forming = end === lastClosed && candles[lastClosed + 1]?.in_progress ? candles[lastClosed + 1] : null;
    if (forming !== this.view.forming || (forming && this.view.formingStamp !== `${forming.high}|${forming.low}|${forming.close}`)) {
      this.view.forming = forming;
      this.view.formingStamp = forming ? `${forming.high}|${forming.low}|${forming.close}` : null;
      this.view.formingValues = forming ? formingValues(this.view.result, this.view.bars, forming, this.config) : null;
    }
    return this.view;
  }

  /** Índice de una vela en la ventana calculada, o −1 */
  indexOf(timestamp) {
    const times = this.view?.bars?.t;
    if (!times) return -1;
    const i = lowerBound(times, timestamp);
    return i < times.length && times[i] === timestamp ? i : -1;
  }
}
