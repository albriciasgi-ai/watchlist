// src/components/ContinuationPatternSettings.jsx
import React, { useState } from "react";
import "./ContinuationPatternSettings.css";

const ContinuationPatternSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleConfigChange = (key, value) => {
    onConfigChange({ ...config, [key]: value });
  };

  const handleVWAPConfigChange = (key, value) => {
    handleConfigChange('vwapConfig', {
      ...config.vwapConfig,
      [key]: value
    });
  };

  const handleFibonacciConfigChange = (key, value) => {
    handleConfigChange('fibonacciConfig', {
      ...config.fibonacciConfig,
      [key]: value
    });
  };

  return (
    <div className="continuation-pattern-settings">
      <div className="settings-section">
        <h4>Configuración Continuation Patterns - {currentSymbol}</h4>

        {/* Pattern Type Filters */}
        <div className="pattern-types">
          <h5>Tipos de Patrones</h5>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={config.showContinuation}
                onChange={(e) => handleConfigChange('showContinuation', e.target.checked)}
              />
              🚩 Continuation (banderas, pennants)
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={config.showTrendStart}
                onChange={(e) => handleConfigChange('showTrendStart', e.target.checked)}
              />
              🚀 Trend Start (breakouts)
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={config.showMomentum}
                onChange={(e) => handleConfigChange('showMomentum', e.target.checked)}
              />
              💪 Momentum (soldiers, crows)
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={config.showReversal}
                onChange={(e) => handleConfigChange('showReversal', e.target.checked)}
              />
              🔄 Reversal (hammer, engulfing)
            </label>
          </div>
        </div>

        {/* Confidence Filter */}
        <div className="setting-row">
          <label>Confianza mínima (%):</label>
          <input
            type="number"
            min="0"
            max="100"
            value={config.minConfidence}
            onChange={(e) => handleConfigChange('minConfidence', parseInt(e.target.value))}
          />
        </div>

        {/* Visual Settings */}
        <div className="visual-settings">
          <h5>Visualización</h5>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={config.showLabels}
                onChange={(e) => handleConfigChange('showLabels', e.target.checked)}
              />
              Mostrar etiquetas de patrones
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={config.showConfidence}
                onChange={(e) => handleConfigChange('showConfidence', e.target.checked)}
              />
              Mostrar % de confianza
            </label>
          </div>

          <div className="setting-row">
            <label>Tamaño de icono (px):</label>
            <input
              type="number"
              min="12"
              max="32"
              value={config.iconSize}
              onChange={(e) => handleConfigChange('iconSize', parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼' : '▶'} Level Sources (contexto)
          </button>
        </div>

        {showAdvanced && (
          <div className="advanced-settings">
            <h5>Fuentes de Niveles para Contexto</h5>

            {/* VWAP Source */}
            <div className="source-group">
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={config.includeVWAP}
                    onChange={(e) => handleConfigChange('includeVWAP', e.target.checked)}
                  />
                  Usar niveles VWAP
                </label>
              </div>

              {config.includeVWAP && (
                <div className="sub-settings">
                  <div className="setting-row">
                    <label>Tipo VWAP:</label>
                    <select
                      value={config.vwapConfig.vwap_type}
                      onChange={(e) => handleVWAPConfigChange('vwap_type', e.target.value)}
                    >
                      <option value="session">Session</option>
                      <option value="rolling">Rolling</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.vwapConfig.apply_crypto_adjustment}
                        onChange={(e) => handleVWAPConfigChange('apply_crypto_adjustment', e.target.checked)}
                      />
                      Ajuste crypto
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Fibonacci Source */}
            <div className="source-group">
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={config.includeFibonacci}
                    onChange={(e) => handleConfigChange('includeFibonacci', e.target.checked)}
                  />
                  Usar niveles Fibonacci
                </label>
              </div>

              {config.includeFibonacci && (
                <div className="sub-settings">
                  <div className="setting-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.fibonacciConfig.auto_detect}
                        onChange={(e) => handleFibonacciConfigChange('auto_detect', e.target.checked)}
                      />
                      Auto-detectar swings
                    </label>
                  </div>

                  <div className="setting-row">
                    <label>Lookback:</label>
                    <input
                      type="number"
                      min="20"
                      max="200"
                      value={config.fibonacciConfig.lookback}
                      onChange={(e) => handleFibonacciConfigChange('lookback', parseInt(e.target.value))}
                    />
                  </div>

                  <div className="setting-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.fibonacciConfig.include_extensions}
                        onChange={(e) => handleFibonacciConfigChange('include_extensions', e.target.checked)}
                      />
                      Incluir extensiones
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="settings-hint">
          💡 Los patrones de continuación identifican momentos donde la tendencia probablemente continuará. Los level sources añaden contexto sobre niveles clave.
        </div>
      </div>
    </div>
  );
};

export default ContinuationPatternSettings;
