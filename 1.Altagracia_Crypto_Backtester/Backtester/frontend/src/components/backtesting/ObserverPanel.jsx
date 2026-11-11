import React, { useEffect, useState } from 'react';
import {
  describeComparison, fetchMeasures, fetchOrders, formatR, observerError, orderAhead, reasonLabel, simulatedDate, statusName, withSessionImages
} from './observer.js';
import ObserverReading from './ObserverReading';
import ObserverReport from './ObserverReport';
import TradeImages from './TradeImages';
import './Observer.css';
import { priceText } from './blindClock.js';

const MEASURES_PENDING = ['building', 'missing'];
const MEASURES_POLL_MS = 5000;

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

const OrderRow = ({ trade, catalog, viewer, expanded, onToggle, onGoTo }) => {
  const [revealed, setRevealed] = useState(false);
  const ended = trade.status === 'closed' || trade.status === 'cancelled';
  const hidden = !revealed && orderAhead(trade, viewer());
  const reasons = trade.marks?.reasons || [];

  return (
    <div className="observer-order">
      <button type="button" className="observer-order-head" onClick={onToggle}>
        <span className={`observer-side ${trade.side}`}>{trade.side === 'long' ? 'LONG' : 'SHORT'}</span>
        <span className="observer-entry">{trade.type} {priceText(Number(trade.entry), 1)}</span>
        <span className="observer-status">{statusName(trade.status)}</span>
        {trade.status === 'closed' && !hidden && (
          <span className={`observer-result ${trade.pnl > 0 ? 'win' : 'loss'}`}>
            {trade.r !== null ? formatR(trade.r) : `$${trade.pnl.toFixed(2)}`}
          </span>
        )}
      </button>
      {expanded && hidden && (
        <div className="observer-order-body">
          <div className="observer-note">Esta orden terminó después de la hora simulada: su resultado queda oculto.</div>
          <button type="button" className="btn-quick" onClick={() => setRevealed(true)}>Ver igual</button>
        </div>
      )}
      {expanded && !hidden && (
        <div className="observer-order-body">
          <div className="observer-subnote">
            {simulatedDate(trade, trade.time)} · {trade.timeframe}
            {trade.rewound ? ' · hecha tras retroceder' : ''}
          </div>
          {reasons.length > 0 && <div className="observer-subnote">Motivos: {reasons.map(reasonLabel).join(', ')}</div>}
          {trade.notes && <div className="observer-subnote">“{trade.notes}”</div>}
          {ended
            ? (
              <>
                <TradeImages trade={trade} catalog={catalog} viewer={viewer} onGoTo={onGoTo} />
                <ObserverReading trade={trade} catalog={catalog} onGoTo={onGoTo} />
                <Comparison comparison={trade.comparison} />
              </>
            )
            : <div className="observer-note">Las medidas y la lectura de la regla quedan ocultas hasta que la orden termine.</div>}
        </div>
      )}
    </div>
  );
};

/** Órdenes registradas y, cuando terminan, en qué coincidieron con la regla */
const ObserverPanel = ({ revision, symbol, blindActive, onRevealDate, sessionManager, viewer, onGoToItem }) => {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [catalog, setCatalog] = useState([]);

  useEffect(() => {
    let active = true;
    fetchMeasures(symbol).then(data => active && setCatalog(data.measures)).catch(() => {});
    return () => { active = false; };
  }, [symbol]);

  useEffect(() => {
    let active = true;
    let timer = null;
    const load = () => fetchOrders()
      .then(list => withSessionImages(list, id => sessionManager.loadSession(id)))
      .then(list => {
        if (!active) return;
        setOrders(list);
        setError(null);
        setExpanded(current => current ?? list[0]?.id ?? null);
        // La primera vez las medidas tardan cerca de un minuto en prepararse
        if (list.some(trade => MEASURES_PENDING.includes(trade.automatic?.status))) timer = setTimeout(load, MEASURES_POLL_MS);
      })
      .catch(failure => active && setError(failure.message));
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
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
          Cada orden que envíes queda aquí con sus medidas, tus dibujos y tus niveles. Al terminar verás su resultado y en qué coincidió con la regla.
        </div>
      )}

      {orders?.map(trade => (
        <OrderRow
          key={trade.id}
          trade={trade}
          catalog={catalog}
          viewer={viewer}
          onGoTo={onGoToItem}
          expanded={expanded === trade.id}
          onToggle={() => setExpanded(current => (current === trade.id ? null : trade.id))}
        />
      ))}

      {showReport && <ObserverReport symbol={symbol} reached={viewer().reached} onClose={() => setShowReport(false)} />}
    </div>
  );
};

// La hora simulada cambia sin parar y el panel no la usa: no debe redibujarse con cada una
export default React.memo(ObserverPanel);
