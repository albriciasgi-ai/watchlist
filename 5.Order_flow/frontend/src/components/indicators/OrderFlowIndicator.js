// src/components/indicators/OrderFlowIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';

/**
 * OrderFlowIndicator - Professional Footprint Chart Visualization
 *
 * Each candle unit consists of (left to right):
 * 1. Japanese Candle (thin, traditional)
 * 2. Volume Profile (horizontal bars per level)
 * 3. Footprint (bid|ask volumes per level)
 *
 * The entire unit scales proportionally with zoom.
 * This indicator REPLACES Japanese candles when enabled.
 */
class OrderFlowIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 1) {
    super(symbol, interval, days);
    this.name = "Order Flow";
    this.footprints = [];
    this.config = this.loadConfig();
    this.height = 0; // Overlay on main chart

    // Polling settings
    this.lastFetchTime = 0;
    this.fetchIntervalMs = 5000;
    this.isFetching = false;
    this._pollingInterval = null;
    this._destroyed = false;


    // Layout proportions (as fractions of total candle width)
    // Order: Candle | Footprint (bid|ask) | Volume Profile
    this.layout = {
      candlePct: 0.20,      // 20% for Japanese candle (doubled from 10%)
      footprintPct: 0.28,   // 28% for footprint (bid|ask) (halved from 55%)
      profilePct: 0.47,     // 47% for volume profile (rightmost)
      gapPct: 0.05          // 5% gaps between elements
    };

    // Colors
    this.colors = {
      // Volume Profile
      PROFILE_BAR: 'rgba(100, 149, 237, 0.7)',  // Cornflower blue
      PROFILE_POC: 'rgba(255, 215, 0, 0.9)',    // Gold for POC

      // Footprint backgrounds
      BID_BG_STRONG: 'rgba(183, 28, 28, 0.85)',   // Dark red
      BID_BG_WEAK: 'rgba(239, 154, 154, 0.6)',    // Light red
      ASK_BG_STRONG: 'rgba(27, 94, 32, 0.85)',    // Dark green
      ASK_BG_WEAK: 'rgba(165, 214, 167, 0.6)',    // Light green

      // Text
      TEXT: '#FFFFFF',
      TEXT_SHADOW: '#000000',

      // Candle colors
      CANDLE_UP: '#26A69A',
      CANDLE_DOWN: '#EF5350',
      CANDLE_WICK: '#666666',

      // POC and imbalances
      POC_LINE: '#FFD700',
      IMBALANCE_BORDER: '#FFD600'
    };

    console.log(`[${this.symbol}] OrderFlowIndicator initialized`);
  }

  loadConfig() {
    const saved = localStorage.getItem(`orderflow_config_${this.symbol}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all new properties exist
        const defaults = this.getDefaultConfig();
        const merged = { ...defaults, ...parsed };
        // Force enabled if it was somehow disabled
        merged.enabled = true;
        return merged;
      } catch (e) {
        console.error('Failed to load orderflow config:', e);
      }
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      enabled: true,
      showCandle: true,       // Show Japanese candle
      showProfile: true,      // Show volume profile
      showFootprint: true,    // Show bid/ask footprint
      showPOC: true,          // Highlight POC level
      showImbalances: true,   // Highlight imbalances
      showDelta: true,        // Show delta at bottom
      fontSize: 9,            // Slightly smaller font
      minCandleWidth: 15,     // Minimum width for basic display
      minCandleWidthFull: 80, // Width needed for full text display (increased)
      opacity: 0.9,
      historyHours: 12
    };
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
    localStorage.setItem(`orderflow_config_${this.symbol}`, JSON.stringify(this.config));
    console.log(`[${this.symbol}] OrderFlow config updated`);
  }

  setInterval(newInterval) {
    this.interval = newInterval;
    this.footprints = [];
    console.log(`[${this.symbol}] OrderFlow interval changed to ${newInterval}`);
  }

  async fetchData() {
    if (this._destroyed) return false;
    const success = await this.fetchFootprints();
    return success;
  }

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
    console.log(`[${this.symbol}] OrderFlow fetchFootprints called - interval=${this.interval}, type=${typeof this.interval}`);

    if (this._destroyed) {
      console.log(`[${this.symbol}] OrderFlow fetchFootprints - destroyed, skipping`);
      return false;
    }
    if (this.isFetching) {
      console.log(`[${this.symbol}] OrderFlow fetchFootprints - already fetching, skipping`);
      return false;
    }

    this.isFetching = true;
    this.lastFetchTime = Date.now();

    try {
      const supportedIntervals = ["1", "5"];
      console.log(`[${this.symbol}] OrderFlow checking interval: "${this.interval}" in [${supportedIntervals.join(', ')}] = ${supportedIntervals.includes(this.interval)}`);

      if (!supportedIntervals.includes(this.interval)) {
        console.warn(`[${this.symbol}] OrderFlow: Intervalo "${this.interval}" no soportado (solo 1, 5)`);
        this.footprints = [];
        return false;
      }

      const hours = this.config.historyHours || 12;
      const url = `${API_BASE_URL}/api/orderflow/footprint/${this.symbol}?interval=${this.interval}&limit=2000&hours=${hours}`;

      console.log(`[${this.symbol}] OrderFlow fetching: ${url}`);

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

      if (this.footprints.length > 0) {
        const firstTs = this.footprints[0].candle_timestamp;
        const lastTs = this.footprints[this.footprints.length - 1].candle_timestamp;
        console.log(`[${this.symbol}] OrderFlow: ${this.footprints.length} footprints loaded`);
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
   * Check if Order Flow should replace Japanese candles
   * Returns true only when we can actually render the full Order Flow
   * @param {number} candleWidth - Current width of each candle in pixels
   */
  shouldReplaceCandles(candleWidth = 0) {
    // Only replace candles if:
    // 1. Indicator is enabled
    // 2. Config is enabled
    // 3. We have footprint data
    // 4. Candle width is sufficient for Order Flow rendering
    const hasData = this.enabled && this.config.enabled && this.footprints.length > 0;
    const widthSufficient = candleWidth >= this.config.minCandleWidth;
    return hasData && widthSufficient;
  }

  /**
   * Main render method - draws the complete Order Flow unit for each candle
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !this.config.enabled) {
      console.log('[OrderFlow] renderOverlay - disabled');
      return;
    }

    if (this.footprints.length === 0 || visibleCandles.length === 0) {
      console.log(`[OrderFlow] renderOverlay - no data: footprints=${this.footprints.length}, visibleCandles=${visibleCandles.length}`);
      return;
    }

    const candleWidth = bounds.width / visibleCandles.length;
    console.log(`[OrderFlow] renderOverlay - candleWidth=${candleWidth.toFixed(1)}px, minWidth=${this.config.minCandleWidth}px, footprints=${this.footprints.length}`);

    // Minimum width check - if too small, don't render Order Flow
    // MiniChart will draw normal candles instead (shouldReplaceCandles returns false)
    if (candleWidth < this.config.minCandleWidth) {
      console.log('[OrderFlow] renderOverlay - width too small, skipping');
      return;
    }

    const fullMode = candleWidth >= this.config.minCandleWidthFull;

    // Price to Y conversion
    const priceToY = (price) => {
      if (!priceContext) return bounds.y;
      if (priceContext.priceToY) {
        return priceContext.priceToY(price);
      }
      const { minPrice, maxPrice } = priceContext;
      return bounds.y + ((maxPrice - price) / (maxPrice - minPrice)) * bounds.height;
    };

    // Create footprint map by timestamp
    const footprintMap = new Map();
    for (const fp of this.footprints) {
      footprintMap.set(fp.candle_timestamp, fp);
    }

    ctx.save();

    let matchCount = 0;
    let noMatchCount = 0;

    // Debug: log first few candle timestamps and footprint timestamps
    if (visibleCandles.length > 0 && this.footprints.length > 0) {
      const candleTs = visibleCandles.slice(0, 3).map(c => c.timestamp);
      const fpTs = this.footprints.slice(0, 3).map(f => f.candle_timestamp);
      console.log(`[OrderFlow] First candle timestamps: ${candleTs.join(', ')}`);
      console.log(`[OrderFlow] First footprint timestamps: ${fpTs.join(', ')}`);
    }

    // Render each visible candle
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const footprint = footprintMap.get(candle.timestamp);

      if (!footprint || !footprint.levels || footprint.levels.length === 0) {
        // No footprint data - draw simple candle
        noMatchCount++;
        this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
        continue;
      }

      matchCount++;

      const unitX = bounds.x + i * candleWidth;
      this.renderOrderFlowUnit(ctx, candle, footprint, unitX, candleWidth, priceToY, fullMode);
    }

    console.log(`[OrderFlow] renderOverlay complete - matches=${matchCount}, noMatch=${noMatchCount}`);

    ctx.restore();
  }

  /**
   * Render a simple Japanese candle when no footprint data is available
   */
  renderSimpleCandle(ctx, candle, x, width, priceToY) {
    const margin = width * 0.1;
    const bodyWidth = width - margin * 2;
    const centerX = x + width / 2;

    const isUp = candle.close >= candle.open;
    const color = isUp ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;

    const highY = priceToY(candle.high);
    const lowY = priceToY(candle.low);
    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);

    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    // Wick
    ctx.strokeStyle = this.colors.CANDLE_WICK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, highY);
    ctx.lineTo(centerX, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(x + margin, bodyTop, bodyWidth, bodyHeight);
  }

  /**
   * Render the complete Order Flow unit: Candle | Footprint | Volume Profile
   * Layout order (left to right): Japanese Candle, Footprint (bid|ask), Volume Profile
   */
  renderOrderFlowUnit(ctx, candle, footprint, unitX, unitWidth, priceToY, fullMode) {
    const levels = footprint.levels;
    const pocIndex = footprint.poc_index;

    // Calculate section widths based on layout proportions
    const gap = unitWidth * this.layout.gapPct / 3;

    // Candle section (leftmost)
    const candleWidth = unitWidth * this.layout.candlePct;
    const candleX = unitX + gap;

    // Footprint section (center) - bid|ask
    const footprintWidth = unitWidth * this.layout.footprintPct;
    const footprintX = candleX + candleWidth + gap;

    // Volume Profile section (rightmost)
    const profileWidth = unitWidth * this.layout.profilePct;
    const profileX = footprintX + footprintWidth + gap;

    // Find max volume for profile scaling AND extended price range from footprint levels
    let maxVolume = 0;
    let footprintHigh = candle.high;
    let footprintLow = candle.low;

    for (const level of levels) {
      if (level.total_volume > maxVolume) {
        maxVolume = level.total_volume;
      }
      // Extend range to include all footprint levels
      if (level.price_max > footprintHigh) {
        footprintHigh = level.price_max;
      }
      if (level.price_min < footprintLow) {
        footprintLow = level.price_min;
      }
    }

    // 1. Draw Japanese Candle (leftmost) - with extended wicks to match footprint range
    if (this.config.showCandle) {
      this.renderJapaneseCandle(ctx, candle, candleX, candleWidth, priceToY, footprintHigh, footprintLow);
    }

    // 2. Draw Footprint (Bid | Ask) - center
    if (this.config.showFootprint) {
      this.renderFootprint(ctx, footprint, footprintX, footprintWidth, priceToY, fullMode, candle);
    }

    // 3. Draw Volume Profile bars (rightmost)
    if (this.config.showProfile) {
      this.renderVolumeProfile(ctx, levels, pocIndex, profileX, profileWidth, priceToY, maxVolume, candle);
    }

    // 4. Draw Delta at bottom
    if (this.config.showDelta && fullMode) {
      this.renderDelta(ctx, footprint, unitX, unitWidth, levels, priceToY);
    }
  }

  /**
   * Render Japanese candle (thin traditional style)
   * @param {number} extendedHigh - Optional: extended high from footprint levels
   * @param {number} extendedLow - Optional: extended low from footprint levels
   */
  renderJapaneseCandle(ctx, candle, x, width, priceToY, extendedHigh = null, extendedLow = null) {
    const centerX = x + width / 2;
    const bodyWidth = Math.max(2, width * 0.6);

    const isUp = candle.close >= candle.open;
    const color = isUp ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;

    // Use extended range if provided (from footprint levels), otherwise use candle high/low
    const wickHigh = extendedHigh !== null ? extendedHigh : candle.high;
    const wickLow = extendedLow !== null ? extendedLow : candle.low;

    const highY = priceToY(wickHigh);
    const lowY = priceToY(wickLow);
    const openY = priceToY(candle.open);
    const closeY = priceToY(candle.close);

    const bodyTop = Math.min(openY, closeY);
    const bodyBottom = Math.max(openY, closeY);
    const bodyHeight = Math.max(1, bodyBottom - bodyTop);

    // Upper wick (extended to match footprint range)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, highY);
    ctx.lineTo(centerX, bodyTop);
    ctx.stroke();

    // Lower wick (extended to match footprint range)
    ctx.beginPath();
    ctx.moveTo(centerX, bodyBottom);
    ctx.lineTo(centerX, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);

    // Body border
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  }

  /**
   * Render Volume Profile (horizontal bars showing volume per level)
   * Bars grow from left to right (standard volume profile orientation)
   */
  renderVolumeProfile(ctx, levels, pocIndex, x, width, priceToY, maxVolume, candle) {
    if (maxVolume === 0) return;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      const levelTopY = priceToY(level.price_max);
      const levelBottomY = priceToY(level.price_min);
      const levelHeight = Math.abs(levelBottomY - levelTopY);

      if (levelHeight < 1) continue;

      const bgY = Math.min(levelTopY, levelBottomY);

      // Bar width proportional to volume
      const volumeRatio = level.total_volume / maxVolume;
      const barWidth = width * volumeRatio;

      // Color: POC is gold, others are blue
      const isPOC = i === pocIndex;
      ctx.fillStyle = isPOC ? this.colors.PROFILE_POC : this.colors.PROFILE_BAR;

      // Draw bar from left to right (grows toward price scale)
      ctx.fillRect(x, bgY, barWidth, Math.max(1, levelHeight - 1));

      // POC marker - horizontal line across the profile
      if (isPOC && this.config.showPOC) {
        ctx.strokeStyle = this.colors.POC_LINE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, bgY + levelHeight / 2);
        ctx.lineTo(x + barWidth, bgY + levelHeight / 2);
        ctx.stroke();
      }
    }
  }

  /**
   * Render Footprint (Bid | Ask volumes per level)
   */
  renderFootprint(ctx, footprint, x, width, priceToY, fullMode, candle) {
    const levels = footprint.levels;
    const pocIndex = footprint.poc_index;
    const imbalances = footprint.imbalances || [];
    const imbalanceSet = new Set(imbalances.map(ib => ib.level_index));

    const halfWidth = width / 2;
    const levelGap = 1;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];

      const levelTopY = priceToY(level.price_max);
      const levelBottomY = priceToY(level.price_min);
      const levelHeight = Math.abs(levelBottomY - levelTopY);

      if (levelHeight < 2) continue;

      const bgY = Math.min(levelTopY, levelBottomY);
      const priceMid = (level.price_min + level.price_max) / 2;
      const textY = priceToY(priceMid);

      // Determine dominant side
      const bidDominates = level.bid_volume > level.ask_volume;
      const askDominates = level.ask_volume > level.bid_volume;

      // Left side: BID
      const bidBg = bidDominates ? this.colors.BID_BG_STRONG : this.colors.BID_BG_WEAK;
      ctx.fillStyle = bidBg;
      ctx.fillRect(x, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // Right side: ASK
      const askBg = askDominates ? this.colors.ASK_BG_STRONG : this.colors.ASK_BG_WEAK;
      ctx.fillStyle = askBg;
      ctx.fillRect(x + halfWidth + 0.5, bgY, halfWidth - 0.5, levelHeight - levelGap);

      // Level border
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, bgY, width, levelHeight - levelGap);

      // Center divider
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + halfWidth, bgY);
      ctx.lineTo(x + halfWidth, bgY + levelHeight - levelGap);
      ctx.stroke();

      // POC marker
      if (this.config.showPOC && i === pocIndex) {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
        ctx.fillRect(x, textY - 1, width, 2);
      }

      // Imbalance border
      if (this.config.showImbalances && imbalanceSet.has(i)) {
        ctx.strokeStyle = this.colors.IMBALANCE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, bgY, width, levelHeight - levelGap);
      }

      // Text labels (only if enough space)
      const minHeightForText = fullMode ? 10 : 6;
      if (fullMode && width >= 30 && levelHeight >= minHeightForText) {
        const fontSize = Math.min(this.config.fontSize, levelHeight - 2, 11);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.colors.TEXT;

        // BID volume (left, right-aligned)
        if (level.bid_volume > 0) {
          ctx.textAlign = 'right';
          const bidText = this.formatVolume(level.bid_volume);
          this.drawTextWithShadow(ctx, bidText, x + halfWidth - 2, textY);
        }

        // ASK volume (right, left-aligned)
        if (level.ask_volume > 0) {
          ctx.textAlign = 'left';
          const askText = this.formatVolume(level.ask_volume);
          this.drawTextWithShadow(ctx, askText, x + halfWidth + 3, textY);
        }
      }
    }
  }

  /**
   * Render total delta at bottom of the unit
   */
  renderDelta(ctx, footprint, unitX, unitWidth, levels, priceToY) {
    const totalDelta = footprint.total_delta;
    if (Math.abs(totalDelta) < 0.001) return;

    // Position below the lowest level
    const lowestLevel = levels[0];
    const bottomY = priceToY(lowestLevel.price_min) + 14;

    ctx.font = `bold ${this.config.fontSize}px Arial`;
    ctx.fillStyle = totalDelta >= 0 ? this.colors.CANDLE_UP : this.colors.CANDLE_DOWN;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const deltaText = totalDelta >= 0 ? `+${this.formatVolume(totalDelta)}` : this.formatVolume(totalDelta);
    this.drawTextWithShadow(ctx, deltaText, unitX + unitWidth / 2, bottomY);
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

  // No separate pane rendering needed
  render(ctx, bounds) {
    return;
  }

  hasFootprintData() {
    const hasData = this.footprints && this.footprints.length > 0;
    if (!this._lastHasDataLog || Date.now() - this._lastHasDataLog > 5000) {
      console.log(`[${this.symbol}] OrderFlow hasFootprintData: ${hasData} (${this.footprints?.length || 0} footprints)`);
      this._lastHasDataLog = Date.now();
    }
    return hasData;
  }
}

export default OrderFlowIndicator;
