/**
 * Ajustes propios del 2.º gráfico.
 *
 * Cada indicador guarda sus ajustes en localStorage con claves como `orderflow_settings_BTCUSDT`, y las
 * dos pestañas comparten localStorage. En la pestaña del 2.º gráfico esas claves se leen y escriben con
 * el prefijo OWN_PREFIX: un cambio hecho aquí no toca la principal. Mientras no se cambie nada aquí, se lee
 * lo de la principal.
 *
 * Solo se desvían los ajustes de los indicadores y la disposición de los paneles. Lo que viaja entre las
 * pestañas a propósito (lo elegido para el análisis, las velas fijadas de Liquidaciones, las recetas de
 * los setups, el estilo) sigue compartido.
 *
 * Se instala al importarse, antes que cualquier indicador: main.jsx lo importa primero.
 */
import { isSecondaryChart } from './replayChannel.js';

export const OWN_PREFIX = 'app1_g2:';
const REMOVED = '\u0000borrado'; // Quitado aquí: no vuelve a leer lo de la principal

export const OWN_KEYS = [
  'orderflow_settings_',
  'fvg_settings_',
  'vp_periodic_settings_',
  'response_balance_settings_',
  'liquidations_settings_',
  'of_elements_settings_',
  'support_resistance_2_config_',
  'support_resistance_config_',
  'double_topbottom_config_',
  'rejection_pattern_config_',
  'range_detection_config_',
  'range_detection_enabled_symbols',
  'volumeVisualParams_',
  'volumeHeight_',
  'priceChartRatio_',
  'indicator_panels_'
];

export const isOwnKey = (key) => typeof key === 'string' && OWN_KEYS.some(prefix => key.startsWith(prefix));

/**
 * Desvía las claves de ajustes de "storage" (localStorage). Devuelve una función que lo deshace.
 * `prefix`: el de esta pestaña. App 1 usa siempre OWN_PREFIX; la suite da otro a cada una de sus pestañas 3 a 5
 */
export function installOwnSettings(storage, proto = Object.getPrototypeOf(storage), prefix = OWN_PREFIX) {
  const { getItem, setItem, removeItem } = proto;
  const mine = (target, key) => target === storage && isOwnKey(key);

  proto.getItem = function (key) {
    if (!mine(this, key)) return getItem.call(this, key);
    const own = getItem.call(this, prefix + key);
    if (own === REMOVED) return null;
    return own !== null ? own : getItem.call(this, key);
  };
  proto.setItem = function (key, value) {
    return setItem.call(this, mine(this, key) ? prefix + key : key, value);
  };
  proto.removeItem = function (key) {
    if (!mine(this, key)) return removeItem.call(this, key);
    return setItem.call(this, prefix + key, REMOVED);
  };
  return () => Object.assign(proto, { getItem, setItem, removeItem });
}

if (typeof window !== 'undefined' && typeof Storage !== 'undefined' && isSecondaryChart()) {
  try {
    installOwnSettings(window.localStorage, Storage.prototype);
  } catch {
    // Sin almacenamiento los ajustes duran hasta cerrar la pestaña, en las dos
  }
}
