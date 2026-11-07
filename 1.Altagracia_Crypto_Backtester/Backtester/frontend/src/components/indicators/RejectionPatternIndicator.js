// src/components/indicators/RejectionPatternIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import LocalPatternDetector from './LocalPatternDetector.js';
import { candleItemId } from './analysisLevels.js';

// Nombre de cada rechazo para una marca elegida
const PATTERN_NAMES = {
  HAMMER: 'Martillo',
  SHOOTING_STAR: 'Estrella fugaz',
  ENGULFING_BULLISH: 'Envolvente alcista',
  ENGULFING_BEARISH: 'Envolvente bajista',
  DOJI_DRAGONFLY: 'Doji libélula',
  DOJI_GRAVESTONE: 'Doji lápida'
};

const MAX_VALIDATED_CANDLES = 1500; // Con más velas en pantalla los puntos no se alcanzan a leer
const MIN_REQUEST_GAP_MS = 400;
const ERROR_WAIT_MS = 5000;

// Posición de la primera vela con timestamp igual o mayor
function lowerBound(candles, timestamp) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Rejection Pattern Indicator
 *
 * Displays candlestick rejection patterns (Hammer, Shooting Star, Engulfing, etc.)
 * - Mode "Show All": Shows all detected patterns (local detection)
 * - Mode "Validated Only": Shows only patterns validated against reference contexts (backend)
 */
class RejectionPatternIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30, backtestingMode = false) {
    super(symbol, interval, days);
    this.name = "Rejection Patterns";
    this.backtestingMode = backtestingMode;
    this.validatedKey = null; // Velas, contextos y filtros de la última petición
    this.validatedRequest = 0; // Una respuesta vieja no reemplaza a una nueva
    this.validatedLoading = false;
    this.validatedNextAt = 0;
    this.validatedTimer = null;
    this.patterns = []; // Validated patterns from backend
    this.localPatterns = []; // All patterns from local detection
    this.config = this.loadConfig();
    this.height = 0; // Overlay on main chart, no separate pane
    this.localDetector = new LocalPatternDetector();
    this.showMode = 'all'; // 'all' or 'validated'
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
        hammer: { enabled: true, minWickRatio: 2.0 },
        shootingStar: { enabled: true, minWickRatio: 2.0 },
        engulfing: { enabled: true },
        doji: { enabled: false }
      },
      referenceContexts: [],
      filters: {
        minConfidence: 60,
        requireNearLevel: true,
        proximityPercent: 1.0,
        requireVolumeSpike: true
      },
      alertsEnabled: false
    };
  }

  updateConfig(config) {
    this.config = config;
    localStorage.setItem(`rejection_pattern_config_${this.symbol}`, JSON.stringify(config));

    // Refetch patterns with new config
    this.validatedKey = null;
    this.fetchData();
  }

  // Contextos activos, con los valores actuales de su perfil si ya está calculado
  _activeContexts() {
    return (this.config.referenceContexts || []).filter(context => context.enabled).map(context => {
      const profile = this.getRangeProfile?.(context.id);
      if (!profile) return context;
      return {
        ...context,
        metadata: {
          ...context.metadata,
          poc: profile.poc?.price ?? context.metadata?.poc,
          vah: profile.valueArea?.vahPrice ?? context.metadata?.vah,
          val: profile.valueArea?.valPrice ?? context.metadata?.val
        }
      };
    });
  }

  /**
   * En backtesting el modo validado analiza las velas de la hora simulada. Pide de nuevo solo si
   * cerró una vela, cambió la vista o cambiaron los contextos o filtros.
   */
  _loadValidated(visibleCandles, priceContext) {
    const contexts = this._activeContexts();
    if (contexts.length === 0) {
      this.patterns = [];
      this.validatedKey = null;
      return;
    }

    const candles = this._closedCandlesToDetect(visibleCandles, null, priceContext).slice(-MAX_VALIDATED_CANDLES);
    if (candles.length < 2) return;

    const key = JSON.stringify([candles[0].timestamp, candles[candles.length - 1].timestamp, contexts, this.config.patterns, this.config.filters]);
    if (key === this.validatedKey || this.validatedLoading) return;

    const wait = this.validatedNextAt - performance.now();
    if (wait > 0) {
      if (!this.validatedTimer) {
        this.validatedTimer = setTimeout(() => {
          this.validatedTimer = null;
          priceContext.requestRedraw?.();
        }, wait);
      }
      return;
    }

    this.validatedKey = key;
    this.validatedLoading = true;
    this.validatedNextAt = performance.now() + MIN_REQUEST_GAP_MS;
    const request = ++this.validatedRequest;

    fetch(`${API_BASE_URL}/api/rejection-patterns/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: this.symbol,
        interval: this.interval,
        config: this.config,
        referenceContexts: contexts,
        candles: candles.map(({ timestamp, open, high, low, close, volume }) => ({ timestamp, open, high, low, close, volume }))
      })
    })
      .then(response => response.json())
      .then(data => {
        if (!data.success) throw new Error(data.error || 'Sin respuesta del detector');
        if (request === this.validatedRequest) this.patterns = data.patterns || [];
      })
      .catch(error => {
        console.error(`[${this.symbol}] Error en patrones validados:`, error);
        this.validatedKey = null;
        this.validatedNextAt = performance.now() + ERROR_WAIT_MS;
      })
      .finally(() => {
        this.validatedLoading = false;
        priceContext.requestRedraw?.();
      });
  }

  /**
   * Establece el modo de visualización
   * @param {string} mode - 'all' o 'validated'
   */
  setShowMode(mode) {
    this.showMode = mode;
    console.log(`[${this.symbol}] Pattern show mode: ${mode}`);
  }

  /**
   * Detecta patrones localmente en las velas dadas
   * @param {Array} candles - Array de velas OHLC
   */
  detectLocalPatterns(candles) {
    if (!candles || candles.length === 0) {
      this.localPatterns = [];
      return;
    }

    this.localPatterns = this.localDetector.detectPatterns(candles, this.config);
    // console.log(`[${this.symbol}] Local detection: ${this.localPatterns.length} patterns found`);
  }

  async fetchData() {
    if (this.backtestingMode) {
      return; // Se pide al dibujar, con las velas de la hora simulada
    }

    if (!this.config.enabled) {
      this.patterns = [];
      return;
    }

    // Check if we have reference contexts
    if (this.config.referenceContexts.length === 0) {
      console.warn(`[${this.symbol}] No reference contexts configured. Patterns disabled.`);
      this.patterns = [];
      return;
    }

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
          referenceContexts: this.config.referenceContexts
        })
      });

      const data = await response.json();

      if (data.success) {
        this.patterns = data.patterns || [];
        console.log(`[${this.symbol}] Loaded ${this.patterns.length} rejection patterns`);
      } else {
        console.error(`[${this.symbol}] Failed to fetch patterns:`, data.error);
        this.patterns = [];
      }
    } catch (error) {
      console.error(`[${this.symbol}] Error fetching rejection patterns:`, error);
      this.patterns = [];
    } finally {
      this.loading = false;
    }
  }

  /**
   * Velas cerradas de la vista, con las anteriores que necesita el Z-Score de volumen.
   * Un patrón describe la forma final de la vela: la vela en formación todavía no la tiene.
   */
  _closedCandlesToDetect(visibleCandles, allCandles, priceContext) {
    const known = priceContext?.knownCandles || allCandles;
    const lookback = (this.config.volumeZScore?.lookbackPeriod || 20) + 1;
    const first = lowerBound(known, visibleCandles[0].timestamp);
    const end = lowerBound(known, visibleCandles[visibleCandles.length - 1].timestamp) + 1;
    return known.slice(Math.max(0, first - lookback), end).filter(candle => !candle.in_progress);
  }

  // Método para overlay (llamado por IndicatorManager)
  /** Rechazos a la vista, para elegirlos como marcas con una nota */
  selectableLevels() {
    return this.marks || [];
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    this.marks = [];
    if (!this.enabled || !this.config.enabled || visibleCandles.length === 0) {
      return;
    }

    // Detectar patrones localmente si está en modo "all"
    if (this.showMode === 'all' && allCandles && allCandles.length > 0) {
      this.detectLocalPatterns(this._closedCandlesToDetect(visibleCandles, allCandles, priceContext));
    }

    if (this.showMode === 'validated' && this.backtestingMode && priceContext?.knownCandles) {
      this._loadValidated(visibleCandles, priceContext);
      if (this._activeContexts().length === 0) {
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#9E9E9E';
        ctx.fillText('Rejection validado: agrega un contexto de referencia', bounds.x + 8, bounds.y + 38);
      }
    }

    // Elegir qué patrones mostrar según el modo
    const patternsToShow = this.showMode === 'all' ? this.localPatterns : this.patterns;

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

      if (!pattern || candle.in_progress) continue;

      const x = bounds.x + i * candleWidth + candleWidth / 2;
      const y = priceToY(candle.high) - 20; // Position above the candle

      // Draw pattern marker (diferente visualización según modo)
      const isValidated = this.showMode === 'validated';
      const drawn = this.drawPatternMarker(ctx, x, y, pattern, isValidated);

      const patternType = pattern.type || pattern.patternType;
      const kind = PATTERN_NAMES[patternType] || 'Rechazo';
      this.marks.push({
        id: candleItemId(this.name, kind, candle.timestamp, null, this.interval), source: this.name, kind, price: drawn.bullish ? candle.low : candle.high,
        time: candle.timestamp, mark: true, x, y: drawn.y, r: Math.max(8, drawn.radius + 3)
      });
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

    return { y: dotY, radius, bullish: isBullish };
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Handle mouse hover to show pattern details
  getTooltipInfo(x, y, bounds, candles, priceToY) {
    if (!this.enabled || !this.config.enabled || this.patterns.length === 0) {
      return null;
    }

    const candleWidth = bounds.width / candles.length;
    const patternMap = new Map();

    for (const pattern of this.patterns) {
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
    return this.patterns.length;
  }

  // Get patterns by type
  getPatternsByType() {
    const byType = {};
    for (const pattern of this.patterns) {
      const type = pattern.patternType;
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
