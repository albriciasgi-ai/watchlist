// src/components/FibonacciSettings.jsx
import React, { useState, useEffect, useRef } from "react";
import PresetManager from "../utils/PresetManager";
import "./FibonacciSettings.css";

const DEBUG = false;

const FibonacciSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [applyGlobally, setApplyGlobally] = useState(false);
  const [localConfig, setLocalConfig] = useState(config);
  const renderCount = useRef(0);

  renderCount.current++;

  if (DEBUG) {
    console.log(`[FibonacciSettings] Render #${renderCount.current}`, {
      currentSymbol,
      applyGlobally
    });
  }

  const hasOverride = currentSymbol && PresetManager.hasOverride(currentSymbol, "Fibonacci");

  // Inicializar config local solo al montar o cuando cambia el símbolo
  useEffect(() => {
    if (DEBUG) console.log('[FibonacciSettings] useEffect: Inicializando config local');
    setLocalConfig(config);
    setApplyGlobally(false);
  }, [currentSymbol]);

  // Cuando cambia applyGlobally, cargar la config correspondiente
  useEffect(() => {
    if (applyGlobally) {
      const globalPreset = PresetManager.getGlobalPreset("Fibonacci");
      if (DEBUG) console.log('[FibonacciSettings] Cargando preset global:', globalPreset);
      setLocalConfig(globalPreset);
    } else {
      if (DEBUG) console.log('[FibonacciSettings] Cargando config del símbolo:', config);
      setLocalConfig(config);
    }
  }, [applyGlobally]);

  const handleConfigChange = (key, value) => {
    if (DEBUG) console.log(`[FibonacciSettings] handleConfigChange:`, { key, value, applyGlobally });

    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("Fibonacci", newConfig);
      if (DEBUG) console.log(`[FibonacciSettings] ✅ Preset global actualizado:`, newConfig);
      onConfigChange(newConfig, false);
    } else {
      if (DEBUG) console.log(`[FibonacciSettings] ✅ Override guardado para ${currentSymbol}:`, newConfig);
      onConfigChange(newConfig, true);
    }
  };

  const handleLevelChange = (index, value) => {
    if (!localConfig.levels) return;

    const newLevels = [...localConfig.levels];
    newLevels[index] = parseFloat(value);
    const newConfig = { ...localConfig, levels: newLevels };
    setLocalConfig(newConfig);

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("Fibonacci", newConfig);
      onConfigChange(newConfig, false);
    } else {
      onConfigChange(newConfig, true);
    }
  };

  const handleExtensionLevelChange = (index, value) => {
    if (!localConfig.extensionLevels) return;

    const newLevels = [...localConfig.extensionLevels];
    newLevels[index] = parseFloat(value);
    const newConfig = { ...localConfig, extensionLevels: newLevels };
    setLocalConfig(newConfig);

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
      setLocalConfig(globalConfig);
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
              checked={localConfig.autoDetect}
              onChange={(e) => handleConfigChange('autoDetect', e.target.checked)}
            />
            Detectar swing points automáticamente
          </label>
        </div>

        {/* Lookback (solo si autoDetect está activo) */}
        {localConfig.autoDetect && (
          <div className="setting-row">
            <label>Lookback (períodos):</label>
            <input
              type="number"
              min="20"
              max="200"
              value={localConfig.lookback}
              onChange={(e) => handleConfigChange('lookback', parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Show Retracements */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={localConfig.showRetracements}
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
              checked={localConfig.showExtensions}
              onChange={(e) => handleConfigChange('showExtensions', e.target.checked)}
            />
            Mostrar niveles de extensión
          </label>
        </div>

        {/* Label Position */}
        <div className="setting-row">
          <label>Posición de etiquetas:</label>
          <select
            value={localConfig.labelPosition}
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
            value={localConfig.color || 'rgba(33, 150, 243, 0.6)'}
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
            {localConfig.showRetracements && (
              <div className="level-group">
                <h5>Niveles de Retroceso</h5>
                {localConfig.levels.map((level, index) => (
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

            {localConfig.showExtensions && (
              <div className="level-group">
                <h5>Niveles de Extensión</h5>
                {localConfig.extensionLevels.map((level, index) => (
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
                value={localConfig.lineWidth || 1}
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
