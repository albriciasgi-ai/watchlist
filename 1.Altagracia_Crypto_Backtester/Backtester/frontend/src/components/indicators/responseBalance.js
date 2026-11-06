// Volumen de Respuesta: desbalance entre las velas principales de la tendencia y las de la retracción.
// Repite research/response_volume/engine.py. Si cambia una regla, hay que cambiar los dos y correr la paridad.

const ATR_LENGTH = 14;
const HOUR_DAYS = 30; // Cada vela se compara con su misma hora en estos días anteriores
const HOUR_MIN_DAYS = 5; // Con menos días su volumen queda en lo normal
const DAY_MS = 86400000;
const MAX_BALANCE = 10;
const MIN_BALANCE = 0.1;

/** Regla validada en BTC: velas principales de 10 velas, volumen por hora, equilibrio cuando la respuesta iguala a la tendencia */
export function defaultResponseConfig() {
  return {
    legAtr: 2,
    window: 10,
    top: 5,
    dominance: 2,
    balance: 1,
    adjustHour: true,
    spikeMultiple: 2,
    showArrows: true,
    showSignals: true
  };
}

// Parámetro: [mínimo, máximo]. Fuera del rango se ajusta al guardar.
export const RESPONSE_LIMITS = {
  legAtr: [1, 6],
  window: [5, 60],
  top: [1, 10],
  dominance: [1.2, 5],
  balance: [0.5, 1.5],
  spikeMultiple: [1.2, 6]
};

/** Valores listos para aplicar: números dentro de su rango, con el equilibrio por debajo del dominio */
export function cleanResponseConfig(values) {
  const defaults = defaultResponseConfig();
  const clean = { ...values };
  for (const [key, [min, max]] of Object.entries(RESPONSE_LIMITS)) {
    const number = parseFloat(values[key]);
    clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : defaults[key];
  }
  clean.window = Math.round(clean.window);
  clean.top = Math.round(clean.top);
  clean.balance = Math.min(clean.balance, Number((clean.dominance - 0.1).toFixed(2)));
  return clean;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function topAverage(values, top) {
  values.sort((a, b) => b - a);
  const count = Math.min(top, values.length);
  let total = 0;
  for (let i = 0; i < count; i++) total += values[i];
  return total / count;
}

/**
 * Lectura de cada vela cerrada. Solo mira hacia atrás, así que agregar velas nunca cambia lo ya calculado:
 * se calcula una vez y se extiende. Al retroceder el tiempo basta con mostrar menos.
 */
export class ResponseSeries {
  constructor(config = defaultResponseConfig()) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.timestamps = [];
    this.high = [];
    this.low = [];
    this.close = [];
    this.side = [];
    this.relative = [];
    this.weight = [];
    this.direction = [];
    this.start = [];
    this.balance = [];
    this.signal = [];
    this.rangeTotal = [0];
    this.hourVolumes = new Map();
    this.step = 0;
    this.known = 0;
    this.leg = null;
    this.armed = false;
    this.armedLeg = -1;
  }

  /** Lleva la serie a las velas cerradas de candles. La última puede estar en formación */
  update(candles) {
    if (!candles?.length) {
      this.known = 0;
      return;
    }
    const closed = candles[candles.length - 1].in_progress ? candles.length - 1 : candles.length;
    const last = Math.min(closed, this.timestamps.length) - 1;
    if (last >= 0 && this.timestamps[last] !== candles[last].timestamp) this.reset();
    if (!this.step && closed > 1) this.step = candles[1].timestamp - candles[0].timestamp;
    if (this.step) {
      for (let i = this.timestamps.length; i < closed; i++) this.push(candles[i]);
    }
    this.known = this.step ? closed : 0;
  }

  /** Volumen de la vela dividido por la mediana de esa misma hora en los días anteriores */
  relativeVolume(timestamp, volume) {
    const slot = Math.floor((timestamp % DAY_MS) / this.step);
    let history = this.hourVolumes.get(slot);
    if (!history) {
      history = [];
      this.hourVolumes.set(slot, history);
    }
    const usual = history.length >= HOUR_MIN_DAYS ? median(history) : 0;
    history.push(volume);
    if (history.length > HOUR_DAYS) history.shift();
    return usual > 0 ? volume / usual : 1;
  }

  /** Tramo conocido al cierre de la vela. Cambia cuando un cierre se aleja legAtr ATR del extremo */
  advanceLeg(i, atr) {
    const leg = this.leg;
    const reach = this.config.legAtr * atr;
    const high = this.high[i];
    const low = this.low[i];
    const close = this.close[i];

    if (leg.direction === 1) {
      if (high >= leg.extreme) {
        leg.extreme = high;
        leg.extremeAt = i;
      } else if (close <= leg.extreme - reach) {
        this.turnLeg(i, -1);
      }
    } else if (low <= leg.extreme) {
      leg.extreme = low;
      leg.extremeAt = i;
    } else if (close >= leg.extreme + reach) {
      this.turnLeg(i, 1);
    }
  }

  /** El tramo nuevo empieza en el extremo del anterior y ya trae su propio extremo */
  turnLeg(i, direction) {
    const leg = this.leg;
    const prices = direction === 1 ? this.high : this.low;
    leg.direction = direction;
    leg.start = leg.extremeAt;
    let at = leg.start;
    for (let j = leg.start + 1; j <= i; j++) {
      if (direction === 1 ? prices[j] > prices[at] : prices[j] < prices[at]) at = j;
    }
    leg.extreme = prices[at];
    leg.extremeAt = at;
  }

  /** T / R: promedio de las velas principales de la tendencia contra las de la respuesta */
  balanceAt(i) {
    const { window, top } = this.config;
    const direction = this.direction[i];
    const trend = [];
    const response = [];
    for (let j = Math.max(this.start[i], i - window + 1); j <= i; j++) {
      if (this.side[j] === direction) trend.push(this.weight[j]);
      else if (this.side[j] === -direction) response.push(this.weight[j]);
    }
    if (!response.length) return trend.length ? MAX_BALANCE : 1;
    if (!trend.length) return MIN_BALANCE;
    const answer = topAverage(response, top);
    if (answer <= 0) return MAX_BALANCE;
    return Math.min(MAX_BALANCE, Math.max(MIN_BALANCE, topAverage(trend, top) / answer));
  }

  push(candle) {
    const i = this.timestamps.length;
    const previous = i > 0 ? this.close[i - 1] : candle.close;
    const range = Math.max(candle.high - candle.low, Math.abs(candle.high - previous), Math.abs(candle.low - previous));
    this.rangeTotal.push(this.rangeTotal[i] + range);
    const first = Math.max(0, i + 1 - ATR_LENGTH);
    const atr = (this.rangeTotal[i + 1] - this.rangeTotal[first]) / (i + 1 - first);

    this.timestamps.push(candle.timestamp);
    this.high.push(candle.high);
    this.low.push(candle.low);
    this.close.push(candle.close);
    this.side.push(Math.sign(candle.close - candle.open));
    const relative = this.relativeVolume(candle.timestamp, candle.volume);
    this.relative.push(relative);
    this.weight.push(this.config.adjustHour ? relative : candle.volume);

    if (!this.leg) this.leg = { direction: 1, start: 0, extreme: candle.high, extremeAt: 0 };
    this.advanceLeg(i, atr);
    this.direction.push(this.leg.direction);
    this.start.push(this.leg.start);

    const balance = this.balanceAt(i);
    this.balance.push(balance);

    if (this.start[i] !== this.armedLeg || (i > 0 && this.direction[i] !== this.direction[i - 1])) {
      this.armedLeg = this.start[i];
      this.armed = false;
    }
    let signal = false;
    if (balance >= this.config.dominance) {
      this.armed = true;
    } else if (this.armed && balance <= this.config.balance) {
      signal = true;
      this.armed = false;
    }
    this.signal.push(signal);
  }

  /** Posición de la vela cerrada de esa hora, o -1 si aún no se conoce */
  indexOf(timestamp) {
    let low = 0;
    let high = this.known - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (this.timestamps[middle] === timestamp) return middle;
      if (this.timestamps[middle] < timestamp) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  /** Quién domina: positivo compra, negativo venta. Cero es equilibrio y cada unidad duplica la ventaja */
  pressure(i) {
    return this.direction[i] * Math.log2(this.balance[i]);
  }

  /** Vela con varias veces el volumen normal de su hora */
  isPrincipal(i) {
    return this.side[i] !== 0 && this.relative[i] >= this.config.spikeMultiple;
  }
}
