// src/components/VWAPSettings.jsx
import React, { useState, useEffect, useRef } from "react";
import PresetManager from "../utils/PresetManager";
import "./VWAPSettings.css";

const DEBUG = true;

// Helper functions for color conversion
const rgbaToHex = (rgba) => {
  if (!rgba || typeof rgba !== 'string') return '#FF9800';

  // If already hex, return as is
  if (rgba.startsWith('#')) return rgba;

  // Parse rgba string
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#FF9800';

  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);

  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

const hexToRgba = (hex, alpha = 0.3) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(255, 152, 0, ${alpha})`;

  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Get recommended BandWidth thresholds by timeframe (same logic as VWAPIndicator)
const getRecommendedBandWidthThresholds = (interval) => {
  const thresholdsByTimeframe = {
    // Ultra-short (scalping): bandas muy amplias
    '1': { squeeze: 8, consolidation: 12, normal: 18 },
    '3': { squeeze: 6, consolidation: 10, normal: 15 },
    '5': { squeeze: 5, consolidation: 8, normal: 12 },

    // Short-term (intraday): bandas moderadas
    '15': { squeeze: 3.5, consolidation: 6, normal: 10 },
    '30': { squeeze: 3, consolidation: 5, normal: 8 },
    '60': { squeeze: 2.5, consolidation: 4.5, normal: 7 },

    // Medium-term (swing): bandas estándar
    '240': { squeeze: 2, consolidation: 4, normal: 6 },
    'D': { squeeze: 1.5, consolidation: 3, normal: 5 },

    // Long-term (position): bandas estrechas
    'W': { squeeze: 1, consolidation: 2, normal: 4 }
  };

  return thresholdsByTimeframe[interval] || { squeeze: 2, consolidation: 5, normal: 10 };
};

const VWAPSettings = ({
  config,
  onConfigChange,
  currentSymbol,
  interval = '60' // Timeframe actual
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [applyGlobally, setApplyGlobally] = useState(false);
  const [localConfig, setLocalConfig] = useState(config);
  const [showPresets, setShowPresets] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState([]);
  const renderCount = useRef(0);
  const isUpdatingRef = useRef(false); // Evita loops en useEffect

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

  // Cargar presets guardados
  useEffect(() => {
    const loadPresets = () => {
      try {
        const saved = localStorage.getItem('vwap_custom_presets');
        if (saved) {
          const presets = JSON.parse(saved);
          setSavedPresets(presets);
          if (DEBUG) console.log('[VWAPSettings] Presets cargados:', presets);
        }
      } catch (e) {
        console.error('[VWAPSettings] Error cargando presets:', e);
      }
    };
    loadPresets();
  }, []);

  // Guardar preset actual
  const handleSavePreset = () => {
    if (!presetName.trim()) {
      alert('Por favor ingresa un nombre para el preset');
      return;
    }

    const newPreset = {
      name: presetName.trim(),
      config: { ...localConfig },
      createdAt: new Date().toISOString()
    };

    const updatedPresets = [...savedPresets.filter(p => p.name !== presetName.trim()), newPreset];
    setSavedPresets(updatedPresets);
    localStorage.setItem('vwap_custom_presets', JSON.stringify(updatedPresets));

    setPresetName('');
    alert(`✅ Preset "${newPreset.name}" guardado correctamente`);
    if (DEBUG) console.log('[VWAPSettings] Preset guardado:', newPreset);
  };

  // Cargar preset
  const handleLoadPreset = (preset) => {
    if (DEBUG) console.log('[VWAPSettings] Cargando preset:', preset);

    setLocalConfig(preset.config);

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("VWAP", preset.config);
      onConfigChange(preset.config, false);
    } else {
      onConfigChange(preset.config, true);
    }

    alert(`✅ Preset "${preset.name}" cargado`);
  };

  // Eliminar preset
  const handleDeletePreset = (presetToDelete) => {
    if (confirm(`¿Eliminar el preset "${presetToDelete.name}"?`)) {
      const updatedPresets = savedPresets.filter(p => p.name !== presetToDelete.name);
      setSavedPresets(updatedPresets);
      localStorage.setItem('vwap_custom_presets', JSON.stringify(updatedPresets));
      alert(`🗑️ Preset "${presetToDelete.name}" eliminado`);
      if (DEBUG) console.log('[VWAPSettings] Preset eliminado:', presetToDelete);
    }
  };

  // Restaurar valores por defecto de volatilidad para el timeframe actual
  const handleRestoreDefaults = () => {
    const recommended = getRecommendedBandWidthThresholds(interval);

    const defaultConfig = {
      ...localConfig,
      bandWidthThresholds: recommended,
      bbwpLookback: 252,
      bbwpThresholds: { squeeze: 20, normal: 80 },
      ttmATRLength: 20,
      ttmATRMultiplier: 1.5
    };

    setLocalConfig(defaultConfig);
    handleConfigChange('bandWidthThresholds', recommended);
    handleConfigChange('bbwpLookback', 252);
    handleConfigChange('bbwpThresholds', { squeeze: 20, normal: 80 });
    handleConfigChange('ttmATRLength', 20);
    handleConfigChange('ttmATRMultiplier', 1.5);

    alert(`✅ Valores restaurados a los recomendados para ${interval} min`);
  };

  // Inicializar config local solo al montar o cuando cambia el símbolo
  useEffect(() => {
    if (DEBUG) console.log('[VWAPSettings] useEffect: Inicializando config local', { currentSymbol, config });

    // Asegurar que rollingPeriod tenga un valor por defecto
    const configWithDefaults = {
      ...config,
      rollingPeriod: config.rollingPeriod !== undefined ? config.rollingPeriod : 20
    };

    if (DEBUG) console.log('[VWAPSettings] Config with defaults:', configWithDefaults);
    setLocalConfig(configWithDefaults);
    setApplyGlobally(false);
  }, [currentSymbol]);

  // Cuando cambia applyGlobally, cargar la config correspondiente
  useEffect(() => {
    // Solo ejecutar cuando applyGlobally cambia, NO cuando config cambia
    // (config puede cambiar debido a nuestras propias actualizaciones)
    if (DEBUG) console.log('[VWAPSettings] useEffect applyGlobally triggered:', { applyGlobally, isUpdating: isUpdatingRef.current });

    // No sobrescribir si estamos en medio de una actualización del usuario
    if (isUpdatingRef.current) {
      if (DEBUG) console.log('[VWAPSettings] Skipping useEffect - user is updating');
      return;
    }

    if (applyGlobally) {
      const globalPreset = PresetManager.getGlobalPreset("VWAP");
      const presetWithDefaults = {
        ...globalPreset,
        rollingPeriod: globalPreset.rollingPeriod !== undefined ? globalPreset.rollingPeriod : 20
      };
      if (DEBUG) console.log('[VWAPSettings] Cargando preset global:', presetWithDefaults);
      setLocalConfig(presetWithDefaults);
    } else {
      const configWithDefaults = {
        ...config,
        rollingPeriod: config.rollingPeriod !== undefined ? config.rollingPeriod : 20
      };
      if (DEBUG) console.log('[VWAPSettings] Cargando config del símbolo:', configWithDefaults);
      setLocalConfig(configWithDefaults);
    }
  }, [applyGlobally]); // Removí 'config' de las dependencias para evitar loops

  // Helper para obtener el valor del rolling period con fallback
  const getRollingPeriodValue = () => {
    const value = localConfig.rollingPeriod;
    if (value !== undefined && value !== null && !isNaN(value)) {
      return Number(value);
    }
    if (DEBUG) console.log('[VWAPSettings] ⚠️ rollingPeriod inválido, usando default 20:', value);
    return 20;
  };

  const handleConfigChange = (key, value) => {
    if (DEBUG) console.log(`[VWAPSettings] handleConfigChange:`, { key, value, applyGlobally, currentLocalConfig: localConfig });

    // Marcar que estamos actualizando para evitar que useEffect sobrescriba
    isUpdatingRef.current = true;

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

    // Resetear después de un breve delay para permitir que se complete la actualización
    setTimeout(() => {
      isUpdatingRef.current = false;
      if (DEBUG) console.log('[VWAPSettings] Actualización completa, isUpdatingRef reset');
    }, 100);
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

    isUpdatingRef.current = true;

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

    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 100);
  };

  const handleBandColorChange = (bandKey, hexColor) => {
    if (DEBUG) console.log(`[VWAPSettings] handleBandColorChange:`, { bandKey, hexColor });

    isUpdatingRef.current = true;

    // Extract current alpha value from existing color (if any)
    const currentColor = localConfig.bandColors?.[bandKey];
    let alpha = 0.3; // default

    if (currentColor && typeof currentColor === 'string') {
      const alphaMatch = currentColor.match(/rgba?\([^,]+,[^,]+,[^,]+,?\s*([\d.]+)?\)/);
      if (alphaMatch && alphaMatch[1]) {
        alpha = parseFloat(alphaMatch[1]);
      }
    }

    // Set default alpha based on band (closer bands = more opaque)
    if (bandKey === 'band1') alpha = alpha || 0.4;
    if (bandKey === 'band2') alpha = alpha || 0.25;
    if (bandKey === 'band3') alpha = alpha || 0.15;

    // Convert hex to rgba preserving alpha
    const rgbaColor = hexToRgba(hexColor, alpha);

    const newBandColors = { ...(localConfig.bandColors || {}), [bandKey]: rgbaColor };
    const newConfig = { ...localConfig, bandColors: newBandColors };
    setLocalConfig(newConfig);

    if (applyGlobally) {
      PresetManager.updateGlobalPreset("VWAP", newConfig);
      if (DEBUG) console.log(`[VWAPSettings] ✅ Preset global actualizado (band colors):`, newConfig);
      onConfigChange(newConfig, false);
    } else {
      if (DEBUG) console.log(`[VWAPSettings] ✅ Override guardado (band colors) para ${currentSymbol}:`, newConfig);
      onConfigChange(newConfig, true);
    }

    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 100);
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

        {/* Presets Personalizados */}
        <div className="setting-row" style={{ marginBottom: '16px' }}>
          <button
            className="toggle-advanced-btn"
            onClick={() => setShowPresets(!showPresets)}
            style={{
              width: '100%',
              padding: '12px',
              background: showPresets ? '#4CAF50' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px'
            }}
          >
            {showPresets ? '▼' : '▶'} 💾 Presets Personalizados ({savedPresets.length})
          </button>
        </div>

        {showPresets && (
          <div style={{
            background: '#f5f5f5',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '16px',
            border: '2px solid #4CAF50'
          }}>
            {/* Guardar nuevo preset */}
            <div style={{ marginBottom: '16px' }}>
              <h5 style={{ margin: '0 0 12px 0', color: '#4CAF50' }}>💾 Guardar Configuración Actual</h5>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Nombre del preset (ej: VWAP Agresivo)"
                  style={{
                    flex: 1,
                    padding: '10px',
                    fontSize: '14px',
                    border: '2px solid #4CAF50',
                    borderRadius: '6px'
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') handleSavePreset();
                  }}
                />
                <button
                  onClick={handleSavePreset}
                  style={{
                    padding: '10px 20px',
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  💾 Guardar
                </button>
              </div>
            </div>

            {/* Lista de presets guardados */}
            {savedPresets.length > 0 && (
              <div>
                <h5 style={{ margin: '0 0 12px 0', color: '#4CAF50' }}>📂 Presets Guardados</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {savedPresets.map((preset, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: 'white',
                        padding: '12px',
                        borderRadius: '6px',
                        border: '1px solid #ddd',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' }}>
                          {preset.name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#666' }}>
                          Creado: {new Date(preset.createdAt).toLocaleDateString()} {new Date(preset.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleLoadPreset(preset)}
                          style={{
                            padding: '6px 12px',
                            background: '#2196F3',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 'bold'
                          }}
                        >
                          📥 Cargar
                        </button>
                        <button
                          onClick={() => handleDeletePreset(preset)}
                          style={{
                            padding: '6px 12px',
                            background: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 'bold'
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {savedPresets.length === 0 && (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                color: '#666',
                fontSize: '14px',
                background: 'white',
                borderRadius: '6px'
              }}>
                No hay presets guardados. Configura el VWAP como desees y guarda tu primera configuración.
              </div>
            )}
          </div>
        )}

        {/* VWAP Type */}
        <div className="setting-row" style={{ background: '#e8f5e9', padding: '12px', borderRadius: '8px', marginBottom: '16px', border: '2px solid #4CAF50' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontWeight: 'bold', fontSize: '14px', display: 'block', marginBottom: '8px' }}>
              🎯 Tipo de VWAP:
            </label>
            <select
              value={localConfig.vwapType}
              onChange={(e) => handleConfigChange('vwapType', e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '14px',
                borderRadius: '4px',
                border: '2px solid #4CAF50',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              <option value="session">📅 Session - Reinicia diariamente</option>
              <option value="rolling">🔄 Rolling - Ventana móvil (CONFIGURABLE)</option>
              <option value="anchored">📍 Anchored - Desde fecha fija</option>
            </select>
          </div>

          {/* Descripción del tipo seleccionado */}
          <div style={{ fontSize: '12px', color: '#555', background: 'white', padding: '8px', borderRadius: '4px', marginTop: '8px' }}>
            {localConfig.vwapType === 'session' && (
              <span>✅ <b>Session VWAP:</b> Se reinicia cada día a las {localConfig.resetHour}:00 UTC. Ideal para day trading.</span>
            )}
            {localConfig.vwapType === 'rolling' && (
              <span>✅ <b>Rolling VWAP:</b> Ventana móvil de {localConfig.rollingPeriod} períodos. Puedes configurar el tamaño abajo. Ideal para swing trading.</span>
            )}
            {localConfig.vwapType === 'anchored' && (
              <span>✅ <b>Anchored VWAP:</b> Inicia desde una fecha/evento específico y no se resetea. Útil para analizar desde eventos importantes.</span>
            )}
          </div>
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
          <div className="setting-row" style={{ background: '#f5f5f5', padding: '12px', borderRadius: '8px', marginBottom: '8px' }}>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '14px', display: 'block', marginBottom: '8px' }}>
                📊 Período Rolling VWAP (número de velas):
              </label>
              <input
                type="number"
                min="5"
                max="200"
                step="5"
                value={getRollingPeriodValue()}
                onChange={(e) => {
                  const newValue = parseInt(e.target.value);
                  if (newValue >= 5 && newValue <= 200) {
                    console.log('[VWAPSettings] ✏️ Rolling period manual input:', newValue);
                    handleConfigChange('rollingPeriod', newValue);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  border: '2px solid #2196F3',
                  borderRadius: '6px',
                  textAlign: 'center',
                  color: '#2196F3'
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: '8px', padding: '8px', background: 'white', borderRadius: '4px' }}>
              <span>📉 5 (muy corto)</span>
              <span>📊 50 (medio)</span>
              <span>📈 200 (largo)</span>
            </div>
            <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', marginBottom: '0' }}>
              💡 <strong>Número de velas en la ventana móvil.</strong><br/>
              • Valores bajos (5-20): más sensible a cambios recientes, más reactivo<br/>
              • Valores medios (40-80): balance entre sensibilidad y estabilidad<br/>
              • Valores altos (100-200): más suavizado, menos ruido
            </p>
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

        {/* Volatility Indicators Section */}
        {localConfig.showBands && (
          <div style={{ background: '#e1f5fe', padding: '12px', borderRadius: '8px', marginTop: '16px', marginBottom: '16px', border: '2px solid #03A9F4' }}>
            <h5 style={{ margin: '0 0 12px 0', color: '#0277BD', fontSize: '15px' }}>
              📊 Indicadores de Volatilidad
            </h5>
            <div style={{ fontSize: '12px', color: '#555', marginBottom: '12px', background: 'white', padding: '8px', borderRadius: '4px' }}>
              Mide la separación de las bandas VWAP para detectar consolidación, squeeze y tendencias fuertes.
            </div>

            {/* BandWidth */}
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={localConfig.showBandWidth || false}
                  onChange={(e) => handleConfigChange('showBandWidth', e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ fontWeight: '500' }}>📏 BandWidth</span>
              </label>
              <div style={{ fontSize: '11px', color: '#666', marginLeft: '24px', marginTop: '4px' }}>
                Ancho de banda: (Superior - Inferior) / VWAP × 100
              </div>
            </div>

            {/* BBWP */}
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={localConfig.showBBWP || false}
                  onChange={(e) => handleConfigChange('showBBWP', e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ fontWeight: '500' }}>📈 BBWP (BandWidth Percentile)</span>
              </label>
              <div style={{ fontSize: '11px', color: '#666', marginLeft: '24px', marginTop: '4px' }}>
                Percentil normalizado del BandWidth histórico (0-100%)
              </div>
            </div>

            {/* TTM Squeeze */}
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={localConfig.showTTMSqueeze || false}
                  onChange={(e) => handleConfigChange('showTTMSqueeze', e.target.checked)}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ fontWeight: '500' }}>🔴 TTM Squeeze</span>
              </label>
              <div style={{ fontSize: '11px', color: '#666', marginLeft: '24px', marginTop: '4px' }}>
                Detecta cuando Bollinger Bands están dentro de Keltner Channels
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
            {showAdvanced ? '▼' : '▶'} Configuración avanzada
          </button>
        </div>

        {showAdvanced && localConfig.showBands && localConfig.bandMultipliers && (
          <div className="advanced-settings">
            {/* Volatility Indicators Advanced Config */}
            {(localConfig.showBandWidth || localConfig.showBBWP || localConfig.showTTMSqueeze) && (
              <div style={{ marginBottom: '24px', padding: '16px', background: '#f0f4ff', borderRadius: '8px', border: '2px solid #03A9F4' }}>
                <h5 style={{ margin: '0 0 16px 0', color: '#0277BD' }}>⚙️ Configuración de Indicadores de Volatilidad</h5>

                {/* BandWidth Thresholds */}
                {localConfig.showBandWidth && (
                  <div style={{ marginBottom: '16px', padding: '12px', background: 'white', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h6 style={{ margin: 0, color: '#0277BD' }}>📏 Umbrales de BandWidth (%)</h6>
                      <button
                        onClick={handleRestoreDefaults}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          background: '#0277BD',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                      >
                        🔄 Restaurar por defecto
                      </button>
                    </div>

                    {(() => {
                      const recommended = getRecommendedBandWidthThresholds(interval);
                      return (
                        <>
                          <div className="setting-row" style={{ marginBottom: '8px' }}>
                            <label>Squeeze (Verde):</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              max="20"
                              value={localConfig.bandWidthThresholds?.squeeze || 2}
                              onChange={(e) => handleConfigChange('bandWidthThresholds', {
                                ...localConfig.bandWidthThresholds,
                                squeeze: parseFloat(e.target.value)
                              })}
                              style={{ width: '80px' }}
                            />
                            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>%</span>
                            <span style={{ fontSize: '11px', color: '#2196F3', marginLeft: '8px', fontWeight: 'bold' }}>
                              (Recomendado: {recommended.squeeze}%)
                            </span>
                          </div>

                          <div className="setting-row" style={{ marginBottom: '8px' }}>
                            <label>Consolidation (Amarillo):</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              max="20"
                              value={localConfig.bandWidthThresholds?.consolidation || 5}
                              onChange={(e) => handleConfigChange('bandWidthThresholds', {
                                ...localConfig.bandWidthThresholds,
                                consolidation: parseFloat(e.target.value)
                              })}
                              style={{ width: '80px' }}
                            />
                            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>%</span>
                            <span style={{ fontSize: '11px', color: '#2196F3', marginLeft: '8px', fontWeight: 'bold' }}>
                              (Recomendado: {recommended.consolidation}%)
                            </span>
                          </div>

                          <div className="setting-row">
                            <label>Normal (Naranja):</label>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              max="30"
                              value={localConfig.bandWidthThresholds?.normal || 10}
                              onChange={(e) => handleConfigChange('bandWidthThresholds', {
                                ...localConfig.bandWidthThresholds,
                                normal: parseFloat(e.target.value)
                              })}
                              style={{ width: '80px' }}
                            />
                            <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>%</span>
                            <span style={{ fontSize: '11px', color: '#2196F3', marginLeft: '8px', fontWeight: 'bold' }}>
                              (Recomendado: {recommended.normal}%)
                            </span>
                          </div>

                          <div style={{ fontSize: '10px', color: '#777', marginTop: '8px', background: '#f5f5f5', padding: '6px', borderRadius: '4px' }}>
                            Valores >normal% = Trending (rojo). Timeframe actual: {interval} min
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* BBWP Config */}
                {localConfig.showBBWP && (
                  <div style={{ marginBottom: '16px', padding: '12px', background: 'white', borderRadius: '6px' }}>
                    <h6 style={{ margin: '0 0 12px 0', color: '#0277BD' }}>📈 Configuración BBWP</h6>

                    <div className="setting-row" style={{ marginBottom: '8px' }}>
                      <label>Lookback (períodos):</label>
                      <input
                        type="number"
                        step="10"
                        min="50"
                        max="500"
                        value={localConfig.bbwpLookback || 252}
                        onChange={(e) => handleConfigChange('bbwpLookback', parseInt(e.target.value))}
                        style={{ width: '80px' }}
                      />
                      <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>(ej: 252 = 1 año)</span>
                    </div>

                    <div className="setting-row" style={{ marginBottom: '8px' }}>
                      <label>Squeeze (Verde):</label>
                      <input
                        type="number"
                        step="5"
                        min="5"
                        max="50"
                        value={localConfig.bbwpThresholds?.squeeze || 20}
                        onChange={(e) => handleConfigChange('bbwpThresholds', {
                          ...localConfig.bbwpThresholds,
                          squeeze: parseInt(e.target.value)
                        })}
                        style={{ width: '80px' }}
                      />
                      <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>%</span>
                    </div>

                    <div className="setting-row">
                      <label>Normal (Amarillo):</label>
                      <input
                        type="number"
                        step="5"
                        min="50"
                        max="95"
                        value={localConfig.bbwpThresholds?.normal || 80}
                        onChange={(e) => handleConfigChange('bbwpThresholds', {
                          ...localConfig.bbwpThresholds,
                          normal: parseInt(e.target.value)
                        })}
                        style={{ width: '80px' }}
                      />
                      <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>% (>% = Trending rojo)</span>
                    </div>
                  </div>
                )}

                {/* TTM Squeeze Config */}
                {localConfig.showTTMSqueeze && (
                  <div style={{ marginBottom: '16px', padding: '12px', background: 'white', borderRadius: '6px' }}>
                    <h6 style={{ margin: '0 0 12px 0', color: '#0277BD' }}>🔴 Configuración TTM Squeeze</h6>

                    <div className="setting-row" style={{ marginBottom: '8px' }}>
                      <label>ATR Length:</label>
                      <input
                        type="number"
                        step="1"
                        min="5"
                        max="50"
                        value={localConfig.ttmATRLength || 20}
                        onChange={(e) => handleConfigChange('ttmATRLength', parseInt(e.target.value))}
                        style={{ width: '80px' }}
                      />
                      <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>períodos</span>
                    </div>

                    <div className="setting-row">
                      <label>ATR Multiplier (Keltner):</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.5"
                        max="5"
                        value={localConfig.ttmATRMultiplier || 1.5}
                        onChange={(e) => handleConfigChange('ttmATRMultiplier', parseFloat(e.target.value))}
                        style={{ width: '80px' }}
                      />
                      <span style={{ fontSize: '11px', color: '#666', marginLeft: '8px' }}>x ATR</span>
                    </div>
                  </div>
                )}

                {/* Volatility Bar Height */}
                <div style={{ padding: '12px', background: 'white', borderRadius: '6px' }}>
                  <h6 style={{ margin: '0 0 12px 0', color: '#0277BD' }}>📊 Visualización de Barras de Volatilidad</h6>

                  <div className="setting-row" style={{ marginBottom: '8px' }}>
                    <label style={{ fontWeight: 'bold', marginBottom: '6px', display: 'block' }}>
                      Alto de cada barra (px):
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input
                        type="number"
                        min="4"
                        max="40"
                        step="2"
                        value={localConfig.volatilityBarHeight || 8}
                        onChange={(e) => {
                          const value = parseInt(e.target.value);
                          if (!isNaN(value) && value >= 4 && value <= 40) {
                            handleConfigChange('volatilityBarHeight', value);
                          }
                        }}
                        style={{
                          width: '80px',
                          padding: '6px 10px',
                          fontSize: '14px',
                          border: '2px solid #03A9F4',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}
                      />
                      <span style={{ fontSize: '11px', color: '#666' }}>
                        Rango: 4-40 px (3 barras apiladas)
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: '#666', background: '#f5f5f5', padding: '8px', borderRadius: '4px' }}>
                    <strong>Nota:</strong> Cada indicador activo (BandWidth, BBWP, TTM) mostrará su propia barra horizontal
                    debajo del gráfico con etiqueta a la izquierda.
                  </div>
                </div>
              </div>
            )}

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

            {/* Sección de Estilo de Líneas */}
            <div style={{ marginTop: '20px', padding: '12px', background: '#fff3e0', borderRadius: '8px', border: '2px solid #FF9800' }}>
              <h5 style={{ marginTop: 0, marginBottom: '12px', color: '#F57C00' }}>🎨 Estilo de Líneas</h5>

              {/* Color VWAP */}
              <div className="setting-row" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold' }}>Color VWAP:</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="color"
                      value={localConfig.vwapColor || '#FF9800'}
                      onChange={(e) => handleConfigChange('vwapColor', e.target.value)}
                      style={{ width: '50px', height: '30px', cursor: 'pointer', border: '2px solid #ccc', borderRadius: '4px' }}
                    />
                    <span style={{ fontSize: '11px', color: '#666', fontFamily: 'monospace' }}>
                      {localConfig.vwapColor || '#FF9800'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Grosor línea VWAP */}
              <div className="setting-row" style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label style={{ fontWeight: 'bold' }}>Grosor línea VWAP:</label>
                  <span style={{
                    background: '#FF9800',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {localConfig.vwapLineWidth || 2}px
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="0.5"
                  value={localConfig.vwapLineWidth || 2}
                  onChange={(e) => handleConfigChange('vwapLineWidth', parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666', marginTop: '2px' }}>
                  <span>1px (fino)</span>
                  <span>3px</span>
                  <span>5px (grueso)</span>
                </div>
              </div>

              {/* Grosor líneas bandas */}
              {localConfig.showBands && (
                <div className="setting-row" style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontWeight: 'bold' }}>Grosor líneas bandas:</label>
                    <span style={{
                      background: '#2196F3',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      {localConfig.bandLineWidth || 1}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.5"
                    value={localConfig.bandLineWidth || 1}
                    onChange={(e) => handleConfigChange('bandLineWidth', parseFloat(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#666', marginTop: '2px' }}>
                    <span>0.5px (muy fino)</span>
                    <span>1.5px</span>
                    <span>3px (grueso)</span>
                  </div>
                </div>
              )}

              {/* Colores de bandas individuales */}
              {localConfig.showBands && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #ddd' }}>
                  <h6 style={{ margin: '0 0 12px 0', color: '#F57C00' }}>🌈 Colores de Bandas de Desviación</h6>

                  {/* Banda 1 */}
                  <div className="setting-row" style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontWeight: '500' }}>Banda 1 (±{localConfig.bandMultipliers?.[0] || 1.0}σ):</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={rgbaToHex((localConfig.bandColors && localConfig.bandColors.band1) || 'rgba(255, 152, 0, 0.3)')}
                          onChange={(e) => handleBandColorChange('band1', e.target.value)}
                          style={{ width: '50px', height: '30px', cursor: 'pointer', border: '2px solid #ccc', borderRadius: '4px' }}
                        />
                        <span style={{ fontSize: '11px', color: '#666', fontFamily: 'monospace', minWidth: '120px' }}>
                          {(localConfig.bandColors && localConfig.bandColors.band1) || 'rgba(255, 152, 0, 0.3)'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Banda 2 */}
                  <div className="setting-row" style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontWeight: '500' }}>Banda 2 (±{localConfig.bandMultipliers?.[1] || 2.0}σ):</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={rgbaToHex((localConfig.bandColors && localConfig.bandColors.band2) || 'rgba(255, 152, 0, 0.2)')}
                          onChange={(e) => handleBandColorChange('band2', e.target.value)}
                          style={{ width: '50px', height: '30px', cursor: 'pointer', border: '2px solid #ccc', borderRadius: '4px' }}
                        />
                        <span style={{ fontSize: '11px', color: '#666', fontFamily: 'monospace', minWidth: '120px' }}>
                          {(localConfig.bandColors && localConfig.bandColors.band2) || 'rgba(255, 152, 0, 0.2)'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Banda 3 */}
                  <div className="setting-row" style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontWeight: '500' }}>Banda 3 (±{localConfig.bandMultipliers?.[2] || 3.0}σ):</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="color"
                          value={rgbaToHex((localConfig.bandColors && localConfig.bandColors.band3) || 'rgba(255, 152, 0, 0.1)')}
                          onChange={(e) => handleBandColorChange('band3', e.target.value)}
                          style={{ width: '50px', height: '30px', cursor: 'pointer', border: '2px solid #ccc', borderRadius: '4px' }}
                        />
                        <span style={{ fontSize: '11px', color: '#666', fontFamily: 'monospace', minWidth: '120px' }}>
                          {(localConfig.bandColors && localConfig.bandColors.band3) || 'rgba(255, 152, 0, 0.1)'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
