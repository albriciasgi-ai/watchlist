// VolumeProfileFixedSettings.jsx
// Modal de configuracion para un Volume Profile Fixed Range especifico

import React, { useState, useEffect } from "react";
import { customList, isCustom, isNewTheme } from "./uiTheme.js";
import { VP_FIXED_FACTORY, vpFixedThemeValue } from "./indicators/VolumeProfileFixedRangeIndicator.js";

// Lo que deja "Restaurar Defecto", como antes
const RESET_VALUES = { useGradient: true, baseColor: "#2196F3", valueAreaColor: "#FF9800", pocColor: "#F44336", vahValColor: "#2196F3", clusterColor: "#9C27B0" };

const VolumeProfileFixedSettings = ({ 
  profileId,
  currentConfig,
  onClose,
  onApply
}) => {
  // Estados para la configuracion
  const [rows, setRows] = useState(24);
  const [valueAreaPercent, setValueAreaPercent] = useState(0.70);
  const [histogramMaxWidth, setHistogramMaxWidth] = useState(0.25);
  const [useGradient, setUseGradient] = useState(true);
  
  // Colores
  const [baseColor, setBaseColor] = useState("#2196F3");
  const [valueAreaColor, setValueAreaColor] = useState("#FF9800");
  const [pocColor, setPocColor] = useState("#F44336");
  const [vahValColor, setVahValColor] = useState("#2196F3");
  const [rangeShadeColor, setRangeShadeColor] = useState("#E0E0E0");
  
  // Deteccion de clusters
  const [enableClusterDetection, setEnableClusterDetection] = useState(false);
  const [clusterThreshold, setClusterThreshold] = useState(1.5);
  const [clusterColor, setClusterColor] = useState("#9C27B0");
  
  // Configuracion avanzada
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Con Nítido, lo visual que el usuario cambia aquí queda como suyo y gana sobre el estilo
  const nitido = isNewTheme();
  const [touched, setTouched] = useState(() => new Set());
  const [resetVisual, setResetVisual] = useState(false);
  const shownValue = (key, value) => (nitido && !isCustom(currentConfig || {}, key, VP_FIXED_FACTORY[key]) ? vpFixedThemeValue(key) : value);
  const visual = (key, setter) => value => { setTouched(prev => new Set(prev).add(key)); setter(value); };

  // Cargar configuracion actual al montar
  useEffect(() => {
    if (currentConfig) {
      setTouched(new Set());
      setResetVisual(false);
      setRows(currentConfig.rows || 24);
      // El perfil guarda porcentajes (70, 25) y el modal trabaja con fracciones (0.70, 0.25)
      const asFraction = (value, fallback) => (value > 1 ? value / 100 : (value || fallback));
      setValueAreaPercent(asFraction(currentConfig.valueAreaPercent, 0.70));
      setHistogramMaxWidth(asFraction(currentConfig.histogramMaxWidth, 0.25));
      setUseGradient(shownValue('useGradient', currentConfig.useGradient !== undefined ? currentConfig.useGradient : true));
      
      setBaseColor(shownValue('baseColor', currentConfig.baseColor || "#2196F3"));
      setValueAreaColor(shownValue('valueAreaColor', currentConfig.valueAreaColor || "#FF9800"));
      setPocColor(shownValue('pocColor', currentConfig.pocColor || "#F44336"));
      setVahValColor(shownValue('vahValColor', currentConfig.vahValColor || "#2196F3"));
      setRangeShadeColor(currentConfig.rangeShadeColor || "#E0E0E0");
      
      setEnableClusterDetection(currentConfig.enableClusterDetection || false);
      setClusterThreshold(currentConfig.clusterThreshold || 1.5);
      setClusterColor(shownValue('clusterColor', currentConfig.clusterColor || "#9C27B0"));
    }
  }, [currentConfig]);

  const handleApply = () => {
    const config = {
      rows,
      valueAreaPercent: Math.round(valueAreaPercent * 100),
      histogramMaxWidth: Math.round(histogramMaxWidth * 100),
      useGradient,
      baseColor,
      valueAreaColor,
      pocColor,
      vahValColor,
      rangeShadeColor,
      enableClusterDetection,
      clusterThreshold,
      clusterColor
    };
    
    // Lo visual que no se tocó conserva lo guardado (con Nítido el modal mostraba el color del estilo)
    const original = currentConfig || {};
    for (const key of Object.keys(VP_FIXED_FACTORY)) {
      if (touched.has(key)) continue;
      if (resetVisual) config[key] = RESET_VALUES[key];
      else if (original[key] !== undefined) config[key] = original[key];
    }
    const chosen = new Set(resetVisual ? [] : customList(original, VP_FIXED_FACTORY));
    touched.forEach(key => chosen.add(key));
    config.customVisual = [...chosen];

    onApply(profileId, config);
    onClose();
  };

  const handleReset = () => {
    if (confirm("Restaurar configuracion por defecto?")) {
      setRows(24);
      setValueAreaPercent(0.70);
      setHistogramMaxWidth(0.25);
      setUseGradient(true);
      
      setBaseColor("#2196F3");
      setValueAreaColor("#FF9800");
      setPocColor("#F44336");
      setVahValColor("#2196F3");
      setRangeShadeColor("#E0E0E0");
      
      setEnableClusterDetection(false);
      setClusterThreshold(1.5);
      setClusterColor("#9C27B0");

      // Vuelve a los colores del estilo (con Nítido) o a los de fábrica (clásico)
      setTouched(new Set());
      setResetVisual(true);
      if (nitido) {
        setUseGradient(true);
        setBaseColor(vpFixedThemeValue('baseColor'));
        setValueAreaColor(vpFixedThemeValue('valueAreaColor'));
        setPocColor(vpFixedThemeValue('pocColor'));
        setVahValColor(vpFixedThemeValue('vahValColor'));
        setClusterColor(vpFixedThemeValue('clusterColor'));
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Configuracion Range {profileId}</h3>
          <button className="modal-close-btn" onClick={onClose}>
            X
          </button>
        </div>

        <div className="modal-body">
          <div className="volume-profile-settings">
            
            {/* Configuracion Basica */}
            <div className="settings-section">
              <h4>Configuracion Basica</h4>

              <div className="setting-row">
                <label>
                  Niveles de Precio: {rows}
                  <span className="setting-hint">Mas niveles = mayor detalle</span>
                </label>
                <input 
                  type="range" 
                  min="12" 
                  max="50" 
                  value={rows}
                  onChange={(e) => setRows(parseInt(e.target.value))}
                />
              </div>

              <div className="setting-row">
                <label>
                  Value Area: {(valueAreaPercent * 100).toFixed(0)}%
                  <span className="setting-hint">Porcentaje del volumen total</span>
                </label>
                <input 
                  type="range" 
                  min="0.5" 
                  max="0.9" 
                  step="0.05"
                  value={valueAreaPercent}
                  onChange={(e) => setValueAreaPercent(parseFloat(e.target.value))}
                />
              </div>

              <div className="setting-row">
                <label>
                  Ancho Histograma: {(histogramMaxWidth * 100).toFixed(0)}%
                  <span className="setting-hint">% del ancho del rango</span>
                </label>
                <input 
                  type="range" 
                  min="0.1" 
                  max="0.5" 
                  step="0.05"
                  value={histogramMaxWidth}
                  onChange={(e) => setHistogramMaxWidth(parseFloat(e.target.value))}
                />
              </div>

              <div className="setting-row">
                <label>
                  <input 
                    type="checkbox" 
                    checked={useGradient}
                    onChange={(e) => visual('useGradient', setUseGradient)(e.target.checked)}
                  />
                  Usar Gradiente
                  <span className="setting-hint">Opacidad basada en volumen</span>
                </label>
              </div>
            </div>

            {/* Deteccion de Clusters */}
            <div className="settings-section">
              <h4>Deteccion de Clusters</h4>

              <div className="setting-row">
                <label>
                  <input 
                    type="checkbox" 
                    checked={enableClusterDetection}
                    onChange={(e) => setEnableClusterDetection(e.target.checked)}
                  />
                  Activar Deteccion de Clusters
                  <span className="setting-hint">Resaltar niveles de alto volumen</span>
                </label>
              </div>

              {enableClusterDetection && (
                <div className="setting-row indent">
                  <label>
                    Umbral: {clusterThreshold.toFixed(1)}x
                    <span className="setting-hint">Multiplicador del volumen promedio</span>
                  </label>
                  <input 
                    type="range" 
                    min="1.2" 
                    max="3.0" 
                    step="0.1"
                    value={clusterThreshold}
                    onChange={(e) => setClusterThreshold(parseFloat(e.target.value))}
                  />
                </div>
              )}
            </div>

            {/* Configuracion Avanzada (Colores) */}
            <div className="advanced-toggle">
              <button 
                className="toggle-advanced-btn"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? "▼" : "►"} Configuracion Avanzada (Colores)
              </button>
            </div>

            {showAdvanced && (
              <div className="advanced-settings">
                <div className="settings-section">
                  <h5>Colores</h5>

                  <div className="color-settings">
                    <div className="setting-row">
                      <label>Color Base:</label>
                      <input 
                        type="color" 
                        value={baseColor}
                        onChange={(e) => visual('baseColor', setBaseColor)(e.target.value)}
                      />
                    </div>

                    <div className="setting-row">
                      <label>Value Area:</label>
                      <input 
                        type="color" 
                        value={valueAreaColor}
                        onChange={(e) => visual('valueAreaColor', setValueAreaColor)(e.target.value)}
                      />
                    </div>

                    <div className="setting-row">
                      <label>POC:</label>
                      <input 
                        type="color" 
                        value={pocColor}
                        onChange={(e) => visual('pocColor', setPocColor)(e.target.value)}
                      />
                    </div>

                    <div className="setting-row">
                      <label>VAH/VAL:</label>
                      <input 
                        type="color" 
                        value={vahValColor}
                        onChange={(e) => visual('vahValColor', setVahValColor)(e.target.value)}
                      />
                    </div>

                    <div className="setting-row">
                      <label>Sombreado Rango:</label>
                      <input 
                        type="color" 
                        value={rangeShadeColor}
                        onChange={(e) => setRangeShadeColor(e.target.value)}
                      />
                    </div>

                    {enableClusterDetection && (
                      <div className="setting-row">
                        <label>Clusters:</label>
                        <input 
                          type="color" 
                          value={clusterColor}
                          onChange={(e) => visual('clusterColor', setClusterColor)(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Botones de accion */}
            <div className="settings-actions" style={{ 
              display: 'flex', 
              gap: '12px', 
              marginTop: '24px' 
            }}>
              <button 
                className="apply-range-btn"
                onClick={handleApply}
                style={{ flex: 1 }}
              >
                Aplicar Cambios
              </button>
              <button 
                className="reset-btn"
                onClick={handleReset}
                style={{ 
                  flex: 1, 
                  background: '#757575',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Restaurar Defecto
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VolumeProfileFixedSettings;
