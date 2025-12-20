// src/components/indicators/RejectionPatternIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import LocalPatternDetector from './LocalPatternDetector.js';
import { createLogger } from '../../utils/logger.js';

/**
 * Rejection Pattern Indicator
 *
 * Displays candlestick rejection patterns (Hammer, Shooting Star, Engulfing, etc.)
 * - Mode "Show All": Shows all detected patterns (local detection)
 * - Mode "Validated Only": Shows only patterns validated against reference contexts (backend)
 */
class RejectionPatternIndicator extends IndicatorBase {
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
      DOJI_GRAVESTONE: '#607D8B'
    };
    this.icons = {
      HAMMER: '🔨',
      SHOOTING_STAR: '⭐',
      ENGULFING_BULLISH: '📈',
      ENGULFING_BEARISH: '📉',
      DOJI_DRAGONFLY: '🐉',
      DOJI_GRAVESTONE: '🪦'
    };

    // ✅ NUEVO: Sistema de alertas automáticas
    this.alertedPatterns = new Map(); // patternId → timestamp del envío
    this.alertCooldownMs = 5 * 60 * 1000; // 5 minutos de cooldown
    this.lastPatternCount = 0; // Para detectar patrones nuevos
    this.notificationPermissionRequested = false; // Flag para pedir permiso una sola vez
    this.logger = createLogger(this.symbol); // Logger con contexto del símbolo

    this.logger.alert(`🔔 Alert system initialized (cooldown: ${this.alertCooldownMs/60000} min)`);
  }

  loadConfig() {
    const saved = localStorage.getItem(`rejection_pattern_config_${this.symbol}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load rejection pattern config:', e);
      }
    }
    return this.getDefaultConfig();
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
        required: false  // Cambiado a false por defecto - más patrones visibles
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
        minZScore: 1.0
      },
      filters: {
        minConfidence: 50,             // Reducido de 60 - más permisivo
        requireNearLevel: false,       // Cambiado a false - más patrones visibles
        proximityPercent: 1.0,
        requireVolumeSpike: false
      },
      alertsEnabled: false,
      // Nuevo: Modo debug global
      debugMode: false,                  // Si true, muestra console.log de todos los patrones rechazados
      // NUEVO: Filtro de dirección de señales
      signalDirection: {
        global: 'BOTH'  // 'LONG' | 'SHORT' | 'BOTH'
        // Los overrides por nivel se guardan en cada zona (zone.signalDirection)
      },
      // NUEVO: Zonas manuales de precio
      manualPriceZones: []
    };
  }

  updateConfig(config) {
    this.config = config;
    localStorage.setItem(`rejection_pattern_config_${this.symbol}`, JSON.stringify(config));

    // ✅ FIX BUG 1: Limpiar patrones para forzar re-detección en el próximo render
    // Esto asegura que al borrar zonas o cambiar configuración, los patrones se actualicen
    this.localPatterns = [];
    console.log(`[${this.symbol}] 🔄 Config updated - patterns will be re-detected on next render`);
  }

  /**
   * Establece el modo de visualización
   * @param {string} mode - 'all' o 'validated'
   */
  setShowMode(mode) {
    const previousMode = this.showMode;
    this.showMode = mode;
    console.log(`[${this.symbol}] Pattern show mode: ${mode}`);

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
      console.log(`[${this.symbol}] 📊 S/R validation skipped: indicator not enabled`);
      return;
    }

    // Obtener niveles S/R activos
    const activeLevels = [
      ...(srIndicator.supports || []).filter(l => l.status === 'active'),
      ...(srIndicator.resistances || []).filter(l => l.status === 'active')
    ];

    if (activeLevels.length === 0) {
      console.log(`[${this.symbol}] 📊 S/R validation skipped: no active levels`);
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

    console.log(`[${this.symbol}] 📊 S/R validation: ${patternsValidated}/${patterns.length} patterns near S/R levels`);
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
      'DOJI_GRAVESTONE': 'Gravestone Doji (ABRIR SHORT)'
    };
    return names[patternType] || patternType;
  }

  /**
   * ✅ NUEVO: Detecta si hay patrones nuevos comparando con detección anterior
   * Retorna solo los patrones que aparecieron en esta iteración
   */
  getNewPatterns() {
    if (this.localPatterns.length === 0) return [];

    // Si es la primera vez, todos son "nuevos" pero no los alertamos (son históricos)
    if (this.lastPatternCount === 0) {
      this.lastPatternCount = this.localPatterns.length;
      console.log(`[${this.symbol}] 📊 Initial pattern count: ${this.lastPatternCount} (not alerting historical patterns)`);
      return [];
    }

    // Si hay más patrones que antes, son nuevos
    if (this.localPatterns.length > this.lastPatternCount) {
      const newPatterns = this.localPatterns.slice(this.lastPatternCount);
      this.lastPatternCount = this.localPatterns.length;

      console.log(`[${this.symbol}] 🆕 Detected ${newPatterns.length} NEW patterns`);
      return newPatterns;
    }

    // Si hay menos o igual, no hay nuevos
    return [];
  }

  /**
   * ✅ NUEVO: Verifica patrones nuevos y envía alertas si aplica
   * Solo procesa patrones que NO han sido alertados previamente
   */
  async checkAndSendAlerts() {
    if (!this.config.alertsEnabled) return;
    if (this.showMode !== 'validated') return; // Solo en modo validated

    const newPatterns = this.getNewPatterns();
    if (newPatterns.length === 0) return;

    const minConfidence = this.config.filters?.minConfidence || 60;
    const now = Date.now();

    for (const pattern of newPatterns) {
      // Filtro 1: Confidence mínimo
      if (pattern.confidence < minConfidence) {
        console.log(`[${this.symbol}] ⏭️ Pattern skipped: confidence ${pattern.confidence.toFixed(1)} < ${minConfidence}`);
        continue;
      }

      // Filtro 2: Crear ID único para el patrón
      const patternId = `${pattern.type}_${pattern.timestamp}_${Math.round(pattern.price * 100)}`;

      // Filtro 3: Cooldown - no enviar mismo patrón muy seguido
      const lastAlert = this.alertedPatterns.get(patternId);
      if (lastAlert && (now - lastAlert) < this.alertCooldownMs) {
        const remaining = Math.round((this.alertCooldownMs - (now - lastAlert)) / 60000);
        this.logger.debug(`⏱️ Pattern in cooldown: ${remaining} min remaining`);
        continue;
      }

      // Enviar alerta
      const success = await this.sendPatternAlert(pattern);

      if (success) {
        // Marcar como alertado
        this.alertedPatterns.set(patternId, now);

        // Marcar visualmente
        pattern._alertSent = true;
        pattern._alertTimestamp = now;

        this.logger.alert(`🚨 ALERT SENT: ${this.formatPatternName(pattern.type)} at $${pattern.price.toFixed(2)}`);
      }
    }
  }

  /**
   * ✅ NUEVO: Envía patrón al backend usando formato EXACTO de alertas existentes
   */
  async sendPatternAlert(pattern) {
    try {
      const payload = {
        symbol: this.symbol,
        interval: this.interval,
        pattern: {
          patternType: pattern.type,
          price: pattern.price,
          confidence: Math.round(pattern.confidence * 10) / 10, // 1 decimal
          timestamp: pattern.timestamp,
          direction: pattern.direction,
          nearSRLevel: pattern.nearSRLevel,
          nearLevel: pattern.nearLevel
        },
        config: {
          filters: this.config.filters,
          alertsEnabled: this.config.alertsEnabled
        }
      };

      const response = await fetch(`${API_BASE_URL}/api/pattern-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.success) {
        // ✅ Mostrar popup en navegador
        this.showAlertPopup(pattern);
        return true;
      } else {
        this.logger.error(`❌ Alert rejected: ${result.reason || result.error}`);
        return false;
      }

    } catch (error) {
      this.logger.error(`❌ Error sending alert: ${error.message}`);
      return false;
    }
  }

  /**
   * ✅ NUEVO: Muestra popup en navegador cuando se envía una alerta
   * Usa Notification API si está disponible, sino alert nativo
   */
  showAlertPopup(pattern) {
    const patternName = this.formatPatternName(pattern.type);
    const priceFormatted = pattern.price.toFixed(2);
    const confidenceFormatted = Math.round(pattern.confidence);

    // Preparar mensaje
    const title = `🚨 Alert Sent: ${this.symbol}`;
    const body = `${patternName}\nPrice: $${priceFormatted}\nConfidence: ${confidenceFormatted}%`;

    // Intentar usar Notification API (más elegante)
    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(title, {
        body: body,
        icon: pattern.direction === 'LONG' ? '📈' : '📉',
        badge: '🔔',
        requireInteraction: false,
        tag: `pattern-alert-${this.symbol}` // Agrupa notificaciones del mismo símbolo
      });

      // Auto-cerrar después de 5 segundos
      setTimeout(() => notification.close(), 5000);

    } else {
      // Fallback: alert nativo del navegador
      alert(`${title}\n\n${body}\n\nAlert sent to port 5000 ✅`);
    }

    // Log detallado en consola
    console.log(`%c[${this.symbol}] 🚨 ALERT SENT`, 'background: #ff4444; color: white; font-weight: bold; padding: 4px;');
    console.log(`Pattern: ${patternName}`);
    console.log(`Price: $${priceFormatted}`);
    console.log(`Confidence: ${confidenceFormatted}%`);
    console.log(`Endpoint: http://localhost:5000/api/watchlist-alert`);
  }

  /**
   * ✅ NUEVO: Pide permisos de notificación del navegador
   * Se llama una sola vez cuando se habilitan las alertas
   */
  requestNotificationPermission() {
    if (this.notificationPermissionRequested) return;
    if (!("Notification" in window)) {
      console.log(`[${this.symbol}] ⚠️ Browser doesn't support notifications`);
      return;
    }

    if (Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        console.log(`[${this.symbol}] 🔔 Notification permission:`, permission);
        this.notificationPermissionRequested = true;
      });
    } else {
      this.notificationPermissionRequested = true;
    }
  }

  /**
   * Detecta patrones localmente en las velas dadas
   * @param {Array} candles - Array de velas OHLC
   * @param {Object} indicatorManager - Referencia al IndicatorManager para obtener niveles
   * @param {Array} manualLevels - Array de drawings/horizontal lines (opcional)
   */
  detectLocalPatterns(candles, indicatorManager = null, manualLevels = []) {
    if (!candles || candles.length === 0) {
      this.localPatterns = [];
      return;
    }

    // Obtener precio actual (última vela)
    const currentPrice = candles[candles.length - 1]?.close || null;

    // Configuración de swing detection
    const swingConfig = this.config.swingDetection || {
      enabled: true,
      leftBars: 5,
      rightBars: 5,
      required: true  // Por defecto, requerir swing points
    };

    // Configuración de volume Z-score
    const volumeConfig = this.config.volumeZScore || {
      enabled: false,
      lookbackPeriod: 20,
      minZScore: 1.0
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

    console.log(`[${this.symbol}] 🎯 Detection config:`, {
      showMode: this.showMode,
      detectionMode: detectionMode,
      manualZonesEnabled: this.config.levelSources?.manualPriceZones !== false,
      manualZonesCount: manualZonesToUse.length,
      srEnabled: srEnabled
    });

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

        console.log(`[${this.symbol}] 📊 Zones+S/R validation: ${filtered.length}/${beforeFilter} patterns (${filtered.filter(p => p.nearSRLevel).length} near S/R, ${filtered.filter(p => !p.nearSRLevel).length} in zones only)`);

        detectedPatterns.length = 0;
        detectedPatterns.push(...filtered);

      } else if (srEnabled && !hasManualZones) {
        // CASO 2: Solo S/R activo (sin zonas)
        const beforeFilter = detectedPatterns.length;
        const filtered = detectedPatterns.filter(p => p.nearSRLevel);

        console.log(`[${this.symbol}] 📊 S/R-only validation: ${filtered.length}/${beforeFilter} patterns near S/R levels`);

        detectedPatterns.length = 0;
        detectedPatterns.push(...filtered);
      }
      // CASO 3: Solo zonas (sin S/R) - Ya filtrado por LocalPatternDetector
      // No hacer nada adicional
    }

    // Si no hay IndicatorManager, solo retornar los patrones básicos
    if (!indicatorManager) {
      this.localPatterns = detectedPatterns;
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

    this.localPatterns = detectedPatterns.map(pattern =>
      this.enhancePatternConfidence(
        pattern,
        classifiedLevels.importantHighs,
        classifiedLevels.importantLows,
        proximityPct
      )
    );

    // Filtrar por minConfidence y dirección del nivel
    const minConfidence = this.config.filters?.minConfidence || 0;
    this.localPatterns = this.localPatterns.filter(pattern => {
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

    // console.log(`[${this.symbol}] Local detection: ${this.localPatterns.length} patterns found (${detectedPatterns.length} before filters)`);

    // ✅ NUEVO: Verificar y enviar alertas automáticas (solo en modo validated)
    if (this.showMode === 'validated' && this.config.alertsEnabled) {
      this.checkAndSendAlerts().catch(err => {
        this.logger.error(`Error checking alerts: ${err.message}`);
      });
    }

    // ✅ NUEVO: Pedir permisos de notificación si alertas están habilitadas
    if (this.config.alertsEnabled && !this.notificationPermissionRequested) {
      this.requestNotificationPermission();
    }
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

    console.log(`[${this.symbol}] 📊 Fetching patterns with ${allReferenceContexts.length} reference contexts:`, allReferenceContexts.map(c => c.type));

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
        console.log(`[${this.symbol}] ✅ Loaded ${this.patterns.length} validated rejection patterns`);
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
          console.log(`[${this.symbol}] 🎯 Adding manual zone context:`, {
            name: zone.name,
            range: `${zone.minPrice}-${zone.maxPrice}`,
            signalDirection: zone.signalDirection
          });
          contexts.push(zoneContext);
        }
      });
    }

    console.log(`[${this.symbol}] 🔧 Built ${contexts.length} total contexts (${this.config.referenceContexts?.length || 0} regular + ${contexts.length - (this.config.referenceContexts?.length || 0)} manual zones)`);

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
    }

    // ✅ FIX: Siempre usar patrones locales (ya tienen validación incorporada según el modo)
    const patternsToShow = this.localPatterns;

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

      const x = bounds.x + i * candleWidth + candleWidth / 2;
      const y = priceToY(candle.high) - 20; // Position above the candle

      // Draw pattern marker (diferente visualización según modo)
      const isValidated = this.showMode === 'validated';
      this.drawPatternMarker(ctx, x, y, pattern, isValidated);
    }
  }

  drawPatternMarker(ctx, x, y, pattern, isValidated = false) {
    // Normalizar el tipo de patrón (puede venir como 'type' o 'patternType')
    const patternType = pattern.type || pattern.patternType;

    // Usar confidence si existe, o quality si es detección local
    const score = pattern.confidence || pattern.quality || 50;

    const color = this.colors[patternType] || '#888';

    // Determinar si es patrón alcista o bajista
    const isBullish = patternType === 'HAMMER' ||
                      patternType === 'ENGULFING_BULLISH' ||
                      patternType === 'DOJI_DRAGONFLY';

    // Posicionar el punto: arriba para bajista, abajo para alcista
    const dotY = isBullish ? y + 8 : y - 8;

    // Tamaño del punto basado en score y validación
    const baseRadius = isValidated ? 5 : 4;
    const radius = baseRadius + (score / 100) * 2; // Max radius: 7 or 6

    // Dibujar punto principal
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, dotY, radius, 0, Math.PI * 2);

    // Color más intenso para validados
    const baseAlpha = isValidated ? 0.9 : 0.7;
    const alpha = Math.max(baseAlpha * 0.6, (score / 100) * baseAlpha);
    ctx.fillStyle = this.hexToRgba(color, alpha);
    ctx.fill();

    // Borde del punto
    ctx.strokeStyle = color;
    ctx.lineWidth = isValidated ? 2 : 1;
    if (!isValidated) {
      // Patrón local: borde punteado
      ctx.setLineDash([2, 2]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

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

    // Badge "✓" pequeño para patrones validados
    if (isValidated) {
      ctx.save();
      ctx.font = 'bold 7px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#4CAF50';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.strokeText('✓', x + radius + 2, dotY - radius - 2);
      ctx.fillText('✓', x + radius + 2, dotY - radius - 2);
      ctx.restore();
    }
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

    let tooltip = `${this.formatPatternName(patternType)}\n`;
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

  formatPatternName(patternType) {
    const names = {
      HAMMER: '🔨 Hammer',
      SHOOTING_STAR: '⭐ Shooting Star',
      ENGULFING_BULLISH: '📈 Bullish Engulfing',
      ENGULFING_BEARISH: '📉 Bearish Engulfing',
      DOJI_DRAGONFLY: '🐉 Dragonfly Doji',
      DOJI_GRAVESTONE: '🪦 Gravestone Doji'
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
