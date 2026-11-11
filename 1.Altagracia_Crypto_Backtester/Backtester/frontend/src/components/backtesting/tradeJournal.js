// Espera a que la vela de la entrada y la caja TP/SL estén dibujadas antes de tomar la imagen
export const ENTRY_CAPTURE_DELAY_MS = 150;

// Velas que espera la imagen de cierre, para ver qué pasó después del trade
export const EXIT_CAPTURE_CANDLES = 10;

// Velas anteriores a la entrada que la imagen de cierre deja como mínimo
const EXIT_CONTEXT_CANDLES = 20;

// La imagen de la decisión y la de la entrada muestran unas 5 veces las velas a la vista. Con la vista
// cerca, como al leer footprints, quedaban pocas velas y faltaba contexto para revisarlas después
export const CONTEXT_IMAGE_SCALE = 5;

// Ancho mínimo por vela en esas imágenes: más angostas ya no se distinguen
export const CONTEXT_MIN_BAR_WIDTH = 3;

/**
 * Detiene el reloj mientras se toman imágenes: la vela y la caja necesitan un momento para
 * dibujarse, y a velocidad alta ese momento son varias velas. Cada imagen avisa con "release"
 * al copiar el gráfico, sin esperar la subida. El reloj sigue cuando avisa la última.
 */
export class CaptureHold {
  constructor(getClock, delayMs = ENTRY_CAPTURE_DELAY_MS) {
    this.getClock = getClock;
    this.delayMs = delayMs;
    this.active = 0;
    this.resume = false;
  }

  /** Quien opera pausó o cambió el reloj: terminar la imagen ya no lo pone a andar */
  cancel() {
    this.resume = false;
  }

  run(capture) {
    const clock = this.getClock();
    if (clock?.isPlaying) {
      clock.pause();
      this.resume = true;
    }
    this.active++;

    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      this.active--;
      if (this.active === 0 && this.resume) {
        this.resume = false;
        this.getClock()?.play();
      }
    };

    setTimeout(async () => {
      try {
        await capture(release);
      } finally {
        release();
      }
    }, this.delayMs);
  }
}

/** Hora simulada en que corresponde la imagen de cierre */
export const exitCaptureTime = (exitTime, candleMs) => exitTime + EXIT_CAPTURE_CANDLES * candleMs;

/** Trades cuya imagen de cierre ya se puede tomar */
export function exitCapturesDue(orders = [], time) {
  return orders.filter(order => order.exitCaptureAt && time >= order.exitCaptureAt);
}

/** Ancho por vela de una imagen con contexto. Nunca acerca la vista */
export function contextBarWidth(barWidth) {
  return Math.min(barWidth, Math.max(CONTEXT_MIN_BAR_WIDTH, barWidth / CONTEXT_IMAGE_SCALE));
}

/** Velas que debe mostrar la imagen de cierre: el trade, lo que siguió y contexto anterior */
export function candlesToFrame(tradeCandles) {
  return tradeCandles + Math.max(EXIT_CONTEXT_CANDLES, Math.ceil(tradeCandles * 0.25));
}

// Velas de aire que una imagen deja como mínimo junto a una marca de la orden, para que su número no quede en el borde
export const ITEM_FRAME_MARGIN = 3;

// Una imagen se aleja hasta 3 veces sus velas para alcanzar una marca de la orden. Más lejos, la de cierre
// dejaría el trade en un rincón: la marca queda en el borde y la imagen no cambia
export const ITEM_FRAME_MAX_GROWTH = 3;

/**
 * Vista de una imagen que también alcanza las velas first y last (índices; null si ese lado no importa)
 * sin perder lo que ya mostraba: se aleja hacia la izquierda y, si hace falta, corre el borde derecho.
 * room es el aire junto a la marca como parte de las velas que abarca: al alejarse, una vela mide menos
 * y hacen falta más. Un lado que pediría más de ITEM_FRAME_MAX_GROWTH veces las velas no se mueve.
 * Devuelve el offset nuevo y cuántas velas deben caber, o null si la vista no cambia
 */
export function viewIncluding({ length, perScreen, offset }, first, last, room = 0) {
  const end = length - Math.min(offset, Math.max(0, length - perScreen));
  const start = Math.max(0, end - perScreen);
  const limit = Math.max(perScreen, Math.round(perScreen * ITEM_FRAME_MAX_GROWTH));
  const air = (span) => Math.max(ITEM_FRAME_MARGIN, Math.ceil(span * room));
  let to = last === null ? end : Math.min(length, Math.max(end, last + 1 + air(last + 1 - start)));
  if (to - start > limit) to = end;
  let from = first === null ? start : Math.max(0, Math.min(start, first - air(to - first)));
  if (to - from > limit) from = start;
  if (from === start && to === end) return null;
  return { offset: length - to, count: to - from };
}

/** Líneas verticales de los trades. Salen de las órdenes para que la sesión las recupere sola */
export function tradeBoundaries(orders = []) {
  return orders
    .filter(order => order.status === 'open' || order.status === 'closed')
    .map(order => ({
      entryTime: order.executedAt ?? order.entryTime,
      exitTime: order.exitTime ?? null,
      tradeNumber: order.tradeNumber ?? order.id // El número del trade; las órdenes canceladas no lo gastan
    }));
}

/** Resumen que la lista de sesiones muestra sin abrir cada una */
export function tradeStats(orders = []) {
  const closed = orders.filter(order => order.status === 'closed');
  const wins = closed.filter(order => order.pnl > 0).length;
  return {
    totalTrades: closed.length,
    winRate: closed.length > 0 ? ((wins / closed.length) * 100).toFixed(2) : 0
  };
}
