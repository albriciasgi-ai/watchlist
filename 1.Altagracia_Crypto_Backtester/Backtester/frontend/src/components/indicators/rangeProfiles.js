import { API_BASE_URL } from '../../config.js';
import { priceDecimals } from '../uiTheme.js';
import { buildProfile } from './sessionProfile.js';

/**
 * Perfil de volumen de cada rango del indicador "Rangos horizontales" (20/11/2026, pedido del usuario): el de las
 * velas cerradas del rango, desde su primera vela hasta la última. El de un rango que sigue vivo crece con cada vela
 * que cierra. Es la regla del perfil de VP Periodic (`buildProfile`): franjas iguales entre el mínimo y el máximo de
 * esas velas, POC en la de más volumen y área de valor creciendo desde el POC hacia la vecina con más volumen.
 *
 * Volumen real: el del almacén de trades (`/api/orderflow/profile`) si cubre el 99% de los minutos del rango, como
 * VP Fixed Range y VP Periodic. Se pide con el cierre de la última vela del rango como hora conocida, así nunca trae
 * lo posterior. Mientras no llega, o sin almacén, el volumen de cada vela se reparte entre su mínimo y su máximo.
 *
 * Un rango vivo cambia de fin con cada vela que cierra: su volumen real se pide cuando ese fin queda quieto SETTLE_MS
 * (en una reproducción rápida, al pausar), y de cada rango solo queda pedido su fin más reciente. Un pedido a la vez.
 */

const MIN_REAL_COVERAGE = 0.99;
const SETTLE_MS = 800;
const REQUEST_GAP_MS = 200;
const MAX_QUEUE = 60;
const MAX_PROFILES = 300;
const MAX_REAL = 400;
const MAX_SENT = 2000;

function lowerBound(candles, timestamp) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Índices [desde, hasta) de las velas de un rango: las que abren desde su primera vela hasta la última */
export function rangeSpan(candles, zone) {
  return [lowerBound(candles, zone.start), lowerBound(candles, zone.lastOpen + 1)];
}

export class RangeProfiles {
  constructor(symbol, { settleMs = SETTLE_MS, gapMs = REQUEST_GAP_MS } = {}) {
    this.symbol = symbol;
    this.settleMs = settleMs;
    this.gapMs = gapMs;
    this.profiles = new Map();  // Perfiles armados, del menos al más usado
    this.real = new Map();      // Volumen real por franja de cada rango, o null si el almacén no lo cubre
    this.sent = new Set();      // Lo ya pedido: no se repite
    this.wanted = new Map();    // Un rango → su último fin, esperando a que quede quieto
    this.queue = [];
    this.busy = false;
    this.timer = null;
    this.closed = false;
  }

  /**
   * Perfil de un rango con las velas cerradas `candles` (en orden). La vela en formación queda fuera sola: abre
   * después de la última vela del rango. Con `real` devuelve el volumen real si ya llegó; si no, lo pide y devuelve
   * el estimado.
   */
  get(zone, candles, { rows, valueAreaShare, group = String(zone.start), real = true, requestRedraw = null }) {
    if (!candles?.length || !Number.isFinite(zone?.lastOpen)) return null;
    const [from, to] = rangeSpan(candles, zone);
    if (to - from < 1) return null;
    const last = candles[to - 1];
    const base = `${zone.start}|${zone.lastOpen}|${rows}|${valueAreaShare}|${to - from}|${last.high}|${last.low}|${last.close}|${last.volume}`;
    const estimate = this._profile(`${base}|e`, () => buildProfile(candles.slice(from, to), rows, valueAreaShare));
    if (!estimate || !real) return estimate;

    const realKey = `${zone.start}|${zone.end}|${rows}|${estimate.minPrice}|${estimate.maxPrice}`;
    const volumes = this.real.get(realKey);
    if (volumes) {
      this.real.delete(realKey);
      this.real.set(realKey, volumes);
      return this._profile(`${base}|r`, () => buildProfile(candles.slice(from, to), rows, valueAreaShare, volumes));
    }
    if (volumes === undefined) {
      this._want(realKey, { group, start: zone.start, end: zone.end, low: estimate.minPrice, high: estimate.maxPrice, rows, requestRedraw });
    }
    return estimate;
  }

  /** Detiene los pedidos pendientes (al destruir el indicador o cambiar de moneda) */
  dispose() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.wanted.clear();
    this.queue = [];
  }

  _profile(key, build) {
    if (this.profiles.has(key)) {
      const cached = this.profiles.get(key);
      this.profiles.delete(key);
      this.profiles.set(key, cached);
      return cached;
    }
    const profile = build();
    if (profile) profile.digits = priceDecimals([{ open: profile.minPrice, close: profile.maxPrice }]); // Los de la moneda
    this.profiles.set(key, profile);
    if (this.profiles.size > MAX_PROFILES) this.profiles.delete(this.profiles.keys().next().value);
    return profile;
  }

  _want(key, item) {
    if (this.closed || this.sent.has(key)) return;
    const waiting = this.wanted.get(item.group);
    if (waiting?.key === key) return;
    this.wanted.set(item.group, { key, item, at: Date.now() });
    this._schedule(this.settleMs);
  }

  _schedule(delay) {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this._promote();
    }, delay);
  }

  // Pasa a la cola lo que lleva SETTLE_MS sin cambiar; de cada rango, solo su fin más reciente
  _promote() {
    if (this.closed) return;
    const now = Date.now();
    let wait = Infinity;
    for (const [group, entry] of this.wanted) {
      const left = this.settleMs - (now - entry.at);
      if (left > 0) {
        wait = Math.min(wait, left);
        continue;
      }
      this.wanted.delete(group);
      this.queue = this.queue.filter(other => other.item.group !== group);
      this.queue.push(entry);
    }
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.wanted.size) this._schedule(Math.max(10, wait));
    this._next();
  }

  _next() {
    if (this.busy || this.closed) return;
    const entry = this.queue.pop(); // El más reciente primero
    if (!entry) return;
    const { key, item } = entry;
    if (this.sent.has(key)) {
      this._next();
      return;
    }
    this.sent.add(key);
    if (this.sent.size > MAX_SENT) this.sent.delete(this.sent.values().next().value);
    this.busy = true;

    const params = new URLSearchParams({
      start_timestamp: String(item.start),
      end_timestamp: String(item.end),
      low: String(item.low),
      high: String(item.high),
      rows: String(item.rows),
      known_until: String(item.end) // Lo posterior al rango no se pide
    });
    Promise.resolve()
      .then(() => fetch(`${API_BASE_URL}/api/orderflow/profile/${this.symbol}?${params}`))
      .then(response => (response?.ok ? response.json() : null))
      .then(data => {
        if (!data?.success || this.closed) return;
        const covered = data.expected_minutes > 0
          && data.minutes / data.expected_minutes >= MIN_REAL_COVERAGE
          && data.buy?.length === item.rows && data.sell?.length === item.rows;
        this._setReal(key, covered ? data.buy.map((buy, i) => buy + data.sell[i]) : null);
        if (covered) item.requestRedraw?.();
      })
      .catch(() => {
        // Sin el perfil real queda el estimado
      })
      .finally(() => {
        setTimeout(() => {
          this.busy = false;
          this._next();
        }, this.gapMs);
      });
  }

  _setReal(key, volumes) {
    this.real.set(key, volumes);
    if (this.real.size > MAX_REAL) {
      const oldest = this.real.keys().next().value;
      this.real.delete(oldest);
      this.sent.delete(oldest); // Si vuelve a hacer falta, se pide otra vez
    }
  }
}
