import React, { useEffect, useState } from 'react';
import { fetchPatterns } from './observer.js';
import './Observer.css';

const ROWS_SHOWN = 10;
const BUILD_POLL_MS = 5000;

const share = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);
const number = (value) => (value === null || value === undefined ? '—' : Number(value.toFixed(2)));

const PatternTable = ({ result, first, second, empty }) => {
  if (!result.rows.length) return <p className="observer-report-note">{empty}</p>;
  return (
    <>
      <table className="observer-table">
        <thead>
          <tr><th>Medida</th><th>{first}</th><th>{second}</th><th>Mayor en</th><th></th></tr>
        </thead>
        <tbody>
          {result.rows.slice(0, ROWS_SHOWN).map(row => (
            <tr key={row.key} className={row.clear ? 'observer-row-clear' : ''}>
              <td>{row.label}</td>
              <td>{number(row.first_median)}</td>
              <td>{number(row.second_median)}</td>
              <td>{share(row.share)}</td>
              <td>{row.clear ? 'Clara' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="observer-report-note">
        Valores típicos de cada grupo. "Mayor en" dice en qué parte de las comparaciones el primer grupo gana al segundo: 50% es no distinguirlos.
        "Clara" supera lo que da el azar al revisar {result.rows.length} medidas juntas.
      </p>
    </>
  );
};

/** Qué distingue tus entradas de los momentos sin entrada, y las ganadoras de las perdedoras */
const ObserverPatterns = ({ symbol, blind, includeRewound, until }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let timer = null;
    const load = () => fetchPatterns({ symbol, blind, includeRewound, until })
      .then(result => {
        if (!active) return;
        setData(result);
        setError(null);
        if (result.status !== 'ready' && result.status !== 'unavailable') timer = setTimeout(load, BUILD_POLL_MS);
      })
      .catch(failure => active && setError(failure.message));
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [symbol, blind, includeRewound, until]);

  if (error) return <p className="observer-report-warning">No se pudieron leer los patrones: {error}</p>;
  if (!data) return <p className="observer-report-note">Buscando patrones...</p>;
  if (data.status === 'unavailable') return <p className="observer-report-note">Este símbolo todavía no tiene velas guardadas.</p>;
  if (data.status !== 'ready') return <p className="observer-report-note">Preparando las medidas de este símbolo. Tarda cerca de un minuto.</p>;

  const { counts, references } = data;
  return (
    <>
      <div className="settings-section">
        <h4>Qué te hace entrar</h4>
        <p className="observer-report-note">
          Tus {counts.entries} entradas contra {counts.controls} momentos sin entrada de esas mismas semanas.
        </p>
        {data.small_sample && (
          <p className="observer-report-warning">Con menos de 30 entradas solo se ven diferencias muy grandes.</p>
        )}
        <PatternTable result={data.entries} first="Al entrar" second="Sin entrada" empty="Todavía no hay entradas suficientes para comparar." />
      </div>

      <div className="settings-section">
        <h4>Qué separa las ganadoras</h4>
        <p className="observer-report-note">{counts.winners} ganadoras contra {counts.losers} perdedoras.</p>
        <PatternTable result={data.results} first="Ganadoras" second="Perdedoras" empty="Hacen falta al menos 5 ganadoras y 5 perdedoras." />
      </div>

      {references.with_reference > 0 && (
        <div className="settings-section">
          <h4>Tus referencias</h4>
          <table className="observer-table">
            <thead><tr><th>Entrada</th><th>Cerradas</th><th>Acierto</th></tr></thead>
            <tbody>
              <tr><td>En un nivel o dibujo tuyo</td><td>{references.closed_at_level}</td><td>{share(references.win_at_level)}</td></tr>
              <tr><td>Lejos de ellos</td><td>{references.closed_away}</td><td>{share(references.win_away)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default ObserverPatterns;
