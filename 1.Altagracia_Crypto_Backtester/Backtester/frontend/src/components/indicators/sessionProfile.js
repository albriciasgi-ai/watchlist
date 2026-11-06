import { API_BASE_URL } from '../../config.js';

// Perfiles por sesión para VP Periodic.

const HOUR = 3600000;
const MONDAY_OFFSET = 4 * 24 * HOUR; // El 1 de enero de 1970 fue jueves
const MIN_REAL_COVERAGE = 0.99;
const REQUEST_GAP_MS = 150;
const MAX_CACHED_PROFILES = 400;

export const SESSION_OPTIONS = [[4, '4 horas'], [8, '8 horas'], [12, '12 horas'], [24, '1 día'], [168, '1 semana']];

export const sessionLength = (hours) => hours * HOUR;

/** Inicio de la sesión en UTC. La semana empieza el lunes */
export function sessionStart(timestamp, hours) {
  const length = sessionLength(hours);
  const anchor = hours === 168 ? MONDAY_OFFSET : 0;
  return Math.floor((timestamp - anchor) / length) * length + anchor;
}

function firstIndexFrom(candles, timestamp) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Velas que empiezan entre start y end */
export function candlesBetween(candles, start, end) {
  return candles.slice(firstIndexFrom(candles, start), firstIndexFrom(candles, end));
}

/** Perfil de un grupo de velas. volumes trae el volumen real por franja; sin él se reparte por vela */
export function buildProfile(candles, rows, valueAreaShare, volumes = null) {
  if (!candles?.length) return null;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const candle of candles) {
    minPrice = Math.min(minPrice, candle.low);
    maxPrice = Math.max(maxPrice, candle.high);
  }
  if (!(maxPrice > minPrice)) return null;

  const step = (maxPrice - minPrice) / rows;
  const levels = Array.from({ length: rows }, (_, i) => ({
    price: minPrice + step * (i + 0.5),
    levelLow: minPrice + step * i,
    levelHigh: minPrice + step * (i + 1),
    volume: volumes ? volumes[i] : 0,
    isValueArea: false
  }));

  if (!volumes) {
    for (const candle of candles) {
      const size = candle.high - candle.low;
      const first = Math.min(rows - 1, Math.floor((candle.low - minPrice) / step));
      const last = Math.min(rows - 1, Math.floor((candle.high - minPrice) / step));
      if (size <= 0) {
        levels[first].volume += candle.volume;
        continue;
      }
      for (let i = first; i <= last; i++) {
        const overlap = Math.min(candle.high, levels[i].levelHigh) - Math.max(candle.low, levels[i].levelLow);
        if (overlap > 0) levels[i].volume += candle.volume * (overlap / size);
      }
    }
  }

  let totalVolume = 0;
  let pocIndex = 0;
  levels.forEach((level, i) => {
    totalVolume += level.volume;
    if (level.volume > levels[pocIndex].volume) pocIndex = i;
  });

  // Value area: crece desde el POC hacia la franja vecina con más volumen
  let lowIndex = pocIndex;
  let highIndex = pocIndex;
  let covered = levels[pocIndex].volume;
  while (covered < totalVolume * valueAreaShare && (lowIndex > 0 || highIndex < rows - 1)) {
    const below = lowIndex > 0 ? levels[lowIndex - 1].volume : -1;
    const above = highIndex < rows - 1 ? levels[highIndex + 1].volume : -1;
    if (below > above) {
      lowIndex -= 1;
      covered += below;
    } else {
      highIndex += 1;
      covered += above;
    }
  }
  for (let i = lowIndex; i <= highIndex; i++) levels[i].isValueArea = true;

  return {
    levels,
    poc: { index: pocIndex, price: levels[pocIndex].price, volume: levels[pocIndex].volume },
    valueArea: { lowIndex, highIndex, vahPrice: levels[highIndex].price, valPrice: levels[lowIndex].price },
    minPrice,
    maxPrice,
    totalVolume,
    maxVolume: levels[pocIndex].volume,
    isReal: !!volumes
  };
}

export class SessionProfiles {
  constructor(symbol) {
    this.symbol = symbol;
    this.profiles = new Map();
    this.realVolumes = new Map();
    this.requested = new Set();
    this.queue = [];
    this.busy = false;
  }

  /**
   * Perfil de una sesión: estimado con las velas y real si el almacén la cubre.
   * Solo una sesión terminada se pide al almacén, porque la actual todavía cambia.
   */
  get({ start, end, candles, rows, valueAreaShare, knownUntil, requestRedraw }) {
    if (!candles?.length) return null;

    const closed = end <= knownUntil;
    const realKey = `${start}|${end}|${rows}`;
    const real = closed ? this.realVolumes.get(realKey) : null;
    const last = candles[candles.length - 1];
    const key = `${realKey}|${valueAreaShare}|${candles.length}|${last.close}|${last.volume}|${real ? 'real' : 'estimado'}`;

    if (!this.profiles.has(key)) {
      this.profiles.set(key, buildProfile(candles, rows, valueAreaShare, real));
      if (this.profiles.size > MAX_CACHED_PROFILES) this.profiles.delete(this.profiles.keys().next().value);
    }

    const profile = this.profiles.get(key);
    if (profile && closed && !real) this._request({ realKey, start, end, rows, profile, requestRedraw });
    return profile;
  }

  _request(item) {
    if (this.requested.has(item.realKey)) return;
    this.requested.add(item.realKey);
    this.queue.push(item);
    this._next();
  }

  // Una petición a la vez, la sesión más reciente primero
  _next() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;

    const { realKey, start, end, rows, profile, requestRedraw } = this.queue.pop();
    const params = new URLSearchParams({
      start_timestamp: String(start),
      end_timestamp: String(end),
      low: String(profile.minPrice),
      high: String(profile.maxPrice),
      rows: String(rows),
      known_until: String(end)
    });

    fetch(`${API_BASE_URL}/api/orderflow/profile/${this.symbol}?${params}`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!data?.success || !data.expected_minutes) return;
        if (data.minutes / data.expected_minutes < MIN_REAL_COVERAGE) return;
        this.realVolumes.set(realKey, data.buy.map((buy, i) => buy + data.sell[i]));
        requestRedraw?.();
      })
      .catch(error => console.warn(`[${this.symbol}] Perfil real de la sesión no disponible:`, error.message))
      .finally(() => {
        setTimeout(() => {
          this.busy = false;
          this._next();
        }, REQUEST_GAP_MS);
      });
  }
}
