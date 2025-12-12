// src/components/ContinuationPatternSettings.jsx
import React, { useState, useEffect } from "react";
import "./ContinuationPatternSettings.css";
import { getPresetNames, getPresetConfig } from "./presets/ContinuationPatternPresets";
import {
  getUserPresets,
  saveUserPreset,
  deleteUserPreset,
  getUserPresetConfig,
  getUserPresetNames,
  isUserPreset
} from "./presets/UserPresetManager";

const ContinuationPatternSettings = ({
  config,
  onConfigChange,
  currentSymbol
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showReversalParams, setShowReversalParams] = useState(false);
  const [showContinuationParams, setShowContinuationParams] = useState(false);
  const [showTrendStartParams, setShowTrendStartParams] = useState(false);
  const [showMomentumParams, setShowMomentumParams] = useState(false);
  const [showPatternEnables, setShowPatternEnables] = useState(false);

  // Local state for immediate UI updates
  const [localConfig, setLocalConfig] = useState(config);

  // Preset management state
  const [currentPresetKey, setCurrentPresetKey] = useState('custom');
  const [newPresetName, setNewPresetName] = useState('');
  const [userPresets, setUserPresets] = useState({});
  const [saveMessage, setSaveMessage] = useState('');

  // Sync local state when prop changes
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  // Load user presets on mount
  useEffect(() => {
    const loadedUserPresets = getUserPresets();
    setUserPresets(loadedUserPresets);
  }, []);

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
      trendStart: {},
      momentum: {}
    };
    const newReversalParams = { ...currentPatternParams.reversal, [key]: value };
    const newPatternParams = { ...currentPatternParams, reversal: newReversalParams };
    const newConfig = { ...localConfig, patternParams: newPatternParams };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleContinuationParamChange = (key, value) => {
    const currentPatternParams = localConfig.patternParams || {
      reversal: {},
      continuation: {},
      trendStart: {},
      momentum: {}
    };
    const newContinuationParams = { ...currentPatternParams.continuation, [key]: value };
    const newPatternParams = { ...currentPatternParams, continuation: newContinuationParams };
    const newConfig = { ...localConfig, patternParams: newPatternParams };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleTrendStartParamChange = (key, value) => {
    const currentPatternParams = localConfig.patternParams || {
      reversal: {},
      continuation: {},
      trendStart: {},
      momentum: {}
    };
    const newTrendStartParams = { ...currentPatternParams.trendStart, [key]: value };
    const newPatternParams = { ...currentPatternParams, trendStart: newTrendStartParams };
    const newConfig = { ...localConfig, patternParams: newPatternParams };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleMomentumParamChange = (key, value) => {
    const currentPatternParams = localConfig.patternParams || {
      reversal: {},
      continuation: {},
      trendStart: {},
      momentum: {}
    };
    const newMomentumParams = { ...currentPatternParams.momentum, [key]: value };
    const newPatternParams = { ...currentPatternParams, momentum: newMomentumParams };
    const newConfig = { ...localConfig, patternParams: newPatternParams };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handlePatternEnableChange = (patternName, enabled) => {
    const currentPatternEnables = localConfig.patternEnables || {};
    const newPatternEnables = { ...currentPatternEnables, [patternName]: enabled };
    const newConfig = { ...localConfig, patternEnables: newPatternEnables };
    setLocalConfig(newConfig);
    onConfigChange(newConfig);
  };

  // Get all presets (predefined + user)
  const getAllPresets = () => {
    const predefined = getPresetNames().map(p => ({ ...p, isUserPreset: false }));
    const user = getUserPresetNames();
    return [...predefined, ...user];
  };

  const handlePresetLoad = (presetKey) => {
    if (presetKey === 'custom') {
      setCurrentPresetKey('custom');
      return;
    }

    let presetConfig = null;

    // Check if it's a user preset
    if (isUserPreset(presetKey)) {
      presetConfig = getUserPresetConfig(presetKey);
    } else {
      // Predefined preset
      presetConfig = getPresetConfig(presetKey);
    }

    if (presetConfig) {
      setLocalConfig(presetConfig);
      onConfigChange(presetConfig);
      setCurrentPresetKey(presetKey);
      setSaveMessage('');
    }
  };

  const handleSavePreset = () => {
    if (!newPresetName || !newPresetName.trim()) {
      setSaveMessage('⚠️ Ingresa un nombre para el preset');
      return;
    }

    const success = saveUserPreset(newPresetName, localConfig, `Preset personalizado guardado el ${new Date().toLocaleDateString()}`);

    if (success) {
      setSaveMessage(`✅ Preset "${newPresetName}" guardado exitosamente`);
      setNewPresetName('');

      // Reload user presets
      const loadedUserPresets = getUserPresets();
      setUserPresets(loadedUserPresets);

      // Set as current preset
      const presetKey = `user_${newPresetName.toLowerCase().replace(/\s+/g, '_')}`;
      setCurrentPresetKey(presetKey);

      // Clear message after 3 seconds
      setTimeout(() => setSaveMessage(''), 3000);
    } else {
      setSaveMessage('❌ Error al guardar preset');
    }
  };

  const handleDeletePreset = () => {
    if (!isUserPreset(currentPresetKey)) {
      setSaveMessage('⚠️ No puedes eliminar presets predefinidos');
      return;
    }

    if (!window.confirm(`¿Estás seguro de eliminar el preset "${currentPresetKey}"?`)) {
      return;
    }

    const success = deleteUserPreset(currentPresetKey);

    if (success) {
      setSaveMessage('✅ Preset eliminado exitosamente');

      // Reload user presets
      const loadedUserPresets = getUserPresets();
      setUserPresets(loadedUserPresets);

      // Reset to custom
      setCurrentPresetKey('custom');

      // Clear message after 3 seconds
      setTimeout(() => setSaveMessage(''), 3000);
    } else {
      setSaveMessage('❌ Error al eliminar preset');
    }
  };

  return (
    <div className="continuation-pattern-settings">
      <div className="settings-section">
        <h4>Configuración Continuation Patterns - {currentSymbol}</h4>

        {/* Preset Management System */}
        <div className="preset-selector" style={{
          marginBottom: '15px',
          padding: '12px',
          background: '#f0f8ff',
          borderRadius: '6px',
          border: '2px solid #4CAF50'
        }}>
          <h5 style={{margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold', color: '#4CAF50'}}>
            📋 Gestión de Presets
          </h5>

          {/* Load Preset */}
          <div className="setting-row" style={{marginBottom: '10px'}}>
            <label style={{fontWeight: 'bold', fontSize: '12px'}}>
              Cargar Preset:
            </label>
            <select
              style={{
                background: '#ffffff',
                border: '1px solid #4CAF50',
                color: '#333333',
                padding: '6px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                width: '240px',
                fontWeight: 'normal'
              }}
              onChange={(e) => handlePresetLoad(e.target.value)}
              value={currentPresetKey}
            >
              <option value="custom">-- Custom / Actual --</option>

              {/* Predefined Presets */}
              <optgroup label="━━━ Presets Predefinidos ━━━">
                {getPresetNames().map(preset => (
                  <option key={preset.key} value={preset.key}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>

              {/* User Presets */}
              {getUserPresetNames().length > 0 && (
                <optgroup label="━━━ Mis Presets ━━━">
                  {getUserPresetNames().map(preset => (
                    <option key={preset.key} value={preset.key}>
                      ⭐ {preset.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Save New Preset */}
          <div style={{
            padding: '10px',
            background: '#ffffff',
            borderRadius: '4px',
            border: '1px dashed #4CAF50',
            marginBottom: '10px'
          }}>
            <div className="setting-row" style={{marginBottom: '8px'}}>
              <label style={{fontSize: '11px', fontWeight: 'bold'}}>
                Guardar configuración actual como:
              </label>
            </div>
            <div className="setting-row" style={{gap: '5px', alignItems: 'stretch'}}>
              <input
                type="text"
                placeholder="Nombre del preset..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                style={{
                  flex: 1,
                  background: '#f5f5f5',
                  border: '1px solid #cccccc',
                  color: '#333333',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  fontSize: '12px'
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handleSavePreset();
                }}
              />
              <button
                onClick={handleSavePreset}
                style={{
                  background: '#4CAF50',
                  border: 'none',
                  color: 'white',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                💾 Guardar
              </button>
            </div>
          </div>

          {/* Delete Preset (only for user presets) */}
          {isUserPreset(currentPresetKey) && (
            <div style={{marginBottom: '10px'}}>
              <button
                onClick={handleDeletePreset}
                style={{
                  background: '#f44336',
                  border: 'none',
                  color: 'white',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  width: '100%'
                }}
              >
                🗑️ Eliminar preset actual
              </button>
            </div>
          )}

          {/* Save Message */}
          {saveMessage && (
            <div style={{
              padding: '8px',
              background: saveMessage.startsWith('✅') ? '#d4edda' : '#f8d7da',
              border: saveMessage.startsWith('✅') ? '1px solid #c3e6cb' : '1px solid #f5c6cb',
              borderRadius: '4px',
              fontSize: '11px',
              color: saveMessage.startsWith('✅') ? '#155724' : '#721c24',
              marginTop: '8px'
            }}>
              {saveMessage}
            </div>
          )}

          <div style={{
            fontSize: '10px',
            color: '#666',
            marginTop: '8px',
            fontStyle: 'italic',
            lineHeight: '1.4'
          }}>
            💡 Los presets predefinidos no se pueden editar. Guarda tu configuración personalizada con un nombre único.
          </div>
        </div>

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

        {/* Continuation Pattern Parameters */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowContinuationParams(!showContinuationParams)}
          >
            {showContinuationParams ? '▼' : '▶'} Parámetros de Continuation Patterns
          </button>
        </div>

        {showContinuationParams && (
          <div className="advanced-settings">
            <h5>Ajustes de Detección (Flags, Pennants)</h5>

            {/* Max Consolidation Range */}
            <div className="setting-row">
              <label title="Rango máximo de consolidación como % del precio. Menor valor = más estricto">
                Max Rango Consolidación:
                <span className="param-hint">{Math.round((localConfig.patternParams?.continuation?.maxConsolidationRange || 0.03) * 100)}% del precio</span>
              </label>
              <input
                type="number"
                min="0.01"
                max="0.05"
                step="0.005"
                value={localConfig.patternParams?.continuation?.maxConsolidationRange || 0.03}
                onChange={(e) => handleContinuationParamChange('maxConsolidationRange', parseFloat(e.target.value))}
              />
            </div>

            {/* Min Breakout Size */}
            <div className="setting-row">
              <label title="Tamaño mínimo del breakout como % del precio. Mayor valor = más estricto">
                Min Tamaño Breakout:
                <span className="param-hint">{Math.round((localConfig.patternParams?.continuation?.minBreakoutSize || 0.01) * 100)}% del precio</span>
              </label>
              <input
                type="number"
                min="0.005"
                max="0.03"
                step="0.005"
                value={localConfig.patternParams?.continuation?.minBreakoutSize || 0.01}
                onChange={(e) => handleContinuationParamChange('minBreakoutSize', parseFloat(e.target.value))}
              />
            </div>

            {/* Min Trend Strength */}
            <div className="setting-row">
              <label title="Fuerza mínima de la tendencia previa (0-100). Mayor valor = requiere tendencia más fuerte">
                Min Fuerza Tendencia:
                <span className="param-hint">Mínimo {localConfig.patternParams?.continuation?.minTrendStrength || 60}%</span>
              </label>
              <input
                type="number"
                min="40"
                max="80"
                step="5"
                value={localConfig.patternParams?.continuation?.minTrendStrength || 60}
                onChange={(e) => handleContinuationParamChange('minTrendStrength', parseInt(e.target.value))}
              />
            </div>

            {/* Invert Proximity Logic */}
            <div className="setting-row" style={{marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0'}}>
              <label title="INVERTIR LÓGICA: Dar MÁS confianza a patrones LEJOS de VWAP/Fibonacci">
                <input
                  type="checkbox"
                  checked={localConfig.patternParams?.continuation?.invertProximity || false}
                  onChange={(e) => handleContinuationParamChange('invertProximity', e.target.checked)}
                />
                ⚠️ Invertir Proximidad (patrones lejos = más confianza)
              </label>
            </div>
          </div>
        )}

        {/* Trend Start Pattern Parameters */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowTrendStartParams(!showTrendStartParams)}
          >
            {showTrendStartParams ? '▼' : '▶'} Parámetros de Trend Start Patterns
          </button>
        </div>

        {showTrendStartParams && (
          <div className="advanced-settings">
            <h5>Ajustes de Detección (Breakouts)</h5>

            {/* Min Breakout Size */}
            <div className="setting-row">
              <label title="Tamaño mínimo del breakout como % del precio. Mayor valor = más estricto">
                Min Tamaño Breakout:
                <span className="param-hint">{Math.round((localConfig.patternParams?.trendStart?.minBreakoutSize || 0.02) * 100)}% del precio</span>
              </label>
              <input
                type="number"
                min="0.01"
                max="0.05"
                step="0.005"
                value={localConfig.patternParams?.trendStart?.minBreakoutSize || 0.02}
                onChange={(e) => handleTrendStartParamChange('minBreakoutSize', parseFloat(e.target.value))}
              />
            </div>

            {/* Invert Proximity Logic */}
            <div className="setting-row" style={{marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0'}}>
              <label title="INVERTIR LÓGICA: Dar MÁS confianza a patrones LEJOS de VWAP/Fibonacci">
                <input
                  type="checkbox"
                  checked={localConfig.patternParams?.trendStart?.invertProximity || false}
                  onChange={(e) => handleTrendStartParamChange('invertProximity', e.target.checked)}
                />
                ⚠️ Invertir Proximidad (patrones lejos = más confianza)
              </label>
            </div>
          </div>
        )}

        {/* Momentum Pattern Parameters */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowMomentumParams(!showMomentumParams)}
          >
            {showMomentumParams ? '▼' : '▶'} Parámetros de Momentum Patterns
          </button>
        </div>

        {showMomentumParams && (
          <div className="advanced-settings">
            <h5>Ajustes de Detección (Soldiers, Crows, Marubozu)</h5>

            {/* Min Body Percent */}
            <div className="setting-row">
              <label title="Tamaño mínimo del cuerpo como % del rango total de la vela. Mayor valor = más estricto">
                Min % Cuerpo:
                <span className="param-hint">Mínimo {Math.round((localConfig.patternParams?.momentum?.minBodyPercent || 0.3) * 100)}% del rango</span>
              </label>
              <input
                type="number"
                min="0.2"
                max="0.5"
                step="0.05"
                value={localConfig.patternParams?.momentum?.minBodyPercent || 0.3}
                onChange={(e) => handleMomentumParamChange('minBodyPercent', parseFloat(e.target.value))}
              />
            </div>

            {/* Min Consecutive */}
            <div className="setting-row">
              <label title="Número mínimo de velas consecutivas para soldiers/crows">
                Min Velas Consecutivas:
                <span className="param-hint">Mínimo {localConfig.patternParams?.momentum?.minConsecutive || 3} velas</span>
              </label>
              <input
                type="number"
                min="2"
                max="4"
                step="1"
                value={localConfig.patternParams?.momentum?.minConsecutive || 3}
                onChange={(e) => handleMomentumParamChange('minConsecutive', parseInt(e.target.value))}
              />
            </div>

            {/* Invert Proximity Logic */}
            <div className="setting-row" style={{marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #e0e0e0'}}>
              <label title="INVERTIR LÓGICA: Dar MÁS confianza a patrones LEJOS de VWAP/Fibonacci">
                <input
                  type="checkbox"
                  checked={localConfig.patternParams?.momentum?.invertProximity || false}
                  onChange={(e) => handleMomentumParamChange('invertProximity', e.target.checked)}
                />
                ⚠️ Invertir Proximidad (patrones lejos = más confianza)
              </label>
            </div>
          </div>
        )}

        {/* Individual Pattern Toggles */}
        <div className="setting-row">
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowPatternEnables(!showPatternEnables)}
          >
            {showPatternEnables ? '▼' : '▶'} Activar/Desactivar Patrones Individuales
          </button>
        </div>

        {showPatternEnables && (
          <div className="advanced-settings">
            {/* Reversal Patterns */}
            <div className="source-group">
              <h5 style={{margin: '0 0 10px 0', fontSize: '11px', fontWeight: 600, color: '#4CAF50'}}>
                🔄 Reversal Patterns
              </h5>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.hammer !== false}
                    onChange={(e) => handlePatternEnableChange('hammer', e.target.checked)}
                  />
                  🔨 Hammer
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.shooting_star !== false}
                    onChange={(e) => handlePatternEnableChange('shooting_star', e.target.checked)}
                  />
                  ⭐ Shooting Star
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bull_engulfing !== false}
                    onChange={(e) => handlePatternEnableChange('bull_engulfing', e.target.checked)}
                  />
                  📈 Bull Engulfing
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bear_engulfing !== false}
                    onChange={(e) => handlePatternEnableChange('bear_engulfing', e.target.checked)}
                  />
                  📉 Bear Engulfing
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.dragonfly_doji !== false}
                    onChange={(e) => handlePatternEnableChange('dragonfly_doji', e.target.checked)}
                  />
                  🐉 Dragonfly Doji
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.gravestone_doji !== false}
                    onChange={(e) => handlePatternEnableChange('gravestone_doji', e.target.checked)}
                  />
                  🪦 Gravestone Doji
                </label>
              </div>
            </div>

            {/* Continuation Patterns */}
            <div className="source-group">
              <h5 style={{margin: '0 0 10px 0', fontSize: '11px', fontWeight: 600, color: '#4CAF50'}}>
                🚩 Continuation Patterns
              </h5>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bull_flag !== false}
                    onChange={(e) => handlePatternEnableChange('bull_flag', e.target.checked)}
                  />
                  🟢 Bull Flag
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bear_flag !== false}
                    onChange={(e) => handlePatternEnableChange('bear_flag', e.target.checked)}
                  />
                  🔴 Bear Flag
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bull_pennant !== false}
                    onChange={(e) => handlePatternEnableChange('bull_pennant', e.target.checked)}
                  />
                  📐 Bull Pennant
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bear_pennant !== false}
                    onChange={(e) => handlePatternEnableChange('bear_pennant', e.target.checked)}
                  />
                  📐 Bear Pennant
                </label>
              </div>
            </div>

            {/* Trend Start Patterns */}
            <div className="source-group">
              <h5 style={{margin: '0 0 10px 0', fontSize: '11px', fontWeight: 600, color: '#4CAF50'}}>
                🚀 Trend Start Patterns
              </h5>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bull_breakout !== false}
                    onChange={(e) => handlePatternEnableChange('bull_breakout', e.target.checked)}
                  />
                  ⬆️ Bull Breakout
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bear_breakout !== false}
                    onChange={(e) => handlePatternEnableChange('bear_breakout', e.target.checked)}
                  />
                  ⬇️ Bear Breakout
                </label>
              </div>
            </div>

            {/* Momentum Patterns */}
            <div className="source-group">
              <h5 style={{margin: '0 0 10px 0', fontSize: '11px', fontWeight: 600, color: '#4CAF50'}}>
                💪 Momentum Patterns
              </h5>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.three_white_soldiers !== false}
                    onChange={(e) => handlePatternEnableChange('three_white_soldiers', e.target.checked)}
                  />
                  ⚪⚪⚪ Three White Soldiers
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.three_black_crows !== false}
                    onChange={(e) => handlePatternEnableChange('three_black_crows', e.target.checked)}
                  />
                  ⚫⚫⚫ Three Black Crows
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bull_marubozu !== false}
                    onChange={(e) => handlePatternEnableChange('bull_marubozu', e.target.checked)}
                  />
                  🟩 Bull Marubozu
                </label>
              </div>
              <div className="setting-row">
                <label>
                  <input
                    type="checkbox"
                    checked={localConfig.patternEnables?.bear_marubozu !== false}
                    onChange={(e) => handlePatternEnableChange('bear_marubozu', e.target.checked)}
                  />
                  🟥 Bear Marubozu
                </label>
              </div>
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
