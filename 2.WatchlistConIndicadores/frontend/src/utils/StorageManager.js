// src/utils/StorageManager.js
// ✅ OPTIMIZACIÓN: Gestión centralizada de localStorage
// Beneficios:
// - Debounce de escrituras (evita escrituras excesivas)
// - Cache en memoria para lecturas rápidas
// - Flush automático antes de cerrar
// - Manejo de errores centralizado

/**
 * StorageManager - Gestión optimizada de localStorage
 *
 * Características:
 * - Cache en memoria para lecturas instantáneas
 * - Debounce de 2 segundos para escrituras
 * - Flush automático en beforeunload
 * - Namespace para evitar colisiones
 */
class StorageManager {
  constructor(namespace = 'watchlist') {
    this.namespace = namespace;

    // Cache en memoria: Map<key, value>
    this._cache = new Map();

    // Escrituras pendientes: Map<key, value>
    this._pendingWrites = new Map();

    // Timer de debounce
    this._debounceTimer = null;
    this._debounceMs = 2000; // 2 segundos

    // Bind handlers
    this._beforeUnloadHandler = this._onBeforeUnload.bind(this);

    // Registrar handler de beforeunload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this._beforeUnloadHandler);
    }

    // Precargar datos existentes en cache
    this._preloadCache();
  }

  /**
   * Obtiene un valor (primero de cache, luego de localStorage)
   * @param {string} key - Clave sin namespace
   * @param {*} defaultValue - Valor por defecto si no existe
   * @returns {*} Valor parseado o defaultValue
   */
  get(key, defaultValue = null) {
    const fullKey = this._getFullKey(key);

    // 1. Verificar en pendingWrites (más reciente)
    if (this._pendingWrites.has(fullKey)) {
      return this._pendingWrites.get(fullKey);
    }

    // 2. Verificar en cache
    if (this._cache.has(fullKey)) {
      return this._cache.get(fullKey);
    }

    // 3. Leer de localStorage
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        this._cache.set(fullKey, parsed);
        return parsed;
      }
    } catch (e) {
      console.error(`[StorageManager] Error reading ${key}:`, e);
    }

    return defaultValue;
  }

  /**
   * Guarda un valor (con debounce)
   * @param {string} key - Clave sin namespace
   * @param {*} value - Valor a guardar (será serializado a JSON)
   */
  set(key, value) {
    const fullKey = this._getFullKey(key);

    // Actualizar cache inmediatamente
    this._cache.set(fullKey, value);

    // Agregar a pendientes
    this._pendingWrites.set(fullKey, value);

    // Programar flush con debounce
    this._scheduleFlush();
  }

  /**
   * Elimina un valor
   * @param {string} key - Clave sin namespace
   */
  remove(key) {
    const fullKey = this._getFullKey(key);

    // Remover de cache
    this._cache.delete(fullKey);

    // Remover de pendientes
    this._pendingWrites.delete(fullKey);

    // Remover de localStorage inmediatamente
    try {
      localStorage.removeItem(fullKey);
    } catch (e) {
      console.error(`[StorageManager] Error removing ${key}:`, e);
    }
  }

  /**
   * Verifica si existe una clave
   */
  has(key) {
    const fullKey = this._getFullKey(key);
    return this._cache.has(fullKey) ||
           this._pendingWrites.has(fullKey) ||
           localStorage.getItem(fullKey) !== null;
  }

  /**
   * Fuerza flush inmediato de escrituras pendientes
   */
  flush() {
    if (this._pendingWrites.size === 0) return;

    const count = this._pendingWrites.size;

    for (const [fullKey, value] of this._pendingWrites) {
      try {
        localStorage.setItem(fullKey, JSON.stringify(value));
      } catch (e) {
        console.error(`[StorageManager] Error writing ${fullKey}:`, e);

        // Si es error de cuota, intentar limpiar datos viejos
        if (e.name === 'QuotaExceededError') {
          this._handleQuotaExceeded();
        }
      }
    }

    this._pendingWrites.clear();

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    console.log(`[StorageManager] Flushed ${count} pending writes`);
  }

  /**
   * Limpia todo el storage del namespace
   */
  clear() {
    const prefix = `${this.namespace}_`;

    // Limpiar localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    // Limpiar cache y pendientes
    this._cache.clear();
    this._pendingWrites.clear();

    console.log(`[StorageManager] Cleared ${keysToRemove.length} keys`);
  }

  /**
   * Obtiene estadísticas de uso
   */
  getStats() {
    let totalSize = 0;
    let keyCount = 0;
    const prefix = `${this.namespace}_`;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keyCount++;
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += key.length + value.length;
        }
      }
    }

    return {
      namespace: this.namespace,
      keyCount,
      totalSizeKB: (totalSize * 2 / 1024).toFixed(2), // UTF-16 = 2 bytes per char
      cacheSize: this._cache.size,
      pendingWrites: this._pendingWrites.size
    };
  }

  // === Métodos privados ===

  _getFullKey(key) {
    return `${this.namespace}_${key}`;
  }

  _scheduleFlush() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this.flush();
    }, this._debounceMs);
  }

  _preloadCache() {
    const prefix = `${this.namespace}_`;
    let loadedCount = 0;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          try {
            const value = localStorage.getItem(key);
            if (value) {
              this._cache.set(key, JSON.parse(value));
              loadedCount++;
            }
          } catch (e) {
            // Ignorar errores de parse individuales
          }
        }
      }

      if (loadedCount > 0) {
        console.log(`[StorageManager] Preloaded ${loadedCount} keys into cache`);
      }
    } catch (e) {
      console.error('[StorageManager] Error preloading cache:', e);
    }
  }

  _onBeforeUnload() {
    // Flush sincrónico antes de cerrar
    this.flush();
  }

  _handleQuotaExceeded() {
    console.warn('[StorageManager] Quota exceeded, attempting cleanup...');

    // Estrategia: eliminar datos más antiguos del namespace
    const prefix = `${this.namespace}_`;
    const keys = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    // Ordenar por tamaño y eliminar los más grandes primero
    keys.sort((a, b) => {
      const sizeA = (localStorage.getItem(a) || '').length;
      const sizeB = (localStorage.getItem(b) || '').length;
      return sizeB - sizeA;
    });

    // Eliminar hasta 10% de las claves
    const toRemove = Math.max(1, Math.floor(keys.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      localStorage.removeItem(keys[i]);
      this._cache.delete(keys[i]);
      console.log(`[StorageManager] Removed ${keys[i]} to free space`);
    }
  }

  /**
   * Destruye el manager (limpia listeners)
   */
  destroy() {
    this.flush();

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    }

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
  }
}

// Instancia singleton para la Watchlist
const storageManager = new StorageManager('watchlist');

// También exportamos la clase para crear instancias con otros namespaces
export { StorageManager };
export default storageManager;
