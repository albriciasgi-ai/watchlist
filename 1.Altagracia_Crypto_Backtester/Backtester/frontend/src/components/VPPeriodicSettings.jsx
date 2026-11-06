import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { SESSION_OPTIONS } from './indicators/sessionProfile.js';
import { defaultVPPeriodicConfig, saveVPPeriodicSettings } from './indicators/VolumeProfilePeriodicIndicator.js';

// Parámetro: [mínimo, máximo]. Fuera del rango se ajusta al guardar.
const NUMBER_LIMITS = {
  rows: [10, 200],
  valueAreaPercent: [50, 95],
  histogramWidthPercent: [5, 100]
};

const pick = (config) => Object.fromEntries(Object.keys(defaultVPPeriodicConfig()).map(key => [key, config[key]]));

/** Valores listos para aplicar: números dentro de su rango */
export function cleanVPPeriodicSettings(values) {
  const defaults = defaultVPPeriodicConfig();
  const clean = { ...values, periodHours: Number(values.periodHours) || defaults.periodHours };
  for (const [key, [min, max]] of Object.entries(NUMBER_LIMITS)) {
    const number = parseFloat(values[key]);
    clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : defaults[key];
  }
  clean.rows = Math.round(clean.rows);
  return clean;
}

/** Parámetros del perfil por sesión. Aplica a todos los marcos del símbolo. */
const VPPeriodicSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => pick(indicator.config));
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));

  const handleApply = () => {
    const settings = cleanVPPeriodicSettings(values);
    saveVPPeriodicSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>VP Periodic - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Sesión</h4>
            <div className="setting-row">
              <label>Duración de cada perfil</label>
              <select value={values.periodHours} onChange={(e) => set('periodHours', Number(e.target.value))}>
                {SESSION_OPTIONS.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}
              </select>
              <span className="hint">Empieza en hora UTC. La sesión en curso cambia hasta cerrar; la anterior ya está confirmada.</span>
            </div>
            <div className="setting-row">
              <label>Filas del perfil</label>
              <input type="number" min="10" max="200" step="10" value={values.rows ?? ''} onChange={(e) => set('rows', e.target.value)} />
            </div>
            <div className="setting-row">
              <label>Área de valor (%)</label>
              <input type="number" min="50" max="95" step="5" value={values.valueAreaPercent ?? ''} onChange={(e) => set('valueAreaPercent', e.target.value)} />
            </div>
          </div>

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            <div className="setting-row">
              <label>Ancho del perfil (% de la sesión)</label>
              <input type="number" min="5" max="100" step="5" value={values.histogramWidthPercent ?? ''} onChange={(e) => set('histogramWidthPercent', e.target.value)} />
            </div>
            {[['showPOC', 'POC'], ['showValueArea', 'VAH y VAL'], ['showLabels', 'Precio del POC']].map(([key, label]) => (
              <div className="setting-row" style={{ marginBottom: '8px' }} key={key}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={!!values[key]} onChange={(e) => set(key, e.target.checked)} />
                  {label}
                </label>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultVPPeriodicConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default VPPeriodicSettings;
