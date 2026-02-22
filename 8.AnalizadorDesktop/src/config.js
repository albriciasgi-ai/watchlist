/**
 * Configuracion del Analizador Desktop
 *
 * Este archivo contiene la configuracion central de la aplicacion.
 * El backend del Analizador corre en el puerto 10000.
 */

// URL base del backend API
// En Electron, siempre nos conectamos al backend local (127.0.0.1 en vez de localhost para evitar problemas IPv6)
export const API_BASE_URL = "http://127.0.0.1:10000";

// Detectar si estamos en Electron
export const isElectron = () => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};

// Log de configuracion al cargar
if (typeof window !== 'undefined') {
  console.log('[Config] API_BASE_URL:', API_BASE_URL);
  console.log('[Config] Electron:', isElectron() ? 'Si' : 'No');
}
