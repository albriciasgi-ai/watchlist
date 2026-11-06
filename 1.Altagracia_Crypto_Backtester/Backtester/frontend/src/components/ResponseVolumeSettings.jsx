import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { RESPONSE_LIMITS, cleanResponseConfig, defaultResponseConfig } from './indicators/responseBalance.js';
import { saveResponseVolumeSettings } from './indicators/ResponseVolumeIndicator.js';

/** Parámetros del volumen de respuesta. Aplica a todos los marcos del símbolo. */
const ResponseVolumeSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => ({ ...defaultResponseConfig(), ...indicator.config }));
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));

  const handleApply = () => {
    const settings = cleanResponseConfig(values);
    saveResponseVolumeSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  const number = (key, label, step, hint) => (
    <div className="setting-row">
      <label>{label}</label>
      <input type="number" min={RESPONSE_LIMITS[key][0]} max={RESPONSE_LIMITS[key][1]} step={step} value={values[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );

  const check = (key, label) => (
    <div className="setting-row" style={{ marginBottom: '8px' }}>
      <label className="checkbox-label">
        <input type="checkbox" checked={!!values[key]} onChange={(e) => set(key, e.target.checked)} />
        {label}
      </label>
    </div>
  );

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Volumen de Respuesta - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Movimiento y velas principales</h4>
            {number('legAtr', 'Giro del tramo (ATR)', 0.5, 'El tramo cambia cuando un cierre se aleja esto del extremo.')}
            {number('window', 'Ventana (velas)', 1, 'Últimas velas que se comparan, sin pasar del inicio del tramo.')}
            {number('top', 'Velas principales por lado', 1, 'Las de mayor volumen de la tendencia y de la respuesta.')}
            {check('adjustHour', 'Comparar cada vela con el volumen normal de su hora')}
          </div>

          <div className="settings-section">
            <h4>Señal de equilibrio</h4>
            {number('dominance', 'La tendencia domina desde', 0.1, 'Tendencia / respuesta. La señal se arma al llegar aquí.')}
            {number('balance', 'Equilibrio desde', 0.05, 'La señal aparece cuando baja a este valor. Con 1 la respuesta igualó a la tendencia.')}
          </div>

          <div className="settings-section">
            <h4>Sobre el precio</h4>
            {check('showArrows', 'Flechas en velas de agresión')}
            {number('spikeMultiple', 'Agresión desde (veces lo normal)', 0.1, 'Volumen de la vela contra la mediana de esa hora en los 30 días anteriores.')}
            {check('showSignals', 'Rombo en la señal de equilibrio')}
          </div>

          <div className="settings-section">
            <h4>Cómo leerlo</h4>
            <span className="hint" style={{ display: 'block' }}>
              Arriba de cero pesan más las velas principales de compra y abajo las de venta. Cada línea punteada es el dominio.
              El rombo marca que la respuesta igualó a la tendencia.
            </span>
            <span className="hint" style={{ display: 'block', marginTop: '8px' }}>
              Medido en BTC con los parámetros de fábrica, en 2025 y 2026: tras el rombo el precio hizo un nuevo extremo 6 puntos menos en 15m (29% contra 35%)
              y 11 menos en 1h (21% contra 32%) que en situaciones iguales sin equilibrio. En 4h no hay muestra suficiente. Avisa de menos continuidad: no indica hacia dónde va el precio.
            </span>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultResponseConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default ResponseVolumeSettings;
