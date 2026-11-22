import React from 'react';
import { ago, when } from '../lib/format.js';

const TONE = { trade_open: 'info', trade_close: 'info', critical: 'bad', bot_down: 'bad', bot_up: 'ok', paused: 'warn', resumed: 'ok', test: 'info' };

export function EventRow({ e, onOpen, fresh }) {
  const tone = e.type === 'trade_close' && typeof e.pnl === 'number' ? (e.pnl >= 0 ? 'ok' : 'bad') : (TONE[e.type] || 'info');
  return (
    <div className={`event ${tone}${fresh ? ' fresh' : ''}`} onClick={() => e.trade_id && onOpen?.(e.trade_id)}>
      <div className="row">
        <b>{e.title}</b>
        <small className="muted" title={when(e.at)}>{ago(e.at)}</small>
      </div>
      <div className="sub">{e.body}</div>
      {e.push === false && <small className="muted">Visto tarde: sin aviso</small>}
    </div>
  );
}

export default function Events({ events, seen, openTrade, offline, pairing }) {
  return (
    <div>
      <h1>Avisos</h1>
      {offline && pairing && <div className="banner warn">Sin conexión con la suite: estos son los avisos ya recibidos.</div>}
      {events.length === 0 && <div className="empty">Todavía no hay avisos. Aparecen cuando el bot abre o cierra una posición, queda en pausa o deja de responder.</div>}
      {[...events].reverse().map(e => <EventRow key={e.id} e={e} onOpen={openTrade} fresh={!seen || e.id > seen} />)}
    </div>
  );
}
