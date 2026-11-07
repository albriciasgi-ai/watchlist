import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { exportUrl, fetchReport, formatR, reasonLabel } from './observer.js';
import ObserverPatterns from './ObserverPatterns';
import ObserverRules from './ObserverRules';
import '../RejectionPatternSettings.css';
import './Observer.css';

const BLOCK_NAMES = {
  context_240: 'Contexto 4 horas',
  context_60: 'Contexto 1 hora',
  move: 'Movimiento con volumen',
  zone: 'Zona',
  oi: 'OI creciendo'
};

const share = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

const Outcome = ({ stats }) => (
  stats.n === 0
    ? <td colSpan="2" className="observer-empty-cell">Sin órdenes</td>
    : (
      <>
        <td>{share(stats.win_rate)} <span className="observer-count">({stats.wins}/{stats.n})</span></td>
        <td>{formatR(stats.avg_r)}</td>
      </>
    )
);

const OutcomeTable = ({ rows, label }) => (
  <table className="observer-table">
    <thead>
      <tr>
        <th rowSpan="2">{label}</th>
        <th rowSpan="2">Presente</th>
        <th colSpan="2">Con</th>
        <th colSpan="2">Sin</th>
      </tr>
      <tr><th>Acierto</th><th>R</th><th>Acierto</th><th>R</th></tr>
    </thead>
    <tbody>
      {rows.map(row => (
        <tr key={row.id}>
          <td>{row.label}</td>
          <td>{share(row.share)}</td>
          <Outcome stats={row.with} />
          <Outcome stats={row.without} />
        </tr>
      ))}
    </tbody>
  </table>
);

const Summary = ({ data, includeRewound }) => {
  const { counts, overall, small_sample: small } = data;
  return (
    <div className="settings-section">
      <div className="observer-kpis">
        <div><strong>{counts.total}</strong><span>Órdenes</span></div>
        <div><strong>{counts.closed}</strong><span>Cerradas</span></div>
        <div>
          <strong>{share(overall.win_rate)}</strong>
          <span>{overall.n > 0 ? `Acierto (95%: ${share(overall.win_low)} a ${share(overall.win_high)})` : 'Acierto'}</span>
        </div>
        <div><strong>{formatR(overall.avg_r)}</strong><span>R promedio, neto de costos</span></div>
      </div>
      <p className="observer-report-note">
        Sin terminar: {counts.pending + counts.open}. Canceladas: {counts.cancelled}. Con fecha oculta: {counts.blind}.
        {counts.rewound > 0 && !includeRewound && ` Fuera del informe por hacerse tras retroceder el tiempo: ${counts.rewound}.`}
        {counts.without_reading > 0 && ` Sin lectura porque esa fecha aún no tiene trades: ${counts.without_reading}.`}
      </p>
      {small && (
        <p className="observer-report-warning">
          Muestra pequeña: con menos de 30 órdenes cerradas estas diferencias pueden ser azar. Sirven para ver hábitos, no para concluir.
        </p>
      )}
    </div>
  );
};

/** Informe de todo lo registrado: qué condiciones se repiten y cuáles acompañan los mejores resultados */
const ObserverReport = ({ symbol, reached, onClose }) => {
  const [blind, setBlind] = useState('all');
  const [includeRewound, setIncludeRewound] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchReport({ symbol, blind, includeRewound })
      .then(result => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch(failure => active && setError(failure.message));
    return () => { active = false; };
  }, [symbol, blind, includeRewound]);

  const marks = data?.marks.map(row => ({ ...row, label: reasonLabel(row.id) })) || [];

  // El panel lateral encierra los elementos fijos: el informe se dibuja sobre toda la ventana
  return createPortal(
    <div className="indicator-settings-overlay">
      <div className="indicator-settings-modal observer-report">
        <div className="settings-header">
          <h3>Informe del observador - {symbol}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="observer-filters">
            <select value={blind} onChange={(e) => setBlind(e.target.value)}>
              <option value="all">Todas las órdenes</option>
              <option value="only">Solo con fecha oculta</option>
              <option value="none">Solo con fecha visible</option>
            </select>
            <label>
              <input type="checkbox" checked={includeRewound} onChange={(e) => setIncludeRewound(e.target.checked)} />
              Incluir órdenes hechas tras retroceder
            </label>
          </div>

          {error && <p className="observer-report-warning">No se pudo leer el informe: {error}</p>}
          {!data && !error && <p className="observer-report-note">Cargando...</p>}

          {data && data.counts.total === 0 && (
            <p className="observer-report-note">Todavía no hay órdenes con estos filtros.</p>
          )}

          {data && data.counts.total > 0 && (
            <>
              <Summary data={data} includeRewound={includeRewound} />

              <ObserverPatterns symbol={symbol} blind={blind} includeRewound={includeRewound} until={reached} />

              {data.agreement.length > 0 && (
                <div className="settings-section">
                  <h4>Tú y la regla</h4>
                  <table className="observer-table">
                    <thead><tr><th>Bloque</th><th>Lo marcaste</th><th>La regla coincidió</th></tr></thead>
                    <tbody>
                      {data.agreement.map(row => (
                        <tr key={row.block}>
                          <td>{BLOCK_NAMES[row.block] || row.block}</td>
                          <td>{row.marked}</td>
                          <td>{row.agreed} de {row.marked}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.habits.length > 0 && (
                <div className="settings-section">
                  <h4>Cuánto sigues cada parte de la regla</h4>
                  <table className="observer-table">
                    <thead><tr><th>Parte de la regla</th><th>Presente en tus órdenes</th></tr></thead>
                    <tbody>
                      {data.habits.map(row => (
                        <tr key={row.id}><td>{row.label}</td><td>{share(row.share)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.zones.orders > 0 && (
                <div className="settings-section">
                  <h4>Entradas cerca de una zona</h4>
                  <p className="observer-report-note">
                    {data.zones.near} de {data.zones.orders} órdenes ({share(data.zones.near / data.zones.orders)}).
                    Por azar se esperaría {share(data.zones.chance)}: si estás cerca de eso, la regla todavía no distingue tus entradas.
                  </p>
                </div>
              )}

              {data.best_worst.length > 0 && (
                <div className="settings-section">
                  <h4>Tus mejores órdenes contra las peores</h4>
                  <table className="observer-table">
                    <thead><tr><th>Condición</th><th>Mejor tercio</th><th>Peor tercio</th></tr></thead>
                    <tbody>
                      {data.best_worst.map(row => (
                        <tr key={row.id}><td>{row.label}</td><td>{share(row.best)}</td><td>{share(row.worst)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {marks.length > 0 && (
                <div className="settings-section">
                  <h4>Tus marcas</h4>
                  <OutcomeTable rows={marks} label="Marca" />
                </div>
              )}

              {data.overall.n > 0 && (
                <div className="settings-section">
                  <h4>Lo que leía la regla</h4>
                  <OutcomeTable rows={data.conditions} label="Condición" />
                </div>
              )}
            </>
          )}

          <ObserverRules symbol={symbol} until={reached} />
        </div>

        <div className="settings-footer">
          <a className="btn-secondary" href={exportUrl(symbol)} download>Descargar registro (CSV)</a>
          <button className="btn-primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ObserverReport;
