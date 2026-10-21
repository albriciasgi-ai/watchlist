import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';

/**
 * OrderFlowIndicator - Versión simplificada para Backtesting
 *
 * - NO renderiza footprints inline (sin cuadrícula invisible)
 * - Solo overlays: imbalance coloring, POC markers, stacked imbalances
 * - Sidebar consume datos vía getFootprintForTimestamp()
 * - Soporte backtesting: anti-sesgo de supervivencia
 */
class OrderFlowIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 7, backtestingMode = false) {
    super(symbol, interval, days);
    this.name = "Order Flow";
    this.height = 0; // Overlay mode - no ocupa espacio propio
    this.backtestingMode = backtestingMode;

    // Estructura de datos
    this.footprints = []; // Array de footprints históricos
    this.footprintMap = new Map(); // timestamp → footprint (para búsqueda rápida)
    this.stackedImbalances = new Map(); // timestamp → array de imbalances consecutivos

    // Configuración de overlays
    this.config = this.getDefaultConfig();

    // Estado de carga
    this.isLoading = false;
    this.error = null;
  }

  // ==================== CONFIGURACIÓN ====================

  getDefaultConfig() {
    return {
      // Detección de imbalances
      imbalanceThreshold: 1.5, // Ratio mínimo bid/ask o ask/bid
      stackedMinLevels: 3, // Mínimo de niveles consecutivos para "stacked"

      // Visualización - Imbalance Coloring
      showImbalanceColoring: true,
      bullishImbalanceColor: 'rgba(34, 197, 94, 0.8)', // Verde semi-transparente (AUMENTADO para testing)
      bearishImbalanceColor: 'rgba(239, 68, 68, 0.8)', // Rojo semi-transparente (AUMENTADO para testing)

      // Visualización - POC Markers
      showPOCMarkers: true,
      pocMarkerColor: '#8B5CF6', // Morado
      pocMarkerSize: 4,

      // Visualización - Stacked Imbalances
      showStackedImbalances: true,
      stackedImbalanceSize: 8, // Tamaño del marcador (cuadrado/círculo)
      stackedImbalanceOpacity: 0.8,
      stackedBullishColor: '#22C55E', // Verde sólido
      stackedBearishColor: '#EF4444', // Rojo sólido
      stackedMarkerType: 'square', // 'square', 'circle', 'triangle'

      // Z-Score para normalización (opcional)
      useZScore: false,
      zScoreThreshold: 1.5
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    // Re-detectar imbalances con nueva configuración
    this._detectAllStackedImbalances();
  }

  // ==================== DATA LOADING ====================

  async fetchData(startTimestamp = null, endTimestamp = null) {
    this.isLoading = true;
    this.error = null;

    try {
      // 🔧 FIX: Convertir interval de formato frontend (15m, 1h, 4h) a backend (15, 60, 240)
      const intervalMap = {
        '1m': '1',
        '5m': '5',
        '15m': '15',
        '1h': '60',
        '4h': '240'
      };

      const backendInterval = intervalMap[this.interval] || this.interval;

      console.log(`[${this.symbol}] 🔍 Interval conversion: ${this.interval} → ${backendInterval}`);

      // Construir URL
      const params = new URLSearchParams({
        interval: backendInterval,
        days: this.days.toString()
      });

      if (startTimestamp) params.append('start_timestamp', startTimestamp.toString());
      if (endTimestamp) params.append('end_timestamp', endTimestamp.toString());

      const url = `${API_BASE_URL}/api/orderflow/historical/${this.symbol}?${params}`;

      console.log(`[${this.symbol}] 📊 Fetching Order Flow data from ${url}`);

      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 🔍 DEBUG: Ver qué estructura tiene realmente la respuesta
      console.log(`[${this.symbol}] 🔍 Backend response:`, data);
      console.log(`[${this.symbol}] 🔍 data.footprints:`, data.footprints);
      console.log(`[${this.symbol}] 🔍 data.footprints?.length:`, data.footprints?.length);
      console.log(`[${this.symbol}] 🔍 Type of data:`, typeof data);
      console.log(`[${this.symbol}] 🔍 Keys in data:`, Object.keys(data));

      console.log(`[${this.symbol}] ✅ Order Flow loaded: ${data.footprints?.length || 0} footprints`);

      // Almacenar footprints
      this.footprints = data.footprints;
      this._buildFootprintMap();

      // Detectar stacked imbalances en todos los footprints
      this._detectAllStackedImbalances();

      this.isLoading = false;
      return data;

    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error loading Order Flow:`, error);
      this.error = error.message;
      this.isLoading = false;
      throw error;
    }
  }

  _buildFootprintMap() {
    this.footprintMap.clear();
    this.footprints.forEach(fp => {
      // 🔧 FIX: Usar candle_timestamp como key
      const timestamp = fp.candle_timestamp || fp.timestamp;
      this.footprintMap.set(timestamp, fp);
    });
  }

  // ==================== ANTI-SESGO DE SUPERVIVENCIA ====================

  getVisibleFootprints(currentPlaybackTime) {
    if (!this.backtestingMode) {
      return this.footprints;
    }

    // 🔍 DEBUG: Ver timestamps de footprints
    if (this.footprints.length > 0 && !this._timestampLogged) {
      const firstFp = this.footprints[0];
      const lastFp = this.footprints[this.footprints.length - 1];
      console.log(`[${this.symbol}] 🔍 Footprint timestamps:`, {
        firstFp_timestamp: firstFp.timestamp,
        firstFp_candle_timestamp: firstFp.candle_timestamp,
        lastFp_timestamp: lastFp.timestamp,
        lastFp_candle_timestamp: lastFp.candle_timestamp,
        currentPlaybackTime,
        totalFootprints: this.footprints.length
      });
      this._timestampLogged = true;
    }

    // 🔧 FIX: Usar candle_timestamp en lugar de timestamp
    // Los footprints del backend tienen candle_timestamp, no timestamp
    return this.footprints.filter(fp => {
      const fpTime = fp.candle_timestamp || fp.timestamp;
      return fpTime <= currentPlaybackTime;
    });
  }

  // ==================== IMBALANCE DETECTION ====================

  _detectAllStackedImbalances() {
    this.stackedImbalances.clear();

    this.footprints.forEach(footprint => {
      const stacked = this._detectStackedImbalancesInFootprint(footprint);
      if (stacked.length > 0) {
        this.stackedImbalances.set(footprint.timestamp, stacked);
      }
    });

    console.log(`[${this.symbol}] 🔍 Detected stacked imbalances in ${this.stackedImbalances.size} footprints`);
  }

  _detectStackedImbalancesInFootprint(footprint) {
    if (!footprint.levels || footprint.levels.length === 0) {
      return [];
    }

    const { imbalanceThreshold, stackedMinLevels } = this.config;
    const imbalances = [];

    // 1. Detectar imbalances en cada level
    const levelImbalances = footprint.levels.map(level => {
      const bid = level.bid_volume || 0;
      const ask = level.ask_volume || 0;
      const total = bid + ask;

      if (total === 0) return null;

      const ratio = bid > ask ? bid / (ask || 1) : ask / (bid || 1);
      const isBullish = bid > ask;

      if (ratio >= imbalanceThreshold) {
        return {
          price: level.price,
          ratio,
          isBullish,
          bid,
          ask
        };
      }

      return null;
    }).filter(Boolean);

    if (levelImbalances.length === 0) return [];

    // 2. Buscar grupos consecutivos
    let currentGroup = [levelImbalances[0]];
    let currentDirection = levelImbalances[0].isBullish;

    for (let i = 1; i < levelImbalances.length; i++) {
      const imb = levelImbalances[i];

      // Si mantiene dirección, agregar al grupo
      if (imb.isBullish === currentDirection) {
        currentGroup.push(imb);
      } else {
        // Cambió dirección, guardar grupo si cumple mínimo
        if (currentGroup.length >= stackedMinLevels) {
          imbalances.push({
            type: currentDirection ? 'bullish' : 'bearish',
            levels: currentGroup,
            priceStart: currentGroup[0].price,
            priceEnd: currentGroup[currentGroup.length - 1].price,
            avgRatio: currentGroup.reduce((sum, l) => sum + l.ratio, 0) / currentGroup.length
          });
        }

        // Iniciar nuevo grupo
        currentGroup = [imb];
        currentDirection = imb.isBullish;
      }
    }

    // Guardar último grupo si cumple mínimo
    if (currentGroup.length >= stackedMinLevels) {
      imbalances.push({
        type: currentDirection ? 'bullish' : 'bearish',
        levels: currentGroup,
        priceStart: currentGroup[0].price,
        priceEnd: currentGroup[currentGroup.length - 1].price,
        avgRatio: currentGroup.reduce((sum, l) => sum + l.ratio, 0) / currentGroup.length
      });
    }

    return imbalances;
  }

  // ==================== OVERLAY RENDERING ====================

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!ctx || !bounds || !priceContext) {
      return;
    }
    if (this.footprints.length === 0) {
      return;
    }
    if (!visibleCandles || visibleCandles.length === 0) {
      return;
    }

    const { priceToY } = priceContext;

    // 🔧 FIX: Calcular candleWidth a partir de bounds.width y visibleCandles
    const candleWidth = bounds.width / visibleCandles.length;

    // 🎯 OPTIMIZACIÓN: Filtrar footprints por rango de timestamps de visibleCandles
    const firstVisibleTs = visibleCandles[0].timestamp;
    const lastVisibleTs = visibleCandles[visibleCandles.length - 1].timestamp;

    // 🎯 Anti-sesgo corregido:
    // - Mostrar TODOS los footprints hasta la fecha de inicio del backtesting
    // - Durante el playback: solo mostrar footprints adicionales hasta currentTime
    const currentTime = this.backtestingMode && allCandles.length > 0
      ? allCandles[allCandles.length - 1].timestamp
      : Date.now();

    // Obtener fecha de inicio del backtesting (primera vela de allCandles)
    const backtestingStartTime = this.backtestingMode && allCandles.length > 0
      ? allCandles[0].timestamp
      : 0;

    // Filtrar footprints:
    // - Rango temporal de velas visibles
    // - Hasta el MAX de (backtestingStartTime, currentTime)
    const visibleFootprints = this.footprints.filter(fp => {
      const fpTime = fp.candle_timestamp || fp.timestamp;
      const maxAllowedTime = Math.max(backtestingStartTime, currentTime);
      return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs && fpTime <= maxAllowedTime;
    });

    // 🔍 DEBUG: Log único al inicio para verificar funcionamiento
    if (!this._renderLogged) {
      console.log(`[${this.symbol}] 🎨 OrderFlow renderOverlay:`, {
        totalFootprints: this.footprints.length,
        visibleCandles: visibleCandles.length,
        visibleFootprints: visibleFootprints.length,
        timeRange: `${new Date(firstVisibleTs).toISOString()} → ${new Date(lastVisibleTs).toISOString()}`,
        bounds,
        candleWidth,
        config: this.config
      });
      this._renderLogged = true;
    }

    // CAPA 1: Imbalance Coloring (fondo de velas con imbalance general)
    if (this.config.showImbalanceColoring) {
      const count = this._renderImbalanceColoring(ctx, bounds, visibleCandles, visibleFootprints, priceToY, candleWidth);
      if (!this._imbalanceLogged && count > 0) {
        console.log(`[${this.symbol}] 🟢 Imbalance Coloring: ${count} velas dibujadas`);
        this._imbalanceLogged = true;
      }
    }

    // CAPA 2: POC Markers (punto de control de volumen)
    if (this.config.showPOCMarkers) {
      this._renderPOCMarkers(ctx, bounds, visibleCandles, visibleFootprints, priceToY, candleWidth);
    }

    // CAPA 3: Stacked Imbalances (marcadores de imbalances consecutivos)
    if (this.config.showStackedImbalances) {
      this._renderStackedImbalances(ctx, bounds, visibleCandles, visibleFootprints, priceToY, candleWidth);
    }
  }

  _renderImbalanceColoring(ctx, bounds, visibleCandles, visibleFootprints, priceToY, candleWidth) {
    // 🔧 FIX: Usar candle_timestamp para el mapa
    const fpMap = new Map(visibleFootprints.map(fp => [fp.candle_timestamp || fp.timestamp, fp]));
    let count = 0;

    visibleCandles.forEach((candle, index) => {
      const footprint = fpMap.get(candle.timestamp);
      if (!footprint || !footprint.levels) return;

      // Calcular imbalance general del footprint
      let totalBid = 0;
      let totalAsk = 0;

      footprint.levels.forEach(level => {
        totalBid += level.bid_volume || 0;
        totalAsk += level.ask_volume || 0;
      });

      const total = totalBid + totalAsk;
      if (total === 0) return;

      const ratio = totalBid > totalAsk ? totalBid / (totalAsk || 1) : totalAsk / (totalBid || 1);

      if (ratio >= this.config.imbalanceThreshold) {
        const isBullish = totalBid > totalAsk;
        const color = isBullish ? '#22C55E' : '#EF4444'; // Verde o rojo sólido

        // 🔧 FIX: Dibujar BORDE grueso en lugar de fondo (más visible)
        const x = bounds.x + index * candleWidth;
        const yTop = priceToY(candle.high);
        const yBottom = priceToY(candle.low);

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, yTop, candleWidth, yBottom - yTop);
        count++;
      }
    });

    return count;
  }

  _renderPOCMarkers(ctx, bounds, visibleCandles, visibleFootprints, priceToY, candleWidth) {
    // 🔧 FIX: Usar candle_timestamp para el mapa
    const fpMap = new Map(visibleFootprints.map(fp => [fp.candle_timestamp || fp.timestamp, fp]));
    let count = 0;

    visibleCandles.forEach((candle, index) => {
      const footprint = fpMap.get(candle.timestamp);
      if (!footprint || !footprint.poc_price) return;

      const x = bounds.x + index * candleWidth + candleWidth / 2;
      const y = priceToY(footprint.poc_price);

      // Dibujar marcador de POC (línea horizontal corta)
      ctx.strokeStyle = this.config.pocMarkerColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - this.config.pocMarkerSize, y);
      ctx.lineTo(x + this.config.pocMarkerSize, y);
      ctx.stroke();
      count++;
    });

    return count;
  }

  _renderStackedImbalances(ctx, bounds, visibleCandles, visibleFootprints, priceToY, candleWidth) {
    // 🔧 FIX: Usar candle_timestamp para el mapa
    const fpMap = new Map(visibleFootprints.map(fp => [fp.candle_timestamp || fp.timestamp, fp]));
    let count = 0;

    visibleCandles.forEach((candle, index) => {
      const footprint = fpMap.get(candle.timestamp);
      if (!footprint) return;

      const stackedGroups = this.stackedImbalances.get(footprint.timestamp);
      if (!stackedGroups || stackedGroups.length === 0) return;

      stackedGroups.forEach(group => {
        const isBullish = group.type === 'bullish';
        const color = isBullish ? this.config.stackedBullishColor : this.config.stackedBearishColor;

        // Posición del marcador
        const x = bounds.x + index * candleWidth + candleWidth / 2;
        const yPrice = isBullish ? group.priceEnd : group.priceStart; // Arriba para bullish, abajo para bearish
        const y = priceToY(yPrice);

        // Dibujar marcador según tipo
        ctx.globalAlpha = this.config.stackedImbalanceOpacity;
        ctx.fillStyle = color;

        const size = this.config.stackedImbalanceSize;

        switch (this.config.stackedMarkerType) {
          case 'square':
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
            break;

          case 'circle':
            ctx.beginPath();
            ctx.arc(x, y, size / 2, 0, Math.PI * 2);
            ctx.fill();
            break;

          case 'triangle':
            ctx.beginPath();
            if (isBullish) {
              // Triángulo apuntando arriba
              ctx.moveTo(x, y - size / 2);
              ctx.lineTo(x - size / 2, y + size / 2);
              ctx.lineTo(x + size / 2, y + size / 2);
            } else {
              // Triángulo apuntando abajo
              ctx.moveTo(x, y + size / 2);
              ctx.lineTo(x - size / 2, y - size / 2);
              ctx.lineTo(x + size / 2, y - size / 2);
            }
            ctx.closePath();
            ctx.fill();
            break;
        }

        ctx.globalAlpha = 1.0;
        count++;
      });
    });

    return count;
  }

  // ==================== PUBLIC API FOR SIDEBAR ====================

  /**
   * Obtiene el footprint para un timestamp dado
   * Usado por FootprintSidebar para mostrar footprints pinneados
   */
  getFootprintForTimestamp(timestamp) {
    return this.footprintMap.get(timestamp) || null;
  }

  /**
   * Obtiene múltiples footprints por timestamps
   */
  getFootprintsForTimestamps(timestamps) {
    return timestamps
      .map(ts => this.getFootprintForTimestamp(ts))
      .filter(Boolean);
  }

  /**
   * Obtiene stacked imbalances para un timestamp
   */
  getStackedImbalancesForTimestamp(timestamp) {
    return this.stackedImbalances.get(timestamp) || [];
  }

  // ==================== UTILITIES ====================

  /**
   * Calcula Z-Score de un array de valores
   */
  _calculateZScore(value, values) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
  }

  /**
   * Normaliza ratios usando Z-Score si está habilitado
   */
  _normalizeImbalanceRatio(ratio, allRatios) {
    if (!this.config.useZScore) return ratio;
    return this._calculateZScore(ratio, allRatios);
  }

  /**
   * Formatea precio según step_size del footprint
   */
  _formatPrice(price, stepSize = 0.1) {
    const decimals = stepSize < 1 ? Math.abs(Math.log10(stepSize)) : 0;
    return price.toFixed(decimals);
  }

  /**
   * Obtiene color para un ratio de imbalance
   */
  _getImbalanceColor(ratio, isBullish) {
    const intensity = Math.min(ratio / 10, 1); // Normalizar a 0-1

    if (isBullish) {
      // Verde con intensidad variable
      const r = Math.floor(34 * (1 - intensity));
      const g = Math.floor(197 * intensity);
      const b = Math.floor(94 * (1 - intensity * 0.5));
      return `rgba(${r}, ${g}, ${b}, 0.3)`;
    } else {
      // Rojo con intensidad variable
      const r = Math.floor(239 * intensity);
      const g = Math.floor(68 * (1 - intensity * 0.5));
      const b = Math.floor(68 * (1 - intensity * 0.5));
      return `rgba(${r}, ${g}, ${b}, 0.3)`;
    }
  }

  // ==================== DEBUG ====================

  getDebugInfo() {
    return {
      name: this.name,
      symbol: this.symbol,
      interval: this.interval,
      backtestingMode: this.backtestingMode,
      footprintsCount: this.footprints.length,
      stackedImbalancesCount: this.stackedImbalances.size,
      isLoading: this.isLoading,
      error: this.error,
      config: this.config
    };
  }

  logDebugInfo() {
    console.table(this.getDebugInfo());
  }
}

export default OrderFlowIndicator;
