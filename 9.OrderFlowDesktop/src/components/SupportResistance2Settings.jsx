import React, { useState, useEffect } from 'react';
import './RejectionPatternSettings.css';

/**
 * Support & Resistance v2 Settings Component
 *
 * Configuracion para el detector de S&R basado en Swing Points:
 * - swingBars: Barras a cada lado para confirmar swing
 * - clusterDistancePct: % para agrupar swings cercanos
 * - minTouches: Minimo de toques para nivel valido
 * - maxLevels: Maximo de niveles por tipo
 * - priceRangePct: % arriba/abajo del precio actual
 */
const SupportResistance2Settings = ({
  symbol,
  indicatorManager,
  onConfigChange,
  onClose,
  initialConfig
}) => {
  const [config, setConfig] = useState(initialConfig || getDefaultConfig());
  const [enabled, setEnabled] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    // Buscar el indicador S&R v2 en el manager
    if (indicatorManager) {
      const sr2Indicator = indicatorManager.indicators?.find(ind => ind.name === "S&R v2");
      if (sr2Indicator) {
        setEnabled(sr2Indicator.enabled || false);
        // Cargar config actual del indicador
        setConfig({
          swingBars: sr2Indicator.swingBars || 5,
          clusterDistancePct: sr2Indicator.clusterDistancePct || 0.3,
          minTouches: sr2Indicator.minTouches || 2,
          maxLevels: sr2Indicator.maxLevels || 10,
          priceRangePct: sr2Indicator.priceRangePct || 5.0,
          showResistances: sr2Indicator.showResistances !== false,
          showSupports: sr2Indicator.showSupports !== false,
          showLabels: sr2Indicator.showLabels !== false
        });
        // Obtener stats si hay datos
        if (sr2Indicator.stats) {
          setStats(sr2Indicator.stats);
        }
      }
    }

    // Cargar config desde localStorage
    const savedConfig = localStorage.getItem(`sr2_config_${symbol}`);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to load S&R v2 config:', e);
      }
    }
  }, [symbol, indicatorManager]);

  const handleChange = (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
  };

  const handleToggleEnabled = async () => {
    if (!indicatorManager) {
      console.warn('IndicatorManager not found');
      return;
    }

    const sr2Indicator = indicatorManager.indicators?.find(ind => ind.name === "S&R v2");
    if (!sr2Indicator) {
      console.warn('S&R v2 Indicator not found');
      return;
    }

    const newEnabled = !enabled;
    setEnabled(newEnabled);
    sr2Indicator.enabled = newEnabled;

    if (newEnabled) {
      // Fetch data when enabling
      const success = await sr2Indicator.fetchData();
      if (sr2Indicator.stats) {
        setStats(sr2Indicator.stats);
      }

      // Force chart redraw
      if (indicatorManager.requestRedraw) {
        indicatorManager.requestRedraw();
      }
    } else {
      sr2Indicator.clearData();
      setStats(null);

      // Force chart redraw
      if (indicatorManager.requestRedraw) {
        indicatorManager.requestRedraw();
      }
    }
  };

  const handleSave = async () => {
    // Guardar en localStorage
    localStorage.setItem(`sr2_config_${symbol}`, JSON.stringify(config));

    // Aplicar config al indicador
    if (indicatorManager) {
      const sr2Indicator = indicatorManager.indicators?.find(ind => ind.name === "S&R v2");
      if (sr2Indicator) {
        sr2Indicator.updateConfig(config);

        // Refrescar datos si esta habilitado
        if (enabled) {
          await sr2Indicator.fetchData();
          if (sr2Indicator.stats) {
            setStats(sr2Indicator.stats);
          }

          // Force chart redraw
          if (indicatorManager.requestRedraw) {
            indicatorManager.requestRedraw();
          }
        }
      }
    }

    // Notificar al parent
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
    localStorage.removeItem(`sr2_config_${symbol}`);
  };

  const handleRefresh = async () => {
    if (!indicatorManager) return;

    const sr2Indicator = indicatorManager.indicators?.find(ind => ind.name === "S&R v2");
    if (sr2Indicator && enabled) {
      // Aplicar config primero
      sr2Indicator.updateConfig(config);
      // Forzar fetch sin cache
      await sr2Indicator.fetchData(true);
      if (sr2Indicator.stats) {
        setStats(sr2Indicator.stats);
      }
      if (indicatorManager.requestRedraw) {
        indicatorManager.requestRedraw();
      }
    }
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>S&R v2 Settings (Swing-based)</h3>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

        <div className="settings-content">
          {/* Enable/Disable Toggle */}
          <div className="settings-section">
            <div className="setting-row">
              <label className="checkbox-label" style={{ fontSize: '16px', fontWeight: 'bold' }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={handleToggleEnabled}
                  style={{ width: '20px', height: '20px' }}
                />
                Enable S&R v2 Indicator
              </label>
            </div>
            {!enabled && (
              <div className="info-box" style={{ marginTop: '10px', background: '#ffeaa7' }}>
                <p style={{ color: '#2d3436', margin: 0 }}>
                  Indicator disabled. Enable to see swing-based support and resistance levels.
                </p>
              </div>
            )}
          </div>

          {/* Detection Parameters */}
          <div className="settings-section">
            <h4>Detection Parameters</h4>

            <div className="setting-row">
              <label>Swing Bars</label>
              <input
                type="number"
                min="2"
                max="20"
                value={config.swingBars}
                onChange={(e) => handleChange('swingBars', parseInt(e.target.value))}
              />
              <span className="hint">Bars on each side to confirm swing (2-20)</span>
            </div>

            <div className="setting-row">
              <label>Cluster Distance (%)</label>
              <input
                type="number"
                min="0.1"
                max="2.0"
                step="0.1"
                value={config.clusterDistancePct}
                onChange={(e) => handleChange('clusterDistancePct', parseFloat(e.target.value))}
              />
              <span className="hint">% to group nearby swings (0.1-2.0)</span>
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
              <span className="hint">Minimum swings to form a level (1-10)</span>
            </div>

            <div className="setting-row">
              <label>Max Levels</label>
              <input
                type="number"
                min="3"
                max="30"
                value={config.maxLevels}
                onChange={(e) => handleChange('maxLevels', parseInt(e.target.value))}
              />
              <span className="hint">Max levels per type (3-30)</span>
            </div>

            <div className="setting-row">
              <label>Price Range (%)</label>
              <input
                type="number"
                min="1"
                max="20"
                step="0.5"
                value={config.priceRangePct}
                onChange={(e) => handleChange('priceRangePct', parseFloat(e.target.value))}
              />
              <span className="hint">% above/below current price (1-20)</span>
            </div>

            <div className="setting-row">
              <label>Min Volume Z-Score</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={config.minVolumeZscore || 0}
                onChange={(e) => handleChange('minVolumeZscore', parseFloat(e.target.value))}
              />
              <span className="hint">0 = no filter, 1+ = only high volume swings</span>
            </div>
          </div>

          {/* Display Options */}
          <div className="settings-section">
            <h4>Display Options</h4>

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
                  checked={config.showLabels}
                  onChange={(e) => handleChange('showLabels', e.target.checked)}
                />
                Show Labels
              </label>
            </div>
          </div>

          {/* Stats (if available) */}
          {stats && (
            <div className="settings-section">
              <h4>Detection Stats</h4>
              <div className="info-box" style={{ background: '#e8f5e9' }}>
                <p><strong>Total Swings Found:</strong> {stats.totalSwingsFound || 0}</p>
                <p><strong>Swings in Price Range:</strong> {stats.swingsInPriceRange || 0}</p>
                <p><strong>Resistance Clusters:</strong> {stats.resistanceClusters || 0}</p>
                <p><strong>Support Clusters:</strong> {stats.supportClusters || 0}</p>
                <p><strong>Final Resistances:</strong> {stats.finalResistances || 0}</p>
                <p><strong>Final Supports:</strong> {stats.finalSupports || 0}</p>
              </div>
            </div>
          )}

          {/* Info */}
          <div className="settings-section">
            <h4>How it works</h4>
            <div className="info-box">
              <p><strong>Green lines:</strong> Support levels (swing lows)</p>
              <p><strong>Red lines:</strong> Resistance levels (swing highs)</p>
              <p><strong>Line thickness:</strong> Based on strength (touches x volume x recency)</p>
              <p><strong>Solid lines:</strong> Active levels</p>
              <p><strong>Dashed lines:</strong> Broken or tested levels</p>
              <p style={{ marginTop: '10px', fontStyle: 'italic' }}>
                Unlike v1, this detector finds ALL swing points first, then clusters them
                by price proximity. Only levels with enough touches are shown.
              </p>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={handleReset}>
            Reset to Default
          </button>
          <button className="btn-secondary" onClick={handleRefresh} disabled={!enabled}>
            Refresh Data
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
    swingBars: 3,
    clusterDistancePct: 0.5,
    minTouches: 2,
    maxLevels: 5,
    priceRangePct: 3.0,
    minVolumeZscore: 0.0,  // 0 = sin filtro de volumen
    showResistances: true,
    showSupports: true,
    showLabels: true
  };
}

export default SupportResistance2Settings;
