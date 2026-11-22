import React from 'react';
import { ago, signed, tradeSummary } from '../lib/format.js';
import { SourceBanner } from './Positions.jsx';
import { EventRow } from './Events.jsx';

export default function Home(props) {
  const { live, direct, offline, trades, events, goto, openTrade } = props;
  const bot = live.overview?.bot;
  const pos = live.overview?.positions;
  const account = bot?.account && (bot.account.name || bot.account);
  const summary = trades.items ? tradeSummary(trades.items) : null;
  const directPositions = direct.accounts.flatMap(a => a.positions);
  const directPnl = directPositions.reduce((s, p) => s + (Number(p.unrealizedPnl) || 0), 0);

  return (
    <div>
      <h1>Altagracia</h1>
      <SourceBanner {...props} />

      {!offline && bot && (
        <div className="card">
          <div className="row">
            <div>
              <span className={bot.mode === 'LIVE' ? 'badge real' : 'badge'}>{bot.mode === 'LIVE' ? 'REAL' : (bot.mode || '—')}</span>
              <b className="symbol">{typeof account === 'string' ? account : 'Cuenta activa'}</b>
            </div>
            <span className={bot.trading_paused ? 'badge short' : 'badge long'}>{bot.trading_paused ? 'En pausa' : 'Operando'}</span>
          </div>
          <div className="hero" onClick={() => goto('positions')}>
            <label>P&L abierto</label>
            <div className={`big ${pos?.unrealized_pnl >= 0 ? 'pos' : 'neg'}`}>{signed(pos?.unrealized_pnl)} <small>USD</small></div>
            <div className="sub">
              {pos?.count || 0} posición(es) abiertas
              {pos?.without_stop > 0 && <b className="neg"> · {pos.without_stop} SIN STOP</b>}
            </div>
          </div>
          {live.overview?.watch?.bot_down && <div className="banner bad">El bot no responde a la suite.</div>}
        </div>
      )}

      {offline && directPositions.length > 0 && (
        <div className="card" onClick={() => goto('positions')}>
          <div className="hero">
            <label>P&L abierto · directo de Bybit</label>
            <div className={`big ${directPnl >= 0 ? 'pos' : 'neg'}`}>{signed(directPnl)} <small>USD</small></div>
            <div className="sub">{directPositions.length} posición(es) abiertas · {ago(direct.at)}</div>
          </div>
        </div>
      )}

      {summary && summary.closed > 0 && (
        <div className="card" onClick={() => goto('trades')}>
          <label>Últimos 30 días</label>
          <div className="grid">
            <div><label>Cerrados</label>{summary.closed}</div>
            <div><label>Acierto</label>{summary.winRate.toFixed(0)}%</div>
            <div><label>P&L neto</label><span className={summary.pnl >= 0 ? 'pos' : 'neg'}>{signed(summary.pnl)}</span></div>
            <div><label>R promedio</label>{summary.avgR === null ? '—' : signed(summary.avgR)}</div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <section>
          <h2>Últimos avisos</h2>
          {events.slice(-5).reverse().map(e => <EventRow key={e.id} e={e} onOpen={openTrade} />)}
        </section>
      )}
      {!offline && live.at && <div className="foot">Suite · {ago(live.at)}{pos?.source ? ` · ${pos.source === 'stream' ? 'en tiempo real' : pos.source}` : ''}</div>}
      {!offline && !bot && live.source === null && <div className="empty">Leyendo la suite…</div>}
      {summary === null && !offline && trades.error && <div className="banner bad">Trades: {trades.error}</div>}
      <div className="foot muted">Solo lectura · las claves del bot nunca salen del PC</div>
    </div>
  );
}
