import React, { useState, useEffect } from 'react';
import './AlertConfigPanel.css';

/**
 * Alert Configuration Panel
 *
 * Allows users to configure global alert settings:
 * - Which indicators can send alerts
 * - Minimum severity level
 * - Sound and browser notifications
 * - Confluence detection settings
 */
const AlertConfigPanel = ({ config, onConfigChange, onClose }) => {
  const [localConfig, setLocalConfig] = useState(config || getDefaultConfig());

  const handleChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
  };

  const handleIndicatorToggle = (indicatorName) => {
    const newIndicators = {
      ...localConfig.enabledIndicators,
      [indicatorName]: !localConfig.enabledIndicators[indicatorName]
    };
    setLocalConfig({
      ...localConfig,
      enabledIndicators: newIndicators
    });
  };

  const handleSave = () => {
    if (onConfigChange) {
      onConfigChange(localConfig);
    }
    onClose();
  };

  const handleReset = () => {
    const defaultConfig = getDefaultConfig();
    setLocalConfig(defaultConfig);
  };

  const getEnabledIndicatorsCount = () => {
    return Object.values(localConfig.enabledIndicators).filter(v => v).length;
  };

  return (
    <div className="alert-config-overlay" onClick={onClose}>
      <div className="alert-config-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="alert-config-header">
          <h3>⚙️ Alert Configuration</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {/* Content */}
        <div className="alert-config-content">
          {/* Section 1: General Settings */}
          <section className="config-section">
            <h4>🔔 General Settings</h4>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.enabled}
                  onChange={(e) => handleChange('enabled', e.target.checked)}
                />
                <span>Enable Alert System</span>
              </label>
              <span className="config-hint">Master switch for all alerts</span>
            </div>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.soundEnabled}
                  onChange={(e) => handleChange('soundEnabled', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Enable Sound Notifications</span>
              </label>
              <span className="config-hint">Play sound when alert arrives</span>
            </div>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.browserNotifications}
                  onChange={(e) => handleChange('browserNotifications', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Enable Browser Notifications</span>
              </label>
              <span className="config-hint">Show native browser notifications</span>
            </div>

            <div className="config-row">
              <label>
                Minimum Severity Level
                <select
                  value={localConfig.minSeverity}
                  onChange={(e) => handleChange('minSeverity', e.target.value)}
                  disabled={!localConfig.enabled}
                >
                  <option value="LOW">Low (all alerts)</option>
                  <option value="MEDIUM">Medium and High only</option>
                  <option value="HIGH">High only</option>
                </select>
              </label>
              <span className="config-hint">Filter alerts by importance</span>
            </div>
          </section>

          {/* Section 2: Indicator Settings */}
          <section className="config-section">
            <h4>📊 Indicator Alerts</h4>
            <p className="section-description">
              Choose which indicators can send alerts. Only enabled indicators will trigger notifications.
            </p>

            <div className="indicators-list">
              <div className={`indicator-toggle ${localConfig.enabledIndicators['Support & Resistance'] ? 'enabled' : ''}`}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.enabledIndicators['Support & Resistance']}
                    onChange={() => handleIndicatorToggle('Support & Resistance')}
                    disabled={!localConfig.enabled}
                  />
                  <span className="indicator-name">
                    <span className="indicator-icon">⚡</span>
                    Support & Resistance
                  </span>
                </label>
                <small>Alerts when price approaches key levels</small>
              </div>

              <div className={`indicator-toggle ${localConfig.enabledIndicators['Rejection Patterns'] ? 'enabled' : ''}`}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.enabledIndicators['Rejection Patterns']}
                    onChange={() => handleIndicatorToggle('Rejection Patterns')}
                    disabled={!localConfig.enabled}
                  />
                  <span className="indicator-name">
                    <span className="indicator-icon">📊</span>
                    Rejection Patterns
                  </span>
                </label>
                <small>Alerts on hammer, shooting star, engulfing patterns</small>
              </div>

              <div className={`indicator-toggle ${localConfig.enabledIndicators['Volume Profile'] ? 'enabled' : ''}`}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.enabledIndicators['Volume Profile']}
                    onChange={() => handleIndicatorToggle('Volume Profile')}
                    disabled={!localConfig.enabled}
                  />
                  <span className="indicator-name">
                    <span className="indicator-icon">📈</span>
                    Volume Profile
                  </span>
                </label>
                <small>Alerts at POC and Value Area boundaries</small>
              </div>

              <div className={`indicator-toggle ${localConfig.enabledIndicators['Open Interest'] ? 'enabled' : ''}`}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={localConfig.enabledIndicators['Open Interest']}
                    onChange={() => handleIndicatorToggle('Open Interest')}
                    disabled={!localConfig.enabled}
                  />
                  <span className="indicator-name">
                    <span className="indicator-icon">🔥</span>
                    Open Interest
                  </span>
                </label>
                <small>Alerts on significant OI changes</small>
              </div>
            </div>

            <div className="indicators-summary">
              {getEnabledIndicatorsCount()} of 4 indicators enabled
            </div>
          </section>

          {/* Section 3: Confluence Detection */}
          <section className="config-section">
            <h4>🎯 Confluence Detection</h4>
            <p className="section-description">
              Detect when multiple indicators agree on the same area/price. Confluence alerts are automatically marked as HIGH severity.
            </p>

            <div className="config-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.confluenceEnabled}
                  onChange={(e) => handleChange('confluenceEnabled', e.target.checked)}
                  disabled={!localConfig.enabled}
                />
                <span>Enable Confluence Detection</span>
              </label>
              <span className="config-hint">Detect multi-indicator agreement</span>
            </div>

            <div className="config-row">
              <label>
                Minimum Indicators for Confluence
                <input
                  type="number"
                  min="2"
                  max="4"
                  value={localConfig.minIndicatorsForConfluence}
                  onChange={(e) => handleChange('minIndicatorsForConfluence', parseInt(e.target.value))}
                  disabled={!localConfig.enabled || !localConfig.confluenceEnabled}
                />
              </label>
              <span className="config-hint">How many indicators must agree (2-4)</span>
            </div>

            <div className="config-row">
              <label>
                Confluence Time Window (candles)
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={localConfig.confluenceWindowCandles}
                  onChange={(e) => handleChange('confluenceWindowCandles', parseInt(e.target.value))}
                  disabled={!localConfig.enabled || !localConfig.confluenceEnabled}
                />
              </label>
              <span className="config-hint">±candles to consider indicators as confluent</span>
            </div>

            <div className="config-row">
              <label>
                Price Proximity (%)
                <input
                  type="number"
                  min="0.1"
                  max="2.0"
                  step="0.1"
                  value={localConfig.confluencePriceProximity}
                  onChange={(e) => handleChange('confluencePriceProximity', parseFloat(e.target.value))}
                  disabled={!localConfig.enabled || !localConfig.confluenceEnabled}
                />
              </label>
              <span className="config-hint">Max price distance to group alerts (%)</span>
            </div>
          </section>

          {/* Summary */}
          <section className="config-section summary">
            <h4>📋 Summary</h4>
            <div className="summary-content">
              {!localConfig.enabled && (
                <p className="warning">⚠️ Alert system is disabled</p>
              )}
              {localConfig.enabled && getEnabledIndicatorsCount() === 0 && (
                <p className="warning">⚠️ No indicators enabled - you won't receive any alerts</p>
              )}
              {localConfig.enabled && getEnabledIndicatorsCount() > 0 && (
                <p className="success">
                  ✅ Alert system active with {getEnabledIndicatorsCount()} indicator(s)
                </p>
              )}
              {localConfig.confluenceEnabled && (
                <p className="info">
                  🎯 Confluence detection active: {localConfig.minIndicatorsForConfluence}+ indicators within ±{localConfig.confluenceWindowCandles} candles and {localConfig.confluencePriceProximity}%
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="alert-config-footer">
          <button className="btn-secondary" onClick={handleReset}>
            Reset to Default
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

function getDefaultConfig() {
  return {
    enabled: true,
    soundEnabled: false,
    browserNotifications: false,
    minSeverity: 'LOW',
    enabledIndicators: {
      'Support & Resistance': true,
      'Rejection Patterns': true,
      'Volume Profile': false,
      'Open Interest': false
    },
    confluenceEnabled: true,
    minIndicatorsForConfluence: 2,
    confluenceWindowCandles: 3,
    confluencePriceProximity: 0.5
  };
}

export default AlertConfigPanel;
