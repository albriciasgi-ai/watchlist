import React, { useState } from 'react';
import './AlertProfileEditor.css';

/**
 * Alert Profile Editor
 *
 * Allows creating/editing individual alert profiles with custom filters per indicator
 */
const AlertProfileEditor = ({ profile, onSave, onCancel, isNew = false }) => {
  const [localProfile, setLocalProfile] = useState(profile || getDefaultProfile());

  const handleChange = (key, value) => {
    setLocalProfile(prev => ({ ...prev, [key]: value }));
  };

  const handleIndicatorToggle = (indicatorName) => {
    setLocalProfile(prev => ({
      ...prev,
      indicators: {
        ...prev.indicators,
        [indicatorName]: {
          ...prev.indicators[indicatorName],
          enabled: !prev.indicators[indicatorName].enabled
        }
      }
    }));
  };

  const handleIndicatorConfigChange = (indicatorName, key, value) => {
    setLocalProfile(prev => ({
      ...prev,
      indicators: {
        ...prev.indicators,
        [indicatorName]: {
          ...prev.indicators[indicatorName],
          [key]: value
        }
      }
    }));
  };

  const handleSave = () => {
    if (!localProfile.name.trim()) {
      alert('Please enter a profile name');
      return;
    }
    onSave(localProfile);
  };

  const getEnabledIndicatorsCount = () => {
    return Object.values(localProfile.indicators).filter(ind => ind.enabled).length;
  };

  return (
    <div className="profile-editor-overlay" onClick={onCancel}>
      <div className="profile-editor-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="profile-editor-header">
          <h3>{isNew ? '➕ Nuevo Perfil de Alertas' : '✏️ Editar Perfil de Alertas'}</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        {/* Content */}
        <div className="profile-editor-content">
          {/* Profile Name */}
          <section className="editor-section">
            <h4>📝 Detalles del Perfil</h4>
            <div className="input-row">
              <label>
                Nombre del Perfil
                <input
                  type="text"
                  value={localProfile.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="ej., Scalping Agresivo, Swing Trading..."
                  autoFocus
                />
              </label>
            </div>
            <div className="input-row">
              <label>
                Descripción (opcional)
                <input
                  type="text"
                  value={localProfile.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="Breve descripción de este perfil..."
                />
              </label>
            </div>
          </section>

          {/* Support & Resistance Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['Support & Resistance'].enabled}
                  onChange={() => handleIndicatorToggle('Support & Resistance')}
                />
                <span className="indicator-title">⚡ Support & Resistance</span>
              </label>
            </div>

            {localProfile.indicators['Support & Resistance'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label>
                    Fuerza Mínima
                    <input
                      type="number"
                      min="1"
                      max="10"
                      step="0.5"
                      value={localProfile.indicators['Support & Resistance'].minStrength}
                      onChange={(e) => handleIndicatorConfigChange('Support & Resistance', 'minStrength', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Puntuación de fuerza del nivel (1-10)</span>
                </div>

                <div className="filter-row">
                  <label>
                    Umbral de Distancia (%)
                    <input
                      type="number"
                      min="0.1"
                      max="2.0"
                      step="0.1"
                      value={localProfile.indicators['Support & Resistance'].proximityPercent}
                      onChange={(e) => handleIndicatorConfigChange('Support & Resistance', 'proximityPercent', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Alertar cuando precio esté dentro del % del nivel</span>
                </div>

                <div className="filter-row">
                  <label>
                    Toques Mínimos
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={localProfile.indicators['Support & Resistance'].minTouches}
                      onChange={(e) => handleIndicatorConfigChange('Support & Resistance', 'minTouches', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Cantidad mínima de veces que el precio tocó el nivel</span>
                </div>
              </div>
            )}
          </section>

          {/* Rejection Patterns Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['Rejection Patterns'].enabled}
                  onChange={() => handleIndicatorToggle('Rejection Patterns')}
                />
                <span className="indicator-title">📊 Rejection Patterns</span>
              </label>
            </div>

            {localProfile.indicators['Rejection Patterns'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label>
                    Minimum Confidence (%)
                    <input
                      type="number"
                      min="50"
                      max="100"
                      step="5"
                      value={localProfile.indicators['Rejection Patterns'].minConfidence}
                      onChange={(e) => handleIndicatorConfigChange('Rejection Patterns', 'minConfidence', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Pattern confidence score</span>
                </div>

                <div className="filter-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localProfile.indicators['Rejection Patterns'].requireNearLevel}
                      onChange={(e) => handleIndicatorConfigChange('Rejection Patterns', 'requireNearLevel', e.target.checked)}
                    />
                    <span>Require Near Key Level</span>
                  </label>
                  <span className="filter-hint">Only alert if pattern near S/R level</span>
                </div>
              </div>
            )}
          </section>

          {/* Volume Profile Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['Volume Profile'].enabled}
                  onChange={() => handleIndicatorToggle('Volume Profile')}
                />
                <span className="indicator-title">📈 Volume Profile</span>
              </label>
            </div>

            {localProfile.indicators['Volume Profile'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localProfile.indicators['Volume Profile'].alertOnPOC}
                      onChange={(e) => handleIndicatorConfigChange('Volume Profile', 'alertOnPOC', e.target.checked)}
                    />
                    <span>Alert at POC (Point of Control)</span>
                  </label>
                </div>

                <div className="filter-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localProfile.indicators['Volume Profile'].alertOnValueArea}
                      onChange={(e) => handleIndicatorConfigChange('Volume Profile', 'alertOnValueArea', e.target.checked)}
                    />
                    <span>Alert at Value Area Boundaries</span>
                  </label>
                </div>

                <div className="filter-row">
                  <label>
                    Distance Threshold (%)
                    <input
                      type="number"
                      min="0.1"
                      max="1.0"
                      step="0.1"
                      value={localProfile.indicators['Volume Profile'].proximityPercent}
                      onChange={(e) => handleIndicatorConfigChange('Volume Profile', 'proximityPercent', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Alert when price within % of VP level</span>
                </div>
              </div>
            )}
          </section>

          {/* Open Interest Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['Open Interest'].enabled}
                  onChange={() => handleIndicatorToggle('Open Interest')}
                />
                <span className="indicator-title">🔥 Open Interest</span>
              </label>
            </div>

            {localProfile.indicators['Open Interest'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label>
                    Minimum Change (%)
                    <input
                      type="number"
                      min="5"
                      max="50"
                      step="5"
                      value={localProfile.indicators['Open Interest'].minChangePercent}
                      onChange={(e) => handleIndicatorConfigChange('Open Interest', 'minChangePercent', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Alert on significant OI changes</span>
                </div>

                <div className="filter-row">
                  <label>
                    Lookback Candles
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={localProfile.indicators['Open Interest'].lookbackCandles}
                      onChange={(e) => handleIndicatorConfigChange('Open Interest', 'lookbackCandles', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Candles to compare OI change</span>
                </div>
              </div>
            )}
          </section>

          {/* Volume Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['Volume'].enabled}
                  onChange={() => handleIndicatorToggle('Volume')}
                />
                <span className="indicator-title">📊 Volumen</span>
              </label>
            </div>

            {localProfile.indicators['Volume'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label>
                    Multiplicador Mínimo
                    <input
                      type="number"
                      min="1.5"
                      max="10.0"
                      step="0.5"
                      value={localProfile.indicators['Volume'].minMultiplier}
                      onChange={(e) => handleIndicatorConfigChange('Volume', 'minMultiplier', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Alertar cuando volumen es X veces el promedio</span>
                </div>

                <div className="filter-row">
                  <label>
                    Período de Comparación
                    <input
                      type="number"
                      min="10"
                      max="50"
                      value={localProfile.indicators['Volume'].lookbackPeriod}
                      onChange={(e) => handleIndicatorConfigChange('Volume', 'lookbackPeriod', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Velas para calcular promedio de volumen</span>
                </div>
              </div>
            )}
          </section>

          {/* Volume Delta Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['Volume Delta'].enabled}
                  onChange={() => handleIndicatorToggle('Volume Delta')}
                />
                <span className="indicator-title">📊 Volume Delta</span>
              </label>
            </div>

            {localProfile.indicators['Volume Delta'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label>
                    Multiplicador Mínimo
                    <input
                      type="number"
                      min="1.5"
                      max="10.0"
                      step="0.5"
                      value={localProfile.indicators['Volume Delta'].minMultiplier}
                      onChange={(e) => handleIndicatorConfigChange('Volume Delta', 'minMultiplier', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Alertar cuando delta es X veces el promedio</span>
                </div>

                <div className="filter-row">
                  <label>
                    Período de Comparación
                    <input
                      type="number"
                      min="10"
                      max="50"
                      value={localProfile.indicators['Volume Delta'].lookbackPeriod}
                      onChange={(e) => handleIndicatorConfigChange('Volume Delta', 'lookbackPeriod', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Velas para calcular promedio de volumen</span>
                </div>
              </div>
            )}
          </section>

          {/* CVD Settings */}
          <section className="editor-section">
            <div className="section-header">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.indicators['CVD'].enabled}
                  onChange={() => handleIndicatorToggle('CVD')}
                />
                <span className="indicator-title">📈 CVD (Cumulative Volume Delta)</span>
              </label>
            </div>

            {localProfile.indicators['CVD'].enabled && (
              <div className="indicator-filters">
                <div className="filter-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localProfile.indicators['CVD'].alertOnExtremes}
                      onChange={(e) => handleIndicatorConfigChange('CVD', 'alertOnExtremes', e.target.checked)}
                    />
                    <span>Alertar en Extremos (máximos/mínimos)</span>
                  </label>
                  <span className="filter-hint">CVD alcanza niveles extremos recientes</span>
                </div>

                <div className="filter-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localProfile.indicators['CVD'].alertOnTrendChange}
                      onChange={(e) => handleIndicatorConfigChange('CVD', 'alertOnTrendChange', e.target.checked)}
                    />
                    <span>Alertar en Cambio de Tendencia</span>
                  </label>
                  <span className="filter-hint">Tendencia alcista/bajista fuerte en CVD</span>
                </div>

                <div className="filter-row">
                  <label>
                    Umbral de Extremo (%)
                    <input
                      type="number"
                      min="0.01"
                      max="0.20"
                      step="0.01"
                      value={localProfile.indicators['CVD'].extremeThreshold}
                      onChange={(e) => handleIndicatorConfigChange('CVD', 'extremeThreshold', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Proximidad al máx/mín para alertar (0.05 = 5%)</span>
                </div>
              </div>
            )}
          </section>

          {/* Confluence Settings */}
          <section className="editor-section">
            <h4>🎯 Confluence Detection</h4>
            <p className="section-description">
              Alert when multiple indicators agree within a specific time/price window
            </p>

            <div className="filter-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={localProfile.confluenceEnabled}
                  onChange={(e) => handleChange('confluenceEnabled', e.target.checked)}
                />
                <span>Enable Confluence Alerts</span>
              </label>
            </div>

            {localProfile.confluenceEnabled && (
              <>
                <div className="filter-row">
                  <label>
                    Minimum Indicators
                    <input
                      type="number"
                      min="2"
                      max="4"
                      value={localProfile.minIndicatorsForConfluence}
                      onChange={(e) => handleChange('minIndicatorsForConfluence', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">How many indicators must agree</span>
                </div>

                <div className="filter-row">
                  <label>
                    Time Window (candles)
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={localProfile.confluenceWindowCandles}
                      onChange={(e) => handleChange('confluenceWindowCandles', parseInt(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">±candles to group alerts</span>
                </div>

                <div className="filter-row">
                  <label>
                    Price Proximity (%)
                    <input
                      type="number"
                      min="0.1"
                      max="2.0"
                      step="0.1"
                      value={localProfile.confluencePriceProximity}
                      onChange={(e) => handleChange('confluencePriceProximity', parseFloat(e.target.value))}
                    />
                  </label>
                  <span className="filter-hint">Max price distance to group</span>
                </div>
              </>
            )}
          </section>

          {/* Summary */}
          <section className="editor-section summary">
            <h4>📋 Profile Summary</h4>
            <div className="summary-content">
              <p>
                <strong>{localProfile.name || 'Unnamed Profile'}</strong>
                {localProfile.description && <span> - {localProfile.description}</span>}
              </p>
              <p>
                {getEnabledIndicatorsCount()} indicator(s) active
                {localProfile.confluenceEnabled && ` • Confluence: ${localProfile.minIndicatorsForConfluence}+ indicators`}
              </p>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="profile-editor-footer">
          <button className="btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={handleSave}>
            {isNew ? 'Crear Perfil' : 'Guardar Cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};

function getDefaultProfile() {
  return {
    id: Date.now() + Math.random(),
    name: '',
    description: '',
    indicators: {
      'Support & Resistance': {
        enabled: true,
        minStrength: 5,
        proximityPercent: 0.3,
        minTouches: 2
      },
      'Rejection Patterns': {
        enabled: true,
        minConfidence: 65,
        requireNearLevel: true
      },
      'Volume Profile': {
        enabled: false,
        alertOnPOC: true,
        alertOnValueArea: true,
        proximityPercent: 0.5
      },
      'Open Interest': {
        enabled: false,
        minChangePercent: 15,
        lookbackCandles: 5
      },
      'Volume Delta': {
        enabled: false,
        minMultiplier: 2.0,
        lookbackPeriod: 20
      },
      'CVD': {
        enabled: false,
        alertOnExtremes: true,
        alertOnTrendChange: true,
        extremeThreshold: 0.05
      }
    },
    confluenceEnabled: true,
    minIndicatorsForConfluence: 2,
    confluenceWindowCandles: 3,
    confluencePriceProximity: 0.5
  };
}

export default AlertProfileEditor;
