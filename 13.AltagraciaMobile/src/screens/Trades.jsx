import React, { useEffect, useState } from 'react';
import { gateImage } from '../lib/gate.js';
import { IMAGE_NAMES, duration, price, sideName, signed, tradeSummary, when } from '../lib/format.js';

// Papeles de lo elegido para el analisis (analysisLevels.js de App 1)
const ROLES = { support: 'Soporte', resistance: 'Resistencia', entry: 'Entrada', target: 'Objetivo', data: 'Solo dato' };

function TradeImage({ pairing, shot, onZoom }) {
  const [state, setState] = useState({ url: null, error: null });
  useEffect(() => {
    let url = null;
    let gone = false;
    gateImage(pairing, shot.image)
      .then(u => { url = u; if (gone) URL.revokeObjectURL(u); else setState({ url: u, error: null }); })
      .catch(e => { if (!gone) setState({ url: null, error: e.message }); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [pairing, shot.image]);
  return (
    <figure className="shot">
      <figcaption>
        <b>{IMAGE_NAMES[shot.kind] || shot.kind}</b> <small className="muted">{when(shot.until || shot.at)}{shot.frame ? ` · ${shot.frame}` : ''}</small>
      </figcaption>
      {state.url && <img src={state.url} alt={IMAGE_NAMES[shot.kind] || shot.kind} onClick={() => onZoom(state.url)} />}
      {!state.url && <div className="empty">{state.error || 'Cargando la imagen…'}</div>}
      {shot.note && <div className="sub">{shot.note}</div>}
    </figure>
  );
}

function TradeDetail({ t, pairing, offline, onBack }) {
  const [zoom, setZoom] = useState(null);
  const open = t.status === 'open';
  const decision = t.decision || {};
  const levels = decision.levels || [];
  return (
    <div>
      <button type="button" className="back" onClick={onBack}>‹ Trades</button>
      <div className="card">
        <div className="row">
          <div>
            <span className={sideName(t.side) === 'Long' ? 'badge long' : 'badge short'}>{sideName(t.side)}</span>
            <b className="symbol">{t.symbol}</b>
          </div>
          {open ? <span className="badge">Abierto</span>
            : <div className={`pnl ${t.pnl >= 0 ? 'pos' : 'neg'}`}>{signed(t.pnl)}{t.pnl_estimated ? ' ≈' : ''} <small>USD</small>{typeof t.r === 'number' && <div className="sub">{signed(t.r)} R</div>}</div>}
        </div>
        <div className="grid">
          <div><label>Entrada</label>{price(t.entry)}</div>
          <div><label>Salida</label>{price(t.exit)}</div>
          <div><label>Tamaño</label>{t.size ?? '—'}</div>
          <div><label>SL inicial</label>{price(t.initial_stop_loss)}</div>
          <div><label>TP inicial</label>{price(t.initial_take_profit)}</div>
          <div><label>Duración</label>{duration(t.duration_min)}</div>
          <div><label>Apertura</label>{when(t.opened_at)}</div>
          <div><label>Cierre</label>{when(t.closed_at)}</div>
          <div><label>Origen</label>{[t.origin, t.pattern].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        {t.account && <div className="sub">Cuenta: {t.account}{t.mode ? ` · ${t.mode}` : ''}</div>}
      </div>

      {(decision.note || levels.length > 0) && (
        <div className="card">
          <label>Decisión</label>
          {decision.note && <p className="note">{decision.note}</p>}
          {levels.map((l, i) => (
            <div key={`${l.id || l.label}-${i}`} className="level">
              <span className="num">{i + 1}</span>
              <span>
                {[ROLES[l.role] || (l.mark ? 'Solo marca' : l.role), l.label, l.source].filter(Boolean).join(' · ')}
                {l.note ? <small className="muted"> — {l.note}</small> : null}
              </span>
              <span className="muted">{price(l.price)}</span>
            </div>
          ))}
        </div>
      )}

      {(t.notes || []).length > 0 && (
        <div className="card">
          <label>Notas</label>
          {t.notes.map((n, i) => <p key={i} className="note">{n.text} <small className="muted">{when(n.at)}</small></p>)}
        </div>
      )}

      <h2>Capturas</h2>
      {offline && <div className="banner warn">Las capturas viven en el PC: se ven con la suite conectada.</div>}
      {!offline && (t.images || []).length === 0 && <div className="empty">Este trade no tiene capturas (se toman con la suite abierta).</div>}
      {!offline && (t.images || []).map(shot => <TradeImage key={`${shot.kind}-${shot.image}`} pairing={pairing} shot={shot} onZoom={setZoom} />)}

      {zoom && (
        <div className="zoom" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Captura a tamaño real" />
          <span>Toca para cerrar · desliza para moverte</span>
        </div>
      )}
    </div>
  );
}

export default function Trades({ trades, pairing, offline, selected, onSelect }) {
  const items = trades.items || [];
  const current = selected ? items.find(t => t.trade_id === selected) : null;
  if (current) return <TradeDetail t={current} pairing={pairing} offline={offline} onBack={() => onSelect(null)} />;
  const summary = tradeSummary(items);
  return (
    <div>
      <h1>Trades <small className="muted">30 días</small></h1>
      {!pairing && <div className="banner warn">El journal vive en la suite: empareja este celular en Ajustes.</div>}
      {trades.error && <div className="banner bad">{trades.error}</div>}
      {selected && trades.items && !current && <div className="banner warn">Ese trade todavía no está en el journal; aparece en unos segundos.</div>}
      {summary.closed > 0 && (
        <div className="card">
          <div className="grid">
            <div><label>Cerrados</label>{summary.closed}</div>
            <div><label>Acierto</label>{summary.winRate.toFixed(0)}%</div>
            <div><label>P&L neto</label><span className={summary.pnl >= 0 ? 'pos' : 'neg'}>{signed(summary.pnl)}</span></div>
          </div>
        </div>
      )}
      {pairing && trades.items === null && !trades.error && <div className="empty">Leyendo el journal…</div>}
      {trades.items && items.length === 0 && <div className="empty">Sin trades en los últimos 30 días.</div>}
      {items.map(t => (
        <div key={t.trade_id} className="event info" onClick={() => onSelect(t.trade_id)}>
          <div className="row">
            <div>
              <span className={sideName(t.side) === 'Long' ? 'badge long' : 'badge short'}>{sideName(t.side)}</span>
              <b className="symbol">{t.symbol}</b>
            </div>
            {t.status === 'open' ? <span className="badge">Abierto</span>
              : <b className={t.pnl >= 0 ? 'pos' : 'neg'}>{signed(t.pnl)}{typeof t.r === 'number' ? ` · ${signed(t.r)} R` : ''}</b>}
          </div>
          <div className="sub">
            {when(t.closed_at || t.opened_at)} · {[t.origin, t.pattern].filter(Boolean).join(' · ') || 'sin origen'}
            {(t.images || []).length > 0 && ` · ${t.images.length} captura(s)`}
          </div>
        </div>
      ))}
    </div>
  );
}
