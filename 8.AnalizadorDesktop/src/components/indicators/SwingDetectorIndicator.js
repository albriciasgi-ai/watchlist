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

    console.log(`[${this.symbol}] [SWING] CONSTRUCTOR: enabled=${this.enabled}, config.enabled=${this.config?.enabled}, interval=${this.interval}, days=${this.days}`);
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
    console.log(`[${this.symbol}] [SWING] fetchData() INICIO - enabled=${this.enabled}`);

    // Verificar si el servicio backend esta corriendo, si no, habilitarlo
    await this._ensureBackendRunning();

    // Sync days with backend first to ensure signals cover the requested period
    await this._syncDaysOnInit();

    // Initial fetch of signals and status
    await Promise.all([
      this.fetchSignals(),
      this.fetchStatus()
    ]);

    console.log(`[${this.symbol}] [SWING] fetchData() FIN - signals=${this.signals.length}, zones=${this.priceZones.length}`);

    // NO iniciar polling aqui - se iniciara despues de carga completa
    // via startPollingIfReady() llamado desde IndicatorManager
  }

  /**
   * Verifica si el backend swing service esta corriendo.
   * Si no lo esta, envia enabled=true para auto-iniciarlo y espera a que arranque.
   */
  async _ensureBackendRunning() {
    try {
      const statusRes = await fetch(`${API_BASE_URL}/api/swing/status`);
      if (!statusRes.ok) return;

      const status = await statusRes.json();
      if (status.running) {
        console.log(`[${this.symbol}] [SWING] Backend service already running`);
        return;
      }

      // Servicio no esta corriendo - habilitarlo
      console.log(`[${this.symbol}] [SWING] Backend service NOT running (enabled=${status.enabled}), auto-starting...`);
      const configRes = await fetch(`${API_BASE_URL}/api/swing/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });

      if (!configRes.ok) return;

      console.log(`[${this.symbol}] [SWING] Sent enabled=true to backend, waiting for service to start...`);

      // Esperar hasta 10 segundos a que el servicio arranque
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const checkRes = await fetch(`${API_BASE_URL}/api/swing/status`);
          if (checkRes.ok) {
            const checkStatus = await checkRes.json();
            console.log(`[${this.symbol}] [SWING] Auto-start check ${i + 1}/5: running=${checkStatus.running}`);
            if (checkStatus.running) {
              console.log(`[${this.symbol}] [SWING] Backend service started successfully`);
              return;
            }
          }
        } catch (e) {
          // Ignorar errores de check, seguir esperando
        }
      }
      console.warn(`[${this.symbol}] [SWING] Backend service did not start after 10s, continuing anyway`);
    } catch (error) {
      console.warn(`[${this.symbol}] [SWING] _ensureBackendRunning error:`, error);
    }
  }

  /**
   * 🚀 Inicia polling solo si está listo (llamado después de carga completa)
   */
  startPollingIfReady() {
    console.log(`[${this.symbol}] SwingDetector startPollingIfReady: interval=${!!this._pollingInterval}, enabled=${this.enabled}`);
    if (!this._pollingInterval && this.enabled) {
      this._startPolling();
    }
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
    this._pollingInterval = setInterval(async () => {
      if (this.enabled) {
        const updated = await this.fetchSignals();
        // Disparar redraw si hay datos nuevos y tenemos referencia al manager
        if (updated && this.indicatorManager?.requestRedraw) {
          this.indicatorManager.requestRedraw();
        }
      }
    }, this.fetchIntervalMs);

    // Poll status less frequently
    this._statusPollingInterval = setInterval(() => {
      if (this.enabled) {
        this.fetchStatus();
      }
    }, this.statusFetchIntervalMs);

    console.log(`[${this.symbol}] SwingDetector polling started (signals: ${this.fetchIntervalMs}ms, status: ${this.statusFetchIntervalMs}ms)`);
  }

  /**
   * 🛑 Detiene el polling (llamado cuando el chart no es visible)
   */
  stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
      console.log(`[${this.symbol}] SwingDetector signal polling stopped`);
    }
    if (this._statusPollingInterval) {
      clearInterval(this._statusPollingInterval);
      this._statusPollingInterval = null;
      console.log(`[${this.symbol}] SwingDetector status polling stopped`);
    }
  }

  destroy() {
    // Clean up polling intervals
    this.stopPolling();
  }

  async fetchSignals(forceRefresh = false) {
    // Prevent concurrent fetches
    if (this.isFetchingSignals) {
      console.log(`[${this.symbol}] [SWING] fetchSignals() SKIP - ya fetching`);
      return false;
    }
    this.isFetchingSignals = true;
    this.lastFetchTime = Date.now(); // Update immediately to prevent re-entry

    try {
      // 🔄 FASE 4: Verificar cache primero (skip si forceRefresh)
      if (!forceRefresh) {
        const cached = await IndicatorCache.get('swing', this.symbol, this.interval);
        if (cached) {
          this.signals = cached;
          console.log(`[${this.symbol}] [SWING] fetchSignals() CACHE HIT: ${cached.length} signals`);
          return true; // Usar datos cacheados
        }
      }

      const url = `${API_BASE_URL}/api/swing/signals/${this.symbol}`;
      console.log(`[${this.symbol}] [SWING] fetchSignals() fetching: ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`[${this.symbol}] [SWING] fetchSignals() FAILED: HTTP ${response.status}`);
        return false;
      }

      const data = await response.json();
      const allSignals = data.signals || [];

      // Filtrar senales por el interval actual del chart
      this.signals = allSignals.filter(s => s.interval === this.interval);

      console.log(`[${this.symbol}] [SWING] fetchSignals() OK: ${this.signals.length}/${allSignals.length} signals match interval=${this.interval}`);
      if (allSignals.length > 0 && this.signals.length === 0) {
        // Mostrar que intervals tienen las senales para diagnosticar
        const intervals = [...new Set(allSignals.map(s => s.interval))];
        console.warn(`[${this.symbol}] [SWING] Senales existen para intervals: [${intervals.join(', ')}] pero chart usa interval=${this.interval}`);
      }

      // Guardar en cache
      if (this.signals.length > 0) {
        IndicatorCache.set('swing', this.symbol, this.interval, this.signals);
      }
      return true;
    } catch (error) {
      console.error(`[${this.symbol}] [SWING] fetchSignals() ERROR:`, error);
      return false;
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
        console.warn(`[${this.symbol}] [SWING] fetchStatus() FAILED: HTTP ${response.status}`);
        return;
      }

      const data = await response.json();
      // Filter zones by this symbol (zones without symbol field apply to all for backwards compatibility)
      const allZones = data.priceZones || [];
      this.priceZones = allZones.filter(z => !z.symbol || z.symbol === this.symbol);
      console.log(`[${this.symbol}] [SWING] fetchStatus() OK: ${this.priceZones.length} zones (service enabled=${data.enabled}, running=${data.running})`);
    } catch (error) {
      console.error(`[${this.symbol}] [SWING] fetchStatus() ERROR:`, error);
    } finally {
      this.isFetchingStatus = false;
    }
  }

  // Called by IndicatorManager on each render
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) {
      return;
    }

    // Log detallado una vez por segundo para no saturar consola
    if (!this._lastRenderLog || Date.now() - this._lastRenderLog > 1000) {
      this._lastRenderLog = Date.now();
      console.log(`[${this.symbol}] [SWING] renderOverlay: signals=${this.signals.length}, zones=${this.priceZones.length}, visibleCandles=${visibleCandles?.length}, hasPriceContext=${!!priceContext}`);
    }

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

    // Contar matches para logging
    let matchCount = 0;

    // Render signals on visible candles
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      const signal = signalMap.get(candle.timestamp);

      if (!signal) continue;

      matchCount++;
      const x = bounds.x + i * candleWidth + candleWidth / 2;
      const highY = priceToY(candle.high);
      const lowY = priceToY(candle.low);

      this.drawSwingArrow(ctx, x, highY, lowY, signal);
    }

    // Log matches una vez por segundo
    if (!this._lastMatchLog || Date.now() - this._lastMatchLog > 1000) {
      this._lastMatchLog = Date.now();
      if (matchCount > 0) {
        console.log(`[${this.symbol}] [SWING] RENDERED ${matchCount} arrows on chart`);
      } else if (this.signals.length > 0) {
        // Hay senales pero ninguna coincide con las velas visibles - diagnosticar
        const signalTsRange = { min: Math.min(...this.signals.map(s => s.timestamp)), max: Math.max(...this.signals.map(s => s.timestamp)) };
        const candleTsRange = { min: visibleCandles[0]?.timestamp, max: visibleCandles[visibleCandles.length - 1]?.timestamp };
        console.warn(`[${this.symbol}] [SWING] 0 matches! Signal timestamps: ${new Date(signalTsRange.min).toLocaleString()}-${new Date(signalTsRange.max).toLocaleString()}, Candle timestamps: ${new Date(candleTsRange.min).toLocaleString()}-${new Date(candleTsRange.max).toLocaleString()}`);
      }
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
