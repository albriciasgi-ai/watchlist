// src/components/indicators/RejectionPatternIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import LocalPatternDetector from './LocalPatternDetector.js';
import { createLogger } from '../../utils/Logger.js';
import { syncConfig } from '../../utils/ConfigSynchronizer.js';

/**
 * Rejection Pattern Indicator
 *
 * Displays candlestick rejection patterns (Hammer, Shooting Star, Engulfing, etc.)
 * - Mode "Show All": Shows all detected patterns (local detection)
 * - Mode "Validated Only": Shows only patterns validated against reference contexts (backend)
 */
class RejectionPatternIndicator extends IndicatorBase {
  // ✅ Variables estáticas para limitar popups globalmente (compartidas entre todos los símbolos)
  static activePopups = 0;
  static MAX_SIMULTANEOUS_POPUPS = 3;

  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Rejection Patterns";
    this.patterns = []; // Validated patterns from backend
    this.localPatterns = []; // All patterns from local detection
    this.config = this.loadConfig();
    this.height = 0; // Overlay on main chart, no separate pane
    this.localDetector = new LocalPatternDetector();
    this.showMode = 'validated'; // 'all' or 'validated' - Cambiado a validated por default
    this.colors = {
      HAMMER: '#4CAF50',
      SHOOTING_STAR: '#f44336',
      ENGULFING_BULLISH: '#2196F3',
      ENGULFING_BEARISH: '#FF9800',
      DOJI_DRAGONFLY: '#9C27B0',
      DOJI_GRAVESTONE: '#607D8B',
      SWING_LOW: '#00E676',   // Verde brillante para LONG
      SWING_HIGH: '#FF1744'   // Rojo brillante para SHORT
    };
    this.icons = {
      HAMMER: '🔨',
      SHOOTING_STAR: '⭐',
      ENGULFING_BULLISH: '📈',
      ENGULFING_BEARISH: '📉',
      DOJI_DRAGONFLY: '🐉',
      DOJI_GRAVESTONE: '🪦',
      SWING_LOW: '↑',    // Flecha arriba para LONG
      SWING_HIGH: '↓'    // Flecha abajo para SHORT
    };

    // ✅ NUEVO: Sistema de alertas automáticas
    this.alertedPatterns = this.loadAlertedPatterns(); // ✅ FIX #4: Cargar desde localStorage
    this.alertCooldownMs = 5 * 60 * 1000; // 5 minutos de cooldown (legacy)
    this.notificationPermissionRequested = false; // Flag para pedir permiso una sola vez
    this.alertSystemStartTime = this.loadAlertSystemStartTime(); // ✅ PERSISTIDO: Cargar desde localStorage
    this.logger = createLogger(this.symbol); // Logger con contexto del símbolo

    // ✅ NUEVO: Cooldown global entre alertas (configurable)
    this.lastGlobalAlertTimestamp = this.loadLastGlobalAlertTimestamp();

    // ✅ NUEVO: Sistema de merge de patrones (evita re-detección en cada render)
    this.knownPatterns = new Map(); // Map de patternId -> pattern para tracking
    this.lastDetectionTime = 0; // Timestamp de última detección completa
    this.detectionThrottleMs = 1000; // Mínimo 1 segundo entre detecciones completas

    // ✅ FIX #3: Sistema de throttling para prevenir llamadas múltiples
    this.lastAlertCheckTime = 0;
    this.alertCheckThrottleMs = 2000; // Mínimo 2 segundos entre chequeos
    this.pendingAlertCheck = null; // Timer para debouncing

    // ✅ NUEVO: Referencia al IndicatorManager para filtro VWAP
    this.indicatorManager = null;

    this.logger.debug(`🔔 Alert system initialized (cooldown: ${this.alertCooldownMs/60000} min, throttle: ${this.alertCheckThrottleMs}ms)`);
  }

  loadConfig() {
    const saved = localStorage.getItem(`rejection_pattern_config_${this.symbol}`);
    if (saved) {
      try {
        const config = JSON.parse(saved);

        // ✅ Migración: Asegurar que exista vwapFilter
        if (!config.vwapFilter) {
          config.vwapFilter = {
            enabled: false,
            deviationTolerance: 10,  // % de σ
            requiredDeviations: {
              second: true,   // ±2σ
              third: false    // ±3σ
            }
          };
        }

        // ✅ Migración: Convertir tolerancia antigua (% de precio) a nueva (% de σ)
        // Valores < 1 eran % de precio (ej: 0.5%), convertir a % de σ (ej: 10%)
        if (config.vwapFilter && config.vwapFilter.deviationTolerance < 1 && config.vwapFilter.deviationTolerance !== 0) {
          const oldValue = config.vwapFilter.deviationTolerance;
          config.vwapFilter.deviationTolerance = 10; // Reset to default
          console.log(`[${this.symbol}] ⚠️ Migrated VWAP tolerance from ${oldValue}% (price) to 10% (σ)`);
        }

        // ✅ FIX: Migración - Asegurar que exista alertCooldown
        if (!config.alertCooldown) {
          config.alertCooldown = {
            enabled: true,
            minutes: 30,
            pauseDetection: false,
            discardedBoxColor: '#9E9E9E',
            discardedBoxOpacity: 0.10
          };
          console.log(`[${this.symbol}] ⚠️ Migrated: Added alertCooldown config`);
        } else {
          // Migración de campos nuevos para cooldown existente
          if (!config.alertCooldown.discardedBoxColor) {
            config.alertCooldown.discardedBoxColor = '#9E9E9E';
          }
          if (config.alertCooldown.discardedBoxOpacity === undefined) {
            config.alertCooldown.discardedBoxOpacity = 0.10;
          }
        }

        return config;
      } catch (e) {
        console.error('Failed to load rejection pattern config:', e);
      }
    }
    return this.getDefaultConfig();
  }

  /**
   * ✅ FIX #4: Carga patrones alertados desde localStorage
   * Incluye limpieza automática de patrones viejos (> 24 horas)
   */
  loadAlertedPatterns() {
    const storageKey = `rejection_alerted_patterns_${this.symbol}_${this.interval}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const data = JSON.parse(stored);
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        // Filtrar patrones que tienen menos de 24 horas
        const filtered = data.filter(item => {
          const age = now - (item.timestamp || 0);
          return age < oneDayMs;
        });

        this.logger.debug(`📂 Loaded ${filtered.length} alerted patterns from storage (${data.length - filtered.length} expired)`);

        // Retornar Set con solo los IDs
        return new Set(filtered.map(item => item.id));
      } catch (e) {
        console.error('Failed to load alerted patterns:', e);
      }
    }

    return new Set();
  }

  /**
   * ✅ FIX #4: Guarda patrones alertados en localStorage
   * Incluye timestamp para limpieza automática posterior
   */
  saveAlertedPatterns() {
    const storageKey = `rejection_alerted_patterns_${this.symbol}_${this.interval}`;

    // Guardar con timestamp para limpieza futura
    const data = Array.from(this.alertedPatterns).map(id => ({
      id: id,
      timestamp: Date.now()
    }));

    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
      this.logger.debug(`💾 Saved ${data.length} alerted patterns to storage`);
    } catch (e) {
      console.error('Failed to save alerted patterns:', e);
    }
  }

  /**
   * ✅ NUEVO: Guarda alerta en historial global (para panel deslizante)
   * Este historial es compartido entre todos los símbolos e indicadores
   */
  saveToGlobalAlertHistory(alertRecord) {
    try {
      const GLOBAL_KEY = 'watchlist_global_alert_history';
      const MAX_GLOBAL_ALERTS = 100;

      // Cargar historial existente
      const existing = localStorage.getItem(GLOBAL_KEY);
      let globalHistory = existing ? JSON.parse(existing) : [];

      // Agregar nueva alerta al inicio
      globalHistory.unshift(alertRecord);

      // Limitar a máximo de alertas
      if (globalHistory.length > MAX_GLOBAL_ALERTS) {
        globalHistory = globalHistory.slice(0, MAX_GLOBAL_ALERTS);
      }

      // Guardar
      localStorage.setItem(GLOBAL_KEY, JSON.stringify(globalHistory));
      this.logger.debug(`Alert saved to global history (${globalHistory.length} total)`);
    } catch (error) {
      console.error('Error saving to global alert history:', error);
    }
  }

  /**
   * Evalúa el resultado (WIN/LOSS) de alertas pendientes basándose en datos de velas.
   * Para cada alerta PENDING, verifica si el precio alcanzó TP (WIN) o SL (LOSS) primero.
   * @param {Array} candles - Array de velas con open, high, low, close, time
   */
  evaluatePendingTradeOutcomes(candles) {
    if (!candles || candles.length === 0) return;

    try {
      const GLOBAL_KEY = 'watchlist_global_alert_history';
      const existing = localStorage.getItem(GLOBAL_KEY);
      if (!existing) return;

      let globalHistory = JSON.parse(existing);
      let updated = false;

      // Helper para obtener timestamp de vela (normalizar a ms)
      const getCandleTime = (candle) => {
        const t = candle.timestamp || candle.time || candle.openTime || candle.start;
        // Si el timestamp es muy pequeño (< año 2000 en ms), probablemente está en segundos
        return t < 1000000000000 ? t * 1000 : t;
      };

      globalHistory = globalHistory.map(alert => {
        // Solo evaluar alertas con outcome PENDING
        if (alert.outcome !== 'PENDING') return alert;
        // Solo evaluar alertas de este símbolo/intervalo
        if (alert.symbol !== this.symbol || alert.interval !== this.interval) return alert;
        // Necesitamos entry, SL y TP para evaluar
        if (!alert.entry || !alert.stopLoss || !alert.takeProfit) return alert;

        const alertTime = alert.timestamp;
        const sl = alert.stopLoss;
        const tp = alert.takeProfit;
        const direction = alert.direction;

        // Filtrar velas posteriores a la alerta
        const candlesAfterAlert = candles.filter(c => {
          const candleTime = getCandleTime(c);
          return candleTime > alertTime;
        });

        if (candlesAfterAlert.length === 0) {
          return alert;
        }

        // Ordenar velas por timestamp para evaluar en orden cronológico
        candlesAfterAlert.sort((a, b) => getCandleTime(a) - getCandleTime(b));

        // Evaluar cada vela para ver si tocó SL o TP primero
        for (const candle of candlesAfterAlert) {
          const high = parseFloat(candle.high);
          const low = parseFloat(candle.low);

          if (direction === 'LONG') {
            // LONG: SL está debajo del entry, TP está arriba
            if (low <= sl) {
              alert.outcome = 'LOSS';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              this.logger.info(`📉 Trade LOSS: ${alert.patternType} - low ${low.toFixed(2)} tocó SL ${sl.toFixed(2)}`);
              break;
            }
            if (high >= tp) {
              alert.outcome = 'WIN';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              this.logger.info(`📈 Trade WIN: ${alert.patternType} - high ${high.toFixed(2)} alcanzó TP ${tp.toFixed(2)}`);
              break;
            }
          } else if (direction === 'SHORT') {
            // SHORT: SL está arriba del entry, TP está abajo
            if (high >= sl) {
              alert.outcome = 'LOSS';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              this.logger.info(`📉 Trade LOSS: ${alert.patternType} - high ${high.toFixed(2)} tocó SL ${sl.toFixed(2)}`);
              break;
            }
            if (low <= tp) {
              alert.outcome = 'WIN';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              this.logger.info(`📈 Trade WIN: ${alert.patternType} - low ${low.toFixed(2)} alcanzó TP ${tp.toFixed(2)}`);
              break;
            }
          }
        }

        return alert;
      });

      if (updated) {
        localStorage.setItem(GLOBAL_KEY, JSON.stringify(globalHistory));
        this.logger.debug(`Trade outcomes updated in global history`);
      }
    } catch (error) {
      console.error('Error evaluating trade outcomes:', error);
    }
  }

  /**
   * ✅ NUEVO: Convierte intervalo a milisegundos
   */
  getIntervalMs() {
    const map = {
      '1': 60000,       // 1 min
      '3': 180000,      // 3 min
      '5': 300000,      // 5 min
      '15': 900000,     // 15 min
      '30': 1800000,    // 30 min
      '60': 3600000,    // 1 hora
      '120': 7200000,   // 2 horas
      '240': 14400000,  // 4 horas
      'D': 86400000,    // 1 día
      'W': 604800000    // 1 semana
    };
    return map[this.interval] || 900000; // Default 15 min
  }

  /**
   * ✅ NUEVO: Obtiene multiplicador de edad según timeframe
   * Timeframes más grandes necesitan más margen
   */
  getAgeMultiplier() {
    switch (this.interval) {
      case '1':   return 10;  // 1m: 10 intervalos = 10 min
      case '3':   return 10;  // 3m: 10 intervalos = 30 min
      case '5':   return 10;  // 5m: 10 intervalos = 50 min
      case '15':  return 15;  // 15m: 15 intervalos = 3.75 horas
      case '30':  return 15;  // 30m: 15 intervalos = 7.5 horas
      case '60':  return 20;  // 1h: 20 intervalos = 20 horas
      case '120': return 20;  // 2h: 20 intervalos = 40 horas
      case '240': return 24;  // 4h: 24 intervalos = 4 días
      case 'D':   return 30;  // 1D: 30 intervalos = 30 días
      default:    return 10;
    }
  }

  /**
   * ✅ NUEVO: Carga alertSystemStartTime desde localStorage
   * - Si la sesión anterior terminó hace más de 1 hora, resetear (nueva sesión)
   * - Si la sesión anterior terminó hace menos de 1 hora, mantener (continuación)
   * - Máximo de vida: 24 horas
   */
  loadAlertSystemStartTime() {
    const storageKey = `rejection_alert_start_time_${this.symbol}_${this.interval}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const data = JSON.parse(stored);
        const age = Date.now() - data.timestamp;
        const sessionTimeout = 60 * 60 * 1000; // 1 hora: después de esto, es "nueva sesión"
        const maxAge = 24 * 60 * 60 * 1000; // 24 horas máximo absoluto

        // Si pasó más de 24 horas, definitivamente resetear
        if (age > maxAge) {
          this.logger.debug(`⏰ alertSystemStartTime expired (${Math.round(age / 3600000)}h old)`);
          return null;
        }

        // Si pasó más de 1 hora, tratarlo como nueva sesión (permite alertar patrones nuevos)
        if (age > sessionTimeout) {
          this.logger.debug(`🔄 New session detected (${Math.round(age / 60000)}min since last) - will reset alert start time`);
          return null;
        }

        // Menos de 1 hora: mantener el timestamp para evitar re-alertar
        this.logger.debug(`📂 Resuming session (${Math.round(age / 60000)}min since last)`);
        return data.timestamp;
      } catch (e) {
        console.error('Failed to load alertSystemStartTime:', e);
      }
    }

    return null;
  }

  /**
   * ✅ NUEVO: Guarda alertSystemStartTime en localStorage
   */
  saveAlertSystemStartTime() {
    const storageKey = `rejection_alert_start_time_${this.symbol}_${this.interval}`;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        timestamp: Date.now()  // Siempre guardar tiempo actual para tracking de sesión
      }));
    } catch (e) {
      console.error('Failed to save alertSystemStartTime:', e);
    }
  }

  /**
   * ✅ NUEVO: Carga el timestamp de la última alerta global desde localStorage
   */
  loadLastGlobalAlertTimestamp() {
    const storageKey = `rejection_last_alert_${this.symbol}_${this.interval}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const data = JSON.parse(stored);
        return data.timestamp || 0;
      } catch (e) {
        console.error('Failed to load lastGlobalAlertTimestamp:', e);
      }
    }

    return 0;
  }

  /**
   * ✅ NUEVO: Guarda el timestamp de la última alerta global
   */
  saveLastGlobalAlertTimestamp() {
    const storageKey = `rejection_last_alert_${this.symbol}_${this.interval}`;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        timestamp: this.lastGlobalAlertTimestamp
      }));
    } catch (e) {
      console.error('Failed to save lastGlobalAlertTimestamp:', e);
    }
  }

  /**
   * ✅ NUEVO: Verifica si el cooldown global está activo
   * @returns {boolean} true si está en cooldown (no se debe enviar alerta)
   */
  isInGlobalCooldown() {
    // Si el cooldown no está habilitado, no hay restricción
    const cooldownEnabled = this.config.alertCooldown?.enabled;
    if (!cooldownEnabled) {
      return false;
    }

    // ✅ FIX: Siempre leer de localStorage para obtener el valor más reciente
    // (puede haber sido actualizado por otra instancia del indicador)
    const lastAlertTimestamp = this.loadLastGlobalAlertTimestamp();

    const cooldownMinutes = this.config.alertCooldown?.minutes ?? 30;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const now = Date.now();
    const timeSinceLastAlert = now - lastAlertTimestamp;

    // ✅ FIX: Throttle logging to avoid spam (max 1 log per 10 seconds)
    if (!this._lastCooldownLogTime || (now - this._lastCooldownLogTime) > 10000) {
      this._lastCooldownLogTime = now;
      if (timeSinceLastAlert < cooldownMs) {
        const remainingMin = Math.ceil((cooldownMs - timeSinceLastAlert) / 60000);
        this.logger.debug(`⏳ COOLDOWN ACTIVE: ${remainingMin} min remaining`);
      } else {
        this.logger.debug(`⏳ Cooldown expired, can send alert`);
      }
    }

    return timeSinceLastAlert < cooldownMs;
  }

  getDefaultConfig() {
    return {
      enabled: true,
      patterns: {
        hammer: {
          enabled: true,
          minWickRatio: 1.5,           // Reducido de 2.0 - más permisivo
          maxUpperWickRatio: 0.3,      // Aumentado de 0.2 - más permisivo
          minBodyPosition: 0.5,        // Reducido de 0.6 - más permisivo
          debug: false                 // Habilitar para ver por qué se rechazan patrones
        },
        shootingStar: {
          enabled: true,
          minWickRatio: 1.5,           // Reducido de 2.0
          maxLowerWickRatio: 0.3,      // Aumentado de 0.2
          minBodyPosition: 0.5,        // Reducido de 0.6
          debug: false
        },
        engulfing: {
          enabled: true
        },
        doji: {
          enabled: false,
          maxBodyRatio: 0.08,          // Aumentado de 0.05 - más permisivo
          minLongWick: 0.5,            // Reducido de 0.6
          maxShortWick: 0.15,          // Aumentado de 0.1
          debug: false
        }
      },
      referenceContexts: [],
      // Nueva configuración de swing detection
      swingDetection: {
        enabled: true,
        leftBars: 5,
        rightBars: 5,
        required: false,     // Cambiado a false por defecto - más patrones visibles
        swingOnlyMode: false // Si true, detecta swings sin requerir forma de patrón
      },
      // Nueva configuración de fuentes de niveles
      levelSources: {
        volumeProfile: false,        // VP dinámico (VolumeProfileIndicator.js) - no usado
        fixedRanges: true,          // Fixed Ranges (VolumeProfileFixedRangeIndicator.js) ✅
        clusters: true,             // Clusters de Fixed Ranges ✅
        manualLevels: true,         // Líneas horizontales dibujadas
        supportResistance: true,    // Support & Resistance Indicator
        rangeDetection: true,       // Range Detector boundaries
        manualPriceZones: true      // Zonas manuales de precio (NUEVO)
      },
      // Configuración de volume Z-score
      volumeZScore: {
        enabled: false,
        lookbackPeriod: 20,
        minZScore: 1.0,
        swingCandleRange: 1  // Cuántas velas alrededor del swing considerar (1 = solo la vela exacta)
      },
      filters: {
        minConfidence: 50,             // Reducido de 60 - más permisivo
        requireNearLevel: false,       // Cambiado a false - más patrones visibles
        proximityPercent: 1.0,
        requireVolumeSpike: false
      },
      alertsEnabled: true,  // Habilitado por defecto para enviar al trading bot
      // Nuevo: Modo debug global
      debugMode: false,                  // Si true, muestra console.log de todos los patrones rechazados
      // NUEVO: Filtro de dirección de señales
      signalDirection: {
        global: 'BOTH'  // 'LONG' | 'SHORT' | 'BOTH'
        // Los overrides por nivel se guardan en cada zona (zone.signalDirection)
      },
      // NUEVO: Zonas manuales de precio
      manualPriceZones: [],
      // ✅ NUEVO: Filtro VWAP (pasa/no pasa)
      vwapFilter: {
        enabled: false,
        deviationTolerance: 10,  // % de σ (desviación estándar)
        requiredDeviations: {
          second: true,   // ±2σ - buscar patrones cerca de 2da desviación
          third: false    // ±3σ - buscar patrones cerca de 3ra desviación
        }
      },
      // ✅ NUEVO: Configuración visual de flechas de swing
      swingArrowStyle: {
        size: 10,           // Tamaño base de la flecha (5-20)
        longColor: '#00E676',   // Verde para LONG (swing low)
        shortColor: '#FF1744',  // Rojo para SHORT (swing high)
        offset: 8          // Distancia desde el high/low de la vela
      },
      // ✅ NUEVO: Configuración de estrategia (Entry/SL/TP)
      strategy: {
        enabled: false,
        riskRewardRatio: 2.0,    // TP = SL distance * ratio
        lineLengthCandles: 5,    // Velas hacia atrás y adelante
        entryColor: '#03A9F4',   // Azul claro para entrada
        stopLossColor: '#FF1744', // Rojo para SL
        takeProfitColor: '#00E676', // Verde para TP
        showLabels: true,        // Mostrar etiquetas con precio y %
        includeInAlert: true,    // Incluir SL/TP en alertas
        showBox: true,           // Mostrar rectángulos de zona
        slBoxColor: '#FF1744',   // Rojo para zona SL-Entry
        tpBoxColor: '#00E676',   // Verde para zona Entry-TP
        boxOpacity: 0.15,        // Opacidad de las zonas
        slSwingLeftBars: 3,      // Barras izquierda para detección de swing
        slSwingRightBars: 3,     // Barras derecha para detección de swing
        slSwingLookback: 50,     // Velas hacia atrás para buscar swing
        slBufferPercent: 20,     // Buffer fallback si no hay swing
        slMinPercent: 0.5        // SL mínimo para viabilidad
      },
      // ✅ NUEVO: Validación de price action post-patrón
      priceActionValidation: {
        enabled: true,           // Habilitar validación de invalidación
        barsToCheck: 3,          // Velas después del patrón a verificar
        invalidateOnBreak: true  // Invalidar si rompe high/low del patrón
      },
      // ✅ FIX: Cooldown entre alertas (antes faltaba en getDefaultConfig)
      alertCooldown: {
        enabled: true,
        minutes: 30,              // Minutos entre alertas consecutivas
        pauseDetection: false,    // Si true, pausa la detección de patrones durante el cooldown
        // Colores para patrones descartados por cooldown (visualización diferenciada)
        discardedBoxColor: '#9E9E9E',    // Gris para zonas de patrones descartados
        discardedBoxOpacity: 0.10        // Opacidad reducida para patrones descartados
      }
    };
  }

  updateConfig(config) {
    this.config = config;
    localStorage.setItem(`rejection_pattern_config_${this.symbol}`, JSON.stringify(config));

    // ✅ NUEVO: Sincronizar config con backend para detección real-time
    syncConfig(this.symbol, this.interval, 'rejection', config);

    // ✅ FIX BUG 1: Limpiar patrones para forzar re-detección en el próximo render
    // Esto asegura que al borrar zonas o cambiar configuración, los patrones se actualicen
    this.localPatterns = [];
    this.knownPatterns.clear(); // ✅ FIX #2: Limpiar cache de patrones conocidos
    this.lastDetectionTime = 0; // ✅ FIX #5: Forzar re-detección inmediata
    this.logger.debug(`Config updated - patterns will be re-detected`);
  }

  /**
   * Establece el modo de visualización
   * @param {string} mode - 'all' o 'validated'
   */
  setShowMode(mode) {
    this.showMode = mode;
    this.logger.debug(`Pattern show mode: ${mode}`);

    // ✅ FIX: Ya no necesitamos fetch al backend - la detección local maneja ambos modos
    // Los patrones se re-detectan automáticamente en el siguiente renderOverlay()
  }

  /**
   * Clasifica niveles de referencia en highs, lows y pivots
   * @param {Object} referenceLevels - Objeto con {importantHighs, importantLows, pivots}
   * @returns {Object} {importantHighs, importantLows, allLevels}
   */
  classifyReferenceLevels(referenceLevels) {
    if (!referenceLevels) {
      return {
        importantHighs: [],
        importantLows: [],
        allLevels: []
      };
    }

    // Combinar pivots con ambos arrays (con strength reducido)
    const importantHighs = [
      ...referenceLevels.importantHighs,
      ...referenceLevels.pivots.map(p => ({ ...p, strength: p.strength * 0.7 }))
    ];

    const importantLows = [
      ...referenceLevels.importantLows,
      ...referenceLevels.pivots.map(p => ({ ...p, strength: p.strength * 0.7 }))
    ];

    const allLevels = [
      ...referenceLevels.importantHighs,
      ...referenceLevels.importantLows,
      ...referenceLevels.pivots
    ];

    return {
      importantHighs,
      importantLows,
      allLevels
    };
  }

  /**
   * Calcula confidence score mejorado basado en múltiples factores
   * @param {Object} pattern - Patrón detectado
   * @param {Array} importantHighs - Niveles high importantes
   * @param {Array} importantLows - Niveles low importantes
   * @param {number} proximityPct - Porcentaje de proximidad (default 0.01 = 1%)
   * @returns {Object} Pattern con confidence calculado
   */
  enhancePatternConfidence(pattern, importantHighs, importantLows, proximityPct = 0.01) {
    let confidence = pattern.quality || 50; // Base: quality score del patrón
    const boosts = {
      swingPoint: 0,
      proximity: 0,
      volume: 0,
      levelStrength: 0,
      srLevel: 0  // ✅ NUEVO: Boost por nivel de S/R
    };

    // BOOST 1: Está en swing point (+20)
    if (pattern.atSwingPoint) {
      boosts.swingPoint = 20;
      confidence += 20;
    }

    // BOOST 2: Cerca de nivel importante del tipo correcto (+30 + strength bonus)
    const relevantLevels = pattern.swingType === 'low' ? importantLows : importantHighs;

    let nearestLevel = null;
    let minDistance = Infinity;

    for (const level of relevantLevels) {
      const distance = Math.abs(pattern.price - level.price) / pattern.price;
      if (distance <= proximityPct && distance < minDistance) {
        nearestLevel = level;
        minDistance = distance;
      }
    }

    if (nearestLevel) {
      // Bonus proporcional a la cercanía (0-30 puntos)
      const proximityBonus = (1 - minDistance / proximityPct) * 30;
      boosts.proximity = proximityBonus;
      confidence += proximityBonus;

      // Bonus adicional por strength del nivel (0-10 puntos)
      const strengthBonus = (nearestLevel.strength / 10) * 10;
      boosts.levelStrength = strengthBonus;
      confidence += strengthBonus;
    }

    // BOOST 3: Volume spike (+15)
    if (pattern.volumeZScore && pattern.volumeZScore > 1.0) {
      const volumeBonus = Math.min(15, pattern.volumeZScore * 7);
      boosts.volume = volumeBonus;
      confidence += volumeBonus;
    }

    // ✅ BOOST 4: Cerca de nivel de Support & Resistance (+20 + strength bonus)
    if (pattern.nearSRLevel) {
      const srBonus = 20; // Base bonus por estar cerca de S/R
      boosts.srLevel = srBonus;
      confidence += srBonus;

      // Bonus adicional por strength del nivel S/R (0-15 puntos)
      const srStrengthBonus = (pattern.nearSRLevel.strength / 10) * 15;
      boosts.srLevel += srStrengthBonus;
      confidence += srStrengthBonus;
    }

    // Normalizar a 0-100
    confidence = Math.min(100, Math.max(0, confidence));

    return {
      ...pattern,
      confidence: Math.round(confidence),
      nearLevel: nearestLevel || null,
      boosts: boosts
    };
  }

  /**
   * ✅ NUEVO: Valida patrones contra niveles de Support & Resistance
   * Agrega información de S/R a los patrones que estén cerca de niveles activos
   * @param {Array} patterns - Array de patrones detectados (se modifica in-place)
   * @param {Object} indicatorManager - Referencia al IndicatorManager
   */
  validatePatternsAgainstSR(patterns, indicatorManager) {
    const srIndicator = indicatorManager.getSupportResistanceIndicator();

    if (!srIndicator || !srIndicator.enabled) {
      // console.log(`[${this.symbol}] 📊 S/R validation skipped: indicator not enabled`);
      return;
    }

    // Obtener niveles S/R activos
    const activeLevels = [
      ...(srIndicator.supports || []).filter(l => l.status === 'active'),
      ...(srIndicator.resistances || []).filter(l => l.status === 'active')
    ];

    if (activeLevels.length === 0) {
      // console.log(`[${this.symbol}] 📊 S/R validation skipped: no active levels`);
      return;
    }

    const proximityPct = (this.config.filters?.proximityPercent || 1.0) / 100;

    // Para cada patrón, buscar niveles S/R cercanos
    let patternsValidated = 0;
    patterns.forEach(pattern => {
      // Determinar qué tipo de nivel buscar (support para LONG, resistance para SHORT)
      const relevantLevels = pattern.direction === 'LONG'
        ? srIndicator.supports.filter(l => l.status === 'active')
        : srIndicator.resistances.filter(l => l.status === 'active');

      // Buscar nivel más cercano
      let nearestSRLevel = null;
      let minDistance = Infinity;

      for (const level of relevantLevels) {
        const distance = Math.abs(pattern.price - level.price) / pattern.price;
        if (distance <= proximityPct && distance < minDistance) {
          nearestSRLevel = level;
          minDistance = distance;
        }
      }

      // Si encontramos un nivel cercano, agregarlo al patrón
      if (nearestSRLevel) {
        pattern.nearSRLevel = {
          price: nearestSRLevel.price,
          strength: nearestSRLevel.strength,
          touches: nearestSRLevel.touches,
          type: pattern.direction === 'LONG' ? 'support' : 'resistance',
          distance: minDistance,
          distancePercent: (minDistance * 100).toFixed(2)
        };
        patternsValidated++;
      }
    });

    // console.log(`[${this.symbol}] 📊 S/R validation: ${patternsValidated}/${patterns.length} patterns near S/R levels`);
  }

  /**
   * ✅ NUEVO: Obtiene tolerancia VWAP por defecto según timeframe
   * La tolerancia es un % de σ (desviación estándar), NO del precio.
   * Ejemplo: 10% con σ=$1000 → margen de $100 alrededor de la línea de desviación
   *
   * Timeframes más pequeños tienen más ruido, necesitan tolerancias mayores.
   * Timeframes más grandes son más estables, pueden tener tolerancias menores.
   */
  getDefaultVWAPTolerance() {
    switch (this.interval) {
      case '1':   return 15;    // 1m: más ruido → 15% de σ
      case '3':   return 12;    // 3m: 12% de σ
      case '5':   return 10;    // 5m: 10% de σ
      case '15':  return 10;    // 15m: 10% de σ
      case '30':  return 10;    // 30m: 10% de σ
      case '60':  return 10;    // 1h: 10% de σ
      case '120': return 10;    // 2h: 10% de σ
      case '240': return 10;    // 4h: 10% de σ
      case 'D':   return 10;    // 1D: 10% de σ
      case 'W':   return 10;    // 1W: 10% de σ
      default:    return 10;    // Default: 10% de σ
    }
  }

  /**
   * ✅ NUEVO: Verifica alineación del patrón con desviaciones VWAP
   * Este es un FILTRO PASA/NO PASA - si no está en la desviación requerida, se rechaza
   *
   * CÁLCULO DEL MARGEN:
   * El margen (tolerance) se calcula como % de la desviación estándar (σ), NO del precio.
   * Ejemplo: si VWAP=100,000 y σ=1,000, un margen del 10% = 100 (10% de 1,000)
   * Esto permite ajustar con mayor sensibilidad y es más fácil de verificar visualmente.
   *
   * @param {Object} pattern - Patrón a validar
   * @returns {boolean} true si pasa el filtro (o filtro deshabilitado), false si no pasa
   */
  checkVWAPAlignment(pattern) {
    const vwapFilter = this.config.vwapFilter;
    if (!vwapFilter || !vwapFilter.enabled) {
      return true; // Filtro deshabilitado - siempre pasa
    }

    // Obtener VWAPIndicator del manager
    if (!this.indicatorManager) {
      return true; // No bloquear si manager no está disponible
    }

    const vwapIndicator = this.indicatorManager.getVWAPIndicator();
    if (!vwapIndicator || !vwapIndicator.enabled) {
      return true; // No bloquear si VWAP no está activo
    }

    // ✅ CORREGIDO: Obtener desviaciones HISTÓRICAS al timestamp del patrón
    // Esto usa los valores VWAP que existían cuando la vela se formó, no los actuales
    const deviations = pattern.timestamp
      ? vwapIndicator.getDeviationsAtTimestamp(pattern.timestamp)
      : vwapIndicator.getDeviations();

    if (!deviations) {
      return true; // No bloquear si no hay datos
    }

    // ✅ Calcular VWAP y σ desde las bandas (más robusto)
    let vwapValue = deviations.vwap;
    let sigma = null;

    // Si tenemos ambas bandas, podemos calcular VWAP y σ directamente
    if (deviations.upper2 && deviations.lower2) {
      // upper2 = VWAP + 2σ, lower2 = VWAP - 2σ
      // VWAP = (upper2 + lower2) / 2
      // 4σ = upper2 - lower2 → σ = (upper2 - lower2) / 4
      if (!vwapValue) {
        vwapValue = (deviations.upper2 + deviations.lower2) / 2;
      }
      sigma = (deviations.upper2 - deviations.lower2) / 4;
    } else if (vwapValue && deviations.upper2) {
      sigma = (deviations.upper2 - vwapValue) / 2;
    } else if (vwapValue && deviations.lower2) {
      sigma = (vwapValue - deviations.lower2) / 2;
    }

    if (!vwapValue || !sigma || sigma <= 0) {
      return true; // No bloquear si no se puede calcular
    }

    const patternPrice = pattern.price;
    const direction = pattern.direction; // 'LONG' o 'SHORT'

    // ✅ Usar tolerancia del config, o default por timeframe si es 0 o "auto"
    const configTolerance = vwapFilter.deviationTolerance;
    const effectiveTolerance = (configTolerance === 0 || configTolerance === 'auto')
      ? this.getDefaultVWAPTolerance()
      : configTolerance;

    // ✅ El margen es un % de σ
    const toleranceDistance = sigma * (effectiveTolerance / 100);

    // Para LONG: buscar en desviaciones negativas (-2σ, -3σ) - DEBAJO del VWAP
    if (direction === 'LONG') {
      const requireDev2 = vwapFilter.requiredDeviations?.second;
      const requireDev3 = vwapFilter.requiredDeviations?.third;

      let aligned = false;
      let debugInfo = {
        type: pattern.type,
        price: patternPrice.toFixed(2),
        vwap: vwapValue.toFixed(2),
        sigma: sigma.toFixed(2),
        tolerance: `${effectiveTolerance}% of σ = ${toleranceDistance.toFixed(2)}`,
        lower2: deviations.lower2?.toFixed(2) || 'N/A',
        lower3: deviations.lower3?.toFixed(2) || 'N/A'
      };

      if (requireDev2 && deviations.lower2) {
        const distance = Math.abs(patternPrice - deviations.lower2);
        debugInfo.distanceTo2σ = distance.toFixed(2);
        if (distance <= toleranceDistance) {
          pattern._vwapDeviation = '-2σ';
          aligned = true;
        }
      }

      if (!aligned && requireDev3 && deviations.lower3) {
        const distance = Math.abs(patternPrice - deviations.lower3);
        debugInfo.distanceTo3σ = distance.toFixed(2);
        if (distance <= toleranceDistance) {
          pattern._vwapDeviation = '-3σ';
          aligned = true;
        }
      }

      // ✅ DEBUG: Log para patrones LONG rechazados
      if (!aligned && this.config.debugMode) {
        console.log(`[${this.symbol}] ❌ LONG pattern REJECTED by VWAP filter:`, debugInfo);
      } else if (aligned && this.config.debugMode) {
        console.log(`[${this.symbol}] ✅ LONG pattern ACCEPTED (${pattern._vwapDeviation}):`, debugInfo);
      }

      return aligned;
    }

    // Para SHORT: buscar en desviaciones positivas (+2σ, +3σ) - ENCIMA del VWAP
    if (direction === 'SHORT') {
      const requireDev2 = vwapFilter.requiredDeviations?.second;
      const requireDev3 = vwapFilter.requiredDeviations?.third;

      let aligned = false;
      let debugInfo = {
        type: pattern.type,
        price: patternPrice.toFixed(2),
        vwap: vwapValue.toFixed(2),
        sigma: sigma.toFixed(2),
        tolerance: `${effectiveTolerance}% of σ = ${toleranceDistance.toFixed(2)}`,
        upper2: deviations.upper2?.toFixed(2) || 'N/A',
        upper3: deviations.upper3?.toFixed(2) || 'N/A'
      };

      if (requireDev2 && deviations.upper2) {
        const distance = Math.abs(patternPrice - deviations.upper2);
        debugInfo.distanceTo2σ = distance.toFixed(2);
        if (distance <= toleranceDistance) {
          pattern._vwapDeviation = '+2σ';
          aligned = true;
        }
      }

      if (!aligned && requireDev3 && deviations.upper3) {
        const distance = Math.abs(patternPrice - deviations.upper3);
        debugInfo.distanceTo3σ = distance.toFixed(2);
        if (distance <= toleranceDistance) {
          pattern._vwapDeviation = '+3σ';
          aligned = true;
        }
      }

      // ✅ DEBUG: Log para patrones SHORT rechazados
      if (!aligned && this.config.debugMode) {
        console.log(`[${this.symbol}] ❌ SHORT pattern REJECTED by VWAP filter:`, debugInfo);
      } else if (aligned && this.config.debugMode) {
        console.log(`[${this.symbol}] ✅ SHORT pattern ACCEPTED (${pattern._vwapDeviation}):`, debugInfo);
      }

      return aligned;
    }

    // Dirección desconocida - rechazar por defecto
    return false;
  }

  /**
   * ✅ NUEVO: Formatea nombre del patrón según formato de alertas existente
   * Mantiene compatibilidad EXACTA con sistema actual
   */
  formatPatternName(patternType) {
    const names = {
      'HAMMER': 'Hammer (ABRIR LONG)',
      'SHOOTING_STAR': 'Shooting Star (ABRIR SHORT)',
      'ENGULFING_BULLISH': 'Bullish Engulfing (ABRIR LONG)',
      'ENGULFING_BEARISH': 'Bearish Engulfing (ABRIR SHORT)',
      'DOJI_DRAGONFLY': 'Dragonfly Doji (ABRIR LONG)',
      'DOJI_GRAVESTONE': 'Gravestone Doji (ABRIR SHORT)',
      'SWING_LOW': 'Swing Low (ABRIR LONG)',
      'SWING_HIGH': 'Swing High (ABRIR SHORT)'
    };
    return names[patternType] || patternType;
  }

  /**
   * ✅ ESTABILIZADO: Genera ID único para un patrón
   * Formato: tipo_timestamp_precio (sin candleIndex para estabilidad)
   *
   * NOTA: Se removió candleIndex porque cambia cuando el array de velas
   * cambia (scroll, nuevas velas), causando IDs inestables y alertas duplicadas.
   */
  getPatternId(pattern) {
    // Usar toFixed(0) para consistencia en el precio
    const priceKey = (pattern.price * 100).toFixed(0);

    // Asegurar timestamp válido
    const timestamp = pattern.timestamp || Date.now();

    // ID estable: tipo + timestamp + precio (sin candleIndex)
    return `${pattern.type}_${timestamp}_${priceKey}`;
  }

  /**
   * ✅ NUEVO: Verifica si un patrón está confirmado y listo para alertar
   *
   * Confirmación depende de:
   * 1. Vela CERRADA (no in_progress)
   * 2. Si swingDetection.required = true: swing debe estar CONFIRMADO (rightBars velas después)
   * 3. Si swingDetection.required = false: solo requiere vela cerrada
   * 4. Price action validation: debe pasar N velas sin invalidar el patrón
   *
   * La alerta y el entry se dan DESPUÉS de que pasa el filtro de invalidación.
   */
  isPatternConfirmed(pattern, candles) {
    if (!pattern || !candles || candles.length === 0) return false;

    // Verificar que el patrón tiene timestamp
    if (!pattern.timestamp) return false;

    // Si ya fue invalidado, no confirmar
    if (pattern._invalidated) return false;

    // Encontrar índice de la vela del patrón en el array
    const patternIndex = candles.findIndex(c => c.timestamp === pattern.timestamp);
    if (patternIndex === -1) {
      this.logger.debug(`Pattern not found in candles array`);
      return false;
    }

    const patternCandle = candles[patternIndex];

    // 1. La vela del patrón debe estar CERRADA (no in_progress)
    if (patternCandle.in_progress) {
      this.logger.debug(`Pattern candle still in progress`);
      return false;
    }

    // 2. Si swing detection está requerido, verificar confirmación de swing
    const rightBars = this.config.swingDetection?.required
      ? (this.config.swingDetection.rightBars || 5)
      : 0;

    if (rightBars > 0) {
      // Necesitamos rightBars velas CERRADAS después del patrón para confirmar el swing
      const requiredIndex = patternIndex + rightBars;

      // Verificar que existan suficientes velas después
      if (requiredIndex >= candles.length) {
        this.logger.debug(`Swing not confirmed yet: need ${rightBars} bars after pattern (current: ${candles.length - patternIndex - 1})`);
        return false;
      }

      // Verificar que todas las velas de confirmación estén cerradas
      for (let i = patternIndex + 1; i <= requiredIndex; i++) {
        if (candles[i]?.in_progress) {
          this.logger.debug(`Swing confirmation bar ${i - patternIndex} still in progress`);
          return false;
        }
      }
    }

    // 3. Verificar price action validation (si está habilitado)
    const paConfig = this.config.priceActionValidation || {};
    const barsToCheck = paConfig.enabled !== false ? (paConfig.barsToCheck || 3) : 0;

    if (barsToCheck > 0) {
      // Calcular el índice final de validación
      const validationEndIndex = patternIndex + rightBars + barsToCheck;

      // Verificar que existan suficientes velas para validación
      if (validationEndIndex >= candles.length) {
        this.logger.debug(`Validation not complete: need ${rightBars + barsToCheck} bars after pattern (current: ${candles.length - patternIndex - 1})`);
        return false;
      }

      // Verificar que la última vela de validación esté cerrada
      if (candles[validationEndIndex]?.in_progress) {
        this.logger.debug(`Validation bar ${barsToCheck} still in progress`);
        return false;
      }

      // Verificar que el price action NO invalide el patrón
      const invalidation = this.checkPatternInvalidation(pattern, patternIndex, candles);
      if (invalidation.invalidated) {
        pattern._invalidated = true;
        pattern._invalidationReason = invalidation.reason;
        this.logger.debug(`❌ Pattern INVALIDATED: ${invalidation.reason}`);
        return false;
      }
    }

    this.logger.debug(`✅ Pattern confirmed after ${rightBars + barsToCheck} bars`);
    return true;
  }

  /**
   * ✅ NUEVO: Verifica si el price action posterior invalida el patrón
   *
   * Reglas de invalidación:
   * - LONG patterns (Hammer, Engulfing Bullish, etc.): Invalidado si precio cae por debajo del low del patrón
   * - SHORT patterns (Shooting Star, Engulfing Bearish, etc.): Invalidado si precio sube por encima del high del patrón
   *
   * IMPORTANTE: La validación empieza DESPUÉS de las velas de confirmación del swing (rightBars)
   * Ejemplo: Si patrón en vela 0, rightBars=5, barsToCheck=3 → verifica velas 6, 7, 8
   *
   * @param {Object} pattern - El patrón a verificar
   * @param {number} patternIndex - Índice del patrón en el array de velas
   * @param {Array} candles - Array de velas
   * @returns {Object} { invalidated: boolean, reason: string }
   */
  checkPatternInvalidation(pattern, patternIndex, candles) {
    // Obtener configuración de invalidación (con defaults)
    const invalidationConfig = this.config.priceActionValidation || {
      enabled: true,
      barsToCheck: 3,  // Velas a verificar DESPUÉS de la confirmación del swing
      invalidateOnBreak: true  // Invalidar si rompe el high/low del patrón
    };

    // Si la validación está deshabilitada, no invalidar
    if (!invalidationConfig.enabled) {
      return { invalidated: false, reason: null };
    }

    const patternCandle = candles[patternIndex];
    const barsToCheck = invalidationConfig.barsToCheck || 3;
    const direction = pattern.direction; // 'LONG' o 'SHORT'

    // ✅ CORRECCIÓN: La validación empieza DESPUÉS de las velas de confirmación del swing
    // Si rightBars=5, empezamos desde la vela 6 (patternIndex + rightBars + 1)
    const rightBars = this.config.swingDetection?.required
      ? (this.config.swingDetection.rightBars || 5)
      : 0;
    const startIndex = rightBars + 1; // Empezar después de la confirmación

    // Verificar las velas siguientes a la confirmación
    for (let i = startIndex; i < startIndex + barsToCheck; i++) {
      const nextIndex = patternIndex + i;
      if (nextIndex >= candles.length) break;

      const nextCandle = candles[nextIndex];
      if (!nextCandle || nextCandle.in_progress) continue; // Solo velas cerradas

      if (direction === 'LONG') {
        // Para LONG: el precio NO debe caer por debajo del low del patrón
        if (nextCandle.low < patternCandle.low) {
          return {
            invalidated: true,
            reason: `Price broke below pattern low ($${patternCandle.low.toFixed(2)}) at bar +${i}`
          };
        }
      } else if (direction === 'SHORT') {
        // Para SHORT: el precio NO debe subir por encima del high del patrón
        if (nextCandle.high > patternCandle.high) {
          return {
            invalidated: true,
            reason: `Price broke above pattern high ($${patternCandle.high.toFixed(2)}) at bar +${i}`
          };
        }
      }
    }

    return { invalidated: false, reason: null };
  }

  /**
   * ✅ NUEVO: Obtiene patrones confirmados que no han sido alertados
   * Solo retorna patrones listos para alertar en TIEMPO REAL
   */
  getNewConfirmedPatterns(candles) {
    if (!this.localPatterns || this.localPatterns.length === 0) {
      this.logger.debug(`getNewConfirmedPatterns: No local patterns`);
      return [];
    }
    if (!candles || candles.length === 0) {
      this.logger.debug(`getNewConfirmedPatterns: No candles`);
      return [];
    }

    const newConfirmed = [];
    let skippedNotNew = 0;
    let skippedAlreadyAlerted = 0;
    let skippedNotConfirmed = 0;
    let skippedAlreadySent = 0;

    for (let i = 0; i < this.localPatterns.length; i++) {
      const pattern = this.localPatterns[i];
      const patternId = this.getPatternId(pattern);

      // ✅ FIX: Verificar si ya fue enviado (flag local)
      if (pattern._alertSent) {
        skippedAlreadySent++;
        continue;
      }

      // ✅ FIX #2: Verificar flag _isNewPattern del sistema de merge
      if (!pattern._isNewPattern) {
        skippedNotNew++;
        continue; // No es un patrón genuinamente nuevo
      }

      // Si ya fue alertado (persistido en localStorage), skip
      if (this.alertedPatterns.has(patternId)) {
        skippedAlreadyAlerted++;
        continue;
      }

      // Verificar si está confirmado
      const isConfirmed = this.isPatternConfirmed(pattern, candles);

      if (!isConfirmed) {
        skippedNotConfirmed++;
        continue;
      }

      // Agregar a la lista
      newConfirmed.push(pattern);
    }

    // Log solo cuando hay patrones listos para alertar
    if (newConfirmed.length > 0) {
      this.logger.debug(`📊 Alert check: ${newConfirmed.length} ready to alert`);
    }

    return newConfirmed;
  }

  /**
   * ✅ NUEVO: Verifica patrones confirmados y envía alertas
   * Solo procesa patrones que NO han sido alertados previamente y están CONFIRMADOS
   *
   * @param {Array} candles - Array de velas para verificar confirmación
   */
  async checkAndSendAlerts(candles) {
    if (!this.config.alertsEnabled) return;
    if (this.showMode !== 'validated') return; // Solo en modo validated
    if (!candles || candles.length === 0) return;

    // ✅ FIX #3: THROTTLING - No chequear más de una vez cada 2 segundos
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastAlertCheckTime;

    if (timeSinceLastCheck < this.alertCheckThrottleMs) {
      this.logger.debug(`⏭️ Throttled: ${timeSinceLastCheck}ms < ${this.alertCheckThrottleMs}ms`);

      // ✅ FIX #3: DEBOUNCING - Programar un chequeo para después
      if (this.pendingAlertCheck) {
        clearTimeout(this.pendingAlertCheck);
      }

      this.pendingAlertCheck = setTimeout(() => {
        this.checkAndSendAlerts(candles);
      }, this.alertCheckThrottleMs - timeSinceLastCheck);

      return;
    }

    this.lastAlertCheckTime = now;

    // Limpiar timer pendiente si existe
    if (this.pendingAlertCheck) {
      clearTimeout(this.pendingAlertCheck);
      this.pendingAlertCheck = null;
    }

    // ✅ Actualizar timestamp de sesión periódicamente (cada 5 min) para mantener sesión activa
    if (!this._lastSessionSave) this._lastSessionSave = 0;
    if (this.alertSystemStartTime && (now - this._lastSessionSave) > 5 * 60 * 1000) {
      this.saveAlertSystemStartTime();
      this._lastSessionSave = now;
    }

    // ✅ PRIMERA VEZ: Guardar timestamp de inicio del sistema de alertas
    if (this.alertSystemStartTime === null) {
      this.alertSystemStartTime = Date.now();
      this.saveAlertSystemStartTime(); // ✅ PERSISTIR para sobrevivir reloads

      // ✅ Contar patrones por estado para debugging
      let newCount = 0, oldCount = 0, alertedCount = 0;
      this.localPatterns.forEach(p => {
        if (p._isNewPattern) newCount++;
        else oldCount++;
        if (this.alertedPatterns.has(this.getPatternId(p))) alertedCount++;
      });

      this.logger.alert(`✅ Alert system activated - ${newCount} NEW, ${oldCount} OLD patterns`);
      return; // Salir en la primera ejecución para dar tiempo a la detección
    }

    // Obtener solo patrones confirmados que no han sido alertados
    const newConfirmedPatterns = this.getNewConfirmedPatterns(candles);
    if (newConfirmedPatterns.length === 0) return;

    // ✅ VALIDACIÓN DE EDAD: Solo alertar patrones recientes (dentro de N intervalos)
    const intervalMs = this.getIntervalMs();
    const baseAgeMultiplier = this.getAgeMultiplier();
    const currentTime = Date.now();
    const minConfidence = this.config.filters?.minConfidence || 50;

    // ✅ FIX: Calcular delay de confirmación (rightBars + barsToCheck)
    // El patrón tiene timestamp de cuando se formó, pero la alerta es DESPUÉS de confirmación
    const rightBars = this.config.swingDetection?.required
      ? (this.config.swingDetection.rightBars || 5)
      : 0;
    const barsToCheck = this.config.priceActionValidation?.enabled !== false
      ? (this.config.priceActionValidation?.barsToCheck || 3)
      : 0;
    const confirmationDelayMs = (rightBars + barsToCheck) * intervalMs;

    // maxAgeMs debe incluir el tiempo base + el delay de confirmación
    const maxAgeMs = (intervalMs * baseAgeMultiplier) + confirmationDelayMs;

    // ✅ Filtrar patrones que:
    // 1. timestamp >= alertSystemStartTime (después de iniciar alertas)
    // 2. No sean demasiado viejos (dentro de maxAgeMs ajustado por confirmación)
    const recentPatterns = newConfirmedPatterns.filter(p => {
      // Condición 1: Después del inicio del sistema de alertas
      if (p.timestamp < this.alertSystemStartTime) {
        return false;
      }

      // Condición 2: No muy viejo (evita alertar patrones históricos re-detectados)
      // El patrón se forma en T, pero alerta en T + confirmationDelayMs, así que ajustamos
      const patternAge = currentTime - p.timestamp;
      if (patternAge > maxAgeMs) {
        this.logger.debug(`⏭️ Pattern too old: ${p.type} age=${Math.round(patternAge/60000)}min > max=${Math.round(maxAgeMs/60000)}min`);
        return false;
      }

      return true;
    });

    // Log solo si hay patrones nuevos
    if (recentPatterns.length > 0) {
      this.logger.info(`🔍 ${recentPatterns.length} NEW patterns to alert (${newConfirmedPatterns.length - recentPatterns.length} old filtered)`);
    }

    if (recentPatterns.length === 0) {
      // Solo log en debug (silencioso)
      return;
    }

    // ✅ PROTECCIÓN ANTI-SPAM: Máximo 5 alertas por ejecución
    const MAX_ALERTS_PER_RUN = 5;
    if (recentPatterns.length > MAX_ALERTS_PER_RUN) {
      this.logger.warn(`⚠️ Too many patterns to alert (${recentPatterns.length}). Limiting to ${MAX_ALERTS_PER_RUN} to prevent spam.`);
    }

    // ✅ NUEVO: Verificar cooldown global antes de procesar
    if (this.isInGlobalCooldown()) {
      this.logger.debug(`⏳ Skipping alerts due to global cooldown`);
      return;
    }

    // Procesar solo patrones NUEVOS (después del start time)
    let alertCount = 0;
    for (const pattern of recentPatterns) {
      // Límite de alertas por ejecución
      if (alertCount >= MAX_ALERTS_PER_RUN) {
        this.logger.warn(`⚠️ Alert limit reached (${MAX_ALERTS_PER_RUN})`);
        break;
      }

      // Filtro de confidence
      if (pattern.confidence < minConfidence) {
        continue;
      }

      // ✅ FILTRO VWAP: Pasa/No pasa
      if (this.config.vwapFilter?.enabled && !this.checkVWAPAlignment(pattern)) {
        continue;
      }

      // Generar ID del patrón
      const patternId = this.getPatternId(pattern);

      // ✅ FIX #1: Verificar PRIMERO si ya fue alertado
      if (this.alertedPatterns.has(patternId)) {
        continue;
      }

      // ✅ FIX #1: Marcar como "en proceso" ANTES de enviar (previene duplicados)
      this.alertedPatterns.add(patternId);
      this.saveAlertedPatterns(); // ✅ FIX #4: Persistir inmediatamente
      this.logger.debug(`🔔 SENDING ALERT: ${pattern.type} @ ${pattern.price.toFixed(2)}`);

      // Enviar alerta
      const success = await this.sendPatternAlert(pattern);

      if (success) {
        // Marcar visualmente y limpiar flag de nuevo
        pattern._alertSent = true;
        pattern._alertTimestamp = Date.now();
        pattern._isNewPattern = false; // ✅ FIX #2: Limpiar flag para que no se alerte nuevamente

        // ✅ NUEVO: Guardar en historial global para panel deslizante
        const strategy = pattern._strategy || {};
        const alertRecord = {
          id: `rp_alert_${Date.now()}_${this.symbol}`,
          timestamp: Date.now(),
          symbol: this.symbol,
          interval: this.interval,
          indicator: 'Rejection',  // Identificador del indicador
          patternType: pattern.type,
          direction: pattern.direction,
          price: pattern.price,
          confidence: pattern.confidence,
          status: 'sent',
          entry: strategy.entry || null,
          stopLoss: strategy.stopLoss || null,
          takeProfit: strategy.takeProfit || null,
          slPercent: strategy.slPercent || null,
          tpPercent: strategy.tpPercent || null,
          outcome: 'PENDING'  // WIN/LOSS se evalúa con velas posteriores
        };
        this.saveToGlobalAlertHistory(alertRecord);

        // ✅ NUEVO: Actualizar timestamp de cooldown global
        this.lastGlobalAlertTimestamp = Date.now();
        this.saveLastGlobalAlertTimestamp();
        this.logger.info(`⏰ Cooldown timestamp updated to ${this.lastGlobalAlertTimestamp}`);

        this.logger.alert(`🚨 ALERT SENT: ${this.formatPatternName(pattern.type)} at $${pattern.price.toFixed(2)}`);
        alertCount++;

        // ✅ NUEVO: Si el cooldown está activo, solo enviar una alerta y luego parar
        if (this.config.alertCooldown?.enabled) {
          this.logger.debug(`⏳ Alert sent, entering cooldown for ${this.config.alertCooldown?.minutes ?? 30} minutes`);
          break;
        }
      } else {
        // ✅ FIX #1: Si falla, remover del Set para permitir reintento
        this.alertedPatterns.delete(patternId);
        this.saveAlertedPatterns(); // ✅ FIX #4: Actualizar storage
        this.logger.warn(`⚠️ Alert failed, pattern unlocked for retry: ${patternId}`);
      }
    }
  }

  /**
   * Registra patrón detectado y muestra notificación en navegador.
   * NOTA: El envío de alertas al Trading Bot lo hace el backend (realtime_pattern_service.py).
   * El frontend solo grafica patrones y muestra notificaciones locales.
   */
  async sendPatternAlert(pattern) {
    this.logger.debug(`🔔 [${this.symbol}] PATTERN DETECTED (display only)`);
    this.logger.debug(`   Pattern: ${pattern.type}`);
    this.logger.debug(`   Price: $${pattern.price.toFixed(2)}`);
    this.logger.debug(`   Confidence: ${pattern.confidence.toFixed(1)}%`);
    this.logger.debug(`   Direction: ${pattern.direction}`);
    this.logger.debug(`   Note: Backend handles alert sending to Trading Bot`);

    // Mostrar popup/notificación en navegador
    this.showAlertPopup(pattern);

    return true;
  }

  /**
   * ✅ NUEVO: Muestra popup en navegador cuando se envía una alerta
   * Usa Notification API si está disponible, sino alert nativo
   */
  showAlertPopup(pattern) {
    // ✅ PROTECCIÓN: Limitar popups simultáneos para evitar bloqueo del navegador
    if (RejectionPatternIndicator.activePopups >= RejectionPatternIndicator.MAX_SIMULTANEOUS_POPUPS) {
      this.logger.debug(`⏭️ Popup skipped: ${RejectionPatternIndicator.activePopups} popups already active (max: ${RejectionPatternIndicator.MAX_SIMULTANEOUS_POPUPS})`);
      return;
    }

    const patternName = this.formatPatternName(pattern.type);
    const priceFormatted = pattern.price.toFixed(2);
    const confidenceFormatted = Math.round(pattern.confidence);

    // Preparar mensaje
    const title = `🚨 Alert: ${this.symbol}`;
    const body = `${patternName}\nPrice: $${priceFormatted}\nConfidence: ${confidenceFormatted}%`;

    // Intentar usar Notification API (más elegante)
    if ("Notification" in window && Notification.permission === "granted") {
      RejectionPatternIndicator.activePopups++;

      const notification = new Notification(title, {
        body: body,
        icon: pattern.direction === 'LONG' ? '📈' : '📉',
        badge: '🔔',
        requireInteraction: false,
        tag: `pattern-alert-${this.symbol}-${Date.now()}` // Tag único por notificación
      });

      // Auto-cerrar después de 5 segundos y decrementar contador
      setTimeout(() => {
        notification.close();
        RejectionPatternIndicator.activePopups = Math.max(0, RejectionPatternIndicator.activePopups - 1);
      }, 5000);

      // Decrementar también cuando el usuario cierra manualmente
      notification.onclose = () => {
        RejectionPatternIndicator.activePopups = Math.max(0, RejectionPatternIndicator.activePopups - 1);
      };

    } else {
      // Fallback: alert nativo del navegador (limitado también)
      RejectionPatternIndicator.activePopups++;
      alert(`${title}\n\n${body}\n\nAlert sent to port 5000 ✅`);
      RejectionPatternIndicator.activePopups = Math.max(0, RejectionPatternIndicator.activePopups - 1);
    }

  }

  /**
   * ✅ NUEVO: Pide permisos de notificación del navegador
   * Se llama una sola vez cuando se habilitan las alertas
   */
  requestNotificationPermission() {
    if (this.notificationPermissionRequested) return;
    if (!("Notification" in window)) return;

    if (Notification.permission === "default") {
      Notification.requestPermission().then(() => {
        this.notificationPermissionRequested = true;
      });
    } else {
      this.notificationPermissionRequested = true;
    }
  }

  /**
   * ✅ FIX #2: Fusiona nuevos patrones con los existentes
   * Evita crear duplicados y marca patrones genuinamente nuevos con _isNewPattern
   * También verifica alineación VWAP al momento de detección (no después)
   *
   * @param {Array} newPatterns - Patrones recién detectados
   * @param {boolean} isInitialLoad - Si es true, no marca patrones como nuevos (son históricos)
   */
  mergeNewPatterns(newPatterns, isInitialLoad = false) {
    if (!newPatterns || newPatterns.length === 0) {
      return;
    }

    const currentTime = Date.now();
    const intervalMs = this.getIntervalMs();
    const baseAgeMultiplier = this.getAgeMultiplier();

    // ✅ FIX: Calcular delay de confirmación (rightBars + barsToCheck)
    // El patrón debe ser considerado "nuevo" si aún está dentro del periodo de confirmación
    const rightBars = this.config.swingDetection?.required
      ? (this.config.swingDetection.rightBars || 5)
      : 0;
    const barsToCheck = this.config.priceActionValidation?.enabled !== false
      ? (this.config.priceActionValidation?.barsToCheck || 3)
      : 0;
    const confirmationDelayMs = (rightBars + barsToCheck) * intervalMs;

    // maxAgeMs debe incluir el tiempo base + el delay de confirmación
    const maxAgeMs = (intervalMs * baseAgeMultiplier) + confirmationDelayMs;

    // ✅ FIX COOLDOWN: Verificar si estamos en cooldown ANTES de marcar patrones como nuevos
    // Si estamos en cooldown, los patrones detectados NO deben marcarse como alertables
    const inCooldown = this.isInGlobalCooldown();
    if (inCooldown && !isInitialLoad) {
      this.logger.debug(`⏳ In cooldown - new patterns will be discarded (not marked as alertable)`);
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedAsOld = 0;
    let skippedByCooldown = 0;

    newPatterns.forEach(newPattern => {
      const patternId = this.getPatternId(newPattern);

      // Verificar si ya existe en knownPatterns
      if (this.knownPatterns.has(patternId)) {
        // Ya existe, actualizar datos pero preservar flags importantes
        const existing = this.knownPatterns.get(patternId);
        newPattern._isNewPattern = existing._isNewPattern || false;
        newPattern._alertSent = existing._alertSent || false;
        newPattern._firstSeenTime = existing._firstSeenTime;
        newPattern._vwapAligned = existing._vwapAligned; // ✅ Preservar resultado VWAP
        newPattern._vwapDeviation = existing._vwapDeviation;
        // ✅ Preservar estrategia calculada (solo si el nuevo no trae una)
        if (!newPattern._strategy && existing._strategy) {
          newPattern._strategy = existing._strategy;
        }
        this.knownPatterns.set(patternId, newPattern);
        updatedCount++;
      } else {
        // Patrón nuevo - verificar edad y VWAP
        newPattern._firstSeenTime = currentTime;
        const patternAge = currentTime - newPattern.timestamp;

        // ✅ FIX ALERTAS EN TIEMPO REAL:
        // - isInitialLoad=true: TODOS los patrones son históricos, NO deben alertar
        // - isInitialLoad=false: Solo patrones recientes (dentro de maxAgeMs) son alertables
        // - ✅ FIX COOLDOWN: Si estamos en cooldown, DESCARTAR el patrón (no marcar como nuevo)
        if (isInitialLoad) {
          // Primera carga: todos los patrones son históricos
          newPattern._isNewPattern = false;
          skippedAsOld++;
        } else if (inCooldown) {
          // ✅ FIX: En cooldown - descartar patrón (no alertable)
          newPattern._isNewPattern = false;
          newPattern._discardedByCooldown = true;
          skippedByCooldown++;
          this.logger.debug(`⏳ DISCARDED by cooldown: ${newPattern.type} @ ${new Date(newPattern.timestamp).toLocaleTimeString()}`);
        } else if (patternAge <= maxAgeMs) {
          // Detección incremental: patrón reciente = genuinamente nuevo
          newPattern._isNewPattern = true;
          this.logger.debug(`🆕 NEW pattern: ${newPattern.type} @ ${new Date(newPattern.timestamp).toLocaleTimeString()}`);
        } else {
          newPattern._isNewPattern = false;
          skippedAsOld++;
        }

        // ✅ NUEVO: Verificar alineación VWAP al momento de detección
        // Esto se hace UNA VEZ y se guarda el resultado
        if (this.config.vwapFilter?.enabled) {
          newPattern._vwapAligned = this.checkVWAPAlignment(newPattern);
        }
        // Si filtro está deshabilitado, _vwapAligned queda undefined (se muestra siempre)

        this.knownPatterns.set(patternId, newPattern);
        addedCount++;
      }
    });

    // Actualizar localPatterns desde knownPatterns
    this.localPatterns = Array.from(this.knownPatterns.values());

    if (!isInitialLoad && (addedCount > 0 || skippedAsOld > 0 || skippedByCooldown > 0)) {
      this.logger.debug(`📊 Merge: +${addedCount} added, ~${updatedCount} updated, ⏭️${skippedAsOld} old, ⏳${skippedByCooldown} cooldown`);
    }
  }

  /**
   * ✅ Limpia patrones muy viejos del cache
   * Se llama periódicamente para evitar acumulación
   */
  cleanOldPatterns() {
    const currentTime = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas

    let removed = 0;
    for (const [id, pattern] of this.knownPatterns) {
      const age = currentTime - pattern.timestamp;
      if (age > maxAge) {
        this.knownPatterns.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.debug(`🧹 Cleaned ${removed} old patterns from cache`);
      this.localPatterns = Array.from(this.knownPatterns.values());
    }
  }

  /**
   * Detecta patrones localmente en las velas dadas
   * @param {Array} candles - Array de velas OHLC
   * @param {Object} indicatorManager - Referencia al IndicatorManager para obtener niveles
   * @param {Array} manualLevels - Array de drawings/horizontal lines (opcional)
   */
  detectLocalPatterns(candles, indicatorManager = null, manualLevels = []) {
    this.logger.debug(`🔍 detectLocalPatterns called with ${candles?.length || 0} candles, existing patterns: ${this.localPatterns.length}`);

    if (!candles || candles.length === 0) {
      this.logger.debug(`❌ No candles provided, clearing patterns`);
      this.localPatterns = [];
      return;
    }

    // ✅ Guardar referencia al indicatorManager para filtro VWAP
    if (indicatorManager) {
      this.indicatorManager = indicatorManager;
    }

    // ✅ FIX #5: THROTTLING - Evitar re-detección en cada render
    const now = Date.now();
    const timeSinceLastDetection = now - this.lastDetectionTime;

    if (timeSinceLastDetection < this.detectionThrottleMs && this.localPatterns.length > 0) {
      // Ya tenemos patrones y no ha pasado suficiente tiempo, usar cached
      this.logger.debug(`⏭️ Throttled (${timeSinceLastDetection}ms < ${this.detectionThrottleMs}ms), using ${this.localPatterns.length} cached patterns`);
      return;
    }

    // ✅ NUEVO: Si pauseDetection está activo y estamos en cooldown, no detectar nuevos patrones
    // IMPORTANTE: Solo pausar si YA tenemos patrones, para no bloquear la detección inicial
    if (this.localPatterns.length > 0 &&
        this.config.alertCooldown?.enabled &&
        this.config.alertCooldown?.pauseDetection &&
        this.isInGlobalCooldown()) {
      this.logger.debug(`⏸️ Detection paused during cooldown (keeping ${this.localPatterns.length} existing patterns)`);
      return;
    }

    this.lastDetectionTime = now;
    this.logger.debug(`✅ Proceeding with detection...`);

    // Obtener precio actual (última vela)
    const currentPrice = candles[candles.length - 1]?.close || null;

    // Configuración de swing detection
    const swingConfig = this.config.swingDetection || {
      enabled: true,
      leftBars: 5,
      rightBars: 5,
      required: true,       // Por defecto, requerir swing points
      swingOnlyMode: false  // Detectar swings sin requerir forma de patrón
    };

    // Configuración de volume Z-score
    const volumeConfig = this.config.volumeZScore || {
      enabled: false,
      lookbackPeriod: 20,
      minZScore: 1.0,
      swingCandleRange: 1   // Velas alrededor del swing a considerar
    };

    // Propagar debugMode a cada patrón si está habilitado globalmente
    const patternsConfig = { ...this.config.patterns };
    if (this.config.debugMode) {
      Object.keys(patternsConfig).forEach(key => {
        if (patternsConfig[key]) {
          patternsConfig[key] = { ...patternsConfig[key], debug: true };
        }
      });
    }

    // NUEVO: Obtener filtro de dirección global
    const globalDirection = this.config.signalDirection?.global || 'BOTH';

    // ✅ FIX BUG 2: Solo pasar zonas manuales si la fuente está habilitada
    const manualZonesToUse = (this.config.levelSources?.manualPriceZones !== false)
      ? (this.config.manualPriceZones || [])
      : [];

    // ✅ FIX BUG 3: Determinar modo de detección basado en si S/R está habilitado
    const srEnabled = this.config.levelSources?.supportResistance !== false;
    const hasManualZones = manualZonesToUse.length > 0;

    // Si S/R está habilitado, detectar en modo 'all' para no pre-filtrar por zonas
    // Filtraremos después combinando zonas + S/R con lógica OR
    let detectionMode = this.showMode;
    if (this.showMode === 'validated' && srEnabled && hasManualZones) {
      // Caso especial: ambas fuentes activas, no filtrar por zonas aún
      detectionMode = 'all';
    }

    // console.log(`[${this.symbol}] 🎯 Detection config:`, {
    //   showMode: this.showMode,
    //   detectionMode: detectionMode,
    //   manualZonesEnabled: this.config.levelSources?.manualPriceZones !== false,
    //   manualZonesCount: manualZonesToUse.length,
    //   srEnabled: srEnabled
    // });

    // ✅ ACTUALIZADO: Detectar patrones con swing detection, filtro de dirección y modo de validación
    const detectedPatterns = this.localDetector.detectPatterns(candles, {
      patterns: patternsConfig,
      swingDetection: swingConfig,
      volumeZScore: volumeConfig,
      signalDirection: this.config.signalDirection,  // ✅ Pasar objeto completo
      manualPriceZones: manualZonesToUse  // ✅ FIX: Solo si la fuente está habilitada
    }, detectionMode);  // ✅ FIX: Usar detectionMode calculado

    // ✅ FIX BUG 3: Validar patrones contra S/R y aplicar filtro combinado
    const srValidationActive = this.showMode === 'validated' && srEnabled && indicatorManager;

    if (srValidationActive) {
      this.validatePatternsAgainstSR(detectedPatterns, indicatorManager);
    }

    // ✅ FIX BUG 3: Filtrar patrones según fuentes activas en modo 'validated'
    if (this.showMode === 'validated') {
      if (hasManualZones && srEnabled) {
        // CASO 1: Ambas fuentes activas (zonas + S/R) - Lógica OR
        // Patrón pasa si está en zona O cerca de S/R
        const beforeFilter = detectedPatterns.length;
        const filtered = detectedPatterns.filter(pattern => {
          // Verificar si está en alguna zona
          const inZone = manualZonesToUse.some(zone => {
            if (!zone.enabled) return false;
            const inRange = pattern.price >= zone.minPrice && pattern.price <= zone.maxPrice;
            if (!inRange) return false;

            // Verificar dirección de la zona
            const zoneDirection = zone.signalDirection || 'BOTH';
            if (zoneDirection === 'BOTH') return true;
            return pattern.direction === zoneDirection;
          });

          // Verificar si está cerca de S/R
          const nearSR = !!pattern.nearSRLevel;

          return inZone || nearSR;
        });

        // console.log(`[${this.symbol}] 📊 Zones+S/R validation: ${filtered.length}/${beforeFilter} patterns (${filtered.filter(p => p.nearSRLevel).length} near S/R, ${filtered.filter(p => !p.nearSRLevel).length} in zones only)`);

        detectedPatterns.length = 0;
        detectedPatterns.push(...filtered);

      } else if (srEnabled && !hasManualZones) {
        // CASO 2: Solo S/R activo (sin zonas)
        const beforeFilter = detectedPatterns.length;
        const filtered = detectedPatterns.filter(p => p.nearSRLevel);

        // console.log(`[${this.symbol}] 📊 S/R-only validation: ${filtered.length}/${beforeFilter} patterns near S/R levels`);

        detectedPatterns.length = 0;
        detectedPatterns.push(...filtered);
      }
      // CASO 3: Solo zonas (sin S/R) - Ya filtrado por LocalPatternDetector
      // No hacer nada adicional
    }

    // ✅ ESTRATEGIA: Calcular niveles de estrategia para cada patrón ANTES del merge
    if (this.config.strategy?.enabled) {
      this.calculateStrategyForPatterns(detectedPatterns, candles);
    }

    // Si no hay IndicatorManager, solo retornar los patrones básicos
    if (!indicatorManager) {
      // ✅ FIX #2: Usar merge en lugar de asignación directa
      const isInitialLoad = this.knownPatterns.size === 0;
      this.mergeNewPatterns(detectedPatterns, isInitialLoad);
      return;
    }

    // Obtener niveles de referencia de todas las fuentes
    const levelSources = this.config.levelSources || {
      volumeProfile: true,
      fixedRanges: true,
      clusters: true,
      manualLevels: true,
      supportResistance: true,
      rangeDetection: true
    };

    const referenceLevels = indicatorManager.getAllReferenceLevels({
      manualLevels: manualLevels,
      currentPrice: currentPrice,
      sources: levelSources
    });

    // Clasificar niveles
    const classifiedLevels = this.classifyReferenceLevels(referenceLevels);

    // Calcular confidence para cada patrón
    const proximityPct = (this.config.filters?.proximityPercent || 1.0) / 100;

    const enhancedPatterns = detectedPatterns.map(pattern =>
      this.enhancePatternConfidence(
        pattern,
        classifiedLevels.importantHighs,
        classifiedLevels.importantLows,
        proximityPct
      )
    );

    // Filtrar por minConfidence y dirección del nivel
    const minConfidence = this.config.filters?.minConfidence || 0;
    const filteredPatterns = enhancedPatterns.filter(pattern => {
      // Filtro 1: Confidence mínimo
      if (pattern.confidence < minConfidence) return false;

      // NUEVO: Filtro 2: Dirección del nivel (override)
      if (pattern.nearLevel?.signalDirection) {
        const levelDirection = pattern.nearLevel.signalDirection;
        const patternDirection = pattern.direction; // Ya viene del LocalPatternDetector

        // Si el nivel tiene un override de dirección, debe coincidir
        if (levelDirection === 'LONG' && patternDirection !== 'LONG') return false;
        if (levelDirection === 'SHORT' && patternDirection !== 'SHORT') return false;
        // Si levelDirection === 'BOTH', pasar todos los patrones
      }

      return true;
    });

    // ✅ FIX #2: Usar merge en lugar de asignación directa
    const isInitialLoad = this.knownPatterns.size === 0;
    this.mergeNewPatterns(filteredPatterns, isInitialLoad);

    // Limpiar patrones muy viejos periódicamente (cada 100 detecciones)
    if (Math.random() < 0.01) {
      this.cleanOldPatterns();
    }

    // console.log(`[${this.symbol}] Local detection: ${this.localPatterns.length} patterns found (${detectedPatterns.length} before filters)`);

    // ⚠️ DESHABILITADO: Las alertas ahora se envían SOLO desde el backend (RealtimePatternService)
    // El frontend solo visualiza patrones, el backend detecta y envía alertas al TradingBot
    // if (this.showMode === 'validated' && this.config.alertsEnabled) {
    //   this.checkAndSendAlerts(candles).catch(err => {
    //     this.logger.error(`Error checking alerts: ${err.message}`);
    //   });
    // }

    // ⚠️ DESHABILITADO: Las notificaciones del navegador también se manejan desde backend
    // if (this.config.alertsEnabled && !this.notificationPermissionRequested) {
    //   this.requestNotificationPermission();
    // }
  }

  async fetchData() {
    if (!this.config.enabled) {
      this.patterns = [];
      return;
    }

    // ✅ NUEVO: Construir contextos de referencia incluyendo zonas manuales
    const allReferenceContexts = this.buildAllReferenceContexts();

    // Check if we have reference contexts
    if (allReferenceContexts.length === 0) {
      console.warn(`[${this.symbol}] ⚠️ No reference contexts configured. Patterns disabled in 'validated' mode.`);
      console.warn(`[${this.symbol}] 💡 TIP: Either add Reference Contexts OR switch to 'Show All' mode to see locally detected patterns.`);
      this.patterns = [];
      return;
    }

    this.logger.debug(`📊 Fetching patterns with ${allReferenceContexts.length} reference contexts`);

    this.loading = true;

    try {
      const response = await fetch(`${API_BASE_URL}/api/rejection-patterns/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: this.symbol,
          interval: this.interval,
          days: this.days,
          config: this.config,
          referenceContexts: allReferenceContexts
        })
      });

      const data = await response.json();

      if (data.success) {
        this.patterns = data.patterns || [];
        this.logger.debug(`✅ Loaded ${this.patterns.length} validated rejection patterns`);
      } else {
        console.error(`[${this.symbol}] ❌ Failed to fetch patterns:`, data.error);
        this.patterns = [];
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error fetching rejection patterns:`, error);
      this.patterns = [];
    } finally {
      this.loading = false;
    }
  }

  /**
   * ✅ NUEVO: Construye todos los contextos de referencia incluyendo zonas manuales
   * Convierte las zonas manuales en contextos de tipo "manual_zone" para el backend
   */
  buildAllReferenceContexts() {
    const contexts = [...(this.config.referenceContexts || [])];

    // Agregar zonas manuales como contextos si están habilitadas
    if (this.config.levelSources?.manualPriceZones && this.config.manualPriceZones) {
      this.config.manualPriceZones.forEach(zone => {
        if (zone.enabled) {
          const zoneContext = {
            id: zone.id,
            type: 'manual_zone',
            name: zone.name,
            minPrice: zone.minPrice,
            maxPrice: zone.maxPrice,
            signalDirection: zone.signalDirection,
            color: zone.color,
            enabled: true,
            weight: 0.8  // Peso alto para zonas manuales
          };
          this.logger.debug(`🎯 Adding manual zone: ${zone.name}`);
          contexts.push(zoneContext);
        }
      });
    }

    return contexts;
  }

  // Método para overlay (llamado por IndicatorManager)
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext, indicatorManager = null, manualLevels = []) {
    if (!this.enabled || !this.config.enabled) {
      return;
    }

    // NUEVO: Renderizar zonas manuales PRIMERO (fondo)
    if (this.config.manualPriceZones &&
        this.config.manualPriceZones.length > 0 &&
        priceContext?.priceToY) {
      this.renderManualPriceZones(ctx, bounds, priceContext);
    }

    // ✅ FIX: Detectar patrones localmente en AMBOS modos (all y validated)
    // El modo se pasa a detectLocalPatterns que internamente lo pasa a LocalPatternDetector
    if (allCandles && allCandles.length > 0) {
      this.detectLocalPatterns(allCandles, indicatorManager, manualLevels);

      // ✅ Evaluar resultados de trades pendientes (WIN/LOSS)
      this.evaluatePendingTradeOutcomes(allCandles);
    }

    // Removed debug log for performance

    // ✅ FIX: Siempre usar patrones locales (ya tienen validación incorporada según el modo)
    let patternsToShow = this.localPatterns;

    // ✅ OPTIMIZADO: Filtrar por VWAP usando el flag pre-calculado (_vwapAligned)
    // El check se hace UNA VEZ en mergeNewPatterns, no en cada render
    if (this.config.vwapFilter?.enabled) {
      patternsToShow = patternsToShow.filter(pattern => pattern._vwapAligned === true);
    }

    if (patternsToShow.length === 0) {
      return;
    }

    // Create a map of patterns by timestamp for quick lookup
    const patternMap = new Map();
    for (const pattern of patternsToShow) {
      patternMap.set(pattern.timestamp, pattern);
    }

    // Render patterns on the visible candles
    const candleWidth = bounds.width / visibleCandles.length;

    // Helper function to convert price to Y coordinate
    const priceToY = (price) => {
      if (!priceContext) return bounds.y;
      const { minPrice, yScale, verticalOffset } = priceContext;
      return bounds.y + bounds.height - (price - minPrice) * yScale + verticalOffset;
    };

    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const pattern = patternMap.get(candle.timestamp);

      if (!pattern) continue;

      // ✅ NUEVO: Verificar invalidación en tiempo real (si no se ha chequeado antes)
      if (pattern._invalidated === undefined && this.config.priceActionValidation?.enabled !== false) {
        const patternIndex = allCandles.findIndex(c => c.timestamp === pattern.timestamp);
        if (patternIndex !== -1) {
          const invalidation = this.checkPatternInvalidation(pattern, patternIndex, allCandles);
          if (invalidation.invalidated) {
            pattern._invalidated = true;
            pattern._invalidationReason = invalidation.reason;
          } else {
            pattern._invalidated = false;
          }
        }
      }

      const x = bounds.x + i * candleWidth + candleWidth / 2;
      const highY = priceToY(candle.high);
      const lowY = priceToY(candle.low);

      // ✅ Dibujar líneas de estrategia si existen (ya calculadas en detectLocalPatterns)
      // NO dibujar estrategia si el patrón está invalidado
      if (this.config.strategy?.enabled && pattern._strategy && !pattern._invalidated) {
        this.drawStrategyLines(ctx, bounds, pattern, x, priceToY, candleWidth);
      }

      // Draw pattern marker (diferente visualización según modo)
      const isValidated = this.showMode === 'validated';
      this.drawPatternMarker(ctx, x, highY, lowY, pattern, isValidated);
    }
  }

  drawPatternMarker(ctx, x, highY, lowY, pattern, isValidated = false) {
    // Normalizar el tipo de patrón (puede venir como 'type' o 'patternType')
    const patternType = pattern.type || pattern.patternType;

    // Usar confidence si existe, o quality si es detección local
    const score = pattern.confidence || pattern.quality || 50;

    // ✅ NUEVO: Verificar si el patrón fue invalidado
    const isInvalidated = pattern._invalidated === true;

    const color = this.colors[patternType] || '#888';

    // ✅ ESPECIAL: Dibujar flechas para SWING_LOW y SWING_HIGH
    if (patternType === 'SWING_LOW' || patternType === 'SWING_HIGH') {
      this.drawSwingArrow(ctx, x, highY, lowY, patternType, score, isValidated, pattern._alertSent, isInvalidated);
      return;
    }

    // Determinar si es patrón alcista o bajista
    const isBullish = patternType === 'HAMMER' ||
                      patternType === 'ENGULFING_BULLISH' ||
                      patternType === 'DOJI_DRAGONFLY';

    // Posicionar el punto: arriba para bajista (sobre el high), abajo para alcista (bajo el low)
    const dotY = isBullish ? lowY + 8 : highY - 8;

    // Tamaño del punto basado en score y validación
    const baseRadius = isValidated ? 5 : 4;
    const radius = baseRadius + (score / 100) * 2; // Max radius: 7 or 6

    // ✅ INVALIDATED: Color más tenue y estilo diferente
    const effectiveColor = isInvalidated ? '#888' : color;
    const effectiveAlpha = isInvalidated ? 0.3 : (isValidated ? 0.9 : 0.7);

    // Dibujar punto principal
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, dotY, radius, 0, Math.PI * 2);

    // Color más intenso para validados, tenue para invalidados
    const alpha = Math.max(effectiveAlpha * 0.6, (score / 100) * effectiveAlpha);
    ctx.fillStyle = this.hexToRgba(effectiveColor, alpha);
    ctx.fill();

    // Borde del punto
    ctx.strokeStyle = effectiveColor;
    ctx.lineWidth = isValidated ? 2 : 1;
    if (!isValidated || isInvalidated) {
      // Patrón local o invalidado: borde punteado
      ctx.setLineDash([2, 2]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ✅ INVALIDATED: Dibujar X sobre el patrón
    if (isInvalidated) {
      ctx.save();
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      // X diagonal
      ctx.moveTo(x - radius, dotY - radius);
      ctx.lineTo(x + radius, dotY + radius);
      ctx.moveTo(x + radius, dotY - radius);
      ctx.lineTo(x - radius, dotY + radius);
      ctx.stroke();
      ctx.restore();
      return; // No mostrar más badges para patrones invalidados
    }

    // Anillo exterior para patrones validados de alta confianza
    if (isValidated && score >= 70) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, dotY, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = this.hexToRgba(color, 0.3);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Badge para patrones validados
    if (isValidated) {
      ctx.save();
      ctx.font = 'bold 7px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // ✅ NUEVO: Doble checkmark para patrones que enviaron alerta
      if (pattern._alertSent) {
        // Patrón que envió alerta exitosamente → doble checkmark verde brillante
        ctx.fillStyle = '#00FF00';  // Verde brillante
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeText('✓✓', x + radius + 4, dotY - radius - 2);
        ctx.fillText('✓✓', x + radius + 4, dotY - radius - 2);
      } else {
        // Patrón validado pero sin alerta → checkmark simple
        ctx.fillStyle = '#4CAF50';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.strokeText('✓', x + radius + 2, dotY - radius - 2);
        ctx.fillText('✓', x + radius + 2, dotY - radius - 2);
      }
      ctx.restore();
    }
  }

  /**
   * ✅ NUEVO: Dibuja flechas para patrones SWING_LOW y SWING_HIGH
   * - Verde hacia arriba para SWING_LOW (señal LONG) - debajo del mínimo de la vela
   * - Rojo hacia abajo para SWING_HIGH (señal SHORT) - encima del máximo de la vela
   */
  drawSwingArrow(ctx, x, highY, lowY, patternType, score, isValidated, alertSent, isInvalidated = false) {
    const isLong = patternType === 'SWING_LOW';

    // Obtener configuración de estilo desde config (con valores por defecto)
    const arrowStyle = this.config.swingArrowStyle || {};
    const baseSize = arrowStyle.size || 10;
    const offset = arrowStyle.offset || 8;

    // Colores configurables - gris si está invalidado
    const longColor = arrowStyle.longColor || this.colors.SWING_LOW || '#00E676';
    const shortColor = arrowStyle.shortColor || this.colors.SWING_HIGH || '#FF1744';
    const color = isInvalidated ? '#888' : (isLong ? longColor : shortColor);

    // Tamaño de la flecha (el baseSize del config, sin escalar por score para mantener consistencia)
    const size = baseSize;

    // Posición: SWING_LOW debajo del mínimo (lowY), SWING_HIGH encima del máximo (highY)
    // Nota: en canvas Y crece hacia abajo, así que lowY > highY
    const arrowY = isLong ? lowY + offset + size : highY - offset - size;

    ctx.save();

    // Alpha basado en score - más tenue si está invalidado
    const baseAlpha = isInvalidated ? 0.35 : (isValidated ? 0.95 : 0.85);
    const alpha = Math.max(baseAlpha * 0.8, (score / 100) * baseAlpha);

    // Dibujar flecha
    ctx.beginPath();
    if (isLong) {
      // Flecha hacia ARRIBA (LONG) - triángulo apuntando arriba, debajo del low
      ctx.moveTo(x, arrowY - size);           // Punta superior
      ctx.lineTo(x - size * 0.6, arrowY + size * 0.4);  // Esquina inferior izquierda
      ctx.lineTo(x + size * 0.6, arrowY + size * 0.4);  // Esquina inferior derecha
    } else {
      // Flecha hacia ABAJO (SHORT) - triángulo apuntando abajo, encima del high
      ctx.moveTo(x, arrowY + size);           // Punta inferior
      ctx.lineTo(x - size * 0.6, arrowY - size * 0.4);  // Esquina superior izquierda
      ctx.lineTo(x + size * 0.6, arrowY - size * 0.4);  // Esquina superior derecha
    }
    ctx.closePath();

    // Relleno
    ctx.fillStyle = this.hexToRgba(color, alpha);
    ctx.fill();

    // Borde
    ctx.strokeStyle = color;
    ctx.lineWidth = isValidated ? 2 : 1.5;
    ctx.stroke();

    // ✅ INVALIDATED: Dibujar X sobre la flecha
    if (isInvalidated) {
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - size * 0.5, arrowY - size * 0.5);
      ctx.lineTo(x + size * 0.5, arrowY + size * 0.5);
      ctx.moveTo(x + size * 0.5, arrowY - size * 0.5);
      ctx.lineTo(x - size * 0.5, arrowY + size * 0.5);
      ctx.stroke();
      ctx.restore();
      return; // No mostrar más badges
    }

    // Efecto glow para alta confianza
    if (isValidated && score >= 70) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Badge de alerta enviada
    if (alertSent) {
      ctx.font = 'bold 8px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#00FF00';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      const badgeY = isLong ? arrowY + size + 10 : arrowY - size - 10;
      ctx.strokeText('✓✓', x, badgeY);
      ctx.fillText('✓✓', x, badgeY);
    }

    ctx.restore();
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * ✅ NUEVO: Calcula estrategia para todos los patrones de una vez
   * @param {Array} patterns - Array de patrones detectados
   * @param {Array} candles - Array de velas
   */
  calculateStrategyForPatterns(patterns, candles) {
    if (!this.config.strategy?.enabled || !patterns || !candles) return;

    patterns.forEach(pattern => {
      // Solo calcular si no tiene estrategia ya calculada
      if (pattern._strategy) return;

      // Usar candleIndex del patrón
      const patternIndex = pattern.candleIndex;
      if (patternIndex === undefined || patternIndex < 0) return;

      pattern._strategy = this.calculateStrategyLevels(pattern, candles, patternIndex);
    });
  }

  /**
   * ✅ NUEVO: Calcula niveles de estrategia (Entry, Stop Loss, Take Profit)
   * @param {Object} pattern - Patrón detectado
   * @param {Array} candles - Array de velas
   * @param {number} patternIndex - Índice de la vela del patrón
   * @returns {Object} {entry, stopLoss, takeProfit, slPercent, tpPercent}
   */
  calculateStrategyLevels(pattern, candles, patternIndex) {
    if (!this.config.strategy?.enabled) return null;

    const patternCandle = candles[patternIndex];
    if (!patternCandle) return null;

    const isLong = pattern.direction === 'LONG';
    const rrRatio = this.config.strategy.riskRewardRatio || 2.0;
    const strategyConfig = this.config.strategy;

    // Obtener parámetros de swing de la configuración
    const swingConfig = this.config.swingDetection || {};
    const rightBars = swingConfig.required ? (swingConfig.rightBars || 5) : 0;

    // Obtener parámetros de price action validation
    const paConfig = this.config.priceActionValidation || {};
    const barsToCheck = paConfig.enabled !== false ? (paConfig.barsToCheck || 3) : 0;

    // ✅ FIX: Entry = close de la última vela de VALIDACIÓN
    // La alerta y entry se dan DESPUÉS de que el patrón pasa el filtro de invalidación
    // Total = rightBars (swing confirmation) + barsToCheck (price action validation)
    const totalConfirmationBars = rightBars + barsToCheck;
    const confirmationIndex = patternIndex + totalConfirmationBars;
    const confirmationCandle = candles[confirmationIndex] || candles[candles.length - 1] || patternCandle;
    const entry = confirmationCandle.close;

    // Parámetros para buscar swing del SL (pueden ser diferentes a los de detección)
    const slSwingLeftBars = strategyConfig.slSwingLeftBars || swingConfig.leftBars || 3;
    const slSwingRightBars = strategyConfig.slSwingRightBars || swingConfig.rightBars || 3;
    const slSwingLookback = strategyConfig.slSwingLookback || 50;
    const slBufferPercent = strategyConfig.slBufferPercent || 20; // % extra de seguridad (10-100%)

    // Buscar el swing anterior significativo
    let stopLoss;
    let usedFallback = false;

    if (isLong) {
      // Para LONG: SL debe estar POR DEBAJO del entry
      const swingLow = this.findPreviousSignificantLow(candles, patternIndex, slSwingLeftBars, slSwingRightBars, slSwingLookback);

      if (swingLow !== null && swingLow < entry) {
        stopLoss = swingLow;
      } else {
        // Fallback: usar el mínimo de la vela del patrón + buffer
        usedFallback = true;
        const patternLow = patternCandle.low;
        const distanceToLow = entry - patternLow;
        const buffer = distanceToLow * (slBufferPercent / 100);
        stopLoss = patternLow - buffer;
      }
    } else {
      // Para SHORT: SL debe estar POR ENCIMA del entry
      const swingHigh = this.findPreviousSignificantHigh(candles, patternIndex, slSwingLeftBars, slSwingRightBars, slSwingLookback);

      if (swingHigh !== null && swingHigh > entry) {
        stopLoss = swingHigh;
      } else {
        // Fallback: usar el máximo de la vela del patrón + buffer
        usedFallback = true;
        const patternHigh = patternCandle.high;
        const distanceToHigh = patternHigh - entry;
        const buffer = distanceToHigh * (slBufferPercent / 100);
        stopLoss = patternHigh + buffer;
      }
    }

    // Calcular distancia del SL como porcentaje
    let slDistance = Math.abs(entry - stopLoss);
    let slPercent = (slDistance / entry) * 100;

    // ✅ NUEVO: Aplicar SL mínimo si está configurado
    const slMinPercent = strategyConfig.slMinPercent || 0.5;
    if (slPercent < slMinPercent) {
      // Recalcular SL para que sea al menos el mínimo %
      slPercent = slMinPercent;
      slDistance = entry * (slMinPercent / 100);
      if (isLong) {
        stopLoss = entry - slDistance;
      } else {
        stopLoss = entry + slDistance;
      }
    }

    // Take Profit = Entry ± (SL distance * RR ratio)
    let takeProfit;
    if (isLong) {
      takeProfit = entry + (slDistance * rrRatio);
    } else {
      takeProfit = entry - (slDistance * rrRatio);
    }

    const tpPercent = slPercent * rrRatio;

    return {
      entry,
      stopLoss,
      takeProfit,
      slPercent: Math.round(slPercent * 100) / 100,
      tpPercent: Math.round(tpPercent * 100) / 100,
      riskRewardRatio: rrRatio,
      direction: isLong ? 'LONG' : 'SHORT',
      usedFallback,
      confirmationTimestamp: confirmationCandle.timestamp  // ✅ Para posicionar las líneas en la vela de confirmación
    };
  }

  /**
   * Busca el low significativo anterior (swing low o mínimo local)
   */
  findPreviousSignificantLow(candles, beforeIndex, leftBars, rightBars, maxLookback = 50) {
    // Primero intentar encontrar un swing low confirmado
    const swingLow = this.findPreviousSwingLow(candles, beforeIndex, leftBars, rightBars);
    if (swingLow !== null) return swingLow;

    // Si no hay swing confirmado, buscar el mínimo en las últimas N velas
    const lookback = Math.min(beforeIndex, maxLookback);
    let lowestLow = null;
    for (let i = beforeIndex - 1; i >= beforeIndex - lookback && i >= 0; i--) {
      if (candles[i]) {
        if (lowestLow === null || candles[i].low < lowestLow) {
          lowestLow = candles[i].low;
        }
      }
    }
    return lowestLow;
  }

  /**
   * Busca el high significativo anterior (swing high o máximo local)
   */
  findPreviousSignificantHigh(candles, beforeIndex, leftBars, rightBars, maxLookback = 50) {
    // Primero intentar encontrar un swing high confirmado
    const swingHigh = this.findPreviousSwingHigh(candles, beforeIndex, leftBars, rightBars);
    if (swingHigh !== null) return swingHigh;

    // Si no hay swing confirmado, buscar el máximo en las últimas N velas
    const lookback = Math.min(beforeIndex, maxLookback);
    let highestHigh = null;
    for (let i = beforeIndex - 1; i >= beforeIndex - lookback && i >= 0; i--) {
      if (candles[i]) {
        if (highestHigh === null || candles[i].high > highestHigh) {
          highestHigh = candles[i].high;
        }
      }
    }
    return highestHigh;
  }

  /**
   * Busca el swing low anterior más cercano al índice dado
   * @param {Array} candles - Array de velas
   * @param {number} beforeIndex - Buscar antes de este índice
   * @param {number} leftBars - Velas a la izquierda para confirmar swing
   * @param {number} rightBars - Velas a la derecha para confirmar swing
   * @returns {number|null} Precio del swing low o null si no se encuentra
   */
  findPreviousSwingLow(candles, beforeIndex, leftBars, rightBars) {
    // Buscar hacia atrás desde beforeIndex - rightBars (para que el swing esté completamente confirmado)
    for (let i = beforeIndex - rightBars - 1; i >= leftBars; i--) {
      if (this.isSwingLow(candles, i, leftBars, rightBars)) {
        return candles[i].low;
      }
    }
    return null;
  }

  /**
   * Busca el swing high anterior más cercano al índice dado
   * @param {Array} candles - Array de velas
   * @param {number} beforeIndex - Buscar antes de este índice
   * @param {number} leftBars - Velas a la izquierda para confirmar swing
   * @param {number} rightBars - Velas a la derecha para confirmar swing
   * @returns {number|null} Precio del swing high o null si no se encuentra
   */
  findPreviousSwingHigh(candles, beforeIndex, leftBars, rightBars) {
    // Buscar hacia atrás desde beforeIndex - rightBars (para que el swing esté completamente confirmado)
    for (let i = beforeIndex - rightBars - 1; i >= leftBars; i--) {
      if (this.isSwingHigh(candles, i, leftBars, rightBars)) {
        return candles[i].high;
      }
    }
    return null;
  }

  /**
   * Verifica si una vela es un swing low (mínimo local)
   * @param {Array} candles - Array de velas
   * @param {number} index - Índice de la vela a verificar
   * @param {number} leftBars - Velas a la izquierda
   * @param {number} rightBars - Velas a la derecha
   * @returns {boolean}
   */
  isSwingLow(candles, index, leftBars, rightBars) {
    if (index < leftBars || index >= candles.length - rightBars) {
      return false;
    }

    const currentLow = candles[index].low;

    // Verificar que el low actual es el mínimo en toda la ventana
    for (let i = index - leftBars; i <= index + rightBars; i++) {
      if (i !== index && candles[i].low <= currentLow) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verifica si una vela es un swing high (máximo local)
   * @param {Array} candles - Array de velas
   * @param {number} index - Índice de la vela a verificar
   * @param {number} leftBars - Velas a la izquierda
   * @param {number} rightBars - Velas a la derecha
   * @returns {boolean}
   */
  isSwingHigh(candles, index, leftBars, rightBars) {
    if (index < leftBars || index >= candles.length - rightBars) {
      return false;
    }

    const currentHigh = candles[index].high;

    // Verificar que el high actual es el máximo en toda la ventana
    for (let i = index - leftBars; i <= index + rightBars; i++) {
      if (i !== index && candles[i].high >= currentHigh) {
        return false;
      }
    }

    return true;
  }

  /**
   * ✅ NUEVO: Dibuja las líneas de estrategia (Entry, SL, TP)
   * @param {CanvasRenderingContext2D} ctx - Contexto del canvas
   * @param {Object} bounds - Límites del área de dibujo
   * @param {Object} pattern - Patrón con datos de estrategia
   * @param {number} patternX - Posición X del patrón
   * @param {Function} priceToY - Función para convertir precio a Y
   * @param {number} candleWidth - Ancho de cada vela
   */
  drawStrategyLines(ctx, bounds, pattern, patternX, priceToY, candleWidth) {
    if (!this.config.strategy?.enabled || !pattern._strategy) return;

    const strategy = pattern._strategy;
    const config = this.config.strategy;
    const lineLength = (config.lineLengthCandles || 5) * candleWidth;

    // ✅ FIX: Si hay confirmationTimestamp, usar esa posición en lugar de la del patrón
    // La diferencia en timestamps nos da cuántas velas avanzar desde el patrón
    let actualX = patternX;
    if (strategy.confirmationTimestamp && pattern.timestamp) {
      const swingConfig = this.config.swingDetection || {};
      const rightBars = swingConfig.rightBars || 5;
      // Mover X hacia adelante por el número de velas de confirmación
      actualX = patternX + (rightBars * candleWidth);
    }

    // Coordenadas X: desde 5 velas antes hasta 5 velas después
    const startX = Math.max(bounds.x, actualX - lineLength);
    const endX = Math.min(bounds.x + bounds.width, actualX + lineLength);

    // Coordenadas Y
    const entryY = priceToY(strategy.entry);
    const slY = priceToY(strategy.stopLoss);
    const tpY = priceToY(strategy.takeProfit);

    ctx.save();

    // ✅ NUEVO: Dos rectángulos separados (SL-Entry rojo, Entry-TP verde)
    // ✅ FIX: Si el patrón fue descartado por cooldown, usar colores grises diferenciados
    if (config.showBox !== false) {
      const isDiscarded = pattern._discardedByCooldown === true;
      const cooldownConfig = this.config.alertCooldown || {};

      // Colores y opacidad según estado del patrón
      let slBoxColor, tpBoxColor, boxOpacity;

      if (isDiscarded) {
        // Patrón descartado por cooldown: usar color gris uniforme
        slBoxColor = cooldownConfig.discardedBoxColor || '#9E9E9E';
        tpBoxColor = cooldownConfig.discardedBoxColor || '#9E9E9E';
        boxOpacity = cooldownConfig.discardedBoxOpacity ?? 0.10;
      } else {
        // Patrón activo: usar colores normales
        slBoxColor = config.slBoxColor || config.stopLossColor || '#FF1744';
        tpBoxColor = config.tpBoxColor || config.takeProfitColor || '#00E676';
        boxOpacity = config.boxOpacity || 0.15;
      }

      // Box 1: Entre SL y Entry
      const slBoxTopY = Math.min(slY, entryY);
      const slBoxBottomY = Math.max(slY, entryY);
      const slBoxHeight = slBoxBottomY - slBoxTopY;

      ctx.fillStyle = this.hexToRgba(slBoxColor, boxOpacity);
      ctx.fillRect(startX, slBoxTopY, endX - startX, slBoxHeight);

      // Box 2: Entre Entry y TP
      const tpBoxTopY = Math.min(entryY, tpY);
      const tpBoxBottomY = Math.max(entryY, tpY);
      const tpBoxHeight = tpBoxBottomY - tpBoxTopY;

      ctx.fillStyle = this.hexToRgba(tpBoxColor, boxOpacity);
      ctx.fillRect(startX, tpBoxTopY, endX - startX, tpBoxHeight);
    }

    ctx.setLineDash([4, 2]); // Línea punteada

    // ✅ FIX: Determinar colores de líneas según estado del patrón
    const isDiscardedForLines = pattern._discardedByCooldown === true;
    const cooldownCfg = this.config.alertCooldown || {};
    const discardedLineColor = cooldownCfg.discardedBoxColor || '#9E9E9E';

    const entryLineColor = isDiscardedForLines ? discardedLineColor : (config.entryColor || '#03A9F4');
    const slLineColor = isDiscardedForLines ? discardedLineColor : (config.stopLossColor || '#FF1744');
    const tpLineColor = isDiscardedForLines ? discardedLineColor : (config.takeProfitColor || '#00E676');

    // === Línea de Entry ===
    ctx.beginPath();
    ctx.strokeStyle = entryLineColor;
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, entryY);
    ctx.lineTo(endX, entryY);
    ctx.stroke();

    // === Línea de Stop Loss ===
    ctx.beginPath();
    ctx.strokeStyle = slLineColor;
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, slY);
    ctx.lineTo(endX, slY);
    ctx.stroke();

    // === Línea de Take Profit ===
    ctx.beginPath();
    ctx.strokeStyle = tpLineColor;
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, tpY);
    ctx.lineTo(endX, tpY);
    ctx.stroke();

    ctx.setLineDash([]); // Resetear línea punteada

    // === Etiquetas con precio y % ===
    if (config.showLabels !== false) {
      ctx.font = 'bold 9px Arial';
      ctx.textAlign = 'left';
      const labelX = endX + 4;

      // Entry label con dirección (LONG/SHORT)
      const dirLabel = strategy.direction || 'ENTRY';
      ctx.fillStyle = entryLineColor;
      ctx.fillText(`${dirLabel}: $${strategy.entry.toFixed(2)}`, labelX, entryY + 3);

      // SL label con dirección y %
      ctx.fillStyle = slLineColor;
      ctx.fillText(`SL ${dirLabel}: $${strategy.stopLoss.toFixed(2)} (${strategy.slPercent}%)`, labelX, slY + 3);

      // TP label con dirección y %
      ctx.fillStyle = tpLineColor;
      ctx.fillText(`TP ${dirLabel}: $${strategy.takeProfit.toFixed(2)} (${strategy.tpPercent}%)`, labelX, tpY + 3);
    }

    ctx.restore();
  }

  /**
   * NUEVO: Renderiza zonas manuales de precio en el gráfico
   */
  renderManualPriceZones(ctx, bounds, priceContext) {
    const { priceToY } = priceContext;

    this.config.manualPriceZones.forEach(zone => {
      if (!zone.enabled) return;

      const minY = priceToY(zone.minPrice);
      const maxY = priceToY(zone.maxPrice);
      const height = Math.abs(minY - maxY);

      // Rectángulo sombreado (fondo de la zona)
      ctx.save();
      ctx.fillStyle = this.hexToRgba(zone.color, 0.08);
      ctx.fillRect(bounds.x, maxY, bounds.width, height);

      // Bordes superior e inferior (punteados)
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);

      // Borde superior
      ctx.beginPath();
      ctx.moveTo(bounds.x, maxY);
      ctx.lineTo(bounds.x + bounds.width, maxY);
      ctx.stroke();

      // Borde inferior
      ctx.beginPath();
      ctx.moveTo(bounds.x, minY);
      ctx.lineTo(bounds.x + bounds.width, minY);
      ctx.stroke();

      ctx.setLineDash([]);

      // Label con nombre y dirección
      const labelY = (minY + maxY) / 2;
      const directionIcon = zone.signalDirection === 'LONG' ? '📈' :
                            zone.signalDirection === 'SHORT' ? '📉' :
                            zone.signalDirection === 'BOTH' ? '↕️' : '';

      ctx.fillStyle = zone.color;
      ctx.font = 'bold 11px Arial';
      const labelText = `${zone.name} ${directionIcon}`;

      // Fondo semi-transparente para el texto
      const textMetrics = ctx.measureText(labelText);
      const textWidth = textMetrics.width;
      const padding = 6;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(
        bounds.x + 5,
        labelY - 8,
        textWidth + padding * 2,
        16
      );

      // Texto
      ctx.fillStyle = zone.color;
      ctx.fillText(labelText, bounds.x + 5 + padding, labelY + 4);

      ctx.restore();
    });
  }

  // Handle mouse hover to show pattern details
  getTooltipInfo(x, y, bounds, candles, priceToY) {
    if (!this.enabled || !this.config.enabled || this.localPatterns.length === 0) {
      return null;
    }

    const candleWidth = bounds.width / candles.length;
    const patternMap = new Map();

    for (const pattern of this.localPatterns) {
      patternMap.set(pattern.timestamp, pattern);
    }

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const pattern = patternMap.get(candle.timestamp);

      if (!pattern) continue;

      const markerX = bounds.x + i * candleWidth + candleWidth / 2;
      const markerY = priceToY(candle.high) - 20;

      // Check if mouse is near the marker
      const distance = Math.sqrt(
        Math.pow(x - markerX, 2) + Math.pow(y - markerY, 2)
      );

      if (distance < 15) {
        return this.formatTooltip(pattern);
      }
    }

    return null;
  }

  formatTooltip(pattern) {
    const { patternType, confidence, price, nearLevels, metrics } = pattern;

    let tooltip = `${this.formatPatternNameWithEmoji(patternType)}\n`;
    tooltip += `Confidence: ${confidence.toFixed(1)}%\n`;
    tooltip += `Price: $${price.toFixed(2)}\n`;

    if (nearLevels && nearLevels.length > 0) {
      tooltip += `\nNear levels:\n`;
      for (const level of nearLevels.slice(0, 3)) {
        const distance = Math.abs(price - level.price);
        const distancePct = (distance / price * 100).toFixed(2);
        tooltip += `  • ${level.type} @ $${level.price.toFixed(2)} (${distancePct}%)\n`;
      }
    }

    if (metrics) {
      tooltip += `\nMetrics:\n`;
      tooltip += `  Quality: ${(metrics.pattern_quality * 100).toFixed(0)}%\n`;
      tooltip += `  Volume: ${(metrics.volume_score * 100).toFixed(0)}%\n`;
    }

    return tooltip;
  }

  formatPatternNameWithEmoji(patternType) {
    const names = {
      HAMMER: '🔨 Hammer',
      SHOOTING_STAR: '⭐ Shooting Star',
      ENGULFING_BULLISH: '📈 Bullish Engulfing',
      ENGULFING_BEARISH: '📉 Bearish Engulfing',
      DOJI_DRAGONFLY: '🐉 Dragonfly Doji',
      DOJI_GRAVESTONE: '🪦 Gravestone Doji',
      SWING_LOW: '📍 Swing Low',
      SWING_HIGH: '📍 Swing High'
    };
    return names[patternType] || patternType;
  }

  // Get count of patterns for UI display
  getPatternCount() {
    return this.localPatterns.length;
  }

  // Get patterns by type
  getPatternsByType() {
    const byType = {};
    for (const pattern of this.localPatterns) {
      const type = pattern.patternType || pattern.type;
      if (!byType[type]) {
        byType[type] = 0;
      }
      byType[type]++;
    }
    return byType;
  }

  // Real-time pattern detection on new candles
  processRealtimeData(wsData) {
    // When a new candle closes, we could trigger pattern detection
    // For now, we'll rely on periodic refreshes
    // In Phase 2, this could be enhanced to detect patterns in real-time
  }
}

export default RejectionPatternIndicator;
