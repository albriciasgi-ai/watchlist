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
      opacity: 0.9
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
      const url = `${API_BASE_URL}/api/orderflow/footprint/${this.symbol}?interval=${this.interval}&limit=500`;
      const response = await fetch(url);

      if (this._destroyed) return false;

      if (!response.ok) {
        console.warn(`[${this.symbol}] OrderFlow fetch failed: ${response.status}`);
        return false;
      }

      const data = await response.json();
      this.footprints = data.footprints || [];

      console.log(`[${this.symbol}] OrderFlow: ${this.footprints.length} footprints loaded`);
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
   * Render footprint for a single candle
   * @param fullMode - true for text labels, false for simplified color bars
   */
  renderCandleFootprint(ctx, footprint, x, width, priceToY, fullMode = true) {
    const levels = footprint.levels;
    const pocIndex = footprint.poc_index;
    const imbalances = footprint.imbalances || [];

    // Create set of imbalance level indices for quick lookup
    const imbalanceSet = new Set(imbalances.map(ib => ib.level_index));

    // Calculate dimensions - in simplified mode, make levels fill more vertical space
    const padding = fullMode ? 2 : 0;

    // Calculate price range of this candle to determine level heights
    const priceRange = footprint.candle_high - footprint.candle_low;
    const candleTopY = priceToY(footprint.candle_high);
    const candleBottomY = priceToY(footprint.candle_low);
    const candleHeightPx = Math.abs(candleBottomY - candleTopY);

    // Each level gets equal height within the candle
    const levelHeight = fullMode
      ? Math.max(14, candleHeightPx / levels.length)
      : Math.max(6, candleHeightPx / levels.length);

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const priceMid = (level.price_min + level.price_max) / 2;
      const y = priceToY(priceMid);

      // Skip if outside bounds
      if (y < 0 || y > 2000) continue;

      // Skip empty levels in simplified mode
      if (!fullMode && level.total_volume === 0) continue;

      // Calculate color based on delta
      const color = this.getColorForDelta(level.delta, level.total_volume || 1);

      // Draw level background
      const bgWidth = width - padding * 2;
      const bgX = x + padding;
      const bgY = y - levelHeight / 2;

      // Background with color tint - more opaque in simplified mode
      const bgOpacity = fullMode ? 0.4 : 0.75;
      ctx.fillStyle = this.hexToRgba(color, bgOpacity);
      ctx.fillRect(bgX, bgY, bgWidth, levelHeight);

      // In simplified mode, add a thin border to separate levels
      if (!fullMode && level.total_volume > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bgX, bgY, bgWidth, levelHeight);
      }

      // Border for imbalances
      if (this.config.showImbalances && imbalanceSet.has(i)) {
        ctx.strokeStyle = this.colors.IMBALANCE_BORDER;
        ctx.lineWidth = fullMode ? 2 : 1;
        ctx.strokeRect(bgX, bgY, bgWidth, levelHeight);
      }

      // POC marker
      if (this.config.showPOC && i === pocIndex) {
        ctx.strokeStyle = this.colors.POC_LINE;
        ctx.lineWidth = fullMode ? 2 : 1;
        ctx.setLineDash(fullMode ? [3, 2] : [2, 1]);
        ctx.beginPath();
        ctx.moveTo(bgX, y);
        ctx.lineTo(bgX + bgWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Text labels only in full mode
      if (fullMode) {
        ctx.font = `${this.config.fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (this.config.showBidAsk && bgWidth >= 50) {
          // Bid on left, Ask on right
          const bidX = bgX + bgWidth * 0.25;
          const askX = bgX + bgWidth * 0.75;

          // Bid (red side)
          ctx.fillStyle = this.colors.SELL_WEAK;
          this.drawTextWithShadow(ctx, this.formatVolume(level.bid_volume), bidX, y);

          // Ask (green side)
          ctx.fillStyle = this.colors.BUY_WEAK;
          this.drawTextWithShadow(ctx, this.formatVolume(level.ask_volume), askX, y);
        }

        if (this.config.showDelta && bgWidth >= 30) {
          // Delta in center
          const deltaX = bgX + bgWidth * 0.5;
          ctx.fillStyle = level.delta >= 0 ? this.colors.BUY_STRONG : this.colors.SELL_STRONG;

          // Only show delta if not showing bid/ask (to avoid overlap)
          if (!this.config.showBidAsk || bgWidth < 50) {
            const deltaText = level.delta >= 0 ? `+${this.formatVolume(level.delta)}` : this.formatVolume(level.delta);
            this.drawTextWithShadow(ctx, deltaText, deltaX, y);
          }
        }
      }
    }

    // Draw total delta at bottom of candle (only in full mode)
    if (fullMode) {
      const totalDelta = footprint.total_delta;
      if (this.config.showDelta && Math.abs(totalDelta) > 0.01) {
        const bottomY = priceToY(footprint.candle_low) + 25;
        ctx.font = `bold ${this.config.fontSize + 2}px Arial`;
        ctx.fillStyle = totalDelta >= 0 ? this.colors.BUY_STRONG : this.colors.SELL_STRONG;
        ctx.textAlign = 'center';
        const deltaText = totalDelta >= 0 ? `+${this.formatVolume(totalDelta)}` : this.formatVolume(totalDelta);
        this.drawTextWithShadow(ctx, deltaText, x + width / 2, bottomY);
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
}

export default OrderFlowIndicator;
