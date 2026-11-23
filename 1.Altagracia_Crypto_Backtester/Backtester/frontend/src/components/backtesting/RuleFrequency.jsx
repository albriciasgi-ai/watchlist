import React, { useState } from 'react';
import { API_BASE_URL } from '../../config.js';

/**
 * Informe de frecuencia de la señal de una regla (23/11/2026, pedido del usuario): cuántas veces pasa algo en las velas
 * que siguen a la señal, sin entrada, stop ni salida. El cálculo está en backend/rule_frequency.py.
 * - Solo en la fase 1 (el backend no lo corre en otra): también es una mirada a los datos.
 * - `rule` es la regla de la corrida a la vista. De ella solo cuenta la señal: elementos, receta y filtros.
 * - Cada pregunta queda anotada, y el informe dice cuántas se han hecho.
 */
const KINDS = [
  ['reach', 'Llega a … ATR a favor'],
  ['first', 'Llega a favor antes que en contra'],
  ['close', 'Cierra a favor a las N velas'],
];
const pct = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`);
const signed = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`;

const Field = ({ value, onChange, min, max, step }) => (
  <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
);

export default function RuleFrequency({ symbol, rule }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('reach');
  const [bars, setBars] = useState(10);
  const [a, setA] = useState(1);
  const [b, setB] = useState(1);
  const [state, setState] = useState(null); // null | 'loading' | { error } | informe

  const ask = async () => {
    setState('loading');
    try {
      const response = await fetch(`${API_BASE_URL}/api/tester/frequency/${symbol}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule, question: { kind, bars, a: kind === 'close' && a === '' ? 0 : a, b } }),
      });
      if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
      const data = await response.json();
      setState(data.success ? data : { error: data.message || 'No se pudo calcular' });
    } catch (error) {
      setState({ error: error.message });
    }
  };

  const report = state && state !== 'loading' && !state.error ? state : null;
  const row = (label, c, key) => (
    <tr key={key || label}><td>{label}</td><td>{c.n}</td><td>{c.hits}</td><td>{pct(c.rate)}</td><td>{c.n ? `${pct(c.low)} a ${pct(c.high)}` : '—'}</td></tr>
  );

  return (
    <div className="rt-group" style={{ marginTop: 8 }}>
      <h4 style={{ cursor: 'pointer' }} onClick={() => setOpen(v => !v)} title="Cuántas veces pasa algo tras la señal de esta regla, sin entrada ni salida. Solo en la fase 1">
        {open ? '▾' : '▸'} Frecuencia de la señal
      </h4>
      {open && (
        <>
          <div className="rt-note" style={{ marginBottom: 6 }}>
            Cuando aparece la señal de esta regla (sus elementos y sus filtros; la entrada, el stop y la salida no cuentan), ¿cuántas veces el precio…
          </div>
          <div className="rt-row">
            <select value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === 'close') setA(0); else if (!a) setA(1); }}>
              {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className="rt-row">
            {kind === 'reach' && <><span>llega a</span><Field value={a} onChange={setA} min={0.05} max={50} step={0.25} /><span>ATR a favor en</span></>}
            {kind === 'first' && <><span>llega a</span><Field value={a} onChange={setA} min={0.05} max={50} step={0.25} /><span>ATR a favor antes que a</span><Field value={b} onChange={setB} min={0.05} max={50} step={0.25} /><span>ATR en contra, en</span></>}
            {kind === 'close' && <><span>cierra más de</span><Field value={a} onChange={setA} min={0} max={50} step={0.25} /><span>ATR a favor a las</span></>}
            <Field value={bars} onChange={setBars} min={1} max={300} step={1} /><span>velas?</span>
            <button type="button" className="rt-btn" disabled={state === 'loading' || bars === '' || a === ''} onClick={ask}>{state === 'loading' ? 'Contando…' : 'Contar'}</button>
          </div>
          {state?.error && <div className="rt-warn">{state.error}</div>}
          {report && (
            <>
              {report.small && <div className="rt-warn">Muestra pequeña ({report.separated.n} señales separadas): con menos de 30 nada se distingue de una vela cualquiera.</div>}
              <div className="rt-cards">
                <div className="rt-card" title="Solo las señales que no se pisan: tras contar una, las de las velas de su ventana no cuentan. Es la tasa que se compara"><b>{pct(report.separated.rate)}</b><span>Señales separadas ({report.separated.hits} de {report.separated.n})</span></div>
                <div className="rt-card" title={`Todas las velas de la fase en que la regla podría dar señal (${Number(report.base.n).toLocaleString('es-CO')}), con la misma parte de largos y cortos`}><b>{pct(report.base.rate)}</b><span>Una vela cualquiera</span></div>
                <div className="rt-card" title="La tasa de las señales separadas menos la de una vela cualquiera, con su margen del 95%">
                  <b>{report.edge ? `${signed(report.edge.diff)} pts` : '—'}</b>
                  <span>{report.edge ? `Diferencia (±${report.edge.margin}) · ${report.edge.clear ? 'se distingue' : 'no se distingue'}` : 'Diferencia'}</span>
                </div>
              </div>
              <table className="rt-table">
                <thead><tr><th></th><th>Señales</th><th>Pasó</th><th>Tasa</th><th>Rango 95%</th></tr></thead>
                <tbody>
                  {row('Todas', report.all)}
                  {row('Separadas', report.separated)}
                  {report.sides.map(s => row(s.side === 'largos' ? 'Largos' : 'Cortos', s, s.side))}
                  {report.years.map(y => row(String(y.year), y))}
                </tbody>
              </table>
              <div className="rt-note">
                Fase 1 ({report.from} a {report.to}): cuántas veces el precio {report.text}, desde la apertura de la vela siguiente a la señal y en ATR de la vela de la señal. Sin comisiones: no es un trade.
                {report.doubts > 0 && ` En ${report.doubts} señales las dos metas cayeron en la misma vela: cuentan como que no.`}
                {report.unfinished > 0 && ` ${report.unfinished} señales del final de la fase no tienen sus velas completas y no cuentan.`}
                {' '}Llevas {report.askedThisSignal} {report.askedThisSignal === 1 ? 'pregunta' : 'preguntas'} sobre esta señal y {report.askedBefore} en esta moneda: cuantas más se hacen, más fácil es que alguna salga bien por azar.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
