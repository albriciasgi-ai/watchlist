// src/components/indicators/LevelSourceManager.js
// Level Source Manager - Consolidates levels from multiple sources for pattern detection

/**
 * LevelSourceManager
 *
 * Aggregates price levels from multiple sources:
 * - Support & Resistance
 * - Volume Profile (Fixed Ranges + Dynamic)
 * - VWAP + Standard Deviation Bands
 * - Fibonacci Retracements & Extensions
 * - Manual Levels
 *
 * Provides adaptive weight calculation for confidence scoring
 */
class LevelSourceManager {
  constructor(indicatorManager) {
    this.indicatorManager = indicatorManager;

    // Level source configuration
    this.sourceConfig = {
      supportResistance: { enabled: true, weight: null },  // Auto-calculated
      volumeProfile: { enabled: true, weight: null },
      vwap: { enabled: false, weight: null },
      fibonacci: { enabled: false, weight: null },
      manual: { enabled: false, weight: null }
    };

    // Base confidence factors (60% total)
    this.baseFactorWeights = {
      patternQuality: 0.25,    // 25%
      relativeSize: 0.20,      // 20%
      volume: 0.15             // 15%
    };

    // Level factors get remaining 40%, distributed among active sources
    this.levelFactorWeight = 0.40;
  }

  /**
   * Update source configuration
   */
  updateConfig(config) {
    if (config.supportResistance !== undefined) {
      this.sourceConfig.supportResistance.enabled = config.supportResistance;
    }
    if (config.volumeProfile !== undefined) {
      this.sourceConfig.volumeProfile.enabled = config.volumeProfile;
    }
    if (config.vwap !== undefined) {
      this.sourceConfig.vwap.enabled = config.vwap;
    }
    if (config.fibonacci !== undefined) {
      this.sourceConfig.fibonacci.enabled = config.fibonacci;
    }
    if (config.manual !== undefined) {
      this.sourceConfig.manual.enabled = config.manual;
    }

    // Recalculate adaptive weights
    this._updateAdaptiveWeights();
  }

  /**
   * Get all levels from active sources
   *
   * @param {Object} options - Options for level retrieval
   * @param {number} options.priceMin - Minimum price to include (viewport filter)
   * @param {number} options.priceMax - Maximum price to include (viewport filter)
   * @param {boolean} options.includeDisabled - Include levels from disabled sources
   * @returns {Object} Levels organized by source
   */
  getAllLevels(options = {}) {
    const {
      priceMin = null,
      priceMax = null,
      includeDisabled = false
    } = options;

    const levels = {
      supportResistance: [],
      volumeProfile: [],
      vwap: [],
      fibonacci: [],
      manual: [],
      all: []  // Flattened array of all levels
    };

    // Get Support & Resistance levels
    if (this.sourceConfig.supportResistance.enabled || includeDisabled) {
      const srLevels = this._getSupportResistanceLevels();
      levels.supportResistance = this._filterLevelsByPrice(srLevels, priceMin, priceMax);
    }

    // Get Volume Profile levels
    if (this.sourceConfig.volumeProfile.enabled || includeDisabled) {
      const vpLevels = this._getVolumeProfileLevels();
      levels.volumeProfile = this._filterLevelsByPrice(vpLevels, priceMin, priceMax);
    }

    // Get VWAP levels
    if (this.sourceConfig.vwap.enabled || includeDisabled) {
      const vwapLevels = this._getVWAPLevels();
      levels.vwap = this._filterLevelsByPrice(vwapLevels, priceMin, priceMax);
    }

    // Get Fibonacci levels
    if (this.sourceConfig.fibonacci.enabled || includeDisabled) {
      const fibLevels = this._getFibonacciLevels();
      levels.fibonacci = this._filterLevelsByPrice(fibLevels, priceMin, priceMax);
    }

    // Get Manual levels
    if (this.sourceConfig.manual.enabled || includeDisabled) {
      const manualLevels = this._getManualLevels();
      levels.manual = this._filterLevelsByPrice(manualLevels, priceMin, priceMax);
    }

    // Flatten all levels into single array
    levels.all = [
      ...levels.supportResistance,
      ...levels.volumeProfile,
      ...levels.vwap,
      ...levels.fibonacci,
      ...levels.manual
    ];

    return levels;
  }

  /**
   * Get adaptive weights for confidence scoring
   *
   * Returns weight distribution based on active sources:
   * - Base factors: 60% fixed (pattern quality, size, volume)
   * - Level factors: 40% distributed among active sources
   *
   * @returns {Object} Weight configuration for confidence calculation
   */
  getActiveSourceWeights() {
    const activeSourceCount = this._getActiveSourceCount();

    return {
      base: this.baseFactorWeights,
      sources: {
        supportResistance: this.sourceConfig.supportResistance.weight || 0,
        volumeProfile: this.sourceConfig.volumeProfile.weight || 0,
        vwap: this.sourceConfig.vwap.weight || 0,
        fibonacci: this.sourceConfig.fibonacci.weight || 0,
        manual: this.sourceConfig.manual.weight || 0
      },
      activeSourceCount,
      totalLevelWeight: this.levelFactorWeight
    };
  }

  /**
   * Check if a price is near any level from active sources
   *
   * @param {number} price - Price to check
   * @param {number} tolerance - Proximity tolerance (percentage, e.g., 0.5 for 0.5%)
   * @returns {Object} Nearby levels and proximity info
   */
  checkProximityToLevels(price, tolerance = 0.5) {
    const levels = this.getAllLevels();
    const toleranceDecimal = tolerance / 100;

    const nearbyLevels = [];

    levels.all.forEach(level => {
      const distance = Math.abs(price - level.price);
      const priceRange = price * toleranceDecimal;

      if (distance <= priceRange) {
        const proximityPercent = (distance / price) * 100;

        nearbyLevels.push({
          ...level,
          distance,
          proximityPercent,
          isWithinTolerance: true
        });
      }
    });

    // Sort by proximity (closest first)
    nearbyLevels.sort((a, b) => a.distance - b.distance);

    return {
      hasNearbyLevels: nearbyLevels.length > 0,
      nearbyLevels,
      closestLevel: nearbyLevels[0] || null,
      levelCount: nearbyLevels.length
    };
  }

  /**
   * Get level statistics for current configuration
   */
  getLevelStats() {
    const levels = this.getAllLevels();

    return {
      total: levels.all.length,
      bySource: {
        supportResistance: levels.supportResistance.length,
        volumeProfile: levels.volumeProfile.length,
        vwap: levels.vwap.length,
        fibonacci: levels.fibonacci.length,
        manual: levels.manual.length
      },
      activeSourceCount: this._getActiveSourceCount(),
      weights: this.getActiveSourceWeights()
    };
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Update adaptive weights based on active sources
   * @private
   */
  _updateAdaptiveWeights() {
    const activeCount = this._getActiveSourceCount();

    if (activeCount === 0) {
      // No sources active, all weights are 0
      Object.keys(this.sourceConfig).forEach(source => {
        this.sourceConfig[source].weight = 0;
      });
      return;
    }

    // Distribute 40% among active sources
    const weightPerSource = this.levelFactorWeight / activeCount;

    Object.keys(this.sourceConfig).forEach(source => {
      if (this.sourceConfig[source].enabled) {
        this.sourceConfig[source].weight = weightPerSource;
      } else {
        this.sourceConfig[source].weight = 0;
      }
    });
  }

  /**
   * Get count of active sources
   * @private
   */
  _getActiveSourceCount() {
    return Object.values(this.sourceConfig).filter(source => source.enabled).length;
  }

  /**
   * Get Support & Resistance levels from existing indicator
   * @private
   */
  _getSupportResistanceLevels() {
    // Support & Resistance levels come from the existing S&R indicator
    // This would integrate with the existing SupportResistanceIndicator
    // For now, return empty array - will be integrated in IndicatorManager
    return [];
  }

  /**
   * Get Volume Profile levels (POC, VAH, VAL)
   * @private
   */
  _getVolumeProfileLevels() {
    const levels = [];

    // Get dynamic Volume Profile levels
    const vpIndicator = this.indicatorManager.getIndicator('VolumeProfile');
    if (vpIndicator && vpIndicator.enabled) {
      const vpData = vpIndicator.getVolumeProfileData?.();
      if (vpData) {
        if (vpData.poc) {
          levels.push({
            price: vpData.poc,
            type: 'volume_profile_poc',
            source: 'volumeProfile',
            strength: 95,
            label: 'POC'
          });
        }
        if (vpData.vah) {
          levels.push({
            price: vpData.vah,
            type: 'volume_profile_vah',
            source: 'volumeProfile',
            strength: 85,
            label: 'VAH'
          });
        }
        if (vpData.val) {
          levels.push({
            price: vpData.val,
            type: 'volume_profile_val',
            source: 'volumeProfile',
            strength: 85,
            label: 'VAL'
          });
        }
      }
    }

    // Get fixed range Volume Profile levels
    const fixedRangeIndicators = this.indicatorManager.getIndicatorsByType?.('VolumeProfileFixedRange') || [];
    fixedRangeIndicators.forEach(indicator => {
      if (indicator.enabled) {
        const vpData = indicator.getVolumeProfileData?.();
        if (vpData) {
          if (vpData.poc) {
            levels.push({
              price: vpData.poc,
              type: 'volume_profile_fixed_poc',
              source: 'volumeProfile',
              strength: 90,
              label: `POC (${indicator.label || 'Fixed'})`,
              rangeId: indicator.rangeId
            });
          }
          if (vpData.vah) {
            levels.push({
              price: vpData.vah,
              type: 'volume_profile_fixed_vah',
              source: 'volumeProfile',
              strength: 80,
              label: `VAH (${indicator.label || 'Fixed'})`,
              rangeId: indicator.rangeId
            });
          }
          if (vpData.val) {
            levels.push({
              price: vpData.val,
              type: 'volume_profile_fixed_val',
              source: 'volumeProfile',
              strength: 80,
              label: `VAL (${indicator.label || 'Fixed'})`,
              rangeId: indicator.rangeId
            });
          }
        }
      }
    });

    return levels;
  }

  /**
   * Get VWAP levels (main line + bands)
   * @private
   */
  _getVWAPLevels() {
    const vwapIndicator = this.indicatorManager.getIndicator('VWAP');

    if (!vwapIndicator || !vwapIndicator.enabled) {
      return [];
    }

    // Use the indicator's getVWAPLevels() method
    const levels = vwapIndicator.getVWAPLevels?.() || [];

    // Add source property
    return levels.map(level => ({
      ...level,
      source: 'vwap'
    }));
  }

  /**
   * Get Fibonacci levels (retracements + extensions)
   * @private
   */
  _getFibonacciLevels() {
    const fibIndicator = this.indicatorManager.getIndicator('Fibonacci');

    if (!fibIndicator || !fibIndicator.enabled) {
      return [];
    }

    // Use the indicator's getFibonacciLevels() method
    const levels = fibIndicator.getFibonacciLevels?.() || [];

    // Add source property
    return levels.map(level => ({
      ...level,
      source: 'fibonacci'
    }));
  }

  /**
   * Get manual levels
   * @private
   */
  _getManualLevels() {
    // Manual levels would be stored in a separate system
    // For now, return empty array - will be implemented later if needed
    return [];
  }

  /**
   * Filter levels by price range
   * @private
   */
  _filterLevelsByPrice(levels, priceMin, priceMax) {
    if (priceMin === null && priceMax === null) {
      return levels;
    }

    return levels.filter(level => {
      if (priceMin !== null && level.price < priceMin) return false;
      if (priceMax !== null && level.price > priceMax) return false;
      return true;
    });
  }
}

export default LevelSourceManager;
