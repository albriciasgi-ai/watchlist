// src/components/indicators/SupportResistanceIndicator.js
// Support & Resistance Indicator con niveles detectados por volumen

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config";

class SupportResistanceIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 60) {
    super(symbol, interval, days);
    this.name = "Support & Resistance";
    this.height = 0; // No ocupa espacio propio, se dibuja sobre el chart
    this.days = days;

    console.log(`%c[SupportResistanceIndicator] VERSION 1.0 LOADED`, 'background: #4CAF50; color: white; font-weight: bold; padding: 4px;');

    // Configuración
    this.volumeMethod = "zscore";
    this.zScoreThreshold = 1.0;
    this.zScorePeriod = 50;
    this.leftBars = 12;
    this.rightBars = 12;
    this.minTouches = 2;
    this.clusterDistance = 0.5;
    this.maxLevels = 20;

    // Visualización
    this.showResistances = true;
    this.showSupports = true;
    this.showConsolidationZones = true;
    this.showLabels = true;
    this.lineWidth = 2;

    // Datos
    this.resistances = [];
    this.supports = [];
    this.consolidationZones = [];
    this.currentPrice = 0;
  }

  /**
   * Fetch Support & Resistance data from backend
   */
  async fetchData() {
    try {
      const params = new URLSearchParams({
        interval: this.interval,
        days: this.days.toString(),
        volume_method: this.volumeMethod,
        z_score_threshold: this.zScoreThreshold.toString(),
        z_score_period: this.zScorePeriod.toString(),
        left_bars: this.leftBars.toString(),
        right_bars: this.rightBars.toString(),
        min_touches: this.minTouches.toString(),
        cluster_distance: this.clusterDistance.toString(),
        max_levels: this.maxLevels.toString()
      });

      const url = `${API_BASE_URL}/api/support-resistance/${this.symbol}?${params}`;
      console.log(`[${this.symbol}] 📊 S/R: Fetching from ${url}`);

      const response = await fetch(url);
      const result = await response.json();

      if (result.success && result.data) {
        this.resistances = result.data.resistances || [];
        this.supports = result.data.supports || [];
        this.consolidationZones = result.data.consolidationZones || [];
        this.currentPrice = result.data.currentPrice || 0;

        console.log(`[${this.symbol}] ✅ S/R loaded: ${this.resistances.length} resistances, ${this.supports.length} supports, ${this.consolidationZones.length} zones`);

        // Check for price alerts
        this.checkPriceAlerts(this.currentPrice);

        return true;
      } else {
        console.warn(`[${this.symbol}] ⚠️ No S/R data available`);
        this.clearData();
        return false;
      }
    } catch (error) {
      console.error(`[${this.symbol}] ❌ Error fetching S/R:`, error);
      this.clearData();
      return false;
    }
  }

  /**
   * Carga datos desde precarga (S&R requiere cálculo en backend, solo guardamos candles)
   */
  setPreloadedData(data) {
    console.log(`[${this.symbol}] 💾 S&R: Datos precargados recibidos (${data ? data.length : 0} candles)`);
    // S&R requiere cálculo en backend, los datos precargados son solo candles históricas
    // No podemos calcular niveles localmente sin replicar la lógica del backend
    // Los niveles se calcularán cuando se active el indicador con fetchData()
    this.candles = data;
    this.lastFetch = Date.now();
    return true;
  }

  clearData() {
    this.resistances = [];
    this.supports = [];
    this.consolidationZones = [];
    this.currentPrice = 0;
  }

  /**
   * Renderiza los niveles de S/R sobre el precio (main chart)
   * IMPORTANTE: Este método se llama desde IndicatorManager.renderOverlays()
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) {
      return;
    }
    if (this.resistances.length === 0 && this.supports.length === 0) {
      return;
    }

    // DEBUG: Solo log una vez
    if (!this._renderLoggedOnce) {
      console.log(`[${this.symbol}] 🎨 renderOverlay called with:`, {
        resistances: this.resistances.length,
        supports: this.supports.length,
        hasPriceToY: !!priceContext?.priceToY,
        hasTimeToX: !!priceContext?.timeToX,
        bounds
      });
      this._renderLoggedOnce = true;
    }

    const { x, y, width, height } = bounds;

    // Extract priceToY and timeToX functions from priceContext
    const priceToY = priceContext ? priceContext.priceToY : null;
    const timeToX = priceContext ? priceContext.timeToX : null;

    if (!priceToY) {
      console.warn(`[${this.symbol}] ❌ No priceToY function in priceContext!`);
      return;
    }

    if (!timeToX) {
      console.warn(`[${this.symbol}] ❌ No timeToX function in priceContext!`);
      return;
    }

    // Dibujar zonas de consolidación primero (fondo)
    if (this.showConsolidationZones) {
      this.consolidationZones.forEach(zone => {
        this.renderConsolidationZone(ctx, zone, bounds, priceToY);
      });
    }

    // Dibujar resistencias
    if (this.showResistances) {
      this.resistances.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, timeToX, 'resistance');
      });
    }

    // Dibujar soportes
    if (this.showSupports) {
      this.supports.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, timeToX, 'support');
      });
    }
  }

  /**
   * Renderiza una zona de consolidación
   */
  renderConsolidationZone(ctx, zone, bounds, priceToY) {
    const { x, y, width, height } = bounds;

    const minPriceY = priceToY(zone.minPrice);
    const maxPriceY = priceToY(zone.maxPrice);

    // Rectángulo sombreado
    ctx.fillStyle = "rgba(156, 39, 176, 0.05)"; // Purple muy tenue
    ctx.fillRect(x, maxPriceY, width, minPriceY - maxPriceY);

    // Borde superior e inferior
    ctx.strokeStyle = "rgba(156, 39, 176, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(x, maxPriceY);
    ctx.lineTo(x + width, maxPriceY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, minPriceY);
    ctx.lineTo(x + width, minPriceY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Label de zona
    if (this.showLabels) {
      const labelY = (minPriceY + maxPriceY) / 2;
      ctx.fillStyle = "rgba(156, 39, 176, 0.7)";
      ctx.font = "10px Inter, sans-serif";
      const labelText = `Zone ${zone.rangePct.toFixed(1)}% • ${zone.numLevels} levels • Str: ${zone.avgStrength.toFixed(1)}`;
      ctx.fillText(labelText, x + 5, labelY);
    }
  }

  /**
   * Renderiza un nivel de soporte o resistencia
   * ✅ FIX: Ahora dibuja desde el punto de detección (lastTouch) hacia adelante
   */
  renderLevel(ctx, level, bounds, priceToY, timeToX, type) {
    const { x, y, width, height } = bounds;

    const priceY = priceToY(level.price);

    // ✅ FIX: Calcular coordenada X desde donde empieza el nivel (lastTouch)
    let startX = x; // Default: inicio del chart

    if (level.lastTouch) {
      const levelStartX = timeToX(level.lastTouch);
      // Si lastTouch está dentro del viewport visible, usar esa coordenada
      // Si está fuera a la izquierda, extender desde el borde izquierdo
      if (levelStartX !== null && levelStartX > x) {
        startX = levelStartX;
      }
    }

    const endX = x + width; // Siempre termina al final del chart

    // Color basado en tipo y estado
    let color, alpha, lineStyle;

    if (level.status === 'broken') {
      color = "#999"; // Gris
      alpha = 0.3;
      lineStyle = [4, 4]; // Punteado
    } else if (level.status === 'tested') {
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 0.5;
      lineStyle = [2, 2]; // Punteado fino
    } else { // active
      color = type === 'resistance' ? "#F44336" : "#4CAF50";
      alpha = 0.8;
      lineStyle = []; // Sólido
    }

    // Grosor basado en strength
    const lineWidth = Math.max(1, Math.min(4, level.strength / 2));

    // ✅ FIX: Dibujar línea desde startX (lastTouch) hasta endX (final del chart)
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(lineStyle);

    ctx.beginPath();
    ctx.moveTo(startX, priceY);
    ctx.lineTo(endX, priceY);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    // Label
    if (this.showLabels && level.status === 'active') {
      const labelText = `${type === 'resistance' ? 'R' : 'S'} $${level.price.toFixed(2)} • ${level.touches}x • ${level.strength.toFixed(1)}`;

      ctx.fillStyle = color;
      ctx.font = "bold 10px Inter, sans-serif";

      // Fondo para el label
      const metrics = ctx.measureText(labelText);
      const labelWidth = metrics.width + 8;
      const labelHeight = 16;
      const labelX = endX - labelWidth - 5;
      const labelY = priceY - labelHeight / 2;

      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

      ctx.fillStyle = color;
      ctx.fillText(labelText, labelX + 4, priceY + 4);
    }
  }

  /**
   * Check for price alerts (when price approaches S/R levels)
   */
  checkPriceAlerts(currentPrice) {
    if (!window.addWatchlistAlert) return;
    if (!currentPrice) return;
    if (this.resistances.length === 0 && this.supports.length === 0) return;

    const proximityPercent = 0.3; // Alert when within 0.3% of level
    const minStrength = 5; // Only alert on strong levels

    // Check resistances
    this.resistances.forEach(resistance => {
      if (resistance.status !== 'active') return;
      if (resistance.strength < minStrength) return;

      const distancePercent = Math.abs((currentPrice - resistance.price) / resistance.price * 100);

      if (distancePercent <= proximityPercent) {
        // Check if we haven't alerted for this level recently
        const alertKey = `sr_alert_${this.symbol}_R_${resistance.price.toFixed(2)}`;
        const lastAlertTime = localStorage.getItem(alertKey);
        const now = Date.now();

        if (!lastAlertTime || now - parseInt(lastAlertTime) > 3600000) { // 1 hour cooldown
          localStorage.setItem(alertKey, now.toString());

          window.addWatchlistAlert({
            indicatorType: 'Support & Resistance',
            severity: resistance.strength >= 8 ? 'HIGH' : resistance.strength >= 6 ? 'MEDIUM' : 'LOW',
            icon: '🔴',
            title: `${this.symbol} approaching Resistance`,
            symbol: this.symbol,
            interval: this.interval,
            type: 'S/R Level',
            description: `Price $${currentPrice.toFixed(2)} is ${distancePercent.toFixed(2)}% from resistance level at $${resistance.price.toFixed(2)}\nStrength: ${resistance.strength.toFixed(1)}/10 • Touches: ${resistance.touches}x`,
            data: {
              price: currentPrice,
              levelPrice: resistance.price,
              levelType: 'resistance',
              strength: resistance.strength,
              touches: resistance.touches,
              distance: distancePercent
            }
          });
        }
      }
    });

    // Check supports
    this.supports.forEach(support => {
      if (support.status !== 'active') return;
      if (support.strength < minStrength) return;

      const distancePercent = Math.abs((currentPrice - support.price) / support.price * 100);

      if (distancePercent <= proximityPercent) {
        const alertKey = `sr_alert_${this.symbol}_S_${support.price.toFixed(2)}`;
        const lastAlertTime = localStorage.getItem(alertKey);
        const now = Date.now();

        if (!lastAlertTime || now - parseInt(lastAlertTime) > 3600000) { // 1 hour cooldown
          localStorage.setItem(alertKey, now.toString());

          window.addWatchlistAlert({
            indicatorType: 'Support & Resistance',
            severity: support.strength >= 8 ? 'HIGH' : support.strength >= 6 ? 'MEDIUM' : 'LOW',
            icon: '🟢',
            title: `${this.symbol} approaching Support`,
            symbol: this.symbol,
            interval: this.interval,
            type: 'S/R Level',
            description: `Price $${currentPrice.toFixed(2)} is ${distancePercent.toFixed(2)}% from support level at $${support.price.toFixed(2)}\nStrength: ${support.strength.toFixed(1)}/10 • Touches: ${support.touches}x`,
            data: {
              price: currentPrice,
              levelPrice: support.price,
              levelType: 'support',
              strength: support.strength,
              touches: support.touches,
              distance: distancePercent
            }
          });
        }
      }
    });
  }

  /**
   * Actualiza configuración
   */
  updateConfig(config) {
    if (config.volumeMethod !== undefined) this.volumeMethod = config.volumeMethod;
    if (config.zScoreThreshold !== undefined) this.zScoreThreshold = config.zScoreThreshold;
    if (config.zScorePeriod !== undefined) this.zScorePeriod = config.zScorePeriod;
    if (config.leftBars !== undefined) this.leftBars = config.leftBars;
    if (config.rightBars !== undefined) this.rightBars = config.rightBars;
    if (config.minTouches !== undefined) this.minTouches = config.minTouches;
    if (config.clusterDistance !== undefined) this.clusterDistance = config.clusterDistance;
    if (config.maxLevels !== undefined) this.maxLevels = config.maxLevels;
    if (config.showResistances !== undefined) this.showResistances = config.showResistances;
    if (config.showSupports !== undefined) this.showSupports = config.showSupports;
    if (config.showConsolidationZones !== undefined) this.showConsolidationZones = config.showConsolidationZones;
    if (config.showLabels !== undefined) this.showLabels = config.showLabels;
    if (config.days !== undefined) this.days = config.days;
  }

  /**
   * No renderiza en el panel de indicadores (se dibuja sobre el chart)
   */
  render(ctx, bounds, visibleCandles) {
    // Nada que renderizar aquí - se dibuja en renderOnPriceChart
  }

  getHeight() {
    return 0; // No ocupa espacio en el panel de indicadores
  }
}

export default SupportResistanceIndicator;
