/**
 * Order Flow Desktop - Preload Script
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
  appName: 'Order Flow Desktop',

  // Notificaciones nativas (para alertas de Order Flow)
  showNotification: (title, body) => {
    return new Notification(title, {
      body: body,
      silent: false
    });
  },

  // Comunicacion con el main process (para futuras extensiones)
  send: (channel, data) => {
    // Whitelist de canales permitidos
    const validChannels = ['app:minimize', 'app:maximize', 'app:close', 'app:restart'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  receive: (channel, callback) => {
    const validChannels = ['alert:received', 'app:update-available', 'orderflow:imbalance'];
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

console.log('[Preload] Order Flow Desktop - Script cargado correctamente');
console.log('[Preload] Electron:', process.versions.electron);
console.log('[Preload] Chrome:', process.versions.chrome);
