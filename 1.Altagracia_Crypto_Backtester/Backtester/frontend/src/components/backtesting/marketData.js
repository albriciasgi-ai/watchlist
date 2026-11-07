/**
 * Velas de la carga inicial: cada marco trae sus velas una sola vez, en "main".
 *
 * Antes el backend mandaba además "subdivisions", una copia idéntica de main, y así quedaron
 * guardadas en IndexedDB. Nada la usa: la vela en formación se arma con los marcos menores
 * (replayClock.js). Se descarta al recibir o leer los datos, para no tenerla dos veces en memoria
 * ni volver a guardarla.
 */
export function withoutSubdivisions(data) {
  const timeframes = data?.timeframes;
  const hasCopy = (tfData) => tfData != null && Object.hasOwn(tfData, 'subdivisions');
  if (!timeframes || !Object.values(timeframes).some(hasCopy)) return data;

  const clean = {};
  for (const [tf, tfData] of Object.entries(timeframes)) {
    if (!hasCopy(tfData)) {
      clean[tf] = tfData;
      continue;
    }
    const { subdivisions: _copy, ...rest } = tfData;
    clean[tf] = rest;
  }
  return { ...data, timeframes: clean };
}
