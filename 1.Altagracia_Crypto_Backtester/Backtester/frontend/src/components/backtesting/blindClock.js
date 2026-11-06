/**
 * Fecha oculta: con una fecha de inicio al azar, la app muestra días relativos a ese inicio.
 * El gráfico se dibuja en canvas fuera de React, por eso el estado vive en este módulo.
 */
const DAY_MS = 86400000;
const COLOMBIA_OFFSET_MS = 5 * 3600000;

let anchor = null;

const colombiaDay = (timestamp) => Math.floor((timestamp - COLOMBIA_OFFSET_MS) / DAY_MS);

export function setBlindAnchor(timestamp) {
  anchor = timestamp ?? null;
}

export function blindAnchor() {
  return anchor;
}

export function isBlind() {
  return anchor !== null;
}

/** "Día 3 14:30", contado desde el inicio de la simulación, en hora de Colombia */
export function maskDate(timestamp) {
  const clock = new Date(timestamp - COLOMBIA_OFFSET_MS).toISOString().slice(11, 16);
  return `Día ${colombiaDay(timestamp) - colombiaDay(anchor)} ${clock}`;
}
