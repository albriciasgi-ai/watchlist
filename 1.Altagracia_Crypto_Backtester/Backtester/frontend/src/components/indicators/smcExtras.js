import { API_BASE_URL } from '../../config.js';

/**
 * Lo que la Estructura SMC suma con los datos de App 1 (20/11/2026), que el indicador de TradingView no tiene:
 * - El volumen real de la vela de cada order block: su POC (el precio donde más se negoció) y su delta, del almacén de
 *   trades (/api/orderflow/historical). Solo en las monedas con almacén; en las demás no se dibuja nada.
 * - Las liquidaciones reales cerca de cada par de iguales (EQH/EQL): lo liquidado a `pct` % de su nivel en los 30
 *   días antes de saberse, de /api/liquidations, cortado en la hora a la vista.
 * Los dos piden poco: un pedido por vela de order block (con caché) y las liquidaciones por tramos que se suman.
 */

const MAX_PARALLEL = 3;
const LIQ_LOOKBACK_MS = 30 * 86400000;
const LIQ_GAP_MS = 2000;   // Un pedido de liquidaciones cada 2 s a lo sumo
export const LIQ_NEAR_PCT = 0.15;

/** Un step redondo para unas 30 franjas en la vela: el POC sale fino aunque la vela sea ancha */
export function footprintStep(high, low) {
  const raw = Math.max(1e-9, (high - low) / 30);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit >= 7.5 ? 10 : unit >= 3.5 ? 5 : unit >= 1.5 ? 2 : 1) * power;
}

/** Lo que el footprint de una vela dice de su POC y su delta */
export function obVolumeFrom(footprint) {
  if (!footprint || !(footprint.total_volume > 0)) return null;
  return { poc: footprint.poc_price ?? footprint.poc, delta: footprint.total_delta ?? footprint.delta, volume: footprint.total_volume };
}

export class ObVolume {
  constructor(symbol) {
    this.symbol = symbol;
    this.cache = new Map();
    this.queue = [];
    this.running = 0;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
  }

  /** POC y delta de la vela del OB, o null mientras no llega (o si la moneda no tiene almacén) */
  get(tfMinutes, candle, requestRedraw) {
    const key = `${tfMinutes}|${candle.t}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit === 'pending' ? null : hit;
    this.cache.set(key, 'pending');
    this.queue.push({ key, tfMinutes, candle, requestRedraw });
    this._pump();
    return null;
  }

  _pump() {
    while (!this.disposed && this.running < MAX_PARALLEL && this.queue.length) {
      const job = this.queue.shift();
      this.running += 1;
      const close = job.candle.t + job.tfMinutes * 60000;
      const params = new URLSearchParams({
        interval: String(job.tfMinutes), start_timestamp: String(job.candle.t), end_timestamp: String(close - 1),
        known_until: String(close), step: String(footprintStep(job.candle.h, job.candle.l))
      });
      fetch(`${API_BASE_URL}/api/orderflow/historical/${this.symbol}?${params}`)
        .then(response => (response.ok ? response.json() : null))
        .then(data => {
          const footprint = data?.success ? (data.footprints || []).find(fp => fp.candle_timestamp === job.candle.t) : null;
          this.cache.set(job.key, obVolumeFrom(footprint));
        })
        .catch(() => this.cache.set(job.key, null))
        .finally(() => {
          this.running -= 1;
          if (this.cache.size > 400) this.cache.clear();
          if (!this.disposed) job.requestRedraw?.();
          this._pump();
        });
    }
  }
}

/**
 * USD liquidado cerca de un nivel: celdas [desde, hasta, se sabe, bajo, alto, largos, cortos, fuente] que tocan
 * nivel ± pct %, sabidas a la hora `knownTime` o antes y de los 30 días anteriores
 */
export function liquidatedNear(cells, level, knownTime, pct = LIQ_NEAR_PCT) {
  const low = level * (1 - pct / 100);
  const high = level * (1 + pct / 100);
  let sum = 0;
  for (const c of cells) {
    if (c[2] > knownTime || c[1] < knownTime - LIQ_LOOKBACK_MS) continue;
    if (c[4] < low || c[3] > high) continue;
    sum += (c[5] || 0) + (c[6] || 0);
  }
  return sum;
}

export class EqLiquidations {
  constructor(symbol) {
    this.symbol = symbol;
    this.cells = [];
    this.from = null;   // Tramo pedido: [from, to]
    this.to = null;
    this.loading = false;
    this.lastAt = 0;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }

  /** Las celdas cubren [from, to]? Si no, pide lo que falta (todo si cambia el inicio, solo lo nuevo si avanza) */
  ensure(from, to, requestRedraw) {
    const covered = this.from !== null && from >= this.from && to <= this.to;
    if (covered || this.loading || this.disposed) return covered;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastAt < LIQ_GAP_MS) return false;
    const extend = this.from !== null && from >= this.from && to > this.to;
    const start = extend ? this.to : from;
    this.loading = true;
    this.lastAt = now;
    const params = new URLSearchParams({ start_timestamp: String(Math.floor(start - LIQ_LOOKBACK_MS)), end_timestamp: String(Math.floor(to)), known_until: String(Math.floor(to)) });
    fetch(`${API_BASE_URL}/api/liquidations/${this.symbol}?${params}`)
      .then(response => (response.ok ? response.json() : null))
      .then(result => {
        const cells = result?.success && Array.isArray(result.cells) ? result.cells : [];
        if (extend) {
          const seen = new Set(this.cells.map(c => `${c[0]}|${c[3]}|${c[7]}`));
          for (const c of cells) if (!seen.has(`${c[0]}|${c[3]}|${c[7]}`)) this.cells.push(c);
        } else {
          this.cells = cells;
          this.from = from;
        }
        this.to = to;
      })
      .catch(() => {})
      .finally(() => {
        this.loading = false;
        if (!this.disposed) requestRedraw?.();
      });
    return false;
  }

  near(level, knownTime) {
    if (this.from === null || knownTime < this.from || knownTime > this.to) return null;
    return liquidatedNear(this.cells, level, knownTime);
  }
}
