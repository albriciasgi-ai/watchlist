import React, { useState, useEffect } from 'react';
import './IndicatorSettings.css';

/**
 * Support & Resistance Settings Component
 *
 * Allows users to configure:
 * - Detection parameters (z-score, bars, touches)
 * - Display options (show supports, resistances, zones, labels)
 * - Visual settings
 */
const SupportResistanceSettings = ({
  symbol,
  onConfigChange,
  onClose,
  initialConfig
}) => {
  const [config, setConfig] = useState(initialConfig || getDefaultConfig());

  useEffect(() => {
    // Load config from localStorage
    const savedConfig = localStorage.getItem(`support_resistance_config_${symbol}`);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
      } catch (e) {
        console.error('Failed to load S/R config:', e);
      }
    }
  }, [symbol]);

  const handleChange = (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
  };

  const handleSave = () => {
    // Save to localStorage
    localStorage.setItem(`support_resistance_config_${symbol}`, JSON.stringify(config));

    // Notify parent
    if (onConfigChange) {
      onConfigChange(config);
    }

    if (onClose) {
      onClose();
    }
  };

  const handleReset = () => {
    const defaultConfig = getDefaultConfig();
    setConfig(defaultConfig);
    localStorage.removeItem(`support_resistance_config_${symbol}`);
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>⚡ Support & Resistance Settings</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          {/* Detection Parameters */}
          <div className="settings-section">
            <h4>🔍 Detection Parameters</h4>

            <div className="setting-row">
              <label>Historical Days</label>
              <input
                type="number"
                min="30"
                max="365"
                value={config.days}
                onChange={(e) => handleChange('days', parseInt(e.target.value))}
              />
              <span className="hint">Days to analyze (30-365)</span>
            </div>

            <div className="setting-row">
              <label>Z-Score Threshold</label>
              <input
                type="number"
                min="0.5"
                max="3.0"
                step="0.1"
                value={config.zScoreThreshold}
                onChange={(e) => handleChange('zScoreThreshold', parseFloat(e.target.value))}
              />
              <span className="hint">Volume significance (0.5-3.0, lower = more levels)</span>
            </div>

            <div className="setting-row">
              <label>Z-Score Period</label>
              <input
                type="number"
                min="20"
                max="200"
                step="10"
                value={config.zScorePeriod}
                onChange={(e) => handleChange('zScorePeriod', parseInt(e.target.value))}
              />
              <span className="hint">Candles for z-score calculation (20-200)</span>
            </div>

            <div className="setting-row">
              <label>Left Bars</label>
              <input
                type="number"
                min="5"
                max="30"
                value={config.leftBars}
                onChange={(e) => handleChange('leftBars', parseInt(e.target.value))}
              />
              <span className="hint">Bars before pivot (5-30)</span>
            </div>

            <div className="setting-row">
              <label>Right Bars</label>
              <input
                type="number"
                min="5"
                max="30"
                value={config.rightBars}
                onChange={(e) => handleChange('rightBars', parseInt(e.target.value))}
              />
              <span className="hint">Bars after pivot (5-30)</span>
            </div>

            <div className="setting-row">
              <label>Min Touches</label>
              <input
                type="number"
                min="1"
                max="10"
                value={config.minTouches}
                onChange={(e) => handleChange('minTouches', parseInt(e.target.value))}
              />
              <span className="hint">Minimum bounces to consider level (1-10)</span>
            </div>

            <div className="setting-row">
              <label>Cluster Distance (%)</label>
              <input
                type="number"
                min="0.1"
                max="2.0"
                step="0.1"
                value={config.clusterDistance}
                onChange={(e) => handleChange('clusterDistance', parseFloat(e.target.value))}
              />
              <span className="hint">Distance to group levels (0.1-2.0%)</span>
            </div>

            <div className="setting-row">
              <label>Max Levels</label>
              <input
                type="number"
                min="5"
                max="50"
                value={config.maxLevels}
                onChange={(e) => handleChange('maxLevels', parseInt(e.target.value))}
              />
              <span className="hint">Maximum levels to show (5-50)</span>
            </div>
          </div>

          {/* Display Options */}
          <div className="settings-section">
            <h4>👁️ Display Options</h4>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.showResistances}
                  onChange={(e) => handleChange('showResistances', e.target.checked)}
                />
                Show Resistances
              </label>
            </div>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.showSupports}
                  onChange={(e) => handleChange('showSupports', e.target.checked)}
                />
                Show Supports
              </label>
            </div>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.showConsolidationZones}
                  onChange={(e) => handleChange('showConsolidationZones', e.target.checked)}
                />
                Show Consolidation Zones
              </label>
            </div>

            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.showLabels}
                  onChange={(e) => handleChange('showLabels', e.target.checked)}
                />
                Show Labels
              </label>
            </div>
          </div>

          {/* Info */}
          <div className="settings-section">
            <h4>ℹ️ Info</h4>
            <div className="info-box">
              <p><strong>Green lines:</strong> Support levels (price bounced up)</p>
              <p><strong>Red lines:</strong> Resistance levels (price bounced down)</p>
              <p><strong>Purple zones:</strong> Consolidation areas (multiple levels close together)</p>
              <p><strong>Line thickness:</strong> Proportional to strength (0-10)</p>
              <p><strong>Dashed lines:</strong> Broken or tested levels</p>
              <p><strong>Solid lines:</strong> Active levels</p>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={handleReset}>
            Reset to Default
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  );
};

function getDefaultConfig() {
  return {
    days: 90,
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
    showLabels: true
  };
}

export default SupportResistanceSettings;
