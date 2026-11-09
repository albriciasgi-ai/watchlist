// Velas fijadas del indicador Liquidaciones: el máximo o el mínimo de una vela queda como nivel con lo liquidado ahí.
// A diferencia de lo elegido en el Observador, que vale para un solo trade y pasa a la orden, una vela fijada queda
// hasta que se quita: un barrido grande de hace meses puede seguir siendo soporte o resistencia.
// Los marcos de un símbolo comparten la lista.

const STORAGE_KEY = 'liquidation_pins_';

const stores = new Map();

function store(symbol) {
  if (!stores.has(symbol)) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(STORAGE_KEY + symbol)) || [];
    } catch {
      // Sin almacenamiento la lista vive hasta recargar
    }
    stores.set(symbol, { items, listeners: new Set() });
  }
  return stores.get(symbol);
}

function changed(symbol) {
  const current = store(symbol);
  try {
    localStorage.setItem(STORAGE_KEY + symbol, JSON.stringify(current.items));
  } catch {
    // Sin almacenamiento la lista vive hasta recargar
  }
  current.listeners.forEach(listener => listener());
}

/** Velas fijadas hasta esa hora simulada: al retroceder no aparecen las fijadas después */
export const pinsAt = (symbol, time) => store(symbol).items.filter(pin => pin.selectedAt <= time);

/** La fijada con ese id, si ya estaba fijada en esa hora simulada */
export const pinnedAt = (symbol, id, time = Infinity) =>
  store(symbol).items.find(pin => pin.id === id && pin.selectedAt <= time) || null;

/**
 * Fija o suelta el máximo o el mínimo de una vela. target trae id, edge ('high' o 'low'), price, time (inicio de la
 * vela), low, high, open y close: el cuerpo dice dónde termina la mecha. Una fijada después de esta hora, que solo
 * existe tras retroceder, se reemplaza
 */
export function togglePin(symbol, target, time, timeframe) {
  const current = store(symbol);
  if (pinnedAt(symbol, target.id, time)) {
    current.items = current.items.filter(pin => pin.id !== target.id);
  } else {
    const { id, edge, price, low, high, open, close } = target;
    const pin = { id, edge, price, time: target.time, low, high, open, close, timeframe, selectedAt: time };
    current.items = [...current.items.filter(other => other.id !== id), pin];
  }
  changed(symbol);
}

export function removePin(symbol, id) {
  const current = store(symbol);
  current.items = current.items.filter(pin => pin.id !== id);
  changed(symbol);
}

/** Suelta las fijadas que se ven en esa hora simulada: las fijadas después siguen guardadas */
export function clearPins(symbol, time = Infinity) {
  const current = store(symbol);
  current.items = current.items.filter(pin => pin.selectedAt > time);
  changed(symbol);
}

export function subscribePins(symbol, listener) {
  const { listeners } = store(symbol);
  listeners.add(listener);
  return () => listeners.delete(listener);
}
