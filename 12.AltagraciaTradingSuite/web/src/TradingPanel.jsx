import React, { useEffect, useMemo, useRef, useState } from 'react';
import { orderPreview, orderQuantity, priceAtPercent, AUTO_ENTRY_DISTANCE } from '@app1/components/backtesting/orderPlan.js';
import AnalysisLevels from '@app1/components/backtesting/AnalysisLevels.jsx';
import { chosenLabel, knownLevels } from '@app1/components/indicators/analysisLevels.js';
import { getJson, postJson } from './api.js';
import { bookError, linesFor, runPositionAction, subscribeBook } from './botBook.js';

/**
 * Panel de trading en vivo: el formulario de App 1 (caja TP/SL del grafico, monto fijo o por riesgo, tipo
 * automatico) enviando al bot real por el servidor de la suite. El bot solo tiene Market y Limit: una
 * entrada que pediria una orden stop no se envia. Siempre con stop y objetivo, y con confirmacion.
 */

const SIZE_KEY = 'suite_order_size';
const decimalsOf = (step) => {
  const text = String(step ?? '');
  if (text.includes('e-')) return parseInt(text.split('e-')[1], 10);
  return text.includes('.') ? text.split('.')[1].length : 0;
};
const floorTo = (value, step) => (step > 0 ? Math.floor(value / step + 1e-9) * step : value);
const roundTo = (value, step) => (step > 0 ? Math.round(value / step) * step : value);
const fmt = (value, digits = 2) => (value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits));
const boxKey = (b) => `${b.entryPrice}|${b.slPrice}|${b.tpPrice}`;

/** Posición real con su P&L al precio actual, y cerrar o mover SL/TP (lo mismo que arrastrar sus líneas en el gráfico). */
function PositionCard({ line, price, digits, onAction }) {
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const last = Number.isFinite(price) && price > 0 ? price : null; // sin precio, la validación queda para el bot
  const pnl = last ? (last - line.entry) * line.size * (line.side === 'Buy' ? 1 : -1) : null;
  const value = (text) => Number(String(text).replace(',', '.'));
  const move = (field, text) => onAction({ type: 'move', line, field, price: value(text), lastPrice: last });
  return (
    <div className="control-section">
      <div>
        <b className={line.side === 'Buy' ? 'pos' : 'neg'}>{line.side === 'Buy' ? 'LONG' : 'SHORT'}</b> · {line.size} · entrada {fmt(line.entry, digits)}
        {pnl !== null && <> · <b className={pnl >= 0 ? 'pos' : 'neg'}>{pnl >= 0 ? '+' : '−'}{Math.abs(pnl).toFixed(2)} USD</b></>}
      </div>
      <div className="price-hint">
        SL {line.stopLoss ? fmt(line.stopLoss, digits) : <b style={{ color: '#c62828' }}>SIN STOP</b>} · TP {line.takeProfit ? fmt(line.takeProfit, digits) : '—'}
        {line.liqPrice ? ` · Liq. ${fmt(line.liqPrice, digits)}` : ''}
        {line.pending ? ' · enviando…' : ''}
      </div>
      <div className="suite-add-coin">
        <input className="suite-input" style={{ width: 90 }} placeholder="SL nuevo" value={sl} onChange={(e) => setSl(e.target.value)} />
        <button type="button" className="suite-btn" disabled={!(value(sl) > 0)} onClick={() => move('stopLoss', sl)}>Mover SL…</button>
        <input className="suite-input" style={{ width: 90 }} placeholder="TP nuevo" value={tp} onChange={(e) => setTp(e.target.value)} />
        <button type="button" className="suite-btn" disabled={!(value(tp) > 0)} onClick={() => move('takeProfit', tp)}>{line.takeProfit ? 'Mover TP…' : 'Poner TP…'}</button>
        {line.takeProfit && <button type="button" className="suite-btn" onClick={() => onAction({ type: 'remove', line, field: 'takeProfit' })}>Quitar TP…</button>}
        <button type="button" className="suite-btn" onClick={() => onAction({ type: 'close', line, lastPrice: last })}>Cerrar posición…</button>
      </div>
    </div>
  );
}

function loadSize() {
  try {
    return { mode: 'fixed', fixed: '100', risk: '5', ...(JSON.parse(localStorage.getItem(SIZE_KEY)) || {}) };
  } catch {
    return { mode: 'fixed', fixed: '100', risk: '5' };
  }
}

export default function TradingPanel({ symbol, shapes, onClose, onDecision }) {
  const [decisionNote, setDecisionNote] = useState(''); // por qué entro: va al journal con la imagen y los niveles
  const [tab, setTab] = useState('trading');
  const [status, setStatus] = useState(null);
  const [coins, setCoins] = useState(null);
  const [price, setPrice] = useState(null);
  const [, setBookVersion] = useState(0);
  const [posNotice, setPosNotice] = useState(null);
  const [orderType, setOrderType] = useState('auto');
  const [manualSide, setManualSide] = useState('long');
  const [useBox, setUseBox] = useState(true);
  const [size, setSize] = useState(loadSize);
  const [slPct, setSlPct] = useState('');
  const [tpPct, setTpPct] = useState('');
  const [limitText, setLimitText] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const touched = useRef(new Map()); // id de la caja -> { key, at }: la tocada mas recientemente manda

  useEffect(() => {
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(size)); } catch { /* sin almacenamiento */ }
  }, [size]);

  // Bot: modo y configuracion de monedas (cada 30 s); precio cada 2 s; posicion cada 10 s
  useEffect(() => {
    let alive = true;
    const read = () => {
      getJson('/api/bot/overview').then(d => alive && setStatus(d.status)).catch(() => alive && setStatus(null));
      getJson('/api/bot/config').then(d => alive && setCoins(d.coins || [])).catch(() => alive && setCoins(null));
    };
    read();
    const timer = setInterval(read, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let alive = true;
    setPrice(null);
    setResult(null);
    setPosNotice(null);
    const readPrice = () => getJson(`/api/ticker/${symbol}`).then(d => alive && setPrice(d.price)).catch(() => {});
    readPrice();
    const t1 = setInterval(readPrice, 2000);
    return () => { alive = false; clearInterval(t1); };
  }, [symbol]);
  // Posiciones y órdenes de la cuenta activa: las mismas que dibuja el gráfico (botBook.js)
  useEffect(() => subscribeBook(() => setBookVersion(v => v + 1)), []);
  const actOnPosition = async (action) => {
    const outcome = await runPositionAction(action);
    if (outcome) setPosNotice(outcome);
  };

  // La caja TP/SL tocada mas recientemente (creada o movida), como en App 9
  const box = useMemo(() => {
    const now = Date.now();
    const boxes = (shapes || []).filter(s => s && s.type === 'tpsl' && s.entryPrice > 0 && s.slPrice > 0 && s.tpPrice > 0);
    boxes.forEach((b, i) => {
      const seen = touched.current.get(b.id);
      if (!seen) touched.current.set(b.id, { key: boxKey(b), at: now - (boxes.length - i) });
      else if (seen.key !== boxKey(b)) touched.current.set(b.id, { key: boxKey(b), at: now });
    });
    const latest = boxes.sort((a, b) => touched.current.get(a.id).at - touched.current.get(b.id).at).pop();
    if (!latest) return null;
    return { id: latest.id, entryPrice: latest.entryPrice, slPrice: latest.slPrice, tpPrice: latest.tpPrice, side: latest.tpPrice < latest.entryPrice ? 'short' : 'long' };
  }, [shapes]);

  const coin = coins?.find(c => c.symbol === symbol) || null;
  const tick = coin ? Number(coin.tick_size) : 0;
  const step = coin ? Number(coin.step_size) : 0;
  const priceDigits = tick ? decimalsOf(coin.tick_size) : (price >= 1000 ? 1 : price >= 1 ? 3 : 5);
  const usingBox = !!box && useBox;
  const side = usingBox ? box.side : manualSide;

  // Entrada, stop y objetivo
  let entry = null;
  let finalType = null;
  if (usingBox) entry = box.entryPrice;
  else if (orderType === 'limit') entry = parseFloat(limitText);
  else entry = price;
  if (entry > 0 && price > 0) {
    if (orderType === 'market') finalType = 'Market';
    else if (orderType === 'limit') finalType = 'Limit';
    else if (Math.abs(entry - price) <= price * AUTO_ENTRY_DISTANCE) finalType = 'Market';
    else finalType = (side === 'long' ? entry < price : entry > price) ? 'Limit' : 'Stop';
  }
  const refPrice = finalType === 'Market' ? price : entry;
  const stop = usingBox ? box.slPrice : priceAtPercent(refPrice, side, slPct, false);
  const target = usingBox ? box.tpPrice : priceAtPercent(refPrice, side, tpPct, true);
  const amount = parseFloat(size.mode === 'risk' ? size.risk : size.fixed);
  const rawQty = refPrice > 0 ? orderQuantity({ mode: size.mode, amount, entry: refPrice, stopLoss: stop }) : 0;
  const quantity = floorTo(rawQty, step);
  const preview = orderPreview({ quantity, entry: refPrice || 0, stopLoss: stop, takeProfit: target });

  const blocked = (() => {
    if (!status) return 'El bot no responde';
    if (!status.credentials_configured) return 'El bot no tiene credenciales de Bybit';
    if (status.trading_paused) return 'El bot está en pausa';
    if (!coins) return 'No se pudo leer la configuración del bot';
    if (!coin) return `${symbol} no está configurada en el bot (agrégala en Bot > Configuración)`;
    if (!(price > 0)) return 'Sin precio de Bybit';
    if (!(entry > 0)) return 'Escribe el precio de entrada';
    if (finalType === 'Stop') return 'Esa entrada pide una orden stop y el bot solo tiene Market y Limit: espera el precio o usa Limit';
    if (finalType === 'Limit' && ((side === 'long' && entry >= price) || (side === 'short' && entry <= price))) return 'Una Limit así cruza el precio y se llenaría a mercado';
    if (!(stop > 0) || !(target > 0)) return 'Falta el stop o el objetivo';
    if ((side === 'long' && !(stop < refPrice && refPrice < target)) || (side === 'short' && !(target < refPrice && refPrice < stop))) return 'El stop o el objetivo están del lado equivocado del precio';
    if (!(quantity > 0)) return size.mode === 'risk' ? 'Por riesgo necesita un stop y un monto' : 'Escribe el monto';
    if (coin.min_qty && quantity < Number(coin.min_qty)) return `La cantidad es menor que el mínimo de Bybit (${coin.min_qty})`;
    return null;
  })();

  const prepare = () => {
    if (blocked) return;
    setResult(null);
    setConfirm({
      symbol, side: side === 'long' ? 'Buy' : 'Sell', order_type: finalType === 'Limit' ? 'Limit' : 'Market', quantity: Number(quantity.toFixed(decimalsOf(coin.step_size))),
      stop_loss: Number(roundTo(stop, tick).toFixed(priceDigits)), take_profit: Number(roundTo(target, tick).toFixed(priceDigits)),
      current_price: price, limit_price: finalType === 'Limit' ? Number(roundTo(entry, tick).toFixed(priceDigits)) : undefined,
      preview, mode: status.mode, boxId: usingBox ? box.id : null,
    });
  };

  const send = async () => {
    if (!confirm || sending) return;
    if (confirm.symbol !== symbol) {
      setConfirm(null);
      return;
    }
    setSending(true);
    const { preview: _p, mode: _m, boxId: _b, ...body } = confirm;
    // Journal (paso 4): la imagen de la decisión sale ya, con lo elegido para este trade. No se espera: la orden sale
    // igual aunque la imagen falle. Lo elegido sale de la lista solo si la orden queda en Bybit (settle, 12/11/2026)
    const decision = onDecision?.({
      symbol: body.symbol, side: body.side, note: decisionNote.trim(),
      order: { type: body.order_type, qty: body.quantity, entry: body.limit_price ?? body.current_price, stop: body.stop_loss,
               target: body.take_profit, risk: confirm.preview?.loss },
    });
    let outcome = 'unknown';
    let ids = {};
    try {
      const r = await postJson('/api/bot/trade', { ...body, confirm: 'ENVIAR_ORDEN_REAL' });
      setResult({ ok: r.success !== false, status: r.status, message: r.message, result: r.result });
      outcome = r.status === 'failed' ? 'rejected' : r.status === 'unknown' ? 'unknown' : 'placed';
      ids = { order_id: r.order_id || null, order_link_id: r.order_link_id || null };
    } catch (e) {
      // Un "no" del servidor o del bot (4xx), o el bot sin conexión (503): la orden no salió. Sin respuesta: no se sabe
      const refused = (e.status >= 400 && e.status < 500) || e.status === 503;
      outcome = refused ? 'rejected' : 'unknown';
      setResult({ ok: false, status: refused ? 'error' : 'unknown', message: e.message });
    } finally {
      setSending(false);
      setConfirm(null);
    }
    if (outcome !== 'rejected') setDecisionNote(''); // rechazada: la nota sigue para la orden corregida
    Promise.resolve(decision).then(d => d?.settle?.(outcome, ids)).catch(() => {});
  };

  const mode = status?.mode ? String(status.mode).toUpperCase() : null;
  const accountName = status?.account?.name || null; // cuenta activa del bot: las ordenes van a ella
  const bookLines = linesFor(symbol);
  const posList = bookLines.filter(l => l.kind === 'position');
  const orderLines = bookLines.filter(l => l.kind === 'order');
  const bookProblem = bookError();
  const chosenNow = confirm ? knownLevels(confirm.symbol, Infinity) : []; // lo que va con la orden que se confirma

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title" title={accountName ? `Cuenta activa del bot: ${accountName}` : ''}>
          Panel de Trading{mode ? ` · ${mode}` : ''}{accountName ? ` · ${accountName}` : ''}
        </span>
        <button className="btn-collapse" onClick={onClose} title="Ocultar panel">✕</button>
      </div>
      <div className="sidebar-tabs">
        <button className={`tab-btn ${tab === 'trading' ? 'active' : ''}`} onClick={() => setTab('trading')}>📊 Trading</button>
        <button className={`tab-btn ${tab === 'position' ? 'active' : ''}`} onClick={() => setTab('position')}>📌 Posición{posList.length ? ` (${posList.length})` : ''}</button>
      </div>
      <div className="sidebar-content">
        {tab === 'trading' && (
          <div className="trading-controls">
            <h3>{symbol} {price > 0 && <span style={{ fontWeight: 400, fontSize: 13 }}>· {fmt(price, priceDigits)}</span>}</h3>
            {mode === 'LIVE' && <div className="suite-live-warning">Cuenta REAL: las órdenes usan dinero real.</div>}

            <div className="control-section">
              <label>Tipo de Orden</label>
              <select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                <option value="auto">Automática</option>
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
              {orderType === 'auto' && finalType && (
                <div className="price-hint">Se enviará como {finalType.toUpperCase()}. A más de 0.1% del precio, espera ese precio.</div>
              )}
            </div>

            {box && (
              <div className="control-section">
                <label>
                  Caja TP/SL del gráfico
                  <input type="checkbox" checked={useBox} onChange={(e) => setUseBox(e.target.checked)} style={{ marginLeft: 10 }} />
                  <span style={{ fontSize: 12, marginLeft: 5 }}>Usarla</span>
                </label>
                <div className="price-hint">
                  {box.side.toUpperCase()} · Entrada {fmt(box.entryPrice, priceDigits)} · SL {fmt(box.slPrice, priceDigits)} · TP {fmt(box.tpPrice, priceDigits)}
                </div>
              </div>
            )}

            <div className="control-section">
              <label>Lado</label>
              <div className="side-buttons">
                <button className={`btn-side btn-long ${side === 'long' ? 'active' : ''}`} onClick={() => setManualSide('long')} disabled={usingBox}>LONG 📈</button>
                <button className={`btn-side btn-short ${side === 'short' ? 'active' : ''}`} onClick={() => setManualSide('short')} disabled={usingBox}>SHORT 📉</button>
              </div>
            </div>

            <div className="control-section">
              <label>Tamaño de la orden</label>
              <div className="quick-sltp">
                {[['fixed', 'Monto fijo'], ['risk', 'Por riesgo']].map(([m, label]) => (
                  <button key={m} className="btn-quick" onClick={() => setSize(s => ({ ...s, mode: m }))} style={size.mode === m ? { background: '#2962ff', color: 'white' } : undefined}>
                    {label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                step={size.mode === 'risk' ? '1' : '10'}
                value={size.mode === 'risk' ? size.risk : size.fixed}
                onChange={(e) => setSize(s => ({ ...s, [s.mode === 'risk' ? 'risk' : 'fixed']: e.target.value }))}
                placeholder={size.mode === 'risk' ? 'USDT a arriesgar' : 'Monto en USDT'}
              />
              <div className="price-hint">
                {quantity > 0 ? `Cantidad ${quantity.toFixed(decimalsOf(coin?.step_size))} · Inversión $${preview.investment.toFixed(2)}` : 'Sin cantidad todavía'}
                {preview.loss !== null && quantity > 0 && ` · Pierde $${preview.loss.toFixed(2)}`}
                {preview.profit !== null && quantity > 0 && ` · Gana $${preview.profit.toFixed(2)}`}
                {preview.ratio !== null && quantity > 0 && ` · R/R 1:${preview.ratio.toFixed(2)}`}
                {coin && <><br />Riesgo configurado en el bot para {symbol}: ${coin.risk_amount} (sin comisiones; el bot las suma)</>}
              </div>
            </div>

            {!usingBox && (
              <>
                {orderType === 'limit' && (
                  <div className="control-section">
                    <label>Precio de entrada (Limit)</label>
                    <input type="number" step={tick || 'any'} value={limitText} onChange={(e) => setLimitText(e.target.value)} placeholder="Precio" />
                  </div>
                )}
                <div className="control-section">
                  <label>Stop Loss %</label>
                  <input type="number" step="0.1" min="0" value={slPct} onChange={(e) => setSlPct(e.target.value)} placeholder="Ej: 0.5 (= 0.5%)" />
                  {stop > 0 && <div className="price-hint">{fmt(stop, priceDigits)}</div>}
                </div>
                <div className="control-section">
                  <label>Take Profit %</label>
                  <input type="number" step="0.1" min="0" value={tpPct} onChange={(e) => setTpPct(e.target.value)} placeholder="Ej: 1 (= 1%)" />
                  {target > 0 && <div className="price-hint">{fmt(target, priceDigits)}</div>}
                </div>
                <div className="control-section">
                  <label>SL/TP Rápido</label>
                  <div className="quick-sltp">
                    {[[0.5, 1], [1, 2], [2, 4]].map(([s, t]) => (
                      <button key={s} className="btn-quick" onClick={() => { setSlPct(String(s)); setTpPct(String(t)); }}>SL {s}% / TP {t}%</button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <AnalysisLevels symbol={symbol} time={Infinity} numbered />

            <div className="control-actions">
              <button className={`btn-create-order ${side === 'long' ? 'btn-long' : 'btn-short'}`} onClick={prepare} disabled={!!blocked} title={blocked || ''}>
                {side === 'long' ? '🟢 COMPRAR (LONG)' : '🔴 VENDER (SHORT)'}
              </button>
            </div>
            {blocked && <div className="price-hint" style={{ color: '#c62828' }}>{blocked}</div>}

            {result && (
              <div className={`suite-result ${result.ok && (result.status === 'success' || result.status === 'pending') ? 'ok' : 'bad'}`}>
                {result.status === 'success' && 'Orden ejecutada en Bybit.'}
                {result.status === 'pending' && 'Orden Limit puesta en Bybit; espera su precio.'}
                {result.status === 'unprotected' && 'ATENCIÓN: la posición quedó SIN STOP. Revisa Bybit ahora y no reintentes.'}
                {result.status === 'closed_unprotected' && 'No se pudo poner el stop: el bot cerró la posición a mercado. Revisa Bybit.'}
                {result.status === 'unknown' && 'Resultado desconocido: revisa Bybit antes de reintentar.'}
                {(result.status === 'failed' || result.status === 'error' || !result.status) && `No se envió: ${result.message || 'error'}`}
                {result.result?.tp_failed && ' El objetivo (TP) no se pudo poner.'}
              </div>
            )}
          </div>
        )}

        {tab === 'position' && (
          <div className="trading-controls">
            <h3>Posición en {symbol}</h3>
            {bookProblem && !posList.length && <div className="price-hint">Sin respuesta del bot: {bookProblem}</div>}
            {!bookProblem && !posList.length && !orderLines.length && <div className="price-hint">Sin posición ni órdenes abiertas.</div>}
            {posList.map(line => (
              <PositionCard key={line.id} line={line} price={Number(price)} digits={priceDigits} onAction={actOnPosition} />
            ))}
            {orderLines.map(line => (
              <div key={line.id} className="control-section">
                <div>{line.orderType} {line.side === 'Buy' ? 'compra' : 'venta'} · {line.qty} · a {fmt(line.price, priceDigits)}</div>
                <div className="price-hint">SL {line.stopLoss ? fmt(line.stopLoss, priceDigits) : '—'} · TP {line.takeProfit ? fmt(line.takeProfit, priceDigits) : '—'}</div>
                <button type="button" className="suite-btn" disabled={!!line.pending} onClick={() => actOnPosition({ type: 'cancel', line })}>
                  {line.pending ? 'Cancelando…' : 'Cancelar orden…'}
                </button>
              </div>
            ))}
            {posNotice && <div className={`suite-result ${posNotice.ok ? 'ok' : 'bad'}`}>{posNotice.message}</div>}
            <div className="price-hint">
              También en el gráfico: × cierra la posición o cancela la orden, y las etiquetas SL y TP se arrastran para moverlos. Todo pide confirmación.
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} className="suite-confirm">
            <h3 style={{ marginTop: 0 }}>Confirmar orden {confirm.mode === 'live' || mode === 'LIVE' ? 'REAL' : mode}{accountName ? ` en ${accountName}` : ''}</h3>
            <table className="bot-table">
              <tbody>
                <tr><td>Moneda</td><td><b>{confirm.symbol}</b></td></tr>
                <tr><td>Lado</td><td><b className={confirm.side === 'Buy' ? 'pos' : 'neg'}>{confirm.side === 'Buy' ? 'LONG (compra)' : 'SHORT (venta)'}</b></td></tr>
                <tr><td>Tipo</td><td>{confirm.order_type}{confirm.limit_price ? ` a ${confirm.limit_price}` : ' (precio de Bybit al enviar)'}</td></tr>
                <tr><td>Cantidad</td><td>{confirm.quantity}</td></tr>
                <tr><td>Stop</td><td>{confirm.stop_loss}</td></tr>
                <tr><td>Objetivo</td><td>{confirm.take_profit}</td></tr>
                <tr><td>Pierde / gana</td><td>${fmt(confirm.preview.loss)} / ${fmt(confirm.preview.profit)} (sin comisiones)</td></tr>
                <tr>
                  <td>Para el análisis</td>
                  <td>
                    {chosenNow.length === 0 ? 'nada elegido en el gráfico' : chosenNow.map((item, i) => (
                      <div key={item.id}>{i + 1}. {chosenLabel(item)}</div>
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
            <textarea className="suite-input" style={{ width: '100%', minHeight: 48, marginTop: 10, boxSizing: 'border-box' }} maxLength={4000}
              placeholder="Por qué entro (opcional, queda en el journal con la imagen y los niveles elegidos)"
              value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn-quick" onClick={() => setConfirm(null)}>Cancelar</button>
              <button className={`btn-create-order ${confirm.side === 'Buy' ? 'btn-long' : 'btn-short'}`} style={{ width: 'auto', padding: '6px 14px' }} onClick={send} disabled={sending}>
                {sending ? 'Enviando…' : 'Enviar al bot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
