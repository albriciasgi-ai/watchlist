import React, { useEffect, useState } from 'react';
import { clearLevels, knownLevels, removeLevel, roleOptions, subscribeLevels, updateLevel } from '../indicators/analysisLevels.js';
import { isBlind, maskDate, priceText } from './blindClock.js';
import './Observer.css';

const candleTime = (time) => (isBlind() ? maskDate(time) : new Date(time).toLocaleString('es-CO', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
}));

// Número de cada elegido, el mismo del gráfico con chosenStyle 'numbers' (la suite)
const NUMBER_STYLE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 16, height: 16, borderRadius: 8,
  background: '#7C3AED', color: '#FFFFFF', fontSize: 10, fontWeight: 700, flex: '0 0 auto', marginRight: 4,
};

/**
 * Niveles y marcas elegidos en el gráfico, con su papel y su nota. Pasan a la orden que se crea y la lista queda vacía.
 * numbered: cada uno con su número del gráfico
 */
const AnalysisLevels = ({ symbol, time, numbered = false }) => {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeLevels(symbol, () => setVersion(version => version + 1)), [symbol]);

  const levels = knownLevels(symbol, time);

  return (
    <div className="control-section">
      <label>Niveles y marcas en análisis</label>
      {levels.length === 0 && (
        <div className="analysis-levels-hint">
          Haz clic sobre un POC, VAH, VAL, soporte, resistencia, FVG, footprint o rombo en el gráfico para incluirlo. Con Liquidaciones activo, también la franja de una vela fijada.
        </div>
      )}
      {levels.map((level, i) => (
        <div className="analysis-level-entry" key={level.id}>
          <div className="analysis-level">
            {numbered && <span style={NUMBER_STYLE} title="Su número en el gráfico">{i + 1}</span>}
            <select
              className="analysis-level-role"
              value={level.role ?? ''}
              title="Papel en el trade"
              onChange={(e) => updateLevel(symbol, level.id, { role: e.target.value })}
            >
              {!level.mark && (level.role ?? null) === null && <option value="" disabled>Nivel</option>}
              {roleOptions(level).map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
            <span className="analysis-level-name">{level.kind}</span>
            <span className="analysis-level-source">{level.source}</span>
            <span className="analysis-level-price">
              {level.mark && level.time !== undefined ? candleTime(level.time) : Number.isFinite(level.price) ? priceText(level.price, 1) : ''}
            </span>
            <button type="button" title="Quitar del análisis" onClick={() => removeLevel(symbol, level.id)}>×</button>
          </div>
          {level.note && <div className="analysis-level-note" title={level.note}>{level.note}</div>}
        </div>
      ))}
      {levels.length > 1 && (
        <button type="button" className="btn-quick" onClick={() => clearLevels(symbol, time)}>Quitar todos</button>
      )}
    </div>
  );
};

export default AnalysisLevels;
