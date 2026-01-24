// src/components/indicators/OrderFlowIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';

/**
 * OrderFlowIndicator - Footprint chart visualization
 *
 * Displays bid/ask volume distribution per price level within each candle.
 * Shows:
 * - 6 price levels per candle
 * - Bid volume (sells) and Ask volume (buys) per level
 * - Delta (ask - bid) with color coding
 * - POC (Point of Control) line
 * - Imbalances highlighted with border
 */
class OrderFlowIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 1) {
    super(symbol, interval, days);
    this.name = "Order Flow";
    this.footprints = [];
    this.config = this.loadConfig();
    this.height = 0; // Overlay on main chart, no separate pane

    // Polling settings
    this.lastFetchTime = 0;
    this.fetchIntervalMs = 5000; // Poll every 5 seconds for real-time data
    this.isFetching = false;
    this._pollingInterval = null;
    this._destroyed = false;

    // Colors for visualization
    this.colors = {
      BUY_STRONG: '#00C853',    // Delta > +50%
      BUY_WEAK: '#81C784',      // Delta > 0
      SELL_STRONG: '#FF1744',   // Delta < -50%
      SELL_WEAK: '#EF9A9A',     // Delta < 0
      NEUTRAL: '#FFEB3B',       // Delta ~0
      POC_LINE: '#FFFFFF',      // POC marker
      IMBALANCE_BORDER: '#FFD600', // Yellow border for imbalances
      TEXT: '#FFFFFF',
      TEXT_SHADOW: '#000000',
      LEVEL_BG: 'rgba(30, 30, 30, 0.7)'
    };

    console.log(`[${this.symbol}] OrderFlowIndicator initialized`);
  }

  loadConfig() {
    const saved = localStorage.getItem(`orderflow_config_${this.symbol}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load orderflow config:', e);
      }
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      enabled: true,
      // Display options
      showBidAsk: true,      // Show bid/ask volumes
      showDelta: true,       // Show delta values
      showPOC: true,         // Highlight POC level
      showImbalances: true,  // Highlight imbalances
      // Style
      fontSize: 20,          // Duplicado de 10 a 20
      minCandleWidth: 12,    // Minimum width for simplified mode
      minCandleWidthFull: 60, // Width needed for full text mode
      opacity: 0.9,
      // History
      historyHours: 12       // Horas de historial a cargar
    };
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    localStorage.setItem(`orderflow_config_${this.symbol}`, JSON.stringify(this.config));
    console.log(`[${this.symbol}] OrderFlow config updated`);
  }

  setInterval(newInterval) {
    this.interval = newInterval;
    // Clear cached data when interval changes
    this.footprints = [];
    console.log(`[${this.symbol}] OrderFlow interval changed to ${newInterval}`);
  }

  async fetchData() {
    if (this._destroyed) return false;

    // Initial fetch
    const success = await this.fetchFootprints();

    // Don't start polling here - will be started via startPollingIfReady()
    return success;
  }

  /**
   * Start polling only after initial load is complete
   */
  startPollingIfReady() {
    if (this._destroyed) return;
    if (!this._pollingInterval && this.enabled && this.config.enabled) {
      this._startPolling();
    }
  }

  _startPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
    }

    this._pollingInterval = setInterval(async () => {
      if (this._destroyed) {
        this.stopPolling();
        return;
      }
      if (this.enabled && this.config.enabled) {
        const updated = await this.fetchFootprints();
        if (updated && this.indicatorManager?.requestRedraw) {
          this.indicatorManager.requestRedraw();
        }
      }
    }, this.fetchIntervalMs);

    console.log(`[${this.symbol}] OrderFlow polling started (${this.fetchIntervalMs}ms)`);
  }

  stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
      console.log(`[${this.symbol}] OrderFlow polling stopped`);
    }
  }

  destroy() {
    this._destroyed = true;
    this.stopPolling();
  }

  async fetchFootprints() {
    if (this._destroyed) return false;
    if (this.isFetching) return false;

    this.isFetching = true;
    this.lastFetchTime = Date.now();

    try {
      // OrderFlow solo soporta intervalos 1 y 5 minutos
      const supportedIntervals = ["1", "5"];
      if (!supportedIntervals.includes(this.interval)) {
        console.warn(`[${this.symbol}] OrderFlow: Intervalo ${this.interval} no soportado (solo 1, 5)`);
        this.footprints = [];
        return false;
      }

      // Solicitar footprints de las ultimas 12 horas (configurable via historyHours)
      const hours = this.config.historyHours || 12;
      const url = `${API_BASE_URL}/api/orderflow/footprint/${this.symbol}?interval=${this.interval}&limit=2000&hours=${hours}`;

      console.log(`[${this.symbol}] OrderFlow fetching: interval=${this.interval}, hours=${hours}`);

      const response = await fetch(url);

      if (this._destroyed) return false;

      if (!response.ok) {
        console.warn(`[${this.symbol}] OrderFlow fetch failed: ${response.status}`);
        return false;
      }

      const data = await response.json();

      if (!data.success) {
        console.warn(`[${this.symbol}] OrderFlow API error:`, data.error);
        return false;
      }

      this.footprints = data.footprints || [];

      // Log detallado de lo que recibimos
      if (this.footprints.length > 0) {
        const firstTs = this.footprints[0].candle_timestamp;
        const lastTs = this.footprints[this.footprints.length - 1].candle_timestamp;
        console.log(`[${this.symbol}] OrderFlow: ${this.footprints.length} footprints loaded`, {
          interval: this.interval,
          hours: hours,
          firstTimestamp: firstTs,
          lastTimestamp: lastTs,
          firstDate: new Date(firstTs).toLocaleString(),
          lastDate: new Date(lastTs).toLocaleString()
        });
      } else {
        console.log(`[${this.symbol}] OrderFlow: 0 footprints loaded (interval=${this.interval})`);
      }

      return true;
    } catch (error) {
      console.error(`[${this.symbol}] OrderFlow fetch error:`, error);
      return false;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Render footprint overlay on main chart
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !this.config.enabled) {
      return;
    }

    if (this.footprints.length === 0 || visibleCandles.length === 0) {
      return;
    }

    const candleWidth = bounds.width / visibleCandles.length;

    // Only show footprint if candles are wide enough for minimal display
    if (candleWidth < this.config.minCandleWidth) {
      return;
    }

    // Determine render mode based on candle width
    const fullMode = candleWidth >= (this.config.minCandleWidthFull || 50);

    // Helper to convert price to Y coordinate
    const priceToY = (price) => {
      if (!priceContext) return bounds.y;
      if (priceContext.priceToY) {
        return priceContext.priceToY(price);
      }
      const { minPrice, maxPrice } = priceContext;
      return bounds.y + ((maxPrice - price) / (maxPrice - minPrice)) * bounds.height;
    };

    // Create map of footprints by timestamp
    const footprintMap = new Map();
    for (const fp of this.footprints) {
      footprintMap.set(fp.candle_timestamp, fp);
    }

    ctx.save();

    // Debug: log matching info
    let matchCount = 0;
    const debugMatches = [];

    // DEBUG: Log timestamp comparison (only once every 5 seconds)
    if (!this._lastTimestampDebug || Date.now() - this._lastTimestampDebug > 5000) {
      const fpTimestamps = this.footprints.slice(-5).map(fp => fp.candle_timestamp);
      const candleTimestamps = visibleCandles.slice(-5).map(c => c.timestamp);
      console.log(`[${this.symbol}] OrderFlow DEBUG:`, {
        footprintCount: this.footprints.length,
        visibleCandleCount: visibleCandles.length,
        lastFpTimestamps: fpTimestamps,
        lastCandleTimestamps: candleTimestamps,
        interval: this.interval
      });
      this._lastTimestampDebug = Date.now();
    }

    // Render footprint for each visible candle
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const footprint = footprintMap.get(candle.timestamp);

      if (!footprint || !footprint.levels || footprint.levels.length === 0) {
        continue;
      }

      matchCount++;
      debugMatches.push({ i, ts: candle.timestamp, x: bounds.x + i * candleWidth });

      const candleX = bounds.x + i * candleWidth;
      this.renderCandleFootprint(ctx, footprint, candleX, candleWidth, priceToY, fullMode);
    }

    // Log once per render cycle
    if (matchCount > 0 && !this._lastDebugLog || Date.now() - this._lastDebugLog > 2000) {
      console.log(`[${this.symbol}] OrderFlow rendered ${matchCount} footprints, candleWidth=${candleWidth.toFixed(1)}, matches:`, debugMatches.slice(-5));
      this._lastDebugLog = Date.now();
    }

    ctx.restore();
  }

  /**
   * Render footprint for a single candle - ESTILO PROFESIONAL con STEP SIZE ABSOLUTO
   * Similar a ATAS/Sierra Chart: El footprint ES la vela
   * Cada nivel tiene BID (izquierda, rojo) | ASK (derecha, verde)
   * Los niveles usan precios ABSOLUTOS (price_min/price_max) para posicionamiento
   */
  renderCandleFootprint(ctx, footprint, x, width, priceToY, fullMode = true) {
    const levels = footprint.levels;
    const pocIndex = footprint.poc_index;
    const imbalances = footprint.imbalances || [];

    if (!levels || levels.length === 0) return;

    // Create set of imbalance level indices for quick lookup
    const imbalanceSet = new Set(imbalances.map(ib => ib.level_index));

    // El footprint ocupa TODO el ancho de la barra (es la vela)
    const margin = Math.max(1, width * 0.02);
    const footprintWidth = width - margin * 2;
    const footprintX = x + margin;

    // Colors for bid/ask backgrounds
    const bidBgColor = 'rgba(183, 28, 28, 0.85)';   // Dark red for bids
    const askBgColor = 'rgba(27, 94, 32, 0.85)';    // Dark green for asks
    const bidBgLight = 'rgba(239, 154, 154, 0.7)';  // Light red
    const askBgLight = 'rgba(165, 214, 167, 0.7)';  // Light green

    const levelGap = 1; // Small gap between levels

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      // IMPORTANTE: Usar precios ABSOLUTOS del nivel para posicionamiento
      // Esto asegura que los niveles estan alineados globalmente entre velas
      const levelTopY = priceToY(level.price_max);
      const levelBottomY = priceToY(level.price_min);
      const levelHeight = Math.abs(levelBottomY - levelTopY);

      // Skip if level is too small to render or outside bounds
      if (levelHeight < 2) continue;
      const bgY = Math.min(levelTopY, levelBottomY);
      if (bgY < -100 || bgY > 2100) continue;

      // Precio medio para texto
      const priceMid = (level.price_min + level.price_max) / 2;
      const textY = priceToY(priceMid);

      const halfWidth = footprintWidth / 2;

      // Determine which side dominates for background intensity
      const bidDominates = level.bid_volume > level.ask_volume;
      const askDominates = level.ask_volume > level.bid_volume;

      // LEFT SIDE: BID (sells hitting the bid)
      const bidBg = bidDominates ? bidBgColor : bidBgLight;
      ctx.fillStyle = bidBg;
      ctx.fillRect(footprintX, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // RIGHT SIDE: ASK (buys lifting the ask)
      const askBg = askDominates ? askBgColor : askBgLight;
      ctx.fillStyle = askBg;
      ctx.fillRect(footprintX + halfWidth + 0.5, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // Border for the entire level
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(footprintX, bgY, footprintWidth, levelHeight - levelGap);

      // Center divider line
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(footprintX + halfWidth, bgY);
      ctx.lineTo(footprintX + halfWidth, bgY + levelHeight - levelGap);
      ctx.stroke();

      // POC marker - horizontal bar on both sides
      if (this.config.showPOC && i === pocIndex) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(footprintX, textY - 1.5, footprintWidth, 3);
      }

      // Border for imbalances
      if (this.config.showImbalances && imbalanceSet.has(i)) {
        ctx.strokeStyle = this.colors.IMBALANCE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(footprintX, bgY, footprintWidth, levelHeight - levelGap);
      }

      // Text labels - BID on left, ASK on right
      // Solo mostrar texto si el nivel tiene suficiente altura
      const minHeightForText = fullMode ? 12 : 6;
      if (fullMode && footprintWidth >= 40 && levelHeight >= minHeightForText) {
        const fontSize = Math.min(this.config.fontSize, levelHeight - 2, 16);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textBaseline = 'middle';

        // BID volume (left side, right-aligned within left half)
        if (level.bid_volume > 0) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#FFFFFF';
          const bidText = this.formatVolume(level.bid_volume);
          const bidX = footprintX + halfWidth - 4;
          this.drawTextWithShadow(ctx, bidText, bidX, textY);
        }

        // ASK volume (right side, left-aligned within right half)
        if (level.ask_volume > 0) {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#FFFFFF';
          const askText = this.formatVolume(level.ask_volume);
          const askX = footprintX + halfWidth + 4;
          this.drawTextWithShadow(ctx, askText, askX, textY);
        }
      }
    }

    // Draw total delta at bottom of candle
    if (fullMode) {
      const totalDelta = footprint.total_delta;
      if (this.config.showDelta && Math.abs(totalDelta) > 0.01) {
        // Usar el nivel mas bajo para posicionar el delta
        const lowestLevel = levels[0];
        const bottomY = priceToY(lowestLevel.price_min) + 18;
        ctx.font = `bold ${this.config.fontSize}px Arial`;
        ctx.fillStyle = totalDelta >= 0 ? this.colors.BUY_STRONG : this.colors.SELL_STRONG;
        ctx.textAlign = 'center';
        const deltaText = totalDelta >= 0 ? `+${this.formatVolume(totalDelta)}` : this.formatVolume(totalDelta);
        this.drawTextWithShadow(ctx, deltaText, footprintX + footprintWidth / 2, bottomY);
      }
    }
  }

  /**
   * Get color based on delta relative to total volume
   */
  getColorForDelta(delta, totalVolume) {
    if (totalVolume === 0) return this.colors.NEUTRAL;

    const ratio = delta / totalVolume;

    if (ratio > 0.5) return this.colors.BUY_STRONG;
    if (ratio > 0) return this.colors.BUY_WEAK;
    if (ratio < -0.5) return this.colors.SELL_STRONG;
    if (ratio < 0) return this.colors.SELL_WEAK;
    return this.colors.NEUTRAL;
  }

  /**
   * Format volume for display
   */
  formatVolume(volume) {
    if (volume === undefined || volume === null) return '0';
    const absVol = Math.abs(volume);
    if (absVol >= 1000000) return (volume / 1000000).toFixed(1) + 'M';
    if (absVol >= 1000) return (volume / 1000).toFixed(1) + 'K';
    if (absVol >= 100) return Math.round(volume).toString();
    if (absVol >= 1) return volume.toFixed(1);
    return volume.toFixed(2);
  }

  /**
   * Draw text with shadow for better visibility
   */
  drawTextWithShadow(ctx, text, x, y) {
    ctx.save();
    ctx.strokeStyle = this.colors.TEXT_SHADOW;
    ctx.lineWidth = 2;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /**
   * Convert hex color to rgba
   */
  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // No separate pane rendering needed - this is an overlay
  render(ctx, bounds) {
    return;
  }

  /**
   * Returns true if there are footprints loaded and ready to display
   */
  hasFootprintData() {
    return this.footprints && this.footprints.length > 0;
  }

  /**
   * Check if Order Flow should replace Japanese candles
   * Siempre false - las velas se dibujan primero, el footprint se dibuja encima
   */
  shouldReplaceCandles() {
    return false;
  }
}

export default OrderFlowIndicator;
