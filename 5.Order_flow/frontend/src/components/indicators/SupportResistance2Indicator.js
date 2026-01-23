// src/components/indicators/SupportResistance2Indicator.js
// Support & Resistance v2 - Basado en Swing Points
// Detecta niveles S&R usando swings confirmados y clustering

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";
import IndicatorCache from '../../utils/IndicatorCache.js';

class SupportResistance2Indicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "S&R v2";
    this.height = 0; // Overlay on main chart

    console.log(`%c[SupportResistance2Indicator] VERSION 1.0 - Swing-based S&R`, 'background: #9C27B0; color: white; font-weight: bold; padding: 4px;');

    // Configuracion de deteccion (enviada al backend)
    this.swingBars = 3;           // Barras a cada lado para confirmar swing (menor = mas sensible)
    this.clusterDistancePct = 0.5; // % para agrupar swings cercanos (mayor = agrupa mas)
    this.minTouches = 2;          // Minimo de toques para nivel valido
    this.maxLevels = 5;           // Maximo de niveles por tipo (menos = solo los mejores)
    this.priceRangePct = 3.0;     // % arriba/abajo del precio actual (menor = mas cercanos)
    this.minVolumeZscore = 0.0;   // Z-score minimo de volumen (0 = sin filtro)

    // Visualizacion
    this.showResistances = true;
    this.showSupports = true;
    this.showLabels = true;
    this.lineWidth = 2;

    // Datos
    this.resistances = [];
    this.supports = [];
    this.currentPrice = 0;
    this.stats = {};

    // Control de polling
    this._pollingInterval = null;
    this._destroyed = false;
    this.fetchIntervalMs = 60000; // 1 minuto

    // Flags de logging
    this._renderLoggedOnce = false;
  }

  /**
   * 🛑 Detiene el polling (llamado cuando el chart no es visible)
   */
  stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
      console.log(`[${this.symbol}] S&R v2 polling stopped`);
    }
  }

  destroy() {
    this._destroyed = true;
    this.stopPolling();
    console.log(`[${this.symbol}] S&R v2 destroyed`);
  }

  _startPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
    }

    this._pollingInterval = setInterval(async () => {
      if (this.enabled && !this._destroyed) {
        const updated = await this.fetchData(true); // skipCache = true
        // Disparar redraw si hay datos nuevos y tenemos referencia al manager
        if (updated && this.indicatorManager?.requestRedraw) {
          this.indicatorManager.requestRedraw();
        }
      }
    }, this.fetchIntervalMs);

    console.log(`[${this.symbol}] S&R v2 polling started (interval: ${this.fetchIntervalMs}ms)`);
  }

  startPollingIfReady() {
    if (!this._pollingInterval && this.enabled && !this._destroyed) {
      this._startPolling();
    }
  }

  /**
   * Fetch S&R v2 data from backend
   * @param {boolean} skipCache - Si true, ignora cache y fuerza fetch del backend
   */
  async fetchData(skipCache = false) {
    if (this._destroyed) {
      return false;
    }

    try {
      const cacheParams = {
        swingBars: this.swingBars,
        minTouches: this.minTouches,
        days: this.days
      };

      // Solo usar cache si no es polling
      if (!skipCache) {
        const cached = await IndicatorCache.get('sr2', this.symbol, this.interval, cacheParams);
        if (cached && !this._destroyed) {
          this.resistances = cached.resistances || [];
          this.supports = cached.supports || [];
          this.currentPrice = cached.currentPrice || 0;
          this.stats = cached.stats || {};
          console.log(`[${this.symbol}] S&R v2 from cache: ${this.resistances.length}R, ${this.supports.length}S`);
          return true;
        }
      }

      const params = new URLSearchParams({
        interval: this.interval,
        days: this.days.toString(),
        swing_bars: this.swingBars.toString(),
        cluster_distance_pct: this.clusterDistancePct.toString(),
        min_touches: this.minTouches.toString(),
        max_levels: this.maxLevels.toString(),
        price_range_pct: this.priceRangePct.toString(),
        min_volume_zscore: this.minVolumeZscore.toString()
      });

      const url = `${API_BASE_URL}/api/sr2/${this.symbol}?${params}`;

      if (!skipCache) {
        console.log(`[${this.symbol}] S&R v2: Fetching from backend...`);
      }

      const response = await fetch(url);

      if (this._destroyed) {
        return false;
      }

      const result = await response.json();

      if (result.success && result.data) {
        this.resistances = result.data.resistances || [];
        this.supports = result.data.supports || [];
        this.currentPrice = result.data.currentPrice || 0;
        this.stats = result.data.stats || {};

        // Guardar en cache solo si no es polling
        if (!skipCache) {
          IndicatorCache.set('sr2', this.symbol, this.interval, result.data, cacheParams);
        }

        if (skipCache) {
          console.log(`[${this.symbol}] S&R v2 updated (polling): ${this.resistances.length}R, ${this.supports.length}S`);
        } else {
          console.log(`[${this.symbol}] S&R v2 loaded: ${this.resistances.length}R, ${this.supports.length}S`);
        }

        return true;
      } else {
        console.warn(`[${this.symbol}] S&R v2: No data available`);
        this.clearData();
        return false;
      }
    } catch (error) {
      if (!this._destroyed) {
        console.error(`[${this.symbol}] S&R v2 fetch error:`, error);
      }
      return false;
    }
  }

  clearData() {
    this.resistances = [];
    this.supports = [];
    this.currentPrice = 0;
    this.stats = {};
  }

  setDays(days) {
    if (this.days !== days) {
      this.days = days;
      console.log(`[${this.symbol}] S&R v2: Days updated to ${days}`);
    }
  }

  setInterval(newInterval) {
    if (this.interval !== newInterval) {
      console.log(`[${this.symbol}] S&R v2: Interval updated ${this.interval} -> ${newInterval}`);
      this.interval = newInterval;
      this.clearData();
    }
  }

  /**
   * Renderiza los niveles de S/R sobre el precio (main chart)
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled || this._destroyed) {
      return;
    }

    if (this.resistances.length === 0 && this.supports.length === 0) {
      return;
    }

    // DEBUG: Solo log una vez
    if (!this._renderLoggedOnce) {
      console.log(`[${this.symbol}] S&R v2 renderOverlay:`, {
        resistances: this.resistances.length,
        supports: this.supports.length,
        currentPrice: this.currentPrice?.toFixed(2)
      });
      this._renderLoggedOnce = true;
    }

    const { x, y, width, height } = bounds;
    const priceToY = priceContext ? priceContext.priceToY : null;

    if (!priceToY) {
      console.warn(`[${this.symbol}] S&R v2: No priceToY function!`);
      return;
    }

    // Dibujar resistencias
    if (this.showResistances) {
      this.resistances.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, 'resistance');
      });
    }

    // Dibujar soportes
    if (this.showSupports) {
      this.supports.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, 'support');
      });
    }
  }

  /**
   * Renderiza un nivel de soporte o resistencia
   */
  renderLevel(ctx, level, bounds, priceToY, type) {
    const { x, y, width, height } = bounds;
    const price = level.price;
    const priceY = priceToY(price);

    // Verificar si el nivel esta dentro del area visible
    if (priceY < y || priceY > y + height) {
      return;
    }

    // Color y estilo basado en tipo y status
    let color, alpha, lineStyle, lineWidthMult;

    const status = level.status || 'active';

    if (status === 'broken') {
      // Niveles rotos: punteados con espacios grandes, mas tenues
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 0.4;
      lineStyle = [8, 6];  // Linea larga, espacio largo
      lineWidthMult = 0.6;
    } else if (status === 'tested') {
      // Niveles testeados: punteados cortos
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 0.6;
      lineStyle = [4, 4];  // Linea corta, espacio corto
      lineWidthMult = 0.8;
    } else {
      // Niveles activos: SOLIDOS, gruesos y prominentes
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 1.0;
      lineStyle = [];  // Sin punteado = linea solida
      lineWidthMult = 1.2;
    }

    // Grosor basado en strength (1-10 -> 1-4px)
    const strength = level.strength || 5;
    const baseWidth = Math.max(1, Math.min(4, strength / 2.5));
    const finalWidth = baseWidth * lineWidthMult;

    // Dibujar linea
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = finalWidth;
    ctx.setLineDash(lineStyle);

    ctx.beginPath();
    ctx.moveTo(x, priceY);
    ctx.lineTo(x + width, priceY);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    // Label
    if (this.showLabels && status !== 'broken') {
      const touches = level.touches || 0;
      const strengthStr = strength.toFixed(1);
      const prefix = type === 'resistance' ? 'R' : 'S';
      const labelText = `${prefix} $${price.toFixed(4)} | ${touches}x | Str:${strengthStr}`;

      ctx.font = "bold 10px Inter, sans-serif";

      // Fondo para el label
      const metrics = ctx.measureText(labelText);
      const labelWidth = metrics.width + 8;
      const labelHeight = 16;
      const labelX = x + width - labelWidth - 5;
      const labelY = priceY - labelHeight / 2;

      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

      ctx.fillStyle = color;
      ctx.fillText(labelText, labelX + 4, priceY + 4);
    }
  }

  /**
   * Actualiza configuracion
   */
  updateConfig(config) {
    let needsRefetch = false;

    if (config.swingBars !== undefined && config.swingBars !== this.swingBars) {
      this.swingBars = config.swingBars;
      needsRefetch = true;
    }
    if (config.clusterDistancePct !== undefined && config.clusterDistancePct !== this.clusterDistancePct) {
      this.clusterDistancePct = config.clusterDistancePct;
      needsRefetch = true;
    }
    if (config.minTouches !== undefined && config.minTouches !== this.minTouches) {
      this.minTouches = config.minTouches;
      needsRefetch = true;
    }
    if (config.maxLevels !== undefined && config.maxLevels !== this.maxLevels) {
      this.maxLevels = config.maxLevels;
      needsRefetch = true;
    }
    if (config.priceRangePct !== undefined && config.priceRangePct !== this.priceRangePct) {
      this.priceRangePct = config.priceRangePct;
      needsRefetch = true;
    }
    if (config.minVolumeZscore !== undefined && config.minVolumeZscore !== this.minVolumeZscore) {
      this.minVolumeZscore = config.minVolumeZscore;
      needsRefetch = true;
    }
    if (config.days !== undefined && config.days !== this.days) {
      this.days = config.days;
      needsRefetch = true;
    }

    // Visual config (no requiere refetch)
    if (config.showResistances !== undefined) this.showResistances = config.showResistances;
    if (config.showSupports !== undefined) this.showSupports = config.showSupports;
    if (config.showLabels !== undefined) this.showLabels = config.showLabels;

    if (needsRefetch && this.enabled) {
      console.log(`[${this.symbol}] S&R v2: Config changed, refetching...`);
      this._renderLoggedOnce = false;
      this.fetchData();
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.fetchData();
    }
  }

  /**
   * No renderiza en el panel de indicadores (se dibuja sobre el chart)
   */
  render(ctx, bounds, visibleCandles) {
    // Nada - se dibuja en renderOverlay
  }

  getHeight() {
    return 0; // No ocupa espacio en el panel de indicadores
  }

  /**
   * Obtiene todos los niveles para uso por otros componentes
   */
  getAllLevels() {
    return {
      resistances: this.resistances,
      supports: this.supports,
      currentPrice: this.currentPrice
    };
  }
}

export default SupportResistance2Indicator;
