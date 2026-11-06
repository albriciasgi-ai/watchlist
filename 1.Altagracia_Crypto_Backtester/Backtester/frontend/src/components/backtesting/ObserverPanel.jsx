import React, { useEffect, useState } from 'react';
import {
  describeComparison, fetchOrders, formatR, observerError, reasonLabel, simulatedDate, statusName
} from './observer.js';
import ObserverReport from './ObserverReport';
import './Observer.css';

const Comparison = ({ comparison }) => {
  const { rows, missing } = describeComparison(comparison);
  if (missing) return <div className="observer-note">{missing}</div>;

  return (
    <table className="observer-compare">
      <thead>
        <tr><th></th><th>Tú</th><th>Regla</th></tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}>
            <td className="observer-block">{row.label}</td>
            <td>{row.you}</td>
            <td>
              {row.rule}
              {row.note && <div className="observer-subnote">{row.note}</div>}
              {row.verdict && (
                <div className={`observer-verdict ${row.verdict === 'Coincide' ? 'agree' : 'differ'}`}>{row.verdict}</div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const OrderRow = ({ trade, expanded, onToggle }) => {
  const ended = trade.status === 'closed' || trade.status === 'cancelled';
  const reasons = trade.marks?.reasons || [];

  return (
    <div className="observer-order">
      <button type="button" className="observer-order-head" onClick={onToggle}>
        <span className={`observer-side ${trade.side}`}>{trade.side === 'long' ? 'LONG' : 'SHORT'}</span>
        <span className="observer-entry">{trade.type} {Number(trade.entry).toFixed(1)}</span>
        <span className="observer-status">{statusName(trade.status)}</span>
        {trade.status === 'closed' && (
          <span className={`observer-result ${trade.pnl > 0 ? 'win' : 'loss'}`}>
            {trade.r !== null ? formatR(trade.r) : `$${trade.pnl.toFixed(2)}`}
          </span>
        )}
      </button>
      {expanded && (
        <div className="observer-order-body">
          <div className="observer-subnote">
            {simulatedDate(trade, trade.time)} · {trade.timeframe}
            {trade.rewound ? ' · hecha tras retroceder' : ''}
          </div>
          {reasons.length > 0 && <div className="observer-subnote">Motivos: {reasons.map(reasonLabel).join(', ')}</div>}
          {trade.notes && <div className="observer-subnote">“{trade.notes}”</div>}
          {ended
            ? <Comparison comparison={trade.comparison} />
            : <div className="observer-note">La lectura de la regla queda oculta hasta que la orden termine.</div>}
        </div>
      )}
    </div>
  );
};

/** Órdenes registradas y, cuando terminan, en qué coincidieron con la regla */
const ObserverPanel = ({ revision, symbol, blindActive, onRevealDate }) => {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    let active = true;
    fetchOrders()
      .then(list => {
        if (!active) return;
        setOrders(list);
        setError(null);
        setExpanded(current => current ?? list[0]?.id ?? null);
      })
      .catch(failure => active && setError(failure.message));
    return () => { active = false; };
  }, [revision]);

  const saveError = observerError();

  return (
    <div className="observer-panel">
      <div className="observer-header">
        <h3>Observador</h3>
        <button type="button" className="btn-quick" onClick={() => setShowReport(true)}>Ver informe</button>
      </div>

      {blindActive && (
        <div className="observer-blind">
          Fecha oculta activa.
          <button type="button" className="btn-quick" onClick={onRevealDate}>Revelar fecha</button>
        </div>
      )}
      {saveError && <div className="observer-warning">No se pudo guardar el último evento: {saveError}</div>}
      {error && <div className="observer-warning">No se pudo leer el registro: {error}</div>}

      {orders?.length === 0 && (
        <div className="observer-note">
          Cada orden que envíes queda aquí. Al terminar verás en qué coincidió con la regla.
        </div>
      )}

      {orders?.map(trade => (
        <OrderRow
          key={trade.id}
          trade={trade}
          expanded={expanded === trade.id}
          onToggle={() => setExpanded(current => (current === trade.id ? null : trade.id))}
        />
      ))}

      {showReport && <ObserverReport symbol={symbol} onClose={() => setShowReport(false)} />}
    </div>
  );
};

export default ObserverPanel;
