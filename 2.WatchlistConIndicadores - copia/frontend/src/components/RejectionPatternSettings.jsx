import React, { useState, useEffect } from 'react';
import './RejectionPatternSettings.css';

/**
 * Rejection Pattern Settings Component
 *
 * Allows users to configure:
 * - Which patterns to detect (Hammer, Shooting Star, Engulfing, etc.)
 * - Pattern-specific parameters (wick ratios, body position, debug mode)
 * - Swing detection settings
 * - Reference contexts to validate patterns (Volume Profiles, Range Detector)
 * - Filters (confidence, volume, proximity)
 * - Alert settings
 * - Quick presets by timeframe
 */
const RejectionPatternSettings = ({
  symbol,
  onConfigChange,
  onClose,
  initialConfig,
  indicatorManager  // NUEVO: recibir el IndicatorManager
}) => {
  const [config, setConfig] = useState(initialConfig || getDefaultConfig());
  const [availableContexts, setAvailableContexts] = useState([]);
  const [showContextModal, setShowContextModal] = useState(false);
  const [showMode, setShowMode] = useState('validated');
  const [activePreset, setActivePreset] = useState('custom');
  const [showAddZoneModal, setShowAddZoneModal] = useState(false);
  const [expandedSections, setExpandedSections] = useState({ strategy: false });

  // ✅ NUEVO: Leer el modo actual del indicador al montar
  useEffect(() => {
    if (indicatorManager) {
      const indicator = indicatorManager.getRejectionPatternIndicator();
      if (indicator && indicator.showMode) {
        setShowMode(indicator.showMode);
        console.log(`[${symbol}] Show mode loaded from indicator: ${indicator.showMode}`);
      }
    }
  }, [indicatorManager, symbol]);

  useEffect(() => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem(`rejection_pattern_config_${symbol}`);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        // Migrate old configs to include new fields
        const migratedConfig = migrateConfig(parsed);
        setConfig(migratedConfig);
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    }
  }, [symbol]);

  useEffect(() => {
    // NUEVO: Cargar contextos disponibles desde IndicatorManager
    if (indicatorManager) {
      loadAvailableContexts();
    }
  }, [indicatorManager, symbol]);

  const loadAvailableContexts = () => {
    if (!indicatorManager) {
      console.warn('[RejectionPatternSettings] No IndicatorManager available');
      return;
    }

    const contexts = [];

    try {
      // 1. Usar el método del IndicatorManager para obtener los perfiles del símbolo
      const symbolProfiles = indicatorManager.getFixedRangeProfiles();
      console.log(`[${symbol}] Profiles from IndicatorManager:`, symbolProfiles.length, symbolProfiles);

      // 2. Obtener las instancias de los indicadores para acceder a los valores calculados
      const fixedRangeIndicators = indicatorManager.fixedRangeIndicators || [];
      console.log(`[${symbol}] Fixed range indicator instances:`, fixedRangeIndicators.length);

      symbolProfiles.forEach(range => {
        // Buscar la instancia del indicador para este rango
        const indicator = fixedRangeIndicators.find(ind => ind.rangeId === range.rangeId);

        // Obtener valores POC/VAH/VAL del perfil calculado si existe
        let poc = null, vah = null, val = null;
        if (indicator && indicator.profile) {
          poc = indicator.profile.poc?.price;
          vah = indicator.profile.valueArea?.vahPrice;
          val = indicator.profile.valueArea?.valPrice;
        }

        // Formatear el nombre del rango
        const startDate = formatDate(range.startTimestamp);
        const endDate = formatDate(range.endTimestamp);
        const rangeName = range.name || `${startDate} - ${endDate}`;

        contexts.push({
          id: range.rangeId,
          type: 'VOLUME_PROFILE_FIXED',
          label: `VP Fijo: ${rangeName}`,
          description: `${startDate} → ${endDate}`,
          metadata: {
            poc: poc,
            vah: vah,
            val: val,
            startTimestamp: range.startTimestamp,
            endTimestamp: range.endTimestamp,
            hasCalculatedValues: poc !== null && vah !== null && val !== null
          },
          levels: ['POC', 'VAH', 'VAL']
        });
      });

      // 3. Agregar Volume Profile Dinámico si está activo
      if (indicatorManager.hasDynamicVolumeProfile()) {
        const vpData = indicatorManager.getDynamicVolumeProfileData();

        if (vpData && vpData.poc !== null && vpData.vah !== null && vpData.val !== null) {
          const startDate = formatDate(vpData.startTimestamp);
          const endDate = formatDate(vpData.endTimestamp);

          contexts.push({
            id: 'dynamic_vp',
            type: 'VOLUME_PROFILE_DYNAMIC',
            label: `VP Dinámico`,
            description: `${startDate} → ${endDate} (Auto-actualizado)`,
            metadata: {
              poc: vpData.poc,
              vah: vpData.vah,
              val: vpData.val,
              startTimestamp: vpData.startTimestamp,
              endTimestamp: vpData.endTimestamp,
              hasCalculatedValues: true
            },
            levels: ['POC', 'VAH', 'VAL']
          });

          console.log(`[${symbol}] Added dynamic Volume Profile context:`, vpData);
        }
      }

      console.log(`[${symbol}] Found ${contexts.length} available contexts:`, contexts);
      setAvailableContexts(contexts);

    } catch (error) {
      console.error('[RejectionPatternSettings] Error loading available contexts:', error);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
  };

  // Migrar configs antiguas para incluir nuevos campos
  const migrateConfig = (oldConfig) => {
    const defaultConfig = getDefaultConfig();

    return {
      ...defaultConfig,
      ...oldConfig,
      patterns: {
        hammer: { ...defaultConfig.patterns.hammer, ...oldConfig.patterns?.hammer },
        shootingStar: { ...defaultConfig.patterns.shootingStar, ...oldConfig.patterns?.shootingStar },
        engulfing: { ...defaultConfig.patterns.engulfing, ...oldConfig.patterns?.engulfing },
        doji: { ...defaultConfig.patterns.doji, ...oldConfig.patterns?.doji }
      },
      swingDetection: {
        ...defaultConfig.swingDetection,
        ...oldConfig.swingDetection
      },
      levelSources: {
        ...defaultConfig.levelSources,
        ...oldConfig.levelSources
      },
      signalDirection: {
        ...defaultConfig.signalDirection,
        ...oldConfig.signalDirection
      },
      manualPriceZones: (oldConfig.manualPriceZones || defaultConfig.manualPriceZones).map(zone => ({
        ...zone,
        signalDirection: zone.signalDirection || 'BOTH'  // ✅ FIX: Migrate null to 'BOTH'
      })),
      debugMode: oldConfig.debugMode !== undefined ? oldConfig.debugMode : defaultConfig.debugMode,
      // ✅ NUEVO: Migrar vwapFilter
      vwapFilter: {
        ...defaultConfig.vwapFilter,
        ...oldConfig.vwapFilter,
        requiredDeviations: {
          ...defaultConfig.vwapFilter.requiredDeviations,
          ...oldConfig.vwapFilter?.requiredDeviations
        }
      },
      // ✅ NUEVO: Migrar swingArrowStyle
      swingArrowStyle: {
        ...defaultConfig.swingArrowStyle,
        ...oldConfig.swingArrowStyle
      },
      // ✅ NUEVO: Migrar strategy
      strategy: {
        ...defaultConfig.strategy,
        ...oldConfig.strategy
      }
    };
  };

  useEffect(() => {
    // Notify parent of config changes
    if (onConfigChange) {
      onConfigChange(config);
    }

    // Save to localStorage
    localStorage.setItem(`rejection_pattern_config_${symbol}`, JSON.stringify(config));
  }, [config, symbol]);  // ✅ FIX: Removed onConfigChange from deps to prevent infinite loop

  const togglePattern = (patternKey) => {
    setConfig(prev => ({
      ...prev,
      patterns: {
        ...prev.patterns,
        [patternKey]: {
          ...prev.patterns[patternKey],
          enabled: !prev.patterns[patternKey].enabled
        }
      }
    }));
    setActivePreset('custom');
  };

  const updatePatternConfig = (patternKey, field, value) => {
    setConfig(prev => ({
      ...prev,
      patterns: {
        ...prev.patterns,
        [patternKey]: {
          ...prev.patterns[patternKey],
          [field]: value
        }
      }
    }));
    setActivePreset('custom');
  };

  const updateSwingDetection = (field, value) => {
    setConfig(prev => ({
      ...prev,
      swingDetection: {
        ...prev.swingDetection,
        [field]: value
      }
    }));
    setActivePreset('custom');
  };

  const toggleContext = (contextId) => {
    setConfig(prev => {
      const contexts = prev.referenceContexts || [];
      const index = contexts.findIndex(c => c.id === contextId);

      if (index === -1) return prev;

      const newContexts = [...contexts];
      newContexts[index] = {
        ...newContexts[index],
        enabled: !newContexts[index].enabled
      };

      return {
        ...prev,
        referenceContexts: newContexts
      };
    });
  };

  const updateContextWeight = (contextId, weight) => {
    setConfig(prev => {
      const contexts = prev.referenceContexts || [];
      const index = contexts.findIndex(c => c.id === contextId);

      if (index === -1) return prev;

      const newContexts = [...contexts];
      newContexts[index] = {
        ...newContexts[index],
        weight: parseFloat(weight) / 100
      };

      return {
        ...prev,
        referenceContexts: newContexts
      };
    });
  };

  const updateFilter = (filterKey, value) => {
    setConfig(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        [filterKey]: value
      }
    }));
    setActivePreset('custom');
  };

  const addContext = (context) => {
    setConfig(prev => ({
      ...prev,
      referenceContexts: [
        ...(prev.referenceContexts || []),
        {
          ...context,
          enabled: true,
          weight: 0.5
        }
      ]
    }));
    setShowContextModal(false);
  };

  const removeContext = (contextId) => {
    setConfig(prev => ({
      ...prev,
      referenceContexts: (prev.referenceContexts || []).filter(c => c.id !== contextId)
    }));
  };

  const getEnabledPatternsCount = () => {
    return Object.values(config.patterns).filter(p => p.enabled).length;
  };

  const getEnabledContextsCount = () => {
    return (config.referenceContexts || []).filter(c => c.enabled).length;
  };

  const isContextEnabled = (contextId) => {
    const context = (config.referenceContexts || []).find(c => c.id === contextId);
    return context ? context.enabled : false;
  };

  const getContextWeight = (contextId) => {
    const context = (config.referenceContexts || []).find(c => c.id === contextId);
    return context ? Math.round(context.weight * 100) : 50;
  };

  // ✅ NUEVO: Obtiene el número de niveles S/R activos
  const getSRLevelCount = () => {
    if (!indicatorManager) return 0;
    const srIndicator = indicatorManager.getSupportResistanceIndicator();
    if (!srIndicator || !srIndicator.enabled) return 0;

    const activeLevels = [
      ...(srIndicator.supports || []).filter(l => l.status === 'active'),
      ...(srIndicator.resistances || []).filter(l => l.status === 'active')
    ];

    return activeLevels.length;
  };

  const handleShowModeChange = (mode) => {
    setShowMode(mode);
    // Actualizar el indicador con el nuevo modo
    if (indicatorManager) {
      const indicator = indicatorManager.getRejectionPatternIndicator();
      if (indicator) {
        indicator.setShowMode(mode);
        console.log(`[${symbol}] Show mode changed to: ${mode}`);
      }
    }
  };

  // ✅ NUEVO: Handlers para Level Sources
  const updateLevelSource = (source, enabled) => {
    setConfig(prev => ({
      ...prev,
      levelSources: {
        ...prev.levelSources,
        [source]: enabled
      }
    }));
    setActivePreset('custom');
  };

  // ✅ NUEVO: Handlers para Signal Direction
  const updateSignalDirection = (scope, direction) => {
    setConfig(prev => ({
      ...prev,
      signalDirection: {
        ...prev.signalDirection,
        [scope]: direction
      }
    }));
    setActivePreset('custom');
  };

  // ✅ NUEVO: Handlers para Manual Price Zones
  const addZone = (zone) => {
    setConfig(prev => ({
      ...prev,
      manualPriceZones: [...(prev.manualPriceZones || []), zone]
    }));
    setShowAddZoneModal(false);
  };

  const updateZone = (zoneId, updates) => {
    setConfig(prev => ({
      ...prev,
      manualPriceZones: prev.manualPriceZones.map(z =>
        z.id === zoneId ? { ...z, ...updates } : z
      )
    }));
  };

  const toggleZone = (zoneId, enabled) => {
    setConfig(prev => ({
      ...prev,
      manualPriceZones: prev.manualPriceZones.map(z =>
        z.id === zoneId ? { ...z, enabled } : z
      )
    }));
  };

  const deleteZone = (zoneId) => {
    if (window.confirm('Delete this price zone?')) {
      setConfig(prev => ({
        ...prev,
        manualPriceZones: prev.manualPriceZones.filter(z => z.id !== zoneId)
      }));
    }
  };

  const getCurrentPrice = () => {
    // Obtener precio actual del indicatorManager si está disponible
    if (indicatorManager) {
      const indicator = indicatorManager.getRejectionPatternIndicator();
      if (indicator && indicator.localPatterns && indicator.localPatterns.length > 0) {
        // Obtener el precio de la última vela
        const lastPattern = indicator.localPatterns[indicator.localPatterns.length - 1];
        return lastPattern.price || 50000;
      }
    }
    return 50000; // Fallback default
  };

  // 🎯 NUEVO: Quick Presets
  const applyPreset = (presetKey) => {
    const presets = getPresets();
    const preset = presets[presetKey];

    if (!preset) return;

    setConfig(prev => ({
      ...prev,
      patterns: preset.patterns,
      swingDetection: preset.swingDetection,
      filters: { ...prev.filters, minConfidence: preset.minConfidence }
    }));

    setActivePreset(presetKey);
  };

  // ✅ NUEVO: Simulación de patrones para testing
  const simulatePattern = async (patternType) => {
    if (!indicatorManager) {
      alert('❌ IndicatorManager not available');
      return;
    }

    const indicator = indicatorManager.getRejectionPatternIndicator();
    if (!indicator) {
      alert('❌ Rejection Pattern Indicator not found');
      return;
    }

    // Obtener precio actual
    const currentPrice = getCurrentPrice();

    // Crear un patrón simulado
    const simulatedPattern = {
      type: patternType,  // ✅ FIX: Usar 'type' en lugar de 'patternType'
      direction: patternType === 'HAMMER' || patternType === 'ENGULFING_BULLISH' ? 'LONG' : 'SHORT',  // ✅ FIX: Usar ENGULFING_BULLISH
      price: currentPrice,
      timestamp: Date.now(),
      confidence: 85.5,
      isSwingPoint: true,
      candle: {
        open: currentPrice,
        close: currentPrice,
        high: currentPrice * 1.01,
        low: currentPrice * 0.99,
        volume: 1000000,
        timestamp: Date.now()
      }
    };

    console.log(`[${symbol}] Simulating pattern:`, simulatedPattern);

    try {
      // Enviar alerta directamente
      await indicator.sendPatternAlert(simulatedPattern);

      // Mostrar popup
      indicator.showAlertPopup(simulatedPattern);

      alert(`✅ Simulated ${patternType} pattern alert sent!\nPrice: $${currentPrice.toFixed(2)}\nConfidence: 85.5%`);
    } catch (err) {
      console.error('Failed to simulate pattern:', err);
      alert(`❌ Failed to simulate pattern: ${err.message}`);
    }
  };

  // 🔧 NUEVO: Utilities
  const copyConfig = async () => {
    try {
      const configJson = JSON.stringify(config, null, 2);
      await navigator.clipboard.writeText(configJson);
      alert('✅ Configuration copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy config:', err);
      alert('❌ Failed to copy configuration');
    }
  };

  const pasteConfig = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      const migratedConfig = migrateConfig(parsed);
      setConfig(migratedConfig);
      setActivePreset('custom');
      alert('✅ Configuration pasted successfully!');
    } catch (err) {
      console.error('Failed to paste config:', err);
      alert('❌ Failed to paste configuration (invalid JSON)');
    }
  };

  const resetToDefaults = () => {
    if (window.confirm('Reset all settings to default values?')) {
      setConfig(getDefaultConfig());
      setActivePreset('custom');
    }
  };

  const exportConfig = () => {
    const configJson = JSON.stringify(config, null, 2);
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rejection-pattern-config-${symbol}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          const migratedConfig = migrateConfig(parsed);
          setConfig(migratedConfig);
          setActivePreset('custom');
          alert('✅ Configuration imported successfully!');
        } catch (err) {
          console.error('Failed to import config:', err);
          alert('❌ Failed to import configuration (invalid JSON)');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="rejection-pattern-settings">
      <div className="settings-header">
        <h3>⚙️ Rejection Pattern Settings - {symbol}</h3>
        <button className="close-button" onClick={onClose}>✕</button>
      </div>

      {/* ⚡ NUEVO: Utilities Bar */}
      <div className="utilities-bar">
        <button className="utility-button" onClick={copyConfig} title="Copy config to clipboard">
          📋 Copy
        </button>
        <button className="utility-button" onClick={pasteConfig} title="Paste config from clipboard">
          📝 Paste
        </button>
        <button className="utility-button" onClick={resetToDefaults} title="Reset to defaults">
          🔄 Reset
        </button>
        <button className="utility-button" onClick={exportConfig} title="Export config as JSON">
          💾 Export
        </button>
        <button className="utility-button" onClick={importConfig} title="Import config from JSON">
          📂 Import
        </button>
      </div>

      <div className="settings-content">
        {/* Visualization Mode Toggle */}
        <section className="settings-section" style={{ background: '#1a1a1a', padding: '15px', borderRadius: '4px', marginBottom: '15px' }}>
          <h4 style={{ marginBottom: '10px' }}>👁️ Visualization Mode</h4>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleShowModeChange('all')}
              style={{
                flex: 1,
                padding: '10px',
                background: showMode === 'all' ? '#4a9eff' : '#333',
                color: 'white',
                border: showMode === 'all' ? '2px solid #4a9eff' : '1px solid #555',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: showMode === 'all' ? 'bold' : 'normal'
              }}
            >
              📊 Show All Patterns
              <br />
              <small style={{ fontSize: '11px', opacity: 0.8 }}>Local detection (no context required)</small>
            </button>
            <button
              onClick={() => handleShowModeChange('validated')}
              style={{
                flex: 1,
                padding: '10px',
                background: showMode === 'validated' ? '#4CAF50' : '#333',
                color: 'white',
                border: showMode === 'validated' ? '2px solid #4CAF50' : '1px solid #555',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: showMode === 'validated' ? 'bold' : 'normal'
              }}
            >
              ✓ Validated Only
              <br />
              <small style={{ fontSize: '11px', opacity: 0.8 }}>Context-validated patterns</small>
            </button>
          </div>
          <p style={{ marginTop: '10px', fontSize: '12px', color: '#888' }}>
            {showMode === 'all'
              ? '💡 Showing ALL detected patterns in historical data. Use this to verify pattern detection quality.'
              : '🎯 Showing only patterns validated against your selected reference contexts (POC/VAH/VAL levels).'}
          </p>
        </section>

        {/* ⚡ NUEVO: Quick Presets */}
        <section className="settings-section">
          <h4>⚡ Quick Presets</h4>
          <p className="help-text">
            Apply pre-configured settings optimized for different timeframes and trading styles.
          </p>
          <div className="presets-section">
            <button
              className={`preset-button ${activePreset === 'scalping_1m' ? 'active' : ''}`}
              onClick={() => applyPreset('scalping_1m')}
            >
              ⚡ 1m Scalping
            </button>
            <button
              className={`preset-button ${activePreset === 'swing_15m' ? 'active' : ''}`}
              onClick={() => applyPreset('swing_15m')}
            >
              📈 15m Swing
            </button>
            <button
              className={`preset-button ${activePreset === 'position_4h' ? 'active' : ''}`}
              onClick={() => applyPreset('position_4h')}
            >
              📊 4h Position
            </button>
            <button
              className={`preset-button ${activePreset === 'test_mode' ? 'active' : ''}`}
              onClick={() => applyPreset('test_mode')}
              title="Relaxed parameters for testing - detects more patterns"
            >
              🧪 Test Mode
            </button>
            <button
              className={`preset-button ${activePreset === 'custom' ? 'active' : ''}`}
              style={{ marginLeft: 'auto' }}
            >
              🎨 Custom
            </button>
          </div>
        </section>

        {/* 🐛 NUEVO: Debug & Diagnostics */}
        <section className="settings-section">
          <h4>🐛 Debug & Diagnostics</h4>
          <p className="help-text">
            Enable debug mode to see why patterns are rejected in the browser console (F12 → Console).
          </p>

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.debugMode || false}
                onChange={(e) => {
                  setConfig(prev => ({ ...prev, debugMode: e.target.checked }));
                  setActivePreset('custom');
                }}
              />
              <span>🔧 Enable global debug mode (all patterns)</span>
            </label>
            <span className="filter-hint">
              Shows detailed rejection reasons in browser console
            </span>
          </div>

          {config.debugMode && (
            <div className="debug-info-box">
              <p>💡 Debug mode is active. Open browser console (F12 → Console) to see pattern rejection details.</p>
              <p style={{ fontSize: '11px', marginTop: '8px', color: '#888' }}>
                You'll see messages like: <code>[HAMMER REJECTED] wickRatio=1.2 (need ≥1.5)</code>
              </p>
            </div>
          )}
        </section>

        {/* ✅ NUEVO: Level Sources */}
        <section className="settings-section">
          <h4>📍 Level Sources</h4>
          <p className="help-text">
            Configure which sources provide important price levels for pattern detection.
          </p>

          <div className="level-sources-list">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.levelSources?.fixedRanges !== false}
                onChange={(e) => updateLevelSource('fixedRanges', e.target.checked)}
              />
              <span>📌 Fixed Range Profiles (POC/VAH/VAL)</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.levelSources?.clusters !== false}
                onChange={(e) => updateLevelSource('clusters', e.target.checked)}
              />
              <span>🎯 Volume Clusters</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.levelSources?.supportResistance !== false}
                onChange={(e) => updateLevelSource('supportResistance', e.target.checked)}
              />
              <span>📏 Support & Resistance</span>
              {config.levelSources?.supportResistance !== false && indicatorManager && getSRLevelCount() > 0 && (
                <span className="level-count-badge" title={`${getSRLevelCount()} active S/R levels available`}>
                  {getSRLevelCount()} levels
                </span>
              )}
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.levelSources?.rangeDetection !== false}
                onChange={(e) => updateLevelSource('rangeDetection', e.target.checked)}
              />
              <span>🔲 Range Detection</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.levelSources?.manualLevels !== false}
                onChange={(e) => updateLevelSource('manualLevels', e.target.checked)}
              />
              <span>✏️ Manual Horizontal Lines</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.levelSources?.manualPriceZones !== false}
                onChange={(e) => updateLevelSource('manualPriceZones', e.target.checked)}
              />
              <span>🎨 Manual Price Zones</span>
            </label>
          </div>
        </section>

        {/* ✅ NUEVO: Signal Direction Filter */}
        <section className="settings-section">
          <h4>📍 Signal Direction Filter (Global)</h4>
          <p className="help-text">
            Choose which direction of signals to show. This applies to all price levels unless overridden by individual zones.
          </p>

          <div className="direction-selector">
            <button
              className={`direction-btn long ${config.signalDirection?.global === 'LONG' ? 'active' : ''}`}
              onClick={() => updateSignalDirection('global', 'LONG')}
            >
              <span className="icon">📈</span>
              <span className="label">LONG Only</span>
              <small>Bullish patterns only</small>
            </button>

            <button
              className={`direction-btn both ${(!config.signalDirection?.global || config.signalDirection?.global === 'BOTH') ? 'active' : ''}`}
              onClick={() => updateSignalDirection('global', 'BOTH')}
            >
              <span className="icon">↕️</span>
              <span className="label">BOTH</span>
              <small>All patterns</small>
            </button>

            <button
              className={`direction-btn short ${config.signalDirection?.global === 'SHORT' ? 'active' : ''}`}
              onClick={() => updateSignalDirection('global', 'SHORT')}
            >
              <span className="icon">📉</span>
              <span className="label">SHORT Only</span>
              <small>Bearish patterns only</small>
            </button>
          </div>
        </section>

        {/* ✅ NUEVO: Manual Price Zones */}
        <section className="settings-section">
          <h4>🎨 Manual Price Zones</h4>
          <p className="help-text">
            Define custom price zones where you want to detect patterns. Each zone can override the global signal direction.
            {showMode === 'validated' && (
              <strong> 💡 Zones are used in "Validated Only" mode to filter patterns.</strong>
            )}
            {showMode === 'all' && (
              <span style={{ color: '#ff9800' }}> ⚠️ Zones are IGNORED in "Show All" mode.</span>
            )}
          </p>

          {(!config.manualPriceZones || config.manualPriceZones.length === 0) ? (
            <div className="no-zones-message">
              <p>📍 No manual price zones defined yet.</p>
              <p style={{ fontSize: '13px', color: '#888' }}>
                Create zones to mark important price areas for pattern detection.
              </p>
            </div>
          ) : (
            <div className="manual-zones-list">
              {config.manualPriceZones.map(zone => (
                <ManualZoneItem
                  key={zone.id}
                  zone={zone}
                  currentPrice={getCurrentPrice()}
                  globalDirection={config.signalDirection?.global || 'BOTH'}
                  onUpdate={(zoneId, updates) => updateZone(zoneId, updates)}
                  onDelete={(zoneId) => deleteZone(zoneId)}
                  onToggle={(zoneId, enabled) => toggleZone(zoneId, enabled)}
                />
              ))}
            </div>
          )}

          <button
            className="add-zone-button"
            onClick={() => setShowAddZoneModal(true)}
          >
            ➕ Add Price Zone
          </button>
        </section>

        {/* Section 1: Patterns to Detect */}
        <section className="settings-section">
          <h4>📊 Patterns to Detect</h4>
          <div className="patterns-list">
            <PatternToggle
              label="🔨 Hammer"
              description="Bullish pin bar with long lower wick"
              enabled={config.patterns.hammer.enabled}
              onToggle={() => togglePattern('hammer')}
              config={config.patterns.hammer}
              onConfigChange={(field, value) => updatePatternConfig('hammer', field, value)}
              patternType="hammer"
            />

            <PatternToggle
              label="⭐ Shooting Star"
              description="Bearish pin bar with long upper wick"
              enabled={config.patterns.shootingStar.enabled}
              onToggle={() => togglePattern('shootingStar')}
              config={config.patterns.shootingStar}
              onConfigChange={(field, value) => updatePatternConfig('shootingStar', field, value)}
              patternType="shootingStar"
            />

            <PatternToggle
              label="📦 Engulfing"
              description="One candle completely engulfs the previous"
              enabled={config.patterns.engulfing.enabled}
              onToggle={() => togglePattern('engulfing')}
              config={config.patterns.engulfing}
              onConfigChange={(field, value) => updatePatternConfig('engulfing', field, value)}
              patternType="engulfing"
            />

            <PatternToggle
              label="🎯 Doji"
              description="Small body with long wicks (Dragonfly/Gravestone)"
              enabled={config.patterns.doji.enabled}
              onToggle={() => togglePattern('doji')}
              config={config.patterns.doji}
              onConfigChange={(field, value) => updatePatternConfig('doji', field, value)}
              patternType="doji"
            />
          </div>
        </section>

        {/* 🎯 NUEVO: Swing Detection Settings */}
        <section className="settings-section">
          <h4>🎯 Swing Detection Settings</h4>
          <p className="help-text">
            Configure swing point detection to identify local highs and lows.
            Patterns at swing points are typically more reliable.
          </p>

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.swingDetection?.enabled || false}
                onChange={(e) => updateSwingDetection('enabled', e.target.checked)}
              />
              <span>Enable swing point detection</span>
            </label>
            <span className="filter-hint">
              Identifies local highs and lows in the price action
            </span>
          </div>

          {config.swingDetection?.enabled && (
            <>
              <div className="swing-visual-explanation">
                <pre style={{ fontSize: '10px', color: '#888', margin: '12px 0' }}>
{`  ${config.swingDetection.leftBars} bars ← [Pattern] → ${config.swingDetection.rightBars} bars
              ↓
      Must be local high/low`}
                </pre>
              </div>

              <div className="filter-item">
                <label>
                  Left Bars: {config.swingDetection?.leftBars || 5}
                  <input
                    type="range"
                    min="3"
                    max="20"
                    step="1"
                    value={config.swingDetection?.leftBars || 5}
                    onChange={(e) => updateSwingDetection('leftBars', parseInt(e.target.value))}
                    className="proximity-slider"
                  />
                </label>
                <span className="filter-hint">
                  Number of candles to the left to compare
                </span>
              </div>

              <div className="filter-item">
                <label>
                  Right Bars: {config.swingDetection?.rightBars || 5}
                  <input
                    type="range"
                    min="3"
                    max="20"
                    step="1"
                    value={config.swingDetection?.rightBars || 5}
                    onChange={(e) => updateSwingDetection('rightBars', parseInt(e.target.value))}
                    className="proximity-slider"
                  />
                </label>
                <span className="filter-hint">
                  Number of candles to the right to compare
                </span>
              </div>

              <div className="filter-item">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.swingDetection?.required || false}
                    onChange={(e) => updateSwingDetection('required', e.target.checked)}
                  />
                  <span>Only show patterns at swing points (more restrictive)</span>
                </label>
                <span className="filter-hint">
                  If enabled, patterns NOT at swing points will be hidden
                </span>
              </div>

              <div className="filter-item" style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,193,7,0.1)', borderRadius: '8px', border: '1px solid rgba(255,193,7,0.3)' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.swingDetection?.swingOnlyMode || false}
                    onChange={(e) => updateSwingDetection('swingOnlyMode', e.target.checked)}
                  />
                  <span style={{ fontWeight: 'bold', color: '#ffc107' }}>⚡ Swing Only Mode (ignore candle shape)</span>
                </label>
                <span className="filter-hint" style={{ display: 'block', marginTop: '8px' }}>
                  Detects ALL swing highs/lows without requiring specific candle patterns (Hammer, Shooting Star, etc.).
                  <br />
                  <strong>Use with:</strong> VWAP filter + Volume Z-Score + Manual Zones for best results.
                  <br />
                  <em>• Swing High → SHORT signal</em>
                  <br />
                  <em>• Swing Low → LONG signal</em>
                </span>
              </div>

              {/* ✅ NUEVO: Swing Arrow Style */}
              {config.swingDetection?.swingOnlyMode && (
                <div className="swing-arrow-style" style={{ marginTop: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #333' }}>
                  <h5 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#888' }}>
                    🎨 Swing Arrow Style
                  </h5>

                  <div className="filter-item">
                    <label>
                      Arrow Size: {config.swingArrowStyle?.size || 10}px
                      <input
                        type="range"
                        min="5"
                        max="20"
                        step="1"
                        value={config.swingArrowStyle?.size || 10}
                        onChange={(e) => {
                          setConfig(prev => ({
                            ...prev,
                            swingArrowStyle: {
                              ...prev.swingArrowStyle,
                              size: parseInt(e.target.value)
                            }
                          }));
                          setActivePreset('custom');
                        }}
                        className="proximity-slider"
                      />
                    </label>
                    <span className="filter-hint">
                      Size of the arrow triangles (5-20 pixels)
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
                    <div className="color-setting">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#00E676' }}>▲</span> LONG Color:
                        <input
                          type="color"
                          value={config.swingArrowStyle?.longColor || '#00E676'}
                          onChange={(e) => {
                            setConfig(prev => ({
                              ...prev,
                              swingArrowStyle: {
                                ...prev.swingArrowStyle,
                                longColor: e.target.value
                              }
                            }));
                            setActivePreset('custom');
                          }}
                          style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                        />
                      </label>
                    </div>

                    <div className="color-setting">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ color: '#FF1744' }}>▼</span> SHORT Color:
                        <input
                          type="color"
                          value={config.swingArrowStyle?.shortColor || '#FF1744'}
                          onChange={(e) => {
                            setConfig(prev => ({
                              ...prev,
                              swingArrowStyle: {
                                ...prev.swingArrowStyle,
                                shortColor: e.target.value
                              }
                            }));
                            setActivePreset('custom');
                          }}
                          style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                        />
                      </label>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button
                      className="utility-button"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                      onClick={() => {
                        setConfig(prev => ({
                          ...prev,
                          swingArrowStyle: {
                            size: 10,
                            longColor: '#00E676',
                            shortColor: '#FF1744',
                            offset: 8
                          }
                        }));
                        setActivePreset('custom');
                      }}
                    >
                      Reset to defaults
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* ✅ NUEVO: Section Strategy (Entry/SL/TP) */}
        <section className="settings-section">
          <h4
            className="section-header collapsible"
            onClick={() => setExpandedSections(prev => ({ ...prev, strategy: !prev.strategy }))}
          >
            📊 Strategy (Entry / SL / TP)
            <span className="toggle-icon">{expandedSections.strategy ? '▼' : '▶'}</span>
          </h4>

          {expandedSections.strategy && (
            <>
              <div className="filter-item" style={{ marginBottom: '16px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.strategy?.enabled || false}
                    onChange={(e) => {
                      setConfig(prev => ({
                        ...prev,
                        strategy: {
                          ...prev.strategy,
                          enabled: e.target.checked
                        }
                      }));
                      setActivePreset('custom');
                    }}
                  />
                  <span style={{ fontWeight: 'bold', color: '#03A9F4' }}>Enable Strategy Lines</span>
                </label>
                <span className="filter-hint">
                  Shows Entry, Stop Loss and Take Profit lines on detected patterns
                </span>
              </div>

              {config.strategy?.enabled && (
                <>
                  <div className="filter-item">
                    <label>
                      Risk:Reward Ratio: {config.strategy?.riskRewardRatio || 2.0}x
                      <input
                        type="range"
                        min="1"
                        max="5"
                        step="0.5"
                        value={config.strategy?.riskRewardRatio || 2.0}
                        onChange={(e) => {
                          setConfig(prev => ({
                            ...prev,
                            strategy: {
                              ...prev.strategy,
                              riskRewardRatio: parseFloat(e.target.value)
                            }
                          }));
                          setActivePreset('custom');
                        }}
                        className="proximity-slider"
                      />
                    </label>
                    <span className="filter-hint">
                      Take Profit = Stop Loss distance × this ratio
                    </span>
                  </div>

                  <div className="filter-item">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={config.strategy?.includeInAlert !== false}
                        onChange={(e) => {
                          setConfig(prev => ({
                            ...prev,
                            strategy: {
                              ...prev.strategy,
                              includeInAlert: e.target.checked
                            }
                          }));
                          setActivePreset('custom');
                        }}
                      />
                      Include Entry/SL/TP in alerts (port 5000)
                    </label>
                  </div>

                  <div style={{ marginTop: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #333' }}>
                    <h5 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#888' }}>
                      🎨 Line Colors
                    </h5>

                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                      <div className="color-setting">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          Entry:
                          <input
                            type="color"
                            value={config.strategy?.entryColor || '#03A9F4'}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                strategy: {
                                  ...prev.strategy,
                                  entryColor: e.target.value
                                }
                              }));
                              setActivePreset('custom');
                            }}
                            style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                          />
                        </label>
                      </div>

                      <div className="color-setting">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          Stop Loss:
                          <input
                            type="color"
                            value={config.strategy?.stopLossColor || '#FF1744'}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                strategy: {
                                  ...prev.strategy,
                                  stopLossColor: e.target.value
                                }
                              }));
                              setActivePreset('custom');
                            }}
                            style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                          />
                        </label>
                      </div>

                      <div className="color-setting">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          Take Profit:
                          <input
                            type="color"
                            value={config.strategy?.takeProfitColor || '#00E676'}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                strategy: {
                                  ...prev.strategy,
                                  takeProfitColor: e.target.value
                                }
                              }));
                              setActivePreset('custom');
                            }}
                            style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Box settings */}
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #444' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={config.strategy?.showBox !== false}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                strategy: {
                                  ...prev.strategy,
                                  showBox: e.target.checked
                                }
                              }));
                              setActivePreset('custom');
                            }}
                          />
                          Show connecting box
                        </label>

                        {config.strategy?.showBox !== false && (
                          <>
                            <div className="color-setting">
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#FF6B6B' }}>SL Box:</span>
                                <input
                                  type="color"
                                  value={config.strategy?.slBoxColor || '#FF1744'}
                                  onChange={(e) => {
                                    setConfig(prev => ({
                                      ...prev,
                                      strategy: {
                                        ...prev.strategy,
                                        slBoxColor: e.target.value
                                      }
                                    }));
                                    setActivePreset('custom');
                                  }}
                                  style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                                />
                              </label>
                            </div>

                            <div className="color-setting">
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: '#4CAF50' }}>TP Box:</span>
                                <input
                                  type="color"
                                  value={config.strategy?.tpBoxColor || '#00E676'}
                                  onChange={(e) => {
                                    setConfig(prev => ({
                                      ...prev,
                                      strategy: {
                                        ...prev.strategy,
                                        tpBoxColor: e.target.value
                                      }
                                    }));
                                    setActivePreset('custom');
                                  }}
                                  style={{ width: '40px', height: '25px', border: 'none', cursor: 'pointer' }}
                                />
                              </label>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '12px', color: '#888' }}>Opacity:</span>
                              <input
                                type="range"
                                min="0.05"
                                max="0.4"
                                step="0.05"
                                value={config.strategy?.boxOpacity || 0.15}
                                onChange={(e) => {
                                  setConfig(prev => ({
                                    ...prev,
                                    strategy: {
                                      ...prev.strategy,
                                      boxOpacity: parseFloat(e.target.value)
                                    }
                                  }));
                                  setActivePreset('custom');
                                }}
                                style={{ width: '80px' }}
                              />
                              <span style={{ fontSize: '11px', color: '#666' }}>{Math.round((config.strategy?.boxOpacity || 0.15) * 100)}%</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stop Loss Swing Detection Parameters */}
                  <div style={{ marginTop: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #333' }}>
                    <h5 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#888' }}>
                      🎯 Stop Loss - Swing Detection
                    </h5>
                    <span className="filter-hint" style={{ display: 'block', marginBottom: '12px' }}>
                      Parameters to find the previous swing high/low for Stop Loss placement
                    </span>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="filter-item">
                        <label>
                          Left Bars: {config.strategy?.slSwingLeftBars || 3}
                          <input
                            type="range"
                            min="1"
                            max="10"
                            step="1"
                            value={config.strategy?.slSwingLeftBars || 3}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                strategy: {
                                  ...prev.strategy,
                                  slSwingLeftBars: parseInt(e.target.value)
                                }
                              }));
                              setActivePreset('custom');
                            }}
                            className="proximity-slider"
                          />
                        </label>
                      </div>

                      <div className="filter-item">
                        <label>
                          Right Bars: {config.strategy?.slSwingRightBars || 3}
                          <input
                            type="range"
                            min="1"
                            max="10"
                            step="1"
                            value={config.strategy?.slSwingRightBars || 3}
                            onChange={(e) => {
                              setConfig(prev => ({
                                ...prev,
                                strategy: {
                                  ...prev.strategy,
                                  slSwingRightBars: parseInt(e.target.value)
                                }
                              }));
                              setActivePreset('custom');
                            }}
                            className="proximity-slider"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="filter-item" style={{ marginTop: '12px' }}>
                      <label>
                        Lookback Candles: {config.strategy?.slSwingLookback || 50}
                        <input
                          type="range"
                          min="10"
                          max="100"
                          step="5"
                          value={config.strategy?.slSwingLookback || 50}
                          onChange={(e) => {
                            setConfig(prev => ({
                              ...prev,
                              strategy: {
                                ...prev.strategy,
                                slSwingLookback: parseInt(e.target.value)
                              }
                            }));
                            setActivePreset('custom');
                          }}
                          className="proximity-slider"
                        />
                      </label>
                      <span className="filter-hint">
                        How far back to search for a swing point
                      </span>
                    </div>

                    <div className="filter-item" style={{ marginTop: '16px', padding: '10px', background: '#2a1a1a', borderRadius: '6px', border: '1px solid #443' }}>
                      <label>
                        <span style={{ color: '#FF9800' }}>⚠️ Fallback Buffer: {config.strategy?.slBufferPercent || 20}%</span>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          step="5"
                          value={config.strategy?.slBufferPercent || 20}
                          onChange={(e) => {
                            setConfig(prev => ({
                              ...prev,
                              strategy: {
                                ...prev.strategy,
                                slBufferPercent: parseInt(e.target.value)
                              }
                            }));
                            setActivePreset('custom');
                          }}
                          className="proximity-slider"
                        />
                      </label>
                      <span className="filter-hint">
                        When no swing is found, SL = pattern low/high + this % extra safety margin
                      </span>
                    </div>
                  </div>

                  {/* Minimum SL % */}
                  <div style={{ marginTop: '16px', padding: '12px', background: '#1a2a1a', borderRadius: '8px', border: '1px solid #343' }}>
                    <div className="filter-item">
                      <label>
                        <span style={{ color: '#4CAF50' }}>🔒 Minimum SL: {config.strategy?.slMinPercent || 0.5}%</span>
                        <input
                          type="range"
                          min="0.1"
                          max="2"
                          step="0.1"
                          value={config.strategy?.slMinPercent || 0.5}
                          onChange={(e) => {
                            setConfig(prev => ({
                              ...prev,
                              strategy: {
                                ...prev.strategy,
                                slMinPercent: parseFloat(e.target.value)
                              }
                            }));
                            setActivePreset('custom');
                          }}
                          className="proximity-slider"
                        />
                      </label>
                      <span className="filter-hint">
                        If calculated SL is smaller than this %, force it to this minimum (for exchange viability)
                      </span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {/* Section 2: Reference Contexts */}
        <section className="settings-section">
          <h4>🎯 Reference Contexts for Validation</h4>
          <p className="help-text">
            Select which Volume Profiles or Ranges to use for pattern validation.
            Only patterns near levels from active contexts will generate alerts.
          </p>

          {(config.referenceContexts || []).length === 0 ? (
            <div className="no-contexts">
              <p>⚠️ No reference contexts configured.</p>
              <p>Add Volume Profiles or Range Detector levels to validate patterns.</p>
            </div>
          ) : (
            <div className="contexts-list">
              {config.referenceContexts.map(context => (
                <ContextItem
                  key={context.id}
                  context={context}
                  enabled={isContextEnabled(context.id)}
                  weight={getContextWeight(context.id)}
                  onToggle={() => toggleContext(context.id)}
                  onWeightChange={(weight) => updateContextWeight(context.id, weight)}
                  onRemove={() => removeContext(context.id)}
                />
              ))}
            </div>
          )}

          <button
            className="add-context-button"
            onClick={() => setShowContextModal(true)}
          >
            ➕ Add Reference Context
          </button>
        </section>

        {/* Section 3: Filters */}
        <section className="settings-section">
          <h4>🔍 Filters & Confidence</h4>

          <div className="filter-item">
            <label>
              Minimum Confidence: {config.filters.minConfidence}%
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={config.filters.minConfidence}
                onChange={(e) => updateFilter('minConfidence', parseInt(e.target.value))}
                className="confidence-slider"
              />
            </label>
            <span className="filter-hint">
              Lower = more patterns, Higher = fewer but more reliable
            </span>
          </div>

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.filters.requireNearLevel}
                onChange={(e) => updateFilter('requireNearLevel', e.target.checked)}
              />
              <span>
                Only alert near key levels ({config.filters.proximityPercent}% tolerance)
              </span>
            </label>
          </div>

          <div className="filter-item">
            <label>
              Proximity Tolerance: {config.filters.proximityPercent}%
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={config.filters.proximityPercent}
                onChange={(e) => updateFilter('proximityPercent', parseFloat(e.target.value))}
                className="proximity-slider"
              />
            </label>
            <span className="filter-hint">
              How close to a level qualifies as "near"
            </span>
          </div>

        </section>

        {/* Section 3.5: Volume Z-Score Filter */}
        <section className="settings-section">
          <h4>📊 Volume Z-Score Filter (Advanced)</h4>
          <p className="help-text">
            Filters patterns based on statistical volume significance (Z-score).
            Evaluates volume around the swing point, not just the exact candle.
          </p>

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.volumeZScore?.enabled || false}
                onChange={(e) => {
                  setConfig(prev => ({
                    ...prev,
                    volumeZScore: {
                      ...prev.volumeZScore,
                      enabled: e.target.checked
                    }
                  }));
                }}
              />
              <span>Enable Volume Z-Score Filter</span>
            </label>
            <span className="filter-hint">
              Only show patterns with statistically significant volume
            </span>
          </div>

          {config.volumeZScore?.enabled && (
            <>
              <div className="filter-item">
                <label>
                  Lookback Period: {config.volumeZScore?.lookbackPeriod || 20} candles
                  <input
                    type="range"
                    min="10"
                    max="50"
                    step="5"
                    value={config.volumeZScore?.lookbackPeriod || 20}
                    onChange={(e) => {
                      setConfig(prev => ({
                        ...prev,
                        volumeZScore: {
                          ...prev.volumeZScore,
                          lookbackPeriod: parseInt(e.target.value)
                        }
                      }));
                    }}
                    className="proximity-slider"
                  />
                </label>
                <span className="filter-hint">
                  Number of previous candles to calculate average volume
                </span>
              </div>

              <div className="filter-item">
                <label>
                  Minimum Z-Score: {(config.volumeZScore?.minZScore || 1.0).toFixed(1)} σ
                  <input
                    type="range"
                    min="0.5"
                    max="3.0"
                    step="0.1"
                    value={config.volumeZScore?.minZScore || 1.0}
                    onChange={(e) => {
                      setConfig(prev => ({
                        ...prev,
                        volumeZScore: {
                          ...prev.volumeZScore,
                          minZScore: parseFloat(e.target.value)
                        }
                      }));
                    }}
                    className="proximity-slider"
                  />
                </label>
                <span className="filter-hint">
                  1.0σ = 84th percentile, 1.5σ = 93rd, 2.0σ = 97.5th, 3.0σ = 99.85th
                </span>
              </div>

              <div className="filter-item">
                <label>
                  Candles around swing: {config.volumeZScore?.swingCandleRange || 1}
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={config.volumeZScore?.swingCandleRange || 1}
                    onChange={(e) => {
                      setConfig(prev => ({
                        ...prev,
                        volumeZScore: {
                          ...prev.volumeZScore,
                          swingCandleRange: parseInt(e.target.value)
                        }
                      }));
                    }}
                    className="proximity-slider"
                  />
                </label>
                <span className="filter-hint">
                  {config.volumeZScore?.swingCandleRange === 1
                    ? 'Only evaluates the exact swing candle'
                    : `Evaluates max Z-score within ±${config.volumeZScore?.swingCandleRange || 1} candles of the swing`}
                </span>
              </div>
            </>
          )}
        </section>

        {/* ✅ NUEVO: VWAP Deviation Filter */}
        <section className="settings-section">
          <h4>📈 VWAP Deviation Filter</h4>
          <p className="help-text">
            Filter patterns based on VWAP standard deviations. When enabled, only patterns near the configured deviations will trigger alerts.
            <br />
            <strong>LONG patterns</strong> → must be near -2σ or -3σ (below VWAP)
            <br />
            <strong>SHORT patterns</strong> → must be near +2σ or +3σ (above VWAP)
          </p>

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.vwapFilter?.enabled || false}
                onChange={(e) => {
                  setConfig(prev => ({
                    ...prev,
                    vwapFilter: {
                      ...prev.vwapFilter,
                      enabled: e.target.checked
                    }
                  }));
                  setActivePreset('custom');
                }}
              />
              <span>Enable VWAP Deviation Filter (Pass/Fail)</span>
            </label>
            <span className="filter-hint">
              ⚠️ Requires VWAP indicator to be active on the chart
            </span>
          </div>

          {config.vwapFilter?.enabled && (
            <>
              {/* Timeframe presets info */}
              <div className="vwap-presets-info" style={{
                background: '#1a2a1a',
                padding: '10px',
                borderRadius: '4px',
                marginBottom: '10px',
                fontSize: '12px'
              }}>
                <strong>📊 Timeframe Defaults:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px', color: '#aaa' }}>
                  <span>1m: 0.1%</span>
                  <span>5m: 0.2%</span>
                  <span>15m: 0.3%</span>
                  <span>1h: 0.8%</span>
                  <span>4h: 1.5%</span>
                  <span>1D: 2.5%</span>
                </div>
              </div>

              <div className="filter-item">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <label className="checkbox-label" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={config.vwapFilter?.deviationTolerance === 0 || config.vwapFilter?.deviationTolerance === 'auto'}
                      onChange={(e) => {
                        setConfig(prev => ({
                          ...prev,
                          vwapFilter: {
                            ...prev.vwapFilter,
                            deviationTolerance: e.target.checked ? 0 : 10
                          }
                        }));
                        setActivePreset('custom');
                      }}
                    />
                    <span>Use Auto (timeframe default)</span>
                  </label>
                </div>

                {config.vwapFilter?.deviationTolerance !== 0 && config.vwapFilter?.deviationTolerance !== 'auto' && (
                  <label>
                    Custom Tolerance: {config.vwapFilter?.deviationTolerance || 10}% of σ
                    <input
                      type="range"
                      min="1"
                      max="80"
                      step="1"
                      value={config.vwapFilter?.deviationTolerance || 10}
                      onChange={(e) => {
                        setConfig(prev => ({
                          ...prev,
                          vwapFilter: {
                            ...prev.vwapFilter,
                            deviationTolerance: parseFloat(e.target.value)
                          }
                        }));
                        setActivePreset('custom');
                      }}
                      className="proximity-slider"
                    />
                  </label>
                )}
                <span className="filter-hint">
                  {config.vwapFilter?.deviationTolerance === 0 || config.vwapFilter?.deviationTolerance === 'auto'
                    ? '✅ Using automatic tolerance based on current timeframe'
                    : 'Margin as % of σ (standard deviation). E.g. 10% of σ=$100 → margin of $10'}
                </span>
              </div>

              <div className="vwap-deviations-config">
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  Required Deviations:
                </label>

                <div className="filter-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={config.vwapFilter?.requiredDeviations?.second !== false}
                      onChange={(e) => {
                        setConfig(prev => ({
                          ...prev,
                          vwapFilter: {
                            ...prev.vwapFilter,
                            requiredDeviations: {
                              ...prev.vwapFilter?.requiredDeviations,
                              second: e.target.checked
                            }
                          }
                        }));
                        setActivePreset('custom');
                      }}
                    />
                    <span>±2σ (Second Deviation)</span>
                  </label>
                  <span className="filter-hint">
                    LONG: -2σ | SHORT: +2σ
                  </span>
                </div>

                <div className="filter-item">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={config.vwapFilter?.requiredDeviations?.third || false}
                      onChange={(e) => {
                        setConfig(prev => ({
                          ...prev,
                          vwapFilter: {
                            ...prev.vwapFilter,
                            requiredDeviations: {
                              ...prev.vwapFilter?.requiredDeviations,
                              third: e.target.checked
                            }
                          }
                        }));
                        setActivePreset('custom');
                      }}
                    />
                    <span>±3σ (Third Deviation)</span>
                  </label>
                  <span className="filter-hint">
                    LONG: -3σ | SHORT: +3σ (more extreme)
                  </span>
                </div>
              </div>

              <div className="debug-info-box" style={{ marginTop: '10px' }}>
                <p>💡 <strong>How it works:</strong></p>
                <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '12px', color: '#aaa' }}>
                  <li>Pattern is detected normally</li>
                  <li>Before sending alert, checks if price is near VWAP deviation</li>
                  <li>If NOT near → pattern is REJECTED (no alert)</li>
                  <li>If near → pattern PASSES → alert sent to port 5000</li>
                </ul>
              </div>
            </>
          )}
        </section>

        {/* Section 4: Alerts */}
        <section className="settings-section">
          <h4>🔔 Alert Settings</h4>

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.alertsEnabled}
                onChange={(e) => setConfig(prev => ({ ...prev, alertsEnabled: e.target.checked }))}
              />
              <span>Enable alerts to port 5000</span>
            </label>
            <span className="filter-hint">
              Sends notifications to external alert listener service
            </span>
          </div>

          {/* ✅ NUEVO: Simulación de Patrones */}
          {config.alertsEnabled && (
            <div className="alert-test-section">
              <h5 style={{ marginTop: '15px', marginBottom: '10px', fontSize: '14px', color: '#888' }}>
                🧪 Pattern Simulation (Testing)
              </h5>
              <p className="help-text" style={{ marginBottom: '10px', fontSize: '12px' }}>
                Test the alert system without waiting for real market patterns. Simulates pattern detection and sends alerts.
              </p>
              <div className="simulation-buttons">
                <button
                  className="test-pattern-button test-hammer"
                  onClick={() => simulatePattern('HAMMER')}
                  title="Simulate Hammer pattern detection"
                >
                  🔨 Test Hammer (LONG)
                </button>
                <button
                  className="test-pattern-button test-shooting-star"
                  onClick={() => simulatePattern('SHOOTING_STAR')}
                  title="Simulate Shooting Star pattern detection"
                >
                  ⭐ Test Shooting Star (SHORT)
                </button>
                <button
                  className="test-pattern-button test-engulfing-bullish"
                  onClick={() => simulatePattern('ENGULFING_BULLISH')}
                  title="Simulate Bullish Engulfing pattern"
                >
                  📈 Test Bullish Engulfing
                </button>
                <button
                  className="test-pattern-button test-engulfing-bearish"
                  onClick={() => simulatePattern('ENGULFING_BEARISH')}
                  title="Simulate Bearish Engulfing pattern"
                >
                  📉 Test Bearish Engulfing
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Summary */}
        <section className="settings-section summary">
          <h4>📋 Configuration Summary</h4>
          <div className="config-summary">
            <p>✅ {getEnabledPatternsCount()} pattern types active</p>
            <p>✅ {getEnabledContextsCount()} reference contexts active</p>
            {config.swingDetection?.enabled && (
              <p>✅ Swing detection: {config.swingDetection.leftBars}L / {config.swingDetection.rightBars}R {config.swingDetection.required ? '(required)' : ''}</p>
            )}
            {config.debugMode && (
              <p className="info">
                🐛 Debug mode active - check console
              </p>
            )}
            {getEnabledContextsCount() === 0 && (
              <p className="warning">
                ⚠️ No contexts active - may generate false positives!
              </p>
            )}
            {config.alertsEnabled && (
              <p className="info">
                🔔 Alerts enabled → localhost:5000
              </p>
            )}
            {config.vwapFilter?.enabled && (
              <p className="info">
                📈 VWAP Filter: {config.vwapFilter.requiredDeviations?.second ? '±2σ' : ''}{config.vwapFilter.requiredDeviations?.second && config.vwapFilter.requiredDeviations?.third ? ', ' : ''}{config.vwapFilter.requiredDeviations?.third ? '±3σ' : ''} (tolerance: {config.vwapFilter.deviationTolerance === 0 ? 'auto' : `${config.vwapFilter.deviationTolerance}% of σ`})
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Context Modal */}
      {showContextModal && (
        <AddContextModal
          symbol={symbol}
          availableContexts={availableContexts}
          onAdd={addContext}
          onClose={() => setShowContextModal(false)}
        />
      )}

      {/* ✅ NUEVO: Add Price Zone Modal */}
      {showAddZoneModal && (
        <AddPriceZoneModal
          symbol={symbol}
          currentPrice={getCurrentPrice()}
          onAdd={addZone}
          onClose={() => setShowAddZoneModal(false)}
        />
      )}
    </div>
  );
};

// ========================================
// Sub-component: ParameterSlider
// ========================================
const ParameterSlider = ({ label, value, min, max, step, unit, onChange, defaultValue, tooltip }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Determine warning level based on how far from default
  const getWarningLevel = () => {
    if (!defaultValue) return null;
    const range = max - min;
    const deviation = Math.abs(value - defaultValue) / range;

    if (deviation < 0.2) return null; // Close to default
    if (deviation < 0.4) return 'permissive';
    return 'restrictive';
  };

  const warningLevel = getWarningLevel();
  const warningMessages = {
    permissive: '⚠️ More permissive - may detect more patterns',
    restrictive: '⚠️ More restrictive - may miss some patterns'
  };

  return (
    <div className="parameter-slider">
      <div className="parameter-label">
        <span>
          {label}
          {tooltip && (
            <span
              className="tooltip-icon"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              ℹ️
            </span>
          )}
        </span>
        <span className="parameter-value">
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="parameter-range"
      />
      {warningLevel && (
        <div className={`parameter-warning ${warningLevel}`}>
          {warningMessages[warningLevel]}
        </div>
      )}
      {showTooltip && tooltip && (
        <div className="parameter-tooltip">
          {tooltip}
        </div>
      )}
    </div>
  );
};

// ========================================
// Sub-component: PatternParameterGroup
// ========================================
const PatternParameterGroup = ({ title, children }) => {
  return (
    <div className="parameter-group">
      <div className="parameter-group-title">{title}</div>
      {children}
    </div>
  );
};

// ========================================
// Sub-component: PatternToggle (MEJORADO)
// ========================================
const PatternToggle = ({ label, description, enabled, onToggle, config, onConfigChange, patternType }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const renderHammerParams = () => (
    <>
      <PatternParameterGroup title="📏 Wick Requirements">
        <ParameterSlider
          label="Min Wick Ratio"
          value={config.minWickRatio || 1.5}
          min={1.0}
          max={5.0}
          step={0.1}
          unit="x"
          onChange={(v) => onConfigChange('minWickRatio', v)}
          defaultValue={1.5}
          tooltip="Lower wick must be X times longer than body"
        />
        <ParameterSlider
          label="Max Upper Wick"
          value={config.maxUpperWickRatio || 0.3}
          min={0.0}
          max={1.0}
          step={0.05}
          unit="x"
          onChange={(v) => onConfigChange('maxUpperWickRatio', v)}
          defaultValue={0.3}
          tooltip="Upper wick should be small (max X times body)"
        />
      </PatternParameterGroup>

      <PatternParameterGroup title="📍 Body Position">
        <ParameterSlider
          label="Min Body Position"
          value={config.minBodyPosition || 0.5}
          min={0.0}
          max={1.0}
          step={0.05}
          unit=""
          onChange={(v) => onConfigChange('minBodyPosition', v)}
          defaultValue={0.5}
          tooltip="Body must be in upper X% of candle range (0=bottom, 1=top)"
        />
      </PatternParameterGroup>

      <div className="debug-checkbox">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.debug || false}
            onChange={(e) => onConfigChange('debug', e.target.checked)}
          />
          <span>🐛 Debug this pattern</span>
        </label>
      </div>
    </>
  );

  const renderShootingStarParams = () => (
    <>
      <PatternParameterGroup title="📏 Wick Requirements">
        <ParameterSlider
          label="Min Wick Ratio"
          value={config.minWickRatio || 1.5}
          min={1.0}
          max={5.0}
          step={0.1}
          unit="x"
          onChange={(v) => onConfigChange('minWickRatio', v)}
          defaultValue={1.5}
          tooltip="Upper wick must be X times longer than body"
        />
        <ParameterSlider
          label="Max Lower Wick"
          value={config.maxLowerWickRatio || 0.3}
          min={0.0}
          max={1.0}
          step={0.05}
          unit="x"
          onChange={(v) => onConfigChange('maxLowerWickRatio', v)}
          defaultValue={0.3}
          tooltip="Lower wick should be small (max X times body)"
        />
      </PatternParameterGroup>

      <PatternParameterGroup title="📍 Body Position">
        <ParameterSlider
          label="Min Body Position"
          value={config.minBodyPosition || 0.5}
          min={0.0}
          max={1.0}
          step={0.05}
          unit=""
          onChange={(v) => onConfigChange('minBodyPosition', v)}
          defaultValue={0.5}
          tooltip="Body must be in lower X% of candle range (from top)"
        />
      </PatternParameterGroup>

      <div className="debug-checkbox">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.debug || false}
            onChange={(e) => onConfigChange('debug', e.target.checked)}
          />
          <span>🐛 Debug this pattern</span>
        </label>
      </div>
    </>
  );

  const renderDojiParams = () => (
    <>
      <PatternParameterGroup title="📏 Body & Wick Requirements">
        <ParameterSlider
          label="Max Body Ratio"
          value={config.maxBodyRatio || 0.08}
          min={0.01}
          max={0.20}
          step={0.01}
          unit=""
          onChange={(v) => onConfigChange('maxBodyRatio', v)}
          defaultValue={0.08}
          tooltip="Body must be smaller than X% of total candle range"
        />
        <ParameterSlider
          label="Min Long Wick"
          value={config.minLongWick || 0.5}
          min={0.3}
          max={0.8}
          step={0.05}
          unit=""
          onChange={(v) => onConfigChange('minLongWick', v)}
          defaultValue={0.5}
          tooltip="Long wick must be at least X% of total range"
        />
        <ParameterSlider
          label="Max Short Wick"
          value={config.maxShortWick || 0.15}
          min={0.0}
          max={0.30}
          step={0.05}
          unit=""
          onChange={(v) => onConfigChange('maxShortWick', v)}
          defaultValue={0.15}
          tooltip="Short wick must be less than X% of total range"
        />
      </PatternParameterGroup>

      <div className="debug-checkbox">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={config.debug || false}
            onChange={(e) => onConfigChange('debug', e.target.checked)}
          />
          <span>🐛 Debug this pattern</span>
        </label>
      </div>
    </>
  );

  const hasParams = patternType === 'hammer' || patternType === 'shootingStar' || patternType === 'doji';

  return (
    <div className={`pattern-item ${enabled ? 'enabled' : 'disabled'}`}>
      <div className="pattern-header">
        <label className="pattern-label">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="pattern-name">{label}</span>
        </label>
        {enabled && hasParams && (
          <button
            className="advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼' : '▶'} Advanced
          </button>
        )}
      </div>
      <p className="pattern-description">{description}</p>

      {enabled && showAdvanced && (
        <div className="pattern-advanced">
          {patternType === 'hammer' && renderHammerParams()}
          {patternType === 'shootingStar' && renderShootingStarParams()}
          {patternType === 'doji' && renderDojiParams()}
        </div>
      )}
    </div>
  );
};

// Sub-component: ContextItem
const ContextItem = ({ context, enabled, weight, onToggle, onWeightChange, onRemove }) => {
  const getContextIcon = (type) => {
    if (type.includes('VOLUME_PROFILE')) return '📊';
    if (type === 'RANGE_DETECTOR') return '📏';
    return '🎯';
  };

  return (
    <div className={`context-item ${enabled ? 'enabled' : 'disabled'}`}>
      <div className="context-header">
        <label>
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="context-icon">{getContextIcon(context.type)}</span>
          <span className="context-label">
            <strong>{context.label || context.id}</strong>
            {context.description && <small>{context.description}</small>}
          </span>
        </label>
        <button className="remove-context" onClick={onRemove} title="Remove context">
          🗑️
        </button>
      </div>

      {enabled && (
        <div className="context-details">
          <label className="weight-label">
            Confidence Weight: {weight}%
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={weight}
              onChange={(e) => onWeightChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
};

// Sub-component: AddContextModal
const AddContextModal = ({ symbol, availableContexts, onAdd, onClose }) => {
  const [selectedContextId, setSelectedContextId] = useState(null);

  const handleAdd = () => {
    if (!selectedContextId) {
      alert('Por favor selecciona un contexto');
      return;
    }

    const context = availableContexts.find(c => c.id === selectedContextId);
    if (!context) {
      alert('Contexto no encontrado');
      return;
    }

    onAdd({
      ...context,
      enabled: true,
      weight: 0.5
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Agregar Contexto de Referencia</h3>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {availableContexts.length === 0 ? (
            <div className="no-contexts-available">
              <p style={{ color: '#ff9800', padding: '20px', textAlign: 'center' }}>
                ⚠️ No hay contextos disponibles para {symbol}
              </p>
              <p style={{ color: '#888', fontSize: '13px', textAlign: 'center' }}>
                Primero crea un Volume Profile Fixed o activa el Range Detector en el chart.
              </p>
            </div>
          ) : (
            <>
              <p className="help-text">
                Selecciona un contexto de referencia para validar los patrones detectados.
                Solo se generarán alertas para patrones cerca de niveles de estos contextos.
              </p>

              <div className="form-group">
                <label>Contextos Disponibles:</label>
                <div className="available-contexts-list">
                  {availableContexts.map(context => (
                    <label
                      key={context.id}
                      className={`context-option ${selectedContextId === context.id ? 'selected' : ''}`}
                      style={{
                        display: 'block',
                        padding: '12px',
                        margin: '8px 0',
                        background: selectedContextId === context.id ? 'rgba(74, 158, 255, 0.1)' : '#1e1e1e',
                        border: selectedContextId === context.id ? '2px solid #4a9eff' : '1px solid #333',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <input
                        type="radio"
                        name="context"
                        value={context.id}
                        checked={selectedContextId === context.id}
                        onChange={() => setSelectedContextId(context.id)}
                        style={{ marginRight: '8px' }}
                      />
                      <span style={{ fontWeight: '500', color: '#fff' }}>
                        {context.label}
                      </span>
                      <br />
                      <small style={{ color: '#888', marginLeft: '24px' }}>
                        {context.description}
                      </small>
                      {context.metadata && context.metadata.hasCalculatedValues ? (
                        <div style={{ marginLeft: '24px', marginTop: '4px', fontSize: '12px', color: '#4a9eff' }}>
                          POC: ${context.metadata.poc.toFixed(2)} |
                          VAH: ${context.metadata.vah.toFixed(2)} |
                          VAL: ${context.metadata.val.toFixed(2)}
                        </div>
                      ) : (
                        <div style={{ marginLeft: '24px', marginTop: '4px', fontSize: '11px', color: '#ff9800' }}>
                          ⚠️ Valores no calculados aún (el perfil se calculará cuando se muestren velas en este rango)
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <p className="info-text">
                💡 Los patrones detectados cerca de los niveles POC, VAH y VAL de este contexto
                tendrán mayor confianza.
              </p>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">Cancelar</button>
          <button
            onClick={handleAdd}
            className="add-button"
            disabled={!selectedContextId}
            style={{
              opacity: selectedContextId ? 1 : 0.5,
              cursor: selectedContextId ? 'pointer' : 'not-allowed'
            }}
          >
            Agregar Contexto
          </button>
        </div>
      </div>
    </div>
  );
};

// ✅ NUEVO: ManualZoneItem Component
const ManualZoneItem = ({ zone, currentPrice, globalDirection, onUpdate, onDelete, onToggle }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const zoneRange = zone.maxPrice - zone.minPrice;
  const zoneWidth = ((zoneRange / currentPrice) * 100).toFixed(2);

  return (
    <div className={`zone-item ${zone.enabled ? 'enabled' : 'disabled'}`}>
      <div className="zone-header">
        <label>
          <input
            type="checkbox"
            checked={zone.enabled}
            onChange={(e) => onToggle(zone.id, e.target.checked)}
          />
          <div
            className="zone-color-indicator"
            style={{ backgroundColor: zone.color }}
          />
          <div className="zone-info">
            <span className="zone-name">{zone.name}</span>
            <small className="zone-range">
              ${zone.minPrice.toFixed(2)} - ${zone.maxPrice.toFixed(2)} ({zoneWidth}% range)
            </small>
          </div>
        </label>

        <div className="zone-actions">
          <button
            className="expand-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
          <button
            className="delete-btn"
            onClick={() => onDelete(zone.id)}
            title="Delete zone"
          >
            🗑️
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="zone-details">
          {/* Direction override */}
          <div className="zone-direction">
            <label>Signal Direction Override:</label>
            <select
              value={zone.signalDirection || ''}
              onChange={(e) => onUpdate(zone.id, {
                signalDirection: e.target.value || null
              })}
            >
              <option value="">Use Global ({globalDirection})</option>
              <option value="LONG">📈 LONG Only</option>
              <option value="SHORT">📉 SHORT Only</option>
              <option value="BOTH">↕️ BOTH</option>
            </select>
          </div>

          {/* Edit prices */}
          <div className="zone-prices">
            <div className="price-input">
              <label>Min Price:</label>
              <input
                type="number"
                value={zone.minPrice}
                onChange={(e) => onUpdate(zone.id, {
                  minPrice: parseFloat(e.target.value)
                })}
                step="0.01"
              />
            </div>
            <div className="price-input">
              <label>Max Price:</label>
              <input
                type="number"
                value={zone.maxPrice}
                onChange={(e) => onUpdate(zone.id, {
                  maxPrice: parseFloat(e.target.value)
                })}
                step="0.01"
              />
            </div>
          </div>

          {/* Edit color */}
          <div className="zone-color">
            <label>Zone Color:</label>
            <input
              type="color"
              value={zone.color}
              onChange={(e) => onUpdate(zone.id, { color: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ✅ NUEVO: AddPriceZoneModal Component
const AddPriceZoneModal = ({ symbol, currentPrice, onAdd, onClose }) => {
  const [zoneName, setZoneName] = useState('');
  const [minPrice, setMinPrice] = useState((currentPrice * 0.98).toFixed(2));
  const [maxPrice, setMaxPrice] = useState((currentPrice * 1.02).toFixed(2));
  const [signalDirection, setSignalDirection] = useState('BOTH');  // ✅ FIX: Default to 'BOTH' instead of null
  const [color, setColor] = useState('#FF5722');
  const [errors, setErrors] = useState({});

  const validate = () => {
    const newErrors = {};

    if (!zoneName.trim()) {
      newErrors.name = 'Zone name is required';
    }

    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);

    if (isNaN(min) || min <= 0) {
      newErrors.minPrice = 'Invalid min price';
    }

    if (isNaN(max) || max <= 0) {
      newErrors.maxPrice = 'Invalid max price';
    }

    if (min >= max) {
      newErrors.range = 'Min price must be less than max price';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAdd = () => {
    if (!validate()) return;

    onAdd({
      id: `zone_${Date.now()}`,
      name: zoneName.trim(),
      minPrice: parseFloat(minPrice),
      maxPrice: parseFloat(maxPrice),
      enabled: true,
      signalDirection: signalDirection,
      color: color,
      strength: 8
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content zone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🎨 Add Manual Price Zone - {symbol}</h3>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p className="help-text">
            Define a custom price zone for pattern detection. Current price: <strong>${currentPrice.toFixed(2)}</strong>
          </p>

          <div className="form-group">
            <label>Zone Name *</label>
            <input
              type="text"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="e.g., Strong Resistance Zone"
              className={errors.name ? 'error' : ''}
            />
            {errors.name && <span className="error-message">{errors.name}</span>}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Min Price ($) *</label>
              <input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                step="0.01"
                className={errors.minPrice ? 'error' : ''}
              />
              {errors.minPrice && <span className="error-message">{errors.minPrice}</span>}
            </div>

            <div className="form-group">
              <label>Max Price ($) *</label>
              <input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                step="0.01"
                className={errors.maxPrice ? 'error' : ''}
              />
              {errors.maxPrice && <span className="error-message">{errors.maxPrice}</span>}
            </div>
          </div>

          {errors.range && (
            <div className="error-message-block">{errors.range}</div>
          )}

          <div className="zone-preview">
            <div className="preview-label">Zone Preview:</div>
            <div className="preview-bar">
              <div
                className="preview-zone"
                style={{
                  backgroundColor: color,
                  opacity: 0.3,
                  height: '40px',
                  borderRadius: '4px',
                  border: `2px solid ${color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 'bold'
                }}
              >
                ${minPrice} - ${maxPrice}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Signal Direction (Optional)</label>
            <select
              value={signalDirection || ''}
              onChange={(e) => setSignalDirection(e.target.value || null)}
            >
              <option value="">Use Global Setting</option>
              <option value="LONG">📈 LONG Only (Bullish patterns)</option>
              <option value="SHORT">📉 SHORT Only (Bearish patterns)</option>
              <option value="BOTH">↕️ BOTH (All patterns)</option>
            </select>
            <small className="help-text">
              If not set, the global signal direction filter will apply to this zone.
            </small>
          </div>

          <div className="form-group">
            <label>Zone Color</label>
            <div className="color-picker-row">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#FF5722"
                maxLength="7"
                className="color-hex-input"
              />
              <div className="color-presets">
                {['#FF5722', '#F44336', '#E91E63', '#9C27B0', '#3F51B5', '#2196F3'].map(c => (
                  <button
                    key={c}
                    className="color-preset"
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">
            Cancel
          </button>
          <button
            onClick={handleAdd}
            className="add-button"
          >
            ✅ Add Zone
          </button>
        </div>
      </div>
    </div>
  );
};

// ========================================
// Presets Configuration
// ========================================
function getPresets() {
  return {
    test_mode: {
      patterns: {
        hammer: {
          enabled: true,
          minWickRatio: 1.0,        // ✅ Muy relajado para testing
          maxUpperWickRatio: 0.5,   // ✅ Permite upper wick más grande
          minBodyPosition: 0.3,     // ✅ Body puede estar más abajo
          debug: false
        },
        shootingStar: {
          enabled: true,
          minWickRatio: 1.0,        // ✅ Muy relajado
          maxLowerWickRatio: 0.5,   // ✅ Permite lower wick más grande
          minBodyPosition: 0.3,     // ✅ Body puede estar más abajo
          debug: false
        },
        engulfing: {
          enabled: true
        },
        doji: {
          enabled: true,
          maxBodyRatio: 0.12,       // ✅ Permite body más grande
          minLongWick: 0.4,         // ✅ Wick largo menos estricto
          maxShortWick: 0.20,       // ✅ Permite wick corto más grande
          debug: false
        }
      },
      swingDetection: {
        enabled: false,             // ✅ Deshabilitado para detectar más patrones
        leftBars: 3,
        rightBars: 3,
        required: false
      },
      minConfidence: 20             // ✅ Muy bajo para testing
    },
    scalping_1m: {
      patterns: {
        hammer: {
          enabled: true,
          minWickRatio: 1.2,
          maxUpperWickRatio: 0.4,
          minBodyPosition: 0.4,
          debug: false
        },
        shootingStar: {
          enabled: true,
          minWickRatio: 1.2,
          maxLowerWickRatio: 0.4,
          minBodyPosition: 0.4,
          debug: false
        },
        engulfing: {
          enabled: true
        },
        doji: {
          enabled: false,
          maxBodyRatio: 0.08,
          minLongWick: 0.5,
          maxShortWick: 0.15,
          debug: false
        }
      },
      swingDetection: {
        enabled: true,
        leftBars: 3,
        rightBars: 3,
        required: false
      },
      minConfidence: 40
    },
    swing_15m: {
      patterns: {
        hammer: {
          enabled: true,
          minWickRatio: 1.5,
          maxUpperWickRatio: 0.3,
          minBodyPosition: 0.5,
          debug: false
        },
        shootingStar: {
          enabled: true,
          minWickRatio: 1.5,
          maxLowerWickRatio: 0.3,
          minBodyPosition: 0.5,
          debug: false
        },
        engulfing: {
          enabled: true
        },
        doji: {
          enabled: false,
          maxBodyRatio: 0.08,
          minLongWick: 0.5,
          maxShortWick: 0.15,
          debug: false
        }
      },
      swingDetection: {
        enabled: true,
        leftBars: 7,
        rightBars: 7,
        required: true
      },
      minConfidence: 60
    },
    position_4h: {
      patterns: {
        hammer: {
          enabled: true,
          minWickRatio: 2.0,
          maxUpperWickRatio: 0.2,
          minBodyPosition: 0.6,
          debug: false
        },
        shootingStar: {
          enabled: true,
          minWickRatio: 2.0,
          maxLowerWickRatio: 0.2,
          minBodyPosition: 0.6,
          debug: false
        },
        engulfing: {
          enabled: true
        },
        doji: {
          enabled: false,
          maxBodyRatio: 0.05,
          minLongWick: 0.6,
          maxShortWick: 0.1,
          debug: false
        }
      },
      swingDetection: {
        enabled: true,
        leftBars: 12,
        rightBars: 12,
        required: true
      },
      minConfidence: 70
    }
  };
}

// Default configuration
function getDefaultConfig() {
  return {
    enabled: true,
    patterns: {
      hammer: {
        enabled: true,
        minWickRatio: 1.5,
        maxUpperWickRatio: 0.3,
        minBodyPosition: 0.5,
        debug: false
      },
      shootingStar: {
        enabled: true,
        minWickRatio: 1.5,
        maxLowerWickRatio: 0.3,
        minBodyPosition: 0.5,
        debug: false
      },
      engulfing: {
        enabled: true
      },
      doji: {
        enabled: false,
        maxBodyRatio: 0.08,
        minLongWick: 0.5,
        maxShortWick: 0.15,
        debug: false
      }
    },
    swingDetection: {
      enabled: true,
      leftBars: 5,
      rightBars: 5,
      required: false,
      swingOnlyMode: false  // Si true, detecta swings sin requerir forma de patrón
    },
    referenceContexts: [],
    levelSources: {
      volumeProfile: false,        // VP dinámico (VolumeProfileIndicator.js) - no usado
      fixedRanges: true,          // Fixed Ranges (VolumeProfileFixedRangeIndicator.js) ✅
      clusters: true,             // Clusters de Fixed Ranges ✅
      manualLevels: true,         // Líneas horizontales dibujadas
      supportResistance: true,    // Support & Resistance Indicator
      rangeDetection: true,       // Range Detector boundaries
      manualPriceZones: true      // Zonas manuales de precio
    },
    filters: {
      minConfidence: 50,
      requireNearLevel: false,
      proximityPercent: 1.0
    },
    volumeZScore: {
      enabled: false,
      lookbackPeriod: 20,
      minZScore: 1.0,
      swingCandleRange: 1  // Velas alrededor del swing a considerar para el Z-score
    },
    alertsEnabled: false,
    debugMode: false,
    signalDirection: {
      global: 'BOTH'  // 'LONG' | 'SHORT' | 'BOTH'
    },
    manualPriceZones: [],
    // ✅ NUEVO: Filtro VWAP (pasa/no pasa)
    vwapFilter: {
      enabled: false,
      deviationTolerance: 10,  // % de σ (desviación estándar)
      requiredDeviations: {
        second: true,   // ±2σ
        third: false    // ±3σ
      }
    },
    // ✅ NUEVO: Estilo visual de flechas de swing
    swingArrowStyle: {
      size: 10,           // Tamaño base de la flecha (5-20)
      longColor: '#00E676',   // Verde para LONG (swing low)
      shortColor: '#FF1744',  // Rojo para SHORT (swing high)
      offset: 8          // Distancia desde el high/low de la vela
    },
    // ✅ NUEVO: Configuración de estrategia (Entry/SL/TP)
    strategy: {
      enabled: false,
      riskRewardRatio: 2.0,
      lineLengthCandles: 5,
      entryColor: '#03A9F4',
      stopLossColor: '#FF1744',
      takeProfitColor: '#00E676',
      showLabels: true,
      includeInAlert: true,
      // Box settings
      showBox: true,
      slBoxColor: '#FF1744',  // Rojo para zona SL-Entry
      tpBoxColor: '#00E676',  // Verde para zona Entry-TP
      boxOpacity: 0.15,
      // SL Swing Detection parameters
      slSwingLeftBars: 3,
      slSwingRightBars: 3,
      slSwingLookback: 50,
      slBufferPercent: 20,
      slMinPercent: 0.5
    }
  };
}

export default RejectionPatternSettings;
