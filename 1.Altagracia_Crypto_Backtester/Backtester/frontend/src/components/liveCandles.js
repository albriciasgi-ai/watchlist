/**
 * Velas del gráfico en vivo: las cerradas y la vela en curso, sin repetir ninguna hora.
 *
 * El gráfico recarga el histórico cada 5 minutos y recibe las velas por el WebSocket. Si una recarga caía
 * justo después del cierre de una vela y antes de que el WebSocket mandara la siguiente (en una moneda con
 * pocos trades eso tarda), esa vela quedaba entre las cerradas y también como vela en curso: se dibujaba dos
 * veces y, al empezar la siguiente, se agregaba otra vez (12/11/2026, PAXG 15m en la suite).
 *
 * Reglas:
 * 1. Las cerradas van en orden y sin repetir hora.
 * 2. La vela en curso es posterior a la última cerrada. Si ya está entre las cerradas, deja de ser la vela en
 *    curso y los mensajes que sigan de esa vela corrigen la cerrada.
 */

/** Hora de inicio de la vela en curso según el reloj */
const formingStart = (now, intervalMs) => Math.floor(now / intervalMs) * intervalMs;

/**
 * Une un histórico recién pedido (en orden) con lo que ya tenía el gráfico.
 * - La última vela del histórico se quita si está en curso según el reloj: la trae el WebSocket.
 * - Lo que el WebSocket cerró mientras se pedía el histórico, y el histórico no trae, se conserva.
 * - La vela en curso queda solo si es posterior a la última cerrada.
 * Devuelve { closed, forming, droppedLast }.
 */
export function mergeHistory(history, previousClosed, forming, intervalMs, now = Date.now()) {
  let closed = history;
  const last = closed[closed.length - 1];
  const droppedLast = !!last && last.timestamp >= formingStart(now, intervalMs);
  if (droppedLast) closed = closed.slice(0, -1);

  const newest = closed[closed.length - 1];
  if (newest && previousClosed?.length) {
    const meanwhile = previousClosed.filter(c => c.timestamp > newest.timestamp);
    if (meanwhile.length) closed = closed.concat(meanwhile);
  }

  const top = closed[closed.length - 1];
  const keep = forming && (!top || forming.timestamp > top.timestamp) ? forming : null;
  return { closed, forming: keep, droppedLast };
}

/**
 * Aplica una vela del WebSocket. `closed` se cambia en el lugar, como antes: se agrega la vela que cerró o se
 * corrige la última. Devuelve { forming, rolled, changed }: `rolled` es true cuando empezó una vela nueva.
 */
export function applyKline(closed, forming, candle, maxClosed = 2000) {
  const last = closed[closed.length - 1];
  // Una vela anterior a la última cerrada no va al final
  if (last && candle.timestamp < last.timestamp) return { forming, rolled: false, changed: false };
  // La misma vela que la última cerrada solo la corrige
  if (last && candle.timestamp === last.timestamp) {
    last.open = candle.open;
    last.high = candle.high;
    last.low = candle.low;
    last.close = candle.close;
    last.volume = candle.volume;
    return { forming: forming && forming.timestamp > candle.timestamp ? forming : null, rolled: false, changed: true };
  }
  if (!forming || candle.timestamp === forming.timestamp) return { forming: candle, rolled: false, changed: true };
  if (candle.timestamp < forming.timestamp) return { forming, rolled: false, changed: false };

  // Empezó una vela nueva: la anterior pasa a las cerradas si no está ya entre ellas
  if (!last || forming.timestamp > last.timestamp) {
    closed.push(forming);
    if (closed.length > maxClosed) closed.shift();
  }
  return { forming: candle, rolled: true, changed: true };
}

/** Lo que se dibuja: las cerradas y, al final, la vela en curso si es posterior a la última cerrada */
export function withForming(closed, forming) {
  const last = closed[closed.length - 1];
  if (!forming || (last && forming.timestamp <= last.timestamp)) return [...closed];
  return [...closed, forming];
}
