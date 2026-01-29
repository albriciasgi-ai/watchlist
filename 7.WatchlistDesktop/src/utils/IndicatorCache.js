/**
 * IndicatorCache.js - Cache para indicadores calculados
 *
 * Los indicadores soportados son:
 * - Swing H/L: Desde backend (/api/swing/signals)
 * - VWAP: Desde backend (/api/vwap-service/data)
 * - Volume: Calculado localmente de velas
 * - Volume Delta: Desde backend (/api/volume-delta)
 * - CVD: Desde backend (/api/volume-delta)
 * - S&R: Desde backend (/api/sr/levels)
 *
 * Estrategia:
 * - Para indicadores que vienen del backend, cacheamos la respuesta
 * - TTL corto (1-5 min) ya que cambian con nuevas velas
 * - Invalidamos cuando cambia el intervalo o llegan nuevas velas
 */

import localforage from 'localforage';

// Store específico para indicadores
const indicatorStore = localforage.createInstance({
  name: 'WatchlistCache',
  storeName: 'indicators',
  description: 'Cached indicator calculations'
});

class IndicatorCache {
  // TTL por tipo de indicador (en ms)
  static TTL = {
    'swing': 5 * 60 * 1000,      // 5 min - señales cambian poco
    'vwap': 2 * 60 * 1000,       // 2 min - se recalcula con cada vela
    'volume_delta': 2 * 60 * 1000,
    'cvd': 2 * 60 * 1000,
    'sr': 10 * 60 * 1000,        // 10 min - S&R cambia menos frecuente
    'default': 2 * 60 * 1000
  };

  // 🚀 LRU: Máximo de entradas en memoria
  static MAX_MEMORY_ENTRIES = 12; // ~4 símbolos × 3 indicadores

  // Cache en memoria para acceso ultra-rápido
  static memoryCache = new Map();

  // Lista de claves en orden LRU
  static lruOrder = [];

  /**
   * Genera clave única para el cache
   */
  static getCacheKey(indicatorType, symbol, interval, extraParams = {}) {
    const paramsStr = Object.entries(extraParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('_');
    return `${indicatorType}_${symbol}_${interval}${paramsStr ? '_' + paramsStr : ''}`;
  }

  /**
   * Obtiene datos del cache
   * @returns {Promise<any|null>} Datos cacheados o null
   */
  static async get(indicatorType, symbol, interval, extraParams = {}) {
    const key = this.getCacheKey(indicatorType, symbol, interval, extraParams);

    // Prioridad 1: Memoria
    if (this.memoryCache.has(key)) {
      const cached = this.memoryCache.get(key);
      if (this.isValid(cached, indicatorType)) {
        // 🚀 LRU: Mover al final (más reciente)
        this._touchLRU(key);
        console.log(`[IndicatorCache] 💾 ${indicatorType}@${symbol} desde memoria`);
        return cached.data;
      }
      // Expirado - eliminar
      this.memoryCache.delete(key);
      this._removeLRU(key);
    }

    // Prioridad 2: IndexedDB
    try {
      const stored = await indicatorStore.getItem(key);
      if (stored && this.isValid(stored, indicatorType)) {
        // 🚀 LRU: Restaurar a memoria con límite
        this._addToMemoryLRU(key, stored);
        console.log(`[IndicatorCache] 💾 ${indicatorType}@${symbol} desde IndexedDB`);
        return stored.data;
      }
    } catch (error) {
      console.warn(`[IndicatorCache] Error leyendo IndexedDB:`, error);
    }

    return null;
  }

  /**
   * 🚀 LRU: Mueve una clave al final (más reciente)
   */
  static _touchLRU(key) {
    const index = this.lruOrder.indexOf(key);
    if (index > -1) {
      this.lruOrder.splice(index, 1);
    }
    this.lruOrder.push(key);
  }

  /**
   * 🚀 LRU: Remueve una clave del orden
   */
  static _removeLRU(key) {
    const index = this.lruOrder.indexOf(key);
    if (index > -1) {
      this.lruOrder.splice(index, 1);
    }
  }

  /**
   * 🚀 LRU: Agrega a memoria respetando el límite
   */
  static _addToMemoryLRU(key, value) {
    // Si ya está, solo actualizar y mover al final
    if (this.memoryCache.has(key)) {
      this.memoryCache.set(key, value);
      this._touchLRU(key);
      return;
    }

    // Si memoria llena, eliminar el más antiguo
    while (this.memoryCache.size >= this.MAX_MEMORY_ENTRIES && this.lruOrder.length > 0) {
      const oldestKey = this.lruOrder.shift();
      this.memoryCache.delete(oldestKey);
    }

    // Agregar nuevo
    this.memoryCache.set(key, value);
    this.lruOrder.push(key);
  }

  /**
   * Guarda datos en cache
   */
  static async set(indicatorType, symbol, interval, data, extraParams = {}) {
    if (!data) return;

    const key = this.getCacheKey(indicatorType, symbol, interval, extraParams);

    const cacheEntry = {
      data,
      savedAt: Date.now(),
      indicatorType,
      symbol,
      interval
    };

    // 🚀 LRU: Guardar en memoria con límite
    this._addToMemoryLRU(key, cacheEntry);

    // Guardar en IndexedDB (async, no blocking)
    try {
      await indicatorStore.setItem(key, cacheEntry);
    } catch (error) {
      console.warn(`[IndicatorCache] Error guardando en IndexedDB:`, error);
    }
  }

  /**
   * Verifica si el cache es válido
   */
  static isValid(cacheEntry, indicatorType) {
    if (!cacheEntry || !cacheEntry.savedAt) return false;

    const ttl = this.TTL[indicatorType] || this.TTL.default;
    const age = Date.now() - cacheEntry.savedAt;
    return age < ttl;
  }

  /**
   * Invalida cache para un símbolo/intervalo específico
   * Útil cuando llega nueva vela por WebSocket
   */
  static async invalidate(symbol, interval) {
    const prefix = `_${symbol}_${interval}`;
    // Also match swing_SYMBOL (for cases where interval isn't in key)
    const symbolPrefix = `_${symbol}`;

    let memoryDeleted = 0;
    let indexedDBDeleted = 0;

    // Limpiar de memoria
    for (const key of Array.from(this.memoryCache.keys())) {
      if (key.includes(prefix) || (key.startsWith('swing_') && key.includes(symbolPrefix))) {
        this.memoryCache.delete(key);
        this._removeLRU(key);
        memoryDeleted++;
      }
    }

    // Limpiar de IndexedDB
    try {
      const keys = await indicatorStore.keys();
      for (const key of keys) {
        if (key.includes(prefix) || (key.startsWith('swing_') && key.includes(symbolPrefix))) {
          await indicatorStore.removeItem(key);
          indexedDBDeleted++;
        }
      }
    } catch (error) {
      console.warn(`[IndicatorCache] Error invalidando:`, error);
    }

    if (memoryDeleted > 0 || indexedDBDeleted > 0) {
      console.log(`[IndicatorCache] 🗑️ Invalidado ${symbol}: ${memoryDeleted} memoria, ${indexedDBDeleted} IndexedDB`);
    }
  }

  /**
   * Limpia todo el cache de indicadores
   */
  static async clearAll() {
    this.memoryCache.clear();
    this.lruOrder = []; // 🚀 LRU: Limpiar orden
    try {
      await indicatorStore.clear();
      console.log(`[IndicatorCache] 🗑️ Todo el cache limpiado`);
    } catch (error) {
      console.warn(`[IndicatorCache] Error limpiando:`, error);
    }
  }

  /**
   * Obtiene estadísticas del cache
   */
  static async getStats() {
    const stats = {
      memoryEntries: this.memoryCache.size,
      indexedDBEntries: 0
    };

    try {
      const keys = await indicatorStore.keys();
      stats.indexedDBEntries = keys.length;
    } catch (error) {
      console.warn(`[IndicatorCache] Error obteniendo stats:`, error);
    }

    return stats;
  }
}

export default IndicatorCache;
