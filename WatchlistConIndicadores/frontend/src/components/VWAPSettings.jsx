// src/components/VWAPSettings.jsx
import React, { useState } from "react";
import "./VWAPSettings.css";

const VWAPSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleConfigChange = (key, value) => {
    onConfigChange({ ...config, [key]: value });
  };

  const handleBandMultiplierChange = (index, value) => {
    const newMultipliers = [...config.bandMultipliers];
    newMultipliers[index] = parseFloat(value);
    handleConfigChange('bandMultipliers', newMultipliers);
  };

  return (
    <div className="vwap-settings">
      <div className="settings-section">
        <h4>Configuración VWAP - {currentSymbol}</h4>

        {/* VWAP Type */}
        <div className="setting-row">
          <label>Tipo de VWAP:</label>
          <select
            value={config.vwapType}
            onChange={(e) => handleConfigChange('vwapType', e.target.value)}
          >
            <option value="session">Session (reinicia diario)</option>
            <option value="rolling">Rolling (período móvil)</option>
            <option value="anchored">Anchored (desde fecha fija)</option>
          </select>
        </div>

        {/* Reset Hour (solo para session) */}
        {config.vwapType === 'session' && (
          <div className="setting-row">
            <label>Hora de reinicio (UTC):</label>
            <input
              type="number"
              min="0"
              max="23"
              value={config.resetHour}
              onChange={(e) => handleConfigChange('resetHour', parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Rolling Period (solo para rolling) */}
        {config.vwapType === 'rolling' && (
          <div className="setting-row">
            <label>Período (períodos):</label>
            <input
              type="number"
              min="5"
              max="500"
              value={config.rollingPeriod}
              onChange={(e) => handleConfigChange('rollingPeriod', parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Show Bands */}
        <div className="setting-row">
          <label>
            <input
              type="checkbox"
              checked={config.showBands}
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
              checked={config.applyCryptoAdjustment}
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

        {showAdvanced && config.showBands && (
          <div className="advanced-settings">
            <h5>Multiplicadores de Bandas</h5>

            <div className="setting-row">
              <label>Banda 1 (±σ):</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                value={config.bandMultipliers[0]}
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
                value={config.bandMultipliers[1]}
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
                value={config.bandMultipliers[2]}
                onChange={(e) => handleBandMultiplierChange(2, e.target.value)}
              />
            </div>

            <div className="setting-row">
              <label>Color VWAP:</label>
              <input
                type="color"
                value={config.vwapColor || '#FF9800'}
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
