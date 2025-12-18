// src/components/FibonacciSettings.jsx
import React, { useState } from "react";
import PresetManager from "../utils/PresetManager";
import "./FibonacciSettings.css";

const FibonacciSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [applyGlobally, setApplyGlobally] = useState(false);

  const hasOverride = currentSymbol && PresetManager.hasOverride(currentSymbol, "Fibonacci");

  const handleConfigChange = (key, value) => {
    const newConfig = { ...config, [key]: value };

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("Fibonacci", newConfig);
      console.log(`[FibonacciSettings] 🌐 Preset global actualizado`);
      onConfigChange(newConfig, false);
    } else {
      onConfigChange(newConfig, true);
    }
  };

  const handleLevelChange = (index, value) => {
    const newLevels = [...config.levels];
    newLevels[index] = parseFloat(value);
    const newConfig = { ...config, levels: newLevels };

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("Fibonacci", newConfig);
      onConfigChange(newConfig, false);
    } else {
      onConfigChange(newConfig, true);
    }
  };

  const handleExtensionLevelChange = (index, value) => {
    const newLevels = [...config.extensionLevels];
    newLevels[index] = parseFloat(value);
    const newConfig = { ...config, extensionLevels: newLevels };

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("Fibonacci", newConfig);
      onConfigChange(newConfig, false);
    } else {
      onConfigChange(newConfig, true);
    }
  };

  const handleResetToGlobal = () => {
    if (currentSymbol && hasOverride) {
      PresetManager.clearSymbolOverride(currentSymbol, "Fibonacci");
      const globalConfig = PresetManager.getGlobalPreset("Fibonacci");
      onConfigChange(globalConfig, false);
      console.log(`[FibonacciSettings] 🔄 ${currentSymbol} reseteado a preset global`);
    }
  };

  return (
    <div className="fibonacci-settings">
      <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ margin: 0 }}>
            Configuración Fibonacci - {currentSymbol}
            {hasOverride && (
              <span style={{
                marginLeft: '8px',
                padding: '2px 8px',
                background: '#FF9800',
                color: 'white',
                fontSize: '10px',
                borderRadius: '4px',
                fontWeight: 'bold'
              }}>
                OVERRIDE
              </span>
            )}
          </h4>
          {hasOverride && (
            <button onClick={handleResetToGlobal} style={{
              padding: '4px 12px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}>
              🔄 Reset to Global
            </button>
          )}
        </div>

        <div className="setting-row" style={{
          background: applyGlobally ? '#fff3e0' : '#e3f2fd',
          padding: '12px',
          borderRadius: '8px',
          border: `2px solid ${applyGlobally ? '#FF9800' : '#2196F3'}`,
          marginBottom: '16px'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'bold' }}>
            <input
              type="checkbox"
              checked={applyGlobally}
              onChange={(e) => setApplyGlobally(e.target.checked)}
              style={{ marginRight: '8px', cursor: 'pointer' }}
            />
            {applyGlobally ? (
              <span style={{ color: '#FF9800' }}>🌐 Modificando preset GLOBAL (todas las monedas)</span>
            ) : (
              <span style={{ color: '#2196F3' }}>✏️ Modificando solo {currentSymbol}</span>
            )}
          </label>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', marginLeft: '24px' }}>
            {applyGlobally
              ? "Los cambios se aplicarán a todas las monedas que no tengan overrides"
              : "Los cambios solo afectarán a " + currentSymbol
            }
          </div>
        </div>

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
