// src/components/indicators/SwingDetectorIndicator.js
// Swing High/Low Detector for Backtester - Full implementation with zones and filters

import IndicatorBase from './IndicatorBase.js';

/**
 * SwingDetectorIndicator - Detects and displays swing highs/lows locally
 *
 * Full backtesting implementation with:
 * - N-bar pivot detection (swing high/low)
 * - Volume Z-Score filter
 * - VWAP filter (validates price position vs VWAP bands)
 * - Price zones with time-bounds (rectangles)
 * - Direction filter (LONG/SHORT/BOTH)
 * - Playback-aware filtering (avoids survivorship bias)
 */
class SwingDetectorIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30, config = {}) {
    super(symbol, interval, days);
    this.name = "Swing Detector";
    this.signals = [];
    this.height = 0; // Overlay on main chart, no separate pane

    // Detection parameters
    this.swingBars = config.swingBars || 5;
    this.direction = config.direction || 'BOTH'; // LONG, SHORT, BOTH

    // Volume filter
    this.volumeFilter = {
      enabled: config.volumeFilter?.enabled !== false,
      minZScore: config.volumeFilter?.minZScore || 0,
      lookbackBars: config.volumeFilter?.lookbackBars || 20
    };

    // VWAP filter
    this.vwapFilter = {
      enabled: config.vwapFilter?.enabled || false,
      deviations: config.vwapFilter?.deviations || [1, 2, 3],
      marginPercent: config.vwapFilter?.marginPercent || 20,
      skipVolumeInRectangle: config.vwapFilter?.skipVolumeInRectangle || false
    };

    // Price zones (including time-bound rectangles)
    this.priceZones = config.priceZones || [];

    // Reference to VWAP indicator
    this.vwapIndicator = null;

    // Reference to drawing manager for getting rectangles
    this.drawingManager = null;

    // Colors
    this.colors = {
      SWING_LOW: '#00E676',
      SWING_HIGH: '#FF1744',
      ZONE_LONG: 'rgba(76, 175, 80, 0.1)',
      ZONE_SHORT: 'rgba(244, 67, 54, 0.1)',
      ZONE_BOTH: 'rgba(255, 152, 0, 0.1)'
    };

    // Visual config
    this.arrowSize = config.arrowSize || 10;
    this.arrowOffset = config.arrowOffset || 8;
    this.showVolumeZScore = config.showVolumeZScore || false;
    this.showZones = config.showZones !== false;

    // 🎯 CRÍTICO: Tiempo actual del playback (para evitar sesgo de supervivencia)
    this._currentPlaybackTime = null;

    // Cache
    this._lastCalculatedLength = 0;
    this._lastConfig = null;
    this._allDetectedSignals = []; // Todas las señales detectadas (sin filtro de tiempo)

    console.log(`[${this.symbol}] SwingDetectorIndicator initialized (full backtesting mode)`);
  }

  setVWAPIndicator(vwapIndicator) {
    this.vwapIndicator = vwapIndicator;
  }

  setDrawingManager(drawingManager) {
    this.drawingManager = drawingManager;
  }

  /**
   * 🎯 CRÍTICO: Actualiza el tiempo del playback
   * Solo muestra señales que ya existían en este momento temporal
   */
  updatePlaybackTime(timestamp) {
    this._currentPlaybackTime = timestamp;
  }

  async fetchData() {
    return Promise.resolve();
  }

  // ==================== ZONE MANAGEMENT ====================

  addPriceZone(zone) {
    // Validar zona
    if (!zone.id) {
      zone.id = `zone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    zone.symbol = zone.symbol || this.symbol;
    zone.enabled = zone.enabled !== false;

    this.priceZones.push(zone);
    this._invalidateCache();

    console.log(`[${this.symbol}] SwingDetector: Added zone ${zone.id}`, zone);
    return zone.id;
  }

  removePriceZone(zoneId) {
    const idx = this.priceZones.findIndex(z => z.id === zoneId);
    if (idx !== -1) {
      this.priceZones.splice(idx, 1);
      this._invalidateCache();
      console.log(`[${this.symbol}] SwingDetector: Removed zone ${zoneId}`);
      return true;
    }
    return false;
  }

  updatePriceZone(zoneId, updates) {
    const zone = this.priceZones.find(z => z.id === zoneId);
    if (zone) {
      Object.assign(zone, updates);
      this._invalidateCache();
      return true;
    }
    return false;
  }

  getPriceZones() {
    return this.priceZones.filter(z => !z.symbol || z.symbol === this.symbol);
  }

  /**
   * Crea una zona desde un rectángulo del chart
   */
  createZoneFromRectangle(rectangle, direction = 'BOTH', timeBound = true) {
    const zone = {
      id: `zone_rect_${rectangle.id}`,
      symbol: this.symbol,
      min: Math.min(rectangle.startPrice, rectangle.endPrice),
      max: Math.max(rectangle.startPrice, rectangle.endPrice),
      direction: direction,
      enabled: true,
      sourceRectId: rectangle.id,
      label: rectangle.label || 'Zone',
      timeBound: timeBound
    };

    if (timeBound) {
      zone.timeStart = Math.min(rectangle.startTime, rectangle.endTime);
      zone.timeEnd = Math.max(rectangle.startTime, rectangle.endTime);
    }

    return this.addPriceZone(zone);
  }

  _invalidateCache() {
    this._lastCalculatedLength = 0;
    this._lastConfig = null;
  }

  // ==================== DETECTION ====================

  /**
   * Detecta todos los swings y aplica filtros
   */
  detectSwings(candles) {
    if (!candles || candles.length < this.swingBars * 2 + 1) {
      return [];
    }

    const configHash = JSON.stringify({
      swingBars: this.swingBars,
      direction: this.direction,
      volumeFilter: this.volumeFilter,
      vwapFilter: this.vwapFilter.enabled,
      priceZones: this.priceZones.map(z => z.id + z.enabled)
    });

    if (candles.length === this._lastCalculatedLength &&
        this._lastConfig === configHash &&
        this._allDetectedSignals.length > 0) {
      return this._filterByPlaybackTime(this._allDetectedSignals);
    }

    const signals = [];
    const n = this.swingBars;
    const lookback = this.volumeFilter.lookbackBars;
    const volumes = candles.map(c => c.volume || 0);

    // VWAP data map
    let vwapMap = new Map();
    if (this.vwapFilter.enabled && this.vwapIndicator?.dataMap) {
      vwapMap = this.vwapIndicator.dataMap;
    }

    // Zonas filtradas por símbolo
    const activeZones = this.priceZones.filter(z =>
      z.enabled && (!z.symbol || z.symbol === this.symbol)
    );

    const startIdx = Math.max(n, lookback);
    const endIdx = candles.length - n;

    for (let i = startIdx; i < endIdx; i++) {
      const current = candles[i];
      const timestamp = current.timestamp;

      // 1. Detectar swing high/low
      const isSwingHigh = this._isSwingHigh(candles, i, n);
      const isSwingLow = this._isSwingLow(candles, i, n);

      if (!isSwingHigh && !isSwingLow) continue;

      // 2. Filtro de dirección global
      if (this.direction === 'LONG' && isSwingHigh) continue;
      if (this.direction === 'SHORT' && isSwingLow) continue;

      const signalDirection = isSwingHigh ? 'SHORT' : 'LONG';
      const price = isSwingLow ? current.low : current.high;

      // 3. Verificar zonas de precio (con time-bounds)
      const zoneMatch = this._checkPriceZones(price, activeZones, signalDirection, timestamp);

      // Si hay zonas definidas pero ninguna coincide, rechazar
      if (activeZones.length > 0 && !zoneMatch) {
        continue;
      }

      // 4. Verificar si estamos dentro de un rectángulo activo
      const isInRectangle = this._isInsideActiveRectangle(price, timestamp, activeZones);

      // 5. Filtro VWAP (solo cuando está dentro de un rectángulo con VWAP habilitado)
      if (this.vwapFilter.enabled && isInRectangle && vwapMap.size > 0) {
        const vwapValidation = this._checkVWAPFilter(timestamp, price, vwapMap);

        if (vwapValidation === null) {
          continue; // Precio entre bandas - rechazar
        }

        // Validar dirección según zona
        const zoneDirection = zoneMatch?.direction || 'BOTH';

        if (zoneDirection === 'BOTH') {
          // Zona permite ambos - VWAP determina
          if (vwapValidation !== signalDirection && vwapValidation !== 'BOTH') {
            continue;
          }
        } else {
          // Zona tiene dirección específica - validar posición VWAP
          if (vwapValidation !== zoneDirection && vwapValidation !== 'BOTH') {
            continue;
          }
        }
      }

      // 6. Filtro de volumen (skip si estamos en rectángulo y skipVolumeInRectangle)
      let volumeZScore = 0;
      const shouldCheckVolume = this.volumeFilter.enabled &&
        this.volumeFilter.minZScore > 0 &&
        !(isInRectangle && this.vwapFilter.skipVolumeInRectangle);

      if (shouldCheckVolume) {
        volumeZScore = this._calculateVolumeZScore(volumes, i, lookback);
        if (volumeZScore < this.volumeFilter.minZScore) {
          continue;
        }
      } else {
        volumeZScore = this._calculateVolumeZScore(volumes, i, lookback);
      }

      // 7. ¡Señal válida!
      signals.push({
        timestamp: timestamp,
        type: isSwingHigh ? 'SWING_HIGH' : 'SWING_LOW',
        price: price,
        direction: signalDirection,
        volumeZScore: volumeZScore,
        candleIndex: i,
        zoneId: zoneMatch?.id || null,
        isInRectangle: isInRectangle
      });
    }

    this._allDetectedSignals = signals;
    this._lastCalculatedLength = candles.length;
    this._lastConfig = configHash;

    // Aplicar filtro de tiempo de playback
    this.signals = this._filterByPlaybackTime(signals);

    const highCount = this.signals.filter(s => s.type === 'SWING_HIGH').length;
    const lowCount = this.signals.filter(s => s.type === 'SWING_LOW').length;
    console.log(`[${this.symbol}] SwingDetector: ${this.signals.length} swings visible (${highCount} H, ${lowCount} L) [zones=${activeZones.length}]`);

    return this.signals;
  }

  /**
   * 🎯 CRÍTICO: Filtra señales por tiempo de playback
   * Evita mostrar señales "futuras" durante el backtesting
   */
  _filterByPlaybackTime(signals) {
    if (!this._currentPlaybackTime) {
      return signals; // Sin playback, mostrar todas
    }

    // Solo mostrar señales cuyo timestamp sea <= al tiempo actual de playback
    // La señal se confirma swingBars velas después, así que usamos:
    // timestamp de la señal + (swingBars * intervaloMs)
    const intervalMs = this._getIntervalMs();
    const confirmationDelay = this.swingBars * intervalMs;

    return signals.filter(signal => {
      const confirmationTime = signal.timestamp + confirmationDelay;
      return confirmationTime <= this._currentPlaybackTime;
    });
  }

  _getIntervalMs() {
    const intervalMap = {
      '1': 60000,
      '3': 180000,
      '5': 300000,
      '15': 900000,
      '30': 1800000,
      '60': 3600000,
      '120': 7200000,
      '240': 14400000,
      'D': 86400000,
      'W': 604800000
    };
    return intervalMap[this.interval] || 3600000;
  }

  // ==================== ZONE CHECKING ====================

  /**
   * Verifica si el precio está dentro de alguna zona válida
   * Sistema de prioridad: rectangles time-bound > zonas manuales
   */
  _checkPriceZones(price, zones, signalDirection, timestamp) {
    // Separar zonas time-bound (rectángulos) de manuales
    const timeBoundZones = zones.filter(z => z.timeBound && z.timeStart && z.timeEnd);
    const manualZones = zones.filter(z => !z.timeBound);

    // PRIORIDAD 1: Zonas time-bound (rectángulos activos)
    for (const zone of timeBoundZones) {
      const inPriceRange = price >= zone.min && price <= zone.max;
      const inTimeRange = timestamp >= zone.timeStart && timestamp <= zone.timeEnd;

      if (inPriceRange && inTimeRange) {
        // Zona activa - verificar dirección
        if (zone.direction === 'BOTH' || zone.direction === signalDirection) {
          return zone; // MATCH
        } else {
          // Zona activa pero dirección no coincide - BLOQUEAR
          return null;
        }
      }
    }

    // PRIORIDAD 2: Zonas manuales (sin límite de tiempo)
    for (const zone of manualZones) {
      const inPriceRange = price >= zone.min && price <= zone.max;

      if (inPriceRange) {
        if (zone.direction === 'BOTH' || zone.direction === signalDirection) {
          return zone; // MATCH
        }
      }
    }

    return null;
  }

  /**
   * Verifica si estamos dentro de cualquier rectángulo activo
   * (independiente de la dirección)
   */
  _isInsideActiveRectangle(price, timestamp, zones) {
    for (const zone of zones) {
      if (!zone.sourceRectId) continue; // No es de un rectángulo

      const inPriceRange = price >= zone.min && price <= zone.max;

      if (inPriceRange) {
        if (zone.timeBound) {
          const inTimeRange = timestamp >= zone.timeStart && timestamp <= zone.timeEnd;
          if (inTimeRange) return true;
        } else {
          return true;
        }
      }
    }
    return false;
  }

  // ==================== FILTERS ====================

  _isSwingHigh(candles, idx, bars) {
    const currentHigh = candles[idx].high;
    for (let i = idx - bars; i < idx; i++) {
      if (candles[i].high >= currentHigh) return false;
    }
    for (let i = idx + 1; i <= idx + bars; i++) {
      if (candles[i].high >= currentHigh) return false;
    }
    return true;
  }

  _isSwingLow(candles, idx, bars) {
    const currentLow = candles[idx].low;
    for (let i = idx - bars; i < idx; i++) {
      if (candles[i].low <= currentLow) return false;
    }
    for (let i = idx + 1; i <= idx + bars; i++) {
      if (candles[i].low <= currentLow) return false;
    }
    return true;
  }

  _calculateVolumeZScore(volumes, idx, lookback) {
    if (idx < lookback) return 0;

    const lookbackVolumes = volumes.slice(idx - lookback, idx);
    if (lookbackVolumes.length < 2) return 0;

    const currentVolume = volumes[idx];
    const mean = lookbackVolumes.reduce((a, b) => a + b, 0) / lookbackVolumes.length;
    const variance = lookbackVolumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / lookbackVolumes.length;
    const stdev = Math.sqrt(variance);

    if (stdev === 0) return 0;
    return (currentVolume - mean) / stdev;
  }

  _checkVWAPFilter(timestamp, price, vwapMap) {
    let vwapPoint = vwapMap.get(timestamp);

    // Si no hay match exacto, buscar el más cercano anterior
    if (!vwapPoint) {
      const timestamps = Array.from(vwapMap.keys()).sort((a, b) => a - b);
      for (let i = timestamps.length - 1; i >= 0; i--) {
        if (timestamps[i] <= timestamp) {
          vwapPoint = vwapMap.get(timestamps[i]);
          break;
        }
      }
    }

    if (!vwapPoint || !vwapPoint.bands) return 'BOTH';

    const bands = vwapPoint.bands;
    const marginFactor = 1 + (this.vwapFilter.marginPercent / 100);

    // Precio por debajo de bandas inferiores = LONG
    const lowestBand = bands['lower3'] || bands['lower2'] || bands['lower1'];
    if (lowestBand && price <= lowestBand * marginFactor) {
      return 'LONG';
    }

    // Precio por encima de bandas superiores = SHORT
    const highestBand = bands['upper3'] || bands['upper2'] || bands['upper1'];
    if (highestBand && price >= highestBand / marginFactor) {
      return 'SHORT';
    }

    // Precio entre bandas = sin señal clara
    return null;
  }

  // ==================== RENDERING ====================

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) return;

    const candlesToUse = allCandles || visibleCandles;
    this.detectSwings(candlesToUse);

    const priceToY = (price) => {
      if (priceContext?.priceToY) return priceContext.priceToY(price);
      if (!priceContext) return bounds.y;
      const { minPrice, maxPrice } = priceContext;
      return bounds.y + ((maxPrice - price) / (maxPrice - minPrice)) * bounds.height;
    };

    // 1. Dibujar zonas primero (detrás de todo)
    if (this.showZones && this.priceZones.length > 0) {
      this._renderZones(ctx, bounds, priceToY, visibleCandles);
    }

    // 2. Dibujar señales
    if (this.signals.length === 0) return;

    const signalMap = new Map();
    for (const signal of this.signals) {
      signalMap.set(signal.timestamp, signal);
    }

    const candleWidth = bounds.width / visibleCandles.length;

    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const signal = signalMap.get(candle.timestamp);

      if (!signal) continue;

      const x = bounds.x + i * candleWidth + candleWidth / 2;
      const highY = priceToY(candle.high);
      const lowY = priceToY(candle.low);

      this._drawSwingArrow(ctx, x, highY, lowY, signal);
    }
  }

  _renderZones(ctx, bounds, priceToY, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return;

    const currentTime = this._currentPlaybackTime || Date.now();
    const minVisibleTime = visibleCandles[0].timestamp;
    const maxVisibleTime = visibleCandles[visibleCandles.length - 1].timestamp;

    ctx.save();

    for (const zone of this.priceZones) {
      if (!zone.enabled || (zone.symbol && zone.symbol !== this.symbol)) continue;

      // Para zonas time-bound, verificar si están en el rango visible
      if (zone.timeBound) {
        // No mostrar zonas que son completamente futuras al playback
        if (zone.timeStart > currentTime) continue;

        // Verificar overlap con el rango visible
        if (zone.timeEnd < minVisibleTime || zone.timeStart > maxVisibleTime) continue;
      }

      const minY = priceToY(zone.max);
      const maxY = priceToY(zone.min);

      if (maxY < bounds.y || minY > bounds.y + bounds.height) continue;

      const clippedMinY = Math.max(minY, bounds.y);
      const clippedMaxY = Math.min(maxY, bounds.y + bounds.height);
      const clippedHeight = clippedMaxY - clippedMinY;

      // Calcular X para zonas time-bound
      let zoneStartX = bounds.x;
      let zoneEndX = bounds.x + bounds.width;

      if (zone.timeBound && zone.timeStart && zone.timeEnd) {
        const candleWidth = bounds.width / visibleCandles.length;

        for (let i = 0; i < visibleCandles.length; i++) {
          const ts = visibleCandles[i].timestamp;
          if (ts >= zone.timeStart && zoneStartX === bounds.x) {
            zoneStartX = bounds.x + i * candleWidth;
          }
          if (ts <= zone.timeEnd) {
            zoneEndX = bounds.x + (i + 1) * candleWidth;
          }
        }
      }

      const zoneWidth = zoneEndX - zoneStartX;

      // Color según dirección
      let fillColor, borderColor;
      if (zone.direction === 'LONG') {
        fillColor = this.colors.ZONE_LONG;
        borderColor = 'rgba(76, 175, 80, 0.4)';
      } else if (zone.direction === 'SHORT') {
        fillColor = this.colors.ZONE_SHORT;
        borderColor = 'rgba(244, 67, 54, 0.4)';
      } else {
        fillColor = this.colors.ZONE_BOTH;
        borderColor = 'rgba(255, 152, 0, 0.4)';
      }

      // Dibujar rectángulo
      ctx.fillStyle = fillColor;
      ctx.fillRect(zoneStartX, clippedMinY, zoneWidth, clippedHeight);

      // Bordes
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(zoneStartX, clippedMinY, zoneWidth, clippedHeight);
      ctx.setLineDash([]);

      // Label
      const labelY = clippedMinY + clippedHeight / 2;
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'right';

      const label = `${zone.direction || 'BOTH'}${zone.timeBound ? ' ⏱️' : ''}`;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      const textWidth = ctx.measureText(label).width + 8;
      ctx.fillRect(zoneEndX - textWidth - 4, labelY - 8, textWidth + 4, 16);

      ctx.fillStyle = zone.direction === 'LONG' ? '#4CAF50' :
                      zone.direction === 'SHORT' ? '#f44336' : '#FF9800';
      ctx.fillText(label, zoneEndX - 6, labelY + 4);
    }

    ctx.restore();
  }

  _drawSwingArrow(ctx, x, highY, lowY, signal) {
    const isLong = signal.type === 'SWING_LOW';
    const size = this.arrowSize;
    const offset = this.arrowOffset;
    const color = isLong ? this.colors.SWING_LOW : this.colors.SWING_HIGH;

    const arrowY = isLong ? lowY + offset + size : highY - offset - size;

    ctx.save();

    const zScore = Math.abs(signal.volumeZScore || 0);
    const alpha = Math.min(0.95, 0.6 + zScore * 0.1);

    ctx.beginPath();
    if (isLong) {
      ctx.moveTo(x, arrowY - size);
      ctx.lineTo(x - size * 0.6, arrowY + size * 0.4);
      ctx.lineTo(x + size * 0.6, arrowY + size * 0.4);
    } else {
      ctx.moveTo(x, arrowY + size);
      ctx.lineTo(x - size * 0.6, arrowY - size * 0.4);
      ctx.lineTo(x + size * 0.6, arrowY - size * 0.4);
    }
    ctx.closePath();

    ctx.fillStyle = this._hexToRgba(color, alpha);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Indicador de zona
    if (signal.zoneId) {
      ctx.beginPath();
      ctx.arc(x, isLong ? arrowY + size + 3 : arrowY - size - 3, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
    }

    if (this.showVolumeZScore && zScore > 0.5) {
      ctx.font = 'bold 8px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      const textY = isLong ? arrowY + size + 12 : arrowY - size - 8;
      ctx.strokeText(`z${signal.volumeZScore.toFixed(1)}`, x, textY);
      ctx.fillText(`z${signal.volumeZScore.toFixed(1)}`, x, textY);
    }

    ctx.restore();
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ==================== CONFIG ====================

  updateConfig(config) {
    if (config.swingBars !== undefined) this.swingBars = config.swingBars;
    if (config.direction !== undefined) this.direction = config.direction;
    if (config.arrowSize !== undefined) this.arrowSize = config.arrowSize;
    if (config.arrowOffset !== undefined) this.arrowOffset = config.arrowOffset;
    if (config.showVolumeZScore !== undefined) this.showVolumeZScore = config.showVolumeZScore;
    if (config.showZones !== undefined) this.showZones = config.showZones;
    if (config.priceZones !== undefined) this.priceZones = config.priceZones;

    if (config.volumeFilter !== undefined) {
      this.volumeFilter = { ...this.volumeFilter, ...config.volumeFilter };
    }
    if (config.vwapFilter !== undefined) {
      this.vwapFilter = { ...this.vwapFilter, ...config.vwapFilter };
    }

    this._invalidateCache();
  }

  getConfig() {
    return {
      swingBars: this.swingBars,
      direction: this.direction,
      arrowSize: this.arrowSize,
      arrowOffset: this.arrowOffset,
      showVolumeZScore: this.showVolumeZScore,
      showZones: this.showZones,
      volumeFilter: this.volumeFilter,
      vwapFilter: this.vwapFilter,
      priceZones: this.priceZones
    };
  }

  render(ctx, bounds) {
    return;
  }
}

export default SwingDetectorIndicator;
