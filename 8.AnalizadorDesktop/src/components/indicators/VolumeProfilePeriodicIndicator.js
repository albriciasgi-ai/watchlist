// VolumeProfilePeriodicIndicator.js
// Dibuja un Volume Profile cada N velas (configurable)
// Ejemplo: period=240 en 1min = un VP cada 4 horas

import IndicatorBase from "./IndicatorBase";

class VolumeProfilePeriodicIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "VP Periodic";
    this.height = 0; // Overlay en grafico principal

    // Configuracion principal
    this.periodCandles = 240; // Cada cuantas velas se dibuja un VP
    this.rows = 50;
    this.valueAreaPercent = 0.70;
    this.histogramMaxWidth = 0.30; // 30% del ancho del segmento

    // Colores
    this.baseColor = "#26A69A";
    this.valueAreaColor = "#FF9800";
    this.pocColor = "#F44336";
    this.vahValColor = "#2196F3";
    this.useGradient = true;

    // Opciones de visualizacion
    this.showPOC = true;
    this.showVAHVAL = true;
    this.showLabels = true;

    // Cache de perfiles calculados
    this._profileCache = new Map(); // key: startIdx -> profile
    this._lastCacheKey = null;
  }

  updateConfig(config) {
    if (config.periodCandles !== undefined) this.periodCandles = config.periodCandles;
    if (config.rows !== undefined) this.rows = config.rows;
    if (config.valueAreaPercent !== undefined) this.valueAreaPercent = config.valueAreaPercent / 100;
    if (config.histogramMaxWidth !== undefined) this.histogramMaxWidth = config.histogramMaxWidth / 100;
    if (config.useGradient !== undefined) this.useGradient = config.useGradient;

    if (config.baseColor !== undefined) this.baseColor = config.baseColor;
    if (config.valueAreaColor !== undefined) this.valueAreaColor = config.valueAreaColor;
    if (config.pocColor !== undefined) this.pocColor = config.pocColor;
    if (config.vahValColor !== undefined) this.vahValColor = config.vahValColor;

    if (config.showPOC !== undefined) this.showPOC = config.showPOC;
    if (config.showVAHVAL !== undefined) this.showVAHVAL = config.showVAHVAL;
    if (config.showLabels !== undefined) this.showLabels = config.showLabels;

    // Invalidar cache al cambiar config
    this._profileCache.clear();
    this._lastCacheKey = null;
  }

  async fetchData() {
    return true;
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
        levelLow,
        levelHigh,
        isValueArea: false
      });
    }

    for (const candle of candles) {
      const candleLow = candle.low;
      const candleHigh = candle.high;
      const candleVolume = candle.volume;

      for (let i = 0; i < this.rows; i++) {
        const level = levels[i];
        const overlapLow = Math.max(candleLow, level.levelLow);
        const overlapHigh = Math.min(candleHigh, level.levelHigh);
        const overlap = Math.max(0, overlapHigh - overlapLow);
        const candleSize = candleHigh - candleLow;

        if (overlap > 0 && candleSize > 0) {
          levels[i].volume += candleVolume * (overlap / candleSize);
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

    // Value Area
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

    return {
      levels,
      poc,
      valueArea: {
        lowIndex,
        highIndex,
        vahPrice: levels[highIndex].price,
        valPrice: levels[lowIndex].price
      },
      minPrice,
      maxPrice,
      totalVolume,
      maxVolume
    };
  }

  /**
   * Divide allCandles en segmentos de periodCandles y retorna los rangos
   */
  _getSegments(allCandles) {
    if (!allCandles || allCandles.length === 0) return [];

    const segments = [];
    const period = this.periodCandles;

    for (let startIdx = 0; startIdx < allCandles.length; startIdx += period) {
      const endIdx = Math.min(startIdx + period, allCandles.length);
      // Solo crear segmento si tiene al menos 2 velas
      if (endIdx - startIdx >= 2) {
        segments.push({
          startIdx,
          endIdx,
          candles: allCandles.slice(startIdx, endIdx),
          startTs: allCandles[startIdx].timestamp,
          endTs: allCandles[endIdx - 1].timestamp
        });
      }
    }

    return segments;
  }

  /**
   * Obtiene perfil cacheado o lo calcula
   */
  _getOrCalculateProfile(segment) {
    const cacheKey = `${segment.startTs}_${segment.endTs}_${segment.candles.length}`;

    if (this._profileCache.has(cacheKey)) {
      return this._profileCache.get(cacheKey);
    }

    const profile = this.calculateProfile(segment.candles);
    if (profile) {
      this._profileCache.set(cacheKey, profile);
    }
    return profile;
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    if (!this.enabled || !allCandles || allCandles.length === 0) return;
    if (!visibleCandles || visibleCandles.length === 0) return;

    const { x, y, width, height } = bounds;

    // Invalidar cache si cambio el dataset
    const cacheKey = `${allCandles.length}_${this.periodCandles}_${this.rows}`;
    if (cacheKey !== this._lastCacheKey) {
      this._profileCache.clear();
      this._lastCacheKey = cacheKey;
    }

    // Obtener segmentos de todo el dataset
    const segments = this._getSegments(allCandles);
    if (segments.length === 0) return;

    // Rango visible
    const firstVisibleTs = visibleCandles[0].timestamp;
    const lastVisibleTs = visibleCandles[visibleCandles.length - 1].timestamp;

    // Encontrar indice absoluto de la primera vela visible
    const firstVisibleAbsIdx = allCandles.findIndex(c => c.timestamp === firstVisibleTs);
    if (firstVisibleAbsIdx === -1) return;

    // priceToY
    let priceToY;
    if (priceContext && priceContext.priceToY) {
      priceToY = priceContext.priceToY;
    } else if (priceContext) {
      const { minPrice, maxPrice, priceRange, yScale, verticalOffset } = priceContext;
      priceToY = (price) => {
        if (priceRange === 0) return y + height / 2;
        return y + height - ((price - minPrice) * yScale) + (verticalOffset || 0);
      };
    } else {
      const visMinPrice = Math.min(...visibleCandles.map(c => c.low));
      const visMaxPrice = Math.max(...visibleCandles.map(c => c.high));
      const visPriceRange = visMaxPrice - visMinPrice;
      priceToY = (price) => {
        if (visPriceRange === 0) return y + height / 2;
        return y + height - ((price - visMinPrice) / visPriceRange) * height;
      };
    }

    const barWidthPx = width / visibleCandles.length;

    // Renderizar cada segmento que este al menos parcialmente visible
    for (const segment of segments) {
      // Verificar si el segmento es visible
      if (segment.endTs < firstVisibleTs || segment.startTs > lastVisibleTs) {
        continue; // Segmento completamente fuera de vista
      }

      const profile = this._getOrCalculateProfile(segment);
      if (!profile) continue;

      // Calcular posiciones X del segmento relativas a las velas visibles
      const segStartRelIdx = segment.startIdx - firstVisibleAbsIdx;
      const segEndRelIdx = (segment.endIdx - 1) - firstVisibleAbsIdx;

      const segStartX = x + (segStartRelIdx * barWidthPx) + (barWidthPx / 2);
      const segEndX = x + (segEndRelIdx * barWidthPx) + (barWidthPx / 2);

      // Clamping a los limites del chart
      const clampedStartX = Math.max(x, segStartX);
      const clampedEndX = Math.min(x + width, segEndX);
      const segWidth = clampedEndX - clampedStartX;

      if (segWidth <= 0) continue;

      // Dibujar separador vertical al inicio del segmento
      if (segStartX >= x && segStartX <= x + width) {
        ctx.strokeStyle = this.hexToRgba(this.baseColor, 0.3);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(segStartX, y);
        ctx.lineTo(segStartX, y + height);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Dibujar histograma del perfil
      const histogramMaxWidth = segWidth * this.histogramMaxWidth;

      for (const level of profile.levels) {
        if (level.volume === 0) continue;

        const levelY = priceToY(level.price);
        if (levelY < y || levelY > y + height) continue;

        const volumeFraction = profile.maxVolume > 0
          ? level.volume / profile.maxVolume
          : 0;

        const levelBarWidth = histogramMaxWidth * volumeFraction;

        let color = this.baseColor;
        if (level.isValueArea) {
          color = this.valueAreaColor;
        }

        if (this.useGradient) {
          const alpha = 0.15 + (volumeFraction * 0.7);
          color = this.hexToRgba(color, alpha);
        } else {
          color = this.hexToRgba(color, 0.5);
        }

        ctx.fillStyle = color;
        ctx.fillRect(clampedStartX, levelY - 1, levelBarWidth, 2);
      }

      // Dibujar POC
      if (this.showPOC) {
        const pocY = priceToY(profile.poc.price);
        if (pocY >= y && pocY <= y + height) {
          ctx.strokeStyle = this.pocColor;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(clampedStartX, pocY);
          ctx.lineTo(clampedEndX, pocY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Dibujar VAH/VAL
      if (this.showVAHVAL) {
        const vahY = priceToY(profile.valueArea.vahPrice);
        const valY = priceToY(profile.valueArea.valPrice);

        ctx.strokeStyle = this.vahValColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.35;

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
      }

      // Label con info del segmento
      if (this.showLabels && segStartX >= x && segStartX <= x + width) {
        ctx.fillStyle = this.hexToRgba(this.baseColor, 0.7);
        ctx.font = "9px Inter, sans-serif";

        const labelX = Math.max(x + 2, segStartX + 3);
        ctx.fillText(
          `POC ${profile.poc.price.toFixed(2)}`,
          labelX,
          y + 12
        );
      }
    }
  }

  render(ctx, bounds, visibleCandles, allCandles, priceContext) {
    // No renderiza en panel inferior, solo overlay
  }
}

export default VolumeProfilePeriodicIndicator;
