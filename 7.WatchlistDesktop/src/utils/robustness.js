/**
 * robustness.js - Utilidades para mejorar la robustez de la aplicacion
 *
 * Incluye:
 * - Validacion de datos de velas
 * - Health check del backend
 * - Retry con backoff exponencial
 * - Limpieza automatica de cache viejo
 */

import { API_BASE_URL } from '../config';

// ============================================================
// 1. VALIDACION DE DATOS DE VELAS
// ============================================================

/**
 * Valida que una vela tenga todos los campos requeridos y valores validos
 * @param {Object} candle - Objeto vela a validar
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validateCandle(candle) {
  const errors = [];

  if (!candle || typeof candle !== 'object') {
    return { valid: false, errors: ['Candle is null or not an object'] };
  }

  // Campos requeridos
  const requiredFields = ['timestamp', 'open', 'high', 'low', 'close'];
  for (const field of requiredFields) {
    if (candle[field] === undefined || candle[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validar tipos numericos
  const numericFields = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
  for (const field of numericFields) {
    if (candle[field] !== undefined && candle[field] !== null) {
      const value = Number(candle[field]);
      if (isNaN(value)) {
        errors.push(`Field ${field} is not a valid number: ${candle[field]}`);
      }
    }
  }

  // Validar logica OHLC
  if (candle.high !== undefined && candle.low !== undefined) {
    const high = Number(candle.high);
    const low = Number(candle.low);
    const open = Number(candle.open);
    const close = Number(candle.close);

    if (high < low) {
      errors.push(`Invalid OHLC: high (${high}) < low (${low})`);
    }
    if (open > high || open < low) {
      errors.push(`Invalid OHLC: open (${open}) outside high-low range`);
    }
    if (close > high || close < low) {
      errors.push(`Invalid OHLC: close (${close}) outside high-low range`);
    }
  }

  // Validar timestamp razonable (despues de 2020, antes de 2030)
  if (candle.timestamp) {
    const ts = Number(candle.timestamp);
    const minTs = new Date('2020-01-01').getTime();
    const maxTs = new Date('2030-01-01').getTime();
    if (ts < minTs || ts > maxTs) {
      errors.push(`Timestamp out of reasonable range: ${ts}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Valida un array de velas, filtrando las invalidas
 * @param {Array} candles - Array de velas
 * @param {string} context - Contexto para logging
 * @returns {Object} - { validCandles: Array, invalidCount: number, errors: string[] }
 */
export function validateCandles(candles, context = 'unknown') {
  if (!Array.isArray(candles)) {
    console.error(`[Validation] ${context}: candles is not an array`);
    return { validCandles: [], invalidCount: 0, errors: ['Input is not an array'] };
  }

  const validCandles = [];
  const allErrors = [];
  let invalidCount = 0;

  for (let i = 0; i < candles.length; i++) {
    const result = validateCandle(candles[i]);
    if (result.valid) {
      validCandles.push(candles[i]);
    } else {
      invalidCount++;
      if (invalidCount <= 5) { // Solo loguear los primeros 5 errores
        allErrors.push(`Candle[${i}]: ${result.errors.join(', ')}`);
      }
    }
  }

  if (invalidCount > 0) {
    console.warn(`[Validation] ${context}: ${invalidCount}/${candles.length} candles invalid`);
    if (allErrors.length > 0) {
      console.warn(`[Validation] First errors:`, allErrors);
    }
  }

  return { validCandles, invalidCount, errors: allErrors };
}


// ============================================================
// 2. HEALTH CHECK DEL BACKEND
// ============================================================

/**
 * Estado global del health check
 */
let healthCheckState = {
  isConnected: true,
  lastCheck: null,
  lastError: null,
  consecutiveFailures: 0,
  listeners: new Set()
};

/**
 * Registra un listener para cambios en el estado de conexion
 * @param {Function} callback - Funcion a llamar cuando cambie el estado
 * @returns {Function} - Funcion para desregistrar el listener
 */
export function onConnectionChange(callback) {
  healthCheckState.listeners.add(callback);
  // Notificar estado actual inmediatamente
  callback(healthCheckState.isConnected);
  return () => healthCheckState.listeners.delete(callback);
}

/**
 * Notifica a todos los listeners del cambio de estado
 */
function notifyListeners() {
  healthCheckState.listeners.forEach(cb => {
    try {
      cb(healthCheckState.isConnected);
    } catch (e) {
      console.error('[HealthCheck] Error in listener:', e);
    }
  });
}

/**
 * Verifica la conexion con el backend
 * @returns {Promise<boolean>} - true si conectado, false si no
 */
export async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(`${API_BASE_URL}/api/status`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const wasDisconnected = !healthCheckState.isConnected;
      healthCheckState.isConnected = true;
      healthCheckState.lastCheck = Date.now();
      healthCheckState.lastError = null;
      healthCheckState.consecutiveFailures = 0;

      if (wasDisconnected) {
        console.log('[HealthCheck] Backend reconnected');
        notifyListeners();
      }
      return true;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const wasConnected = healthCheckState.isConnected;
    healthCheckState.isConnected = false;
    healthCheckState.lastCheck = Date.now();
    healthCheckState.lastError = error.message;
    healthCheckState.consecutiveFailures++;

    if (wasConnected) {
      console.error(`[HealthCheck] Backend disconnected: ${error.message}`);
      notifyListeners();
    }
    return false;
  }
}

/**
 * Obtiene el estado actual del health check
 */
export function getHealthCheckState() {
  return { ...healthCheckState };
}

// Variables para el intervalo de health check
let healthCheckIntervalId = null;

/**
 * Inicia el health check periodico
 * @param {number} intervalMs - Intervalo en milisegundos (default: 30000)
 */
export function startHealthCheck(intervalMs = 30000) {
  if (healthCheckIntervalId) {
    console.log('[HealthCheck] Already running');
    return;
  }

  // Check inmediato
  checkBackendHealth();

  // Check periodico
  healthCheckIntervalId = setInterval(() => {
    checkBackendHealth();
  }, intervalMs);

  console.log(`[HealthCheck] Started (interval: ${intervalMs}ms)`);
}

/**
 * Detiene el health check periodico
 */
export function stopHealthCheck() {
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
    console.log('[HealthCheck] Stopped');
  }
}


// ============================================================
// 3. RETRY CON BACKOFF EXPONENCIAL
// ============================================================

/**
 * Ejecuta una funcion async con reintentos y backoff exponencial
 * @param {Function} fn - Funcion async a ejecutar
 * @param {Object} options - Opciones de configuracion
 * @returns {Promise} - Resultado de la funcion o error despues de todos los reintentos
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffFactor = 2,
    shouldRetry = () => true, // Funcion que decide si reintentar basado en el error
    onRetry = null, // Callback opcional cuando se reintenta
    context = 'unknown'
  } = options;

  let lastError;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt > maxRetries || !shouldRetry(error)) {
        break;
      }

      console.warn(`[Retry] ${context}: Attempt ${attempt}/${maxRetries + 1} failed: ${error.message}`);

      if (onRetry) {
        onRetry(attempt, error, delay);
      }

      // Esperar antes de reintentar
      await new Promise(resolve => setTimeout(resolve, delay));

      // Aumentar delay con backoff exponencial
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  console.error(`[Retry] ${context}: All ${maxRetries + 1} attempts failed`);
  throw lastError;
}

/**
 * Wrapper para fetch con retry automatico
 * @param {string} url - URL a fetch
 * @param {Object} fetchOptions - Opciones para fetch
 * @param {Object} retryOptions - Opciones de retry
 * @returns {Promise<Response>} - Response del fetch
 */
export async function fetchWithRetry(url, fetchOptions = {}, retryOptions = {}) {
  const defaultRetryOptions = {
    maxRetries: 3,
    initialDelayMs: 1000,
    context: url.split('/').pop() || 'fetch',
    shouldRetry: (error) => {
      // Reintentar en errores de red o 5xx
      if (error.name === 'AbortError') return false; // No reintentar si fue cancelado
      if (error.message?.includes('Failed to fetch')) return true;
      if (error.status >= 500) return true;
      return false;
    }
  };

  return withRetry(
    async () => {
      const response = await fetch(url, fetchOptions);
      if (!response.ok && response.status >= 500) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response;
    },
    { ...defaultRetryOptions, ...retryOptions }
  );
}


// ============================================================
// 4. LIMPIEZA AUTOMATICA DE CACHE VIEJO
// ============================================================

import localforage from 'localforage';

// Store para velas (mismo que usa CandleCache)
const candleStore = localforage.createInstance({
  name: 'WatchlistCache',
  storeName: 'candles'
});

// Store para indicadores (mismo que usa IndicatorCache)
const indicatorStore = localforage.createInstance({
  name: 'WatchlistCache',
  storeName: 'indicators'
});

/**
 * Limpia entradas de cache mas viejas que maxAgeDays
 * @param {number} maxAgeDays - Dias maximos de antiguedad (default: 7)
 * @returns {Promise<Object>} - Estadisticas de limpieza
 */
export async function cleanupOldCache(maxAgeDays = 7) {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const stats = {
    candlesChecked: 0,
    candlesRemoved: 0,
    indicatorsChecked: 0,
    indicatorsRemoved: 0,
    errors: []
  };

  // Limpiar cache de velas
  try {
    const candleKeys = await candleStore.keys();
    stats.candlesChecked = candleKeys.length;

    for (const key of candleKeys) {
      try {
        const entry = await candleStore.getItem(key);
        if (entry && entry.savedAt) {
          const age = now - entry.savedAt;
          if (age > maxAgeMs) {
            await candleStore.removeItem(key);
            stats.candlesRemoved++;
            console.log(`[CacheCleanup] Removed old candle cache: ${key} (age: ${Math.round(age / 86400000)}d)`);
          }
        }
      } catch (e) {
        stats.errors.push(`Candle ${key}: ${e.message}`);
      }
    }
  } catch (e) {
    stats.errors.push(`Candle store: ${e.message}`);
  }

  // Limpiar cache de indicadores
  try {
    const indicatorKeys = await indicatorStore.keys();
    stats.indicatorsChecked = indicatorKeys.length;

    for (const key of indicatorKeys) {
      try {
        const entry = await indicatorStore.getItem(key);
        if (entry && entry.savedAt) {
          const age = now - entry.savedAt;
          if (age > maxAgeMs) {
            await indicatorStore.removeItem(key);
            stats.indicatorsRemoved++;
            console.log(`[CacheCleanup] Removed old indicator cache: ${key} (age: ${Math.round(age / 86400000)}d)`);
          }
        }
      } catch (e) {
        stats.errors.push(`Indicator ${key}: ${e.message}`);
      }
    }
  } catch (e) {
    stats.errors.push(`Indicator store: ${e.message}`);
  }

  console.log(`[CacheCleanup] Complete: ${stats.candlesRemoved}/${stats.candlesChecked} candles, ${stats.indicatorsRemoved}/${stats.indicatorsChecked} indicators removed`);

  return stats;
}

/**
 * Obtiene estadisticas del cache actual
 * @returns {Promise<Object>} - Estadisticas del cache
 */
export async function getCacheStats() {
  const stats = {
    candles: { count: 0, totalSize: 0, oldestAge: 0, entries: [] },
    indicators: { count: 0, totalSize: 0, oldestAge: 0, entries: [] }
  };

  const now = Date.now();

  try {
    const candleKeys = await candleStore.keys();
    stats.candles.count = candleKeys.length;

    for (const key of candleKeys) {
      const entry = await candleStore.getItem(key);
      if (entry) {
        const age = entry.savedAt ? Math.round((now - entry.savedAt) / 86400000) : '?';
        const size = entry.candles ? entry.candles.length : 0;
        stats.candles.entries.push({ key, age: `${age}d`, candles: size });
        stats.candles.totalSize += size;
        if (entry.savedAt && (now - entry.savedAt) > stats.candles.oldestAge) {
          stats.candles.oldestAge = now - entry.savedAt;
        }
      }
    }
  } catch (e) {
    console.error('[CacheStats] Error reading candle store:', e);
  }

  try {
    const indicatorKeys = await indicatorStore.keys();
    stats.indicators.count = indicatorKeys.length;

    for (const key of indicatorKeys) {
      const entry = await indicatorStore.getItem(key);
      if (entry) {
        const age = entry.savedAt ? Math.round((now - entry.savedAt) / 86400000) : '?';
        stats.indicators.entries.push({ key, age: `${age}d` });
        if (entry.savedAt && (now - entry.savedAt) > stats.indicators.oldestAge) {
          stats.indicators.oldestAge = now - entry.savedAt;
        }
      }
    }
  } catch (e) {
    console.error('[CacheStats] Error reading indicator store:', e);
  }

  stats.candles.oldestAge = Math.round(stats.candles.oldestAge / 86400000);
  stats.indicators.oldestAge = Math.round(stats.indicators.oldestAge / 86400000);

  return stats;
}


// ============================================================
// 5. INICIALIZACION
// ============================================================

/**
 * Inicializa todas las utilidades de robustez
 * Llamar una vez al iniciar la aplicacion
 */
export function initRobustness() {
  // Iniciar health check cada 30 segundos
  startHealthCheck(30000);

  // Limpiar cache viejo al iniciar (>7 dias)
  cleanupOldCache(7).then(stats => {
    if (stats.candlesRemoved > 0 || stats.indicatorsRemoved > 0) {
      console.log('[Robustness] Old cache cleaned on startup');
    }
  });

  console.log('[Robustness] Initialized');
}

/**
 * Detiene todas las utilidades de robustez
 * Llamar al cerrar la aplicacion
 */
export function stopRobustness() {
  stopHealthCheck();
  console.log('[Robustness] Stopped');
}
