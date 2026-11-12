/**
 * Canal entre la pestaña principal de App 1 y la del segundo gráfico (?grafico=2).
 *
 * La principal publica 'state': símbolo, inicio, fecha oculta, líneas y cajas de los trades, y la hora de
 * su pantalla con "playing" y "speed" leídos del reloj. Sale cada vez que su pantalla cambia de hora (unas
 * 9 veces por segundo al reproducir), cuando cambia algo de lo demás y una vez por segundo. Al cerrarse
 * manda 'gone'.
 *
 * El segundo gráfico escucha y manda 'hello' al abrirse, cada HEARTBEAT_MS mientras está a la vista y al
 * volver a estarlo; 'tf' al cambiar de marco y 'bye' al cerrarse. Con eso la principal sabe que alguien
 * lo está mirando y avanza su reloj con pasos finos.
 *
 * La hora que viaja es la de la pantalla de la principal, no la de su reloj, que va hasta 100 ms reales
 * adelante: una orden toma la hora de la pantalla, y el segundo gráfico nunca debe mostrar más que eso.
 */
export const REPLAY_CHANNEL = 'app1-replay';

export const SECONDARY_PARAM = 'grafico';

export function openReplayChannel() {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(REPLAY_CHANNEL);
}

/** URL del segundo gráfico, en la misma dirección de la app */
export function secondaryChartUrl(location = window.location) {
  return `${location.origin}${location.pathname}?${SECONDARY_PARAM}=2`;
}

export const isSecondaryChart = (location = window.location) => new URLSearchParams(location.search).get(SECONDARY_PARAM) === '2';

/** Cada cuánto avisa el segundo gráfico que lo están mirando, y cuánto espera la principal antes de darlo por ido */
export const HEARTBEAT_MS = 5000;
export const SECONDARY_GONE_MS = 15000;

/**
 * Hora que informa un 'state' de la principal: { time, playing, speed }, o null si no trae hora.
 * Una principal de una versión anterior no manda "playing" ni "speed": queda solo la hora
 */
export function reportOf(message) {
  if (message?.type !== 'state' || !Number.isFinite(message.currentTime)) return null;
  return { time: message.currentTime, playing: message.playing === true, speed: message.speed, step: message.step };
}

/** Lo del estado que casi nunca cambia. La hora y los trades van aparte para no redibujar todo con cada mensaje */
export function replayBasics(message) {
  return {
    symbol: message.symbol,
    simulationStartTime: message.simulationStartTime,
    blindAnchor: message.blindAnchor ?? null,
    blindScale: message.blindAnchor == null ? null : (message.blindScale ?? null)
  };
}

export function sameBasics(a, b) {
  return !!a && !!b
    && a.symbol === b.symbol
    && a.simulationStartTime === b.simulationStartTime
    && a.blindAnchor === b.blindAnchor
    && JSON.stringify(a.blindScale) === JSON.stringify(b.blindScale);
}

/**
 * Marcos con que avanza el reloj de la principal. Con un segundo gráfico a la vista, de a 1 minuto: así
 * recibe cada minuto y va a la par. El paso fino va en minutos, no como marco: para el reloj '5m' también
 * avanza de a 1. Si esa fecha no tiene velas de 1 minuto ("fine" = '5m'), de a 5: la
 * vela en formación no cambiaría más seguido, y una orden puesta entre dos velas de 5 minutos esperaría
 * a la siguiente para revisarse
 */
export const stepTimeframes = (active, secondary, fine = '1m') => (secondary ? [active, fine === '1m' ? 1 : 5] : [active]);
