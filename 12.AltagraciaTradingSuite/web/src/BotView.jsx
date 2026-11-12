import React, { useCallback, useEffect, useState } from 'react';
import { getJson, postJson } from './api.js';

/**
 * Modulo del bot: lo que hoy muestra App 10, leido del bot por el servidor de la suite.
 * El bot sigue siendo su propio proceso (3.TradingBot_Python). Desde aqui solo se puede pausar o
 * reanudar todo el trading, con confirmacion; las ordenes y la configuracion siguen en el bot.
 */

const fmtTime = (value) => {
  if (!value) return '—';
  const date = typeof value === 'number' || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const num = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('es-CO', { maximumFractionDigits: digits }) : (value ?? '—');
};

const signClass = (value) => (Number(value) > 0 ? 'pos' : Number(value) < 0 ? 'neg' : '');

function usePolling(path, everyMs, enabled) {
  const [state, setState] = useState({ data: null, error: null, at: null });
  const read = useCallback(() => getJson(path)
    .then(data => setState({ data, error: null, at: Date.now() }))
    .catch(error => setState(previous => ({ ...previous, error: error.message, at: Date.now() }))), [path]);
  useEffect(() => {
    if (!enabled) return undefined;
    read();
    const timer = setInterval(read, everyMs);
    return () => clearInterval(timer);
  }, [read, everyMs, enabled]);
  return [state, read];
}

export default function BotView({ active }) {
  const [overview, reloadOverview] = usePolling('/api/bot/overview', 5000, active);
  const [positions] = usePolling('/api/bot/positions', 15000, active);
  const [alerts] = usePolling('/api/bot/alerts?minutes=240', 30000, active);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const status = overview.data?.status;
  const paused = status?.trading_paused;

  const togglePause = async () => {
    if (typeof paused !== 'boolean') return;
    const next = !paused;
    const text = next
      ? 'Pausar TODO el trading del bot: no se abrirán operaciones nuevas (las abiertas siguen con su TP/SL). ¿Continuar?'
      : 'Reanudar el trading del bot: volverá a operar las alertas y órdenes que reciba. ¿Continuar?';
    if (!window.confirm(text)) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await postJson('/api/bot/pause', { paused: next, confirm: 'CAMBIAR_PAUSA' });
      setMessage(result.trading_paused ? 'Trading pausado' : 'Trading reanudado');
      reloadOverview();
    } catch (error) {
      setMessage(`No se pudo cambiar: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!overview.data && overview.error) {
    return (
      <div className="bot-view">
        <div className="bot-warning">El bot no responde ({overview.error}). Se inicia con 3.TradingBot_Python (puerto 5000).</div>
      </div>
    );
  }
  if (!overview.data) return <div className="bot-view"><div className="bot-empty">Leyendo el bot…</div></div>;

  const om = status?.order_manager || {};
  const critical = overview.data.critical || [];
  const orders = overview.data.orders || [];
  const positionList = positions.data?.positions || [];
  const alertList = alerts.data?.alerts || [];

  return (
    <div className="bot-view">
      {overview.error && <div className="bot-warning">Sin respuesta del bot desde {fmtTime(overview.at)}: {overview.error}</div>}
      <div className="bot-cards">
        <div className="bot-card">
          <div className="label">Modo · cuenta activa</div>
          <div className="value">{status?.mode ? String(status.mode).toUpperCase() : '—'}</div>
          {status?.account?.name && <div className="label">{status.account.name}</div>}
        </div>
        <div className="bot-card">
          <div className="label">Trading</div>
          <div className={`value ${paused ? 'neg' : 'pos'}`}>{paused === undefined ? '—' : paused ? 'En pausa' : 'Activo'}</div>
          <button type="button" className="suite-btn" style={{ marginTop: 6 }} disabled={busy || typeof paused !== 'boolean'} onClick={togglePause}>
            {paused ? 'Reanudar…' : 'Pausar todo…'}
          </button>
        </div>
        <div className="bot-card"><div className="label">Credenciales</div><div className="value">{status?.credentials_configured ? 'Configuradas' : 'Faltan'}</div></div>
        <div className="bot-card"><div className="label">Monedas configuradas</div><div className="value">{status?.symbols_configured ?? '—'}</div></div>
        <div className="bot-card"><div className="label">Órdenes en el historial</div><div className="value">{overview.data.orders_total ?? '—'}</div></div>
        {om.total_executions !== undefined && (
          <div className="bot-card">
            <div className="label">Ejecuciones desde que arrancó</div>
            <div className="value">{om.successful_executions}/{om.total_executions}</div>
            {(om.failed_sl_count > 0 || om.failed_tp_count > 0) && (
              <div className="neg" style={{ fontSize: 11 }}>SL fallidos {om.failed_sl_count} · TP fallidos {om.failed_tp_count}</div>
            )}
          </div>
        )}
      </div>
      {message && <div className="bot-empty" style={{ marginBottom: 10 }}>{message}</div>}

      <div className="bot-section">
        <h3>Avisos críticos</h3>
        {critical.length === 0 ? <div className="bot-empty">Ninguno</div> : critical.slice().reverse().map((a, i) => (
          <div key={i} className="bot-warning">{fmtTime(a.timestamp || a.time)} · {a.symbol ? `${a.symbol}: ` : ''}{a.message || a.detail || JSON.stringify(a)}</div>
        ))}
      </div>

      <div className="bot-section">
        <h3>Posiciones abiertas {positions.error ? `(sin respuesta: ${positions.error})` : ''}</h3>
        {positionList.length === 0 ? <div className="bot-empty">{positions.data ? 'Ninguna' : 'Leyendo…'}</div> : (
          <table className="bot-table">
            <thead><tr><th>Moneda</th><th>Lado</th><th>Tamaño</th><th>Entrada</th><th>Marca</th><th>PnL</th><th>SL</th><th>TP</th><th>Apalanc.</th></tr></thead>
            <tbody>
              {positionList.map((p, i) => (
                <tr key={`${p.symbol}-${p.side}-${i}`}>
                  <td>{p.symbol}</td><td>{p.side}</td><td>{p.size}</td><td>{p.entryPrice}</td><td>{p.markPrice}</td>
                  <td className={signClass(p.unrealizedPnl)}>{num(p.unrealizedPnl)}</td>
                  <td className={!Number(p.stopLoss) ? 'neg' : ''}>{Number(p.stopLoss) ? p.stopLoss : 'sin SL'}</td>
                  <td>{Number(p.takeProfit) ? p.takeProfit : '—'}</td><td>{p.leverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bot-section">
        <h3>Últimas órdenes</h3>
        {orders.length === 0 ? <div className="bot-empty">Ninguna</div> : (
          <table className="bot-table">
            <thead><tr><th>Hora</th><th>Moneda</th><th>Lado</th><th>Cantidad</th><th>USDT</th><th>Entrada</th><th>SL</th><th>TP</th><th>Patrón</th><th>Estado</th><th>Origen</th></tr></thead>
            <tbody>
              {orders.slice(0, 30).map((o, i) => (
                <tr key={`${o.timestamp}-${o.symbol}-${i}`}>
                  <td>{fmtTime(o.timestamp)}</td><td>{o.symbol}</td><td>{o.side}</td>
                  <td>{o.quantity_coin ?? '—'}</td><td>{num(o.quantity_usdt)}</td><td>{o.entry_price ?? '—'}</td>
                  <td className={!Number(o.stop_loss) ? 'neg' : ''}>{Number(o.stop_loss) ? o.stop_loss : 'sin SL'}</td>
                  <td>{Number(o.take_profit) ? o.take_profit : '—'}</td><td>{o.pattern || '—'}</td>
                  <td className={o.status === 'success' ? '' : 'neg'}>{o.status || '—'}</td><td>{o.origin || o.source || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bot-section">
        <h3>Alertas recibidas (4 horas)</h3>
        {alertList.length === 0 ? <div className="bot-empty">{alerts.data ? 'Ninguna' : 'Leyendo…'}</div> : (
          <table className="bot-table">
            <thead><tr><th>Hora</th><th>Resultado</th><th>Origen</th><th>Moneda</th><th>Lado</th><th>Patrón</th><th>Precio</th></tr></thead>
            <tbody>
              {alertList.slice(0, 50).map((a, i) => (
                <tr key={i}>
                  <td>{fmtTime(a.timestamp)}</td><td className={String(a.result).startsWith('BLOCKED') ? 'neg' : ''}>{a.result}</td>
                  <td>{a.origin || a.source}</td><td>{a.symbol}</td><td>{a.side}</td><td>{a.pattern}</td><td>{a.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
