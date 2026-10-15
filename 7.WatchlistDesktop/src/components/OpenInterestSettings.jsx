// src/components/OpenInterestSettings.jsx
import React, { useState, useEffect } from "react";
import "./OpenInterestSettings.css";

const OpenInterestSettings = ({ config, onConfigChange, onApplyToAll, currentSymbol }) => {
  const [localConfig, setLocalConfig] = useState(config);

  // Sincronizar con config externo cuando cambia
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleConfigChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleApplyToAll = () => {
    if (onApplyToAll) {
      onApplyToAll(localConfig);
    }
  };

  return (
    <div className="oi-settings">
      <div className="oi-settings-header">
        <h3>Configuración Open Interest</h3>
        <span className="oi-settings-symbol">{currentSymbol}</span>
      </div>

      <div className="oi-settings-body">
        {/* Modo de visualización */}
        <div className="oi-setting-group">
          <label className="oi-setting-label">
            <span className="label-text">Modo de Visualización</span>
            <span className="label-hint">Cómo se muestra el Open Interest</span>
          </label>

          <div className="oi-mode-selector">
            <button
              className={`oi-mode-btn ${localConfig.mode === 'histogram' ? 'active' : ''}`}
              onClick={() => handleConfigChange('mode', 'histogram')}
            >
              <span className="mode-icon">📊</span>
              <span className="mode-name">Histogram</span>
              <span className="mode-desc">Delta simple</span>
            </button>

            <button
              className={`oi-mode-btn ${localConfig.mode === 'cumulative' ? 'active' : ''}`}
              onClick={() => handleConfigChange('mode', 'cumulative')}
            >
              <span className="mode-icon">📈</span>
              <span className="mode-name">Cumulative</span>
              <span className="mode-desc">OI acumulado</span>
            </button>

            <button
              className={`oi-mode-btn ${localConfig.mode === 'flow' ? 'active' : ''}`}
              onClick={() => handleConfigChange('mode', 'flow')}
            >
              <span className="mode-icon">🌊</span>
              <span className="mode-name">Flow</span>
              <span className="mode-desc">Sentimiento + EMA</span>
            </button>
          </div>
        </div>

        {/* Configuración específica para modo Flow */}
        {localConfig.mode === 'flow' && (
          <>
            <div className="oi-setting-group">
              <label className="oi-setting-label">
                <span className="label-text">Suavizado (EMA)</span>
                <span className="label-hint">Períodos para suavizar el flujo</span>
              </label>

              <div className="slider-container">
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={localConfig.smoothing || 3}
                  onChange={(e) => handleConfigChange('smoothing', parseInt(e.target.value))}
                  className="oi-slider"
                />
                <span className="slider-value">{localConfig.smoothing || 3}</span>
              </div>
            </div>

            <div className="oi-setting-group">
              <label className="oi-checkbox-label">
                <input
                  type="checkbox"
                  checked={localConfig.showPriceSentiment || false}
                  onChange={(e) => handleConfigChange('showPriceSentiment', e.target.checked)}
                />
                <span>Mostrar Price Sentiment</span>
              </label>
              <p className="setting-hint">Correlación entre OI y precio</p>
            </div>
          </>
        )}

        {/* Información del modo actual */}
        <div className="oi-info-box">
          <h4>ℹ️ Acerca del modo {localConfig.mode}</h4>
          {localConfig.mode === 'histogram' && (
            <p>
              <strong>Histogram:</strong> Muestra el cambio de Open Interest vela a vela (delta).
              Similar al Volume Delta, pero para contratos abiertos.
            </p>
          )}
          {localConfig.mode === 'cumulative' && (
            <p>
              <strong>Cumulative:</strong> Muestra el Open Interest acumulado desde el inicio.
              Útil para identificar tendencias a largo plazo en posiciones abiertas.
            </p>
          )}
          {localConfig.mode === 'flow' && (
            <p>
              <strong>Flow:</strong> Análisis avanzado con OI Flow Sentiment (estilo LuxAlgo).
              Combina cambios de OI con EMA para detectar flujos institucionales.
            </p>
          )}
        </div>

        {/* Descripción de colores */}
        <div className="oi-color-legend">
          <h4>Colores</h4>
          <div className="color-item">
            <span className="color-box" style={{ backgroundColor: '#1E88E5' }}></span>
            <span>Azul = OI aumentando (más contratos abiertos)</span>
          </div>
          <div className="color-item">
            <span className="color-box" style={{ backgroundColor: '#FF6F00' }}></span>
            <span>Naranja = OI disminuyendo (contratos cerrándose)</span>
          </div>
        </div>

        {/* Botón para aplicar a todas las monedas */}
        <div className="oi-apply-all-container">
          <button
            className="oi-apply-all-btn"
            onClick={handleApplyToAll}
            title="Aplicar esta configuración a todas las monedas"
          >
            📋 Aplicar a todas las monedas
          </button>
        </div>
      </div>
    </div>
  );
};

export default OpenInterestSettings;
