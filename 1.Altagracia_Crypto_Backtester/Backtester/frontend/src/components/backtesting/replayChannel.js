/**
 * Canal entre la pestaña principal de App 1 y la del segundo gráfico (?grafico=2).
 * La principal publica la hora simulada, el símbolo, la fecha oculta y las líneas de los trades;
 * el segundo gráfico solo escucha y pide el estado al abrirse.
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
