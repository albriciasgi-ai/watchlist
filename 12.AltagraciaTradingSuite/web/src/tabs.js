// Dos pestanas, como el 2.o grafico de App 1: cada una con sus marcos, indicadores y ajustes de indicadores;
// los dibujos son por moneda (los guarda el servidor) y viajan al instante a la otra pestana por BroadcastChannel.
import { installOwnSettings } from '@app1/components/backtesting/secondaryStorage.js';

export const TAB = (() => {
  try {
    return new URLSearchParams(window.location.search).get('pestana') === '2' ? 2 : 1;
  } catch {
    return 1;
  }
})();

export const otherTabUrl = () => (TAB === 1 ? '/?pestana=2' : '/');

/** En la pestana 2 los ajustes de los indicadores van con prefijo propio (mientras no se cambien, lee los de la 1) */
export function installTabSettings() {
  if (TAB !== 2 || typeof Storage === 'undefined') return;
  try {
    installOwnSettings(window.localStorage, Storage.prototype);
  } catch {
    // Sin almacenamiento los ajustes duran hasta cerrar la pestana
  }
}

const SOURCE = `${TAB}-${Math.random().toString(36).slice(2)}`;
let channel = null;
try {
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('suite-drawings') : null;
} catch {
  channel = null;
}

export function sendDrawings(symbol, shapes) {
  try {
    channel?.postMessage({ source: SOURCE, symbol, shapes });
  } catch {
    // La otra pestana los lee del servidor al recargar
  }
}

/** listener(symbol, shapes) con los dibujos que cambio la otra pestana. Devuelve como dejar de escuchar */
export function onDrawings(listener) {
  if (!channel) return () => {};
  const handle = (e) => {
    const msg = e.data || {};
    if (msg.source !== SOURCE && typeof msg.symbol === 'string' && Array.isArray(msg.shapes)) listener(msg.symbol, msg.shapes);
  };
  channel.addEventListener('message', handle);
  return () => channel.removeEventListener('message', handle);
}
