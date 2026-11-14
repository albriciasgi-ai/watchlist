// Pestañas de la suite (en Electron, ventanas): la 1 es la principal y de la 2 a la 5 se abren desde el menú
// "Pestañas", cada una con el módulo que se elija (gráfico, Watchlist, journal o bot). Como el 2.o gráfico de App 1,
// cada una tiene sus marcos, indicadores y ajustes de indicadores; los dibujos son por moneda (los guarda el servidor)
// y viajan al instante a las demás por BroadcastChannel, igual que las monedas agregadas.
// Solo la pestaña 1 toma las imágenes del journal y da los avisos de Windows.
import { installOwnSettings } from '@app1/components/backtesting/secondaryStorage.js';

export const MAX_TABS = 5;
export const MODULES = ['chart', 'watchlist', 'journal', 'bot', 'mapa'];

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

// En la barra de tareas (y en las pestañas del navegador) cada ventana dice cuál es
if (TAB > 1 && typeof document !== 'undefined') document.title = `Pestaña ${TAB} · ${document.title}`;

/** El módulo con que se abrió esta pestaña desde el menú (?modulo=...), o null */
export const MODULE_PARAM = MODULES.includes(params.get('modulo')) ? params.get('modulo') : null;

/** La moneda y el marco con que se abrió (13/11, el mapa los trae del gráfico principal), o null */
export const URL_SYMBOL = /^[A-Z0-9]{2,20}$/.test(params.get('moneda') || '') ? params.get('moneda') : null;
export const URL_TIMEFRAME = ['1m', '5m', '15m', '1h', '4h'].includes(params.get('marco')) ? params.get('marco') : null;

/** Dirección de la pestaña n, abierta en `module` (extra: moneda y marco) */
export function tabUrl(n, module = null, extra = null) {
  const query = new URLSearchParams();
  if (n > 1) query.set('pestana', String(n));
  if (module) query.set('modulo', module);
  for (const [key, value] of Object.entries(extra || {})) if (value) query.set(key, String(value));
  const text = query.toString();
  return text ? `/?${text}` : '/';
}

/**
 * Abre la pestaña n (o la trae al frente si ya está abierta: cada una tiene su nombre de ventana). En Electron la
 * crea la app como ventana propia, con su propio hilo (desktop/main.cjs); en el navegador comparte el de esta
 */
export function openTab(n, module = null, extra = null) {
  return window.open(tabUrl(n, module, extra), `suite_pestana_${n}`);
}

// Qué pestañas están abiertas y con qué módulo (13/11): cada una lo anota cada 4 s. 90 s sin anotar cuenta como
// cerrada: en el navegador una pestaña oculta puede quedar en un aviso por minuto
const ALIVE_PREFIX = 'suite_tab_alive_';
const ALIVE_MS = 90000;

export function startTabHeartbeat(getModule) {
  const beat = () => {
    try { localStorage.setItem(`${ALIVE_PREFIX}${TAB}`, JSON.stringify({ at: Date.now(), module: getModule() })); } catch { /* sin almacenamiento */ }
  };
  const bye = () => {
    try { localStorage.removeItem(`${ALIVE_PREFIX}${TAB}`); } catch { /* sin almacenamiento */ }
  };
  beat();
  const timer = setInterval(beat, 4000);
  window.addEventListener('pagehide', bye);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', bye);
  };
}

export function openTabsNow(now = Date.now(), storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  return Array.from({ length: MAX_TABS }, (_, i) => i + 1).map(n => {
    let note = null;
    try { note = JSON.parse(storage?.getItem(`${ALIVE_PREFIX}${n}`) || 'null'); } catch { note = null; }
    const alive = !!note && Number.isFinite(note.at) && now - note.at < ALIVE_MS;
    return { n, alive, module: alive ? note.module : null };
  });
}

/** Dónde abrir el mapa: la pestaña que ya lo muestra, o la primera libre de la 2 a la 5 (null: todas ocupadas) */
export function mapTabNumber(tabs = openTabsNow(), current = TAB) {
  const others = tabs.filter(t => t.n >= 2 && t.n !== current);
  return (others.find(t => t.alive && t.module === 'mapa') || others.find(t => !t.alive))?.n ?? null;
}

/** El mapa de liquidez en otra pestaña, con esa moneda y ese marco. Devuelve el número de pestaña, o null */
export function openMapTab(symbol, timeframe) {
  const n = mapTabNumber();
  if (!n) return null;
  openTab(n, 'mapa', { moneda: symbol, marco: timeframe });
  return n;
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
