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

  clearData() {
    this.resistances = [];
    this.supports = [];
    this.consolidationZones = [];
    this.currentPrice = 0;
  }

  /**
   * Renderiza los niveles de S/R sobre el precio (main chart)
   */
  renderOnPriceChart(ctx, bounds, visibleCandles, priceToY, xScale) {
    if (!this.enabled) return;
    if (this.resistances.length === 0 && this.supports.length === 0) return;

    const { x, y, width, height } = bounds;

    // Dibujar zonas de consolidación primero (fondo)
    if (this.showConsolidationZones) {
      this.consolidationZones.forEach(zone => {
        this.renderConsolidationZone(ctx, zone, bounds, priceToY, xScale);
      });
    }

    // Dibujar resistencias
    if (this.showResistances) {
      this.resistances.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, xScale, 'resistance');
      });
    }

    // Dibujar soportes
    if (this.showSupports) {
      this.supports.forEach(level => {
        this.renderLevel(ctx, level, bounds, priceToY, xScale, 'support');
      });
    }
  }

  /**
   * Renderiza una zona de consolidación
   */
  renderConsolidationZone(ctx, zone, bounds, priceToY, xScale) {
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
   */
  renderLevel(ctx, level, bounds, priceToY, xScale, type) {
    const { x, y, width, height } = bounds;

    const priceY = priceToY(level.price);

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

    // Dibujar línea
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(lineStyle);

    ctx.beginPath();
    ctx.moveTo(x, priceY);
    ctx.lineTo(x + width, priceY);
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
      const labelX = x + width - labelWidth - 5;
      const labelY = priceY - labelHeight / 2;

      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(labelX, labelY, labelWidth, labelHeight);

      ctx.fillStyle = color;
      ctx.fillText(labelText, labelX + 4, priceY + 4);
    }
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
