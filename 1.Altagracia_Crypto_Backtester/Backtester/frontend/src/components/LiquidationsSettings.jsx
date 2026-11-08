import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import {
  SOURCE_CHOICES, cleanLiquidationsSettings, defaultLiquidationsConfig, saveLiquidationsSettings
} from './indicators/LiquidationsIndicator.js';
import { coverageText } from './indicators/liquidationZones.js';

const pick = (config) => Object.fromEntries(Object.keys(defaultLiquidationsConfig()).map(key => [key, config[key]]));

/** Zonas de liquidaciones. Aplica a todos los marcos del símbolo. */
const LiquidationsSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => pick(indicator.config));
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
  const sources = indicator.sources || [];

  const handleApply = () => {
    const settings = cleanLiquidationsSettings(values);
    saveLiquidationsSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  const percentInput = (key, min, max, step) => (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={values[key] === '' ? '' : Math.round(values[key] * 100)}
      onChange={(e) => set(key, e.target.value === '' ? '' : e.target.value / 100)}
    />
  );

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Liquidaciones - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Zonas</h4>
            <span className="hint" style={{ display: 'block', marginBottom: '10px' }}>
              Precios donde se liquidó mucho dinero en los últimos días. Son zonas de barrido para estar alerta, no entradas ni imanes.
              Cada zona aparece cuando se conoce: un evento en su hora, y un día de MarginPad o un intervalo de Coinalyze al cerrar (UTC).
              Cuando el precio la atraviesa queda más tenue, con línea punteada, y sigue como referencia.
            </span>
            <div className="setting-row">
              <label>Zonas por lado del precio</label>
              <input type="number" min="1" max="8" step="1" value={values.perSide ?? ''} onChange={(e) => set('perSide', e.target.value)} />
              <span className="hint">Las mayores arriba y las mayores abajo. Las que tienen el precio adentro se muestran siempre.</span>
            </div>
            <div className="setting-row">
              <label>Distancia máxima al precio (%)</label>
              <input type="number" min="0.5" max="30" step="0.5" value={values.maxDistancePct ?? ''} onChange={(e) => set('maxDistancePct', e.target.value)} />
            </div>
            <div className="setting-row">
              <label>Espacio mínimo entre zonas (%)</label>
              <input type="number" min="0" max="3" step="0.1" value={values.minGapPct ?? ''} onChange={(e) => set('minGapPct', e.target.value)} />
              <span className="hint">Un barrido ancho se ve como unos pocos niveles separados, no como un bloque.</span>
            </div>
            <div className="setting-row">
              <label>Ventana hacia atrás (días)</label>
              <input type="number" min="1" max="90" step="1" value={values.lookbackDays ?? ''} onChange={(e) => set('lookbackDays', e.target.value)} />
              <span className="hint">Una liquidación más vieja que la ventana deja de contar.</span>
            </div>
            <div className="setting-row">
              <label>Ancho de franja (% del precio)</label>
              <input type="number" min="0.02" max="1" step="0.05" value={values.binPct ?? ''} onChange={(e) => set('binPct', e.target.value)} />
              <span className="hint">Una zona es el núcleo de un pico: hasta 3 franjas. Nunca es más fina que el dato de la fuente.</span>
            </div>
            <div className="setting-row">
              <label>Tamaño mínimo (% de la mayor zona de la ventana)</label>
              {percentInput('minShare', 0, 100, 1)}
            </div>
          </div>

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showLongs} onChange={(e) => set('showLongs', e.target.checked)} />
                Largos liquidados
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showShorts} onChange={(e) => set('showShorts', e.target.checked)} />
                Cortos liquidados
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showLabels} onChange={(e) => set('showLabels', e.target.checked)} />
                Monto y edad de cada zona
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showOffscreen} onChange={(e) => set('showOffscreen', e.target.checked)} />
                Aviso de zonas arriba o abajo de la vista
              </label>
            </div>
            <div className="setting-row">
              <label>Opacidad de la mayor zona (%)</label>
              {percentInput('maxOpacity', 5, 80, 5)}
              <span className="hint">Una zona más chica se ve más clara.</span>
            </div>
            <div style={{ display: 'flex', gap: '24px' }}>
              <div className="setting-row">
                <label>Largos liquidados</label>
                <input type="color" value={values.longColor} onChange={(e) => set('longColor', e.target.value)} />
              </div>
              <div className="setting-row">
                <label>Cortos liquidados</label>
                <input type="color" value={values.shortColor} onChange={(e) => set('shortColor', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="settings-section">
            <h4>Datos disponibles</h4>
            <div className="setting-row">
              <label>Fuente</label>
              <select value={values.source || 'auto'} onChange={(e) => set('source', e.target.value)}>
                {SOURCE_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <span className="hint">Una fuente fija sirve para comparar dos fuentes en la misma fecha.</span>
            </div>
            {sources.length === 0 ? (
              <span className="hint">Sin datos cargados para {symbol}. Se actualizan con backend/liq_update.py.</span>
            ) : (
              sources.map(source => (
                <div key={source.id} className="setting-row" style={{ marginBottom: '6px' }}>
                  <label>{source.label}, {source.scope}</label>
                  <span className="hint">
                    {coverageText(source, 4)} · {source.days} días con datos ·{' '}
                    {source.kind === 'events' ? 'eventos con hora'
                      : source.kind === 'spans' ? 'por intervalo, precio estimado con velas de 5 minutos'
                        : 'por día y precio, se conoce al cerrar el día'}
                  </span>
                </div>
              ))
            )}
            <span className="hint" style={{ display: 'block' }}>
              Nunca se mezclan dos fuentes, porque sus montos no se comparan. En automática manda, en cada fecha, la primera de la lista que tenga datos.
              El gráfico dice arriba a la izquierda cuál se está usando. Fuera de estas fechas lo avisa y no dibuja nada.
            </span>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues(defaultLiquidationsConfig())}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default LiquidationsSettings;
