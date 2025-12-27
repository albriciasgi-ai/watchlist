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
  constructor(symbol, interval, days = 90) {
    super(symbol, interval, days);
    this.name = "Double Top/Bottom";
    this.patterns = [];
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

  async fetchData() {
    if (!this.config.enabled) {
      console.log(`[${this.symbol}] Double Top/Bottom indicator disabled`);
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
    if (!this.config.alertsEnabled) return;
    if (!this.patterns || this.patterns.length === 0) return;

    // Primera vez: guardar timestamp de inicio del sistema de alertas
    if (this.alertSystemStartTime === null) {
      this.alertSystemStartTime = Date.now();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 [${this.symbol}] DBT ALERT SYSTEM ACTIVATED`);
      console.log(`${'='.repeat(80)}`);
      console.log(`Start time: ${new Date(this.alertSystemStartTime).toLocaleString()}`);
      console.log(`All patterns before this time will be suppressed`);
      console.log(`Only NEW patterns detected AFTER this time will trigger alerts`);
      console.log(`${'='.repeat(80)}\n`);

      return; // Salir en la primera ejecución
    }

    // Obtener solo patrones nuevos que no han sido alertados
    const newPatterns = [];

    for (const pattern of this.patterns) {
      const patternId = this.getPatternId(pattern);

      // Si ya fue alertado, skip
      if (this.alertedPatterns.has(patternId)) {
        continue;
      }

      // Solo patrones con señal de entrada (momentum confirmado)
      if (!pattern.entrySignal || !pattern.entrySignal.has_momentum) {
        continue;
      }

      // Solo patrones detectados después del start time
      const patternTime = pattern.secondExtreme.timestamp; // Usar segundo extremo como tiempo del patrón
      if (patternTime < this.alertSystemStartTime) {
        continue;
      }

      newPatterns.push(pattern);
    }

    if (newPatterns.length === 0) return;

    console.log(`\n[${this.symbol}] 🔍 NEW DBT PATTERNS DETECTED:`);
    console.log(`  Alert system start time: ${new Date(this.alertSystemStartTime).toLocaleString()}`);
    console.log(`  ✅ NEW patterns to alert: ${newPatterns.length}`);

    newPatterns.forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.type} at $${p.levelPrice.toFixed(2)} - Direction: ${p.entrySignal.direction}`);
    });
    console.log('');

    // Protección anti-spam: Máximo 5 alertas por ejecución
    const MAX_ALERTS_PER_RUN = 5;
    if (newPatterns.length > MAX_ALERTS_PER_RUN) {
      console.log(`⚠️ Too many patterns to alert (${newPatterns.length}). Limiting to ${MAX_ALERTS_PER_RUN}.`);
    }

    // Enviar alertas
    let alertCount = 0;
    for (const pattern of newPatterns) {
      if (alertCount >= MAX_ALERTS_PER_RUN) {
        console.log(`⚠️ Alert limit reached (${MAX_ALERTS_PER_RUN}). Remaining ${newPatterns.length - alertCount} patterns will be processed next time.`);
        break;
      }

      const patternId = this.getPatternId(pattern);

      // Enviar alerta
      const success = await this.sendPatternAlert(pattern);

      if (success) {
        // Marcar como alertado
        this.alertedPatterns.add(patternId);
        pattern._alertSent = true;
        pattern._alertTimestamp = Date.now();

        console.log(`🚨 ALERT SENT: ${this.formatPatternName(pattern)} at $${pattern.levelPrice.toFixed(2)}`);
        alertCount++;
      }
    }
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

      const response = await fetch(`${API_BASE_URL}/api/pattern-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.success) {
        // Mostrar popup en navegador
        this.showAlertPopup(pattern);
        return true;
      } else {
        console.error(`❌ Alert rejected: ${result.reason || result.error}`);
        return false;
      }

    } catch (error) {
      console.error(`❌ Error sending alert: ${error.message}`);
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
