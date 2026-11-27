import React, { useState } from 'react';
import './RejectionPatternSettings.css';
import { cleanEMAConfig, defaultEMAConfig, emaColor, saveEMASettings, EMA_MAX_LINES, EMA_PERIOD } from './indicators/EMAIndicator.js';

/** Medias móviles exponenciales: varias a la vez, cada una con su periodo. Aplica a todos los marcos del símbolo. */
const EMASettings = ({ symbol, indicator, onApply, onClose }) => {
  const [lines, setLines] = useState(() => indicator.config.lines.map(line => ({ ...line })));
  const [showLabels, setShowLabels] = useState(indicator.config.showLabels !== false);

  const setLine = (index, patch) => setLines(previous => previous.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const addLine = () => setLines(previous => {
    const used = new Set(previous.map(line => Math.round(Number(line.period))));
    const period = [9, 20, 50, 100, 200, 14, 34, 150].find(value => !used.has(value)) ?? 10;
    return [...previous, { period, color: emaColor(previous.length), width: 1.5 }];
  });

  const clean = cleanEMAConfig({ lines, showLabels });
  const dropped = lines.length - clean.lines.length;

  const handleApply = () => {
    saveEMASettings(symbol, clean);
    onApply(clean);
    onClose();
  };

  return (
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal">
        <div className="settings-header">
          <h3>EMA - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h4>Líneas</h4>
            {lines.map((line, index) => (
              <div key={index} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '8px' }}>
                <div className="setting-row" style={{ marginBottom: 0 }}>
                  <label>Periodo (velas)</label>
                  <input type="number" min={EMA_PERIOD.min} max={EMA_PERIOD.max} step="1" value={line.period ?? ''}
                    onChange={(e) => setLine(index, { period: e.target.value })} />
                </div>
                <div className="setting-row" style={{ marginBottom: 0 }}>
                  <label>Grosor</label>
                  <input type="number" min="0.5" max="4" step="0.5" value={line.width ?? ''}
                    onChange={(e) => setLine(index, { width: e.target.value })} />
                </div>
                <div className="setting-row" style={{ marginBottom: 0 }}>
                  <label>Color</label>
                  <input type="color" value={line.color} onChange={(e) => setLine(index, { color: e.target.value })} />
                </div>
                <button className="btn-secondary" title="Quitar esta línea"
                  onClick={() => setLines(previous => previous.filter((_, i) => i !== index))}>Quitar</button>
              </div>
            ))}
            {lines.length < EMA_MAX_LINES && (
              <button className="btn-secondary" onClick={addLine}>+ Otra EMA</button>
            )}
            <span className="hint" style={{ display: 'block', marginTop: '8px' }}>
              Hasta {EMA_MAX_LINES} líneas, de {EMA_PERIOD.min} a {EMA_PERIOD.max} velas. Es la EMA del cierre, la misma del backtesting global y de la cocina de estrategias.
              {dropped > 0 ? ` ${dropped === 1 ? 'Una línea no se aplica' : `${dropped} líneas no se aplican`}: periodo repetido o fuera de rango.` : ''}
            </span>
          </div>

          <div className="settings-section">
            <h4>Qué se muestra</h4>
            <div className="setting-row">
              <label className="checkbox-label">
                <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
                El nombre de cada línea junto a su último punto
              </label>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={() => { const base = defaultEMAConfig(); setLines(base.lines); setShowLabels(base.showLabels); }}>Restablecer</button>
          <button className="btn-primary" onClick={handleApply}>Aplicar y cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default EMASettings;
