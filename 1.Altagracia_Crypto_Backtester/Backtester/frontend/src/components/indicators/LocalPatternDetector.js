// src/components/indicators/LocalPatternDetector.js

/**
 * Local Pattern Detector
 *
 * Detecta patrones de velas directamente en el frontend sin requerir backend
 * Permite visualizar patrones históricos para validar la calidad de detección
 */
import { findPatterns, ruleOptions } from './candlePatterns.js';

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
    // La regla es la de candlePatterns.js (16/11/2026), la misma del servidor: formas de Nison y Bulkowski, tendencia
    // previa y volumen opcionales. Antes el envolvente salía en el 26% de las velas y la mecha contraria se medía
    // contra el cuerpo
    const valid = candles.filter(c => this.isValidCandle(c));
    return findPatterns(valid, ruleOptions(config)).map(({ index, type, volumeZ }) => {
      const current = valid[index];
      const previous = valid[index - 1];
      const pattern = { type, timestamp: current.timestamp, price: current.close, candle: current, volumeZ };
      if (type === 'HAMMER') pattern.quality = this.calculateHammerQuality(current);
      else if (type === 'SHOOTING_STAR') pattern.quality = this.calculateShootingStarQuality(current);
      else if (type.startsWith('ENGULFING')) {
        pattern.previousCandle = previous;
        pattern.quality = this.calculateEngulfingQuality(previous, current);
      } else pattern.quality = this.calculateDojiQuality(current);
      return pattern;
    });
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

}

export default LocalPatternDetector;
