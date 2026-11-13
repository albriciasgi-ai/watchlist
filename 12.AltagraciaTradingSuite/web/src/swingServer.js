// Swing del servidor en el gráfico (paso 5, parte B, 12/11/2026).
//
// El indicador Swing de App 1 dibuja las señales que calcula el servidor de la suite (server/swing_rules.py, la misma
// regla), solo con velas cerradas y en cualquier marco: lo que se ve es lo que el servidor detecta. En el marco y las
// monedas que el servidor vigila en vivo son las mismas que anota; en los demás, solo para ver.
// Las reglas se guardan en el servidor, por moneda. Las opciones de las flechas son de cada pestaña.
// Lo usan el gráfico principal (ChartView) y la Watchlist (feedSwing por cada gráfico).
import { getJson, postJson } from './api.js';

export const SWING = 'Swing Detector';
export const INTERVAL_CODE = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240' };
const FRAME_NAME = Object.fromEntries(Object.entries(INTERVAL_CODE).map(([tf, code]) => [code, tf]));
export const frameName = (code) => FRAME_NAME[code] || code;
// Lo que el modal de App 1 cambia de la regla (las zonas de precio no están en el modal y no se mandan)
export const RULE_KEYS = ['swingBars', 'direction', 'volumeFilter', 'vwapFilter'];
export const VISUAL_KEYS = ['arrowSize', 'arrowOffset', 'showVolumeZScore', 'showZones'];
// Reintento cuando el servidor todavía no da la vela recién cerrada
export const SWING_RETRY_MS = 3000;
// El servidor cuenta una vela como cerrada 4 s después de su cierre (como su detección en vivo): antes no se le pide
export const CLOSE_GRACE_MS = 4000;

export const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj?.[k] !== undefined).map(k => [k, obj[k]]));

export const swingOf = (manager) => manager?.indicators?.find(i => i.name === SWING) || null;

/** La última vela que el servidor ya da como cerrada a esta hora */
export const lastClosed = (tfMs, now = Date.now()) => Math.floor((now - CLOSE_GRACE_MS) / tfMs) * tfMs - tfMs;

/** Señales de un gráfico. `days`: los que carga el gráfico (la Watchlist pide menos); sin él, los del gráfico principal */
export function fetchSwing(symbol, tf, days = null) {
  const extra = days ? `&days=${encodeURIComponent(days)}` : '';
  return getJson(`/api/swing/signals/${encodeURIComponent(symbol)}?interval=${INTERVAL_CODE[tf]}${extra}`);
}

/** Las reglas y las señales del servidor en el indicador de un gráfico, con las opciones de flechas de la pestaña */
export function applySwing(indicator, data, visual) {
  indicator.updateConfig({ ...(data.rules || {}), ...(visual || {}) });
  indicator.setExternalSignals(Array.isArray(data.signals) ? data.signals : []);
}

/**
 * El indicador Swing de un gráfico recién armado (`st` es el estado de ese gráfico: {ind, data, version, last, pending,
 * tried}): recibe lo último que dio el servidor, o nada mientras llega. Así nunca calcula por su cuenta con la vela
 * en curso.
 */
export function attachSwing(st, ind, visual) {
  if (!ind || st.ind === ind) return;
  st.ind = ind;
  if (st.data) applySwing(ind, st.data, visual);
  else ind.setExternalSignals([]);
}

/**
 * Pide al servidor las señales de un gráfico si cerró una vela de su marco o cambió `version` (reglas, dibujos o VP
 * Fixed), y se las pone a su indicador. Con `keepRules` solo pone las señales: el modal se está guardando y sus valores
 * no se pisan. Devuelve true si llegaron señales nuevas.
 */
export async function feedSwing(st, { symbol, tf, tfMs, days = null, version, visual, keepRules = false, isAlive = () => true }) {
  if (!st.ind) return false;
  const due = st.version !== version || !(st.last >= lastClosed(tfMs));
  if (!due || st.pending || Date.now() - (st.tried || 0) < SWING_RETRY_MS) return false;
  st.pending = true;
  st.tried = Date.now();
  try {
    const data = await fetchSwing(symbol, tf, days);
    if (!isAlive()) return false;
    st.data = data;
    st.version = version;
    st.last = data.candles?.last ?? lastClosed(tfMs);
    if (keepRules) st.ind.setExternalSignals(data.signals || []);
    else applySwing(st.ind, data, visual);
    return true;
  } catch {
    return false; // sin respuesta queda lo último y se reintenta
  } finally {
    st.pending = false;
  }
}

/** Las reglas del modal como las propias de la moneda (el servidor guarda solo lo distinto a las generales) */
export function saveSwingRules(symbol, rules) {
  return postJson('/api/swing/config', { symbolRules: { [symbol]: pick(rules, RULE_KEYS) } });
}

/** Rectángulos que definen un VP Fixed: no cuentan para el filtro VWAP, como en App 1 */
export function profileRectIds(manager) {
  const profiles = manager?.getFixedRangeProfiles?.() || [];
  return [...new Set(profiles.map(p => p.sourceRectId).filter(Boolean).map(String))].sort();
}

export function saveProfileRects(symbol, ids) {
  return postJson(`/api/swing/profile-rects/${encodeURIComponent(symbol)}`, { ids });
}

// Cambió algo que mueve las señales (reglas guardadas desde el modal, dibujos): los otros gráficos de la página,
// como los de la Watchlist, vuelven a pedir las suyas
const changeListeners = new Set();
export function onSwingChanged(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
export function notifySwingChanged(symbol = null) {
  changeListeners.forEach(listener => {
    try {
      listener(symbol);
    } catch {
      // un oyente con error no frena a los demás
    }
  });
}
