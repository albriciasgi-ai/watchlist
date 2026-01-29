/**
 * BackgroundPreloader.js - Precarga inteligente de datos en background
 *
 * Usa requestIdleCallback para cargar datos cuando el navegador está inactivo.
 * Prioriza símbolos visibles, luego precarga los invisibles.
 */

import CandleCache from './CandleCache.js';
import { API_BASE_URL } from '../config.js';

class BackgroundPreloader {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.currentInterval = '60';
    this.currentDays = 1;
    this.visibleSymbols = new Set();
    this.allSymbols = [];
    this.enabled = true;

    // Cooldown para evitar recargas excesivas (5 minutos por símbolo)
    this.lastLoadTime = new Map();
    this.COOLDOWN_MS = 5 * 60 * 1000;
  }

  /**
   * Configura los parámetros de carga
   */
  configure({ interval, days, symbols }) {
    if (interval) this.currentInterval = interval;
    if (days) this.currentDays = days;
    if (symbols) this.allSymbols = symbols;

    console.log(`[BackgroundPreloader] ⚙️ Configurado: interval=${this.currentInterval}, days=${this.currentDays}, ${this.allSymbols.length} símbolos`);
  }

  /**
   * Actualiza la lista de símbolos visibles
   */
  setVisibleSymbols(symbols) {
    this.visibleSymbols = new Set(symbols);
  }

  /**
   * Habilita o deshabilita el preloader
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.queue = [];
    }
  }

  /**
   * Inicia la precarga de símbolos no visibles
   */
  startPreloading() {
    if (!this.enabled || this.isProcessing) return;

    // Construir cola: símbolos no visibles que no tengan cooldown activo
    const now = Date.now();
    this.queue = this.allSymbols
      .filter(symbol => !this.visibleSymbols.has(symbol))
      .filter(symbol => {
        const lastLoad = this.lastLoadTime.get(`${symbol}_${this.currentInterval}`);
        return !lastLoad || (now - lastLoad) > this.COOLDOWN_MS;
      });

    if (this.queue.length === 0) {
      console.log('[BackgroundPreloader] ✅ Todos los símbolos ya están en cache o en cooldown');
      return;
    }

    console.log(`[BackgroundPreloader] 🚀 Iniciando precarga de ${this.queue.length} símbolos`);
    this.processQueue();
  }

  /**
   * Procesa la cola usando requestIdleCallback
   */
  processQueue() {
    if (!this.enabled || this.queue.length === 0) {
      this.isProcessing = false;
      console.log('[BackgroundPreloader] ✅ Cola de precarga vacía');
      return;
    }

    this.isProcessing = true;

    // Usar requestIdleCallback si disponible, sino setTimeout
    const scheduleNext = (callback) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 5000 });
      } else {
        setTimeout(callback, 100);
      }
    };

    scheduleNext(async (deadline) => {
      // Solo procesar si hay tiempo disponible (>10ms) o si timeout
      const hasTime = deadline?.timeRemaining ? deadline.timeRemaining() > 10 : true;

      if (hasTime && this.queue.length > 0 && this.enabled) {
        const symbol = this.queue.shift();
        await this.preloadSymbol(symbol);

        // Pequeña pausa entre cargas para no saturar
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Continuar con el siguiente
      this.processQueue();
    });
  }

  /**
   * Precarga datos para un símbolo específico
   */
  async preloadSymbol(symbol) {
    const cacheKey = `${symbol}_${this.currentInterval}`;

    try {
      // Verificar si ya hay cache valido (getValidated limpia cache corrupto)
      const cached = await CandleCache.getValidated(symbol, this.currentInterval, parseInt(this.currentDays));

      let url;
      let isIncremental = false;

      if (cached && cached.candles.length > 0) {
        // Carga incremental
        const sinceTs = cached.lastTimestamp;
        url = `${API_BASE_URL}/api/historical/${symbol}?interval=${this.currentInterval}&since_timestamp=${sinceTs}`;
        isIncremental = true;
        console.log(`[BackgroundPreloader] ${symbol} incremental desde ${new Date(sinceTs).toLocaleTimeString()}`);
      } else {
        // Carga completa (cache vacio o limpiado por corrupto)
        url = `${API_BASE_URL}/api/historical/${symbol}?interval=${this.currentInterval}&days=${this.currentDays}`;
        console.log(`[BackgroundPreloader] ${symbol} carga completa (${this.currentDays} dias)`);
      }

      const res = await fetch(url, {
        cache: 'no-cache',
        headers: { 'Cache-Control': 'no-cache' }
      });
      const json = await res.json();

      if (json.success && json.data) {
        let newCandles = json.data;

        // Filtrar vela en progreso
        if (newCandles.length > 0) {
          const now = Date.now();
          const intervalMs = this.getIntervalMs(this.currentInterval);
          const currentTimeframeStart = Math.floor(now / intervalMs) * intervalMs;
          const lastCandle = newCandles[newCandles.length - 1];
          if (lastCandle.timestamp >= currentTimeframeStart) {
            newCandles = newCandles.slice(0, -1);
          }
        }

        // Merge con cache si es incremental
        let finalCandles;
        if (isIncremental && cached) {
          finalCandles = CandleCache.merge(cached.candles, newCandles);
        } else {
          finalCandles = newCandles;
        }

        // Guardar en cache
        await CandleCache.set(symbol, this.currentInterval, finalCandles);

        // Actualizar tiempo de última carga
        this.lastLoadTime.set(cacheKey, Date.now());

        console.log(`[BackgroundPreloader] ✅ ${symbol}: ${finalCandles.length} velas en cache`);
      }
    } catch (error) {
      console.warn(`[BackgroundPreloader] ⚠️ Error precargando ${symbol}:`, error.message);
    }
  }

  /**
   * Obtiene milisegundos por intervalo
   */
  getIntervalMs(interval) {
    const map = {
      "1": 60000, "3": 180000, "5": 300000, "15": 900000, "30": 1800000,
      "60": 3600000, "120": 7200000, "240": 14400000, "D": 86400000, "W": 604800000
    };
    return map[interval] || 900000;
  }

  /**
   * Fuerza recarga de un símbolo específico (ignora cooldown)
   */
  async forcePreload(symbol) {
    this.lastLoadTime.delete(`${symbol}_${this.currentInterval}`);
    await this.preloadSymbol(symbol);
  }

  /**
   * Limpia cooldowns (útil para testing)
   */
  clearCooldowns() {
    this.lastLoadTime.clear();
    console.log('[BackgroundPreloader] 🗑️ Cooldowns limpiados');
  }

  /**
   * Obtiene estadísticas
   */
  getStats() {
    return {
      enabled: this.enabled,
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      visibleCount: this.visibleSymbols.size,
      totalSymbols: this.allSymbols.length,
      cooldownEntries: this.lastLoadTime.size
    };
  }
}

// Singleton
const backgroundPreloader = new BackgroundPreloader();
export default backgroundPreloader;
