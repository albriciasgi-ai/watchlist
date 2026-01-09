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
   * ✅ ACTUALIZADO: Valida si un patrón cumple con los filtros de zonas manuales
   * @param {number} price - Precio del patrón (close)
   * @param {string} patternDirection - 'LONG' o 'SHORT'
   * @param {Array} manualZones - Array de zonas manuales configuradas
   * @param {string} globalDirection - Dirección global ('LONG'|'SHORT'|'BOTH')
   * @param {string} validationMode - 'all' o 'validated' - Modo de validación
   * @param {boolean} debug - Si true, imprime logs de debugging
   * @returns {boolean} true si el patrón pasa los filtros
   */
  passesZoneFilters(price, patternDirection, manualZones, globalDirection, validationMode = 'all', debug = false) {
    // ✅ FIX: En modo 'all' (Show All), SIEMPRE ignorar zonas y solo aplicar filtro de dirección global
    if (validationMode === 'all') {
      if (globalDirection === 'BOTH') return true;
      const passes = patternDirection === globalDirection;
      if (debug && !passes) {
        console.log(`    ❌ [ALL MODE] Pattern ${patternDirection} rejected by global filter (requires ${globalDirection})`);
      }
      return passes;
    }

    // ✅ Modo 'validated' (Validated Only): Aplicar lógica de zonas
    const activeZones = manualZones.filter(z => z.enabled);

    // Si no hay zonas activas en modo validated, solo aplicar filtro global
    if (activeZones.length === 0) {
      if (globalDirection === 'BOTH') return true;
      const passes = patternDirection === globalDirection;
      if (debug && !passes) {
        console.log(`    ❌ [VALIDATED MODE - NO ZONES] Pattern ${patternDirection} rejected by global filter (requires ${globalDirection})`);
      }
      return passes;
    }

    // Con zonas activas: el patrón DEBE estar dentro de al menos una zona
    for (const zone of activeZones) {
      const { minPrice, maxPrice, signalDirection } = zone;

      // 1. Validar que el precio esté DENTRO del rango de la zona
      if (price < minPrice || price > maxPrice) {
        if (debug) {
          console.log(`    ⏭️ Price ${price} outside zone '${zone.name}' (${minPrice}-${maxPrice})`);
        }
        continue; // Fuera de esta zona, probar siguiente
      }

      // 2. El precio está dentro de esta zona, ahora validar dirección
      const zoneDirection = signalDirection || globalDirection; // Zone override o global

      if (zoneDirection === 'BOTH') {
        if (debug) {
          console.log(`    ✅ Pattern accepted in zone '${zone.name}' (accepts BOTH)`);
        }
        return true; // Zona acepta ambas direcciones
      }

      if (patternDirection === zoneDirection) {
        if (debug) {
          console.log(`    ✅ Pattern ${patternDirection} accepted in zone '${zone.name}' (matches ${zoneDirection})`);
        }
        return true; // Dirección coincide
      }

      if (debug) {
        console.log(`    ❌ Pattern ${patternDirection} rejected in zone '${zone.name}' (zone requires ${zoneDirection})`);
      }

      // Si llega aquí, está en la zona pero dirección no coincide
      // Continuar buscando otra zona que acepte esta dirección
    }

    // Si salió del loop, el patrón no pasó ninguna zona
    return false;
  }

  /**
   * Detecta todos los patrones en un array de velas
   * @param {Array} candles - Array de velas OHLC
   * @param {Object} config - Configuración de detección
   * @param {string} validationMode - 'all' o 'validated' - Controla si se validan contra zonas
   * @returns {Array} Array de patrones detectados
   */
  detectPatterns(candles, config = {}, validationMode = 'all') {
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

    // Configuración de swing detection
    const swingConfig = config.swingDetection || {
      enabled: false,
      leftBars: 5,
      rightBars: 5,
      required: false  // Si true, rechaza patrones que no estén en swing points
    };

    // NUEVO: Configuración de filtro de dirección
    const globalSignalDirection = config.signalDirection?.global || 'BOTH'; // 'LONG' | 'SHORT' | 'BOTH'

    // ✅ NUEVO: Zonas manuales (si existen)
    const manualZones = config.manualPriceZones || [];
    const hasActiveZones = manualZones.some(z => z.enabled);

    // console.log(`[LocalPatternDetector] 🎯 Filtro config:`, {
    //   validationMode: validationMode,
    //   globalDirection: globalSignalDirection,
    //   manualZones: manualZones.length,
    //   activeZones: manualZones.filter(z => z.enabled).map(z => ({
    //     name: z.name,
    //     range: `${z.minPrice}-${z.maxPrice}`,
    //     signalDirection: z.signalDirection
    //   }))
    // });

    // Pre-calcular Z-scores de volumen si está habilitado
    const volumeZScores = volumeConfig.enabled ? this.calculateVolumeZScores(candles, volumeConfig.lookbackPeriod) : null;

    // Determinar rango de iteración
    // Si swing detection está habilitado y es required, necesitamos leftBars y rightBars
    const startIndex = swingConfig.enabled && swingConfig.required ? swingConfig.leftBars : 1;
    const endIndex = swingConfig.enabled && swingConfig.required ? candles.length - swingConfig.rightBars : candles.length;

    // Detectar patrones para cada vela
    for (let i = startIndex; i < endIndex; i++) {
      const current = candles[i];
      const previous = i > 0 ? candles[i - 1] : null;

      // Skip invalid candles
      if (!this.isValidCandle(current)) continue;

      // Validar volumen si está habilitado
      if (volumeConfig.enabled && volumeZScores) {
        const zScore = volumeZScores[i];
        if (zScore === null || zScore < volumeConfig.minZScore) {
          continue; // Skip this candle if volume is not significant
        }
      }

      // Pre-calcular swing points si está habilitado
      let isAtSwingLow = false;
      let isAtSwingHigh = false;
      if (swingConfig.enabled) {
        isAtSwingLow = this.isSwingLow(candles, i, swingConfig.leftBars, swingConfig.rightBars);
        isAtSwingHigh = this.isSwingHigh(candles, i, swingConfig.leftBars, swingConfig.rightBars);
      }

      // Hammer - patrón bullish, debe estar en swing low
      if (enabledPatterns.hammer?.enabled && this.isHammer(current, enabledPatterns.hammer)) {
        // ✅ ACTUALIZADO: Validar con zonas manuales según modo de validación
        if (!this.passesZoneFilters(current.close, 'LONG', manualZones, globalSignalDirection, validationMode, true)) {
          continue; // No pasa filtros de zona/dirección
        }

        // Si swing detection está habilitado y es required, validar swing low
        if (!swingConfig.enabled || !swingConfig.required || isAtSwingLow) {
          patterns.push({
            type: 'HAMMER',
            timestamp: current.timestamp,
            price: current.low,  // Usar low para patrones bullish
            candle: current,
            quality: this.calculateHammerQuality(current),
            atSwingPoint: swingConfig.enabled ? isAtSwingLow : undefined,
            swingType: 'low',
            candleIndex: i,
            volumeZScore: volumeZScores ? volumeZScores[i] : undefined,
            direction: 'LONG'  // NUEVO: Marcar dirección
          });
        }
      }

      // Shooting Star - patrón bearish, debe estar en swing high
      if (enabledPatterns.shootingStar?.enabled && this.isShootingStar(current, enabledPatterns.shootingStar)) {
        // ✅ ACTUALIZADO: Validar con zonas manuales según modo de validación
        if (!this.passesZoneFilters(current.close, 'SHORT', manualZones, globalSignalDirection, validationMode)) {
          continue; // No pasa filtros de zona/dirección
        }

        // Si swing detection está habilitado y es required, validar swing high
        if (!swingConfig.enabled || !swingConfig.required || isAtSwingHigh) {
          patterns.push({
            type: 'SHOOTING_STAR',
            timestamp: current.timestamp,
            price: current.high,  // Usar high para patrones bearish
            candle: current,
            quality: this.calculateShootingStarQuality(current),
            atSwingPoint: swingConfig.enabled ? isAtSwingHigh : undefined,
            swingType: 'high',
            candleIndex: i,
            volumeZScore: volumeZScores ? volumeZScores[i] : undefined,
            direction: 'SHORT'  // NUEVO: Marcar dirección
          });
        }
      }

      // Engulfing patterns (necesita vela anterior)
      if (enabledPatterns.engulfing?.enabled && previous) {
        const engulfingType = this.isEngulfing(previous, current);
        if (engulfingType) {
          const isBullish = engulfingType === 'ENGULFING_BULLISH';
          const patternDirection = isBullish ? 'LONG' : 'SHORT';

          // ✅ ACTUALIZADO: Validar con zonas manuales según modo de validación
          if (!this.passesZoneFilters(current.close, patternDirection, manualZones, globalSignalDirection, validationMode)) {
            continue; // No pasa filtros de zona/dirección
          }

          const isAtCorrectSwing = isBullish ? isAtSwingLow : isAtSwingHigh;

          // Validar swing point si está habilitado
          if (!swingConfig.enabled || !swingConfig.required || isAtCorrectSwing) {
            patterns.push({
              type: engulfingType,
              timestamp: current.timestamp,
              price: isBullish ? current.low : current.high,  // Usar low/high según tipo
              candle: current,
              previousCandle: previous,
              quality: this.calculateEngulfingQuality(previous, current),
              atSwingPoint: swingConfig.enabled ? isAtCorrectSwing : undefined,
              swingType: isBullish ? 'low' : 'high',
              candleIndex: i,
              volumeZScore: volumeZScores ? volumeZScores[i] : undefined,
              direction: isBullish ? 'LONG' : 'SHORT'  // NUEVO: Marcar dirección
            });
          }
        }
      }

      // Doji patterns
      if (enabledPatterns.doji?.enabled) {
        const dojiType = this.isDoji(current, enabledPatterns.doji);
        if (dojiType) {
          const isDragonfly = dojiType === 'DOJI_DRAGONFLY';
          const patternDirection = isDragonfly ? 'LONG' : 'SHORT';

          // ✅ ACTUALIZADO: Validar con zonas manuales según modo de validación
          if (!this.passesZoneFilters(current.close, patternDirection, manualZones, globalSignalDirection, validationMode)) {
            continue; // No pasa filtros de zona/dirección
          }

          const isAtCorrectSwing = isDragonfly ? isAtSwingLow : isAtSwingHigh;

          // Validar swing point si está habilitado
          if (!swingConfig.enabled || !swingConfig.required || isAtCorrectSwing) {
            patterns.push({
              type: dojiType,
              timestamp: current.timestamp,
              price: isDragonfly ? current.low : current.high,  // Usar low/high según tipo
              candle: current,
              quality: this.calculateDojiQuality(current),
              atSwingPoint: swingConfig.enabled ? isAtCorrectSwing : undefined,
              swingType: isDragonfly ? 'low' : 'high',
              candleIndex: i,
              volumeZScore: volumeZScores ? volumeZScores[i] : undefined,
              direction: isDragonfly ? 'LONG' : 'SHORT'  // NUEVO: Marcar dirección
            });
          }
        }
      }
    }

    // console.log(`[LocalPatternDetector] Detected ${patterns.length} patterns in ${candles.length} candles (swing detection: ${swingConfig.enabled})`);
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
   * Detecta swing low (mínimo local)
   * Verifica que el low de la vela actual sea el mínimo en la ventana leftBars + rightBars
   *
   * @param {Array} candles - Array de velas
   * @param {number} index - Índice de la vela actual
   * @param {number} leftBars - Número de velas a la izquierda para comparar
   * @param {number} rightBars - Número de velas a la derecha para comparar
   * @returns {boolean} True si es un swing low
   */
  isSwingLow(candles, index, leftBars = 5, rightBars = 5) {
    // Verificar que hay suficientes velas a ambos lados
    if (index < leftBars || index >= candles.length - rightBars) {
      return false;
    }

    const currentLow = candles[index].low;

    // Verificar que el low actual es el mínimo en toda la ventana
    for (let i = index - leftBars; i <= index + rightBars; i++) {
      if (i !== index && candles[i].low <= currentLow) {
        return false;
      }
    }

    return true;
  }

  /**
   * Detecta swing high (máximo local)
   * Verifica que el high de la vela actual sea el máximo en la ventana leftBars + rightBars
   *
   * @param {Array} candles - Array de velas
   * @param {number} index - Índice de la vela actual
   * @param {number} leftBars - Número de velas a la izquierda para comparar
   * @param {number} rightBars - Número de velas a la derecha para comparar
   * @returns {boolean} True si es un swing high
   */
  isSwingHigh(candles, index, leftBars = 5, rightBars = 5) {
    // Verificar que hay suficientes velas a ambos lados
    if (index < leftBars || index >= candles.length - rightBars) {
      return false;
    }

    const currentHigh = candles[index].high;

    // Verificar que el high actual es el máximo en toda la ventana
    for (let i = index - leftBars; i <= index + rightBars; i++) {
      if (i !== index && candles[i].high >= currentHigh) {
        return false;
      }
    }

    return true;
  }

  /**
   * Detecta patrón Hammer
   * - Cuerpo pequeño en la parte superior
   * - Mecha inferior larga (al menos 2x el cuerpo)
   * - Poca o ninguna mecha superior
   */
  isHammer(candle, params = {}) {
    const {
      minWickRatio = 2.0,
      maxUpperWickRatio = 0.2,
      minBodyPosition = 0.6,
      debug = false
    } = params;

    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const range = candle.high - candle.low;

    // Evitar división por cero
    if (body === 0 || range === 0) {
      if (debug) console.log(`[HAMMER REJECTED] body=0 or range=0`, candle);
      return false;
    }

    // Mecha inferior debe ser al menos minWickRatio veces el cuerpo
    const wickToBodyRatio = lowerWick / body;

    // Mecha superior debe ser pequeña
    const upperWickRatio = upperWick / body;

    // Cuerpo debe estar en la posición superior
    const bodyPosition = (Math.min(candle.open, candle.close) - candle.low) / range;

    const passes = wickToBodyRatio >= minWickRatio &&
                   upperWickRatio <= maxUpperWickRatio &&
                   bodyPosition >= minBodyPosition;

    if (debug && !passes) {
      console.log(`[HAMMER REJECTED] time=${candle.timestamp}, wickRatio=${wickToBodyRatio.toFixed(2)} (need >=${minWickRatio}), upperWickRatio=${upperWickRatio.toFixed(2)} (need <=${maxUpperWickRatio}), bodyPos=${bodyPosition.toFixed(2)} (need >=${minBodyPosition})`);
    }

    return passes;
  }

  /**
   * Detecta patrón Shooting Star
   * - Cuerpo pequeño en la parte inferior
   * - Mecha superior larga (al menos 2x el cuerpo)
   * - Poca o ninguna mecha inferior
   */
  isShootingStar(candle, params = {}) {
    const {
      minWickRatio = 2.0,
      maxLowerWickRatio = 0.2,
      minBodyPosition = 0.6,
      debug = false
    } = params;

    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const range = candle.high - candle.low;

    if (body === 0 || range === 0) {
      if (debug) console.log(`[SHOOTING_STAR REJECTED] body=0 or range=0`, candle);
      return false;
    }

    const wickToBodyRatio = upperWick / body;
    const lowerWickRatio = lowerWick / body;
    const bodyPosition = (candle.high - Math.max(candle.open, candle.close)) / range;

    const passes = wickToBodyRatio >= minWickRatio &&
                   lowerWickRatio <= maxLowerWickRatio &&
                   bodyPosition >= minBodyPosition;

    if (debug && !passes) {
      console.log(`[SHOOTING_STAR REJECTED] time=${candle.timestamp}, wickRatio=${wickToBodyRatio.toFixed(2)} (need >=${minWickRatio}), lowerWickRatio=${lowerWickRatio.toFixed(2)} (need <=${maxLowerWickRatio}), bodyPos=${bodyPosition.toFixed(2)} (need >=${minBodyPosition})`);
    }

    return passes;
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
  isDoji(candle, params = {}) {
    const {
      maxBodyRatio = 0.05,
      minLongWick = 0.6,
      maxShortWick = 0.1,
      debug = false
    } = params;

    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;

    if (range === 0) {
      if (debug) console.log(`[DOJI REJECTED] range=0`, candle);
      return null;
    }

    // Cuerpo debe ser menor a maxBodyRatio del rango total
    const bodyRatio = body / range;
    if (bodyRatio > maxBodyRatio) {
      if (debug) console.log(`[DOJI REJECTED] time=${candle.timestamp}, bodyRatio=${bodyRatio.toFixed(3)} (need <=${maxBodyRatio})`);
      return null;
    }

    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);

    // Dragonfly Doji: mecha inferior larga, superior corta
    if (lowerWick > range * minLongWick && upperWick < range * maxShortWick) {
      return 'DOJI_DRAGONFLY';
    }

    // Gravestone Doji: mecha superior larga, inferior corta
    if (upperWick > range * minLongWick && lowerWick < range * maxShortWick) {
      return 'DOJI_GRAVESTONE';
    }

    if (debug) {
      const lowerWickRatio = lowerWick / range;
      const upperWickRatio = upperWick / range;
      console.log(`[DOJI REJECTED] time=${candle.timestamp}, lowerWickRatio=${lowerWickRatio.toFixed(2)} (need >${minLongWick} for dragonfly), upperWickRatio=${upperWickRatio.toFixed(2)} (need >${minLongWick} for gravestone)`);
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
