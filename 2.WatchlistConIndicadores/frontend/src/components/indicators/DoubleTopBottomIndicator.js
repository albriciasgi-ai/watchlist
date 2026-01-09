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

    // Cargar historial desde localStorage
    this.loadAlertHistory();

    log.debug(`[${this.symbol}] 🔔 Double Top/Bottom alert system initialized with multi-level support`);
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

  async fetchData() {
    // Solo recargar config si no existe o si cambia el timeframe
    if (!this.config || this.lastLoadedInterval !== this.interval) {
      this.config = this.loadConfig();
      this.lastLoadedInterval = this.interval;
    }

    if (!this.config.enabled) {
      log.trace(`[${this.symbol}] Double Top/Bottom indicator disabled`);
      return;
    }

    this.loading = true;
    const startTime = Date.now();

    try {
      log.trace(`[${this.symbol}] 🔍 DTB FETCH START ====================================`);
      log.trace(`[${this.symbol}] Interval: ${this.interval}, Days: ${this.days}`);
      log.trace(`[${this.symbol}] Config being sent to backend:`);
      log.trace(`[${this.symbol}]   - maxBreakoutPercent: ${this.config.doubleTopBottom?.maxBreakoutPercent}%`);
      log.trace(`[${this.symbol}]   - minConfidence: ${this.config.filters?.minConfidence}%`);
      log.trace(`[${this.symbol}]   - requireBothRejections: ${this.config.filters?.requireBothRejections}`);
      log.trace(`[${this.symbol}]   - volumeFilter.enabled: ${this.config.doubleTopBottom?.volumeFilter?.enabled}`);
      log.trace(`[${this.symbol}]   - lookbackCandles: ${this.config.doubleTopBottom?.lookbackCandles}`);

      // Timeout de 30 segundos para evitar bloqueos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const requestPayload = {
        symbol: this.symbol,
        interval: this.interval,
        days: this.days,
        config: this.config
      };

      log.debug(`[${this.symbol}] Full request payload:`, JSON.stringify(requestPayload, null, 2));

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

      log.debug(`[${this.symbol}] 📥 DTB RESPONSE ====================================`);
      log.debug(`[${this.symbol}] Success: ${result.success}`);
      log.debug(`[${this.symbol}] Duration: ${duration}s`);
      log.debug(`[${this.symbol}] Patterns received: ${result.patterns ? result.patterns.length : 0}`);

      if (result.debug_info) {
        log.debug(`[${this.symbol}] Debug info from backend:`, result.debug_info);
      }

      if (result.success && result.patterns) {
        this.patterns = result.patterns;
        log.debug(`[${this.symbol}] ✅ Double Top/Bottom: ${this.patterns.length} patterns stored`);

        if (this.patterns.length > 0) {
          log.debug(`[${this.symbol}] First pattern confidence: ${this.patterns[0].confidence}%`);
          log.debug(`[${this.symbol}] Pattern types: ${this.patterns.map(p => p.type).join(', ')}`);
        }

        if (this.config.debugMode || this.patterns.length === 0) {
          log.debug(`[${this.symbol}] All patterns:`, this.patterns);
        }
      } else {
        log.error(`[${this.symbol}] ❌ Double Top/Bottom detection failed:`, result.error);
        if (result.details) {
          log.error(`[${this.symbol}] Error details:`, result.details);
        }
        this.patterns = [];
      }

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      if (error.name === 'AbortError') {
        log.error(`[${this.symbol}] ⏱️ Double Top/Bottom detection timeout after ${duration}s`);
      } else {
        log.error(`[${this.symbol}] ❌ Error fetching Double Top/Bottom patterns after ${duration}s:`, error);
      }
      this.patterns = [];
    } finally {
      this.loading = false;

      // Verificar y enviar alertas si están habilitadas
      if (this.config.alertsEnabled && this.patterns.length > 0) {
        this.checkAndSendAlerts().catch(err => {
          log.error(`[${this.symbol}] Error checking alerts:`, err);
        });
      }

      // Pedir permisos de notificación si alertas están habilitadas
      if (this.config.alertsEnabled && !this.notificationPermissionRequested) {
        this.requestNotificationPermission();
      }
    }
  }

  /**
   * Genera ID único para un patrón
   */
  getPatternId(pattern) {
    return `${pattern.type}_${pattern.levelPrice}_${pattern.firstExtreme.timestamp}_${pattern.secondExtreme.timestamp}`;
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

    // Obtener desviaciones
    const deviations = vwapIndicator.getDeviations();
    if (!deviations) {
      log.warn(`[${this.symbol}] VWAP indicator doesn't provide deviations`);
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
   * Determina si debe enviar alerta para un patrón
   */
  shouldSendAlert(pattern) {
    const mode = this.config.alertSettings.mode;

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

    return true;
  }

  /**
   * Verifica patrones confirmados y envía alertas (Sistema Mejorado Multi-Nivel)
   */
  async checkAndSendAlerts() {
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
      historical: 0
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

      // Solo patrones detectados después del start time
      if (patternTime < this.alertSystemStartTime) {
        skipReasons.historical++;
        log.debug(`  ⏭️  SKIP: Historical - ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate})`);
        continue;
      }

      // Validar con nuevo sistema
      if (!this.shouldSendAlert(pattern)) {
        skipReasons.failedValidation++;
        continue;
      }

      // Determinar nivel de confianza
      const level = this.getConfidenceLevel(pattern);
      const levelEmoji = level === 'critical' ? '🔴' : level === 'high' ? '🟠' : '🟡';

      log.debug(`  ✅ NEW: ${levelEmoji} ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate}) - Level: ${level?.toUpperCase() || 'N/A'}`);
      newPatterns.push(pattern);
    }

    log.debug(`\nSummary:`);
    log.debug(`  📊 Total patterns: ${this.patterns.length}`);
    log.debug(`  ✅ NEW to alert: ${newPatterns.length}`);
    log.debug(`  ⏭️  Already alerted: ${skipReasons.alreadyAlerted}`);
    log.debug(`  ⏭️  Failed validation: ${skipReasons.failedValidation}`);
    log.debug(`  ⏭️  Historical: ${skipReasons.historical}`);

    if (newPatterns.length === 0) {
      log.debug(`\n❌ No new patterns to alert`);
      log.debug(`${'='.repeat(80)}\n`);
      return;
    }

    // Protección anti-spam: Máximo 5 alertas por ejecución
    const MAX_ALERTS_PER_RUN = 5;
    if (newPatterns.length > MAX_ALERTS_PER_RUN) {
      log.debug(`\n⚠️  Too many patterns (${newPatterns.length}). Limiting to ${MAX_ALERTS_PER_RUN} alerts.`);
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
        this.markCooldown(pattern);

        // Agregar al historial
        const alertRecord = {
          id: `dbt_alert_${Date.now()}_${this.symbol}`,
          timestamp: Date.now(),
          symbol: this.symbol,
          interval: this.interval,
          patternType: pattern.type,
          direction: direction,
          price: pattern.levelPrice,
          confidence: pattern.confidence,
          level: level || 'medium',
          status: 'sent',
          vwapAligned: vwapAligned,
          momentumConfirmed: pattern.entrySignal?.has_momentum || false,
          detectionTimestamp: pattern.secondExtreme.timestamp
        };

        this.addToAlertHistory(alertRecord);

        log.debug(`     ✅ ALERT SENT SUCCESSFULLY`);
        alertCount++;
      } else {
        log.debug(`     ❌ ALERT FAILED TO SEND`);

        // Agregar al historial como fallida
        const alertRecord = {
          id: `dbt_alert_${Date.now()}_${this.symbol}`,
          timestamp: Date.now(),
          symbol: this.symbol,
          interval: this.interval,
          patternType: pattern.type,
          direction: direction,
          price: pattern.levelPrice,
          confidence: pattern.confidence,
          level: level || 'medium',
          status: 'failed',
          vwapAligned: vwapAligned,
          momentumConfirmed: pattern.entrySignal?.has_momentum || false,
          detectionTimestamp: pattern.secondExtreme.timestamp
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

      log.debug(`📤 Sending POST to ${API_BASE_URL}/api/pattern-alert`);
      log.debug(`Payload:`, payload);

      const response = await fetch(`${API_BASE_URL}/api/pattern-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      log.debug(`📥 Response status: ${response.status} ${response.statusText}`);

      const result = await response.json();
      log.debug(`📥 Response body:`, result);

      if (result.success) {
        // Mostrar popup en navegador
        this.showAlertPopup(pattern, level);
        return true;
      } else {
        log.error(`❌ Alert rejected: ${result.reason || result.error}`);
        return false;
      }

    } catch (error) {
      log.error(`❌ Error sending alert:`, error);
      log.error(`Error stack:`, error.stack);
      return false;
    }
  }

  /**
   * Envía una alerta de prueba para debugging
   */
  async sendTestAlert() {
    log.debug(`\n${'='.repeat(80)}`);
    log.debug(`🧪 [${this.symbol}] SENDING TEST ALERT`);
    log.debug(`${'='.repeat(80)}`);

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

    log.debug(`Test Pattern:`, testPattern);
    log.debug(`\nSending to backend...`);

    try {
      const success = await this.sendPatternAlert(testPattern);

      log.debug(`\n📊 Test Alert Result:`);
      if (success) {
        log.debug(`  ✅ Test alert sent successfully!`);
        log.debug(`  - Backend accepted the alert`);
        log.debug(`  - Should appear in alert listener (port 5000) if running`);
        log.debug(`  - Check browser notifications`);
      } else {
        log.debug(`  ❌ Test alert failed to send`);
        log.debug(`  - Check console for error details`);
        log.debug(`  - Verify backend is running on port 8000`);
        log.debug(`  - Check if alert service is running on port 5000`);
      }
      log.debug(`${'='.repeat(80)}\n`);

      return success;
    } catch (error) {
      log.error(`  ❌ Test alert error:`, error);
      log.debug(`${'='.repeat(80)}\n`);
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

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.config.enabled || !this.patterns.length || !priceContext) {
      return;
    }

    const { priceToY, timeToX } = priceContext;

    // Render each pattern
    this.patterns.forEach(pattern => {
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
    });
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
    const y = priceToY(pattern.levelPrice);

    // Check if line is within visible bounds
    if (y < bounds.y || y > bounds.y + bounds.height) {
      return;
    }

    const color = pattern.type === 'DOUBLE_TOP'
      ? this.config.visualization.colors.doubleTopLine
      : this.config.visualization.colors.doubleBottomLine;

    const startX = timeToX(pattern.firstExtreme.timestamp);
    const endX = timeToX(pattern.secondExtreme.timestamp);

    // Draw line ONLY BETWEEN the two extremes (no extension to the right)
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = this.config.visualization.lineStyle.width;
    ctx.setLineDash(this.config.visualization.lineStyle.dash);

    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.restore();

    // Draw pattern label
    ctx.save();
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    const labelText = pattern.type === 'DOUBLE_TOP' ? 'DT' : 'DB';
    const labelX = startX + 5;
    const labelY = pattern.type === 'DOUBLE_TOP' ? y - 5 : y + 15;

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

  // Required by IndicatorBase but not used (overlay indicator)
  render(ctx, bounds) {
    // Not used - renderOverlay is used instead
  }
}

export default DoubleTopBottomIndicator;
