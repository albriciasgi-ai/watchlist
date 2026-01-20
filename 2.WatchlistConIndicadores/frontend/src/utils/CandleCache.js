/**
 * CandleCache.js - Sistema de cache persistente para velas históricas
 *
 * Guarda velas en IndexedDB para evitar re-pedirlas al backend.
 * Soporta carga incremental: solo pide las velas que faltan.
 *
 * Indicadores soportados: Swing H/L, VWAP, Volume, Volume Delta, CVD, S&R
 */

import localforage from 'localforage';

// Configurar store específico para velas
const candleStore = localforage.createInstance({
  name: 'WatchlistCache',
  storeName: 'candles',
  description: 'Cached candle data for incremental loading'
});

class CandleCache {
  // TTL para velas cerradas (24 horas - las velas históricas no cambian)
  static CLOSED_CANDLE_TTL = 24 * 60 * 60 * 1000;

  // 🚀 LRU: Máximo de entradas en memoria (el resto queda en IndexedDB)
  static MAX_MEMORY_ENTRIES = 4;

  // Cache en memoria para acceso rápido (LRU order: más reciente al final)
  static memoryCache = new Map();

  // Lista de claves en orden LRU (más antiguo primero, más reciente al final)
  static lruOrder = [];

  /**
   * Genera clave única para el cache
   */
  static getCacheKey(symbol, interval) {
    return `candles_${symbol}_${interval}`;
  }

  /**
   * Obtiene velas del cache (memoria o IndexedDB)
   * @returns {Promise<{candles: Array, lastTimestamp: number}|null>}
   */
  static async get(symbol, interval) {
    const key = this.getCacheKey(symbol, interval);

    // Prioridad 1: Memoria
    if (this.memoryCache.has(key)) {
      const cached = this.memoryCache.get(key);
      if (this.isValid(cached)) {
        // 🚀 LRU: Mover al final (más reciente)
        this._touchLRU(key);
        console.log(`[CandleCache] 💾 ${symbol}@${interval} - desde memoria (${cached.candles.length} velas)`);
        return cached;
      }
    }

    // Prioridad 2: IndexedDB
    try {
      const stored = await candleStore.getItem(key);
      if (stored && this.isValid(stored)) {
        // 🚀 LRU: Restaurar a memoria con límite
        this._addToMemoryLRU(key, stored);
        console.log(`[CandleCache] 💾 ${symbol}@${interval} - desde IndexedDB (${stored.candles.length} velas)`);
        return stored;
      }
    } catch (error) {
      console.warn(`[CandleCache] Error leyendo IndexedDB:`, error);
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
      console.log(`[CandleCache] 🔄 LRU evict: ${oldestKey} (memoria: ${this.memoryCache.size}/${this.MAX_MEMORY_ENTRIES})`);
    }

    // Agregar nuevo
    this.memoryCache.set(key, value);
    this.lruOrder.push(key);
  }

  /**
   * Guarda velas en cache
   * @param {string} symbol
   * @param {string} interval
   * @param {Array} candles - Array de velas
   */
  static async set(symbol, interval, candles) {
    if (!candles || candles.length === 0) return;

    const key = this.getCacheKey(symbol, interval);

    // Ordenar por timestamp ascendente
    const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);

    // Remover vela en progreso (la última si está marcada como in_progress)
    const closedCandles = sortedCandles.filter(c => !c.in_progress);

    const cacheEntry = {
      candles: closedCandles,
      lastTimestamp: closedCandles.length > 0 ? closedCandles[closedCandles.length - 1].timestamp : 0,
      firstTimestamp: closedCandles.length > 0 ? closedCandles[0].timestamp : 0,
      savedAt: Date.now(),
      symbol,
      interval
    };

    // 🚀 LRU: Guardar en memoria con límite
    this._addToMemoryLRU(key, cacheEntry);

    // Guardar en IndexedDB (async, no blocking) - siempre guarda para persistencia
    try {
      await candleStore.setItem(key, cacheEntry);
      console.log(`[CandleCache] ✅ ${symbol}@${interval} - guardado (${closedCandles.length} velas, memoria: ${this.memoryCache.size}/${this.MAX_MEMORY_ENTRIES})`);
    } catch (error) {
      console.warn(`[CandleCache] Error guardando en IndexedDB:`, error);
    }
  }

  /**
   * Merge: combina velas del cache con velas nuevas
   * @param {Array} cachedCandles - Velas del cache
   * @param {Array} newCandles - Velas nuevas del servidor
   * @returns {Array} - Velas combinadas sin duplicados
   */
  static merge(cachedCandles, newCandles) {
    if (!cachedCandles || cachedCandles.length === 0) return newCandles;
    if (!newCandles || newCandles.length === 0) return cachedCandles;

    // Crear map para deduplicación por timestamp
    const candleMap = new Map();

    // Agregar velas del cache primero
    cachedCandles.forEach(c => candleMap.set(c.timestamp, c));

    // Agregar/actualizar con velas nuevas (sobrescriben si hay conflicto)
    newCandles.forEach(c => candleMap.set(c.timestamp, c));

    // Convertir a array y ordenar
    const merged = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[CandleCache] 🔄 Merge: ${cachedCandles.length} cached + ${newCandles.length} new = ${merged.length} total`);

    return merged;
  }

  /**
   * Verifica si el cache es válido (no muy viejo)
   */
  static isValid(cacheEntry) {
    if (!cacheEntry || !cacheEntry.savedAt) return false;

    const age = Date.now() - cacheEntry.savedAt;
    return age < this.CLOSED_CANDLE_TTL;
  }

  /**
   * Obtiene el timestamp desde el cual pedir datos nuevos
   * @returns {number|null} - Timestamp o null si no hay cache
   */
  static async getLastTimestamp(symbol, interval) {
    const cached = await this.get(symbol, interval);
    return cached ? cached.lastTimestamp : null;
  }

  /**
   * Limpia cache para un símbolo/intervalo específico
   */
  static async clear(symbol, interval) {
    const key = this.getCacheKey(symbol, interval);
    this.memoryCache.delete(key);
    // 🚀 LRU: Remover de la lista de orden
    const index = this.lruOrder.indexOf(key);
    if (index > -1) {
      this.lruOrder.splice(index, 1);
    }
    try {
      await candleStore.removeItem(key);
      console.log(`[CandleCache] 🗑️ ${symbol}@${interval} - cache limpiado`);
    } catch (error) {
      console.warn(`[CandleCache] Error limpiando cache:`, error);
    }
  }

  /**
   * Limpia todo el cache
   */
  static async clearAll() {
    this.memoryCache.clear();
    this.lruOrder = []; // 🚀 LRU: Limpiar orden
    try {
      await candleStore.clear();
      console.log(`[CandleCache] 🗑️ Todo el cache limpiado`);
    } catch (error) {
      console.warn(`[CandleCache] Error limpiando todo el cache:`, error);
    }
  }

  /**
   * Obtiene estadísticas del cache
   */
  static async getStats() {
    const stats = {
      memoryEntries: this.memoryCache.size,
      indexedDBEntries: 0,
      totalCandles: 0
    };

    try {
      const keys = await candleStore.keys();
      stats.indexedDBEntries = keys.length;

      for (const key of keys) {
        const entry = await candleStore.getItem(key);
        if (entry && entry.candles) {
          stats.totalCandles += entry.candles.length;
        }
      }
    } catch (error) {
      console.warn(`[CandleCache] Error obteniendo stats:`, error);
    }

    return stats;
  }
}

export default CandleCache;
