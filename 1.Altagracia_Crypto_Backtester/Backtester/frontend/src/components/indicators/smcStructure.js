/**
 * Estructura SMC (20/11/2026): las ideas de Smart Money Concepts con reglas propias, escritas para App 1 y la suite sin
 * copiar el código de LuxAlgo (su licencia es CC BY-NC-SA: no comercial). Lógica pura, sin dibujo: la usa
 * SMCIndicator.js y la repite backend/smc.py para el probador de reglas (prueba de paridad en tests/smc.test.mjs).
 *
 * Todo con velas cerradas y en orden; cada pieza dice con qué vela se supo (`known`, un índice).
 *
 * - Pivotes de tramo: una vela es el extremo de su tramo cuando las `length` velas siguientes no la pasan; ahí el
 *   tramo cambia de sentido. Los máximos y mínimos alternan. Se sabe al cerrar la última de esas velas, `length` velas
 *   después: un pivote de 50 velas se dibuja en su vela, pero se supo 50 velas más tarde.
 * - Estructura interna (pivotes de 5) y mayor (de 50): un cierre más allá del último pivote sin romper es una
 *   ruptura. BOS si va a favor de la tendencia que había (o no había ninguna), CHoCH si la da vuelta. Se sabe al
 *   cerrar esa vela. Cada pivote se rompe una vez. La interna no repite una ruptura del mismo pivote que la mayor.
 * - Order block: al romper, la vela con el mínimo más bajo (ruptura alcista) entre el pivote roto y la ruptura, o la
 *   última vela contraria antes de ese mínimo. Su zona es la vela entera o su cuerpo. Vida: tocado (el precio vuelve
 *   a su borde), a la mitad, roto (un cierre, o una mecha, más allá de su borde lejano). Un OB roto pasa a breaker,
 *   del lado contrario, hasta que un cierre lo atraviesa de vuelta.
 * - Iguales (EQH/EQL): dos pivotes de 3 velas seguidos del mismo lado a menos de `threshold` ATR de 200 velas. Se
 *   saben con el segundo. Barrido: la primera vela que pasa el nivel; con regreso si cierra de vuelta.
 * - Rango (premium/discount): del último máximo mayor al último mínimo mayor, cada uno estirado por los precios que
 *   lo pasan después. Arriba de la mitad es premium; abajo, discount. Con la tendencia alcista el mínimo es fuerte y
 *   el máximo débil; con la bajista, al revés.
 * - Niveles anteriores: máximo y mínimo del día, la semana (desde el lunes) y el mes anteriores, en UTC, ya cerrados.
 */

import { atrOf } from './williams.js';

const SETTINGS_KEY = 'smc_settings_';

export function defaultSmcConfig() {
  return {
    internal: { show: true, length: 5, bos: true, choch: true },
    swing: { show: true, length: 50, bos: true, choch: true, labels: true },
    ob: {
      internal: true, internalCount: 5, swing: true, swingCount: 5,
      pick: 'extreme',     // 'extreme': la vela del extremo; 'opposite': la última vela contraria antes de él
      area: 'full',        // 'full': la vela entera; 'body': su cuerpo
      mitigation: 'close', // Qué rompe un OB: 'close' un cierre más allá; 'wick' una mecha
      showBroken: true,    // Los rotos siguen a la vista, tenues, hasta la vela que los rompió
      breakers: true,      // Un OB roto pasa a breaker del lado contrario
      showMid: true,
      realVolume: true     // POC y delta reales de la vela del OB, del almacén de trades (si la moneda lo tiene)
    },
    equal: { show: true, length: 3, threshold: 0.1, sweeps: true, liquidations: true }, // liquidations: lo liquidado cerca del nivel
    zones: { show: false, style: 'half' }, // 'half': arriba o abajo de la mitad; 'bands': franjas de 5% en los extremos
    strongWeak: { show: true },
    levels: { daily: false, weekly: false, monthly: false },
    showBefore: true,      // Punteado desde la vela de cada pieza hasta la vela en que se supo
    bullColor: '#089981',
    bearColor: '#F23645',
    obOpacity: 0.14
  };
}

export function mergeSmcConfig(saved = {}) {
  const base = defaultSmcConfig();
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = value && typeof value === 'object' ? { ...value, ...(saved?.[key] || {}) } : (saved?.[key] ?? value);
  }
  return out;
}

export function loadSmcSettings(symbol) {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY + symbol)) || {};
  } catch {
    return {};
  }
}

export function saveSmcSettings(symbol, settings) {
  try {
    localStorage.setItem(SETTINGS_KEY + symbol, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento los ajustes siguen vigentes hasta recargar
  }
}

const LIMITS = {
  internal: { length: [2, 50, true] },
  swing: { length: [5, 300, true] },
  ob: { internalCount: [0, 50, true], swingCount: [0, 50, true] },
  equal: { length: [2, 20, true], threshold: [0.01, 2] }
};

export function cleanSmcSettings(values) {
  const out = mergeSmcConfig(values);
  const base = defaultSmcConfig();
  for (const [section, limits] of Object.entries(LIMITS)) {
    for (const [key, [min, max, integer]] of Object.entries(limits)) {
      const number = parseFloat(out[section][key]);
      const value = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : base[section][key];
      out[section][key] = integer ? Math.round(value) : value;
    }
  }
  if (out.internal.length >= out.swing.length) out.internal.length = Math.max(2, Math.min(out.internal.length, out.swing.length - 1));
  if (!['extreme', 'opposite'].includes(out.ob.pick)) out.ob.pick = 'extreme';
  if (!['full', 'body'].includes(out.ob.area)) out.ob.area = 'full';
  if (!['close', 'wick'].includes(out.ob.mitigation)) out.ob.mitigation = 'close';
  if (!['half', 'bands'].includes(out.zones.style)) out.zones.style = 'half';
  const opacity = parseFloat(out.obOpacity);
  out.obOpacity = Number.isFinite(opacity) ? Math.min(0.6, Math.max(0.02, opacity)) : base.obOpacity;
  return out;
}

/** Pivotes de tramo: { type: 1 máximo / −1 mínimo, index, price, known }, alternados y en el orden en que se saben */
export function legPivots(h, l, length) {
  const n = h.length;
  const out = [];
  let leg = 0;
  for (let t = length; t < n; t += 1) {
    const c = t - length;
    let maxRight = -Infinity;
    let minRight = Infinity;
    for (let j = c + 1; j <= t; j += 1) {
      if (h[j] > maxRight) maxRight = h[j];
      if (l[j] < minRight) minRight = l[j];
    }
    if (leg >= 0 && h[c] > maxRight) {
      out.push({ type: 1, index: c, price: h[c], known: t });
      leg = -1;
    } else if (leg <= 0 && l[c] < minRight) {
      out.push({ type: -1, index: c, price: l[c], known: t });
      leg = 1;
    }
  }
  return out;
}

/** HH/LH para cada máximo y HL/LL para cada mínimo, contra el anterior del mismo lado */
function labelPivots(pivots) {
  let lastHigh = null;
  let lastLow = null;
  for (const p of pivots) {
    if (p.type > 0) {
      p.label = lastHigh === null ? null : (p.price > lastHigh ? 'HH' : 'LH');
      lastHigh = p.price;
    } else {
      p.label = lastLow === null ? null : (p.price < lastLow ? 'LL' : 'HL');
      lastLow = p.price;
    }
  }
}

/** La vela del order block entre el pivote roto y la ruptura (excluida) */
function orderBlockAt(bars, pivotIndex, breakIndex, dir, cfg) {
  const { o, h, l, c } = bars;
  const last = Math.max(pivotIndex, breakIndex - 1);
  let m = pivotIndex;
  for (let j = pivotIndex; j <= last; j += 1) {
    if (dir > 0 ? l[j] < l[m] : h[j] > h[m]) m = j;
  }
  if (cfg.pick === 'opposite') {
    for (let j = m; j >= pivotIndex; j -= 1) {
      if (dir > 0 ? c[j] < o[j] : c[j] > o[j]) {
        m = j;
        break;
      }
    }
  }
  let top = h[m];
  let bottom = l[m];
  if (cfg.area === 'body' && Math.max(o[m], c[m]) > Math.min(o[m], c[m])) {
    top = Math.max(o[m], c[m]);
    bottom = Math.min(o[m], c[m]);
  }
  return { index: m, top, bottom, mid: (top + bottom) / 2 };
}

/**
 * Estructura, order blocks, iguales y rango de velas cerradas (columnas de barsOf en williams.js).
 * Devuelve índices de esas columnas
 */
export function computeSmc(bars, config = defaultSmcConfig()) {
  const cfg = mergeSmcConfig(config);
  const { h, l, c } = bars;
  const n = h.length;
  const internalPivots = legPivots(h, l, cfg.internal.length);
  const swingPivots = legPivots(h, l, cfg.swing.length);
  labelPivots(swingPivots);
  labelPivots(internalPivots);

  const breaks = [];
  const obs = [];
  const bias = new Int8Array(n);       // Tendencia de la estructura mayor al cierre de cada vela
  const top = new Float64Array(n).fill(NaN);
  const bottom = new Float64Array(n).fill(NaN);
  const rangeStart = new Int32Array(n).fill(-1);

  const state = {
    internal: { pivots: internalPivots, next: 0, high: null, low: null, trend: 0 },
    swing: { pivots: swingPivots, next: 0, high: null, low: null, trend: 0 }
  };
  let trailTop = NaN;
  let trailBottom = NaN;
  let highAt = -1;
  let lowAt = -1;
  const live = [];   // Order blocks que todavía pueden cambiar

  for (let t = 0; t < n; t += 1) {
    // Vida de los order blocks ya creados
    for (let k = live.length - 1; k >= 0; k -= 1) {
      const ob = live[k];
      if (ob.known >= t) continue;
      if (ob.broken === null) {
        const reach = ob.dir > 0 ? l[t] : h[t];
        if (ob.touched === null && (ob.dir > 0 ? reach <= ob.top : reach >= ob.bottom)) ob.touched = t;
        if (ob.half === null && (ob.dir > 0 ? reach <= ob.mid : reach >= ob.mid)) ob.half = t;
        const through = cfg.ob.mitigation === 'wick' ? reach : c[t];
        if (ob.dir > 0 ? through < ob.bottom : through > ob.top) ob.broken = t;
      } else if (cfg.ob.breakers && ob.breakerEnd === null && ob.broken < t) {
        // Breaker: el OB roto del lado contrario, hasta que un cierre lo atraviesa de vuelta
        if (ob.breakerTouched === null && (ob.dir > 0 ? h[t] >= ob.bottom : l[t] <= ob.top)) ob.breakerTouched = t;
        if (ob.dir > 0 ? c[t] > ob.top : c[t] < ob.bottom) ob.breakerEnd = t;
      }
      if (ob.broken !== null && (!cfg.ob.breakers || ob.breakerEnd !== null)) live.splice(k, 1);
    }

    // Rupturas: primero la mayor, para que la interna no repita el mismo pivote
    for (const scope of ['swing', 'internal']) {
      const s = state[scope];
      const other = state.swing;
      for (const dir of [1, -1]) {
        const p = dir > 0 ? s.high : s.low;
        if (!p || p.crossed) continue;
        if (!(dir > 0 ? c[t] > p.price : c[t] < p.price)) continue;
        p.crossed = true;
        if (scope === 'internal') {
          const twin = dir > 0 ? other.high : other.low;
          if (twin && twin.index === p.index) continue;
        }
        const tag = s.trend === -dir ? 'CHoCH' : 'BOS';
        s.trend = dir;
        const ob = orderBlockAt(bars, p.index, t, dir, cfg.ob);
        breaks.push({ scope, dir, tag, price: p.price, pivot: p.index, index: t, known: t });
        const block = {
          scope, dir, ...ob, created: t, known: t, pivot: p.index,
          touched: null, half: null, broken: null, breakerTouched: null, breakerEnd: null
        };
        obs.push(block);
        live.push(block);
      }
    }

    // Pivotes que se saben al cerrar esta vela
    for (const scope of ['swing', 'internal']) {
      const s = state[scope];
      while (s.next < s.pivots.length && s.pivots[s.next].known === t) {
        const p = { ...s.pivots[s.next], crossed: false };
        if (p.type > 0) s.high = p;
        else s.low = p;
        if (scope === 'swing') {
          if (p.type > 0) {
            trailTop = p.price;
            highAt = p.index;
          } else {
            trailBottom = p.price;
            lowAt = p.index;
          }
        }
        s.next += 1;
      }
    }

    // El rango va del más viejo de los dos últimos pivotes mayores y se estira con los precios que pasan sus bordes
    if (Number.isFinite(trailTop)) trailTop = Math.max(trailTop, h[t]);
    if (Number.isFinite(trailBottom)) trailBottom = Math.min(trailBottom, l[t]);
    top[t] = trailTop;
    bottom[t] = trailBottom;
    rangeStart[t] = highAt >= 0 && lowAt >= 0 ? Math.min(highAt, lowAt) : -1;
    bias[t] = state.swing.trend;
  }

  // Iguales: pivotes cortos seguidos del mismo lado, casi al mismo precio
  const equals = [];
  {
    const atr = atrOf(h, l, c, 200);
    const eq = legPivots(h, l, cfg.equal.length);
    let lastHigh = null;
    let lastLow = null;
    for (const p of eq) {
      const previous = p.type > 0 ? lastHigh : lastLow;
      if (previous && Math.abs(p.price - previous.price) < cfg.equal.threshold * atr[p.known]) {
        const level = p.type > 0 ? Math.max(p.price, previous.price) : Math.min(p.price, previous.price);
        const item = { dir: p.type, first: previous.index, firstPrice: previous.price, index: p.index, price: p.price, level, known: p.known, swept: null, reclaimed: false };
        for (let u = p.known + 1; u < n; u += 1) {
          if (p.type > 0 ? h[u] > level : l[u] < level) {
            item.swept = u;
            item.reclaimed = p.type > 0 ? c[u] < level : c[u] > level;
            break;
          }
        }
        equals.push(item);
      }
      if (p.type > 0) lastHigh = p;
      else lastLow = p;
    }
  }

  return { n, internalPivots, swingPivots, breaks, obs, equals, top, bottom, rangeStart, bias };
}

const DAY = 86400000;
const WEEK_ANCHOR = 4 * DAY; // 05/01/1970 fue lunes: las semanas empiezan los lunes a las 00:00 UTC

/** Inicio del periodo (UTC) que contiene la hora */
export function periodStart(time, kind) {
  if (kind === 'day') return Math.floor(time / DAY) * DAY;
  if (kind === 'week') return Math.floor((time - WEEK_ANCHOR) / (7 * DAY)) * 7 * DAY + WEEK_ANCHOR;
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function nextPeriod(start, kind) {
  if (kind === 'day') return start + DAY;
  if (kind === 'week') return start + 7 * DAY;
  const date = new Date(start);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

/**
 * Máximo y mínimo de cada periodo cerrado, para dibujarlos en el periodo siguiente:
 * [{ start, end, high, low, highTime, lowTime }] del periodo que los muestra. El primer periodo de las velas no cuenta
 * como anterior (puede venir cortado); un fin de semana o un feriado no corta nada: el anterior es el último con velas
 */
export function previousLevels(candles, kind) {
  const periods = [];
  let current = null;
  for (const k of candles) {
    if (k.in_progress) break;
    const start = periodStart(k.timestamp, kind);
    if (!current || current.start !== start) {
      if (current) periods.push(current);
      current = { start, end: nextPeriod(start, kind), high: k.high, low: k.low, highTime: k.timestamp, lowTime: k.timestamp, first: k.timestamp, last: k.timestamp };
    } else {
      if (k.high > current.high) {
        current.high = k.high;
        current.highTime = k.timestamp;
      }
      if (k.low < current.low) {
        current.low = k.low;
        current.lowTime = k.timestamp;
      }
      current.last = k.timestamp;
    }
  }
  if (current) periods.push(current);
  const out = [];
  for (let i = 2; i < periods.length; i += 1) {
    const before = periods[i - 1];
    out.push({ start: periods[i].start, end: periods[i].end, high: before.high, low: before.low, highTime: before.highTime, lowTime: before.lowTime });
  }
  return out;
}
