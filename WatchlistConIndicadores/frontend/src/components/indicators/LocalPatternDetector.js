// src/components/indicators/LocalPatternDetector.js

/**
 * Local Pattern Detector
 *
 * Detecta patrones de velas directamente en el frontend sin requerir backend
 * Permite visualizar patrones históricos para validar la calidad de detección
 */
class LocalPatternDetector {
  constructor() {
    this.patterns = {
      HAMMER: 'Hammer',
      SHOOTING_STAR: 'Shooting Star',
      ENGULFING_BULLISH: 'Bullish Engulfing',
      ENGULFING_BEARISH: 'Bearish Engulfing',
      DOJI_DRAGONFLY: 'Dragonfly Doji',
      DOJI_GRAVESTONE: 'Gravestone Doji'
    };
  }

  /**
   * Detecta todos los patrones en un array de velas
   * @param {Array} candles - Array de velas OHLC
   * @param {Object} config - Configuración de detección
   * @returns {Array} Array de patrones detectados
   */
  detectPatterns(candles, config = {}) {
    if (!candles || candles.length < 2) {
      return [];
    }

    const patterns = [];
    const enabledPatterns = config.patterns || {
      hammer: { enabled: true, minWickRatio: 2.0 },
      shootingStar: { enabled: true, minWickRatio: 2.0 },
      engulfing: { enabled: true },
      doji: { enabled: true }
    };

    // Configuración de volumen Z-score
    const volumeConfig = config.volumeZScore || {
      enabled: false,
      lookbackPeriod: 20,
      minZScore: 1.0
    };

    // Pre-calcular Z-scores de volumen si está habilitado
    const volumeZScores = volumeConfig.enabled ? this.calculateVolumeZScores(candles, volumeConfig.lookbackPeriod) : null;

    // Detectar patrones para cada vela (excepto la primera)
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];

      // Skip invalid candles
      if (!this.isValidCandle(current)) continue;

      // Validar volumen si está habilitado
      if (volumeConfig.enabled && volumeZScores) {
        const zScore = volumeZScores[i];
        if (zScore === null || zScore < volumeConfig.minZScore) {
          continue; // Skip this candle if volume is not significant
        }
      }

      // Hammer
      if (enabledPatterns.hammer?.enabled && this.isHammer(current, enabledPatterns.hammer.minWickRatio)) {
        patterns.push({
          type: 'HAMMER',
          timestamp: current.timestamp,
          price: current.close,
          candle: current,
          quality: this.calculateHammerQuality(current)
        });
      }

      // Shooting Star
      if (enabledPatterns.shootingStar?.enabled && this.isShootingStar(current, enabledPatterns.shootingStar.minWickRatio)) {
        patterns.push({
          type: 'SHOOTING_STAR',
          timestamp: current.timestamp,
          price: current.close,
          candle: current,
          quality: this.calculateShootingStarQuality(current)
        });
      }

      // Engulfing patterns (necesita vela anterior)
      if (enabledPatterns.engulfing?.enabled && previous) {
        const engulfingType = this.isEngulfing(previous, current);
        if (engulfingType) {
          patterns.push({
            type: engulfingType,
            timestamp: current.timestamp,
            price: current.close,
            candle: current,
            previousCandle: previous,
            quality: this.calculateEngulfingQuality(previous, current)
          });
        }
      }

      // Doji patterns
      if (enabledPatterns.doji?.enabled) {
        const dojiType = this.isDoji(current);
        if (dojiType) {
          patterns.push({
            type: dojiType,
            timestamp: current.timestamp,
            price: current.close,
            candle: current,
            quality: this.calculateDojiQuality(current)
          });
        }
      }
    }

    console.log(`[LocalPatternDetector] Detected ${patterns.length} patterns in ${candles.length} candles`);
    return patterns;
  }

  /**
   * Valida que una vela tenga datos correctos
   */
  isValidCandle(candle) {
    return candle &&
           candle.open > 0 &&
           candle.high > 0 &&
           candle.low > 0 &&
           candle.close > 0 &&
           candle.high >= candle.low &&
           candle.high >= Math.max(candle.open, candle.close) &&
           candle.low <= Math.min(candle.open, candle.close);
  }

  /**
   * Detecta patrón Hammer
   * - Cuerpo pequeño en la parte superior
   * - Mecha inferior larga (al menos 2x el cuerpo)
   * - Poca o ninguna mecha superior
   */
  isHammer(candle, minWickRatio = 2.0) {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const range = candle.high - candle.low;

    // Evitar división por cero
    if (body === 0 || range === 0) return false;

    // Mecha inferior debe ser al menos minWickRatio veces el cuerpo
    const wickToBodyRatio = lowerWick / body;

    // Mecha superior debe ser pequeña (máximo 20% del cuerpo)
    const upperWickRatio = upperWick / body;

    // Cuerpo debe estar en el tercio superior
    const bodyPosition = (Math.min(candle.open, candle.close) - candle.low) / range;

    return wickToBodyRatio >= minWickRatio &&
           upperWickRatio <= 0.2 &&
           bodyPosition >= 0.6;
  }

  /**
   * Detecta patrón Shooting Star
   * - Cuerpo pequeño en la parte inferior
   * - Mecha superior larga (al menos 2x el cuerpo)
   * - Poca o ninguna mecha inferior
   */
  isShootingStar(candle, minWickRatio = 2.0) {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const range = candle.high - candle.low;

    if (body === 0 || range === 0) return false;

    const wickToBodyRatio = upperWick / body;
    const lowerWickRatio = lowerWick / body;
    const bodyPosition = (candle.high - Math.max(candle.open, candle.close)) / range;

    return wickToBodyRatio >= minWickRatio &&
           lowerWickRatio <= 0.2 &&
           bodyPosition >= 0.6;
  }

  /**
   * Detecta patrones Engulfing
   * - Vela actual engulfa completamente a la anterior
   * - Direcciones opuestas
   */
  isEngulfing(prev, current) {
    const prevBullish = prev.close > prev.open;
    const currentBullish = current.close > current.open;

    // Deben ser de direcciones opuestas
    if (prevBullish === currentBullish) return null;

    // Bullish Engulfing: vela alcista engulfa bajista anterior
    if (currentBullish && !prevBullish) {
      if (current.open <= prev.close && current.close >= prev.open) {
        return 'ENGULFING_BULLISH';
      }
    }

    // Bearish Engulfing: vela bajista engulfa alcista anterior
    if (!currentBullish && prevBullish) {
      if (current.open >= prev.close && current.close <= prev.open) {
        return 'ENGULFING_BEARISH';
      }
    }

    return null;
  }

  /**
   * Detecta patrones Doji
   * - Cuerpo muy pequeño (apertura ≈ cierre)
   * - Dragonfly: mecha inferior larga
   * - Gravestone: mecha superior larga
   */
  isDoji(candle) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;

    if (range === 0) return null;

    // Cuerpo debe ser menos del 5% del rango total
    const bodyRatio = body / range;
    if (bodyRatio > 0.05) return null;

    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);

    // Dragonfly Doji: mecha inferior larga, superior corta
    if (lowerWick > range * 0.6 && upperWick < range * 0.1) {
      return 'DOJI_DRAGONFLY';
    }

    // Gravestone Doji: mecha superior larga, inferior corta
    if (upperWick > range * 0.6 && lowerWick < range * 0.1) {
      return 'DOJI_GRAVESTONE';
    }

    return null;
  }

  /**
   * Calcula la calidad del patrón Hammer (0-100)
   */
  calculateHammerQuality(candle) {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);

    if (body === 0) return 0;

    const wickRatio = lowerWick / body;
    const upperWickRatio = upperWick / body;

    // Mejor calidad: mecha inferior muy larga, superior muy pequeña
    let quality = Math.min(100, wickRatio * 20); // Max 100 cuando ratio >= 5
    quality -= upperWickRatio * 10; // Penalizar mecha superior

    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Calcula la calidad del patrón Shooting Star (0-100)
   */
  calculateShootingStarQuality(candle) {
    const body = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    if (body === 0) return 0;

    const wickRatio = upperWick / body;
    const lowerWickRatio = lowerWick / body;

    let quality = Math.min(100, wickRatio * 20);
    quality -= lowerWickRatio * 10;

    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Calcula la calidad del patrón Engulfing (0-100)
   */
  calculateEngulfingQuality(prev, current) {
    const prevBody = Math.abs(prev.close - prev.open);
    const currentBody = Math.abs(current.close - current.open);

    if (prevBody === 0) return 0;

    // Mejor calidad cuando la vela actual es mucho más grande
    const sizeRatio = currentBody / prevBody;

    // Calidad basada en cuánto más grande es la vela engulfing
    let quality = Math.min(100, sizeRatio * 40);

    // Bonus si el engulfing es completo (incluye las mechas)
    if (current.high > prev.high && current.low < prev.low) {
      quality += 20;
    }

    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Calcula la calidad del patrón Doji (0-100)
   */
  calculateDojiQuality(candle) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;

    if (range === 0) return 0;

    const bodyRatio = body / range;

    // Mejor calidad cuando el cuerpo es más pequeño
    const quality = 100 * (1 - (bodyRatio / 0.05)); // Max cuando bodyRatio cerca de 0

    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Obtiene el nombre legible del patrón
   */
  getPatternName(type) {
    return this.patterns[type] || type;
  }

  /**
   * Calcula Z-scores de volumen para cada vela
   * Z-score = (volumen - media) / desviación estándar
   *
   * @param {Array} candles - Array de velas
   * @param {number} lookbackPeriod - Período de lookback para calcular media/std
   * @returns {Array} Array de Z-scores (null para velas con datos insuficientes)
   */
  calculateVolumeZScores(candles, lookbackPeriod = 20) {
    const zScores = [];

    for (let i = 0; i < candles.length; i++) {
      // Necesitamos al menos lookbackPeriod velas para calcular
      if (i < lookbackPeriod - 1) {
        zScores.push(null);
        continue;
      }

      // Obtener volúmenes del período lookback
      const volumes = [];
      for (let j = i - lookbackPeriod + 1; j <= i; j++) {
        volumes.push(candles[j].volume);
      }

      // Calcular media
      const mean = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

      // Calcular desviación estándar
      const squaredDiffs = volumes.map(v => Math.pow(v - mean, 2));
      const variance = squaredDiffs.reduce((sum, sd) => sum + sd, 0) / volumes.length;
      const stdDev = Math.sqrt(variance);

      // Calcular Z-score
      if (stdDev === 0) {
        zScores.push(0);
      } else {
        const currentVolume = candles[i].volume;
        const zScore = (currentVolume - mean) / stdDev;
        zScores.push(zScore);
      }
    }

    return zScores;
  }
}

export default LocalPatternDetector;
