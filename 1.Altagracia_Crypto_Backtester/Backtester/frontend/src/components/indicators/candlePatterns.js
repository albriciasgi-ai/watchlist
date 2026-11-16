// candlePatterns.js - Regla de los patrones de vela de "Rejection Patterns" (16/11/2026).
//
// Una sola regla para los dos detectores: el del navegador (modo "todos", LocalPatternDetector.js) y el del servidor
// (modo "validado" y la suite, backend/candle_patterns.py, que la repite línea por línea). Un cambio se hace en los dos
// y se corre backend/tests/test_candle_patterns.py, que compara los dos con node.
//
// Por qué (auditoría del 16/11 con 1000 velas reales de BTC por marco):
// - en cripto cada vela abre donde cerró la anterior: el envolvente del servidor, con comparaciones estrictas, nunca
//   salía; el del navegador, con empates y sin cuerpo mínimo, salía en el 26% de las velas (también con dojis);
// - la mecha contraria se medía contra el cuerpo y no contra el rango: se perdía casi la mitad de los martillos;
// - ningún detector miraba la tendencia previa: un martillo tras una subida (hanging man) se marcaba igual.
//
// Formas (Nison, Bulkowski), con rango = máximo − mínimo:
// - Doji: cuerpo ≤ 5% del rango. Libélula: mecha de arriba ≤ 10% del rango; lápida: mecha de abajo ≤ 10%.
// - Martillo: no es doji, cuerpo ≤ 33% del rango, mecha de abajo ≥ minWickRatio cuerpos (2) y la de arriba ≤ 10%
//   del rango. Estrella fugaz: lo mismo al revés.
// - Envolvente: colores opuestos, la vela anterior con cuerpo de al menos 10% de su rango (no un doji), la actual
//   con al menos 30% del suyo, su cuerpo más grande que el anterior y cubriéndolo (un empate en un borde vale: la
//   apertura suele ser el cierre anterior).
// - Una vela tiene a lo sumo un patrón: doji, si no envolvente, si no martillo o estrella.
// Contexto (opcionales, de fábrica encendidos o apagados según la opción):
// - Tendencia previa (requireTrend, de fábrica sí; trendBars 5): los alcistas (martillo, libélula, envolvente alcista)
//   piden que el cierre anterior esté por debajo del de 5 velas antes; los bajistas, por encima.
// - Volumen (volume.enabled): z-score del volumen de la vela contra las `lookback` velas anteriores (sin la vela,
//   desviación de la población) de al menos minZScore. Sin velas suficientes, la vela no cuenta.

export const SHAPE = { dojiBody: 0.05, maxBody: 0.33, oppositeWick: 0.10, engulfedMinBody: 0.10, engulfingMinBody: 0.30 };
export const BULLISH = new Set(['HAMMER', 'DOJI_DRAGONFLY', 'ENGULFING_BULLISH']);

const parts = (c) => {
  const top = Math.max(c.open, c.close);
  const bottom = Math.min(c.open, c.close);
  return { range: c.high - c.low, body: top - bottom, upper: c.high - top, lower: bottom - c.low, top, bottom };
};

/** La forma de una vela (con la anterior, para el envolvente), sin contexto. null si no es ninguna */
export function shapeOf(prev, cur, minWickRatio = 2.0, enabled = {}) {
  const on = (key) => enabled[key] !== false;
  const k = parts(cur);
  if (!(k.range > 0)) return null;
  if (k.body <= SHAPE.dojiBody * k.range) {
    if (!on('doji')) return null;
    if (k.upper <= SHAPE.oppositeWick * k.range) return 'DOJI_DRAGONFLY';
    if (k.lower <= SHAPE.oppositeWick * k.range) return 'DOJI_GRAVESTONE';
    return null;
  }
  if (prev && on('engulfing')) {
    const p = parts(prev);
    const prevBull = prev.close > prev.open;
    const curBull = cur.close > cur.open;
    if (p.range > 0 && prevBull !== curBull && prev.close !== prev.open
        && p.body >= SHAPE.engulfedMinBody * p.range && k.body >= SHAPE.engulfingMinBody * k.range
        && k.body > p.body && k.bottom <= p.bottom && k.top >= p.top) {
      return curBull ? 'ENGULFING_BULLISH' : 'ENGULFING_BEARISH';
    }
  }
  if (k.body <= SHAPE.maxBody * k.range) {
    if (on('hammer') && k.lower >= minWickRatio * k.body && k.upper <= SHAPE.oppositeWick * k.range) return 'HAMMER';
    if (on('shootingStar') && k.upper >= minWickRatio * k.body && k.lower <= SHAPE.oppositeWick * k.range) return 'SHOOTING_STAR';
  }
  return null;
}

/** Z-score del volumen de la vela i contra las `lookback` anteriores (sin ella). null sin velas suficientes */
export function volumeZ(candles, i, lookback = 20) {
  if (i < lookback) return null;
  let sum = 0;
  for (let j = i - lookback; j < i; j++) sum += Number(candles[j].volume) || 0;
  const mean = sum / lookback;
  let sq = 0;
  for (let j = i - lookback; j < i; j++) sq += ((Number(candles[j].volume) || 0) - mean) ** 2;
  const std = Math.sqrt(sq / lookback);
  if (std === 0) return 0;
  return ((Number(candles[i].volume) || 0) - mean) / std;
}

/** Si la tendencia previa acompaña al patrón: bajista antes de uno alcista, alcista antes de uno bajista */
export function trendFits(candles, i, type, bars = 5) {
  if (i - 1 - bars < 0) return false;
  const last = candles[i - 1].close;
  const before = candles[i - 1 - bars].close;
  return BULLISH.has(type) ? last < before : last > before;
}

/** Opciones de la regla a partir de la configuración del indicador (la misma forma en los dos detectores) */
export function ruleOptions(config = {}) {
  const p = config.patterns || {};
  const v = config.volumeZScore || {};
  return {
    minWickRatio: Number(p.hammer?.minWickRatio ?? p.shootingStar?.minWickRatio ?? 2.0) || 2.0,
    enabled: {
      hammer: p.hammer?.enabled !== false, shootingStar: p.shootingStar?.enabled !== false,
      engulfing: p.engulfing?.enabled !== false, doji: !!p.doji?.enabled,
    },
    requireTrend: config.filters?.requireTrend !== false,
    trendBars: Math.max(1, Math.round(Number(config.filters?.trendBars) || 5)),
    volume: { enabled: !!v.enabled, lookback: Math.max(2, Math.round(Number(v.lookbackPeriod) || 20)), minZ: Number(v.minZScore ?? 1.0) },
  };
}

/** Los patrones de una lista de velas cerradas, en orden: [{index, type, volumeZ}] */
export function findPatterns(candles, opts) {
  const out = [];
  for (let i = 1; i < (candles?.length || 0); i++) {
    const type = shapeOf(candles[i - 1], candles[i], opts.minWickRatio, opts.enabled);
    if (!type) continue;
    if (opts.requireTrend && !trendFits(candles, i, type, opts.trendBars)) continue;
    const z = volumeZ(candles, i, opts.volume.lookback);
    if (opts.volume.enabled && (z === null || z < opts.volume.minZ)) continue;
    out.push({ index: i, type, volumeZ: z });
  }
  return out;
}
