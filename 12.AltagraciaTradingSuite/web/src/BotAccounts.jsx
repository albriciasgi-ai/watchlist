import React, { useCallback, useEffect, useState } from 'react';
import { getJson, postJson } from './api.js';

/**
 * Cuentas de Bybit del bot (pedido del usuario el 12/11/2026): varias claves guardadas, reales o demo,
 * y una activa a la vez. El bot opera solo con la activa (alertas y panel de trading). De cada cuenta se
 * ven saldo y posiciones. Las claves van directo al bot; esta app no las guarda ni las muestra.
 */

const fmt = (value, digits = 2) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('es-CO', { maximumFractionDigits: digits }));

export default function BotAccounts({ active, onError, onNotice }) {
  const [data, setData] = useState(null);
  const [summaries, setSummaries] = useState({});
  const [form, setForm] = useState({ name: '', api_key: '', api_secret: '', demo: true });
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(null);

  const readSummaries = useCallback(async (accounts) => {
    for (const acc of accounts) {
      setSummaries(s => ({ ...s, [acc.id]: { loading: true } }));
      try {
        const r = await getJson(`/api/bot/accounts/${acc.id}/summary`);
        setSummaries(s => ({ ...s, [acc.id]: r.success === false ? { error: r.error } : r }));
      } catch (e) {
        setSummaries(s => ({ ...s, [acc.id]: { error: e.message } }));
      }
    }
  }, []);

  const read = useCallback(async () => {
    try {
      const d = await getJson('/api/bot/accounts');
      setReadError(null);
      setData(d);
      readSummaries(d.accounts || []);
    } catch (e) {
      // Un bot arrancado antes de las cuentas no tiene la ruta (404 "Not Found")
      setReadError(/not found/i.test(e.message)
        ? 'El bot que está corriendo es de antes de las cuentas: reinícialo (puerto 5000) para manejarlas desde aquí.'
        : `No se pudieron leer las cuentas: ${e.message}`);
    }
  }, [readSummaries]);
  useEffect(() => { if (active) read(); }, [active, read]);
  // Sin respuesta (bot caido o de antes de las cuentas): reintenta cada 15 s hasta que conteste
  useEffect(() => {
    if (!active || !readError) return undefined;
    const t = setInterval(read, 15000);
    return () => clearInterval(t);
  }, [active, readError, read]);

  const act = async (text, path, body, done) => {
    if (!window.confirm(text)) return null;
    setBusy(true);
    try {
      const r = await postJson(path, body);
      onNotice?.(done);
      await read();
      return r;
    } catch (e) {
      onError?.(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addAccount = async () => {
    const name = form.name.trim();
    if (!name || !form.api_key.trim() || !form.api_secret.trim()) return;
    const r = await act(
      `Guardar la cuenta "${name}" (${form.demo ? 'DEMO' : 'REAL, dinero real'}) en el bot? No pasa a ser la activa hasta que la elijas.`,
      '/api/bot/accounts',
      { name, api_key: form.api_key, api_secret: form.api_secret, demo: form.demo, confirm: 'CAMBIAR_CLAVES' },
      `Cuenta "${name}" guardada`,
    );
    if (r) {
      setForm({ name: '', api_key: '', api_secret: '', demo: true });
      if (r.account?.validated === false) onError?.(`Se guardó, pero Bybit rechazó la clave: ${r.account.validation_message || ''}`);
    }
  };

  const activate = (acc) => act(
    `El bot pasará a operar con "${acc.name}" (${acc.demo ? 'DEMO' : 'REAL, dinero real'}): alertas automáticas y panel de trading.\n\n`
      + 'Las posiciones abiertas en la cuenta actual siguen en Bybit con su stop y su objetivo, pero el bot deja de vigilarlas. ¿Continuar?',
    `/api/bot/accounts/${acc.id}/activate`, { confirm: 'CAMBIAR_CUENTA' }, `Cuenta activa: ${acc.name}`,
  );

  const rename = (acc) => {
    const name = window.prompt('Nuevo nombre de la cuenta', acc.name);
    if (!name || !name.trim() || name.trim() === acc.name) return;
    act(`Renombrar "${acc.name}" como "${name.trim()}"?`, `/api/bot/accounts/${acc.id}/rename`,
      { name: name.trim(), confirm: 'CAMBIAR_CONFIG' }, 'Cuenta renombrada');
  };

  const remove = (acc) => act(
    `Borrar la cuenta "${acc.name}" del bot? Sus claves se eliminan del bot; en Bybit no cambia nada.`,
    `/api/bot/accounts/${acc.id}/delete`, { confirm: 'CAMBIAR_CLAVES' }, `Cuenta "${acc.name}" borrada`,
  );

  if (!data) return <div className={readError ? 'bot-warning' : 'bot-empty'}>{readError || 'Leyendo las cuentas del bot…'}</div>;
  const accounts = data.accounts || [];

  return (
    <div>
      {readError && <div className="bot-warning">{readError}</div>}
      {accounts.length === 0 && <div className="bot-empty">El bot no tiene cuentas todavía: agrega una abajo.</div>}
      {accounts.length > 0 && (
        <table className="bot-table">
          <thead>
            <tr><th>Cuenta</th><th>Tipo</th><th>Clave</th><th>Patrimonio</th><th>Disponible</th><th>Posiciones</th><th /></tr>
          </thead>
          <tbody>
            {accounts.map(acc => {
              const s = summaries[acc.id] || {};
              return (
                <tr key={acc.id}>
                  <td><b>{acc.name}</b>{acc.active && <span className="suite-badge-active">activa</span>}</td>
                  <td className={acc.demo ? '' : 'neg'}>{acc.demo ? 'DEMO' : 'REAL'}</td>
                  <td title={acc.validation_message || ''}>{acc.key_hint}{acc.validated === false ? ' ⚠' : ''}</td>
                  <td>{s.loading ? '…' : s.error ? <span className="neg" title={s.error}>sin respuesta</span> : `$${fmt(s.balance?.equity)}`}</td>
                  <td>{s.balance ? `$${fmt(s.balance.available)}` : ''}</td>
                  <td title={(s.positions || []).map(p => `${p.symbol} ${p.side} ${p.size}${Number(p.stopLoss) > 0 ? '' : ' (sin SL)'}`).join('\n')}>
                    {s.positions ? s.positions.length : ''}
                    {s.positions?.some(p => !(Number(p.stopLoss) > 0)) && <span className="neg"> sin SL</span>}
                  </td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    {!acc.active && <button type="button" className="suite-btn" disabled={busy} onClick={() => activate(acc)}>Usar esta…</button>}
                    <button type="button" className="suite-btn" disabled={busy} onClick={() => rename(acc)}>Renombrar</button>
                    {!acc.active && <button type="button" className="suite-btn" disabled={busy} onClick={() => remove(acc)}>Borrar…</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="suite-add-coin">
        <input className="suite-input" style={{ width: 150 }} placeholder="Nombre (ej: Real BTC)" maxLength={40} value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
        <input className="suite-input" style={{ width: 200 }} placeholder="API key" autoComplete="off" value={form.api_key} onChange={(e) => setForm(f => ({ ...f, api_key: e.target.value }))} />
        <input className="suite-input" style={{ width: 200 }} placeholder="API secret" type="password" autoComplete="new-password" value={form.api_secret} onChange={(e) => setForm(f => ({ ...f, api_secret: e.target.value }))} />
        <label><input type="checkbox" checked={form.demo} onChange={(e) => setForm(f => ({ ...f, demo: e.target.checked }))} style={{ marginRight: 4 }} />Demo</label>
        <button type="button" className="suite-btn" disabled={busy || !form.name.trim() || !form.api_key.trim() || !form.api_secret.trim()} onClick={addAccount}>Agregar cuenta…</button>
        <button type="button" className="suite-btn" disabled={busy} onClick={read}>Actualizar saldos</button>
      </div>
      <div className="bot-empty">
        El bot opera solo con la cuenta activa: alertas automáticas y panel de trading. Las claves van directo al bot; esta app no las guarda ni las muestra.
        Para operar en real, la clave de Bybit necesita permiso de órdenes (Contracts: Orders y Positions) y conviene que no tenga permiso de retiro.
      </div>
    </div>
  );
}
