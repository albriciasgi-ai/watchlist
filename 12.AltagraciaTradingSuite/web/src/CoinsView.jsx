import React, { useCallback, useEffect, useRef, useState } from 'react';
import { deleteJson, getJson, postJson } from './api.js';
import { TAB, symbolsChanged } from './tabs.js';
import TabsMenu from './TabsMenu.jsx';
import { dayShort, mbText, perDayTotal, progressText, recordNote, short, storeText, swingNext } from './coinsView.js';

/**
 * Módulo "Monedas" (23/11/2026, docs/PLAN_MONEDAS.md, fase 1): una fila por moneda y lo que se guarda de ella.
 * - En la suite: la Watchlist, el gráfico y «Mis monedas» del scanner (data/symbols.json, como siempre).
 * - Grabar en el PC: los trades, el libro y Hyperliquid, cada uno aparte. Encender vale al instante; apagar, al
 *   reiniciar la suite.
 * - El almacén: bajar su historia de Bybit (las herramientas del panel de Order Flow, una moneda a la vez) y tenerla al
 *   día. Al terminar una descarga se arma solo.
 * - El Swing, con su propia ruta. La nube, App 1, DX y el bot se muestran como están.
 * Nada de lo guardado se borra desde aquí. focus: {symbol, at} para agregar una moneda (desde el scanner).
 */
const RECORD = [['trades', 'Trades'], ['book', 'Libro'], ['hl', 'Hyperliquid']];
const LOWER = { trades: 'trades', book: 'libro', hl: 'Hyperliquid' };   // dentro de una frase
const EMPTY_FORM = { symbol: '', trades: true, book: true, hl: true, history: true };

export default function CoinsView({ active = true, focus = null, onFocusDone, onBack, onWatchlist, onOpenTheme, onModule }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const formRef = useRef(null);
  const inputRef = useRef(null);

  const read = useCallback(async () => {
    try {
      setData(await getJson('/api/coins'));
      setError(null);
    } catch (e) {
      setError(`Sin respuesta del servidor: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    read();
    const timer = setInterval(read, 10000);
    return () => clearInterval(timer);
  }, [active, read]);

  // El formulario con la moneda; con opts (las de su fila), lo que se había elegido para ella
  const prefill = useCallback((symbol, opts = null) => {
    setForm({ ...EMPTY_FORM, symbol, ...(opts ? { trades: !!opts.trades, book: !!opts.book, hl: !!opts.hl } : {}) });
    setNotice(null);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ block: 'nearest' });
      inputRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!focus?.symbol) return;
    prefill(focus.symbol);
    onFocusDone?.();
  }, [focus, prefill, onFocusDone]);

  const run = async (key, work) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
      read();
    }
  };

  const addCoin = () => {
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol) return;
    const history = form.history && available;   // sin la historia disponible en este servidor, no se pide
    const rec = RECORD.filter(([k]) => form[k]).map(([k]) => LOWER[k]);
    const lines = [
      `¿Agregar ${short(symbol)} a la suite?`,
      '',
      rec.length ? `Se graba en este PC: ${rec.join(', ')}.${form.book ? ' El libro ocupa de 4 a 21 MB por día.' : ''}` : 'No se graba nada en este PC.',
      history ? 'Se baja también su historia de Bybit desde que cotiza, para el almacén: puede tardar horas y ocupar varios GB. Se baja una moneda a la vez y sigue aunque cierres la suite.' : 'Su historia no se baja (se puede pedir después).',
      'La nube y App 1 no cambian.',
    ];
    if (!window.confirm(lines.join('\n'))) return;
    run('add', async () => {
      const d = await postJson('/api/coins', { symbol, trades: form.trades, book: form.book, hl: form.hl, history });
      symbolsChanged(d.symbols);
      const bits = [`${short(symbol)} quedó en la suite.`];
      if (d.history) bits.push(`Su historia: ${d.history.missing.toLocaleString('en-US')} días por bajar, del ${dayShort(d.history.first)} de ${d.history.first.slice(0, 4)} al ${dayShort(d.history.last)}.`);
      if (d.history_error) bits.push(`Su historia no se pidió: ${d.history_error}`);
      setNotice(bits.join(' '));
      setForm(EMPTY_FORM);
    });
  };

  const setOption = (row, key, value) => {
    const name = short(row.symbol);
    if (!value && key !== 'store' && row.recording?.[key] === 'on'
        && !window.confirm(`¿Dejar de grabar ${key === 'hl' ? 'Hyperliquid' : `el ${LOWER[key]}`} de ${name}?\n\nSe deja de grabar al reiniciar la suite. Lo ya grabado queda.`)) return;
    if (key === 'store' && !value
        && !window.confirm(`¿Dejar de poner al día el almacén de ${name}?\n\nNo se borra nada: solo deja de bajar los días nuevos (y si esperaba su descarga, sale de la espera).`)) return;
    run(`${row.symbol}:${key}`, () => postJson(`/api/coins/${row.symbol}`, { [key]: value }));
  };

  const download = (row, more) => {
    const name = short(row.symbol);
    const text = more
      ? `¿Seguir bajando la historia de ${name}?\n\nBaja los días que le faltan, una moneda a la vez, y al terminar arma su almacén.`
      : `¿Bajar la historia de ${name}?\n\nBybit publica sus trades de cada día desde que cotiza. Se baja una moneda a la vez, con el límite de velocidad del panel de Order Flow, y sigue aunque cierres la suite. Al terminar se arma su almacén.`;
    if (!window.confirm(text)) return;
    run(`${row.symbol}:history`, async () => {
      const d = await postJson(`/api/coins/${row.symbol}/history`, {});
      setNotice(`${name}: ${d.missing.toLocaleString('en-US')} días por bajar, del ${dayShort(d.first)} de ${d.first.slice(0, 4)} al ${dayShort(d.last)}.`);
    });
  };

  const cancel = (row) => run(`${row.symbol}:history`, () => deleteJson(`/api/coins/${row.symbol}/history`));

  const stopDownload = (symbols) => {
    if (!window.confirm(`¿Detener la descarga de ${symbols.map(short).join(', ')}?\n\nTermina el día que está bajando y se cierra, como «Detener» del panel de Order Flow. Las que esperan se cancelan. Se puede seguir después.`)) return;
    run('stop', async () => {
      const d = await postJson('/api/coins/history/stop', {});
      setNotice(`Se detiene ${d.stopping.map(short).join(', ')}${d.cancelled.length ? `; salieron de la espera: ${d.cancelled.map(short).join(', ')}` : ''}.`);
    });
  };

  const removeFromSuite = (row) => {
    const name = short(row.symbol);
    if (!window.confirm(`¿Quitar ${name} de la suite?\n\nDeja de verse en la Watchlist y en el gráfico. Lo que se graba de ella sigue hasta reiniciar la suite. No se borra nada de lo guardado.`)) return;
    run(`${row.symbol}:suite`, async () => {
      const d = await deleteJson(`/api/suite/symbols/${row.symbol}`);
      symbolsChanged(d.symbols);
      setNotice(`${name} salió de la suite.`);
    });
  };

  const toggleSwing = (row, on) => run(`${row.symbol}:swing`, async () => {
    const cfg = await getJson('/api/swing/config');
    const next = swingNext(cfg.config?.symbols, row.symbol, on);
    if (!next) throw new Error('El Swing vigila al menos una moneda: agrega otra antes de quitar esta');
    await postJson('/api/swing/config', { symbols: next });
  });

  const rows = data?.rows || [];
  const errors = data?.errors || {};
  const locked = !!errors.registry;
  const hist = data?.history || {};
  const available = !!hist.available?.ok;
  const recorders = data?.recorders || {};
  const total = perDayTotal(rows);
  const running = rows.filter(r => r.store?.state === 'bajando');
  const firstOutside = rows.findIndex(r => !r.suite);

  return (
    <div className="suite-root">
      <div className="suite-bar">
        <button type="button" className="suite-btn" onClick={onBack}>← Gráfico</button>
        <button type="button" className="suite-btn" onClick={onWatchlist}>Watchlist</button>
        <span className="suite-title">Monedas{TAB > 1 ? ` · pestaña ${TAB}` : ''}</span>
        <div className="suite-spacer" />
        <TabsMenu onModule={onModule} />
        <button type="button" className="suite-btn" onClick={onOpenTheme}>Estilo</button>
      </div>
      <div className="suite-main">
        <div className="bot-view">
          {error && <div className="bot-warning">{error}</div>}
          {errors.symbols && <div className="bot-warning">{errors.symbols}</div>}
          {errors.registry && <div className="bot-warning">{errors.registry}</div>}
          {notice && <div className="bot-empty">{notice}</div>}
          {!data && !error && <div className="bot-empty">Leyendo las monedas…</div>}

          {data && (
            <div className="bot-cards">
              <div className="bot-card">
                <div className="label">En la suite</div>
                <div className="value">{data.suite_count} monedas</div>
              </div>
              <div className="bot-card" title={RECORD.map(([k, label]) => (recorders[k]?.running ? null : `${label}: no corre en este servidor (${recorders[k]?.why})`)).filter(Boolean).join('\n')}>
                <div className="label">Se graban en este PC</div>
                <div className="value">
                  {RECORD.map(([k]) => `${LOWER[k]} ${recorders[k]?.running ? data.recording?.[k] : '—'}`).join(' · ')}
                </div>
              </div>
              <div className="bot-card" title="Lo que escriben por día el libro y la cinta de las monedas de la suite: el promedio de sus últimos 3 días">
                <div className="label">Escriben por día</div>
                <div className="value">{total.estimates ? '≈ ' : ''}{mbText(total.mb)}</div>
              </div>
              <div className="bot-card" title={running.map(r => `${short(r.symbol)}: ${progressText(r.store.progress)}`).join('\n')}>
                <div className="label">Historia del almacén</div>
                <div className="value">
                  {running.length ? running.map(r => `${short(r.symbol)} ${Math.round(r.store.progress?.pct ?? 0)} %`).join(' · ')
                    : hist.building ? `armando ${short(hist.building)}` : 'sin descargas'}
                </div>
              </div>
            </div>
          )}

          <div className="bot-section" ref={formRef}>
            <h3>Agregar a la suite</h3>
            <div className="suite-add-coin">
              <input ref={inputRef} className="suite-input" style={{ width: 150 }} placeholder="Moneda (ej: LINKUSDT)" value={form.symbol}
                onChange={(e) => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                onKeyDown={(e) => { if (e.key === 'Enter') addCoin(); }} aria-label="Moneda nueva" />
              {RECORD.map(([k, label]) => (
                <label key={k} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={form[k]} onChange={(e) => setForm(f => ({ ...f, [k]: e.target.checked }))} /> {label}
                </label>
              ))}
              <label style={{ cursor: 'pointer' }} title={available ? 'Su historia de trades de Bybit, desde que cotiza' : hist.available?.why}>
                <input type="checkbox" checked={form.history && available} disabled={!available}
                  onChange={(e) => setForm(f => ({ ...f, history: e.target.checked }))} /> Bajar su historia
              </label>
              <button type="button" className="suite-btn" onClick={addCoin} disabled={!form.symbol.trim() || busy === 'add' || locked}>Agregar a la suite…</button>
            </div>
            <div className="bot-empty">
              Se comprueba en Bybit. Los trades dan los footprints recientes y la cinta; el libro, el mapa de liquidez y el
              ladder; Hyperliquid, sus liquidaciones. La nube y App 1 no cambian.
            </div>
          </div>

          {data && (running.length > 0 || hist.waiting?.length > 0 || hist.building || !available || hist.queue_busy || hist.control?.pause || hist.error) && (
            <div className="bot-section">
              <h3>Descargas de la historia</h3>
              {!available && <div className="bot-empty">Desde aquí no se baja ni se arma nada: {hist.available?.why}.</div>}
              {running.map(r => (
                <div key={r.symbol} className="suite-add-coin">
                  <span className="suite-dot warn" />
                  <span><b>{short(r.symbol)}</b>: {progressText(r.store.progress)}</span>
                  {hist.ours !== r.symbol && <span className="wl-muted">la bajó el panel de Order Flow u otra copia</span>}
                  {available && <button type="button" className="suite-btn" disabled={busy === 'stop' || hist.stopping} onClick={() => stopDownload([r.symbol])}>{hist.stopping ? 'Deteniendo…' : 'Detener'}</button>}
                </div>
              ))}
              {hist.building && <div className="suite-add-coin"><span className="suite-dot warn" /><span>Armando el almacén de <b>{short(hist.building)}</b>…</span></div>}
              {hist.waiting?.length > 0 && (
                <div className="bot-empty">Esperan su turno: {hist.waiting.map(short).join(', ')}. Se baja una moneda a la vez.</div>
              )}
              {hist.queue_busy && <div className="bot-empty">La cola del panel de Order Flow está activa: lo pedido aquí espera a que termine.</div>}
              {hist.control?.pause && <div className="bot-empty">Las descargas están en pausa desde el panel de Order Flow.</div>}
              {hist.error && <div className="bot-warning">{hist.error}</div>}
            </div>
          )}

          {data && (
            <div className="bot-section">
              <h3>Monedas ({rows.length})</h3>
              <table className="bot-table">
                <thead>
                  <tr>
                    <th>Moneda</th><th>En la suite</th>
                    {RECORD.map(([k, label]) => <th key={k}>{label}</th>)}
                    <th title="Lo que escriben por día su libro y su cinta en este PC">Por día</th>
                    <th title="Su historia de trades de Bybit. La casilla: tenerla al día (official.py, cada 6 h)">Almacén</th>
                    <th title="Lo que ocupa en el disco: su almacén y lo grabado en vivo">En el disco</th>
                    <th title={`Swing del servidor${data.swing_interval ? ` (marco ${data.swing_interval})` : ''}: detecta y anota, no envía nada`}>Swing</th>
                    <th title="La nube (Northflank) graba sus trades y su libro. Se elige aquí en la fase 2">Nube</th>
                    <th title="Su grupo en el probador de App 1. Se elige aquí en la fase 3">App 1</th>
                    <th title="DX en vivo: sus 7 monedas no cambian">DX</th>
                    <th title="Configurada en el bot (Bot > Configuración y riesgo)">Bot</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const st = storeText(row.store, available);
                    const disk = row.history_mb === null || row.history_mb === undefined ? null : (row.history_mb || 0) + (row.live_mb || 0);
                    const pd = row.per_day;
                    return (
                      <React.Fragment key={row.symbol}>
                        {i === firstOutside && (
                          <tr><td colSpan={13} className="wl-muted">Fuera de la suite: con algo guardado o en otra lista</td></tr>
                        )}
                        <tr>
                          <td><b title={row.symbol}>{short(row.symbol)}</b></td>
                          <td>
                            {row.suite ? (
                              <button type="button" className="suite-btn" disabled={!!busy || data.suite_count <= 1} onClick={() => removeFromSuite(row)}
                                title="Deja de verse en la suite; lo grabado se conserva">Quitar</button>
                            ) : (
                              <button type="button" className="suite-btn" disabled={locked} onClick={() => prefill(row.symbol, row.options)}>Agregar…</button>
                            )}
                          </td>
                          {RECORD.map(([k]) => {
                            const note = recordNote(row, k, recorders);
                            return (
                              <td key={k} title={note.title}>
                                <input type="checkbox" checked={!!row.options?.[k]} disabled={!row.suite || locked || busy === `${row.symbol}:${k}`}
                                  aria-label={`${RECORD.find(([kk]) => kk === k)[1]} de ${short(row.symbol)}`}
                                  onChange={(e) => setOption(row, k, e.target.checked)} />
                                {note.text && <span className="wl-muted"> {note.text}</span>}
                              </td>
                            );
                          })}
                          <td title={pd ? `libro ${mbText(pd.book_mb)} · trades ${mbText(pd.trades_mb)} · ${pd.estimate ? 'estimado con lo de hoy' : `promedio de ${pd.days} días`}` : ''}>
                            {pd ? `${pd.estimate ? '≈ ' : ''}${mbText(pd.total_mb)}` : '—'}
                          </td>
                          <td title={st.title}>
                            <input type="checkbox" checked={!!row.options?.store} disabled={locked || busy === `${row.symbol}:store`}
                              aria-label={`Almacén de ${short(row.symbol)} al día`}
                              title="Tenerlo al día con los días oficiales de Bybit" onChange={(e) => setOption(row, 'store', e.target.checked)} />
                            {' '}<span className={`suite-dot ${st.tone || ''}`} />{st.text}
                            {st.action === 'download' && <> <button type="button" className="suite-btn" disabled={!!busy || locked} onClick={() => download(row, false)}>Bajar la historia…</button></>}
                            {st.action === 'continue' && <> <button type="button" className="suite-btn" disabled={!!busy || locked} onClick={() => download(row, true)}>Seguir bajando…</button></>}
                            {st.action === 'cancel' && <> <button type="button" className="suite-btn" disabled={!!busy || locked} onClick={() => cancel(row)}>Sacar</button></>}
                            {!row.options?.store && row.store?.state !== 'sin_historia' && <span className="wl-muted"> · no se pone al día</span>}
                          </td>
                          <td title={disk === null ? 'Midiendo…' : `almacén ${mbText(row.history_mb)} · grabado en vivo ${mbText(row.live_mb)}`}>{disk === null ? '…' : disk > 0 ? mbText(disk) : '—'}</td>
                          <td>
                            <input type="checkbox" checked={!!row.swing} disabled={busy === `${row.symbol}:swing`} aria-label={`Swing de ${short(row.symbol)}`}
                              onChange={(e) => toggleSwing(row, e.target.checked)} />
                          </td>
                          <td>{row.cloud === null || row.cloud === undefined ? '?' : row.cloud ? 'Sí' : '—'}</td>
                          <td>{row.app1 === 'base' ? 'de siempre' : row.app1 === 'nueva' ? 'nueva' : '—'}</td>
                          <td>{row.dx ? 'Sí' : '—'}</td>
                          <td title={row.bot === null || row.bot === undefined ? 'El bot no respondió' : ''}>{row.bot === null || row.bot === undefined ? '?' : row.bot ? 'Sí' : '—'}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && (
            <div className="bot-section">
              <div className="bot-empty">
                Encender una grabación vale al instante; apagarla, al reiniciar la suite. Quitar una moneda o apagar algo no
                borra nada de lo guardado. El Swing cambia al instante, como en su panel de la Watchlist. La nube y App 1 se
                muestran como están: se eligen aquí en las fases 2 y 3 (docs/PLAN_MONEDAS.md).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
