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

    // 🎯 FIX v2: Empezar habilitado por defecto, fetchData se llamará en initialize()
    // this.enabled ya es true por defecto en IndicatorBase

    console.log(`%c[SupportResistanceIndicator] VERSION 1.3 LOADED - WITH LOCAL CALCULATION`, 'background: #4CAF50; color: white; font-weight: bold; padding: 4px;');

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

    // 🎯 NUEVO: Control de cálculo local para backtesting
    this._lastCalculatedLength = 0;
    this._calculationValid = false;

    // 🎯 Control de playback time para evitar sesgo de supervivencia
    this._currentPlaybackTime = null;
    this._lastPlaybackTime = null;
  }

  /**
   * Fetch Support & Resistance data from backend
   */
  async fetchData() {
    console.log(`%c[${this.symbol}] 📊 S/R fetchData CALLED`, 'background: #2196F3; color: white; font-weight: bold; padding: 2px 4px;');
    console.log(`[${this.symbol}] S/R config: interval=${this.interval}, days=${this.days}, enabled=${this.enabled}`);

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
      console.log(`[${this.symbol}] S/R response status: ${response.status}`);
      const result = await response.json();
      console.log(`[${this.symbol}] S/R response:`, result);

      if (result.success && result.data) {
        this.resistances = result.data.resistances || [];
        this.supports = result.data.supports || [];
        this.consolidationZones = result.data.consolidationZones || [];
        this.currentPrice = result.data.currentPrice || 0;

        console.log(`%c[${this.symbol}] ✅ S/R loaded: ${this.resistances.length} resistances, ${this.supports.length} supports, ${this.consolidationZones.length} zones`, 'background: #4CAF50; color: white; font-weight: bold; padding: 2px 4px;');

        // Check for price alerts
        this.checkPriceAlerts(this.currentPrice);

        return true;
      } else {
        console.warn(`[${this.symbol}] ⚠️ No S/R data available - success=${result.success}, hasData=${!!result.data}`);
        if (result.error) console.error(`[${this.symbol}] S/R error: ${result.error}`);
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
    this._calculationValid = false;
  }

  /**
   * 🎯 Actualiza el tiempo de playback (llamado desde BacktestingApp)
   * Invalida el cálculo si el tiempo cambió significativamente
   */
  updatePlaybackDate(timestamp) {
    this._currentPlaybackTime = timestamp;

    // Recalcular si el playback avanzó más de 1 vela (estimado)
    if (this._lastPlaybackTime && timestamp !== this._lastPlaybackTime) {
      this._calculationValid = false;
      this._renderLoggedOnce = false;
    }
    this._lastPlaybackTime = timestamp;
  }

  /**
   * 🎯 NUEVO: Calcula S&R localmente a partir de las velas (para backtesting)
   * @param {Array} candles - Array de velas con formato {timestamp, open, high, low, close, volume}
   */
  calculateFromCandles(candles) {
    if (!candles || candles.length < this.leftBars + this.rightBars + 1) {
      console.warn(`[${this.symbol}] S&R calculateFromCandles: No hay suficientes velas (${candles?.length || 0})`);
      return;
    }

    console.log(`[${this.symbol}] 📊 S&R: Calculando localmente con ${candles.length} velas...`);
    console.log(`[${this.symbol}] 📊 S&R PARAMS: leftBars=${this.leftBars}, rightBars=${this.rightBars}, minTouches=${this.minTouches}, clusterDistance=${this.clusterDistance}, maxLevels=${this.maxLevels}`);

    // 1. Encontrar pivots (máximos y mínimos locales)
    const pivotHighs = [];
    const pivotLows = [];

    for (let i = this.leftBars; i < candles.length - this.rightBars; i++) {
      const candle = candles[i];

      // Verificar si es un pivot high (máximo local)
      let isHighPivot = true;
      for (let j = i - this.leftBars; j <= i + this.rightBars; j++) {
        if (j !== i && candles[j].high >= candle.high) {
          isHighPivot = false;
          break;
        }
      }
      if (isHighPivot) {
        pivotHighs.push({
          price: candle.high,
          timestamp: candle.timestamp,
          index: i,
          volume: candle.volume
        });
      }

      // Verificar si es un pivot low (mínimo local)
      let isLowPivot = true;
      for (let j = i - this.leftBars; j <= i + this.rightBars; j++) {
        if (j !== i && candles[j].low <= candle.low) {
          isLowPivot = false;
          break;
        }
      }
      if (isLowPivot) {
        pivotLows.push({
          price: candle.low,
          timestamp: candle.timestamp,
          index: i,
          volume: candle.volume
        });
      }
    }

    console.log(`[${this.symbol}] S&R: Encontrados ${pivotHighs.length} pivot highs, ${pivotLows.length} pivot lows`);

    // 2. Agrupar pivots cercanos (clustering)
    const clusterPivots = (pivots, type) => {
      if (pivots.length === 0) return [];

      // Ordenar por precio
      const sorted = [...pivots].sort((a, b) => a.price - b.price);
      const clusters = [];
      let currentCluster = [sorted[0]];

      for (let i = 1; i < sorted.length; i++) {
        const priceDiff = Math.abs(sorted[i].price - currentCluster[0].price) / currentCluster[0].price * 100;

        if (priceDiff <= this.clusterDistance) {
          currentCluster.push(sorted[i]);
        } else {
          clusters.push(currentCluster);
          currentCluster = [sorted[i]];
        }
      }
      clusters.push(currentCluster);

      // Convertir clusters a niveles
      return clusters.map(cluster => {
        const avgPrice = cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
        const totalVolume = cluster.reduce((sum, p) => sum + p.volume, 0);
        const touches = cluster.length;

        return {
          price: avgPrice,
          touches: touches,
          strength: Math.min(10, touches * 2 + (totalVolume > 0 ? 2 : 0)),
          status: 'active',
          type: type
        };
      });
    };

    // 3. Crear niveles de resistencia y soporte
    let resistances = clusterPivots(pivotHighs, 'resistance');
    let supports = clusterPivots(pivotLows, 'support');
    console.log(`[${this.symbol}] S&R: Clusters creados: ${resistances.length} resistances, ${supports.length} supports`);

    // 4. Filtrar por toques mínimos
    const beforeFilterR = resistances.length;
    const beforeFilterS = supports.length;
    resistances = resistances.filter(r => r.touches >= this.minTouches);
    supports = supports.filter(s => s.touches >= this.minTouches);
    console.log(`[${this.symbol}] S&R: Después de filtro minTouches=${this.minTouches}: ${resistances.length}/${beforeFilterR} resistances, ${supports.length}/${beforeFilterS} supports`);

    // 5. Limitar número de niveles
    resistances = resistances.sort((a, b) => b.strength - a.strength).slice(0, this.maxLevels);
    supports = supports.sort((a, b) => b.strength - a.strength).slice(0, this.maxLevels);

    // 6. Actualizar precio actual
    const lastCandle = candles[candles.length - 1];
    this.currentPrice = lastCandle.close;

    // 7. Marcar niveles como broken si el precio actual los ha superado
    resistances = resistances.map(r => ({
      ...r,
      status: this.currentPrice > r.price ? 'broken' : 'active'
    }));
    supports = supports.map(s => ({
      ...s,
      status: this.currentPrice < s.price ? 'broken' : 'active'
    }));

    // 8. Guardar resultados
    this.resistances = resistances;
    this.supports = supports;
    this.consolidationZones = []; // Simplificado - no calculamos zonas por ahora

    this._lastCalculatedLength = candles.length;
    this._calculationValid = true;

    console.log(`[${this.symbol}] ✅ S&R Local: ${this.resistances.length} R, ${this.supports.length} S (${candles.length} velas analizadas)`);
  }

  /**
   * Renderiza los niveles de S/R sobre el precio (main chart)
   * IMPORTANTE: Este método se llama desde IndicatorManager.renderOverlays()
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) return;

    // 🎯 NUEVO: Calcular S&R localmente si tenemos velas (modo backtesting)
    if (allCandles && allCandles.length > 0) {
      // Filtrar velas hasta el playback time para evitar sesgo de supervivencia
      let candlesToUse = allCandles;
      if (this._currentPlaybackTime) {
        candlesToUse = allCandles.filter(c => c.timestamp <= this._currentPlaybackTime);
      }

      const needsRecalculation = !this._calculationValid ||
                                 this.resistances.length === 0 && this.supports.length === 0 ||
                                 candlesToUse.length !== this._lastCalculatedLength;

      if (needsRecalculation && candlesToUse.length > 0) {
        console.log(`[${this.symbol}] 🔄 S&R: Recalculando (valid=${this._calculationValid}, dataLen=${candlesToUse.length}/${allCandles.length}, playbackTime=${this._currentPlaybackTime ? new Date(this._currentPlaybackTime).toISOString() : 'null'})`);
        this.calculateFromCandles(candlesToUse);
      }
    }

    // Verificar si hay datos para renderizar
    if (this.resistances.length === 0 && this.supports.length === 0) {
      return;
    }

    // DEBUG: Solo log una vez
    if (!this._renderLoggedOnce) {
      // Obtener rango de precios del contexto
      const chartMinPrice = priceContext?.minPrice;
      const chartMaxPrice = priceContext?.maxPrice;

      // Obtener rango de precios de S&R
      const srPrices = [...this.resistances, ...this.supports].map(l => l.price);
      const srMinPrice = Math.min(...srPrices);
      const srMaxPrice = Math.max(...srPrices);

      console.log(`[${this.symbol}] 🎨 S&R renderOverlay:`, {
        resistances: this.resistances.length,
        supports: this.supports.length,
        chartPriceRange: { min: chartMinPrice?.toFixed(2), max: chartMaxPrice?.toFixed(2) },
        srPriceRange: { min: srMinPrice?.toFixed(2), max: srMaxPrice?.toFixed(2) },
        pricesOverlap: srMinPrice <= chartMaxPrice && srMaxPrice >= chartMinPrice
      });
      this._renderLoggedOnce = true;
    }

    const { x, y, width, height } = bounds;

    // Extract priceToY function from priceContext
    const priceToY = priceContext ? priceContext.priceToY : null;
    if (!priceToY) {
      console.warn(`[${this.symbol}] ❌ No priceToY function in priceContext!`);
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
   */
  renderLevel(ctx, level, bounds, priceToY, type) {
    const { x, y, width, height } = bounds;

    const priceY = priceToY(level.price);

    // Verificar si el nivel está dentro del área visible
    if (priceY < y || priceY > y + height) {
      return;
    }

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
    console.log(`[${this.symbol}] S&R updateConfig called with:`, config);
    console.log(`[${this.symbol}] S&R BEFORE: leftBars=${this.leftBars}, rightBars=${this.rightBars}, minTouches=${this.minTouches}, clusterDistance=${this.clusterDistance}`);

    // Parámetros que afectan el cálculo de niveles
    const recalculateParams = ['leftBars', 'rightBars', 'minTouches', 'clusterDistance', 'maxLevels',
                               'volumeMethod', 'zScoreThreshold', 'zScorePeriod'];
    let needsRecalculate = false;

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

    console.log(`[${this.symbol}] S&R AFTER: leftBars=${this.leftBars}, rightBars=${this.rightBars}, minTouches=${this.minTouches}, clusterDistance=${this.clusterDistance}`);

    // Verificar si algún parámetro de cálculo cambió
    for (const param of recalculateParams) {
      if (config[param] !== undefined) {
        needsRecalculate = true;
        break;
      }
    }

    // 🎯 FIX: Invalidar caché para forzar recálculo en el próximo renderOverlay
    if (needsRecalculate) {
      console.log(`[${this.symbol}] S&R: Config changed, invalidating cache for recalculation. _calculationValid = false`);
      this._calculationValid = false;
      this._renderLoggedOnce = false; // Reset log flag para mostrar nuevo cálculo
      // NO limpiar los datos aquí - dejar que renderOverlay los recalcule
      // Esto evita que desaparezcan mientras esperamos el siguiente render
    }
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
