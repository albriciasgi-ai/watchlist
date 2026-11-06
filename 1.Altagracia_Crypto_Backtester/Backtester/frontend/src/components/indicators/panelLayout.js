// Orden y altura de los paneles de indicadores. Los marcos de un símbolo comparten el mismo reparto.

const STORAGE_KEY = 'indicator_panels_';
const MIN_PRICE_RATIO = 0.3;
const MAX_PRICE_RATIO = 0.85;

export const MIN_PANEL_HEIGHT = 48; // Por debajo de esto un panel ya no se alcanza a leer
export const DEFAULT_PRICE_RATIO = 0.65;

const layouts = new Map();

/** Reparto del símbolo. Todos sus marcos reciben el mismo objeto, así un cambio les llega a todos */
export function panelLayout(symbol) {
  if (!layouts.has(symbol)) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY + symbol)) || {};
    } catch {
      // Sin almacenamiento quedan el orden y las alturas de fábrica
    }
    layouts.set(symbol, { order: saved.order || [], heights: saved.heights || {} });
  }
  return layouts.get(symbol);
}

export function savePanelLayout(symbol) {
  try {
    localStorage.setItem(STORAGE_KEY + symbol, JSON.stringify(panelLayout(symbol)));
  } catch {
    // Sin almacenamiento el reparto sigue vigente hasta recargar
  }
}

export function clearPanelLayout(symbol) {
  const layout = panelLayout(symbol);
  layout.order = [];
  layout.heights = {};
  try {
    localStorage.removeItem(STORAGE_KEY + symbol);
  } catch {
    // Nada guardado que borrar
  }
}

/** Nombres en el orden elegido. Los que nunca se movieron van al final, en su orden de siempre */
export function orderPanels(names, order) {
  return [...order.filter(name => names.includes(name)), ...names.filter(name => !order.includes(name))];
}

/** Cambia un panel de lugar con su vecino a la vista. Los paneles apagados conservan su sitio */
export function movePanel(order, names, visible, name, step) {
  const full = orderPanels(names, order);
  const shown = full.filter(item => visible.includes(item));
  const neighbor = shown[shown.indexOf(name) + step];
  if (!neighbor) return full;

  const first = full.indexOf(name);
  const second = full.indexOf(neighbor);
  full[first] = neighbor;
  full[second] = name;
  return full;
}

/**
 * Altura pedida y parte del precio para que solo cambie este panel: el precio cede o recibe
 * lo que el panel gana o pierde, y los demás quedan del mismo tamaño.
 * shown es la altura que se ve, scale la compresión actual y others lo que piden volumen y demás paneles.
 */
export function resizePanel({ shown, delta, scale, others, availableHeight, ratio }) {
  const limit = availableHeight * (1 - MIN_PRICE_RATIO);
  const height = Math.max(MIN_PANEL_HEIGHT, Math.min(limit, shown + delta)) / scale;
  const exact = 1 - (scale * (others + height)) / availableHeight;
  const nextRatio = scale < 1 ? exact : Math.min(ratio, exact); // Sin compresión, lo que sobra ya es del precio
  return { height: Math.round(height), ratio: Math.max(MIN_PRICE_RATIO, Math.min(MAX_PRICE_RATIO, nextRatio)) };
}
