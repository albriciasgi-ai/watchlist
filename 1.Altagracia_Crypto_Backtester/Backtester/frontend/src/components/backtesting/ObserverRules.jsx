import React, { useEffect, useState } from 'react';
import { fetchMeasures, formatR, ruleRequest, runRule, yearsToShow } from './observer.js';
import './Observer.css';

const MAX_CONDITIONS = 3;
const FIRST_CONDITION = { key: 'pressure_1h', op: '>=', value: '1' };

const share = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

/** Elige hasta tres condiciones y mira cuántas veces se cumplieron en fechas que no operaste y qué pasó después */
const ObserverRules = ({ symbol, until }) => {
  const [catalog, setCatalog] = useState([]);
  const [conditions, setConditions] = useState([FIRST_CONDITION]);
  const [side, setSide] = useState('both');
  const [stopAtr, setStopAtr] = useState('1.5');
  const [targetR, setTargetR] = useState('2');
  const [horizon, setHorizon] = useState('96');
  const [cooldown, setCooldown] = useState('16');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    fetchMeasures(symbol).then(data => active && setCatalog(data.measures)).catch(failure => active && setError(failure.message));
    return () => { active = false; };
  }, [symbol]);

  const change = (index, field, value) => {
    setConditions(current => current.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const run = async () => {
    const { rule, error: invalid } = ruleRequest({ conditions, side, stopAtr, targetR, horizon, cooldown });
    if (invalid) {
      setError(invalid);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      setResult(await runRule(symbol, { ...rule, until }));
    } catch (failure) {
      setError(failure.message);
    }
    setRunning(false);
  };

  const groups = [...new Set(catalog.map(item => item.group))];

  return (
    <div className="settings-section">
      <h4>Probar una regla en el histórico</h4>
      <p className="observer-report-note">
        Las medidas se leen a favor de la operación. Se prueba en las fechas que no has operado y entrando al cierre de la vela de 15 minutos.
      </p>

      {conditions.map((condition, index) => (
        <div className="observer-rule-row" key={index}>
          <select value={condition.key} onChange={(e) => change(index, 'key', e.target.value)}>
            {groups.map(group => (
              <optgroup key={group} label={group}>
                {catalog.filter(item => item.group === group).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </optgroup>
            ))}
          </select>
          <select value={condition.op} onChange={(e) => change(index, 'op', e.target.value)}>
            <option value=">=">mayor o igual a</option>
            <option value="<=">menor o igual a</option>
          </select>
          <input type="number" step="any" value={condition.value} onChange={(e) => change(index, 'value', e.target.value)} />
          {conditions.length > 1 && (
            <button type="button" className="btn-quick" onClick={() => setConditions(current => current.filter((_, i) => i !== index))}>Quitar</button>
          )}
        </div>
      ))}
      {conditions.length < MAX_CONDITIONS && (
        <button type="button" className="btn-quick" onClick={() => setConditions(current => [...current, { ...FIRST_CONDITION }])}>Agregar condición</button>
      )}

      <div className="observer-rule-options">
        <label>Lado
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="both">Compras y ventas</option>
            <option value="long">Solo compras</option>
            <option value="short">Solo ventas</option>
          </select>
        </label>
        <label>Stop (ATR de 15m)<input type="number" min="0.1" step="0.1" value={stopAtr} onChange={(e) => setStopAtr(e.target.value)} /></label>
        <label>Objetivo (R)<input type="number" min="0.1" step="0.1" value={targetR} onChange={(e) => setTargetR(e.target.value)} /></label>
        <label>Velas máximas<input type="number" min="1" value={horizon} onChange={(e) => setHorizon(e.target.value)} /></label>
        <label>Velas entre señales<input type="number" min="1" value={cooldown} onChange={(e) => setCooldown(e.target.value)} /></label>
      </div>

      <button type="button" className="btn-primary" disabled={running || !catalog.length} onClick={run}>
        {running ? 'Probando...' : 'Probar regla'}
      </button>

      {error && <p className="observer-report-warning">{error}</p>}
      {result && result.status !== 'ready' && <p className="observer-report-note">Preparando las medidas de este símbolo. Inténtalo en un minuto.</p>}
      {result?.status === 'ready' && (
        <div className="observer-rule-result">
          <table className="observer-table">
            <thead><tr><th></th><th>Señales</th><th>Acierto</th><th>R promedio, neto de costos</th></tr></thead>
            <tbody>
              <tr>
                <td>Tu regla</td>
                <td>{result.signals}</td>
                <td>{share(result.win_rate)} <span className="observer-count">(95%: {share(result.win_low)} a {share(result.win_high)})</span></td>
                <td>{formatR(result.avg_r)} <span className="observer-count">(95%: {formatR(result.avg_low)} a {formatR(result.avg_high)})</span></td>
              </tr>
              <tr>
                <td>Entrar en cualquier momento</td>
                <td>{result.base.signals}</td>
                <td>{share(result.base.win_rate)}</td>
                <td>{formatR(result.base.avg_r)}</td>
              </tr>
            </tbody>
          </table>
          {result.small_sample && <p className="observer-report-warning">Menos de 30 señales: no alcanza para concluir nada.</p>}
          <p className="observer-report-note">
            La regla agrega {formatR(result.difference_r)} por operación frente a entrar en cualquier momento.
            {result.excluded_periods > 0 && ` Se excluyeron ${result.excluded_periods} períodos que ya operaste.`}
          </p>
          {yearsToShow(result.years).length > 0 && (
            <table className="observer-table">
              <thead><tr><th>Año</th><th>Señales</th><th>Acierto</th><th>R promedio</th></tr></thead>
              <tbody>
                {yearsToShow(result.years).map(row => (
                  <tr key={row.year}><td>{row.year}</td><td>{row.signals}</td><td>{share(row.win_rate)}</td><td>{formatR(row.avg_r)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default ObserverRules;
