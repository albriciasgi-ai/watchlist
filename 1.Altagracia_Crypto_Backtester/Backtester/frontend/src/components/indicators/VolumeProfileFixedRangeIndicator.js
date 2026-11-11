// VolumeProfileFixedRangeIndicator.js
// ✅ VERSION 3.0 - Correcciones de formato visual y configuración

import { profileLevels } from './analysisLevels.js';
import { alignX, alignY, crispWidth } from '../chartPixels.js';
import { THEME, isCustom, isNewTheme, rgbOf } from '../uiTheme.js'; // Estilo Nítido
import IndicatorBase from "./IndicatorBase";

/** Valores de fábrica de lo visual de un perfil manual. Los auto-detectados (morados) y de tendencia (azules)
 *  difieren y por eso conservan sus colores con Nítido */
export const VP_FIXED_FACTORY = {
  baseColor: '#2196F3',
  valueAreaColor: '#FF9800',
  pocColor: '#F44336',
  vahValColor: ['#9C27B0', '#2196F3'],
  clusterColor: ['#4CAF50', '#9C27B0'],
  useGradient: true
};

/** Color de cada ajuste con el estilo Nítido, para mostrarlo en el modal */
export const vpFixedThemeValue = key => ({
  baseColor: THEME.vpOutside, valueAreaColor: THEME.vpValueArea, pocColor: THEME.vpPoc,
  vahValColor: THEME.vpVahVal, clusterColor: THEME.vpCluster, useGradient: true
}[key]);
import { API_BASE_URL } from "../../config";
import { TF_MS, candlesBetween } from "../backtesting/replayClock";

import { priceText } from '../backtesting/blindClock.js';
const MIN_REAL_COVERAGE = 0.99; // Con menos minutos en el almacén se usa el perfil estimado
// Los perfiles guardan porcentajes (70, 25); el modal anterior a veces guardaba fracciones (0.70, 0.25)
const asFraction = value => (value > 1 ? value / 100 : value);

/** Niveles de precio de un perfil fijo. Hasta el 11/11/2026 eran 50 como mucho (modal de 12 a 50) */
export const VP_FIXED_ROWS = 400;
export const VP_FIXED_ROWS_MAX = 1000;

/** Niveles de una configuración guardada: las de antes de rowsV2 pasan a 400, lo elegido después se respeta */
export function fixedRows(data, fallback = VP_FIXED_ROWS) {
  if (!data || !Number.isFinite(data.rows)) return fallback;
  if (!data.rowsV2) return VP_FIXED_ROWS;
  return Math.max(12, Math.min(VP_FIXED_ROWS_MAX, Math.round(data.rows)));
}

class VolumeProfileFixedRangeIndicator extends IndicatorBase {
  constructor(symbol, interval, rangeId = null) {
    super(symbol, interval);
    this.name = rangeId ? `VP Fixed Range ${rangeId}` : "VP Fixed Range";
    this.rangeId = rangeId;
    this.height = 0;
    
    this.rows = VP_FIXED_ROWS;
    this.valueAreaPercent = 0.70;
    this.histogramMaxWidth = 0.25;
    
    // Colores
    this.baseColor = "#2196F3";
    this.valueAreaColor = "#FF9800";
    this.pocColor = "#F44336";
    this.vahValColor = "#2196F3";
    // ✅ CORREGIDO: Color gris más visible (#CCCCCC en vez de #E0E0E0)
    this.rangeShadeColor = "#CCCCCC";
    this.useGradient = true;
    
    // Deteccion de clusters
    this.enableClusterDetection = false;
    this.clusterThreshold = 1.5;
    this.clusterColor = "#9C27B0";
    
    // Rango de tiempo (timestamps)
    this.startTimestamp = null;
    this.endTimestamp = null;

    // Perfil calculado y velas originales del rango
    this.profile = null;
    this.rangeCandles = null;
    this.profileCalculated = false;

    // 🎯 NUEVO: Identificador alfabético del rango
    this.rangeLabel = null; // "A", "B", "C", etc.

    // Volumen real por franja, leído del almacén de trades
    this.realVolumes = null;
    this.realRequestKey = null;
    this.realLoading = false;
  }

  setTimeRange(startTimestamp, endTimestamp) {
    this.startTimestamp = startTimestamp;
    this.endTimestamp = endTimestamp;
    this.profile = null;
    this.rangeCandles = null;
    this.profileCalculated = false;
  }

  updateConfig(config) {
    if (config.customVisual !== undefined) this.customVisual = config.customVisual; // Lo elegido en el modal
    if (config.rows !== undefined) this.rows = fixedRows(config, this.rows);
    if (config.valueAreaPercent !== undefined) this.valueAreaPercent = asFraction(config.valueAreaPercent);
    if (config.histogramMaxWidth !== undefined) this.histogramMaxWidth = asFraction(config.histogramMaxWidth);
    if (config.useGradient !== undefined) this.useGradient = config.useGradient;
    
    if (config.baseColor !== undefined) this.baseColor = config.baseColor;
    if (config.valueAreaColor !== undefined) this.valueAreaColor = config.valueAreaColor;
    if (config.pocColor !== undefined) this.pocColor = config.pocColor;
    if (config.vahValColor !== undefined) this.vahValColor = config.vahValColor;
    if (config.rangeShadeColor !== undefined) this.rangeShadeColor = config.rangeShadeColor;
    
    if (config.enableClusterDetection !== undefined) this.enableClusterDetection = config.enableClusterDetection;
    if (config.clusterThreshold !== undefined) this.clusterThreshold = config.clusterThreshold;
    if (config.clusterColor !== undefined) this.clusterColor = config.clusterColor;

    // 🎯 NUEVO: Actualizar rangeLabel si viene en config
    if (config.rangeLabel !== undefined) this.rangeLabel = config.rangeLabel;

    if (this.profileCalculated && this.rangeCandles) {
      this.profile = this.calculateProfile(this.rangeCandles);
    }
  }

  async fetchData() {
    return true;
  }

  calculateOverlap(candleLow, candleHigh, levelLow, levelHigh) {
    const overlapLow = Math.max(candleLow, levelLow);
    const overlapHigh = Math.min(candleHigh, levelHigh);
    const overlap = Math.max(0, overlapHigh - overlapLow);
    const candleSize = candleHigh - candleLow;
    
    if (overlap > 0 && candleSize > 0) {
      return overlap / candleSize;
    }
    return 0;
  }

  calculateProfile(candles) {
    if (!candles || candles.length === 0) return null;

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    for (const candle of candles) {
      minPrice = Math.min(minPrice, candle.low);
      maxPrice = Math.max(maxPrice, candle.high);
    }

    const priceRange = maxPrice - minPrice;
    if (priceRange === 0) return null;

    const step = priceRange / this.rows;

    const levels = [];
    for (let i = 0; i < this.rows; i++) {
      const levelLow = minPrice + (step * i);
      const levelHigh = levelLow + step;
      const levelPrice = levelLow + (step * 0.5);
      
      levels.push({
        price: levelPrice,
        volume: 0,
        levelLow: levelLow,
        levelHigh: levelHigh,
        isValueArea: false,
        isCluster: false
      });
    }

    // Si el almacén cubre el rango, el volumen de cada franja es real
    const realVolumes = this.realVolumes?.key === this.realKey(minPrice, maxPrice) ? this.realVolumes.volumes : null;

    if (realVolumes) {
      levels.forEach((level, i) => {
        level.volume = realVolumes[i];
      });
    }

    for (const candle of realVolumes ? [] : candles) {
      const candleLow = candle.low;
      const candleHigh = candle.high;
      const candleVolume = candle.volume;

      // Solo las franjas que toca la vela: con 400 niveles recorrerlas todas costaría 8 veces más
      const first = Math.max(0, Math.floor((candleLow - minPrice) / step));
      const last = Math.min(this.rows - 1, Math.floor((candleHigh - minPrice) / step));
      for (let i = first; i <= last; i++) {
        const level = levels[i];
        const overlapFraction = this.calculateOverlap(
          candleLow, 
          candleHigh, 
          level.levelLow, 
          level.levelHigh
        );

        if (overlapFraction > 0) {
          levels[i].volume += candleVolume * overlapFraction;
        }
      }
    }

    let totalVolume = 0;
    for (const level of levels) {
      totalVolume += level.volume;
    }

    let pocIndex = 0;
    let maxVolume = levels[0].volume;
    
    for (let i = 1; i < levels.length; i++) {
      if (levels[i].volume > maxVolume) {
        pocIndex = i;
        maxVolume = levels[i].volume;
      }
    }

    const poc = {
      index: pocIndex,
      price: levels[pocIndex].price,
      volume: maxVolume
    };

    const valueAreaThreshold = totalVolume * this.valueAreaPercent;
    let lowIndex = pocIndex;
    let highIndex = pocIndex;
    let cumulativeVolume = maxVolume;

    while (cumulativeVolume < valueAreaThreshold && (lowIndex > 0 || highIndex < levels.length - 1)) {
      const lowerVolume = lowIndex > 0 ? levels[lowIndex - 1].volume : 0;
      const upperVolume = highIndex < levels.length - 1 ? levels[highIndex + 1].volume : 0;

      if (lowerVolume > upperVolume) {
        lowIndex--;
        cumulativeVolume += lowerVolume;
      } else {
        highIndex++;
        cumulativeVolume += upperVolume;
      }
    }

    for (let i = lowIndex; i <= highIndex; i++) {
      levels[i].isValueArea = true;
    }

    if (this.enableClusterDetection && maxVolume > 0) {
      const avgVolume = totalVolume / levels.length;
      const clusterThresholdVolume = avgVolume * this.clusterThreshold;
      
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].volume >= clusterThresholdVolume) {
          levels[i].isCluster = true;
        }
      }
    }

    const valueArea = {
      lowIndex: lowIndex,
      highIndex: highIndex,
      vahPrice: levels[highIndex].price,
      valPrice: levels[lowIndex].price,
      percentage: this.valueAreaPercent * 100
    };

    return {
      levels: levels,
      poc: poc,
      valueArea: valueArea,
      minPrice: minPrice,
      maxPrice: maxPrice,
      totalVolume: totalVolume,
      maxVolume: maxVolume,
      isReal: !!realVolumes
    };
  }

  realKey(minPrice, maxPrice) {
    return `${this.startTimestamp}|${this.endTimestamp}|${minPrice}|${maxPrice}|${this.rows}|${this.profiledUntil}`;
  }

  // Pide el volumen real del rango, cortado en la hora simulada. Sin cobertura queda el estimado
  loadRealVolumes(priceContext) {
    const { minPrice, maxPrice } = this.profile;
    const key = this.realKey(minPrice, maxPrice);
    if (this.realLoading || this.realRequestKey === key || !priceContext?.knownUntil) return;

    this.realRequestKey = key;
    this.realLoading = true;

    const params = new URLSearchParams({
      start_timestamp: String(this.startTimestamp),
      end_timestamp: String(this.endTimestamp + (TF_MS[this.interval] || 0)),
      low: String(minPrice),
      high: String(maxPrice),
      rows: String(this.rows),
      known_until: String(priceContext.knownUntil)
    });

    fetch(`${API_BASE_URL}/api/orderflow/profile/${this.symbol}?${params}`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!data?.success || data.expected_minutes === 0) return;
        if (data.minutes / data.expected_minutes < MIN_REAL_COVERAGE) return;
        if (this.realRequestKey !== key || !this.rangeCandles?.length) return;

        this.realVolumes = { key, volumes: data.buy.map((buy, i) => buy + data.sell[i]) };
        this.profile = this.calculateProfile(this.rangeCandles);
        priceContext.requestRedraw?.();
      })
      .catch(error => console.warn(`[${this.symbol}] Perfil real no disponible:`, error.message))
      .finally(() => {
        this.realLoading = false;
      });
  }

  filterCandlesByRange(allCandles, startTimestamp, endTimestamp) {
    return candlesBetween(allCandles, startTimestamp, endTimestamp);
  }

  findCandleIndex(timestamp, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return -1;
    
    let closestIndex = 0;
    let minDiff = Math.abs(visibleCandles[0].timestamp - timestamp);
    
    for (let i = 1; i < visibleCandles.length; i++) {
      const diff = Math.abs(visibleCandles[i].timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }
    
    return closestIndex;
  }

  candleIndexToX(candleIndex, totalVisibleCandles, x, chartWidth) {
    if (totalVisibleCandles === 0) return null;
    
    const barWidth = chartWidth / totalVisibleCandles;
    const xPosition = x + (candleIndex * barWidth) + (barWidth / 2);
    
    return xPosition;
  }

  render(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;
    if (!this.startTimestamp || !this.endTimestamp) return;

    // En reproducción solo cuentan las velas que ya ocurrieron
    const candlesToUse = priceContext?.knownCandles || (allCandles && allCandles.length > 0 ? allCandles : visibleCandles);
    const knownUntil = candlesToUse[candlesToUse.length - 1]?.timestamp ?? 0;
    const rangeChanged = this.profileCalculated
      && knownUntil !== this.profiledUntil
      && this.endTimestamp >= Math.min(knownUntil, this.profiledUntil ?? 0);

    if (!this.profileCalculated || rangeChanged) {
      this.rangeCandles = this.filterCandlesByRange(
        candlesToUse,
        this.startTimestamp,
        this.endTimestamp
      );
      this.profiledUntil = knownUntil;

      if (this.rangeCandles.length > 0) {
        this.profile = this.calculateProfile(this.rangeCandles);
        this.profileCalculated = true;
      } else {
        this.profile = null;
        this.profileCalculated = false;
        return;
      }
    }

    if (!this.profile) return;

    this.loadRealVolumes(priceContext);

    const { x, y, width, height } = bounds;

    const startCandleIndex = this.findCandleIndex(this.startTimestamp, visibleCandles);
    const endCandleIndex = this.findCandleIndex(this.endTimestamp, visibleCandles);

    if (startCandleIndex === -1 || endCandleIndex === -1) return;

    const rangeStartX = this.candleIndexToX(startCandleIndex, visibleCandles.length, x, width);
    const rangeEndX = this.candleIndexToX(endCandleIndex, visibleCandles.length, x, width);

    if (!rangeStartX || !rangeEndX) return;
    if (rangeStartX === rangeEndX) return;

    const clampedStartX = Math.max(x, rangeStartX);
    const clampedEndX = Math.min(x + width, rangeEndX);
    const rangeWidth = clampedEndX - clampedStartX;

    if (rangeWidth <= 0) return;

    // 🎯 NUEVO: Usar priceContext si está disponible (incluye verticalZoom y verticalOffset)
    // Si no está disponible, calcular localmente como antes
    let allCandlesMinPrice, allCandlesMaxPrice, allCandlesPriceRange, yScale, verticalOffset;

    if (priceContext) {
      // Usar los valores del contexto (sincronizado con MiniChart)
      allCandlesMinPrice = priceContext.minPrice;
      allCandlesMaxPrice = priceContext.maxPrice;
      allCandlesPriceRange = priceContext.priceRange;
      yScale = priceContext.yScale; // Ya incluye verticalZoom
      verticalOffset = priceContext.verticalOffset || 0; // Paneo vertical
    } else {
      // Fallback: calcular localmente sin zoom ni offset
      allCandlesMinPrice = Math.min(...allCandles.map(c => c.low));
      allCandlesMaxPrice = Math.max(...allCandles.map(c => c.high));
      allCandlesPriceRange = allCandlesMaxPrice - allCandlesMinPrice;
      yScale = allCandlesPriceRange > 0 ? height / allCandlesPriceRange : 1;
      verticalOffset = 0;
    }

    const priceToY = (price) => {
      if (allCandlesPriceRange === 0) return y + height / 2;
      return y + height - ((price - allCandlesMinPrice) * yScale) + verticalOffset;
    };

    // 🎯 Obtener high/low del rango desde las velas del rango
    const rangeHigh = this.profile.maxPrice;
    const rangeLow = this.profile.minPrice;

    // 🎯 Convertir precios del rango a coordenadas Y
    const rangeHighY = priceToY(rangeHigh);
    const rangeLowY = priceToY(rangeLow);
    const rangeHeightY = rangeLowY - rangeHighY; // Y crece hacia abajo

    // 🎯 NUEVO: Dibujar rectángulo delimitado por el precio (no toda la altura del gráfico)
    ctx.fillStyle = this.hexToRgba(this.rangeShadeColor, 0.15);
    ctx.fillRect(clampedStartX, rangeHighY, rangeWidth, rangeHeightY);

    // Lo que el usuario eligió en el modal del perfil gana sobre el estilo Nítido
    const nitido = isNewTheme();
    const look = {
      customVisual: this.customVisual, baseColor: this.baseColor, valueAreaColor: this.valueAreaColor,
      pocColor: this.pocColor, vahValColor: this.vahValColor, clusterColor: this.clusterColor, useGradient: this.useGradient
    };
    const own = key => isCustom(look, key, VP_FIXED_FACTORY[key]);
    const styled = key => nitido && !own(key);

    // 🎯 Dibujar bordes del rectángulo (high, low, inicio, fin)
    // Usar el baseColor para el borde (morado para auto-detectados, azul para manuales). Con Nítido, fino y gris
    const borderWidth = styled('baseColor') ? 1 : 2;
    ctx.strokeStyle = styled('baseColor') ? THEME.vpVahVal : this.baseColor;
    ctx.lineWidth = crispWidth(borderWidth);
    ctx.setLineDash([]);

    // Bordes enteros en píxeles reales
    const borderLeft = alignX(clampedStartX, borderWidth);
    const borderRight = alignX(clampedEndX, borderWidth);
    const borderTop = alignY(rangeHighY, borderWidth);
    const borderBottom = alignY(rangeLowY, borderWidth);
    ctx.beginPath();
    // Borde superior (high)
    ctx.moveTo(borderLeft, borderTop);
    ctx.lineTo(borderRight, borderTop);
    // Borde derecho
    ctx.lineTo(borderRight, borderBottom);
    // Borde inferior (low)
    ctx.lineTo(borderLeft, borderBottom);
    // Borde izquierdo
    ctx.lineTo(borderLeft, borderTop);
    ctx.stroke();

    ctx.setLineDash([]);

    const histogramMaxWidth = rangeWidth * this.histogramMaxWidth;
    
    for (const level of this.profile.levels) {
      if (level.volume === 0) continue;
      
      const levelY = priceToY(level.price);
      
      if (levelY < y || levelY > y + height) continue;
      
      const volumeFraction = this.profile.maxVolume > 0 
        ? level.volume / this.profile.maxVolume 
        : 0;
      
      const barWidth = histogramMaxWidth * volumeFraction;
      
      let color = this.baseColor;
      
      if (this.enableClusterDetection && level.isCluster) {
        color = this.clusterColor;
      } else if (level.isValueArea) {
        color = this.valueAreaColor;
      }
      
      if (nitido) {
        let rgb;
        if (this.enableClusterDetection && level.isCluster) rgb = (own('clusterColor') && rgbOf(this.clusterColor)) || THEME.vpClusterRgb;
        else if (level.isValueArea) rgb = (own('valueAreaColor') && rgbOf(this.valueAreaColor)) || THEME.vpValueAreaRgb;
        else rgb = (own('baseColor') && rgbOf(this.baseColor)) || THEME.vpOutsideRgb;
        const graded = own('useGradient') ? this.useGradient : true;
        color = `rgba(${rgb}, ${graded ? 0.22 + volumeFraction * 0.4 : 0.45})`;
      } else if (this.useGradient) {
        const alpha = 0.2 + (volumeFraction * 0.7);
        color = this.hexToRgba(color, alpha);
      } else {
        color = this.hexToRgba(color, 0.6);
      }

      ctx.fillStyle = color;
      ctx.fillRect(clampedStartX, levelY - 1, barWidth, 2);
    }

    const pocY = priceToY(this.profile.poc.price);
    if (pocY >= y && pocY <= y + height) {
      const pocWidth = nitido ? 1 : 2;
      ctx.strokeStyle = styled('pocColor') ? THEME.vpPoc : this.pocColor;
      ctx.lineWidth = crispWidth(pocWidth);
      ctx.setLineDash(nitido ? [] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(clampedStartX, alignY(pocY, pocWidth));
      ctx.lineTo(clampedEndX, alignY(pocY, pocWidth));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const vahY = priceToY(this.profile.valueArea.vahPrice);
    const valY = priceToY(this.profile.valueArea.valPrice);
    
    ctx.strokeStyle = styled('vahValColor') ? THEME.vpVahVal : this.vahValColor;
    ctx.lineWidth = crispWidth(1);
    ctx.globalAlpha = nitido ? 0.9 : 0.4;
    if (nitido) ctx.setLineDash([3, 3]);

    if (vahY >= y && vahY <= y + height) {
      ctx.beginPath();
      ctx.moveTo(clampedStartX, alignY(vahY));
      ctx.lineTo(clampedEndX, alignY(vahY));
      ctx.stroke();
    }

    if (valY >= y && valY <= y + height) {
      ctx.beginPath();
      ctx.moveTo(clampedStartX, alignY(valY));
      ctx.lineTo(clampedEndX, alignY(valY));
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);

    // 🎯 NUEVO: Dibujar etiqueta alfabética en esquina superior derecha
    if (this.rangeLabel) {
      const labelRightX = clampedEndX - 30; // 30px desde el borde derecho
      const labelTopY = rangeHighY + 20; // 20px desde el borde superior

      // Fondo para la etiqueta
      const labelColor = styled('baseColor') ? THEME.vpPoc : this.baseColor;
      ctx.fillStyle = this.hexToRgba(labelColor, 0.9);
      ctx.fillRect(labelRightX, labelTopY - 15, 25, 18);

      // Borde
      ctx.strokeStyle = labelColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(labelRightX, labelTopY - 15, 25, 18);

      // Texto
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.rangeLabel, labelRightX + 12.5, labelTopY);
      ctx.textAlign = "left"; // Restaurar
    }

    ctx.fillStyle = nitido ? THEME.textMuted : "#333";
    ctx.font = "10px Inter, sans-serif";

    const labelX = clampedStartX + 5;
    let labelY = y + 15;

    if (this.rangeId) {
      const shortId = String(this.rangeId).replace('range_', '');
      ctx.fillText(`Range ${shortId}`, labelX, labelY);
      labelY += 12;
    }

    ctx.fillStyle = styled('pocColor') ? THEME.text : this.pocColor;
    ctx.fillText(`POC: ${priceText(this.profile.poc.price, 2)}${this.profile.isReal ? ' · real' : ''}`, labelX, labelY);
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  toJSON() {
    return {
      rangeId: this.rangeId,
      startTimestamp: this.startTimestamp,
      endTimestamp: this.endTimestamp,
      rows: this.rows,
      rowsV2: true, // Desde el 11/11: rows ya está en la escala de 400 niveles
      valueAreaPercent: this.valueAreaPercent * 100,
      histogramMaxWidth: this.histogramMaxWidth * 100,
      useGradient: this.useGradient,
      baseColor: this.baseColor,
      valueAreaColor: this.valueAreaColor,
      pocColor: this.pocColor,
      vahValColor: this.vahValColor,
      rangeShadeColor: this.rangeShadeColor,
      enableClusterDetection: this.enableClusterDetection,
      clusterThreshold: this.clusterThreshold,
      clusterColor: this.clusterColor,
      customVisual: this.customVisual,
      enabled: this.enabled,
      rangeLabel: this.rangeLabel  // 🎯 AGREGAR rangeLabel
    };
  }

  fromJSON(data) {
    if (data.startTimestamp && data.endTimestamp) {
      this.setTimeRange(data.startTimestamp, data.endTimestamp);
    }
    
    if (data.customVisual !== undefined) this.customVisual = data.customVisual; // Lo elegido en el modal
    this.rows = fixedRows(data, this.rows);
    this.valueAreaPercent = (data.valueAreaPercent !== undefined ? asFraction(data.valueAreaPercent) : this.valueAreaPercent);
    this.histogramMaxWidth = (data.histogramMaxWidth !== undefined ? asFraction(data.histogramMaxWidth) : this.histogramMaxWidth);
    this.useGradient = data.useGradient !== undefined ? data.useGradient : this.useGradient;
    
    this.baseColor = data.baseColor || this.baseColor;
    this.valueAreaColor = data.valueAreaColor || this.valueAreaColor;
    this.pocColor = data.pocColor || this.pocColor;
    this.vahValColor = data.vahValColor || this.vahValColor;
    this.rangeShadeColor = data.rangeShadeColor || this.rangeShadeColor;
    
    this.enableClusterDetection = data.enableClusterDetection || this.enableClusterDetection;
    this.clusterThreshold = data.clusterThreshold || this.clusterThreshold;
    this.clusterColor = data.clusterColor || this.clusterColor;

    this.enabled = data.enabled !== undefined ? data.enabled : this.enabled;

    // 🎯 AGREGAR: Cargar rangeLabel
    this.rangeLabel = data.rangeLabel || this.rangeLabel;
  }

  loadFromData(data) {
    this.fromJSON(data);
    
    if (this.startTimestamp && this.endTimestamp) {
      console.log(`[${this.symbol}] ✅ Fixed Range ${this.rangeId} cargado`, {
        start: new Date(this.startTimestamp).toISOString(),
        end: new Date(this.endTimestamp).toISOString(),
        enabled: this.enabled
      });
    }
  }

  selectableLevels() {
    return profileLevels(this.profile, 'VP Fixed Range', { start: this.startTimestamp, end: this.endTimestamp });
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    return this.render(ctx, bounds, visibleCandles, allCandles, priceContext);
  }
}

export default VolumeProfileFixedRangeIndicator;
