import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { getJson, postJson } from './api.js';

/**
 * Celulares emparejados con la suite (app Android, 21/11/2026). Emparejar crea un celular pendiente y muestra su
 * QR una sola vez: trae la direccion de la puerta movil y el secreto con que el celular firma cada pedido.
 * El secreto no viaja por la red ni se puede volver a leer: si se pierde, se revoca y se empareja de nuevo.
 */

const when = (ms) => (ms ? new Date(ms).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function MobileDevices({ active, onError, onNotice }) {
  const [data, setData] = useState(null);
  const [readError, setReadError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(null); // { device, qr, image }

  const read = useCallback(async () => {
    try {
      setData(await getJson('/api/mobile/status'));
      setReadError(null);
    } catch (e) {
      setReadError(`No se pudo leer la puerta móvil: ${e.message}`);
    }
  }, []);
  useEffect(() => { if (active) read(); }, [active, read]);
  // Con un QR a la vista se lee cada 3 s, para ver cuando el celular lo usa; si no, cada 30 s
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(read, pairing ? 3000 : 30000);
    return () => clearInterval(t);
  }, [active, pairing, read]);

  const devices = data?.devices || [];
  const paired = pairing && devices.find(d => d.id === pairing.device.id);
  useEffect(() => {
    if (!pairing) return;
    if (paired?.activated_at) {
      onNotice?.(`Celular "${pairing.device.name}" emparejado`);
      setPairing(null);
    } else if (data && !paired) {
      setPairing(null); // vencio sin usarse
    }
  }, [pairing, paired, data, onNotice]);

  const pair = async () => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const r = await postJson('/api/mobile/pair', { name: clean, confirm: 'EMPAREJAR_CELULAR' });
      const image = await QRCode.toDataURL(JSON.stringify(r.qr), { errorCorrectionLevel: 'M', margin: 2, width: 260 });
      setPairing({ device: r.device, qr: r.qr, image });
      setName('');
      await read();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (d) => {
    if (!window.confirm(`Revocar el celular "${d.name}"? Deja de entrar al instante; para volver a usarlo hay que emparejarlo de nuevo.`)) return;
    setBusy(true);
    try {
      await postJson(`/api/mobile/devices/${d.id}/revoke`, { confirm: 'REVOCAR_CELULAR' });
      if (pairing?.device.id === d.id) setPairing(null);
      onNotice?.(`Celular "${d.name}" revocado`);
      await read();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const testPush = async () => {
    setBusy(true);
    try {
      const r = await postJson('/api/mobile/test-push', { confirm: 'ENVIAR_AVISO_PRUEBA' });
      onNotice?.(`Aviso de prueba enviado a ${r.tokens} celular(es)`);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className={readError ? 'bot-warning' : 'bot-empty'}>{readError || 'Leyendo la puerta móvil…'}</div>;
  const gate = data.gate || {};
  const push = data.watch?.push || {};

  return (
    <div>
      {readError && <div className="bot-warning">{readError}</div>}
      {!gate.enabled && (
        <div className="bot-warning">
          La puerta móvil está apagada. Para encenderla, pon en config/suite.json la dirección por la que entra el celular
          (la IP de Tailscale de este PC): {'"mobile_host": "100.x.y.z"'} y reinicia la suite.
        </div>
      )}
      {gate.enabled && (
        <div className="bot-empty">
          Puerta móvil en {gate.host}:{gate.port} · {gate.listening ? 'escuchando' : <span className="neg">sin abrir{gate.error ? `: ${gate.error}` : ''}</span>}
          {' · '}avisos push: {push.configured ? `listos (${push.sent || 0} enviados)` : <span className="neg">{push.error || 'sin configurar'}</span>}
        </div>
      )}
      {devices.length > 0 && (
        <table className="bot-table">
          <thead>
            <tr><th>Celular</th><th>Estado</th><th>Emparejado</th><th>Última vez</th><th>Avisos</th><th /></tr>
          </thead>
          <tbody>
            {devices.map(d => (
              <tr key={d.id}>
                <td><b>{d.name}</b></td>
                <td>{d.activated_at ? 'activo' : `pendiente (vence ${when(d.expires_at)})`}</td>
                <td>{when(d.activated_at)}</td>
                <td>{when(d.last_seen)}</td>
                <td>{d.push ? 'sí' : 'no'}</td>
                <td><button type="button" className="suite-btn" disabled={busy} onClick={() => revoke(d)}>Revocar…</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pairing && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '8px 0' }}>
          <img src={pairing.image} alt="QR para emparejar el celular" width={260} height={260} style={{ background: '#fff' }} />
          <div className="bot-empty" style={{ maxWidth: 420 }}>
            <b>Escanea este código con la app en "{pairing.device.name}".</b><br />
            Vence a los 10 minutos y se muestra una sola vez. Trae el secreto del celular: no lo fotografíes ni lo compartas.
            Con Tailscale conectado en el celular, la app queda emparejada al escanearlo y esta tarjeta se cierra sola.<br />
            <button type="button" className="suite-btn" style={{ marginTop: 8 }} onClick={() => setPairing(null)}>Ocultar el código</button>
          </div>
        </div>
      )}
      <div className="suite-add-coin">
        <input className="suite-input" style={{ width: 200 }} placeholder="Nombre del celular (ej: Mi Pixel)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="suite-btn" disabled={busy || !name.trim() || !gate.enabled} onClick={pair}>Emparejar celular…</button>
        <button type="button" className="suite-btn" disabled={busy || !devices.some(d => d.push)} onClick={testPush}>Enviar aviso de prueba</button>
      </div>
      <div className="bot-empty">
        El celular solo lee: posiciones, trades, capturas y avisos. Las claves de Bybit nunca salen de este PC.
      </div>
    </div>
  );
}
