import React from 'react';
import { CONTEXT_OPTIONS, REASONS } from './observer.js';
import './Observer.css';

const Chip = ({ active, onClick, children }) => (
  <button type="button" className={`observer-chip ${active ? 'active' : ''}`} onClick={onClick}>
    {children}
  </button>
);

/** Marcas rápidas del motivo de la orden. Todas son opcionales. */
const ObserverMarks = ({ marks, onChange }) => {
  const setContext = (key, value) => onChange(current => ({ ...current, [key]: current[key] === value ? null : value }));
  const toggleReason = (reason) => onChange(current => ({
    ...current,
    reasons: current.reasons.includes(reason)
      ? current.reasons.filter(item => item !== reason)
      : [...current.reasons, reason]
  }));

  return (
    <div className="control-section">
      <label>¿Por qué entras?</label>
      {[['context4h', '4h'], ['context1h', '1h']].map(([key, name]) => (
        <div className="observer-marks-row" key={key}>
          <span className="observer-marks-name">{name}</span>
          {CONTEXT_OPTIONS.map(([value, label]) => (
            <Chip key={value} active={marks[key] === value} onClick={() => setContext(key, value)}>{label}</Chip>
          ))}
        </div>
      ))}
      <div className="observer-marks-row wrap">
        {REASONS.map(([value, label]) => (
          <Chip key={value} active={marks.reasons.includes(value)} onClick={() => toggleReason(value)}>{label}</Chip>
        ))}
      </div>
    </div>
  );
};

export default ObserverMarks;
