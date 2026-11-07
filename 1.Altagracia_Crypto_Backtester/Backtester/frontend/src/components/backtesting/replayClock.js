/**
 * Reloj de la reproduccion: decide que velas ya existen en la hora simulada.
 *
 * Una vela [t, t + marco) solo esta cerrada cuando t + marco <= ahora.
 * La vela en formacion se arma con velas menores ya cerradas, nunca con la vela final,
 * porque esa contiene precios que todavia no ocurrieron.
 */

export const TF_MS = {
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000
};

const FINE_TO_COARSE = ['1m', '5m', '15m', '1h', '4h'];

const candlesOf = (timeframes, tf) => timeframes?.[tf]?.main || [];

// Cantidad de velas con timestamp menor a t
export function countBefore(candles, t) {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].timestamp < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Indice de la vela con ese timestamp exacto, o -1
export function timestampIndex(candles, t) {
  const index = countBefore(candles, t);
  return candles[index]?.timestamp === t ? index : -1;
}

// Velas con timestamp entre start y end, ambos incluidos
export function candlesBetween(candles, start, end) {
  return candles.slice(countBefore(candles, start), countBefore(candles, end + 1));
}

// Indice de la ultima vela cerrada en "now", o -1 si todavia no hay ninguna
export function lastClosedIndex(candles, tf, now) {
  return countBefore(candles, now - TF_MS[tf] + 1) - 1;
}

function covers(candles, tf, from, to) {
  return candles.length > 0
    && candles[0].timestamp <= from
    && candles[candles.length - 1].timestamp + TF_MS[tf] >= to;
}

// Vela actual armada solo con lo que ya cerro. null si aun no hay nada que mostrar.
export function formingCandle(timeframes, tf, now) {
  const tfMs = TF_MS[tf];
  const start = Math.floor(now / tfMs) * tfMs;
  if (start === now) return null;

  for (const source of FINE_TO_COARSE) {
    if (source === tf) return null;
    const candles = candlesOf(timeframes, source);
    if (!covers(candles, source, start, now)) continue;

    const first = countBefore(candles, start);
    const last = lastClosedIndex(candles, source, now);
    if (last < first) return null;

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let i = first; i <= last; i++) {
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low) low = candles[i].low;
      volume += candles[i].volume;
    }
    return {
      timestamp: start,
      open: candles[first].open,
      high,
      low,
      close: candles[last].close,
      volume,
      in_progress: true,
      knownUntil: candles[last].timestamp + TF_MS[source]
    };
  }
  return null;
}

// Deja en "known" las velas cerradas hasta lastIndex y la vela en formacion. Cambia el arreglo en
// lugar de copiar todo el historial en cada avance: cuesta solo lo que cambio
export function syncKnownCandles(known, all, lastIndex, forming) {
  if (known[known.length - 1]?.in_progress) known.pop();

  const closed = lastIndex + 1;
  if (known.length > closed) known.length = closed;
  if (known.length > 0 && known[known.length - 1] !== all[known.length - 1]) known.length = 0;
  for (let i = known.length; i < closed; i++) known.push(all[i]);

  if (forming) known.push(forming);
  return known;
}

// Cada tick revisa las ordenes con la hora exacta. La pantalla va detras del reloj: si las revisara
// con su hora repetiria velas, y una orden recien llena responderia a velas anteriores a su entrada
export const tickAlreadySettled = (clock, time) => !!clock && (clock.isPlaying || clock.currentTime !== time);

// Ultimo precio negociado que ya se conoce en "now"
export function priceAt(timeframes, now) {
  for (const tf of FINE_TO_COARSE) {
    const candles = candlesOf(timeframes, tf);
    if (!covers(candles, tf, now - TF_MS[tf], now)) continue;
    const last = lastClosedIndex(candles, tf, now);
    if (last >= 0) return candles[last].close;
  }
  return null;
}

// Velas mas finas que cerraron entre "from" y "to", en orden, para liquidar ordenes
export function candlesToSettle(timeframes, from, to) {
  for (const tf of FINE_TO_COARSE) {
    const candles = candlesOf(timeframes, tf);
    if (!covers(candles, tf, from, to)) continue;
    const first = countBefore(candles, from);
    const last = lastClosedIndex(candles, tf, to);
    if (last < first) return { tf, candles: [], settledTo: from };
    return { tf, candles: candles.slice(first, last + 1), settledTo: candles[last].timestamp + TF_MS[tf] };
  }
  return { tf: null, candles: [], settledTo: from };
}
