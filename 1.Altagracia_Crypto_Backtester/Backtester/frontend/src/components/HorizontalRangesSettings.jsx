import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import {
  METHODS, NULLABLE, cleanHorizontalRangesSettings, defaultHorizontalRangesConfig, saveHorizontalRangesSettings, tunedParams
} from './indicators/HorizontalRangesIndicator.js';
import { PARAMS } from './indicators/regimeDetectors.js';

// Textos de la pestaña Régimen del backtesting global (RegimeTab.jsx)
const PARAM_LABEL = {
  n: 'Velas', below: 'Bajo', buffer: 'Margen de salida (ATR)', exit_er: 'Sale si la eficiencia pasa de (vacío = no)', min_bars: 'Velas seguidas',
  bb_k: 'Bollinger (σ)', kc_k: 'Keltner (ATR)', lookback: 'Velas del percentil', length: 'Velas', atr_len: 'Velas del ATR', mult: 'ATR',
  max_out: 'Cierres fuera para terminar', threshold: 'Umbral (vacío = el de App 1)', min_c: 'Velas mínimas', range_pct: 'Rango máximo (%)',
  range_atr: 'Rango máximo (ATR, vacío = usar %)', min_d: 'd_score mínimo', close_out: 'Cierres fuera del valor'
};
const HELP = {
  er_box: 'Rango cuando el avance neto de las últimas velas es poco comparado con lo recorrido. Su caja son el máximo y el mínimo de esas velas y no crece. Termina en el primer cierre fuera de la caja o cuando la eficiencia sube.',
  er: 'Rango mientras el avance neto de las últimas velas es poco comparado con lo recorrido.',
  adx: 'Rango mientras el ADX está bajo.',
  ttm: 'Rango mientras la banda de Bollinger cabe dentro del canal de Keltner.',
  bbwp: 'Rango mientras el ancho de Bollinger está en un percentil bajo de su historia.',
  atr_range: 'El Range Detection de App 1: los últimos cierres quedan a menos de N ATR de su media. Ojo: los cierres fuera que no alcanzan a terminar el rango cuentan como rango si el precio vuelve, así que la caja se alarga hacia atrás.',
  vwap_bw: 'El BandWidth del VWAP de sesión de App 1, bajo su umbral de "consolidación".',
  vp_prog: 'El "Progresivo (D creciente)" de App 8: las últimas velas caben en un rango estrecho y su perfil de volumen es D.'
};
// Calificación en 4h con los afinados (J = rango hallado − tendencia confundida; 0 es azar), en 2023, siete monedas
const SCORE = { er_box: 0.32, er: 0.31, vp_prog: 0.25, ttm: 0.22, adx: 0.21, atr_range: 0.19, bbwp: 0.13, vwap_bw: 0.01 };

const pick = (config) => {
  const base = defaultHorizontalRangesConfig();
  return { ...base, ...config, params: { ...base.params, ...(config.params || {}) } };
};

/** Método de detección de los rangos horizontales, sus parámetros y lo que se muestra. Aplica a todos los marcos del símbolo. */
const HorizontalRangesSettings = ({ symbol, indicator, onApply, onClose }) => {
  const [values, setValues] = useState(() => pick(indicator.config));
  const set = (key, value) => setValues(previous => ({ ...previous, [key]: value }));
  const method = values.method;
  const own = values.params[method] || {};
  const setParam = (name, value) => setValues(previous => ({
    ...previous, params: { ...previous.params, [method]: { ...previous.params[method], [name]: value } }
  }));
  const preset = (which) => setValues(previous => ({
    ...previous,
    params: { ...previous.params, [method]: { ...(which === 'original' && PARAMS[method].original ? PARAMS[method].original : PARAMS[method].params) } }
  }));

  const handleApply = () => {
    const settings = cleanHorizontalRangesSettings(values);
    saveHorizontalRangesSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Rangos horizontales - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Método de detección</h4>
            <div className="setting-row">
              <label>Método</label>
              <select value={method} onChange={(e) => set('method', e.target.value)}>
                {METHODS.map(key => <option key={key} value={key}>{PARAMS[key].label}</option>)}
              </select>
              <span className="hint">{HELP[method]}</span>
              <span className="hint">Calificación en 4h con los afinados: J {SCORE[method].toFixed(2)} (rango hallado menos tendencia confundida con rango; 0 es azar). Medido en 2023, siete monedas.</span>
            </div>
            {Object.keys(PARAMS[method].params).map(name => (
              <div className="setting-row" key={name}>
                <label>{PARAM_LABEL[name] || name}</label>
                <input type="number" step="any" value={own[name] ?? ''}
                  onChange={(e) => setParam(name, e.target.value === '' ? (NULLABLE.has(name) ? null : '') : e.target.value)} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button className="btn-secondary" onClick={() => preset('tuned')} title="Los afinados en la fase 1 contra la referencia de 48 velas">Afinados (4h)</button>
              {PARAMS[method].original && <button className="btn-secondary" onClick={() => preset('original')} title="Como estaban en App 1 o App 8">De fábrica</button>}
            </div>
            <span className="hint">Los afinados salieron en 4h. En otros marcos los parámetros cuentan en velas de ese marco.</span>
          </div>

          <div className="settings-section">
            <h4>Rango mayor</h4>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.major} onChange={(e) => set('major', e.target.checked)} />
                Construir el rango mayor
              </label>
              <span className="hint">Une las cajas del método en un rango de más tiempo, en naranja: empieza con una caja, crece con las que aparecen mientras sigue y termina tras varios cierres seguidos fuera.</span>
            </div>
            {values.major && (
              <>
                <div className="setting-row">
                  <label>Alto máximo del rango (ATR)</label>
                  <input type="number" min="1" max="50" step="0.5" value={values.majorAtr ?? ''} onChange={(e) => set('majorAtr', e.target.value)} />
                </div>
                <div className="setting-row">
                  <label>Margen fuera de la caja (ATR)</label>
                  <input type="number" min="0" max="10" step="0.1" value={values.majorBuffer ?? ''} onChange={(e) => set('majorBuffer', e.target.value)} />
                </div>
                <div className="setting-row">
                  <label>Cierres seguidos fuera para terminar</label>
                  <input type="number" min="1" max="50" step="1" value={values.majorOut ?? ''} onChange={(e) => set('majorOut', e.target.value)} />
                  <span className="hint">En 4h con la eficiencia con caja: con 1 dura lo mismo que las cajas chicas; con 3, unos 5 días; con 6, de 8 a 12 días.</span>
                </div>
              </>
            )}
          </div>

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showBoxes} onChange={(e) => set('showBoxes', e.target.checked)} />
                Cajas del método
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showBefore} onChange={(e) => set('showBefore', e.target.checked)} />
                Tramo antes de saberse (punteado)
              </label>
            </div>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.showBar} onChange={(e) => set('showBar', e.target.checked)} />
                Barra bajo las velas mientras hay rango
              </label>
            </div>
            <div className="setting-row">
              <label>Opacidad del relleno (%)</label>
              <input type="number" min="2" max="60" step="1" value={Math.round((Number(values.opacity) || 0) * 100)} onChange={(e) => set('opacity', e.target.value / 100)} />
            </div>
            <span className="hint">Solo se calcula con velas cerradas: la caja va punteada hasta la vela en que se supo y marcada desde ahí.</span>
          </div>

          <div className="settings-section">
            <h4>Perfil de volumen</h4>
            <div className="setting-row" style={{ marginBottom: '8px' }}>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!values.profile} onChange={(e) => set('profile', e.target.checked)} />
                Dibujar el perfil de volumen de cada rango
              </label>
              <span className="hint">El de las velas cerradas del rango, desde su primera vela hasta la última que cerró dentro de su caja: las de la ruptura del final no cuentan (si el precio vuelve a cerrar dentro, sí). El de un rango que sigue vivo crece con cada vela que cierra dentro. Con trades en el almacén que cubren todo el rango, el volumen es real (la etiqueta dice «real»); si no, el de cada vela se reparte entre su mínimo y su máximo.</span>
            </div>
            {values.profile && (
              <>
                {values.major && (
                  <div className="setting-row">
                    <label>Sobre</label>
                    <select value={values.profileOn} onChange={(e) => set('profileOn', e.target.value)}>
                      <option value="major">El rango mayor</option>
                      <option value="boxes">Las cajas del método</option>
                    </select>
                  </div>
                )}
                {(!values.major || values.profileOn === 'boxes') && !values.showBoxes && (
                  <span className="hint">Las cajas del método están ocultas: no se verá ningún perfil.</span>
                )}
                <div className="setting-row">
                  <label>Franjas de precio</label>
                  <input type="number" min="10" max="400" step="1" value={values.profileRows ?? ''} onChange={(e) => set('profileRows', e.target.value)} />
                </div>
                <div className="setting-row">
                  <label>Área de valor (%)</label>
                  <input type="number" min="20" max="100" step="1" value={values.profileVa ?? ''} onChange={(e) => set('profileVa', e.target.value)} />
                </div>
                <div className="setting-row">
                  <label>Largo de la barra mayor (% del ancho del rango)</label>
                  <input type="number" min="5" max="100" step="1" value={values.profileWidth ?? ''} onChange={(e) => set('profileWidth', e.target.value)} />
                </div>
                <div className="setting-row" style={{ marginBottom: '8px' }}>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={!!values.profilePoc} onChange={(e) => set('profilePoc', e.target.checked)} />
                    Línea del POC
                  </label>
                </div>
                <div className="setting-row" style={{ marginBottom: '8px' }}>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={!!values.profileVaLines} onChange={(e) => set('profileVaLines', e.target.checked)} />
                    Líneas del VAH y el VAL
                  </label>
                </div>
                <div className="setting-row" style={{ marginBottom: '8px' }}>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={!!values.profileLabel} onChange={(e) => set('profileLabel', e.target.checked)} />
                    Precio del POC en los rangos anchos
                  </label>
                </div>
                <span className="hint">Los colores salen del estilo elegido (modal Estilo, «Perfil de volumen»). Un clic en el POC, el VAH o el VAL los ofrece para el análisis del trade.</span>
              </>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues({ ...defaultHorizontalRangesConfig(), params: tunedParams() })}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default HorizontalRangesSettings;
