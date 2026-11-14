import React, { useEffect, useRef, useState } from 'react';
import { THEME } from '@app1/components/uiTheme.js';
import { linesFor, subscribeBook } from './botBook.js';
import { fmtQty } from './ladderLogic.js';
import { fmtUsd } from '@app1/components/sustainedLevels.js';

/**
 * Cinta de operaciones grandes (14/11/2026), a la derecha del ladder en la pestaña "Mapa". Pedido del usuario, como el
 * Smart Tape de ATAS: los trades del mismo instante y lado son una orden, y se muestran solo las grandes (de fábrica,
 * el 1% más grande de los últimos 30 minutos). Sale de los trades que ya recibe la suite (/api/book/tape).
 * - Verde ▲ compra agresiva, rojo ▼ venta agresiva; en negrita las de 3 veces el mínimo o más.
 * - Una orden que cruzó varios precios dice el rango ("65,586.5→65,576.2"): un barrido. Al pasar el mouse, cuánto cruzó.
 * - Resaltada si tocó el precio de una Limit tuya.
 * - Arriba, lo comprado y lo vendido a mercado en los últimos 30 s.
 */

export const TAPE_WIDTH = 236;
const POLL_MS = 1000;
const HIDDEN_POLL_MS = 4000;
const MINIMUMS = [0, 50000, 100000, 250000, 500000, 1000000];

const timeText = (t) => new Date(t).toLocaleTimeString('es-CO', { hour12: false });
const priceText = (p) => Number(p.toPrecision(8)).toLocaleString('en-US');

export default function TapePanel({ symbol, active = true, minUsd = 0, onMinUsd }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [limits, setLimits] = useState([]);
  const stopRef = useRef(false);

  // tus Limit de esta moneda: se resalta lo que se negoció en su precio
  useEffect(() => {
    const update = () => setLimits(linesFor(symbol).filter(l => l.kind === 'order' && l.price > 0).map(l => l.price));
    update();
    return subscribeBook(update);
  }, [symbol]);

  useEffect(() => {
    stopRef.current = false;
    setData(null);
    let timer = null;
    const tick = async () => {
      try {
        const r = await fetch(`/api/book/tape/${encodeURIComponent(symbol)}?min_usd=${minUsd}&limit=80`);
        const d = await r.json().catch(() => ({}));
        if (stopRef.current) return;
        if (!r.ok || !d.success) setError(d.detail || `error ${r.status}`);
        else { setError(null); setData(d); }
      } catch {
        if (!stopRef.current) setError('sin respuesta del servidor');
      }
      if (!stopRef.current) timer = setTimeout(tick, active && !document.hidden ? POLL_MS : HIDDEN_POLL_MS);
    };
    tick();
    return () => { stopRef.current = true; clearTimeout(timer); };
  }, [symbol, minUsd, active]);

  const up = THEME.up || '#089981';
  const down = THEME.down || '#F23645';
  const thr = data?.min_usd || 0;
  const buy = data?.buy_30s || 0;
  const sell = data?.sell_30s || 0;
  const total = buy + sell;

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--t-line, #d0d4da)',
      background: 'var(--t-chart, #fff)', fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px' }}>
        <span className="wl-muted" style={{ fontWeight: 600 }}>Cinta</span>
        <select className="suite-select" value={minUsd} onChange={(e) => onMinUsd(Number(e.target.value))} aria-label="Tamaño mínimo de la cinta"
          title="Solo las órdenes de ese tamaño o más. Automático: el 1% más grande de los últimos 30 minutos">
          {MINIMUMS.map(m => <option key={m} value={m}>{m ? `≥ ${fmtUsd(m)}` : `Auto${thr ? ` (${fmtUsd(thr)})` : ''}`}</option>)}
        </select>
      </div>
      <div style={{ padding: '0 6px 4px' }} title="Lo comprado y lo vendido a mercado en los últimos 30 segundos, de todos los tamaños">
        <div className="wl-muted">30 s: <span style={{ color: up }}>compra {fmtUsd(buy)}</span> · <span style={{ color: down }}>venta {fmtUsd(sell)}</span></div>
        {total > 0 && (
          <div style={{ display: 'flex', height: 4, marginTop: 2 }}>
            <div style={{ width: `${(100 * buy) / total}%`, background: up }} />
            <div style={{ flex: 1, background: down }} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid var(--t-line, #d0d4da)' }}>
        {error && <div className="wl-muted" style={{ padding: 6 }}>Cinta: {error}</div>}
        {!error && data?.note && <div className="wl-muted" style={{ padding: 6 }}>{data.note}</div>}
        {!error && data && !data.note && !data.orders.length && <div className="wl-muted" style={{ padding: 6 }}>Ninguna orden de ese tamaño en 30 minutos</div>}
        {(data?.orders || []).map((o, k) => {
          const color = o.side === 'buy' ? up : down;
          const strong = thr > 0 && o.usd >= 3 * thr;
          const mine = limits.some(p => p >= o.lo - 1e-9 && p <= o.hi + 1e-9);
          const range = o.levels > 1 ? `${priceText(o.p0)}→${priceText(o.p1)}` : priceText(o.p0);
          return (
            <div key={`${o.t}-${o.side}-${k}`} title={`${o.trades} trades${o.levels > 1 ? ` · cruzó ${priceText(o.hi - o.lo)} (${o.levels} ticks)` : ''}${mine ? ' · tocó el precio de tu Limit' : ''}`}
              style={{ display: 'flex', gap: 6, padding: '2px 6px', alignItems: 'baseline', fontWeight: strong ? 700 : 400,
                background: mine ? 'var(--t-accent-soft, rgba(41,98,255,0.12))' : undefined,
                borderBottom: '1px solid var(--t-line, #eee)' }}>
              <span className="wl-muted" style={{ width: 50, flexShrink: 0 }}>{timeText(o.t)}</span>
              <span style={{ color, width: 10, flexShrink: 0 }}>{o.side === 'buy' ? '▲' : '▼'}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {range}
              </span>
              <span style={{ color, width: 38, textAlign: 'right', flexShrink: 0 }}>{fmtQty(o.qty)}</span>
              <span style={{ color, width: 38, textAlign: 'right', flexShrink: 0 }}>{fmtUsd(o.usd)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
