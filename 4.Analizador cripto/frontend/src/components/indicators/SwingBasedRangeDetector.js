// SwingBasedRangeDetector.js
// Detector de rangos basado en estructura de mercado (Swing Highs/Lows)

import IndicatorBase from './IndicatorBase';

class SwingBasedRangeDetector extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Swing-Based Range Detection";
    this.height = 0;

    // Configuración
    this.config = {
      swingLength: 5,              // Velas a cada lado para identificar swing point (default: 5)
      rangeTolerancePercent: 0.02, // 2% de tolerancia para considerar highs/lows "iguales"
      minRangeDuration: 20,        // Mínimo de velas para considerar un rango válido
      maxActiveRanges: 10,
      autoCreateFixedRange: true
    };

    this.swingHighs = [];      // [{index, price, timestamp}]
    this.swingLows = [];       // [{index, price, timestamp}]
    this.detectedRanges = [];  // Rangos activos detectados
    this.dateFilter = null;
  }

  // ==================== CONFIGURACIÓN ====================

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`[${this.symbol}] 🎯 Config actualizada:`, this.config);
  }

  setDateFilter(startTimestamp, endTimestamp) {
    this.dateFilter = { start: startTimestamp, end: endTimestamp };
    console.log(`[${this.symbol}] 📅 Date filter activado:`, {
      start: new Date(startTimestamp).toISOString(),
      end: new Date(endTimestamp).toISOString()
    });
  }

  clearDateFilter() {
    this.dateFilter = null;
    console.log(`[${this.symbol}] 📅 Date filter desactivado`);
  }

  // ==================== DETECCIÓN DE SWING POINTS ====================

  /**
   * Identifica todos los swing highs en las velas
   */
  findSwingHighs(candles) {
    const swingHighs = [];
    const len = this.config.swingLength;

    for (let i = len; i < candles.length - len; i++) {
      const currentHigh = candles[i].high;
      let isSwingHigh = true;

      // Verificar que sea mayor que las 'len' velas a la izquierda
      for (let left = 1; left <= len; left++) {
        if (candles[i - left].high >= currentHigh) {
          isSwingHigh = false;
          break;
        }
      }

      if (!isSwingHigh) continue;

      // Verificar que sea mayor que las 'len' velas a la derecha
      for (let right = 1; right <= len; right++) {
        if (candles[i + right].high >= currentHigh) {
          isSwingHigh = false;
          break;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({
          index: i,
          price: currentHigh,
          timestamp: candles[i].timestamp
        });
      }
    }

    return swingHighs;
  }

  /**
   * Identifica todos los swing lows en las velas
   */
  findSwingLows(candles) {
    const swingLows = [];
    const len = this.config.swingLength;

    for (let i = len; i < candles.length - len; i++) {
      const currentLow = candles[i].low;
      let isSwingLow = true;

      // Verificar que sea menor que las 'len' velas a la izquierda
      for (let left = 1; left <= len; left++) {
        if (candles[i - left].low <= currentLow) {
          isSwingLow = false;
          break;
        }
      }

      if (!isSwingLow) continue;

      // Verificar que sea menor que las 'len' velas a la derecha
      for (let right = 1; right <= len; right++) {
        if (candles[i + right].low <= currentLow) {
          isSwingLow = false;
          break;
        }
      }

      if (isSwingLow) {
        swingLows.push({
          index: i,
          price: currentLow,
          timestamp: candles[i].timestamp
        });
      }
    }

    return swingLows;
  }

  // ==================== DETECCIÓN DE RANGOS ====================

  /**
   * Detecta rangos basándose en los swing points
   * Patrón: H + L + H (o L + H + L) donde los H/L son similares
   */
  analyze(candles) {
    console.log(`[${this.symbol}] 🔄 Ejecutando análisis Swing-Based con ${candles.length} velas...`);

    // Aplicar filtro de fechas si está configurado
    let candlesToAnalyze = candles;
    if (this.dateFilter) {
      candlesToAnalyze = candles.filter(c =>
        c.timestamp >= this.dateFilter.start && c.timestamp <= this.dateFilter.end
      );
      console.log(`[${this.symbol}] 📅 Después del filtro: ${candlesToAnalyze.length} velas (de ${candles.length} totales)`);
    }

    // 1. Identificar swing highs y lows
    this.swingHighs = this.findSwingHighs(candlesToAnalyze);
    this.swingLows = this.findSwingLows(candlesToAnalyze);

    console.log(`[${this.symbol}] 📊 Swing Points: ${this.swingHighs.length} highs, ${this.swingLows.length} lows`);

    // 2. Limpiar rangos anteriores
    this.detectedRanges = [];

    // 3. Buscar patrones H-L-H (rango formado por swing highs similares)
    this.detectRangesFromSwingHighs(candlesToAnalyze);

    // 4. Buscar patrones L-H-L (rango formado por swing lows similares)
    this.detectRangesFromSwingLows(candlesToAnalyze);

    // 5. Limpiar rangos obsoletos
    this.pruneOldRanges();

    console.log(`[${this.symbol}] ✅ Análisis completado: ${this.detectedRanges.length} rangos detectados`);

    return this.detectedRanges;
  }

  /**
   * Detecta rangos usando patrón H-L-H
   */
  detectRangesFromSwingHighs(candles) {
    const tolerance = this.config.rangeTolerancePercent;

    for (let i = 0; i < this.swingHighs.length - 1; i++) {
      const firstHigh = this.swingHighs[i];

      // Buscar el siguiente swing high que sea similar (dentro de la tolerancia)
      for (let j = i + 1; j < this.swingHighs.length; j++) {
        const secondHigh = this.swingHighs[j];

        // Verificar si los highs son similares (dentro de tolerancia)
        const priceDiff = Math.abs(secondHigh.price - firstHigh.price);
        const avgPrice = (secondHigh.price + firstHigh.price) / 2;
        const diffPercent = priceDiff / avgPrice;

        if (diffPercent > tolerance) continue; // Highs muy diferentes

        // Buscar swing lows entre estos dos highs
        const lowsBetween = this.swingLows.filter(sl =>
          sl.index > firstHigh.index && sl.index < secondHigh.index
        );

        if (lowsBetween.length === 0) continue; // No hay low entre los highs

        // Encontrar el swing low más bajo entre los dos highs
        const lowestPoint = lowsBetween.reduce((min, curr) =>
          curr.price < min.price ? curr : min
        );

        // Calcular duración del rango
        const duration = secondHigh.index - firstHigh.index;
        if (duration < this.config.minRangeDuration) continue;

        // Crear el rango
        const rangeHigh = Math.max(firstHigh.price, secondHigh.price);
        const rangeLow = lowestPoint.price;

        this.createRange({
          startTimestamp: firstHigh.timestamp,
          endTimestamp: secondHigh.timestamp,
          high: rangeHigh,
          low: rangeLow,
          type: 'H-L-H',
          duration: duration,
          swingPoints: {
            firstHigh,
            secondHigh,
            low: lowestPoint
          }
        });

        break; // Solo crear un rango por swing high inicial
      }
    }
  }

  /**
   * Detecta rangos usando patrón L-H-L
   */
  detectRangesFromSwingLows(candles) {
    const tolerance = this.config.rangeTolerancePercent;

    for (let i = 0; i < this.swingLows.length - 1; i++) {
      const firstLow = this.swingLows[i];

      // Buscar el siguiente swing low que sea similar (dentro de la tolerancia)
      for (let j = i + 1; j < this.swingLows.length; j++) {
        const secondLow = this.swingLows[j];

        // Verificar si los lows son similares (dentro de tolerancia)
        const priceDiff = Math.abs(secondLow.price - firstLow.price);
        const avgPrice = (secondLow.price + firstLow.price) / 2;
        const diffPercent = priceDiff / avgPrice;

        if (diffPercent > tolerance) continue; // Lows muy diferentes

        // Buscar swing highs entre estos dos lows
        const highsBetween = this.swingHighs.filter(sh =>
          sh.index > firstLow.index && sh.index < secondLow.index
        );

        if (highsBetween.length === 0) continue; // No hay high entre los lows

        // Encontrar el swing high más alto entre los dos lows
        const highestPoint = highsBetween.reduce((max, curr) =>
          curr.price > max.price ? curr : max
        );

        // Calcular duración del rango
        const duration = secondLow.index - firstLow.index;
        if (duration < this.config.minRangeDuration) continue;

        // Verificar que no se traslape con rangos H-L-H ya creados
        const overlaps = this.detectedRanges.some(r =>
          this.rangesOverlap(
            firstLow.timestamp, secondLow.timestamp,
            r.startTimestamp, r.endTimestamp
          )
        );

        if (overlaps) continue;

        // Crear el rango
        const rangeHigh = highestPoint.price;
        const rangeLow = Math.min(firstLow.price, secondLow.price);

        this.createRange({
          startTimestamp: firstLow.timestamp,
          endTimestamp: secondLow.timestamp,
          high: rangeHigh,
          low: rangeLow,
          type: 'L-H-L',
          duration: duration,
          swingPoints: {
            firstLow,
            secondLow,
            high: highestPoint
          }
        });

        break; // Solo crear un rango por swing low inicial
      }
    }
  }

  /**
   * Crea un nuevo rango detectado
   */
  createRange(rangeData) {
    const range = {
      id: `range_${rangeData.startTimestamp}`,
      rangeId: `range_${rangeData.startTimestamp}`,
      startTimestamp: rangeData.startTimestamp,
      endTimestamp: rangeData.endTimestamp,
      high: rangeData.high,
      low: rangeData.low,
      type: rangeData.type,
      duration: rangeData.duration,
      swingPoints: rangeData.swingPoints,
      status: 'confirmed',
      detectedAt: Date.now(),
      isAutoDetected: true,
      processed: false
    };

    this.detectedRanges.push(range);

    console.log(`[${this.symbol}] ✨ Rango ${range.type} detectado:`, {
      start: new Date(range.startTimestamp).toISOString(),
      end: new Date(range.endTimestamp).toISOString(),
      high: range.high.toFixed(2),
      low: range.low.toFixed(2),
      duration: range.duration
    });
  }

  /**
   * Verifica si dos rangos se traslapan temporalmente
   */
  rangesOverlap(start1, end1, start2, end2) {
    return !(end1 < start2 || end2 < start1);
  }

  /**
   * Elimina rangos obsoletos
   */
  pruneOldRanges() {
    const now = Date.now();
    const daysInMs = this.days * 24 * 60 * 60 * 1000;
    const oldestAllowedTimestamp = now - daysInMs;

    const beforeCount = this.detectedRanges.length;

    this.detectedRanges = this.detectedRanges.filter(range => {
      return range.endTimestamp >= oldestAllowedTimestamp;
    });

    const removedByAge = beforeCount - this.detectedRanges.length;
    if (removedByAge > 0) {
      console.log(`[${this.symbol}] 🗑️ Rangos obsoletos eliminados: ${removedByAge}`);
    }

    // Limitar cantidad máxima
    if (this.detectedRanges.length > this.config.maxActiveRanges) {
      this.detectedRanges.sort((a, b) => b.detectedAt - a.detectedAt);
      const removed = this.detectedRanges.splice(this.config.maxActiveRanges);
      console.log(`[${this.symbol}] 🗑️ Rangos excedentes eliminados: ${removed.length}`);
    }
  }

  // ==================== UTILIDADES ====================

  getDetectedRanges() {
    return this.detectedRanges;
  }

  clearAllRanges() {
    this.detectedRanges = [];
    this.swingHighs = [];
    this.swingLows = [];
    console.log(`[${this.symbol}] 🧹 Todos los rangos eliminados`);
  }

  markRangeAsProcessed(rangeId) {
    const range = this.detectedRanges.find(r => r.rangeId === rangeId);
    if (range) {
      range.processed = true;
    }
  }

  render(ctx, bounds) {
    // Este indicador no se renderiza directamente (opera en background)
    return;
  }
}

export default SwingBasedRangeDetector;
