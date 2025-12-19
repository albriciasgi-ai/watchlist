// src/components/indicators/RejectionPatternIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import LocalPatternDetector from './LocalPatternDetector.js';

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

    // Refetch patterns with new config
    this.fetchData();
  }

  /**
   * Establece el modo de visualización
   * @param {string} mode - 'all' o 'validated'
   */
  setShowMode(mode) {
    const previousMode = this.showMode;
    this.showMode = mode;
    console.log(`[${this.symbol}] Pattern show mode: ${mode}`);

    // Si cambiamos a modo 'validated', necesitamos cargar los patrones validados del backend
    if (mode === 'validated' && previousMode !== 'validated') {
      console.log(`[${this.symbol}] 🔄 Switching to validated mode - fetching patterns from backend...`);
      this.fetchData();
    }
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
      levelStrength: 0
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

    // Detectar patrones con swing detection y filtro de dirección
    const detectedPatterns = this.localDetector.detectPatterns(candles, {
      patterns: patternsConfig,
      swingDetection: swingConfig,
      volumeZScore: volumeConfig,
      signalDirection: this.config.signalDirection,  // ✅ Pasar objeto completo
      manualPriceZones: this.config.manualPriceZones  // ✅ NUEVO: Pasar zonas manuales
    });

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

    // Detectar patrones localmente si está en modo "all"
    if (this.showMode === 'all' && allCandles && allCandles.length > 0) {
      this.detectLocalPatterns(allCandles, indicatorManager, manualLevels);
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
