// src/components/FibonacciSettings.jsx
import React, { useState } from "react";
import "./FibonacciSettings.css";

const FibonacciSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleConfigChange = (key, value) => {
    onConfigChange({ ...config, [key]: value });
  };

  const handleLevelChange = (index, value) => {
    const newLevels = [...config.levels];
    newLevels[index] = parseFloat(value);
    handleConfigChange('levels', newLevels);
  };

  const handleExtensionLevelChange = (index, value) => {
    const newLevels = [...config.extensionLevels];
    newLevels[index] = parseFloat(value);
    handleConfigChange('extensionLevels', newLevels);
  };

  return (
    <div className="fibonacci-settings">
      <div className="settings-section">
        <h4>Configuración Fibonacci - {currentSymbol}</h4>

        {/* Auto Detect */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={config.autoDetect}
              onChange={(e) => handleConfigChange('autoDetect', e.target.checked)}
            />
            Detectar swing points automáticamente
          </label>
        </div>

        {/* Lookback (solo si autoDetect está activo) */}
        {config.autoDetect && (
          <div className="setting-row">
            <label>Lookback (períodos):</label>
            <input
              type="number"
              min="20"
              max="200"
              value={config.lookback}
              onChange={(e) => handleConfigChange('lookback', parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Show Retracements */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={config.showRetracements}
              onChange={(e) => handleConfigChange('showRetracements', e.target.checked)}
            />
            Mostrar niveles de retroceso
          </label>
        </div>

        {/* Show Extensions */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={config.showExtensions}
              onChange={(e) => handleConfigChange('showExtensions', e.target.checked)}
            />
            Mostrar niveles de extensión
          </label>
        </div>

        {/* Label Position */}
        <div className="setting-row">
          <label>Posición de etiquetas:</label>
          <select
            value={config.labelPosition}
            onChange={(e) => handleConfigChange('labelPosition', e.target.value)}
          >
            <option value="right">Derecha</option>
            <option value="left">Izquierda</option>
            <option value="none">Ocultar</option>
          </select>
        </div>

        {/* Color */}
        <div className="setting-row">
          <label>Color de niveles:</label>
          <input
            type="color"
            value={config.color || 'rgba(33, 150, 243, 0.6)'}
            onChange={(e) => handleConfigChange('color', e.target.value)}
          />
        </div>

        {/* Advanced Settings */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼' : '▶'} Configuración avanzada
          </button>
        </div>

        {showAdvanced && (
          <div className="advanced-settings">
            {config.showRetracements && (
              <div className="level-group">
                <h5>Niveles de Retroceso</h5>
                {config.levels.map((level, index) => (
                  <div key={index} className="setting-row">
                    <label>Nivel {index + 1}:</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={level}
                      onChange={(e) => handleLevelChange(index, e.target.value)}
                    />
                    <span className="level-percent">{(level * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}

            {config.showExtensions && (
              <div className="level-group">
                <h5>Niveles de Extensión</h5>
                {config.extensionLevels.map((level, index) => (
                  <div key={index} className="setting-row">
                    <label>Extensión {index + 1}:</label>
                    <input
                      type="number"
                      step="0.001"
                      min="1"
                      max="5"
                      value={level}
                      onChange={(e) => handleExtensionLevelChange(index, e.target.value)}
                    />
                    <span className="level-percent">{level.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="setting-row">
              <label>Grosor de línea:</label>
              <input
                type="number"
                min="1"
                max="5"
                value={config.lineWidth || 1}
                onChange={(e) => handleConfigChange('lineWidth', parseInt(e.target.value))}
              />
            </div>
          </div>
        )}

        <div className="settings-hint">
          💡 Los niveles de Fibonacci identifican zonas de soporte/resistencia potenciales basadas en retrocesos y extensiones de movimientos de precio.
        </div>
      </div>
    </div>
  );
};

export default FibonacciSettings;
