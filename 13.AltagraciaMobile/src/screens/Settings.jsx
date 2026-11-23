import React, { useState } from 'react';
import { parsePairing } from '../lib/gate.js';
import { isNative, scanQr } from '../lib/native.js';
import { ago } from '../lib/format.js';

export default function Settings({ pairing, live, offline, accounts, actions, prefs, pushState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ name: '', apiKey: '', apiSecret: '', demo: true });

  const run = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const pairWith = (text) => run(async () => {
    await actions.pair(parsePairing(text));
    setCode('');
  });

  const scan = () => run(async () => {
    const text = await scanQr();
    if (text) await actions.pair(parsePairing(text));
  });

  const unpair = () => {
    if (window.confirm('Quitar el emparejamiento de este celular? Para volver a entrar hay que escanear un código nuevo en la suite.')) run(actions.unpair);
  };

  const addAccount = () => run(async () => {
    const account = { name: form.name.trim(), apiKey: form.apiKey.trim(), apiSecret: form.apiSecret.trim(), demo: form.demo };
    if (!account.name || !account.apiKey || !account.apiSecret) throw new Error('Faltan el nombre, la clave o el secreto');
    await actions.addAccount(account);
    setForm({ name: '', apiKey: '', apiSecret: '', demo: true });
  });

  return (
    <div>
      <h1>Ajustes</h1>
      {error && <div className="banner bad" onClick={() => setError(null)}>{error}</div>}

      <section>
        <h2>Suite</h2>
        {pairing ? (
          <div className="card">
            <div className="row">
              <b>{pairing.name}</b>
              <span className={offline ? 'badge short' : 'badge long'}>{offline ? 'Sin conexión' : 'Conectado'}</span>
            </div>
            <div className="sub">{pairing.host}:{pairing.port}{live.at ? ` · leído ${ago(live.at)}` : ''}</div>
            <div className="buttons">
              <button type="button" disabled={busy} onClick={actions.refresh}>Actualizar</button>
              <button type="button" disabled={busy} className="danger" onClick={unpair}>Quitar emparejamiento</button>
            </div>
          </div>
        ) : (
          <div className="card">
            <p className="note">
              En la suite: Bot › Configuración y riesgo › Celulares › «Emparejar celular…». Con Tailscale conectado en este celular,
              escanea el código que aparece.
            </p>
            {isNative() && <button type="button" className="primary" disabled={busy} onClick={scan}>Escanear el código</button>}
            <label className="field">O pega aquí el contenido del código
              <textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder='{"v":1,"host":"100.x.y.z",…}' autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <button type="button" disabled={busy || !code.trim()} onClick={() => pairWith(code)}>Emparejar</button>
          </div>
        )}
      </section>

      <section>
        <h2>Avisos</h2>
        <div className="card">
          <label className="switch">
            <input type="checkbox" checked={!!prefs.push} disabled={busy || !pairing || !isNative()} onChange={(e) => run(() => actions.setPush(e.target.checked))} />
            <span>Avisos cuando el bot abre o cierra una posición</span>
          </label>
          <div className="sub">
            {!isNative() ? 'Los avisos solo existen en la app instalada en el celular.'
              : pushState || 'Necesitan el archivo de Firebase (google-services.json) dentro de la app y Firebase configurado en la suite.'}
          </div>
        </div>
      </section>

      <section>
        <h2>Modo directo · PC apagado</h2>
        <div className="card">
          <p className="note">
            Con el PC apagado, la app lee las posiciones directo de Bybit. Usa una clave creada en Bybit <b>solo con permiso de lectura</b>:
            no puede operar ni retirar. Nunca pongas aquí las claves del bot.
          </p>
          {accounts.map(a => (
            <div key={a.name} className="row line">
              <span><b>{a.name}</b> <span className={a.demo ? 'badge' : 'badge real'}>{a.demo ? 'DEMO' : 'REAL'}</span> <small className="muted">…{a.apiKey.slice(-4)}</small></span>
              <button type="button" className="danger small" disabled={busy}
                onClick={() => window.confirm(`Borrar la clave "${a.name}" de este celular?`) && run(() => actions.removeAccount(a.name))}>Borrar</button>
            </div>
          ))}
          <label className="field">Nombre
            <input value={form.name} maxLength={30} placeholder="Ej: Real" onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>
          <label className="field">API key (solo lectura)
            <input value={form.apiKey} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setForm(f => ({ ...f, apiKey: e.target.value }))} />
          </label>
          <label className="field">API secret
            <input type="password" value={form.apiSecret} autoComplete="new-password" onChange={(e) => setForm(f => ({ ...f, apiSecret: e.target.value }))} />
          </label>
          <label className="switch">
            <input type="checkbox" checked={form.demo} onChange={(e) => setForm(f => ({ ...f, demo: e.target.checked }))} />
            <span>Cuenta Demo de Bybit</span>
          </label>
          <button type="button" disabled={busy || !form.name.trim() || !form.apiKey.trim() || !form.apiSecret.trim()} onClick={addAccount}>
            {busy ? 'Probando…' : 'Probar y guardar'}
          </button>
          <div className="sub">La clave se prueba contra Bybit antes de guardarse y queda solo en este celular. Bybit caduca las claves sin IP fija: si deja de servir, crea otra.</div>
        </div>
      </section>

      <div className="foot muted">Altagracia móvil 0.1 · solo lectura</div>
    </div>
  );
}
