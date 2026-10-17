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
const fs = require('fs').promises;
const path = require('path');

// ============================================================
// APIs EXPUESTAS AL RENDERER
// ============================================================

contextBridge.exposeInMainWorld('electron', {
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
  },

  // ============================================================
  // FILE SYSTEM APIs (para FootprintArchiver)
  // ============================================================

  /**
   * Obtiene la ruta de userData de Electron.
   * Esta carpeta persiste incluso si se desinstala/reinstala la app.
   */
  getUserDataPath: async () => {
    return ipcRenderer.invoke('get-user-data-path');
  },

  /**
   * Verifica si un archivo existe.
   */
  fileExists: async (filePath) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Lee un archivo como texto.
   */
  readFile: async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      console.error(`[Preload] Error leyendo ${filePath}:`, error);
      throw error;
    }
  },

  /**
   * Escribe un archivo.
   */
  writeFile: async (filePath, content) => {
    try {
      // Asegurar que el directorio existe
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      console.error(`[Preload] Error escribiendo ${filePath}:`, error);
      throw error;
    }
  },

  /**
   * Asegura que un directorio existe.
   */
  ensureDir: async (dirPath) => {
    try {
      await fs.mkdir(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error(`[Preload] Error creando directorio ${dirPath}:`, error);
      throw error;
    }
  },

  /**
   * Lista archivos en un directorio.
   */
  listFiles: async (dirPath) => {
    try {
      const exists = await fs.access(dirPath).then(() => true).catch(() => false);
      if (!exists) {
        return [];
      }

      const files = await fs.readdir(dirPath);
      return files;
    } catch (error) {
      console.error(`[Preload] Error listando ${dirPath}:`, error);
      return [];
    }
  },

  /**
   * Elimina un archivo.
   */
  deleteFile: async (filePath) => {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      console.error(`[Preload] Error eliminando ${filePath}:`, error);
      throw error;
    }
  },

  /**
   * Abre una carpeta en el explorador de archivos.
   */
  openFolder: async (folderPath) => {
    return ipcRenderer.invoke('open-folder', folderPath);
  },

  // ============================================================
  // FOOTPRINT DOWNLOADER (Bypass CORS usando Main Process)
  // ============================================================

  /**
   * Descarga footprints desde el cloud usando el main process (sin CORS).
   *
   * @param {string} symbol - Símbolo (ej: 'BTCUSDT')
   * @param {number} hours - Horas a descargar
   * @param {string} interval - Intervalo ('1', '5', '15', etc.)
   * @returns {Promise<Array>} - Array de footprints
   */
  downloadFootprints: async (symbol, hours, interval) => {
    return ipcRenderer.invoke('download-footprints', { symbol, hours, interval });
  }
});

// Compatibilidad con código legacy que usa 'electronAPI'
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  appName: 'Order Flow Desktop',
  showNotification: (title, body) => {
    return new Notification(title, { body, silent: false });
  },
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
