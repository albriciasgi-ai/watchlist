import React, { useState, useEffect } from 'react';
import { configStorageKey } from './indicators/SupportResistance2Indicator';
import { DEFAULT_LEVEL_CONFIG } from './indicators/swingLevels';
import './RejectionPatternSettings.css';

const PREVIEW_DELAY_MS = 250; // Rehacer los niveles tarda: espera a que se deje de escribir

/**
 * Support & Resistance v2 Settings Component
 *
 * S&R basado en los swings que el precio no ha superado
 * Solo dibuja niveles dentro de un rango de precio cercano al actual
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
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    // Check if indicator is enabled
    if (indicatorManager && indicatorManager.supportResistance2Indicator) {
      const isEnabled = indicatorManager.supportResistance2Indicator.enabled || false;
      setEnabled(isEnabled);

      // Load current config from indicator
      const indicator = indicatorManager.supportResistance2Indicator;
      setConfig({
        swingBars: indicator.swingBars,
        clusterDistancePct: indicator.clusterDistancePct,
        minTouches: indicator.minTouches,
        maxLevels: indicator.maxLevels,
        priceRangePct: indicator.priceRangePct,
        minVolumeZScore: indicator.minVolumeZScore,
        volumeLookbackBars: indicator.volumeLookbackBars,
        showResistances: indicator.showResistances !== false,
        showSupports: indicator.showSupports !== false,
        showLabels: indicator.showLabels !== false
      });
    }
  }, [symbol, indicatorManager]);

  const handleChange = (key, value) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
  };

  const handleToggleEnabled = () => {
    if (!indicatorManager || !indicatorManager.supportResistance2Indicator) {
      console.warn('S&R v2 Indicator not found');
      return;
    }

    const indicator = indicatorManager.supportResistance2Indicator;
    const newEnabled = !enabled;

    setEnabled(newEnabled);
    indicator.enabled = newEnabled;

    if (!newEnabled) {
      indicator.clearData();
    }

    // Force chart redraw
    if (indicatorManager.requestRedraw) {
      indicatorManager.requestRedraw();
    }
  };

  const handleSave = () => {
    let applied = config;

    // Apply config to indicator
    if (indicatorManager && indicatorManager.supportResistance2Indicator) {
      const indicator = indicatorManager.supportResistance2Indicator;
      indicator.updateConfig(config);
      applied = indicator.currentConfig(); // Un campo vacío conserva su valor

      // Force chart redraw
      if (indicatorManager.requestRedraw) {
        indicatorManager.requestRedraw();
      }
    }

    // Save config to localStorage
    localStorage.setItem(configStorageKey(symbol), JSON.stringify(applied));

    // Notify parent
    if (onConfigChange) {
      onConfigChange(applied);
    }

    if (onClose) {
      onClose();
    }
  };

  const handleReset = () => {
    const defaultConfig = getDefaultConfig();
    setConfig(defaultConfig);
    localStorage.removeItem(configStorageKey(symbol));
  };

  // Efecto de los valores escritos sobre las velas de la hora simulada, antes de aplicarlos.
  // Las casillas de mostrar no cambian los niveles
  const levelValues = Object.keys(DEFAULT_LEVEL_CONFIG).map(key => config[key]).join();
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreview(indicatorManager?.supportResistance2Indicator?.preview(config) ?? null);
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [indicatorManager, levelValues]);

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>📊 S&R v2 Settings (Swing Points)</h3>
          <button className="close-btn" onClick={onClose}>×</button>
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
                  ⚠️ Indicator is disabled. Enable it to see support and resistance levels.
                </p>
              </div>
            )}
          </div>

          {/* Swing Detection */}
          <div className="settings-section">
            <h4>🔄 Swing Detection</h4>

            <div className="setting-row">
              <label>Swing Bars</label>
              <input
                type="number"
                min="2"
                max="15"
                value={config.swingBars}
                onChange={(e) => handleChange('swingBars', parseInt(e.target.value))}
              />
              <span className="hint">Barras a cada lado para confirmar swing (2-15)</span>
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
              <span className="hint">Rango arriba/abajo del precio actual (1-20%)</span>
            </div>
          </div>

          {/* Clustering */}
          <div className="settings-section">
            <h4>🎯 Clustering</h4>

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
              <span className="hint">Distancia para agrupar swings (0.1-2.0%)</span>
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
              <span className="hint">Toques mínimos para nivel válido (1-10)</span>
            </div>

            <div className="setting-row">
              <label>Max Levels</label>
              <input
                type="number"
                min="1"
                max="20"
                value={config.maxLevels}
                onChange={(e) => handleChange('maxLevels', parseInt(e.target.value))}
              />
              <span className="hint">Máximo niveles por lado (1-20)</span>
            </div>
          </div>

          {/* Volume Filter */}
          <div className="settings-section">
            <h4>📈 Volume Filter (opcional)</h4>

            <div className="setting-row">
              <label>Min Volume Z-Score</label>
              <input
                type="number"
                min="0"
                max="3"
                step="0.1"
                value={config.minVolumeZScore}
                onChange={(e) => handleChange('minVolumeZScore', parseFloat(e.target.value))}
              />
              <span className="hint">0 = sin filtro, mayor = solo swings con alto volumen</span>
            </div>

            <div className="setting-row">
              <label>Volume Lookback</label>
              <input
                type="number"
                min="20"
                max="200"
                step="10"
                value={config.volumeLookbackBars}
                onChange={(e) => handleChange('volumeLookbackBars', parseInt(e.target.value))}
              />
              <span className="hint">Velas para calcular z-score (20-200)</span>
            </div>

            {preview && (
              <div className="info-box">
                <p>
                  Pasan {preview.kept.resistance} de {preview.swings.resistance} máximos y {preview.kept.support} de {preview.swings.support} mínimos.
                  A la vista: {preview.resistances.length} resistencias y {preview.supports.length} soportes.
                </p>
              </div>
            )}
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
                  checked={config.showLabels}
                  onChange={(e) => handleChange('showLabels', e.target.checked)}
                />
                Show Labels
              </label>
            </div>
          </div>

          {/* Info */}
          <div className="settings-section">
            <h4>ℹ️ Cómo funciona S&R v2</h4>
            <div className="info-box">
              <p><strong>Swing Points:</strong> Detecta máximos/mínimos locales confirmados (N barras a cada lado)</p>
              <p><strong>Vigencia:</strong> Un nivel vale hasta que una vela cierra más allá de todos sus toques. Una mecha no lo rompe</p>
              <p><strong>Filtro de precio:</strong> Solo dibuja niveles dentro del rango especificado</p>
              <p><strong>Clustering:</strong> Un swing cercano refuerza un nivel que sigue vigente</p>
              <p><strong>Strength:</strong> Basado en toques + volumen + recencia</p>
              <p><strong>Etiqueta:</strong> toques, strength y z-score promedio del volumen de sus swings</p>
              <p style={{ marginTop: '10px', borderTop: '1px solid #ddd', paddingTop: '10px' }}>
                <strong>Líneas sólidas:</strong> Niveles activos<br/>
                <strong>Líneas punteadas:</strong> Rotos hace poco, de cualquier lado del precio<br/>
                Es un mapa de estructura: medido en BTC, estos niveles no aguantan más que un precio al azar
              </p>
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
    swingBars: 5,
    clusterDistancePct: 0.3,
    minTouches: 1,
    maxLevels: 5,
    priceRangePct: 10.0,
    minVolumeZScore: 0,
    volumeLookbackBars: 50,
    showResistances: true,
    showSupports: true,
    showLabels: true
  };
}

export default SupportResistance2Settings;
