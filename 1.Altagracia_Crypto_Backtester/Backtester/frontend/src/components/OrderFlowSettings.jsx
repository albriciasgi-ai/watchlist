import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { OF_FACTORY, saveOrderFlowSettings } from './indicators/OrderFlowIndicator.js';
import { THEME, customList, isNewTheme } from './uiTheme.js';

const TIMEFRAMES = [['1m', 1], ['5m', 5], ['15m', 15], ['1h', 60], ['4h', 240]];

// Parámetro: [mínimo, máximo]. Fuera del rango se ajusta al guardar.
const NUMBER_LIMITS = {
  maxLevels: [3, 50],
  imbalanceRatio: [1.1, 50],
  imbalanceCandleVolumePct: [0, 1000],
  imbalanceCandleVolumeBars: [1, 100],
  imbalanceCellSharePct: [0, 100],
  stackedMinLevels: [2, 20],
  stackedMinVolumeZScore: [0, 5],
  minCandleWidth: [4, 200],
  minCandleWidthFull: [20, 400],
  fontSize: [7, 14],
  deltaFontSize: [8, 24],
  deltaMarkMinShare: [0.01, 1],
  stackedLineWidth: [1, 6],
  stackedLineExtend: [1, 8],
  stackedOpacity: [0.1, 1]
};

const CHECKBOXES = [
  ['showCandle', 'Vela junto al footprint'],
  ['showFootprint', 'Celdas de compra y venta'],
  ['showProfile', 'Perfil de cada vela'],
  ['showPOC', 'POC de cada vela'],
  ['showImbalances', 'Resaltar imbalances'],
  ['showDelta', 'Delta debajo de la vela'],
  ['showDeltaMarks', 'Rombos de delta contrario a la vela']
];

const TEXT_KEYS = ['imbalanceMode', 'profileMode', 'stackedBuyColor', 'stackedSellColor'];
const EDITABLE = [...Object.keys(NUMBER_LIMITS), ...CHECKBOXES.map(([key]) => key), ...TEXT_KEYS, 'imbalanceCountZero', 'stepByMinutes'];

const rgbToHex = (rgb) => `#${rgb.split(',').map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
const hexToRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',');

const pick = (config) => Object.fromEntries(EDITABLE.map(key => [key, config[key]]));

/** Valores listos para aplicar: números dentro de su rango y steps vacíos como automáticos */
export function cleanOrderFlowSettings(values, defaults) {
  const clean = { ...values, stepByMinutes: {} };

  for (const [key, [min, max]] of Object.entries(NUMBER_LIMITS)) {
    const number = parseFloat(values[key]);
    clean[key] = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : defaults[key];
  }
  clean.stackedMinLevels = Math.round(clean.stackedMinLevels);
  clean.imbalanceCandleVolumeBars = Math.round(clean.imbalanceCandleVolumeBars);
  if (!['volume', 'delta', 'both'].includes(clean.profileMode)) clean.profileMode = defaults.profileMode;

  for (const [, minutes] of TIMEFRAMES) {
    const step = parseFloat(values.stepByMinutes?.[minutes]);
    if (step > 0) clean.stepByMinutes[minutes] = step;
  }
  return clean;
}

const NumberRow = ({ label, hint, value, onChange, step = 1, min, max }) => (
  <div className="setting-row">
    <label>{label}</label>
    <input type="number" min={min} max={max} step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    {hint && <span className="hint">{hint}</span>}
  </div>
);

/**
 * Parámetros del Order Flow. Los imbalances y el step cambian lo que entrega el almacén de
 * trades; lo demás solo cambia el dibujo. Aplica a todos los marcos del símbolo.
 */
const OrderFlowSettings = ({ symbol, indicator, activeTimeframe, onApply, onClose }) => {
  const [values, setValues] = useState(() => ({ ...pick(indicator.config), customVisual: customList(indicator.config, OF_FACTORY) }));
  const defaults = indicator.getDefaultConfig();
  // Lo visual que el usuario cambia aquí queda como suyo: gana sobre el estilo Nítido
  const set = (key, value) => setValues(previous => {
    const chosen = previous.customVisual || [];
    const visual = key in OF_FACTORY && !chosen.includes(key) ? { customVisual: [...chosen, key] } : {};
    return { ...previous, [key]: value, ...visual };
  });
  // Con Nítido se muestra lo que se dibuja: el valor del estilo mientras el usuario no elija otro
  const nitido = isNewTheme();
  const styled = key => nitido && !(values.customVisual || []).includes(key);
  const setStep = (minutes, value) => setValues(previous => ({
    ...previous,
    stepByMinutes: { ...previous.stepByMinutes, [minutes]: value }
  }));

  const handleApply = () => {
    const settings = cleanOrderFlowSettings(values, defaults);
    saveOrderFlowSettings(symbol, settings);
    onApply(settings);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>Order Flow - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Tamaño de celda (step)</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {TIMEFRAMES.map(([name, minutes]) => (
                <div className="setting-row" key={name} style={{ marginBottom: 0 }}>
                  <label>{name}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Auto"
                    value={values.stepByMinutes?.[minutes] ?? ''}
                    onChange={(e) => setStep(minutes, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <span className="hint" style={{ display: 'block', marginTop: '8px' }}>
              {indicator.backtestingMode === false
                ? 'Precio por nivel. Vacío usa el automático: el mismo en todas las velas, con unos 10 niveles en la vela típica del marco.'
                : 'USD por nivel. Vacío usa el valor automático de cada marco.'}
              {indicator.stepSize ? ` En ${activeTimeframe} se está usando $${indicator.stepSize}.` : ''}
              {indicator.cellSize ? ` Se ajusta a múltiplos de $${indicator.cellSize}, la celda guardada.` : ''}
              {' '}Un step fijo se respeta hasta 200 niveles por vela.
            </span>
            {indicator.backtestingMode !== false && <div style={{ marginTop: '12px' }}>
              <NumberRow
                label="Máximo de niveles por vela"
                hint="Con step automático, una vela más ancha une niveles y sube su propio step."
                step="1" min="3" max="50"
                value={values.maxLevels}
                onChange={(value) => set('maxLevels', value)}
              />
            </div>}
          </div>

          <div className="settings-section">
            <h4>Imbalances</h4>
            <NumberRow
              label="Ratio mínimo"
              hint="Veces que un lado debe superar al otro. App 9 usa 3."
              step="0.5" min="1.1" max="50"
              value={values.imbalanceRatio}
              onChange={(value) => set('imbalanceRatio', value)}
            />
            <div className="setting-row">
              <label>Qué se compara</label>
              <select value={values.imbalanceMode} onChange={(e) => set('imbalanceMode', e.target.value)}>
                <option value="level">Compra y venta del mismo nivel</option>
                <option value="diagonal">Diagonal: compra contra la venta del nivel inferior</option>
              </select>
            </div>
            <NumberRow
              label="Volumen mínimo de la vela (%)"
              hint="Solo velas con al menos este % del volumen promedio de las velas anteriores tienen imbalances. 100 es una vela promedio; 0 es sin filtro."
              step="10" min="0" max="1000"
              value={values.imbalanceCandleVolumePct}
              onChange={(value) => set('imbalanceCandleVolumePct', value)}
            />
            <NumberRow
              label="Velas anteriores para el promedio"
              hint="Solo velas ya cerradas antes de cada vela. La vela en curso se compara con lo que lleva."
              step="1" min="1" max="100"
              value={values.imbalanceCandleVolumeBars}
              onChange={(value) => set('imbalanceCandleVolumeBars', value)}
            />
            <NumberRow
              label="Volumen de la celda del imbalance (% de su vela)"
              hint="Compra más venta de la celda. Un stacked se mide por la suma de sus celdas. 0 es sin filtro."
              step="1" min="0" max="100"
              value={values.imbalanceCellSharePct}
              onChange={(value) => set('imbalanceCellSharePct', value)}
            />
            <div className="setting-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!values.imbalanceCountZero}
                  onChange={(e) => set('imbalanceCountZero', e.target.checked)}
                />
                Contar el nivel aunque el otro lado esté en cero
              </label>
            </div>
            <NumberRow
              label="Niveles seguidos para un stacked"
              step="1" min="2" max="20"
              value={values.stackedMinLevels}
              onChange={(value) => set('stackedMinLevels', value)}
            />
            <NumberRow
              label="Z-Score mínimo de volumen para mostrar stacked"
              hint="0 los muestra todos. Más alto deja solo velas de volumen alto."
              step="0.1" min="0" max="5"
              value={values.stackedMinVolumeZScore}
              onChange={(value) => set('stackedMinVolumeZScore', value)}
            />
          </div>

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            {CHECKBOXES.map(([key, label]) => (
              <div className="setting-row" key={key} style={{ marginBottom: '8px' }}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={values[key] !== false} onChange={(e) => set(key, e.target.checked)} />
                  {label}
                </label>
              </div>
            ))}
            <div className="setting-row">
              <label>Perfil junto al footprint</label>
              <select value={values.profileMode || 'volume'} onChange={(e) => set('profileMode', e.target.value)}>
                <option value="volume">Volumen</option>
                <option value="delta">Delta</option>
                <option value="both">Volumen y al lado el delta</option>
              </select>
            </div>
            <NumberRow
              label="Parte del volumen contra la vela para el rombo (%)"
              step="1" min="1" max="100"
              value={Math.round(values.deltaMarkMinShare * 100)}
              onChange={(value) => set('deltaMarkMinShare', value / 100)}
            />
          </div>

          <div className="settings-section">
            <h4>Zoom</h4>
            <NumberRow
              label="Ancho de vela para ver el footprint (px)"
              hint="Por debajo quedan la vela, las líneas de stacked y los rombos."
              step="1" min="4" max="200"
              value={values.minCandleWidth}
              onChange={(value) => set('minCandleWidth', value)}
            />
            <NumberRow
              label="Ancho de vela para ver cifras y delta (px)"
              step="1" min="20" max="400"
              value={values.minCandleWidthFull}
              onChange={(value) => set('minCandleWidthFull', value)}
            />
            <NumberRow
              label="Tamaño de las cifras (px)"
              step="1" min="7" max="14"
              value={styled('fontSize') ? THEME.fontSize : values.fontSize}
              onChange={(value) => set('fontSize', value)}
            />
            <NumberRow
              label="Tamaño del delta debajo de la vela (px)"
              step="1" min="8" max="24"
              value={values.deltaFontSize}
              onChange={(value) => set('deltaFontSize', value)}
            />
          </div>

          <div className="settings-section">
            <h4>Franjas de stacked</h4>
            <span className="hint" style={{ display: 'block', marginBottom: '8px' }}>
              Con poco zoom son líneas; con el footprint a la vista, franjas desde la vela hacia la derecha.
            </span>
            <NumberRow
              label="Grosor (px)"
              step="1" min="1" max="6"
              value={values.stackedLineWidth}
              onChange={(value) => set('stackedLineWidth', value)}
            />
            <NumberRow
              label="Largo, en anchos de vela"
              step="1" min="1" max="8"
              value={values.stackedLineExtend}
              onChange={(value) => set('stackedLineExtend', value)}
            />
            <NumberRow
              label="Opacidad (%)"
              step="5" min="10" max="100"
              value={Math.round(values.stackedOpacity * 100)}
              onChange={(value) => set('stackedOpacity', value / 100)}
            />
            <div style={{ display: 'flex', gap: '24px' }}>
              <div className="setting-row">
                <label>Compra</label>
                <input type="color" value={styled('stackedBuyColor') ? THEME.fpBuy.toLowerCase() : rgbToHex(values.stackedBuyColor)} onChange={(e) => set('stackedBuyColor', hexToRgb(e.target.value))} />
              </div>
              <div className="setting-row">
                <label>Venta</label>
                <input type="color" value={styled('stackedSellColor') ? THEME.fpSell.toLowerCase() : rgbToHex(values.stackedSellColor)} onChange={(e) => set('stackedSellColor', hexToRgb(e.target.value))} />
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => setValues({ ...pick(defaults), customVisual: [] })}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default OrderFlowSettings;
