// src/components/VWAPSettings.jsx
import React, { useState, useEffect, useRef } from "react";
import PresetManager from "../utils/PresetManager";
import "./VWAPSettings.css";

const DEBUG = true;

const VWAPSettings = ({
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
    console.log(`[VWAPSettings] Render #${renderCount.current}`, {
      currentSymbol,
      applyGlobally,
      configKeys: Object.keys(config),
      localConfigKeys: Object.keys(localConfig)
    });
  }

  // Verificar si este símbolo tiene un override activo
  const hasOverride = currentSymbol && PresetManager.hasOverride(currentSymbol, "VWAP");

  // Inicializar config local solo al montar o cuando cambia el símbolo
  useEffect(() => {
    if (DEBUG) console.log('[VWAPSettings] useEffect: Inicializando config local', { currentSymbol });
    setLocalConfig(config);
    setApplyGlobally(false);
  }, [currentSymbol]);

  // Cuando cambia applyGlobally, cargar la config correspondiente
  useEffect(() => {
    if (applyGlobally) {
      const globalPreset = PresetManager.getGlobalPreset("VWAP");
      if (DEBUG) console.log('[VWAPSettings] Cargando preset global:', globalPreset);
      setLocalConfig(globalPreset);
    } else {
      if (DEBUG) console.log('[VWAPSettings] Cargando config del símbolo:', config);
      setLocalConfig(config);
    }
  }, [applyGlobally]);

  const handleConfigChange = (key, value) => {
    if (DEBUG) console.log(`[VWAPSettings] handleConfigChange:`, { key, value, applyGlobally });

    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("VWAP", newConfig);
      if (DEBUG) console.log(`[VWAPSettings] ✅ Preset global actualizado:`, newConfig);
      onConfigChange(newConfig, false);
    } else {
      if (DEBUG) console.log(`[VWAPSettings] ✅ Override guardado para ${currentSymbol}:`, newConfig);
      onConfigChange(newConfig, true);
    }
  };

  const handleResetToGlobal = () => {
    if (DEBUG) console.log(`[VWAPSettings] handleResetToGlobal`);

    if (currentSymbol && hasOverride) {
      PresetManager.clearSymbolOverride(currentSymbol, "VWAP");
      const globalConfig = PresetManager.getGlobalPreset("VWAP");
      setLocalConfig(globalConfig);
      onConfigChange(globalConfig, false);
      console.log(`[VWAPSettings] 🔄 ${currentSymbol} reseteado a preset global`);
    }
  };

  const handleBandMultiplierChange = (index, value) => {
    if (DEBUG) console.log(`[VWAPSettings] handleBandMultiplierChange:`, { index, value });

    if (!localConfig.bandMultipliers) {
      console.warn('[VWAPSettings] bandMultipliers is undefined');
      return;
    }

    const newMultipliers = [...localConfig.bandMultipliers];
    newMultipliers[index] = parseFloat(value);
    const newConfig = { ...localConfig, bandMultipliers: newMultipliers };
    setLocalConfig(newConfig);

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("VWAP", newConfig);
      if (DEBUG) console.log(`[VWAPSettings] ✅ Preset global actualizado (bands):`, newConfig);
      onConfigChange(newConfig, false);
    } else {
      if (DEBUG) console.log(`[VWAPSettings] ✅ Override guardado (bands) para ${currentSymbol}:`, newConfig);
      onConfigChange(newConfig, true);
    }
  };

  return (
    <div className="vwap-settings">
      <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ margin: 0 }}>
            Configuración VWAP - {currentSymbol}
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
            <button
              onClick={handleResetToGlobal}
              style={{
                padding: '4px 12px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              🔄 Reset to Global
            </button>
          )}
        </div>

        {/* Apply Globally Checkbox */}
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

        {/* VWAP Type */}
        <div className="setting-row">
          <label>Tipo de VWAP:</label>
          <select
            value={localConfig.vwapType}
            onChange={(e) => handleConfigChange('vwapType', e.target.value)}
          >
            <option value="session">Session (reinicia diario)</option>
            <option value="rolling">Rolling (período móvil)</option>
            <option value="anchored">Anchored (desde fecha fija)</option>
          </select>
        </div>

        {/* Reset Hour (solo para session) */}
        {localConfig.vwapType === 'session' && (
          <div className="setting-row">
            <label>Hora de reinicio (UTC):</label>
            <input
              type="number"
              min="0"
              max="23"
              value={localConfig.resetHour}
              onChange={(e) => handleConfigChange('resetHour', parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Rolling Period (solo para rolling) */}
        {localConfig.vwapType === 'rolling' && (
          <div className="setting-row">
            <label>Período (períodos):</label>
            <input
              type="number"
              min="5"
              max="500"
              value={localConfig.rollingPeriod}
              onChange={(e) => handleConfigChange('rollingPeriod', parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Show Bands */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={localConfig.showBands}
              onChange={(e) => handleConfigChange('showBands', e.target.checked)}
            />
            Mostrar bandas de desviación
          </label>
        </div>

        {/* Crypto Adjustment */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={localConfig.applyCryptoAdjustment}
              onChange={(e) => handleConfigChange('applyCryptoAdjustment', e.target.checked)}
            />
            Ajuste para crypto (1.15x volatilidad)
          </label>
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

        {showAdvanced && localConfig.showBands && localConfig.bandMultipliers && (
          <div className="advanced-settings">
            <h5>Multiplicadores de Bandas</h5>

            <div className="setting-row">
              <label>Banda 1 (±σ):</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                value={localConfig.bandMultipliers[0] || 1.0}
                onChange={(e) => handleBandMultiplierChange(0, e.target.value)}
              />
            </div>

            <div className="setting-row">
              <label>Banda 2 (±σ):</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                value={localConfig.bandMultipliers[1] || 2.0}
                onChange={(e) => handleBandMultiplierChange(1, e.target.value)}
              />
            </div>

            <div className="setting-row">
              <label>Banda 3 (±σ):</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                value={localConfig.bandMultipliers[2] || 3.0}
                onChange={(e) => handleBandMultiplierChange(2, e.target.value)}
              />
            </div>

            <div className="setting-row">
              <label>Color VWAP:</label>
              <input
                type="color"
                value={localConfig.vwapColor || '#FF9800'}
                onChange={(e) => handleConfigChange('vwapColor', e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="settings-hint">
          💡 El VWAP es el precio promedio ponderado por volumen, útil para identificar niveles de valor justo.
        </div>
      </div>
    </div>
  );
};

export default VWAPSettings;
