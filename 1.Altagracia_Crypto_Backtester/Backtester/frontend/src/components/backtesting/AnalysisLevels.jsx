import React, { useEffect, useState } from 'react';
import { ROLES, clearLevels, knownLevels, removeLevel, subscribeLevels, updateLevel } from '../indicators/analysisLevels.js';
import { isBlind, maskDate, priceText } from './blindClock.js';
import './Observer.css';

const candleTime = (time) => (isBlind() ? maskDate(time) : new Date(time).toLocaleString('es-CO', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
}));

/** Niveles y marcas elegidos en el gráfico, con su papel y su nota. Pasan a la orden que se crea y la lista queda vacía */
const AnalysisLevels = ({ symbol, time }) => {
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
      {levels.map(level => (
        <div className="analysis-level-entry" key={level.id}>
          <div className="analysis-level">
            <select
              className="analysis-level-role"
              value={level.role ?? ''}
              title="Papel en el trade"
              onChange={(e) => updateLevel(symbol, level.id, { role: e.target.value })}
            >
              {level.mark ? <option value="">Solo marca</option> : (level.role ?? null) === null && <option value="" disabled>Nivel</option>}
              {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
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
