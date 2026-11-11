import React, { useState } from 'react';
import { roleLabel } from '../indicators/analysisLevels.js';
import ObserverMarks from './ObserverMarks';
import { emptyMarks, formatMeasure, formatR, recordMarks, simulatedDate } from './observer.js';
import './Observer.css';
import { priceText } from './blindClock.js';

const WAITING = {
  building: 'Preparando las medidas de este símbolo. Tarda cerca de un minuto.',
  missing: 'Preparando las medidas de este símbolo. Tarda cerca de un minuto.',
  outside: 'Esta fecha queda fuera de las velas guardadas.',
  unavailable: 'Este símbolo todavía no tiene velas guardadas.'
};

const minutes = (value) => {
  if (value === null || value === undefined) return '—';
  return value < 60 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} h`;
};

const References = ({ references }) => {
  if (!references.items?.length) {
    return <div className="observer-subnote">Sin dibujos ni niveles elegidos.</div>;
  }
  return (
    <table className="observer-compare">
      <thead><tr><th>Referencia</th><th>Papel</th><th>Precio</th><th>Desde la entrada</th></tr></thead>
      <tbody>
        {references.items.map((item, i) => (
          <tr key={`${item.label}-${i}`}>
            <td>{item.label}</td>
            <td>{item.role || (item.origin === 'drawing' ? 'Dibujo' : 'Nivel')}</td>
            <td>{priceText(item.price, 1)}</td>
            <td>{item.distance_atr === undefined ? '—' : `${Math.abs(item.distance_atr).toFixed(2)} ATR ${item.distance_atr >= 0 ? 'detrás' : 'delante'}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Lo elegido con nota o como marca, con el número que lleva en las imágenes */
const Chosen = ({ trade, onGoTo }) => {
  const [problems, setProblems] = useState({});
  const items = (trade.levels || []).map((item, index) => ({ item, number: index + 1 })).filter(({ item }) => item.mark || item.note);
  if (!items.length) return null;

  const goTo = (item) => {
    const problem = onGoTo(item);
    if (problem) setProblems(current => ({ ...current, [item.id]: problem }));
  };

  return (
    <div className="observer-chosen">
      <div className="observer-subnote">Marcas y notas</div>
      {items.map(({ item, number }) => (
        <div className="observer-chosen-item" key={item.id}>
          <span className="observer-chosen-number">{number}</span>
          <div>
            <div><strong>{item.kind}</strong> · {item.source} · {roleLabel(item.role)}</div>
            {item.note && <div className="observer-chosen-note">{item.note}</div>}
            {problems[item.id] && <div className="observer-subnote">{problems[item.id]}</div>}
          </div>
          {onGoTo && <button type="button" className="btn-quick" onClick={() => goTo(item)}>Ir</button>}
        </div>
      ))}
    </div>
  );
};

const candleNote = (trade, time) => time && <div className="observer-subnote">{simulatedDate(trade, time)}</div>;

const Measures = ({ trade, automatic, catalog }) => {
  const groups = [...new Set(catalog.map(item => item.group))];
  const { decision, fill, decision_candle: decisionCandle, fill_candle: fillCandle } = automatic;
  return (
    <table className="observer-measures">
      <caption className="observer-subnote">Cada columna lee la última vela de 15m cerrada a esa hora.</caption>
      <thead>
        <tr>
          <th>Medida</th>
          <th>Al decidir{candleNote(trade, decisionCandle)}</th>
          {fill && <th>Al llenarse{candleNote(trade, fillCandle)}</th>}
        </tr>
      </thead>
      {groups.map(group => (
        <tbody key={group}>
          <tr><th colSpan={fill ? 3 : 2}>{group}</th></tr>
          {catalog.filter(item => item.group === group).map(item => (
            <tr key={item.key}>
              <td>{item.label}</td>
              <td>{formatMeasure(item.key, decision[item.key])}</td>
              {fill && <td>{formatMeasure(item.key, fill[item.key])}</td>}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
};

/**
 * Lo que se registró solo: resultado, referencias y medidas. Aparece cuando la orden terminó.
 * En "review" acompaña a la imagen: las medidas van abiertas y los motivos quedan en el panel.
 */
const ObserverReading = ({ trade, catalog, review = false, onGoTo = null }) => {
  const [marks, setMarks] = useState(trade.marks || emptyMarks());
  const [measuresOpen, setMeasuresOpen] = useState(review);
  const automatic = trade.automatic;

  const updateMarks = (change) => {
    const next = change(marks);
    setMarks(next);
    recordMarks(trade.id, next);
  };

  if (!automatic?.available) {
    return <div className="observer-note">{WAITING[automatic?.status] || 'Sin medidas para esta orden.'}</div>;
  }

  const { outcome, references } = automatic;
  return (
    <div className="observer-reading">
      {outcome.filled && (
        <div className="observer-outcome">
          <div><strong>{formatR(outcome.r)}</strong><span>Resultado</span></div>
          <div><strong>{formatR(outcome.best_r)}</strong><span>Lo mejor</span></div>
          <div><strong>{formatR(outcome.worst_r)}</strong><span>Lo peor</span></div>
          <div><strong>{minutes(outcome.duration_minutes)}</strong><span>En el trade</span></div>
          <div><strong>{minutes(outcome.wait_minutes)}</strong><span>Espera</span></div>
        </div>
      )}
      <References references={references} />
      <Chosen trade={trade} onGoTo={onGoTo} />
      <details open={measuresOpen} onToggle={(event) => setMeasuresOpen(event.currentTarget.open)}>
        <summary>Medidas de la orden</summary>
        {measuresOpen && <Measures trade={trade} automatic={automatic} catalog={catalog} />}
      </details>
      {!review && (
        <details>
          <summary>Agregar motivos (opcional)</summary>
          <ObserverMarks marks={marks} onChange={updateMarks} />
        </details>
      )}
    </div>
  );
};

export default ObserverReading;
