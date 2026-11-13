// Pestañas de la suite (en Electron, ventanas): la 1 es la principal y de la 2 a la 5 se abren desde el menú
// "Pestañas", cada una con el módulo que se elija (gráfico, Watchlist, journal o bot). Como el 2.o gráfico de App 1,
// cada una tiene sus marcos, indicadores y ajustes de indicadores; los dibujos son por moneda (los guarda el servidor)
// y viajan al instante a las demás por BroadcastChannel, igual que las monedas agregadas.
// Solo la pestaña 1 toma las imágenes del journal y da los avisos de Windows.
import { installOwnSettings } from '@app1/components/backtesting/secondaryStorage.js';

export const MAX_TABS = 5;
export const MODULES = ['chart', 'watchlist', 'journal', 'bot'];

const params = (() => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
})();

export const TAB = (() => {
  const n = parseInt(params.get('pestana'), 10);
  return n >= 2 && n <= MAX_TABS ? n : 1;
})();

/** El módulo con que se abrió esta pestaña desde el menú (?modulo=...), o null */
export const MODULE_PARAM = MODULES.includes(params.get('modulo')) ? params.get('modulo') : null;

/** Dirección de la pestaña n, abierta en `module` */
export function tabUrl(n, module = null) {
  const query = new URLSearchParams();
  if (n > 1) query.set('pestana', String(n));
  if (module) query.set('modulo', module);
  const text = query.toString();
  return text ? `/?${text}` : '/';
}

/** Abre la pestaña n (o la trae al frente si ya está abierta: cada una tiene su nombre de ventana) */
export function openTab(n, module = null) {
  return window.open(tabUrl(n, module), `suite_pestana_${n}`);
}

/**
 * En las pestañas 2 a 5 los ajustes de los indicadores van con prefijo propio: mientras no se cambien, leen los de
 * la 1. La 2 conserva el de antes (el del 2.o gráfico de App 1); de la 3 a la 5, "suite_p<n>:"
 */
export function installTabSettings() {
  if (TAB === 1 || typeof Storage === 'undefined') return;
  try {
    installOwnSettings(window.localStorage, Storage.prototype, TAB === 2 ? undefined : `suite_p${TAB}:`);
  } catch {
    // Sin almacenamiento los ajustes duran hasta cerrar la pestaña
  }
}

const SOURCE = `${TAB}-${Math.random().toString(36).slice(2)}`;
const openChannel = (name) => {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
  } catch {
    return null;
  }
};
const channel = openChannel('suite-drawings');
const symbolsChannel = openChannel('suite-symbols');

// Quien solo muestra los dibujos (la Watchlist) también se entera de los que cambia el gráfico de esta misma pestaña
const drawingViewers = new Set();

export function sendDrawings(symbol, shapes) {
  drawingViewers.forEach(listener => {
    try {
      listener(symbol, shapes);
    } catch {
      // un oyente con error no frena a los demás
    }
  });
  try {
    channel?.postMessage({ source: SOURCE, symbol, shapes });
  } catch {
    // La otra pestaña los lee del servidor al recargar
  }
}

/**
 * listener(symbol, shapes) con los dibujos que cambiaron en esta pestaña o en otra. Para quien solo los muestra: el
 * gráfico que los cambió no se entera de los suyos (usa onDrawings). Devuelve cómo dejar de escuchar
 */
export function onAnyDrawings(listener) {
  drawingViewers.add(listener);
  const stop = onDrawings(listener);
  return () => {
    drawingViewers.delete(listener);
    stop();
  };
}

/** listener(symbol, shapes) con los dibujos que cambió otra pestaña. Devuelve cómo dejar de escuchar */
export function onDrawings(listener) {
  if (!channel) return () => {};
  const handle = (e) => {
    const msg = e.data || {};
    if (msg.source !== SOURCE && typeof msg.symbol === 'string' && Array.isArray(msg.shapes)) listener(msg.symbol, msg.shapes);
  };
  channel.addEventListener('message', handle);
  return () => channel.removeEventListener('message', handle);
}

// Monedas de la suite: una agregada en el gráfico o en la Watchlist aparece al instante en los dos y en las otras pestañas
const symbolListeners = new Set();

export function symbolsChanged(symbols) {
  symbolListeners.forEach(listener => {
    try {
      listener(symbols);
    } catch {
      // un oyente con error no frena a los demás
    }
  });
  try {
    symbolsChannel?.postMessage({ source: SOURCE, symbols });
  } catch {
    // Las otras pestañas la leen del servidor al recargar
  }
}

/** listener(symbols) con la lista nueva de monedas. Devuelve cómo dejar de escuchar */
export function onSymbolsChanged(listener) {
  symbolListeners.add(listener);
  const handle = (e) => {
    const msg = e.data || {};
    if (msg.source !== SOURCE && Array.isArray(msg.symbols)) listener(msg.symbols);
  };
  symbolsChannel?.addEventListener('message', handle);
  return () => {
    symbolListeners.delete(listener);
    symbolsChannel?.removeEventListener('message', handle);
  };
}
