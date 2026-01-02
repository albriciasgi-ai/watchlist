// src/components/indicators/DoubleTopBottomIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';

/**
 * Double Top/Bottom Pattern Indicator
 *
 * Detects double top and double bottom patterns with rejection validation
 * and optional momentum confirmation for entry signals.
 */
class DoubleTopBottomIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 90, config = {}) {
    super(symbol, interval, days);
    this.name = "Double Top/Bottom";
    this.patterns = [];

    // 🎯 CRÍTICO: Modo backtesting - deshabilita fetch al backend
    this.backtestingMode = config.backtestingMode || false;

    // 🎯 Flag para rastrear si ya se enviaron velas al backend (optimización)
    this.candlesSentToBackend = false;

    this.config = this.loadConfig();

    // ✅ Sincronizar this.enabled con config.enabled al inicializar
    if (this.config.enabled !== undefined) {
      this.enabled = this.config.enabled;
    }

    this.height = 0; // Overlay on main chart
    this.loading = false;

    // Sistema de alertas (mismo formato que RejectionPatternIndicator)
    this.alertedPatterns = new Set(); // Set de IDs de patrones ya alertados
    this.alertCooldownMs = 5 * 60 * 1000; // 5 minutos de cooldown
    this.notificationPermissionRequested = false;
    this.alertSystemStartTime = null; // Solo alertar patrones detectados después de este timestamp

    console.log(`[${this.symbol}] 🔔 Double Top/Bottom alert system initialized (cooldown: ${this.alertCooldownMs/60000} min)`);
  }

  loadConfig() {
    const saved = localStorage.getItem(`double_topbottom_config_${this.symbol}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(`[${this.symbol}] Failed to load double top/bottom config:`, e);
      }
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
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

        maxBreakoutPercent: 2.0  // Maximum % price can exceed first extreme between peaks (breakout rejection)
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
        minConfidence: 60,
        requireBothRejections: true,
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
      alertsEnabled: false  // Sistema de alertas automáticas
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
    console.log(`[${this.symbol}] 🔄 Double Top/Bottom config updated, patterns will refresh`);
  }

  /**
   * 🎯 NUEVO: Precalcular patrones con velas proporcionadas
   * @param {Array} candles - Array de velas históricas completas
   */
  async precalculateWithCandles(candles) {
    if (!this.config.enabled) {
      console.log(`[${this.symbol}] Double Top/Bottom indicator disabled`);
      return;
    }

    if (!candles || candles.length === 0) {
      console.warn(`[${this.symbol}] No candles provided for DTB precalculation`);
      return;
    }

    this.loading = true;
    const startTime = Date.now();

    try {
      console.log(`[${this.symbol}] 🔍 Precalculating Double Top/Bottom patterns with ${candles.length} candles...`);

      // 🔍 DEBUG: Verificar orden de las velas
      if (candles.length > 0) {
        const firstCandle = candles[0];
        const lastCandle = candles[candles.length - 1];
        const firstDate = new Date(firstCandle.timestamp).toISOString().replace('T', ' ').substring(0, 19);
        const lastDate = new Date(lastCandle.timestamp).toISOString().replace('T', ' ').substring(0, 19);
        console.log(`[${this.symbol}] 🔍 Rango de velas enviadas al backend:`);
        console.log(`  - Primera vela (índice 0): ${firstDate} (${firstCandle.timestamp})`);
        console.log(`  - Última vela (índice ${candles.length - 1}): ${lastDate} (${lastCandle.timestamp})`);
      }

      // 🎯 Timeout de 10 minutos para procesamiento de 3 años de datos (~5 min primera vez)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutos

      // 🎯 OPTIMIZACIÓN: Solo enviar velas la primera vez, luego usar caché del backend
      const payload = {
        symbol: this.symbol,
        interval: this.interval,
        days: this.days,
        config: this.config
      };

      if (!this.candlesSentToBackend) {
        payload.candles = candles;  // Solo primera vez: enviar 11MB
        console.log(`[${this.symbol}] 📤 Enviando ${candles.length} velas al backend (primera vez)`);
      } else {
        console.log(`[${this.symbol}] 📦 Backend usará caché (no enviar velas)`);
      }

      const response = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const result = await response.json();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`[${this.symbol}] 🔍 DEBUG: Respuesta del backend:`, {
        success: result.success,
        hasPatterns: !!result.patterns,
        patternsCount: result.patterns?.length || 0,
        error: result.error
      });

      if (result.success && result.patterns) {
        this.patterns = result.patterns;
        console.log(`[${this.symbol}] ✅ Double Top/Bottom: ${this.patterns.length} patterns precalculated in ${duration}s`);
        console.log(`[${this.symbol}] 🎯 this.patterns ahora tiene ${this.patterns.length} patrones guardados`);

        // 🎯 Marcar que las velas ya están en el caché del backend
        if (!this.candlesSentToBackend) {
          this.candlesSentToBackend = true;
          console.log(`[${this.symbol}] ✅ Velas almacenadas en caché del backend`);
        }

        if (this.config.debugMode) {
          console.log(`[${this.symbol}] Patterns:`, this.patterns);
        }
      } else {
        console.error(`[${this.symbol}] ❌ Double Top/Bottom precalculation failed:`, result.error);
        this.patterns = [];
      }

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      if (error.name === 'AbortError') {
        console.error(`[${this.symbol}] ⏱️ Double Top/Bottom precalculation timeout after ${duration}s`);
      } else {
        console.error(`[${this.symbol}] ❌ Error precalculating Double Top/Bottom patterns after ${duration}s:`, error);
      }
      this.patterns = [];
    } finally {
      this.loading = false;
    }
  }

  async fetchData() {
    if (!this.config.enabled) {
      console.log(`[${this.symbol}] Double Top/Bottom indicator disabled`);
      return;
    }

    // 🎯 En modo backtesting, usar precalculateWithCandles() en su lugar
    if (this.backtestingMode) {
      console.log(`[${this.symbol}] ℹ️  DTB en modo backtesting - use precalculateWithCandles() en su lugar`);
      this.loading = false;
      return;
    }

    this.loading = true;
    const startTime = Date.now();

    try {
      console.log(`[${this.symbol}] 🔍 Fetching Double Top/Bottom patterns...`);

      // Timeout de 30 segundos para evitar bloqueos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol: this.symbol,
          interval: this.interval,
          days: this.days,
          config: this.config
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const result = await response.json();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (result.success && result.patterns) {
        this.patterns = result.patterns;
        console.log(`[${this.symbol}] ✅ Double Top/Bottom: ${this.patterns.length} patterns detected in ${duration}s`);

        if (this.config.debugMode) {
          console.log(`[${this.symbol}] Patterns:`, this.patterns);
        }
      } else {
        console.error(`[${this.symbol}] ❌ Double Top/Bottom detection failed:`, result.error);
        this.patterns = [];
      }

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      if (error.name === 'AbortError') {
        console.error(`[${this.symbol}] ⏱️ Double Top/Bottom detection timeout after ${duration}s`);
      } else {
        console.error(`[${this.symbol}] ❌ Error fetching Double Top/Bottom patterns after ${duration}s:`, error);
      }
      this.patterns = [];
    } finally {
      this.loading = false;

      // Verificar y enviar alertas si están habilitadas
      if (this.config.alertsEnabled && this.patterns.length > 0) {
        this.checkAndSendAlerts().catch(err => {
          console.error(`[${this.symbol}] Error checking alerts:`, err);
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
   * Verifica patrones confirmados y envía alertas
   */
  async checkAndSendAlerts() {
    if (!this.config.alertsEnabled) {
      console.log(`[${this.symbol}] DBT Alerts: DISABLED`);
      return;
    }

    if (!this.patterns || this.patterns.length === 0) {
      console.log(`[${this.symbol}] DBT Alerts: No patterns detected`);
      return;
    }

    // Primera vez: guardar timestamp de inicio del sistema de alertas
    if (this.alertSystemStartTime === null) {
      this.alertSystemStartTime = Date.now();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 [${this.symbol}] DBT ALERT SYSTEM ACTIVATED`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Start time: ${new Date(this.alertSystemStartTime).toLocaleString()}`);
      console.log(`All patterns before this time will be suppressed`);
      console.log(`Only NEW patterns detected AFTER this time will trigger alerts`);
      console.log(`Total patterns in historical data: ${this.patterns.length}`);
      console.log(`${'='.repeat(80)}\n`);

      return; // Salir en la primera ejecución
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔔 [${this.symbol}] DBT ALERT CHECK - ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Total patterns: ${this.patterns.length}`);
    console.log(`Alert system start time: ${new Date(this.alertSystemStartTime).toLocaleString()}`);
    console.log(`Already alerted: ${this.alertedPatterns.size}`);

    // Obtener solo patrones nuevos que no han sido alertados
    const newPatterns = [];
    const skipReasons = {
      alreadyAlerted: 0,
      noMomentum: 0,
      historical: 0
    };

    for (const pattern of this.patterns) {
      const patternId = this.getPatternId(pattern);
      const patternTime = pattern.secondExtreme.timestamp;
      const patternDate = new Date(patternTime).toLocaleString();

      // Si ya fue alertado, skip
      if (this.alertedPatterns.has(patternId)) {
        skipReasons.alreadyAlerted++;
        console.log(`  ⏭️  SKIP: Already alerted - ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate})`);
        continue;
      }

      // Solo patrones con señal de entrada (momentum confirmado)
      if (!pattern.entrySignal || !pattern.entrySignal.has_momentum) {
        skipReasons.noMomentum++;
        console.log(`  ⏭️  SKIP: No momentum - ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate})`);
        continue;
      }

      // Solo patrones detectados después del start time
      if (patternTime < this.alertSystemStartTime) {
        skipReasons.historical++;
        console.log(`  ⏭️  SKIP: Historical - ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate})`);
        continue;
      }

      console.log(`  ✅ NEW: ${pattern.type} at $${pattern.levelPrice.toFixed(2)} (${patternDate}) - Direction: ${pattern.entrySignal.direction}`);
      newPatterns.push(pattern);
    }

    console.log(`\nSummary:`);
    console.log(`  📊 Total patterns: ${this.patterns.length}`);
    console.log(`  ✅ NEW to alert: ${newPatterns.length}`);
    console.log(`  ⏭️  Already alerted: ${skipReasons.alreadyAlerted}`);
    console.log(`  ⏭️  No momentum: ${skipReasons.noMomentum}`);
    console.log(`  ⏭️  Historical: ${skipReasons.historical}`);

    if (newPatterns.length === 0) {
      console.log(`\n❌ No new patterns to alert`);
      console.log(`${'='.repeat(80)}\n`);
      return;
    }

    // Protección anti-spam: Máximo 5 alertas por ejecución
    const MAX_ALERTS_PER_RUN = 5;
    if (newPatterns.length > MAX_ALERTS_PER_RUN) {
      console.log(`\n⚠️  Too many patterns (${newPatterns.length}). Limiting to ${MAX_ALERTS_PER_RUN} alerts.`);
    }

    // Enviar alertas
    console.log(`\n🚨 Sending alerts...`);
    let alertCount = 0;
    let alertsFailed = 0;

    for (const pattern of newPatterns) {
      if (alertCount >= MAX_ALERTS_PER_RUN) {
        console.log(`\n⚠️  Alert limit reached (${MAX_ALERTS_PER_RUN}). Remaining ${newPatterns.length - alertCount} will be processed next time.`);
        break;
      }

      const patternId = this.getPatternId(pattern);
      const patternDate = new Date(pattern.secondExtreme.timestamp).toLocaleString();

      console.log(`\n  📤 Sending alert ${alertCount + 1}/${Math.min(newPatterns.length, MAX_ALERTS_PER_RUN)}:`);
      console.log(`     Pattern: ${this.formatPatternName(pattern)}`);
      console.log(`     Price: $${pattern.levelPrice.toFixed(2)}`);
      console.log(`     Time: ${patternDate}`);
      console.log(`     Direction: ${pattern.entrySignal.direction}`);

      // Enviar alerta
      const success = await this.sendPatternAlert(pattern);

      if (success) {
        // Marcar como alertado
        this.alertedPatterns.add(patternId);
        pattern._alertSent = true;
        pattern._alertTimestamp = Date.now();

        console.log(`     ✅ ALERT SENT SUCCESSFULLY`);
        alertCount++;
      } else {
        console.log(`     ❌ ALERT FAILED TO SEND`);
        alertsFailed++;
      }
    }

    console.log(`\n📊 Alert Results:`);
    console.log(`  ✅ Sent: ${alertCount}`);
    console.log(`  ❌ Failed: ${alertsFailed}`);
    console.log(`  📝 Total alerted (session): ${this.alertedPatterns.size}`);
    console.log(`${'='.repeat(80)}\n`);
  }

  /**
   * Envía patrón al backend usando formato de alertas
   */
  async sendPatternAlert(pattern) {
    try {
      const payload = {
        symbol: this.symbol,
        interval: this.interval,
        pattern: {
          patternType: pattern.type,
          price: pattern.levelPrice,
          confidence: Math.round(pattern.confidence * 10) / 10,
          timestamp: pattern.secondExtreme.timestamp,
          direction: pattern.entrySignal.direction,
          metadata: {
            firstExtreme: pattern.firstExtreme,
            secondExtreme: pattern.secondExtreme,
            entrySignal: pattern.entrySignal,
            priceTolerance: pattern.priceTolerance
          }
        },
        config: {
          filters: this.config.filters,
          alertsEnabled: this.config.alertsEnabled
        }
      };

      console.log(`📤 Sending POST to ${API_BASE_URL}/api/pattern-alert`);
      console.log(`Payload:`, payload);

      const response = await fetch(`${API_BASE_URL}/api/pattern-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log(`📥 Response status: ${response.status} ${response.statusText}`);

      const result = await response.json();
      console.log(`📥 Response body:`, result);

      if (result.success) {
        // Mostrar popup en navegador
        this.showAlertPopup(pattern);
        return true;
      } else {
        console.error(`❌ Alert rejected: ${result.reason || result.error}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ Error sending alert:`, error);
      console.error(`Error stack:`, error.stack);
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
  showAlertPopup(pattern) {
    const patternName = this.formatPatternName(pattern);
    const priceFormatted = pattern.levelPrice.toFixed(2);
    const confidenceFormatted = Math.round(pattern.confidence);
    const direction = pattern.entrySignal.direction;

    const title = `🚨 Alert: ${this.symbol}`;
    const body = `${patternName}\nPrice: $${priceFormatted}\nConfidence: ${confidenceFormatted}%\nDirection: ${direction}`;

    // Intentar usar Notification API
    if ("Notification" in window && Notification.permission === "granted") {
      const notification = new Notification(title, {
        body: body,
        icon: direction === 'LONG' ? '📈' : '📉',
        badge: '🔔',
        requireInteraction: false,
        tag: `dbt-alert-${this.symbol}-${Date.now()}`
      });

      // Auto-cerrar después de 5 segundos
      setTimeout(() => {
        notification.close();
      }, 5000);

    } else {
      // Fallback: alert nativo
      alert(`${title}\n\n${body}\n\nAlert sent to port 5000 ✅`);
    }

    // Log detallado en consola
    console.log(`%c[${this.symbol}] 🚨 DBT ALERT SENT`, 'background: #ff4444; color: white; font-weight: bold; padding: 4px;');
    console.log(`Pattern: ${patternName}`);
    console.log(`Price: $${priceFormatted}`);
    console.log(`Confidence: ${confidenceFormatted}%`);
    console.log(`Direction: ${direction}`);
    console.log(`Endpoint: http://localhost:5000/api/watchlist-alert`);
  }

  /**
   * Pide permisos de notificación del navegador
   */
  requestNotificationPermission() {
    if (this.notificationPermissionRequested) return;
    if (!("Notification" in window)) {
      console.log(`[${this.symbol}] ⚠️ Browser doesn't support notifications`);
      return;
    }

    if (Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        console.log(`[${this.symbol}] Notification permission: ${permission}`);
      });
    }

    this.notificationPermissionRequested = true;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    // 🎯 DEBUG: Log de entrada a renderOverlay
    if (!this._renderLogOnce) {
      console.log(`[${this.symbol}] 🎨 renderOverlay CALLED:`, {
        enabled: this.config.enabled,
        patternsLength: this.patterns.length,
        hasPriceContext: !!priceContext,
        visibleCandlesCount: visibleCandles?.length || 0
      });
      this._renderLogOnce = true;
    }

    if (!this.config.enabled || !this.patterns.length || !priceContext) {
      if (!this._earlyReturnLogged) {
        console.log(`[${this.symbol}] ⚠️ DTB renderOverlay EARLY RETURN:`, {
          enabled: this.config.enabled,
          patternsLength: this.patterns.length,
          hasPriceContext: !!priceContext
        });
        this._earlyReturnLogged = true;
      }
      return;
    }

    const { priceToY, timeToX, minPrice, maxPrice } = priceContext;

    // 🎯 DEBUG: Log del rango de precios visible y patrones
    let patternsInRange = 0;
    let patternsOutOfRange = 0;

    // Render each pattern
    this.patterns.forEach(pattern => {
      // 🎯 FIX: Verificar si el patrón está en el rango de precios visible
      if (pattern.levelPrice < minPrice || pattern.levelPrice > maxPrice) {
        patternsOutOfRange++;
        return; // Patrón fuera del rango visible
      }
      patternsInRange++;
      // Draw level line
      if (this.config.visualization.showLines) {
        this._drawLevelLine(ctx, pattern, bounds, priceToY, timeToX);
      }

      // Draw rejection icons at extremes
      if (this.config.visualization.showRejectionIcons) {
        this._drawRejectionIcons(ctx, pattern, allCandles, priceToY, timeToX);
      }

      // Draw momentum icon and entry arrow (Phase 2)
      if (pattern.entrySignal && pattern.entrySignal.has_momentum) {
        if (this.config.visualization.showMomentumIcons) {
          this._drawMomentumIcon(ctx, pattern, allCandles, priceToY, timeToX);
        }

        if (this.config.visualization.showEntryArrows) {
          this._drawEntryArrow(ctx, pattern, allCandles, priceToY, timeToX);
        }
      }
    });

    // 🎯 DEBUG: Log de resultados
    if (!this._loggedPatternInfo) {
      // Obtener rango de precios de los patrones
      const patternPrices = this.patterns.map(p => p.levelPrice);
      const minPatternPrice = Math.min(...patternPrices);
      const maxPatternPrice = Math.max(...patternPrices);

      // 🔍 NUEVO: Obtener rango de timestamps de patrones
      const patternTimestamps = this.patterns.flatMap(p => [
        p.firstExtreme.timestamp,
        p.secondExtreme.timestamp
      ]);
      const minPatternTimestamp = Math.min(...patternTimestamps);
      const maxPatternTimestamp = Math.max(...patternTimestamps);

      // 🔍 NUEVO: Obtener rango de timestamps de velas visibles
      const visibleTimestamps = visibleCandles.map(c => c.timestamp);
      const minVisibleTimestamp = Math.min(...visibleTimestamps);
      const maxVisibleTimestamp = Math.max(...visibleTimestamps);

      // Convertir timestamps a fechas legibles
      const formatDate = (ts) => new Date(ts).toISOString().replace('T', ' ').substring(0, 19);

      console.log(`[${this.symbol}] 📊 DTB INFO:`);
      console.log(`  - Total patrones: ${this.patterns.length}`);
      console.log(`  - Rango precios patrones: [${minPatternPrice.toFixed(2)} - ${maxPatternPrice.toFixed(2)}]`);
      console.log(`  - Rango precios visible: [${minPrice.toFixed(2)} - ${maxPrice.toFixed(2)}]`);
      console.log(`  - Patrones en rango: ${patternsInRange}, fuera: ${patternsOutOfRange}`);
      console.log(`\n  🔍 DIAGNÓSTICO DE TIMESTAMPS:`);
      console.log(`  - Rango timestamps PATRONES:`);
      console.log(`    Inicio: ${formatDate(minPatternTimestamp)} (${minPatternTimestamp})`);
      console.log(`    Fin:    ${formatDate(maxPatternTimestamp)} (${maxPatternTimestamp})`);
      console.log(`  - Rango timestamps VELAS VISIBLES:`);
      console.log(`    Inicio: ${formatDate(minVisibleTimestamp)} (${minVisibleTimestamp})`);
      console.log(`    Fin:    ${formatDate(maxVisibleTimestamp)} (${maxVisibleTimestamp})`);
      console.log(`  - Total velas visibles: ${visibleCandles.length}`);

      // Muestra los primeros 3 timestamps de patrones
      console.log(`  - Sample primeros 3 patrones (timestamps):`);
      this.patterns.slice(0, 3).forEach((p, i) => {
        console.log(`    ${i}: ${formatDate(p.firstExtreme.timestamp)} - ${formatDate(p.secondExtreme.timestamp)}`);
      });

      if (patternsOutOfRange > 0 && patternsInRange === 0) {
        console.log(`  ⚠️ TODOS los patrones están fuera del rango visible`);
        console.log(`  💡 Haz zoom out o navega al rango [${minPatternPrice.toFixed(2)} - ${maxPatternPrice.toFixed(2)}]`);
      }

      this._loggedPatternInfo = true;
    }
  }

  _drawLevelLine(ctx, pattern, bounds, priceToY, timeToX) {
    const y = priceToY(pattern.levelPrice);

    const color = pattern.type === 'DOUBLE_TOP'
      ? this.config.visualization.colors.doubleTopLine
      : this.config.visualization.colors.doubleBottomLine;

    const startX = timeToX(pattern.firstExtreme.timestamp);
    const endX = timeToX(pattern.secondExtreme.timestamp);

    // 🎯 DEBUG: Verificar coordenadas
    if (startX === null || endX === null) {
      if (!this._loggedNullX) {
        console.log(`[${this.symbol}] DTB: ⚠️ timeToX devolvió null - timestamp1=${pattern.firstExtreme.timestamp}, timestamp2=${pattern.secondExtreme.timestamp}`);
        this._loggedNullX = true; // Solo logear una vez
      }
      return;
    }

    // 🎯 DEBUG: Logear que realmente está dibujando (solo primera vez)
    if (!this._loggedDrawing) {
      console.log(`[${this.symbol}] DTB: ✏️ Dibujando línea: (${startX}, ${y}) → (${endX}, ${y}), color=${color}, lineWidth=${this.config.visualization.lineWidth}`);
      this._loggedDrawing = true;
    }

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
      if (x1 !== null) {  // 🎯 FIX: Verificar si la vela está visible
        const y1 = priceToY(pattern.firstExtreme.price);
        this._drawIcon(
          ctx,
          x1,
          y1,
          pattern.firstExtreme.rejection_pattern,
          pattern.type === 'DOUBLE_TOP' ? 'above' : 'below'
        );
      }
    }

    // Draw icon at second extreme
    const candle2 = this._findCandleByTimestamp(allCandles, pattern.secondExtreme.timestamp);
    if (candle2) {
      const x2 = timeToX(pattern.secondExtreme.timestamp);
      if (x2 !== null) {  // 🎯 FIX: Verificar si la vela está visible
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
    if (x === null) return;  // 🎯 FIX: Verificar si la vela está visible

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
    if (x === null) return;  // 🎯 FIX: Verificar si la vela está visible

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

  getConfig() {
    return this.config;
  }

  async applyConfig(newConfig, candles = null) {
    if (!newConfig) {
      console.warn(`[${this.symbol}] DTB applyConfig called with null config`);
      return;
    }

    console.log(`[${this.symbol}] DTB: Aplicando nueva configuración (velas recibidas: ${candles?.length || 0})`);
    const wasEnabled = this.enabled;
    const hadPatterns = this.patterns.length > 0;

    this.config = { ...this.config, ...newConfig };
    localStorage.setItem(`double_topbottom_config_${this.symbol}`, JSON.stringify(this.config));

    // Sincronizar enabled
    if (this.config.enabled !== undefined) {
      this.enabled = this.config.enabled;
      console.log(`[${this.symbol}] DTB: Indicador ${this.enabled ? 'HABILITADO' : 'DESHABILITADO'}`);
    }

    // 🎯 FIX: En modo backtesting, SIEMPRE precalcular cuando el indicador está habilitado
    // Esto asegura que los cambios de configuración recalculen patrones con todo el histórico
    if (this.backtestingMode && this.enabled) {
      if (candles && candles.length > 0) {
        console.log(`[${this.symbol}] 🔍 DTB habilitado en backtesting - precalculando con ${candles.length} velas...`);
        await this.precalculateWithCandles(candles);
      } else {
        console.warn(`[${this.symbol}] ⚠️ DTB habilitado en backtesting pero no se recibieron velas desde IndicatorManager`);
      }
    } else {
      console.log(`[${this.symbol}] DTB: Configuración aplicada (${this.patterns.length} patrones cargados)`);
    }
  }
}

export default DoubleTopBottomIndicator;
