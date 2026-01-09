import React, { useState, useEffect } from 'react';
import './RejectionPatternSettings.css';

/**
 * Rejection Pattern Settings Component
 *
 * Allows users to configure:
 * - Which patterns to detect (Hammer, Shooting Star, Engulfing, etc.)
 * - Reference contexts to validate patterns (Volume Profiles, Range Detector)
 * - Filters (confidence, volume, proximity)
 * - Alert settings
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
  const [showMode, setShowMode] = useState('all'); // 'all' or 'validated'

  useEffect(() => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem(`rejection_pattern_config_${symbol}`);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
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

  useEffect(() => {
    // Notify parent of config changes
    if (onConfigChange) {
      onConfigChange(config);
    }

    // Save to localStorage
    localStorage.setItem(`rejection_pattern_config_${symbol}`, JSON.stringify(config));
  }, [config, symbol, onConfigChange]);

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

  return (
    <div className="rejection-pattern-settings">
      <div className="settings-header">
        <h3>⚙️ Rejection Pattern Settings - {symbol}</h3>
        <button className="close-button" onClick={onClose}>✕</button>
      </div>

      <div className="settings-content">
        {/* NEW: Show Mode Toggle */}
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
            />

            <PatternToggle
              label="⭐ Shooting Star"
              description="Bearish pin bar with long upper wick"
              enabled={config.patterns.shootingStar.enabled}
              onToggle={() => togglePattern('shootingStar')}
              config={config.patterns.shootingStar}
              onConfigChange={(field, value) => updatePatternConfig('shootingStar', field, value)}
            />

            <PatternToggle
              label="📦 Engulfing"
              description="One candle completely engulfs the previous"
              enabled={config.patterns.engulfing.enabled}
              onToggle={() => togglePattern('engulfing')}
              config={config.patterns.engulfing}
              onConfigChange={(field, value) => updatePatternConfig('engulfing', field, value)}
            />

            <PatternToggle
              label="🎯 Doji"
              description="Small body with long wicks (Dragonfly/Gravestone)"
              enabled={config.patterns.doji.enabled}
              onToggle={() => togglePattern('doji')}
              config={config.patterns.doji}
              onConfigChange={(field, value) => updatePatternConfig('doji', field, value)}
            />
          </div>
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

          <div className="filter-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.filters.requireVolumeSpike}
                onChange={(e) => updateFilter('requireVolumeSpike', e.target.checked)}
              />
              <span>Require elevated volume on pattern candle (legacy)</span>
            </label>
          </div>
        </section>

        {/* Section 3.5: Volume Z-Score Filter */}
        <section className="settings-section">
          <h4>📊 Volume Z-Score Filter (Advanced)</h4>
          <p className="help-text">
            Filters patterns based on statistical volume significance (Z-score).
            Only patterns with volume above the threshold are shown.
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
        </section>

        {/* Summary */}
        <section className="settings-section summary">
          <h4>📋 Configuration Summary</h4>
          <div className="config-summary">
            <p>✅ {getEnabledPatternsCount()} pattern types active</p>
            <p>✅ {getEnabledContextsCount()} reference contexts active</p>
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
    </div>
  );
};

// Sub-component: PatternToggle
const PatternToggle = ({ label, description, enabled, onToggle, config, onConfigChange }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className={`pattern-item ${enabled ? 'enabled' : 'disabled'}`}>
      <div className="pattern-header">
        <label className="pattern-label">
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="pattern-name">{label}</span>
        </label>
        {enabled && (
          <button
            className="advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼' : '▶'} Advanced
          </button>
        )}
      </div>
      <p className="pattern-description">{description}</p>

      {enabled && showAdvanced && config.minWickRatio !== undefined && (
        <div className="pattern-advanced">
          <label>
            Min Wick Ratio: {config.minWickRatio}x
            <input
              type="range"
              min="1.5"
              max="4"
              step="0.1"
              value={config.minWickRatio}
              onChange={(e) => onConfigChange('minWickRatio', parseFloat(e.target.value))}
            />
          </label>
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

// Default configuration
function getDefaultConfig() {
  return {
    enabled: true,
    patterns: {
      hammer: {
        enabled: true,
        minWickRatio: 2.0
      },
      shootingStar: {
        enabled: true,
        minWickRatio: 2.0
      },
      engulfing: {
        enabled: true
      },
      doji: {
        enabled: false
      }
    },
    referenceContexts: [],
    filters: {
      minConfidence: 60,
      requireNearLevel: true,
      proximityPercent: 1.0,
      requireVolumeSpike: true
    },
    volumeZScore: {
      enabled: false,
      lookbackPeriod: 20,
      minZScore: 1.0
    },
    alertsEnabled: false
  };
}

export default RejectionPatternSettings;
