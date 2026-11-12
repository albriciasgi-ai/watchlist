import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getJson, postJson } from './api.js';
import { subscribeBook } from './botBook.js';

/**
 * Journal de trades reales (paso 4 de la integración, 12/11/2026): el Observador de App 1 con trades de verdad.
 * Primera parte: los hechos de cada trade, del bot y de Bybit. Apertura con su origen (alerta o panel), SL y TP
 * iniciales; cierres con el resultado neto de comisiones; R sobre el riesgo del SL inicial; notas propias.
 * Los abiertos muestran el P&L sin realizar de Bybit (precio marca).
 */

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const price = (v) => (num(v) === null ? '—' : String(Number(Number(v).toPrecision(10))));
const money = (v) => (num(v) === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
const when = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const duration = (min) => {
  if (min === null || min === undefined) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  if (min < 1440) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} d`;
};
const originText = (t) => [t.origin, t.source].filter(Boolean).join(' · ');

export default function JournalView({ active }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState({});

  const read = useCallback(async () => {
    try {
      const d = await getJson(`/api/bot/journal?days=${days}`);
      setData(d);
      setError(null);
    } catch (e) {
      setError(/not found/i.test(e.message)
        ? 'El bot que está corriendo es de antes del journal: reinícialo (puerto 5000).'
        : `No se pudo leer el journal: ${e.message}`);
    }
  }, [days]);
  useEffect(() => {
    if (!active) return undefined;
    read();
    const timer = setInterval(read, 15000);
    return () => clearInterval(timer);
  }, [active, read]);
  // P&L sin realizar de los abiertos: el de Bybit, del libro de posiciones (cada 2 s)
  useEffect(() => {
    if (!active) return undefined;
    return subscribeBook((book) => {
      const map = {};
      for (const p of book.positions || []) map[`${p.symbol}:${p.side}`] = p;
      setLive(map);
    });
  }, [active]);

  const trades = data?.trades || [];
  const closed = trades.filter(t => t.status === 'closed');
  const stats = useMemo(() => {
    const wins = closed.filter(t => (t.pnl || 0) > 0).length;
    const total = closed.reduce((s, t) => s + (t.pnl || 0), 0);
    const rs = closed.map(t => num(t.r)).filter(r => r !== null);
    const groups = {};
    for (const t of closed) {
      const key = originText(t) || '—';
      const g = groups[key] || (groups[key] = { n: 0, wins: 0, pnl: 0, rs: [] });
      g.n += 1;
      if ((t.pnl || 0) > 0) g.wins += 1;
      g.pnl += t.pnl || 0;
      if (num(t.r) !== null) g.rs.push(t.r);
    }
    return {
      n: closed.length, wins, total, avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null, rN: rs.length,
      groups: Object.entries(groups).sort((a, b) => b[1].n - a[1].n),
    };
  }, [closed]);
  const selected = trades.find(t => t.trade_id === selectedId) || null;

  const sync = async () => {
    setBusy(true);
    try {
      const r = await postJson('/api/bot/journal/sync', {});
      setNotice(r.added ? `${r.added} cierre(s) nuevo(s) de Bybit` : 'Sin cierres nuevos en Bybit');
      await read();
    } catch (e) {
      setNotice(`No se pudo: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const saveNote = async () => {
    if (!selected || !note.trim()) return;
    setBusy(true);
    try {
      await postJson(`/api/bot/journal/${encodeURIComponent(selected.trade_id)}/note`, { text: note.trim() });
      setNote('');
      await read();
    } catch (e) {
      setNotice(`La nota no se guardó: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="bot-warning">{error}</div>;
  if (!data) return <div className="bot-empty">Leyendo el journal del bot…</div>;

  return (
    <div>
      {error && <div className="bot-warning">{error}</div>}
      <div className="bot-cards">
        <div className="bot-card"><div className="label">Trades cerrados</div><div className="value">{stats.n}</div></div>
        <div className="bot-card"><div className="label">Acierto</div><div className="value">{stats.n ? `${Math.round((stats.wins / stats.n) * 100)}%` : '—'}</div></div>
        <div className="bot-card"><div className="label">P&L neto (USD)</div><div className={`value ${stats.total >= 0 ? 'pos' : 'neg'}`}>{stats.n ? money(stats.total) : '—'}</div></div>
        <div className="bot-card">
          <div className="label">R promedio</div>
          <div className={`value ${(stats.avgR || 0) >= 0 ? 'pos' : 'neg'}`}>{stats.avgR === null ? '—' : stats.avgR.toFixed(2)}</div>
          {stats.rN < stats.n && <div className="label">{stats.rN} de {stats.n} con SL</div>}
        </div>
        <div className="bot-card"><div className="label">Abiertos</div><div className="value">{trades.length - closed.length}</div></div>
      </div>

      <div className="suite-add-coin">
        <label>Últimos
          <select className="suite-input" style={{ width: 80, marginLeft: 6 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map(d => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <button type="button" className="suite-btn" disabled={busy} onClick={sync}>Pedir cierres a Bybit</button>
        {notice && <span className="bot-empty">{notice}</span>}
      </div>

      {stats.groups.length > 1 && (
        <div className="bot-section">
          <h3>Por origen</h3>
          <table className="bot-table">
            <thead><tr><th>Origen</th><th>Trades</th><th>Acierto</th><th>P&L neto</th><th>R promedio</th></tr></thead>
            <tbody>
              {stats.groups.map(([key, g]) => (
                <tr key={key}>
                  <td>{key}</td><td>{g.n}</td><td>{Math.round((g.wins / g.n) * 100)}%</td>
                  <td className={g.pnl >= 0 ? 'pos' : 'neg'}>{money(g.pnl)}</td>
                  <td>{g.rs.length ? (g.rs.reduce((s, r) => s + r, 0) / g.rs.length).toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bot-section">
        <h3>Trades</h3>
        {!trades.length && <div className="bot-empty">Sin trades en estos días. Las aperturas se anotan desde que el bot tiene el journal; los cierres llegan de Bybit.</div>}
        {trades.length > 0 && (
          <table className="bot-table">
            <thead>
              <tr><th>Abierto</th><th>Moneda</th><th>Lado</th><th>Origen</th><th>Tamaño</th><th>Entrada</th><th>Salida</th><th>SL inicial</th><th>P&L</th><th>R</th><th>Duración</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {trades.map(t => {
                const position = live[`${t.symbol}:${t.side}`];
                const open = t.status === 'open';
                const pnl = open ? num(position?.unrealizedPnl) : t.pnl;
                return (
                  <tr key={t.trade_id} onClick={() => setSelectedId(t.trade_id === selectedId ? null : t.trade_id)}
                    style={{ cursor: 'pointer', background: t.trade_id === selectedId ? 'var(--t-hover, #eef3ff)' : undefined }}>
                    <td title={t.pre_existing && t.opened_at ? `El bot la vio por primera vez el ${when(t.opened_at)}` : ''}>
                      {t.opened_at && !t.pre_existing ? when(t.opened_at) : 'antes'}
                    </td>
                    <td>{t.symbol}</td>
                    <td className={t.side === 'Buy' ? 'pos' : 'neg'}>{t.side === 'Buy' ? 'LONG' : 'SHORT'}</td>
                    <td>{originText(t)}</td>
                    <td>{t.size}</td>
                    <td>{price(t.entry)}</td>
                    <td>{price(t.exit)}</td>
                    <td>{t.initial_stop_loss ? price(t.initial_stop_loss) : <span className="neg">sin SL</span>}</td>
                    <td className={(pnl || 0) >= 0 ? 'pos' : 'neg'}>{money(pnl)}{open && pnl !== null ? ' *' : ''}</td>
                    <td>{num(t.r) === null ? '—' : t.r.toFixed(2)}</td>
                    <td>{duration(t.duration_min)}</td>
                    <td>{open ? (position ? 'abierto' : 'sin posición') : 'cerrado'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="bot-empty">
          P&L neto de comisiones, de Bybit. * Abiertos: sin realizar, al precio marca. R = resultado sobre lo que arriesgaba el SL inicial.
          "Anterior": la posición ya estaba abierta cuando el bot empezó el journal. "Externa": no la abrió el bot (Bybit a mano u otra app).
        </div>
      </div>

      {selected && (
        <div className="bot-section">
          <h3>{selected.symbol} · {selected.side === 'Buy' ? 'LONG' : 'SHORT'} · {originText(selected)}{selected.pattern ? ` · ${selected.pattern}` : ''}</h3>
          <div className="bot-empty">
            Cuenta {selected.account || '—'}{selected.mode ? ` (${String(selected.mode).toUpperCase()})` : ''} · apalancamiento {selected.leverage ?? '—'}x
            {' '}· SL inicial {price(selected.initial_stop_loss)} · TP inicial {price(selected.initial_take_profit)}
            {' '}· SL actual {price(selected.stop_loss)} · TP actual {price(selected.take_profit)}
            {selected.risk ? ` · riesgo ${selected.risk.toFixed(2)} USD` : ''}
          </div>
          {selected.closes.length > 0 && (
            <table className="bot-table">
              <thead><tr><th>Cierre</th><th>Cantidad</th><th>Entrada</th><th>Salida</th><th>P&L neto</th><th>Tipo</th></tr></thead>
              <tbody>
                {selected.closes.map(cl => (
                  <tr key={cl.close_id}>
                    <td>{when(cl.closed_at)}</td><td>{cl.qty}</td><td>{price(cl.entry)}</td><td>{price(cl.exit)}</td>
                    <td className={(cl.pnl || 0) >= 0 ? 'pos' : 'neg'}>{money(cl.pnl)}</td><td>{cl.order_type || ''} {cl.exec_type || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {selected.changes.length > 0 && (
            <div className="bot-empty">
              Cambios: {selected.changes.map(ch => `${when(ch.at)} ${['stop_loss', 'take_profit', 'size'].filter(k => k in ch)
                .map(k => `${k === 'stop_loss' ? 'SL' : k === 'take_profit' ? 'TP' : 'tamaño'} ${price(ch[k])}`).join(', ')}`).join(' · ')}
            </div>
          )}
          <div>
            {selected.notes.map((n, i) => <div key={i} className="bot-empty">{when(n.at)} · {n.text}</div>)}
          </div>
          <div className="suite-add-coin">
            <textarea className="suite-input" style={{ width: '100%', minHeight: 60 }} maxLength={4000}
              placeholder="Nota: por qué entraste, qué viste, qué harías distinto…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="suite-btn" disabled={busy || !note.trim()} onClick={saveNote}>Guardar nota</button>
          </div>
        </div>
      )}
    </div>
  );
}
