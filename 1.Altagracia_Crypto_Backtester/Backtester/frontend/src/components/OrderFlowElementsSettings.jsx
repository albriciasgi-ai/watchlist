import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import {
  OF_ELEMENTS, OF_GROUPS, cleanOFElementsConfig, defaultOFElementsConfig, saveOFElementsSettings
} from './indicators/ofElements.js';

const SHAPE_TEXT = { band: 'franja', mark: 'celdas', box: 'contorno', table: 'tabla' };

/** Elementos de Orderflows Unlocked: cuáles se ven y cómo. Aplica a todos los marcos del símbolo. */
const OrderFlowElementsSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => cleanOFElementsConfig(indicator.config));
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
  const setCode = (code, on) => setValues(previous => ({ ...previous, codes: { ...previous.codes, [code]: on } }));
  const setGroup = (group, on) => setValues(previous => ({
    ...previous,
    codes: { ...previous.codes, ...Object.fromEntries(Object.entries(OF_ELEMENTS).filter(([, info]) => info.group === group).map(([code]) => [code, on])) }
  }));

  const handleApply = () => {
    const settings = cleanOFElementsConfig(values);
    saveOFElementsSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Elementos Order Flow - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Cómo se detectan</h4>
            <p className="hint" style={{ margin: '0 0 8px 0' }}>
              Con los trades reales del almacén y la regla de cada elemento en las láminas de Orderflows Unlocked.
              Los umbrales del libro son contratos del ES: aquí se calculan cada día con los 30 días anteriores,
              para que cada elemento marque cerca del porcentaje de velas elegido. Son ayudas de lectura, no señales.
            </p>
            <div className="setting-row">
              <label>Velas marcadas (%)</label>
              <input type="number" min="1" max="20" step="1" value={values.target} onChange={(e) => set('target', e.target.value)} />
              <span className="hint">Por cada elemento calibrado. 5% por defecto; menos es más exigente.</span>
            </div>
            <div className="setting-row">
              <label>Volumen mínimo de la vela (×)</label>
              <input type="number" min="0" max="10" step="0.5" value={values.volFilter} onChange={(e) => set('volFilter', e.target.value)} />
              <span className="hint">Para los marcados con "vol.": veces la mediana de las 20 velas anteriores. 2 por defecto; 0 los muestra en todas las velas, donde marcan del 12% al 74%.</span>
            </div>
          </div>

          {OF_GROUPS.map(([group, title, description]) => {
            const codes = Object.entries(OF_ELEMENTS).filter(([, info]) => info.group === group);
            const allOn = codes.every(([code]) => values.codes[code]);
            return (
              <div className="settings-section" key={group}>
                <h4 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {title}
                  <button className="btn-secondary" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => setGroup(group, !allOn)}>
                    {allOn ? 'Quitar todos' : 'Todos'}
                  </button>
                </h4>
                <p className="hint" style={{ margin: '0 0 6px 0' }}>{description}</p>
                {codes.map(([code, info]) => (
                  <div className="setting-row" style={{ marginBottom: '4px' }} key={code}>
                    <label className="checkbox-label">
                      <input type="checkbox" checked={!!values.codes[code]} onChange={(e) => setCode(code, e.target.checked)} />
                      <strong style={{ width: '24px', display: 'inline-block' }}>{code}</strong> {info.name}
                      <span className="hint" style={{ marginLeft: '6px' }}>({SHAPE_TEXT[info.shape]}{info.volume ? ', vol.' : ''}{info.flow ? ', flujo' : ''})</span>
                    </label>
                  </div>
                ))}
              </div>
            );
          })}

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            {[
              ['showBands', 'Franjas: siguen hasta que el precio vuelve'],
              ['showGlyphs', 'Triángulo con los códigos bajo o sobre la vela'],
              ['showTable', 'Panel con la tabla de la vela (delta, Máx y Mín Δ exactos, Δ/Vol y delta acumulado del día)'],
              ['showEMA', 'EMA 14: el "Momentum Strength" de las láminas, coloreada si tiene pendiente']
            ].map(([key, label]) => (
              <div className="setting-row" style={{ marginBottom: '6px' }} key={key}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={!!values[key]} onChange={(e) => set(key, e.target.checked)} />
                  {label}
                </label>
              </div>
            ))}
            <div className="setting-row">
              <label>Franjas a la vez</label>
              <input type="number" min="0" max="200" step="5" value={values.maxBands} onChange={(e) => set('maxBands', e.target.value)} />
              <span className="hint">Las más recientes, vivas o que terminan a la vista.</span>
            </div>
            <div className="setting-row">
              <label>Opacidad de las franjas (%)</label>
              <input type="number" min="4" max="50" step="2" value={Math.round(values.bandOpacity * 100)} onChange={(e) => set('bandOpacity', e.target.value / 100)} />
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultOFElementsConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default OrderFlowElementsSettings;
