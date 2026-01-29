/**
 * Analizador Desktop - Preload Script
 *
 * Este script se ejecuta en un contexto aislado antes de que se cargue la pagina web.
 * Proporciona una API segura para comunicacion entre el renderer y el main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Exponer API segura al renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Informacion de la plataforma
  platform: process.platform,

  // Versiones de Node, Chrome y Electron
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },

  // Mostrar notificacion nativa del sistema
  showNotification: (title, body) => {
    new Notification(title, { body });
  },

  // Comunicacion bidireccional con el main process
  send: (channel, data) => {
    // Lista blanca de canales permitidos
    const validChannels = ['toMain', 'minimize-to-tray', 'show-window'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  receive: (channel, func) => {
    const validChannels = ['fromMain', 'alert-received', 'price-update'];
    if (validChannels.includes(channel)) {
      // Eliminar listener anterior para evitar duplicados
      ipcRenderer.removeAllListeners(channel);
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },

  // Invocar funciones del main process y esperar respuesta
  invoke: async (channel, data) => {
    const validChannels = ['get-app-path', 'get-version'];
    if (validChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, data);
    }
    return null;
  }
});

// Log cuando el preload se carga correctamente
console.log('[Preload] Script cargado correctamente');
console.log('[Preload] Plataforma:', process.platform);
console.log('[Preload] Electron:', process.versions.electron);
