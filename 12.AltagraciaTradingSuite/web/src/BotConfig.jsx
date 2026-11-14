import React, { useCallback, useEffect, useState } from 'react';
import { getJson, postJson } from './api.js';
import BotAccounts from './BotAccounts.jsx';

/**
 * Configuracion del bot, como en App 10: monedas y sus parametros (riesgo, SL, TP, apalancamiento, que desde el
 * 13/11/2026 tambien se cambia despues de agregar la moneda y se fija ya en Bybit, precision de Bybit), riesgo diario,
 * metodo de ejecucion, origenes de alertas, direcciones por moneda y credenciales de Bybit. Cada cambio pide
 * confirmacion aqui y una palabra en el servidor.
 */

const CONFIG_WORD = 'CAMBIAR_CONFIG';
const LEVERAGE_WORD = 'CAMBIAR_APALANCAMIENTO'; // 13/11/2026: el bot lo fija ya en Bybit para la cuenta activa
const pct = (fraction) => (fraction === null || fraction === undefined ? '' : String(+(Number(fraction) * 100).toFixed(4)));
const ORIGINS = [
  ['ANALIZADOR', 'Analizador (App 4/8)'],
  ['WATCHLIST', 'Watchlist (App 2/7)'],
  ['ORDERFLOW', 'Order Flow (App 5/9)'],
];
const DIRECTIONS = ['DISABLED', 'LONG', 'SHORT', 'BOTH'];

function CoinRow({ coin, direction, onSaved, onError }) {
  const [risk, setRisk] = useState(String(coin.risk_amount));
  const [sl, setSl] = useState(pct(coin.stop_loss_percent));
  const [tp, setTp] = useState(pct(coin.take_profit_percent));
  const [lev, setLev] = useState(String(coin.leverage ?? ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRisk(String(coin.risk_amount));
    setSl(pct(coin.stop_loss_percent));
    setTp(pct(coin.take_profit_percent));
  }, [coin.risk_amount, coin.stop_loss_percent, coin.take_profit_percent]);
  useEffect(() => setLev(String(coin.leverage ?? '')), [coin.leverage]);
  const dirty = risk !== String(coin.risk_amount) || sl !== pct(coin.stop_loss_percent) || tp !== pct(coin.take_profit_percent);
  const levDirty = lev !== String(coin.leverage ?? '');

  const run = async (text, path, body, word = CONFIG_WORD) => {
    if (!window.confirm(text)) return;
    setBusy(true);
    try {
      await postJson(path, { ...body, confirm: word });
      onSaved();
    } catch (e) {
      onError(`${coin.symbol}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(
    `Guardar en el bot ${coin.symbol}: riesgo $${risk}, SL ${sl}%, TP ${tp}%?`,
    '/api/bot/config/update',
    { symbol: coin.symbol, risk_amount: Number(risk), stop_loss_percent: Number(sl) / 100, take_profit_percent: Number(tp) / 100 },
  );
  const setDirection = (value) => run(`Dirección de ${coin.symbol}: ${value}?`, '/api/bot/directions/update', { symbol: coin.symbol, direction: value });
  // Apalancamiento (13/11/2026): se fija ya en Bybit, por eso va aparte de "Guardar"
  const applyLeverage = () => {
    const value = Number(lev);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      onError(`${coin.symbol}: el apalancamiento es un entero de 1 a 100`);
      return;
    }
    run(
      `Cambiar el apalancamiento de ${coin.symbol} de ${coin.leverage ?? '—'}x a ${value}x?\n\n`
      + 'El bot lo fija ya en Bybit para la cuenta activa, y las órdenes siguientes lo usan. '
      + 'Si hay una posición abierta, cambian su margen y su precio de liquidación (o Bybit lo rechaza y nada cambia).',
      '/api/bot/config/leverage', { symbol: coin.symbol, leverage: value }, LEVERAGE_WORD,
    );
  };
  const syncPrecision = () => run(`Leer de Bybit tick, paso y mínimo de ${coin.symbol}?`, `/api/bot/config/sync-precision/${coin.symbol}`, {});

  return (
    <tr>
      <td><b>{coin.symbol}</b></td>
      <td><input className="suite-input" type="number" step="0.5" value={risk} onChange={(e) => setRisk(e.target.value)} /></td>
      <td><input className="suite-input" type="number" step="0.1" value={sl} onChange={(e) => setSl(e.target.value)} /></td>
      <td><input className="suite-input" type="number" step="0.1" value={tp} onChange={(e) => setTp(e.target.value)} /></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <input className="suite-input" type="number" min="1" max="100" step="1" style={{ width: 52 }} value={lev}
          onChange={(e) => setLev(e.target.value)} title="Apalancamiento: se fija en Bybit al aplicarlo" />x
        {levDirty && (
          <button type="button" className="suite-btn" style={{ marginLeft: 4 }} disabled={busy} onClick={applyLeverage}
            title="Fijar ya este apalancamiento en Bybit (cuenta activa)">
            Aplicar
          </button>
        )}
      </td>
      <td title="tick · paso · mínimo">{coin.tick_size} · {coin.step_size} · {coin.min_qty}</td>
      <td>
        <select className="suite-select" value={direction || 'DISABLED'} onChange={(e) => setDirection(e.target.value)} disabled={busy}>
          {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </td>
      <td style={{ display: 'flex', gap: 4 }}>
        <button type="button" className="suite-btn" disabled={!dirty || busy} onClick={save}>Guardar</button>
        <button type="button" className="suite-btn" disabled={busy} onClick={syncPrecision} title="Leer la precisión de Bybit">Precisión</button>
      </td>
    </tr>
  );
}

export default function BotConfig({ active }) {
  const [coins, setCoins] = useState(null);
  const [settings, setSettings] = useState(null);
  const [directions, setDirections] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [add, setAdd] = useState({ symbol: '', risk_amount: '3', sl: '2.2', tp: '4.5', leverage: '10' });
  const [riskAll, setRiskAll] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');

  const read = useCallback(async () => {
    setError(null);
    try {
      const [c, s, d] = await Promise.all([
        getJson('/api/bot/config'), getJson('/api/bot/settings'), getJson('/api/bot/directions'),
      ]);
      setCoins(c.coins || []);
      setSettings(s);
      setDirections(d.directions || {});
      setDailyLimit(String(s.daily_risk_limit ?? ''));
    } catch (e) {
      setError(`El bot no responde: ${e.message}`);
    }
  }, []);
  useEffect(() => { if (active) read(); }, [active, read]);

  const run = async (text, path, body, done) => {
    if (text && !window.confirm(text)) return false;
    setNotice(null);
    try {
      const r = await postJson(path, body);
      setNotice(done || 'Guardado en el bot');
      await read();
      return r;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const addCoin = () => {
    const symbol = add.symbol.trim().toUpperCase();
    if (!symbol) return;
    run(
      `Agregar ${symbol} al bot con riesgo $${add.risk_amount}, SL ${add.sl}%, TP ${add.tp}% y apalancamiento ${add.leverage}x? Queda con dirección DISABLED hasta que la cambies.`,
      '/api/bot/config/add',
      { symbol, risk_amount: Number(add.risk_amount), stop_loss_percent: Number(add.sl) / 100, take_profit_percent: Number(add.tp) / 100, leverage: Number(add.leverage), confirm: CONFIG_WORD },
      `${symbol} agregada`,
    ).then(ok => ok && setAdd(a => ({ ...a, symbol: '' })));
  };

  if (error && !coins) return <div className="bot-warning">{error}</div>;
  if (!coins || !settings) return <div className="bot-empty">Leyendo la configuración del bot…</div>;
  const origins = settings.allowed_origins || {};

  return (
    <div>
      {error && <div className="bot-warning">{error}</div>}
      {notice && <div className="suite-result ok">{notice}</div>}

      <div className="bot-section">
        <h3>Riesgo</h3>
        <div className="bot-cards">
          <div className="bot-card">
            <div className="label">Riesgo diario usado</div>
            <div className="value">${Number(settings.daily_risk_used || 0).toFixed(2)} {settings.daily_risk_limit > 0 ? `de $${settings.daily_risk_limit}` : '(sin límite)'}</div>
            <div className="label">{settings.daily_risk_trades || 0} operaciones · {settings.daily_risk_date || ''}</div>
            <button type="button" className="suite-btn" style={{ marginTop: 6 }}
              onClick={() => run('Poner en cero el riesgo diario usado?', '/api/bot/settings/daily-risk-reset', { confirm: CONFIG_WORD }, 'Riesgo diario reiniciado')}>
              Reiniciar…
            </button>
          </div>
          <div className="bot-card">
            <div className="label">Límite diario (USDT, 0 = sin límite)</div>
            <input className="suite-input" type="number" step="1" min="0" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
            <button type="button" className="suite-btn" style={{ marginLeft: 6 }} disabled={dailyLimit === String(settings.daily_risk_limit ?? '')}
              onClick={() => run(`Límite de riesgo diario: $${dailyLimit}?`, '/api/bot/settings/daily-risk-limit', { daily_risk_limit: Number(dailyLimit), confirm: CONFIG_WORD })}>
              Guardar
            </button>
          </div>
          <div className="bot-card">
            <div className="label">Riesgo por trade para TODAS las monedas</div>
            <input className="suite-input" type="number" step="0.5" min="0" value={riskAll} onChange={(e) => setRiskAll(e.target.value)} placeholder="USDT" />
            <button type="button" className="suite-btn" style={{ marginLeft: 6 }} disabled={!(Number(riskAll) > 0)}
              onClick={() => run(`Poner $${riskAll} de riesgo en las ${coins.length} monedas?`, '/api/bot/config/update-risk-all', { risk_amount: Number(riskAll), confirm: CONFIG_WORD })}>
              Aplicar
            </button>
          </div>
          <div className="bot-card">
            <div className="label">Método de ejecución</div>
            <div className="value" style={{ fontSize: 13 }}>{settings.use_integrated_tpsl ? 'Integrado (TP/SL con la orden)' : 'Secuencial (orden y luego TP/SL)'}</div>
            <button type="button" className="suite-btn" style={{ marginTop: 6 }}
              onClick={() => run(`Cambiar a ${settings.use_integrated_tpsl ? 'secuencial' : 'integrado'}?`, '/api/bot/settings/execution-method', { use_integrated: !settings.use_integrated_tpsl, confirm: CONFIG_WORD })}>
              Cambiar…
            </button>
          </div>
        </div>
      </div>

      <div className="bot-section">
        <h3>Orígenes de alertas permitidos</h3>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          {ORIGINS.map(([id, label]) => (
            <label key={id} style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={!!origins[id]} style={{ marginRight: 6 }}
                onChange={(e) => run(`${e.target.checked ? 'Permitir' : 'Bloquear'} las alertas de ${label}?`, '/api/bot/settings/allowed-origins', { origin: id, enabled: e.target.checked, confirm: CONFIG_WORD })} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="bot-section">
        <h3>Monedas ({coins.length})</h3>
        <table className="bot-table">
          <thead>
            <tr><th>Moneda</th><th>Riesgo $</th><th>SL %</th><th>TP %</th><th>Apal.</th><th>Tick · paso · mín.</th><th>Dirección</th><th /></tr>
          </thead>
          <tbody>
            {coins.map(c => <CoinRow key={c.symbol} coin={c} direction={directions[c.symbol]} onSaved={read} onError={setError} />)}
          </tbody>
        </table>
        <div className="suite-add-coin">
          <input className="suite-input" placeholder="Moneda (ej: LINKUSDT)" value={add.symbol} onChange={(e) => setAdd(a => ({ ...a, symbol: e.target.value.toUpperCase() }))} style={{ width: 150 }} />
          <label>Riesgo $ <input className="suite-input" type="number" value={add.risk_amount} onChange={(e) => setAdd(a => ({ ...a, risk_amount: e.target.value }))} /></label>
          <label>SL % <input className="suite-input" type="number" value={add.sl} onChange={(e) => setAdd(a => ({ ...a, sl: e.target.value }))} /></label>
          <label>TP % <input className="suite-input" type="number" value={add.tp} onChange={(e) => setAdd(a => ({ ...a, tp: e.target.value }))} /></label>
          <label>Apalancamiento <input className="suite-input" type="number" value={add.leverage} onChange={(e) => setAdd(a => ({ ...a, leverage: e.target.value }))} /></label>
          <button type="button" className="suite-btn" onClick={addCoin} disabled={!add.symbol.trim()}>Agregar al bot…</button>
        </div>
        <div className="bot-empty">El apalancamiento solo se fija al agregar la moneda: el bot no tiene cómo cambiarlo después.</div>
      </div>

      <div className="bot-section">
        <h3>Cuentas de Bybit</h3>
        <BotAccounts active={active} onError={setError} onNotice={setNotice} />
      </div>
    </div>
  );
}
