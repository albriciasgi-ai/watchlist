// ATRBasedRangeDetector.js
// Detector de rangos basado en ATR y Media Móvil (inspirado en LuxAlgo Range Detector)

import IndicatorBase from './IndicatorBase';

class ATRBasedRangeDetector extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "ATR-Based Range Detection";
    this.height = 0;

    // Configuración
    this.config = {
      minRangeLength: 20,        // Mínimo de velas para considerar un rango (default: 20)
      atrMultiplier: 1.0,        // Multiplicador del ATR para definir ancho del rango (default: 1.0)
      atrLength: 200,            // Período del ATR (default: 200, ajustado de 500 para timeframes cortos)
      maxActiveRanges: 10,
      autoCreateFixedRange: true,
      maxBreakoutCandles: 5,     // 🎯 Máximo de velas fuera del rango antes de finalizarlo (default: 5)
      createTrendProfiles: false,// 🎯 Crear VP entre rangos para tendencias (default: false)
      showOtherTimeframes: false // 🎯 NUEVO: Mostrar rangos de otros timeframes (default: false)
    };

    this.detectedRanges = [];  // Rangos activos detectados
    this.dateFilter = null;
  }

  // ==================== CONFIGURACIÓN ====================

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`[${this.symbol}] 🎯 Config ATR actualizada:`, this.config);
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

  // ==================== CÁLCULO DE INDICADORES ====================

  /**
   * Calcula ATR (Average True Range)
   */
  calculateATR(candles, period) {
    if (candles.length < period + 1) return [];

    const trueRanges = [];

    // Calcular True Range para cada vela
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    // Calcular ATR como promedio móvil del True Range
    const atrValues = [];

    for (let i = period - 1; i < trueRanges.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += trueRanges[i - j];
      }
      atrValues.push(sum / period);
    }

    return atrValues;
  }

  /**
   * Calcula SMA (Simple Moving Average)
   */
  calculateSMA(candles, period) {
    if (candles.length < period) return [];

    const smaValues = [];

    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += candles[i - j].close;
      }
      smaValues.push(sum / period);
    }

    return smaValues;
  }

  // ==================== DETECCIÓN DE RANGOS ====================

  /**
   * Analiza las velas y detecta rangos usando el método ATR-based
   */
  analyze(candles) {
    console.log(`[${this.symbol}] 🔄 Ejecutando análisis ATR-Based con ${candles.length} velas...`);

    // Aplicar filtro de fechas si está configurado
    let candlesToAnalyze = candles;
    if (this.dateFilter) {
      candlesToAnalyze = candles.filter(c =>
        c.timestamp >= this.dateFilter.start && c.timestamp <= this.dateFilter.end
      );
      console.log(`[${this.symbol}] 📅 Después del filtro: ${candlesToAnalyze.length} velas (de ${candles.length} totales)`);
    }

    if (candlesToAnalyze.length < this.config.minRangeLength + this.config.atrLength) {
      console.log(`[${this.symbol}] ⚠️ No hay suficientes velas para el análisis`);
      return [];
    }

    // 1. Calcular ATR y SMA
    const atrValues = this.calculateATR(candlesToAnalyze, this.config.atrLength);
    const smaValues = this.calculateSMA(candlesToAnalyze, this.config.minRangeLength);

    console.log(`[${this.symbol}] 📊 ATR calculado: ${atrValues.length} valores, SMA: ${smaValues.length} valores`);

    // 2. Limpiar rangos anteriores
    this.detectedRanges = [];

    // 3. Detectar rangos
    this.detectRanges(candlesToAnalyze, atrValues, smaValues);

    // 4. Limpiar rangos obsoletos
    this.pruneOldRanges();

    console.log(`[${this.symbol}] ✅ Análisis completado: ${this.detectedRanges.length} rangos detectados`);

    return this.detectedRanges;
  }

  /**
   * Detecta rangos verificando cuántas velas se mantienen dentro del rango ATR
   * 🎯 Con soporte para re-ingreso: permite que el precio salga y vuelva a entrar
   */
  detectRanges(candles, atrValues, smaValues) {
    const length = this.config.minRangeLength;

    // Offset para alinear índices (ATR necesita 1 vela extra, SMA necesita 'length' velas)
    const startIndex = Math.max(this.config.atrLength, length);

    let currentRange = null;
    let prevCountOutside = null;
    let breakoutCandleCount = 0; // 🎯 NUEVO: Contador de velas fuera del rango

    for (let i = startIndex; i < candles.length; i++) {
      const atrIndex = i - this.config.atrLength;
      const smaIndex = i - length;

      if (atrIndex < 0 || smaIndex < 0 || atrIndex >= atrValues.length || smaIndex >= smaValues.length) {
        continue;
      }

      const atr = atrValues[atrIndex] * this.config.atrMultiplier;
      const ma = smaValues[smaIndex];
      const rangeHigh = ma + atr;
      const rangeLow = ma - atr;

      // 🎯 CAMBIO: Verificar si la VELA ACTUAL está dentro del rango
      const currentCandleClose = candles[i].close;
      const isCurrentCandleInside = currentCandleClose >= rangeLow && currentCandleClose <= rangeHigh;

      // Contar cuántas de las últimas 'length' velas están FUERA del rango ATR
      let countOutside = 0;
      for (let j = 0; j < length; j++) {
        const idx = i - j;
        if (idx < 0) break;

        const deviation = Math.abs(candles[idx].close - ma);
        if (deviation > atr) {
          countOutside++;
        }
      }

      // Si TODAS las velas están dentro del rango (countOutside == 0)
      if (countOutside === 0 && prevCountOutside !== 0) {
        // TRANSICIÓN: fuera → dentro

        // 🎯 VERIFICAR RE-INGRESO: ¿Había un rango activo en pausa?
        if (currentRange && breakoutCandleCount > 0 && breakoutCandleCount <= this.config.maxBreakoutCandles) {
          // RE-INGRESO EXITOSO: Continuar el rango
          console.log(`[${this.symbol}] 🔙 Re-ingreso detectado después de ${breakoutCandleCount} velas fuera del rango`);
          currentRange.endIndex = i;
          currentRange.endTimestamp = candles[i].timestamp;
          currentRange.candleCount++;
          currentRange.high = Math.max(currentRange.high, ma + atr);
          currentRange.low = Math.min(currentRange.low, ma - atr);
          currentRange.ma = ma;
          currentRange.atr = atr;
          breakoutCandleCount = 0; // Resetear contador
        } else {
          // NUEVO RANGO (o rango anterior expiró)
          const rangeHigh = ma + atr;
          const rangeLow = ma - atr;
          const newRangeStartIndex = i - length + 1;

          // 🎯 VERIFICAR OVERLAP CON EL ÚLTIMO RANGO GUARDADO
          const lastSavedRange = this.detectedRanges[this.detectedRanges.length - 1];

          if (lastSavedRange && newRangeStartIndex <= lastSavedRange.endIndex) {
            // HAY OVERLAP: Mergear con el rango anterior
            console.log(`[${this.symbol}] 🔄 Mergeando rango overlapeado (startIndex ${newRangeStartIndex} <= lastEndIndex ${lastSavedRange.endIndex})`);

            lastSavedRange.endIndex = i;
            lastSavedRange.endTimestamp = candles[i].timestamp;
            lastSavedRange.high = Math.max(lastSavedRange.high, rangeHigh);
            lastSavedRange.low = Math.min(lastSavedRange.low, rangeLow);
            lastSavedRange.ma = ma;
            lastSavedRange.atr = atr;
            lastSavedRange.duration = lastSavedRange.endIndex - lastSavedRange.startIndex + 1;
            lastSavedRange.rangeSize = ((lastSavedRange.high - lastSavedRange.low) / lastSavedRange.low * 100).toFixed(2) + '%';

            currentRange = null;
          } else {
            // NO HAY OVERLAP: Crear nuevo rango
            currentRange = {
              startIndex: newRangeStartIndex,
              startTimestamp: candles[newRangeStartIndex].timestamp,
              endIndex: i,
              endTimestamp: candles[i].timestamp,
              high: rangeHigh,
              low: rangeLow,
              ma: ma,
              atr: atr,
              candleCount: length
            };
          }
          breakoutCandleCount = 0;
        }
      } else if (countOutside === 0) {
        // DENTRO DEL RANGO: Extender rango existente
        if (currentRange) {
          currentRange.endIndex = i;
          currentRange.endTimestamp = candles[i].timestamp;
          currentRange.candleCount++;
          currentRange.high = Math.max(currentRange.high, ma + atr);
          currentRange.low = Math.min(currentRange.low, ma - atr);
          currentRange.ma = ma;
          currentRange.atr = atr;
        }
        breakoutCandleCount = 0; // Resetear contador (estamos dentro)
      } else {
        // HAY VELAS FUERA DEL RANGO (pero no necesariamente la actual)

        // 🎯 NUEVA LÓGICA: Usar isCurrentCandleInside para el re-ingreso
        if (currentRange) {
          if (!isCurrentCandleInside) {
            // La vela ACTUAL está fuera
            breakoutCandleCount++;

            if (breakoutCandleCount > this.config.maxBreakoutCandles) {
              // BREAKOUT CONFIRMADO: Finalizar rango
              if (currentRange.candleCount >= this.config.minRangeLength) {
                console.log(`[${this.symbol}] ❌ Rango finalizado: breakout confirmado (${breakoutCandleCount} velas fuera)`);
                this.createRange(currentRange);
              }
              currentRange = null;
              breakoutCandleCount = 0;
            } else {
              // BREAKOUT TEMPORAL: Mantener rango en pausa, NO actualizar endIndex
              console.log(`[${this.symbol}] ⏸️ Breakout temporal: ${breakoutCandleCount}/${this.config.maxBreakoutCandles} velas fuera`);
            }
          } else {
            // La vela ACTUAL está dentro, pero hay velas históricas fuera
            // Esto indica RE-INGRESO
            if (breakoutCandleCount > 0) {
              console.log(`[${this.symbol}] 🔙 Re-ingreso detectado después de ${breakoutCandleCount} velas fuera - continuando rango`);
              breakoutCandleCount = 0;
            }

            // Continuar extendiendo el rango
            currentRange.endIndex = i;
            currentRange.endTimestamp = candles[i].timestamp;
            currentRange.candleCount++;
            // 🎯 IMPORTANTE: NO cambiar high/low durante re-ingreso
            // Solo actualizar si el precio actual expande el rango
            if (candles[i].high > currentRange.high) {
              currentRange.high = candles[i].high;
            }
            if (candles[i].low < currentRange.low) {
              currentRange.low = candles[i].low;
            }
          }
        }
      }

      prevCountOutside = countOutside;
    }

    // Guardar el último rango si existe
    if (currentRange && currentRange.candleCount >= this.config.minRangeLength) {
      this.createRange(currentRange);
    }

    // 🎯 POST-PROCESAMIENTO: Mergear rangos que aún se overlapen en tiempo
    this.mergeOverlappingRanges();
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
      type: 'ATR-Based',
      duration: rangeData.candleCount,
      ma: rangeData.ma,
      atr: rangeData.atr,
      rangeSize: ((rangeData.high - rangeData.low) / rangeData.low * 100).toFixed(2) + '%',
      status: 'confirmed',
      detectedAt: Date.now(),
      isAutoDetected: true,
      processed: false
    };

    this.detectedRanges.push(range);

    console.log(`[${this.symbol}] ✨ Rango ATR detectado:`, {
      start: new Date(range.startTimestamp).toISOString(),
      end: new Date(range.endTimestamp).toISOString(),
      high: range.high.toFixed(2),
      low: range.low.toFixed(2),
      size: range.rangeSize,
      duration: range.duration
    });
  }

  /**
   * Mergea rangos que se overlapen en tiempo o precio
   * Inspirado en el código de TradingView LuxAlgo
   */
  mergeOverlappingRanges() {
    if (this.detectedRanges.length <= 1) return;

    const merged = [];
    let currentMerged = null;

    // Ordenar por startIndex
    this.detectedRanges.sort((a, b) => a.startTimestamp - b.startTimestamp);

    for (let i = 0; i < this.detectedRanges.length; i++) {
      const range = this.detectedRanges[i];

      if (!currentMerged) {
        currentMerged = { ...range };
      } else {
        // Verificar si hay overlap temporal
        const hasTemporalOverlap = range.startTimestamp <= currentMerged.endTimestamp;

        // Verificar si hay overlap de precio (rangos anidados o superpuestos)
        const hasPriceOverlap =
          (range.low >= currentMerged.low && range.low <= currentMerged.high) ||
          (range.high >= currentMerged.low && range.high <= currentMerged.high) ||
          (range.low <= currentMerged.low && range.high >= currentMerged.high);

        if (hasTemporalOverlap || hasPriceOverlap) {
          // MERGEAR
          currentMerged.endTimestamp = Math.max(currentMerged.endTimestamp, range.endTimestamp);
          currentMerged.high = Math.max(currentMerged.high, range.high);
          currentMerged.low = Math.min(currentMerged.low, range.low);
          currentMerged.duration += range.duration;
          currentMerged.rangeSize = ((currentMerged.high - currentMerged.low) / currentMerged.low * 100).toFixed(2) + '%';

          console.log(`[${this.symbol}] 🔗 Mergeando rangos overlapeados en post-procesamiento`);
        } else {
          // Guardar el rango mergeado anterior y empezar uno nuevo
          merged.push(currentMerged);
          currentMerged = { ...range };
        }
      }
    }

    // Guardar el último
    if (currentMerged) {
      merged.push(currentMerged);
    }

    const beforeCount = this.detectedRanges.length;
    this.detectedRanges = merged;

    if (beforeCount > merged.length) {
      console.log(`[${this.symbol}] 🎯 Post-merge: ${beforeCount} rangos → ${merged.length} rangos (${beforeCount - merged.length} mergeados)`);
    }
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

export default ATRBasedRangeDetector;
