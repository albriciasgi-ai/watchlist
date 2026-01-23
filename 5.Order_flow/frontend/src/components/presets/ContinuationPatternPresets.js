// src/components/presets/ContinuationPatternPresets.js

/**
 * Preset configurations for Continuation Pattern Indicator
 *
 * Each preset is a complete configuration object that can be loaded
 * to quickly setup the indicator for different trading styles
 */

export const CONTINUATION_PATTERN_PRESETS = {
  /**
   * DEFAULT - Configuración actual balanceada
   * Todos los patrones activos, configuración general
   */
  default: {
    name: "Default (Balanceado)",
    description: "Configuración balanceada con todos los patrones activos",
    config: {
      // Type visibility
      showContinuation: true,
      showTrendStart: false,
      showMomentum: false,
      showReversal: true,

      // General settings
      minConfidence: 30,
      showLabels: true,
      showConfidence: true,
      iconSize: 9,

      // Pattern parameters
      patternParams: {
        reversal: {
          minWickRatio: 1.5,
          maxOppositeWick: 0.25,
          minBodyPosition: 0.5,
          engulfingTolerance: 0.02,
          invertProximity: false
        },
        continuation: {
          maxConsolidationRange: 0.03,
          minBreakoutSize: 0.01,
          minTrendStrength: 60,
          invertProximity: false
        },
        trendStart: {
          minBreakoutSize: 0.02,
          invertProximity: false
        },
        momentum: {
          minBodyPercent: 0.3,
          minConsecutive: 3,
          invertProximity: false
        }
      },

      // All patterns enabled
      patternEnables: {
        hammer: true,
        shooting_star: true,
        bull_engulfing: true,
        bear_engulfing: true,
        dragonfly_doji: true,
        gravestone_doji: true,
        bull_flag: true,
        bear_flag: true,
        bull_pennant: true,
        bear_pennant: true,
        bull_breakout: true,
        bear_breakout: true,
        three_white_soldiers: true,
        three_black_crows: true,
        bull_marubozu: true,
        bear_marubozu: true
      },

      // Level sources
      includeVWAP: true,
      includeFibonacci: false,
      vwapConfig: {
        vwap_type: 'session',
        apply_crypto_adjustment: false
      },
      fibonacciConfig: {
        auto_detect: true,
        lookback: 100,
        include_extensions: false
      }
    }
  },

  /**
   * RAYNER TEO MODE - Enfoque en contexto sobre cantidad
   * Solo patrones core (2 por categoría)
   * Alta dependencia de niveles clave
   * Filosofía: Contexto > Cantidad de patrones
   */
  rayner_teo: {
    name: "Rayner Teo Mode",
    description: "Solo patrones core con alto énfasis en contexto (VWAP/Fibonacci)",
    config: {
      // Type visibility - Todos activos para ver las 4 categorías
      showContinuation: true,
      showTrendStart: true,
      showMomentum: true,
      showReversal: true,

      // General settings - Mayor confianza requerida
      minConfidence: 50, // MÁS ALTO: Solo patrones de alta calidad
      showLabels: true,
      showConfidence: true,
      iconSize: 10, // Ligeramente más grande para visibilidad

      // Pattern parameters - MÁS ESTRICTOS
      patternParams: {
        reversal: {
          minWickRatio: 2.0,          // MÁS ESTRICTO (1.5 → 2.0)
          maxOppositeWick: 0.15,      // MÁS ESTRICTO (0.25 → 0.15)
          minBodyPosition: 0.6,       // MÁS ESTRICTO (0.5 → 0.6)
          engulfingTolerance: 0.01,   // MÁS ESTRICTO (0.02 → 0.01)
          invertProximity: false      // NORMAL: Cerca de niveles = alta confianza
        },
        continuation: {
          maxConsolidationRange: 0.02,  // MÁS ESTRICTO (0.03 → 0.02)
          minBreakoutSize: 0.015,       // MÁS ESTRICTO (0.01 → 0.015)
          minTrendStrength: 70,         // MÁS ESTRICTO (60 → 70)
          invertProximity: false        // NORMAL: Cerca de niveles
        },
        trendStart: {
          minBreakoutSize: 0.025,       // MÁS ESTRICTO (0.02 → 0.025)
          invertProximity: false        // NORMAL: Breakouts desde niveles
        },
        momentum: {
          minBodyPercent: 0.4,          // MÁS ESTRICTO (0.3 → 0.4)
          minConsecutive: 3,
          invertProximity: false        // NORMAL: Cerca de niveles
        }
      },

      // SOLO PATRONES CORE (2 por categoría = 8 total)
      patternEnables: {
        // Reversal: Solo los 2 más confiables
        hammer: true,              // ✅ Core
        shooting_star: true,       // ✅ Core
        bull_engulfing: false,     // ❌ Muchos falsos positivos
        bear_engulfing: false,     // ❌ Muchos falsos positivos
        dragonfly_doji: false,     // ❌ Menos común
        gravestone_doji: false,    // ❌ Menos común

        // Continuation: Solo flags (más claros que pennants)
        bull_flag: true,           // ✅ Core
        bear_flag: true,           // ✅ Core
        bull_pennant: false,       // ❌ Más difíciles de detectar
        bear_pennant: false,       // ❌ Más difíciles de detectar

        // Trend Start: Ambos (solo 2 en esta categoría)
        bull_breakout: true,       // ✅ Core
        bear_breakout: true,       // ✅ Core

        // Momentum: Solo soldiers/crows (más fuertes que marubozu)
        three_white_soldiers: true,  // ✅ Core
        three_black_crows: true,     // ✅ Core
        bull_marubozu: false,        // ❌ Marubozu menos fiables
        bear_marubozu: false         // ❌ Marubozu menos fiables
      },

      // Level sources - AMBOS ACTIVOS (contexto es clave)
      includeVWAP: true,           // ✅ VWAP es crítico para Rayner
      includeFibonacci: true,      // ✅ Fibonacci también (cambio vs default)
      vwapConfig: {
        vwap_type: 'session',
        apply_crypto_adjustment: false
      },
      fibonacciConfig: {
        auto_detect: true,
        lookback: 100,
        include_extensions: true   // ✅ Incluir extensiones para más contexto
      }
    }
  },

  /**
   * SCALPING MODE - Para trading de corto plazo
   * Todos los patrones, baja confianza, inversión de lógica para capturar movimientos rápidos
   */
  scalping: {
    name: "Scalping (Alta Frecuencia)",
    description: "Configuración para scalping - más señales, menor confianza requerida",
    config: {
      showContinuation: true,
      showTrendStart: true,
      showMomentum: true,
      showReversal: true,

      minConfidence: 25, // BAJO: Más señales
      showLabels: false,  // Menos clutter en pantalla
      showConfidence: true,
      iconSize: 8,        // Más pequeño

      patternParams: {
        reversal: {
          minWickRatio: 1.2,          // PERMISIVO
          maxOppositeWick: 0.3,       // PERMISIVO
          minBodyPosition: 0.4,       // PERMISIVO
          engulfingTolerance: 0.03,   // PERMISIVO
          invertProximity: false
        },
        continuation: {
          maxConsolidationRange: 0.04,
          minBreakoutSize: 0.005,     // MUY BAJO
          minTrendStrength: 50,       // BAJO
          invertProximity: false
        },
        trendStart: {
          minBreakoutSize: 0.015,     // BAJO
          invertProximity: false
        },
        momentum: {
          minBodyPercent: 0.25,       // BAJO
          minConsecutive: 2,          // SOLO 2 VELAS
          invertProximity: false
        }
      },

      patternEnables: {
        // Todos activos para máximas oportunidades
        hammer: true,
        shooting_star: true,
        bull_engulfing: true,
        bear_engulfing: true,
        dragonfly_doji: true,
        gravestone_doji: true,
        bull_flag: true,
        bear_flag: true,
        bull_pennant: true,
        bear_pennant: true,
        bull_breakout: true,
        bear_breakout: true,
        three_white_soldiers: true,
        three_black_crows: true,
        bull_marubozu: true,
        bear_marubozu: true
      },

      includeVWAP: true,
      includeFibonacci: false, // Solo VWAP para scalping
      vwapConfig: {
        vwap_type: 'rolling',  // Rolling VWAP mejor para scalping
        apply_crypto_adjustment: true
      },
      fibonacciConfig: {
        auto_detect: false,
        lookback: 50,
        include_extensions: false
      }
    }
  },

  /**
   * SWING TRADING MODE - Para posiciones de días/semanas
   * Patrones conservadores, alta confianza, énfasis en reversiones
   */
  swing_trading: {
    name: "Swing Trading (Posiciones Largas)",
    description: "Configuración conservadora para swing trading - alta calidad, pocas señales",
    config: {
      showContinuation: false,  // Solo reversiones para swing
      showTrendStart: true,
      showMomentum: false,
      showReversal: true,

      minConfidence: 60,        // MUY ALTO
      showLabels: true,
      showConfidence: true,
      iconSize: 12,             // Grande para visibilidad

      patternParams: {
        reversal: {
          minWickRatio: 2.5,          // MUY ESTRICTO
          maxOppositeWick: 0.1,       // MUY ESTRICTO
          minBodyPosition: 0.7,       // MUY ESTRICTO
          engulfingTolerance: 0.005,  // CASI PERFECTO
          invertProximity: false
        },
        continuation: {
          maxConsolidationRange: 0.015,
          minBreakoutSize: 0.02,
          minTrendStrength: 75,
          invertProximity: false
        },
        trendStart: {
          minBreakoutSize: 0.03,      // BREAKOUTS GRANDES
          invertProximity: false
        },
        momentum: {
          minBodyPercent: 0.5,
          minConsecutive: 3,
          invertProximity: false
        }
      },

      patternEnables: {
        // Solo los más confiables para swing
        hammer: true,
        shooting_star: true,
        bull_engulfing: false,
        bear_engulfing: false,
        dragonfly_doji: false,
        gravestone_doji: false,
        bull_flag: false,
        bear_flag: false,
        bull_pennant: false,
        bear_pennant: false,
        bull_breakout: true,
        bear_breakout: true,
        three_white_soldiers: false,
        three_black_crows: false,
        bull_marubozu: false,
        bear_marubozu: false
      },

      includeVWAP: true,
      includeFibonacci: true,  // Ambos niveles para swing
      vwapConfig: {
        vwap_type: 'session',
        apply_crypto_adjustment: false
      },
      fibonacciConfig: {
        auto_detect: true,
        lookback: 150,          // Lookback más largo
        include_extensions: true
      }
    }
  },

  /**
   * DIVERGENCE HUNTER - Detectar divergencias
   * Lógica invertida, énfasis en patrones lejos de niveles
   */
  divergence_hunter: {
    name: "Divergence Hunter",
    description: "Detecta patrones LEJOS de niveles (divergencias, agotamiento)",
    config: {
      showContinuation: false,
      showTrendStart: false,
      showMomentum: false,
      showReversal: true,       // Solo reversales para divergencias

      minConfidence: 40,
      showLabels: true,
      showConfidence: true,
      iconSize: 10,

      patternParams: {
        reversal: {
          minWickRatio: 2.0,
          maxOppositeWick: 0.2,
          minBodyPosition: 0.6,
          engulfingTolerance: 0.015,
          invertProximity: true   // ⚠️ INVERTIDO: Lejos = alta confianza
        },
        continuation: {
          maxConsolidationRange: 0.03,
          minBreakoutSize: 0.01,
          minTrendStrength: 60,
          invertProximity: false
        },
        trendStart: {
          minBreakoutSize: 0.02,
          invertProximity: false
        },
        momentum: {
          minBodyPercent: 0.3,
          minConsecutive: 3,
          invertProximity: false
        }
      },

      patternEnables: {
        // Solo patrones de reversión fuertes
        hammer: true,
        shooting_star: true,
        bull_engulfing: true,
        bear_engulfing: true,
        dragonfly_doji: true,
        gravestone_doji: true,
        bull_flag: false,
        bear_flag: false,
        bull_pennant: false,
        bear_pennant: false,
        bull_breakout: false,
        bear_breakout: false,
        three_white_soldiers: false,
        three_black_crows: false,
        bull_marubozu: false,
        bear_marubozu: false
      },

      includeVWAP: true,
      includeFibonacci: true,  // Necesario para detectar divergencias
      vwapConfig: {
        vwap_type: 'session',
        apply_crypto_adjustment: false
      },
      fibonacciConfig: {
        auto_detect: true,
        lookback: 100,
        include_extensions: true
      }
    }
  }
};

/**
 * Get list of preset names for dropdown
 */
export const getPresetNames = () => {
  return Object.keys(CONTINUATION_PATTERN_PRESETS).map(key => ({
    key,
    name: CONTINUATION_PATTERN_PRESETS[key].name,
    description: CONTINUATION_PATTERN_PRESETS[key].description
  }));
};

/**
 * Get preset configuration by key
 */
export const getPresetConfig = (presetKey) => {
  const preset = CONTINUATION_PATTERN_PRESETS[presetKey];
  return preset ? preset.config : null;
};

/**
 * Check if current config matches a preset
 */
export const matchesPreset = (currentConfig, presetKey) => {
  const presetConfig = getPresetConfig(presetKey);
  if (!presetConfig) return false;

  // Deep comparison (simplified - you might want a proper deep equal)
  return JSON.stringify(currentConfig) === JSON.stringify(presetConfig);
};
