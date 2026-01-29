/**
 * SessionManager - Gestión de sesiones de backtesting con IndexedDB
 * Permite guardar y restaurar estado completo: órdenes, dibujos, configuraciones
 */

class SessionManager {
  constructor() {
    this.dbName = 'backtestingSessions';
    this.dbVersion = 1;
    this.storeName = 'sessions';
    this.db = null;
    this.autoSaveInterval = null;
  }

  /**
   * Inicializa IndexedDB y crea el schema si no existe
   */
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('[SessionManager] Error al abrir IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[SessionManager] IndexedDB inicializado');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Crear object store para sesiones
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'sessionId' });

          // Índices para búsqueda rápida
          store.createIndex('symbol', 'symbol', { unique: false });
          store.createIndex('timeframe', 'timeframe', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('lastModified', 'lastModified', { unique: false });
          store.createIndex('symbolTimeframe', ['symbol', 'timeframe'], { unique: false });

          console.log('[SessionManager] Object store creado');
        }
      };
    });
  }

  /**
   * Asegura que la DB esté inicializada
   */
  async ensureDB() {
    if (!this.db) {
      await this.initDB();
    }
  }

  /**
   * Guarda una sesión completa
   */
  async saveSession(sessionData) {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // Asegurar que tenga timestamp de modificación
      sessionData.lastModified = Date.now();

      const request = store.put(sessionData);

      request.onsuccess = () => {
        console.log('[SessionManager] Sesión guardada:', sessionData.sessionId);
        resolve(sessionData);
      };

      request.onerror = () => {
        console.error('[SessionManager] Error al guardar sesión:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Carga una sesión por ID
   */
  async loadSession(sessionId) {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(sessionId);

      request.onsuccess = () => {
        if (request.result) {
          console.log('[SessionManager] Sesión cargada:', sessionId);
          resolve(request.result);
        } else {
          console.warn('[SessionManager] Sesión no encontrada:', sessionId);
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('[SessionManager] Error al cargar sesión:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Lista todas las sesiones con filtros opcionales
   */
  async listSessions(filters = {}) {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      let request;

      // Si hay filtro de symbol y timeframe, usar índice compuesto
      if (filters.symbol && filters.timeframe) {
        const index = store.index('symbolTimeframe');
        request = index.getAll([filters.symbol, filters.timeframe]);
      } else if (filters.symbol) {
        const index = store.index('symbol');
        request = index.getAll(filters.symbol);
      } else if (filters.timeframe) {
        const index = store.index('timeframe');
        request = index.getAll(filters.timeframe);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        let sessions = request.result;

        // Ordenar por última modificación (más reciente primero)
        sessions.sort((a, b) => b.lastModified - a.lastModified);

        console.log(`[SessionManager] ${sessions.length} sesiones encontradas`);
        resolve(sessions);
      };

      request.onerror = () => {
        console.error('[SessionManager] Error al listar sesiones:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Elimina una sesión
   */
  async deleteSession(sessionId) {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(sessionId);

      request.onsuccess = () => {
        console.log('[SessionManager] Sesión eliminada:', sessionId);
        resolve(true);
      };

      request.onerror = () => {
        console.error('[SessionManager] Error al eliminar sesión:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Exporta una sesión a JSON (para descargar archivo)
   */
  async exportSession(sessionId) {
    const session = await this.loadSession(sessionId);

    if (!session) {
      throw new Error('Sesión no encontrada');
    }

    const jsonString = JSON.stringify(session, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Crear link de descarga
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtesting_session_${session.symbol}_${session.timeframe}_${new Date(session.createdAt).toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[SessionManager] Sesión exportada:', sessionId);
    return session;
  }

  /**
   * Importa una sesión desde JSON
   */
  async importSession(jsonData) {
    try {
      let sessionData;

      if (typeof jsonData === 'string') {
        sessionData = JSON.parse(jsonData);
      } else {
        sessionData = jsonData;
      }

      // Validar que tenga los campos mínimos
      if (!sessionData.sessionId || !sessionData.symbol || !sessionData.timeframe) {
        throw new Error('Formato de sesión inválido');
      }

      // Generar nuevo sessionId para evitar conflictos
      const originalId = sessionData.sessionId;
      sessionData.sessionId = `${sessionData.sessionId}_imported_${Date.now()}`;
      sessionData.lastModified = Date.now();
      sessionData.sessionName = `${sessionData.sessionName || 'Sesión importada'} (Importada)`;

      await this.saveSession(sessionData);

      console.log('[SessionManager] Sesión importada:', originalId, '→', sessionData.sessionId);
      return sessionData;
    } catch (error) {
      console.error('[SessionManager] Error al importar sesión:', error);
      throw error;
    }
  }

  /**
   * Habilita auto-guardado cada N segundos
   */
  enableAutoSave(sessionId, getStateCallback, intervalSeconds = 30) {
    // Limpiar auto-save anterior si existe
    this.disableAutoSave();

    this.autoSaveInterval = setInterval(async () => {
      try {
        const state = getStateCallback();
        if (state) {
          state.sessionId = sessionId;
          await this.saveSession(state);
          console.log('[SessionManager] Auto-guardado ejecutado');
        }
      } catch (error) {
        console.error('[SessionManager] Error en auto-guardado:', error);
      }
    }, intervalSeconds * 1000);

    console.log(`[SessionManager] Auto-guardado habilitado (cada ${intervalSeconds}s)`);
  }

  /**
   * Deshabilita auto-guardado
   */
  disableAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      console.log('[SessionManager] Auto-guardado deshabilitado');
    }
  }

  /**
   * Limpia la base de datos (solo para testing)
   */
  async clearAllSessions() {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('[SessionManager] Todas las sesiones eliminadas');
        resolve(true);
      };

      request.onerror = () => {
        console.error('[SessionManager] Error al limpiar sesiones:', request.error);
        reject(request.error);
      };
    });
  }
}

export default SessionManager;
