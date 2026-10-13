// src/components/indicators/OIVolumeConfluenceIndicator.js
// Indicador de Confluencia entre Open Interest y Volumen
// Muestra cuando ambos confirman un movimiento (fuerte) vs cuando divergen (débil)

import IndicatorBase from "./IndicatorBase";

class OIVolumeConfluenceIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "OI-Volume Confluence";
    this.days = days;

    // Referencias a otros indicadores (se inyectarán desde IndicatorManager)
    this.volumeIndicator = null;
    this.oiIndicator = null;

    // 🎯 Configuración simplificada - solo confluencias fuertes (verde/rojo)
    this.config = {
      // Cluster detection
      detectClusters: true,
      clusterMinBars: 3,

      // Filtros de señales (valores estrictos para mostrar solo confluencias significativas)
      minVolumeZScore: 1.5,
      minOIZScore: 1.5,
      minStrength: 1.0,

      // Visualización
      height: 100,
      barWidthRatio: 0.9,

      // Avanzado
      lookbackPeriod: 20,
      colors: {
        bullish: '#34C759',  // Verde - confluencia alcista (Vol+ Y OI+)
        bearish: '#FF3B30'   // Rojo - confluencia bajista (Vol- Y OI-)
      }
    };

    this.height = this.config.height;
    this.lookbackPeriod = this.config.lookbackPeriod;
  }

  /**
   * 🎯 Obtener configuración actual (para persistencia)
   */
  getConfig() {
    return {
      detectClusters: this.config.detectClusters,
      clusterMinBars: this.config.clusterMinBars,
      minVolumeZScore: this.config.minVolumeZScore,
      minOIZScore: this.config.minOIZScore,
      minStrength: this.config.minStrength,
      height: this.config.height,
      barWidthRatio: this.config.barWidthRatio,
      lookbackPeriod: this.config.lookbackPeriod,
      colors: { ...this.config.colors }
    };
  }

  /**
   * 🎯 NUEVO: Actualizar configuración
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    // Actualizar propiedades que afectan el layout
    if (newConfig.height !== undefined) {
      this.height = newConfig.height;
    }
    if (newConfig.lookbackPeriod !== undefined) {
      this.lookbackPeriod = newConfig.lookbackPeriod;
    }

    console.log(`[${this.symbol}] 🎨 OI-Volume Confluence config actualizado`, this.config);
  }

  /**
   * No necesita fetchData - usa datos de otros indicadores
   */
  async fetchData() {
    console.log(`[${this.symbol}] 🔗 OI-Volume Confluence: Usa datos de Volume y OI`);
    return true;
  }

  /**
   * Inyectar referencias a los indicadores de Volume y OI
   */
  setIndicators(volumeIndicator, oiIndicator) {
    this.volumeIndicator = volumeIndicator;
    this.oiIndicator = oiIndicator;
  }

  /**
   * Calcular Z-Score de una serie de valores
   */
  calculateZScore(values, lookbackPeriod = 20) {
    if (!values || values.length === 0) return [];

    const zScores = [];

    for (let i = 0; i < values.length; i++) {
      if (i < lookbackPeriod - 1) {
        zScores.push(0); // No hay suficiente lookback
        continue;
      }

      const window = values.slice(i - lookbackPeriod + 1, i + 1);
      const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev === 0) {
        zScores.push(0);
      } else {
        const zScore = (values[i] - mean) / stdDev;
        zScores.push(zScore);
      }
    }

    return zScores;
  }

  /**
   * Calcular confluencia entre OI y Volumen
   */
  calculateConfluence(candles) {
    if (!candles || candles.length === 0) return [];
    if (!this.volumeIndicator || !this.oiIndicator) {
      console.warn(`[${this.symbol}] ⚠️ OI-Volume Confluence: Indicadores no inyectados`);
      return [];
    }

    // 1. Obtener Volume Delta
    const volumeDeltaData = this.volumeIndicator.calculateVolumeDelta(candles);
    const volumeDeltas = volumeDeltaData.map(d => d.volumeDelta);

    // 2. Obtener OI Delta (cambio en Open Interest)
    let oiDeltas = [];

    if (this.oiIndicator.mode === "cumulative") {
      // Si OI está en modo cumulative, extraer los deltas
      const cumulativeData = this.oiIndicator.calculateCumulativeMode(candles);
      oiDeltas = cumulativeData.map(d => d.delta);
    } else if (this.oiIndicator.mode === "histogram") {
      // Si OI está en modo histogram, calcular deltas directamente
      const histogramData = this.oiIndicator.calculateHistogramMode(candles);
      oiDeltas = histogramData.map(d => d.delta);
    } else {
      // Modo flow - no es ideal para confluencia, usar histogram como fallback
      const histogramData = this.oiIndicator.calculateHistogramMode(candles);
      oiDeltas = histogramData.map(d => d.delta);
    }

    // 3. Normalizar ambos usando Z-Score
    const volumeZScores = this.calculateZScore(volumeDeltas, this.lookbackPeriod);
    const oiZScores = this.calculateZScore(oiDeltas, this.lookbackPeriod);

    // 4. Calcular confluencia
    const confluenceData = [];

    for (let i = 0; i < candles.length; i++) {
      const volZ = volumeZScores[i] || 0;
      const oiZ = oiZScores[i] || 0;

      // Confluence Score: Producto de Z-Scores (ambos positivos = positivo, ambos negativos = positivo)
      // Divergencia: Uno positivo y otro negativo = negativo
      const confluenceScore = volZ * oiZ;

      // 🎯 SIMPLIFICADO: Solo confluencias fuertes (verde/rojo)
      // Eliminamos neutrales y divergencias - solo mostramos cuando hay respaldo institucional claro
      let confluenceType = null; // null = no mostrar barra

      if (volZ > 0 && oiZ > 0) {
        // Ambos positivos = movimiento alcista con respaldo
        confluenceType = "bullish_strong";
      } else if (volZ < 0 && oiZ < 0) {
        // Ambos negativos = movimiento bajista con respaldo
        confluenceType = "bearish_strong";
      }
      // Si no cumple ninguna: null (no se muestra)

      confluenceData.push({
        timestamp: candles[i].timestamp,
        volumeZScore: volZ,
        oiZScore: oiZ,
        confluenceScore: confluenceScore,
        confluenceType: confluenceType,
        strength: Math.abs(confluenceScore), // Fuerza = valor absoluto del score
        in_progress: candles[i].in_progress || false
      });
    }

    return confluenceData;
  }

  /**
   * 🎯 NUEVO: Detectar clusters de barras consecutivas con confluencia fuerte
   * Un cluster es un grupo de N+ barras consecutivas con señales significativas
   */
  detectClusters(significantBars) {
    if (!significantBars || significantBars.length === 0) return [];

    const minBars = this.config.clusterMinBars || 3;
    const clusters = [];
    let currentCluster = null;

    significantBars.forEach((bar, idx) => {
      // Solo considerar señales fuertes (no neutrales ni divergencias)
      const isStrong = bar.confluenceType === 'bullish_strong' || bar.confluenceType === 'bearish_strong';

      if (isStrong) {
        if (!currentCluster) {
          // Iniciar nuevo cluster
          currentCluster = {
            startIndex: idx,
            endIndex: idx,
            direction: bar.confluenceType,
            bars: [bar],
            avgStrength: bar.strength
          };
        } else {
          // Verificar si la barra continúa el cluster (misma dirección)
          if (bar.confluenceType === currentCluster.direction) {
            currentCluster.endIndex = idx;
            currentCluster.bars.push(bar);
            currentCluster.avgStrength = currentCluster.bars.reduce((sum, b) => sum + b.strength, 0) / currentCluster.bars.length;
          } else {
            // Cambio de dirección - finalizar cluster anterior si cumple mínimo
            if (currentCluster.bars.length >= minBars) {
              clusters.push(currentCluster);
            }
            // Iniciar nuevo cluster
            currentCluster = {
              startIndex: idx,
              endIndex: idx,
              direction: bar.confluenceType,
              bars: [bar],
              avgStrength: bar.strength
            };
          }
        }
      } else {
        // Barra no fuerte - finalizar cluster si existe
        if (currentCluster && currentCluster.bars.length >= minBars) {
          clusters.push(currentCluster);
        }
        currentCluster = null;
      }
    });

    // Finalizar último cluster si cumple mínimo
    if (currentCluster && currentCluster.bars.length >= minBars) {
      clusters.push(currentCluster);
    }

    return clusters;
  }

  /**
   * 🎯 MEJORADO: Obtener color según tipo de confluencia
   * Con filtrado previo, usamos opacidad más alta y fija (similar a Volume Delta)
   */
  getConfluenceColor(type, strength) {
    // 🎯 NUEVO: Usar colores de la configuración
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 0, g: 0, b: 0 };
    };

    const baseColors = {
      bullish_strong: hexToRgb(this.config.colors.bullish),
      bearish_strong: hexToRgb(this.config.colors.bearish),
      divergence: hexToRgb(this.config.colors.divergence),
      neutral: hexToRgb(this.config.colors.neutral)
    };

    const color = baseColors[type] || baseColors.neutral;

    // 🎯 NUEVO: Opacidad más alta y menos variable, ya que el filtrado previo
    // elimina las señales débiles. Similar al Volume Delta (0.7 fijo)
    let alpha;
    if (type === "neutral") {
      alpha = 0.3; // Neutral más visible pero aún discreto
    } else {
      // Opacidad basada en strength pero en rango más alto [0.6, 0.85]
      // Las barras que pasan el filtro son significativas, merecen ser visibles
      if (strength < 1.0) {
        alpha = 0.6;  // Señal moderada
      } else if (strength < 2.5) {
        alpha = 0.7;  // Señal fuerte (similar a Volume Delta)
      } else {
        alpha = 0.85; // Señal muy fuerte
      }
    }

    return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
  }

  render(ctx, bounds, visibleCandles) {
    if (!this.enabled || !visibleCandles || visibleCandles.length === 0) return;

    const { x, y, width, height } = bounds;

    // Fondo
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y, width, height);

    // Línea separadora superior
    ctx.strokeStyle = "#DDE2E7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();

    // Título
    ctx.fillStyle = "#666";
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText("OI-Volume Confluence", x + 5, y + 15);

    // Calcular confluencia
    const confluenceData = this.calculateConfluence(visibleCandles);

    if (confluenceData.length === 0) {
      // Mostrar mensaje de error
      ctx.fillStyle = "#999";
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("Requiere Volume Delta y Open Interest activos", x + 5, y + height / 2);
      return;
    }

    // 🎯 MEJORADO: Escalado más inteligente
    // Encontrar percentil 95 en lugar de max absoluto para evitar outliers que compriman todo
    const absScores = confluenceData.map(d => Math.abs(d.confluenceScore)).sort((a, b) => a - b);
    const p95Index = Math.floor(absScores.length * 0.95);
    const maxScore = Math.max(absScores[p95Index] || 1, 1); // Mínimo 1 para evitar división por cero

    const histogramHeight = height - 30;
    const histogramY = y + 25;
    const barWidth = width / visibleCandles.length;
    const scoreScale = (histogramHeight / 2) / maxScore;

    // 🎯 MEJORADO: Línea cero más prominente
    const zeroY = histogramY + histogramHeight / 2;
    ctx.strokeStyle = "#B0B0B0"; // Más oscuro que antes (#DDE2E7)
    ctx.lineWidth = 1.5; // Más grueso
    ctx.setLineDash([]); // Línea sólida en lugar de punteada
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);
    ctx.stroke();
    ctx.lineWidth = 1; // Restaurar grosor por defecto

    // 🎯 FILTRO SIMPLIFICADO: Solo confluencias fuertes (verde/rojo)
    const significantBars = confluenceData.filter((d, i) => {
      // 1. Solo mostrar confluencias fuertes - rechazar null (no hay confluencia)
      if (d.confluenceType === null) return false;

      // 2. Filtrar por magnitud mínima de Z-scores (AND logic)
      // AMBOS (volumen Y OI) deben ser significativos
      const hasSignificantVolume = Math.abs(d.volumeZScore) > this.config.minVolumeZScore;
      const hasSignificantOI = Math.abs(d.oiZScore) > this.config.minOIZScore;

      if (!hasSignificantVolume || !hasSignificantOI) return false;

      // 3. Filtrar por strength mínima
      if (Math.abs(d.strength) < this.config.minStrength) return false;

      return true;
    });

    // 🎯 CLUSTER DETECTION: Detectar zonas de múltiples señales consecutivas
    const clusters = this.config.detectClusters ? this.detectClusters(significantBars) : [];

    // 🎯 NUEVO: Renderizar highlighting de clusters PRIMERO (detrás de las barras)
    if (clusters.length > 0) {
      clusters.forEach(cluster => {
        const firstBar = cluster.bars[0];
        const lastBar = cluster.bars[cluster.bars.length - 1];

        // Encontrar índices originales
        const startIdx = confluenceData.indexOf(firstBar);
        const endIdx = confluenceData.indexOf(lastBar);

        if (startIdx === -1 || endIdx === -1) return;

        // Calcular posición y ancho del rectángulo de cluster
        const clusterX = x + (startIdx * barWidth);
        const clusterWidth = ((endIdx - startIdx + 1) * barWidth);

        // Color de fondo según dirección del cluster
        const clusterColor = cluster.direction === 'bullish_strong'
          ? 'rgba(52, 199, 89, 0.15)'   // Verde muy transparente
          : 'rgba(255, 59, 48, 0.15)';  // Rojo muy transparente

        // Dibujar rectángulo de fondo
        ctx.fillStyle = clusterColor;
        ctx.fillRect(clusterX, histogramY, clusterWidth, histogramHeight);

        // Dibujar borde del cluster
        ctx.strokeStyle = cluster.direction === 'bullish_strong'
          ? 'rgba(52, 199, 89, 0.4)'
          : 'rgba(255, 59, 48, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]); // Línea punteada
        ctx.strokeRect(clusterX, histogramY, clusterWidth, histogramHeight);
        ctx.setLineDash([]); // Restaurar línea sólida

        // Etiqueta de cluster (pequeña, arriba del rectángulo)
        const clusterLabel = `${cluster.bars.length}x`;
        ctx.fillStyle = cluster.direction === 'bullish_strong' ? '#34C759' : '#FF3B30';
        ctx.font = 'bold 9px Inter, sans-serif';
        const labelWidth = ctx.measureText(clusterLabel).width;
        ctx.fillText(clusterLabel, clusterX + (clusterWidth - labelWidth) / 2, histogramY + 10);
      });
    }

    // Renderizar solo las barras significativas
    significantBars.forEach((d) => {
      // Encontrar el índice original para calcular la posición X correcta
      const originalIndex = confluenceData.indexOf(d);
      const barX = x + (originalIndex * barWidth);
      const score = d.confluenceScore;

      // Altura de la barra - clampeada al máximo de la escala
      const rawHeight = Math.abs(score) * scoreScale;
      const barHeight = Math.min(rawHeight, histogramHeight / 2);

      // Color con opacidad dinámica incluida
      const color = this.getConfluenceColor(d.confluenceType, d.strength);
      ctx.fillStyle = color;

      // 🎯 NUEVO: Usar ancho de barra de la configuración
      const effectiveBarWidth = barWidth * (this.config.barWidthRatio || 0.9);

      if (score >= 0) {
        // Barra positiva (confluencia alcista)
        ctx.fillRect(barX, zeroY - barHeight, effectiveBarWidth, barHeight);
      } else if (score < 0) {
        // Barra negativa (divergencia o confluencia bajista)
        ctx.fillRect(barX, zeroY, effectiveBarWidth, barHeight);
      }
    });

    // 🎯 MEJORADO: Leyenda más compacta en la parte inferior (usar colores del config)
    const legendY = y + height - 8;
    const legendItems = [
      { label: "Conf ▲", color: this.config.colors.bullish },
      { label: "Conf ▼", color: this.config.colors.bearish },
      { label: "Diverg", color: this.config.colors.divergence }
    ];

    let legendX = x + width - 220;
    legendItems.forEach(item => {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, legendY - 6, 8, 8);
      ctx.fillStyle = "#666";
      ctx.font = "9px Inter, sans-serif";
      ctx.fillText(item.label, legendX + 10, legendY);
      legendX += 70;
    });

    // 🎯 MEJORADO: Valor actual más informativo
    if (confluenceData.length > 0) {
      const lastData = confluenceData[confluenceData.length - 1];

      // Etiqueta compacta del estado actual
      const label = {
        bullish_strong: "CONF ▲",
        bearish_strong: "CONF ▼",
        divergence: "DIVERG",
        neutral: "━"
      }[lastData.confluenceType] || "━";

      // Color base sin opacidad para el texto
      const baseColors = {
        bullish_strong: "#34C759",
        bearish_strong: "#FF3B30",
        divergence: "#FF9800",
        neutral: "#999"
      };

      ctx.fillStyle = baseColors[lastData.confluenceType] || "#999";
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillText(label, x + 5, y + height - 8);

      // Mostrar Z-Scores de forma más compacta
      ctx.fillStyle = "#666";
      ctx.font = "9px Inter, sans-serif";
      const volZText = `V:${lastData.volumeZScore >= 0 ? '+' : ''}${lastData.volumeZScore.toFixed(1)}`;
      const oiZText = `OI:${lastData.oiZScore >= 0 ? '+' : ''}${lastData.oiZScore.toFixed(1)}`;
      ctx.fillText(`${volZText} ${oiZText}`, x + 45, y + height - 8);
    }
  }
}

export default OIVolumeConfluenceIndicator;
