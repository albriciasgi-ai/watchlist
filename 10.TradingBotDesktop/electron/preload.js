/**
 * Trading Bot Desktop - Preload Script
 *
 * Este script corre en un contexto aislado y expone APIs seguras
 * al renderer process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// APIs EXPUESTAS AL RENDERER
// ============================================================

contextBridge.exposeInMainWorld('electronAPI', {
  // Informacion del entorno
  platform: process.platform,
  isElectron: true,
  appName: 'Trading Bot Desktop',

  // Notificaciones nativas (para alertas de ordenes ejecutadas)
  showNotification: (title, body) => {
    return new Notification(title, {
      body: body,
      silent: false
    });
  },

  // Comunicacion con el main process
  send: (channel, data) => {
    const validChannels = ['app:minimize', 'app:maximize', 'app:close', 'app:restart'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  receive: (channel, callback) => {
    const validChannels = ['order:executed', 'alert:received', 'app:update-available'];
    if (validChannels.includes(channel)) {
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

console.log('[Preload] Trading Bot Desktop - Script cargado correctamente');
console.log('[Preload] Electron:', process.versions.electron);
console.log('[Preload] Chrome:', process.versions.chrome);
