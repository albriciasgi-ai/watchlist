// src/components/indicators/RangeDetectionIndicator.js
// 🎯 Detector Automático de Zonas de Consolidación/Rotación (Volume Profile tipo D)
// Algoritmo: ATR + Price Range Analysis + Volume Profile Shape Validation

import IndicatorBase from "./IndicatorBase";

class RangeDetectionIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Range Detection";
    this.height = 0; // No ocupa espacio (opera en background)

    // ==================== PARÁMETROS CONFIGURABLES (AJUSTADOS PARA RANGOS CORTOS) ====================
    this.config = {
      // Ventana de análisis
      windowSize: 30,                    // Velas a analizar (reducido para detectar rangos más cortos)

      // Volatilidad (Coeficiente de Variación)
      volatilityThreshold: 0.02,         // CV < 2% indica consolidación muy fuerte

      // Rango de precios
      priceRangeThreshold: 0.05,         // 5% - Rango más estricto para consolidaciones compactas

      // Balance de velas
      candleBalanceMin: 0.35,            // Mínimo 35% de velas en una dirección (calibrado: más flexible)
      candleBalanceMax: 0.65,            // Máximo 65% de velas en una dirección

      // Volume Profile validation
      pocCentralRangeMin: 0.35,          // POC debe estar entre 35%-65% del rango
      pocCentralRangeMax: 0.65,
      valueAreaMaxSize: 0.60,            // Value Area debe ser < 60% del rango total

      // Confirmación
      minConsolidationBars: 20,          // Mínimo de velas consecutivas en consolidación (aumentado para mayor certeza)

      // Range management
      maxActiveRanges: 50,               // Máximo de rangos activos por símbolo (después de deduplicación)
      autoCreateFixedRange: true,        // Crear Fixed Range automáticamente al detectar

      // Date range filter
      enableDateFilter: false,           // Si está activo, solo analiza entre startDate y endDate
      startDate: null,                   // Timestamp inicio del rango a analizar
      endDate: null                      // Timestamp fin del rango a analizar
    };

    // Estado interno
    this.detectedRanges = [];            // Rangos detectados { id, startTimestamp, endTimestamp, status, score }
    this.currentCandidate = null;        // Candidato actual en evaluación
    this.lastAnalysisTimestamp = null;
    this.lastDebugLog = null;            // Para throttling de logs debug

    // Cache de cálculos
    this.atrCache = [];
    this.profileCache = new Map();

    console.log(`[${this.symbol}] 🎯 RangeDetectionIndicator: Inicializado con window=${this.config.windowSize}`);
  }

  // ==================== CONFIGURACIÓN ====================

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`[${this.symbol}] 🎯 Config actualizada:`, this.config);

    // Limpiar cache al cambiar configuración crítica
    if (newConfig.atrPeriod || newConfig.windowSize) {
      this.atrCache = [];
      this.profileCache.clear();
    }
  }

  setDateRange(startDate, endDate) {
    this.config.enableDateFilter = true;
    this.config.startDate = startDate;
    this.config.endDate = endDate;
    console.log(`[${this.symbol}] 📅 Date filter activado:`, {
      start: new Date(startDate).toISOString(),
      end: new Date(endDate).toISOString()
    });
  }

  clearDateRange() {
    this.config.enableDateFilter = false;
    this.config.startDate = null;
    this.config.endDate = null;
    console.log(`[${this.symbol}] 📅 Date filter desactivado`);
  }

  // ==================== ANÁLISIS PRINCIPAL ====================

  /**
   * Método principal llamado por IndicatorManager en cada actualización
   * @param {Array} allCandles - Todas las velas disponibles
   * @returns {Array} - Rangos detectados con status actualizado
   */
  analyze(allCandles) {
    if (!this.enabled) {
      return this.detectedRanges;
    }

    if (!allCandles || allCandles.length < this.config.windowSize) {
      console.log(`[${this.symbol}] ⚠️ Insuficientes velas: ${allCandles?.length || 0} (necesita mín: ${this.config.windowSize})`);
      return this.detectedRanges;
    }

    const now = Date.now();

    // Evitar análisis repetido (throttling)
    if (this.lastAnalysisTimestamp && (now - this.lastAnalysisTimestamp) < 5000) {
      return this.detectedRanges;
    }

    this.lastAnalysisTimestamp = now;
    console.log(`[${this.symbol}] 🔄 Ejecutando análisis con ${allCandles.length} velas...`);

    // Aplicar filtro de fecha si está habilitado
    let candlesToAnalyze = allCandles;
    if (this.config.enableDateFilter && this.config.startDate && this.config.endDate) {
      candlesToAnalyze = allCandles.filter(c =>
        c.timestamp >= this.config.startDate && c.timestamp <= this.config.endDate
      );

      console.log(`[${this.symbol}] 📅 Después del filtro: ${candlesToAnalyze.length} velas (de ${allCandles.length} totales)`);

      if (candlesToAnalyze.length < this.config.windowSize) {
        console.log(`[${this.symbol}] ⚠️ Insuficientes velas en rango de fechas: ${candlesToAnalyze.length} (mínimo: ${this.config.windowSize})`);
        return this.detectedRanges;
      }
    }

    // ==================== SLIDING WINDOW EXHAUSTIVO ====================
    // Analizar TODAS las ventanas posibles dentro del rango de fechas

    const totalWindows = candlesToAnalyze.length - this.config.windowSize + 1;

    if (totalWindows <= 0) {
      console.log(`[${this.symbol}] ⚠️ No hay suficientes velas para crear ventanas: ${candlesToAnalyze.length} velas, necesita ${this.config.windowSize}`);
      return this.detectedRanges;
    }

    console.log(`[${this.symbol}] 🪟 Analizando ${totalWindows} ventanas de ${this.config.windowSize} velas cada una...`);

    let windowsAnalyzed = 0;
    let windowsSkipped = 0;
    let windowsPassedInitialChecks = 0;
    let consolidationsFound = 0;
    let rangesExtended = 0;

    // Loop sobre todas las ventanas posibles
    for (let i = 0; i <= candlesToAnalyze.length - this.config.windowSize; i++) {
      const windowCandles = candlesToAnalyze.slice(i, i + this.config.windowSize);
      windowsAnalyzed++;

      // ==================== FASE 0: VERIFICAR SI LA VENTANA ESTÁ DENTRO DE UN RANGO ACTIVO ====================

      const windowStartTime = windowCandles[0].timestamp;
      const windowEndTime = windowCandles[windowCandles.length - 1].timestamp;
      const windowHigh = Math.max(...windowCandles.map(c => c.high));
      const windowLow = Math.min(...windowCandles.map(c => c.low));

      // Buscar si hay un rango activo que contenga esta ventana
      const activeRange = this.findActiveRangeContaining(windowStartTime, windowEndTime, windowLow, windowHigh);

      if (activeRange) {
        // Si la ventana está dentro de un rango activo, extender SOLO el tiempo (NO el precio)
        windowsSkipped++;

        // Extender SOLO el endTimestamp del rango si esta ventana va más allá
        // NO expandir high/low para mantener el rango compacto
        if (windowEndTime > activeRange.endTimestamp) {
          activeRange.endTimestamp = windowEndTime;
          rangesExtended++;
        }

        continue; // Skip análisis completo
      }

      // ==================== FASE 1: IDENTIFICACIÓN DE CANDIDATOS ====================

      // Calcular volatilidad usando Coeficiente de Variación
      const closes = windowCandles.map(c => c.close);
      const avgClose = closes.reduce((a,b) => a+b, 0) / closes.length;
      const variance = closes.reduce((sum, c) => sum + Math.pow(c - avgClose, 2), 0) / closes.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = avgClose > 0 ? stdDev / avgClose : 1;

      const volatilityDecreasing = coefficientOfVariation < this.config.volatilityThreshold;

      const priceAnalysis = this.analyzePriceRange(windowCandles);
      const isLateralMovement = priceAnalysis.rangeRatio < this.config.priceRangeThreshold;

      const candleBalance = this.analyzeCandleBalance(windowCandles);
      const isIndecision = candleBalance >= this.config.candleBalanceMin &&
                           candleBalance <= this.config.candleBalanceMax;

      // Si no pasa los checks básicos, skip Volume Profile validation (costosa)
      if (!volatilityDecreasing || !isLateralMovement || !isIndecision) {
        continue;
      }

      windowsPassedInitialChecks++;

      // ==================== FASE 2: VALIDACIÓN CON VOLUME PROFILE ====================

      const profileValidation = this.validateVolumeProfile(windowCandles);

      // ==================== FASE 3: DECISIÓN Y GESTIÓN DE RANGOS ====================

      const isConsolidation = profileValidation.isValid;

      if (isConsolidation) {
        consolidationsFound++;

        this.handleConsolidationDetected(windowCandles, {
          coefficientOfVariation,
          priceAnalysis,
          candleBalance,
          profileValidation,
          score: this.calculateConsolidationScore({
            cv: coefficientOfVariation,
            priceRangeRatio: priceAnalysis.rangeRatio,
            candleBalance,
            profileValid: profileValidation.isValid
          })
        });
      }
    }

    // Log de resumen del análisis
    console.log(`[${this.symbol}] ✅ Análisis completado: ${windowsAnalyzed} ventanas | ${windowsSkipped} skipped (dentro de rangos activos) | ${windowsPassedInitialChecks} analizadas | ${consolidationsFound} nuevos rangos | ${rangesExtended} extensiones`);

    // Debug: mostrar ejemplo de la última ventana analizada (para ver thresholds)
    if (windowsAnalyzed > 0 && (!this.lastDebugLog || (now - this.lastDebugLog) > 30000)) {
      const lastWindowCandles = candlesToAnalyze.slice(-this.config.windowSize);
      const closes = lastWindowCandles.map(c => c.close);
      const avgClose = closes.reduce((a,b) => a+b, 0) / closes.length;
      const variance = closes.reduce((sum, c) => sum + Math.pow(c - avgClose, 2), 0) / closes.length;
      const stdDev = Math.sqrt(variance);
      const cv = avgClose > 0 ? stdDev / avgClose : 1;
      const priceAnalysis = this.analyzePriceRange(lastWindowCandles);
      const balance = this.analyzeCandleBalance(lastWindowCandles);

      console.log(`[${this.symbol}] 🔍 Ejemplo última ventana: CV=${(cv*100).toFixed(2)}% (max ${(this.config.volatilityThreshold*100).toFixed(2)}%) | Range=${(priceAnalysis.rangeRatio*100).toFixed(2)}% (max ${(this.config.priceRangeThreshold*100).toFixed(2)}%) | Balance=${(balance*100).toFixed(1)}%`);
      this.lastDebugLog = now;
    }

    // ==================== DEDUPLICACIÓN YA NO ES NECESARIA ====================
    // El sistema de extensión de rangos ya evita duplicados
    // this.deduplicateOverlappingRanges();

    // Limpiar rangos antiguos (mantener solo los últimos N)
    this.pruneOldRanges();

    return this.detectedRanges;
  }

  // ==================== CÁLCULOS TÉCNICOS ====================

  /**
   * Calcula Average True Range (ATR)
   */
  calculateATR(candles, period) {
    if (!candles || candles.length < period) return 0;

    const trueRanges = [];

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

    // Promedio simple de los últimos 'period' TR
    const relevantTRs = trueRanges.slice(-period);
    const atr = relevantTRs.reduce((sum, tr) => sum + tr, 0) / relevantTRs.length;

    return atr;
  }

  /**
   * Analiza el rango de precios en la ventana
   */
  analyzePriceRange(candles) {
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const range = high - low;
    const avgPrice = (high + low) / 2;
    const rangeRatio = avgPrice > 0 ? range / avgPrice : 0;

    return { high, low, range, avgPrice, rangeRatio };
  }

  /**
   * Analiza balance entre velas alcistas y bajistas
   * @returns {number} - Porcentaje de velas alcistas (0-1)
   */
  analyzeCandleBalance(candles) {
    let bullishCount = 0;

    for (const candle of candles) {
      if (candle.close >= candle.open) {
        bullishCount++;
      }
    }

    return bullishCount / candles.length;
  }

  /**
   * Valida que el Volume Profile tenga forma tipo "D" (consolidación)
   */
  validateVolumeProfile(candles) {
    // Calcular Volume Profile simplificado
    const priceAnalysis = this.analyzePriceRange(candles);
    const { low: minPrice, high: maxPrice, range } = priceAnalysis;

    if (range === 0) return { isValid: false };

    const rows = 50; // Bins para el perfil
    const step = range / rows;

    // Inicializar niveles
    const levels = Array(rows).fill(0).map((_, i) => ({
      price: minPrice + (step * i) + (step / 2),
      volume: 0,
      levelLow: minPrice + (step * i),
      levelHigh: minPrice + (step * (i + 1))
    }));

    // Acumular volumen por nivel
    for (const candle of candles) {
      for (let i = 0; i < rows; i++) {
        const overlap = this.calculateOverlap(
          candle.low, candle.high,
          levels[i].levelLow, levels[i].levelHigh
        );

        if (overlap > 0) {
          levels[i].volume += candle.volume * overlap;
        }
      }
    }

    // Encontrar POC (Point of Control)
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

    // Validar posición del POC (debe estar central)
    const pocPosition = pocIndex / rows;
    const isPOCCentral = pocPosition >= this.config.pocCentralRangeMin &&
                         pocPosition <= this.config.pocCentralRangeMax;

    // Calcular Value Area (70% del volumen)
    const totalVolume = levels.reduce((sum, l) => sum + l.volume, 0);
    const valueAreaThreshold = totalVolume * 0.70;

    let lowIndex = pocIndex;
    let highIndex = pocIndex;
    let cumulativeVolume = maxVolume;

    while (cumulativeVolume < valueAreaThreshold && (lowIndex > 0 || highIndex < rows - 1)) {
      const lowerVolume = lowIndex > 0 ? levels[lowIndex - 1].volume : 0;
      const upperVolume = highIndex < rows - 1 ? levels[highIndex + 1].volume : 0;

      if (lowerVolume > upperVolume) {
        lowIndex--;
        cumulativeVolume += lowerVolume;
      } else {
        highIndex++;
        cumulativeVolume += upperVolume;
      }
    }

    const valueAreaSize = (highIndex - lowIndex) / rows;
    const isValueAreaCompact = valueAreaSize < this.config.valueAreaMaxSize;

    const isValid = isPOCCentral && isValueAreaCompact;

    return {
      isValid,
      poc,
      valueArea: {
        lowIndex,
        highIndex,
        size: valueAreaSize,
        vahPrice: levels[highIndex].price,
        valPrice: levels[lowIndex].price
      },
      distribution: {
        isPOCCentral,
        isValueAreaCompact,
        pocPosition
      }
    };
  }

  calculateOverlap(candleLow, candleHigh, levelLow, levelHigh) {
    const overlapLow = Math.max(candleLow, levelLow);
    const overlapHigh = Math.min(candleHigh, levelHigh);
    const overlap = Math.max(0, overlapHigh - overlapLow);
    const candleSize = candleHigh - candleLow;

    return candleSize > 0 ? overlap / candleSize : 0;
  }

  // ==================== GESTIÓN DE RANGOS ====================

  /**
   * Calcula score de consolidación (0-100)
   * Calibrado con datos históricos de BTCUSDT
   */
  calculateConsolidationScore({ cv, priceRangeRatio, candleBalance, profileValid }) {
    let score = 0;

    // Baja volatilidad (0-40 puntos) - Peso mayor porque es el indicador más confiable
    const cvScore = cv < this.config.volatilityThreshold ?
      40 * (1 - (cv / this.config.volatilityThreshold)) : 0;
    score += cvScore;

    // Rango de precios estrecho (0-40 puntos) - Segundo indicador más importante
    const rangeScore = priceRangeRatio < this.config.priceRangeThreshold ?
      40 * (1 - (priceRangeRatio / this.config.priceRangeThreshold)) : 0;
    score += rangeScore;

    // Balance de velas (0-20 puntos) - Indicador de indecisión
    const balanceScore = Math.max(0, (1 - Math.abs(0.5 - candleBalance) * 2) * 20);
    score += balanceScore;

    return Math.min(100, score);
  }

  handleConsolidationDetected(candles, metrics) {
    const startTimestamp = candles[0].timestamp;
    const endTimestamp = candles[candles.length - 1].timestamp;
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));

    // Verificar si ya existe un rango activo que overlap con este
    const existingRange = this.detectedRanges.find(r =>
      r.status === 'monitoring' &&
      ((startTimestamp >= r.startTimestamp && startTimestamp <= r.endTimestamp) ||
       (endTimestamp >= r.startTimestamp && endTimestamp <= r.endTimestamp))
    );

    if (existingRange) {
      // Actualizar SOLO el tiempo del rango existente (NO expandir high/low)
      existingRange.endTimestamp = endTimestamp;
      // NO actualizar high/low para mantener el rango compacto y fiel al inicio
      existingRange.consecutiveBars++;
      existingRange.lastUpdateTimestamp = Date.now();
      existingRange.score = metrics.score;
      existingRange.metrics = metrics;

      // Confirmar si alcanzó el mínimo de barras
      if (existingRange.consecutiveBars >= this.config.minConsolidationBars &&
          existingRange.status !== 'confirmed') {
        existingRange.status = 'confirmed';
        console.log(`[${this.symbol}] ✅ Rango CONFIRMADO (${existingRange.consecutiveBars} barras):`, {
          start: new Date(existingRange.startTimestamp).toISOString(),
          end: new Date(existingRange.endTimestamp).toISOString(),
          score: existingRange.score.toFixed(1),
          cv: (metrics.coefficientOfVariation * 100).toFixed(2) + '%',
          priceRange: (metrics.priceAnalysis.rangeRatio * 100).toFixed(2) + '%'
        });
      }
    } else {
      // Crear nuevo rango
      const newRange = {
        id: `range_${startTimestamp}`,
        symbol: this.symbol,
        startTimestamp,
        endTimestamp,
        high,
        low,
        status: 'monitoring', // 'monitoring' | 'confirmed' | 'broken'
        consecutiveBars: this.config.windowSize,
        detectedAt: Date.now(),
        lastUpdateTimestamp: Date.now(),
        score: metrics.score,
        metrics,
        profileCreated: false
      };

      this.detectedRanges.push(newRange);

      console.log(`[${this.symbol}] 🆕 Nuevo rango detectado (monitoring):`, {
        start: new Date(startTimestamp).toISOString(),
        end: new Date(endTimestamp).toISOString(),
        score: metrics.score.toFixed(1)
      });
    }

    this.currentCandidate = { startTimestamp, endTimestamp, metrics };
  }

  handleNoConsolidation(candles) {
    // Si había un candidato activo, marcar como roto si era confirmado
    if (this.currentCandidate) {
      const lastTimestamp = candles[candles.length - 1].timestamp;

      this.detectedRanges.forEach(range => {
        if (range.status === 'confirmed' &&
            lastTimestamp > range.endTimestamp &&
            lastTimestamp - range.endTimestamp < 10 * this.getIntervalMs()) {
          range.status = 'broken';
          range.breakoutTimestamp = lastTimestamp;
          console.log(`[${this.symbol}] 💥 Rango ROTO (breakout):`, {
            rangeId: range.id,
            breakoutTime: new Date(lastTimestamp).toISOString()
          });
        }
      });

      this.currentCandidate = null;
    }
  }

  /**
   * Busca un rango activo que contenga o se solape con la ventana actual
   * Permite expansión del rango si la ventana está adyacente
   */
  findActiveRangeContaining(windowStartTime, windowEndTime, windowLow, windowHigh) {
    for (const range of this.detectedRanges) {
      // Solo considerar rangos confirmados
      if (range.status !== 'confirmed') continue;

      // Verificar si la ventana está temporalmente adyacente o dentro del rango
      const tolerance = this.getIntervalMs() * this.config.windowSize; // Tolerancia = tamaño de ventana
      const isTemporallyAdjacentOrWithin =
        (windowStartTime >= range.startTimestamp && windowStartTime <= range.endTimestamp + tolerance) ||
        (windowEndTime >= range.startTimestamp && windowEndTime <= range.endTimestamp + tolerance);

      if (!isTemporallyAdjacentOrWithin) continue;

      // Calcular expansión de precio permitida (5% del rango actual)
      const currentRangeSize = range.high - range.low;
      const expansionAllowed = currentRangeSize * 0.05; // Permitir solo 5% de expansión

      // Verificar si el precio de la ventana está dentro o cerca del rango
      const maxAllowedHigh = range.high + expansionAllowed;
      const minAllowedLow = range.low - expansionAllowed;

      const isPriceCompatible =
        (windowLow >= minAllowedLow && windowLow <= maxAllowedHigh) ||
        (windowHigh >= minAllowedLow && windowHigh <= maxAllowedHigh);

      if (isPriceCompatible) {
        return range; // Encontrado un rango activo compatible
      }
    }

    return null; // No hay rango activo que contenga esta ventana
  }

  /**
   * Deduplicación de rangos superpuestos - conserva el de mejor score
   */
  deduplicateOverlappingRanges() {
    const beforeCount = this.detectedRanges.length;

    // Ordenar por score descendente (mejores primero)
    this.detectedRanges.sort((a, b) => (b.score || 0) - (a.score || 0));

    const uniqueRanges = [];
    const OVERLAP_THRESHOLD = 0.60; // 60% de superposición = considerar duplicado

    for (const range of this.detectedRanges) {
      let isDuplicate = false;

      for (const existing of uniqueRanges) {
        const overlapRatio = this.calculateOverlapRatio(range, existing);

        if (overlapRatio >= OVERLAP_THRESHOLD) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        uniqueRanges.push(range);
      }
    }

    this.detectedRanges = uniqueRanges;

    const removedCount = beforeCount - uniqueRanges.length;
    if (removedCount > 0) {
      console.log(`[${this.symbol}] 🧹 Deduplicación: ${removedCount} rangos superpuestos eliminados (${uniqueRanges.length} únicos restantes)`);
    }
  }

  /**
   * Calcula el ratio de superposición entre dos rangos (0.0 a 1.0)
   */
  calculateOverlapRatio(range1, range2) {
    const start1 = range1.startTimestamp;
    const end1 = range1.endTimestamp;
    const start2 = range2.startTimestamp;
    const end2 = range2.endTimestamp;

    // Calcular la intersección
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);

    if (overlapStart >= overlapEnd) {
      return 0; // No hay superposición
    }

    const overlapDuration = overlapEnd - overlapStart;
    const range1Duration = end1 - start1;
    const range2Duration = end2 - start2;
    const minDuration = Math.min(range1Duration, range2Duration);

    return overlapDuration / minDuration;
  }

  pruneOldRanges() {
    const now = Date.now();
    const beforeCount = this.detectedRanges.length;

    // 1. Eliminar rangos muy antiguos (más allá del histórico actual)
    // Si el rango terminó hace más de los días configurados, eliminarlo
    const daysInMs = this.days * 24 * 60 * 60 * 1000; // Convertir días a milisegundos
    const oldestAllowedTimestamp = now - daysInMs;

    this.detectedRanges = this.detectedRanges.filter(range => {
      return range.endTimestamp >= oldestAllowedTimestamp;
    });

    const removedByAge = beforeCount - this.detectedRanges.length;
    if (removedByAge > 0) {
      console.log(`[${this.symbol}] 🗑️ Rangos obsoletos eliminados: ${removedByAge} (fuera del histórico de ${this.days} días)`);
    }

    // 2. Limitar cantidad máxima de rangos
    if (this.detectedRanges.length > this.config.maxActiveRanges) {
      // Mantener solo los más recientes
      this.detectedRanges.sort((a, b) => b.detectedAt - a.detectedAt);
      const removed = this.detectedRanges.splice(this.config.maxActiveRanges);

      console.log(`[${this.symbol}] 🗑️ Rangos excedentes eliminados: ${removed.length} (límite: ${this.config.maxActiveRanges})`);
    }
  }

  // ==================== UTILIDADES ====================

  getIntervalMs() {
    const map = {
      "1": 60000, "3": 180000, "5": 300000, "15": 900000,
      "30": 1800000, "60": 3600000, "120": 7200000,
      "240": 14400000, "D": 86400000, "W": 604800000
    };
    return map[this.interval] || 900000;
  }

  /**
   * Obtiene rangos confirmados listos para crear Fixed Ranges (nuevos)
   */
  getConfirmedRanges() {
    return this.detectedRanges.filter(r =>
      r.status === 'confirmed' && !r.profileCreated
    );
  }

  /**
   * Obtiene TODOS los rangos confirmados (incluyendo los ya procesados)
   */
  getAllConfirmedRanges() {
    return this.detectedRanges.filter(r => r.status === 'confirmed');
  }

  /**
   * Marca un rango como procesado (Fixed Range creado)
   */
  markRangeAsProcessed(rangeId) {
    const range = this.detectedRanges.find(r => r.id === rangeId);
    if (range) {
      range.profileCreated = true;
      console.log(`[${this.symbol}] ✓ Rango marcado como procesado: ${rangeId}`);
    }
  }

  /**
   * ✅ NUEVO: Limpia todos los rangos detectados y el estado
   * Se usa cuando el usuario cambia el rango de fechas/días seleccionados
   */
  clearAllRanges() {
    const count = this.detectedRanges.length;
    this.detectedRanges = [];
    this.currentCandidate = null;
    this.lastAnalysisTimestamp = null;
    this.profileCache.clear();
    console.log(`[${this.symbol}] 🗑️ ${count} rangos limpiados por cambio de selección`);
    return count;
  }

  /**
   * Exporta estado para debugging/localStorage
   */
  toJSON() {
    return {
      symbol: this.symbol,
      interval: this.interval,
      config: this.config,
      detectedRanges: this.detectedRanges,
      lastAnalysisTimestamp: this.lastAnalysisTimestamp
    };
  }

  /**
   * Carga estado desde localStorage
   */
  fromJSON(data) {
    if (data.config) this.config = { ...this.config, ...data.config };
    if (data.detectedRanges) this.detectedRanges = data.detectedRanges;
    if (data.lastAnalysisTimestamp) this.lastAnalysisTimestamp = data.lastAnalysisTimestamp;
  }

  // ==================== MÉTODOS REQUERIDOS POR IndicatorBase ====================

  async fetchData() {
    // Este indicador no necesita fetch del backend
    return true;
  }

  render(ctx, bounds, visibleCandles, allCandles) {
    // Este indicador no renderiza nada (opera en background)
    // Los rangos detectados se visualizan como Fixed Ranges automáticos
  }
}

export default RangeDetectionIndicator;
