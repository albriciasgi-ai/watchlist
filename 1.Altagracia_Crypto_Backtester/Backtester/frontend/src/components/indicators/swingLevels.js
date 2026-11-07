/**
 * Niveles de S&R v2. Recorre las velas cerradas hacia adelante, así cada estado depende solo de
 * lo ya ocurrido y cada vela nueva cuesta lo mismo sin importar cuánta historia haya.
 *
 * - Un nivel nace cuando cierra la última vela de la derecha de su swing.
 * - Sigue activo mientras ninguna vela cierre más allá de todos sus toques: una mecha no lo rompe.
 * - Roto, se sigue dibujando "brokenKeepBars" velas, de cualquier lado del precio.
 * - Un swing nuevo solo refuerza un nivel activo, medido contra su primer toque.
 * - La vela en formación no confirma ni rompe nada: solo mueve el precio actual.
 */

export const DEFAULT_LEVEL_CONFIG = {
  swingBars: 5,            // Velas a cada lado para confirmar un swing
  clusterDistancePct: 0.3, // Distancia al primer toque para reforzar un nivel
  minTouches: 1,
  maxLevels: 5,            // Por lado: activos y rotos recientes, cada uno con su límite
  priceRangePct: 10,       // % arriba y abajo del precio que se dibuja
  volumeLookbackBars: 50,  // Velas para el z-score del volumen de cada swing
  minVolumeZScore: 0,      // 0 = sin filtro de volumen
  brokenKeepBars: 50
};

// Los mismos límites que anuncia el modal
const LEVEL_LIMITS = {
  swingBars: [2, 15],
  clusterDistancePct: [0.1, 2],
  minTouches: [1, 10],
  maxLevels: [1, 20],
  priceRangePct: [1, 20],
  volumeLookbackBars: [20, 200],
  minVolumeZScore: [0, 3]
};

const RECENCY_BARS = 1000; // Pasadas estas velas sin toques un nivel ya no suma por reciente
const PRUNE_EVERY_BARS = 64;

const SIDES = {
  resistance: { field: 'high', beyond: (a, b) => a > b },
  support: { field: 'low', beyond: (a, b) => a < b }
};

/** Solo lo aplicable: un campo vacío se ignora y un valor fuera de rango queda en su límite */
export function cleanLevelConfig(config) {
  const clean = {};
  for (const key of Object.keys(DEFAULT_LEVEL_CONFIG)) {
    if (!Number.isFinite(config[key])) continue;
    const [low, high] = LEVEL_LIMITS[key] ?? [-Infinity, Infinity];
    clean[key] = Math.min(high, Math.max(low, config[key]));
  }
  return clean;
}

/** Cantidad de velas cerradas: la vela en formación todavía puede cambiar */
export function closedCount(candles) {
  return candles[candles.length - 1]?.in_progress ? candles.length - 1 : candles.length;
}

/** Z-score del volumen de una vela contra las "lookback" velas que terminan en ella */
function volumeZ(candles, index, lookback) {
  if (index + 1 < lookback) return 0;

  let sum = 0;
  for (let i = index - lookback + 1; i <= index; i++) sum += candles[i].volume;
  const mean = sum / lookback;

  let squares = 0;
  for (let i = index - lookback + 1; i <= index; i++) squares += (candles[i].volume - mean) ** 2;
  const deviation = Math.sqrt(squares / lookback);

  return deviation === 0 ? 0 : (candles[index].volume - mean) / deviation;
}

export class LevelBook {
  constructor(config = {}) {
    this.config = { ...DEFAULT_LEVEL_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.levels = { resistance: [], support: [] };
    this.nearest = { resistance: null, support: null }; // Ningún nivel activo se rompe antes que este
    this.swings = { resistance: 0, support: 0 }; // Hallados
    this.kept = { resistance: 0, support: 0 };   // Los que pasaron el filtro de volumen
    this.next = 0;                               // Primera vela cerrada sin revisar
    this.lastTimestamp = null;
  }

  _isSwing(candles, index, { field, beyond }) {
    const bars = this.config.swingBars;
    const value = candles[index][field];
    for (let i = index - bars; i <= index + bars; i++) {
      if (i !== index && !beyond(value, candles[i][field])) return false;
    }
    return true;
  }

  _addSwing(candles, index, side, { field, beyond }) {
    const { clusterDistancePct, volumeLookbackBars, minVolumeZScore } = this.config;
    const candle = candles[index];
    const price = candle[field];
    const z = volumeZ(candles, index, volumeLookbackBars);

    this.swings[side]++;
    if (minVolumeZScore > 0 && z < minVolumeZScore) return;
    this.kept[side]++;

    let nearest = null;
    let nearestDistance = Infinity;
    for (const level of this.levels[side]) {
      if (level.brokenAt !== null) continue;
      const distance = Math.abs(price - level.anchor) / level.anchor * 100;
      if (distance <= clusterDistancePct && distance < nearestDistance) {
        nearest = level;
        nearestDistance = distance;
      }
    }

    if (nearest) {
      nearest.touches++;
      nearest.priceSum += price;
      nearest.zSum += z;
      nearest.lastIndex = index;
      nearest.lastTouch = candle.timestamp;
      if (beyond(price, nearest.extreme)) nearest.extreme = price;
    } else {
      this.levels[side].push({
        anchor: price,
        extreme: price,
        priceSum: price,
        zSum: z,
        touches: 1,
        firstTouch: candle.timestamp,
        lastTouch: candle.timestamp,
        lastIndex: index,
        brokenAt: null
      });
      if (this.nearest[side] === null || beyond(this.nearest[side], price)) this.nearest[side] = price;
    }
  }

  /** Con muchos niveles vivos recorrerlos en cada vela sería lo más caro de rehacer el libro */
  _breakLevels(side, { beyond }, close, index) {
    if (this.nearest[side] !== null && !beyond(close, this.nearest[side])) return;

    let nearest = null;
    for (const level of this.levels[side]) {
      if (level.brokenAt !== null) continue;
      if (beyond(close, level.extreme)) level.brokenAt = index;
      else if (nearest === null || beyond(nearest, level.extreme)) nearest = level.extreme;
    }
    this.nearest[side] = nearest;
  }

  _close(candles, index) {
    const { swingBars, brokenKeepBars } = this.config;
    const swing = index - swingBars; // Esta vela es la última de la derecha de ese swing

    for (const [side, rule] of Object.entries(SIDES)) {
      this._breakLevels(side, rule, candles[index].close, index);
      if (swing >= swingBars && this._isSwing(candles, swing, rule)) this._addSwing(candles, swing, side, rule);

      if (index % PRUNE_EVERY_BARS === 0) {
        this.levels[side] = this.levels[side].filter(level => level.brokenAt === null || index - level.brokenAt <= brokenKeepBars);
      }
    }
  }

  /** Revisa las velas cerradas nuevas. Si se retrocedió o cambiaron las velas empieza de cero */
  advance(candles) {
    const closed = closedCount(candles);
    const continues = this.next <= closed && (this.next === 0 || candles[this.next - 1].timestamp === this.lastTimestamp);
    if (!continues) this.reset();

    for (let index = this.next; index < closed; index++) this._close(candles, index);
    this.next = closed;
    this.lastTimestamp = closed > 0 ? candles[closed - 1].timestamp : null;
  }

  _published(level, side, price, last) {
    const { touches, priceSum, zSum, firstTouch, lastTouch, lastIndex, brokenAt } = level;
    const average = priceSum / touches;
    const avgVolumeZScore = zSum / touches;
    const recency = Math.max(0, 1 - (last - lastIndex) / RECENCY_BARS);
    const volumeBonus = Math.max(0, Math.min(3, avgVolumeZScore));

    return {
      price: average,
      touches,
      strength: Math.min(10, touches * 2 + volumeBonus + recency * 3),
      avgVolumeZScore,
      firstTouch,
      lastTouch,
      recency,
      type: side,
      status: brokenAt === null ? 'active' : 'broken',
      distanceToPrice: Math.abs(average - price)
    };
  }

  _pick(side, price, last) {
    const { priceRangePct, minTouches, brokenKeepBars, maxLevels } = this.config;
    const low = price * (1 - priceRangePct / 100);
    const high = price * (1 + priceRangePct / 100);

    const shown = this.levels[side]
      .filter(level => level.touches >= minTouches && (level.brokenAt === null || last - level.brokenAt <= brokenKeepBars))
      .map(level => this._published(level, side, price, last))
      .filter(level => level.price >= low && level.price <= high)
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    return [
      ...shown.filter(level => level.status === 'active').slice(0, maxLevels),
      ...shown.filter(level => level.status === 'broken').slice(0, maxLevels)
    ];
  }

  /** Lo que se dibuja con el precio actual, que puede ser el de la vela en formación */
  publish(candles) {
    const price = candles[candles.length - 1]?.close ?? 0;
    const last = closedCount(candles) - 1;
    return {
      resistances: this._pick('resistance', price, last),
      supports: this._pick('support', price, last),
      price,
      swings: this.swings,
      kept: this.kept
    };
  }
}
