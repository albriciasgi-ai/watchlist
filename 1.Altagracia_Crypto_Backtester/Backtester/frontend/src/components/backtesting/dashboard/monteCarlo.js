// Monte Carlo de trades (23/11/2026, pedido del usuario tras el análisis de LuxAlgo Quant): con los resultados de los
// trades ya hechos, cuánto pudo cambiar la curva por puro orden y suerte. Sin React ni navegador: se prueba en Node
// (tests/montecarlo.test.mjs). Lo usan el dashboard de App 1, el del journal de la suite y el probador de reglas.
//
// Dos métodos:
// - 'resample' (de fábrica): cada corrida saca N trades al azar de los N reales, con repetición. Cambia el resultado
//   final y la caída: dice entre qué valores pudo quedar una serie igual de larga con trades como estos.
// - 'shuffle': los mismos trades en otro orden. El resultado final no cambia; cambian la caída y las rachas.
//
// Lo que NO dice: si la ventaja es real. Parte de que los trades futuros se parecen a los pasados y de que no dependen
// unos de otros; con pocos trades, las bandas son tan inciertas como la muestra. Por eso `small` avisa bajo 30.

export const SMALL_SAMPLE = 30;
export const DEFAULT_RUNS = 2000;
const MAX_POINTS = 120; // Puntos de la curva que se guardan por corrida: con miles de trades, las bandas se muestrean

/** Generador con semilla (mulberry32): la misma semilla da las mismas corridas, así el widget no baila al redibujar */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla que sale de los propios resultados: cambia solo si cambian los trades */
export function seedOf(values) {
  let h = 2166136261;
  for (const v of values) {
    h ^= Math.round(v * 1000) | 0;
    h = Math.imul(h, 16777619);
  }
  return (h ^ values.length) >>> 0;
}

/** Percentil p (0 a 1) de un arreglo ya ordenado, con interpolación lineal */
export function quantile(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const at = Math.min(n - 1, Math.max(0, p * (n - 1)));
  const low = Math.floor(at);
  const high = Math.min(n - 1, low + 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** Mayor caída desde un pico y racha más larga de pérdidas de una serie de resultados, empezando en 0 */
export function pathStats(values) {
  let cum = 0;
  let peak = 0;
  let drawdown = 0;
  let streak = 0;
  let worstStreak = 0;
  for (const v of values) {
    cum += v;
    if (cum > peak) peak = cum;
    if (peak - cum > drawdown) drawdown = peak - cum;
    if (v < 0) {
      streak += 1;
      if (streak > worstStreak) worstStreak = streak;
    } else {
      streak = 0;
    }
  }
  return { final: cum, drawdown, streak: worstStreak };
}

/** Índices (1 a n) donde se guarda la curva: todos si caben, o repartidos parejo y siempre con el último */
export function checkpoints(n, max = MAX_POINTS) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i + 1);
  const out = [];
  for (let k = 1; k <= max; k++) out.push(Math.round((k * n) / max));
  return [...new Set(out)];
}

/**
 * Los trades por bloque (la semana de su salida, por ejemplo), en el orden en que aparece cada bloque. Con menos de 2
 * bloques no hay nada que barajar por bloques: se devuelve null y se trabaja trade por trade
 */
export function blocksOf(values, groups) {
  if (!groups) return null;
  const index = new Map();
  const blocks = [];
  values.forEach((v, i) => {
    const key = groups[i];
    if (!index.has(key)) {
      index.set(key, blocks.length);
      blocks.push([]);
    }
    blocks[index.get(key)].push(v);
  });
  return blocks.length >= 2 ? blocks : null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Los trades del probador (objetos con exit_t y r, o ternas [entrada, salida, R]) como resultados en orden de salida,
 * con la semana de cada salida para remuestrear por bloques: los trades que salen la misma semana (sobre todo entre
 * monedas) se mueven juntos, y tratarlos como independientes daría bandas demasiado angostas
 */
export function resultsByExit(trades) {
  const list = (trades || []).map(t => (Array.isArray(t) ? { exit_t: t[1], r: t[2] } : t))
    .filter(t => t && Number.isFinite(t.r) && Number.isFinite(t.exit_t))
    .sort((a, b) => a.exit_t - b.exit_t);
  return { results: list.map(t => t.r), weeks: list.map(t => Math.floor(t.exit_t / WEEK_MS)) };
}

const bandOf = (sorted) => ({
  p5: quantile(sorted, 0.05),
  p25: quantile(sorted, 0.25),
  p50: quantile(sorted, 0.5),
  p75: quantile(sorted, 0.75),
  p95: quantile(sorted, 0.95),
});

/**
 * Corre el Monte Carlo sobre los resultados de los trades (en dólares o en R, en su orden real).
 * @param {number[]} results - un resultado por trade; lo que no sea un número finito se salta
 * @param {{runs?: number, method?: 'resample'|'shuffle', seed?: number, groups?: any[]}} options - groups: el bloque de
 *   cada trade (uno por resultado); con él se remuestrean o barajan bloques enteros en vez de trades sueltos
 * @returns {null | {
 *   n, runs, method, small, blocks,     // blocks: cuántos bloques hubo, o null trade por trade
 *   at: number[],                       // número de trade de cada punto de las bandas
 *   bands: {p5,p25,p50,p75,p95}[],      // resultado acumulado en cada punto
 *   actual: number[],                   // la curva real en esos mismos puntos
 *   final: {p5,p25,p50,p75,p95},        // resultado final
 *   drawdown: {p5,p25,p50,p75,p95},     // mayor caída desde un pico
 *   streak: {p50,p95},                  // racha más larga de pérdidas
 *   lossShare: number,                  // parte de las corridas que termina en negativo (0 a 1)
 *   real: {final, drawdown, streak},    // lo que pasó de verdad
 *   drawdownRank: number                // parte de las corridas con una caída menor o igual a la real (0 a 1)
 * }}
 */
export function monteCarlo(results, options = {}) {
  const keep = (results || []).map((v, i) => (Number.isFinite(v) ? i : -1)).filter(i => i >= 0);
  const values = keep.map(i => results[i]);
  const groups = Array.isArray(options.groups) && options.groups.length === (results || []).length
    ? keep.map(i => options.groups[i]) : null;
  const n = values.length;
  if (n < 2) return null;
  const runs = Math.max(100, Math.min(20000, Math.round(options.runs || DEFAULT_RUNS)));
  const method = options.method === 'shuffle' ? 'shuffle' : 'resample';
  const random = seeded(options.seed ?? seedOf(values));

  const at = checkpoints(n);
  const points = at.length;
  const curves = new Float64Array(runs * points);
  const finals = new Float64Array(runs);
  const drawdowns = new Float64Array(runs);
  const streaks = new Float64Array(runs);
  const seq = new Float64Array(n);
  const blocks = blocksOf(values, groups);
  let losses = 0;

  for (let run = 0; run < runs; run++) {
    if (blocks) {
      // Por bloques (semanas): los trades de un mismo bloque van siempre juntos y en su orden
      const count = blocks.length;
      let filled = 0;
      if (method === 'shuffle') {
        const order = Array.from({ length: count }, (_, i) => i);
        for (let i = count - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        for (const b of order) for (const v of blocks[b]) seq[filled++] = v;
      } else {
        while (filled < n) {
          const block = blocks[Math.floor(random() * count)];
          for (let k = 0; k < block.length && filled < n; k++) seq[filled++] = block[k];
        }
      }
    } else if (method === 'shuffle') {
      seq.set(values);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const swap = seq[i];
        seq[i] = seq[j];
        seq[j] = swap;
      }
    } else {
      for (let i = 0; i < n; i++) seq[i] = values[Math.floor(random() * n)];
    }
    let cum = 0;
    let peak = 0;
    let drawdown = 0;
    let streak = 0;
    let worstStreak = 0;
    let point = 0;
    for (let i = 0; i < n; i++) {
      const v = seq[i];
      cum += v;
      if (cum > peak) peak = cum;
      if (peak - cum > drawdown) drawdown = peak - cum;
      if (v < 0) {
        streak += 1;
        if (streak > worstStreak) worstStreak = streak;
      } else {
        streak = 0;
      }
      if (i + 1 === at[point]) {
        curves[run * points + point] = cum;
        point += 1;
      }
    }
    finals[run] = cum;
    drawdowns[run] = drawdown;
    streaks[run] = worstStreak;
    if (cum < 0) losses += 1;
  }

  const column = new Float64Array(runs);
  const bands = [];
  for (let point = 0; point < points; point++) {
    for (let run = 0; run < runs; run++) column[run] = curves[run * points + point];
    bands.push(bandOf(Float64Array.from(column).sort()));
  }

  const actual = [];
  let cum = 0;
  let point = 0;
  for (let i = 0; i < n; i++) {
    cum += values[i];
    if (i + 1 === at[point]) {
      actual.push(cum);
      point += 1;
    }
  }

  const real = pathStats(values);
  const sortedDrawdowns = Float64Array.from(drawdowns).sort();
  let below = 0;
  for (let run = 0; run < runs; run++) if (drawdowns[run] <= real.drawdown + 1e-12) below += 1;
  const sortedStreaks = Float64Array.from(streaks).sort();

  return {
    n,
    runs,
    method,
    blocks: blocks ? blocks.length : null,
    small: n < SMALL_SAMPLE || (blocks !== null && blocks.length < SMALL_SAMPLE),
    at,
    bands,
    actual,
    final: bandOf(Float64Array.from(finals).sort()),
    drawdown: bandOf(sortedDrawdowns),
    streak: { p50: quantile(sortedStreaks, 0.5), p95: quantile(sortedStreaks, 0.95) },
    lossShare: losses / runs,
    real,
    drawdownRank: below / runs,
  };
}
