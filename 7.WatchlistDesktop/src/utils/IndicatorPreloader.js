// Sistema de precarga inteligente para indicadores
import localforage from 'localforage';

// ✅ Configurar localforage para usar IndexedDB
localforage.config({
  name: 'WatchlistIndicators',
  storeName: 'indicator_cache',
  description: 'Cached indicator data (Volume Profile, Open Interest, S&R)'
});

class IndicatorPreloader {
  static preloadedData = new Map(); // symbol_indicator_interval_days → data
  static loadingPromises = new Map(); // Evitar requests duplicados

  // TTL por tipo de indicador (en milisegundos)
  static TTL = {
    'Volume Profile': 60 * 60 * 1000,        // 1 hora (histórico, no cambia mucho)
    'Open Interest': 5 * 60 * 1000,          // 5 min (datos dinámicos)
    'Support & Resistance': 30 * 60 * 1000,  // 30 min (semi-dinámico)
    'VWAP': 60 * 60 * 1000,                  // 1 hora
    'Fibonacci': 60 * 60 * 1000,             // 1 hora
    'Continuation Patterns': 60 * 60 * 1000  // 1 hora
  };

  // Indicadores que necesitan precarga
  static PRELOADABLE_INDICATORS = [
    'Volume Profile',
    'Open Interest',
    'Support & Resistance'
  ];

  /**
   * Precarga todos los indicadores para todos los símbolos
   */
  static async preloadAllIndicators(symbols, interval, days, onProgress = null) {
    console.log(`[Preloader] 🚀 Iniciando precarga para ${symbols.length} símbolos`);
    const startTime = Date.now();

    // Crear todas las promesas de carga
    const allPromises = symbols.flatMap(symbol =>
      this.PRELOADABLE_INDICATORS.map(indicatorName =>
        this.preloadIndicator(symbol, indicatorName, interval, days)
      )
    );

    let completed = 0;
    const total = allPromises.length;

    // Ejecutar en paralelo con reporte de progreso
    const results = await Promise.allSettled(
      allPromises.map(p => p.then(result => {
        completed++;
        if (onProgress) {
          onProgress(completed, total);
        }
        return result;
      }))
    );

    const duration = (Date.now() - startTime) / 1000;
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`[Preloader] ✅ Precarga completada en ${duration}s (${succeeded} exitosos, ${failed} fallidos)`);

    return { succeeded, failed, duration };
  }

  /**
   * Precarga un indicador específico para un símbolo
   */
  static async preloadIndicator(symbol, indicatorName, interval, days) {
    const cacheKey = this.getCacheKey(symbol, indicatorName, interval, days);

    // Evitar requests duplicados
    if (this.loadingPromises.has(cacheKey)) {
      return this.loadingPromises.get(cacheKey);
    }

    // Verificar cache en memoria
    const cached = this.preloadedData.get(cacheKey);
    if (cached && this.isCacheValid(cached)) {
      console.log(`[Preloader] 💾 ${symbol} ${indicatorName} - desde memoria`);
      return cached.data;
    }

    // Verificar cache en IndexedDB
    const localCached = await this.getFromLocalStorage(cacheKey);  // ✅ await
    if (localCached && this.isCacheValid(localCached)) {
      console.log(`[Preloader] 💾 ${symbol} ${indicatorName} - desde IndexedDB`);
      this.preloadedData.set(cacheKey, localCached);
      return localCached.data;
    }

    // Crear promesa de carga
    const loadPromise = this.fetchIndicatorData(symbol, indicatorName, interval, days)
      .then(async (data) => {  // ✅ async
        const cacheEntry = {
          data,
          timestamp: Date.now(),
          ttl: this.TTL[indicatorName] || 3600000
        };

        // Guardar en memoria
        this.preloadedData.set(cacheKey, cacheEntry);

        // Guardar en IndexedDB (no blocking - fire and forget)
        this.saveToLocalStorage(cacheKey, cacheEntry).catch(err =>
          console.warn(`[Preloader] Error guardando en IndexedDB:`, err)
        );

        console.log(`[Preloader] ✅ ${symbol} ${indicatorName} - cargado y cacheado`);

        return data;
      })
      .catch(error => {
        console.error(`[Preloader] ❌ Error cargando ${symbol} ${indicatorName}:`, error);
        return null;
      })
      .finally(() => {
        this.loadingPromises.delete(cacheKey);
      });

    this.loadingPromises.set(cacheKey, loadPromise);
    return loadPromise;
  }

  /**
   * Obtiene datos precargados (desde memoria o IndexedDB)
   */
  static async getData(symbol, indicatorName, interval, days) {
    const cacheKey = this.getCacheKey(symbol, indicatorName, interval, days);

    // Prioridad 1: Memoria
    const memCached = this.preloadedData.get(cacheKey);
    if (memCached && this.isCacheValid(memCached)) {
      return memCached.data;
    }

    // Prioridad 2: IndexedDB
    const localCached = await this.getFromLocalStorage(cacheKey);  // ✅ await
    if (localCached && this.isCacheValid(localCached)) {
      // Restaurar a memoria
      this.preloadedData.set(cacheKey, localCached);
      return localCached.data;
    }

    return null;
  }

  /**
   * Fetchea datos del backend según el tipo de indicador
   */
  static async fetchIndicatorData(symbol, indicatorName, interval, days) {
    const API_BASE_URL = "http://localhost:8000";

    let url;
    switch (indicatorName) {
      case 'Volume Profile':
        url = `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&days=${days}`;
        break;
      case 'Open Interest':
        url = `${API_BASE_URL}/api/open-interest/${symbol}?interval=${interval}&days=${days}`;
        break;
      case 'Support & Resistance':
        url = `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&days=${days}`;
        break;
      default:
        throw new Error(`Indicador no soportado: ${indicatorName}`);
    }

    const response = await fetch(url);
    const json = await response.json();

    if (json.success && json.data) {
      return json.data;
    } else {
      throw new Error(`Error en API: ${json.error || 'Unknown error'}`);
    }
  }

  /**
   * Genera clave de cache única
   */
  static getCacheKey(symbol, indicatorName, interval, days) {
    return `${symbol}_${indicatorName}_${interval}_${days}`;
  }

  /**
   * Verifica si cache es válido (no expirado)
   */
  static isCacheValid(cacheEntry) {
    if (!cacheEntry || !cacheEntry.timestamp || !cacheEntry.ttl) {
      return false;
    }

    const age = Date.now() - cacheEntry.timestamp;
    return age < cacheEntry.ttl;
  }

  /**
   * Guarda en IndexedDB (via localforage)
   */
  static async saveToLocalStorage(cacheKey, cacheEntry) {
    try {
      const storageKey = `indicator_preload_${cacheKey}`;
      await localforage.setItem(storageKey, cacheEntry);  // ✅ No need to JSON.stringify!
    } catch (error) {
      console.warn(`[Preloader] No se pudo guardar en IndexedDB:`, error);
    }
  }

  /**
   * Lee desde IndexedDB (via localforage)
   */
  static async getFromLocalStorage(cacheKey) {
    try {
      const storageKey = `indicator_preload_${cacheKey}`;
      const stored = await localforage.getItem(storageKey);  // ✅ Returns object directly!
      return stored;
    } catch (error) {
      console.warn(`[Preloader] Error leyendo IndexedDB:`, error);
    }
    return null;
  }

  /**
   * Limpia cache expirado
   */
  static async clearExpiredCache() {
    let cleared = 0;

    // Limpiar memoria
    for (const [key, entry] of this.preloadedData.entries()) {
      if (!this.isCacheValid(entry)) {
        this.preloadedData.delete(key);
        cleared++;
      }
    }

    // Limpiar IndexedDB (via localforage)
    try {
      const keys = await localforage.keys();
      for (const key of keys) {
        if (key.startsWith('indicator_preload_')) {
          try {
            const entry = await localforage.getItem(key);
            if (!this.isCacheValid(entry)) {
              await localforage.removeItem(key);
              cleared++;
            }
          } catch (e) {
            // Ignorar errores de parsing
          }
        }
      }
    } catch (error) {
      console.warn(`[Preloader] Error obteniendo claves:`, error);
    }

    console.log(`[Preloader] 🧹 Limpiados ${cleared} caches expirados`);
  }

  /**
   * Limpia todo el cache
   */
  static async clearAllCache() {
    this.preloadedData.clear();

    // Limpiar IndexedDB (via localforage)
    try {
      const keys = await localforage.keys();
      const keysToRemove = keys.filter(key => key.startsWith('indicator_preload_'));

      await Promise.all(keysToRemove.map(key => localforage.removeItem(key)));

      console.log(`[Preloader] 🗑️ Cache completamente limpiado (${keysToRemove.length} items)`);
    } catch (error) {
      console.warn(`[Preloader] Error limpiando cache:`, error);
    }
  }
}

export default IndicatorPreloader;
