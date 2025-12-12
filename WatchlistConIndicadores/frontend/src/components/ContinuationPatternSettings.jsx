// src/components/ContinuationPatternSettings.jsx
import React, { useState, useEffect } from "react";
import "./ContinuationPatternSettings.css";

const ContinuationPatternSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showReversalParams, setShowReversalParams] = useState(false);

  // Local state for immediate UI updates
  const [localConfig, setLocalConfig] = useState(config);

  // Sync local state when prop changes
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleConfigChange = (key, value) => {
    const newConfig = { ...localConfig, [key]: value };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleVWAPConfigChange = (key, value) => {
    const newVwapConfig = { ...localConfig.vwapConfig, [key]: value };
    const newConfig = { ...localConfig, vwapConfig: newVwapConfig };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleFibonacciConfigChange = (key, value) => {
    const newFibConfig = { ...localConfig.fibonacciConfig, [key]: value };
    const newConfig = { ...localConfig, fibonacciConfig: newFibConfig };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleReversalParamChange = (key, value) => {
    const currentPatternParams = localConfig.patternParams || {
      reversal: {},
      continuation: {},
      momentum: {}
    };
    const newReversalParams = { ...currentPatternParams.reversal, [key]: value };
    const newPatternParams = { ...currentPatternParams, reversal: newReversalParams };
    const newConfig = { ...localConfig, patternParams: newPatternParams };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
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
                checked={localConfig.showContinuation}
                onChange={(e) => handleConfigChange('showContinuation', e.target.checked)}
              />
              🚩 Continuation (banderas, pennants)
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={localConfig.showTrendStart}
                onChange={(e) => handleConfigChange('showTrendStart', e.target.checked)}
              />
              🚀 Trend Start (breakouts)
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={localConfig.showMomentum}
                onChange={(e) => handleConfigChange('showMomentum', e.target.checked)}
              />
              💪 Momentum (soldiers, crows)
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={localConfig.showReversal}
                onChange={(e) => handleConfigChange('showReversal', e.target.checked)}
              />
              🔄 Reversal (hammer, engulfing, doji)
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
            value={localConfig.minConfidence}
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
                checked={localConfig.showLabels}
                onChange={(e) => handleConfigChange('showLabels', e.target.checked)}
              />
              Mostrar etiquetas de patrones
            </label>
          </div>

          <div className="setting-row">
            <label>
              <input
                type="checkbox"
                checked={localConfig.showConfidence}
                onChange={(e) => handleConfigChange('showConfidence', e.target.checked)}
              />
              Mostrar % de confianza
            </label>
          </div>

          <div className="setting-row">
            <label>Tamaño de icono (px):</label>
            <input
              type="number"
              min="6"
              max="32"
              value={localConfig.iconSize}
              onChange={(e) => handleConfigChange('iconSize', parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* Reversal Pattern Parameters */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowReversalParams(!showReversalParams)}
          >
            {showReversalParams ? '▼' : '▶'} Parámetros de Reversal Patterns
          </button>
        </div>

        {showReversalParams && (
          <div className="advanced-settings">
            <h5>Ajustes de Detección (Hammer, Shooting Star, Engulfing, Doji)</h5>

            {/* Min Wick Ratio */}
            <div className="setting-row">
              <label title="Cuánto más larga debe ser la mecha que el cuerpo. Mayor valor = más estricto">
                Min Wick Ratio:
                <span className="param-hint">Mecha debe ser {localConfig.patternParams?.reversal?.minWickRatio || 1.5}x el cuerpo</span>
              </label>
              <input
                type="number"
                min="1.0"
                max="3.0"
                step="0.1"
                value={localConfig.patternParams?.reversal?.minWickRatio || 1.5}
                onChange={(e) => handleReversalParamChange('minWickRatio', parseFloat(e.target.value))}
              />
            </div>

            {/* Max Opposite Wick */}
            <div className="setting-row">
              <label title="Tamaño máximo permitido de la mecha opuesta (como % del cuerpo). Menor valor = más estricto">
                Max Mecha Opuesta:
                <span className="param-hint">Máx {Math.round((localConfig.patternParams?.reversal?.maxOppositeWick || 0.25) * 100)}% del cuerpo</span>
              </label>
              <input
                type="number"
                min="0.1"
                max="0.5"
                step="0.05"
                value={localConfig.patternParams?.reversal?.maxOppositeWick || 0.25}
                onChange={(e) => handleReversalParamChange('maxOppositeWick', parseFloat(e.target.value))}
              />
            </div>

            {/* Min Body Position */}
            <div className="setting-row">
              <label title="Posición mínima del cuerpo en el rango de la vela (0.5 = 50% del rango). Mayor valor = más estricto">
                Min Posición Cuerpo:
                <span className="param-hint">Mín {Math.round((localConfig.patternParams?.reversal?.minBodyPosition || 0.5) * 100)}% del rango</span>
              </label>
              <input
                type="number"
                min="0.3"
                max="0.8"
                step="0.05"
                value={localConfig.patternParams?.reversal?.minBodyPosition || 0.5}
                onChange={(e) => handleReversalParamChange('minBodyPosition', parseFloat(e.target.value))}
              />
            </div>

            {/* Engulfing Tolerance */}
            <div className="setting-row">
              <label title="Margen permitido para que una vela envuelva a la anterior. 0% = envolvimiento perfecto, mayor % = más tolerante">
                Tolerancia Engulfing:
                <span className="param-hint">{Math.round((localConfig.patternParams?.reversal?.engulfingTolerance || 0.02) * 100)}% margen</span>
              </label>
              <input
                type="number"
                min="0.0"
                max="0.1"
                step="0.01"
                value={localConfig.patternParams?.reversal?.engulfingTolerance || 0.02}
                onChange={(e) => handleReversalParamChange('engulfingTolerance', parseFloat(e.target.value))}
              />
            </div>

            {/* Invert Proximity Logic */}
            <div className="setting-row" style={{marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0'}}>
              <label title="INVERTIR LÓGICA: Dar MÁS confianza a patrones LEJOS de VWAP/Fibonacci (útil para divergencias)">
                <input
                  type="checkbox"
                  checked={localConfig.patternParams?.reversal?.invertProximity || false}
                  onChange={(e) => handleReversalParamChange('invertProximity', e.target.checked)}
                />
                ⚠️ Invertir Proximidad (patrones lejos = más confianza)
              </label>
            </div>

            <div className="settings-hint" style={{marginTop: '10px'}}>
              💡 <strong>Invertir Proximidad:</strong> Normalmente, patrones cerca de VWAP/Fibonacci tienen más confianza.
              Activar esto invierte la lógica - patrones <strong>lejos</strong> de niveles tendrán más confianza.
              Útil para detectar divergencias o agotamiento de tendencia.
            </div>
          </div>
        )}

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
                    checked={localConfig.includeVWAP}
                    onChange={(e) => handleConfigChange('includeVWAP', e.target.checked)}
                  />
                  Usar niveles VWAP
                </label>
              </div>

              {localConfig.includeVWAP && (
                <div className="sub-settings">
                  <div className="setting-row">
                    <label>Tipo VWAP:</label>
                    <select
                      value={localConfig.vwapConfig.vwap_type}
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
                        checked={localConfig.vwapConfig.apply_crypto_adjustment}
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
                    checked={localConfig.includeFibonacci}
                    onChange={(e) => handleConfigChange('includeFibonacci', e.target.checked)}
                  />
                  Usar niveles Fibonacci
                </label>
              </div>

              {localConfig.includeFibonacci && (
                <div className="sub-settings">
                  <div className="setting-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={localConfig.fibonacciConfig.auto_detect}
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
                      value={localConfig.fibonacciConfig.lookback}
                      onChange={(e) => handleFibonacciConfigChange('lookback', parseInt(e.target.value))}
                    />
                  </div>

                  <div className="setting-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={localConfig.fibonacciConfig.include_extensions}
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
