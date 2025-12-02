// VolumeProfileFixedRangeIndicator.js
// ✅ VERSION 3.0 - Correcciones de formato visual y configuración

import IndicatorBase from "./IndicatorBase";

class VolumeProfileFixedRangeIndicator extends IndicatorBase {
  constructor(symbol, interval, rangeId = null) {
    super(symbol, interval);
    this.name = rangeId ? `VP Fixed Range ${rangeId}` : "VP Fixed Range";
    this.rangeId = rangeId;
    this.height = 0;
    
    // ✅ CORREGIDO: rows por defecto 50 (antes 24)
    this.rows = 50;
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
  }

  setTimeRange(startTimestamp, endTimestamp) {
    this.startTimestamp = startTimestamp;
    this.endTimestamp = endTimestamp;
    this.profile = null;
    this.rangeCandles = null;
    this.profileCalculated = false;
  }

  updateConfig(config) {
    if (config.rows !== undefined) this.rows = config.rows;
    if (config.valueAreaPercent !== undefined) this.valueAreaPercent = config.valueAreaPercent / 100;
    if (config.histogramMaxWidth !== undefined) this.histogramMaxWidth = config.histogramMaxWidth / 100;
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

    for (const candle of candles) {
      const candleLow = candle.low;
      const candleHigh = candle.high;
      const candleVolume = candle.volume;

      for (let i = 0; i < this.rows; i++) {
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
      maxVolume: maxVolume
    };
  }

  filterCandlesByRange(allCandles, startTimestamp, endTimestamp) {
    return allCandles.filter(candle => 
      candle.timestamp >= startTimestamp && candle.timestamp <= endTimestamp
    );
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

    const candlesToUse = allCandles && allCandles.length > 0 ? allCandles : visibleCandles;

    if (!this.profileCalculated) {
      this.rangeCandles = this.filterCandlesByRange(
        candlesToUse,
        this.startTimestamp,
        this.endTimestamp
      );

      if (this.rangeCandles.length > 0) {
        this.profile = this.calculateProfile(this.rangeCandles);
        this.profileCalculated = true;
      } else {
        return;
      }
    }

    if (!this.profile) return;

    const { x, y, width, height } = bounds;

    // ✅ FIX: Buscar índice en allCandles para obtener posición absoluta
    // Luego calcular posición relativa respecto a visibleCandles
    const startCandleAbsIndex = this.findCandleIndex(this.startTimestamp, candlesToUse);
    const endCandleAbsIndex = this.findCandleIndex(this.endTimestamp, candlesToUse);

    if (startCandleAbsIndex === -1 || endCandleAbsIndex === -1) return;

    // Encontrar el índice de la primera vela visible dentro de allCandles
    const firstVisibleTimestamp = visibleCandles[0]?.timestamp;
    const firstVisibleAbsIndex = candlesToUse.findIndex(c => c.timestamp === firstVisibleTimestamp);

    if (firstVisibleAbsIndex === -1) return;

    // Calcular índice relativo dentro de visibleCandles
    const startCandleIndex = startCandleAbsIndex - firstVisibleAbsIndex;
    const endCandleIndex = endCandleAbsIndex - firstVisibleAbsIndex;

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
    const rangeHigh = Math.max(...this.rangeCandles.map(c => c.high));
    const rangeLow = Math.min(...this.rangeCandles.map(c => c.low));

    // 🎯 Convertir precios del rango a coordenadas Y
    const rangeHighY = priceToY(rangeHigh);
    const rangeLowY = priceToY(rangeLow);
    const rangeHeightY = rangeLowY - rangeHighY; // Y crece hacia abajo

    // 🎯 NUEVO: Dibujar rectángulo delimitado por el precio (no toda la altura del gráfico)
    ctx.fillStyle = this.hexToRgba(this.rangeShadeColor, 0.15);
    ctx.fillRect(clampedStartX, rangeHighY, rangeWidth, rangeHeightY);

    // 🎯 Dibujar bordes del rectángulo (high, low, inicio, fin)
    // Usar el baseColor para el borde (morado para auto-detectados, azul para manuales)
    ctx.strokeStyle = this.baseColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    ctx.beginPath();
    // Borde superior (high)
    ctx.moveTo(clampedStartX, rangeHighY);
    ctx.lineTo(clampedEndX, rangeHighY);
    // Borde derecho
    ctx.lineTo(clampedEndX, rangeLowY);
    // Borde inferior (low)
    ctx.lineTo(clampedStartX, rangeLowY);
    // Borde izquierdo
    ctx.lineTo(clampedStartX, rangeHighY);
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
      
      if (this.useGradient) {
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
      ctx.strokeStyle = this.pocColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(clampedStartX, pocY);
      ctx.lineTo(clampedEndX, pocY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const vahY = priceToY(this.profile.valueArea.vahPrice);
    const valY = priceToY(this.profile.valueArea.valPrice);
    
    ctx.strokeStyle = this.vahValColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    
    if (vahY >= y && vahY <= y + height) {
      ctx.beginPath();
      ctx.moveTo(clampedStartX, vahY);
      ctx.lineTo(clampedEndX, vahY);
      ctx.stroke();
    }
    
    if (valY >= y && valY <= y + height) {
      ctx.beginPath();
      ctx.moveTo(clampedStartX, valY);
      ctx.lineTo(clampedEndX, valY);
      ctx.stroke();
    }
    
    ctx.globalAlpha = 1.0;

    // 🎯 NUEVO: Dibujar etiqueta alfabética en esquina superior derecha
    if (this.rangeLabel) {
      const labelRightX = clampedEndX - 30; // 30px desde el borde derecho
      const labelTopY = rangeHighY + 20; // 20px desde el borde superior

      // Fondo para la etiqueta
      ctx.fillStyle = this.hexToRgba(this.baseColor, 0.9);
      ctx.fillRect(labelRightX, labelTopY - 15, 25, 18);

      // Borde
      ctx.strokeStyle = this.baseColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(labelRightX, labelTopY - 15, 25, 18);

      // Texto
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(this.rangeLabel, labelRightX + 12.5, labelTopY);
      ctx.textAlign = "left"; // Restaurar
    }

    ctx.fillStyle = "#333";
    ctx.font = "10px Inter, sans-serif";

    const labelX = clampedStartX + 5;
    let labelY = y + 15;

    if (this.rangeId) {
      const shortId = String(this.rangeId).replace('range_', '');
      ctx.fillText(`Range ${shortId}`, labelX, labelY);
      labelY += 12;
    }

    ctx.fillStyle = this.pocColor;
    ctx.fillText(`POC: ${this.profile.poc.price.toFixed(2)}`, labelX, labelY);
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  toJSON() {
    // Exportar clusters si están disponibles
    const clusters = this.getClusters();

    return {
      rangeId: this.rangeId,
      startTimestamp: this.startTimestamp,
      endTimestamp: this.endTimestamp,
      rows: this.rows,
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
      enabled: this.enabled,
      rangeLabel: this.rangeLabel,  // 🎯 AGREGAR rangeLabel
      clusters: clusters  // 🎯 NUEVO: Exportar clusters calculados
    };
  }

  /**
   * Obtiene los clusters de volumen detectados
   * @returns {Array} Array de clusters con {price, volume, strength, levelLow, levelHigh}
   */
  getClusters() {
    if (!this.profile || !this.profile.levels || !this.enableClusterDetection) {
      return [];
    }

    const maxVolume = this.profile.maxVolume || 1;

    return this.profile.levels
      .filter(level => level.isCluster)
      .map(level => ({
        price: level.price,
        volume: level.volume,
        strength: maxVolume > 0 ? (level.volume / maxVolume * 10) : 0,  // Strength 0-10
        levelLow: level.levelLow,
        levelHigh: level.levelHigh,
        volumeFraction: maxVolume > 0 ? (level.volume / maxVolume) : 0  // 0-1 fraction
      }));
  }

  fromJSON(data) {
    if (data.startTimestamp && data.endTimestamp) {
      this.setTimeRange(data.startTimestamp, data.endTimestamp);
    }
    
    this.rows = data.rows || this.rows;
    this.valueAreaPercent = (data.valueAreaPercent !== undefined ? data.valueAreaPercent / 100 : this.valueAreaPercent);
    this.histogramMaxWidth = (data.histogramMaxWidth !== undefined ? data.histogramMaxWidth / 100 : this.histogramMaxWidth);
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

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    return this.render(ctx, bounds, visibleCandles, allCandles, priceContext);
  }
}

export default VolumeProfileFixedRangeIndicator;
