import React from 'react';
import { ago, money, positionView, price, sideName, signed } from '../lib/format.js';

const pct = (v, digits = 2) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);

export function PositionCard({ p }) {
  const v = positionView(p);
  const tone = v.pnl === null ? '' : v.pnl >= 0 ? 'pos' : 'neg';
  return (
    <div className="card">
      <div className="row">
        <div>
          <span className={v.long ? 'badge long' : 'badge short'}>{sideName(p.side)}</span>
          <b className="symbol">{p.symbol}</b>
          {v.leverage ? <span className="muted"> {v.leverage}x</span> : null}
        </div>
        <div className={`pnl ${tone}`}>
          {signed(v.pnl)} <small>USD</small>
          <div className="sub">{pct(v.roiPct)} ROI</div>
        </div>
      </div>
      <div className="grid">
        <div><label>Tamaño</label>{v.size}</div>
        <div><label>Entrada</label>{price(v.entry)}</div>
        <div><label>Marca</label>{price(v.mark)}</div>
        <div>
          <label>Stop</label>
          {v.sl ? <>{price(v.sl)} <small className="neg">{signed(v.riskAtSl)}</small></> : <b className="neg">SIN STOP</b>}
        </div>
        <div>
          <label>Objetivo</label>
          {v.tp ? <>{price(v.tp)} <small className="pos">{signed(v.gainAtTp)}</small></> : <span className="muted">sin TP</span>}
        </div>
        <div><label>Liquidación</label>{price(v.liq)}</div>
        <div><label>Al SL</label>{v.sl ? pct(v.toSlPct) : '—'}</div>
        <div><label>Al TP</label>{v.tp ? pct(v.toTpPct) : '—'}</div>
        <div><label>Precio</label>{pct(v.movePct)}</div>
      </div>
    </div>
  );
}

export function SourceBanner({ live, direct, offline, accounts, pairing, goto }) {
  if (!pairing && !accounts.length) {
    return <div className="banner warn" onClick={() => goto('settings')}>Empareja este celular con la suite en Ajustes.</div>;
  }
  if (offline) {
    return (
      <div className="banner warn">
        {pairing ? 'Sin conexión con la suite (PC apagado o Tailscale sin conectar).' : 'Sin emparejar con la suite.'}
        {accounts.length
          ? <> <b>Directo de Bybit · solo lectura</b>{direct.at ? ` · ${ago(direct.at)}` : ''}</>
          : ' Agrega una clave de solo lectura en Ajustes para ver las posiciones sin el PC.'}
      </div>
    );
  }
  if (live.source === 'suite-error') return <div className="banner bad">{live.error}</div>;
  return null;
}

export default function Positions(props) {
  const { live, direct, offline, accounts } = props;
  if (offline) {
    return (
      <div>
        <h1>Posiciones</h1>
        <SourceBanner {...props} />
        {direct.accounts.map(a => (
          <section key={a.name}>
            <h2>
              {a.name} <span className={a.demo ? 'badge' : 'badge real'}>{a.demo ? 'DEMO' : 'REAL'}</span>
              {a.balance?.equity ? <small className="muted"> patrimonio ${money(a.balance.equity)}</small> : null}
            </h2>
            {a.error && <div className="banner bad">{a.error}</div>}
            {!a.error && a.positions.length === 0 && <div className="empty">Sin posiciones abiertas.</div>}
            {a.positions.map(p => <PositionCard key={`${p.symbol}-${p.side}`} p={p} />)}
          </section>
        ))}
        {accounts.length > 0 && direct.accounts.length === 0 && <div className="empty">Leyendo Bybit…</div>}
      </div>
    );
  }
  return (
    <div>
      <h1>Posiciones</h1>
      <SourceBanner {...props} />
      {live.error && live.source === 'suite' && <div className="banner bad">{live.error}</div>}
      {live.source === 'suite' && live.positions.length === 0 && !live.error && <div className="empty">Sin posiciones abiertas.</div>}
      {live.source === null && <div className="empty">Leyendo la suite…</div>}
      {live.positions.map(p => <PositionCard key={`${p.symbol}-${p.side}`} p={p} />)}
      {live.at && <div className="foot">Del bot · {ago(live.at)}</div>}
    </div>
  );
}
