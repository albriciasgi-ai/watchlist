/**
 * Watchlist Desktop - Preload Script
 *
 * Este script corre en un contexto aislado y expone APIs seguras
 * al renderer process via contextBridge.
 *
 * IMPORTANTE: Este script tiene acceso limitado a Node.js por seguridad.
 * Solo expone funciones especificas que el frontend necesita.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// APIs EXPUESTAS AL RENDERER
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // Informacion del entorno
  platform: process.platform,
  isElectron: true,

  // Notificaciones nativas (para alertas de trading)
  showNotification: (title, body) => {
    return new Notification(title, {
      body: body,
      silent: false
    });
  },

  // Reportar coordenadas de los charts al main process (para screenshot server)
  reportChartRects: (rects) => {
    ipcRenderer.send('report-chart-rects', rects);
  },

  // Comunicacion con el main process (para futuras extensiones)
  send: (channel, data) => {
    // Whitelist de canales permitidos
    const validChannels = ['app:minimize', 'app:maximize', 'app:close', 'app:restart'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // Reportar que el scroll al simbolo se completo (con nuevas coordenadas)
  reportScrollComplete: (rect) => {
    ipcRenderer.send('scroll-to-symbol-done', rect);
  },

  receive: (channel, callback) => {
    const validChannels = ['alert:received', 'app:update-available', 'request-chart-rects', 'scroll-to-symbol', 'scroll-restore'];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  // Versiones
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
});

// ============================================================
// LOG DE INICIO
// ============================================================

console.log('[Preload] Script cargado correctamente');
console.log('[Preload] Electron:', process.versions.electron);
console.log('[Preload] Chrome:', process.versions.chrome);
