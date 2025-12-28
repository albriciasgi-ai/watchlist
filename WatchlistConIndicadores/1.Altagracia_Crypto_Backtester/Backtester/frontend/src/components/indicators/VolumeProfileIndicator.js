// src/components/indicators/VolumeProfileIndicator.js

import IndicatorBase from "./IndicatorBase";

class VolumeProfileIndicator extends IndicatorBase {
  constructor(symbol, interval) {
    super(symbol, interval);
    this.name = "Volume Profile";
    this.height = 0; // No ocupa espacio adicional (overlay en grÃƒÂ¡fico principal)
    
    // ConfiguraciÃƒÂ³n base
    this.rows = 100;
    this.valueAreaPercent = 0.70;
    this.histogramWidth = 50;
    this.histogramPosition = "right"; // "left", "right", "center"
    this.useGradient = true;
    this.showLabels = true;
    this.showVolumeLabels = false; // FASE 3: Labels de volumen en cada nivel
    this.hideWhenFixedRanges = false; // NUEVO: Ocultar cuando hay Fixed Ranges activos
    
    // Colores
    this.baseColor = "#2196F3";
    this.valueAreaColor = "#FF9800";
    this.pocColor = "#F44336";
    this.vahValColor = "#2196F3";
    this.clusterColor = "#9C27B0"; // FASE 3: Color para clusters
    this.rangeShadeColor = "#E0E0E0"; // NUEVO: Color del sombreado del rango fixed
    
    // Modo: "dynamic" o "fixed"
    this.mode = "dynamic";
    
    // FASE 3: Cluster detection
    this.enableClusterDetection = false;
    this.clusterThreshold = 1.5; // Multiplicador para detectar clusters
    
    // Datos del perfil calculado
    this.profile = null;
    this.fixedRange = null;
    
    // Cache de velas para detectar cambios
    this.lastVisibleRange = null;
  }

  /**
   * Actualiza la configuraciÃƒÂ³n del indicador
   */
  updateConfig(config) {
    if (config.rows !== undefined) this.rows = config.rows;
    if (config.valueAreaPercent !== undefined) this.valueAreaPercent = config.valueAreaPercent;
    if (config.histogramWidth !== undefined) this.histogramWidth = config.histogramWidth;
    if (config.histogramPosition !== undefined) this.histogramPosition = config.histogramPosition;
    if (config.useGradient !== undefined) this.useGradient = config.useGradient;
    if (config.showLabels !== undefined) this.showLabels = config.showLabels;
    if (config.showVolumeLabels !== undefined) this.showVolumeLabels = config.showVolumeLabels;
    if (config.hideWhenFixedRanges !== undefined) this.hideWhenFixedRanges = config.hideWhenFixedRanges;
    
    if (config.baseColor !== undefined) this.baseColor = config.baseColor;
    if (config.valueAreaColor !== undefined) this.valueAreaColor = config.valueAreaColor;
    if (config.pocColor !== undefined) this.pocColor = config.pocColor;
    if (config.vahValColor !== undefined) this.vahValColor = config.vahValColor;
    if (config.clusterColor !== undefined) this.clusterColor = config.clusterColor;
    if (config.rangeShadeColor !== undefined) this.rangeShadeColor = config.rangeShadeColor; // NUEVO
    
    if (config.enableClusterDetection !== undefined) this.enableClusterDetection = config.enableClusterDetection;
    if (config.clusterThreshold !== undefined) this.clusterThreshold = config.clusterThreshold;
    
    // Forzar recÃƒÂ¡lculo
    this.profile = null;
    this.lastVisibleRange = null;
  }

  async fetchData() {
    // Este indicador no necesita datos del backend
    return true;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "fixed" && this.profile) {
      this.fixedRange = {
        minPrice: this.profile.minPrice,
        maxPrice: this.profile.maxPrice,
        startIndex: this.profile.startIndex,
        endIndex: this.profile.endIndex,
        startTimestamp: this.profile.startTimestamp,
        endTimestamp: this.profile.endTimestamp
      };
    } else if (mode === "dynamic") {
      this.fixedRange = null;
    }
  }

  /**
   * Establece un rango fijo especÃƒÂ­fico por timestamp
   */
  setFixedRange(startTimestamp, endTimestamp) {
    if (this.mode === "fixed") {
      this.fixedRange = {
        startTimestamp: startTimestamp,
        endTimestamp: endTimestamp,
        isCustomRange: true
      };
      // Forzar recÃƒÂ¡lculo
      this.profile = null;
      this.lastVisibleRange = null;
    }
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

    // Calcular rango de precio
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    for (const candle of candles) {
      minPrice = Math.min(minPrice, candle.low);
      maxPrice = Math.max(maxPrice, candle.high);
    }

    const priceRange = maxPrice - minPrice;
    if (priceRange === 0) return null;

    const step = priceRange / this.rows;

    // Inicializar niveles
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
        isCluster: false // FASE 3
      });
    }

    // Acumular volumen por nivel usando solapamiento proporcional
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

    // Calcular volumen total
    let totalVolume = 0;
    for (const level of levels) {
      totalVolume += level.volume;
    }

    // Encontrar POC
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

    // Calcular Value Area
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

    // Marcar niveles dentro del Value Area
    for (let i = lowIndex; i <= highIndex; i++) {
      levels[i].isValueArea = true;
    }

    // FASE 3: Detectar clusters (zonas de alto volumen)
    if (this.enableClusterDetection) {
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
      startIndex: 0,
      endIndex: candles.length - 1,
      startTimestamp: candles[0].timestamp,
      endTimestamp: candles[candles.length - 1].timestamp
    };
  }

  shouldRecalculate(visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return false;
    if (!this.profile) return true;
    if (this.mode === "fixed" && this.fixedRange && !this.fixedRange.isCustomRange) return false;

    const currentRange = {
      start: visibleCandles[0].timestamp,
      end: visibleCandles[visibleCandles.length - 1].timestamp,
      count: visibleCandles.length
    };

    if (!this.lastVisibleRange) {
      this.lastVisibleRange = currentRange;
      return true;
    }

    const rangeChanged = 
      this.lastVisibleRange.start !== currentRange.start ||
      this.lastVisibleRange.end !== currentRange.end ||
      Math.abs(this.lastVisibleRange.count - currentRange.count) > 5;

    if (rangeChanged) {
      this.lastVisibleRange = currentRange;
      return true;
    }

    return false;
  }

  /**
   * Filtrar velas por rango de timestamp personalizado
   */
  filterCandlesByRange(allCandles, startTimestamp, endTimestamp) {
    return allCandles.filter(candle => 
      candle.timestamp >= startTimestamp && candle.timestamp <= endTimestamp
    );
  }

  /**
   * NUEVO: Renderizar sombreado del rango en modo fixed
   */
  renderRangeShading(ctx, bounds, visibleCandles, startTimestamp, endTimestamp) {
    if (!visibleCandles || visibleCandles.length === 0) return;

    const { x, y, width, height } = bounds;
    
    // Encontrar Ã­ndices de las velas que corresponden al rango
    let startIndex = -1;
    let endIndex = -1;
    
    // Detectar si el rango estÃ¡ antes, despuÃ©s o parcialmente en visibleCandles
    const firstVisibleTimestamp = visibleCandles[0].timestamp;
    const lastVisibleTimestamp = visibleCandles[visibleCandles.length - 1].timestamp;
    
    // Caso 1: Rango completamente antes de las velas visibles
    if (endTimestamp < firstVisibleTimestamp) {
      // No dibujar nada, el rango estÃ¡ completamente a la izquierda
      return;
    }
    
    // Caso 2: Rango completamente despuÃ©s de las velas visibles
    if (startTimestamp > lastVisibleTimestamp) {
      // No dibujar nada, el rango estÃ¡ completamente a la derecha
      return;
    }
    
    // Caso 3: Rango parcial o completamente visible
    for (let i = 0; i < visibleCandles.length; i++) {
      const candle = visibleCandles[i];
      
      // Encontrar inicio del rango (o usar primera vela si el rango empieza antes)
      if (startIndex === -1 && candle.timestamp >= startTimestamp) {
        startIndex = i;
      }
      
      // Si el rango empieza antes de las velas visibles, usar Ã­ndice 0
      if (startIndex === -1 && startTimestamp < firstVisibleTimestamp && i === 0) {
        startIndex = 0;
      }
      
      // Encontrar fin del rango
      if (candle.timestamp <= endTimestamp) {
        endIndex = i;
      }
    }
    
    // Si el rango termina despuÃ©s de las velas visibles, usar Ãºltima vela
    if (endIndex === -1 && endTimestamp > lastVisibleTimestamp) {
      endIndex = visibleCandles.length - 1;
    }
    
    // Si aÃºn no tenemos Ã­ndices vÃ¡lidos, retornar
    if (startIndex === -1 || endIndex === -1) return;
    
    // Asegurar que endIndex >= startIndex
    if (endIndex < startIndex) return;

    // Calcular posiciones X
    const barWidth = width / visibleCandles.length;
    const rangeStartX = x + (startIndex * barWidth);
    const rangeEndX = x + ((endIndex + 1) * barWidth);
    const rangeWidth = rangeEndX - rangeStartX;

    // Dibujar rectÃ¡ngulo sombreado
    ctx.fillStyle = this.hexToRgba(this.rangeShadeColor, 0.15);
    ctx.fillRect(rangeStartX, y, rangeWidth, height);

    // Dibujar lÃ­nea vertical izquierda (inicio del rango) - solo si el inicio estÃ¡ visible
    if (startTimestamp >= firstVisibleTimestamp) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(rangeStartX, y);
      ctx.lineTo(rangeStartX, y + height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Dibujar lÃ­nea vertical derecha (fin del rango) - solo si el fin estÃ¡ visible
    if (endTimestamp <= lastVisibleTimestamp) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(rangeEndX, y);
      ctx.lineTo(rangeEndX, y + height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  render(ctx, bounds, visibleCandles, allCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;

    const candlesToUse = allCandles || visibleCandles;

    // Modo fixed con rango personalizado
    if (this.mode === "fixed" && this.fixedRange && this.fixedRange.isCustomRange) {
      // FORZAR RECALCULO SIEMPRE para depuraciÃ³n
      this.profile = null;
      
      const filteredCandles = this.filterCandlesByRange(
        candlesToUse,
        this.fixedRange.startTimestamp,
        this.fixedRange.endTimestamp
      );
      
      console.log('%c=== VOLUME PROFILE FIXED DEBUG ===', 'background: red; color: white; font-size: 16px; padding: 5px;');
      console.log('%cTotal candles available:', 'color: blue; font-weight: bold', candlesToUse.length);
      console.log('%cRange timestamps:', 'color: blue; font-weight: bold', {
        start: new Date(this.fixedRange.startTimestamp).toISOString(),
        end: new Date(this.fixedRange.endTimestamp).toISOString()
      });
      console.log('%cFiltered candles:', 'color: blue; font-weight: bold', filteredCandles.length);
      
      if (filteredCandles.length > 0) {
        const minPrice = Math.min(...filteredCandles.map(c => c.low));
        const maxPrice = Math.max(...filteredCandles.map(c => c.high));
        console.log('%cPrice range of filtered candles:', 'color: green; font-weight: bold', { minPrice, maxPrice });
        console.log('First filtered candle:', filteredCandles[0]);
        console.log('Last filtered candle:', filteredCandles[filteredCandles.length - 1]);
        
        this.profile = this.calculateProfile(filteredCandles);
        
        console.log('%cProfile calculated:', 'color: purple; font-weight: bold', {
          minPrice: this.profile.minPrice,
          maxPrice: this.profile.maxPrice,
          totalVolume: this.profile.totalVolume,
          levelsWithVolume: this.profile.levels.filter(l => l.volume > 0).length,
          totalLevels: this.profile.levels.length
        });
      } else {
        console.error('%cNO CANDLES FILTERED!', 'background: red; color: white; font-size: 20px; padding: 10px;');
      }

      // NUEVO: Renderizar sombreado del rango PRIMERO (detrÃƒÂ¡s de todo)
      if (this.profile) {
        this.renderRangeShading(
          ctx, 
          bounds, 
          visibleCandles, 
          this.fixedRange.startTimestamp, 
          this.fixedRange.endTimestamp
        );
      }
    } else if (this.shouldRecalculate(visibleCandles)) {
      if (this.mode === "dynamic") {
        this.profile = this.calculateProfile(visibleCandles);
      } else {
        if (!this.profile) {
          this.profile = this.calculateProfile(candlesToUse);
        }
      }
    }

    if (!this.profile) return;

    const { x, y, width, height } = bounds;
    
    // Calcular posiciones segÃƒÂºn histogramPosition
    const chartRight = x + width;
    const histogramMaxWidth = (width * this.histogramWidth) / 100;
    
    let histoStartX, histoEndX;
    
    switch (this.histogramPosition) {
      case "left":
        histoStartX = x;
        histoEndX = x + histogramMaxWidth;
        break;
      case "center":
        histoStartX = x + (width - histogramMaxWidth) / 2;
        histoEndX = histoStartX + histogramMaxWidth;
        break;
      case "right":
      default:
        histoStartX = chartRight - histogramMaxWidth;
        histoEndX = chartRight;
        break;
    }

    // CRÃTICO: Usar la MISMA escala de precios que el grÃ¡fico principal
    // No usar this.profile.minPrice/maxPrice, sino el rango de las velas VISIBLES
    // Esto hace que el perfil se dibuje a las alturas correctas
    const visibleMinPrice = Math.min(...visibleCandles.map(c => c.low));
    const visibleMaxPrice = Math.max(...visibleCandles.map(c => c.high));
    const visiblePriceRange = visibleMaxPrice - visibleMinPrice;
    
    const priceToY = (price) => {
      if (visiblePriceRange === 0) return y + height / 2;
      // Usar la misma fÃ³rmula que el grÃ¡fico principal: y + height - ((price - minPrice) / priceRange) * height
      return y + height - ((price - visibleMinPrice) / visiblePriceRange) * height;
    };

    // Dibujar barras del perfil
    for (const level of this.profile.levels) {
      // En modo fixed, solo dibujar niveles con volumen > 0 (precios que realmente se visitaron)
      if (this.mode === "fixed" && level.volume === 0) {
        continue;
      }
      
      const levelY = priceToY(level.price);
      const volumeFraction = this.profile.maxVolume > 0 
        ? level.volume / this.profile.maxVolume 
        : 0;
      
      const barWidth = histogramMaxWidth * volumeFraction;
      
      // Calcular color
      let color = this.baseColor;
      
      // FASE 3: Clusters tienen prioridad sobre Value Area
      if (this.enableClusterDetection && level.isCluster) {
        color = this.clusterColor;
      } else if (level.isValueArea) {
        color = this.valueAreaColor;
      }
      
      // FASE 3: Gradiente mejorado
      if (this.useGradient) {
        const alpha = 0.15 + (volumeFraction * 0.75); // De 15% a 90% opacidad
        color = this.hexToRgba(color, alpha);
      } else {
        color = this.hexToRgba(color, 0.6);
      }

      // Dibujar barra horizontal
      ctx.fillStyle = color;
      
      if (this.histogramPosition === "left") {
        ctx.fillRect(histoStartX, levelY - 1, barWidth, 2);
      } else if (this.histogramPosition === "center") {
        const centerBarStart = histoStartX + (histogramMaxWidth - barWidth) / 2;
        ctx.fillRect(centerBarStart, levelY - 1, barWidth, 2);
      } else {
        ctx.fillRect(histoEndX - barWidth, levelY - 1, barWidth, 2);
      }

      // FASE 3: Labels de volumen en cada nivel (opcional)
      if (this.showVolumeLabels && volumeFraction > 0.3) { // Solo mostrar para niveles significativos
        ctx.fillStyle = "#333";
        ctx.font = "8px Inter, sans-serif";
        const volumeText = this.formatVolume(level.volume);
        const textX = this.histogramPosition === "left" ? histoStartX + barWidth + 3 : histoEndX - barWidth - 25;
        ctx.fillText(volumeText, textX, levelY + 3);
      }
    }

    // Dibujar lÃƒÂ­nea del POC
    const pocY = priceToY(this.profile.poc.price);
    ctx.strokeStyle = this.pocColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, pocY);
    ctx.lineTo(chartRight, pocY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dibujar lÃƒÂ­neas VAH y VAL
    const vahY = priceToY(this.profile.valueArea.vahPrice);
    const valY = priceToY(this.profile.valueArea.valPrice);
    
    ctx.strokeStyle = this.vahValColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    
    ctx.beginPath();
    ctx.moveTo(x, vahY);
    ctx.lineTo(chartRight, vahY);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(x, valY);
    ctx.lineTo(chartRight, valY);
    ctx.stroke();
    
    ctx.globalAlpha = 1.0;

    // Labels informativos
    if (this.showLabels) {
      ctx.fillStyle = "#666";
      ctx.font = "10px Inter, sans-serif";
      
      const labelX = this.histogramPosition === "left" ? x + 5 : chartRight - histogramMaxWidth + 5;
      let labelY = y + 15;
      
      // Etiqueta del modo
      const modeText = this.mode === "fixed" 
        ? (this.fixedRange && this.fixedRange.isCustomRange ? "Fixed (Custom)" : "Fixed")
        : "Dynamic";
      ctx.fillText(`VP: ${modeText}`, labelX, labelY);
      labelY += 12;
      
      // POC
      ctx.fillStyle = this.pocColor;
      ctx.fillText(`POC: ${this.profile.poc.price.toFixed(2)}`, labelX, labelY);
      labelY += 12;
      
      // VAH
      ctx.fillStyle = this.vahValColor;
      ctx.fillText(`VAH: ${this.profile.valueArea.vahPrice.toFixed(2)}`, labelX, labelY);
      labelY += 12;
      
      // VAL
      ctx.fillText(`VAL: ${this.profile.valueArea.valPrice.toFixed(2)}`, labelX, labelY);
      
      // FASE 3: Mostrar info de clusters si estÃƒÂ¡ habilitado
      if (this.enableClusterDetection) {
        labelY += 12;
        const clusterCount = this.profile.levels.filter(l => l.isCluster).length;
        ctx.fillStyle = this.clusterColor;
        ctx.fillText(`Clusters: ${clusterCount}`, labelX, labelY);
      }
    }
  }

  /**
   * Formatea el volumen para display
   */
  formatVolume(volume) {
    if (volume >= 1000000) {
      return (volume / 1000000).toFixed(1) + "M";
    } else if (volume >= 1000) {
      return (volume / 1000).toFixed(1) + "K";
    }
    return volume.toFixed(0);
  }

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ✅ NUEVO: Método renderOverlay para compatibilidad con IndicatorManager
  // El IndicatorManager busca este método para overlays en el gráfico principal
  renderOverlay(ctx, bounds, visibleCandles, allCandles) {
    // Simplemente delegar al método render existente
    return this.render(ctx, bounds, visibleCandles, allCandles);
  }
}

export default VolumeProfileIndicator;
