// src/components/indicators/SwingDetectorIndicator.js

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import IndicatorCache from '../../utils/IndicatorCache.js';

/**
 * SwingDetectorIndicator - Simple swing high/low visualization
 *
 * Fetches swing signals from backend and displays as simple arrow markers.
 * Also displays price zones as translucent background rectangles.
 * No local detection - all signals come from backend SwingService.
 */
class SwingDetectorIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Swing Detector";
    this.signals = [];
    this.priceZones = [];
    this.config = this.loadConfig();
    this.height = 0; // Overlay on main chart, no separate pane

    // Polling interval (backend detects, we just display)
    this.lastFetchTime = 0;
    this.lastStatusFetchTime = 0;
    this.fetchIntervalMs = 30000; // Poll signals every 30 seconds (was 5s - too aggressive)
    this.statusFetchIntervalMs = 60000; // Poll status/zones every 60 seconds (was 10s)
    this.isFetchingSignals = false; // Prevent concurrent fetches
    this.isFetchingStatus = false;
    this._pollingInterval = null; // For proper cleanup

    // Colors
    this.colors = {
      SWING_LOW: '#00E676',   // Green for LONG
      SWING_HIGH: '#FF1744',  // Red for SHORT
      ZONE_LONG: 'rgba(76, 175, 80, 0.1)',    // Green zone
      ZONE_SHORT: 'rgba(244, 67, 54, 0.1)',   // Red zone
      ZONE_BOTH: 'rgba(255, 152, 0, 0.1)'     // Orange zone
    };

    console.log(`[${this.symbol}] SwingDetectorIndicator initialized`);
  }

  loadConfig() {
    const saved = localStorage.getItem(`swing_detector_config_${this.symbol}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to load swing detector config:', e);
      }
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      enabled: true,
      // Arrow style
      arrowSize: 10,
      arrowOffset: 8,
      longColor: '#00E676',
      shortColor: '#FF1744',
      // Display options
      showVolumeZScore: false,
      showZones: true
    };
  }

  updateConfig(config) {
    this.config = config;
    localStorage.setItem(`swing_detector_config_${this.symbol}`, JSON.stringify(config));
    console.log(`[${this.symbol}] SwingDetector config updated`);
  }

  /**
   * Sync days with backend when chart days change
   */
  async syncDaysWithBackend(newDays) {
    if (this.days === newDays) return;

    this.days = newDays;
    console.log(`[${this.symbol}] SwingDetector syncing days to backend: ${newDays}`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/swing/config/${this.symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: newDays })
      });

      if (response.ok) {
        console.log(`[${this.symbol}] SwingDetector days synced to ${newDays}`);
        // Force refresh signals after days change
        await this.fetchSignals(true);
      }
    } catch (error) {
      console.error(`[${this.symbol}] Failed to sync days:`, error);
    }
  }

  async fetchData() {
    // Sync days with backend first to ensure signals cover the requested period
    await this._syncDaysOnInit();

    // Initial fetch of signals and status
    await Promise.all([
      this.fetchSignals(),
      this.fetchStatus()
    ]);

    // Start polling for updates
    this._startPolling();
  }

  /**
   * Sync days with backend on init (without checking if changed)
   */
  async _syncDaysOnInit() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/swing/config/${this.symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: this.days })
      });

      if (response.ok) {
        console.log(`[${this.symbol}] SwingDetector initialized with ${this.days} days`);
      }
    } catch (error) {
      console.warn(`[${this.symbol}] Failed to sync days on init:`, error);
    }
  }

  _startPolling() {
    // Clear any existing interval
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
    }

    // Poll signals at configured interval
    this._pollingInterval = setInterval(() => {
      if (this.enabled && this.config.enabled) {
        this.fetchSignals();
      }
    }, this.fetchIntervalMs);

    // Poll status less frequently
    this._statusPollingInterval = setInterval(() => {
      if (this.enabled && this.config.enabled) {
        this.fetchStatus();
      }
    }, this.statusFetchIntervalMs);
  }

  destroy() {
    // Clean up polling intervals
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
    if (this._statusPollingInterval) {
      clearInterval(this._statusPollingInterval);
      this._statusPollingInterval = null;
    }
  }

  async fetchSignals(forceRefresh = false) {
    // Prevent concurrent fetches
    if (this.isFetchingSignals) return;
    this.isFetchingSignals = true;
    this.lastFetchTime = Date.now(); // Update immediately to prevent re-entry

    try {
      // 🔄 FASE 4: Verificar cache primero (skip si forceRefresh)
      if (!forceRefresh) {
        const cached = await IndicatorCache.get('swing', this.symbol, this.interval);
        if (cached) {
          this.signals = cached;
          return; // Usar datos cacheados
        }
      }

      const response = await fetch(`${API_BASE_URL}/api/swing/signals/${this.symbol}`);

      if (!response.ok) {
        console.warn(`[${this.symbol}] SwingDetector fetch failed: ${response.status}`);
        return;
      }

      const data = await response.json();
      this.signals = data.signals || [];

      // Guardar en cache
      if (this.signals.length > 0) {
        IndicatorCache.set('swing', this.symbol, this.interval, this.signals);
        console.log(`[${this.symbol}] SwingDetector: ${this.signals.length} signals (cached)`);
      }
    } catch (error) {
      console.error(`[${this.symbol}] SwingDetector fetch error:`, error);
    } finally {
      this.isFetchingSignals = false;
    }
  }

  async fetchStatus() {
    // Prevent concurrent fetches
    if (this.isFetchingStatus) return;
    this.isFetchingStatus = true;
    this.lastStatusFetchTime = Date.now(); // Update immediately to prevent re-entry

    try {
      const response = await fetch(`${API_BASE_URL}/api/swing/status`);

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      // Filter zones by this symbol (zones without symbol field apply to all for backwards compatibility)
      const allZones = data.priceZones || [];
      this.priceZones = allZones.filter(z => !z.symbol || z.symbol === this.symbol);
    } catch (error) {
      console.error(`[${this.symbol}] SwingDetector status error:`, error);
    } finally {
      this.isFetchingStatus = false;
    }
  }

  // Called by IndicatorManager on each render
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || !this.config.enabled) {
      return;
    }

    // 🚀 OPTIMIZADO: No hacer fetch aquí - se hace via setInterval en _startPolling()
    // Esto elimina Date.now() y comparaciones en cada frame (~60 veces/segundo)

    // Helper function to convert price to Y coordinate
    // Use priceContext.priceToY if available (properly anchored to chart)
    const priceToY = (price) => {
      if (!priceContext) return bounds.y;
      if (priceContext.priceToY) {
        return priceContext.priceToY(price);
      }
      // Fallback calculation
      const { minPrice, maxPrice } = priceContext;
      return bounds.y + ((maxPrice - price) / (maxPrice - minPrice)) * bounds.height;
    };

    // Draw price zones first (behind everything else)
    if (this.config.showZones !== false && this.priceZones.length > 0) {
      this.renderZones(ctx, bounds, priceToY);
    }

    // Then draw signals
    if (this.signals.length === 0) {
      return;
    }

    // Create map of signals by timestamp
    const signalMap = new Map();
    for (const signal of this.signals) {
      signalMap.set(signal.timestamp, signal);
    }

    const candleWidth = bounds.width / visibleCandles.length;

    // Render signals on visible candles
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const signal = signalMap.get(candle.timestamp);

      if (!signal) continue;

      const x = bounds.x + i * candleWidth + candleWidth / 2;
      const highY = priceToY(candle.high);
      const lowY = priceToY(candle.low);

      this.drawSwingArrow(ctx, x, highY, lowY, signal);
    }
  }

  renderZones(ctx, bounds, priceToY) {
    ctx.save();

    for (const zone of this.priceZones) {
      if (zone.enabled === false) continue;

      const minY = priceToY(zone.max); // max price = higher on screen = lower Y
      const maxY = priceToY(zone.min); // min price = lower on screen = higher Y
      const height = maxY - minY;

      // Skip if zone is completely outside visible area
      if (maxY < bounds.y || minY > bounds.y + bounds.height) continue;

      // Clip to bounds
      const clippedMinY = Math.max(minY, bounds.y);
      const clippedMaxY = Math.min(maxY, bounds.y + bounds.height);
      const clippedHeight = clippedMaxY - clippedMinY;

      // Choose color based on direction
      let fillColor;
      let borderColor;
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

      // Draw filled rectangle
      ctx.fillStyle = fillColor;
      ctx.fillRect(bounds.x, clippedMinY, bounds.width, clippedHeight);

      // Draw border lines at top and bottom
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);

      // Top border (max price)
      if (minY >= bounds.y && minY <= bounds.y + bounds.height) {
        ctx.beginPath();
        ctx.moveTo(bounds.x, minY);
        ctx.lineTo(bounds.x + bounds.width, minY);
        ctx.stroke();
      }

      // Bottom border (min price)
      if (maxY >= bounds.y && maxY <= bounds.y + bounds.height) {
        ctx.beginPath();
        ctx.moveTo(bounds.x, maxY);
        ctx.lineTo(bounds.x + bounds.width, maxY);
        ctx.stroke();
      }

      ctx.setLineDash([]);

      // Draw zone label on the right side
      const labelY = clippedMinY + clippedHeight / 2;
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'right';
      ctx.fillStyle = borderColor.replace('0.4', '0.9');

      const label = `${zone.direction || 'BOTH'} Zone`;
      const priceLabel = `$${zone.min?.toLocaleString()} - $${zone.max?.toLocaleString()}`;

      // Background for text
      const textWidth = Math.max(ctx.measureText(label).width, ctx.measureText(priceLabel).width) + 8;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(bounds.x + bounds.width - textWidth - 4, labelY - 16, textWidth + 4, 28);

      // Text
      ctx.fillStyle = zone.direction === 'LONG' ? '#4CAF50' : zone.direction === 'SHORT' ? '#f44336' : '#FF9800';
      ctx.fillText(label, bounds.x + bounds.width - 6, labelY - 4);
      ctx.fillStyle = '#fff';
      ctx.font = '9px Arial';
      ctx.fillText(priceLabel, bounds.x + bounds.width - 6, labelY + 8);
    }

    ctx.restore();
  }

  drawSwingArrow(ctx, x, highY, lowY, signal) {
    const isLong = signal.type === 'SWING_LOW';

    // Get style from config
    const size = this.config.arrowSize || 10;
    const offset = this.config.arrowOffset || 8;
    const longColor = this.config.longColor || this.colors.SWING_LOW;
    const shortColor = this.config.shortColor || this.colors.SWING_HIGH;
    const color = isLong ? longColor : shortColor;

    // Position: SWING_LOW below the minimum, SWING_HIGH above the maximum
    // Note: in canvas Y grows downward, so lowY > highY
    const arrowY = isLong ? lowY + offset + size : highY - offset - size;

    ctx.save();

    // Alpha based on volume z-score (higher = more prominent)
    const zScore = signal.volumeZScore || 0;
    const alpha = Math.min(0.95, 0.6 + zScore * 0.1);

    // Draw arrow
    ctx.beginPath();
    if (isLong) {
      // Arrow pointing UP (LONG) - below the low
      ctx.moveTo(x, arrowY - size);                    // Top point
      ctx.lineTo(x - size * 0.6, arrowY + size * 0.4); // Bottom left
      ctx.lineTo(x + size * 0.6, arrowY + size * 0.4); // Bottom right
    } else {
      // Arrow pointing DOWN (SHORT) - above the high
      ctx.moveTo(x, arrowY + size);                    // Bottom point
      ctx.lineTo(x - size * 0.6, arrowY - size * 0.4); // Top left
      ctx.lineTo(x + size * 0.6, arrowY - size * 0.4); // Top right
    }
    ctx.closePath();

    // Fill
    ctx.fillStyle = this.hexToRgba(color, alpha);
    ctx.fill();

    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Optional: Show volume z-score as small text
    if (this.config.showVolumeZScore && zScore > 0) {
      ctx.font = 'bold 8px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      const textY = isLong ? arrowY + size + 10 : arrowY - size - 5;
      ctx.strokeText(`z${zScore.toFixed(1)}`, x, textY);
      ctx.fillText(`z${zScore.toFixed(1)}`, x, textY);
    }

    ctx.restore();
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // No separate pane rendering needed
  render(ctx, bounds) {
    // This indicator only uses overlay
    return;
  }
}

export default SwingDetectorIndicator;
