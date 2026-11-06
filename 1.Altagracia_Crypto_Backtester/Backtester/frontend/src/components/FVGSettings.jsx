import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { defaultFVGConfig, saveFVGSettings } from './indicators/FVGIndicator.js';

// Parámetro: [mínimo, máximo]. Fuera del rango se ajusta al guardar.
const NUMBER_LIMITS = {
  minPct: [0.001, 5],
  maxAge: [0, 5000],
  lookback: [10, 5000],
  opacity: [0.02, 1]
};

const pick = (config) => Object.fromEntries(Object.keys(defaultFVGConfig()).map(key => [key, config[key]]));

/** Valores listos para aplicar: números dentro de su rango */
export function cleanFVGSettings(values) {
  const defaults = defaultFVGConfig();
  const clean = { ...values };
  for (const [key, [min, max]] of Object.entries(NUMBER_LIMITS)) {
    const number = parseFloat(values[key]);
    clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : defaults[key];
  }
  clean.maxAge = Math.round(clean.maxAge);
  clean.lookback = Math.round(clean.lookback);
  return clean;
}

/** Parámetros de los fair value gaps. Aplica a todos los marcos del símbolo. */
const FVGSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => pick(indicator.config));
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));

  const handleApply = () => {
    const settings = cleanFVGSettings(values);
    saveFVGSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Fair Value Gaps - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Detección</h4>
            <div className="setting-row">
              <label>Tamaño mínimo (% del precio)</label>
              <input type="number" min="0.001" max="5" step="0.01" value={values.minPct ?? ''} onChange={(e) => set('minPct', e.target.value)} />
              <span className="hint">La regla del laboratorio usa 0.03%.</span>
            </div>
            <div className="setting-row">
              <label>Cuándo deja de estar abierto</label>
              <select value={values.fillMode} onChange={(e) => set('fillMode', e.target.value)}>
                <option value="trim">Se recorta con cada vela y termina al llenarse</option>
                <option value="touch">Termina al primer toque</option>
                <option value="whole">Conserva su tamaño hasta que el precio lo cruce</option>
              </select>
            </div>
            <div className="setting-row">
              <label>Edad máxima (velas)</label>
              <input type="number" min="0" max="5000" step="10" value={values.maxAge ?? ''} onChange={(e) => set('maxAge', e.target.value)} />
              <span className="hint">0 es sin límite.</span>
            </div>
            <div className="setting-row">
              <label>Velas antes de la vista donde se buscan</label>
              <input type="number" min="10" max="5000" step="50" value={values.lookback ?? ''} onChange={(e) => set('lookback', e.target.value)} />
              <span className="hint">Más velas encuentran gaps viejos que siguen abiertos.</span>
            </div>
          </div>

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showBullish} onChange={(e) => set('showBullish', e.target.checked)} />
                Gaps alcistas
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showBearish} onChange={(e) => set('showBearish', e.target.checked)} />
                Gaps bajistas
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showBorder} onChange={(e) => set('showBorder', e.target.checked)} />
                Borde
              </label>
            </div>
            <div className="setting-row">
              <label>Opacidad (%)</label>
              <input
                type="number"
                min="2"
                max="100"
                step="2"
                value={Math.round(values.opacity * 100)}
                onChange={(e) => set('opacity', e.target.value / 100)}
              />
            </div>
            <div style={{ display: 'flex', gap: '24px' }}>
              <div className="setting-row">
                <label>Alcista</label>
                <input type="color" value={values.bullishColor} onChange={(e) => set('bullishColor', e.target.value)} />
              </div>
              <div className="setting-row">
                <label>Bajista</label>
                <input type="color" value={values.bearishColor} onChange={(e) => set('bearishColor', e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultFVGConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default FVGSettings;
