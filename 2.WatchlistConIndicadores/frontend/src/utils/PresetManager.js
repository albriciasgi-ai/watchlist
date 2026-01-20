// Sistema de presets globales con overrides per-símbolo
class PresetManager {
  static STORAGE_KEY = 'indicator_presets_v1';

  // Presets por defecto para cada indicador
  static DEFAULT_PRESETS = {
    "Rejection Patterns": {
      showMode: "validated",
      minConfidence: 70,
      alertEnabled: false,
      alertThreshold: 80,
      contexts: {
        volumeProfileDynamic: true,
        volumeProfileFixed: true,
        rangeDetector: true
      },
      patterns: {
        hammer: {enabled: true, minWickRatio: 2.0},
        shootingStar: {enabled: true, minWickRatio: 2.0},
        engulfing: {enabled: true},
        doji: {enabled: true, maxBodyRatio: 0.1}
      }
    },
    "Support & Resistance": {
      volumeMethod: "zscore",
      zScoreThreshold: 1.0,
      zScorePeriod: 50,
      leftBars: 12,
      rightBars: 12,
      minTouches: 2,
      clusterDistance: 0.5,
      maxLevels: 20,
      showResistances: true,
      showSupports: true,
      showConsolidationZones: true,
      showLabels: true,
      lineWidth: 2
    },
    "VWAP": {
      vwapType: "session",
      resetHour: 0,
      rollingPeriod: 200,
      showBands: true,
      bandMultipliers: [1.0, 2.0, 3.0],
      applyCryptoAdjustment: true,
      showVWAP: true,
      vwapColor: "#FF9800",
      upperBandColor: "#FF5252",
      lowerBandColor: "#4CAF50"
    },
    "Fibonacci": {
      autoDetect: true,
      lookback: 100,
      levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
      showExtensions: false,
      extensionLevels: [1.272, 1.414, 1.618],
      showLabels: true,
      lineWidth: 1
    },
    "Continuation Patterns": {
      showContinuation: true,
      minConfidence: 60,
      includeVWAP: true,
      includeFibonacci: true,
      includeVolumeProfile: true,
      lookback: 50
    },
    "Open Interest": {
      mode: "histogram",
      smoothing: 3,
      showPriceSentiment: false
    },
    "Volume Profile": {
      mode: "dynamic",
      rows: 100,
      valueAreaPercent: 0.70,
      histogramWidth: 50,
      histogramPosition: "right",
      useGradient: true,
      showLabels: true,
      showVolumeLabels: false,
      hideWhenFixedRanges: false,
      baseColor: "#2196F3",
      valueAreaColor: "#FF9800",
      pocColor: "#F44336",
      vahValColor: "#2196F3",
      clusterColor: "#9C27B0",
      rangeShadeColor: "#E0E0E0",
      enableClusterDetection: false,
      clusterThreshold: 1.5
    },
    "Range Detection": {
      minRangeLength: 20,
      atrMultiplier: 1.0,
      atrLength: 200,
      maxBreakoutCandles: 5,
      createTrendProfiles: false,
      showOtherTimeframes: false
    }
  };

  /**
   * Carga todos los presets y overrides
   */
  static loadAll() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);

        // 🔧 Migración: Convertir bandMultiplier (singular) a bandMultipliers (plural array)
        const migrateVWAPConfig = (config) => {
          if (config && config.bandMultiplier !== undefined && !config.bandMultipliers) {
            console.log('[PresetManager] 🔄 Migrando VWAP config: bandMultiplier → bandMultipliers');
            const { bandMultiplier, ...rest } = config;
            return {
              ...rest,
              bandMultipliers: [1.0, 2.0, 3.0],
              applyCryptoAdjustment: config.applyCryptoAdjustment ?? true
            };
          }
          return config;
        };

        // Migrar preset global de VWAP
        const globalPresets = { ...this.DEFAULT_PRESETS, ...(parsed.globalPresets || {}) };
        if (globalPresets.VWAP) {
          globalPresets.VWAP = migrateVWAPConfig(globalPresets.VWAP);
        }

        // Migrar overrides de VWAP
        const symbolOverrides = parsed.symbolOverrides || {};
        let migrated = false;
        Object.keys(symbolOverrides).forEach(symbol => {
          if (symbolOverrides[symbol].VWAP) {
            const oldConfig = symbolOverrides[symbol].VWAP;
            symbolOverrides[symbol].VWAP = migrateVWAPConfig(oldConfig);
            if (oldConfig !== symbolOverrides[symbol].VWAP) {
              migrated = true;
            }
          }
        });

        // Si hubo migración, guardar automáticamente
        if (migrated || (globalPresets.VWAP && globalPresets.VWAP.bandMultipliers)) {
          // console.log('[PresetManager] 💾 Guardando presets migrados...');
          this.saveAll(globalPresets, symbolOverrides);
        }

        return { globalPresets, symbolOverrides };
      }
    } catch (error) {
      console.error('[PresetManager] Error loading presets:', error);
    }

    return {
      globalPresets: { ...this.DEFAULT_PRESETS },
      symbolOverrides: {}
    };
  }

  /**
   * Guarda todos los presets y overrides
   */
  static saveAll(globalPresets, symbolOverrides) {
    try {
      const data = {
        globalPresets,
        symbolOverrides,
        version: 1,
        lastUpdate: Date.now()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      // console.log('[PresetManager] Presets guardados exitosamente');
      return true;
    } catch (error) {
      console.error('[PresetManager] Error saving presets:', error);
      return false;
    }
  }

  /**
   * Obtiene configuración efectiva para un indicador en un símbolo
   * (preset global + override si existe)
   */
  static getEffectiveConfig(indicatorName, symbol) {
    const { globalPresets, symbolOverrides } = this.loadAll();

    // Preset global base
    const globalConfig = globalPresets[indicatorName] || this.DEFAULT_PRESETS[indicatorName] || {};

    // Override específico del símbolo (si existe)
    const symbolOverride = symbolOverrides[symbol]?.[indicatorName];

    // Merge: override tiene prioridad
    if (symbolOverride) {
      // console.log(`[PresetManager] 🔧 ${symbol} ${indicatorName}: Usando override local`);
      return { ...globalConfig, ...symbolOverride };
    }

    // console.log(`[PresetManager] 🌐 ${symbol} ${indicatorName}: Usando preset global`);
    return globalConfig;
  }

  /**
   * Actualiza preset global para un indicador
   */
  static updateGlobalPreset(indicatorName, config) {
    const { globalPresets, symbolOverrides } = this.loadAll();
    globalPresets[indicatorName] = { ...globalPresets[indicatorName], ...config };
    this.saveAll(globalPresets, symbolOverrides);
    console.log(`[PresetManager] ✅ Preset global actualizado: ${indicatorName}`);
  }

  /**
   * Actualiza override para un símbolo específico
   */
  static updateSymbolOverride(symbol, indicatorName, config) {
    const { globalPresets, symbolOverrides } = this.loadAll();

    if (!symbolOverrides[symbol]) {
      symbolOverrides[symbol] = {};
    }

    symbolOverrides[symbol][indicatorName] = { ...config };
    this.saveAll(globalPresets, symbolOverrides);
    console.log(`[PresetManager] ✅ Override guardado: ${symbol} - ${indicatorName}`);
  }

  /**
   * Elimina override para un símbolo (vuelve a preset global)
   */
  static clearSymbolOverride(symbol, indicatorName) {
    const { globalPresets, symbolOverrides } = this.loadAll();

    if (symbolOverrides[symbol]?.[indicatorName]) {
      delete symbolOverrides[symbol][indicatorName];

      // Si el símbolo no tiene más overrides, eliminar la entrada
      if (Object.keys(symbolOverrides[symbol]).length === 0) {
        delete symbolOverrides[symbol];
      }

      this.saveAll(globalPresets, symbolOverrides);
      console.log(`[PresetManager] 🗑️ Override eliminado: ${symbol} - ${indicatorName}`);
      return true;
    }

    return false;
  }

  /**
   * Verifica si un símbolo tiene override para un indicador
   */
  static hasOverride(symbol, indicatorName) {
    const { symbolOverrides } = this.loadAll();
    return !!symbolOverrides[symbol]?.[indicatorName];
  }

  /**
   * Obtiene preset global puro (sin overrides)
   */
  static getGlobalPreset(indicatorName) {
    const { globalPresets } = this.loadAll();
    return globalPresets[indicatorName] || this.DEFAULT_PRESETS[indicatorName] || {};
  }

  /**
   * Obtiene override específico del símbolo (sin preset global)
   */
  static getSymbolOverride(symbol, indicatorName) {
    const { symbolOverrides } = this.loadAll();
    return symbolOverrides[symbol]?.[indicatorName] || null;
  }

  /**
   * Restaura todos los presets a valores por defecto
   */
  static resetToDefaults() {
    this.saveAll({ ...this.DEFAULT_PRESETS }, {});
    console.log('[PresetManager] 🔄 Presets restaurados a valores por defecto');
  }

  /**
   * Exporta configuración actual (para backup)
   */
  static export() {
    return this.loadAll();
  }

  /**
   * Importa configuración (desde backup)
   */
  static import(data) {
    if (data.globalPresets && data.symbolOverrides) {
      this.saveAll(data.globalPresets, data.symbolOverrides);
      console.log('[PresetManager] ✅ Configuración importada exitosamente');
      return true;
    }
    console.error('[PresetManager] ❌ Formato de importación inválido');
    return false;
  }
}

export default PresetManager;
