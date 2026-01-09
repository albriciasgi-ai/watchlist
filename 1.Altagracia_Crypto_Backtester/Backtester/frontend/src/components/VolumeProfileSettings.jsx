// src/components/VolumeProfileSettings.jsx
import React, { useState } from "react";

const VolumeProfileSettings = ({ 
  config, 
  onConfigChange,
  onFixedRangeChange,
  applyToAll,
  onApplyToAllChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const handleConfigChange = (key, value) => {
    onConfigChange({ ...config, [key]: value });
  };

  const handleApplyRange = () => {
    if (!startDate || !endDate) {
      alert("Por favor selecciona fecha de inicio y fecha final");
      return;
    }

    const startTimestamp = new Date(startDate).getTime();
    const endTimestamp = new Date(endDate).getTime();

    if (startTimestamp >= endTimestamp) {
      alert("La fecha de inicio debe ser anterior a la fecha final");
      return;
    }

    onFixedRangeChange(startTimestamp, endTimestamp);
  };

  return (
    <div className="volume-profile-settings">
      <div className="settings-section">
        <h4>Configuración Volume Profile</h4>
        
        {/* Modo */}
        <div className="setting-row">
          <label>Modo:</label>
          <select 
            value={config.mode} 
            onChange={(e) => handleConfigChange('mode', e.target.value)}
          >
            <option value="dynamic">Dynamic</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>

        {/* Fixed Range Controls */}
        {config.mode === "fixed" && (
          <div className="fixed-range-controls">
            <div className="setting-row">
              <label>Fecha inicio:</label>
              <input 
                type="datetime-local" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            
            <div className="setting-row">
              <label>Fecha final:</label>
              <input 
                type="datetime-local" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <div className="setting-row">
              <label>
                <input 
                  type="checkbox" 
                  checked={applyToAll}
                  onChange={(e) => onApplyToAllChange(e.target.checked)}
                />
                Aplicar a todas las monedas
              </label>
              {!applyToAll && (
                <span className="setting-hint">Solo para {currentSymbol}</span>
              )}
            </div>

            <button onClick={handleApplyRange} className="apply-range-btn">
              Aplicar Rango
            </button>
          </div>
        )}

        {/* Position */}
        <div className="setting-row">
          <label>Posición:</label>
          <select 
            value={config.histogramPosition} 
            onChange={(e) => handleConfigChange('histogramPosition', e.target.value)}
          >
            <option value="left">Izquierda</option>
            <option value="center">Centro</option>
            <option value="right">Derecha</option>
          </select>
        </div>

        {/* Width */}
        <div className="setting-row">
          <label>Ancho ({config.histogramWidth}%):</label>
          <input 
            type="range" 
            min="20" 
            max="80" 
            value={config.histogramWidth}
            onChange={(e) => handleConfigChange('histogramWidth', parseInt(e.target.value))}
          />
        </div>

        {/* Toggles */}
        <div className="setting-row">
          <label>
            <input 
              type="checkbox" 
              checked={config.useGradient}
              onChange={(e) => handleConfigChange('useGradient', e.target.checked)}
            />
            Gradiente
          </label>
        </div>

        <div className="setting-row">
          <label>
            <input 
              type="checkbox" 
              checked={config.showLabels}
              onChange={(e) => handleConfigChange('showLabels', e.target.checked)}
            />
            Mostrar Labels
          </label>
        </div>

        {/* Ocultar cuando hay Fixed Ranges */}
        <div className="setting-row">
          <label>
            <input 
              type="checkbox" 
              checked={config.hideWhenFixedRanges || false}
              onChange={(e) => handleConfigChange('hideWhenFixedRanges', e.target.checked)}
            />
            Ocultar cuando hay Fixed Ranges activos
          </label>
        </div>

        {/* FASE 3: Cluster Detection */}
        <div className="setting-row">
          <label>
            <input 
              type="checkbox" 
              checked={config.enableClusterDetection}
              onChange={(e) => handleConfigChange('enableClusterDetection', e.target.checked)}
            />
            Detectar Clusters
          </label>
        </div>

        {config.enableClusterDetection && (
          <div className="setting-row indent">
            <label>Threshold ({config.clusterThreshold}x):</label>
            <input 
              type="range" 
              min="1.2" 
              max="3" 
              step="0.1"
              value={config.clusterThreshold}
              onChange={(e) => handleConfigChange('clusterThreshold', parseFloat(e.target.value))}
            />
          </div>
        )}

        {/* FASE 3: Volume Labels */}
        <div className="setting-row">
          <label>
            <input 
              type="checkbox" 
              checked={config.showVolumeLabels}
              onChange={(e) => handleConfigChange('showVolumeLabels', e.target.checked)}
            />
            Labels de Volumen
          </label>
        </div>

        {/* Advanced Settings */}
        <div className="advanced-toggle">
          <button 
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="toggle-advanced-btn"
          >
            {showAdvanced ? "▼" : "▶"} Avanzado
          </button>
        </div>

        {showAdvanced && (
          <div className="advanced-settings">
            {/* Rows */}
            <div className="setting-row">
              <label>Niveles ({config.rows}):</label>
              <input 
                type="range" 
                min="50" 
                max="200" 
                value={config.rows}
                onChange={(e) => handleConfigChange('rows', parseInt(e.target.value))}
              />
            </div>

            {/* Value Area % */}
            <div className="setting-row">
              <label>Value Area ({(config.valueAreaPercent * 100).toFixed(0)}%):</label>
              <input 
                type="range" 
                min="0.50" 
                max="0.90" 
                step="0.05"
                value={config.valueAreaPercent}
                onChange={(e) => handleConfigChange('valueAreaPercent', parseFloat(e.target.value))}
              />
            </div>

            {/* Colors */}
            <div className="color-settings">
              <h5>Colores</h5>
              
              <div className="setting-row">
                <label>Base:</label>
                <input 
                  type="color" 
                  value={config.baseColor}
                  onChange={(e) => handleConfigChange('baseColor', e.target.value)}
                />
              </div>

              <div className="setting-row">
                <label>Value Area:</label>
                <input 
                  type="color" 
                  value={config.valueAreaColor}
                  onChange={(e) => handleConfigChange('valueAreaColor', e.target.value)}
                />
              </div>

              <div className="setting-row">
                <label>POC:</label>
                <input 
                  type="color" 
                  value={config.pocColor}
                  onChange={(e) => handleConfigChange('pocColor', e.target.value)}
                />
              </div>

              <div className="setting-row">
                <label>VAH/VAL:</label>
                <input 
                  type="color" 
                  value={config.vahValColor}
                  onChange={(e) => handleConfigChange('vahValColor', e.target.value)}
                />
              </div>

              {config.enableClusterDetection && (
                <div className="setting-row">
                  <label>Clusters:</label>
                  <input 
                    type="color" 
                    value={config.clusterColor}
                    onChange={(e) => handleConfigChange('clusterColor', e.target.value)}
                  />
                </div>
              )}

              {/* NUEVO: Color del sombreado del rango en modo Fixed */}
              {config.mode === "fixed" && (
                <div className="setting-row">
                  <label>Sombreado Rango:</label>
                  <input 
                    type="color" 
                    value={config.rangeShadeColor || "#E0E0E0"}
                    onChange={(e) => handleConfigChange('rangeShadeColor', e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VolumeProfileSettings;
