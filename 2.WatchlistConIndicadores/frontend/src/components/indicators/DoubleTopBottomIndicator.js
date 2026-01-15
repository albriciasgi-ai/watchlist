// src/components/indicators/DoubleTopBottomIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import Logger from '../../utils/Logger.js';

// Crear instancia del logger
const log = new Logger('DoubleTopBottom', { level: 'info' });

/**
 * Double Top/Bottom Pattern Indicator
 *
 * Detects double top and double bottom patterns with rejection validation
 * and optional momentum confirmation for entry signals.
 */
class DoubleTopBottomIndicator extends IndicatorBase {
  // Versión del indicador - incrementar cuando cambie el formato de IDs o datos
  static VERSION = 'v2.1.0';

  constructor(symbol, interval, days = 90) {
    super(symbol, interval, days);
    this.name = "Double Top/Bottom";
    this.patterns = [];
    this.config = this.loadConfig();
    this.lastLoadedInterval = interval; // Track el intervalo cargado

    // ✅ Sincronizar this.enabled con config.enabled al inicializar
    if (this.config.enabled !== undefined) {
      this.enabled = this.config.enabled;
    }

    this.height = 0; // Overlay on main chart
    this.loading = false;

    // Sistema de alertas mejorado
    this.alertedPatterns = new Set(); // Set de IDs de patrones ya alertados
    this.alertHistory = []; // Historial de alertas (max 20)
    this.alertCooldowns = new Map(); // Cooldowns por nivel (critical/high/medium)
    this.notificationPermissionRequested = false;
    this.alertSystemStartTime = null; // Solo alertar patrones detectados después de este timestamp

    // ✅ NUEVO: Cooldown global entre alertas (configurable)
    this.lastGlobalAlertTimestamp = this.loadLastGlobalAlertTimestamp();

    // Real-time detection
    this.lastRealtimeCheck = null; // Timestamp de última detección en tiempo real
    this.hasRunFullAnalysis = false; // Flag para saber si ya se hizo el análisis completo inicial

    // ✅ MIGRACIÓN: Limpiar datos legacy si la versión cambió
    // Esto evita problemas con IDs de patrones que usaban formato anterior
    this._migrateIfNeeded();

    // Cargar historial desde localStorage
    this.loadAlertHistory();

    log.debug(`[${this.symbol}] 🔔 Double Top/Bottom ${DoubleTopBottomIndicator.VERSION} initialized`);
  }

  /**
   * Migra datos legacy cuando la versión del indicador cambia.
   * Limpia alertedPatterns y cooldowns para evitar conflictos con nuevos IDs.
   */
  _migrateIfNeeded() {
    const versionKey = `dbt_version_${this.symbol}`;
    const storedVersion = localStorage.getItem(versionKey);

    if (storedVersion !== DoubleTopBottomIndicator.VERSION) {
      log.info(`[${this.symbol}] 🔄 Migrando DBT de ${storedVersion || 'null'} a ${DoubleTopBottomIndicator.VERSION}`);

      // Limpiar datos que dependen del formato de ID
      this.alertedPatterns.clear();
      this.alertCooldowns.clear();

      // Limpiar historial de alertas (los IDs viejos no coincidirán)
      localStorage.removeItem(`dbt_alert_history_${this.symbol}`);

      // Guardar nueva versión
      localStorage.setItem(versionKey, DoubleTopBottomIndicator.VERSION);

      log.info(`[${this.symbol}] ✅ Migración completada - datos legacy limpiados`);
    }
  }

  loadConfig() {
    // Función helper para obtener maxBreakoutPercent dinámico
    const getMaxBreakoutByInterval = () => {
      switch (this.interval) {
        case '1':   return 7.0;  // 1 minuto: muy tolerante (patrones hasta 11% visto en logs)
        case '3':   return 5.0;  // 3 minutos
        case '5':   return 4.0;  // 5 minutos
        case '15':  return 3.0;  // 15 minutos
        case '30':  return 2.5;  // 30 minutos
        case '60':  return 2.0;  // 1 hora
        case '120': return 2.0;  // 2 horas
        case '240': return 2.0;  // 4 horas
        case 'D':   return 2.0;  // Diario
        default:    return 3.0;  // Valor por defecto
      }
    };

    const saved = localStorage.getItem(`double_topbottom_config_${this.symbol}`);
    let config;

    if (saved) {
      try {
        config = JSON.parse(saved);
        // RESPETAMOS LA CONFIGURACIÓN GUARDADA DEL USUARIO
        // Solo aplicamos valores por defecto si faltan propiedades

        // Asegurar estructura básica
        if (!config.doubleTopBottom) {
          config.doubleTopBottom = {};
        }

        // Solo aplicar valor por defecto si maxBreakoutPercent no está definido
        if (config.doubleTopBottom.maxBreakoutPercent === undefined || config.doubleTopBottom.maxBreakoutPercent === null) {
          config.doubleTopBottom.maxBreakoutPercent = getMaxBreakoutByInterval();
          log.debug(`[${this.symbol}] Using default maxBreakoutPercent: ${config.doubleTopBottom.maxBreakoutPercent}% for interval ${this.interval}`);
        }

        // Asegurar que existan las estructuras necesarias sin sobrescribir valores
        if (!config.doubleTopBottom.volumeFilter) {
          config.doubleTopBottom.volumeFilter = { enabled: false };
        }

        if (!config.filters) {
          config.filters = {
            minConfidence: 20,
            requireBothRejections: false
          };
        }

        // Asegurar que exista alertSettings (CRÍTICO para evitar errores)
        if (!config.alertSettings) {
          config.alertSettings = {
            mode: 'smart',
            confidenceLevels: {
              critical: {
                minConfidence: 80,
                cooldownSeconds: 60,
                color: '#F44336'
              },
              high: {
                minConfidence: 60,
                cooldownSeconds: 180,
                color: '#FF9800'
              },
              medium: {
                minConfidence: 40,
                cooldownSeconds: 300,
                color: '#FFC107'
              }
            },
            vwapFilter: {
              enabled: false,
              deviationTolerance: 0.5,
              requiredDeviations: {
                second: true,
                third: true
              }
            },
            visualization: {
              showDetectionCircle: true,
              detectionCircleColor: '#2196F3',
              detectionCircleSize: 8
            }
          };
        } else {
          // Asegurar que exista vwapFilter dentro de alertSettings
          if (!config.alertSettings.vwapFilter) {
            config.alertSettings.vwapFilter = {
              enabled: false,
              deviationTolerance: 0.5,
              requiredDeviations: {
                second: true,
                third: true
              }
            };
          }
        }

      } catch (e) {
        log.error(`[${this.symbol}] Failed to load double top/bottom config:`, e);
        config = this.getDefaultConfig();
      }
    } else {
      config = this.getDefaultConfig();
    }

    log.trace(`[${this.symbol}] DTB Config loaded - maxBreakoutPercent: ${config.doubleTopBottom.maxBreakoutPercent}% for interval ${this.interval}, minConfidence: ${config.filters.minConfidence}%, volumeFilter: ${config.doubleTopBottom.volumeFilter?.enabled}, requireBothRejections: ${config.filters.requireBothRejections}`);

    return config;
  }

  getDefaultConfig() {
    // Ajustar maxBreakoutPercent según el timeframe
    const getMaxBreakoutByInterval = () => {
      switch (this.interval) {
        case '1':   return 7.0;  // 1 minuto: muy tolerante (patrones hasta 11% visto en logs)
        case '3':   return 5.0;  // 3 minutos
        case '5':   return 4.0;  // 5 minutos
        case '15':  return 3.0;  // 15 minutos
        case '30':  return 2.5;  // 30 minutos
        case '60':  return 2.0;  // 1 hora: valor original
        case '120': return 2.0;  // 2 horas
        case '240': return 2.0;  // 4 horas
        case 'D':   return 2.0;  // Diario
        default:    return 3.0;  // Valor por defecto
      }
    };

    return {
      enabled: true,

      // Phase 1: Double Top/Bottom Detection
      doubleTopBottom: {
        lookbackCandles: 50,
        candlesPerExtreme: 5,
        priceMarginPercent: 2.0,
        minCandlesBetween: 5,
        maxCandlesBetween: 50,

        rejectionPatterns: {
          requirePatterns: true,  // NUEVO: Checkbox maestro para validación de patrones
          hammer: true,
          shootingStar: true,
          bullishEngulfing: true,
          bearishEngulfing: true
        },

        volumeFilter: {
          enabled: false,
          zScoreThreshold: 1.5,
          zScorePeriod: 20
        },

        // High-volume extreme filter (reject extremes with low volume)
        requireHighVolumeAtExtremes: {
          enabled: false,
          zScoreThresholdFirst: 1.5,   // First extreme usually has higher volume (strong initial move)
          zScoreThresholdSecond: 0.5,  // Second extreme usually has lower volume (weakness/divergence)
          zScorePeriod: 20,            // Period for z-score calculation
          volumeWindowCandles: 3       // ⭐ NUEVO: Buscar volumen alto en ±N velas alrededor del extremo
        },

        maxBreakoutPercent: getMaxBreakoutByInterval()  // Ajustado dinámicamente según timeframe
      },

      // Phase 2: Momentum Confirmation
      momentumConfirmation: {
        enabled: false,

        patterns: {
          marubozu: {
            enabled: true,
            minBodyRatio: 0.8
          },
          soldiers_crows: {
            enabled: true,
            minBodyRatio: 0.6
          },
          bigBody: {
            enabled: true,
            minBodyRatio: 0.7,
            allowBigWick: true
          }
        },

        volumeFilter: {
          enabled: false,
          zScoreThreshold: 1.0,
          zScorePeriod: 20
        },

        lookbackAfterPattern: 10,
        requireMomentum: false
      },

      // Filters
      filters: {
        minConfidence: 20,  // Reducido de 60% a 20% para mostrar más patrones
        requireBothRejections: false,  // Deshabilitado para ser menos restrictivo
        minPatternDuration: 3,
        maxPatternDuration: 72,

        // Post-pattern validation (confirm directional movement)
        applyPostValidationToRealtimeSignals: false,  // Don't wait for confirmation on real-time signals
        postPatternValidationCandles: 5,
        minPostPatternMovePercent: 0.5,
        postPatternConfidenceBonus: 20,

        // Duplicate pattern filtering
        duplicatePriceTolerancePercent: 2.0,
        duplicateTimeToleranceHours: 24
      },

      // ✅ NUEVO: Price Action Validation (invalidación si precio va en contra)
      priceActionValidation: {
        enabled: true,
        // Velas adicionales DESPUÉS de postPatternValidationCandles para verificar invalidación
        barsToCheck: 3,
        // Invalidar si precio rompe el nivel del patrón
        invalidateOnBreak: true
      },

      // Visualization
      visualization: {
        showLines: true,
        showRejectionIcons: true,
        showMomentumIcons: true,
        showEntryArrows: true,

        colors: {
          doubleTopLine: '#FF5722',
          doubleBottomLine: '#4CAF50',
          rejectionIcon: '#FFC107',
          entryLong: '#00E676',
          entryShort: '#FF1744'
        },

        lineStyle: {
          width: 2,
          dash: [10, 5]
        }
      },

      debugMode: false,
      alertsEnabled: false,  // Sistema de alertas automáticas

      // Real-time detection (NEW)
      realTimeDetection: {
        enabled: false,  // Usuario debe habilitar manualmente
        lookbackCandles: 100,  // Analizar últimas N velas
        throttleMs: null,  // Auto-calculado según intervalo
        debugMode: false  // Logs extra para debugging
      },

      // Sistema de alertas mejorado
      alertSettings: {
        // Modo de alerta
        mode: 'smart', // 'momentum_required' | 'pattern_complete' | 'smart'

        // Niveles de confianza con cooldowns personalizables
        confidenceLevels: {
          critical: {
            minConfidence: 80,
            cooldownSeconds: 60,
            color: '#F44336'
          },
          high: {
            minConfidence: 60,
            cooldownSeconds: 180,
            color: '#FF9800'
          },
          medium: {
            minConfidence: 40,
            cooldownSeconds: 300,
            color: '#FFC107'
          }
        },

        // Filtro VWAP (opcional)
        vwapFilter: {
          enabled: false,
          deviationTolerance: 0.5, // % de tolerancia
          requiredDeviations: {
            second: true,  // ±2σ
            third: true    // ±3σ
          }
        },

        // Visualización del círculo de detección
        visualization: {
          showDetectionCircle: true,
          detectionCircleColor: '#2196F3',
          detectionCircleSize: 8
        }
      },

      // ✅ NUEVO: Strategy (Entry/SL/TP)
      strategy: {
        enabled: false,
        riskRewardRatio: 2.0,
        lineLengthCandles: 5,
        entryColor: '#03A9F4',
        stopLossColor: '#FF1744',
        takeProfitColor: '#00E676',
        showLabels: true,
        includeInAlert: true,
        // Box settings
        showBox: true,
        slBoxColor: '#FF1744',    // Rojo para zona SL-Entry
        tpBoxColor: '#00E676',    // Verde para zona Entry-TP
        boxOpacity: 0.15,
        // SL Swing Detection parameters
        slSwingLeftBars: 3,
        slSwingRightBars: 3,
        slSwingLookback: 50,
        slBufferPercent: 20,
        slMinPercent: 0.5
      }
    };
  }

  updateConfig(config) {
    this.config = config;

    // ✅ Sincronizar this.enabled con config.enabled
    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }

    localStorage.setItem(`double_topbottom_config_${this.symbol}`, JSON.stringify(config));
    // Don't clear patterns immediately - let fetchData() replace them naturally
    log.debug(`[${this.symbol}] 🔄 Double Top/Bottom config updated, patterns will refresh`);
  }

  async fetchData(allCandles = null) {
    log.info(`[${this.symbol}] 🔄 fetchData() LLAMADO - Iniciando carga completa de patrones históricos`);

    // Solo recargar config si no existe o si cambia el timeframe
    if (!this.config || this.lastLoadedInterval !== this.interval) {
      this.config = this.loadConfig();

      // ✅ Si cambió el timeframe, resetear el flag para forzar análisis completo
      if (this.lastLoadedInterval !== this.interval) {
        log.info(`[${this.symbol}] 🔄 Timeframe cambió de ${this.lastLoadedInterval} a ${this.interval} - reseteando análisis completo`);
        this.hasRunFullAnalysis = false;
        this.patterns = [];  // Limpiar patrones del timeframe anterior
      }

      this.lastLoadedInterval = this.interval;
    }

    if (!this.config.enabled) {
      log.info(`[${this.symbol}] ⚠️ fetchData() ABORTADO - config.enabled es FALSE`);
      return;
    }

    // ✅ NUEVA LÓGICA: Usar detectIncrementalPattern() si tenemos velas disponibles
    if (allCandles && allCandles.length > 0) {
      log.info(`[${this.symbol}] ✅ fetchData() tiene ${allCandles.length} velas - usando detectIncrementalPattern() con análisis COMPLETO`);

      this.loading = true;
      const startTime = Date.now();

      try {
        // Limpiar patrones anteriores para empezar fresco
        this.patterns = [];

        // ✅ Usar detectIncrementalPattern con análisis completo (isFullAnalysis = true)
        const newPatterns = await this.detectIncrementalPattern(allCandles, true);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log.info(`[${this.symbol}] ✅ Análisis completo finalizado en ${duration}s - ${newPatterns.length} patrones detectados`);

        if (newPatterns.length > 0) {
          // ✅ Fusionar patrones con isInitialLoad = true para NO marcarlos como nuevos
          this.mergeNewPatterns(newPatterns, true);

          log.info(`[${this.symbol}] 📊 fetchData() completado - ${this.patterns.length} patrones históricos cargados`);

          if (this.patterns.length > 0) {
            log.debug(`[${this.symbol}] First pattern confidence: ${this.patterns[0].confidence}%`);
            log.debug(`[${this.symbol}] Pattern types: ${this.patterns.map(p => p.type).join(', ')}`);
          }
        } else {
          log.info(`[${this.symbol}] ℹ️ No se detectaron patrones históricos`);
        }

        // ✅ Marcar que ya se hizo el análisis completo
        this.hasRunFullAnalysis = true;
        log.info(`[${this.symbol}] ✅ fetchData() completado - análisis completo realizado, futuras detecciones serán incrementales`);

      } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log.error(`[${this.symbol}] ❌ Error en fetchData() después de ${duration}s:`, error);
        this.patterns = [];
        // ⚠️ Si falla, resetear flag para que onCandleClose() pueda hacer análisis completo
        this.hasRunFullAnalysis = false;
      } finally {
        this.loading = false;

        // NO enviar alertas en carga inicial (todos los patrones son históricos)
        // Las alertas solo deben enviarse en detección en tiempo real

        // Pedir permisos de notificación si alertas están habilitadas
        if (this.config.alertsEnabled && !this.notificationPermissionRequested) {
          this.requestNotificationPermission();
        }
      }

    } else {
      // ⚠️ FALLBACK: Si no hay velas disponibles, usar el método antiguo del backend
      log.warn(`[${this.symbol}] ⚠️ fetchData() sin velas disponibles - usando método legacy del backend`);

      this.loading = true;
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const requestPayload = {
          symbol: this.symbol,
          interval: this.interval,
          days: this.days,
          config: this.config
        };

        const response = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const result = await response.json();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (result.success && result.patterns) {
          // Limpiar patrones anteriores
          this.patterns = [];

          // Agregar patrones del backend sin marcar como nuevos
          result.patterns.forEach(pattern => {
            this.patterns.push(pattern);
          });

          log.info(`[${this.symbol}] ✅ fetchData() legacy completado - ${this.patterns.length} patrones cargados en ${duration}s`);

          // ✅ Marcar que ya se hizo la carga desde backend
          this.hasRunFullAnalysis = true;
        } else {
          log.error(`[${this.symbol}] ❌ fetchData() legacy falló:`, result.error);
          this.patterns = [];
          this.hasRunFullAnalysis = false;
        }

      } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log.error(`[${this.symbol}] ❌ Error en fetchData() legacy después de ${duration}s:`, error);
        this.patterns = [];
        this.hasRunFullAnalysis = false;
      } finally {
        this.loading = false;
      }
    }
  }

  /**
   * Genera ID único para un patrón
   *
   * IMPORTANTE: Usamos secondExtreme.price (dato crudo del exchange: candle.high/low)
   * en lugar de levelPrice (calculado) porque levelPrice puede variar ligeramente
   * cuando el backend recibe diferentes cantidades de velas.
   *
   * @see Fix para detección en tiempo real v2.1.0
   */
  getPatternId(pattern) {
    // Preferir secondExtreme.price (dato crudo estable), fallback a levelPrice si no existe
    const price = pattern.secondExtreme?.price ?? pattern.levelPrice;
    const priceStr = typeof price === 'number' ? price.toFixed(2) : '0.00';
    const id = `${pattern.type}_${priceStr}_${pattern.firstExtreme.timestamp}_${pattern.secondExtreme.timestamp}`;

    // Log diagnóstico solo si debugMode está habilitado
    if (this.config?.debugMode) {
      log.trace(`[${this.symbol}] 🔑 Pattern ID: ${id} (price used: ${priceStr}, levelPrice: ${pattern.levelPrice?.toFixed(2)})`);
    }

    return id;
  }

  /**
   * Formatea nombre del patrón para alertas
   */
  formatPatternName(pattern) {
    if (pattern.type === 'DOUBLE_TOP') {
      return 'Double Top (ABRIR SHORT)';
    } else {
      return 'Double Bottom (ABRIR LONG)';
    }
  }

  /**
   * Carga historial de alertas desde localStorage
   */
  loadAlertHistory() {
    try {
      const saved = localStorage.getItem(`dbt_alert_history_${this.symbol}`);
      if (saved) {
        this.alertHistory = JSON.parse(saved);
        log.debug(`[${this.symbol}] Loaded ${this.alertHistory.length} alerts from history`);
      }
    } catch (e) {
      log.error(`[${this.symbol}] Failed to load alert history:`, e);
      this.alertHistory = [];
    }
  }

  /**
   * Guarda historial de alertas en localStorage
   */
  saveAlertHistory() {
    try {
      localStorage.setItem(`dbt_alert_history_${this.symbol}`, JSON.stringify(this.alertHistory));
    } catch (e) {
      log.error(`[${this.symbol}] Failed to save alert history:`, e);
    }
  }

  /**
   * Agrega alerta al historial (max 20)
   */
  addToAlertHistory(alert) {
    this.alertHistory.unshift(alert); // Agregar al inicio
    if (this.alertHistory.length > 20) {
      this.alertHistory = this.alertHistory.slice(0, 20); // Mantener solo últimas 20
    }
    this.saveAlertHistory();
  }

  /**
   * Obtiene historial de alertas
   */
  getAlertHistory() {
    return this.alertHistory;
  }

  /**
   * Limpia historial de alertas
   */
  clearAlertHistory() {
    this.alertHistory = [];
    this.saveAlertHistory();
    log.debug(`[${this.symbol}] Alert history cleared`);
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
      log.debug(`[${this.symbol}] Alert saved to global history (${globalHistory.length} total)`);
    } catch (error) {
      console.error('Error saving to global alert history:', error);
    }
  }

  /**
   * ✅ NUEVO: Carga el timestamp de la última alerta global desde localStorage
   */
  loadLastGlobalAlertTimestamp() {
    const storageKey = `dbt_last_alert_${this.symbol}_${this.interval}`;
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const data = JSON.parse(stored);
        return data.timestamp || 0;
      } catch (e) {
        log.error(`[${this.symbol}] Failed to load lastGlobalAlertTimestamp:`, e);
      }
    }

    return 0;
  }

  /**
   * ✅ NUEVO: Guarda el timestamp de la última alerta global
   */
  saveLastGlobalAlertTimestamp() {
    const storageKey = `dbt_last_alert_${this.symbol}_${this.interval}`;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        timestamp: this.lastGlobalAlertTimestamp
      }));
    } catch (e) {
      log.error(`[${this.symbol}] Failed to save lastGlobalAlertTimestamp:`, e);
    }
  }

  /**
   * ✅ NUEVO: Verifica si el cooldown global está activo
   * @returns {boolean} true si está en cooldown (no se debe enviar alerta)
   */
  isInGlobalCooldown() {
    // Si el cooldown no está habilitado, no hay restricción
    const cooldownEnabled = this.config.alertSettings?.globalCooldown?.enabled;
    if (!cooldownEnabled) {
      log.debug(`[${this.symbol}] ⏳ Cooldown DISABLED in config`);
      return false;
    }

    // ✅ FIX: Siempre leer de localStorage para obtener el valor más reciente
    // (puede haber sido actualizado por otra instancia del indicador)
    const lastAlertTimestamp = this.loadLastGlobalAlertTimestamp();

    const cooldownMinutes = this.config.alertSettings?.globalCooldown?.minutes ?? 30;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    const now = Date.now();
    const timeSinceLastAlert = now - lastAlertTimestamp;

    log.info(`[${this.symbol}] ⏳ Cooldown check: lastAlert=${lastAlertTimestamp}, now=${now}, elapsed=${Math.round(timeSinceLastAlert/1000)}s, required=${cooldownMinutes}min`);

    if (timeSinceLastAlert < cooldownMs) {
      const remainingMs = cooldownMs - timeSinceLastAlert;
      const remainingMin = Math.ceil(remainingMs / 60000);
      log.info(`[${this.symbol}] ⏳ COOLDOWN ACTIVE: ${remainingMin} min remaining`);
      return true;
    }

    log.info(`[${this.symbol}] ⏳ Cooldown expired, can send alert`);
    return false;
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
            // Primero verificar LOSS (SL), ya que en la misma vela podría tocar ambos
            if (low <= sl) {
              alert.outcome = 'LOSS';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              log.info(`[${this.symbol}] 📉 Trade LOSS: ${alert.patternType} - low ${low.toFixed(2)} tocó SL ${sl.toFixed(2)}`);
              break;
            }
            if (high >= tp) {
              alert.outcome = 'WIN';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              log.info(`[${this.symbol}] 📈 Trade WIN: ${alert.patternType} - high ${high.toFixed(2)} alcanzó TP ${tp.toFixed(2)}`);
              break;
            }
          } else if (direction === 'SHORT') {
            // SHORT: SL está arriba del entry, TP está abajo
            if (high >= sl) {
              alert.outcome = 'LOSS';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              log.info(`[${this.symbol}] 📉 Trade LOSS: ${alert.patternType} - high ${high.toFixed(2)} tocó SL ${sl.toFixed(2)}`);
              break;
            }
            if (low <= tp) {
              alert.outcome = 'WIN';
              alert.outcomeTimestamp = getCandleTime(candle);
              updated = true;
              log.info(`[${this.symbol}] 📈 Trade WIN: ${alert.patternType} - low ${low.toFixed(2)} alcanzó TP ${tp.toFixed(2)}`);
              break;
            }
          }
        }

        return alert;
      });

      if (updated) {
        localStorage.setItem(GLOBAL_KEY, JSON.stringify(globalHistory));
        log.debug(`[${this.symbol}] Trade outcomes updated in global history`);
      }
    } catch (error) {
      console.error('Error evaluating trade outcomes:', error);
    }
  }

  /**
   * Determina el nivel de confianza del patrón (critical/high/medium/null)
   */
  getConfidenceLevel(pattern) {
    const levels = this.config.alertSettings.confidenceLevels;

    if (pattern.confidence >= levels.critical.minConfidence) {
      return 'critical';
    } else if (pattern.confidence >= levels.high.minConfidence) {
      return 'high';
    } else if (pattern.confidence >= levels.medium.minConfidence) {
      return 'medium';
    }

    return null; // Confianza muy baja - no alertar
  }

  /**
   * Verifica cooldown por nivel de confianza
   */
  checkCooldown(pattern, level) {
    if (!level) return false;

    const patternId = this.getPatternId(pattern);
    const lastAlertTime = this.alertCooldowns.get(patternId);

    if (!lastAlertTime) return true; // No ha sido alertado

    const cooldownMs = this.config.alertSettings.confidenceLevels[level].cooldownSeconds * 1000;
    const timeSinceLastAlert = Date.now() - lastAlertTime;

    return timeSinceLastAlert >= cooldownMs;
  }

  /**
   * Marca cooldown para un patrón
   */
  markCooldown(pattern) {
    const patternId = this.getPatternId(pattern);
    this.alertCooldowns.set(patternId, Date.now());
  }

  /**
   * Verifica alineación del patrón con desviaciones VWAP
   */
  checkVWAPAlignment(pattern) {
    const vwapFilter = this.config.alertSettings.vwapFilter;
    if (!vwapFilter.enabled) {
      return true; // Filtro deshabilitado - siempre pasa
    }

    // Obtener VWAPIndicator del manager
    if (!this.indicatorManager) {
      log.warn(`[${this.symbol}] IndicatorManager not available for VWAP filter`);
      return true; // No bloquear si manager no está disponible
    }

    const vwapIndicator = this.indicatorManager.getVWAPIndicator();
    if (!vwapIndicator || !vwapIndicator.enabled) {
      log.warn(`[${this.symbol}] VWAP filter enabled but VWAP indicator not active`);
      return true; // No bloquear si VWAP no está disponible
    }

    // ✅ FIX: Obtener desviaciones HISTÓRICAS al timestamp del patrón
    // Esto usa los valores VWAP que existían cuando el patrón se completó, no los actuales
    const patternTimestamp = pattern.secondExtreme?.timestamp;
    const deviations = patternTimestamp
      ? vwapIndicator.getDeviationsAtTimestamp(patternTimestamp)
      : vwapIndicator.getDeviations();

    if (!deviations) {
      log.warn(`[${this.symbol}] VWAP indicator doesn't provide deviations for timestamp ${patternTimestamp}`);
      return true;
    }

    const patternPrice = pattern.levelPrice;
    const direction = pattern.type === 'DOUBLE_BOTTOM' ? 'LONG' : 'SHORT';
    const tolerance = vwapFilter.deviationTolerance / 100;

    // Para LONG: buscar en desviaciones negativas (-2σ, -3σ)
    if (direction === 'LONG') {
      const requireDev2 = vwapFilter.requiredDeviations.second;
      const requireDev3 = vwapFilter.requiredDeviations.third;

      let aligned = false;

      if (requireDev2 && deviations.lower2) {
        const dev2 = deviations.lower2;
        const near2 = Math.abs(patternPrice - dev2) / dev2 <= tolerance;
        if (near2) {
          log.debug(`[${this.symbol}] ✅ VWAP aligned: LONG pattern near -2σ (${dev2.toFixed(2)})`);
          aligned = true;
        }
      }

      if (requireDev3 && deviations.lower3) {
        const dev3 = deviations.lower3;
        const near3 = Math.abs(patternPrice - dev3) / dev3 <= tolerance;
        if (near3) {
          log.debug(`[${this.symbol}] ✅ VWAP aligned: LONG pattern near -3σ (${dev3.toFixed(2)})`);
          aligned = true;
        }
      }

      return aligned;
    }

    // Para SHORT: buscar en desviaciones positivas (+2σ, +3σ)
    if (direction === 'SHORT') {
      const requireDev2 = vwapFilter.requiredDeviations.second;
      const requireDev3 = vwapFilter.requiredDeviations.third;

      let aligned = false;

      if (requireDev2 && deviations.upper2) {
        const dev2 = deviations.upper2;
        const near2 = Math.abs(patternPrice - dev2) / dev2 <= tolerance;
        if (near2) {
          log.debug(`[${this.symbol}] ✅ VWAP aligned: SHORT pattern near +2σ (${dev2.toFixed(2)})`);
          aligned = true;
        }
      }

      if (requireDev3 && deviations.upper3) {
        const dev3 = deviations.upper3;
        const near3 = Math.abs(patternPrice - dev3) / dev3 <= tolerance;
        if (near3) {
          log.debug(`[${this.symbol}] ✅ VWAP aligned: SHORT pattern near +3σ (${dev3.toFixed(2)})`);
          aligned = true;
        }
      }

      return aligned;
    }

    return false;
  }

  /**
   * ✅ NUEVO: Verifica si el price action posterior invalida el patrón
   *
   * Reglas de invalidación:
   * - DOUBLE_BOTTOM (LONG): Invalidado si precio cae por debajo del segundo valle
   * - DOUBLE_TOP (SHORT): Invalidado si precio sube por encima del segundo pico
   *
   * @param {Object} pattern - El patrón a verificar
   * @param {Array} candles - Array de velas
   * @returns {Object} { invalidated: boolean, reason: string }
   */
  checkPatternInvalidation(pattern, candles) {
    const paConfig = this.config.priceActionValidation || {
      enabled: true,
      barsToCheck: 3,
      invalidateOnBreak: true
    };

    // Si la validación está deshabilitada, no invalidar
    if (!paConfig.enabled) {
      return { invalidated: false, reason: null };
    }

    // Necesitamos el timestamp del segundo extremo para encontrar el índice
    const patternTimestamp = pattern.secondExtreme?.timestamp;
    if (!patternTimestamp || !candles || candles.length === 0) {
      return { invalidated: false, reason: null };
    }

    const patternIndex = candles.findIndex(c => c.timestamp === patternTimestamp);
    if (patternIndex === -1) {
      return { invalidated: false, reason: null };
    }

    const barsToCheck = paConfig.barsToCheck || 3;
    const confirmationCandles = this.config.filters?.postPatternValidationCandles || 5;
    const isLong = pattern.type === 'DOUBLE_BOTTOM';

    // Nivel de invalidación: el precio del segundo extremo
    const invalidationLevel = pattern.secondExtreme.price;

    // La validación empieza DESPUÉS de las velas de confirmación del patrón
    const startIndex = confirmationCandles + 1;

    // Verificar las velas de validación
    for (let i = startIndex; i < startIndex + barsToCheck; i++) {
      const nextIndex = patternIndex + i;
      if (nextIndex >= candles.length) break;

      const nextCandle = candles[nextIndex];
      if (!nextCandle || nextCandle.in_progress) continue; // Solo velas cerradas

      if (isLong) {
        // Para DOUBLE_BOTTOM (LONG): el precio NO debe caer por debajo del segundo valle
        if (nextCandle.low < invalidationLevel) {
          return {
            invalidated: true,
            reason: `Price broke below pattern low ($${invalidationLevel.toFixed(2)}) at bar +${i}`
          };
        }
      } else {
        // Para DOUBLE_TOP (SHORT): el precio NO debe subir por encima del segundo pico
        if (nextCandle.high > invalidationLevel) {
          return {
            invalidated: true,
            reason: `Price broke above pattern high ($${invalidationLevel.toFixed(2)}) at bar +${i}`
          };
        }
      }
    }

    return { invalidated: false, reason: null };
  }

  /**
   * Determina si debe enviar alerta para un patrón
   */
  shouldSendAlert(pattern, candles = null) {
    const mode = this.config.alertSettings.mode;

    // Si ya fue invalidado, no enviar alerta
    if (pattern._invalidated) {
      log.debug(`[${this.symbol}] Pattern rejected: Already invalidated`);
      return false;
    }

    // ✅ NUEVO: Verificar que han pasado suficientes velas de confirmación
    // Esto evita alertas en el pico/valle antes de confirmar el patrón
    const confirmationCandles = this.config.filters?.postPatternValidationCandles || 5;
    const barsToCheck = this.config.priceActionValidation?.enabled !== false
      ? (this.config.priceActionValidation?.barsToCheck || 3)
      : 0;
    const totalBarsNeeded = confirmationCandles + barsToCheck;

    const intervalMs = this.getIntervalMs();
    const requiredTimeMs = totalBarsNeeded * intervalMs;
    const patternTimestamp = pattern.secondExtreme?.timestamp || 0;
    const currentTime = Date.now();
    const elapsedMs = currentTime - patternTimestamp;

    if (elapsedMs < requiredTimeMs) {
      const candlesElapsed = Math.floor(elapsedMs / intervalMs);
      log.debug(`[${this.symbol}] ⏳ Pattern waiting for confirmation: ${candlesElapsed}/${confirmationCandles} candles (${Math.round(elapsedMs/1000)}s / ${Math.round(requiredTimeMs/1000)}s)`);
      return false; // Aún no han pasado suficientes velas de confirmación
    }

    // Modo 1: Momentum Required
    if (mode === 'momentum_required') {
      if (!pattern.entrySignal || !pattern.entrySignal.has_momentum) {
        return false;
      }
    }

    // Modo 2: Pattern Complete
    // (Siempre envía si el patrón está completo - sin restricciones adicionales)

    // Modo 3: Smart
    if (mode === 'smart') {
      // Con momentum → solo verifica nivel de confianza
      if (pattern.entrySignal?.has_momentum) {
        const level = this.getConfidenceLevel(pattern);
        if (level === null) {
          log.debug(`[${this.symbol}] Pattern rejected: Confidence too low (${pattern.confidence.toFixed(1)}%)`);
          return false; // Confianza muy baja
        }
      } else {
        // Sin momentum → requiere alta confianza (70%+)
        if (pattern.confidence < 70) {
          log.debug(`[${this.symbol}] Pattern rejected: No momentum and low confidence (${pattern.confidence.toFixed(1)}%)`);
          return false;
        }
      }
    }

    // Validar filtro VWAP (si está activo)
    if (this.config.alertSettings.vwapFilter.enabled) {
      if (!this.checkVWAPAlignment(pattern)) {
        log.debug(`[${this.symbol}] Pattern rejected: VWAP filter not met`);
        return false; // NO envía alerta pero SÍ grafica el patrón
      }
    }

    // Verificar cooldown por nivel
    const level = this.getConfidenceLevel(pattern);
    if (level && !this.checkCooldown(pattern, level)) {
      const cooldownSeconds = this.config.alertSettings.confidenceLevels[level].cooldownSeconds;
      log.debug(`[${this.symbol}] Pattern rejected: Cooldown active (${cooldownSeconds}s for ${level} level)`);
      return false;
    }

    // ✅ NUEVO: Verificar price action validation (si está habilitado y hay velas)
    if (candles && this.config.priceActionValidation?.enabled !== false) {
      const invalidation = this.checkPatternInvalidation(pattern, candles);
      if (invalidation.invalidated) {
        pattern._invalidated = true;
        pattern._invalidationReason = invalidation.reason;
        log.debug(`[${this.symbol}] ❌ Pattern INVALIDATED: ${invalidation.reason}`);
        return false;
      }
    }

    log.info(`[${this.symbol}] ✅ Pattern CONFIRMED after ${totalBarsNeeded} bars (${confirmationCandles} confirmation + ${barsToCheck} validation) - ready for alert`);
    return true;
  }

  /**
   * Verifica patrones confirmados y envía alertas (Sistema Mejorado Multi-Nivel)
   * @param {Array} candles - Array de velas para verificar price action validation
   */
  async checkAndSendAlerts(candles = null) {
    if (!this.config.alertsEnabled) {
      log.debug(`[${this.symbol}] DBT Alerts: DISABLED`);
      return;
    }

    if (!this.patterns || this.patterns.length === 0) {
      log.debug(`[${this.symbol}] DBT Alerts: No patterns detected`);
      return;
    }

    // Primera vez: guardar timestamp de inicio del sistema de alertas
    if (this.alertSystemStartTime === null) {
      this.alertSystemStartTime = Date.now();

      log.debug(`\n${'='.repeat(80)}`);
      log.debug(`📊 [${this.symbol}] DBT ALERT SYSTEM ACTIVATED`);
      log.debug(`${'='.repeat(80)}`);
      log.debug(`Mode: ${this.config.alertSettings.mode.toUpperCase()}`);
      log.debug(`Start time: ${new Date(this.alertSystemStartTime).toLocaleString()}`);
      log.debug(`All patterns before this time will be suppressed`);
      log.debug(`Only NEW patterns detected AFTER this time will trigger alerts`);
      log.debug(`Total patterns in historical data: ${this.patterns.length}`);
      log.debug(`${'='.repeat(80)}\n`);

      return; // Salir en la primera ejecución
    }

    log.debug(`\n${'='.repeat(80)}`);
    log.debug(`🔔 [${this.symbol}] DBT ALERT CHECK - ${new Date().toLocaleString()}`);
    log.debug(`${'='.repeat(80)}`);
    log.debug(`Mode: ${this.config.alertSettings.mode.toUpperCase()}`);
    log.debug(`Total patterns: ${this.patterns.length}`);
    log.debug(`Already alerted: ${this.alertedPatterns.size}`);
    log.debug(`VWAP Filter: ${this.config.alertSettings.vwapFilter.enabled ? 'ENABLED' : 'DISABLED'}`);

    // Obtener solo patrones nuevos que no han sido alertados
    const newPatterns = [];
    const skipReasons = {
      alreadyAlerted: 0,
      failedValidation: 0,
      notNewPattern: 0
    };

    for (const pattern of this.patterns) {
      const patternId = this.getPatternId(pattern);
      const patternTime = pattern.secondExtreme.timestamp;
      const patternDate = new Date(patternTime).toLocaleString();

      // Si ya fue alertado, skip
      if (this.alertedPatterns.has(patternId)) {
        skipReasons.alreadyAlerted++;
        log.debug(`  ⏭️  SKIP: Already alerted - ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate})`);
        continue;
      }

      // ✅ NUEVA LÓGICA: Solo patrones marcados como nuevos en mergeNewPatterns()
      if (!pattern._isNewPattern) {
        skipReasons.notNewPattern++;
        log.debug(`  ⏭️  SKIP: Not a new pattern - ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate})`);
        continue;
      }

      // Validar con nuevo sistema (pasando velas para price action validation)
      if (!this.shouldSendAlert(pattern, candles)) {
        skipReasons.failedValidation++;
        continue;
      }

      // Determinar nivel de confianza
      const level = this.getConfidenceLevel(pattern);
      const levelEmoji = level === 'critical' ? '🔴' : level === 'high' ? '🟠' : '🟡';

      log.debug(`  ✅ NEW: ${levelEmoji} ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate}) - Level: ${level?.toUpperCase() || 'N/A'}`);
      newPatterns.push(pattern);
    }

    log.info(`\nSummary:`);
    log.info(`  📊 Total patterns: ${this.patterns.length}`);
    log.info(`  ✅ NEW to alert: ${newPatterns.length}`);
    log.info(`  ⏭️  Already alerted: ${skipReasons.alreadyAlerted}`);
    log.info(`  ⏭️  Failed validation: ${skipReasons.failedValidation}`);
    log.info(`  ⏭️  Not new patterns: ${skipReasons.notNewPattern}`);

    if (newPatterns.length === 0) {
      log.info(`\n❌ No new patterns to alert`);
      log.info(`${'='.repeat(80)}\n`);
      return;
    }

    // Protección anti-spam: Máximo 5 alertas por ejecución
    const MAX_ALERTS_PER_RUN = 5;
    if (newPatterns.length > MAX_ALERTS_PER_RUN) {
      log.debug(`\n⚠️  Too many patterns (${newPatterns.length}). Limiting to ${MAX_ALERTS_PER_RUN} alerts.`);
    }

    // ✅ NUEVO: Verificar cooldown global antes de enviar
    if (this.isInGlobalCooldown()) {
      log.info(`\n⏳ Skipping alerts due to global cooldown`);
      log.info(`${'='.repeat(80)}\n`);
      return;
    }

    // Enviar alertas
    log.debug(`\n🚨 Sending alerts...`);
    let alertCount = 0;
    let alertsFailed = 0;

    for (const pattern of newPatterns) {
      if (alertCount >= MAX_ALERTS_PER_RUN) {
        log.debug(`\n⚠️  Alert limit reached (${MAX_ALERTS_PER_RUN}). Remaining ${newPatterns.length - alertCount} will be processed next time.`);
        break;
      }

      const patternId = this.getPatternId(pattern);
      const patternDate = new Date(pattern.secondExtreme.timestamp).toLocaleString();
      const level = this.getConfidenceLevel(pattern);
      const levelEmoji = level === 'critical' ? '🔴' : level === 'high' ? '🟠' : '🟡';

      log.debug(`\n  📤 Sending alert ${alertCount + 1}/${Math.min(newPatterns.length, MAX_ALERTS_PER_RUN)}:`);
      log.debug(`     ${levelEmoji} Level: ${level?.toUpperCase() || 'N/A'}`);
      log.debug(`     Pattern: ${this.formatPatternName(pattern)}`);
      log.debug(`     Price: $${pattern.levelPrice.toFixed(2)}`);
      log.debug(`     Confidence: ${pattern.confidence.toFixed(1)}%`);
      log.debug(`     Time: ${patternDate}`);

      // Determinar dirección (con o sin momentum)
      const direction = pattern.entrySignal?.direction
        || (pattern.type === 'DOUBLE_BOTTOM' ? 'LONG' : 'SHORT');
      log.debug(`     Direction: ${direction}`);

      // Enviar alerta
      const vwapAligned = this.config.alertSettings.vwapFilter.enabled
        ? this.checkVWAPAlignment(pattern)
        : null;

      const success = await this.sendPatternAlert(pattern, level);

      if (success) {
        // Marcar como alertado
        this.alertedPatterns.add(patternId);
        pattern._alertSent = true;
        pattern._alertTimestamp = Date.now();
        pattern._isNewPattern = false; // ✅ Limpiar flag para que no se alerte nuevamente
        this.markCooldown(pattern);

        // Agregar al historial
        const strategy = pattern._strategy || {};
        const alertRecord = {
          id: `dbt_alert_${Date.now()}_${this.symbol}`,
          timestamp: Date.now(),
          symbol: this.symbol,
          interval: this.interval,
          indicator: 'DTB',  // ✅ Identificador del indicador
          patternType: pattern.type,
          direction: direction,
          price: pattern.levelPrice,
          confidence: pattern.confidence,
          level: level || 'medium',
          status: 'sent',
          vwapAligned: vwapAligned,
          momentumConfirmed: pattern.entrySignal?.has_momentum || false,
          detectionTimestamp: pattern.secondExtreme.timestamp,
          // ✅ NUEVO: Datos de Strategy
          entry: strategy.entry || null,
          stopLoss: strategy.stopLoss || null,
          takeProfit: strategy.takeProfit || null,
          slPercent: strategy.slPercent || null,
          tpPercent: strategy.tpPercent || null,
          outcome: 'PENDING'  // WIN/LOSS se evalúa con velas posteriores
        };

        this.addToAlertHistory(alertRecord);

        // ✅ NUEVO: También guardar en historial global
        this.saveToGlobalAlertHistory(alertRecord);

        // ✅ NUEVO: Actualizar timestamp de cooldown global
        this.lastGlobalAlertTimestamp = Date.now();
        this.saveLastGlobalAlertTimestamp();
        log.info(`[${this.symbol}] ⏰ Cooldown timestamp updated to ${this.lastGlobalAlertTimestamp}`);

        log.debug(`     ✅ ALERT SENT SUCCESSFULLY`);
        alertCount++;

        // ✅ NUEVO: Si el cooldown global está activo, solo enviar una alerta y luego parar
        if (this.config.alertSettings?.globalCooldown?.enabled) {
          log.info(`     ⏳ Entering global cooldown for ${this.config.alertSettings?.globalCooldown?.minutes ?? 30} minutes`);
          break;
        }
      } else {
        log.debug(`     ❌ ALERT FAILED TO SEND`);

        // Agregar al historial como fallida
        const strategyFailed = pattern._strategy || {};
        const alertRecord = {
          id: `dbt_alert_${Date.now()}_${this.symbol}`,
          timestamp: Date.now(),
          symbol: this.symbol,
          interval: this.interval,
          indicator: 'DTB',
          patternType: pattern.type,
          direction: direction,
          price: pattern.levelPrice,
          confidence: pattern.confidence,
          level: level || 'medium',
          status: 'failed',
          vwapAligned: vwapAligned,
          momentumConfirmed: pattern.entrySignal?.has_momentum || false,
          detectionTimestamp: pattern.secondExtreme.timestamp,
          // Datos de Strategy
          entry: strategyFailed.entry || null,
          stopLoss: strategyFailed.stopLoss || null,
          takeProfit: strategyFailed.takeProfit || null,
          slPercent: strategyFailed.slPercent || null,
          tpPercent: strategyFailed.tpPercent || null,
          outcome: 'PENDING'
        };

        this.addToAlertHistory(alertRecord);
        alertsFailed++;
      }
    }

    log.debug(`\n📊 Alert Results:`);
    log.debug(`  ✅ Sent: ${alertCount}`);
    log.debug(`  ❌ Failed: ${alertsFailed}`);
    log.debug(`  📝 Total alerted (session): ${this.alertedPatterns.size}`);
    log.debug(`  📋 History size: ${this.alertHistory.length}`);
    log.debug(`${'='.repeat(80)}\n`);
  }

  /**
   * Envía patrón al backend usando formato de alertas
   */
  async sendPatternAlert(pattern, level = null) {
    const startTime = Date.now();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚨 [${this.symbol}] SENDING PATTERN ALERT`);
    console.log(`${'='.repeat(80)}`);

    try {
      // Determinar dirección (con o sin momentum)
      const direction = pattern.entrySignal?.direction
        || (pattern.type === 'DOUBLE_BOTTOM' ? 'LONG' : 'SHORT');

      const payload = {
        symbol: this.symbol,
        interval: this.interval,
        pattern: {
          patternType: pattern.type,
          price: pattern.levelPrice,
          confidence: Math.round(pattern.confidence * 10) / 10,
          timestamp: pattern.secondExtreme.timestamp,
          direction: direction,
          level: level, // critical/high/medium
          metadata: {
            firstExtreme: pattern.firstExtreme,
            secondExtreme: pattern.secondExtreme,
            entrySignal: pattern.entrySignal || null,
            priceTolerance: pattern.priceTolerance,
            hasMomentum: pattern.entrySignal?.has_momentum || false,
            alertMode: this.config.alertSettings.mode
          }
        },
        config: {
          filters: this.config.filters,
          alertsEnabled: this.config.alertsEnabled,
          alertSettings: this.config.alertSettings
        }
      };

      console.log(`📤 STEP 1: Building payload`);
      console.log(`   Symbol: ${this.symbol}`);
      console.log(`   Interval: ${this.interval}`);
      console.log(`   Pattern Type: ${pattern.type}`);
      console.log(`   Price: $${pattern.levelPrice.toFixed(2)}`);
      console.log(`   Confidence: ${pattern.confidence.toFixed(1)}%`);
      console.log(`   Direction: ${direction}`);
      console.log(`   Level: ${level || 'N/A'}`);
      console.log(`   Alert Mode: ${this.config.alertSettings.mode}`);
      console.log(`\n📤 STEP 2: Sending HTTP POST request`);
      console.log(`   Endpoint: ${API_BASE_URL}/api/pattern-alert`);
      console.log(`   Full Payload:`, JSON.stringify(payload, null, 2));

      const response = await fetch(`${API_BASE_URL}/api/pattern-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const duration = Date.now() - startTime;

      console.log(`\n📥 STEP 3: Received response (${duration}ms)`);
      console.log(`   HTTP Status: ${response.status} ${response.statusText}`);

      const result = await response.json();
      console.log(`   Response Body:`, JSON.stringify(result, null, 2));

      if (result.success) {
        console.log(`\n✅ STEP 4: Alert sent successfully!`);
        console.log(`   Pattern: ${result.pattern || pattern.type}`);
        console.log(`   Symbol: ${result.symbol || this.symbol}`);
        console.log(`   Price: $${result.price?.toFixed(2) || pattern.levelPrice.toFixed(2)}`);
        console.log(`   Confidence: ${result.confidence || pattern.confidence}%`);
        console.log(`   Total Duration: ${duration}ms`);
        console.log(`${'='.repeat(80)}\n`);

        // Mostrar popup en navegador
        this.showAlertPopup(pattern, level);
        return true;
      } else {
        console.error(`\n❌ STEP 4: Alert REJECTED by backend`);
        console.error(`   Reason: ${result.reason || result.error || 'Unknown'}`);
        if (result.confidence !== undefined && result.required !== undefined) {
          console.error(`   Confidence: ${result.confidence}% (required: ${result.required}%)`);
        }
        console.error(`   Duration: ${duration}ms`);
        console.error(`${'='.repeat(80)}\n`);
        return false;
      }

    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`\n❌ STEP 4: EXCEPTION during alert send`);
      console.error(`   Error Type: ${error.name}`);
      console.error(`   Error Message: ${error.message}`);
      console.error(`   Duration: ${duration}ms`);

      if (error.message.includes('fetch')) {
        console.error(`   Possible Cause: Backend not running or network error`);
        console.error(`   Check: Is backend running on ${API_BASE_URL}?`);
      }

      console.error(`   Stack Trace:`, error.stack);
      console.error(`${'='.repeat(80)}\n`);
      return false;
    }
  }

  /**
   * Envía una alerta de prueba para debugging
   */
  async sendTestAlert() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🧪 [${this.symbol}] SENDING TEST ALERT`);
    console.log(`${'='.repeat(80)}`);

    // Crear un patrón de prueba
    const testPattern = {
      type: 'DOUBLE_BOTTOM',
      levelPrice: 50000.00,
      confidence: 85.5,
      firstExtreme: {
        timestamp: Date.now() - 3600000, // 1 hora atrás
        price: 49980.00,
        index: 100
      },
      secondExtreme: {
        timestamp: Date.now(),
        price: 50020.00,
        index: 150
      },
      entrySignal: {
        has_momentum: true,
        direction: 'LONG',
        timestamp: Date.now(),
        price: 50100.00,
        pattern_type: 'MARUBOZU',
        quality: 0.95
      },
      priceTolerance: 20.00
    };

    console.log(`Test Pattern:`, testPattern);
    console.log(`\nSending to backend...`);

    try {
      const success = await this.sendPatternAlert(testPattern);

      console.log(`\n📊 Test Alert Result:`);
      if (success) {
        console.log(`  ✅ Test alert sent successfully!`);
        console.log(`  - Backend accepted the alert`);
        console.log(`  - Should appear in alert listener (port 5000) if running`);
        console.log(`  - Check browser notifications`);
      } else {
        console.log(`  ❌ Test alert failed to send`);
        console.log(`  - Check console for error details`);
        console.log(`  - Verify backend is running on port 8000`);
        console.log(`  - Check if alert service is running on port 5000`);
      }
      console.log(`${'='.repeat(80)}\n`);

      return success;
    } catch (error) {
      console.error(`  ❌ Test alert error:`, error);
      console.log(`${'='.repeat(80)}\n`);
      return false;
    }
  }

  /**
   * Muestra popup en navegador cuando se envía una alerta
   */
  showAlertPopup(pattern, level = null) {
    const patternName = this.formatPatternName(pattern);
    const priceFormatted = pattern.levelPrice.toFixed(2);
    const confidenceFormatted = Math.round(pattern.confidence);
    const direction = pattern.entrySignal?.direction
      || (pattern.type === 'DOUBLE_BOTTOM' ? 'LONG' : 'SHORT');

    const levelEmoji = level === 'critical' ? '🔴' : level === 'high' ? '🟠' : '🟡';
    const levelText = level ? `${levelEmoji} ${level.toUpperCase()}` : '';

    const title = `🚨 Alert: ${this.symbol} ${levelText}`;
    const body = `${patternName}\nPrice: $${priceFormatted}\nConfidence: ${confidenceFormatted}%\nDirection: ${direction}`;

    // Intentar usar Notification API
    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(title, {
        body: body,
        icon: direction === 'LONG' ? '📈' : '📉',
        badge: '🔔',
        requireInteraction: level === 'critical', // Critical alerts require interaction
        tag: `dbt-alert-${this.symbol}-${Date.now()}`
      });

      // Auto-cerrar después de tiempo variable según nivel
      const closeTime = level === 'critical' ? 10000 : level === 'high' ? 7000 : 5000;
      setTimeout(() => {
        notification.close();
      }, closeTime);

    } else {
      // Fallback: alert nativo
      alert(`${title}\n\n${body}\n\nAlert sent to port 5000 ✅`);
    }

    // Log detallado en consola con color según nivel
    const bgColor = level === 'critical' ? '#ff0000' : level === 'high' ? '#ff9800' : '#ffc107';
    log.debug(`%c[${this.symbol}] 🚨 DBT ALERT SENT ${levelText}`, `background: ${bgColor}; color: white; font-weight: bold; padding: 4px;`);
    log.debug(`Pattern: ${patternName}`);
    log.debug(`Price: $${priceFormatted}`);
    log.debug(`Confidence: ${confidenceFormatted}%`);
    log.debug(`Direction: ${direction}`);
    log.debug(`Level: ${level || 'N/A'}`);
    log.debug(`Endpoint: http://localhost:5000/api/watchlist-alert`);
  }

  /**
   * Pide permisos de notificación del navegador
   */
  requestNotificationPermission() {
    if (this.notificationPermissionRequested) return;
    if (!("Notification" in window)) {
      log.debug(`[${this.symbol}] ⚠️ Browser doesn't support notifications`);
      return;
    }

    if (Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        log.debug(`[${this.symbol}] Notification permission: ${permission}`);
      });
    }

    this.notificationPermissionRequested = true;
  }

  /**
   * Convierte intervalo de cadena a milisegundos
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
   * Fusiona nuevos patrones detectados con los existentes, evitando duplicados
   * MARCA los patrones verdaderamente nuevos con _isNewPattern flag para alertas
   *
   * VALIDACIÓN TEMPORAL: Un patrón solo se considera "nuevo" si:
   * 1. No es carga inicial (isInitialLoad = false)
   * 2. El patrón se completó recientemente (dentro de MAX_NEW_PATTERN_AGE)
   *
   * Esto evita que patrones históricos sean marcados como "nuevos" cuando
   * el algoritmo los re-detecta con parámetros ligeramente diferentes.
   *
   * @param {Array} newPatterns - Patrones detectados
   * @param {boolean} isInitialLoad - Si es true, NO marca patrones como nuevos (son históricos)
   */
  mergeNewPatterns(newPatterns, isInitialLoad = false) {
    if (!newPatterns || newPatterns.length === 0) {
      log.debug(`[${this.symbol}] No hay nuevos patrones para fusionar`);
      return;
    }

    let addedCount = 0;
    let skippedAsHistorical = 0;
    const currentTime = Date.now();

    // ✅ VALIDACIÓN TEMPORAL: Solo patrones completados en las últimas N velas
    // pueden ser considerados "nuevos" para alertas
    // Multiplicador dinámico según timeframe (más grande = más margen)
    const intervalMs = this.getIntervalMs();
    const getAgeMultiplier = () => {
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
    };

    // ✅ FIX: Incluir delay de confirmación en el cálculo de edad máxima
    // El patrón debe esperar postPatternValidationCandles + barsToCheck antes de alertar
    const confirmationCandles = this.config.filters?.postPatternValidationCandles || 5;
    const barsToCheck = this.config.priceActionValidation?.enabled !== false
      ? (this.config.priceActionValidation?.barsToCheck || 3)
      : 0;
    const confirmationDelayMs = (confirmationCandles + barsToCheck) * intervalMs;

    // maxAgeMs incluye tiempo base + delay de confirmación
    const MAX_NEW_PATTERN_AGE_MS = (intervalMs * getAgeMultiplier()) + confirmationDelayMs;

    newPatterns.forEach(newPattern => {
      const newId = this.getPatternId(newPattern);

      // Verificar si ya existe en this.patterns
      const existingPattern = this.patterns.find(p => this.getPatternId(p) === newId);

      if (!existingPattern) {
        // ✅ Agregar patrón
        this.patterns.push(newPattern);
        addedCount++;

        // ✅ FIX: SIEMPRE verificar edad del patrón (incluso en carga inicial)
        // El filtro por alertSystemStartTime se hace en checkAndSendAlerts()
        const patternAge = currentTime - newPattern.secondExtreme.timestamp;
        const isRecentPattern = patternAge <= MAX_NEW_PATTERN_AGE_MS;

        // Formatear timestamp del segundo extremo (cuando se completó el patrón)
        const patternDate = new Date(newPattern.secondExtreme.timestamp);
        const formattedDate = patternDate.toLocaleString('es-CO', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        if (isRecentPattern) {
          // ✅ Patrón reciente - marcar como nuevo para posible alerta
          newPattern._isNewPattern = true;
          newPattern._detectionTime = currentTime;

          if (!isInitialLoad) {
            log.info(`[${this.symbol}] ✅ NUEVO patrón detectado en tiempo real: ${newPattern.type} @ $${newPattern.levelPrice.toFixed(2)} | Completado: ${formattedDate}`);
          } else {
            log.debug(`[${this.symbol}] 📌 Patrón reciente cargado (puede alertar): ${newPattern.type} @ $${newPattern.levelPrice.toFixed(2)} | Completado: ${formattedDate}`);
          }
        } else {
          // ⚠️ Patrón muy viejo - NO marcar como nuevo
          newPattern._isNewPattern = false;
          skippedAsHistorical++;

          const ageMinutes = Math.round(patternAge / 60000);
          log.debug(`[${this.symbol}] ⏭️ Patrón histórico (${ageMinutes}min antiguo), NO es nuevo: ${newPattern.type} @ $${newPattern.levelPrice.toFixed(2)} | Completado: ${formattedDate}`);
        }
      } else {
        log.debug(`[${this.symbol}] ⏭️ Patrón ya existe, saltando: ${newPattern.type} @ $${newPattern.levelPrice.toFixed(2)}`);
      }
    });

    if (isInitialLoad) {
      log.info(`[${this.symbol}] 📊 Carga inicial completa: ${addedCount} patrones históricos cargados, ${this.patterns.length} patrones totales`);
    } else {
      const genuinelyNew = addedCount - skippedAsHistorical;
      log.info(`[${this.symbol}] 📊 Fusión completa: ${addedCount} patrones agregados (${genuinelyNew} NUEVOS, ${skippedAsHistorical} históricos re-detectados), ${this.patterns.length} patrones totales`);
    }
  }

  /**
   * Detecta patrones usando análisis completo o incremental
   * @param {Array} allCandles - Todas las velas disponibles
   * @param {boolean} isFullAnalysis - Si es true, analiza todas las velas (inicial/config). Si false, solo analiza velas recientes (tiempo real)
   */
  async detectIncrementalPattern(allCandles, isFullAnalysis = false) {
    // ✅ Solo verificar realTimeDetection para detección incremental, NO para análisis completo inicial
    if (!isFullAnalysis && !this.config.realTimeDetection?.enabled) {
      log.debug(`[${this.symbol}] Real-time detection deshabilitado (solo afecta detección incremental)`);
      return;
    }

    // ✅ NUEVO: Si pauseDetection está activo y estamos en cooldown, no detectar nuevos patrones
    // IMPORTANTE: Solo pausar si YA tenemos patrones, para no bloquear la detección inicial
    if (!isFullAnalysis &&
        this.patterns.length > 0 &&
        this.config.alertSettings?.globalCooldown?.enabled &&
        this.config.alertSettings?.globalCooldown?.pauseDetection &&
        this.isInGlobalCooldown()) {
      log.debug(`[${this.symbol}] ⏸️ Detection paused during cooldown (keeping ${this.patterns.length} existing patterns)`);
      return [];
    }

    // ✅ OPTIMIZACIÓN: Solo hacer análisis completo en carga inicial o cambios de config
    // Para tiempo real, analizar solo las últimas 300 velas (suficiente para patrones grandes)
    let candlesToSend;
    const realtimeLookback = 300; // Permite detectar patrones grandes sin re-procesar todo el histórico

    if (isFullAnalysis) {
      // ANÁLISIS COMPLETO: Carga inicial, cambio de config, cambio de timeframe
      candlesToSend = allCandles;
      log.info(`[${this.symbol}] 🔍 Análisis COMPLETO: ${candlesToSend.length} velas`);
    } else {
      // TIEMPO REAL: Solo analizar velas recientes
      candlesToSend = allCandles.slice(-realtimeLookback);
      log.info(`[${this.symbol}] 🔍 Detección incremental: ${candlesToSend.length} velas recientes (últimas ${realtimeLookback})`);
    }

    try {
      const startTime = Date.now();
      const requestPayload = {
        symbol: this.symbol,
        interval: this.interval,
        days: this.days,
        config: {
          ...this.config,
          doubleTopBottom: {
            ...this.config.doubleTopBottom
          }
        },
        candles: candlesToSend
      };

      const response = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      const result = await response.json();
      const duration = Date.now() - startTime;

      if (result.success && result.patterns) {
        const analysisType = isFullAnalysis ? 'COMPLETO' : 'incremental';
        log.info(`[${this.symbol}] ✅ Análisis ${analysisType}: ${result.patterns.length} patrones en ${duration}ms`);
        return result.patterns;
      } else {
        log.error(`[${this.symbol}] ❌ Error en detección:`, result.error);
        return [];
      }
    } catch (error) {
      log.error(`[${this.symbol}] ❌ Excepción en detección:`, error);
      return [];
    }
  }

  /**
   * Handler llamado cuando se cierra una vela (WebSocket confirm=true)
   * Incluye throttling para evitar detecciones excesivas
   *
   * ESTRATEGIA:
   * - Primera ejecución: Análisis COMPLETO de todas las velas (carga inicial de patrones históricos)
   * - Ejecuciones posteriores: Análisis INCREMENTAL de últimas 300 velas (detección en tiempo real)
   */
  async onCandleClose(allCandles) {
    if (!this.config.enabled) {
      log.debug(`[${this.symbol}] DBT Indicator deshabilitado`);
      return;
    }

    if (!this.config.realTimeDetection?.enabled) {
      log.debug(`[${this.symbol}] Real-time detection deshabilitado`);
      return;
    }

    const now = Date.now();
    const throttleMs = this.getIntervalMs() * 0.9;

    // Throttling: solo ejecutar si ha pasado suficiente tiempo
    if (this.lastRealtimeCheck && (now - this.lastRealtimeCheck) < throttleMs) {
      const elapsed = now - this.lastRealtimeCheck;
      log.debug(`[${this.symbol}] ⏱️ Throttled: ${elapsed}ms < ${throttleMs}ms (esperando ${throttleMs - elapsed}ms más)`);
      return;
    }

    this.lastRealtimeCheck = now;

    try {
      // ✅ DETECCIÓN INTELIGENTE: Primera vez = análisis completo, posteriores = incremental
      // Usar FLAG explícito en lugar de this.patterns.length para evitar conflictos con fetchData()
      const isFirstDetection = !this.hasRunFullAnalysis;

      if (isFirstDetection) {
        log.info(`[${this.symbol}] 🔄 Primera detección - analizando TODAS las velas para carga inicial (${allCandles.length} velas)`);
      } else {
        log.info(`[${this.symbol}] 🕐 Vela cerrada - detección incremental de patrones DBT...`);
      }

      const newPatterns = await this.detectIncrementalPattern(allCandles, isFirstDetection);

      if (newPatterns.length > 0) {
        if (isFirstDetection) {
          log.info(`[${this.symbol}] 📊 Carga inicial: ${newPatterns.length} patrones históricos detectados`);
        } else {
          log.info(`[${this.symbol}] 📊 ${newPatterns.length} patrones detectados en tiempo real`);
        }

        this.mergeNewPatterns(newPatterns, isFirstDetection);

        // ✅ Marcar que ya se ejecutó el análisis completo
        if (isFirstDetection) {
          this.hasRunFullAnalysis = true;
          log.info(`[${this.symbol}] ✅ Análisis completo inicial finalizado - futuras detecciones serán incrementales`);
        }

        // Enviar alertas solo si NO es la primera detección (evitar alertas de patrones históricos)
        if (!isFirstDetection && this.config.alertsEnabled) {
          log.info(`[${this.symbol}] 🔔 Alertas habilitadas - verificando patrones nuevos...`);
          await this.checkAndSendAlerts(allCandles);
        }

        // Forzar redibujado del chart
        if (this.indicatorManager?.requestRedraw) {
          this.indicatorManager.requestRedraw();
        }
      } else {
        if (isFirstDetection) {
          log.info(`[${this.symbol}] ℹ️ No se detectaron patrones históricos`);
          // Aunque no haya patrones, marcar como ejecutado para evitar repetir análisis completo
          this.hasRunFullAnalysis = true;
        } else {
          log.info(`[${this.symbol}] ℹ️ No se detectaron patrones nuevos`);
        }
      }

      // ✅ Evaluar resultados de trades pendientes (WIN/LOSS)
      this.evaluatePendingTradeOutcomes(allCandles);
    } catch (error) {
      log.error(`[${this.symbol}] ❌ Error en detección en tiempo real:`, error);
    }
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.config.enabled || !this.patterns.length || !priceContext) {
      return;
    }

    const { priceToY, timeToX } = priceContext;

    // Calcular ancho de vela para Strategy lines
    const candleWidth = visibleCandles.length > 0 ? bounds.width / visibleCandles.length : 10;

    // Render each pattern
    this.patterns.forEach(pattern => {
      // ✅ NUEVO: Calcular Strategy si está habilitado y no existe
      if (this.config.strategy?.enabled && !pattern._strategy && allCandles) {
        pattern._strategy = this.calculateStrategyLevels(pattern, allCandles);
      }

      // ✅ NUEVO: Dibujar Strategy lines PRIMERO (fondo)
      if (this.config.strategy?.enabled && pattern._strategy) {
        this.drawStrategyLines(ctx, pattern, allCandles, priceToY, timeToX, candleWidth);
      }

      // Draw level line
      if (this.config.visualization.showLines) {
        this._drawLevelLine(ctx, pattern, bounds, priceToY, timeToX);
      }

      // Draw rejection icons at extremes
      if (this.config.visualization.showRejectionIcons) {
        this._drawRejectionIcons(ctx, pattern, allCandles, priceToY, timeToX);
      }

      // Draw detection circle (NEW)
      if (this.config.alertSettings?.visualization?.showDetectionCircle) {
        this._drawDetectionCircle(ctx, pattern, allCandles, priceToY, timeToX);
      }

      // Draw momentum icon and entry arrow
      if (pattern.entrySignal && pattern.entrySignal.has_momentum) {
        if (this.config.visualization.showMomentumIcons) {
          this._drawMomentumIcon(ctx, pattern, allCandles, priceToY, timeToX);
        }

        if (this.config.visualization.showEntryArrows) {
          this._drawEntryArrow(ctx, pattern, allCandles, priceToY, timeToX);
        }
      }

      // ✅ NUEVO: Dibujar marca de invalidación (X) si el patrón fue invalidado
      if (pattern._invalidated) {
        this._drawInvalidationMark(ctx, pattern, allCandles, priceToY, timeToX);
      }
    });
  }

  /**
   * ✅ NUEVO: Dibuja marca X para patrones invalidados
   */
  _drawInvalidationMark(ctx, pattern, allCandles, priceToY, timeToX) {
    // Calcular posición de la X (en el segundo extremo del patrón)
    const patternTimestamp = pattern.secondExtreme?.timestamp;
    if (!patternTimestamp) return;

    const x = timeToX(patternTimestamp);
    const y = priceToY(pattern.secondExtreme.price);

    // Dibujar una X roja semi-transparente
    ctx.save();

    const size = 12;
    ctx.strokeStyle = '#FF1744';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;

    // Dibujar X
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.stroke();

    // Opcional: círculo alrededor de la X
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(x, y, size + 4, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Dibuja círculo azul en la vela donde se detectó el patrón
   */
  _drawDetectionCircle(ctx, pattern, allCandles, priceToY, timeToX) {
    // El timestamp de detección es el del segundo extremo
    // (es cuando el patrón se confirma)
    const detectionTimestamp = pattern.secondExtreme.timestamp;

    // Encontrar la vela de detección
    const detectionCandle = this._findCandleByTimestamp(allCandles, detectionTimestamp);
    if (!detectionCandle) return;

    const x = timeToX(detectionTimestamp);
    const y = priceToY(detectionCandle.close);

    const color = this.config.alertSettings.visualization.detectionCircleColor || '#2196F3';
    const size = this.config.alertSettings.visualization.detectionCircleSize || 8;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;

    // Dibujar círculo
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Agregar label "D" (Detection)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', x, y);

    ctx.restore();
  }

  _drawLevelLine(ctx, pattern, bounds, priceToY, timeToX) {
    // Dibujar línea conectando los DOS extremos reales (no el promedio)
    const y1 = priceToY(pattern.firstExtreme.price);
    const y2 = priceToY(pattern.secondExtreme.price);

    // Check if line is within visible bounds
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    if (maxY < bounds.y || minY > bounds.y + bounds.height) {
      return;
    }

    const color = pattern.type === 'DOUBLE_TOP'
      ? this.config.visualization.colors.doubleTopLine
      : this.config.visualization.colors.doubleBottomLine;

    const startX = timeToX(pattern.firstExtreme.timestamp);
    const endX = timeToX(pattern.secondExtreme.timestamp);

    // Draw line connecting the two ACTUAL extremes
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = this.config.visualization.lineStyle.width;
    ctx.setLineDash(this.config.visualization.lineStyle.dash);

    ctx.beginPath();
    ctx.moveTo(startX, y1);  // First extreme at its actual price
    ctx.lineTo(endX, y2);    // Second extreme at its actual price
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();

    // Draw pattern label at the first extreme
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    const labelText = pattern.type === 'DOUBLE_TOP' ? 'DT' : 'DB';
    const labelX = startX + 5;
    const labelY = pattern.type === 'DOUBLE_TOP' ? y1 - 5 : y1 + 15;

    ctx.fillText(labelText, labelX, labelY);
    ctx.restore();
  }

  _drawRejectionIcons(ctx, pattern, allCandles, priceToY, timeToX) {
    // Draw icon at first extreme
    const candle1 = this._findCandleByTimestamp(allCandles, pattern.firstExtreme.timestamp);
    if (candle1) {
      const x1 = timeToX(pattern.firstExtreme.timestamp);
      const y1 = priceToY(pattern.firstExtreme.price);
      this._drawIcon(
        ctx,
        x1,
        y1,
        pattern.firstExtreme.rejection_pattern,
        pattern.type === 'DOUBLE_TOP' ? 'above' : 'below'
      );
    }

    // Draw icon at second extreme
    const candle2 = this._findCandleByTimestamp(allCandles, pattern.secondExtreme.timestamp);
    if (candle2) {
      const x2 = timeToX(pattern.secondExtreme.timestamp);
      const y2 = priceToY(pattern.secondExtreme.price);
      this._drawIcon(
        ctx,
        x2,
        y2,
        pattern.secondExtreme.rejection_pattern,
        pattern.type === 'DOUBLE_TOP' ? 'above' : 'below'
      );
    }
  }

  _drawIcon(ctx, x, y, patternType, position) {
    const iconMap = {
      'HAMMER': '🔨',
      'SHOOTING_STAR': '⭐',
      'ENGULFING_BULLISH': '📈',
      'ENGULFING_BEARISH': '📉'
    };

    const icon = iconMap[patternType];
    if (!icon) return;

    ctx.save();
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const offsetY = position === 'above' ? -20 : 20;
    ctx.fillText(icon, x, y + offsetY);

    ctx.restore();
  }

  _drawMomentumIcon(ctx, pattern, allCandles, priceToY, timeToX) {
    if (!pattern.entrySignal) return;

    const candle = this._findCandleByTimestamp(allCandles, pattern.entrySignal.entry_candle_timestamp);
    if (!candle) return;

    const x = timeToX(pattern.entrySignal.entry_candle_timestamp);
    const y = priceToY(candle.high);

    // Icon based on momentum pattern
    let icon = '💥';
    if (pattern.entrySignal.momentum_pattern.includes('MARUBOZU')) {
      icon = '🚀';
    } else if (pattern.entrySignal.momentum_pattern.includes('SOLDIERS') ||
               pattern.entrySignal.momentum_pattern.includes('CROWS')) {
      icon = '🔥';
    }

    ctx.save();
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(icon, x, y - 5);
    ctx.restore();
  }

  _drawEntryArrow(ctx, pattern, allCandles, priceToY, timeToX) {
    if (!pattern.entrySignal) return;

    const candle = this._findCandleByTimestamp(allCandles, pattern.entrySignal.entry_candle_timestamp);
    if (!candle) return;

    const x = timeToX(pattern.entrySignal.entry_candle_timestamp);
    const direction = pattern.entrySignal.direction;

    // Position arrow below low for LONG, above high for SHORT
    const y = direction === 'LONG'
      ? priceToY(candle.low) + 30
      : priceToY(candle.high) - 30;

    const color = direction === 'LONG'
      ? this.config.visualization.colors.entryLong
      : this.config.visualization.colors.entryShort;

    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    // Draw triangle arrow
    const size = 10;
    ctx.beginPath();

    if (direction === 'LONG') {
      // Upward triangle
      ctx.moveTo(x, y - size);
      ctx.lineTo(x - size, y + size);
      ctx.lineTo(x + size, y + size);
    } else {
      // Downward triangle
      ctx.moveTo(x, y + size);
      ctx.lineTo(x - size, y - size);
      ctx.lineTo(x + size, y - size);
    }

    ctx.closePath();
    ctx.fill();

    // Draw label
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = direction === 'LONG' ? 'top' : 'bottom';
    const labelY = direction === 'LONG' ? y + size + 2 : y - size - 2;
    ctx.fillText(direction, x, labelY);

    ctx.restore();
  }

  _findCandleByTimestamp(candles, timestamp) {
    return candles.find(c => c.timestamp === timestamp);
  }

  // =====================================================
  // ✅ STRATEGY FUNCTIONS (Entry / Stop Loss / Take Profit)
  // =====================================================

  /**
   * Calcula niveles de estrategia para un patrón DTB
   * @param {Object} pattern - Patrón DTB detectado
   * @param {Array} candles - Array de velas
   * @returns {Object} {entry, stopLoss, takeProfit, slPercent, tpPercent, direction}
   */
  calculateStrategyLevels(pattern, candles) {
    if (!this.config.strategy?.enabled) return null;

    const strategyConfig = this.config.strategy;
    const isLong = pattern.type === 'DOUBLE_BOTTOM';
    const rrRatio = strategyConfig.riskRewardRatio || 2.0;

    // ✅ FIX: Usar la vela de CONFIRMACIÓN real, no la vela del pico/valle
    // La vela de confirmación es N velas DESPUÉS del segundo extremo
    const confirmationCandlesCount = this.config.filters?.postPatternValidationCandles || 5;

    // Encontrar el índice de la vela del patrón (segundo extremo)
    const patternTimestamp = pattern.secondExtreme?.timestamp;
    const patternIndex = candles.findIndex(c => c.timestamp === patternTimestamp);
    if (patternIndex < 0) return null;

    // Calcular el índice de la vela de confirmación (N velas después del patrón)
    const confirmationIndex = patternIndex + confirmationCandlesCount;

    // Si no hay suficientes velas para la confirmación, usar la última vela disponible
    const actualConfirmationIndex = Math.min(confirmationIndex, candles.length - 1);
    const confirmationCandle = candles[actualConfirmationIndex];

    if (!confirmationCandle) return null;

    // Entry = close de la vela de confirmación REAL (no la del pico/valle)
    const entry = confirmationCandle.close;

    // Parámetros para buscar swing del SL
    const slSwingLeftBars = strategyConfig.slSwingLeftBars || 3;
    const slSwingRightBars = strategyConfig.slSwingRightBars || 3;
    const slSwingLookback = strategyConfig.slSwingLookback || 50;
    const slBufferPercent = strategyConfig.slBufferPercent || 20;

    // Buscar el swing anterior significativo
    let stopLoss;
    let usedFallback = false;

    if (isLong) {
      // Para LONG (Double Bottom): SL debe estar POR DEBAJO del entry
      const swingLow = this.findPreviousSignificantLow(candles, confirmationIndex, slSwingLeftBars, slSwingRightBars, slSwingLookback);

      if (swingLow !== null && swingLow < entry) {
        stopLoss = swingLow;
      } else {
        // Fallback: usar el mínimo del patrón + buffer
        usedFallback = true;
        const patternLow = Math.min(pattern.firstExtreme.price, pattern.secondExtreme.price);
        const distanceToLow = entry - patternLow;
        const buffer = distanceToLow * (slBufferPercent / 100);
        stopLoss = patternLow - buffer;
      }
    } else {
      // Para SHORT (Double Top): SL debe estar POR ENCIMA del entry
      const swingHigh = this.findPreviousSignificantHigh(candles, confirmationIndex, slSwingLeftBars, slSwingRightBars, slSwingLookback);

      if (swingHigh !== null && swingHigh > entry) {
        stopLoss = swingHigh;
      } else {
        // Fallback: usar el máximo del patrón + buffer
        usedFallback = true;
        const patternHigh = Math.max(pattern.firstExtreme.price, pattern.secondExtreme.price);
        const distanceToHigh = patternHigh - entry;
        const buffer = distanceToHigh * (slBufferPercent / 100);
        stopLoss = patternHigh + buffer;
      }
    }

    // Calcular distancia del SL como porcentaje
    let slDistance = Math.abs(entry - stopLoss);
    let slPercent = (slDistance / entry) * 100;

    // Aplicar SL mínimo si está configurado
    const slMinPercent = strategyConfig.slMinPercent || 0.5;
    if (slPercent < slMinPercent) {
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
   * Busca el low significativo anterior
   */
  findPreviousSignificantLow(candles, beforeIndex, leftBars, rightBars, maxLookback = 50) {
    const swingLow = this.findPreviousSwingLow(candles, beforeIndex, leftBars, rightBars);
    if (swingLow !== null) return swingLow;

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
   * Busca el high significativo anterior
   */
  findPreviousSignificantHigh(candles, beforeIndex, leftBars, rightBars, maxLookback = 50) {
    const swingHigh = this.findPreviousSwingHigh(candles, beforeIndex, leftBars, rightBars);
    if (swingHigh !== null) return swingHigh;

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
   * Busca el swing low anterior
   */
  findPreviousSwingLow(candles, beforeIndex, leftBars, rightBars) {
    for (let i = beforeIndex - rightBars - 1; i >= leftBars; i--) {
      if (this.isSwingLow(candles, i, leftBars, rightBars)) {
        return candles[i].low;
      }
    }
    return null;
  }

  /**
   * Busca el swing high anterior
   */
  findPreviousSwingHigh(candles, beforeIndex, leftBars, rightBars) {
    for (let i = beforeIndex - rightBars - 1; i >= leftBars; i--) {
      if (this.isSwingHigh(candles, i, leftBars, rightBars)) {
        return candles[i].high;
      }
    }
    return null;
  }

  /**
   * Verifica si una vela es un swing low
   */
  isSwingLow(candles, index, leftBars, rightBars) {
    if (index < leftBars || index >= candles.length - rightBars) {
      return false;
    }
    const currentLow = candles[index].low;
    for (let i = index - leftBars; i <= index + rightBars; i++) {
      if (i !== index && candles[i].low <= currentLow) {
        return false;
      }
    }
    return true;
  }

  /**
   * Verifica si una vela es un swing high
   */
  isSwingHigh(candles, index, leftBars, rightBars) {
    if (index < leftBars || index >= candles.length - rightBars) {
      return false;
    }
    const currentHigh = candles[index].high;
    for (let i = index - leftBars; i <= index + rightBars; i++) {
      if (i !== index && candles[i].high >= currentHigh) {
        return false;
      }
    }
    return true;
  }

  /**
   * Dibuja las líneas de estrategia
   */
  drawStrategyLines(ctx, pattern, allCandles, priceToY, timeToX, candleWidth) {
    if (!this.config.strategy?.enabled || !pattern._strategy) return;

    const strategy = pattern._strategy;
    const config = this.config.strategy;

    // ✅ FIX: Usar timestamp de la vela de CONFIRMACIÓN para posicionar las líneas
    // Esto representa donde realmente se haría la entrada en tiempo real
    const confirmationTimestamp = strategy.confirmationTimestamp || pattern.secondExtreme?.timestamp;
    if (!confirmationTimestamp) return;

    const confirmationX = timeToX(confirmationTimestamp);
    const lineLength = (config.lineLengthCandles || 5) * candleWidth;

    const startX = confirmationX - lineLength;
    const endX = confirmationX + lineLength;

    const entryY = priceToY(strategy.entry);
    const slY = priceToY(strategy.stopLoss);
    const tpY = priceToY(strategy.takeProfit);

    ctx.save();

    // Dos rectángulos separados (SL-Entry rojo, Entry-TP verde)
    if (config.showBox !== false) {
      const boxOpacity = config.boxOpacity || 0.15;

      // Box 1: Entre SL y Entry (rojo/pérdida)
      const slBoxColor = config.slBoxColor || config.stopLossColor || '#FF1744';
      const slBoxTopY = Math.min(slY, entryY);
      const slBoxBottomY = Math.max(slY, entryY);
      const slBoxHeight = slBoxBottomY - slBoxTopY;

      ctx.fillStyle = this.hexToRgba(slBoxColor, boxOpacity);
      ctx.fillRect(startX, slBoxTopY, endX - startX, slBoxHeight);

      // Box 2: Entre Entry y TP (verde/ganancia)
      const tpBoxColor = config.tpBoxColor || config.takeProfitColor || '#00E676';
      const tpBoxTopY = Math.min(entryY, tpY);
      const tpBoxBottomY = Math.max(entryY, tpY);
      const tpBoxHeight = tpBoxBottomY - tpBoxTopY;

      ctx.fillStyle = this.hexToRgba(tpBoxColor, boxOpacity);
      ctx.fillRect(startX, tpBoxTopY, endX - startX, tpBoxHeight);
    }

    ctx.setLineDash([4, 2]);

    // Línea de Entry
    ctx.beginPath();
    ctx.strokeStyle = config.entryColor || '#03A9F4';
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, entryY);
    ctx.lineTo(endX, entryY);
    ctx.stroke();

    // Línea de Stop Loss
    ctx.beginPath();
    ctx.strokeStyle = config.stopLossColor || '#FF1744';
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, slY);
    ctx.lineTo(endX, slY);
    ctx.stroke();

    // Línea de Take Profit
    ctx.beginPath();
    ctx.strokeStyle = config.takeProfitColor || '#00E676';
    ctx.lineWidth = 1.5;
    ctx.moveTo(startX, tpY);
    ctx.lineTo(endX, tpY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Etiquetas
    if (config.showLabels !== false) {
      ctx.font = 'bold 9px Arial';
      ctx.textAlign = 'left';
      const labelX = endX + 4;

      const dirLabel = strategy.direction || 'ENTRY';

      ctx.fillStyle = config.entryColor || '#03A9F4';
      ctx.fillText(`${dirLabel}: $${strategy.entry.toFixed(2)}`, labelX, entryY + 3);

      ctx.fillStyle = config.stopLossColor || '#FF1744';
      ctx.fillText(`SL ${dirLabel}: $${strategy.stopLoss.toFixed(2)} (${strategy.slPercent}%)`, labelX, slY + 3);

      ctx.fillStyle = config.takeProfitColor || '#00E676';
      ctx.fillText(`TP ${dirLabel}: $${strategy.takeProfit.toFixed(2)} (${strategy.tpPercent}%)`, labelX, tpY + 3);
    }

    ctx.restore();
  }

  /**
   * Convierte hex a rgba
   */
  hexToRgba(hex, alpha) {
    if (!hex || hex.length < 7) return `rgba(0, 0, 0, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Required by IndicatorBase but not used (overlay indicator)
  render(ctx, bounds) {
    // Not used - renderOverlay is used instead
  }
}

export default DoubleTopBottomIndicator;
