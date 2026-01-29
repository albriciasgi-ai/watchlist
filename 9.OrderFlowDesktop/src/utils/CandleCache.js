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

  // Mínimo de velas esperadas por día según timeframe
  static CANDLES_PER_DAY = {
    "1": 1440,   // 1 minuto
    "5": 288,    // 5 minutos
    "15": 96,    // 15 minutos
    "30": 48,    // 30 minutos
    "60": 24,    // 1 hora
    "240": 6,    // 4 horas
    "D": 1,      // 1 día
    "W": 0.14    // 1 semana
  };

  // Umbral minimo: si cache tiene menos del 70% de lo esperado, se considera corrupto
  // Aumentado de 0.1 a 0.7 para evitar descartar cache valido innecesariamente
  static MIN_CACHE_RATIO = 0.7;

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
   * Calcula el minimo de velas esperadas para N dias en un intervalo
   * @param {string} interval - Timeframe ("1", "5", "60", etc)
   * @param {number} days - Cantidad de dias
   * @returns {number} - Minimo de velas esperadas
   */
  static getExpectedCandles(interval, days) {
    const candlesPerDay = this.CANDLES_PER_DAY[interval] || 1440;
    return Math.floor(candlesPerDay * days);
  }

  /**
   * Verifica si el cache tiene suficientes velas para los dias solicitados
   * Si tiene menos del MIN_CACHE_RATIO o tiene GAPS, se considera corrupto y se limpia
   * @param {string} symbol
   * @param {string} interval
   * @param {number} days - Dias solicitados
   * @returns {Promise<{candles: Array, lastTimestamp: number}|null>}
   */
  static async getValidated(symbol, interval, days) {
    const cached = await this.get(symbol, interval);

    if (!cached || !cached.candles) {
      return null;
    }

    const expectedCandles = this.getExpectedCandles(interval, days);
    const actualCandles = cached.candles.length;
    const ratio = actualCandles / expectedCandles;

    // Si el cache tiene menos del 70% de lo esperado, es corrupto
    if (ratio < this.MIN_CACHE_RATIO) {
      console.warn(`[CandleCache] ${symbol}@${interval} - Cache corrupto: ${actualCandles} velas (esperadas: ~${expectedCandles}, ratio: ${(ratio * 100).toFixed(1)}%)`);
      console.log(`[CandleCache] Limpiando cache corrupto para forzar recarga completa...`);
      await this.clear(symbol, interval);
      return null;
    }

    // NUEVO: Detectar gaps en el cache - si hay gaps, limpiar y forzar recarga
    const gapAnalysis = this.analyzeGaps(cached.candles, interval, `VALIDATION ${symbol}@${interval}`);
    if (gapAnalysis.gapCount > 0) {
      // Si hay gaps de mas de 2 minutos (para timeframe 1m), limpiar cache
      const significantGaps = gapAnalysis.gaps.filter(g => parseFloat(g.gapMinutes) > 2);
      if (significantGaps.length > 0) {
        console.warn(`[CandleCache] ${symbol}@${interval} - Cache tiene ${significantGaps.length} gaps significativos`);
        significantGaps.forEach((g, i) => {
          console.warn(`  Gap #${i + 1}: ${g.from} -> ${g.to} (${g.gapMinutes} min)`);
        });
        console.log(`[CandleCache] Limpiando cache con gaps para forzar recarga completa...`);
        await this.clear(symbol, interval);
        return null;
      }
    }

    // Cache valido
    console.log(`[CandleCache] ${symbol}@${interval} - Cache valido: ${actualCandles} velas, sin gaps significativos`);
    return cached;
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

  /**
   * DIAGNOSTICO: Analiza gaps en un array de velas
   * @param {Array} candles - Array de velas a analizar
   * @param {string} interval - Timeframe
   * @param {string} context - Contexto del log
   * @returns {Object} - Reporte de gaps
   */
  static analyzeGaps(candles, interval, context = "unknown") {
    if (!candles || candles.length < 2) {
      return { gapCount: 0, gaps: [], totalGapMinutes: 0 };
    }

    const intervalMs = {
      "1": 60000, "3": 180000, "5": 300000, "15": 900000,
      "30": 1800000, "60": 3600000, "240": 14400000,
      "D": 86400000, "W": 604800000
    }[interval] || 60000;

    const gapThreshold = intervalMs * 2;
    const gaps = [];

    for (let i = 1; i < candles.length; i++) {
      const ts1 = candles[i - 1].timestamp;
      const ts2 = candles[i].timestamp;
      const diff = ts2 - ts1;

      if (diff > gapThreshold) {
        const gapMinutes = diff / 60000;
        gaps.push({
          index: i,
          from: new Date(ts1).toLocaleString('es-CO'),
          to: new Date(ts2).toLocaleString('es-CO'),
          gapMinutes: gapMinutes.toFixed(1),
          gapHours: (gapMinutes / 60).toFixed(2)
        });
      }
    }

    const totalGapMinutes = gaps.reduce((sum, g) => sum + parseFloat(g.gapMinutes), 0);

    if (gaps.length > 0) {
      console.error(`[CandleCache] === GAPS en ${context} ===`);
      console.error(`  Total velas: ${candles.length}`);
      console.error(`  Primera: ${new Date(candles[0].timestamp).toLocaleString('es-CO')}`);
      console.error(`  Ultima: ${new Date(candles[candles.length - 1].timestamp).toLocaleString('es-CO')}`);
      console.error(`  Gaps encontrados: ${gaps.length}`);
      gaps.forEach((g, i) => {
        console.error(`    Gap #${i + 1}: ${g.from} -> ${g.to} (${g.gapMinutes} min = ${g.gapHours} hrs)`);
      });
      console.error(`  Tiempo total perdido: ${totalGapMinutes.toFixed(1)} min (${(totalGapMinutes / 60).toFixed(2)} hrs)`);
    } else {
      console.log(`[CandleCache] OK ${context}: ${candles.length} velas sin gaps`);
    }

    return { gapCount: gaps.length, gaps, totalGapMinutes };
  }
}

export default CandleCache;
